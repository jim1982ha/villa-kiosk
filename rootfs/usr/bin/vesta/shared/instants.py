"""Reading an ISO-8601 stamp as an instant. Pure; the one owner of that rule.

⚠️ THIS EXISTS BECAUSE THE SAME COMPARISON WAS WRITTEN THREE TIMES AND ONE OF
THEM SHIPPED A BUG (2026-08-30). Ordering ISO-8601 text lexicographically is
only chronological when both sides carry the SAME OFFSET. Stored stamps are
UTC — `record.append` uses `datetime.now(timezone.utc)`, and a journal row takes
Home Assistant's own `time_fired` — while a caller naturally builds a window
from the villa's LOCAL wall clock, because `schedule.period_start` is
deliberately wall-clock midnight.

`collect.as_utc_iso` was written for exactly this and says so at length. Then
`journal.since` restated the trap in prose and pushed it onto its callers, and
`record.since` — added later — made the comparison and used neither. On a UTC+8
villa that silently dropped the first eight hours of every local day from the
daily briefing: six device-watchdog alerts fired at 00:52 and the 10:00 brief
did not mention them.

⚠️ SO THE RULE LIVES IN ONE PLACE AND IN `shared`, WHERE EVERY LAYER CAN REACH
IT. `adapters` and `supervise` may both import `shared` and neither may import
the other, so this is the only home from which `collect`, `record` and `journal`
can share one implementation. It is pure — no clock, no I/O, no environment —
which is what keeps `shared` shippable anywhere.

⚠️ A NAIVE VALUE IS READ AS UTC RATHER THAN REJECTED, and that is deliberate:
every producer in this tree is tz-aware, so a naive stamp can only arrive from
stored data an operator touched, and a briefing must not fail to be delivered
over a timestamp.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping, Optional


def as_utc(value: Any) -> Optional[datetime]:
    """An ISO-8601 stamp as an aware UTC datetime, or `None` if unreadable.

    ⚠️ `None` IS A REAL ANSWER AND CALLERS MUST DECIDE WHAT IT MEANS. Both
    windowed readers treat it as "keep this row", because an entry silently
    vanishing from a report is the failure this subsystem keeps being caught
    by — thin-but-honest beats quietly empty.
    """
    try:
        moment = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    return moment.astimezone(timezone.utc) if moment.tzinfo \
        else moment.replace(tzinfo=timezone.utc)


def as_utc_iso(value: str, *, timespec: str = "seconds") -> str:
    """The same instant re-expressed in UTC, as text.

    ⚠️ AN UNREADABLE VALUE COMES BACK UNCHANGED rather than raising. This is
    the older half of the pair and its contract predates this module: callers
    compare the result as a string, and handing them `""` would widen a window
    to everything instead of leaving it exactly as wrong as it was.
    """
    moment = as_utc(value)
    return value if moment is None else moment.isoformat(timespec=timespec)


#: Home Assistant's own keys for a schedule helper's days, in week order —
#: `datetime.weekday()` indexes it. ⚠️ IN `shared` BECAUSE THREE LAYERS READ
#: IT (2026-09-04): the adapter that fetches a helper's week, the agent tool
#: that decides what a block is, and the calibration module that walks the
#: week — and `shared` is the only layer all three may import.
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday",
            "saturday", "sunday")


def seconds_of(duration: Any) -> float:
    """A blueprint duration input as seconds.

    `{"hours", "minutes", "seconds"}` (and `days`) is how Home Assistant's
    duration selector stores one; a bare number is taken as seconds; anything
    else is 0, which every reader treats as "not set".
    """
    if isinstance(duration, bool):
        return 0.0
    if isinstance(duration, (int, float)):
        return max(0.0, float(duration))
    if not isinstance(duration, Mapping):
        return 0.0
    total = 0.0
    for key, factor in (("days", 86_400.0), ("hours", 3_600.0),
                        ("minutes", 60.0), ("seconds", 1.0)):
        try:
            total += float(duration.get(key) or 0) * factor
        except (TypeError, ValueError):
            pass
    return max(0.0, total)
