"""Catching the findings the automation layer is already producing.

⚠️ THIS IS THE MISSING LINK, AND IT IS THE WHOLE REASON THIS SUBSYSTEM EXISTS.
The villa runs 23 blueprints and 84 automation instances. Every `roi_` and
`maintenance_` rule "writes a report line" — which means it fires a `vesta_*`
event on Home Assistant's event bus. Searched across every automation and script
on the live instance: **zero listeners**. Home Assistant events are transient, so
eighty-four automations have been firing findings into nothing, and the report
they were all written to feed has never been composed.

The detection layer is good and stays exactly as it is. What it lacked was
memory. This file is the memory.

⚠️ WHY NOT JUST QUERY THE RECORDER LATER. Home Assistant offers no supported way
to read arbitrary custom events back over a time range — the logbook surfaces
only events that registered a logbook entry, and the recorder's `events` table
has no public API. Subscribing live and persisting is the only reliable route,
which is why the buffer below exists rather than a query at report time.

⚠️ AND THEREFORE: EVENTS FIRED WHILE THE ADD-ON IS DOWN ARE LOST. That is a real
limitation of this design and it must be STATED IN THE REPORT rather than hidden
— an owner reading a quiet week deserves to know whether it was quiet or whether
nobody was listening. `coverage()` below is what the renderer uses to say so.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence

from aiohttp import ClientSession

from . import store
from .hass import HassClient, HassUnavailable
from .log import log, swallow, warn

#: The event families the blueprint layer emits. Named explicitly — see
#: `HassClient.subscribe` on why a bare subscription is not an option.
#:
#: ⚠️ THIS LIST IS A GUESS BEYOND THE FIRST ENTRY, and is instrumented rather
#: than assumed: `vesta_roi_event` is documented in `roi_idle_load.yaml`'s own
#: description, the rest follow the catalog's four categories. `seen_types` in
#: the buffer records which ones actually arrive, so a name that is wrong shows
#: up as permanently absent instead of silently collecting nothing.
DEFAULT_EVENT_TYPES = (
    "vesta_roi_event",
    "vesta_maintenance_event",
    "vesta_critical_event",
    "vesta_audit_event",
)

#: Bounded, like every other store here. A busy villa might produce a few dozen
#: findings a day; 2000 is months of headroom and a hard stop against a rule
#: stuck in a loop filling /data — which on HAOS is the same filesystem Home
#: Assistant's own database lives on.
MAX_EVENTS = 2000

#: How often the buffer is flushed to disk. Events arrive in bursts and each
#: write is a full rewrite, so writing per event would be wasteful; a short
#: window bounds how much a crash can lose.
FLUSH_SECONDS = 20.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_buffer() -> Dict[str, Any]:
    """The event buffer, shaped, whatever is on disk."""
    raw = store.read_json(store.REPORTS_EVENTS_FILE, store.EMPTY_EVENTS)
    events = raw.get("events") if isinstance(raw.get("events"), list) else []
    return {
        "events": events,
        "seen_types": raw.get("seen_types") if isinstance(raw.get("seen_types"), dict) else {},
        "online_since": raw.get("online_since") or "",
        "last_seen": raw.get("last_seen") or "",
        "offline_seconds": raw.get("offline_seconds") or 0,
    }


def events_since(since_iso: str) -> List[Dict[str, Any]]:
    """Buffered events at or after `since_iso`, oldest first.

    String comparison on ISO-8601 UTC timestamps is a correct chronological
    ordering, which is why they are stored that way rather than as epochs.
    """
    buffer = read_buffer()
    return [e for e in buffer["events"]
            if isinstance(e, dict) and str(e.get("at", "")) >= since_iso]


def coverage(since_iso: str) -> Dict[str, Any]:
    """How much of the period the collector was actually listening for.

    ⚠️ THE REPORT MUST SAY THIS. A week with no findings and a week with no
    listener produce the same empty section, and they mean opposite things.
    """
    buffer = read_buffer()
    online_since = str(buffer.get("online_since") or "")
    complete = bool(online_since) and online_since <= since_iso
    return {
        "complete": complete,
        "online_since": online_since,
        "last_seen": buffer.get("last_seen", ""),
        "seen_types": buffer.get("seen_types", {}),
    }


class Collector:
    """Holds one subscription open and appends what arrives."""

    def __init__(self, session: ClientSession,
                 event_types: Sequence[str] = DEFAULT_EVENT_TYPES) -> None:
        self._session = session
        self._types = list(event_types)
        self._pending: List[Dict[str, Any]] = []
        self._last_flush = 0.0

    def _record(self, event: Dict[str, Any]) -> None:
        """Normalise one HA event into a buffer entry.

        ⚠️ THE WHOLE `data` PAYLOAD IS KEPT, deliberately. The blueprints carry
        `rule_id`, `report_bucket`, duration, kWh and cost — a schema this file
        did not design and must not second-guess by picking fields. Aggregation
        decides what matters; the collector's job is to lose nothing.
        """
        data = event.get("data")
        self._pending.append({
            "at": _now(),
            "type": str(event.get("event_type") or ""),
            "fired": str(event.get("time_fired") or ""),
            "data": data if isinstance(data, dict) else {},
        })

    def _flush(self, force: bool = False) -> None:
        loop_now = asyncio.get_event_loop().time()
        if not force and not self._pending:
            return
        if not force and (loop_now - self._last_flush) < FLUSH_SECONDS:
            return
        self._last_flush = loop_now

        try:
            buffer = read_buffer()
            events = list(buffer["events"]) + self._pending
            seen = dict(buffer["seen_types"])
            for entry in self._pending:
                name = entry["type"]
                if name:
                    seen[name] = int(seen.get(name, 0)) + 1
            store.write_json(store.REPORTS_EVENTS_FILE, {
                "events": events[-MAX_EVENTS:],
                "seen_types": seen,
                "online_since": buffer["online_since"] or _now(),
                "last_seen": _now(),
                "offline_seconds": buffer["offline_seconds"],
            })
            self._pending = []
        except Exception as err:  # noqa: BLE001 - never take the loop down
            swallow("could not flush the event buffer", err)

    def _mark_online(self) -> None:
        """Record that listening has (re)started.

        `online_since` is only set when it is absent, so a reconnection does not
        reset it and claim coverage the collector did not have.
        """
        try:
            buffer = read_buffer()
            if not buffer["online_since"]:
                store.write_json(store.REPORTS_EVENTS_FILE, {
                    "events": buffer["events"],
                    "seen_types": buffer["seen_types"],
                    "online_since": _now(),
                    "last_seen": buffer["last_seen"],
                    "offline_seconds": buffer["offline_seconds"],
                })
        except Exception as err:  # noqa: BLE001
            swallow("could not mark the collector online", err)

    async def run_once(self) -> None:
        """One connection's lifetime. Returns when the socket closes."""
        async with HassClient(self._session) as hass:
            await hass.subscribe(self._types)
            self._mark_online()
            log(f"collector subscribed to {', '.join(self._types)}")
            async for event in hass.events():
                self._record(event)
                self._flush()
        self._flush(force=True)

    async def run_forever(self, retry_seconds: float = 30.0) -> None:
        """Keep the subscription up for the life of the process.

        Reconnects on any drop. Home Assistant restarts routinely — a collector
        that exits on the first restart is a collector that works for one day.
        """
        while True:
            try:
                await self.run_once()
                warn("event subscription closed; reconnecting")
            except asyncio.CancelledError:
                self._flush(force=True)
                log("collector stopped")
                raise
            except HassUnavailable as err:
                warn(f"collector could not subscribe: {err}")
            except Exception as err:  # noqa: BLE001
                swallow("collector error", err)
            await asyncio.sleep(retry_seconds)


def blueprint_layer_present(within_days: int = 30) -> bool:
    """Has the automation layer emitted anything recently?

    ⚠️ THIS IS WHAT DECIDES WHETHER THE BUILT-IN MODULES RUN. On a property with
    a blueprint layer they would duplicate it — worse, since they cannot see
    occupancy or tariffs. On a fresh install with no blueprints they are the
    only analysis there is. Detected rather than configured, so neither
    deployment needs to be told which kind it is.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=within_days)
              ).isoformat(timespec="seconds")
    return bool(events_since(cutoff))


async def run_forever(session: ClientSession,
                      event_types: Optional[Sequence[str]] = None) -> None:
    """Entry point for the proxy's startup hook."""
    await Collector(session, event_types or DEFAULT_EVENT_TYPES).run_forever()
