"""Scheduling: when a report is due, and whether it already went out.

The scheduler's decisions are the easiest thing in this subsystem to get subtly
wrong and the easiest to test, which is why they live in pure functions. The
two that would hurt most in the field:

  A DUPLICATE SEND. The tick runs every 60 seconds and the add-on restarts on
  every update. Without an idempotency key, a restart inside the delivery
  window sends the report twice and the owner's phone buzzes with the same
  summary — the fastest way to have the feature switched off.

  A DRIFTING WINDOW. "7am" must stay 7am across a DST change. Anything built
  on 24-hour multiples drifts by an hour for half the year.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
from zoneinfo import ZoneInfo

from reports.schedule import (
    CATCH_UP_HOURS,
    due,
    idempotency_key,
    period_key,
    prune_keys,
    resolve_timezone,
)

# A zone with a real DST transition, so the wall-clock property is exercised
# rather than asserted. Deliberately NOT the reference deployment's zone
# (Asia/Singapore has no DST and would make every one of these pass vacuously).
DST_ZONE = ZoneInfo("Europe/Paris")


def _sched(**kw: Any) -> Dict[str, Any]:
    base: Dict[str, Any] = {"id": "s1", "cadence": "daily", "hour": 7,
                            "audience": "owner"}
    base.update(kw)
    return base


# ── timezone ─────────────────────────────────────────────────────────────────

def test_unknown_timezone_degrades_to_utc() -> None:
    """A report at the wrong hour is a nuisance; a scheduler that refuses to
    start is an outage."""
    assert resolve_timezone("Not/AZone") is timezone.utc
    assert resolve_timezone("") is timezone.utc


def test_a_real_timezone_resolves() -> None:
    assert resolve_timezone("Europe/Paris") == DST_ZONE


# ── period identity ──────────────────────────────────────────────────────────

def test_daily_period_is_the_date() -> None:
    assert period_key("daily", datetime(2026, 8, 20, 7, 0)) == "2026-08-20"


def test_weekly_period_is_the_iso_week() -> None:
    """A year boundary mid-week must stay ONE period, not split into two
    partial reports."""
    monday = period_key("weekly", datetime(2025, 12, 29))   # Mon, ISO 2026-W01
    thursday = period_key("weekly", datetime(2026, 1, 1))   # same ISO week
    assert monday == thursday


def test_monthly_period_is_the_month() -> None:
    assert period_key("monthly", datetime(2026, 8, 20)) == "2026-08"


def test_the_key_is_stable_across_a_restart() -> None:
    """⚠️ THE WHOLE POINT. The key is derived from the PERIOD, so re-deriving
    it after a restart yields the same string and the send is suppressed. A
    "remember the last run time" design loses to a restart that happens before
    the write lands."""
    first = idempotency_key("s1", "daily", datetime(2026, 8, 20, 7, 0))
    later = idempotency_key("s1", "daily", datetime(2026, 8, 20, 7, 59))
    assert first == later == "s1:2026-08-20"


# ── due ──────────────────────────────────────────────────────────────────────

def _at(hour: int, minute: int = 0, day: int = 20) -> datetime:
    return datetime(2026, 8, day, hour, minute, tzinfo=DST_ZONE)


def test_fires_at_its_hour() -> None:
    assert len(due([_sched()], [], _at(7, 0))) == 1


def test_does_not_fire_before_its_hour() -> None:
    assert due([_sched()], [], _at(6, 59)) == []


def test_does_not_fire_twice_in_one_period() -> None:
    """The restart guard, as behaviour."""
    ready = due([_sched()], [], _at(7, 0))
    assert len(ready) == 1
    assert due([_sched()], [ready[0]["key"]], _at(7, 30)) == []


def test_a_new_period_fires_again() -> None:
    ready = due([_sched()], [], _at(7, 0, day=20))
    assert due([_sched()], [ready[0]["key"]], _at(7, 0, day=21))


def test_catch_up_covers_a_restart() -> None:
    """A tick can miss its moment for real reasons — an update, a reboot, Core
    being down. A summary an hour late is still worth having."""
    assert len(due([_sched()], [], _at(7 + CATCH_UP_HOURS - 1))) == 1


def test_catch_up_is_bounded() -> None:
    """⚠️ WITHOUT THE BOUND, an add-on started after a week offline fires every
    missed report at once."""
    assert due([_sched()], [], _at(7 + CATCH_UP_HOURS + 1)) == []


def test_a_boolean_hour_is_refused() -> None:
    """`isinstance(True, int)` is True in Python, so a JSON `true` would
    schedule hour 1 — silently, at one in the morning."""
    assert due([_sched(hour=True)], [], _at(1, 0)) == []


def test_malformed_schedules_are_skipped_not_fatal() -> None:
    bad: List[Any] = ["not a dict", {}, _sched(cadence="hourly"),
                      _sched(hour=99), _sched(id="")]
    assert due(bad, [], _at(7, 0)) == []


def test_several_schedules_can_fire_together() -> None:
    ready = due([_sched(id="a"), _sched(id="b", hour=7)], [], _at(7, 0))
    assert {r["id"] for r in ready} == {"a", "b"}


# ── the DST property ─────────────────────────────────────────────────────────

def test_the_hour_is_wall_clock_across_a_dst_change() -> None:
    """⚠️ THE PROPERTY THAT 24-HOUR ARITHMETIC BREAKS.

    Europe/Paris springs forward on 2026-03-29. A schedule set for 07:00 must
    fire at 07:00 local on both the day before and the day after — not 06:00 or
    08:00. Checked by asking `due` at exactly 07:00 wall-clock on each date.
    """
    for day in (28, 29, 30):
        moment = datetime(2026, 3, day, 7, 0, tzinfo=DST_ZONE)
        assert len(due([_sched()], [], moment)) == 1, f"March {day} did not fire"


def test_the_window_does_not_drift_across_dst() -> None:
    """The same schedule, one second before its hour, must NOT fire — on the
    DST day as on any other. A drifting window would make this fire early."""
    for day in (28, 29, 30):
        moment = datetime(2026, 3, day, 6, 59, 59, tzinfo=DST_ZONE)
        assert due([_sched()], [], moment) == [], f"March {day} fired early"


# ── state hygiene ────────────────────────────────────────────────────────────

def test_keys_are_bounded() -> None:
    """An unbounded state file on a tablet that runs for years is a
    slow-motion disk-full bug."""
    keys = [f"s1:2026-{n:04d}" for n in range(500)]
    pruned = prune_keys(keys, limit=200)
    assert len(pruned) == 200
    assert pruned[-1] == keys[-1], "pruning dropped the newest key"


def test_pruning_leaves_a_short_list_alone() -> None:
    assert prune_keys(["a", "b"], limit=200) == ["a", "b"]


def test_weekly_fires_on_monday_only() -> None:
    """A week's report is about the week that ended, and Monday morning is when
    someone reads it. 2026-08-20 is a Thursday; 2026-08-17 is a Monday."""
    weekly = _sched(cadence="weekly")
    monday = datetime(2026, 8, 17, 7, 0, tzinfo=DST_ZONE)
    assert len(due([weekly], [], monday)) == 1
    thursday = datetime(2026, 8, 20, 7, 0, tzinfo=DST_ZONE)
    assert due([weekly], [], thursday) == [], "fired mid-week"


def test_monthly_fires_on_the_first_only() -> None:
    monthly = _sched(cadence="monthly")
    first = datetime(2026, 8, 1, 7, 0, tzinfo=DST_ZONE)
    assert len(due([monthly], [], first)) == 1
    assert due([monthly], [], datetime(2026, 8, 9, 7, 0, tzinfo=DST_ZONE)) == []


def test_a_late_weekly_still_catches_up_within_the_window() -> None:
    monday = datetime(2026, 8, 17, 7, 0, tzinfo=DST_ZONE) + timedelta(hours=3)
    assert len(due([_sched(cadence="weekly")], [], monday)) == 1


# ── timezone resolution ──────────────────────────────────────────────────────
# ⚠️ SHIPPED BROKEN IN 2.505.0 AND CAUGHT BY QA ON REAL HARDWARE. The config
# default was `""` with a comment reading "ask Home Assistant", and nothing
# asked — so everything scheduled in UTC. On the UTC+8 reference deployment a
# schedule set for the CURRENT hour sat eight hours in the future and never
# became due, which is how the QA plan's timezone test failed: not by firing at
# the wrong time, but by never firing at all.

def test_an_explicit_setting_wins() -> None:
    import asyncio

    from reports.pipeline import resolve_zone

    zone, learned = asyncio.run(resolve_zone(
        None, {"timezone": "Europe/Paris"}, {}))  # type: ignore[arg-type]
    assert zone == ZoneInfo("Europe/Paris")
    assert learned is None, "an explicit setting must not be re-cached"


def test_a_cached_name_is_used_without_asking() -> None:
    """The tick must decide what is due BEFORE discovery runs, so the timezone
    cannot come from discovery. Passing `None` as the session proves no network
    call happens — it would raise if one were attempted."""
    import asyncio

    from reports.pipeline import resolve_zone

    zone, learned = asyncio.run(resolve_zone(
        None, {"timezone": ""}, {"timezone": "Asia/Tokyo"}))  # type: ignore[arg-type]
    assert zone == ZoneInfo("Asia/Tokyo")
    assert learned is None


def test_a_learned_name_is_returned_for_caching() -> None:
    import asyncio

    from reports import pipeline

    async def fake(_session: object) -> str:
        return "Australia/Sydney"

    original = pipeline.fetch_timezone
    pipeline.fetch_timezone = fake  # type: ignore[assignment]
    try:
        zone, learned = asyncio.run(resolve := pipeline.resolve_zone(
            None, {"timezone": ""}, {}))  # type: ignore[arg-type]
    finally:
        pipeline.fetch_timezone = original  # type: ignore[assignment]
    assert zone == ZoneInfo("Australia/Sydney")
    assert learned == "Australia/Sydney", "the caller must be told to cache it"


def test_utc_is_the_last_resort_only() -> None:
    import asyncio

    from reports import pipeline

    async def unavailable(_session: object) -> None:
        return None

    original = pipeline.fetch_timezone
    pipeline.fetch_timezone = unavailable  # type: ignore[assignment]
    try:
        zone, learned = asyncio.run(pipeline.resolve_zone(
            None, {"timezone": ""}, {}))  # type: ignore[arg-type]
    finally:
        pipeline.fetch_timezone = original  # type: ignore[assignment]
    assert zone is timezone.utc
    assert learned is None, "a failed lookup must not poison the cache"


def test_the_regression_itself_a_current_hour_schedule_is_due_locally() -> None:
    """⚠️ THE FAILURE, AS A PROPERTY.

    A schedule set for the CURRENT LOCAL hour must be due. Computed against a
    UTC clock on a UTC+8 property it sits eight hours ahead and never fires —
    which is precisely what QA observed.
    """
    zone = ZoneInfo("Asia/Singapore")
    now_utc = datetime(2026, 8, 20, 9, 9, tzinfo=timezone.utc)
    now_local = now_utc.astimezone(zone)
    assert now_local.hour == 17, "fixture assumption: 09:09Z is 17:09 in +08:00"

    assert len(due([_sched(hour=now_local.hour)], [], now_local)) == 1
    # And the shape of the bug: the same schedule against the UTC clock.
    assert due([_sched(hour=now_local.hour)], [], now_utc) == [], (
        "scheduling against UTC must NOT find a local-hour schedule due — "
        "if this passes, the fixture no longer reproduces the regression")
