"""What a day of a meter's Home Assistant statistics says: one reading for every skill.

Moved from preventive-maintenance's features.py (architecture review, 2026-10-07): roi-energy used them by
importing that skill's script folder by path — a villa without the preventive-maintenance skill would have
broken its energy reports. Pure functions: statistics rows in, numbers per local day out.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from .params import MissingParameter
from .stats import med
from .timeutil import local_day

#: The settings every skill reads as ONE villa value, by name (running_threshold's share): written in each skill that
#: asks it, shown and saved as one row on the agent page's Limits tab (review J, 0.12.341: four rows each said "the
#: villa's one definition", and a save changed one skill — a pump "ran" in the night check and not in the reports)
VILLA_WIDE = ("on_threshold_fraction",)


def power_daily_features(hour_rows: list[dict], zone: str, on_threshold_w: float) -> dict[date, dict]:
    """From hourly mean/min/max of a power sensor.

    run_hours       hours the asset was drawing power: an hour whose MAXIMUM reached the threshold counts the share
                    of it spent running, its mean over its maximum
    full_hours      whole hours with min above the threshold (steady running)
    running_power   mean of the full hours' means (the signature we trend)
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
        out[day] = {
            "run_hours": round(run_hours, 2),
            "full_hours": len(full),
            "running_power": round(sum(r["mean"] for r in full) / len(full), 1) if full else None,
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


# ⚠️ ONE METER, TWO PARTS (owner, 2026-10-29: "a wall switch that has a few gangs: one gang controls the light, the
# other one controls the fan"): one power reading measures a fan and a light together (knowledge_pack.parts_of). Judged
# by its power alone, a light left on read as the fan running, and the fan's running power held the light's. For such a
# motor, its OWN on/off decides when it runs, and its power is read only in the hours no other part was on.
#: The states of a part that is not on (a climate unit's "off" too): anything else is on.
NOT_ON = ("off", "unavailable", "unknown", "")


def shared_meter(asset: dict | None) -> tuple[list[str], list[str]] | None:
    """(its motor parts, the other parts its meter also measures) for a motor whose power reading measures something
    else too (a light on the same wall switch); None for any other device."""
    parts = (asset or {}).get("parts") or {}
    if (asset or {}).get("kind") == "motor" and parts.get("motor") and parts.get("light"):
        return list(parts["motor"]), list(parts["light"])
    return None


def measured_motor(asset: dict | None) -> bool:
    """A motor whose power reading is its own: its running power and run hours are read from that power (the reports'
    equipment cards and trends, the energy figures' pumps). A shared meter's (shared_meter) are not: the light is in it."""
    return (asset or {}).get("kind") == "motor" and shared_meter(asset) is None


def on_spans(changes: list[tuple[datetime, str]], end: datetime) -> list[tuple[datetime, datetime]]:
    """When a part was on: each (from, to) of its state changes (History.changes: the state carried in from before the
    window first), the last one open until `end`."""
    spans, since = [], None
    for t, state in sorted(changes):
        on = str(state).strip().lower() not in NOT_ON
        if on and since is None:
            since = t
        elif not on and since is not None:
            spans.append((since, t))
            since = None
    if since is not None and since < end:
        spans.append((since, end))
    return spans


def joined(*span_lists) -> list[tuple[datetime, datetime]]:
    """Several parts' spans as one: when ANY of them was on."""
    out: list[list[datetime]] = []
    for a, b in sorted(x for spans in span_lists for x in spans):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def seconds_on(spans, a: datetime, b: datetime) -> float:
    """How long within [a, b) the spans cover."""
    return sum(max(0.0, (min(b, y) - max(a, x)).total_seconds()) for x, y in spans)


def shared_day_features(hour_rows: list[dict], zone: str, motor_on, others_on) -> dict[date, dict]:
    """power_daily_features for a motor on a shared meter (shared_meter): `run_hours` and `full_hours` from its own on/off
    (`motor_on`), `running_power` the mean of the hours it ran whole while no other part was on (`others_on`), `peak_w`
    the highest maximum of the hours no other part was on. An hour another part was on still counts as data (never a
    gap: the meter was there)."""
    by_day: dict[date, list[dict]] = defaultdict(list)
    for r in hour_rows:
        by_day[local_day(r["start"], zone)].append(r)
    out = {}
    for day, rows in by_day.items():
        run_s, full, clean_full, clean_max = 0.0, 0, [], []
        for r in rows:
            h0 = datetime.fromtimestamp(r["start"] / 1000, tz=timezone.utc)
            h1 = h0 + timedelta(hours=1)
            on = seconds_on(motor_on, h0, h1)
            alone = seconds_on(others_on, h0, h1) == 0
            run_s += on
            whole = on >= 3600 - 60
            full += whole
            if alone and r.get("max") is not None:
                clean_max.append(r["max"])
            if alone and whole and r.get("mean") is not None:
                clean_full.append(r["mean"])
        out[day] = {
            "run_hours": round(run_s / 3600, 2),
            "full_hours": full,
            "running_power": round(sum(clean_full) / len(clean_full), 1) if clean_full else None,
            "peak_w": round(max(clean_max), 0) if clean_max else 0,
            "gap_hours": 24 - len(rows),
            "hours_with_data": len(rows),
        }
    return out


def parts_spans(cli, shared: tuple[list[str], list[str]], start: datetime, end: datetime, now: datetime):
    """(when the motor was on, when another part on its meter was on) over [start, end), from the parts' own state
    history; None when it could not be read whole (judged on half a history, a light on would read as the fan's power
    again). ⚠️ ONE READING FOR EVERY JUDGE (architecture review, 2026-10-30): the night check had it alone, and
    /investigate counted a light's hours as its fan's. Blocking."""
    motors, others = shared
    try:
        got = cli.history_read(motors + others, start, end, now=now)
    except Exception:  # noqa: BLE001 — the reason is the reader's; the caller says what waits
        return None
    if not all(got.whole(e) for e in motors + others):
        return None
    return (joined(*(on_spans(got.changes(e), got.end) for e in motors)),
            joined(*(on_spans(got.changes(e), got.end) for e in others)))


def alone_rows(hour_rows: list[dict], others_on) -> list[dict]:
    """The hours no other part on the meter was on (a shared meter's typical peak and threshold are the motor's own)."""
    out = []
    for r in hour_rows:
        h0 = datetime.fromtimestamp(r["start"] / 1000, tz=timezone.utc)
        if seconds_on(others_on, h0, h0 + timedelta(hours=1)) == 0:
            out.append(r)
    return out


def motor_alone(raw: list[dict], motor_on, others_on) -> list[dict]:
    """A shared meter's raw power readings as the motor's own: a reading while the motor is off or another part is on
    reads 0, and a 0 is added where either begins, so a run ends there (features.runs_from_history splits on it)."""
    def at(r):
        try:
            return datetime.fromisoformat(r["last_changed"])
        except (KeyError, TypeError, ValueError):
            return None
    out = []
    for r in raw:
        t = at(r)
        if t is None:
            continue
        mine = seconds_on(motor_on, t, t + timedelta(seconds=1)) > 0 and seconds_on(others_on, t, t + timedelta(seconds=1)) == 0
        out.append(r if mine else {**r, "state": "0"})
    for x, y in others_on:
        out.append({"state": "0", "last_changed": x.isoformat()})
    for x, y in motor_on:
        out.append({"state": "0", "last_changed": y.isoformat()})
    return sorted(out, key=lambda r: at(r) or datetime.min.replace(tzinfo=timezone.utc))


def hour_rows_of(readings: list[tuple[datetime, float | None]]) -> list[dict]:
    """Raw readings (moment, value) as the hourly rows Home Assistant's statistics give: per hour, the highest reading
    (`max`) and the mean of its readings (`mean`). A reading with no value (offline, no value) is left out."""
    by_hour: dict[datetime, list[float]] = defaultdict(list)
    for t, v in readings:
        if v is not None:
            by_hour[t.replace(minute=0, second=0, microsecond=0)].append(float(v))
    return [{"start": h.isoformat(), "max": max(vs), "mean": sum(vs) / len(vs)} for h, vs in sorted(by_hour.items())]


def power_asset(pack, entity_id: str) -> dict | None:
    """The asset whose power reading `entity_id` is (the knowledge pack's link, as the night check reads it: the
    asset's `entities.power`), or None — another reading of an asset (a current, a temperature) is not judged by its
    power's baseline."""
    row = pack.row(entity_id) if pack is not None else None
    asset = pack.asset(row["asset"]) if row and row.get("asset") else None
    return asset if asset and (asset.get("entities") or {}).get("power") == entity_id else None


def threshold_from_readings(readings: list[tuple[datetime, float | None]], params, pack, entity_id: str) -> float:
    """Power above which `entity_id` counts as running, from its raw readings: the ONE rule (running_threshold) over
    those readings bucketed per hour (hour_rows_of), with its asset's baseline cap found here (power_asset).

    ⚠️ THE ASSET IS FOUND HERE, NEVER LEFT OUT (architecture review O, 2026-10-27): this read `running_threshold(None,
    …)`, so /investigate and a chat's answer judged a pump with its own baseline setting without its cap — another run
    count than the night check's, the weekly page's and the energy figures' for the same day.

    ⚠️ ONE "RUNNING" FOR /investigate TOO (owner, 2026-10-19: "the night check owns each number asked twice"): the
    investigation counted a device running above 10 % of its top 0.1 % readings, at least 2 W — its own rule, beside
    the night check's, the energy figures' and the weekly page's. Its settings running_fraction, high_quantile and
    running_min are retired; on_threshold_fraction (a villa helper vesta_on_threshold_fraction for every skill) is the
    share for all of them."""
    return running_threshold(power_asset(pack, entity_id), hour_rows_of(readings), params)


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
    """A device's days as one series: (day, steady running power, run hours); the power is None on a day it did not
    run — and on EVERY day for a device that does not run steadily (one day without a steady hour).

    ⚠️ A BURST PUMP HAS NO RUNNING POWER IN HOURLY FIGURES (villa, 2026-10-19). A pressure pump's minutes of bursts never
    fill an hour, and what it drew per minute run, worked out from the hour's mean and peak, swung from 1,500 W to
    6,410 W with its start-up peaks — the weekly report read "watch for a leak" in that noise. Its run hours are real;
    its power is not known, and is never shown."""
    ran = [f for _, f in days.items() if (f.get("run_hours") or 0) > 0]
    steady = bool(ran) and all(f.get("running_power") for f in ran)
    return [(d, f.get("running_power") if steady and (f.get("run_hours") or 0) > 0 else None, f.get("run_hours") or 0.0)
            for d, f in sorted(days.items())]


def energy_daily_features(day_rows: list[dict], zone: str) -> dict[date, dict]:
    out = {}
    for r in day_rows:
        d = local_day(r["start"], zone)
        ch = r.get("change")
        out[d] = {"kwh": round(ch, 3) if ch is not None else None,
                  "counter_reset": bool(ch is not None and ch < 0)}
    return out
