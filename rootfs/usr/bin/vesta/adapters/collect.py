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
from typing import (Any, Awaitable, Callable, Dict, List, Mapping, Optional, Sequence,
                    Tuple)

from aiohttp import ClientSession

from vesta.shared import instants
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


def _stems_from_blueprints(listing: Any) -> List[str]:
    """Blueprint file names -> their stems (`maintenance_silence.yaml` -> that).

    ⚠️ THE STEM IS KEPT NOW, AND IT USED TO BE THROWN AWAY. This function
    returned only the CATEGORY (`maintenance`), which is too coarse to answer
    the question that matters: a built-in check stands down because the
    property's own automations cover its ground, and "the maintenance category
    is alive" says nothing about whether the ONE blueprint that covers it has
    ever fired. On the reference villa the maintenance category was busy —
    three pump findings in a single brief — while `maintenance_silence` had
    `last_triggered: null` on all four of its instances, and the brief reported
    "your own automations already cover this" about a rule that had never
    reported anything in its life.

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

    stems: set[str] = set()
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
        stem = leaf.rsplit(".", 1)[0].lower()
        if "_" in stem:
            stems.add(stem)
    return sorted(stems)


def category_of(stem: str) -> str:
    """`maintenance_silence` -> `maintenance`. One expression, three readers."""
    return stem.split("_", 1)[0].lower()


def _categories_from_blueprints(listing: Any) -> List[str]:
    """The event categories this deployment's blueprints emit."""
    return sorted({category_of(s) for s in _stems_from_blueprints(listing)})


async def discover_event_types(hass: HassClient) -> Tuple[List[str], List[str]]:
    """Which `vesta_*` events THIS deployment can produce.

    ⚠️ DERIVED, NOT HARDCODED, AND THIS IS A PORTABILITY REQUIREMENT RATHER
    THAN A REFINEMENT. The first version subscribed to four names guessed from
    one villa's catalog. A property with a different blueprint set — a new
    category, a subset, a rename — would have had a collector listening for
    events nothing fires, reporting an empty week forever with no error
    anywhere. Reading the installed blueprints makes the subscription a
    function of the deployment.

    ⚠️ RETURNS THE INSTALLED BLUEPRINTS TOO, and that second value is not
    decoration: it is what the Briefings tab lists this villa's reflex families
    from, and, per blueprint, which event types each emits. (It also fed
    `blueprint_layer_present`, deleted 2026-08-28 — that predicate read this
    list as "does this property have a detection layer", which a cumulative
    record cannot answer once a family is retired.)
    An empty list means the fallback was used, so nothing may be concluded
    from it.
    """
    try:
        listing: Any = await hass.command("blueprint/list", domain="automation")
    except HassUnavailable as err:
        warn(f"could not list blueprints ({err}); using the fallback event list")
        return _with_chat(FALLBACK_EVENT_TYPES), []

    stems = _stems_from_blueprints(listing)
    if not stems:
        warn("no VESTA blueprints found; using the fallback event list")
        return _with_chat(FALLBACK_EVENT_TYPES), []
    categories = sorted({category_of(s) for s in stems})
    return (_with_chat([EVENT_TEMPLATE.format(category=c) for c in categories]),
            stems)


#: ⚠️ ADDED TO EVERY SUBSCRIPTION, INCLUDING THE FALLBACK ONE, AND THAT IS THE
#: POINT. The blueprint event names are DERIVED from what is installed; the chat
#: event is not derived from anything, because a property with no VESTA
#: blueprints at all must still be able to answer a question. Deriving it would
#: make the conversation depend on a detection layer it has nothing to do with.
#:
#: ⚠️ AND IT RIDES THIS CONNECTION RATHER THAN OPENING ANYTHING. One more event
#: type on a websocket already held: no webhook, no public URL, no inbound
#: firewall hole. It is low-volume by nature — a person typing — so it cannot
#: put the loop behind the villa's own state traffic.
#: ⚠️ AND THE BUTTON PRESS RIDES IT TOO (2026-08-28). `telegram_callback` is the
#: same argument one step further: a press is a person acting, so it is
#: low-volume by nature, and putting it on this socket is what let button
#: HANDLING move into the add-on. The retired blueprint had to wait for its own
#: press inside a `wait_for_trigger`, so its buttons expired with the
#: automation's timeout and a restart lost the wait entirely.
CHAT_EVENT_TYPES = ("telegram_text", "telegram_callback")

#: Home Assistant's OWN event, fired for every automation that runs — no
#: blueprint change, no re-import, and it covers automations the owner writes
#: later (2026-08-30). This is what made the record possible without touching
#: anything in their Home Assistant.
AUTOMATION_EVENT = "automation_triggered"

#: The rich half: the blueprints never stopped emitting these — VESTA stopped
#: listening at TASK-074. Their payload carries the figures a briefing wants
#: (kwh, cost_local, wasted_minutes, rule_id, report_bucket).
VESTA_EVENT_TYPES = ("vesta_roi_event", "vesta_maintenance_event",
                     "vesta_audit_event", "vesta_critical_event")

#: How long a rich event may arrive after the firing it enriches. The blueprint
#: emits its event as an ACTION, so `automation_triggered` always lands first;
#: seconds is generous for a local websocket.
ENRICH_WINDOW_SECONDS = 30


def _with_chat(types: Sequence[str]) -> List[str]:
    """The derived list plus chat, automation firings and the rich events.

    ⚠️ THE `vesta_*` SUBSCRIPTION IS BACK, AND IT IS A DELIBERATE REVERSAL
    (2026-08-30, the owner's ruling). TASK-074 dropped it because every
    producer had been retired — true of the SHIPPED set, and it silently
    assumed the owner would never re-enable the archived ones. They do exactly
    that when Supervision is OFF, which is the supported way to run: the
    automations alert a phone and now also fill the record. Paired with
    `automation_triggered`, which needs no blueprint at all, the record is
    filled the same way whichever position the switch is in.
    """
    out = list(types)
    for name in (AUTOMATION_EVENT,) + VESTA_EVENT_TYPES:
        if name not in out:
            out.append(name)
    for name in CHAT_EVENT_TYPES:
        if name not in out:
            out.append(name)
    return out


def read_buffer() -> Dict[str, Any]:
    """The event buffer, shaped, whatever is on disk."""
    raw = store.read_json(store.REPORTS_EVENTS_FILE, store.EMPTY_EVENTS)
    events = raw.get("events") if isinstance(raw.get("events"), list) else []
    return {
        "events": events,
        "seen_types": raw.get("seen_types") if isinstance(raw.get("seen_types"), dict) else {},
        # Which BLUEPRINTS have produced an event, by stem, cumulative. Same
        # shape and same purpose as `seen_types` one level finer — see
        # `_stems_from_blueprints` for why the coarser one was not enough.
        "online_since": raw.get("online_since") or "",
        "last_seen": raw.get("last_seen") or "",
        "offline_seconds": raw.get("offline_seconds") or 0,
        "blueprint_categories": raw.get("blueprint_categories") or [],
        #: Installed VESTA blueprints, by stem. ⚠️ ABSENT ON A STORE WRITTEN
        #: BEFORE 2.568.0, and that is why every reader of it must treat an
        #: empty list as "not known" rather than as "none installed": the
        #: latter would claim every covering blueprint is silent on the first
        #: pass after an upgrade, which is a false alarm about a real check.
        "blueprint_names": raw.get("blueprint_names") or [],
    }


def as_utc_iso(value: str) -> str:
    """Any ISO-8601 instant, re-expressed in UTC.

    ⚠️ THE ONE LINE THAT MAKES STRING COMPARISON LEGAL. Ordering ISO strings
    lexicographically is only chronological when both sides carry the SAME
    offset, and `_now()` stamps every stored event in UTC while a caller
    naturally builds a window from the villa's LOCAL wall clock.

    A naive value is read as UTC rather than rejected: a report must not fail
    to be delivered over a timestamp, and every producer in this package is
    tz-aware, so a naive one can only arrive from stored config an operator
    typed.

    ⚠️ PUBLIC BECAUSE IT HAS A SECOND CALLER, AND FINDING THAT CALLER FOUND A
    BUG. `pipeline` splits events into before/inside the reporting window by
    comparing `Item.when` against the window start, and `when` is a MIXED-OFFSET
    field: a blueprint's own `now().isoformat()` where it supplied one, and the
    collector's UTC stamp where it did not. Comparing those as raw strings is
    2.528.0 exactly, one field along.

    ⚠️ THE BODY MOVED TO `shared.instants` (2026-08-30) AND THE DOCSTRING STAYED.
    Two more readers needed this exact conversion — `record.since` and
    `journal.since` — and one of them shipped the bug this function was written
    to prevent. The name and the reasoning above are the record of WHY; the
    implementation is now shared so a fourth reader cannot get it wrong.
    """
    return instants.as_utc_iso(value)


def coverage(since_iso: str) -> Dict[str, Any]:
    """How much of the period the collector was actually listening for.

    ⚠️ THE REPORT MUST SAY THIS. A week with no findings and a week with no
    listener produce the same empty section, and they mean opposite things.
    """
    buffer = read_buffer()
    online_since = str(buffer.get("online_since") or "")
    # ⚠️ NORMALISED TO UTC (the treatment `events_since` shared before it
    # was deleted, 2026-08-29) — this
    # compares a UTC `online_since` against a caller's local window and would
    # otherwise claim full coverage of a period the collector missed the start
    # of, or deny coverage it had.
    complete = bool(online_since) and online_since <= as_utc_iso(since_iso)
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
        # ⚠️ `silent_types` WAS DELETED, NOT EMPTIED (2026-08-28). It named every
        # `vesta_<category>_event` with a zero count, and its value was that a
        # subscribed type reading zero separates "nothing of that kind happened"
        # from "the blueprints do not emit it" — which once turned a silent, total
        # failure of the critical tier into a one-line read.
        #
        # THE WORD THAT MATTERED WAS *SUBSCRIBED*, AND TASK-074 REMOVED IT. This
        # socket carries the chat types only; nothing under `vesta_*` is listened
        # for at all, so every category was guaranteed to read zero forever and the
        # line could no longer separate anything. It reached a screen as "Nothing
        # has arrived from vesta_control_event, vesta_vesta_event in this window",
        # where the second name is not even a real event — it is the `vesta` stem of
        # `vesta_task_actions` run through the template. An instrument whose
        # question closed does not stay neutral; it rots until somebody reads it as
        # meaning something.
        # ⚠️ THE SAME QUESTION ONE LEVEL FINER THAN THE CATEGORY, AND THE
        # COARSE ONE ANSWERED IT WRONG. A category is alive as soon as ANY of
        # its blueprints fires, so `maintenance` read healthy on the reference
        # villa — three pump findings in one brief — while `maintenance_silence`
        # had never fired at all. The built-in check that stands down for that
        # blueprint was reported as "covered", and the devices it covers went
        # unmentioned in every brief. This is what `registry.gate` reads to stop
        # claiming coverage it cannot demonstrate.
        "blueprint_names": buffer["blueprint_names"],
        # ⚠️ THE COLLECTOR'S OWN CLOCK, AND NOT THE VILLA'S. It is the last
        # event on THIS subscription — chat only, since TASK-074 — so it says
        # when somebody last typed to the bot, never when a device last moved.
        # The Observe tab reported it as "last change seen" until 2026-08-28;
        # `journal.last_seen` is the field that answers that.
        "last_event_at": events[-1].get("at") if events else "",
    }


def _to_record(event: Dict[str, Any]) -> None:
    """Write an automation firing into the RECORD. Never raises.

    ⚠️ THE MERGE, AND ITS JOIN IS DERIVED FROM THE DATA. One firing can arrive
    twice: `automation_triggered` (thin — time, automation, entity) and then the
    blueprint's own `vesta_*` event (rich — kwh, cost, duration, rule_id). The
    join is that the automation's NAME starts with the blueprint's STEM
    (`roi_idle_load---living_room_ac` ← `blueprint: roi_idle_load`), so the rich
    event UPGRADES the thin entry it belongs to rather than adding a second row.

    ⚠️ AN UNMATCHED EVENT ON EITHER SIDE STILL LANDS. A rich event whose
    automation was renamed, or a firing whose blueprint sends nothing, must
    appear — dropping one to keep the ledger tidy is how a briefing goes quiet
    about something that happened.
    """
    from vesta.adapters import record as record_mod
    kind = str(event.get("event_type") or "")
    raw = event.get("data")
    data: Dict[str, Any] = raw if isinstance(raw, dict) else {}
    try:
        if kind == AUTOMATION_EVENT:
            name = str(data.get("name") or "")
            record_mod.append({
                "source": "automation", "fidelity": "thin",
                "subject": name or str(data.get("entity_id") or ""),
                "title": name or "an automation ran",
                "detail": "", "severity": "notice",
                "payload": {"entity_id": str(data.get("entity_id") or "")},
            })
        elif kind in VESTA_EVENT_TYPES:
            stem = str(data.get("blueprint") or "")
            if not _enrich_latest(record_mod, stem, data):
                record_mod.append({
                    "source": "automation", "fidelity": "rich",
                    "subject": str(data.get("report_bucket")
                                   or data.get("rule_id") or stem),
                    "title": stem or kind,
                    "detail": _figures(data), "severity": "notice",
                    "payload": dict(data),
                })
    except Exception as err:  # noqa: BLE001 - the record may never break the socket
        swallow("could not record an automation event", err)


def _figures(data: Mapping[str, Any]) -> str:
    """The blueprint's own numbers, as one readable clause."""
    bits = []
    if data.get("wasted_minutes"):
        bits.append(f"{data['wasted_minutes']} min")
    if data.get("kwh"):
        bits.append(f"{data['kwh']} kWh")
    if data.get("cost_local"):
        # ⚠️ "about", NEVER "~". The tilde is markup-active, so `style.inert`
        # rewrites it on the way out and "~510" reached the draft as "-510" —
        # an approximation rendered as NEGATIVE money. Caught by reading the
        # composed text rather than the code.
        bits.append(f"about {data['cost_local']}")
    if data.get("basis"):
        bits.append(str(data["basis"]))
    return " · ".join(str(b) for b in bits)


def _enrich_latest(record_mod: Any, stem: str, data: Mapping[str, Any]) -> bool:
    """Upgrade the newest thin entry this rich event belongs to."""
    if not stem:
        return False
    from datetime import datetime, timezone
    entries = record_mod.read()
    now = datetime.now(timezone.utc)
    for row in reversed(entries[-200:]):
        if str(row.get("fidelity") or "") != "thin":
            continue
        if not str(row.get("subject") or "").startswith(stem):
            continue
        # ⚠️ THROUGH THE SHARED OWNER (2026-08-30). This parsed the stamp
        # itself, which is the same rule `as_utc_iso` above exists to hold —
        # and it silently skipped a NAIVE stamp where the owner reads one as
        # UTC, so an enrichment could be dropped rather than merged.
        at = instants.as_utc(row.get("at"))
        if at is None:
            continue
        if (now - at).total_seconds() > ENRICH_WINDOW_SECONDS:
            break
        row["fidelity"] = "rich"
        row["detail"] = _figures(data)
        row["payload"] = dict(data)
        row["subject"] = str(data.get("report_bucket")
                             or data.get("rule_id") or row.get("subject"))
        store.write_json(store.RECORD_FILE, {"entries": entries})
        return True
    return False


class Collector:
    """Holds one subscription open and appends what arrives."""

    def __init__(self, session: ClientSession,
                 event_types: Optional[Sequence[str]] = None,
                 on_event: Optional["Callable[[Dict[str, Any]], Awaitable[None]]"] = None) -> None:
        self._session = session
        # ⚠️ A CALLBACK RATHER THAN AN IMPORT, AND THE DIRECTION IS THE POINT.
        # `reports/` must not import `agent/`: the collector predates the agent,
        # runs on a villa where the agent is switched off, and is the honest
        # observation floor underneath it. Handing the dispatch in from the
        # proxy keeps this file free of any knowledge that a conversation
        # exists — it records events, as it always has.
        self._on_event = on_event
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
        _to_record(event)


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
                # so a key it forgets is a key it DELETES. Dropping either of
                # these would make the built-in modules start duplicating the
                # automation layer again on the first flush after connecting —
                # a bug with a delay fuse, invisible until the first event.
                "blueprint_categories": buffer["blueprint_categories"],
                "blueprint_names": buffer["blueprint_names"],
            })
            self._pending = []
        except Exception as err:  # noqa: BLE001 - never take the loop down
            swallow("could not flush the event buffer", err)

    def _mark_online(self, stems: Sequence[str]) -> None:
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
            known_names = buffer.get("blueprint_names") or []
            known_categories = buffer.get("blueprint_categories") or []
            names = list(stems) if stems else known_names
            categories = (sorted({category_of(s) for s in stems}) if stems
                          else known_categories)
            store.write_json(store.REPORTS_EVENTS_FILE, {
                "events": buffer["events"],
                "seen_types": buffer["seen_types"],
                "online_since": buffer["online_since"] or _now(),
                "last_seen": buffer["last_seen"],
                "offline_seconds": buffer["offline_seconds"],
                # Never overwritten with an empty list: a pass that could not
                # reach Core must not erase what a previous one established.
                "blueprint_categories": categories,
                "blueprint_names": names,
            })
        except Exception as err:  # noqa: BLE001
            swallow("could not mark the collector online", err)

    async def run_once(self) -> None:
        """One connection's lifetime. Returns when the socket closes.

        ⚠️ THE `vesta_*` SUBSCRIPTION IS GONE (TASK-074, 2026-08-27). Every
        producer was retired with the blueprint cutover — the critical_*
        reflexes and the channel-test canary stopped emitting on the same day,
        verified by reading the live blueprints back — so a derived event list
        is a list of names nothing fires. What remains on this socket are the
        CHAT events — a typed message and a button press — which were never
        derived from anything (see CHAT_EVENT_TYPES), plus whatever a caller
        passes explicitly.
        `discover_event_types` survives for discovery's blueprint inventory;
        the SUBSCRIPTION no longer consults it."""
        async with HassClient(self._session) as hass:
            if not self._types:
                self._types = _with_chat([])
            await hass.subscribe(self._types)
            # ⚠️ STILL CALLED, WITH NO STEMS — `online_since` lives in there and
            # TASK-074's own constraint is that coverage semantics stay exact.
            # An empty stems list preserves whatever blueprint inventory a
            # previous pass recorded rather than erasing it.
            self._mark_online([])
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
                    await self._dispatch(event)
            finally:
                # Cleared on ANY exit — a clean close, an error, or the
                # cancellation raised at shutdown. A `finally` rather than a
                # line after the loop, because the cancellation path never
                # reaches that line and would leave `connected: true` behind on
                # a collector that has stopped.
                _LIVE["connected_since"] = ""
        self._flush(force=True)

    async def _dispatch(self, event: Dict[str, Any]) -> None:
        """Hand the event to the optional consumer. ⚠️ NEVER RAISES INTO THE
        LOOP. A consumer that throws must not close the subscription — the
        collector's whole contract is that it keeps recording, and an agent
        failure taking the observation floor down with it inverts the
        dependency this design puts them in."""
        if self._on_event is None:
            return
        try:
            await self._on_event(event)
        except Exception as err:  # noqa: BLE001 - degrade, never fail
            swallow("event consumer failed", err)

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


def connected_seconds() -> float:
    """Unix seconds when the LIVE subscription was established, or 0.

    ⚠️ THE LIVE SOCKET, NEVER `online_since`. That value is PERSISTED and reads
    true forever after the first connect — the exact lie `connected` was added
    to replace. The chat backlog guard asks "how long has this connection been
    up", and a persisted answer would say "months" one second after a restart,
    which is precisely when a replayed backlog arrives.
    """
    stamp = str(_LIVE["connected_since"] or "")
    if not stamp:
        return 0.0
    # ⚠️ THE `Z` WORKAROUND WENT WITH IT (2026-08-30). `fromisoformat` refused a
    # trailing `Z` before Python 3.11 and this carried a `.replace()` for it;
    # the shared owner handles the whole grammar, so the special case is gone
    # rather than duplicated a fourth time.
    started = instants.as_utc(stamp)
    return 0.0 if started is None else started.timestamp()


# ⚠️ `blueprint_layer_present()` WAS DELETED HERE (2026-08-28). It answered "has
# the automation layer emitted anything recently", and its docstring said it "is
# what decides whether the built-in modules run" — TRUE when written and false
# from 2.755.0, when the owner's ruling made `supervision_enabled` the only
# input to that decision. After that it kept exactly one consumer: a sentence on
# the "What is watched" tab, which it made inverted.
#
# ⚠️ AND ITS "INSTALLED BEATS FIRED" RULE IS WHY IT COULD NOT SIMPLY BE LEFT. It
# returned True whenever `blueprint_categories` was non-empty — a PERSISTED,
# CUMULATIVE list — so on the reference villa it still reported `maintenance`
# and `roi` weeks after both were retired, and no passage of time could clear
# it. A value that can only ever say yes is the `online_since` lie again.


async def run_forever(session: ClientSession,
                      event_types: Optional[Sequence[str]] = None,
                      on_event: Optional["Callable[[Dict[str, Any]], Awaitable[None]]"] = None
                      ) -> None:
    """Entry point for the proxy's startup hook.

    `event_types` is normally None so the deployment decides — an operator
    override exists for a property whose blueprints use a different convention.
    """
    await Collector(session, event_types, on_event).run_forever()
