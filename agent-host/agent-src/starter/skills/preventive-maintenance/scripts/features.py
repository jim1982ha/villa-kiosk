"""Feature extraction per family. Pure functions: statistics rows in, numbers out.

Every function takes the rows Home Assistant returned (hourly or daily
long-term statistics, or raw history) and returns per-day features. No
thresholds live here; thresholds are applied in rules.py from the villa
parameters.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from vesta_shared.stats import med, slope_per_hour


def _day(ms: int, zone: str) -> date:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(ZoneInfo(zone)).date()


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
        by_day[_day(r["start"], zone)].append(r)
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
        d = _day(r["start"], zone)
        ch = r.get("change")
        out[d] = {"kwh": round(ch, 3) if ch is not None else None,
                  "counter_reset": bool(ch is not None and ch < 0)}
    return out


def level_daily_features(hour_rows: list[dict], zone: str) -> dict[date, dict]:
    by_day: dict[date, list[dict]] = defaultdict(list)
    for r in hour_rows:
        by_day[_day(r["start"], zone)].append(r)
    out = {}
    for day, rows in by_day.items():
        means = [r["mean"] for r in rows if r.get("mean") is not None]
        out[day] = {"mean": round(med(means), 2) if means else None,
                    "max": round(max((r.get("max") or -1e9) for r in rows), 2) if rows else None,
                    "min": round(min((r.get("min") or 1e9) for r in rows), 2) if rows else None,
                    "hours_with_data": len(rows)}
    return out


def runs_from_history(states: list[dict], on_threshold_w: float, zone: str, min_run_minutes: int = 30) -> list[dict]:
    """Split a raw power history into runs. Each run: start, end, minutes, first/last quarter medians, slope W/h, sag_pct."""
    pts = []
    for s in states:
        try:
            v = float(s["state"])
        except (ValueError, TypeError):
            continue
        t = datetime.fromisoformat(s["last_changed"]).astimezone(ZoneInfo(zone))
        pts.append((t, v))
    pts.sort()
    runs, cur = [], []
    for t, v in pts:
        if v > on_threshold_w:
            cur.append((t, v))
        else:
            if cur:
                runs.append(cur); cur = []
    if cur:
        runs.append(cur)
    out = []
    for run in runs:
        t0, t1 = run[0][0], run[-1][0]
        minutes = (t1 - t0).total_seconds() / 60
        if minutes < min_run_minutes:
            continue
        q = max(1, len(run) // 4)
        first = med([v for _, v in run[:q]])
        last = med([v for _, v in run[-q:]])
        slope = slope_per_hour([((t - t0).total_seconds() / 3600, v) for t, v in run])
        out.append({
            "start": t0.isoformat(timespec="minutes"), "end": t1.isoformat(timespec="minutes"),
            "minutes": round(minutes), "points": len(run),
            "first_quarter_w": round(first, 1), "last_quarter_w": round(last, 1),
            "slope_w_per_h": round(slope, 2) if slope is not None else None,
            "sag_pct": round((first - last) / first * 100, 1) if first else None,
            "mean_w": round(sum(v for _, v in run) / len(run), 1),
        })
    return out


def flips_per_day(logbook: list[dict], zone: str) -> dict[str, dict[date, int]]:
    """Count unavailable <-> available transitions per entity per day from logbook rows."""
    out: dict[str, dict[date, int]] = defaultdict(lambda: defaultdict(int))
    for r in logbook:
        st = str(r.get("state", ""))
        if st in ("unavailable", "unknown") or r.get("from_unavailable"):
            d = datetime.fromisoformat(r["when"]).astimezone(ZoneInfo(zone)).date()
            out[r["entity_id"]][d] += 1
    return {k: dict(v) for k, v in out.items()}


def days_back(end: date, n: int) -> list[date]:
    return [end - timedelta(days=i) for i in range(n)][::-1]
