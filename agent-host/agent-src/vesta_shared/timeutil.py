"""Time helpers. All skill output is in the villa's local time zone, which is
read from Home Assistant (config.time_zone) and stored in the knowledge pack.
UTC never reaches a chat message."""

from __future__ import annotations

import math
import re
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo

from . import agreement


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


#: How every notice writes a moment ("11/10/2026 07:05") and a day ("11/10/2026"): ⚠️ THE AGREEMENT'S, the tablet writes
#: the same (agent-contract.json `moment`; owner, 2026-10-29: alert #83 said "24/10/2026 19:05" on Telegram and
#: "2026-10-24 19:05" on the tablet). `moment_label`, and the villa's own alert template, which fills "Cleared on
#: {time}." with its clock (message_format.jinja_words writes this format into it). Locale-free directives only: the
#: same text on any machine.
MOMENT: dict = agreement.section("moment")
if not (isinstance(MOMENT.get("format"), str) and isinstance(MOMENT.get("date"), str)):
    # ⚠️ ONE LOUD FAILURE, NEVER A GUESS (round 2 of review R): a second format typed here would be the copy the
    # agreement exists to end; the image ships the file (agent-host/tests/test_kiosk_contract.py holds it to the Kiosk's)
    raise RuntimeError("The agreement with the Kiosk (agent-contract.json) names no `moment` format: copy the Kiosk's "
                       "file (agent-host/tools/release.py ship does)")
MOMENT_FORMAT: str = MOMENT["format"]


def moment_label(d: datetime, zone: "str | ZoneInfo") -> str:
    """A moment as every notice writes it: "11/10/2026 07:05", in the villa's time (vesta_agent/notice.when)."""
    t = d.astimezone(ZoneInfo(zone) if isinstance(zone, str) else zone)
    return t.strftime(MOMENT_FORMAT)


#: The agreement's time ("%H:%M") and its day without the year ("%d/%m"), derived from it as the Kiosk derives them
#: (src/utils/dateText.ts TIME_FORMAT, SHORT_DAY_FORMAT): one agreement, never a second format typed here.
TIME_FORMAT: str = MOMENT_FORMAT.replace(MOMENT["date"], "").strip()
SHORT_DAY_FORMAT: str = re.sub(r"(\W)?%Y(\W)?", lambda m: m.group(1) if m.group(1) and m.group(2) else "", MOMENT["date"])
#: A moment as moment_label writes it, found in a text ("07/11/2026 05:14"), its parts named.
_MOMENT_IN_TEXT = re.compile(r"(?<!\d)" + re.sub(r"%([dmYHM])", lambda m: {
    "d": r"(?P<d>\d{2})", "m": r"(?P<m>\d{2})", "Y": r"(?P<Y>\d{4})", "H": r"(?P<H>\d{2})", "M": r"(?P<M>\d{2})"}[m.group(1)],
    re.escape(MOMENT_FORMAT).replace(r"\%", "%")) + r"(?!\d)")


def status_moment(d: datetime, day: date | None) -> str:
    """A moment of an alert's Status, `d` in the villa's time: its time alone ("05:14") on the alert's own `day` (the
    day its card's strip shows), else its day without the year and its time ("08/11 09:20"); the whole moment when the
    alert's day is not known.

    ⚠️ ONE RULE FOR EVERY STATUS MOMENT (owner, 2026-11-07, every alert, Telegram and the tablet alike): "Alert sent
    07/11/2026 05:14" under a card whose strip says 07/11/2026 repeated the day on every line."""
    if day is None:
        return d.strftime(MOMENT_FORMAT)
    return d.strftime(TIME_FORMAT) if d.date() == day else d.strftime(f"{SHORT_DAY_FORMAT} {TIME_FORMAT}")


def status_moments(text: str, day: date | None, on: tuple[tuple[str, str], ...] = ()) -> tuple[str, int]:
    """`text` with every whole moment in it ("07/11/2026 05:14", as moment_label writes it) written as status_moment
    says, and how many it rewrote. `on`: the words a moment follows when it is a day ("on") and when it is a time alone
    ("at"), each language's (status_words.ON): "Cleared on 07/11/2026 05:23" reads "Cleared at 05:23"."""
    if day is None or not text:
        return text, 0
    n = 0

    def short(m: re.Match) -> str:
        nonlocal n
        try:
            d = datetime(int(m["Y"]), int(m["m"]), int(m["d"]), int(m["H"]), int(m["M"]))
        except ValueError:
            return m.group(0)
        n += 1
        return status_moment(d, day)
    out = _MOMENT_IN_TEXT.sub(short, text)
    for day_word, time_word in on:
        out = re.sub(rf"(?<!\w){re.escape(day_word)} (?=\d\d:\d\d(?!/|\d))", f"{time_word} ", out)
    return out, n


def first_moment(lines) -> date | None:
    """The day of the first whole moment among `lines` (a Status written before its alert's day was kept: its first
    step's, "Alert sent 07/11/2026 05:14"); None when none says one."""
    for ln in lines or ():
        m = _MOMENT_IN_TEXT.search(str(ln))
        if m:
            try:
                return date(int(m["Y"]), int(m["m"]), int(m["d"]))
            except ValueError:
                continue
    return None


def day_label(d: date, weekday: bool = False, short: bool = False) -> str:
    """A day as every message, notice and page writes it: the agreement's date, "05/10/2026"; weekday: "Mon 05/10/2026";
    short: the weekday alone, "Mon" (a column of days).

    ⚠️ ONE FORMAT (2026-10-05): seven hand-written strftime("%d %b") calls in the skills, four stripping
    the leading zero and three not, so the same report said "05 Oct" in one line and "5 Oct" in the next.
    (Seven helpers here — ms_to_local, parse_iso, fmt_day… — had no caller at all; they went.) Seven more
    ("%a %d %b": "Mon 05 Oct") were found by the architecture review of 2026-10-07: weekday is here so no skill
    needs its own. ⚠️ AND IT IS THE AGREEMENT'S (owner, 2026-11-05: "one date format everywhere"): a message's title
    said "04/11/2026" and its lines "4 Nov"; every day is now the Kiosk's and the titles' (MOMENT["date"]), so the
    words "5 Oct", "Monday 5 October" and their `long`, `year` and `numeric` switches went."""
    if short:
        return f"{d:%a}"
    out = d.strftime(MOMENT["date"])
    return f"{d:%a} {out}" if weekday else out


def day_time_label(d: datetime, weekday: bool = False) -> str:
    """A day and a time, the agreement's moment as `d` holds it (already in the villa's time): "05/10/2026 09:30"
    (weekday: "Mon 05/10/2026 09:30"). moment_label converts to the villa's zone first."""
    out = d.strftime(MOMENT_FORMAT)
    return f"{d:%a} {out}" if weekday else out


def month_label(d: date) -> str:
    """A month as a report's title says it: "October 2026"."""
    return f"{d:%B} {d.year}"


def clock(t: datetime, zone: "str | ZoneInfo", *, days: bool, seconds: bool = False) -> str:
    """A moment on an investigation, in the villa's time: "03:09" — with its day when the period spans several
    ("09/10/2026 03:09", the agreement's moment) — and with its seconds where they matter ("03:09:46": the lines the
    AI reads, where a 71-second drop must keep its seconds).

    ⚠️ ONE CLOCK (architecture review round 3, 2026-10-19): the lines the AI read said "09/10 03:09:46", the page's
    log "9 Oct, 03:09" and its charts "03:09", and SKILL.md asked the AI to write "09/10 07:30" — which the page then
    put in the same column as "9 Oct, 03:09". Its day is day_label's since 2026-11-05 (one date format)."""
    t = t.astimezone(ZoneInfo(zone) if isinstance(zone, str) else zone)
    hm = f"{t:%H:%M:%S}" if seconds else f"{t:%H:%M}"
    return f"{day_label(t.date())} {hm}" if days else hm


def said(value, zone: "str | ZoneInfo | None" = None, *, weekday: bool = False, day: bool = False):
    """A figure as a report page says it: an ISO day ("2026-10-05") reads "05/10/2026", an ISO moment
    ("2026-10-05T09:30", with or without its zone) "05/10/2026 09:30" — in the villa's `zone` when the moment carries
    one; `weekday`: "Mon 05/10/2026…"; `day`: a moment reads as its day alone ("Since 05/10/2026."). Anything else, as it is.

    ⚠️ ONE READER OF A STORED TIME (architecture review round 3, 2026-10-19): the playbook's `_fill.show` and the
    composer's `day()` / `when()` each sniffed the ISO strings facts.json keeps, by their lengths, with their own
    fallbacks. facts.json keeps ISO; this is the one place a page turns it into words."""
    if not isinstance(value, str):
        return value
    s = value
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        try:
            return day_label(date.fromisoformat(s), weekday=weekday)
        except ValueError:
            return value
    if len(s) >= 16 and s[10] == "T":
        try:
            t = datetime.fromisoformat(s)
        except ValueError:
            return value
        if t.tzinfo and zone:
            t = t.astimezone(ZoneInfo(zone) if isinstance(zone, str) else zone)
        return day_label(t.date(), weekday=weekday) if day else day_time_label(t, weekday=weekday)
    return value


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
    """A duration in words a person reads: "8s", "47min", "1h 15min", "2h", "1d 9h", "3d" — the Kiosk's own wording
    (chartUtils.fmtDuration): from a day on, days and hours.

    ⚠️ EACH UNIT JOINED TO ITS NUMBER (owner, 2026-10-24: "Watch 1 h" should read "1h"; all units: "1h 30min", "10min",
    "30s"), replacing 2026-10-23's spaced "1 h 30 min".

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
        return f"{max(1, s)}s"
    m = half_up(s / 60)
    if m < 60:
        return f"{m}min"
    h, m = divmod(m, 60)
    if h < 24:
        return f"{h}h {m}min" if m else f"{h}h"
    d, h = divmod(h, 24)
    return f"{d}d {h}h" if h else f"{d}d"
