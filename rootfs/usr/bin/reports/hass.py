"""A Home Assistant websocket client that belongs to the SERVER.

⚠️ THIS IS THE ONE PIECE OF PHASE 1 THAT IS NOT A MIRROR OF EXISTING CODE, and
the reason is worth stating precisely. `supervisor-proxy.py`'s `ws_handler`
looks like the thing to copy, but it RELAYS a browser's frames — including the
browser's own `auth` message, which it rewrites to carry the Supervisor token.
There is no browser here. A server-originated connection has to perform the
handshake itself:

    server -> ws://supervisor/core/websocket        (headers=AUTH)
    HA     -> {"type": "auth_required"}
    server -> {"type": "auth", "access_token": ...}
    HA     -> {"type": "auth_ok"}                   then id-incrementing pairs

Sending `headers=AUTH` is NOT sufficient on its own — Core still expects the
in-band auth frame — and the failure is quiet: the socket opens, the first
command is answered with `auth_required` rather than a result, and a client
that only looks for its own id waits forever.

⚠️ WHY THIS EXISTS AT ALL: scheduled reports must run with no browser open.
Everything else in this add-on is driven by a client. The proxy already proves
the pattern is available — it owns SUPERVISOR_TOKEN and already originates a
browser-less call at startup (`_cleanup_stale_options`) — this generalises it.

⚠️ DEGRADE, NEVER FAIL. Home Assistant restarts, and a report that raises into
the proxy is a 3D dashboard that stopped working because a weekly summary
could not be generated. Every public method here returns a value or raises
`HassUnavailable`, which callers are expected to treat as "no data this pass".
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import time
from types import TracebackType
from typing import Any, Dict, List, Optional, Type

from aiohttp import ClientError, ClientSession, WSMsgType

from .log import log, warn

SUPERVISOR = "supervisor"
WS_URL = f"ws://{SUPERVISOR}/core/websocket"
REST_ROOT = f"http://{SUPERVISOR}/core/api"

# Read from the environment rather than imported from the proxy — the reports
# package never imports upward (see __init__.py's layering note). s6 passes the
# same variable to the same process, so this is the same token, not a copy of a
# decision.
TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
AUTH_HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# One command's patience. Long enough for `statistics_during_period` over a
# month of 5-minute data on a Pi, short enough that a wedged socket cannot hold
# a scheduled pass open indefinitely.
COMMAND_TIMEOUT_S = 60.0
CONNECT_TIMEOUT_S = 20.0

# Reconnect backoff. Jittered because every add-on in the house reconnects when
# Core restarts, and unjittered retries make a thundering herd out of exactly
# the moment Core is least able to serve one.
BACKOFF_S = (5.0, 10.0, 20.0, 60.0)

# Circuit breaker. Core being down for maintenance is normal; hammering it for
# an hour is not, and neither is a report pass that spends its whole budget
# retrying. After this many consecutive failures the client refuses to try
# until the reset window elapses.
BREAKER_FAIL_MAX = 5
BREAKER_RESET_S = 300.0


class HassUnavailable(RuntimeError):
    """Home Assistant could not be reached, or refused the request.

    A single exception type on purpose: every caller's correct response is the
    same — record that this pass had no data and say so in the report — and a
    taxonomy of failure modes would invite callers to handle some and forget
    others.
    """


class _Breaker:
    """Consecutive-failure breaker, shared across connections.

    Deliberately counts CONSECUTIVE failures, not a rate: one failed pass a day
    against a flaky sensor is not an outage, and a rate window would trip on it
    eventually while never tripping fast enough on a genuine one.
    """

    def __init__(self) -> None:
        self.failures = 0
        self.opened_at = 0.0

    def is_open(self) -> bool:
        if self.failures < BREAKER_FAIL_MAX:
            return False
        if time.monotonic() - self.opened_at >= BREAKER_RESET_S:
            # Half-open: allow one attempt through. A success resets fully; a
            # failure re-opens for another window.
            self.failures = BREAKER_FAIL_MAX - 1
            return False
        return True

    def record_success(self) -> None:
        self.failures = 0

    def record_failure(self) -> None:
        self.failures += 1
        if self.failures >= BREAKER_FAIL_MAX:
            self.opened_at = time.monotonic()


_breaker = _Breaker()


class HassClient:
    """One websocket conversation with Core.

    Used as an async context manager around a whole report pass, so the
    handshake is paid once for the dozen-odd commands a pass makes rather than
    once per command:

        async with HassClient(session) as hass:
            ids = await hass.command("recorder/list_statistic_ids")
    """

    def __init__(self, session: ClientSession) -> None:
        self._session = session
        self._ws: Any = None
        self._next_id = 1

    async def __aenter__(self) -> "HassClient":
        await self.connect()
        return self

    async def __aexit__(self, exc_type: Optional[Type[BaseException]],
                        exc: Optional[BaseException],
                        tb: Optional[TracebackType]) -> None:
        await self.close()

    async def connect(self) -> None:
        """Open the socket and complete the auth handshake, with backoff."""
        if not TOKEN:
            # Distinct message on purpose: an add-on without hassio_api or run
            # outside Supervisor fails here, and "no token" is a configuration
            # fact while "connection refused" is an outage. Conflating them
            # sends the reader looking at the network.
            raise HassUnavailable("SUPERVISOR_TOKEN is not set")
        if _breaker.is_open():
            raise HassUnavailable(
                f"circuit breaker open after {BREAKER_FAIL_MAX} consecutive failures")

        last: Optional[BaseException] = None
        for attempt, delay in enumerate((0.0,) + BACKOFF_S):
            if delay:
                await asyncio.sleep(delay * (0.5 + random.random()))
            try:
                await self._open_and_authenticate()
                _breaker.record_success()
                return
            except (ClientError, asyncio.TimeoutError, HassUnavailable, OSError) as err:
                last = err
                warn(f"websocket connect attempt {attempt + 1} failed: {err}")
                await self.close()
        _breaker.record_failure()
        raise HassUnavailable(f"could not reach Home Assistant: {last}")

    async def _open_and_authenticate(self) -> None:
        # ⚠️ The connect timeout is applied with asyncio.wait_for rather than
        # ws_connect's own `timeout=`. That parameter changed type across
        # aiohttp versions (it now wants a ClientWSTimeout, not a float), and
        # the version in the add-on image is not pinned to the version CI
        # installs — passing a float typechecks against one and fails at
        # runtime against the other. wait_for has meant the same thing since
        # Python 3.4.
        self._ws = await asyncio.wait_for(
            self._session.ws_connect(WS_URL, headers=AUTH_HEADERS, heartbeat=30),
            timeout=CONNECT_TIMEOUT_S)

        # ⚠️ Core sends `auth_required` FIRST and expects an in-band `auth`
        # frame, even though the connection already carried a bearer header.
        # Skipping this leaves the socket open and every command unanswered.
        greeting = await self._receive_json()
        if greeting.get("type") == "auth_required":
            await self._ws.send_json({"type": "auth", "access_token": TOKEN})
            result = await self._receive_json()
            if result.get("type") != "auth_ok":
                raise HassUnavailable(
                    f"authentication refused: {result.get('message', result.get('type'))}")
        elif greeting.get("type") != "auth_ok":
            raise HassUnavailable(f"unexpected greeting: {greeting.get('type')}")

    async def _receive_json(self) -> Dict[str, Any]:
        msg = await asyncio.wait_for(self._ws.receive(), timeout=COMMAND_TIMEOUT_S)
        if msg.type != WSMsgType.TEXT:
            raise HassUnavailable(f"socket closed while awaiting a frame ({msg.type})")
        parsed: Any = json.loads(msg.data)
        if not isinstance(parsed, dict):
            raise HassUnavailable("received a non-object frame")
        return parsed

    async def command(self, command_type: str, **payload: Any) -> Any:
        """Send one command and return its `result`.

        Frames for OTHER ids are skipped rather than treated as an error: Core
        interleaves event frames on a shared connection, and a client that
        assumed the next frame was its own answer would break the moment
        anything subscribed.
        """
        if self._ws is None:
            raise HassUnavailable("not connected")
        message_id = self._next_id
        self._next_id += 1
        await self._ws.send_json({"id": message_id, "type": command_type, **payload})

        deadline = time.monotonic() + COMMAND_TIMEOUT_S
        while True:
            if time.monotonic() > deadline:
                raise HassUnavailable(f"{command_type} timed out")
            frame = await self._receive_json()
            if frame.get("id") != message_id:
                continue
            if frame.get("type") != "result":
                continue
            if not frame.get("success", False):
                error = frame.get("error") or {}
                raise HassUnavailable(
                    f"{command_type} failed: "
                    f"{error.get('code', 'unknown')} {error.get('message', '')}".strip())
            return frame.get("result")

    async def close(self) -> None:
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:  # noqa: BLE001 - closing must never raise upward
                pass
            self._ws = None


async def rest_get(session: ClientSession, path: str) -> Any:
    """One authenticated REST GET against Core.

    A few things have no websocket equivalent worth using. Kept minimal and
    separate from the WS client rather than folded into it, because the two
    have different failure semantics and merging them would hide that.
    """
    try:
        async with session.get(f"{REST_ROOT}/{path.lstrip('/')}",
                               headers=AUTH_HEADERS,
                               timeout=None) as response:
            if response.status != 200:
                raise HassUnavailable(f"GET {path} -> HTTP {response.status}")
            return await response.json()
    except (ClientError, asyncio.TimeoutError, OSError) as err:
        raise HassUnavailable(f"GET {path}: {err}") from err


async def probe(session: ClientSession) -> Dict[str, Any]:
    """Can we talk to Core at all, and what is it?

    Used by diagnostics so "reports produced nothing" can be told apart from
    "reports could not reach Home Assistant" — the two look identical in an
    empty report and have completely different fixes.
    """
    started = time.monotonic()
    try:
        async with HassClient(session) as hass:
            config: Any = await hass.command("get_config")
        elapsed_ms = int((time.monotonic() - started) * 1000)
        version = config.get("version") if isinstance(config, dict) else None
        timezone = config.get("time_zone") if isinstance(config, dict) else None
        log(f"connected to Home Assistant {version} in {elapsed_ms}ms")
        return {"ok": True, "version": version, "timezone": timezone,
                "latency_ms": elapsed_ms}
    except HassUnavailable as err:
        return {"ok": False, "error": str(err)}


def statistic_ids_of(sources: List[Dict[str, Any]], key: str) -> List[str]:
    """Pull one statistic-id field out of a list of energy source dicts,
    dropping absent/null entries. Trivial, but it is done in several places and
    the null handling is the whole point: an unconfigured field is `None`, not
    a missing key, so `.get(key)` alone yields a list containing None."""
    out: List[str] = []
    for source in sources:
        value = source.get(key)
        if isinstance(value, str) and value:
            out.append(value)
    return out
