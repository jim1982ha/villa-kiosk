"""A battery's state: its charge and where it is heading — one reading for every skill. Pure, no threshold.

⚠️ ONE OWNER: THE NIGHT CHECK (owner, 2026-10-19: "the night check owns each number asked twice"). The weekly page
judged a battery itself (red under 20 %, amber under 35 %) and its playbook projected "weeks left" to its own 20 %,
while the night check said "replace now" under 10 %, "within the week" under 20 % and "days left" to 10 % — the same
cell had two "replace" lines and two projections. The night check judges (preventive-maintenance rules.py, its
settings.yaml thresholds); the page shows the charge and the night's open finding. The floor of a projection is the
caller's setting, passed in: none is defaulted here.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from .stats import slope_per_hour

#: The night check's battery findings, which the reports read back (the page's "replace" / "watch").
CRIT, LOW, TREND = "PM-BATTERY-CRIT", "PM-BATTERY-LOW", "PM-BATTERY-TREND"
#: A finding that says "replace it" (CRIT: now, LOW: within the week, or a voltage below its share of the nominal).
REPLACE = frozenset({CRIT, LOW})


def charge(value: float | None, unit: str | None, nominal_v: float | None = None) -> float | None:
    """A battery's charge in %: as the sensor gives it (%), or its voltage against its nominal voltage (V).
    None when it cannot be told — volts with no nominal set (the night check asks for the helper)."""
    if value is None:
        return None
    unit = (unit or "%").strip()
    if unit == "%":
        return float(value)
    if unit == "V":
        return round(min(100.0, value / nominal_v * 100), 1) if nominal_v else None
    return None


def projection(points: list[tuple[float, float]], floor_pct: float, level: float | None = None) -> dict | None:
    """Where a battery is heading from its daily points (day index, charge %): {per_day: its change a day (least
    squares; negative when it falls), days_left: days until it reaches `floor_pct` from `level` (its charge now; the
    last point when not given) — None when it is not falling}. None with fewer than three points (no slope)."""
    per_day = slope_per_hour([(float(i), float(v)) for i, v in points])     # the points are per day: a slope per day
    if per_day is None:
        return None
    now = points[-1][1] if level is None else level
    return {"per_day": per_day, "days_left": (now - floor_pct) / -per_day if per_day < 0 else None}


#: The store's record of each battery's level as the night check last JUDGED it, with when — {entity: {"level": value
#: in its own unit, or None when it was judged with no reading, "at": ISO time}}. Written ONLY by the judging itself
#: (preventive-maintenance nightly.battery_findings, for the night and the 5-minute recheck alike).
#: ⚠️ ONE LEVEL ON EVERY PAGE (architecture review, 2026-10-22): the weekly page printed a battery's reading of the
#: moment, so a coin cell's 1 % dip between two readings near 50 % headed the list while the night check judged it 50 %.
#: ⚠️ THE LEVEL JUDGED, DATED (review, 2026-10-23): the record kept each window's best reading, merged and never
#: dated. A night with no hourly statistics for a battery (asleep, unavailable) left the weeks-old 50 % in place; the
#: night judged its last report, 8 %, "replace now", and the weekly page printed 50 % beside it. Now the night stores
#: the level it judged (the best or the reading, whichever it used), every battery it judged, with the time; a page
#: uses it only while it is the last night's (JUDGED_HOURS), else the reading now.
RESTED = "battery-rested"
#: How long a judged level stands: the night check runs once a day; half a day more for one run late. A night missed
#: (the agent off): the reading now. Not a villa setting, the night's own cadence.
JUDGED_HOURS = 36


def keep_judged(store, levels: dict[str, float | None], at: datetime) -> None:
    """Record the level each of these batteries was judged with, at `at` (merged over the others: a 5-minute look
    judges only its open faults' batteries). Per battery, the record judged LATER stands: a replayed past night
    (nightly --as-of) judges at its own day's end and never overwrites a newer judgement. An entry of the old undated
    format ({entity: value}) is dropped: it can never be told whether it is the last night's."""
    if store is None or not levels or not hasattr(store, "cache_put"):
        return
    kept = {k: v for k, v in (store.cache_get(RESTED) or {}).items() if _dated(v)}
    when = at.isoformat()
    for k, v in levels.items():
        if not _later(kept.get(k), at):
            kept[k] = {"level": None if v is None else float(v), "at": when}
    store.cache_put(RESTED, kept)


def _later(record, at: datetime) -> bool:
    """Whether a kept record was judged after `at` (an unreadable or undated time is never later)."""
    if not _dated(record):
        return False
    try:
        when = datetime.fromisoformat(record["at"])
        return when > at if (when.tzinfo is None) == (at.tzinfo is None) else False
    except (ValueError, TypeError):
        return False


def _dated(v) -> bool:
    return isinstance(v, dict) and isinstance(v.get("at"), str)


def rested(store, entity_id: str, now: float | None, at: datetime) -> float | None:
    """A battery's level as the night check judged it: the level the last night judged (no older than JUDGED_HOURS
    before `at`), its reading `now` when that is higher (a battery changed since) or when the night's is missing,
    old, or was judged with no reading. None when `now` is None."""
    if now is None:
        return None
    get = getattr(store, "cache_get", None)              # a page drawn without the night's record: its reading
    kept = (get(RESTED) or {}).get(entity_id) if get is not None else None
    if not _dated(kept) or kept.get("level") is None:
        return now
    try:
        when = datetime.fromisoformat(kept["at"])
        if when.tzinfo is None or at.tzinfo is None:
            return now
        fresh = timedelta(0) <= at - when <= timedelta(hours=JUDGED_HOURS)
        level = float(kept["level"])
    except (ValueError, TypeError):
        return now
    return max(now, level) if fresh else now
