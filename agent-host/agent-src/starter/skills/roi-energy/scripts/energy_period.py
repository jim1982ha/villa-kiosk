#!/usr/bin/env python3
"""Energy and cost for a period, per metered load, with comparisons.

  python energy_period.py --pack pack.json --period week|month|custom [--end 2026-09-27] [--start ...] [--fixture-dir DIR] [--store S] [--out r.json]

Reads daily long-term statistics (change) for every entity of the energy
family, once. Computes in code:
  total (the main meter), per load kWh and share, unmetered remainder,
  cost at the villa tariff, comparison with the previous period of equal
  length and with the 30-day baseline, top movers, pump run hours.
The result is cached in the store by (period, start, end): a second request
for the same period costs nothing.

Which entity is the main meter: the energy asset whose slug contains "main"
or which is the largest, unless input_text.villa_main_meter names it. Phase
sub-meters (slug containing "phase") are part of the main meter, not loads.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, time, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))

from vesta_shared import script  # noqa: E402  (client, pack, store, settings, zone: one set-up)
from vesta_shared.params import MissingParameter  # noqa: E402
from vesta_shared.stats import med, pct_change  # noqa: E402
from vesta_shared.messaging import fmt_money  # noqa: E402
from vesta_shared.timeutil import villa_day  # noqa: E402
import vesta_shared.daily as F  # noqa: E402  (a day of a meter: shared, not another skill's file)


def period_bounds(period: str, end: date, start: date | None) -> tuple[date, date]:
    if period == "week":
        # the last full Monday to Sunday week ending on or before `end`
        last_sunday = end - timedelta(days=(end.weekday() + 1) % 7)
        return last_sunday - timedelta(days=6), last_sunday
    if period == "month":
        first_this = end.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        return last_prev.replace(day=1), last_prev
    if period == "custom" and start:
        return start, end
    raise ValueError("period must be week, month or custom with --start")


def sum_days(series: dict[date, dict], a: date, b: date) -> tuple[float, int]:
    vals = [series[d]["kwh"] for d in series if a <= d <= b and series[d].get("kwh") is not None and not series[d].get("counter_reset")]
    return round(sum(vals), 2), len(vals)


def run(args) -> dict:
    ctx = script.Context.of(args, skill=os.path.dirname(HERE))   # it ignored the --zone it was given: one rule now
    args = ctx.args
    cli, pack, params, Z = ctx.client, ctx.pack, ctx.params, ctx.Z
    end = villa_day(Z, args.end, last_finished=True)
    start_arg = date.fromisoformat(args.start) if args.start else None
    a, b = period_bounds(args.period, end, start_arg)
    n_days = (b - a).days + 1
    prev_a, prev_b = a - timedelta(days=n_days), a - timedelta(days=1)
    key = f"energy:{args.period}:{a}:{b}"
    store = ctx.store
    if store and not args.no_cache:
        cached = store.cache_get(key)
        if cached:
            cached["from_cache"] = True
            return cached

    energy_rows = pack.entities("energy") + pack.entities("generation")
    main_name = params.text_or("villa_main_meter", "")
    # one energy counter per asset: a Shelly plug exposes "energy" and "energy_consumed" for the same kWh.
    # ⚠️ THE NAMED MAIN METER IS THE ONE KEPT for its asset (architecture review 5): the shortest id was, and the
    # total then read a meter that had not been fetched — a KeyError instead of a report
    seen_asset: dict[str, str] = {}
    deduped = []
    for r in sorted(energy_rows, key=lambda r: (r["entity_id"] != main_name, len(r["entity_id"]))):
        if "returned" in r["entity_id"]:
            continue
        if r["asset"] in seen_asset:
            continue
        seen_asset[r["asset"]] = r["entity_id"]
        deduped.append(r)
    energy_rows = deduped
    ids = [r["entity_id"] for r in energy_rows]
    win_start = datetime.combine(min(prev_a, a - timedelta(days=30)), time(0, 0), tzinfo=Z)
    win_end = datetime.combine(b + timedelta(days=1), time(0, 0), tzinfo=Z)
    stats = cli.statistics(ids, win_start, win_end, "day", ("change", "sum")) if ids else {}
    series = {eid: F.energy_daily_features(stats.get(eid, []), pack.time_zone) for eid in ids}

    main_eid = main_name or next((r["entity_id"] for r in energy_rows if "main" in r["asset"] and "phase" not in r["asset"]), None)
    try:
        tariff, currency = params.tariff()
    except MissingParameter:
        tariff, currency = None, None

    loads = []
    for r in energy_rows:
        eid = r["entity_id"]
        if eid == main_eid or "phase" in r["asset"] or "returned" in eid:
            continue
        cur, days = sum_days(series[eid], a, b)
        prev, _ = sum_days(series[eid], prev_a, prev_b)
        base_vals = [series[eid][d]["kwh"] for d in series[eid] if a - timedelta(days=30) <= d < a and series[eid][d].get("kwh") is not None]
        base_daily = med(base_vals)
        loads.append({"entity_id": eid, "asset": r["asset"], "name": pack.assets.get(r["asset"], {}).get("name", r["name"]),
                      "area": r["area"], "family": r["family"], "kwh": cur, "days_with_data": days, "prev_kwh": prev,
                      "vs_prev_pct": pct_change(cur, prev) if prev else None,
                      "baseline_kwh": round(base_daily * n_days, 2) if base_daily is not None else None,
                      "vs_baseline_pct": pct_change(cur, base_daily * n_days) if base_daily else None,
                      "cost": round(cur * tariff) if tariff else None,
                      "first_seen": store.first_seen(eid) if store else None})
    known_main = main_eid if main_eid in series else None
    total, total_days = (sum_days(series[known_main], a, b) if known_main else (None, 0))
    total_prev = sum_days(series[known_main], prev_a, prev_b)[0] if known_main else None
    metered = round(sum(l["kwh"] for l in loads if l["family"] == "energy"), 2)
    unmetered = round(total - metered, 2) if total is not None else None
    for l in loads:
        l["share_pct"] = round(l["kwh"] / total * 100, 1) if total else None
    loads.sort(key=lambda l: -l["kwh"])
    movers = sorted([l for l in loads if l["vs_prev_pct"] is not None and abs(l["kwh"] - l["prev_kwh"]) >= 1],
                    key=lambda l: -abs(l["kwh"] - l["prev_kwh"]))[:5]
    generation = [l for l in loads if l["family"] == "generation"]

    # pumps: run hours from hourly power stats
    pumps = []
    p_ids = [r["entity_id"] for r in pack.entities("power") if pack.assets.get(r["asset"], {}).get("kind", "appliance") == "motor"]
    hstats = cli.statistics(p_ids, datetime.combine(a, time(0, 0), tzinfo=Z), win_end, "hour", ("mean", "min", "max")) if p_ids else {}
    for r in pack.entities("power"):
        rows = hstats.get(r["entity_id"], [])
        if not rows or pack.assets.get(r["asset"], {}).get("kind", "appliance") != "motor":
            continue
        thr = (med([x["max"] for x in rows if x.get("max")]) or 0) * params.behaviour("on_threshold_fraction")
        feats = F.power_daily_features(rows, pack.time_zone, thr)
        hrs = [feats[d]["run_hours"] for d in feats if a <= d <= b]
        rp = [feats[d]["running_power"] for d in feats if a <= d <= b and feats[d].get("running_power")]
        if hrs:
            pumps.append({"asset": r["asset"], "name": pack.assets.get(r["asset"], {}).get("name", r["name"]),
                          "run_hours_total": round(sum(hrs), 1), "run_hours_per_day": round(sum(hrs) / len(hrs), 2),
                          "running_power_w": round(med(rp), 0) if rp else None})

    result = {"period": args.period, "start": a.isoformat(), "end": b.isoformat(), "days": n_days,
              "villa": pack.villa, "tariff": tariff, "currency": currency,
              "total_kwh": total, "total_prev_kwh": total_prev, "total_vs_prev_pct": pct_change(total, total_prev) if total_prev else None,
              "total_cost": round(total * tariff) if (total is not None and tariff) else None,
              "days_with_data": total_days, "metered_kwh": metered, "unmetered_kwh": unmetered,
              "unmetered_pct": round(unmetered / total * 100, 1) if total else None,
              "loads": loads, "movers": movers, "generation": generation, "pumps": pumps,
              "main_meter": main_eid, "from_cache": False}
    if not main_eid:
        result["note"] = "No main meter found: set input_text.villa_main_meter to the total energy entity."
    elif main_eid not in series:
        result["note"] = (f"input_text.villa_main_meter names {main_eid}, which is not one of the villa's energy "
                          "meters in the knowledge pack: the total is not known.")
    result["headline"] = headline(result)
    if store:
        store.cache_put(key, result)
    return result


def headline(r: dict) -> str:
    if r["total_kwh"] is None:
        return "No main meter: totals unavailable."
    s = f"{r['villa']}: {r['total_kwh']:.0f} kWh from {r['start']} to {r['end']}"
    if r["total_cost"] is not None:
        s += f", {fmt_money(r['total_cost'], r['currency'])}"
    if r["total_vs_prev_pct"] is not None:
        s += f" ({r['total_vs_prev_pct']:+.0f}% vs previous {r['period']})"
    top = [l for l in r["loads"] if l["family"] == "energy"][:3]
    if top:
        s += ". Largest: " + ", ".join(f"{l['name']} {l['share_pct']:.0f}%" for l in top)
    if r["unmetered_pct"] is not None:
        s += f". Not metered: {r['unmetered_pct']:.0f}%."
    return s


def main(argv=None):
    ap = argparse.ArgumentParser()
    script.arguments(ap, pack=True, pack_required=True, store="optional")
    ap.add_argument("--period", default="week", choices=["week", "month", "custom"])
    ap.add_argument("--start"); ap.add_argument("--end")
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    res = run(a)
    if a.out:
        json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(res["headline"])
    for l in res["loads"][:8]:
        print(f"  {l['name']:40} {l['kwh']:8.1f} kWh  share {l['share_pct'] or 0:5.1f}%  vs prev {l['vs_prev_pct'] if l['vs_prev_pct'] is None else round(l['vs_prev_pct'])}")
    for p in res["pumps"]:
        print(f"  pump {p['name']:35} {p['run_hours_per_day']:.1f} h/day at {p['running_power_w']} W")
    return 0


if __name__ == "__main__":
    sys.exit(main())
