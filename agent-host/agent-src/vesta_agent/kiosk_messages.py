"""Every message the agent writes on Telegram, kept for the tablet as it stands now (ticket 25 of "One inbox", owner
2026-10-28: everything Telegram shows is reproduced on the tablet).

⚠️ DELIVERY'S SECOND SINK, NEVER A SECOND WRITER OF WORDS. The words of a message are drawn once, where they always were:
IncidentThread (an alert, an approval, a snapshot: `_post`, `_show`) and Poster (a note sent on its own, its rewrite). Those
call `KioskMessages` with the very parts they drew; nothing here composes a sentence. One record per thread (`key`), which
the Kiosk replaces when the message is rewritten — the tablet shows the message as it stands, as Telegram does.

⚠️ NEVER IN THE CRITICAL PATH. The push runs in the background with a time limit (kiosk.message_timeout_s): an alert never
waits on it, a Kiosk that is down or slow loses that copy and nothing else, and the next change of the message tries
again. The Agent stopped, the villa's own first version (its announcement) is all the tablet has.

The record's shape is the agreement's (agent-contract.json `vestaMessage`): its limits are read from there.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import datetime, timezone

from vesta_shared import agreement
from vesta_shared.message_format import AND

from . import button_data, layout
from .in_progress import scheduled_run
from .scheduler import job_of

log = logging.getLogger("vesta.kiosk")

#: How many keys' last push are remembered to skip an identical one (a retry that redraws the same copy).
REMEMBERED = 500
#: A report's page as a file of the out folder, until the push uploads it and names it by its Kiosk id (`page`).
PAGE_FILE = "_page"


def agreed_limit(name: str) -> int:
    """The agreement's longest `name` (vestaMessage.limits); 0 when it names none."""
    return int(agreement.section("vestaMessage").get("limits", {}).get(name) or 0)


def _cut(text, name: str) -> str:
    n = agreed_limit(name)
    return str(text or "").strip()[:n] if n else ""


def _lines(lines, list_name: str, line_name: str) -> list[str]:
    n = agreed_limit(list_name)
    return [x for x in (_cut(line, line_name) for line in lines or ()) if x][:n]


def buttons_of(keyboard: dict | None, closes=None) -> list[dict]:
    """A Telegram keyboard as the record's buttons: each the agent's own kind and id (button_data) with its label —
    never a device or a command. A button the agent did not write is left out. `closes(kind, parts)`: whether its press
    settles its alert as done (an alert's Done: AlertButtons.closes) — the tablet does not draw it beside the issue's own
    Close (owner, 2026-10-29)."""
    out = []
    for row in (keyboard or {}).get("inline_keyboard") or ():
        for b in row:
            kind, parts = button_data.read(str(b.get("callback_data") or ""))
            if kind:
                out.append({"label": _cut(b.get("text"), "label"), "kind": kind, "id": ":".join(parts),
                            **({"closes": True} if closes and closes(kind, parts) else {})})
    return out


def roles_of(to: str) -> list[str]:
    """The roles a "To:" line names ("Owner & FM")."""
    return [r.strip() for r in (to or "").split(AND.strip()) if r.strip()]


def of_parts(key: str, p: dict, *, keyboard: dict | None = None, photo: str | None = None, to: str | None = None,
             takes: list[str] | None = None, closes=None) -> dict:
    """The record of a message drawn as `layout` parts `p`: its title and "To:", the Status lines (the history, then where it
    stands), its stage, the words it was drawn in besides English when the agent holds them, its buttons. `to`: the "To:"
    of every chat's copy together (IncidentThread.tell), else this copy's; `takes`: the villa's runs it stands for."""
    h = layout.head_of(p.get("head"))
    status = layout.stage_line(h, (p.get("status") or "").strip(), p.get("mark")) if h else (p.get("status") or "").strip()
    languages: dict = {}
    said = p.get("said") if isinstance(p.get("said"), dict) else {}
    for code, words in (said.get("status_in") or {}).items():
        if isinstance(words, str) and words.strip():
            languages[code] = {"status": [words.strip()]}
    tr = p.get("tr")
    if isinstance(tr, dict) and tr.get("lang") and isinstance(tr.get("body"), str) and tr["body"].strip():
        languages.setdefault(tr["lang"], {})["body"] = tr["body"].strip()
    rec = {
        "key": key, "title": layout.title_line(h) if h else "", "to": to if to is not None else (h["to"] if h else ""),
        "takes": takes or [],
        "lead": p.get("lead"), "body": layout.body_shown(p, h),
        "status": _lines([*(h["history"] if h else []), status], "status", "statusLine"),
        "stage": (h or {}).get("word") or said.get("stage") or "", "mark": p.get("mark") or "",
        "buttons": buttons_of(keyboard, closes), "languages": languages,
    }
    return _finished(rec, photo)


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


def page_id(html: bytes) -> str:
    """A page's id at the Kiosk: its content's, so the same page sent to two chats or again later is the same file,
    written again (its age starts again) — never an id remembered here for a file the Kiosk may have tidied away."""
    return hashlib.sha1(html).hexdigest()


def thread_key(iid) -> str:
    """The thread of an incident (its number, in the agreement's form `vestaMessage.incidentKey`, the one the tablet
    reads), or of an approval or a snapshot (their own ids)."""
    form = str(agreement.section("vestaMessage").get("incidentKey") or "incident:{number}")
    return form.replace("{number}", str(iid)) if str(iid).isdigit() else f"thread:{iid}"


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
    takes = [str(t) for t in rec.get("takes") or [] if t]
    rec["takes"] = takes[-agreed_limit("takes"):] if agreed_limit("takes") else []
    rec["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rec = {k: v for k, v in rec.items() if v not in ("", [], {}, None)}
    return {**rec, "photo": photo} if photo else rec


class KioskMessages:
    """Keeps records for the tablet, in the background (see the module's note). One push in flight per key, the newest
    waiting: a message changed twice in a row is pushed in order, never both at once."""

    def __init__(self, kiosk, timeout_s):
        self.kiosk = kiosk
        self._timeout_s = timeout_s            # kiosk.message_timeout_s: read at each push (the Limits tab applies at once)
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
            rec = self._pending.pop(key)
            try:
                rec = await self._with_pages(rec)
                kept = await asyncio.wait_for(self.kiosk.keep_message(rec), self._timeout_s())
                if not kept:
                    # ⚠️ REFUSED IS NOT KEPT (architecture review 2026-10-29, round 3): remembered, the same copy told
                    # again (a retry, a run taken over) was skipped and the tablet kept an earlier step
                    self._last.pop(key, None)
                if self._unreached and kept:
                    log.info("The Kiosk keeps the agent's messages for the tablet again")
                self._unreached = self._unreached and not kept
            except Exception as e:  # noqa: BLE001 — a push never harms what is being said
                self._last.pop(key, None)      # not kept: the next draw of the same words tries again
                if not self._unreached:
                    self._unreached = True
                    log.warning("A message could not be kept for the tablet (%s); it is tried again at its next change",
                                type(e).__name__)
        self._running.pop(key, None)

    async def settle(self) -> None:
        """Wait for every push started (the tests; a stop)."""
        while self._running:
            await asyncio.gather(*list(self._running.values()), return_exceptions=True)
            await asyncio.sleep(0)
