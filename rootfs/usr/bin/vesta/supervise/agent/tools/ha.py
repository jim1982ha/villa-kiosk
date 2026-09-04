"""Thin wrappers over the websocket client VESTA already holds. ADR-005.

⚠️ WHY NOT `ha_mcp`, WHICH IS INSTALLED AND PUBLISHES ALL OF THIS. Because
consuming it would mean adding an MCP CLIENT dependency to a process that
already has a working Home Assistant websocket client three modules away. That
is a real dependency, a second auth path and a second failure mode, bought to
avoid roughly a hundred and fifty lines. `ha_mcp` stays exactly as valuable as
it was — for development, and for any agent OUTSIDE this process, which is what
`agent/mcp_server.py` will serve.

⚠️ EVERY RESULT IS REF-AND-LABEL, NEVER AN ENTITY ID. That is the whole point of
`refs.py`, and the enforcement is a test that scans real tool output with an
anchored regex rather than a promise in this docstring.

⚠️ THESE TOOLS DO NOT INTERPRET. `read_state` returns what Home Assistant said;
deciding whether it is unusual is `read_salient`'s job, two modules away and
against the entity's own distribution. A wrapper that started judging would be a
threshold, and thresholds are what this redesign exists to remove.

⚠️ THEY WERE BUILT WITH NO SOURCE FOR THE WHOLE OF THEIR LIFE, AND THE VILLA
COULD NOT TELL (2026-09-04). `sources.build_tools` constructed every one of
them as `cls(refs=refs)` — the defect that module's own header describes for
`read_salient`, one line further down and never fixed — so `read_state`
answered `{"states": [], "count": 0}` and `read_automation_trace` answered
"no runs recorded" about every automation on the property. Not a refusal: a
DATA block, indistinguishable from an empty villa, published in the reason
tier's prefix on every investigating pass. `sources.ha_readers` is the wire;
an unwired tool now REFUSES like `read_logs` does and is withheld from the
model, so the failure is loud to the operator rather than quiet to the agent.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Sequence, Tuple

from vesta.shared import instants
from vesta.supervise.agent.tools.base import BaseTool
from vesta.supervise.agent.tools.base import data
from vesta.supervise.agent.tools.base import fail
from vesta.supervise.agent.tools.base import resolved

MAX_ENTITIES = 60
MAX_HISTORY_POINTS = 200


class ReadState(BaseTool):
    name = "read_state"
    description = (
        "Current state and the few meaningful attributes of one or more "
        "devices, addressed by opaque handle. Returns what Home Assistant says "
        "and nothing more — whether a reading is unusual is read_salient's "
        "question, and it answers it against the device's own history rather "
        "than any threshold.")
    inputSchema = {
        "type": "object",
        "properties": {
            "refs": {
                "type": "array", "items": {"type": "string"},
                "description": "Device handles from another tool's output."},
        },
        "required": ["refs"],
    }
    mode = "READ"

    def __init__(self, source: Any = None, refs: Any = None) -> None:
        self._source = source
        self._refs = refs

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        wanted = args.get("refs")
        if not isinstance(wanted, Sequence) or isinstance(wanted, str):
            return [fail("invalid_args", "refs must be an array of handles")]
        if len(wanted) > MAX_ENTITIES:
            return [fail("too_large",
                         f"at most {MAX_ENTITIES} handles per call; "
                         f"{len(wanted)} were given")]
        if self._refs is None:
            return [fail("internal", "no handle table for this run")]
        if not callable(self._source):
            return [fail("unavailable", _UNWIRED)]

        unknown = [str(r) for r in wanted if not self._refs.resolve(str(r))]
        if unknown:
            return [fail("not_found",
                         f"no such handle(s): {', '.join(sorted(unknown))}")]
        ids = [self._refs.resolve(str(r)) for r in wanted]
        try:
            states = await resolved(self._source(ids))
        except Exception as err:  # noqa: BLE001
            return [fail("unavailable", f"Home Assistant did not answer: {err}")]

        rows: List[Dict[str, Any]] = []
        for row in states if isinstance(states, Sequence) else []:
            if not isinstance(row, Mapping):
                continue
            entity_id = str(row.get("entity_id") or "")
            described = self._refs.describe(entity_id)
            rows.append({
                "ref": described["ref"], "label": described["label"],
                "state": row.get("state"),
                # ⚠️ THE SAME SHORT ALLOW-LIST THE JOURNAL USES, and imported
                # from it rather than restated — a second list here would drift
                # from the one materiality is decided by, and the model would be
                # reasoning about attributes the record does not keep.
                "attributes": _kept_attributes(row.get("attributes")),
            })
        return [data({"states": rows, "count": len(rows)})]


class ReadHistory(BaseTool):
    name = "read_history"
    description = (
        "How one device's value moved over a window, as a downsampled series. "
        "Use this to see a shape — a drift, a step, a flatline — not to read "
        "every point: the series is capped, and a longer window returns a "
        "coarser sample rather than more data.")
    inputSchema = {
        "type": "object",
        "properties": {
            "ref": {"type": "string", "description": "One device handle."},
            "window_hours": {
                "type": "integer", "minimum": 1, "maximum": 720,
                "description": "How far back. Default 24."},
        },
        "required": ["ref"],
    }
    mode = "READ"

    def __init__(self, source: Any = None, refs: Any = None) -> None:
        self._source = source
        self._refs = refs

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        ref = str(args.get("ref") or "")
        entity_id = self._refs.resolve(ref) if self._refs else None
        if not entity_id:
            return [fail("not_found", f"no such handle: {ref!r}")]
        if not callable(self._source):
            return [fail("unavailable", _UNWIRED)]
        hours = _clamp(args.get("window_hours"), 24, 1, 720)
        try:
            points = await resolved(self._source(entity_id, hours))
        except Exception as err:  # noqa: BLE001
            return [fail("unavailable", f"Home Assistant did not answer: {err}")]
        series = list(points) if isinstance(points, Sequence) else []
        sampled, step = _downsample(series, MAX_HISTORY_POINTS)
        return [data({
            "ref": ref, "label": self._refs.label(ref),
            "window_hours": hours, "points": sampled,
            "total_points": len(series),
            # ⚠️ SAYING IT WAS SAMPLED IS NOT OPTIONAL. A model handed 200
            # points from 4,000 without being told will read gaps as outages.
            "note": (f"Downsampled: every {step}th point of {len(series)}."
                     if step > 1 else "Complete series."),
        })]


class ReadAutomationTrace(BaseTool):
    name = "read_automation_trace"
    description = (
        "Why an automation did or did not run: its last trigger time, whether "
        "it is enabled, and the outcome of its most recent runs. This is how "
        "you tell 'the rule never fired' from 'the rule fired and did nothing' "
        "— which look identical from the outside and have opposite fixes.")
    inputSchema = {
        "type": "object",
        "properties": {
            "ref": {"type": "string",
                    "description": "An automation handle."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20,
                      "description": "How many recent runs. Default 5."},
        },
        "required": ["ref"],
    }
    mode = "READ"

    def __init__(self, source: Any = None, refs: Any = None) -> None:
        self._source = source
        self._refs = refs

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        ref = str(args.get("ref") or "")
        entity_id = self._refs.resolve(ref) if self._refs else None
        if not entity_id:
            return [fail("not_found", f"no such handle: {ref!r}")]
        if not callable(self._source):
            return [fail("unavailable", _UNWIRED)]
        limit = _clamp(args.get("limit"), 5, 1, 20)
        try:
            traces = await resolved(self._source(entity_id, limit))
        except Exception as err:  # noqa: BLE001
            return [fail("unavailable", f"Home Assistant did not answer: {err}")]
        rows = [r for r in (traces if isinstance(traces, Sequence) else [])
                if isinstance(r, Mapping)]
        return [data({
            "ref": ref, "label": self._refs.label(ref),
            "runs": [{"at": str(r.get("at") or ""),
                      "outcome": str(r.get("outcome") or ""),
                      "error": str(r.get("error") or "")} for r in rows[:limit]],
            "count": len(rows),
            "note": ("No runs recorded in the retained traces. That is not the "
                     "same as never having fired — Home Assistant keeps a "
                     "bounded number of traces per automation."
                     if not rows else ""),
        })]


class ReadSchedule(BaseTool):
    name = "read_schedule"
    description = (
        "The weekly time blocks a schedule helper is configured with — when a "
        "window opens and closes on each day. This is CONFIGURATION, which "
        "read_state cannot show: a device that 'failed to start' is judged "
        "against the moment its schedule opened, and without these blocks "
        "that moment is unknowable.")
    inputSchema = {
        "type": "object",
        "properties": {
            "ref": {"type": "string",
                    "description": "A schedule helper's handle."},
        },
        "required": ["ref"],
    }
    mode = "READ"

    def __init__(self, source: Any = None, refs: Any = None) -> None:
        self._source = source
        self._refs = refs

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        ref = str(args.get("ref") or "")
        entity_id = self._refs.resolve(ref) if self._refs else None
        if not entity_id:
            return [fail("not_found", f"no such handle: {ref!r}")]
        if not callable(self._source):
            return [fail("unavailable", _UNWIRED)]
        try:
            blocks = await resolved(self._source(entity_id))
        except Exception as err:  # noqa: BLE001
            return [fail("unavailable", f"Home Assistant did not answer: {err}")]
        # ⚠️ KEPT BY SHAPE, NOT BY TRUST. A block is a weekday and two clock
        # times, and nothing else can ever be one — so a value that is not a
        # weekday or not `HH:MM[:SS]` is dropped here, whatever the source
        # said. That is what makes this the one tool whose text fields cannot
        # carry an entity id or a person's words into the transcript by
        # construction; `test_refs`' leak sweep feeds it an id and expects
        # nothing back.
        rows = [b for b in (blocks if isinstance(blocks, Sequence) else [])
                if isinstance(b, Mapping)
                and str(b.get("day") or "") in WEEKDAYS
                and _CLOCK.match(str(b.get("from") or ""))
                and _CLOCK.match(str(b.get("to") or ""))]
        return [data({
            "ref": ref, "label": self._refs.label(ref),
            # ⚠️ ONE ROW PER BLOCK, KEYED day/from/to — never a dict keyed by
            # weekday. `redact.ALLOWED_FIELDS` is a flat allow-list of KEYS,
            # so `{"monday": [...]}` would be scrubbed to nothing on the way
            # into the transcript and the model would read an empty schedule.
            "blocks": [{"day": str(b["day"]), "from": str(b["from"]),
                        "to": str(b["to"])} for b in rows],
            "count": len(rows),
            "note": ("This helper has no time blocks configured, so nothing "
                     "is scheduled by it." if not rows else ""),
        })]


#: ⚠️ THE SHARED TUPLE, NOT A COPY: `adapters/automations.schedule_blocks`
#: is the one reader of a schedule helper's week and walks the same tuple, so
#: the tool that decides what a block is and the reader that fetches one
#: cannot disagree.
WEEKDAYS = instants.WEEKDAYS
#: A clock time as a schedule helper stores it: `07:15:00`, seconds optional.
_CLOCK = re.compile(r"^\d{2}:\d{2}(?::\d{2})?$")

#: ⚠️ THE SAME SENTENCE `read_logs` REFUSES WITH, for the same reason: an empty
#: result and "nobody connected me" are opposite facts that read alike.
_UNWIRED = ("this tool is not connected to Home Assistant, so an empty "
            "result here would mean a fault rather than a quiet villa")


# ── helpers ─────────────────────────────────────────────────────────────────
def _kept_attributes(attrs: Any) -> Dict[str, Any]:
    from vesta.supervise.observe.journal import MATERIAL_ATTRIBUTES
    if not isinstance(attrs, Mapping):
        return {}
    return {name: attrs[name] for name in MATERIAL_ATTRIBUTES if name in attrs}


def _downsample(series: Sequence[Any], limit: int) -> Tuple[List[Any], int]:
    if len(series) <= limit:
        return list(series), 1
    step = (len(series) + limit - 1) // limit
    return list(series[::step])[:limit], step


def _clamp(value: Any, default: int, low: int, high: int) -> int:
    try:
        out = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, out))


HA_TOOLS = (ReadState, ReadHistory, ReadAutomationTrace, ReadSchedule)
