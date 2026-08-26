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


# ── minutes ─────────────────────────────────────────────────────────────────

def test_a_schedule_can_fire_at_an_arbitrary_minute() -> None:
    """⚠️ THE TICK RUNS EVERY 60 SECONDS, so minute precision is as real as the
    hour's always was — and it cannot affect what the report CONTAINS, because
    the window comes from `period_start`, a DATE boundary, over hourly
    statistics buckets this does not slice. Delivery time and measurement window
    are independent."""
    from datetime import datetime
    from reports.schedule import due
    entry = {"id": "s1", "cadence": "daily", "hour": 7, "minute": 30}

    at_0729 = datetime(2026, 8, 21, 7, 29, tzinfo=timezone.utc)
    at_0730 = datetime(2026, 8, 21, 7, 30, tzinfo=timezone.utc)
    assert due([entry], [], at_0729) == []
    fired = due([entry], [], at_0730)
    assert len(fired) == 1 and fired[0]["id"] == "s1"


def test_a_schedule_written_before_minutes_existed_still_fires() -> None:
    """⚠️ ABSENT MEANS ZERO, NOT MALFORMED. Every schedule stored before this
    field existed has no `minute` key, and rejecting those would silently stop
    delivering reports an operator already configured — the worst possible
    reading of a field being added."""
    from datetime import datetime
    from reports.schedule import due
    legacy = {"id": "s1", "cadence": "daily", "hour": 7}
    fired = due([legacy], [], datetime(2026, 8, 21, 7, 0, tzinfo=timezone.utc))
    assert len(fired) == 1


def test_a_nonsense_minute_falls_back_rather_than_dropping_the_schedule() -> None:
    """A schedule that stops firing because one field is wrong is a silent
    outage. `validate_config` refuses a bad minute at SAVE time, which is where
    a typo should fail; by the time the scheduler reads it, delivering at the
    top of the hour beats not delivering."""
    from datetime import datetime
    from reports.schedule import due
    for bad in (99, -1, True, "30", None):
        entry = {"id": "s1", "cadence": "daily", "hour": 7, "minute": bad}
        fired = due([entry], [], datetime(2026, 8, 21, 7, 0, tzinfo=timezone.utc))
        assert len(fired) == 1, f"minute={bad!r} dropped the schedule"


def test_the_config_validator_refuses_a_bad_minute_but_allows_an_absent_one() -> None:
    from reports.store import validate_config
    ok = {"schedules": [{"cadence": "daily", "hour": 7}]}
    assert validate_config(ok) == []
    ok_minute = {"schedules": [{"cadence": "daily", "hour": 7, "minute": 30}]}
    assert validate_config(ok_minute) == []
    bad = {"schedules": [{"cadence": "daily", "hour": 7, "minute": 60}]}
    assert any("minute" in p for p in validate_config(bad))


def test_a_weekly_schedule_can_land_on_any_weekday() -> None:
    """⚠️ THIS COST THE OWNER A WEEK. "Weekly" fired on MONDAY, hard-coded, with
    nothing in the dialog saying so: they created one on a Friday at 11:58 for
    11:59, received nothing, and were right to ask why. Its slot for that week
    was Monday 11:59 — four days past, outside the six-hour catch-up window."""
    from datetime import datetime
    from reports.schedule import due
    friday = datetime(2026, 8, 21, 11, 59, tzinfo=timezone.utc)
    assert due([{"id": "s", "cadence": "weekly", "hour": 11, "minute": 59}],
               [], friday) == [], "the default is still Monday"
    fired = due([{"id": "s", "cadence": "weekly", "hour": 11, "minute": 59,
                  "weekday": 4}], [], friday)
    assert len(fired) == 1, "weekday=4 is Friday and it is 11:59 on a Friday"


def test_next_fire_answers_the_question_the_dialog_could_not() -> None:
    from datetime import datetime
    from reports.schedule import next_fire
    friday_noon = datetime(2026, 8, 21, 12, 1, tzinfo=timezone.utc)
    nxt = next_fire({"cadence": "weekly", "hour": 11, "minute": 59}, friday_noon)
    assert nxt is not None
    assert nxt.strftime("%A %d %b %H:%M") == "Monday 24 Aug 11:59"


def test_a_monthly_day_is_clamped_to_the_month_rather_than_refused() -> None:
    """An operator who wants the 31st gets the 31st in January and the last day
    in February, rather than a date they can see on a calendar being rejected."""
    from datetime import datetime
    from reports.schedule import next_fire
    in_february = datetime(2026, 2, 5, 9, 0, tzinfo=timezone.utc)
    nxt = next_fire({"cadence": "monthly", "hour": 7, "day": 31}, in_february)
    assert nxt is not None and nxt.strftime("%d %b") == "28 Feb"


def test_next_fire_is_always_in_the_future_for_every_cadence() -> None:
    from datetime import datetime
    from reports.schedule import next_fire
    now = datetime(2026, 8, 21, 12, 1, tzinfo=timezone.utc)
    for cadence in ("daily", "weekly", "monthly"):
        nxt = next_fire({"cadence": cadence, "hour": 7}, now)
        assert nxt is not None and nxt > now, cadence
    assert next_fire({"cadence": "hourly"}, now) is None


def test_next_fire_is_TODAY_for_a_time_still_ahead() -> None:
    """⚠️ REPORTED AS "IT ALWAYS SCHEDULES FOR THE NEXT DAY". The scheduler was
    right — the add-on log showed the save landing at 13:42:12 for a 13:42
    schedule, twelve seconds INTO the slot, so tomorrow was correct. What was
    wrong is that the dialog could not say so while the time was being picked:
    it showed "save to see it", and by the time you saved the moment had passed.

    So the behaviour is pinned here and the DIALOG now asks this same function
    live, through `/reports-next-run`, rather than reimplementing it."""
    from datetime import datetime
    from reports.schedule import next_fire
    at_1341 = datetime(2026, 8, 21, 13, 41, tzinfo=timezone.utc)
    nxt = next_fire({"cadence": "daily", "hour": 13, "minute": 42}, at_1341)
    assert nxt is not None and nxt.strftime("%d %b %H:%M") == "21 Aug 13:42", (
        "a slot still ahead today must be TODAY")

    at_1343 = datetime(2026, 8, 21, 13, 43, tzinfo=timezone.utc)
    nxt = next_fire({"cadence": "daily", "hour": 13, "minute": 42}, at_1343)
    assert nxt is not None and nxt.strftime("%d %b %H:%M") == "22 Aug 13:42", (
        "a slot already past today must roll to tomorrow")


def test_every_cadence_says_what_its_window_is() -> None:
    """⚠️ THE PHRASE IS A CLAIM ABOUT `period_start`, SO IT LIVES BESIDE IT.

    Asked by the owner reading a delivered brief: "I see number — when are these
    numbers reset?" Nothing on the page answered it. The title said "Daily
    property brief"; the dateline said it was prepared at 23:35, which is the
    one time that is NOT the boundary — from a prepared time a reader infers a
    rolling window, and `period_start` uses wall-clock midnight.

    A cadence with no phrase would silently print no window sentence, which is
    the same silence that prompted the question.
    """
    from datetime import datetime, timezone
    from reports import schedule

    moment = datetime(2026, 8, 21, 23, 35, tzinfo=timezone.utc)  # a Friday
    for cadence in ("daily", "weekly", "monthly"):
        assert cadence in schedule.WINDOW_PHRASE, f"{cadence} has no phrase"

    # And the phrase must describe what period_start actually does.
    assert schedule.period_start("daily", moment).hour == 0
    assert schedule.period_start("weekly", moment).weekday() == 0, "Monday"
    assert schedule.period_start("monthly", moment).day == 1
    assert "midnight" in schedule.WINDOW_PHRASE["daily"]
    assert "Monday" in schedule.WINDOW_PHRASE["weekly"]
    assert "1st" in schedule.WINDOW_PHRASE["monthly"]


# ⚠️ test_a_scoped_heading_reads_as_english_not_as_a_cadence_name LEFT WITH
# ITS RENDERER (TASK-073): `section_heading` and the scoped-heading grammar
# were `deterministic.py`'s, and the new brief has no per-cadence headings to
# shadow. The lesson it recorded — a test deriving its expectation from the
# expression under test agrees with any bug in it — survives as prose here.


def test_the_title_span_says_which_days_the_report_covers() -> None:
    """⚠️ "Daily property brief - 2026-08-21" drew two questions in one breath:
    "would that always be daily?" and "based on what start/end date?". The
    cadence is a SETTING and the date was the SEND date, so neither named the
    days the contents describe. The span answers both.

    Derived from `period_start`, so a title can never describe a window the body
    does not — `period_key`'s own header warns about exactly that shape, where
    both halves stay internally consistent and only the reader can tell.
    """
    from datetime import datetime, timezone
    from reports import schedule
    friday = datetime(2026, 8, 21, 23, 35, tzinfo=timezone.utc)
    assert schedule.period_span("daily", friday) == "21 Aug 2026"
    assert schedule.period_span("weekly", friday) == "17-23 Aug 2026"
    assert schedule.period_span("monthly", friday) == "August 2026"
    # The weekly span must START on the same day period_start does.
    start = schedule.period_start("weekly", friday)
    assert str(start.day) == schedule.period_span("weekly", friday).split("-")[0]
