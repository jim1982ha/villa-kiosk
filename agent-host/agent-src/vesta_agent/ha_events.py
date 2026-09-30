"""The one Home Assistant websocket: LISTEN ONLY, to four event types.

  vesta_critical_event   fired by the VESTA rules (the critical_* blueprints), AFTER
                         their own Telegram message: the alert desk's input
  telegram_text          what Home Assistant receives on the villa bot, as it fires it
  telegram_command       for its own automations: the agent reads Telegram from here
  telegram_callback      and never from Telegram itself (telegram.py sends only)

Decision D1 (owner, 2026-09-30): an exception to "Home Assistant only through HA
MCP", because HA MCP has no event-listening tool. The socket subscribes to these
four types and SENDS NOTHING ELSE: no service call, no event, no write of any kind
travels on it. Everything Home Assistant does with Telegram (alerts, the gate
button, any automation) keeps working whether this process runs or not.

The connection doubles as the "villa silent" watch: while it is up, a beat is
written every minute; the alert desk opens an incident when the beat is older than
its limit (internet, power or Home Assistant down).
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Awaitable, Callable

import aiohttp

log = logging.getLogger("vesta.ha_events")

EVENT_TYPES = ("vesta_critical_event", "telegram_text", "telegram_command", "telegram_callback")
BACKOFF_START = 5
BACKOFF_MAX = 300
BEAT_EVERY = 60


def websocket_url(ha_url: str) -> str:
    base = ha_url.rstrip("/")
    if base.startswith("https://"):
        base = "wss://" + base[len("https://"):]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://"):]
    return base + "/api/websocket"


class HaEvents:
    def __init__(self, ha_url: str, token: str, handler: Callable[[str, dict], Awaitable[None]],
                 beat: Callable[[], None], headers: dict | None = None, event_types=EVENT_TYPES):
        self.url = websocket_url(ha_url)
        self.token = token
        self.handler = handler
        self.beat = beat
        self.headers = headers or {}
        self.event_types = tuple(event_types)
        self.connected = asyncio.Event()
        self._tasks: set = set()

    async def run(self, stop: asyncio.Event) -> None:
        delay = BACKOFF_START
        while not stop.is_set():
            # ⚠️ THE SESSION RACES THE STOP: a socket waiting for its next event would
            # otherwise hold a stop until Home Assistant happened to send something.
            session = asyncio.create_task(self._session(stop))
            stopper = asyncio.create_task(stop.wait())
            done, _ = await asyncio.wait({session, stopper}, return_when=asyncio.FIRST_COMPLETED)
            if stopper in done:
                session.cancel()
                await asyncio.gather(session, return_exceptions=True)
                break
            stopper.cancel()
            try:
                session.result()
                delay = BACKOFF_START
            except asyncio.CancelledError:
                raise
            except PermissionError as e:
                # our own message, no secret in it: say plainly that the token is the problem
                log.error("Home Assistant events: %s, retry in %d s", e, delay)
            except Exception as e:  # noqa: BLE001
                # never the URL or the token: only what kind of failure it was
                log.warning("Home Assistant events: connection lost (%s), retry in %d s", type(e).__name__, delay)
            self.connected.clear()
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay)
            except asyncio.TimeoutError:
                pass
            delay = min(delay * 2, BACKOFF_MAX)

    async def _session(self, stop: asyncio.Event) -> None:
        timeout = aiohttp.ClientTimeout(total=None, connect=20, sock_read=None)
        async with aiohttp.ClientSession(timeout=timeout, headers=self.headers) as http:
            async with http.ws_connect(self.url, heartbeat=30, max_msg_size=4 * 1024 * 1024) as ws:
                first = await ws.receive_json(timeout=20)
                if first.get("type") != "auth_required":
                    raise ConnectionError("unexpected first message")
                await ws.send_json({"type": "auth", "access_token": self.token})
                reply = await ws.receive_json(timeout=20)
                if reply.get("type") != "auth_ok":
                    # a refused token will not fix itself: say so plainly, then keep retrying slowly
                    raise PermissionError("Home Assistant refused the VESTA Agent token")
                ids = {}
                for n, et in enumerate(self.event_types, start=1):
                    await ws.send_json({"id": n, "type": "subscribe_events", "event_type": et})
                    ids[n] = et
                pending = set(ids)
                self.connected.set()
                log.info("Home Assistant events: listening to %s", ", ".join(self.event_types))
                self.beat()
                beat_task = asyncio.create_task(self._beats(stop))
                try:
                    while not stop.is_set():
                        msg = await ws.receive()
                        if msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            raise ConnectionError("socket closed")
                        if msg.type != aiohttp.WSMsgType.TEXT:
                            continue
                        try:
                            data = json.loads(msg.data)
                        except ValueError:
                            continue
                        for item in data if isinstance(data, list) else [data]:
                            await self._dispatch(item, ids, pending)
                finally:
                    beat_task.cancel()

    async def _dispatch(self, item: dict, ids: dict, pending: set) -> None:
        kind = item.get("type")
        if kind == "result":
            n = item.get("id")
            if n in pending:
                pending.discard(n)
                if not item.get("success"):
                    log.error("Home Assistant events: subscription to %s refused", ids.get(n))
            return
        if kind != "event":
            return
        ev = item.get("event") or {}
        et = ev.get("event_type")
        if et not in self.event_types:
            return
        # ⚠️ A TASK, NEVER AWAITED HERE: a conversation takes the model tens of seconds,
        # and the socket must keep reading (and answering Home Assistant's pings) meanwhile.
        task = asyncio.create_task(self._handle(et, ev.get("data") or {}))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _handle(self, et: str, data: dict) -> None:
        try:
            await self.handler(et, data)
        except Exception:  # noqa: BLE001
            log.exception("handling %s failed", et)

    async def _beats(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            await asyncio.sleep(BEAT_EVERY)
            try:
                self.beat()
            except Exception:  # noqa: BLE001
                log.exception("beat failed")
