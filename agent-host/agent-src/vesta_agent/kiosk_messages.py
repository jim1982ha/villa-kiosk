"""Every message the agent writes on Telegram, kept for the tablet as it stands now (ticket 25 of "One inbox", owner
2026-10-28: everything Telegram shows is reproduced on the tablet).

⚠️ DELIVERY'S SECOND SINK, NEVER A SECOND WRITER OF WORDS. The words of a message are drawn once, where they always were:
IncidentThread (an alert, an approval: `_post`, `_show`) and Poster (a note sent on its own, its rewrite). Those
call `KioskMessages` with the very parts they drew; nothing here composes a sentence. One record per thread (`key`), which
the Kiosk replaces when the message is rewritten — the tablet shows the message as it stands, as Telegram does.

⚠️ NEVER IN THE CRITICAL PATH. The push runs in the background with a time limit (kiosk.message_timeout_s): an alert never
waits on it, and a Kiosk that is down or slow delays that copy and nothing else. The Agent stopped, the villa's own first
version (its announcement) is all the tablet has.

⚠️ A COPY NOT KEPT IS OWED, NOT LOST (architecture review 2026-10-30, round 3: #97, escalated, showed its short lines
with Open Ticket and Close on the tablet while #98 showed VESTA's card with Done and Need help). A copy the Kiosk did not
keep (unreachable, restarting, refused) was tried again only at the message's next change, and an alert with no step
after it kept the tablet's short list for good. Now the newest copy of each such message is owed and sent again at the
housekeeping pass (kiosk.message_retry_s) until the Kiosk keeps it, and a newer copy replaces the one owed: an alert
closed meanwhile is sent closed, never as it stood before. What is owed is kiosk_owed.KioskOwed's (round 16): kept in
the agent's state, a restart keeps it; the tablet's conversation turns are owed the same way.

The record's shape is the agreement's (agent-contract.json `vestaMessage`): its limits are read from there.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
from datetime import datetime, timezone

from vesta_shared import agreement
from vesta_shared.message_format import role_words

from . import button_data, layout, ringing
from .kiosk_owed import MESSAGE, KioskOwed
from .in_progress import scheduled_run
from .scheduler import job_of

log = logging.getLogger("vesta.kiosk")

#: How many keys' last push are remembered to skip an identical one (a retry that redraws the same copy).
REMEMBERED = 500
#: A report's page as a file of the out folder, until the push uploads it and names it by its Kiosk id (`page`).
PAGE_FILE = "_page"


#: The most base64 of the Agent's own photos one record carries: the Kiosk reads a push of at most 1 MB (its web
#: server's default request size), the card's words and its other photos with them
OWN_PHOTOS_B64 = 700_000


def agreed_limit(name: str) -> int:
    """The agreement's longest `name` (vestaMessage.limits); 0 when it names none."""
    return int(agreement.section("vestaMessage").get("limits", {}).get(name) or 0)


def _cut(text, name: str) -> str:
    n = agreed_limit(name)
    return str(text or "").strip()[:n] if n else ""


def _lines(lines, list_name: str, line_name: str) -> list[str]:
    n = agreed_limit(list_name)
    return [x for x in (_cut(line, line_name) for line in lines or ()) if x][:n]


def buttons_of(keyboard: dict | None) -> list[dict]:
    """A Telegram keyboard as the record's buttons: each the agent's own kind and id (button_data) with its label —
    never a device or a command. A button the agent did not write is left out. The tablet draws an alert's Done · Need
    help wherever the alert shows (owner, 2026-10-29), as Telegram does: no button is flagged."""
    out = []
    for row in (keyboard or {}).get("inline_keyboard") or ():
        for b in row:
            kind, parts = button_data.read(str(b.get("callback_data") or ""))
            if kind and kind not in button_data.TELEGRAM_ONLY:
                out.append({"label": _cut(b.get("text"), "label"), "kind": kind, "id": ":".join(parts)})
    return out


def rows_of(buttons) -> list[list[dict]]:
    """A record's buttons (buttons_of) as Telegram's rows, one row: what a press settles them from (press.Press.rows)."""
    row = []
    for b in buttons or ():
        kind, parts = button_data.read(f"{b.get('kind')}:{b.get('id')}" if isinstance(b, dict) else "")
        if kind:
            row.append({"text": b.get("label") or "", "callback_data": button_data.make(kind, *parts)})
    return [row] if row else []


def roles_of(to: str) -> list[str]:
    """The roles a "To:" line names ("Owner (escalation) & FM": Owner, FM)."""
    return role_words(to)


def of_parts(key: str, p: dict, *, keyboard: dict | None = None, photo: str | None = None, to: str | None = None,
             takes: list[str] | None = None, photos: list[dict] | None = None) -> dict:
    """The record of a message drawn as `layout` parts `p`: its title and "To:", the Status lines (the history, then where it
    stands), its stage, the words it was drawn in besides English when the agent holds them, its buttons. `to`: the "To:"
    of every chat's copy together (IncidentThread.tell), else this copy's; `takes`: the villa's runs it stands for;
    `photos`: a visit's one list of photos (visit.photos), each a file of the villa's media folder."""
    h = layout.head_of(p.get("head"))
    said = p.get("said") if isinstance(p.get("said"), dict) else {}
    # ⚠️ THE STATE IS THE STAGE ALONE (owner, 2026-11-07): a reminder's state line was its whole bottom line, "Reminder
    # sent 11:43, No answer after 15min. Seen at … Was this visit expected? (to: Owner & FM)"; the step's own words
    # ("Reminder sent 11:43") are the state, what the desk said with it a Status line above, as Telegram's bottom line
    # says it (Telegram keeps it whole)
    bottom, said_with = _step_and_words((p.get("status") or "").strip(), said) if h else ((p.get("status") or "").strip(), "")
    # ⚠️ "MONITORING UNTIL" ONCE (owner, 2026-11-07, drill #139): the tablet's card said it in its state AND its pill;
    # the pill (the fault's monitoredUntil) says it there, so the tablet's state is the stage's words alone
    status = layout.stage_line({**h, "until": None}, bottom, p.get("mark")) if h else bottom
    languages: dict = {}
    for code, words in (said.get("status_in") or {}).items():
        if isinstance(words, str) and words.strip():
            languages[code] = {"status": layout.status_shown(h, [words.strip()], code) if h else [words.strip()]}
    tr = p.get("tr")
    if isinstance(tr, dict) and tr.get("lang") and isinstance(tr.get("body"), str) and tr["body"].strip():
        languages.setdefault(tr["lang"], {})["body"] = tr["body"].strip()
    rec = {
        "key": key, "title": layout.title_line(h) if h else "", "to": to if to is not None else (h["to"] if h else ""),
        "takes": takes or [],
        "lead": p.get("lead"), "body": layout.body_shown(p, h),
        # the tablet is everyone's: every step, whoever it went to (layout.head's `story`), else this copy's own
        "status": _lines(layout.status_shown(h, [*(_tablet_lines((h.get("story") or h["history"])) if h else []),
                                                 *([f"- {said_with}"] if said_with else []), status]), "status", "statusLine"),
        "stage": (h or {}).get("word") or said.get("stage") or "", "mark": p.get("mark") or "",
        "buttons": buttons_of(keyboard), "languages": languages, "photos": tablet_photos(photos),
    }
    if is_incident(key):
        # ⚠️ AN ALERT'S CARD: ITS POP-UP ONLY WHEN IT RINGS (owner, 2026-11-08, visit #154): the tablet pops a card up
        # at each new step, as Telegram rang each; a step that does not ring on Telegram (ringing.decide) is
        # `quiet` on the tablet too. ⚠️ THE SIREN'S QUESTION IS THE OWNER'S CHATS' ONLY: its buttons on the visit's
        # card (visit.Visits.offered) never on the tablet, everyone's card, as never on the facility manager's copy
        rec["buttons"] = [b for b in rec["buttons"] if b["kind"] != button_data.APPROVAL]
        if ringing.decide(key, said.get("stage"), p.get("mark")) != ringing.RING_NEW:
            rec["quiet"] = True
    return _finished(rec, photo)


def tablet_photos(photos) -> list[dict]:
    """`photos` ({path, label, at, strongest?, own?}, a visit's one list in its order: visit.photos) as a record names
    them for the Kiosk, at most the agreement's count, each label cut at its length: a file of the villa's media folder
    by its `path` (the Kiosk copies it, as a villa announcement's), one the Agent took itself (`own`: a camera its siren
    snapped, in its own folder the Kiosk cannot read) as the picture itself, `photo` (base64 of a JPEG no larger than a
    sheet's tile, sheet.small) — together never more than OWN_PHOTOS_B64, the rest left out (logged)."""
    from . import sheet
    root = os.path.realpath(sheet.MEDIA) + os.sep
    out, room = [], OWN_PHOTOS_B64
    for ph in photos or []:
        if not isinstance(ph, dict) or not ph.get("path"):
            continue
        one = {"label": _cut(ph.get("label"), "photoLabel"), "at": str(ph.get("at") or ""),
               **({"strongest": True} if ph.get("strongest") else {})}
        if ph.get("own"):
            jpeg = sheet.small(str(ph["path"]))
            b64 = base64.b64encode(jpeg).decode() if jpeg else ""
            if not b64 or len(b64) > room:
                log.info("A photo of a visit was left off the tablet's card: %s", "too large" if b64 else "unreadable")
                continue
            room -= len(b64)
            out.append({"photo": b64, **one})
        elif os.path.realpath(str(ph["path"])).startswith(root):
            out.append({"path": str(ph["path"]), **one})
    return out[:agreed_limit("photos")] if agreed_limit("photos") else []


#: The line of a visit's story only Telegram's copy needs: "+3 more photos on the tablet" (its picture holds a few)
TELEGRAM_ONLY_LINES = {"seen:photos"}


def _tablet_lines(lines) -> list:
    """A heading's Status lines as the tablet tells them: every one but those of Telegram's copy alone.

    ⚠️ "+3 MORE PHOTOS ON THE TABLET" ON THE TABLET (owner's screenshot, 2026-11-08, #154): meaningless there, the
    tablet's card shows every photo."""
    return [x for x in lines or () if not (isinstance(x, dict) and x.get("id") in TELEGRAM_ONLY_LINES)]


def _step_and_words(status: str, said: dict) -> tuple[str, str]:
    """A step's bottom line ("Reminder sent 11:43, No answer after 15min. … (to: Owner & FM)", notice.Notices.bottom)
    as its step alone and the words said with it, whom included ("No answer after 15min. … (to: Owner & FM)"); the line
    whole and no words when it is no step said with words (`said`: what it was drawn from, layout.step_said)."""
    if not (said.get("stage") and said.get("at")):
        return status, ""
    for words in [said.get("status"), *(said.get("status_in") or {}).values()]:
        words = str(words or "").strip()
        i = status.rfind(words) if words else -1
        step = status[:i].rstrip(" ,;:，、") if i > 0 else ""
        if step:
            return step, status[i:]
    return status, ""


def of_note(key: str, title: str, to: str, text: str, *, status: str = "", lead: str = "", keyboard: dict | None = None,
            photo: str | None = None) -> dict:
    """The record of a message sent on its own (a note to the owner, the night check's message, the morning digest): its
    title, who it is for, its words as sent. `key`: the thread it is (the skill's `key`, else its words)."""
    rec = {"key": key, "title": title, "to": to, "lead": lead, "body": text,
           "status": _lines([status], "status", "statusLine"), "buttons": buttons_of(keyboard)}
    return _finished(rec, photo)


def note_key(key: str | None, title: str, text: str) -> str:
    """A note's thread: its skill's own `key` (a later result may rewrite it), else a name made of its words — the same
    note sent to two chats is one line, as one saying."""
    if key:
        return f"note:{key}"
    return "note:" + hashlib.sha1(f"{title}\n{text}".encode("utf-8")).hexdigest()


def reported(rec: dict, *, own_key: bool, document: str | None = None, language: str | None = None) -> dict:
    """`rec`, a note sent on its own, as a REPORT when a scheduled run sends it (ticket 20 of "One inbox": the morning
    digest, the weekly and monthly reports, the owner's weekly lines, the night check's message): the job that sent it,
    its page (`document`, an HTML page of the out folder — any other file stays Telegram's —, uploaded by the push) and
    the language of its words (`language`, when its readers read several). Its key is the run's and its title's — its versions in other languages are ONE record (KioskMessages),
    and the next run's report is another line — unless the skill named its own (`own_key`: a later result rewrites it).
    Outside a scheduled run, `rec` as it was: an answer, a note to the owner, a recheck's line are no reports."""
    run = scheduled_run()
    if run is None:
        return rec
    key = rec["key"] if own_key else "note:" + hashlib.sha1(
        f"{run.name}\n{run.slot}\n{rec.get('title', '')}\n{rec.get('to', '')}".encode("utf-8")).hexdigest()
    out = {**rec, "key": key, "report": _cut(job_of(run.name), "report")}
    if language:
        out["language"] = language
    if document and document.lower().endswith(".html"):
        out[PAGE_FILE] = document
    return out


def note(keep, title: str, to: str, text: str, *, parts: dict | None = None, keyboard: dict | None = None,
         photo=None, document: str | None = None, language: str | None = None, report: bool = True) -> dict:
    """THE record of a message sent on its own (Poster.post, Poster.rewrite): its thread — the skill's own `keep` key
    when it gave one, else its words (note_key) —, drawn from its layout `parts` when it has some (a heading, a Status),
    else from its words as sent (of_note), as a report when a scheduled run sends it (`report`: a rewrite keeps the one
    it rewrites, agent-contract.json keptOnRewrite).

    ⚠️ ONE RECORD, ASSEMBLED HERE (architecture review round 14, card 2): the poster put each one together from four of
    this module's helpers, three ways — its pages, its laid-out note and its rewrite each chose the key, the drawing and
    the report on their own."""
    own = isinstance(keep, str)
    key = note_key(keep if own else None, title, text)
    pic = photo_b64(photo)
    rec = of_parts(key, parts, keyboard=keyboard, photo=pic) if parts is not None \
        else of_note(key, title, to, text, keyboard=keyboard, photo=pic)
    return reported(rec, own_key=own, document=document, language=language) if report else rec


def page_id(html: bytes) -> str:
    """A page's id at the Kiosk: its content's, so the same page sent to two chats or again later is the same file,
    written again (its age starts again) — never an id remembered here for a file the Kiosk may have tidied away."""
    return hashlib.sha1(html).hexdigest()


def is_incident(key: str) -> bool:
    """Is `key` an incident's thread (thread_key of a number), never an approval's or a note's?"""
    return any(str(key) == thread_key(n) for n in [str(key).rsplit(":", 1)[-1]] if n.isdigit())


def thread_key(iid) -> str:
    """The thread of an incident (its number, in the agreement's form `vestaMessage.incidentKey`, the one the tablet
    reads), or of an approval (its own id)."""
    form = str(agreement.section("vestaMessage").get("incidentKey") or "incident:{number}")
    return form.replace("{number}", str(iid)) if str(iid).isdigit() else f"thread:{iid}"


def incident_of(key: str) -> int | None:
    """The alert number a record's key names (thread_key's incident form), or None for any other thread."""
    form = str(agreement.section("vestaMessage").get("incidentKey") or "incident:{number}")
    head, _, tail = form.partition("{number}")
    if not (key.startswith(head) and key.endswith(tail)):
        return None
    n = key[len(head):len(key) - len(tail) if tail else None]
    return int(n) if n.isdigit() else None


def photo_b64(photo) -> str | None:
    """A message's picture ((base64, mime), as Delivery sends it) as the record carries it: its base64; none without."""
    return photo[0] if photo else None


def _finished(rec: dict, photo: str | None) -> dict:
    """⚠️ ONE FINISH FOR EVERY RECORD: its texts cut at the agreement's limits, who it is for read from its "To:", when it
    was drawn, its empty fields left out (the Kiosk reads a missing one as none), the photo (base64) added."""
    rec = {**rec, **{f: _cut(rec.get(f), f) for f in ("title", "to", "lead", "body")}}
    rec["roles"] = _lines(roles_of(rec["to"]), "roles", "role")
    # the villa's runs it stands for: the NEWEST kept when there are more (the older ones' messages are long tidied away
    # on the tablet; agent-contract.json vestaMessage says so)
    # ⚠️ A KEY IS NEVER CROWDED OUT (owner's drills, 2026-11-06): a visit's card takes every step's run, and its one
    # announcement by its key ("visit:<id>") — kept whatever the number of runs, the newest runs after it
    takes = [str(t) for t in rec.get("takes") or [] if t]
    keys, runs = [t for t in takes if ":" in t], [t for t in takes if ":" not in t]
    room = max(agreed_limit("takes") - len(keys), 0)
    rec["takes"] = (keys + (runs[-room:] if room else []))[-agreed_limit("takes"):] if agreed_limit("takes") else []
    rec["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rec = {k: v for k, v in rec.items() if v not in ("", [], {}, None)}
    return {**rec, "photo": photo} if photo else rec


class KioskMessages:
    """Keeps records for the tablet, in the background (see the module's note). One push in flight per key, the newest
    waiting: a message changed twice in a row is pushed in order, never both at once."""

    def __init__(self, kiosk, timeout_s, owed: KioskOwed, fault=None):
        self.kiosk = kiosk
        self._timeout_s = timeout_s            # kiosk.message_timeout_s: read at each push (the Limits tab applies at once)
        # fault(number): that alert's Kiosk fault made what its task says now (tickets.Tickets.follow), written just
        # before its record, in the same push (_drain)
        self.fault = fault
        # key → its newest copy the Kiosk did not keep, as drawn (see the module's note), sent again by the owed's pass
        self.owed = owed
        owed.sends(MESSAGE, lambda _key, rec: self.keep(rec))
        self._pending: dict[str, dict] = {}
        self._running: dict[str, asyncio.Task] = {}
        self._last: dict[str, str] = {}        # key → what was last pushed, to skip an identical one
        self._versions: dict[str, dict] = {}   # key → {language: record}: a report's versions, pushed as one record
        self._unreached = False                # said once per outage

    def keep(self, rec: dict) -> None:
        """Push `rec`, whatever the answer, without waiting. Nothing when there is no Kiosk, or `rec` is what the Kiosk
        was last given for its key."""
        if not self.kiosk.enabled or not rec.get("key"):
            return
        key = rec["key"]
        if rec.get("language"):
            rec = self._merged(key, rec)
        same = hashlib.sha1(json.dumps({k: v for k, v in rec.items() if k != "at"}, sort_keys=True).encode()).hexdigest()
        if self._last.get(key) == same:
            return
        self._last.pop(key, None)
        self._last[key] = same
        self.owed.paid(MESSAGE, key)           # this copy is newer than the one owed: it is the one to send
        while len(self._last) > REMEMBERED:
            self._last.pop(next(iter(self._last)))
        self._pending[key] = rec
        task = self._running.get(key)
        try:
            if task is None or task.done():
                self._running[key] = asyncio.get_running_loop().create_task(self._drain(key))
        except RuntimeError:                   # no loop running: nothing to push on (a script, a test)
            self._pending.pop(key, None)

    def _merged(self, key: str, rec: dict) -> dict:
        """A report's versions in its readers' languages as ONE record: the first version's words, each other one under
        `languages` with its page — which one a tablet shows is the tablet's (announcements.ts inTabletLanguage, the
        owner's spec story 38), never decided here too."""
        versions = self._versions.pop(key, {})
        versions[rec["language"]] = rec
        self._versions[key] = versions
        while len(self._versions) > REMEMBERED:
            self._versions.pop(next(iter(self._versions)))
        main = next(iter(versions))
        others = {code: {"body": r.get("body", ""), **({PAGE_FILE: r[PAGE_FILE]} if r.get(PAGE_FILE) else {})}
                  for code, r in versions.items() if code != main}
        merged = dict(versions[main])
        if others:
            merged["languages"] = {**merged.get("languages", {}), **others}
        return merged

    async def _with_pages(self, rec: dict) -> dict:
        """`rec` with its pages uploaded (kiosk.add_document, its own time limit) and named by their Kiosk ids; a page
        the Kiosk did not keep (an older one, refused, unreachable, the file gone) is left out, the words kept."""
        async def page(path):
            try:
                html = await asyncio.to_thread(lambda: open(path, "rb").read())
                return await self.kiosk.add_document(html, page_id(html))
            except Exception as e:  # noqa: BLE001 — a page not kept never costs the report its words
                log.warning("A report's page could not be kept for the tablet (%s): its words are", type(e).__name__)
                return None

        def named(part: dict, did) -> dict:
            out = {k: v for k, v in part.items() if k != PAGE_FILE}
            return {**out, "page": did} if did else out
        out = named(rec, await page(rec[PAGE_FILE]) if rec.get(PAGE_FILE) else None)
        if isinstance(out.get("languages"), dict):
            out["languages"] = {code: named(w, await page(w[PAGE_FILE]) if w.get(PAGE_FILE) else None)
                                for code, w in out["languages"].items()}
        return out

    async def _drain(self, key: str) -> None:
        while key in self._pending:
            drawn = self._pending.pop(key)
            await self._fault_first(key)
            try:
                rec = await self._with_pages(drawn)
                kept = await asyncio.wait_for(self.kiosk.keep_message(rec), self._timeout_s())
                if not kept:
                    # ⚠️ REFUSED IS NOT KEPT (architecture review 2026-10-29, round 3): remembered, the same copy told
                    # again (a retry, a run taken over) was skipped and the tablet kept an earlier step
                    self._owe(key, drawn)
                if self._unreached and kept:
                    log.info("The Kiosk keeps the agent's messages for the tablet again")
                self._unreached = self._unreached and not kept
            except Exception as e:  # noqa: BLE001 — a push never harms what is being said
                self._owe(key, drawn)
                if not self._unreached:
                    self._unreached = True
                    log.warning("A message could not be kept for the tablet (%s); it is sent again later",
                                type(e).__name__)
        self._running.pop(key, None)

    async def _fault_first(self, key: str) -> None:
        """An alert's record (its key the agreement's incident form): its fault brought up to date first — its name (the
        device its words name), its "monitoring until" pill, its lines — so the tablet's card changes with its words.

        ⚠️ ONE PUSH, FAULT AND WORDS (owner's drill, 2026-11-07, 10:56: Telegram's copies at 10:57:11 and 10:57:13, the
        tablet's pop-up within a second, its card's name and "monitoring until" at 10:57:28): the fault waited for the
        repair after every Telegram edit, the sheet and the villa told. Its own time limit; a fault not brought up to
        date never holds the words (the repair after the result does it)."""
        iid = incident_of(key)
        if iid is None or self.fault is None:
            return
        try:
            await asyncio.wait_for(self.fault(iid), self._timeout_s())
        except Exception as e:  # noqa: BLE001 — the words go anyway
            log.warning("Alert #%s: its Kiosk fault could not be brought up to date with its message (%s)", iid,
                        type(e).__name__)

    def _owe(self, key: str, drawn: dict) -> None:
        """`drawn` was not kept: forgotten as pushed (the same copy told again is sent), and owed — unless a newer copy
        of its key already waits, which is the one to send. As drawn, its pages still files: a retry uploads them."""
        self._last.pop(key, None)
        if key in self._pending:
            return
        self.owed.owe(MESSAGE, key, drawn)

    async def settle(self) -> None:
        """Wait for every push started (the tests; a stop)."""
        while self._running:
            await asyncio.gather(*list(self._running.values()), return_exceptions=True)
            await asyncio.sleep(0)
