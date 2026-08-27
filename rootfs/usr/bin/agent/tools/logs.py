"""read_logs — filtered server-side, capped, and paged. TOOL-006.

⚠️ THE COST MODEL IS THE DESIGN. The Messages API is stateless, so every turn
re-sends the whole conversation INCLUDING previous tool results. A naive
`read_logs` that returns the file puts those lines in the transcript once and
pays for them on every subsequent turn — ten more turns re-read the dump ten
times, which is how an agent's cost goes super-linear. The worked example in the
plan measures it: a 4,000-token log slice re-read across four turns.

⚠️ AND THE FILTERING IS FREE. It is deterministic Python running beside Home
Assistant; pulling 4,000 lines and keeping 20 costs nothing at all. What is
billed is what lands in front of the model. So the rule is: filter here, return a
window and a COUNT, and let the model ask for more if it needs it.

⚠️ THE CAP IS IN THE TOOL CONTRACT, NOT IN THE PROMPT. A prompt asking a model to
be brief is a request; a tool that cannot return more than N lines is a
guarantee. The prompt version fails exactly when the log is most interesting.

⚠️ TRUNCATION IS ALWAYS EXPLICIT. A silently cut result is a model reasoning
confidently about the half it happened to receive, and concluding something false
with every appearance of rigour.
"""

from __future__ import annotations

import inspect
from typing import Any, Dict, List, Mapping, Sequence

from agent.tools.base import BaseTool, data, fail, text, truncate

#: How many lines surround a match. Small on purpose: a log line is only useful
#: with its neighbours, and twenty is enough to see a cause and its effect
#: without becoming a dump.
DEFAULT_CONTEXT_LINES: int = 20
MAX_CONTEXT_LINES: int = 100
MAX_WINDOW_HOURS: int = 168

#: ⚠️ HOME ASSISTANT'S OWN LEVELS. Not a VESTA vocabulary — a model that knows
#: HA knows these, and inventing synonyms would mean translating in both
#: directions for no gain.
LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")


class ReadLogs(BaseTool):
    name = "read_logs"
    description = (
        "Home Assistant log lines around a moment or a subject, FILTERED "
        "server-side. Returns a small window plus how many lines matched in "
        "total, never the whole log — ask again with an offset if the window "
        "was not enough. Narrow with level and window_hours before widening "
        "context: a wide window costs you on every later turn, because tool "
        "results are re-sent with each one.")
    inputSchema = {
        "type": "object",
        "properties": {
            "subject_ref": {
                "type": "string",
                "description": "An opaque device handle from another tool, to "
                               "restrict matching to lines mentioning it."},
            "contains": {
                "type": "string",
                "description": "Free-text substring to match, case-insensitive."},
            "level": {
                "type": "string", "enum": list(LOG_LEVELS),
                "description": "Minimum severity. WARNING or above is usually "
                               "what you want."},
            "window_hours": {
                "type": "integer", "minimum": 1, "maximum": MAX_WINDOW_HOURS,
                "description": "How far back to look. Default 24."},
            "context_lines": {
                "type": "integer", "minimum": 1, "maximum": MAX_CONTEXT_LINES,
                "description": f"Lines to return. Default {DEFAULT_CONTEXT_LINES}."},
            "offset": {
                "type": "integer", "minimum": 0,
                "description": "Skip this many matches, for paging."},
        },
    }
    mode = "READ"

    def __init__(self, source: Any = None, refs: Any = None) -> None:
        #: `source(window_hours) -> Sequence[str]`. Injected so this module does
        #: not reach into Home Assistant itself — that is `tools/ha.py`'s job,
        #: and two callers of the same client is two places to fix a timeout.
        self._source = source
        self._refs = refs

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        # ⚠️ REFUSES WHEN UNWIRED. "Zero matching lines in seven days" and
        # "nobody connected me to the log" are the same answer to a reader and
        # opposite facts. See `read.py`'s ReadSalient for the measurement.
        if not callable(self._source):
            return [fail("unavailable",
                         "this tool is not connected to the villa's logs, so "
                         "an empty result here means a fault rather than a "
                         "quiet week")]
        hours = _clamp(args.get("window_hours"), 24, 1, MAX_WINDOW_HOURS)
        want = _clamp(args.get("context_lines"), DEFAULT_CONTEXT_LINES,
                      1, MAX_CONTEXT_LINES)
        offset = max(0, _clamp(args.get("offset"), 0, 0, 10_000))

        needle = str(args.get("contains") or "").strip()
        ref = str(args.get("subject_ref") or "").strip()
        if ref:
            # ⚠️ RESOLVED ON THIS SIDE. The model passes a handle; the entity id
            # it stands for is used to match and is never echoed back.
            entity_id = self._refs.resolve(ref) if self._refs else None
            if not entity_id:
                return [fail("not_found", f"no such subject handle: {ref!r}")]
            needle = entity_id if not needle else needle

        level = str(args.get("level") or "").upper()
        if level and level not in LOG_LEVELS:
            return [fail("invalid_args",
                         f"level must be one of {', '.join(LOG_LEVELS)}")]

        try:
            lines = self._source(hours)
            # ⚠️ AWAITED WHEN IT IS AWAITABLE, because reading Home Assistant's
            # log is an HTTP round trip while every earlier stand-in for this
            # source was a plain list. Testing the RESULT rather than declaring
            # the source async keeps a synchronous fixture — a list of lines —
            # a legal source, which is what the tests here use.
            if inspect.isawaitable(lines):
                lines = await lines
        except Exception as err:  # noqa: BLE001
            return [fail("unavailable", f"the log is unreadable: {err}")]
        if not isinstance(lines, Sequence):
            return [fail("unavailable", "the log did not return lines")]

        matched = [str(line) for line in lines
                   if _matches(str(line), needle, level)]
        window = matched[offset:offset + want]

        if not matched:
            # ⚠️ "NOTHING MATCHED" IS AN ANSWER AND MUST READ AS ONE. An empty
            # result is indistinguishable from a broken tool, and a model that
            # cannot tell them apart will either invent a finding or give up.
            return [data({
                "matches": 0, "returned": 0, "window_hours": hours,
                "note": ("No log lines matched. That is a real result: either "
                         "nothing was logged for this, or the filter was too "
                         "narrow. Widen window_hours or drop the level before "
                         "concluding anything."),
            })]

        # ⚠️ PSEUDONYMISED HERE, AND THIS TOOL CANNOT SKIP IT. Every other tool
        # of ours calls `RefTable.describe` and never holds an entity id in the
        # first place; a log line is written by Home Assistant and its
        # integrations, and it is FULL of them. `redact.audit` refuses any
        # payload containing one — so without this line every log answer would
        # have been replaced by "the result could not be shown safely", which is
        # precisely what happened to the upstream tools from 2.705.0 to 2.710.0
        # and cost that whole integration five releases.
        #
        # ⚠️ AFTER THE MATCHING, NEVER BEFORE IT. `_matches` compares against the
        # real entity id resolved from `subject_ref`; pseudonymising first would
        # leave the filter hunting for an id that is no longer in the text, and
        # every subject-scoped search would return nothing.
        #
        # ⚠️ AND BEFORE `truncate`, so the cap counts the characters that will
        # actually be sent. A handle is not the same length as the id it
        # replaces, so capping first would report a size nobody receives.
        body = "\n".join(window)
        if self._refs is not None:
            from agent.refs import pseudonymise
            body = pseudonymise(body, self._refs)
        more = max(0, len(matched) - (offset + len(window)))
        return [
            text(truncate(body)),
            data({
                "matches": len(matched), "returned": len(window),
                "offset": offset, "more": more, "window_hours": hours,
                "level": level or "any",
                # ⚠️ THE PAGING HANDLE IS STATED, not implied by arithmetic the
                # model has to do correctly under pressure.
                "next_offset": (offset + len(window)) if more else None,
            }),
        ]


def _matches(line: str, needle: str, level: str) -> bool:
    if needle and needle.lower() not in line.lower():
        return False
    if not level:
        return True
    # ⚠️ MINIMUM SEVERITY, NOT EQUALITY. "level=WARNING" meaning "warnings only"
    # would hide every ERROR above it, which is the opposite of what anybody
    # asking for warnings wants.
    floor = LOG_LEVELS.index(level)
    return any(name in line for name in LOG_LEVELS[floor:])


def _clamp(value: Any, default: int, low: int, high: int) -> int:
    try:
        out = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, out))


LOG_TOOLS = (ReadLogs,)
