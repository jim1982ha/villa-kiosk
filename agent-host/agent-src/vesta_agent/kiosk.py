"""The VESTA Kiosk agent interface v1: the heartbeat and the Facility tickets.

Only two jobs, one mechanism each:
  presence   POST /agent/v1/heartbeat every 2 minutes: the Kiosk shows the agent
             online / offline (its own window, 5 min by default)
  FM tasks   a ticket in the Facility records (GET, then PUT /agent/v1/fm-data with
             the revision read): the facility manager's work lives in one place,
             and the Kiosk stamps every record the agent writes "By VESTA Agent"

The Kiosk's messages and choices (/agent/v1/messages, /choices) are not used:
people talk to the agent on Telegram (decision D4, 2026-09-30).

⚠️ THE AGENT NEVER REMOVES A RECORD. The Kiosk refuses it anyway (403); every
write here starts from the document just read and only adds or updates.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from datetime import datetime, timezone

import aiohttp

log = logging.getLogger("vesta.kiosk")

CONTRACT = 1
HEARTBEAT_EVERY = 120


class KioskError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# What a step in a fault's history is — the agreement's `ticketUpdate.kinds` (agent-contract.json), never a note's
# first words (architecture review 26: the Kiosk took "Now: …" for a status step and showed it under the title it
# repeated). A step without a kind changes the status.
REOPENED, RETITLED, READING, NOTED, CLEARED = "reopened", "retitled", "reading", "noted", "cleared"
OLD_TITLE_NOTE = "Now: "            # this agent's title step before the kinds (0.12.150 and earlier), still read


#: Who the Kiosk names on a step the agent wrote (its proxy stamps it); a step written here, not yet through it, has none.
AGENT_BY = "VESTA Agent"


def _mine(u: dict) -> bool:
    return (u.get("by") or AGENT_BY) == AGENT_BY


def agent_title(t: dict) -> str | None:
    """The title the agent last gave ticket `t` — from its own steps (each says the title it gave), or an old "Now: …"
    note; None when its steps never said (a ticket written before 0.12.151)."""
    for u in reversed([u for u in t.get("updates") or [] if isinstance(u, dict)]):
        if isinstance(u.get("title"), str) and u["title"] and _mine(u):
            return u["title"]
        if not u.get("kind") and str(u.get("note") or "").startswith(OLD_TITLE_NOTE):
            return str(u["note"])[len(OLD_TITLE_NOTE):][:200]
    return None


def person_titled(t: dict) -> bool:
    """A person gave the ticket its title: the Kiosk's rename step says so (2.496.324), else it is no longer the one the
    agent last gave it; a ticket on which the agent never said its title is presumed the person's.
    ⚠️ THEIRS STAYS (architecture review 26): every night the agent wrote its own back over "Front door — part ordered".
    ⚠️ READ, NOT GUESSED (review 29): a person's rename left no step — an old ticket's title was overwritten once."""
    for u in reversed([u for u in t.get("updates") or [] if isinstance(u, dict)]):
        if u.get("kind") == RETITLED and not _mine(u):
            return True                                            # the last rename was a person's
        if isinstance(u.get("title"), str) and u["title"] and _mine(u):
            break                                                  # the agent titled it after any person did
    mine = agent_title(t)
    return mine is None or str(t.get("title") or "") != mine


class Kiosk:
    def __init__(self, url: str, token: str, headers: dict | None = None):
        self.url = url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}", **(headers or {})}
        self.enabled = bool(url and token)
        self.info: dict | None = None
        self._lock = asyncio.Lock()

    async def _req(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        timeout = aiohttp.ClientTimeout(total=30)
        try:
            async with aiohttp.ClientSession(timeout=timeout, headers=self.headers) as http:
                async with http.request(method, f"{self.url}{path}", json=body) as r:
                    try:
                        data = await r.json(content_type=None)
                    except ValueError:
                        data = {}
                    return r.status, data if isinstance(data, dict) else {}
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            # never the token: only what kind of failure it was
            raise KioskError(f"{method} {path}: {type(e).__name__}") from None

    async def check(self) -> bool:
        """The agreement version. A Kiosk that speaks another one is not written to."""
        if not self.enabled:
            return False
        status, data = await self._req("GET", "/agent/v1/info")
        if status != 200:
            raise KioskError(f"/agent/v1/info answered {status}")
        if data.get("contract") != CONTRACT:
            raise KioskError(f"the Kiosk speaks agreement {data.get('contract')}, this agent {CONTRACT}")
        self.info = data
        return True

    async def heartbeat(self, status: str | None = None) -> None:
        code, _ = await self._req("POST", "/agent/v1/heartbeat", {"status": status} if status else None)
        if code != 200:
            raise KioskError(f"heartbeat answered {code}")

    async def heartbeats(self, stop: asyncio.Event, status=lambda: None) -> None:
        reported = None
        while not stop.is_set():
            try:
                await self.heartbeat(status())
                if reported:
                    log.info("Kiosk heartbeat: back")
                reported = None
            except KioskError as e:
                if str(e) != reported:
                    log.warning("Kiosk heartbeat failed: %s", e)
                reported = str(e)
            try:
                await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_EVERY)
            except asyncio.TimeoutError:
                pass

    # ------------------------------------------------------------------ Facility tickets
    async def _edit(self, change) -> object:
        """Read the Facility records, apply `change(data)`, write them back with the revision read.

        A 409 means a person saved in between: read again and apply the same change
        once more — their edit stays, ours lands on top of it."""
        async with self._lock:
            for attempt in (1, 2):
                status, got = await self._req("GET", "/agent/v1/fm-data")
                if status != 200:
                    raise KioskError(f"reading the Facility records answered {status}")
                data = got.get("data") if isinstance(got.get("data"), dict) else {}
                data = dict(data)
                before = json.dumps(data, sort_keys=True, default=str)
                result = change(data)
                if json.dumps(data, sort_keys=True, default=str) == before:
                    return result                    # nothing changed: no write (a write bumps the revision and
                                                     # can turn a person's save into "changed since you opened it")
                status, res = await self._req("PUT", "/agent/v1/fm-data", {"data": data, "rev": got.get("rev")})
                if status == 200:
                    return result
                if status == 409 and attempt == 1:
                    continue
                raise KioskError(f"writing the Facility records answered {status}: {str(res.get('error', ''))[:200]}")
        raise KioskError("the Facility records kept changing")

    async def add_document(self, html: bytes) -> str | None:
        """Store one HTML page for a fault (the VESTA Kiosk 2.496.326 and later: /agent/v1/fm-document) — its id, or None
        when this Kiosk cannot hold documents (an older one answers 404) or refused it. Kept with the fault, deleted with it."""
        did = secrets.token_hex(16)
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60), headers=self.headers) as http:
                async with http.post(f"{self.url}/agent/v1/fm-document?id={did}", data=html,
                                     headers={"Content-Type": "text/html; charset=utf-8"}) as r:
                    if r.status == 200:
                        return did
                    log.warning("The Kiosk did not keep the document: it answered %s%s", r.status,
                                " (a Kiosk older than 2.496.326 holds no documents)" if r.status == 404 else "")
                    return None
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            raise KioskError(f"POST /agent/v1/fm-document: {type(e).__name__}") from None

    def _ticket_id(self) -> str:
        """A new fault's id ("va-…": written by the VESTA Agent)."""
        return "va-" + secrets.token_hex(8)

    async def add_ticket(self, title: str, entity_id: str | None = None, note: str | None = None,
                         document_ids: list[str] | None = None, number: int | None = None) -> str:
        """`number`: the alert's number, as every chat names it ("#5"), when the fault comes from one — the Kiosk's card
        shows it beside the title (owner, 2026-10-14), so the Telegram message and the card are seen to be one problem."""
        tid = self._ticket_id()

        def change(data: dict) -> str:
            tickets = list(data.get("tickets") or [])
            t = {"id": tid, "title": title[:200], "status": "open", "openedAt": _now(), "photoIds": [],
                 "updates": [{"at": _now(), "status": "open", "photoIds": [], "title": title[:200]}]}
            if document_ids:
                t["documentIds"] = list(document_ids)
            if entity_id:
                t["entityId"] = entity_id
            if note:
                t["note"] = note[:2000]
            if number:
                t["alertNumber"] = int(number)
            tickets.append(t)
            data["tickets"] = tickets
            return tid
        return await self._edit(change)

    async def ticket_states(self) -> dict[str, str]:
        """{ticket id: status} of the Facility records, as the Kiosk holds them now."""
        return {tid: t["status"] for tid, t in (await self.held_tickets()).items()}

    async def held_tickets(self) -> dict[str, dict]:
        """{ticket id: {status, title, agent_title, resolved_at, by, reopened_at, reopened_by}} of the Facility records,
        as the Kiosk holds them now: `by` the profile of its last step ("Facility manager" who closed it), `agent_title`
        the title the agent last gave it (None: never said), `reopened_*` its last reopening, from its steps."""
        status, got = await self._req("GET", "/agent/v1/fm-data")
        if status != 200:
            raise KioskError(f"reading the Facility records answered {status}")
        data = got.get("data") if isinstance(got.get("data"), dict) else {}
        def last(t: dict, key: str) -> str:
            ups = [u for u in t.get("updates") or [] if isinstance(u, dict)]
            return str(ups[-1].get(key) or "") if ups else ""
        def reopened(t: dict) -> dict:
            ups = [u for u in t.get("updates") or [] if isinstance(u, dict) and u.get("kind") == REOPENED]
            return {"reopened_at": str(ups[-1].get("at") or ""),
                    "reopened_by": str(ups[-1].get("who") or ups[-1].get("by") or "")} if ups else {}
        return {t["id"]: {"status": str(t.get("status") or ""), "title": str(t.get("title") or ""),
                          "agent_title": agent_title(t), "resolved_at": str(t.get("resolvedAt") or ""),
                          "by": last(t, "who") or last(t, "by"), "alert_number": t.get("alertNumber"),
                          "noted": [(str(u.get("at") or ""), str(u.get("note") or "")) for u in t.get("updates") or []
                                    if isinstance(u, dict) and u.get("kind") == NOTED],
                          **reopened(t)}     # `by`: who did it, as the card says it
                for t in data.get("tickets") or [] if isinstance(t, dict) and isinstance(t.get("id"), str)}

    async def update_ticket(self, tid: str, title: str) -> bool:
        """An open ticket says what is wrong NOW (owner, 2026-10-07: "battery at 5 %" stayed while it read 0 %): its
        title follows, its history keeping the one before (a "retitled" step); under a title a person wrote, the title
        stays theirs and the reading is a "reading" step. False when it is gone, closed, or already says it."""
        title = title[:200]

        def change(data: dict) -> bool:
            tickets = list(data.get("tickets") or [])
            for i, t in enumerate(tickets):
                if isinstance(t, dict) and t.get("id") == tid:
                    if t.get("status") == "resolved" or (agent_title(t) or t.get("title")) == title:
                        return False
                    step = {"at": _now(), "status": t.get("status") or "open", "photoIds": [], "title": title}
                    if person_titled(t):
                        t = dict(t, updates=list(t.get("updates") or []) + [{**step, "kind": READING}])
                    else:
                        t = dict(t, title=title, updates=list(t.get("updates") or [])
                                 + [{**step, "kind": RETITLED, "was": str(t.get("title") or "")}])
                    tickets[i] = t
                    data["tickets"] = tickets
                    return True
            return False
        return await self._edit(change)

    def says(self, kind: str) -> bool:
        """This Kiosk shows fault steps of `kind` (/agent/v1/info `step_kinds`, 2.496.356+): an older one would read a
        "noted" line as the fault changing status."""
        return kind in ((self.info or {}).get("step_kinds") or [])

    async def note_ticket(self, tid: str, lines: list[dict]) -> bool:
        """Lines of what happened about an open fault on Telegram ([{at, note}], notice.Notices.story), each a "noted"
        step at its own time; a line the fault already has is not written again. False when it is gone, closed, or has
        them all."""
        def change(data: dict) -> bool:
            tickets = list(data.get("tickets") or [])
            for i, t in enumerate(tickets):
                if isinstance(t, dict) and t.get("id") == tid:
                    if t.get("status") == "resolved":
                        return False
                    have = {(u.get("at"), u.get("note")) for u in t.get("updates") or [] if isinstance(u, dict)
                            and u.get("kind") == NOTED}
                    new = [{"at": x["at"], "status": t.get("status") or "open", "photoIds": [], "kind": NOTED,
                            "note": str(x["note"])[:500]} for x in lines if (x["at"], str(x["note"])[:500]) not in have]
                    if not new:
                        return False
                    tickets[i] = dict(t, updates=list(t.get("updates") or []) + new)
                    data["tickets"] = tickets
                    return True
            return False
        return await self._edit(change)

    async def number_ticket(self, tid: str, number: int) -> bool:
        """A fault made before it carried its alert's number gets it ("#5", add_ticket). False when it is gone or
        already says it."""
        def change(data: dict) -> bool:
            tickets = list(data.get("tickets") or [])
            for i, t in enumerate(tickets):
                if isinstance(t, dict) and t.get("id") == tid:
                    if t.get("alertNumber") == int(number):
                        return False
                    tickets[i] = dict(t, alertNumber=int(number))
                    data["tickets"] = tickets
                    return True
            return False
        return await self._edit(change)

    async def reopen_ticket(self, tid: str, title: str, note: str | None = None) -> bool:
        """One of the agent's resolved tickets open again — its problem came back (architecture review 24: each return
        made a new fault, 24 a day for one access point, nothing saying they were the same). False when it is gone."""
        def change(data: dict) -> bool:
            tickets = list(data.get("tickets") or [])
            for i, t in enumerate(tickets):
                if isinstance(t, dict) and t.get("id") == tid:
                    upd = {"at": _now(), "status": "open", "photoIds": [], "kind": REOPENED, "title": title[:200],
                           "note": (note or f"Back again: {title}")[:500]}
                    mine = not person_titled(t)                 # a title a person wrote stays theirs (review 26)
                    if mine and str(t.get("title") or "") != title[:200]:
                        upd["was"] = str(t.get("title") or "")  # the title it replaces: the card's "Was:" (review 31)
                    t = {k: v for k, v in t.items() if k != "resolvedAt"}
                    tickets[i] = dict(t, status="open", title=title[:200] if mine else t.get("title"),
                                      updates=list(t.get("updates") or []) + [upd])
                    data["tickets"] = tickets
                    return True
            return False
        return await self._edit(change)

    async def resolve_ticket(self, tid: str, note: str | None = None, who: str | None = None) -> bool:
        """Mark one of the agent's tickets resolved. By `who` — a person's Done: their name on the card, and the work
        recorded as the Kiosk's own "Mark resolved" records it (a completion, in Recent work; review 31: a Done on
        Telegram never appeared there). Without — the agent's own clearing of a problem gone: kind "cleared", never a
        repair in any figure. False when it is gone or closed."""
        def change(data: dict) -> bool:
            tickets = list(data.get("tickets") or [])
            for i, t in enumerate(tickets):
                if isinstance(t, dict) and t.get("id") == tid:
                    if t.get("status") == "resolved":
                        return False
                    now = _now()
                    upd = {"at": now, "status": "resolved", "photoIds": []}
                    if note:
                        upd["note"] = note[:500]
                    if who:
                        upd["who"] = who[:80]       # the person, on the card (faultWhen: who, else by)
                        # its `by` is the Kiosk's to stamp ("VESTA Agent"); the person is `who` (fmEngine.workedBy)
                        data["completions"] = list(data.get("completions") or []) + [{
                            "id": "va-cp-" + secrets.token_hex(6), "scheduleId": "", "ticketId": tid, "at": now,
                            "by": "", "who": who[:80], "photoIds": [], **({"note": note[:500]} if note else {})}]
                    else:
                        upd["kind"] = CLEARED
                    tickets[i] = dict(t, status="resolved", resolvedAt=now,
                                      updates=list(t.get("updates") or []) + [upd])
                    data["tickets"] = tickets
                    return True
            return False
        return await self._edit(change)
