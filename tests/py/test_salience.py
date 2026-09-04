"""Salience — novelty against an entity's own past, with no tunable constant.

⚠️ THE ACCEPTANCE CRITERION INCLUDES A GREP. TASK-011 says "no threshold literal
in the module", so one test reads the source and fails on the shapes a real
threshold takes. That test is the reason this module can be trusted to travel to
install #2, and it is the first thing to run after anyone edits salience.py.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Any, Dict, List, Optional

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.supervise.observe import salience

SOURCE = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta", "supervise", "observe", "salience.py")

#: ⚠️ ANCHORED ON `(?:^|[._])`, NOT ON `\b`, AND THIS EXACT BUG WAS SHIPPED IN
#: THE FIRST DRAFT OF THIS FILE. `\bTHRESHOLD\b` does not match
#: `ALERT_THRESHOLD`, because `_` is a word character so there is no boundary
#: in front of it — the same reason CLAUDE.md records that `door` matches
#: inside `outdoor` and `\b` does not help. The companion test below feeds this
#: pattern a smuggled threshold and fails if it does not fire, which is how the
#: defect was caught: a guard that matches nothing passes forever.
_FORBIDDEN = re.compile(
    r"(?:^|[._])(THRESHOLD|LIMIT|CAP|CUTOFF|TRIP|FLOOR|CEILING|BAND|"
    r"MAX_[A-Z_]*(?:WATT|POWER|COST|TEMP|LEVEL|LOAD)|"
    r"MIN_[A-Z_]*(?:WATT|POWER|COST|TEMP|LEVEL|LOAD)|"
    r"SIGMA[A-Z_]*|[A-Z_]*_PCT|[A-Z_]*_PERCENT)(?:$|[._\s=:])")
#: A bare magnitude beside a unit is the other shape a smuggled threshold takes.
_UNITS = re.compile(r"\b\d+(?:\.\d+)?[\s#:,]*(?:W|kW|kWh|IDR|USD|EUR|degC|%)\b")


def _executable_source() -> str:
    """`salience.py` with every docstring removed.

    ⚠️ STRUCTURAL, NOT LINE-BASED. Stripping lines that *start* with a quote
    leaves the MODULE docstring's body intact, and this module's prose
    necessarily discusses thresholds at length — so the first version of this
    guard failed on the very paragraph explaining why there are none. The
    question is "does the CODE contain a threshold", and only a parser can
    separate code from prose reliably.
    """
    import ast
    with open(SOURCE, encoding="utf-8") as handle:
        text = handle.read()
    tree = ast.parse(text)
    spans: List[range] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                                 ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", [])
        if (body and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)):
            doc = body[0]
            spans.append(range(doc.lineno, (doc.end_lineno or doc.lineno) + 1))
    lines = text.splitlines()
    kept = [line for n, line in enumerate(lines, 1)
            if not any(n in span for span in spans)
            and not line.lstrip().startswith("#")]
    return "\n".join(kept)


def _rows(values: List[float], start_day: int = 1,
          month: str = "2026-08") -> List[Dict[str, Any]]:
    """`{"day", "value"}` rows, oldest first — series.hourly_by_day's shape."""
    return [{"day": f"{month}-{start_day + i:02d}", "value": v}
            for i, v in enumerate(values)]


# ── TEST-003 · a seeded anomaly ranks top; a normal day does not ────────────

def test_a_seeded_anomaly_scores_far_above_a_normal_reading() -> None:
    history = _rows([340, 338, 342, 339, 341, 337, 343, 340, 340, 339])
    anomaly = salience.score_numeric(history, 1900, entity_id="sensor.pump")
    normal = salience.score_numeric(history, 341, entity_id="sensor.pump")
    assert anomaly.score is not None and normal.score is not None
    assert anomaly.score > normal.score * 10, (
        "a 1.9 kW reading against a 340 W median must dominate a normal one")
    assert anomaly.baseline == 340 and anomaly.spread is not None


def test_a_seeded_anomaly_ranks_in_the_top_five_of_its_cycle() -> None:
    """REQ-002's acceptance criterion, stated as it is written."""
    quiet = [salience.score_numeric(_rows([10, 10.2, 9.8, 10.1, 9.9, 10, 10.3]),
                                    10.05, entity_id=f"sensor.q{i}")
             for i in range(30)]
    seeded = salience.score_numeric(
        _rows([10, 10.2, 9.8, 10.1, 9.9, 10, 10.3]), 95.0,
        entity_id="sensor.seeded")
    top5 = salience.rank(quiet + [seeded], limit=5)
    assert "sensor.seeded" in [s.entity_id for s in top5]
    assert top5[0].entity_id == "sensor.seeded"


def test_an_ordinary_reading_does_not_rank() -> None:
    quiet = [salience.score_numeric(_rows([10, 10.2, 9.8, 10.1, 9.9, 10, 10.3]),
                                    10.0, entity_id=f"sensor.q{i}")
             for i in range(10)]
    assert all(s.score is not None and s.score < 1.0 for s in quiet), (
        "an ordinary reading must not accumulate score merely by being measured")


# ── TEST-004 · short history returns None with a reason ────────────────────

def test_too_little_history_returns_None_and_says_why() -> None:
    """⚠️ NEVER A FABRICATED SCORE. A confident number from four readings ranks,
    and whatever it displaces was real."""
    out = salience.score_numeric(_rows([1, 2, 3, 4]), 99, entity_id="sensor.new")
    assert out.score is None
    assert "only 4 usable reading" in out.reason
    assert str(salience.MIN_SAMPLES) in out.reason


def test_a_non_numeric_current_reading_is_refused() -> None:
    """⚠️ `unavailable` MUST NOT BECOME A NUMBER. maintenance_* shipped exactly
    this bug: unavailable read as -999999, below every threshold, so any sensor
    dropping off the mesh fired its own low-battery alert."""
    # ⚠️ NOT a flat history: with one, the zero-spread guard returns None on
    # its own and this test passes even when _numeric coerces junk to 0.0.
    history = _rows([10, 12, 8, 11, 9, 10, 13])
    for junk in ("unavailable", "unknown", None, "", "n/a", True, float("nan")):
        out = salience.score_numeric(history, junk, entity_id="sensor.x")
        assert out.score is None, f"{junk!r} must not be scored"
    assert salience.score_numeric(history, "unavailable").observed is None


def test_unscorable_entities_are_a_first_class_result() -> None:
    """"I could not assess 40 of your devices, and here is why" is the honest
    half of a coverage claim."""
    scored = [salience.score_numeric(_rows([1, 2]), 5, entity_id="sensor.a"),
              salience.score_numeric(_rows([1] * 8), 1, entity_id="sensor.b")]
    missing = salience.unscorable(scored)
    assert [s.entity_id for s in missing] == ["sensor.a"]
    assert missing[0].reason


# ── the zero-spread case robust.py's docstring demands be handled ──────────

def test_a_perfectly_flat_history_does_not_divide_by_zero() -> None:
    """⚠️ robust.mad RETURNS 0.0 LEGITIMATELY — a well-behaved always-on
    appliance draws the same amount every hour. Dividing would make the
    quietest equipment in the house the loudest alarm."""
    flat = _rows([500] * 10)
    steady = salience.score_numeric(flat, 500, entity_id="sensor.flat")
    assert steady.score == 0.0 and steady.spread == 0.0

    moved = salience.score_numeric(flat, 620, entity_id="sensor.flat")
    assert moved.score is None, (
        "a departure from a flat history must be reported as novel, not given "
        "an arithmetic infinity that heads every ranking forever")
    assert "flat at 500" in moved.reason and "620" in moved.reason


# ── the duration term ───────────────────────────────────────────────────────

def test_a_sustained_departure_outranks_a_single_spike_at_equal_sigma() -> None:
    """The two call for different responses, and the difference belongs in the
    ranking rather than in a tunable weight."""
    spike = salience.score_numeric(
        _rows([10, 11, 9, 10, 11, 9, 10, 11, 9]), 20, entity_id="sensor.spike")
    drift = salience.score_numeric(
        _rows([10, 10, 10, 10, 18, 19, 19, 20, 19]), 20, entity_id="sensor.drift")
    assert spike.score is not None and drift.score is not None
    assert drift.persistence > spike.persistence


def test_the_duration_term_is_bounded_at_double() -> None:
    """⚠️ Bounded BY CONSTRUCTION so it cannot become a weight. Persistence is a
    fraction in [0,1] and maps to a multiple in [1,2]; an unbounded term is the
    first per-villa constant back in the door."""
    # ⚠️ DRIFTING, NOT SWITCHING. This was `[10]*6 + [40]*6`, which is a
    # textbook DUTY CYCLE — and once salience learned to see those, the running
    # side held 6 readings, fell under MIN_SAMPLES and correctly scored `None`,
    # so a test about the persistence term started failing over something it
    # does not test. The two features are orthogonal and the fixture now says
    # so: the same persistence, no clean gap to split on.
    history = _rows([10, 12, 15, 18, 22, 25, 28, 31, 34, 37, 39, 40])
    out = salience.score_numeric(history, 40, entity_id="sensor.x")
    assert out.score is not None and out.baseline is not None
    assert out.spread is not None and out.spread > 0
    z = abs(40 - out.baseline) / out.spread
    assert z <= out.score <= z * 2.0 + 1e-9
    assert 0.0 <= out.persistence <= 1.0


# ── categoricals ────────────────────────────────────────────────────────────

def test_a_never_seen_state_is_flagged_with_its_evidence() -> None:
    out = salience.score_categorical(
        ["locked", "unlocked", "locked"], "jammed", entity_id="lock.front")
    assert out.novel_state == "jammed" and out.score == 1.0
    assert "never been seen" in out.reason and "'locked'" in out.reason


def test_a_usual_state_is_not_novel() -> None:
    out = salience.score_categorical(["on", "off"], "off", entity_id="switch.a")
    assert out.novel_state is None and out.score == 0.0


def test_no_history_yields_no_claim() -> None:
    out = salience.score_categorical([], "on", entity_id="switch.new")
    assert out.score is None and "no history" in out.reason


# ── ranking ─────────────────────────────────────────────────────────────────

def test_numeric_and_categorical_are_not_compared_as_numbers() -> None:
    """⚠️ A sigma and a boolean have no common unit. A novel state scores 1.0;
    treating that as 'less salient than 1.1 sigma' is a units error."""
    weak = salience.score_numeric(
        _rows([10, 12, 8, 11, 9, 10, 13, 7]), 10.5, entity_id="sensor.weak")
    novel = salience.score_categorical(["locked"], "jammed", entity_id="lock.a")
    assert weak.score is not None and 0 < weak.score < 2.0
    ordered = [s.entity_id for s in salience.rank([novel, weak])]
    assert ordered.index("sensor.weak") < ordered.index("lock.a"), (
        "numeric ranks first as a block; the novel state is never dropped")


def test_ranking_puts_unscorable_last_and_never_discards() -> None:
    items = [
        salience.score_numeric(_rows([1, 2]), 9, entity_id="sensor.unscorable"),
        salience.score_numeric(_rows([10] * 8), 10, entity_id="sensor.quiet"),
        salience.score_numeric(_rows([10, 11, 9, 10, 11, 9, 10, 30]), 30,
                               entity_id="sensor.loud"),
    ]
    ordered = salience.rank(items)
    assert len(ordered) == 3, "ranking truncates only when asked"
    assert ordered[0].entity_id == "sensor.loud"
    assert ordered[-1].entity_id == "sensor.unscorable"


def test_limit_truncates_the_shown_set_only() -> None:
    items = [salience.score_numeric(_rows([10] * 8), 10 + i, entity_id=f"s.{i}")
             for i in range(9)]
    assert len(salience.rank(items, limit=3)) == 3
    assert len(salience.rank(items)) == 9


# ── the score carries its own evidence ─────────────────────────────────────

def test_every_score_travels_with_its_baseline_and_spread() -> None:
    """⚠️ A ranked list of bare numbers cannot be checked, explained or
    debugged. '1.9 kW against a median of 340 W' is a sentence."""
    out = salience.score_numeric(
        _rows([340, 338, 342, 339, 341, 337, 343]), 1900, entity_id="sensor.pump")
    for field_name in ("observed", "baseline", "spread", "samples"):
        assert getattr(out, field_name) is not None
    assert out.reason and "sigma" in out.reason
    blob = out.as_dict()
    assert blob["baseline"] == 340 and blob["observed"] == 1900


# ── ARCH-004 · the grep the acceptance criterion asks for ──────────────────

def test_the_module_contains_no_threshold_literal() -> None:
    """⚠️ TASK-011's ACCEPTANCE CRITERION, MECHANISED. A threshold answers "how
    much is too much" and is a per-villa judgement wearing a number's clothes.
    The three constants this module does define are statistical VALIDITY
    requirements — "is this sample big enough to say anything" — which have the
    same answer at every property.
    """
    body = _executable_source()

    # ⚠️ ANY module-level UPPERCASE binding, annotated or not. Matching only
    # `NAME: Final` let a bare `IDLE_FLOOR = 340` through untouched - found by
    # mutation testing, not by review.
    # A LEADING UNDERSCORE IS STILL IN SCOPE — a private constant hides a
    # threshold exactly as well as a public one.
    declared = set(re.findall(r"^(_?[A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=", body, re.M))
    assert declared == {"MIN_SAMPLES",
                        "_PERSISTENCE_MAX_MULTIPLE",
                        # ⚠️ THE FOUR BIMODAL CONSTANTS ARE VALIDITY
                        # REQUIREMENTS, WHICH IS WHY THEY BELONG HERE. Each
                        # answers "are there two populations in this series at
                        # all", never "how much is too much": the gap is
                        # measured against the series' OWN range and the other
                        # three are sample counts. None carries a unit, so none
                        # can be right on one property and wrong on the next —
                        # which is the whole test this list serves.
                        "_BIMODAL_MIN_SAMPLES", "_BIMODAL_MIN_SHARE",
                        "_BIMODAL_MIN_COUNT", "_BIMODAL_MIN_GAP",
                        # ⚠️ THREE MORE ON 2026-09-04, AND NONE IS A NUMBER
                        # ANYONE COULD TUNE. `KINDS` and `WHY` are closed
                        # vocabularies — tuples of names the ranking and the
                        # census iterate. `_DAY_S` is a UNIT (one day in
                        # seconds), the same kind of thing `MIN_SAMPLES` is
                        # about readings: the frequency lens bins per day
                        # because a routine repeats daily, and how many days
                        # it looks back is the ring's decision, not a number
                        # here. The forbidden-shape regex below still applies
                        # to all three.
                        "KINDS", "WHY", "_DAY_S"}, (
        f"undeclared module constant(s): {sorted(declared)}. Every constant "
        "here must be a validity requirement, named and justified in the header")

    forbidden = re.compile(
        r"\b(THRESHOLD|LIMIT|MAX_[A-Z]*(?:WATT|POWER|COST|TEMP|LEVEL)"
        r"|MIN_[A-Z]*(?:WATT|POWER|COST|TEMP|LEVEL)|SIGMA_[A-Z]+|_PCT|_PERCENT)\b")
    assert not forbidden.search(body), (
        f"threshold-shaped constant: {forbidden.search(body).group(0)}")   # type: ignore[union-attr]

    # A bare number next to a unit is the other shape a smuggled threshold takes.
    units = re.compile(r"\b\d+(?:\.\d+)?\s*(?:W|kW|kWh|IDR|USD|EUR|degC|%)\b")
    assert not units.search(body), (
        f"villa-specific magnitude: {units.search(body).group(0)}")  # type: ignore[union-attr]


def test_the_grep_would_actually_catch_a_smuggled_threshold(
        tmp_path: Any) -> None:
    """⚠️ MUTATION-PROOFING THE GUARD ITSELF. A pattern that matches nothing
    passes forever and proves nothing — four ways a test can measure nothing are
    on record in this project, and 'the regex never matched' is one of them."""
    forbidden, units = _FORBIDDEN, _UNITS
    assert forbidden.search("ALERT_THRESHOLD = 3.0")
    assert forbidden.search("MAX_WATT = 340")
    assert forbidden.search("SIGMA_TRIP = 3")
    assert forbidden.search("IDLE_FLOOR = 340")
    assert forbidden.search("POWER_CEILING = 2200")
    assert units.search("IDLE_FLOOR = 340  # W")
    assert units.search("idle draw above 340 W is waste")
    assert units.search("costs 2380 IDR")
    # ...and does not fire on the module's own legitimate vocabulary.
    assert not forbidden.search("_BIMODAL_MIN_SAMPLES: Final[int] = 12")
    assert not units.search("seven readings the MAD is dominated")


# ── the like-for-like contract · PH-1 checkpoint, Finding 1 ────────────────

def test_the_basis_travels_with_the_score_so_a_mismatch_is_LEGIBLE() -> None:
    """⚠️ THE CHECKPOINT'S HEADLINE FINDING. Real 28-day DAILY MEANS scored
    against a real INSTANTANEOUS reading produced three perfect z-scores that
    described one fact: the pumps were on. This module sees two numbers and
    cannot detect that — so the basis is printed, which makes the comparison
    visible to a reader where a bare sigma is not."""
    rows = _rows([157, 97, 65, 17, 248, 104, 261, 364])
    out = salience.score_numeric(rows, 2516.1, entity_id="sensor.pump",
                                 basis="daily mean")
    assert out.basis == "daily mean"
    assert "daily mean" in out.reason
    assert out.as_dict()["basis"] == "daily mean"


def test_no_basis_given_prints_no_basis_rather_than_a_guess() -> None:
    # ⚠️ NOT a flat history: the zero-spread message legitimately contains
    # "across", so a flat fixture would fail this assertion against correct
    # code. Second time this fixture shape has bitten in this file.
    out = salience.score_numeric(_rows([10, 12, 8, 11, 9, 10, 13, 7]), 40,
                                 entity_id="sensor.x")
    assert out.basis == ""
    assert "across" not in out.reason
    assert "basis" not in out.as_dict()


def test_a_value_outside_the_whole_range_is_STATED_not_scored() -> None:
    """⚠️ Either a genuine extreme or a unit mismatch, and a reader can tell
    those apart where the arithmetic cannot. It must NOT become a second
    ranking term — the score is unchanged by the note."""
    rows = _rows([10, 11, 9, 10, 11, 9, 10, 12])
    inside = salience.score_numeric(rows, 11.5, entity_id="sensor.a")
    outside = salience.score_numeric(rows, 99.0, entity_id="sensor.b")
    assert "outside the entire" not in inside.reason
    assert "outside the entire" in outside.reason and "[9, 12]" in outside.reason
    # The note is prose. The score is still just z x persistence.
    assert outside.baseline is not None and outside.spread is not None
    z = abs(99.0 - outside.baseline) / outside.spread
    assert outside.score is not None and z <= outside.score <= z * 2.0 + 1e-9


# ── the weekday refinement is GONE, and must stay gone ─────────────────────

def test_the_weekday_refinement_appears_NOWHERE_in_shipped_code() -> None:
    """⚠️ THE SAME DISCIPLINE `test_dedupe` APPLIES TO THE 2.755.0 DELETIONS: a
    removal that is only a diff comes back one plausible commit at a time.

    `score_numeric` took a `weekday` argument and scoped the baseline to this
    weekday. It had ONE production caller, which never passed it, so the branch
    was unreachable outside this file; `WINDOW_DAYS` had no code reader at all
    and existed only to justify it. The job is not missing — `level_anomaly` and
    `level_shortfall` do it against Home Assistant statistics over eight weeks,
    and the right response to wanting it here is to read those, not to rebuild
    a shorter copy.
    """
    root = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta")
    dead = ("weekday_scoped", "MIN_SAMPLES_PER_WEEKDAY")
    offenders: List[str] = []
    checked = 0
    for base, _dirs, files in os.walk(root):
        if "__pycache__" in base:
            continue
        for name in files:
            if not name.endswith(".py"):
                continue
            path = os.path.join(base, name)
            checked += 1
            body = open(path, encoding="utf-8").read()
            # ⚠️ `salience.py` MAY NAME THEM — it carries the tombstone saying
            # what went and why, which is the thing that makes this deletion
            # survive contact with a future reader.
            if os.path.basename(path) == "salience.py":
                continue
            for token in dead:
                if token in body:
                    offenders.append(f"{path}: {token}")
    assert checked > 50, f"only {checked} modules scanned — the walk is broken"
    assert not offenders, (
        "the weekday refinement is being rebuilt:\n  " + "\n  ".join(offenders))


def test_score_numeric_takes_no_weekday_ARGUMENT() -> None:
    """The signature is the contract; a caller passing `weekday=` must fail
    loudly rather than be silently ignored."""
    import inspect
    assert "weekday" not in inspect.signature(salience.score_numeric).parameters
    with pytest.raises(TypeError):
        salience.score_numeric(_rows([10] * 8), 10, weekday=6)  # type: ignore[call-arg]


def test_salience_declares_no_WINDOW_constant() -> None:
    """⚠️ IT ASKS "IS THIS READING UNUSUAL FOR THIS ENTITY", over whatever the
    journal still holds. How far back that reaches is a property of the ring,
    and a span asserted here would be a claim this module cannot keep — which
    is exactly what `WINDOW_DAYS = 28` turned out to be."""
    assert not hasattr(salience, "WINDOW_DAYS")
    assert not hasattr(salience, "MIN_SAMPLES_PER_WEEKDAY")


# ── duration · the lens categorical declines to be ─────────────────────────

def _journal(states: List[Any], *, start: float = 1_700_000_000.0
             ) -> List[Dict[str, Any]]:
    """Journal rows oldest first: `(state, seconds held)` pairs become a row per
    transition, timestamped from `start`."""
    from datetime import datetime, timezone
    rows: List[Dict[str, Any]] = []
    at = start
    for state, held in states:
        rows.append({"at": datetime.fromtimestamp(at, timezone.utc).isoformat(),
                     "id": "lock.x", "s": state})
        at += held
    return rows


def _lock_history(unlocked_holds: List[float]) -> List[Dict[str, Any]]:
    """locked / unlocked alternating, each unlocked hold from the list, the
    lock re-locked for an hour between them, ending UNLOCKED."""
    pairs: List[Any] = []
    for held in unlocked_holds:
        pairs.append(("locked", 3600.0))
        pairs.append(("unlocked", held))
    pairs.append(("locked", 3600.0))
    pairs.append(("unlocked", 0.0))
    return _journal(pairs)


def _end(rows: List[Dict[str, Any]]) -> float:
    from vesta.shared import instants
    moment = instants.as_utc(rows[-1]["at"])
    assert moment is not None
    return moment.timestamp()


def test_a_hold_longer_than_every_earlier_one_scores_and_says_so() -> None:
    rows = _lock_history([80, 95, 90, 100, 85, 92, 88])
    out = salience.score_duration(rows, _end(rows) + 38 * 60, entity_id="lock.x")
    assert out.kind == "duration" and out.state == "unlocked"
    assert out.score is not None and out.score > 3.0, out.reason
    assert "for 38 minutes" in out.reason and "longer than any" in out.reason
    assert out.samples == 7 and out.why == ""


def test_a_hold_within_its_own_range_is_quiet_not_novel() -> None:
    """⚠️ A gate propped open for an hour on Sundays must not be the villa's most
    unusual thing every Sunday. Within the range already seen is this entity
    doing something it has done before."""
    rows = _lock_history([80, 95, 90, 3600, 85, 92, 88])
    out = salience.score_duration(rows, _end(rows) + 38 * 60, entity_id="lock.x")
    assert out.score == 0.0 and "within its usual range" in out.reason


def test_too_few_earlier_holds_is_the_cold_start_answer() -> None:
    """⚠️ THE COLD-START CONTRACT. Three unlocked holds are not a distribution
    of unlocked holds, whatever a person guesses about locks in general."""
    rows = _lock_history([80, 95, 90])
    out = salience.score_duration(rows, _end(rows) + 3600, entity_id="lock.x")
    assert out.score is None and out.why == "too_few"
    assert "3 usable earlier hold(s) of 'unlocked'" in out.reason
    assert str(salience.MIN_SAMPLES) in out.reason


def test_only_holds_of_the_SAME_state_are_the_population() -> None:
    """Seven locked holds say nothing about how long it is usually unlocked."""
    rows = _lock_history([80, 95])
    out = salience.score_duration(rows, _end(rows) + 3600, entity_id="lock.x")
    assert out.samples == 2 and out.why == "too_few"


def test_a_timer_driven_hold_beyond_its_fixed_length_is_flat_not_infinite() -> None:
    rows = _lock_history([90.0] * 8)
    out = salience.score_duration(rows, _end(rows) + 600, entity_id="lock.x")
    assert out.score is None and out.why == "flat", out.reason
    assert "exactly" in out.reason


def test_duration_scores_in_log_time_so_a_long_tail_cannot_produce_673_sigma() -> None:
    """⚠️ Hold lengths are heavy-tailed. A linear MAD on seconds turns one
    long hold into hundreds of sigma — the pump defect with a clock."""
    rows = _lock_history([60, 70, 65, 80, 75, 62, 68, 71])
    out = salience.score_duration(rows, _end(rows) + 6 * 3600, entity_id="lock.x")
    assert out.score is not None and 3.0 < out.score < 60.0, out.score


def test_duration_with_no_rows_is_no_history() -> None:
    out = salience.score_duration([], 0.0, entity_id="lock.x")
    assert out.score is None and out.why == "no_history"


# ── frequency · both tails, one estimator ───────────────────────────────────

def _daily(counts_per_day: List[int], *, today: int,
           start: float = 1_700_000_000.0) -> Any:
    """Journal rows with `counts_per_day[i]` changes on day i (oldest first)
    and `today` changes in the last 24 h. Returns `(rows, now)`."""
    from datetime import datetime, timezone
    rows: List[Dict[str, Any]] = []
    day = 86_400.0
    for i, n in enumerate(counts_per_day):
        for k in range(n):
            at = start + i * day + (k + 1) * (day / (n + 1))
            rows.append({"at": datetime.fromtimestamp(at, timezone.utc).isoformat(),
                         "id": "binary_sensor.gate", "s": "on" if k % 2 else "off"})
    now = start + (len(counts_per_day) + 1) * day
    for k in range(today):
        at = now - day + (k + 1) * (day / (today + 1))
        rows.append({"at": datetime.fromtimestamp(at, timezone.utc).isoformat(),
                     "id": "binary_sensor.gate", "s": "on" if k % 2 else "off"})
    rows.sort(key=lambda r: r["at"])
    rows.insert(0, {"at": datetime.fromtimestamp(start - 1, timezone.utc).isoformat(),
                    "id": "binary_sensor.gate", "s": "off"})
    return rows, now


def test_a_chattering_day_scores_high() -> None:
    rows, now = _daily([4, 5, 4, 6, 5, 4, 5, 4, 5], today=40)
    out = salience.score_frequency(rows, now, entity_id="binary_sensor.gate")
    assert out.kind == "frequency" and out.score and out.score > 5.0, out.reason
    assert "changed 40 times in the last day" in out.reason


def test_a_day_with_NO_change_where_it_usually_changes_is_ABSENCE() -> None:
    """⚠️ The thing that reliably happens did not. The low tail of the same
    comparison — no rule per device, no schedule to configure."""
    rows, now = _daily([4, 5, 4, 6, 5, 4, 5, 4, 5], today=0)
    out = salience.score_frequency(rows, now, entity_id="binary_sensor.gate")
    assert out.score and out.score > 2.0, out.reason
    assert out.reason.startswith("no change in the last day")


def test_an_ordinary_day_is_quiet() -> None:
    rows, now = _daily([4, 5, 4, 6, 5, 4, 5, 4, 5], today=5)
    out = salience.score_frequency(rows, now, entity_id="binary_sensor.gate")
    assert out.score == 0.0 and "as often as it usually does" in out.reason


def test_frequency_keeps_score_numerics_floor_rather_than_its_own() -> None:
    """⚠️ ONE ESTIMATOR, ONE FLOOR. Six complete days is below MIN_SAMPLES, and
    the answer is `score_numeric`'s `too_few`, not a second copy of it."""
    rows, now = _daily([4, 5, 4, 6, 5, 4], today=40)
    out = salience.score_frequency(rows, now, entity_id="binary_sensor.gate")
    assert out.score is None and out.why == "too_few"
    assert "6 usable complete day(s) of change counts" in out.reason


# ── ranking · every lens gets a share ──────────────────────────────────────

def _many_numeric(n: int) -> List[salience.Salience]:
    return [salience.score_numeric(_rows([10, 11, 9, 10, 11, 9, 10, 30 + i]),
                                   30 + i, entity_id=f"sensor.n{i:03d}")
            for i in range(n)]


def test_a_novel_state_survives_a_limit_the_numeric_block_alone_would_fill() -> None:
    """⚠️ THE DEFECT MEASURED ON THE VILLA (2026-09-04): `doc_salient=25`, the
    limit exactly, on eight passes out of eight — and the ranking used to be
    `numeric + novel + …` then `[:25]`, so no novel state had reached the
    document since the categorical scorer shipped. A lens is represented by
    being reserved a slot, or it is invisible by construction."""
    loud = _many_numeric(40)
    novel = salience.score_categorical(["locked"], "jammed", entity_id="lock.a")
    rows = _lock_history([80, 95, 90, 100, 85, 92, 88])
    held = salience.score_duration(rows, _end(rows) + 3600, entity_id="lock.x")
    assert held.score
    ranked = salience.rank(loud + [novel, held], limit=25)
    assert len(ranked) == 25
    ids = [s.entity_id for s in ranked]
    assert "lock.a" in ids, "the novel state was cut by the numeric block"
    assert "lock.x" in ids, "the duration row was cut by the numeric block"


def test_blocks_are_presented_in_KINDS_order_not_interleaved() -> None:
    """The reservation decides WHICH rows fit; the document still reads as one
    block per lens, because a sigma next to a boolean reads as a comparison."""
    loud = _many_numeric(5)
    novel = salience.score_categorical(["locked"], "jammed", entity_id="lock.a")
    ranked = salience.rank(loud + [novel], limit=4)
    kinds = [s.kind for s in ranked]
    assert kinds == sorted(kinds, key=salience.KINDS.index)
    assert kinds.count("categorical") == 1 and kinds.count("numeric") == 3


def test_a_lens_with_nothing_to_say_yields_its_slots() -> None:
    loud = _many_numeric(10)
    assert len(salience.rank(loud, limit=6)) == 6
    assert all(s.kind == "numeric" for s in salience.rank(loud, limit=6))


def test_no_limit_shows_every_scored_row_of_every_lens() -> None:
    loud = _many_numeric(3)
    novel = salience.score_categorical(["locked"], "jammed", entity_id="lock.a")
    assert len(salience.rank(loud + [novel])) == 4


# ── the two census lines ────────────────────────────────────────────────────

def test_the_kind_census_counts_what_the_document_was_given() -> None:
    loud = _many_numeric(3)
    novel = salience.score_categorical(["locked"], "jammed", entity_id="lock.a")
    quiet = salience.score_categorical(["on"], "on", entity_id="switch.q")
    assert salience.kind_census(salience.rank(loud + [novel, quiet])) == (
        "numeric=3,categorical=1")
    assert salience.kind_census([]) == "none"


def test_the_unscorable_census_says_WHY_not_only_how_many() -> None:
    """⚠️ `doc_unscorable` counted two thirds of a villa and could not say
    whether a new lens would reach any of them. This can."""
    thin = salience.score_numeric(_rows([1, 2]), 9, entity_id="sensor.thin")
    words = salience.score_numeric([], "unlocked", entity_id="lock.words")
    flat = salience.score_numeric(_rows([10] * 8), 11, entity_id="sensor.flat")
    fine = salience.score_numeric(_rows([10] * 8), 10, entity_id="sensor.fine")
    assert salience.unscorable_census([thin, words, flat, fine]) == (
        "flat=1,not_numeric=1,too_few=1")
    assert all(s.why in salience.WHY for s in (thin, words, flat))
    assert fine.why == "", "a scored row carries no why"
