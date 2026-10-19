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

    run_hours       hours the asset was drawing power: an hour whose MAXIMUM reached the threshold counts the share
                    of it spent running, its mean over its maximum
    full_hours      whole hours with min above the threshold (steady running)
    running_power   mean of the full hours' means (the signature we trend)
    draw_w          what it drew while running: the running hours' energy over run_hours (None when it did not run)
    peak_w          highest max of the day
    gap_hours       hours with no statistics row at all (data missing)

    ⚠️ BY THE HOUR'S MAXIMUM, NOT ITS MEAN (owner, 2026-10-19). A pump that runs in short bursts — a house pressure
    pump: 3 kW for a few minutes, many times a day — never has an hourly MEAN near its running power: the night check
    read 0 h on a day it used 3.0 kWh (about 1 h at 3 kW), while the weekly page's own 15 W rule read 18 h. Judged by
    the maximum, that day is 1.1 h; a steady pump (mean close to its maximum) reads as before.
    """
    by_day: dict[date, list[dict]] = defaultdict(list)
    for r in hour_rows:
        by_day[local_day(r["start"], zone)].append(r)
    out = {}
    for day, rows in by_day.items():
        on = [r for r in rows if r.get("max") and r["max"] > on_threshold_w and r.get("mean") is not None]
        full = [r for r in rows if r.get("min") is not None and r["min"] > on_threshold_w]
        run_hours = sum(min(1.0, max(0.0, r["mean"]) / r["max"]) for r in on)
        drawn = sum(max(0.0, r["mean"]) for r in on)
        out[day] = {
            "run_hours": round(run_hours, 2),
            "full_hours": len(full),
            "running_power": round(sum(r["mean"] for r in full) / len(full), 1) if full else None,
            "draw_w": round(drawn / run_hours, 1) if run_hours > 0 else None,
            "peak_w": round(max((r.get("max") or 0) for r in rows), 0),
            "gap_hours": 24 - len(rows),
            "hours_with_data": len(rows),
        }
    return out


def typical_peak(hour_rows: list[dict]) -> float | None:
    """A device's typical peak while it runs: the hourly maximum at the middle of the energy it drew (the median of
    the maxima, each hour weighted by its mean power); the plain median when it drew nothing; None without a maximum.

    ⚠️ WHERE THE ENERGY WENT, NOT EVERY HOUR (owner, 2026-10-19). The median of every hourly maximum was the
    reference: for a pump off most of the day that is its idle noise (the jacuzzi pump's threshold was 1 W, the pool
    pump's 2.4 W under its own 10 W idle readings). Two other references were tried on the villa's data and failed:
    from the highest peak down, a lone 546 W reading of a 34 W onsen pump stayed the reference; asking several hours
    behind it, four 4–7 kW start-up spikes of a 1 kW jacuzzi pump did. A spike or a glitch draws little energy; idle
    hours draw none — the hours that drew the energy are the ones it ran."""
    pts = [(r["max"], max(0.0, r.get("mean") or 0.0)) for r in hour_rows if r.get("max") and r["max"] > 0]
    if not pts:
        return None
    total = sum(w for _, w in pts)
    if total <= 0:
        return med([m for m, _ in pts])
    acc = 0.0
    for m, w in sorted(pts):
        acc += w
        if acc >= total / 2:
            return m
    return max(m for m, _ in pts)


def running_threshold(asset: dict | None, hour_rows: list[dict], params) -> float:
    """Power above which a device counts as running: a fraction of its typical peak while it runs (typical_peak),
    capped by its baseline helper when it has one; the floor when there is neither. Nothing hardcoded per pump.

    ⚠️ ONE "RUNNING" (architecture review 13, 2026-10-09): the night check, the energy figures and the filtration
    optimiser each had a copy, and only the night check's had the cap and the floor — the same pump had two run-hour
    numbers when its baseline helper was set. The weekly page joined them on 2026-10-19 (its own 15 W rule read a
    pump's few minutes of bursts in an hour as the whole hour)."""
    frac = params.behaviour("on_threshold_fraction")
    peak = typical_peak(hour_rows)
    data_thr = (peak or 0) * frac
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


def running_series(days: dict[date, dict]) -> list[tuple[date, float | None, float]]:
    """A device's days as one series: (day, power while running, run hours); the power is None on a day it did not
    run.

    The power is its steady running power (running_power) when every day it ran has one; a device that runs in
    bursts has no steady hour, and then every day says what it drew while running (draw_w) — one measure for the
    whole series, so a pump that ran one steady hour some day does not step from one measure to the other."""
    ran = [f for _, f in days.items() if (f.get("run_hours") or 0) > 0]
    key = "running_power" if ran and all(f.get("running_power") for f in ran) else "draw_w"
    return [(d, f.get(key) if (f.get("run_hours") or 0) > 0 else None, f.get("run_hours") or 0.0)
            for d, f in sorted(days.items())]


def energy_daily_features(day_rows: list[dict], zone: str) -> dict[date, dict]:
    out = {}
    for r in day_rows:
        d = local_day(r["start"], zone)
        ch = r.get("change")
        out[d] = {"kwh": round(ch, 3) if ch is not None else None,
                  "counter_reset": bool(ch is not None and ch < 0)}
    return out
