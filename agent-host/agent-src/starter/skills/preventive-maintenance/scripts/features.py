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
from vesta_shared.timeutil import local_day
# a day of a power or energy meter: shared with roi-energy, so they live in vesta_shared (roi-energy imported this
# file by path, and broke on any villa without the preventive-maintenance skill)
from vesta_shared.daily import energy_daily_features, power_daily_features  # noqa: F401


def level_daily_features(hour_rows: list[dict], zone: str) -> dict[date, dict]:
    by_day: dict[date, list[dict]] = defaultdict(list)
    for r in hour_rows:
        by_day[local_day(r["start"], zone)].append(r)
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


def flips_per_day(logbook: list[dict], zone: str, mass: int = 0) -> dict[str, dict[date, int]]:
    """Count unavailable <-> available transitions per entity per day from logbook rows.

    ⚠️ A MINUTE IN WHICH `mass` OR MORE ENTITIES DROP TOGETHER IS NOT THEIR FAULT (villa, 2026-10-04):
    every Home Assistant restart takes every entity through "unavailable", so three restarts in three
    days read as "dropped and reconnected 10 times: a Wi-Fi or power problem on its side" for a relay
    that never moved. A drop shared by that many entities in one minute is the restart's (or the
    integration's), and is not counted against any of them. mass=0 counts everything."""
    drops = [r for r in logbook if str(r.get("state", "")) in ("unavailable", "unknown") or r.get("from_unavailable")]
    crowd: dict[str, set] = defaultdict(set)
    for r in drops:
        crowd[str(r["when"])[:16]].add(r["entity_id"])
    out: dict[str, dict[date, int]] = defaultdict(lambda: defaultdict(int))
    for r in drops:
        if mass and len(crowd[str(r["when"])[:16]]) >= mass:
            continue
        d = datetime.fromisoformat(r["when"]).astimezone(ZoneInfo(zone)).date()
        out[r["entity_id"]][d] += 1
    return {k: dict(v) for k, v in out.items()}


def reporting_share(hour_rows: list[dict], until_ms: int | None = None, hours: int | None = None) -> tuple[float | None, int]:
    """How regularly a sensor reports, from its hourly statistics: the share of hours in which its value
    moved (max above min, or a mean unlike the hour before), over the `hours` before `until_ms` (all
    rows before it when None). Returns (share, hours); share is None with no rows.

    ⚠️ THE HOURS JUST BEFORE IT WENT QUIET, NOT A LONG WINDOW (villa, 2026-10-04): the one sensor that
    really stopped had stopped once before (6 days frozen, then 6 reporting); over 14 days it "moved" in
    45 % of hours and read as a change-only sensor — the real fault would have gone unreported.

    ⚠️ ONLY A SENSOR THAT REPORTS ALL THE TIME CAN BE "SILENT" (villa, 2026-10-04): a curtain reports when
    it moves, a rain gauge when rain falls; quiet for days is their normal, and 18 of 21 "has not reported"
    tasks were such sensors. A temperature that moved in most hours and then stops is the real case."""
    lo = until_ms - hours * 3600_000 if (until_ms is not None and hours) else None
    rows = sorted((r for r in hour_rows if (until_ms is None or r["start"] < until_ms) and (lo is None or r["start"] >= lo)),
                  key=lambda r: r["start"])
    if not rows:
        return None, 0
    moved, prev = 0, None
    for r in rows:
        mn, mx, mean = r.get("min"), r.get("max"), r.get("mean")
        if (mn is not None and mx is not None and mx > mn) or (prev is not None and mean is not None and mean != prev):
            moved += 1
        prev = mean if mean is not None else prev
    return moved / len(rows), len(rows)


def device_key(row: dict, fallback: str) -> str:
    """Which physical device a knowledge-pack row belongs to: its device_id when the registry gives one,
    else its integration + asset, else `fallback` (an entity the pack does not know).

    ⚠️ ONE KEY FOR EVERY RULE (architecture review, 0.12.27): "offline" and "silent" keyed on
    device_id or platform:asset while "keeps dropping" keyed on device_id or asset slug — one device without
    a registry id was one finding to the first two and another to the third."""
    if row.get("device_id"):
        return str(row["device_id"])
    if row.get("asset"):
        return f"{row.get('platform') or 'x'}:{row['asset']}"
    return fallback


def device_name(names: list[str]) -> str:
    """A device found through several of its entities, as one name: the first, and how many more."""
    return names[0] + (f" (+{len(names) - 1} entities of the same device)" if len(names) > 1 else "")


def worsened(change_pct: float | None, last_reported_pct: float | None, step: float) -> bool:
    """A still-open finding earns a digest line again when it moved `step` points further from normal
    than when it was last reported."""
    return change_pct is not None and abs(change_pct) - abs(last_reported_pct or 0) >= step


def to_close(open_rows: list[dict], fired: set[tuple[str, str]], state_rules: set[str] | frozenset[str]) -> list[dict]:
    """The open findings that close tonight: a STATE rule (a condition that holds or not) that did not fire
    for its entity. An event rule closes the night it fires, never here."""
    return [o for o in open_rows if o["rule_id"] in state_rules and (o["rule_id"], o["entity_id"]) not in fired]
