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
judgement wearing a number's clothes. ⚠️ THIS SAID "THE THREE CONSTANTS BELOW",
THEN "EIGHT", AND THE COUNT IS NOW GONE — a number in prose beside a list in
code is the drift this project has a whole audit part for, and it went stale
twice: once when the four bimodal ones arrived, and again when the weekday pair
was deleted. The test that pins the list by NAME is the copy to trust. All of
them are STATISTICAL
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

import math
from dataclasses import dataclass, field
from typing import (Any, Dict, Final, List, Mapping, Optional, Sequence,
                    Tuple)

from vesta.shared import instants
from vesta.shared.analysis import robust
from vesta.shared.text import for_phrase

# ── the constants, each a validity requirement rather than a threshold ──────

#: Below this, a median absolute deviation is not a measurement. With fewer than
#: seven readings the MAD is dominated by whichever handful arrived, and the
#: resulting z-score is arithmetic performed on noise. This is a property of the
#: estimator, identical at every villa.
#:
#: ⚠️ SEVEN READINGS, NOT SEVEN DAYS, and that is why this module needs no
#: window constant. It asks whether THIS reading is unusual for THIS entity over
#: whatever history the journal still holds; how far back that reaches is a
#: property of the ring, not a number this file gets to assert.
MIN_SAMPLES: Final[int] = 7

# ⚠️ `WINDOW_DAYS` (28) AND `MIN_SAMPLES_PER_WEEKDAY` (4) WERE DELETED HERE ON
# 2026-08-30 ALONG WITH THE WEEKDAY REFINEMENT THEY EXISTED FOR, and this note
# is what stops them coming back one plausible commit at a time.
#
# `score_numeric` took a `weekday` argument and scoped the baseline to "what
# this entity does on THIS weekday". It had ONE production caller —
# `agent/sources.build_salient_source` — which never passed it, so the branch
# was unreachable outside the test suite; `WINDOW_DAYS` had no code reader at
# all and existed only to justify the branch. The function's own comment
# recorded this arm being found dead ONCE BEFORE and fixed inside the function,
# with nobody wiring the caller: `feedback_pin-the-caller` at the scale of a
# feature.
#
# ⚠️ AND IT IS NOT MISSING — IT LIVES ONE LAYER UP, DONE PROPERLY.
# `analysis/modules/level_anomaly` and `level_shortfall` already judge a device
# against "its own same-weekday median", fed by Home Assistant's permanent
# statistics over `WINDOW_DAYS = 56`, and their own comment says why that is
# right: "EIGHT WEEKS, NOT FOUR. Four weeks gives four samples of each weekday".
# Rebuilding it here would be a second implementation of one rule, fed by the
# same statistics, landing at the horizon the first one examined and rejected.
#
# The two layers ask different questions and should keep doing so: this one
# ranks what is unusual RIGHT NOW to spend a model's attention on, over recent
# history; that one asks whether this Tuesday is unlike its Tuesdays, over
# months. Short horizon is correct here.

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
    kind: str                                  # one of KINDS
    score: Optional[float] = None              # None means "cannot say"
    reason: str = ""
    #: WHY it could not be scored, as one of `WHY`, or "" when it was. The
    #: `reason` above is a sentence with the entity's own numbers in it; this
    #: is the same fact as a token a census can count. Added 2026-09-04 because
    #: `doc_unscorable` said HOW MANY entities were unscorable (~two thirds of
    #: the reference villa) and nothing could say why, so nothing could say
    #: whether a new lens would reach any of them.
    why: str = ""
    #: The state being held, for `kind == "duration"` — printed, never keyed on.
    state: Optional[str] = None
    observed: Optional[float] = None
    baseline: Optional[float] = None           # median of the window
    spread: Optional[float] = None             # robust sigma
    samples: int = 0
    persistence: float = 0.0                   # 0..1 of the window off-baseline
    basis: str = ""                            # what BOTH sides are measuring
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
        if self.why:
            out["why"] = self.why
        if self.state is not None:
            out["state"] = self.state
        if self.persistence:
            out["persistence"] = round(self.persistence, 3)
        if self.novel_state is not None:
            out["novel_state"] = self.novel_state
            out["seen_states"] = list(self.seen_states)
        return out


#: The lenses, in the order the document presents them. ⚠️ A TUPLE, NOT A
#: COMMENT ON A FIELD — `rank` reserves a slot per kind by iterating this, so a
#: fifth lens is represented in the document by being named here and nowhere
#: else. "numeric" and "categorical" were the only two until 2026-09-04;
#: "duration" and "frequency" are the lenses that reach the two thirds of a
#: villa that has no number to score — a lock, a light, a cover, a door.
KINDS: Final[Tuple[str, ...]] = ("numeric", "categorical", "duration",
                                  "frequency")

#: Why a scorer declined, as tokens a census can count. Every unscorable
#: `Salience` carries exactly one of these in `why`; `unscorable_census`
#: aggregates them. ⚠️ THE VOCABULARY IS CLOSED ON PURPOSE: a free-text reason
#: cannot be counted, and the whole point of the token is to answer "would a
#: new lens reach these" — `too_few` says yes-with-time, `not_numeric` says a
#: different lens, `flat` says nothing will and that is an answer.
WHY: Final[Tuple[str, ...]] = ("not_numeric", "too_few", "too_few_on_side",
                                "no_baseline", "flat", "no_history",
                                "no_change_yet")


def _thin(out: "Salience", have: int, what: str) -> "Salience":
    """The cold-start answer, stated once for every lens.

    ⚠️ ONE FLOOR, ONE SENTENCE, THREE SCORERS. `MIN_SAMPLES` is a property of
    the MAD estimator every lens here uses, not of any particular scorer, so a
    per-scorer floor would be a second copy of one validity requirement — the
    duplication this project audits for. What IS per-scorer is the NOUN: seven
    readings, seven earlier holds of this state, seven days of counts. The
    contract every scorer keeps is that below the floor it returns THIS, with
    `score=None` and `why="too_few"`, never a number computed from too little.
    """
    out.score = None
    out.why = "too_few"
    out.reason = (f"only {have} usable {what}; {MIN_SAMPLES} needed before "
                  f"a spread means anything")
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


# ── numeric ─────────────────────────────────────────────────────────────────
def score_numeric(samples: Sequence[Mapping[str, Any]],
                  observed: Any, *, entity_id: str = "",
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
        out.reason, out.why = "the current reading is not numeric", "not_numeric"
        return out
    out.observed = current

    values = [v for v in (_numeric(r.get("value")) for r in samples)
              if v is not None]
    out.samples = len(values)
    # ⚠️ ONE FLOOR, BECAUSE THERE IS ONE POPULATION SINCE 2026-08-30. This used
    # to pick between `MIN_SAMPLES` and a weekday-local floor, and the weekday
    # arm was unreachable in production — see the note beside `MIN_SAMPLES` for
    # why it went and where that job actually lives.
    if len(values) < MIN_SAMPLES:
        return _thin(out, len(values), "reading(s)")

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
        if len(values) < MIN_SAMPLES:
            out.reason = (
                f"{current:g} is {side}, and only {len(values)} of "
                f"{out.samples} readings were comparable; "
                f"{MIN_SAMPLES} needed before that side has a baseline")
            out.why = "too_few_on_side"
            return out

    baseline = robust.median(values)
    spread = robust.robust_sigma(values)
    if baseline is None or spread is None:
        out.reason, out.why = "no baseline could be computed", "no_baseline"
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
        out.why = "flat"
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
    out.reason = (f"{current:g} is {z:.1f} sigma {direction} its median of "
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
        out.reason, out.why = "no history for this entity yet", "no_history"
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


# ── duration ────────────────────────────────────────────────────────────────
def _instant_s(value: Any) -> Optional[float]:
    moment = instants.as_utc(value)
    return None if moment is None else moment.timestamp()


def _holds(rows: Sequence[Mapping[str, Any]]) -> List[Tuple[str, float, float]]:
    """`(state, started_s, ended_s)` for every COMPLETED hold, oldest first.

    A hold is one contiguous run of the same journalled state. Two consecutive
    rows with the same state (an attribute-only change) extend a hold rather
    than closing it, because the state did not change.
    """
    out: List[Tuple[str, float, float]] = []
    state: Optional[str] = None
    since: Optional[float] = None
    for row in rows:
        at = _instant_s(row.get("at"))
        if at is None:
            continue
        current = "" if row.get("s") is None else str(row.get("s"))
        if state is None:
            state, since = current, at
            continue
        if current != state:
            assert since is not None
            out.append((state, since, at))
            state, since = current, at
    return out


def score_duration(rows: Sequence[Mapping[str, Any]], now: float, *,
                   entity_id: str = "") -> Salience:
    """How long THIS state has been held, against this entity's own holds of it.

    ⚠️ THE LENS `score_categorical` DECLINES TO BE, AND FOR A GOOD REASON THAT
    THIS DOES NOT CONTRADICT. That scorer refuses to rank states because they
    are unordered — "how unusual is `jammed`" has no arithmetic. A DURATION is
    ordered: forty minutes unlocked is more than ninety seconds unlocked, and
    the entity's own past holds of the same state are the population. So this
    scores a number, and the number is time.

    ⚠️ ONLY THE CURRENT HOLD, AND ONLY WHEN IT IS LONGER THAN EVERY EARLIER
    ONE. A hold still in progress is a lower bound — a lock unlocked for five
    minutes may be about to close, so "shorter than usual" is never a finding.
    And a hold within the range already seen is this entity doing something it
    has done before: a gate the owner props open for an hour on Sundays must
    not be the most unusual thing in the villa every Sunday. So the novelty
    condition is the same one `score_categorical` uses — never seen before —
    applied to the length rather than the label, and the score is how far
    beyond the population it has gone, in log-time: hold lengths are
    heavy-tailed (seconds most of the time, hours occasionally), and a linear
    MAD on them is the 673-sigma pump again with a clock instead of a wattage.

    ⚠️ THE COLD-START CONTRACT IS `_thin`, THE SAME FLOOR EVERY LENS USES. A
    lock the ring has seen unlocked three times has no distribution of unlocked
    holds, whatever a person might guess about locks in general.

    `rows` are ONE entity's journal rows, oldest first; `now` is epoch seconds.
    """
    out = Salience(entity_id=entity_id, kind="duration")
    if not rows:
        out.reason, out.why = "no history for this entity yet", "no_history"
        return out
    last = rows[-1]
    current = "" if last.get("s") is None else str(last.get("s"))
    out.state = current
    holds = _holds(rows)
    # The current hold began when the state last CHANGED, which is the end of
    # the last completed hold — or the first row, if it never has.
    started = holds[-1][2] if holds else _instant_s(rows[0].get("at"))
    if started is None:
        out.reason, out.why = "no readable timestamps", "no_history"
        return out
    held = max(0.0, float(now) - started)
    out.observed = held
    earlier = [b - a for state, a, b in holds if state == current and b > a]
    out.samples = len(earlier)
    if len(earlier) < MIN_SAMPLES:
        return _thin(out, len(earlier), f"earlier hold(s) of {current!r}")

    logs = [math.log(d) for d in earlier]
    baseline = robust.median(logs)
    spread = robust.robust_sigma(logs)
    if baseline is None or spread is None:
        out.reason, out.why = "no baseline could be computed", "no_baseline"
        return out
    usual = math.exp(baseline)
    out.baseline, out.spread = usual, spread
    longest = max(earlier)
    phrase = for_phrase(held * 1000.0)
    if held <= longest:
        out.score = 0.0
        out.reason = (f"{current!r} {phrase}, within its usual range "
                      f"(longest seen {for_phrase(longest * 1000.0)[4:]}, "
                      f"n={len(earlier)})")
        return out
    if spread == 0.0:
        # Every earlier hold was identical to the second — a timer, not a
        # person. Beyond it is novel and stated; a sigma against zero is not.
        out.reason = (f"{current!r} {phrase}; every earlier hold was "
                      f"{for_phrase(usual * 1000.0)[4:]} exactly, so there "
                      f"is no spread to score against")
        out.why = "flat"
        return out
    z = (math.log(held) - baseline) / spread
    out.score = z
    out.reason = (f"{current!r} {phrase} — {z:.1f} sigma beyond its usual "
                  f"{for_phrase(usual * 1000.0)[4:]} in log-time, and longer "
                  f"than any of its {len(earlier)} earlier holds (longest "
                  f"{for_phrase(longest * 1000.0)[4:]})")
    return out


# ── frequency ───────────────────────────────────────────────────────────────
#: One day, in seconds. ⚠️ A UNIT, NOT A WINDOW CONSTANT — the same distinction
#: `MIN_SAMPLES` draws about readings. `score_frequency` bins transitions per
#: day because a day is the period a villa's routine repeats on, and the number
#: of days it looks back is whatever the ring holds, never a number here.
_DAY_S: Final[float] = 86_400.0


def score_frequency(rows: Sequence[Mapping[str, Any]], now: float, *,
                    entity_id: str = "") -> Salience:
    """How often this entity changed in the last day, against its own days.

    ⚠️ BOTH TAILS ARE THE SIGNAL, AND THE LOW ONE IS ABSENCE. A door cycling
    thirty times in an hour is the high tail (a relay chattering, a latch not
    catching). A gate that opens every day and has not opened today is the low
    tail — and that is the only way "the thing that reliably happens did not"
    can be said without a rule per device. Both fall out of one comparison:
    today's count against the entity's own daily counts.

    ⚠️ IT IS `score_numeric` OVER DAILY COUNTS, NOT A THIRD ESTIMATOR. The
    population is one number per day, the observation is today's number, and
    the floor, the duty-cycle split, the flat-history guard and the reason
    format are all the ones that module already has. Writing a second z-score
    here would be the second copy this repository keeps paying for.

    Days are counted BACK FROM `now`, so "today" is the last twenty-four
    hours rather than the calendar day — a check at 09:00 comparing "since
    midnight" against whole days would find every entity quiet every morning.
    Only days the journal fully covers are population; the partial oldest one
    is dropped rather than counted short.
    """
    out = Salience(entity_id=entity_id, kind="frequency")
    stamps = [t for t in (_instant_s(r.get("at")) for r in rows) if t is not None]
    if not stamps:
        out.reason, out.why = "no history for this entity yet", "no_history"
        return out
    first = min(stamps)
    span_days = int((float(now) - first) // _DAY_S)
    counts = [0] * (span_days + 1)
    for t in stamps:
        age = int((float(now) - t) // _DAY_S)
        if 0 <= age <= span_days:
            counts[age] += 1
    # counts[0] is the last 24 h; counts[1..span_days-1] are complete days;
    # counts[span_days] is the partial oldest day and is dropped.
    complete = counts[1:span_days]
    samples = [{"day": f"-{i + 1}d", "value": float(c)}
               for i, c in enumerate(complete)]
    scored = score_numeric(samples, float(counts[0]), entity_id=entity_id,
                           basis="daily change count")
    scored.kind = "frequency"
    if scored.score is None:
        if scored.why == "too_few":
            # The floor is `score_numeric`'s; the NOUN is this lens's — see
            # `_thin`. "6 readings" would send a reader looking at a sensor.
            return _thin(scored, len(samples), "complete day(s) of change counts")
        return scored
    if scored.score == 0.0:
        scored.reason = "changed about as often as it usually does today"
        return scored
    direction = "more" if counts[0] > (scored.baseline or 0) else "fewer"
    if counts[0] == 0:
        scored.reason = (f"no change in the last day; it usually changes "
                        f"{scored.baseline:g} times a day ({scored.reason})")
    else:
        scored.reason = (f"changed {counts[0]} times in the last day, "
                        f"{direction} than its usual {scored.baseline:g} "
                        f"({scored.reason})")
    return scored


# ── ranking ─────────────────────────────────────────────────────────────────
def rank(scored: Sequence[Salience], *, limit: Optional[int] = None
         ) -> List[Salience]:
    """Most novel first, one block per lens. Unscorable entities keep their
    place at the end.

    ⚠️ THE LENSES ARE RANKED SEPARATELY AND PRESENTED AS BLOCKS, because a
    sigma, a boolean and a log-time ratio have no common unit. A novel state
    scores 1.0; treating that as "less salient than 1.1 sigma" would be a units
    error with a straight face. Blocks appear in `KINDS` order and every block
    that has something to say gets a share of the limit.

    ⚠️ THE SHARE IS RESERVED BY ROUND-ROBIN, AND THIS IS WHY (2026-09-04).
    Until this date the blocks were CONCATENATED and then cut: `numeric +
    novel + …` then `[:limit]`. On the reference villa the numeric block alone
    exceeds the document's limit on every pass — `doc_salient=25`, the limit
    exactly, eight passes out of eight — so no novel state ever reached the
    model, and a lock entering a state it had never been in was invisible to
    triage by construction from the day the categorical scorer shipped. A lens
    added after that would have shipped invisible the same way. So the set that
    fits is chosen by taking the best of each lens in turn until the limit is
    met; a lens with fewer candidates than its turn yields its slots to the
    others. Nothing here is a weight or a quota — no constant decides the
    split, and there is no constant to tune per villa.

    ⚠️ `limit` TRUNCATES THE SHOWN SET, WHICH IS THIS MODULE'S ONLY JOB — it
    does not discard anything. The caller keeps the full list; salience decides
    what fits in a context window, and that is a budget, not a judgement.
    """
    def _key(item: Salience) -> Tuple[float, str]:
        # ⚠️ NOVEL STATES SORT BY NAME: their score is a boolean, so ordering
        # them by it would be ordering by nothing.
        magnitude = 0.0 if item.kind == "categorical" else -(item.score or 0.0)
        return (magnitude, item.entity_id)

    blocks: Dict[str, List[Salience]] = {
        kind: sorted((s for s in scored if s.kind == kind and s.score),
                     key=_key)
        for kind in KINDS}
    quiet = sorted((s for s in scored if s.score == 0.0),
                   key=lambda s: s.entity_id)
    unscored = sorted((s for s in scored if s.score is None),
                      key=lambda s: s.entity_id)

    if limit is None:
        chosen = {kind: list(rows) for kind, rows in blocks.items()}
        rest = quiet + unscored
    else:
        chosen = {kind: [] for kind in KINDS}
        taken, turn = 0, 0
        while taken < limit and any(turn < len(blocks[k]) for k in KINDS):
            for kind in KINDS:
                if taken >= limit:
                    break
                if turn < len(blocks[kind]):
                    chosen[kind].append(blocks[kind][turn])
                    taken += 1
            turn += 1
        rest = (quiet + unscored)[:max(0, limit - taken)]

    out: List[Salience] = []
    for kind in KINDS:
        out.extend(chosen[kind])
    return out + rest


def kind_census(ranked: Sequence[Salience]) -> str:
    """`numeric=23,categorical=2` — what the document was actually given,
    per lens. ⚠️ THE INSTRUMENT THAT SETTLES WHETHER A LENS IS VISIBLE: a lens
    whose count reads 0 here on a villa where it scores something is a lens
    the ranking is cutting, and `doc_salient` alone could never say so."""
    counts: Dict[str, int] = {}
    for item in ranked:
        if item.score:
            counts[item.kind] = counts.get(item.kind, 0) + 1
    return ",".join(f"{k}={counts[k]}" for k in KINDS if k in counts) or "none"


def unscorable_census(scored: Sequence[Salience]) -> str:
    """`too_few=790,not_numeric=12` — WHY the unscorable were unscorable.

    ⚠️ THE QUESTION `doc_unscorable` COULD NOT ANSWER. It counted ~two thirds
    of the reference villa as unscorable and nothing said whether a new lens
    would reach any of them: `too_few` is history that time will supply,
    `not_numeric` is a lens that did not exist, `flat` is an entity nothing
    will ever score and that is an answer. Read this once before building a
    lens, and again after — it is what says whether the lens landed.
    """
    counts: Dict[str, int] = {}
    for item in unscorable(scored):
        key = item.why or "unstated"
        counts[key] = counts.get(key, 0) + 1
    return ",".join(f"{k}={v}" for k, v in sorted(counts.items())) or "none"


def unscorable(scored: Sequence[Salience]) -> List[Salience]:
    """Everything that could not be scored, with its stated reason.

    ⚠️ A FIRST-CLASS RESULT, NOT A LEFTOVER. "I could not assess 40 of your
    devices and here is why" is one of the most useful sentences this system can
    produce, and it is the honest half of a coverage claim — the current
    pipeline's inability to say it is what the old blueprint stand-down papered
    over (deleted in 2.755.0).
    """
    return [s for s in scored if s.score is None]
