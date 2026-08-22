"""The observation cycle: journal, score, assemble — on a cadence, in the loop.

⚠️ NO NEW PROCESS AND NO NEW s6 SERVICE. The scheduler and the collector already
live in the proxy's event loop; a third supervised service would be a third thing
to start, stop, watch and misconfigure, and would buy nothing that
`asyncio.create_task` does not. `run_forever` follows `collect.run_forever`'s
shape exactly — reconnect on drop, swallow on error, re-raise on cancel — so
there is one pattern in this process rather than two.

⚠️ IT POLLS, AND THE REQUIREMENT SAYS IT MAY. `REQ-001`'s acceptance is "a change
made in HA appears within ONE CYCLE", which is poll semantics stated as an
acceptance criterion. The alternative — a second websocket subscribed to
`state_changed` — is a second connection to keep alive and a second thing to
reconcile against `collect.py`, which PH-5 rewrites anyway.

⚠️ SO STATE THE COST HONESTLY: a value that changes and changes back INSIDE one
cadence is invisible to this journal. For the questions this tier exists to
answer — what is unusual for this entity, what stopped reporting, what drifted
— that loss is acceptable, because all three are about levels sustained over
hours. It would NOT be acceptable for anything counting transitions (a
short-cycling pump), and a check of that shape must read Home Assistant's own
history rather than this journal. Written down because the limitation is
invisible at the call site and would otherwise be discovered as a wrong answer.

⚠️ AND THE CADENCE IS CONFIG, NEVER A LITERAL. A villa with a slow HA instance
and one with 3,000 entities want different numbers, and a number compiled into
the image is a per-property constant by another name — the exact defect the
whole redesign exists to remove.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Mapping, Optional, Sequence

from aiohttp import ClientSession

from observe import journal, salience as salience_mod
from reports import store
from reports.hass import HassClient, HassUnavailable
from reports.log import log, swallow, warn

#: Config key and default. The default is the plan's stated triage cadence, so
#: the observation floor and the tier that reads it stay in step; an operator
#: who halves one and not the other gets a document describing a window nobody
#: is looking at.
CADENCE_KEY = "observe_cycle_minutes"
CADENCE_DEFAULT_MINUTES = 15

#: ⚠️ A FLOOR ON THE CADENCE, NOT ON THE VILLA. Below a minute this stops being
#: an observation cycle and becomes a busy loop against Home Assistant's own
#: API — the failure is to the HA instance, not to this add-on, which is
#: exactly the kind of damage a config typo should not be able to do.
CADENCE_MIN_MINUTES = 1

_LAST: Dict[str, Any] = {}


def cadence_minutes(config: Optional[Mapping[str, Any]] = None) -> float:
    """Cycle period in minutes, from config, clamped to something sane."""
    raw: Any = CADENCE_DEFAULT_MINUTES
    if isinstance(config, Mapping) and config.get(CADENCE_KEY) is not None:
        raw = config.get(CADENCE_KEY)
    try:
        minutes = float(raw)
    except (TypeError, ValueError):
        return float(CADENCE_DEFAULT_MINUTES)
    if minutes != minutes:
        # ⚠️ NaN IS JUNK, NOT A SMALL NUMBER. Folding it into the clamp below
        # turned an unusable value into the FASTEST possible cadence — the one
        # outcome a bad config must never produce.
        return float(CADENCE_DEFAULT_MINUTES)
    if minutes < CADENCE_MIN_MINUTES:
        return float(CADENCE_MIN_MINUTES)
    return minutes


def _as_event(entity_id: str, before: Optional[Mapping[str, Any]],
              after: Mapping[str, Any], now_iso: str) -> Dict[str, Any]:
    """One poll difference, in Home Assistant's own `state_changed` shape.

    ⚠️ THE JOURNAL'S SHAPE IS HA'S SHAPE, DELIBERATELY. Inventing a second
    event format here would mean the journal could never be fed from a real
    subscription later without a translation layer — and the day that layer
    exists is the day the two shapes drift.
    """
    return {"event_type": "state_changed",
            "time_fired": str(after.get("last_changed") or now_iso),
            "data": {"entity_id": entity_id,
                     "old_state": dict(before) if before else None,
                     "new_state": dict(after)}}


def diff_states(previous: Mapping[str, Mapping[str, Any]],
                current: Mapping[str, Mapping[str, Any]],
                now_iso: str = "") -> List[Dict[str, Any]]:
    """Synthetic `state_changed` events for everything that moved.

    ⚠️ A DISAPPEARED ENTITY YIELDS AN EVENT TOO. An entity removed from the
    registry is a fact about the villa, and `journal.is_material` already treats
    `new_state=None` as material — so the removal is recorded rather than
    silently ceasing to appear.

    ⚠️ ON THE FIRST CYCLE `previous` IS EMPTY AND EVERY ENTITY LOOKS NEW. That
    is correct and it is not noise: the journal genuinely has no record of any
    of them, and one baseline row per entity is what makes the second cycle's
    diff meaningful. It costs one full sweep, once, per process start.
    """
    events: List[Dict[str, Any]] = []
    for entity_id, after in current.items():
        before = previous.get(entity_id)
        if before is None or before.get("state") != after.get("state") \
                or before.get("attributes") != after.get("attributes"):
            events.append(_as_event(entity_id, before, after, now_iso))
    for entity_id, before in previous.items():
        if entity_id not in current:
            events.append({"event_type": "state_changed",
                           "time_fired": now_iso,
                           "data": {"entity_id": entity_id,
                                    "old_state": dict(before),
                                    "new_state": None}})
    return events


def _index(states: Sequence[Mapping[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """`entity_id -> {state, attributes}`, keeping only what materiality reads.

    ⚠️ TRIMMED ON THE WAY IN, because this dict is held in memory between
    cycles for every entity in the villa. Home Assistant's own state objects
    carry context ids, timestamps and full attribute blocks; retaining all of
    that for 1,250 entities to answer "did the state change" is a leak with a
    respectable name.
    """
    out: Dict[str, Dict[str, Any]] = {}
    for row in states:
        if not isinstance(row, Mapping):
            continue
        entity_id = str(row.get("entity_id") or "")
        if not entity_id:
            continue
        attrs = row.get("attributes")
        kept = {name: attrs.get(name)
                for name in journal.MATERIAL_ATTRIBUTES
                if isinstance(attrs, Mapping) and name in attrs}
        out[entity_id] = {"state": row.get("state"),
                          "attributes": kept,
                          "last_changed": row.get("last_changed")}
    return out


async def run_once(session: ClientSession, *, now_iso: str = "") -> Dict[str, Any]:
    """One cycle. Returns the counts the log line prints.

    ⚠️ RETURNS RATHER THAN LOGS, so the cycle is testable without capturing
    stdout and so `run_forever` owns the single log line. `log.py` is the one
    entry point for this subsystem's output and a module that printed its own
    would be the second.
    """
    counts: Dict[str, Any] = {"entities": 0, "changed": 0, "journalled": 0,
                              "salient": 0, "unscorable": 0}
    async with HassClient(session) as hass:
        raw = await hass.command("get_states")
    states = raw if isinstance(raw, list) else []
    current = _index(states)
    counts["entities"] = len(current)

    previous = _LAST.get("states") or {}
    events = diff_states(previous, current, now_iso)
    counts["changed"] = len(events)
    counts["journalled"] = journal.append(events, now_iso=now_iso)
    _LAST["states"] = current
    return counts


async def run_forever(session: ClientSession,
                      config: Optional[Mapping[str, Any]] = None) -> None:
    """Entry point for the proxy's startup hook.

    ⚠️ THE CADENCE IS RE-READ EVERY CYCLE, not captured once. An operator who
    changes it should not have to restart the add-on to see the change, and
    re-reading a small JSON file every fifteen minutes costs nothing measurable.

    ⚠️ CANCELLATION RE-RAISES. aiohttp's shutdown cancels this task and waits
    for it; swallowing `CancelledError` here would hold the whole shutdown open
    until the timeout, which is the same trap `collect.run_forever` documents.
    """
    log("observation cycle started")
    while True:
        settings = config
        if settings is None:
            settings = store.config_view(
                store.read_json(store.REPORTS_CONFIG_FILE, {}))
        minutes = cadence_minutes(settings)
        try:
            counts = await run_once(session)
            log(f"observed {counts['entities']} entities, "
                f"{counts['changed']} changed, "
                f"{counts['journalled']} journalled")
        except asyncio.CancelledError:
            log("observation cycle stopped")
            raise
        except HassUnavailable as err:
            warn(f"observation cycle could not reach Home Assistant: {err}")
        except Exception as err:  # noqa: BLE001 - degrade, never fail
            swallow("observation cycle error", err)
        await asyncio.sleep(minutes * 60.0)
