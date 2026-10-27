"""A battery's state: its charge and where it is heading — one reading for every skill. Pure, no threshold.

⚠️ ONE OWNER: THE NIGHT CHECK (owner, 2026-10-19: "the night check owns each number asked twice"). The weekly page
judged a battery itself (red under 20 %, amber under 35 %) and its playbook projected "weeks left" to its own 20 %,
while the night check said "replace now" under 10 %, "within the week" under 20 % and "days left" to 10 % — the same
cell had two "replace" lines and two projections. The night check judges (preventive-maintenance rules.py, its
settings.yaml thresholds); the page shows the charge and the night's open finding. The floor of a projection is the
caller's setting, passed in: none is defaulted here.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import NamedTuple

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


class Verdict(NamedTuple):
    """What a rule's reading now says of one of its open findings (preventive-maintenance: the night and the 5-minute
    recheck): `seen`, still found; `handed`, the close note when another finding follows it now (it closes, never
    "cleared"); `opens`, the findings to open now in its place; `restate`, the finding to raise again with its new
    words (the same fault, another level)."""
    seen: bool
    handed: str | None = None
    opens: tuple = ()
    restate: object | None = None


def seen(row: dict, found) -> Verdict:
    """Every rule's verdict but the battery's: still found, or not."""
    return Verdict(any(x.rule_id == row["rule_id"] and x.entity_id == row["entity_id"] for x in found))


def judge(row: dict, found) -> Verdict:
    """THE battery verdict on an open finding (`row`, as stored) from what its rule finds now (`found`): ONE place for
    what the night and the recheck each worked out (architecture review N, 2026-10-27).

    ⚠️ A STEP IS NOT A CLEAR (architecture review, 2026-10-22): the two "replace" steps are two rules, so a battery at
    18 % that fell to 9 % closed "Cleared: the check at 14:05 no longer sees it" — and a P2 back at 16 % was marked ✅
    cleared on Telegram while still under its line. Found at the other step: handed to that step's finding ("Now: <its
    words>"), opened now. ⚠️ ONE LEVEL, ONE TITLE (review, 2026-10-23): at the same step at another WHOLE percent (its
    words say the level as a whole number), it is raised again, so its title, the Kiosk's fault and the weekly page say
    the level judged now."""
    v = seen(row, found)
    if row["rule_id"] not in REPLACE:
        return v
    step = next((x for x in found if x.entity_id == row["entity_id"] and x.rule_id in REPLACE
                 and x.rule_id != row["rule_id"]), None)
    if step is not None:
        return Verdict(False, handed=f"Now: {step.summary}", opens=(step,))
    same = next((x for x in found if x.rule_id == row["rule_id"] and x.entity_id == row["entity_id"]), None)
    return Verdict(True, restate=same) if same is not None and _restated(row, same) else v


def _restated(row: dict, finding) -> bool:
    """Whether the stored finding and the one found now say another whole percent."""
    try:
        was = json.loads(row.get("detail") or "{}").get("level")
        now = finding.detail.get("level")
        return was is not None and now is not None and f"{float(was):.0f}" != f"{float(now):.0f}"
    except (TypeError, ValueError, AttributeError):
        return False


def level(reading: float | None, best: float | None) -> float | None:
    """The level a battery is judged at: the higher of its reading now and its best of the window (the night's
    battery_level_window_hours). ⚠️ A BATTERY ONLY EVER READS LOW BY MISTAKE (owner, 2026-10-21): a coin cell's voltage
    dips under load and comes back at rest. No reading: None (judged with none), whatever its best."""
    return None if reading is None else (max(reading, best) if best is not None else reading)


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
