"""A schedule's time in words: "07:00" every day, "Mon 08:00" each week, "1 08:00" each month, villa time.

⚠️ ONE READER OF THIS WORDING (architecture review, round 9): it was read in five places, each with its own idea of
today. The scheduler built a slot on the clock's own date, so a 23:45 job missed by a restart across midnight was lost
although its catch-up window still held it; "31 08:00" asked for day 31 and never ran in a 30-day month; the skill
check, the settings page and the chat reset each had a pattern or a split of their own. `Spec.parse` reads it once;
`due`, `last_at` and `next_after` say when it falls, `words` and `per_month` what the page shows.

A day the month lacks ("31" in November, "30" in February) runs on the month's last day, and its words say so.
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import datetime, timedelta

#: the week's days as the schedule writes them, Monday first (datetime.weekday's order: never strftime, which follows
#: the machine's language)
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
DAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_SPEC = re.compile(r"^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun|[1-9]|[12][0-9]|3[01]) )?([01][0-9]|2[0-3]):([0-5][0-9])$")
#: what a person reads when a time is refused (the skill check and the settings page say the same)
SHAPES = "HH:MM (every day), Mon HH:MM (each week) or D HH:MM (each month)"
#: how far a search for the next or last slot looks: a monthly slot is never further than this
_SEARCH_DAYS = 62


class Invalid(ValueError):
    """A time not written as SHAPES says."""


@dataclass(frozen=True)
class Spec:
    hour: int
    minute: int
    weekday: int | None = None          # 0 = Monday
    day: int | None = None              # day of the month, 1..31

    @classmethod
    def parse(cls, text) -> "Spec":
        m = _SPEC.match(str(text or "").strip())
        if not m:
            raise Invalid(f"{text!r} is not {SHAPES}")
        cond, h, mi = m.group(1), int(m.group(2)), int(m.group(3))
        if cond is None:
            return cls(h, mi)
        if cond.isdigit():
            return cls(h, mi, day=int(cond))
        return cls(h, mi, weekday=WEEKDAYS.index(cond))

    @staticmethod
    def valid(text) -> bool:
        return bool(_SPEC.match(str(text or "").strip()))

    @property
    def time(self) -> str:
        return f"{self.hour:02d}:{self.minute:02d}"

    def _on(self, d: datetime) -> datetime | None:
        """This spec's slot on `d`'s day, or None when it does not fall on that day."""
        if self.weekday is not None and d.weekday() != self.weekday:
            return None
        if self.day is not None and d.day != min(self.day, calendar.monthrange(d.year, d.month)[1]):
            return None
        return d.replace(hour=self.hour, minute=self.minute, second=0, microsecond=0)

    def last_at(self, now: datetime) -> datetime | None:
        """The latest slot at or before `now` (its day may be yesterday, or last month)."""
        for back in range(_SEARCH_DAYS):
            slot = self._on(now - timedelta(days=back))
            if slot is not None and slot <= now:
                return slot
        return None

    def due(self, now: datetime, window: timedelta) -> datetime | None:
        """The slot to run at `now`: the latest one, when `now` is still inside its catch-up `window`; else None.
        ⚠️ LOOKS BACK ACROSS MIDNIGHT: a 23:45 slot is still due at 00:05 the next day with a 30-minute window."""
        slot = self.last_at(now)
        return slot if slot is not None and now - slot <= window else None

    def next_after(self, after: datetime) -> datetime | None:
        """The first slot strictly after `after`."""
        for d in range(_SEARCH_DAYS):
            slot = self._on(after + timedelta(days=d))
            if slot is not None and slot > after:
                return slot
        return None

    def words(self) -> str:
        """The schedule as the VESTA Agent page says it."""
        if self.weekday is not None:
            return f"every {DAY_NAMES[self.weekday]} at {self.time}"
        if self.day is not None:
            short = ", or on the last day of a shorter month" if self.day > 28 else ""
            return f"on day {self.day} of each month at {self.time}{short}"
        return f"every day at {self.time}"

    def per_month(self) -> float:
        """How many times it runs in a month (the page's cost of a month of runs)."""
        if self.weekday is not None:
            return 4.35
        if self.day is not None:
            return 1.0
        return 30.0
