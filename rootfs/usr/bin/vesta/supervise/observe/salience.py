"""What is unusual for THIS entity, measured against its own recent past.

⚠️ THIS IS WHY 108 HAND-TUNED RULES EXIST, AND WHY THEY DO NOT TRAVEL. Every
threshold in the blueprint pack is somebody answering "how much is too much" for
one villa's equipment — 340 W of idle draw, 1.30 phase imbalance, 0.55 power
factor. Each is correct here and wrong at the next property, which is the whole
portability failure in one sentence. Novelty needs no such answer: an entity's
own distribution says what normal is, and every property has one from the day it
is installed.

⚠️ SALIENCE DOES NOT DECIDE WHAT MATTERS. It decides what is SHOWN. Ranking a
pump top of the cycle is a claim that its reading is unusual for it, not a claim
that anything is wrong — a guest arriving is unusual and entirely fine. The
judgement is made two tiers up with the whole villa in view, and the separation
is what stops this file growing into a rule engine again.

⚠️ NO THRESHOLD CONSTANT MAY APPEAR HERE (ARCH-004), AND THE DISTINCTION IS NOT
PEDANTRY. A threshold answers "how much is too much" and is a per-villa
judgement wearing a number's clothes. ⚠️ THIS SAID "THE THREE CONSTANTS BELOW"
AND THERE ARE NOW EIGHT — a count in prose beside a list in code, which is the
drift this project has a whole audit part for; the test that pins the list by
NAME is the copy to trust, and it is why this was caught the day the four
bimodal ones were added. All of them are STATISTICAL
VALIDITY requirements — they answer "is this sample big enough to say anything
at all", which has the same answer at every property because it is a fact about
arithmetic rather than about plumbing. The test suite greps this module for the
shapes a real threshold takes, and each of these is named and justified rather
than tolerated.

⚠️ THE CALLER MUST COMPARE LIKE WITH LIKE, AND THIS MODULE CANNOT CHECK IT FOR
YOU. `samples` and `observed` must be the SAME STATISTIC. Scoring an
INSTANTANEOUS reading against a distribution of DAILY MEANS produces a perfect
z-score that describes nothing: a pump running three hours a day has a daily mean
near 250 W and draws 2,516 W while running, an order of magnitude apart BY
CONSTRUCTION, every day, forever.

That is not hypothetical. The PH-1 checkpoint fed this module real 28-day daily
means and real instantaneous readings from the reference villa, and the top three
"most unusual" items were all the same fact — the pumps were on. A facility
manager would have said "yes, it is the afternoon". Left alone it would have
ranked the same four pumps first on every cycle forever, escalated them, spent
the budget explaining that pumps draw power, and buried the one real finding —
which is the alert-fatigue failure this redesign exists to remove, arriving by a
new route.

`score_numeric` is handed two numbers and has no way to know they are different
quantities, so the contract cannot be enforced here. What IS done here: `basis`
travels with the score and is printed in the reason, so the comparison is
LEGIBLE — "against 28 daily means" beside an instantaneous value is visible to
a reader and to the agent, where a bare sigma is not.

⚠️ AND IT NEVER FABRICATES A SCORE. An entity without enough history returns
`score=None` and a reason a person can read. That is not a lesser answer than a
number: a confident score computed from four readings is worse than no score,
because it ranks, and whatever it displaces was real.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import (Any, Dict, Final, List, Mapping, Optional, Sequence,
                    Tuple)

from vesta.shared.analysis import robust, series

# ── the three constants, each a validity requirement rather than a threshold ─

#: The observation window. ADR-002. A WINDOW is not a threshold: it says how far
#: back to look, not how much is too much, and moving it changes precision
#: rather than sensitivity. 28 days is four of every weekday, which is the
#: smallest number that lets the per-weekday refinement below mean anything.
WINDOW_DAYS: Final[int] = 28

#: Below this, a median absolute deviation is not a measurement. With fewer than
#: seven readings the MAD is dominated by whichever handful arrived, and the
#: resulting z-score is arithmetic performed on noise. This is a property of the
#: estimator, identical at every villa.
MIN_SAMPLES: Final[int] = 7

#: The per-weekday refinement needs its own floor, and it is higher in effect
#: because it partitions the same data. Four samples is one per week across the
#: window; below that "Tuesdays look like this" is a sentence about one Tuesday.
MIN_SAMPLES_PER_WEEKDAY: Final[int] = 4

#: ⚠️ NOT A CONSTANT AND NOT A DIAL — this is the shape of the score, stated so
#: nobody reintroduces a weight. The duration term MULTIPLIES rather than adds,
#: and its range is fixed at [1, 2] by construction: a reading that is unusual
#: AND has persisted is at most twice as salient as the same reading seen once.
#: A tunable weight here would be the first per-villa constant back in the door.
_PERSISTENCE_MAX_MULTIPLE: Final[float] = 2.0

#: ⚠️ A DUTY-CYCLED DEVICE HAS TWO POPULATIONS AND NO SINGLE BASELINE, AND
#: SCORING IT AGAINST ONE IS THE SAME CATEGORY ERROR AS DIVIDING BY A ZERO
#: SPREAD (2026-08-30, from the field). A pool pump sits at 0 W most of the day
#: and ~850 W while it runs; the median lands on the RESTING mode (~6 W) and the
#: MAD collapses toward it, so every ordinary run scored as hundreds of sigma —
#: the villa's own document said "1704.6 VA against a median of 6.3 VA … 673
#: sigma" about a pump doing exactly what it should, on three of four passes,
#: at ~$0.37 an investigation to conclude nothing.
#:
#: ⚠️ AND THE NOISE WAS THE LESSER HALF. A pump at 400 W with a failing
#: capacitor also scores hundreds of sigma, so the number could not separate a
#: healthy run from a degraded one — the fault worth catching was invisible
#: underneath the false ones. Scoring against the population the reading
#: BELONGS TO is what makes 850-vs-848 boring and 400-vs-848 loud.
#:
#: A reading is unscorable rather than fabricated when its own side is too thin,
#: which is the same answer this module already gives for a flat history.
_BIMODAL_MIN_SAMPLES: Final[int] = 12
#: Each side must hold this share before two clusters are a real duty cycle
#: rather than one outlier and the rest.
_BIMODAL_MIN_SHARE: Final[float] = 0.10
#: ⚠️ AND AN ABSOLUTE FLOOR, BECAUSE A SHARE ALONE LETS ONE READING BE A
#: "POPULATION". `int(12 * 0.10)` is 1, so a single spike in a steady series
#: qualified as a second mode, was given a baseline of its own, and would have
#: been scored as normal — silencing the one reading that mattered, which is
#: precisely the inverse of this change's purpose. Caught by its own test.
_BIMODAL_MIN_COUNT: Final[int] = 3
#: The empty band between the two, as a fraction of the whole range. Well above
#: anything a unimodal series produces: a noisy sensor's widest internal gap is
#: a few percent of its range, not half of it.
_BIMODAL_MIN_GAP: Final[float] = 0.50


def _clusters(values: Sequence[float]
              ) -> Optional[Tuple[List[float], List[float]]]:
    """Split a duty-cycled series into (rest, load), or `None` if unimodal.

    ⚠️ THE WIDEST EMPTY BAND, NOT A THRESHOLD. Any fixed wattage would be a
    villa-specific constant, which this project forbids and which would be
    wrong for the next device anyway — a lit circuit rests at 0 W and loads at
    56 W, a pump at 0 and 850. The gap is measured against the series' OWN
    range, so it carries no units and no assumption about the equipment.
    """
    ordered = sorted(values)
    if len(ordered) < _BIMODAL_MIN_SAMPLES:
        return None
    span = ordered[-1] - ordered[0]
    if span <= 0:
        return None
    gap, at = 0.0, 0
    for i in range(len(ordered) - 1):
        width = ordered[i + 1] - ordered[i]
        if width > gap:
            gap, at = width, i
    if gap < _BIMODAL_MIN_GAP * span:
        return None
    rest, load = ordered[:at + 1], ordered[at + 1:]
    floor = max(_BIMODAL_MIN_COUNT, int(len(ordered) * _BIMODAL_MIN_SHARE))
    if len(rest) < floor or len(load) < floor:
        return None
    return rest, load


@dataclass
class Salience:
    """One entity's novelty, with everything needed to argue with it.

    ⚠️ THE BASELINE AND SPREAD TRAVEL WITH THE SCORE, ALWAYS. A ranked list of
    bare numbers cannot be checked by the reader, cannot be explained to an
    owner, and cannot be debugged when it is wrong. "1.9 kW against a median of
    340 W, spread 60 W" is a sentence; "score 8.4" is an assertion.
    """

    entity_id: str
    kind: str                                  # "numeric" | "categorical"
    score: Optional[float] = None              # None means "cannot say"
    reason: str = ""
    observed: Optional[float] = None
    baseline: Optional[float] = None           # median of the window
    spread: Optional[float] = None             # robust sigma
    samples: int = 0
    persistence: float = 0.0                   # 0..1 of the window off-baseline
    basis: str = ""                            # what BOTH sides are measuring
    weekday_scoped: bool = False               # was the baseline weekday-local
    #: Was this scored against ONE of two populations — see `_clusters`. A pump
    #: is either at rest or at load and has no single "normal"; scoring the two
    #: together is what made every ordinary run read as hundreds of sigma.
    duty_cycled: bool = False
    novel_state: Optional[str] = None          # categoricals only
    seen_states: Tuple[str, ...] = field(default_factory=tuple)

    def as_dict(self) -> Dict[str, Any]:
        """Flat, JSON-safe, and the shape the Villa Document embeds."""
        out: Dict[str, Any] = {
            "entity_id": self.entity_id, "kind": self.kind,
            "score": self.score, "reason": self.reason,
            "observed": self.observed, "baseline": self.baseline,
            "spread": self.spread, "samples": self.samples,
        }
        if self.basis:
            out["basis"] = self.basis
        if self.persistence:
            out["persistence"] = round(self.persistence, 3)
        if self.weekday_scoped:
            out["weekday_scoped"] = True
        if self.novel_state is not None:
            out["novel_state"] = self.novel_state
            out["seen_states"] = list(self.seen_states)
        return out


# ── helpers ─────────────────────────────────────────────────────────────────
def _numeric(value: Any) -> Optional[float]:
    """A float, or None for anything that is not one.

    ⚠️ `unavailable` AND `unknown` MUST NOT BECOME NUMBERS. `maintenance_*`
    already shipped a bug of exactly this shape — unavailable read as -999999,
    which is below every threshold, so any sensor dropping off the mesh fired
    its own low-battery alert. A non-numeric state is absence of a reading, and
    absence is the journal's business, not this module's.
    """
    if isinstance(value, bool) or value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return None if out != out else out          # NaN is not a reading


def _persistence(values: Sequence[float], baseline: float) -> float:
    """How much of the window sat on the same side of normal as the latest one.

    ⚠️ A FRACTION, DELIBERATELY, so it cannot become a weight. A single spike
    and a fortnight of drift can carry the same z-score, and they call for
    different responses — but the difference belongs in the ranking, not in a
    tunable. Range [0, 1] by construction; the caller maps it to [1, 2].
    """
    if not values:
        return 0.0
    latest = values[-1]
    if latest == baseline:
        return 0.0
    above = latest > baseline
    same_side = sum(1 for v in values if (v > baseline) == above and v != baseline)
    return same_side / len(values)


def _window(samples: Sequence[Mapping[str, Any]],
            weekday: Optional[int]) -> List[Mapping[str, Any]]:
    """Rows for one weekday, or all of them when the weekday is unusable."""
    if weekday is None:
        return list(samples)
    out = [row for row in samples
           if series.weekday_of(str(row.get("day") or "")) == weekday]
    return out


# ── numeric ─────────────────────────────────────────────────────────────────
def score_numeric(samples: Sequence[Mapping[str, Any]],
                  observed: Any, *, entity_id: str = "",
                  weekday: Optional[int] = None,
                  basis: str = "") -> Salience:
    """Novelty of `observed` against this entity's own history.

    ⚠️ `basis` NAMES WHAT BOTH SIDES ARE — "daily mean", "hourly mean",
    "instantaneous". It is not used in the arithmetic and cannot be: this
    function sees two numbers. It is printed in the reason so a mismatch is
    VISIBLE, which is the only defence available at this layer. See the module
    header for the mismatch that made it necessary.

    `samples` are `{"day": "YYYY-MM-DD", "value": float}` rows, oldest first —
    the shape `series.hourly_by_day` already produces, so the journal and the
    statistics API can both feed this without a second adapter.
    """
    out = Salience(entity_id=entity_id, kind="numeric", basis=str(basis or ""))
    current = _numeric(observed)
    if current is None:
        out.reason = "the current reading is not numeric"
        return out
    out.observed = current

    # ⚠️ WEEKDAY FIRST, THEN FALL BACK — and the fallback is not a failure. A
    # villa's Sunday genuinely differs from its Tuesday (occupancy, pool, staff),
    # so a weekday-local baseline is the better measure whenever the data
    # supports one. It usually does not in the first month, which is exactly
    # when a new install most needs an answer.
    scoped = _window(samples, weekday)
    if weekday is not None and len(scoped) >= MIN_SAMPLES_PER_WEEKDAY:
        rows, out.weekday_scoped, floor = scoped, True, MIN_SAMPLES_PER_WEEKDAY
    else:
        rows, floor = list(samples), MIN_SAMPLES

    values = [v for v in (_numeric(r.get("value")) for r in rows) if v is not None]
    out.samples = len(values)
    # ⚠️ THE FLOOR FOLLOWS THE WINDOW, AND GETTING THIS WRONG MADE THE WEEKDAY
    # PATH DEAD CODE. A 28-day window contains exactly FOUR of each weekday, so
    # selecting a weekday sample on MIN_SAMPLES_PER_WEEKDAY (4) and then scoring
    # it against MIN_SAMPLES (7) rejects every weekday baseline that has ever
    # existed — the branch would set `weekday_scoped = True` and then always
    # return None, which reads in a capture as "this villa has no weekday
    # history" rather than "the code cannot reach that answer". Caught by the
    # test, not by review.
    if len(values) < floor:
        out.reason = (f"only {len(values)} usable reading(s); "
                      f"{floor} needed before a spread means anything")
        return out

    # ⚠️ THE POPULATION THIS READING BELONGS TO, WHERE THERE ARE TWO. Taken
    # BEFORE the baseline, because the whole point is that the all-samples
    # median is the wrong number for a duty-cycled device — it lands on
    # whichever mode is commoner and describes neither.
    pair = _clusters(values)
    side = ""
    if pair is not None:
        rest, load = pair
        out.duty_cycled = True
        if current <= rest[-1]:
            values, side = rest, "at rest"
        elif current >= load[0]:
            values, side = load, "running"
        else:
            # ⚠️ IN THE EMPTY BAND — NEITHER OFF NOR AT LOAD, AND THIS IS THE
            # FAULT THE OLD ARITHMETIC COULD NOT SEE. A pump at 400 W when it
            # rests at 0 and runs at 850 is the failing-capacitor, blocked-
            # impeller, cavitating case. Scored against the RUN it should have
            # been, because that is what it is failing to be — filing it with
            # the resting readings (the midpoint rule this replaced) buried it
            # under a flat baseline and returned "no spread to score against".
            values, side = load, "part-loaded"
        # ⚠️ TOO THIN TO SCORE IS AN ANSWER, NOT A FAILURE — the same one this
        # module gives for a flat history. A device seen running twice has no
        # running baseline, and inventing one is what this change undoes.
        if len(values) < floor:
            out.reason = (
                f"{current:g} is {side}, and only {len(values)} of "
                f"{out.samples} readings were comparable; "
                f"{floor} needed before that side has a baseline")
            return out

    baseline = robust.median(values)
    spread = robust.robust_sigma(values)
    if baseline is None or spread is None:
        out.reason = "no baseline could be computed"
        return out
    out.baseline, out.spread = baseline, spread

    if spread == 0.0:
        # ⚠️ MAD RETURNS 0.0 LEGITIMATELY and robust.py's docstring requires
        # every caller to handle it: a well-behaved always-on appliance draws
        # the same amount every hour. Dividing here would turn the quietest
        # equipment in the house into the loudest alarm — "a divide-by-almost-
        # zero dressed up as statistics", in that module's own words. So a
        # departure from a perfectly flat history is reported as NOVEL, with
        # the flatness stated, and left unscored rather than given an
        # arithmetic infinity that would head every ranking forever.
        if current == baseline:
            out.score, out.reason = 0.0, "steady at its usual value"
            return out
        out.reason = (f"was flat at {baseline:g} across {len(values)} "
                      f"{('readings ' + side) if side else 'readings'} "
                      f"and is now {current:g}; no spread to score against")
        return out

    z = abs(current - baseline) / spread
    out.persistence = _persistence(values + [current], baseline)
    # [1, 2]: unusual AND sustained is at most twice as salient as unusual once.
    out.score = z * (1.0 + out.persistence * (_PERSISTENCE_MAX_MULTIPLE - 1.0))
    direction = "above" if current > baseline else "below"
    against = f" across {len(values)} {out.basis}s" if out.basis else ""
    # ⚠️ SAY WHICH POPULATION, OR THE NUMBERS READ AS WRONG. "850 W against a
    # median of 848" is baffling to a reader who knows the device is off most
    # of the day; "while running" is what makes it checkable — this module's
    # founding rule that the reader must be able to argue with the figure.
    scope = f" while {side}" if side else ""
    out.reason = (f"{current:g} is {z:.1f} sigma {direction} its "
                  f"{'weekday ' if out.weekday_scoped else ''}median of "
                  f"{baseline:g}{scope}{against} "
                  f"(spread {spread:g}, n={len(values)})")
    # ⚠️ OUTSIDE THE WHOLE RANGE IS WORTH SAYING SEPARATELY FROM "n sigma". A
    # value beyond every reading ever recorded is either a genuine extreme or a
    # unit mismatch, and a reader can tell those apart where the arithmetic
    # cannot. Stated, never scored — it must not become a second ranking term.
    low, high = min(values), max(values)
    if current > high or current < low:
        out.reason += (f"; outside the entire {len(values)}-sample range "
                       f"[{low:g}, {high:g}]")
    return out


# ── categorical ─────────────────────────────────────────────────────────────
def score_categorical(seen: Sequence[Any], observed: Any, *,
                      entity_id: str = "") -> Salience:
    """A state this entity has never been in before is the whole signal here.

    ⚠️ NO SCALE, SO NO SCORE BEYOND PRESENT/ABSENT. "How unusual is `jammed`"
    has no arithmetic answer — the states of a lock are not ordered and their
    distances are undefined. Counting frequencies and calling the rare ones
    salient would rank a lock that is usually locked above one that is
    sometimes unlocked, which is not information. So this reports a boolean
    fact with its evidence, and the ranking is left to the tier that can weigh
    a novel state against everything else happening.
    """
    out = Salience(entity_id=entity_id, kind="categorical")
    current = "" if observed is None else str(observed)
    history = tuple(dict.fromkeys(str(s) for s in seen if s is not None))
    out.seen_states, out.samples = history, len(history)

    if not history:
        out.reason = "no history for this entity yet"
        return out
    if current in history:
        out.score, out.reason = 0.0, f"{current!r} is one of its usual states"
        return out
    out.novel_state = current
    # ⚠️ The score is the count of states it has NEVER been, i.e. 1 — deliberately
    # not a magnitude. Numeric and categorical scores are NOT comparable and the
    # ranking below keeps them apart rather than pretending they are.
    out.score = 1.0
    out.reason = (f"{current!r} has never been seen; "
                  f"previously only {', '.join(repr(s) for s in history)}")
    return out


# ── ranking ─────────────────────────────────────────────────────────────────
def rank(scored: Sequence[Salience], *, limit: Optional[int] = None
         ) -> List[Salience]:
    """Most novel first. Unscorable entities keep their place at the end.

    ⚠️ NUMERIC AND CATEGORICAL ARE RANKED SEPARATELY AND THEN INTERLEAVED
    NUMERIC-FIRST, because a sigma and a boolean have no common unit. A novel
    categorical state scores 1.0; treating that as "less salient than 1.1 sigma"
    would be a units error with a straight face. Every novel state reaches the
    agent, after the numeric ranking, and the agent sees both lists with their
    reasons attached.

    ⚠️ `limit` TRUNCATES THE SHOWN SET, WHICH IS THIS MODULE'S ONLY JOB — it
    does not discard anything. The caller keeps the full list; salience decides
    what fits in a context window, and that is a budget, not a judgement.
    """
    numeric = sorted(
        (s for s in scored if s.kind == "numeric" and s.score),
        key=lambda s: (-(s.score or 0.0), s.entity_id))
    novel = sorted(
        (s for s in scored if s.kind == "categorical" and s.novel_state is not None),
        key=lambda s: s.entity_id)
    quiet = sorted(
        (s for s in scored if s.score == 0.0), key=lambda s: s.entity_id)
    unscored = sorted(
        (s for s in scored if s.score is None), key=lambda s: s.entity_id)
    out = numeric + novel + quiet + unscored
    return out if limit is None else out[:limit]


def unscorable(scored: Sequence[Salience]) -> List[Salience]:
    """Everything that could not be scored, with its stated reason.

    ⚠️ A FIRST-CLASS RESULT, NOT A LEFTOVER. "I could not assess 40 of your
    devices and here is why" is one of the most useful sentences this system can
    produce, and it is the honest half of a coverage claim — the current
    pipeline's inability to say it is what the old blueprint stand-down papered
    over (deleted in 2.755.0).
    """
    return [s for s in scored if s.score is None]
