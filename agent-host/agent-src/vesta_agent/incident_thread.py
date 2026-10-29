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

log = logging.getLogger("vesta.thread")

Edit = Callable[..., Awaitable]     # (chat, message id, text[, keyboard])
Delete = Callable[[int, int], Awaitable]

#: How long a copy Telegram refused to update is tried again (at every housekeeping pass), then given up.
#: ⚠️ A DURATION, NEVER A COUNT (architecture review 22): 12 tries were meant as "about an hour" at one pass every five
#: minutes — housekeeping runs every 30 seconds, so a 10-minute internet cut outlived them and left the buttons.


def owed_for() -> timedelta:
    return timedelta(hours=limit("telegram.edit_retry_hours", 2, unit="hours", group="text", lo=1, hi=72,
                                 says="How long a message Telegram refused to update is tried again (its buttons "
                                      "removed, its status written).",
                                 reached="It is given up: that copy keeps its old text and buttons.", told=""))


class IncidentThread:
    def __init__(self, state, timezone: str, edit: Edit | None = None, delete: Delete | None = None):
        self.state = state
        self.tz = timezone
        self.edit = edit                # Telegram's edit (its buttons go); None while Telegram is off
        self.delete = delete            # Telegram's deleteMessage: True when the message is gone
        self.retitle = None             # notice.Notices.retitle: a copy's heading as its incident stands now
        # notice.Notices.heading (chat, incident): the whole heading again — title, "To:" and EVERY earlier step. Used
        # when a copy's status is REPLACED (taken on in the Kiosk, closed): the status it showed becomes a line of its
        # history (owner, 2026-10-15: "Escalation sent … to Owner" vanished when "Ticket opened…" replaced it)
        self.reheading = None
        # notice.Notices.lang (chat): the language a chat reads its cards' Status in; notice.Notices.restatus (chat,
        # parts): a step's bottom line drawn again in that chat's language (owner, 2026-10-23). None: as given
        self.language = None
        self.restatus = None
        # translation.Translations.draw (incident, chat, parts): the alert's own words in the chat's language when they
        # are known, else asked for in the background (owner, 2026-10-23). None: as written
        self.translate = None
        # kiosk_messages.KioskMessages.keep (a record): the copy as it stands, kept for the tablet too (ticket 25 of "One
        # inbox"). None: not kept. Called at every change that is the incident's own step, never at a retry or a redraw
        # in another language (`tell` of _show): the tablet's record is the latest step, not whichever chat was drawn last.
        self.mirror = None
        # notice.Notices.story_of (incident, chat, its lines): a copy drawn before its heading held every step, told for
        # everyone (tell_open). None: its own steps
        self.story_of = None
        # incidents.Incidents.name: how the incident is named ("#9-P2") in a pointer to its newer message; its number
        # alone until set
        self.name = incident_tag
        self._told: dict[str, tuple] = {}       # incident → the last copy told (parts, keyboard, photo): `taken` tells it again
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock(self, iid: int | str) -> asyncio.Lock:
        """Incident `iid`'s lock: its copies change one at a time (see the module's note)."""
        return self._locks.setdefault(str(iid), asyncio.Lock())

    async def post(self, iid: int | str, chat: int, mid: int, parts: dict, *, buttons: bool = False,
                   keyboard: dict | None = None, photo=None) -> None:
        """Message `mid`, just sent to `chat` with these `parts` (layout.py), is now incident `iid`'s message there: the
        earlier one goes. `photo`: the picture it carries ((base64, mime): a snapshot), kept for the tablet."""
        async with self._lock(iid):
            await self._post(iid, chat, mid, parts, buttons=buttons, keyboard=keyboard, photo=photo)

    def taken(self, iid: int | str, run: str) -> None:
        """The villa's automation run `run` (its context id) is incident `iid`'s: its announcement on the tablet gives way
        to the incident's card. Told again at once when the card was already told without it."""
        if run and self.state.add_incident_run(iid, run) and str(iid) in self._told:
            self.tell(iid, *self._told[str(iid)])

    def tell(self, iid: int | str, parts: dict, keyboard: dict | None = None, photo=None) -> None:
        """Keep the copy as it stands for the tablet (`mirror`): one record per incident, replaced at each step."""
        if self.mirror is None:
            return
        self._told[str(iid)] = (parts, keyboard, photo)
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

    def tell_open(self, open_incidents) -> int:
        """At start: each open incident's card kept for the tablet, as its newest copy stands — how many. ⚠️ ALERT #83
        (owner, 2026-10-29): the tablet keeps a card from the incident's next step on (since engine 0.6.359), and an
        incident with no step since (its one "still not fixed" sent) had none: the tablet showed its short list
        while Telegram showed the card. The newest copy is the one whose own Status leaves the fewest steps to its
        bottom line; its Status told for everyone (the tablet is everyone's), as every step's card is now."""
        told = 0
        for iid in open_incidents:
            if self.mirror is None or str(iid) in self._told:
                continue
            best = None
            for chat, rec in self.state.incident_chats(iid):
                h = layout.head_of((rec.get("parts") or {}).get("head"))
                if h is None:
                    continue
                story = self.story_of(int(iid), chat, h["history"]) if self.story_of and "story" not in h else None
                left = story[0] if story else 0
                if best is None or left < best[0]:
                    parts = rec["parts"] if story is None else {**rec["parts"], "head": {**h, "story": story[1]}}
                    best = (left, parts, rec.get("kb") if rec.get("buttons") else None)
            if best is not None:
                self.tell(iid, best[1], best[2])
                told += 1
        return told

    async def _post(self, iid: int | str, chat: int, mid: int, parts: dict, *, buttons: bool = False,
                    keyboard: dict | None = None, photo=None) -> None:
        old = self.state.incident_message(iid, chat)
        if old and old["mid"] != mid:
            gone = bool(self.delete and await self.delete(chat, old["mid"]))
            if not gone and self.edit:
                # past Telegram's 48 hours: the old message cannot go, so it stops repeating the incident
                await self.edit(chat, old["mid"], f"{self.name(iid)} · see the newer message below.")
            # what happened to the earlier copy, said (owner, 2026-10-10: two messages of #14 stayed in the group)
            log.info("%s in chat %s: message %s replaced by %s (%s)", iid, chat, old["mid"], mid,
                     "deleted" if gone else "kept, now a pointer" if self.edit else "kept")
        # its buttons kept with it: a quiet update (`sync`) or a retry (`catch_up`) shows them again, never drops them
        self.state.set_incident_message(iid, chat, {"mid": mid, "parts": parts, "text": layout.render(parts),
                                                    "buttons": buttons, "settled": False,
                                                    **({"kb": keyboard} if buttons and keyboard else {})})
        self.tell(iid, parts, keyboard if buttons else None, photo)

    async def adopt(self, iid: int, chat: int, mid: int, parts: dict, keyboard: dict | None = None) -> None:
        """One of Home Assistant's own messages (a VESTA rule's alert, its all-clear) belongs to incident `iid`: it is
        rewritten as the incident's message — its number, the original alert and, while it is open, its buttons
        (`keyboard`) — and replaces the earlier one."""
        text = layout.render(parts)
        async with self._lock(iid):
            if self.edit:
                await self.edit(chat, mid, text, keyboard) if keyboard else await self.edit(chat, mid, text)
            await self._post(iid, chat, mid, parts, buttons=bool(keyboard), keyboard=keyboard)

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
                    note_in: dict | None = None, final: bool = False) -> int:
        """Every message of incident `iid`, in every chat, loses its buttons and shows `note` (who did what, when;
        "{time}": the villa's time now) — a copy without buttons too (owner, 2026-10-11: one incident, one picture);
        `note_in`: the same in other languages ({code: text}), each chat showing the one it reads (owner, 2026-10-23).
        Returns how many chats show it now. Settled once: a second close changes nothing but a heading now "(closed)".

        ⚠️ ALL OF THEM, NOT THE ONE PRESSED (owner, 2026-10-01): a P1 goes to the owner's chat and the facility
        manager's; pressed in one, the others kept buttons that only answered "already closed".

        `final`: its watch is over (the desk's watch_over, owner 2026-10-25) — every copy, settled or not, once: where it
        stood (its close, "Cleared on … Watch 1h.") becomes a line of its Status, in each chat's language, and `note`
        ("Closed on …: it did not come back within 1h.") the line under it; its title "(closed)", its alert struck."""
        if final:
            return await self._finish(iid, note, note_in)
        async with self._lock(iid):
            now = datetime.now(timezone.utc)
            n = 0
            for chat, rec in self.state.incident_chats(iid):
                said = pick(note, note_in, self._lang(chat))
                said = layout.fill_time(said, now, self.tz) if said else said           # 10/10/2026 17:13, as every notice
                if rec.get("settled") and self.retitle:
                    # ⚠️ SETTLED BEFORE ITS INCIDENT CLOSED (owner, 2026-10-11): a press settles every copy at once, the desk
                    # closes the incident just after — the group's copy kept "New" above "Done pressed by Fabien"
                    p = layout.of(rec)
                    head = self.retitle(iid, p.get("head") or "", chat)
                    if head != (p.get("head") or ""):
                        n += await self._show(iid, chat, rec, {**p, "head": head})
                    continue
                if rec.get("settled"):
                    continue
                if not said:
                    self.state.set_incident_message(iid, chat, {**rec, "settled": True})
                    continue
                # where it stands is the note now, under the line at the bottom; a new body when one is given (an approved
                # request: what happened) — the head and the lead kept (layout.py). Settled: decided, whatever Telegram said — a copy it did not take is owed and tried again (`catch_up`)
                p = layout.changed(layout.of(rec), status=said, body=body, mark=mark)
                if note_in:
                    # its other languages kept with it: a copy another chat later gets of this one says its own (sync)
                    p["said"] = {"stage": None, "status": layout.fill_time(note, now, self.tz),
                                 "status_in": {k: layout.fill_time(v, now, self.tz) for k, v in note_in.items()}}
                p = {**p, "head": self._head_now(iid, chat, p.get("head") or "")}      # "Closed" once its incident is (notice.py)
                p = self._own_words(iid, chat, p)
                n += await self._show(iid, chat, {**rec, "settled": True}, p)
            self._tell_alone(iid, status=layout.fill_time(note, now, self.tz) if note else None, body=body, mark=mark)
            return n

    def _tell_alone(self, iid: int | str, **change) -> None:
        """A thread no chat holds — a request only the tablet keeps (no Telegram chat may approve it: approvals.ask) —
        changes on the tablet itself: its record is the only copy, settled there (its buttons gone)."""
        told = self._told.get(str(iid))
        if told is None or self.state.incident_chats(iid):
            return
        parts, _keyboard, photo = told
        self.tell(iid, layout.changed(parts, **{k: v for k, v in change.items() if v is not None}), None, photo)

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
                    p["said"] = {"stage": None, "status": layout.fill_time(note, now, self.tz),
                                 "status_in": {k: layout.fill_time(v, now, self.tz) for k, v in note_in.items()}}
                p = {**p, "head": self._head_now(iid, chat, p.get("head") or "")}      # "(closed)", its story listed
                p = self._own_words(iid, chat, p)
                n += await self._show(iid, chat, {**rec, "settled": True, "finished": True}, p)
            return n

    async def restate(self, iid: int | str, note: str, note_in: dict | None = None) -> int:
        """Every copy of incident `iid` shows `note` as where it stands and loses its buttons, WITHOUT settling: the
        incident is open and ends as any does (its close still says how). For an alert someone took on in the VESTA
        Kiosk (owner, 2026-10-15). `note_in`: the same in other languages ({code: text}), each chat showing the one it
        reads, kept as `close` keeps it so a copy another chat gets later says its own (architecture review O).
        Returns how many chats show it now."""
        async with self._lock(iid):
            now = datetime.now(timezone.utc)
            n = 0
            for chat, rec in self.state.incident_chats(iid):
                if rec.get("settled") or not rec.get("mid"):
                    continue
                p = layout.changed(layout.of(rec), status=layout.fill_time(pick(note, note_in, self._lang(chat)), now, self.tz))
                if note_in:
                    p["said"] = {"stage": None, "status": layout.fill_time(note, now, self.tz),
                                 "status_in": {k: layout.fill_time(v, now, self.tz) for k, v in note_in.items()}}
                p = self._own_words(iid, chat, {**p, "head": self._head_now(iid, chat, p.get("head") or "")})
                n += await self._show(iid, chat, {**rec, "buttons": False}, p)
            return n

    def _own_words(self, iid: int | str, chat: int, p: dict) -> dict:
        """A redrawn copy's alert words in the language its heading now reads (translation.Translations.draw): kept,
        drawn; not yet, English now and translated afterwards.

        ⚠️ A CLOSE DRAWS THE WORDS TOO (owner, 2026-10-24: the group switched from Indonesian to Chinese; #80's close read
        its Status in Chinese over the alert's words in English). The heading and Status were redrawn in the chat's
        language now, the words kept the copy's old drawing — another language's, so shown in English — and nothing
        asked for the new one. Only sync drew them."""
        return self.translate(iid, chat, p) if self.translate else p

    def _lang(self, chat: int) -> str:
        """The language chat `chat` reads (`language`); English without it."""
        return self.language(chat) if self.language else "en"

    def _head_now(self, iid: int | str, chat: int, head: str) -> str:
        """A copy's heading when its status is replaced: every earlier step listed again (reheading), else its title
        brought up to date (retitle) — a message about no incident keeps its own."""
        if self.reheading and str(iid).isdigit() and head:
            return self.reheading(chat, int(iid))
        return self.retitle(iid, head, chat) if self.retitle else head

    async def sync(self, iid: int | str, parts: dict, skip=(), keyboard=None, head_for=None, quiet=()) -> int:
        """Every copy of incident `iid` outside `skip` (the chats just sent it) shows `parts` too — the same title,
        "To:", history and status in every chat, edited quietly (an edit makes no sound) (owner, 2026-10-11: "this should
        be exactly the same, since we are speaking about the same incident"). A copy in `quiet` — a chat none of whose
        roles this step went to (each chat its own steps: owner, 2026-10-18, #55) — keeps its own words, body and
        status, and takes only the heading (`head_for`): the title word and "To:" are the INCIDENT's, the same in every
        copy (architecture review, 2026-10-19: a fault reopened in the Cockpit left the owner's group reading "(closed)"
        over "Done on … (Wayan)." while the facility manager's copy read "(existing)"). A copy still asked to answer
        keeps its buttons (`keyboard(chat)`). Returns how many changed."""
        async with self._lock(iid):
            n = 0
            for chat, rec in self.state.incident_chats(iid):
                if chat in skip or not rec.get("mid"):
                    continue
                tell = True
                own = layout.of(rec)
                if chat in quiet:
                    # its own words, its own steps; the title word and "To:" as the incident stands now (retitle)
                    p = {**own, "head": self.retitle(iid, own.get("head") or "", chat) if self.retitle else own.get("head")}
                    tell = False                                # its own words are not the incident's latest step
                else:
                    p = {**parts, "limit": own.get("limit")}
                    if head_for:
                        p["head"] = head_for(chat)              # this chat's own heading (each chat its own steps)
                    elif self.retitle:
                        p["head"] = self.retitle(iid, p.get("head") or "", chat)
                    if self.restatus:
                        p = self.restatus(chat, p)              # this step's bottom line in the chat's own language
                    if self.translate:
                        # ⚠️ ITS OWN WORDS, NEVER THE ENGLISH BACK (owner, 2026-10-23): `parts` are another chat's copy —
                        # its translation, if any, is that chat's; this one draws its own
                        p = self.translate(iid, chat, p)
                if layout.render(p) == rec.get("text"):
                    continue
                live = rec.get("buttons") and not rec.get("settled")
                n += await self._show(iid, chat, rec, p, keyboard=(keyboard(chat) if live and keyboard else None),
                                      tell=tell)
            return n

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
        ok = bool(self.edit and await (self.edit(chat, rec["mid"], text, keyboard) if keyboard
                                       else self.edit(chat, rec["mid"], text)))
        now = datetime.now(timezone.utc)
        since = rec.get("owed_since") or now.isoformat()
        rec = {k: v for k, v in rec.items() if k not in ("owed", "owed_since", "owed_tries")} | {"parts": p, "text": text}
        if keyboard:
            rec["kb"] = keyboard
        if not ok:
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
