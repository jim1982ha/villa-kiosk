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
REOPENED, RETITLED, READING = "reopened", "retitled", "reading"
OLD_TITLE_NOTE = "Now: "            # this agent's title step before the kinds (0.12.150 and earlier), still read


def agent_title(t: dict) -> str | None:
    """The title the agent last gave ticket `t` — from its steps (each says the title it gave), or an old "Now: …" note;
    None when its steps never said (a ticket written before 0.12.151)."""
    for u in reversed([u for u in t.get("updates") or [] if isinstance(u, dict)]):
        if isinstance(u.get("title"), str) and u["title"]:
            return u["title"]
        if not u.get("kind") and str(u.get("note") or "").startswith(OLD_TITLE_NOTE):
            return str(u["note"])[len(OLD_TITLE_NOTE):][:200]
    return None


def person_titled(t: dict) -> bool:
    """A person changed the ticket's title in the Kiosk: it is no longer the one the agent last gave it.
    ⚠️ THEIRS STAYS (architecture review 26): every night the agent wrote its own back over "Front door — part ordered"."""
    mine = agent_title(t)
    return mine is not None and str(t.get("title") or "") != mine


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

    async def add_ticket(self, title: str, entity_id: str | None = None, note: str | None = None) -> str:
        tid = "va-" + secrets.token_hex(8)

        def change(data: dict) -> str:
            tickets = list(data.get("tickets") or [])
            t = {"id": tid, "title": title[:200], "status": "open", "openedAt": _now(), "photoIds": [],
                 "updates": [{"at": _now(), "status": "open", "photoIds": [], "title": title[:200]}]}
            if entity_id:
                t["entityId"] = entity_id
            if note:
                t["note"] = note[:2000]
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
            return {"reopened_at": str(ups[-1].get("at") or ""), "reopened_by": str(ups[-1].get("by") or "")} if ups else {}
        return {t["id"]: {"status": str(t.get("status") or ""), "title": str(t.get("title") or ""),
                          "agent_title": agent_title(t), "resolved_at": str(t.get("resolvedAt") or ""),
                          "by": last(t, "by"), **reopened(t)}
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
                    t = {k: v for k, v in t.items() if k != "resolvedAt"}
                    tickets[i] = dict(t, status="open", title=title[:200] if mine else t.get("title"),
                                      updates=list(t.get("updates") or []) + [upd])
                    data["tickets"] = tickets
                    return True
            return False
        return await self._edit(change)

    async def resolve_ticket(self, tid: str, note: str | None = None) -> bool:
        """Mark one of the agent's tickets resolved (the FM answered Done). False when it is gone or closed."""
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
                    tickets[i] = dict(t, status="resolved", resolvedAt=now,
                                      updates=list(t.get("updates") or []) + [upd])
                    data["tickets"] = tickets
                    return True
            return False
        return await self._edit(change)
