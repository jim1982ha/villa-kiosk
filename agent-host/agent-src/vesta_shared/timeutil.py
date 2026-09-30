"""Time helpers. All skill output is in the villa's local time zone, which is
read from Home Assistant (config.time_zone) and stored in the knowledge pack.
UTC never reaches a chat message."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone, date
from zoneinfo import ZoneInfo


def tz(name: str) -> ZoneInfo:
    return ZoneInfo(name)


def ms_to_local(ms: int, zone: str) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(tz(zone))


def parse_iso(s: str, zone: str) -> datetime:
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=tz(zone))
    return d.astimezone(tz(zone))


def local_now(zone: str) -> datetime:
    return datetime.now(tz(zone))


def day_of(d: datetime) -> date:
    return d.date()


def fmt_dt(d: datetime) -> str:
    return d.strftime("%a %d %b %H:%M")


def fmt_day(d: date) -> str:
    return d.strftime("%a %d %b")


def hhmm_to_minutes(s: str) -> int:
    h, m = s.split(":")[:2]
    return int(h) * 60 + int(m)


def schedule_hours_per_day(schedule: dict) -> dict:
    """From an HA schedule helper record, hours expected per weekday name."""
    out = {}
    for day in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"):
        blocks = schedule.get(day) or []
        minutes = 0
        for b in blocks:
            minutes += max(0, hhmm_to_minutes(b["to"]) - hhmm_to_minutes(b["from"]))
        out[day] = round(minutes / 60, 2)
    return out


WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def weekday_name(d: date) -> str:
    return WEEKDAYS[d.weekday()]


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)
