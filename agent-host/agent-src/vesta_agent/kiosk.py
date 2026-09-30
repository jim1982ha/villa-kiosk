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
                result = change(data)
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
                 "updates": [{"at": _now(), "status": "open", "photoIds": []}]}
            if entity_id:
                t["entityId"] = entity_id
            if note:
                t["note"] = note[:2000]
            tickets.append(t)
            data["tickets"] = tickets
            return tid
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
