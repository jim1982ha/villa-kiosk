"""Robust statistics — the properties, not just examples.

These functions decide whether a villa's owner is told their freezer is
failing. The plan calls for PROPERTY tests here rather than a handful of
worked examples, because the failure that matters is not "median(1,2,3) != 2",
it is "one bad hour in a month moved the answer past a threshold".
"""

from __future__ import annotations

from typing import List

from vesta.shared.analysis.robust import (
    MAD_TO_SIGMA,
    mad,
    median,
    percentile,
    relative_change,
    robust_sigma,
    trimmed,
)


def test_no_data_is_none_never_zero() -> None:
    """⚠️ THE RULE THAT RUNS THROUGH THIS WHOLE SUBSYSTEM. "No data" and
    "measured zero" are different findings, and a report stating 0 for a meter
    that said nothing states a measurement nobody took."""
    assert median([]) is None
    assert mad([]) is None
    assert percentile([], 0.5) is None
    assert robust_sigma([]) is None


def test_median_basics() -> None:
    assert median([3.0, 1.0, 2.0]) == 2.0
    assert median([4.0, 1.0, 3.0, 2.0]) == 2.5
    assert median([7.0]) == 7.0


# ── the properties ───────────────────────────────────────────────────────────

def test_median_resists_a_single_wild_outlier() -> None:
    """The whole reason the mean is not used. A recorder restart can report a
    single 40x hour; a mean walks past any threshold, a median does not care."""
    clean: List[float] = [1.0] * 30
    with_spike = clean + [4000.0]
    assert median(with_spike) == 1.0
    assert sum(with_spike) / len(with_spike) > 100, "fixture must actually be wild"


def test_median_tolerates_almost_half_the_sample_being_nonsense() -> None:
    """MAD's advertised breakdown point is 50%. Checked just under it, so the
    test states the guarantee rather than assuming it."""
    values = [1.0] * 26 + [9999.0] * 24
    assert median(values) == 1.0


def test_scale_invariance() -> None:
    """⚠️ THE PROPERTY THAT MAKES THIS PORTABLE. A 3 kW heat pump and a 40 W
    router must be judged identically — so scaling every value by k must scale
    the centre and the spread by k, and leave any RATIO untouched."""
    base = [1.0, 2.0, 2.0, 3.0, 10.0]
    for k in (0.001, 0.5, 1000.0):
        scaled = [v * k for v in base]
        assert abs((median(scaled) or 0) - (median(base) or 0) * k) < 1e-9
        assert abs((mad(scaled) or 0) - (mad(base) or 0) * k) < 1e-9
        # The ratio is what a threshold is expressed in, and it must not move.
        left = relative_change(median(base) or 1, 3.0)
        right = relative_change(median(scaled) or 1, 3.0 * k)
        assert left is not None and right is not None
        assert abs(left - right) < 1e-9


def test_translation_moves_the_centre_and_not_the_spread() -> None:
    base = [1.0, 2.0, 2.0, 3.0, 10.0]
    shifted = [v + 100.0 for v in base]
    assert abs((median(shifted) or 0) - ((median(base) or 0) + 100.0)) < 1e-9
    assert abs((mad(shifted) or 0) - (mad(base) or 0)) < 1e-9


def test_mad_is_zero_for_a_constant_series_and_that_is_legitimate() -> None:
    """⚠️ EVERY CALLER MUST HANDLE THIS. A well-behaved always-on appliance
    genuinely draws the same amount every hour. Any threshold of the form
    `median + k * MAD` then flags the first value that differs at all — a
    divide-by-almost-zero dressed up as statistics, and how an anomaly detector
    comes to cry wolf on the quietest equipment in the house."""
    assert mad([5.0] * 20) == 0.0
    assert robust_sigma([5.0] * 20) == 0.0


def test_robust_sigma_is_mad_scaled() -> None:
    values = [1.0, 2.0, 3.0, 4.0, 100.0]
    spread = mad(values)
    assert spread is not None
    assert abs((robust_sigma(values) or 0) - spread * MAD_TO_SIGMA) < 1e-9


# ── the idle floor ───────────────────────────────────────────────────────────

def test_percentile_bounds_and_interpolation() -> None:
    values = [0.0, 1.0, 2.0, 3.0, 4.0]
    assert percentile(values, 0.0) == 0.0
    assert percentile(values, 1.0) == 4.0
    assert percentile(values, 0.5) == 2.0
    assert abs((percentile(values, 0.25) or 0) - 1.0) < 1e-9


def test_percentile_clamps_out_of_range_fractions() -> None:
    values = [0.0, 1.0, 2.0]
    assert percentile(values, -5) == 0.0
    assert percentile(values, 5) == 2.0


def test_the_idle_floor_beats_the_minimum() -> None:
    """⚠️ WHY A LOW PERCENTILE AND NOT `min()`. A day of a pump's hourly
    readings contains one hour where the meter reported nothing at all. The
    minimum picks that hour and calls it the idle floor; the 20th percentile
    finds the level the device actually sits at."""
    day = [0.0] + [0.10] * 8 + [0.9] * 15   # one dead hour, idle, then running
    assert min(day) == 0.0
    floor = percentile(day, 0.20)
    assert floor is not None and 0.05 < floor < 0.5, floor


def test_idle_floor_is_below_the_median_when_the_device_runs() -> None:
    """A sanity property: the level a device idles at is at or below its
    typical level. If this ever inverts, the percentile is being read
    upside-down."""
    day = [0.1] * 10 + [2.0] * 14
    floor = percentile(day, 0.20)
    centre = median(day)
    assert floor is not None and centre is not None
    assert floor <= centre


# ── ratios ───────────────────────────────────────────────────────────────────

def test_relative_change_refuses_a_zero_baseline() -> None:
    """⚠️ Returning inf — or a large finite number — would make every device
    that used to draw nothing the loudest finding in the report."""
    assert relative_change(0.0, 5.0) is None
    assert relative_change(-1.0, 5.0) is None


def test_relative_change_is_a_fraction() -> None:
    assert abs((relative_change(2.0, 3.0) or 0) - 0.5) < 1e-9
    assert abs((relative_change(2.0, 1.0) or 0) + 0.5) < 1e-9
    assert relative_change(2.0, 2.0) == 0.0


def test_trimming_drops_both_ends() -> None:
    values = [-1000.0] + [1.0] * 20 + [1000.0]
    assert max(trimmed(values, 0.05)) == 1.0
    assert min(trimmed(values, 0.05)) == 1.0


def test_trimming_never_empties_a_short_series() -> None:
    assert trimmed([1.0, 2.0], 0.5) == [1.0, 2.0]
    assert trimmed([], 0.1) == []


def test_nan_is_dropped_not_propagated() -> None:
    """One NaN from a malformed statistic must not poison a whole series."""
    values = [1.0, float("nan"), 2.0, 3.0]
    assert median(values) == 2.0
