"""A battery's state: its charge and where it is heading — one reading for every skill. Pure, no threshold.

⚠️ ONE OWNER: THE NIGHT CHECK (owner, 2026-10-19: "the night check owns each number asked twice"). The weekly page
judged a battery itself (red under 20 %, amber under 35 %) and its playbook projected "weeks left" to its own 20 %,
while the night check said "replace now" under 10 %, "within the week" under 20 % and "days left" to 10 % — the same
cell had two "replace" lines and two projections. The night check judges (preventive-maintenance rules.py, its
settings.yaml thresholds); the page shows the charge and the night's open finding. The floor of a projection is the
caller's setting, passed in: none is defaulted here.
"""
from __future__ import annotations

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


#: The store's record of each battery's rested level as the night check last judged it (preventive-maintenance
#: nightly.battery_best: its highest reading of the window) — {entity: value in its own unit}.
#: ⚠️ ONE LEVEL ON EVERY PAGE (architecture review, 2026-10-22): the weekly page printed a battery's reading of the
#: moment, so a coin cell's 1 % dip between two readings near 50 % headed the list while the night check judged it 50 %.
RESTED = "battery-rested"


def keep_rested(store, best: dict[str, float]) -> None:
    """Record these rested levels (merged over the ones kept: a 5-minute look reads only its open faults' batteries)."""
    if store is None or not best:
        return
    store.cache_put(RESTED, {**(store.cache_get(RESTED) or {}), **{k: float(v) for k, v in best.items()}})


def rested(store, entity_id: str, now: float | None) -> float | None:
    """A battery's level as the night check judges it: its reading `now`, raised to the rested level it last kept
    (a battery changed since reads higher now, and that reading stands). None when `now` is None."""
    get = getattr(store, "cache_get", None)              # a page drawn without the night's record: its reading
    kept = (get(RESTED) or {}).get(entity_id) if get is not None else None
    return now if now is None or kept is None else max(now, float(kept))
