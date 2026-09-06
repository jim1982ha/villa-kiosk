"""Is this number better or worse than usual? — and a chart that survives delivery.

⚠️ THE GAP THIS CLOSES WAS THE OWNER'S OWN DIAGNOSIS OF THE BRIEF. A line reading
"Avoidable cost identified: 74 IDR" cannot be judged: 74 is meaningless without
knowing that a normal day is 61. Every number in the report had that problem, and
no amount of rewording fixes it — the comparison simply was not computed.

⚠️ THE CHART IS EIGHT CHARACTERS, AND THAT IS NOT A COMPROMISE. A brief is
delivered as plain text because that is the intersection of what every notify
platform accepts (`deliver.py`). Block-element sparklines pass `style.inert()`
untouched, render on every destination this add-on can reach, need no image
hosting, and cost nothing offline — which a PNG on a villa with no WAN does not.
Checked rather than assumed: `test_trend` asserts the whole alphabet survives.

⚠️ IT NEVER EXTRAPOLATES. `direction` compares one period against the mean of
the ones before it and says up, down or flat. No forecast, no "trending toward",
no seasonality: the modules own statistics and this owns presentation, and a
renderer that started predicting would be an unaccountable opinion in a document
the owner acts on — the same rule `providers._prompt` states for the LLM.
"""

from __future__ import annotations

from typing import List, Sequence, Tuple

#: Low to high. ⚠️ EIGHT LEVELS, NOT MORE: these are the Unicode block elements
#: that every platform tested renders at a consistent width. Mixing in other
#: block characters produces a chart with a ragged baseline on some fonts.

# ⚠️ `sparkline`, `direction`, `phrase`, `BLOCKS`, `FLAT_BAND_PCT`,
# `MIN_TREND_PERIODS` and `PERIOD_NOUN` were DELETED (2.953.0). None had a
# production caller — `tests/py/test_trend.py` exercised all three functions at
# length and was their only reader, which is the "pure function extracted for
# testability while nothing calls it" shape this repo has paid for before (the
# escalation ladder "EXISTED FROM v2.641.0 TO v2.698.0 WITH NOBODY ON IT").
#
# ⚠️ RE-ATTACHING THE TREND IS A PRODUCT DECISION, NOT A REFACTOR, and it is
# still available: `findingCount` is a real series and this module's header
# argued it was "the owner's own diagnosis of the brief". What is gone is the
# machinery that made it look wired.

def series_from_history(entries: Sequence[object], field: str,
                        cadence: str, limit: int = 7) -> List[float]:
    """The last `limit` values of `field` from same-cadence history, oldest first.

    ⚠️ SAME CADENCE ONLY. A daily brief compared against a month of mixed daily
    and weekly entries would rank one week's total beside one day's and report a
    catastrophe every time a weekly report happened to precede it. The cadence is
    stored on every entry precisely so this can filter on it.

    ⚠️ AND THE CURRENT REPORT IS NOT IN IT — it is appended to history AFTER
    delivery, so "history" here is genuinely the periods before this one. If that
    ordering ever changes, every trend silently compares a number with itself.
    """
    out: List[float] = []
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("cadence") != cadence:
            continue
        value = entry.get(field)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            out.append(float(value))
    return out[-limit:]
