"""Thin wrappers over the websocket client VESTA already holds. ADR-005.

⚠️ THIS PARAGRAPH USED TO SAY "WHY NOT `ha_mcp`: IT WOULD MEAN ADDING AN MCP
CLIENT DEPENDENCY" — AND THAT REASON IS OBSOLETE. `agent/upstream.py` consumes
`ha_mcp` over exactly such a client, and the chat registry publishes five of its
tools. The argument was answered by the code and the comment outlived it.

⚠️ THE REASON THESE TOOLS STILL EXIST IS DIFFERENT AND STILL GOOD: `ha_mcp` is a
SEPARATE ADD-ON and this one is redistributable. `upstream.tools_for` returns
`[]` when it is not installed, so a villa without it must still be able to read
a state, a history and a schedule — these are the floor, and `ha_mcp` is an
enhancement on top. They also serve what no Home Assistant tool can know: this
add-on's own concerns, briefings, salience and facility record.

⚠️ THIS PARAGRAPH USED TO ARGUE FOR A TOOL THAT THEN CAUSED THE FAILURE, AND
THE CORRECTION IS THE POINT. It read: prefer `ha_get_history(source=
"statistics")`, it answers "how much since 1pm" in ONE call and takes a `limit`
and a `period`, so the result comes back bounded. The principle is right —
shaped beats raw, and being ours is no reason to prefer ours. The example was
wrong. A tool that ACCEPTS a limit is not a tool that RETURNS a bounded result:
asked without one, on a meter reporting every minute, it returned 267 rows and
~45,000 characters, and the figure assembled from the truncated remains was
6.67 kWh against a true 3.06.

⚠️ SO THE RULE IS NARROWER NOW: prefer the tool that cannot return the wrong
shape. For a FIGURE that is `measure`, which returns one number and never a
series; the choice is no longer between two ways of handing a model rows to
add up. `registry.CHAT_UPSTREAM` says which upstream tools survive and why.

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

from vesta.shared import wallclock
from vesta.supervise.agent import clock
from vesta.shared import instants
from vesta.supervise.agent.tools.base import BaseTool
from vesta.supervise.agent.tools.base import refuse_if_oversized
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
        # ⚠️ THE VILLA'S WALL CLOCK, NOT UTC — see shared/wallclock. Home
        # Assistant hands these back in UTC and the model is given them
        # verbatim; on a UTC+8 property that is how an evening event reached
        # the owner's phone described as lunchtime.
        # ⚠️ NON-MAPPING ROWS PASS THROUGH UNTOUCHED. Rewriting the list with
        # `if isinstance(r, Mapping)` dropped every other shape on the floor —
        # `total_points` went from 1000 to 0 against a source that yields plain
        # values, and the model would have been told a complete series was
        # empty. A renderer must never be able to delete a reading.
        zone = clock.villa_zone()
        series = [{**dict(r), "at": wallclock.for_reader(r.get("at"), zone)}
                  if isinstance(r, Mapping) else r
                  for r in series]
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


#: The arithmetic the villa will do on a device's own record.
#:
#: ⚠️ PUBLISHED HERE BECAUSE A SCHEMA IS A CONTRACT WITH THE MODEL, and a
#: description that offers something the code cannot do costs exactly as much
#: as the capability being missing — measured in 2.989.0, where
#: `call_read_only_service` advertised "a statistics summary" it could not
#: produce and three of eight turns went into the dead end before the run
#: expired. `sources._REDUCTIONS` implements this set and `test_measure`
#: asserts the two agree.
MEASURE_REDUCTIONS: Tuple[str, ...] = (
    "total", "mean", "min", "max", "time_in_state", "count_changes")


class Measure(BaseTool):
    name = "measure"
    description = (
        "ONE number, worked out BY THE VILLA from a device's own record over a "
        "window. Use this for any question containing how much, how long, how "
        "many times, average, highest, lowest, or a period like 'since 5pm' or "
        "'today'. "
        "`reduce` chooses the arithmetic: total (how much was used or "
        "produced), mean / min / max (a reading that moves), time_in_state "
        "(how long it sat in one state), count_changes (how many times it "
        "changed). `since` and `until` are times at the villa. "
        "You are given the number, its unit and the window actually covered. "
        "⚠️ DO NOT ADD ANYTHING UP YOURSELF. If you find yourself summing rows "
        "from read_history or read_configuration, that is this tool's job and "
        "the sum will be wrong. One device per call — call it again for each.")
    inputSchema = {
        "type": "object",
        "properties": {
            "ref": {"type": "string", "description": "One device handle."},
            "reduce": {"type": "string", "enum": list(MEASURE_REDUCTIONS),
                       "description": "Which arithmetic the villa should do."},
            "since": {
                "type": "string",
                "description": "When the window starts, at the villa "
                               "(e.g. 2026-09-18T17:00:00+08:00)."},
            "until": {
                "type": "string",
                "description": "When it ends. Defaults to now."},
            "state": {
                "type": "string",
                "description": "Which state to time or to count, for "
                               "time_in_state and count_changes (e.g. 'on')."},
        },
        "required": ["ref", "reduce", "since"],
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
        reduce = str(args.get("reduce") or "")
        try:
            out = await resolved(self._source(
                entity_id, reduce, args.get("since"), args.get("until"),
                args.get("state")))
        except Exception as err:  # noqa: BLE001
            return [fail("unavailable", f"Home Assistant did not answer: {err}")]
        if not isinstance(out, Mapping):
            return [fail("internal", "the villa returned no measurement")]
        if out.get("error"):
            return [fail("invalid_args", str(out["error"]))]
        # ⚠️ THE LABEL TRAVELS WITH THE NUMBER. A bare figure makes the model
        # write "the total is 3.06" about whichever device it last mentioned,
        # and the reader cannot tell which one was measured.
        #
        # ⚠️ NAMED FIELDS, NEVER `**out`. The first cut splatted whatever the
        # source returned, so a source that one day carried an `entity_id`
        # alongside its number would have published one to the model —
        # `redact.audit` refuses any payload holding an id, so the whole
        # measurement would come back as "the result could not be shown
        # safely", which is how the upstream integration went dark for six
        # releases. Copying only what this tool promises fails closed.
        return [data({
            "ref": ref, "label": self._refs.label(ref),
            "value": out.get("value"), "unit": out.get("unit"),
            "reduce": out.get("reduce"), "source": out.get("source"),
            "rows": out.get("rows"), "covers": out.get("covers"),
            "note": out.get("note"),
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
        # The villa's wall clock — see shared/wallclock.
        zone = clock.villa_zone()
        return [data({
            "ref": ref, "label": self._refs.label(ref),
            "runs": [{"at": wallclock.for_reader(r.get("at"), zone),
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


class CallReadOnlyService(BaseTool):
    name = "call_read_only_service"
    description = (
        "Ask Home Assistant to WORK SOMETHING OUT and hand back the answer — a "
        "weather forecast, for example, or anything else a SERVICE computes. "
        "⚠️ NOT figures over a time period: totals, history and statistics are "
        "read_configuration's job, not a service's. Only services that cannot "
        "change the property are allowed; this can never switch, open, unlock "
        "or set anything. Call with no arguments to see what this property "
        "offers.")
    inputSchema = {
        "type": "object",
        "properties": {
            "service": {
                "type": "string",
                "description": "Domain-qualified, e.g. 'weather.get_forecasts'. "
                               "Omit to list what is available.",
            },
            "refs": {
                "type": "array", "items": {"type": "string"},
                "description": "Handles of the entities to run it against.",
            },
            "data": {
                "type": "object",
                "description": "The service's own arguments, from its schema.",
            },
        },
    }
    mode = "READ"

    def __init__(self, source: Any = None, refs: Any = None) -> None:
        self._source = source
        self._refs = refs

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        if not callable(self._source):
            return [fail("unavailable", _UNWIRED)]
        service = str(args.get("service") or "").strip()
        # ⚠️ RESOLVED FROM HANDLES, NEVER TAKEN AS IDS. A model that could pass
        # a raw entity id here would be naming devices the ref table never
        # minted, which is the one thing `refs.py` exists to prevent.
        entity_ids: List[str] = []
        for ref in (args.get("refs") or []):
            resolved_id = self._refs.resolve(str(ref)) if self._refs else None
            if not resolved_id:
                return [fail("not_found", f"no such handle: {str(ref)!r}")]
            entity_ids.append(resolved_id)
        try:
            # ⚠️ THE `data` PAYLOAD TOO, NOT ONLY THE `refs` ARRAY. A service's
            # own arguments can name an entity — and did so silently, because
            # only the explicit handle list was being resolved.
            from vesta.supervise.agent.refs import resolve_handles
            out = await resolved(self._source(
                service, entity_ids,
                resolve_handles(dict(args.get("data") or {}), self._refs)))
        except Exception as err:  # noqa: BLE001
            return [fail("unavailable", f"Home Assistant did not answer: {err}")]
        if not isinstance(out, Mapping):
            return [fail("unavailable", _UNWIRED)]
        if out.get("error"):
            return [fail(str(out.get("code") or "refused"), str(out["error"]))]

        body = _flatten_text(out.get("body"))
        if self._refs is not None:
            from vesta.supervise.agent.refs import pseudonymise
            body = pseudonymise(body, self._refs)
        return [_json_or_refuse(body, "service_result")]


def _flatten_text(value: Any) -> str:
    """A service response as text the model can read.

    ⚠️ JSON, NOT A HAND-ROLLED RENDERING. A service response is an arbitrary
    structure nobody here designed, and every prettifier written for one of
    them is a prettifier that silently drops a key from the next.
    """
    import json
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    except Exception:  # noqa: BLE001
        return str(value)




def _json_or_refuse(body: str, what: str) -> Dict[str, Any]:
    """A structured result, or a refusal — never a truncated fragment.

    ⚠️ TRUNCATED JSON IS NOT PARTIAL DATA, IT IS INVALID DATA, and handing one
    back cost the owner a false alarm about their own hardware. Measured on the
    villa: a `read_configuration` call returned ~294,000 characters, `truncate`
    cut it at 8,000 mid-structure, and the model read a zero out of the broken
    prefix and reported that the main meter had shown no consumption since 1pm
    and its wiring should be checked. The meter was fine — the property had used
    9.8 kWh. A wrong number delivered confidently is worse than no number, and
    worst of all when it sends somebody to look at a breaker.

    ⚠️ THE RULE ITSELF MOVED TO `tools/base.py` AND THAT IS THE POINT. Written
    here, it guarded our own two tools and left every upstream one truncating
    JSON — which produced the same false figure six days later through
    `ha_get_history`. This is now one of two callers of one rule.
    """
    refusal = refuse_if_oversized(body)
    return refusal if refusal is not None else data({"kind": what, "text": body})


class ReadConfiguration(BaseTool):
    name = "read_configuration"
    description = (
        "HOW THE PROPERTY IS SET UP, which is configuration rather than a "
        "reading: 'energy/get_prefs' names the meters that make up the "
        "whole-property total and which circuits are already counted inside "
        "them; also areas, floors, integrations, dashboards. Only reading is "
        "possible. "
        "⚠️ NOT FIGURES OVER TIME — a total, an average or a period is "
        "`measure`'s job, and it returns the number itself instead of rows to "
        "add up. The usual pair is this tool to learn WHICH meter, then "
        "`measure` to read it.")
    inputSchema = {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "A Home Assistant websocket read command.",
            },
            "data": {
                "type": "object",
                "description": "The command's own arguments — a time window "
                               "for a statistics query, for example.",
            },
        },
        "required": ["command"],
    }
    mode = "READ"

    def __init__(self, source: Any = None, refs: Any = None) -> None:
        self._source = source
        self._refs = refs

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        if not callable(self._source):
            return [fail("unavailable", _UNWIRED)]
        try:
            # ⚠️ HANDLES BACK TO IDS ON THE WAY OUT, AND THIS WAS THE WHOLE
            # BUG. Every other tool here resolves a ref before it calls
            # anything; this one passed `data` through untouched. So the chain
            # the model must walk was broken in the middle:
            #
            #   read_configuration("energy/get_prefs")
            #     -> the response names statistics, pseudonymised to handles
            #   read_configuration("recorder/statistics_during_period",
            #                      data={"statistic_ids": ["d12"], ...})
            #     -> Home Assistant has never heard of d12, returns nothing
            #
            # and the villa told its owner it had no access to the energy
            # statistics — about a property whose recorder answers that query
            # in milliseconds. `pseudonymise` is the inbound half; this is its
            # outbound counterpart, and without both the tool can only ask
            # questions that name nothing.
            from vesta.supervise.agent.refs import resolve_handles
            out = await resolved(self._source(
                str(args.get("command") or ""),
                resolve_handles(args.get("data") or {}, self._refs)))
        except Exception as err:  # noqa: BLE001
            return [fail("unavailable", f"Home Assistant did not answer: {err}")]
        if not isinstance(out, Mapping):
            return [fail("unavailable", _UNWIRED)]
        if out.get("error"):
            return [fail(str(out.get("code") or "refused"), str(out["error"]))]
        # ⚠️ CONFIGURATION IS THE MOST ID-DENSE PAYLOAD IN HOME ASSISTANT — the
        # Energy dashboard is nothing BUT statistic ids — so this is
        # pseudonymised before `redact` ever sees it, exactly as the upstream
        # tools are. Without it the audit refuses the whole result and the model
        # is handed nothing, which is how the integration went dark for six
        # releases once already.
        body = _flatten_text(out.get("body"))
        if self._refs is not None:
            from vesta.supervise.agent.refs import pseudonymise
            body = pseudonymise(body, self._refs)
        return [_json_or_refuse(body, "configuration")]


HA_TOOLS = (ReadState, ReadHistory, Measure, ReadAutomationTrace,
            ReadSchedule, CallReadOnlyService, ReadConfiguration)
