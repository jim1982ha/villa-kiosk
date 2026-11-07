"""An incident's message in each chat: the one module that decides what a chat shows of an incident.

⚠️ ONE MESSAGE PER INCIDENT PER CHAT (owner, 2026-10-09: "only show the latest message for a given incident, so the
Telegram channel is not overflowed"). Every message about an incident — the alert, a reminder, an escalation, an
answer, and Home Assistant's own alert once its incident is known — replaces the earlier one in the same chat: the
new one is posted first, then the older one is deleted, so a failed send never leaves the chat without the incident.
One Telegram will no longer let the bot delete (older than 48 hours) is cut down to a pointer instead.

⚠️ ONE MODULE, ONE RECORD (architecture review 12, 2026-10-09). This was spread over two record families with two
lifetimes, alert_buttons' replace / adopt / settle, and the order outcome.carry_out ran them in. Settling after the
sends took the buttons off the owner's escalation the moment "Need help" sent it, and the latest-message records were
never pruned. Here a chat holds one record per incident (state.incident_message) and `close` settles only what was
shown before it, whatever order the caller uses.

⚠️ ONE CHANGE AT A TIME PER INCIDENT (architecture review scan 1, 2026-10-19 — #55 shown twice in the owner's group): a
post read the chat's record, waited on Telegram to delete the older message, then wrote its own. Every Home Assistant
event, button press and scheduler tick is its own task, and nothing ran one incident's changes one at a time: two
posts read the same record, one's message was left in the chat with nothing pointing at it — its buttons live. Every
public method holds the incident's lock; what it reads, it reads under it.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

import asyncio
import logging

from vesta_shared.limits import limit
from vesta_shared.message_format import AND
from vesta_shared.messaging import incident_tag
from vesta_shared.status_words import pick

from . import kiosk_messages, layout
from .telegram import GONE

log = logging.getLogger("vesta.thread")

Edit = Callable[..., Awaitable]     # (chat, message id, text[, keyboard])
Delete = Callable[[int, int], Awaitable]

#: How long a copy Telegram refused to update is tried again (at every housekeeping pass), then given up.
#: ⚠️ A DURATION, NEVER A COUNT (architecture review 22): 12 tries were meant as "about an hour" at one pass every five
#: minutes — housekeeping runs every 30 seconds, so a 10-minute internet cut outlived them and left the buttons.


#: How many of a chat's earlier copies of an incident are remembered as replaced (never taken over again).
REPLACED_KEPT = 50


def owed_for() -> timedelta:
    return timedelta(hours=limit("telegram.edit_retry_hours", 2, unit="hours", group="text", lo=1, hi=72,
                                 says="How long a message Telegram refused to update is tried again (its buttons "
                                      "removed, its status written).",
                                 reached="It is given up: that copy keeps its old text and buttons.", told=""))


class PlainWords:
    """A thread's words as given: its copies' headings, Status and language with no notices to draw them (a test, or a
    thread built before them). notice.Notices is the one the engine uses: the same seven methods."""

    def retitle(self, iid, head: str, chat: int = 0) -> str:
        return head

    def heading(self, chat: int, incident: int | None = None) -> str | None:
        return None

    def story_of(self, incident: int, chat: int, shown) -> None:
        return None

    def lang(self, chat: int) -> str:
        return "en"

    def restatus(self, chat: int, p: dict) -> dict:
        return p

    def closed_now(self, incident: int) -> bool:
        return False

    def refold(self, incident: int) -> dict:
        return {}


class IncidentThread:
    def __init__(self, state, timezone: str, edit: Edit | None = None, delete: Delete | None = None, *,
                 words=None, name: Callable[[int | str], str] = incident_tag, translations: Callable[[], object] | None = None,
                 mirror=None, media: Callable[..., Awaitable] | None = None, send: Callable[..., Awaitable] | None = None):
        """⚠️ EVERY COLLABORATOR AT CONSTRUCTION (architecture review 2026-10-30, round 2): eight of them were set on the
        thread after it was built, each a None the code had to test for, and one forgotten was a feature silently off.

        `words`: notice.Notices (or PlainWords): `retitle` (a copy's heading as its incident stands now); `heading` (chat,
        incident): the whole heading again, title, "To:" and EVERY earlier step, used when a copy's status is REPLACED
        (owner, 2026-10-15: "Escalation sent … to Owner" vanished when "Ticket opened…" replaced it); `lang` (chat) and
        `restatus` (chat, parts): each chat's Status in its own language (owner, 2026-10-23); `story_of` (incident,
        chat, its lines): a copy drawn before its heading held every step, told for everyone (tell_open); `refold`
        (incident): a history recorded a line per repeat, folded, and each copy's heading then.
        `name`: incidents.Incidents.name, how the incident is named ("#9-P2") in a pointer to its newer message.
        `translations` () → translation.Translations (or None): the alert's own words in each chat's language, when known,
        else asked for in the background (owner, 2026-10-23); a lookup, since they are built on this thread. None: as
        written.
        `mirror` (a record): kiosk_messages.KioskMessages.keep, the copy as it stands kept for the tablet too (ticket 25
        of "One inbox"); None: not kept. Called at every change that is the incident's own step, never at a retry or a
        redraw in another language (`tell` of _show): the tablet's record is the latest step, not whichever chat was
        drawn last."""
        self.state = state
        self.tz = timezone
        self.edit = edit                # Telegram's edit (its buttons go); None while Telegram is off
        self.delete = delete            # Telegram's deleteMessage: True when the message is gone
        self.words = words or PlainWords()
        self.name = name
        self._translations = translations or (lambda: None)
        self._wanted: dict[tuple[str, int], tuple] = {}  # (incident, chat) → its words still to translate, once recorded
        self.mirror = mirror
        # a copy's picture replaced (delivery.Delivery.edit_media: "shown", "not_media", "refused"), and a copy sent
        # again as a photo when it is a text message (delivery.Delivery.send): a visit's sheet (`picture`)
        self.media, self.send = media, send
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock(self, iid: int | str) -> asyncio.Lock:
        """Incident `iid`'s lock: its copies change one at a time (see the module's note)."""
        return self._locks.setdefault(str(iid), asyncio.Lock())

    async def post(self, iid: int | str, chat: int, mid: int, parts: dict, *, buttons: bool = False,
                   keyboard: dict | None = None, photo=None, sheet: str | None = None) -> None:
        """Message `mid`, just sent to `chat` with these `parts` (layout.py), is now incident `iid`'s message there: the
        earlier one goes. `photo`: the picture it carries ((base64, mime)), kept for the tablet; `sheet`:
        the visit's sheet it carries (its fingerprint: `picture` leaves it as it is)."""
        async with self._lock(iid):
            await self._post(iid, chat, mid, parts, buttons=buttons, keyboard=keyboard, photo=photo, sheet=sheet)

    def taken(self, iid: int | str, run: str) -> None:
        """The villa's automation run `run` (its context id) is incident `iid`'s: its announcement on the tablet gives way
        to the incident's card. Told again at once when the card was already told without it."""
        if run and self.state.add_incident_run(iid, run) and (card := self.state.incident_card(iid)):
            self.tell(iid, card["parts"], card.get("keyboard"))

    def tell(self, iid: int | str, parts: dict, keyboard: dict | None = None, photo=None) -> None:
        """Keep the copy as it stands for the tablet (`mirror`): one record per incident, replaced at each step.

        ⚠️ THE CARD IS KEPT HERE, NOT REBUILT FROM THE CHATS (architecture review round 14, card 2): it was held in memory
        only, so after a restart a request only the tablet holds kept its Approve button once decided or expired
        (`_tell_alone` had nothing to change), and every open alert's card was guessed back from the Telegram copies
        (`tell_open`). It is the thread's own record now (state.incident_card): its picture is not, the Kiosk keeps
        one a later copy does not carry (agent-contract.json vestaMessage.keptOnRewrite)."""
        if self.mirror is None:
            return
        parts = self._for_everyone(parts)
        self.state.set_incident_card(iid, {"parts": parts, "keyboard": keyboard})
        # ⚠️ WHO IT WENT TO IS EVERY CHAT'S, NOT THE LAST DRAWN'S: each chat's copy says its own "To:" (owner and FM, one
        # group each); the tablet's one record names them all, in the words a "To:" line uses (message_format.audience)
        # ⚠️ AND THIS COPY'S OWN (architecture review 2026-10-29, round 2): a copy Telegram refused is in no chat, and its
        # reader is precisely the one the tablet stands in for
        heads = [layout.of(copy).get("head") for _c, copy in self.state.incident_chats(iid)] + [parts.get("head")]
        roles = list(dict.fromkeys(r for h in heads for r in kiosk_messages.roles_of((layout.head_of(h) or {}).get("to"))))
        # ⚠️ THE VILLA'S OWN MESSAGES IT STANDS FOR (tickets 26-27 of "One inbox", owner 2026-10-28: "update the existing
        # card, the same way it is done on Telegram"): every run of the villa's alert this incident took over, so the
        # tablet shows this one card in place of the villa's alert, its repeat and its all-clear
        self.mirror(kiosk_messages.of_parts(kiosk_messages.thread_key(iid), parts, keyboard=keyboard,
                                            photo=kiosk_messages.photo_b64(photo), to=AND.join(roles) if roles else None,
                                            takes=self.state.incident_runs(iid)))

    def _for_everyone(self, parts: dict) -> dict:
        """A chat's copy as the tablet's card: in English, the languages it was said in carried beside it
        (kiosk_messages.of_parts reads its step's `status_in` and the alert's translation `tr`).

        ⚠️ THE TABLET'S OWN LANGUAGE, NOT THE LAST CHAT'S (architecture review 22, card 4): every chat's copy is told
        here in turn and the last drawn was kept — the facility manager's chat reads French, so the tablet read "Rappel
        envoyé …" under an English title. Its Status is drawn again from the step (`said`) for no chat (English), its
        heading drawn in no chat's language, so its alert words are the ones written."""
        h = layout.head_of(parts.get("head"))
        if h and h.get("lang"):
            parts = {**parts, "head": {k: v for k, v in h.items() if k != "lang"}}
        return self.words.restatus(0, parts)

    def tell_open(self, open_incidents) -> int:
        """At start: each open incident's card told to the tablet again, as it was kept (`tell`) — a copy the Kiosk had not
        kept when the Agent stopped is owed no longer (kiosk_messages.py keeps what is owed in memory) — how many.
        ⚠️ ALERT #83 (owner, 2026-10-29): an incident with no card kept had none on the tablet, which showed its short list
        while Telegram showed the card. One told before its card was kept (engine 0.6.419 and earlier) gets it from its
        newest copy: the one whose Status, told for everyone, holds the most steps before its bottom line, told for
        everyone (the tablet is everyone's) — read once, kept from then on."""
        told = 0
        for iid in open_incidents:
            if self.mirror is None:
                continue
            if card := self.state.incident_card(iid):
                self.tell(iid, card["parts"], card.get("keyboard"))
                told += 1
                continue
            best = None
            for chat, rec in self.state.incident_chats(iid):
                h = layout.head_of((rec.get("parts") or {}).get("head"))
                if h is None:
                    continue
                if "story" in h:
                    told_steps, parts = h["story"], rec["parts"]
                else:
                    story = self.words.story_of(int(iid), chat, h["history"])
                    # ⚠️ ONE WHOSE LINES NO COUNT DRAWS AGAIN COMES LAST (round 2): it tells its own chat's steps only
                    told_steps, parts = (story[1], {**rec["parts"], "head": {**h, "story": story[1]}}) if story \
                        else (None, rec["parts"])
                # the newest copy tells the most steps before its bottom line
                score = -1 if told_steps is None else len(told_steps)
                if best is None or score > best[0]:
                    best = (score, parts, rec.get("kb") if rec.get("buttons") else None)
            if best is not None:
                self.tell(iid, best[1], best[2])
                told += 1
        return told

    async def _post(self, iid: int | str, chat: int, mid: int, parts: dict, *, buttons: bool = False,
                    keyboard: dict | None = None, photo=None, sheet: str | None = None) -> None:
        old = self.state.incident_message(iid, chat)
        if old and old["mid"] != mid:
            gone = bool(self.delete and await self.delete(chat, old["mid"]))
            if not gone and self.edit:
                # past Telegram's 48 hours: the old message cannot go, so it stops repeating the incident
                await self.edit(chat, old["mid"], f"{self.name(iid)} · see the newer message below.")
            # what happened to the earlier copy, said (owner, 2026-10-10: two messages of #14 stayed in the group)
            log.info("%s in chat %s: message %s replaced by %s (%s)", iid, chat, old["mid"], mid,
                     "deleted" if gone else "kept, now a pointer" if self.edit else "kept")
        # ⚠️ A CARD REPLACED IS NEVER TAKEN OVER AGAIN (owner, 2026-11-06, #125-P1 at 18:53): the reminder replaced the
        # villa's card 1464 by 1472; the all-clear of the same automation run named 1464 again, the take-over edited a
        # message gone ("message to edit not found"), recorded it, and deleted the live 1472. The ids replaced are kept
        replaced = [*((old or {}).get("replaced") or []), *([old["mid"]] if old and old["mid"] != mid else [])][-REPLACED_KEPT:]
        # its buttons kept with it: a quiet update (`sync`) or a retry (`catch_up`) shows them again, never drops them
        self.state.set_incident_message(iid, chat, {"mid": mid, "parts": parts, "text": layout.render(parts),
                                                    "buttons": buttons, "settled": False,
                                                    **({"kb": keyboard} if buttons and keyboard else {}),
                                                    **({"replaced": replaced} if replaced else {}),
                                                    **({"sheet": sheet} if sheet else {})})
        self.tell(iid, parts, keyboard if buttons else None, photo)
        want, tr = self._wanted.pop((str(iid), int(chat)), None), self._translations()
        if want and tr is not None:
            tr.later(int(iid), chat, want)      # recorded now: its translation redraws this very copy

    def own_words(self, iid: int | str, chat: int, p: dict) -> dict:
        """A card of incident `iid` about to go to `chat` (Poster.post, Outcome's take-over), its alert words in the chat's
        language: known, translated; not yet, as written, and asked for once the copy is recorded (`_post`), never
        waited for (translation.py).

        ⚠️ THE THREAD'S JOB, ONCE (architecture review 2026-10-30, round 2): the poster and the take-over each applied
        the translation and asked for the rest after posting, the take-over by reaching into the poster for it."""
        tr = self._translations()
        if tr is None:
            return p
        p, want = tr.apply(int(iid), chat, p)
        if want:
            self._wanted[(str(iid), int(chat))] = want
        else:
            self._wanted.pop((str(iid), int(chat)), None)
        return p

    def _translate(self, iid: int | str, chat: int, p: dict) -> dict:
        """A redrawn copy's alert words (translation.Translations.draw): kept, drawn; not yet, as written and asked for."""
        tr = self._translations()
        return tr.draw(iid, chat, p) if tr is not None else p

    async def adopt(self, iid: int, chat: int, mid: int, parts: dict, keyboard: dict | None = None) -> bool:
        """One of Home Assistant's own messages (a VESTA rule's alert, its all-clear) belongs to incident `iid`: it is
        rewritten as the incident's message — its number, the original alert and, while it is open, its buttons
        (`keyboard`) — and replaces the earlier one. False when it is no longer in its chat (telegram.GONE): it is
        never kept as the incident's copy, the caller posts one (owner's drill #129: the group's card deleted in the
        chat was taken over, its next step "kept, now a pointer" to a message nobody could see)."""
        text = layout.render(parts)
        async with self._lock(iid):
            if self.edit:
                said = await (self.edit(chat, mid, text, keyboard) if keyboard else self.edit(chat, mid, text))
                if said is GONE:
                    log.info("%s in chat %s: message %s is no longer there: not taken over", iid, chat, mid)
                    return False
            await self._post(iid, chat, mid, parts, buttons=bool(keyboard), keyboard=keyboard)
            return True

    async def stray(self, iid: int | str, chat: int, mid: int) -> bool:
        """A message of incident `iid` in `chat` that is NOT its message there (a button pressed on it): it goes, or —
        past Telegram's 48 hours — points to the newer one, so no chat keeps two copies with live buttons. True when it
        was one."""
        async with self._lock(iid):
            rec = self.state.incident_message(iid, chat)
            if not rec or int(rec.get("mid") or 0) == int(mid):
                return False
            gone = bool(self.delete and await self.delete(chat, mid))
            if not gone and self.edit:
                await self.edit(chat, mid, f"{self.name(iid)} · see the newer message below.")
            log.info("%s in chat %s: stray message %s %s (its message is %s)", iid, chat, mid,
                     "deleted" if gone else "now a pointer" if self.edit else "kept", rec.get("mid"))
            return True

    async def close(self, iid: int | str, note: str, body: str | None = None, mark: str | None = None,
                    note_in: dict | None = None, final: bool = False, interim: bool = False,
                    closed: bool = False) -> int:
        """Every message of incident `iid`, in every chat, loses its buttons and shows `note` (who did what, when;
        "{time}": the villa's time now) — a copy without buttons too (owner, 2026-10-11: one incident, one picture);
        `note_in`: the same in other languages ({code: text}), each chat showing the one it reads (owner, 2026-10-23).
        Returns how many chats show it now. Settled once: a second close changes nothing but a heading now "(closed)".

        ⚠️ ALL OF THEM, NOT THE ONE PRESSED (owner, 2026-10-01): a P1 goes to the owner's chat and the facility
        manager's; pressed in one, the others kept buttons that only answered "already closed".

        `final`: its watch is over (the desk's watch_over, owner 2026-10-25) — every copy, settled or not, once: where it
        stood (its close, "Cleared on … Watch 1h.") becomes a line of its Status, in each chat's language, and `note`
        ("Closed on …: it did not come back within 1h.") the line under it; its title "(closed)", its alert struck.

        `interim`: the engine's receipt of a press, its buttons gone at once — the skill's answer that follows (its
        settle) replaces it in every copy. ⚠️ ONE LAST LINE IN EVERY CHAT (architecture review 21 card 1): "Not a problem"
        pressed in the FM's chat ended "… (Luc). Watch 1h." there and "… (Luc)." in the owner's group — the receipt
        settled the group's copy first, and the desk's own words, its watch, were then dropped as "settled already".

        `closed`: `note` tells a close that happened, even if the incident is open again by now (its line kept in the
        story, notice.close_step). ⚠️ A CLOSE AND A REOPENING READ TOGETHER (architecture review 24): Done then Reopen in
        the Cockpit, read in one go (presses made while VESTA restarted), left the facility manager's chat and the
        tablet's card with "Reopened in the Cockpit" under an alert they were never told was closed."""
        if final:
            return await self._finish(iid, note, note_in)
        async with self._lock(iid):
            now = datetime.now(timezone.utc)
            n = 0
            for chat, rec in self.state.incident_chats(iid):
                said = pick(note, note_in, self._lang(chat))
                said = layout.fill_time(said, now, self.tz) if said else said           # 10/10/2026 17:13, as every notice
                if rec.get("settled") and not rec.get("interim"):
                    # ⚠️ SETTLED BEFORE ITS INCIDENT CLOSED (owner, 2026-10-11): a press settles every copy at once, the desk
                    # closes the incident just after — the group's copy kept "New" above "Done pressed by Fabien"
                    p = layout.of(rec)
                    head = self.words.retitle(iid, p.get("head") or "", chat)
                    if head != (p.get("head") or ""):
                        n += await self._show(iid, chat, rec, {**p, "head": head})
                    continue
                if not said:
                    self.state.set_incident_message(iid, chat, {**rec, "settled": True})
                    continue
                # where it stands is the note now, under the line at the bottom; a new body when one is given (an approved
                # request: what happened) — the head and the lead kept (layout.py). Settled: decided, whatever Telegram said — a copy it did not take is owed and tried again (`catch_up`)
                p = layout.changed(layout.of(rec), status=said, body=body, mark=mark)
                if note_in:
                    # its other languages kept with it: a copy another chat later gets of this one says its own (sync)
                    p["said"] = layout.note_said(note, note_in, now, self.tz)
                p = {**p, "head": self._head_now(iid, chat, p.get("head") or "")}      # "Closed" once its incident is (notice.py)
                p = self._own_words(iid, chat, p)
                kept = {k: v for k, v in rec.items() if k != "interim"}
                n += await self._show(iid, chat, {**kept, "settled": True, **({"interim": True} if interim else {})}, p)
            if note and not interim and str(iid).isdigit() and (closed or self.words.closed_now(int(iid))):
                # the close's own line in its story (notice.close_step), whoever settled it: the desk, the Cockpit
                from .notice import close_step
                close_step(self.state, int(iid), layout.fill_time(note, now, self.tz),
                           {k: layout.fill_time(v, now, self.tz) for k, v in (note_in or {}).items() if isinstance(v, str)})
            self._tell_alone(iid, status=layout.fill_time(note, now, self.tz) if note else None, body=body, mark=mark)
            return n

    def _tell_alone(self, iid: int | str, **change) -> None:
        """A thread no chat holds — a request only the tablet keeps (no Telegram chat may approve it: approvals.ask) —
        changes on the tablet itself: its record is the only copy, settled there (its buttons gone)."""
        card = self.state.incident_card(iid)
        if card is None or self.state.incident_chats(iid):
            return
        p = layout.changed(card["parts"], **{k: v for k, v in change.items() if v is not None})
        if change.get("status") is not None and str(iid).isdigit():
            # its heading as the incident stands now ("(closed)"): a visit that ended while VESTA was away is the
            # tablet's card alone (owner's drill, 2026-11-07, #138), its close read as one on the tablet too
            p = {**p, "head": self._head_now(iid, 0, p.get("head") or "")}
        self.tell(iid, p, None)

    async def _finish(self, iid: int | str, note: str, note_in: dict | None) -> int:
        """`close` with `final`: the incident's last word (see there). Returns how many chats show it now."""
        from .notice import CLEARED_STAGE, note_step
        async with self._lock(iid):
            now = datetime.now(timezone.utc)
            copies = [(chat, rec) for chat, rec in self.state.incident_chats(iid) if not rec.get("finished")]
            if not copies or not note:
                return 0
            # where it stood, kept in its story in every language its close was said in (`said`, the close's words)
            said = next((layout.of(rec).get("said") for _c, rec in copies
                         if isinstance(layout.of(rec).get("said"), dict) and not layout.of(rec)["said"].get("stage")), None)
            stood = (said or {}).get("status") or (layout.of(copies[0][1]).get("status") or "")
            if stood.strip() and str(iid).isdigit():
                note_step(self.state, int(iid), CLEARED_STAGE, stood.strip(), (said or {}).get("status_in"))
            n = 0
            for chat, rec in copies:
                words = layout.fill_time(pick(note, note_in, self._lang(chat)), now, self.tz)
                p = layout.changed(layout.of(rec), status=words)
                if note_in:
                    p["said"] = layout.note_said(note, note_in, now, self.tz)
                p = {**p, "head": self._head_now(iid, chat, p.get("head") or "")}      # "(closed)", its story listed
                p = self._own_words(iid, chat, p)
                n += await self._show(iid, chat, {**rec, "settled": True, "finished": True}, p)
            return n

    async def restate(self, iid: int | str, note: str, note_in: dict | None = None,
                      keyboard: Callable[[int], dict | None] | None = None) -> int:
        """Every copy of incident `iid` shows `note` as where it stands, WITHOUT settling: the incident is open and ends
        as any does (its close still says how). For an alert someone took on as a ticket, in the VESTA Kiosk or on
        Telegram (owner, 2026-10-15). `keyboard(chat)`: the buttons each copy keeps now (alert_buttons.AlertButtons.still:
        owner, 2026-11-05, Done and Need help stay once taken on), none: its buttons go. `note_in`: the same in other
        languages ({code: text}), each chat showing the one it reads, kept as `close` keeps it so a copy another chat
        gets later says its own (architecture review O); a kiosk_words.Words `note` brings its own (`langs`). Returns how
        many chats show it now.

        ⚠️ THE THREAD RECORDS ITS OWN "TAKEN" STEP (architecture review round 16): app glued it on after the call
        (thread.restate, then note_step) while `_finish` records its CLEARED itself — two ways to put a step in the
        story, and a second caller of restate would have left it out. It is recorded AFTER the copies are drawn: listed in
        every later "Status:" (its close included), never twice beside the status saying it now."""
        from .notice import TAKEN_STAGE, note_step
        if note_in is None:
            note_in = getattr(note, "langs", None) or None
        async with self._lock(iid):
            now = datetime.now(timezone.utc)
            n = 0
            for chat, rec in self.state.incident_chats(iid):
                # a press's receipt (`interim`: its buttons gone at once) is replaced by what the press did
                if (rec.get("settled") and not rec.get("interim")) or not rec.get("mid"):
                    continue
                p = layout.changed(layout.of(rec), status=layout.fill_time(pick(note, note_in, self._lang(chat)), now, self.tz))
                if note_in:
                    p["said"] = layout.note_said(note, note_in, now, self.tz)
                p = self._own_words(iid, chat, {**p, "head": self._head_now(iid, chat, p.get("head") or "")})
                kb = keyboard(chat) if keyboard else None
                kept = {k: v for k, v in rec.items() if k not in ("interim", "kb")}
                n += await self._show(iid, chat, {**kept, "settled": False, "buttons": bool(kb)}, p, keyboard=kb)
            if str(iid).isdigit():
                note_step(self.state, int(iid), TAKEN_STAGE, str(note), note_in)
            return n

    async def unsettle(self, iid: int | str, note: str, keyboard: Callable[[int], dict | None]) -> int:
        """A press that could not be carried out: every copy its receipt settled (`interim`) shows `note` (why, and what
        to do instead) with its buttons back (`keyboard(chat)`), as before the press — nothing half done (owner,
        2026-11-05: Open Ticket on Telegram with the VESTA Kiosk unreachable). Returns how many chats show it now."""
        async with self._lock(iid):
            n = 0
            for chat, rec in self.state.incident_chats(iid):
                if not (rec.get("settled") and rec.get("interim")) or not rec.get("mid"):
                    continue
                p = self._own_words(iid, chat, layout.changed(layout.of(rec), status=note))
                kb = keyboard(chat)
                kept = {k: v for k, v in rec.items() if k not in ("interim", "kb")}
                n += await self._show(iid, chat, {**kept, "settled": False, "buttons": bool(kb)}, p, keyboard=kb)
            return n

    def _own_words(self, iid: int | str, chat: int, p: dict) -> dict:
        """A redrawn copy's alert words in the language its heading now reads (translation.Translations.draw): kept,
        drawn; not yet, English now and translated afterwards.

        ⚠️ A CLOSE DRAWS THE WORDS TOO (owner, 2026-10-24: the group switched from Indonesian to Chinese; #80's close read
        its Status in Chinese over the alert's words in English). The heading and Status were redrawn in the chat's
        language now, the words kept the copy's old drawing — another language's, so shown in English — and nothing
        asked for the new one. Only sync drew them."""
        return self._translate(iid, chat, p)

    def _lang(self, chat: int) -> str:
        """The language chat `chat` reads (`language`); English without it."""
        return self.words.lang(chat)

    def _head_now(self, iid: int | str, chat: int, head: str) -> str:
        """A copy's heading when its status is replaced: every earlier step listed again (reheading), else its title
        brought up to date (retitle) — a message about no incident keeps its own."""
        whole = self.words.heading(chat, int(iid)) if str(iid).isdigit() and head else None
        return whole or self.words.retitle(iid, head, chat)

    async def sync(self, iid: int | str, parts: dict, skip=(), keyboard=None, head_for=None) -> int:
        """Every copy of incident `iid` outside `skip` (the chats just sent it) shows `parts` too — the same title,
        "To:", history and status in every chat, edited quietly (an edit makes no sound) (owner, 2026-10-11: "this should
        be exactly the same, since we are speaking about the same incident"; 2026-11-07, live #146-P2: every copy at
        every change, whichever chat the step was sent to). A copy still asked to answer keeps its buttons
        (`keyboard(chat)`). Returns how many changed."""
        async with self._lock(iid):
            n = 0
            for chat, rec in self.state.incident_chats(iid):
                if chat in skip or not rec.get("mid"):
                    continue
                own = layout.of(rec)
                p = {**parts, "limit": own.get("limit")}
                if head_for:
                    p["head"] = head_for(chat)                  # this chat's heading, in its language
                else:
                    p["head"] = self.words.retitle(iid, p.get("head") or "", chat)
                p = self.words.restatus(chat, p)                # this step's bottom line in the chat's own language
                # ⚠️ ITS OWN WORDS, NEVER THE ENGLISH BACK (owner, 2026-10-23): `parts` are another chat's copy — its
                # translation, if any, is that chat's; this one draws its own
                p = self._translate(iid, chat, p)
                if layout.render(p) == rec.get("text"):
                    continue
                # ⚠️ OPEN AGAIN, EVERY COPY ASKS AGAIN (owner, 2026-11-07, live #146-P2): the owner's group copy, settled at
                # the all-clear, stayed settled through the return, so the Done in the Cockpit never reached it
                again = bool(rec.get("settled")) and keyboard is not None
                if again:
                    rec = {**rec, "settled": False, "buttons": True}
                live = rec.get("buttons") and not rec.get("settled")
                n += await self._show(iid, chat, rec, p, keyboard=(keyboard(chat) if live and keyboard else None))
            return n

    async def refold(self, iid: int | str) -> int:
        """Every copy of incident `iid` whose Status listed a step once per repeat (an engine before 0.6.447) shows it as
        ONE line, counted (words.refold: the history folded, each copy's heading drawn again), quietly; the tablet's
        card with it. Its buttons and bottom line stay. Returns how many changed."""
        async with self._lock(iid):
            return await self._reheaded(iid, self.words.refold(int(iid)))

    async def reheaded(self, iid: int | str, heads: dict, body: str | None = None) -> int:
        """Every copy of incident `iid` shows the heading `heads` gives its chat ({chat: heading}: notice.Notices.observe,
        a visit's story as it stands) and, when given, the alert's new `body` — quietly, an edit, its buttons and bottom
        line kept; the tablet's card with it. Returns how many changed."""
        async with self._lock(iid):
            return await self._reheaded(iid, heads, body)

    async def _reheaded(self, iid: int | str, heads: dict, body: str | None = None) -> int:
        n = 0
        for chat, head in heads.items():
            rec = self.state.incident_message(iid, chat)
            if not rec or not rec.get("mid"):
                continue
            p = {**layout.of(rec), "head": head}
            if body is not None and body != p.get("body"):
                p = self._own_words(iid, chat, layout.changed(p, body=body))
            if layout.render(p) != rec.get("text"):
                n += await self._show(iid, chat, rec, p)
        return n

    async def picture(self, iid: int | str, jpeg: bytes, keyboard: Callable[[int], dict | None] | None = None) -> int:
        """Every copy of incident `iid` carries the picture `jpeg` (a visit's sheet), its caption drawn again within a
        caption's limit and its buttons kept — replaced in place, no sound; a copy that is a text message (Telegram
        gives no text message a picture) sent again as a photo, which replaces it (`_post`) and rings once. Returns
        how many copies carry it now."""
        import base64
        import hashlib
        from vesta_shared.messaging import telegram_caption_chars
        made = hashlib.sha1(jpeg).hexdigest()
        async with self._lock(iid):
            n = 0
            for chat, rec in self.state.incident_chats(iid):
                if not rec.get("mid") or rec.get("sheet") == made:
                    continue
                p = {**layout.of(rec), "limit": telegram_caption_chars()}
                text = layout.render(p)
                live = rec.get("buttons") and not rec.get("settled")
                kb = ((keyboard(chat) if keyboard else None) or rec.get("kb")) if live else None
                said = await self.media(chat, rec["mid"], jpeg, text, kb) if self.media else "refused"
                if said == "shown":
                    # the buttons it shows now kept with it ("All photos" once a second photo came): a later edit
                    # that keeps the record's buttons never takes that row off
                    self.state.set_incident_message(iid, chat, {**rec, "parts": p, "text": text, "sheet": made,
                                                                **({"kb": kb} if kb else {})})
                    n += 1
                elif said == "not_media" and self.send:
                    mid = await self.send(chat, text, keyboard=kb, photo=(base64.b64encode(jpeg).decode(), "image/jpeg"))
                    if mid:
                        await self._post(iid, chat, mid, p, buttons=bool(kb), keyboard=kb, sheet=made)
                        n += 1
            return n

    def held(self, iid: int | str, chat: int, mid: int) -> bool:
        """Does chat `chat` already hold a copy of incident `iid` — `mid` itself, a newer one, or one that replaced
        `mid`? Then `mid` is never taken over again."""
        rec = self.state.incident_message(iid, chat)
        return bool(rec) and (int(rec.get("mid") or 0) == int(mid) or int(mid) in (rec.get("replaced") or []))

    async def translated(self, iid: int | str, chat: int, draw: Callable[[int | str, int, dict], dict]) -> bool:
        """The copy of `iid` in `chat` drawn again now that its words are known in its language (`draw`: its parts as
        the chat reads them — translation.Translations.apply), as it stands now, under the incident's lock: a copy
        redrawn, replaced or closed meanwhile is drawn from what it is now. Its buttons stay (`_show`). True when
        Telegram took the edit; a refused one keeps the English on the card (owed: tried again, catch_up)."""
        async with self._lock(iid):
            rec = self.state.incident_message(iid, chat)
            if not rec or not rec.get("mid"):
                return False
            p = draw(iid, chat, layout.of(rec))
            if layout.render(p) == rec.get("text"):
                return False
            return await self._show(iid, chat, rec, p, tell=False)           # the same step, in another language

    async def rewrite(self, iid: int | str, body: str) -> None:
        """Every copy of `iid` says `body` now in its middle part, its heading and status kept (an approved request whose
        device got there: "Opening …" becomes "Opened …")."""
        async with self._lock(iid):
            for chat, rec in self.state.incident_chats(iid):
                await self._show(iid, chat, rec, layout.changed(layout.of(rec), body=body))
            self._tell_alone(iid, body=body)

    async def _show(self, iid: int | str, chat: int, rec: dict, p: dict, keyboard: dict | None = None,
                    tell: bool = True) -> bool:
        """The copy in `chat` shows `p` now (its buttons gone). The record keeps `p` whatever Telegram said; a copy Telegram
        did not take is OWED and tried again by `catch_up`. `tell`: it is the incident's own latest step, so the tablet's
        record becomes `p` too — whatever Telegram said (the tablet is the second place, not the second try).

        ⚠️ RECORDED ONLY WHEN SHOWN (architecture review 21): a refused edit (a network blip) was recorded settled like
        a shown one and never tried again — one chat kept Done / Need help, "Already answered." at every press."""
        text = layout.render(p)
        # a copy that keeps its buttons keeps them through the edit, and through a retry (`catch_up`: its "kb")
        keyboard = keyboard or (rec.get("kb") if rec.get("buttons") and not rec.get("settled") else None)
        said = await (self.edit(chat, rec["mid"], text, keyboard) if keyboard
                      else self.edit(chat, rec["mid"], text)) if self.edit else False
        ok = bool(said)
        now = datetime.now(timezone.utc)
        since = rec.get("owed_since") or now.isoformat()
        rec = {k: v for k, v in rec.items() if k not in ("owed", "owed_since", "owed_tries")} | {"parts": p, "text": text}
        if keyboard:
            rec["kb"] = keyboard
        if said is GONE:
            # deleted in its chat: no retry can ever show it (it was tried again for two hours)
            log.info("%s in chat %s: message %s is no longer there", iid, chat, rec["mid"])
            rec["gone"] = True
        elif not ok:
            rec |= {"owed": now - datetime.fromisoformat(since) < owed_for(), "owed_since": since}
            if not rec["owed"]:
                rec.pop("owed_since")   # given up: a later change starts its own two hours (architecture review 23)
            log.info("%s in chat %s: message %s not updated (%s)", iid, chat, rec["mid"],
                     "tried again later" if rec["owed"] else "given up")
        self.state.set_incident_message(iid, chat, rec)
        if tell:
            self.tell(iid, p, keyboard)
        return ok

    async def catch_up(self) -> int:
        """Every copy a refused edit left behind is tried again (housekeeping, every 30 seconds; for owed_for() — a message
        deleted in the chat can never be changed). Returns how many are shown now."""
        n = 0
        for iid, chat, _rec in self.state.incident_messages_owed():
            async with self._lock(iid):
                rec = self.state.incident_message(iid, chat)        # as it stands now, under its lock
                if rec and rec.get("owed"):
                    n += await self._show(iid, chat, rec, layout.of(rec), tell=False)       # a retry, not a new step
        return n

    def shown(self, iid: int | str) -> dict[int, dict]:
        """What each chat shows of incident `iid`: {chat: {mid, parts, text, buttons, settled}}."""
        return dict(self.state.incident_chats(iid))
