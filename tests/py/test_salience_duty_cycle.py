"""A device that is either off or at load has two baselines, not one.

⚠️ FROM THE VILLA'S OWN DOCUMENT (2026-08-30). Triage read "Pool Pump drew
1704.6 VA against a median of 6.3 VA across 457 readings; this is 673 sigma
beyond normal and suggests a fault" — about a pump running exactly as it should.
It was flagged on three of four passes and each flag that reached an
investigation cost ~$0.37 to conclude nothing, while also crowding the rank-25
cut that decides what the agent may look at at all.

⚠️ THE NOISE WAS THE LESSER HALF. A pump at 400 W with a failing capacitor
scored hundreds of sigma too, so the number could not separate a healthy run
from a degraded one — the fault worth catching was invisible underneath the
false ones. That is the assertion this file exists for.
"""
from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.supervise.observe import salience  # noqa: E402


def _samples(values: List[float]) -> List[Dict[str, Any]]:
    return [{"day": "2026-08-30", "value": v} for v in values]


#: The pool pump's real shape: at rest most of the day, ~850 W while running.
PUMP = _samples([0.0] * 300 + [2.5, 3.1, 9.9] * 10
                + [792.3, 848.0, 850.5, 860.1, 911.1] * 25)


def _score(rows: List[Dict[str, Any]], observed: float) -> Any:
    return salience.score_numeric(rows, observed, entity_id="sensor.x",
                                  basis="journalled reading")


def test_an_ordinary_run_is_no_longer_extraordinary() -> None:
    """⚠️ THE REPORTED CASE. 850 W on a pump that runs at 850 W is not news."""
    out = _score(PUMP, 850.0)
    assert out.duty_cycled is True
    assert out.score is not None and out.score < 3.0, (
        f"a healthy run still scores {out.score} — it was 673 sigma")
    assert "while running" in out.reason, out.reason


def test_a_PART_LOADED_run_is_now_detectable() -> None:
    """⚠️ THE HALF THAT WAS INVISIBLE. 400 W is neither off nor at load — the
    failing-capacitor, blocked-impeller, cavitating case. It must outrank a
    healthy run by a wide margin, or the fix has only removed noise."""
    healthy = _score(PUMP, 850.0)
    degraded = _score(PUMP, 400.0)

    assert degraded.score is not None, (
        "a part-loaded run came back unscored — it used to be filed with the "
        "resting readings, where a flat baseline gives 'no spread to score "
        "against' and the fault disappears")
    assert degraded.score > 10 * (healthy.score or 0.0) + 10, (
        f"degraded {degraded.score} does not stand out from healthy "
        f"{healthy.score}")
    assert "part-loaded" in degraded.reason, degraded.reason


def test_resting_and_stopped_readings_stay_quiet() -> None:
    assert _score(PUMP, 0.0).score == 0.0
    resting = _score(PUMP, 2.0)
    assert resting.score is None or resting.score < 3.0


def test_a_UNIMODAL_sensor_is_untouched() -> None:
    """⚠️ THE COMMON PATH MUST NOT MOVE. A temperature or a humidity has one
    population, and this change may not alter a single number for it."""
    steady = _samples([20.0, 20.4, 19.6, 20.1, 20.8, 19.9,
                       20.2, 20.5, 19.7, 20.3, 20.0, 20.6])
    out = _score(steady, 27.0)
    assert out.duty_cycled is False
    assert out.score is not None and out.score > 5, out.reason
    assert "while" not in out.reason, "a unimodal reading gained a population"


def test_the_rule_generalises_beyond_the_pump(  # noqa: D103
) -> None:
    """⚠️ SCOPE, ASKED FOR EXPLICITLY. The same shape flagged six other subjects
    in two days — light circuits at 0/56 W, a fan, a jet pump. The split is
    measured against each series' OWN range and carries no wattage, so it must
    work at every scale without a per-device constant."""
    shapes = {
        "lit circuit": ([0.0] * 200 + [55.8, 56.16, 57.0] * 30, 56.0, 25.0),
        "extractor fan": ([0.0] * 150 + [29.5, 30.1, 30.8] * 40, 30.0, 14.0),
        "jet pump": ([0.0] * 120 + [830.0, 834.8, 840.0] * 40, 834.0, 400.0),
    }
    for name, (history, normal, degraded) in shapes.items():
        rows = _samples(history)
        good, bad = _score(rows, normal), _score(rows, degraded)
        assert good.duty_cycled, f"{name}: two populations not detected"
        assert good.score is not None and good.score < 3.0, (
            f"{name}: a normal run still scores {good.score}")
        assert bad.score is not None and bad.score > 10.0, (
            f"{name}: a part-loaded run scores {bad.score} and would be missed")


def test_a_side_too_thin_to_score_says_so() -> None:
    """⚠️ UNSCORABLE IS AN ANSWER. A device seen running twice has no running
    baseline; inventing one is the error this whole change undoes."""
    # 25 at rest, 5 running: the split is real (5 clears the 3-reading floor and
    # the 10% share) but 5 is under MIN_SAMPLES, so the RUNNING side has no
    # baseline even though the device is plainly duty-cycled.
    barely = _samples([0.0] * 25 + [898.0, 900.0, 902.0, 905.0, 907.0])
    out = _score(barely, 902.0)
    assert out.duty_cycled is True, out.reason
    assert out.score is None
    assert "needed before that side has a baseline" in out.reason, out.reason


def test_one_outlier_is_not_a_duty_cycle() -> None:
    """⚠️ BOTH SIDES MUST BE POPULATED. A single spike in an otherwise steady
    series is an outlier, and treating it as a second mode would give it its own
    baseline and silence it — the exact opposite of the intent."""
    spiky = _samples([20.0, 20.4, 19.6, 20.1, 20.8, 19.9,
                      20.2, 20.5, 19.7, 20.3, 20.0, 900.0])
    assert _score(spiky, 890.0).duty_cycled is False


def test_a_MODEST_gap_is_not_a_duty_CYCLE() -> None:
    """⚠️ THE GAP THRESHOLD, PINNED ON ITS OWN.

    Mutation testing found `_BIMODAL_MIN_GAP` free: every fixture here that is
    meant to be unimodal has its widest band near an END, so the population
    FLOOR refused the split first and the gap constant could be set to zero
    with the suite still green. Two guards, one of them doing all the work and
    the other only appearing to.

    This series clusters mildly — the widest band is ~29% of the range, with
    six readings either side, so the floor cannot save it. Only the gap rule
    can, which is what makes this the test that measures it."""
    mild = _samples([20.0, 20.1, 20.2, 20.3, 20.4, 20.5,
                     20.9, 21.0, 21.1, 21.2, 21.3, 21.4])
    out = _score(mild, 27.0)
    assert out.duty_cycled is False, out.reason
    assert "while" not in out.reason, out.reason
