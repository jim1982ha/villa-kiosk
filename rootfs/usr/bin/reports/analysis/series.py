"""Turning Home Assistant's statistics rows into days.

Shared by every module that looks at a time series, which from Phase 4 is all
of them. It exists because `_day_key` was about to be copied into a second
module — and the FIRST copy already cost Phase 3 its entire first live run.

⚠️ HOME ASSISTANT SENDS `start` AS EPOCH MILLISECONDS, not an ISO string. The
original code did `str(start)[:10]`, which is exactly right for
"2026-07-01T00:00:00" and catastrophic for 1755648000000: the first ten digits
of a millisecond timestamp advance every hour. Every hour became its own day,
every one-row day was then discarded as too short, and 18 meters with 11,859
readings produced nothing at any threshold. Silent, total, and invisible to a
test suite whose fixtures had been written from the same assumption as the
code. Keeping the parsing in one place means the next module inherits the fix
rather than the bug.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

#: A day needs at least this many hourly readings to be usable. Half a day.
#: A floor or a total computed from three hours is not one, and inventing it is
#: how a gap in the recorder becomes a finding about a pump.
MIN_HOURS_PER_DAY = 12


def day_key(start: Any, zone: Any = None) -> str:
    """The LOCAL calendar day a statistics row belongs to, or "".

    Accepts epoch milliseconds, epoch seconds and ISO strings, because HA has
    changed this once and may again — a module that only understands the
    current wire format breaks on upgrade.

    LOCAL, not UTC: "a day" means the villa's day. On a UTC+8 property, UTC
    bucketing splits every local day across two buckets and files the small
    hours — exactly when a device is idle — under the wrong one.
    """
    if isinstance(start, bool) or start is None:
        return ""
    if isinstance(start, (int, float)):
        seconds = float(start)
        if seconds != seconds:      # NaN
            return ""
        # Epoch seconds are ~1.7e9 today, milliseconds ~1.7e12. Anything past
        # 1e11 is milliseconds by a margin of three decades either way.
        if seconds > 1e11:
            seconds /= 1000.0
        try:
            moment = datetime.fromtimestamp(seconds, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return ""
        if zone is not None:
            moment = moment.astimezone(zone)
        return moment.strftime("%Y-%m-%d")
    text = str(start)
    return text[:10] if len(text) >= 10 else ""


def hourly_by_day(rows: Sequence[Dict[str, Any]],
                  zone: Any = None) -> Dict[str, List[float]]:
    """Group `change` values into local days, dropping unusable readings.

    A negative change means the meter reset — `total_increasing` permits it —
    and the hour is unusable, though the day may still be fine.
    """
    buckets: Dict[str, List[float]] = {}
    for row in rows:
        change = row.get("change")
        if not isinstance(change, (int, float)) or isinstance(change, bool):
            continue
        value = float(change)
        if value != value or value < 0:
            continue
        day = day_key(row.get("start"), zone)
        if not day:
            continue
        buckets.setdefault(day, []).append(value)
    return buckets


def complete_days(buckets: Dict[str, List[float]]) -> List[str]:
    """Days with enough readings to say anything about, oldest first."""
    return sorted(day for day, hours in buckets.items()
                  if len(hours) >= MIN_HOURS_PER_DAY)


def daily_totals(rows: Sequence[Dict[str, Any]],
                 zone: Any = None) -> Dict[str, float]:
    """Total consumption per complete local day."""
    buckets = hourly_by_day(rows, zone)
    return {day: sum(buckets[day]) for day in complete_days(buckets)}


def parse_day(day: str) -> Optional[datetime]:
    """A `day_key` back into a date, or None if it is not one.

    ⚠️ THIS MODULE OWNS THE DAY-KEY FORMAT, and until 2026-08-21 three others
    re-implemented parsing it: `weekday_of` here, `pipeline._span_days` and
    `sensor_health._days_between` each carried their own
    `strptime(day, "%Y-%m-%d")`. `day_key` is the only thing that produces these
    strings, so changing its format would have broken two modules silently —
    the format is an invariant between a producer and its readers, and it had
    no single reader. Found by /dry-audit.

    What each caller does with the result is NOT shared: an inclusive window
    span and an exclusive day gap are different questions, and so are their
    "unparseable" answers (0 days vs None). Only the parse is common.
    """
    try:
        return datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        return None


def weekday_of(day: str) -> Optional[int]:
    """Monday = 0. None for an unparseable key."""
    parsed = parse_day(day)
    return parsed.weekday() if parsed is not None else None


def last_reading_day(rows: Sequence[Dict[str, Any]],
                     zone: Any = None) -> Optional[str]:
    """The most recent day with any usable reading at all.

    Deliberately does NOT require a complete day: this answers "when did this
    sensor last say anything", which is a different question from "when was it
    last measurable", and conflating them would report a sensor as dead on the
    day it happens to be reporting.
    """
    days = sorted(hourly_by_day(rows, zone))
    return days[-1] if days else None
