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

log = logging.getLogger("vesta.kiosk")

#: How many keys' last push are remembered to skip an identical one (a retry that redraws the same copy).
REMEMBERED = 500


def limit(name: str) -> int:
    """The agreement's longest `name` (vestaMessage.limits); 0 when it names none."""
    return int(agreement.section("vestaMessage").get("limits", {}).get(name) or 0)


def _cut(text, name: str) -> str:
    n = limit(name)
    return str(text or "").strip()[:n] if n else ""


def _lines(lines, list_name: str, line_name: str) -> list[str]:
    n = limit(list_name)
    return [x for x in (_cut(line, line_name) for line in lines or ()) if x][:n]


def buttons_of(keyboard: dict | None) -> list[dict]:
    """A Telegram keyboard as the record's buttons: each the agent's own kind and id (button_data) with its label —
    never a device or a command. A button the agent did not write is left out."""
    out = []
    for row in (keyboard or {}).get("inline_keyboard") or ():
        for b in row:
            kind, parts = button_data.read(str(b.get("callback_data") or ""))
            if kind:
                out.append({"label": _cut(b.get("text"), "label"), "kind": kind, "id": ":".join(parts)})
    return out


def roles_of(to: str) -> list[str]:
    """The roles a "To:" line names ("Owner & FM")."""
    return [r.strip() for r in (to or "").split(AND.strip()) if r.strip()]


def of_parts(key: str, p: dict, *, keyboard: dict | None = None, photo: str | None = None) -> dict:
    """The record of a message drawn as `layout` parts `p`: its title and "To:", the Status lines (the history, then where it
    stands), its stage, the words it was drawn in besides English when the agent holds them, its buttons."""
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
        "key": key, "title": _cut(layout.title_line(h), "title") if h else "",
        "roles": _lines(roles_of(h["to"]), "roles", "role") if h else [],
        "lead": _cut(p.get("lead"), "lead"), "body": _cut(layout.body_shown(p, h), "body"),
        "status": _lines([*(h["history"] if h else []), status], "status", "statusLine"),
        "stage": (h or {}).get("word") or said.get("stage") or "", "mark": p.get("mark") or "",
        "buttons": buttons_of(keyboard), "languages": languages, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    return _finished(rec, photo)


def of_note(key: str, title: str, to: str, text: str, *, status: str = "", lead: str = "", keyboard: dict | None = None,
            photo: str | None = None) -> dict:
    """The record of a message sent on its own (a note to the owner, the night check's message, the morning digest): its
    title, who it is for, its words as sent. `key`: the thread it is (the skill's `key`, else its words)."""
    rec = {"key": key, "title": _cut(title, "title"), "roles": _lines(roles_of(to), "roles", "role"),
           "lead": _cut(lead, "lead"), "body": _cut(text, "body"), "status": _lines([status], "status", "statusLine"),
           "buttons": buttons_of(keyboard), "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    return _finished(rec, photo)


def note_key(key: str | None, title: str, text: str) -> str:
    """A note's thread: its skill's own `key` (a later result may rewrite it), else a name made of its words — the same
    note sent to two chats is one line, as one saying."""
    if key:
        return f"note:{key}"
    return "note:" + hashlib.sha1(f"{title}\n{text}".encode("utf-8")).hexdigest()


def thread_key(iid) -> str:
    """The thread of an incident (its number), or of an approval or a snapshot (their own ids)."""
    return f"incident:{iid}" if str(iid).isdigit() else f"thread:{iid}"


def _finished(rec: dict, photo: str | None) -> dict:
    """The record without its empty fields (the Kiosk reads a missing one as none), the photo (base64) added."""
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
        self._unreached = False                # said once per outage

    def keep(self, rec: dict) -> None:
        """Push `rec`, whatever the answer, without waiting. Nothing when there is no Kiosk, or `rec` is what the Kiosk
        was last given for its key."""
        if not self.kiosk.enabled or not rec.get("key"):
            return
        key = rec["key"]
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

    async def _drain(self, key: str) -> None:
        while key in self._pending:
            rec = self._pending.pop(key)
            try:
                kept = await asyncio.wait_for(self.kiosk.keep_message(rec), self._timeout_s())
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
