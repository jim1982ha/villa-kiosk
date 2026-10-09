"""What a day of a meter's Home Assistant statistics says: one reading for every skill.

Moved from preventive-maintenance's features.py (architecture review, 2026-10-07): roi-energy used them by
importing that skill's script folder by path — a villa without the preventive-maintenance skill would have
broken its energy reports. Pure functions: statistics rows in, numbers per local day out.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date

from .params import MissingParameter
from .stats import med
from .timeutil import local_day


def power_daily_features(hour_rows: list[dict], zone: str, on_threshold_w: float) -> dict[date, dict]:
    """From hourly mean/min/max of a power sensor.

    run_hours       hours the asset was drawing power, partial hours weighted by mean/max
    full_hours      whole hours with min above the threshold (steady running)
    running_power   mean of the full hours' means (the signature we trend)
    peak_w          highest max of the day
    gap_hours       hours with no statistics row at all (data missing)
    """
    by_day: dict[date, list[dict]] = defaultdict(list)
    for r in hour_rows:
        by_day[local_day(r["start"], zone)].append(r)
    out = {}
    for day, rows in by_day.items():
        on = [r for r in rows if r.get("mean") is not None and r["mean"] > on_threshold_w]
        full = [r for r in rows if r.get("min") is not None and r["min"] > on_threshold_w]
        run_hours = sum(min(1.0, r["mean"] / r["max"]) for r in on if r.get("max"))
        out[day] = {
            "run_hours": round(run_hours, 2),
            "full_hours": len(full),
            "running_power": round(sum(r["mean"] for r in full) / len(full), 1) if full else None,
            "peak_w": round(max((r.get("max") or 0) for r in rows), 0),
            "gap_hours": 24 - len(rows),
            "hours_with_data": len(rows),
        }
    return out


def running_threshold(asset: dict | None, hour_rows: list[dict], params) -> float:
    """Power above which a device counts as running: a fraction of its typical hourly maximum, capped by its baseline
    helper when it has one; the floor when there is neither. Nothing hardcoded per pump.

    ⚠️ ONE "RUNNING" (architecture review 13, 2026-10-09): the night check, the energy figures and the filtration
    optimiser each had a copy, and only the night check's had the cap and the floor — the same pump had two run-hour
    numbers when its baseline helper was set."""
    frac = params.behaviour("on_threshold_fraction")
    maxes = [r["max"] for r in hour_rows if r.get("max") and r["max"] > 0]
    data_thr = (med(maxes) or 0) * frac if maxes else 0
    helper_thr = None
    if (asset or {}).get("baseline_helper"):
        try:
            helper_thr = params.number(asset["baseline_helper"].split(".", 1)[1]) * frac
        except MissingParameter:
            helper_thr = None
    cands = [t for t in (data_thr, helper_thr) if t]
    return min(cands) if cands else params.behaviour("on_threshold_floor_w")


def power_days(asset: dict | None, hour_rows: list[dict], zone: str, params) -> tuple[float | None, dict[date, dict]]:
    """A device's days from its hourly power statistics, judged by the one running threshold: (threshold, days).
    No rows: (None, {}) — nothing to judge. No hourly maximum above zero: its run hours are 0 whatever the threshold
    (they are weighted by the maximum), so the floor is not asked for (roi-energy has no floor setting: it never
    needed one) and the threshold is 0."""
    if not hour_rows:
        return None, {}
    drew = any((r.get("max") or 0) > 0 for r in hour_rows)
    thr = running_threshold(asset, hour_rows, params) if drew else 0.0
    return thr, power_daily_features(hour_rows, zone, thr)


def energy_daily_features(day_rows: list[dict], zone: str) -> dict[date, dict]:
    out = {}
    for r in day_rows:
        d = local_day(r["start"], zone)
        ch = r.get("change")
        out[d] = {"kwh": round(ch, 3) if ch is not None else None,
                  "counter_reset": bool(ch is not None and ch < 0)}
    return out
