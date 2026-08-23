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
FIGURE = re.compile(
    r"(?<![\w.])"
    r"(?P<value>\d[\d,]*(?:\.\d+)?)"
    r"\s?(?P<unit>%|W|kW|kWh|V|A|°C|°F|IDR|EUR|USD|L|L/min|bar|hours?|hrs?|"
    r"minutes?|mins?|days?|times?|starts?)?"
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
        if not unit:
            try:
                if float(value) < BARE_MIN:
                    return match.group(0)
            except ValueError:
                return match.group(0)
        if value and value in haystack:
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
