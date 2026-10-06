"""Time helpers. All skill output is in the villa's local time zone, which is
read from Home Assistant (config.time_zone) and stored in the knowledge pack.
UTC never reaches a chat message."""

from __future__ import annotations

from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo


def local_day(ms: int, zone: "str | ZoneInfo") -> date:
    """The villa's day of a Home Assistant statistics row's `start` (milliseconds, UTC).

    One reading for the night's checks and the reports (they each had their own copy)."""
    z = ZoneInfo(zone) if isinstance(zone, str) else zone
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(z).date()


def villa_day(zone: "str | ZoneInfo", as_of: str | None = None, last_finished: bool = False) -> date:
    """The day a script works on: the one named (--as-of, YYYY-MM-DD), or today at the villa — or, for a check
    that judges a whole day, the last FINISHED one (the night's run at 02:00 judged the date it ran on: two hours
    of data, villa 2026-10-04). One rule for every skill (architecture review, 2026-10-07)."""
    if as_of:
        return date.fromisoformat(as_of)
    z = ZoneInfo(zone) if isinstance(zone, str) else zone
    today = datetime.now(z).date()
    return today - timedelta(days=1) if last_finished else today


def day_label(d: date, weekday: bool = False, long: bool = False, year: bool = False) -> str:
    """A day as every message and report writes it: "5 Oct", never "05 Oct". weekday: "Mon 5 Oct"; long:
    "Monday 5 October"; year: "… 2026".

    ⚠️ ONE FORMAT (2026-10-05): seven hand-written strftime("%d %b") calls in the skills, four stripping
    the leading zero and three not, so the same report said "05 Oct" in one line and "5 Oct" in the next.
    (Seven helpers here — ms_to_local, parse_iso, fmt_day… — had no caller at all; they went.) Seven more
    ("%a %d %b": "Mon 05 Oct") were found by the architecture review of 2026-10-07: weekday and long are here
    so no skill needs its own."""
    out = f"{d.day} {d:%B}" if long else f"{d.day} {d:%b}"
    if weekday or long:
        out = f"{d:%A} {out}" if long else f"{d:%a} {out}"
    return f"{out} {d.year}" if year else out


def day_time_label(d: datetime, weekday: bool = False, year: bool = False) -> str:
    """A day and a time: "5 Oct, 09:30" (weekday: "Mon 5 Oct, 09:30")."""
    return f"{day_label(d, weekday=weekday, year=year)}, {d:%H:%M}"


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
