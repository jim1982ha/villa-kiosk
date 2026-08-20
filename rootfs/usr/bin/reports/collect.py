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
from typing import Any, Dict, List, Optional, Sequence, Tuple

from aiohttp import ClientSession

from . import store
from .hass import HassClient, HassUnavailable
from .log import log, swallow, warn

#: Fallback only — used when the installed blueprints cannot be read. See
#: `discover_event_types`, which derives the real list from the deployment.
FALLBACK_EVENT_TYPES = (
    "vesta_roi_event",
    "vesta_maintenance_event",
    "vesta_critical_event",
    "vesta_audit_event",
)

#: How a blueprint's file name maps to the event it emits. `roi_idle_load.yaml`
#: is in the `roi` category and fires `vesta_roi_event`.
EVENT_TEMPLATE = "vesta_{category}_event"

#: Bounded, like every other store here. A busy villa might produce a few dozen
#: findings a day; 2000 is months of headroom and a hard stop against a rule
#: stuck in a loop filling /data — which on HAOS is the same filesystem Home
#: Assistant's own database lives on.
MAX_EVENTS = 2000

#: How often the buffer is flushed to disk. Events arrive in bursts and each
#: write is a full rewrite, so writing per event would be wasteful; a short
#: window bounds how much a crash can lose.
FLUSH_SECONDS = 20.0

#: ⚠️ LIVENESS IS A PROPERTY OF THE PROCESS, NOT OF THE BUFFER — IN MEMORY ON
#: PURPOSE. `state()` used to answer "is the collector listening?" with
#: `bool(online_since)`, a PERSISTED field that is written once and never
#: cleared. It therefore reads `true` forever after the first successful
#: subscribe: through every reconnect, every add-on restart, and a socket that
#: died a week ago. The one question the whole diagnostic surface exists to
#: answer — is the detection layer still reaching the report? — was the one it
#: could not answer, and `silent_types` is only meaningful if the answer is yes.
#:
#: Found on 2026-08-21 by an owner asking what their collector state meant. It
#: took the add-on's supervisor log over MCP to establish that the subscription
#: was in fact healthy, which is precisely the work this field is supposed to
#: save. An instrument that has to be corroborated elsewhere is not one.
#:
#: ⚠️ RESETTING ON RESTART IS THE CORRECT BEHAVIOUR, NOT A LIMITATION. A fresh
#: process has not subscribed yet, and saying so is honest; persisting it is
#: how the old field came to lie. `online_since` stays persisted because it
#: answers a genuinely different question — how much of the reporting period
#: this villa has had ANY listener — which is a coverage claim about history.
_LIVE: Dict[str, Any] = {"connected_since": "", "drops": 0}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _categories_from_blueprints(listing: Any) -> List[str]:
    """Blueprint file names -> the event categories they emit.

    ⚠️ KEYED ON THE BLUEPRINT, NEVER ON THE AUTOMATION. An automation instance
    is named by whoever filled the form — `roi_idle_load---living_room_ac` on
    one property, something entirely different on the next — so any code that
    reads instance names is code that works on exactly one villa. The blueprint
    a rule was built from is the same file everywhere it is installed, and the
    category is the part of its name before the first underscore.

    ⚠️ THE FILTER IS DELIBERATELY LOOSE, AND THE FIRST VERSION HAD THE
    TRADE-OFF BACKWARDS. It accepted only blueprints whose metadata said
    `author: VESTA`, which on the reference villa silently dropped ALL SEVEN
    `critical_*` blueprints — the P1/P2 tier, carrying leaks, an unlocked door
    and the presence guard. They are the ones the catalog records as "already
    exist, rename + minor inputs": pre-existing files folded into the naming
    scheme, which never acquired the author field. The log line read three
    categories instead of four and nothing else complained.

    The two failure modes are not symmetric:

      a subscription that never fires   costs nothing — Home Assistant simply
                                        never sends a frame
      a subscription that is MISSING    loses every finding in that category,
                                        forever, with no error anywhere

    So local blueprints are included by their file name alone. Third-party ones
    live in a namespace directory (`homeassistant/`, `sbyx/`, `_archive/`) and
    are excluded by that, which is a structural signal rather than a metadata
    field an author may or may not have filled in. `seen_types` then records
    which subscriptions actually produce anything, so a dead one is visible
    rather than assumed.
    """
    entries: List[Any] = []
    if isinstance(listing, dict):
        for path, meta in listing.items():
            entries.append((str(path), meta))
    elif isinstance(listing, list):
        for meta in listing:
            if isinstance(meta, dict):
                entries.append((str(meta.get("path") or ""), meta))

    categories: set[str] = set()
    for path, meta in entries:
        if not path:
            continue
        metadata = meta.get("metadata") if isinstance(meta, dict) else None
        source = metadata if isinstance(metadata, dict) else (meta if isinstance(meta, dict) else {})
        author = str(source.get("author") or "")
        name = str(source.get("name") or "")
        vesta_authored = author.upper() == "VESTA" or name.upper().startswith("VESTA")

        # A namespaced path is somebody else's blueprint — unless it declares
        # itself VESTA, in which case a property is free to file them in a
        # folder of their own.
        if "/" in path and not vesta_authored:
            continue

        leaf = path.rsplit("/", 1)[-1]
        stem = leaf.rsplit(".", 1)[0]
        if "_" in stem:
            categories.add(stem.split("_", 1)[0].lower())
    return sorted(categories)


async def discover_event_types(hass: HassClient) -> Tuple[List[str], List[str]]:
    """Which `vesta_*` events THIS deployment can produce.

    ⚠️ DERIVED, NOT HARDCODED, AND THIS IS A PORTABILITY REQUIREMENT RATHER
    THAN A REFINEMENT. The first version subscribed to four names guessed from
    one villa's catalog. A property with a different blueprint set — a new
    category, a subset, a rename — would have had a collector listening for
    events nothing fires, reporting an empty week forever with no error
    anywhere. Reading the installed blueprints makes the subscription a
    function of the deployment.

    ⚠️ RETURNS THE CATEGORIES TOO, and that second value is not decoration. It
    is what tells the rest of the subsystem that this property HAS a detection
    layer — see `blueprint_layer_present`. An empty list means the fallback was
    used, so nothing may be concluded from it.
    """
    try:
        listing: Any = await hass.command("blueprint/list", domain="automation")
    except HassUnavailable as err:
        warn(f"could not list blueprints ({err}); using the fallback event list")
        return list(FALLBACK_EVENT_TYPES), []

    categories = _categories_from_blueprints(listing)
    if not categories:
        warn("no VESTA blueprints found; using the fallback event list")
        return list(FALLBACK_EVENT_TYPES), []
    return ([EVENT_TEMPLATE.format(category=c) for c in categories], categories)


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
        "blueprint_categories": raw.get("blueprint_categories") or [],
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


def state() -> Dict[str, Any]:
    """What the collector has actually seen, for diagnostics.

    ⚠️ AN INSTRUMENT WITH NO SURFACE IS NOT AN INSTRUMENT. `seen_types` and
    `blueprint_categories` were being recorded from the first release and
    exposed nowhere, so the one question they exist to answer — is the
    detection layer reaching the report? — could only be answered by reading
    the file on the host. The first person to ask it looked in the statistics
    tally instead and got `undefined`.

    Deliberately counts and names, never event payloads: those carry entity ids
    and free text, and this is a diagnostics endpoint rather than a data export.
    """
    buffer = read_buffer()
    events = buffer["events"]
    return {
        # ⚠️ THE LIVE SOCKET, NOT THE STORED HISTORY. See `_LIVE` — this was
        # `bool(online_since)`, which can never be false once set.
        "connected": bool(_LIVE["connected_since"]),
        "connected_since": _LIVE["connected_since"],
        # ⚠️ IN-MEMORY, SO IT RESETS WITH THE PROCESS, and `0` therefore means
        # "none since this add-on started" rather than "none ever". Paired with
        # `connected_since` deliberately: read together they separate a stable
        # subscription from one that is flapping, which `connected` alone
        # cannot — a socket that drops and reconnects every minute is `true`
        # every time anyone looks.
        "drops": _LIVE["drops"],
        "online_since": buffer["online_since"],
        # The last time the buffer was WRITTEN. Not the last event: a flush is
        # also forced when the socket closes, so this moves without anything
        # arriving. `last_event_at` below is the one to read for that.
        "last_flush": buffer["last_seen"],
        "buffered": len(events),
        "seen_types": buffer["seen_types"],
        "blueprint_categories": buffer["blueprint_categories"],
        # ⚠️ A subscribed type with a zero count is the interesting case: either
        # nothing of that kind has happened, or the blueprints do not emit it at
        # all. Naming them is what turned a silent, total failure of the
        # critical tier into a one-line read.
        "silent_types": sorted(
            EVENT_TEMPLATE.format(category=c)
            for c in buffer["blueprint_categories"]
            if not buffer["seen_types"].get(EVENT_TEMPLATE.format(category=c))
        ),
        "last_event_at": events[-1].get("at") if events else "",
    }


class Collector:
    """Holds one subscription open and appends what arrives."""

    def __init__(self, session: ClientSession,
                 event_types: Optional[Sequence[str]] = None) -> None:
        self._session = session
        #: None means "ask the deployment on connect" — see discover_event_types.
        self._types = list(event_types) if event_types else []
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
                # ⚠️ CARRIED FORWARD. This method rewrites the whole document,
                # so a key it forgets is a key it DELETES. Dropping this one
                # would make the built-in modules start duplicating the
                # automation layer again on the first flush after connecting —
                # a bug with a delay fuse, invisible until the first event.
                "blueprint_categories": buffer["blueprint_categories"],
            })
            self._pending = []
        except Exception as err:  # noqa: BLE001 - never take the loop down
            swallow("could not flush the event buffer", err)

    def _mark_online(self, categories: Sequence[str]) -> None:
        """Record that listening has (re)started, and what this property runs.

        `online_since` is only set when it is absent, so a reconnection does not
        reset it and claim coverage the collector did not have.

        ⚠️ THE CATEGORIES ARE RECORDED HERE BECAUSE OF A CHICKEN AND EGG. The
        built-in analysis modules stand down where a detection layer already
        covers the ground, and that used to be decided by "has an event been
        seen recently" — which is false on a freshly installed add-on until
        something happens to fire. On the reference villa that meant the modules
        duplicated the automation layer for as long as the property stayed quiet,
        which is exactly backwards: a quiet villa is when duplicate findings are
        least wanted. Blueprints being INSTALLED is the immediate signal.
        """
        try:
            buffer = read_buffer()
            known = buffer.get("blueprint_categories") or []
            store.write_json(store.REPORTS_EVENTS_FILE, {
                "events": buffer["events"],
                "seen_types": buffer["seen_types"],
                "online_since": buffer["online_since"] or _now(),
                "last_seen": buffer["last_seen"],
                "offline_seconds": buffer["offline_seconds"],
                # Never overwritten with an empty list: a pass that could not
                # reach Core must not erase what a previous one established.
                "blueprint_categories": list(categories) if categories else known,
            })
        except Exception as err:  # noqa: BLE001
            swallow("could not mark the collector online", err)

    async def run_once(self) -> None:
        """One connection's lifetime. Returns when the socket closes."""
        async with HassClient(self._session) as hass:
            categories: List[str] = []
            if not self._types:
                self._types, categories = await discover_event_types(hass)
            await hass.subscribe(self._types)
            self._mark_online(categories)
            # ⚠️ SET AFTER `subscribe`, NEVER BEFORE. An open websocket that has
            # not been subscribed receives nothing, so marking it connected on
            # connect would report a listener that is not listening — the same
            # class of over-claim as the persisted flag this replaced.
            _LIVE["connected_since"] = _now()
            log(f"collector subscribed to {', '.join(self._types)}")
            try:
                async for event in hass.events():
                    self._record(event)
                    self._flush()
            finally:
                # Cleared on ANY exit — a clean close, an error, or the
                # cancellation raised at shutdown. A `finally` rather than a
                # line after the loop, because the cancellation path never
                # reaches that line and would leave `connected: true` behind on
                # a collector that has stopped.
                _LIVE["connected_since"] = ""
        self._flush(force=True)

    async def run_forever(self, retry_seconds: float = 30.0) -> None:
        """Keep the subscription up for the life of the process.

        Reconnects on any drop. Home Assistant restarts routinely — a collector
        that exits on the first restart is a collector that works for one day.
        """
        while True:
            try:
                await self.run_once()
                _LIVE["drops"] += 1
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
    # ⚠️ INSTALLED BEATS FIRED. A property whose blueprints exist but have not
    # tripped recently still HAS a detection layer, and the built-in modules
    # would duplicate it. Waiting for an event meant a freshly installed add-on
    # duplicated the automation layer until something went wrong — worst on a
    # well-run villa, where nothing does.
    if read_buffer()["blueprint_categories"]:
        return True
    cutoff = (datetime.now(timezone.utc) - timedelta(days=within_days)
              ).isoformat(timespec="seconds")
    return bool(events_since(cutoff))


async def run_forever(session: ClientSession,
                      event_types: Optional[Sequence[str]] = None) -> None:
    """Entry point for the proxy's startup hook.

    `event_types` is normally None so the deployment decides — an operator
    override exists for a property whose blueprints use a different convention.
    """
    await Collector(session, event_types).run_forever()
