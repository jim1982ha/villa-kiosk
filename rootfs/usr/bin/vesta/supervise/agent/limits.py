"""What stopped this run being complete, collected as it happens.

⚠️ THE READER IS THE ONE INSTRUMENT THAT MATTERS HERE, AND NOTHING REPORTED TO
THEM. `truncate` has always told the MODEL that a result was cut — "the whole
value" of that note, in its own words — and the person who asked the question
was told nothing at all. So an answer built on half a search, or composed after
the turn budget ran out, arrived looking exactly like a complete one. Owner's
instruction, 2026-09-18: the reader must always be able to judge how exhaustive
an answer is.

⚠️ A CONTEXTVAR, NOT AN ARGUMENT THREADED THROUGH EVERY TOOL. `truncate` is a
free function called from inside a dozen tools that neither know nor should
know about the run around them; passing a collector down to it would mean
touching every one and would be forgotten by the next tool added. A contextvar
is set once per run, is safe across concurrent runs in the same process, and is
invisible to everything that does not care.

⚠️ AND IT IS NOT LOGGING. A log line reaches an operator reading the add-on
log; this reaches the person holding the phone. The two audiences need the same
facts and different words, which is why this collects STRUCTURED notes and lets
the caller phrase them.
"""

from __future__ import annotations

import contextvars
from typing import Dict, List, Optional

#: The run's collected limitations. None outside a run, which is what makes
#: `note()` a no-op anywhere this is not wanted (a preview, a test, the MCP
#: server) rather than something that has to be disabled.
_NOTES: contextvars.ContextVar[Optional[List[Dict[str, str]]]] = \
    contextvars.ContextVar("vesta_run_limits", default=None)


class scope:
    """Collect limitations for the duration of one run.

    Re-entrant by replacement, not by nesting: an inner run gets its own list
    and the outer one is restored on exit, so a nested call cannot silently
    attribute its truncation to its parent.
    """

    def __init__(self) -> None:
        self._token: object = None

    def __enter__(self) -> "scope":
        self._token = _NOTES.set([])
        return self

    def __exit__(self, *_exc: object) -> None:
        if self._token is not None:
            _NOTES.reset(self._token)  # type: ignore[arg-type]
            self._token = None

    def collected(self) -> List[Dict[str, str]]:
        return list(_NOTES.get() or ())


def note(kind: str, detail: str = "") -> None:
    """Record one limitation. A no-op outside a `scope`.

    ⚠️ DEDUPLICATED BY (kind, detail). One broad search truncated eight times in
    a run is ONE fact for the reader; eight identical sentences would read as
    eight separate failures and bury the one that differs.
    """
    notes = _NOTES.get()
    if notes is None:
        return
    row = {"kind": str(kind), "detail": str(detail)}
    if row not in notes:
        notes.append(row)


def _phrase(row: Dict[str, str]) -> str:
    """One limitation, in the words the person who asked would use."""
    kind, detail = row.get("kind", ""), row.get("detail", "")
    if kind == "truncated":
        return ("Some of what I looked at was too long to read in full, so I "
                "answered from the part I could see" + (f" ({detail})" if detail else "")
                + ".")
    if kind == "turns":
        return ("I ran out of steps before I had finished looking"
                + (f" ({detail})" if detail else "") + ".")
    if kind == "tool_failed":
        return (f"I could not reach {detail}, so anything that depends on it is "
                "missing." if detail else
                "One of the things I check could not be reached.")
    if kind == "declined":
        return detail or "I had to stop early."
    return detail or kind


def summary(rows: Optional[List[Dict[str, str]]] = None) -> str:
    """The management message, or "" when there is nothing to report.

    ⚠️ EMPTY IS THE COMMON CASE AND MUST STAY SILENT. A bubble saying "nothing
    was limited" after every answer is noise that trains the reader to ignore
    the one that matters — the owner's instruction was explicitly that this is
    sent only when there is something to say.
    """
    # ⚠️ ONE GUARD, NOT TWO. This began with an early `if not rows: return ""`
    # as well — and a mutation deleting it SURVIVED, because the empty-lines
    # check below already covers it. A redundant guard is worse than none: it
    # is code no test can hold, and it makes the mutation that matters look
    # tested.
    lines = [ln for ln in (_phrase(r) for r in (rows or ())) if ln]
    if not lines:
        return ""
    head = "⚠️ About this answer"
    return head + "\n" + "\n".join(f"— {ln}" for ln in lines)
