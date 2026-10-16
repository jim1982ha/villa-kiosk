"""Time helpers. All skill output is in the villa's local time zone, which is
read from Home Assistant (config.time_zone) and stored in the knowledge pack.
UTC never reaches a chat message."""

from __future__ import annotations

import math
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo


def local_day(ms: int, zone: "str | ZoneInfo") -> date:
    """The villa's day of a Home Assistant statistics row's `start` (milliseconds, UTC).

    One reading for the night's checks and the reports (they each had their own copy)."""
    z = ZoneInfo(zone) if isinstance(zone, str) else zone
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(z).date()


def villa_time(iso, zone: "str | ZoneInfo") -> datetime | None:
    """A time Home Assistant or the store wrote, in the villa's zone. Both write UTC; a time with its zone cut off
    (Home Assistant's last_changed[:16]) is UTC too. None when there is none.

    ⚠️ ONE CONVERSION (architecture review, 2026-10-07): the reports cut these to 16 or 10 characters and showed or
    compared them as the villa's — a to-do's "offline since" was UTC, a Monday-morning task fell in the week before."""
    if not iso:
        return None
    t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    z = ZoneInfo(zone) if isinstance(zone, str) else zone
    return (t if t.tzinfo else t.replace(tzinfo=timezone.utc)).astimezone(z)


def villa_date(iso, zone: "str | ZoneInfo") -> date | None:
    """The villa's day of such a time; a date alone (a finding's opened_day: the villa's already) is kept."""
    if not iso:
        return None
    s = str(iso)
    return date.fromisoformat(s) if len(s) == 10 else villa_time(s, zone).date()


def villa_day(zone: "str | ZoneInfo", as_of: str | None = None, last_finished: bool = False) -> date:
    """The day a script works on: the one named (--as-of, YYYY-MM-DD), or today at the villa — or, for a check
    that judges a whole day, the last FINISHED one (the night's run at 02:00 judged the date it ran on: two hours
    of data, villa 2026-10-04). One rule for every skill (architecture review, 2026-10-07)."""
    if as_of:
        return date.fromisoformat(as_of)
    z = ZoneInfo(zone) if isinstance(zone, str) else zone
    today = datetime.now(z).date()
    return today - timedelta(days=1) if last_finished else today


def day_label(d: date, weekday: bool = False, long: bool = False, year: bool = False, numeric: bool = False) -> str:
    """A day as every message and report writes it: "5 Oct", never "05 Oct". weekday: "Mon 5 Oct"; long:
    "Monday 5 October"; year: "… 2026"; numeric: "05/10/2026", as a message's title and its notices say it.

    ⚠️ ONE FORMAT (2026-10-05): seven hand-written strftime("%d %b") calls in the skills, four stripping
    the leading zero and three not, so the same report said "05 Oct" in one line and "5 Oct" in the next.
    (Seven helpers here — ms_to_local, parse_iso, fmt_day… — had no caller at all; they went.) Seven more
    ("%a %d %b": "Mon 05 Oct") were found by the architecture review of 2026-10-07: weekday and long are here
    so no skill needs its own."""
    if numeric:
        return f"{d:%d}/{d:%m}/{d.year}"
    out = f"{d.day} {d:%B}" if long else f"{d.day} {d:%b}"
    if weekday or long:
        out = f"{d:%A} {out}" if long else f"{d:%a} {out}"
    return f"{out} {d.year}" if year else out


def moment_label(d: datetime, zone: "str | ZoneInfo") -> str:
    """A moment as every notice writes it: "11/10/2026 07:05", in the villa's time (vesta_agent/notice.when)."""
    t = d.astimezone(ZoneInfo(zone) if isinstance(zone, str) else zone)
    return f"{day_label(t.date(), numeric=True)} {t:%H:%M}"


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


def lasting(seconds: float) -> str:
    """A duration in words a person reads: "8 s", "47 min", "1 h 15 min", "2 h", "1 d 9 h", "3 d" — the Kiosk's own
    wording (chartUtils.fmtDuration): from a day on, days and hours.

    ⚠️ ONE DURATION WORDING (architecture review, 2026-10-13): the investigation's lines said "1 h 15 min" and its page,
    just above the AI's reading of them, "75 min" for the same outage — three copies, two rules.
    ⚠️ NOT "33 h" (owner, 2026-10-15): the night check's "offline for 33 h" sat in the Cockpit beside the Kiosk's
    "1 d 9 h", and its "has not reported for 1.4 days" was a third way.
    ⚠️ ONE RULE ON BOTH APPS (architecture review round 2, 2026-10-16): this said "89 s" where the Kiosk said "1 min",
    and "1 h 29 min" for its "1 h 30 min" (seconds from 90 s, minutes cut); the weekly report's "Lasted" a third rule.
    Now the Kiosk's: rounded to the second (never under "1 s"), to the minute from a minute on, whole hours from a day
    on. A half rounds UP, as JavaScript's Math.round does (Python's round() would make 150 s "2 min"). The agreement's
    `duration.cases` (agent-contract.json) are the words, on both sides (test_duration_words)."""
    def half_up(x: float) -> int:
        return math.floor(x + 0.5)
    s = max(0, half_up(float(seconds)))
    if s < 60:
        return f"{max(1, s)} s"
    m = half_up(s / 60)
    if m < 60:
        return f"{m} min"
    h, m = divmod(m, 60)
    if h < 24:
        return f"{h} h {m} min" if m else f"{h} h"
    d, h = divmod(h, 24)
    return f"{d} d {h} h" if h else f"{d} d"
