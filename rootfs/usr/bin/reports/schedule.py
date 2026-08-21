"""When is a report due, and has this one already been sent?

Pure functions over a clock. No I/O, no Home Assistant, no state of its own —
the scheduler's decisions are the easiest thing in this subsystem to get subtly
wrong and the easiest to test, so they are kept somewhere a test can reach.

⚠️ WALL CLOCK, NOT ELAPSED TIME. An owner asking for a report "at 7am" means
7am on the wall, and that has to stay 7am across a DST change. Anything built
on 24-hour multiples drifts by an hour for half the year — which would be
merely untidy for the delivery time, and is corrupting for the WINDOW the
report covers, because a day-of-week baseline then compares Monday against a
slice of Sunday.

⚠️ IDEMPOTENCY IS NOT OPTIONAL HERE. The tick runs every 60 seconds and the
add-on restarts — on an update, on a host reboot, whenever the owner presses
Restart. Without a key, a restart at 07:00 during the delivery window sends the
report again, and the owner's phone buzzes twice with the same summary. Worse,
the obvious fix ("remember the last run time") loses to a restart that happens
before the write lands. The key is derived from the PERIOD, so re-deriving it
after a restart yields the same string and the send is suppressed.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .log import warn

# How late a report may still be sent. The tick can miss its moment for real
# reasons — the add-on was updating, the host was rebooting, Home Assistant was
# down — and a weekly summary delivered two hours late is still worth having.
#
# ⚠️ BUT IT IS BOUNDED, AND THAT BOUND IS THE POINT. Without it, an add-on
# started after a week offline would fire every missed report at once. Six
# hours is long enough to cover an update or a reboot and short enough that a
# report arriving inside it is still about the day it names.
CATCH_UP_HOURS = 6


def resolve_timezone(name: str) -> Any:
    """The villa's timezone, degrading to UTC.

    Home Assistant reports its own (`get_config`'s `time_zone`) and that is the
    right answer — the villa's wall clock is the one the owner reads. An
    unknown name degrades rather than raising: a report at the wrong hour is a
    nuisance, a scheduler that will not start is an outage.
    """
    if not name:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        warn(f"unknown timezone {name!r}; scheduling in UTC")
        return timezone.utc


def period_key(cadence: str, moment: datetime) -> str:
    """The identity of the period `moment` falls in.

    This is what makes a send idempotent, so each cadence names its period in
    the way the owner would: a day, an ISO week, a calendar month. Two ticks in
    the same period yield the same key; the first send wins.
    """
    if cadence == "daily":
        return moment.strftime("%Y-%m-%d")
    if cadence == "weekly":
        # ISO week: a year boundary mid-week stays ONE period rather than
        # splitting into two partial reports.
        iso = moment.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    if cadence == "monthly":
        return moment.strftime("%Y-%m")
    return moment.strftime("%Y-%m-%d")


def period_start(cadence: str, moment: datetime) -> datetime:
    """When the period `moment` falls in BEGAN — the report's window.

    ⚠️ THE COMPANION TO `period_key`, AND IT MUST AGREE WITH IT. The key says
    which period this is; this says which events belong to it. If the two
    disagreed, a report titled with one week would be assembled from another's
    events — and nothing would look wrong, because both halves would be
    internally consistent.

    ⚠️ WALL-CLOCK MIDNIGHT, NOT "24 HOURS AGO". Subtracting a duration from the
    send time gives a window that slides with the hour the schedule fires, so a
    daily report sent at 07:00 would cover 07:00-to-07:00 and cut every evening
    in half. `replace()` on a tz-aware datetime re-resolves the offset, which is
    also what keeps this right across a DST change — the same reason
    `_fire_time` builds its times that way.

    Monthly deliberately walks back to day 1 rather than subtracting 30 days:
    "this month" is a calendar claim, and a 30-day window in a 31-day month
    silently drops a day of findings.
    """
    midnight = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    if cadence == "weekly":
        return midnight - timedelta(days=midnight.weekday())
    if cadence == "monthly":
        return midnight.replace(day=1)
    return midnight


def idempotency_key(schedule_id: str, cadence: str, moment: datetime) -> str:
    return f"{schedule_id}:{period_key(cadence, moment)}"


#: Which weekday a `weekly` schedule lands on when none is chosen, and which
#: day of the month a `monthly` one does.
#:
#: ⚠️ THESE WERE HARD-CODED AND INVISIBLE, AND IT COST THE OWNER A WEEK. A
#: weekly schedule fired on MONDAY with nothing anywhere saying so — they
#: created one on a Friday at 11:58 for 11:59, received nothing, and were right
#: to ask why: its slot for that week was Monday 11:59, four days past, outside
#: the six-hour catch-up window. Next delivery would have been the following
#: Monday. Now they are DEFAULTS rather than laws, the UI offers both, and
#: `next_fire` states the answer in the dialog so it can never be invisible
#: again.
DEFAULT_WEEKDAY = 0   # Monday — a week's report is about the week that ended
DEFAULT_MONTH_DAY = 1


def _slot(entry: Dict[str, Any], key: str, low: int, high: int,
          fallback: int) -> int:
    """One bounded integer from a schedule, tolerating absence and nonsense.

    ⚠️ ABSENT MEANS THE DEFAULT AND SO DOES MALFORMED, deliberately. Every
    schedule stored before a field existed lacks it, and a schedule that stops
    firing because one value is out of range is a silent outage — the config
    validator is where a typo should fail, at save. `isinstance(True, int)` is
    True in Python, hence the bool guard this codebase writes everywhere.
    """
    value = entry.get(key, fallback)
    if isinstance(value, int) and not isinstance(value, bool) and low <= value <= high:
        return value
    return fallback


def _fire_time(cadence: str, hour: int, minute: int,
               now_local: datetime, weekday: int = DEFAULT_WEEKDAY,
               month_day: int = DEFAULT_MONTH_DAY) -> Optional[datetime]:
    """When this schedule was due within the current period.

    ⚠️ Built by REPLACING the hour on a real local date, never by adding
    seconds. `replace()` on a tz-aware datetime re-resolves the offset, so the
    result is 07:00 wall-clock on both sides of a DST change; arithmetic on a
    UTC instant is what drifts.

    ⚠️ MINUTE PRECISION IS HONEST HERE, AND IT IS WORTH SAYING WHY. The tick
    runs every 60 seconds, so a schedule set for 07:30 fires within a minute of
    07:30 — the same accuracy the hour already had. And it cannot affect what
    the report CONTAINS: the window comes from `period_start(cadence,
    now_local)`, which is a DATE boundary, and Home Assistant's long-term
    statistics are hourly buckets that this does not slice. Delivery time and
    measurement window are independent, which is what makes an arbitrary minute
    a free choice rather than a trade.
    """
    if cadence == "daily":
        return now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if cadence == "weekly":
        start = now_local - timedelta(days=now_local.weekday())
        return (start + timedelta(days=weekday)).replace(
            hour=hour, minute=minute, second=0, microsecond=0)
    if cadence == "monthly":
        # ⚠️ CLAMPED TO THE MONTH'S LENGTH, not restricted to 1-28. An operator
        # who wants the 31st should get the 31st in January and the last day in
        # February, rather than being told a date they can see on a calendar is
        # not allowed.
        last = monthrange(now_local.year, now_local.month)[1]
        return now_local.replace(day=min(month_day, last), hour=hour,
                                 minute=minute, second=0, microsecond=0)
    return None


def next_fire(entry: Dict[str, Any], now_local: datetime) -> Optional[datetime]:
    """When this schedule will NEXT fire, or None if it never can.

    ⚠️ THE ONE THING THE DIALOG COULD NOT SAY, AND THE REASON IT HAD TO. A
    weekly schedule created on a Friday next fires the following MONDAY, which
    is obvious from `_fire_time` and invisible from the UI — so the answer is
    computed HERE, by the same function the scheduler uses, and shown. A second
    implementation in the SPA would be a different answer wearing the same
    label, which is this subsystem's most expensive recurring bug.

    Probes forward a day at a time rather than doing calendar arithmetic per
    cadence: `_fire_time` already knows where each cadence's slot sits within a
    period, so walking the days re-uses that instead of restating it. Bounded at
    two months, which covers every cadence including a monthly landing on the
    31st.
    """
    cadence = str(entry.get("cadence") or "")
    if cadence not in ("daily", "weekly", "monthly"):
        return None
    hour = _slot(entry, "hour", 0, 23, 7)
    minute = _slot(entry, "minute", 0, 59, 0)
    weekday = _slot(entry, "weekday", 0, 6, DEFAULT_WEEKDAY)
    month_day = _slot(entry, "day", 1, 31, DEFAULT_MONTH_DAY)

    for ahead in range(0, 62):
        moment = now_local + timedelta(days=ahead)
        fire_at = _fire_time(cadence, hour, minute, moment, weekday, month_day)
        if fire_at is not None and fire_at > now_local:
            return fire_at
    return None


def due(schedules: Sequence[Dict[str, Any]], sent_keys: Sequence[str],
        now_local: datetime) -> List[Dict[str, Any]]:
    """Which schedules should fire right now.

    `sent_keys` is what has already been delivered (from the scheduler's own
    state file). A schedule whose key is in there is silently skipped — that is
    the restart guard, and it is why this takes the keys rather than a
    last-run timestamp.

    Returns the schedule dicts, each with the key that must be recorded once
    delivery is attempted.
    """
    already = set(sent_keys)
    ready: List[Dict[str, Any]] = []

    for entry in schedules:
        if not isinstance(entry, dict):
            continue
        cadence = entry.get("cadence")
        hour = entry.get("hour")
        schedule_id = str(entry.get("id") or "")
        if cadence not in ("daily", "weekly", "monthly"):
            continue
        # `isinstance(True, int)` is True in Python, so a JSON `true` would
        # schedule hour 1 — the same trap the config validator guards.
        if not isinstance(hour, int) or isinstance(hour, bool) or not 0 <= hour <= 23:
            continue
        # ⚠️ ABSENT MEANS ZERO, NOT INVALID. Every schedule written before
        # minutes existed has no `minute` key, and treating that as malformed
        # would silently stop delivering the reports an operator already
        # configured — the worst possible reading of a field being added.
        minute = _slot(entry, "minute", 0, 59, 0)
        weekday = _slot(entry, "weekday", 0, 6, DEFAULT_WEEKDAY)
        month_day = _slot(entry, "day", 1, 31, DEFAULT_MONTH_DAY)
        if not schedule_id:
            continue

        fire_at = _fire_time(cadence, hour, minute, now_local, weekday, month_day)
        if fire_at is None or now_local < fire_at:
            continue
        if now_local - fire_at > timedelta(hours=CATCH_UP_HOURS):
            # Missed by more than the catch-up window. Deliberately NOT sent,
            # and deliberately not an error: the period simply passed.
            continue

        key = idempotency_key(schedule_id, str(cadence), fire_at)
        if key in already:
            continue
        ready.append({**entry, "key": key, "fire_at": fire_at.isoformat()})

    return ready


def prune_keys(keys: Sequence[str], limit: int = 200) -> List[str]:
    """Keep the state file bounded.

    The keys are only ever tested for membership, so the oldest can go once
    their period is long past. Bounded by count rather than age because the
    count is what threatens the file, and 200 covers well over a year of any
    cadence this supports.
    """
    return list(keys)[-limit:] if len(keys) > limit else list(keys)
