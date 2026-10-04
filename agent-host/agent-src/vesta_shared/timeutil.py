"""Time helpers. All skill output is in the villa's local time zone, which is
read from Home Assistant (config.time_zone) and stored in the knowledge pack.
UTC never reaches a chat message."""

from __future__ import annotations

from datetime import datetime, date
from zoneinfo import ZoneInfo


def tz(name: str) -> ZoneInfo:
    return ZoneInfo(name)


def day_label(d: date) -> str:
    """A day as every message and report writes it: "5 Oct", never "05 Oct".

    ⚠️ ONE FORMAT (2026-10-05): seven hand-written strftime("%d %b") calls in the skills, four stripping
    the leading zero and three not, so the same report said "05 Oct" in one line and "5 Oct" in the next.
    (Seven helpers here — ms_to_local, parse_iso, fmt_day… — had no caller at all; they went.)"""
    return d.strftime("%d %b").lstrip("0")


def day_time_label(d: datetime) -> str:
    """A day and a time: "5 Oct, 09:30"."""
    return d.strftime("%d %b, %H:%M").lstrip("0")


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
