"""The evidence rule, enforced. ARCH-006, TASK-042.

⚠️ ENFORCEMENT IN CODE BEATS ASKING THE MODEL NICELY, AND THE REASON IS NOT
DISTRUST. A model that invents a figure does so fluently, in a sentence shaped
exactly like a sourced one, and a reader has no way to tell them apart. The
prompt asks; this checks. Both, or the asking is the whole defence.

⚠️ A STRIP IS COUNTED, ALWAYS. An enforcement that silently removed numbers
would be the fifth instrument in this codebase reporting zero for the case it
exists to measure. If this fires often, that is a finding about the prompt, and
the count is how anybody would ever know.

⚠️ AND IT STRIPS THE FIGURE, NOT THE SENTENCE. Deleting the whole line would
lose the finding along with the number — "the pump is short-cycling" is worth
saying even if the model could not source "14 times". The figure is replaced by
a marker that says a figure was removed, so the reader sees a gap rather than a
fluent half-truth.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Sequence

#: What counts as a figure. ⚠️ NOT EVERY NUMBER: a year, a time of day and an
#: ordinal are not claims about measurement, and stripping them would mangle
#: "since 2 August" and "the third occurrence" into nonsense. A figure is a
#: number carrying a UNIT, or a bare number large enough to be a reading.
#: ⚠️ A READING IS CITED; A COUNT IS DERIVED, AND CONFLATING THEM BROKE BOTH
#: DIRECTIONS OF THIS RULE. A reading — 340 W, 22.5 °C — is a value the villa
#: MEASURED, and demanding it appear in an evidence row is exactly right: a
#: model that read 340 and wrote "roughly 400 W" has invented a measurement.
#: A COUNT is arithmetic the model performs OVER the evidence ("it came on 7
#: times" from seven state rows), so the figure is legitimately absent from
#: every row — and requiring a citation made VESTA strip a number it had worked
#: out correctly. Measured against a real history answer: "came on 7 times" was
#: removed while the reader saw "[unsourced figure removed]".
#:
#: ⚠️ THE RISK IS NOT THE SAME EITHER, WHICH IS WHY ONE RULE CANNOT SERVE BOTH.
#: The failure mode for a reading is FABRICATION, which citation catches. The
#: failure mode for a count is ARITHMETIC, which citation cannot catch at all —
#: a wrong count of rows the model genuinely holds is still uncited-looking.
#: That is the tool's job to fix (TASK-113: return the count, so the number IS
#: evidence), not this checker's.
READING_UNITS = (r"%|W|kW|kWh|V|A|°C|°F|IDR|EUR|USD|L|L/min|bar")
#: ⚠️ `sigma` AND `n` JOINED THE DERIVED LIST FOR THE REASON ABOVE, NOT AS A
#: LOOSENING. A sigma is arithmetic the model performs over salience's own
#: median and spread; it is not a value the villa measured, so no evidence row
#: can ever contain it and demanding one strips a correct figure. Measured on a
#: delivered message: "((unsourced figure removed) sigma, n=144)" reached the
#: owner's phone mid-sentence. Same defect the counts note records, one class
#: further along — and the same argument decides it: the failure mode for a
#: derived number is ARITHMETIC, which a citation check cannot catch anyway.
DERIVED_UNITS = (r"hours?|hrs?|minutes?|mins?|days?|times?|starts?"
                 r"|sigma|σ|n")

FIGURE = re.compile(
    r"(?<![\w.])"
    r"(?P<value>\d[\d,]*(?:\.\d+)?)"
    rf"\s?(?P<unit>{READING_UNITS})?"
    rf"(?P<derived>{DERIVED_UNITS})?"
    r"(?![\w])")

#: A figure with no unit is only checked when it is big enough to be a reading.
#: ⚠️ SMALL BARE NUMBERS ARE PROSE — "one of four pumps", "the 3 phases" — and
#: demanding a citation for them produces a report full of markers.
BARE_MIN = 10

#: What replaces a figure nobody sourced.
STRIPPED = "[unsourced figure removed]"


@dataclass
class Rendered:
    body: str
    stripped: int = 0
    removed: List[str] = field(default_factory=list)

    @property
    def clean(self) -> bool:
        return self.stripped == 0


def _cited(evidence: Sequence[Mapping[str, Any]]) -> str:
    """Every evidence row as one searchable blob.

    ⚠️ `cited` FIRST, `summary` AS THE FALLBACK, AND THE ORDER IS THE FIX FOR A
    RULE THAT ACCUSED THE MODEL OF INVENTING WHAT IT HAD READ. `summary` is
    truncated to 200 characters for the person who reads the concern later, so
    checking figures against it alone stripped everything a tool reported past
    its first line — see `registry.CITED_CHARS`. A row with no `cited` key is a
    stored concern being re-checked after the fact, where the summary is all
    there is; both are read so neither case is wrong.
    """
    parts: List[str] = []
    for row in evidence:
        if isinstance(row, Mapping):
            parts.append(str(row.get("cited") or ""))
            parts.append(str(row.get("summary") or ""))
            parts.append(str(row.get("args_digest") or ""))
    return " ".join(parts)


def _normalise(value: str) -> str:
    """`1,240` and `1240` are the same figure; `3.0` and `3` are not."""
    return value.replace(",", "")


def _has_figure(haystack: str, value: str) -> bool:
    """Is `value` a FIGURE in the evidence, rather than a run of digits inside
    one?

    ⚠️ THE SUBSTRING FORM WAS A HOLE IN BOTH DIRECTIONS. `"14" in "on at 09:14"`
    is true, so a fabricated count of 14 was accepted as cited by a timestamp;
    and `"7" in ...` matched any row containing a 7 anywhere. A guard that can
    be satisfied by coincidence is not a guard — the whole value of this rule is
    that a figure the villa never measured cannot appear.

    ⚠️ THE BOUNDARY IS NOT `\\b`. `_` is a word character to `\\b`, and a digit
    run inside `09:14` is bounded by `:` which `\\b` treats as a boundary — so
    the naive fix does not help. What separates a figure from a fragment is that
    neither neighbour is a digit, a dot or a colon: `340` in `1340` is a
    fragment, `14` in `09:14` is a fragment, `340` in `340 W` is a figure.
    """
    for match in re.finditer(re.escape(value), haystack):
        before = haystack[match.start() - 1] if match.start() else ""
        after = haystack[match.end()] if match.end() < len(haystack) else ""
        if before not in "0123456789.:" and after not in "0123456789.:":
            return True
    return False


def enforce(body: str, evidence: Sequence[Mapping[str, Any]]) -> Rendered:
    """Strip every figure that resolves to no evidence row.

    ⚠️ MATCHED ON THE VALUE, NOT ON THE SENTENCE. A model that read 340 and
    wrote "340 W" has cited it; one that read 340 and wrote "roughly 400 W" has
    not, and the second is exactly the drift this catches — a plausible
    rounding nobody can trace.

    ⚠️ NO EVIDENCE AT ALL MEANS EVERY FIGURE GOES. That reads harshly and is
    correct: a concern with no evidence rows has nothing behind any of its
    numbers, and softening it here would make the rule advisory.
    """
    haystack = _normalise(_cited(evidence))
    removed: List[str] = []

    def replace(match: "re.Match[str]") -> str:
        value = _normalise(match.group("value"))
        unit = match.group("unit") or ""
        # ⚠️ A DERIVED FIGURE IS NOT CHECKED AGAINST THE EVIDENCE, because it is
        # not IN the evidence by construction. See READING_UNITS.
        if match.group("derived"):
            return match.group(0)
        if not unit:
            try:
                if float(value) < BARE_MIN:
                    return match.group(0)
            except ValueError:
                return match.group(0)
        # ⚠️ A TOKEN, NOT A SUBSTRING, AND THE SUBSTRING FORM PASSED FABRICATED
        # NUMBERS. `"14" in haystack` is true of an evidence row reading
        # "on at 09:14" — so a wrong count of 14 was CITED by a timestamp while
        # a correct count of 7 was stripped. The check that exists to catch an
        # invented figure was waving them through on a coincidence of digits.
        if value and _has_figure(haystack, value):
            return match.group(0)
        removed.append(match.group(0).strip())
        return STRIPPED

    out = FIGURE.sub(replace, str(body or ""))
    return Rendered(body=out, stripped=len(removed), removed=removed)


def enforce_concern(concern: Mapping[str, Any]) -> Dict[str, Any]:
    """A concern with its body enforced and the strip count recorded.

    ⚠️ THE COUNT TRAVELS WITH THE CONCERN. Storing it lets "how often does the
    agent invent numbers" be answered from the record rather than estimated,
    which is the difference between a claim about the system and a measurement
    of it.
    """
    out = dict(concern)
    evidence = out.get("evidence")
    result = enforce(str(out.get("body") or ""),
                     evidence if isinstance(evidence, list) else [])
    out["body"] = result.body
    out["figures_stripped"] = result.stripped
    return out
