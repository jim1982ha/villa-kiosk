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
BLOCKS = "▁▂▃▄▅▆▇█"

#: Below this, "up 2%" is noise dressed as a finding — the reader cannot act on
#: it and it makes every period look eventful. Stated here rather than at the
#: call site so both the renderer and the narration payload agree on "flat".
FLAT_BAND_PCT = 10.0

#: How many EARLIER periods a comparison needs before it may be stated. Below
#: this there is a number but no baseline, and "vs 1-day average" is a sentence
#: that cannot be true.
MIN_TREND_PERIODS = 2


def sparkline(series: Sequence[float]) -> str:
    """A series as block characters, scaled to its own range.

    ⚠️ SCALED TO THE SERIES, NOT TO ZERO. A cost that moves between 58 and 74
    would be eight identical full blocks on a zero-based scale — a chart that
    draws a flat line over a 28% swing. The question a sparkline answers is
    "what is the SHAPE", and the absolute values are on the line beside it.

    ⚠️ A FLAT SERIES DRAWS A FLAT LINE, deliberately mid-height rather than at
    the bottom: an all-`▁` chart reads as "everything collapsed to zero" when it
    means "nothing changed".
    """
    values = [float(v) for v in series if isinstance(v, (int, float))
              and not isinstance(v, bool)]
    if not values:
        return ""
    low, high = min(values), max(values)
    if high - low < 1e-9:
        return BLOCKS[len(BLOCKS) // 2] * len(values)
    span = high - low
    return "".join(
        BLOCKS[min(len(BLOCKS) - 1, int((v - low) / span * len(BLOCKS)))]
        for v in values)


def direction(current: float, history: Sequence[float]) -> Tuple[str, float]:
    """`("up"|"down"|"flat", percent)` against the mean of `history`.

    ⚠️ AGAINST THE MEAN OF THE PREVIOUS PERIODS, NEVER THE LAST ONE. "Worse than
    yesterday" is a coin flip on any noisy series and would put an arrow on
    roughly half of all briefs; "worse than a normal day" is the claim a reader
    can act on. Returns `("flat", 0.0)` when there is no history at all, because
    a first report has nothing to compare against and must not imply it does.
    """
    past = [float(v) for v in history if isinstance(v, (int, float))
            and not isinstance(v, bool)]
    if not past:
        return "flat", 0.0
    mean = sum(past) / len(past)
    if abs(mean) < 1e-9:
        # ⚠️ NO PERCENTAGE AGAINST ZERO. "Infinitely worse than a week of
        # nothing" is arithmetically true and useless; the direction still
        # carries the fact that something appeared where nothing was.
        return ("up", 0.0) if current > 0 else ("flat", 0.0)
    change = (current - mean) / abs(mean) * 100.0
    if abs(change) < FLAT_BAND_PCT:
        return "flat", change
    return ("up" if change > 0 else "down"), change


#: The noun a cadence counts in, for "7-day average". ⚠️ NOT `PERIOD_SCOPE_WORD`
#: — that one answers "which period is this" ("today", "this week") and reads as
#: nonsense pluralised. Two questions, two tables, both beside what they describe.
PERIOD_NOUN = {"daily": "day", "weekly": "week", "monthly": "month"}


def phrase(current: float, history: Sequence[float], unit: str = "",
           cadence: str = "") -> str:
    """"↑ 21% vs 7-day average of 61 IDR", or "" when there is nothing to say.

    ⚠️ THE BASELINE IS PRINTED, NOT JUST THE PERCENTAGE. "up 21%" invites "from
    what?" — the same defect as a number without its unit, one level up. And the
    window is named ("7-day average") because a comparison against an unstated
    span is a comparison the reader cannot check.
    """
    past = [float(v) for v in history if isinstance(v, (int, float))
            and not isinstance(v, bool)]
    # ⚠️ TWO PRIOR PERIODS MINIMUM, THE SAME BAR THE CHART ALREADY SET. A
    # delivered brief read "↑ 2934% vs 1-day AVERAGE of 74 IDR" — an average of
    # one sample is not an average, and a 2934% swing computed off a single
    # quiet day is noise presented as insight, at the top of the money section.
    # The chart already refused below two points; the sentence did not, so the
    # two halves of one feature disagreed about when they had enough data.
    if len(past) < MIN_TREND_PERIODS:
        return ""
    way, pct = direction(current, past)
    mean = sum(past) / len(past)
    noun = PERIOD_NOUN.get(cadence, "period")
    tail = (f" vs {len(past)}-{noun} average of "
            f"{mean:,.0f}{f' {unit}' if unit else ''}")
    if way == "flat":
        return f"about usual{tail}"
    arrow = "↑" if way == "up" else "↓"
    return f"{arrow} {abs(pct):.0f}%{tail}"


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
