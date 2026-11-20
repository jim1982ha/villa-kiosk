"""Moments sort by the moment, never by their text (owner, 2026-11-20, #204: the villa writes some moments in UTC and
some in its own time; sorted as text, a Parking photo of 12:20 came before two of 12:19)."""
from datetime import datetime, timezone

from vesta_shared.timeutil import moment_key


def test_moments_in_two_zones_sort_by_when_they_happened():
    seen = ["2026-11-20T04:20:12+00:00", "2026-11-20T12:19:32+08:00", "2026-11-20T12:19:56+08:00",
            datetime(2026, 11, 20, 4, 18, 30, tzinfo=timezone.utc)]
    got = sorted(seen, key=moment_key)
    assert got == [seen[3], seen[1], seen[2], seen[0]]


def test_a_value_that_is_no_moment_comes_first_and_keeps_its_order():
    assert sorted(["2026-11-20T12:00:00+08:00", "", None, "b", "a"], key=moment_key) == [
        "", None, "a", "b", "2026-11-20T12:00:00+08:00"]
