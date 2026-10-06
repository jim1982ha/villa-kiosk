"""What a day of a meter's Home Assistant statistics says: one reading for every skill.

Moved from preventive-maintenance's features.py (architecture review, 2026-10-07): roi-energy used them by
importing that skill's script folder by path — a villa without the preventive-maintenance skill would have
broken its energy reports. Pure functions: statistics rows in, numbers per local day out.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date

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


def energy_daily_features(day_rows: list[dict], zone: str) -> dict[date, dict]:
    out = {}
    for r in day_rows:
        d = local_day(r["start"], zone)
        ch = r.get("change")
        out[d] = {"kwh": round(ch, 3) if ch is not None else None,
                  "counter_reset": bool(ch is not None and ch < 0)}
    return out
