"""Feature extraction per family. Pure functions: statistics rows in, numbers out.

Every function takes the rows Home Assistant returned (hourly or daily
long-term statistics, or raw history) and returns per-day features. No
thresholds live here; thresholds are applied in rules.py from the villa
parameters.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from zoneinfo import ZoneInfo

from vesta_shared.device_state import RestartDrops, is_offline  # the one "does this device answer"
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


def ended_runs(runs: list[dict], states: list[dict], on_threshold_w: float, zone: str) -> list[dict]:
    """`runs` (runs_from_history's) without the one still going at the last reading: a reading that stopped short
    does not know its end, its length or its sag."""
    last = None
    for s in states:
        try:
            v = float(s["state"])
        except (ValueError, TypeError, KeyError):
            continue
        t = datetime.fromisoformat(s["last_changed"]).astimezone(ZoneInfo(zone))
        if last is None or t >= last[0]:
            last = (t, v)
    if last is None or last[1] <= on_threshold_w:
        return runs
    going = last[0].isoformat(timespec="minutes")
    return [r for r in runs if r["end"] != going]


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


def flips_per_day(logbook: list[dict], zone: str, settle_minutes: float = 0,
                  min_drop_seconds: float = 0) -> dict[str, dict[date, int]]:
    """Count drops to "unavailable" per entity per day from logbook rows, leaving out those within `settle_minutes` of
    a Home Assistant restart (device_state.in_restart: its own "started" entry) — every restart takes every entity
    through "unavailable", and three restarts in three days read as "dropped and reconnected 10 times" for a relay that
    never moved (villa, 2026-10-04).

    ⚠️ A DROP IS "unavailable", NEVER "unknown" (architecture review, 2026-10-13): "unknown" is a sensor that answers
    with no value (device_state) — counted, a wind chill on a still day read as a Wi-Fi problem. A device Home Assistant
    loses goes "unavailable"; its other entities going "unknown" with it add nothing (the device counts its busiest
    entity's day, nightly).

    ⚠️ A DROP OF A FEW MILLISECONDS IS A RELOAD, NOT A RECONNECT (villa, 2026-10-20: 19 faults "dropped and reconnected
    10 times in 3 days" in one night — every ceiling fan, a template lock, template sensors). Each time the villa's system
    reloads its virtual devices (a template, a helper or a package saved), every one of them reads "unavailable" for
    about 50 ms; nine such reloads in two days read as Wi-Fi trouble. A drop back within `min_drop_seconds` (the
    night's setting reconnect_min_drop_seconds) is not counted; one still offline at the end of the read is."""
    drops = RestartDrops(logbook, settle_minutes)        # the one answer (vesta_shared.device_state)
    out: dict[str, dict[date, int]] = defaultdict(lambda: defaultdict(int))
    timeline: dict[str, list[tuple[datetime, bool]]] = defaultdict(list)
    for r in logbook:
        if r.get("entity_id") and r.get("when"):
            try:
                timeline[r["entity_id"]].append((datetime.fromisoformat(r["when"]), is_offline(r.get("state"))))
            except ValueError:
                continue
    for eid, rows in timeline.items():
        rows.sort(key=lambda x: x[0])
        for i, (t, off) in enumerate(rows):
            if not off:
                continue
            if drops.at_restart(eid, t):                  # came with a restart: never the device's own reconnect
                continue
            back = next((u for u, o in rows[i + 1:] if not o), None)
            if back is not None and (back - t).total_seconds() < min_drop_seconds:
                continue                                  # back within the blink of a reload
            out[eid][t.astimezone(ZoneInfo(zone)).date()] += 1
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


# the one device key (vesta_shared.knowledge_pack): KnowledgePack.device_key is what the checks call
from vesta_shared.knowledge_pack import device_key  # noqa: E402,F401


def device_name(names: list[str]) -> str:
    """A device found through several of its entities, as one name: the first, and how many more."""
    return names[0] + (f" (+{len(names) - 1} entities of the same device)" if len(names) > 1 else "")


# an integration down (several devices of one integration offline together) is merged by the one reading of
# "offline now", vesta_shared.offline.merged_integrations (architecture review round 3, 2026-10-19; it was here)


# a finding's life — worsened, closing tonight — belongs to vesta_shared.problems (review 7); named here as before
from vesta_shared.problems import closes_tonight as to_close, worsened  # noqa: E402,F401
