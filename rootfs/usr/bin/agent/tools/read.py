"""The four read tools over PH-1's observation floor. TOOL-001/002/003/005.

⚠️ THESE ARE THE ONLY THINGS VESTA SUPPLIES THAT NOTHING ELSE CAN. Home
Assistant's own MCP server already publishes state, history, traces, logs and
search, and this villa runs it — so a tool here that fetched a state would be a
second, worse implementation of something already installed. What VESTA has that
HA does not is the villa's *interpretation of itself*: the document, the
novelty ranking, the open concerns, and an honest statement of what it could not
observe.

⚠️ EVERY ONE OF THEM IS READ-ONLY AND SAYS SO IN `mode`. The registry enforces
it; no tool here is trusted to behave.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence

from agent.tools.base import BaseTool, data, fail, text, truncate
from observe import journal, salience as salience_mod, snapshot

#: ⚠️ A CEILING ON WHAT REACHES THE MODEL, NOT ON WHAT IS COMPUTED. Salience
#: ranks the whole villa; this decides how much of the ranking fits in a context
#: window. That is a BUDGET, not a judgement, and the full list stays available
#: to anything that asks for it.
DEFAULT_SALIENT_LIMIT: int = 25
MAX_SALIENT_LIMIT: int = 100
MAX_WINDOW_HOURS: int = 168


class ReadVilla(BaseTool):
    """TOOL-001. The Villa Document — profile plus the current delta."""

    name = "read_villa"
    description = (
        "The villa's own description of itself: a stable profile of the "
        "property (layout, areas, device classes, metered circuits, equipment, "
        "and what it cannot be asked about) followed by this period's delta. "
        "Start here — it is the cheapest way to know what this property is.")
    inputSchema = {
        "type": "object",
        "properties": {
            "window_hours": {
                "type": "integer", "minimum": 1, "maximum": MAX_WINDOW_HOURS,
                "description": "How far back the delta reaches. Default 24."},
        },
    }
    mode = "READ"

    def __init__(self, profile_source: Optional[Any] = None) -> None:
        # ⚠️ INJECTED, NOT IMPORTED. The registry supplies the villa's structure;
        # this tool must not reach into Home Assistant itself, or it becomes the
        # second implementation of something `ha_mcp` already publishes.
        self._profile_source = profile_source

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        hours = _window_hours(args.get("window_hours"))
        facts = self._profile_source() if callable(self._profile_source) else {}
        if not isinstance(facts, Mapping):
            facts = {}
        profile_text = snapshot.profile(**dict(facts))
        cov = journal.coverage("")
        delta_text = snapshot.delta(coverage=cov)
        document = snapshot.villa_document(profile_text=profile_text,
                                           delta_text=delta_text)
        return [text(truncate(document)),
                data({"window_hours": hours,
                      "cache_prefix_chars": len(snapshot.cache_prefix_of(document))})]


class ReadSalient(BaseTool):
    """TOOL-002. What is unusual, with the distribution it is unusual against."""

    name = "read_salient"
    description = (
        "Entities ranked by how unusual their current reading is FOR THEM, "
        "measured against their own recent distribution rather than any "
        "threshold. Every row carries its baseline, spread and sample count so "
        "you can judge the comparison rather than trust it. Unusual is not the "
        "same as wrong — a guest arriving is unusual and entirely fine.")
    inputSchema = {
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "minimum": 1,
                      "maximum": MAX_SALIENT_LIMIT,
                      "description": f"Rows to return. Default {DEFAULT_SALIENT_LIMIT}."},
            "include_unscorable": {
                "type": "boolean",
                "description": "Also list entities with too little history to "
                               "score, and why. Default false."},
        },
    }
    mode = "READ"

    def __init__(self, scorer: Optional[Any] = None) -> None:
        self._scorer = scorer

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        scored = self._scorer() if callable(self._scorer) else []
        if not isinstance(scored, Sequence):
            return [fail("unavailable", "salience produced no ranking")]
        limit = _clamp_int(args.get("limit"), DEFAULT_SALIENT_LIMIT,
                           1, MAX_SALIENT_LIMIT)
        ranked = salience_mod.rank(list(scored), limit=limit)
        rows = [item.as_dict() for item in ranked]
        blocks: List[Dict[str, Any]] = [data({"salient": rows, "limit": limit})]
        if args.get("include_unscorable"):
            # ⚠️ A FIRST-CLASS RESULT, NOT A LEFTOVER. "I could not assess 40 of
            # your devices and here is why" is the honest half of any coverage
            # claim, and the pipeline's inability to say it is what
            # `covered_but_silent` was invented to paper over.
            missing = salience_mod.unscorable(list(scored))
            blocks.append(data({"unscorable": [m.as_dict() for m in missing]}))
        return blocks


class ReadConcerns(BaseTool):
    """TOOL-003. What is already open, so the agent does not raise it twice."""

    name = "read_concerns"
    description = (
        "Concerns already open, with their age and lifecycle state. Read this "
        "BEFORE raising anything: a concern that repeats one already open "
        "should supersede it rather than arrive as news, and an owner who has "
        "dismissed something does not want it again.")
    inputSchema = {
        "type": "object",
        "properties": {
            "include_closed": {
                "type": "boolean",
                "description": "Also return recently closed and dismissed "
                               "concerns. Default false."},
        },
    }
    mode = "READ"

    def __init__(self, store: Optional[Any] = None) -> None:
        self._store = store

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        rows = self._store() if callable(self._store) else []
        if not isinstance(rows, Sequence):
            rows = []
        keep_closed = bool(args.get("include_closed"))
        out = [r for r in rows if isinstance(r, Mapping)
               and (keep_closed or str(r.get("state") or "") not in
                    ("closed", "dismissed"))]
        return [data({"concerns": out, "count": len(out)})]


class ReadCoverage(BaseTool):
    """TOOL-005. What this villa cannot be asked, and whether anyone was watching."""

    name = "read_coverage"
    description = (
        "Two different blindnesses, and both matter before you conclude "
        "anything. STRUCTURAL: what this property does not measure at all "
        "(no water meter, no per-device metering). TEMPORAL: whether the "
        "observation floor was actually listening for the window you are "
        "asking about. An absence of findings means nothing until you have "
        "read this.")
    inputSchema = {
        "type": "object",
        "properties": {
            "since": {"type": "string",
                      "description": "ISO-8601 instant the window opens at. "
                                     "Omit for the whole journal."},
        },
    }
    mode = "READ"

    def __init__(self, discovered: Optional[Any] = None) -> None:
        self._discovered = discovered

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        since = str(args.get("since") or "")
        cov = journal.coverage(since)
        found = self._discovered() if callable(self._discovered) else None
        absent = snapshot.absent_sentences(found if isinstance(found, Mapping) else None)
        return [data({
            "temporal": cov,
            "structural": absent,
            # ⚠️ SPELLED OUT RATHER THAN LEFT TO INFERENCE. A model handed
            # `complete: false` may or may not draw the right conclusion from
            # it; a sentence cannot be misread.
            "note": ("Coverage is complete for this window."
                     if cov.get("complete") else
                     "Coverage is INCOMPLETE: part of this window was not "
                     "observed, so an absence of findings is not evidence "
                     "that nothing happened."),
        })]


# ── helpers ─────────────────────────────────────────────────────────────────
def _clamp_int(value: Any, default: int, low: int, high: int) -> int:
    try:
        out = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, out))


def _window_hours(value: Any) -> int:
    return _clamp_int(value, 24, 1, MAX_WINDOW_HOURS)


#: ⚠️ THE ONE PLACE THE FOUR ARE LISTED. A tool that exists but is not here is
#: a tool the model never learns about — which fails silently and looks exactly
#: like a model choosing not to use it.
READ_TOOLS = (ReadVilla, ReadSalient, ReadConcerns, ReadCoverage)
