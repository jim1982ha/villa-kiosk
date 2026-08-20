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


def idempotency_key(schedule_id: str, cadence: str, moment: datetime) -> str:
    return f"{schedule_id}:{period_key(cadence, moment)}"


def _fire_time(cadence: str, hour: int, now_local: datetime) -> Optional[datetime]:
    """When this schedule was due within the current period.

    ⚠️ Built by REPLACING the hour on a real local date, never by adding
    seconds. `replace()` on a tz-aware datetime re-resolves the offset, so the
    result is 07:00 wall-clock on both sides of a DST change; arithmetic on a
    UTC instant is what drifts.
    """
    if cadence == "daily":
        return now_local.replace(hour=hour, minute=0, second=0, microsecond=0)
    if cadence == "weekly":
        # Monday. A week's report is about the week that just ended, and Monday
        # morning is when someone reads it.
        monday = now_local - timedelta(days=now_local.weekday())
        return monday.replace(hour=hour, minute=0, second=0, microsecond=0)
    if cadence == "monthly":
        return now_local.replace(day=1, hour=hour, minute=0, second=0, microsecond=0)
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
        if not schedule_id:
            continue

        fire_at = _fire_time(cadence, hour, now_local)
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
