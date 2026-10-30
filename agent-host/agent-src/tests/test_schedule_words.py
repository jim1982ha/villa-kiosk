"""One reader of a schedule's wording ("07:00", "Mon 08:00", "31 08:00"): vesta_shared.when.Spec.

Architecture review, round 9: the wording was read in five places, each with its own idea of today."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from vesta_shared.when import Invalid, Spec

WINDOW = timedelta(minutes=30)


def t(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=timezone.utc)


def test_a_slot_before_midnight_is_due_after_it():
    assert Spec.parse("23:45").due(t(2026, 10, 2, 0, 5), WINDOW) == t(2026, 10, 1, 23, 45)
    assert Spec.parse("23:45").due(t(2026, 10, 2, 0, 20), WINDOW) is None          # its window has closed
    assert Spec.parse("Thu 23:45").due(t(2026, 10, 2, 0, 5), WINDOW) == t(2026, 10, 1, 23, 45)  # 1 Oct 2026: a Thursday
    assert Spec.parse("30 23:45").due(t(2026, 10, 1, 0, 5), WINDOW) == t(2026, 9, 30, 23, 45)


def test_day_31_runs_on_the_last_day_of_a_shorter_month():
    assert Spec.parse("31 08:00").due(t(2027, 2, 28, 8, 5), WINDOW) == t(2027, 2, 28, 8, 0)
    assert Spec.parse("31 08:00").due(t(2028, 2, 29, 8, 5), WINDOW) == t(2028, 2, 29, 8, 0)   # a leap year
    assert Spec.parse("31 08:00").due(t(2028, 2, 28, 8, 5), WINDOW) is None
    assert Spec.parse("31 08:00").due(t(2026, 11, 30, 8, 5), WINDOW) == t(2026, 11, 30, 8, 0)
    assert Spec.parse("31 08:00").due(t(2026, 10, 30, 8, 5), WINDOW) is None      # October has its 31st
    assert Spec.parse("31 08:00").next_after(t(2026, 11, 1, 0, 0)) == t(2026, 11, 30, 8, 0)
    assert Spec.parse("31 08:00").next_after(t(2026, 12, 1, 0, 0)) == t(2026, 12, 31, 8, 0)


def test_its_words_say_what_a_shorter_month_does():
    assert Spec.parse("31 08:00").words() == "on day 31 of each month at 08:00, or on the last day of a shorter month"
    assert Spec.parse("1 08:00").words() == "on day 1 of each month at 08:00"
    assert Spec.parse("Mon 08:00").words() == "every Monday at 08:00"
    assert Spec.parse("07:00").words() == "every day at 07:00"
    assert [Spec.parse(w).per_month() for w in ("07:00", "Mon 08:00", "1 08:00")] == [30.0, 4.35, 1.0]


def test_the_last_slot_and_the_next():
    assert Spec.parse("04:00").last_at(t(2026, 10, 2, 3, 0)) == t(2026, 10, 1, 4, 0)
    assert Spec.parse("04:00").last_at(t(2026, 10, 2, 4, 0)) == t(2026, 10, 2, 4, 0)
    assert Spec.parse("Mon 08:00").next_after(t(2026, 10, 5, 8, 0)) == t(2026, 10, 12, 8, 0)


@pytest.mark.parametrize("bad", ["", "7:00", "24:00", "32 08:00", "0 08:00", "Monday 08:00", "mon 08:00", None])
def test_a_time_not_so_written_is_refused(bad):
    assert not Spec.valid(bad)
    with pytest.raises(Invalid):
        Spec.parse(bad)
