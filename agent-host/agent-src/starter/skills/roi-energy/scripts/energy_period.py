#!/usr/bin/env python3
"""Energy and cost for a period, per metered load, with comparisons.

  python energy_period.py --pack pack.json --period week|month|custom [--end 2026-09-27] [--start ...] [--fixture-dir DIR] [--store S] [--out r.json]

Reads daily long-term statistics (change) once, for every statistic it needs. Computes in code:
  total, per device kWh and share, what the devices leave untracked, cost at the villa tariff,
  comparison with the previous period of equal length and with the 30-day baseline, top movers, pump run hours.
The result is cached in the store by (period, start, end): a second request
for the same period costs nothing.

Where the total and the devices come from (architecture review round 2, 2026-10-16): the villa's own Energy
settings, read once (vesta_shared.energy_setup — the Kiosk's Energy window rule): total = grid in + solar − grid
out; the devices and which one sits inside which; "untracked" = total − the TOP-LEVEL devices, so a light inside a
phase meter is counted once. Only when those settings give no grid or solar source (or cannot be read) does it fall
back to the old guess: the energy asset whose slug contains "main" (not "phase"), unless input_text.villa_main_meter
names it; phase sub-meters and "returned" counters are then not loads.
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
from vesta_shared.page import number  # noqa: E402  (the one number rule of every page and headline)
from vesta_shared.timeutil import day_label  # noqa: E402  (the one day format)
from vesta_shared.timeutil import villa_day  # noqa: E402
import vesta_shared.daily as F  # noqa: E402  (a day of a meter: shared, not another skill's file)
import vesta_shared.energy_setup as E  # noqa: E402  (the Energy settings' rule, the Kiosk's)


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
    # v2: the total and the devices follow the villa's Energy settings — a period cached by the name guess is not reused
    key = f"energy:v2:{args.period}:{a}:{b}:{calc_tag(pack)}"
    store = ctx.store
    if store and not args.no_cache:
        cached = store.cache_get(key)
        if cached:
            cached["from_cache"] = True
            return cached

    win_start = datetime.combine(min(prev_a, a - timedelta(days=30)), time(0, 0), tzinfo=Z)
    win_end = datetime.combine(b + timedelta(days=1), time(0, 0), tzinfo=Z)

    def read(ids: list[str]) -> dict:
        stats = cli.statistics(ids, win_start, win_end, "day", ("change", "sum")) if ids else {}
        return {eid: F.energy_daily_features(stats.get(eid, []), pack.time_zone) for eid in ids}

    try:
        tariff, currency = params.tariff()
    except MissingParameter:
        tariff, currency = None, None

    def load(eid: str, name: str, area, family: str, series: dict) -> dict:
        cur, days = sum_days(series[eid], a, b)
        prev, _ = sum_days(series[eid], prev_a, prev_b)
        base_vals = [series[eid][d]["kwh"] for d in series[eid] if a - timedelta(days=30) <= d < a and series[eid][d].get("kwh") is not None]
        base_daily = med(base_vals)
        return {"entity_id": eid, "asset": (pack.row(eid) or {}).get("asset"), "name": name,
                "area": area, "family": family, "kwh": cur, "days_with_data": days, "prev_kwh": prev,
                "vs_prev_pct": pct_change(cur, prev) if prev else None,
                "baseline_kwh": round(base_daily * n_days, 2) if base_daily is not None else None,
                "vs_baseline_pct": pct_change(cur, base_daily * n_days) if base_daily else None,
                "cost": round(cur * tariff) if tariff else None,
                "first_seen": store.first_seen(eid) if store else None}

    prefs, unread = E.read(cli)
    if E.usable(prefs):
        part = from_settings(prefs, pack, read, load, a, b, prev_a, prev_b)
    else:
        part = from_names(pack, params, read, load, a, b, prev_a, prev_b)
        if unread:
            part["unread"] = unread
            part["total_basis"] = "The villa's Energy settings could not be read: " + part["total_basis"]
    total, total_prev, loads = part["total"], part["total_prev"], part["loads"]
    for l in loads:
        l["share_pct"] = round(l["kwh"] / total * 100, 1) if total else None
    loads.sort(key=lambda l: -l["kwh"])
    movers = sorted([l for l in loads if l["vs_prev_pct"] is not None and abs(l["kwh"] - l["prev_kwh"]) >= 1],
                    key=lambda l: -abs(l["kwh"] - l["prev_kwh"]))[:5]
    unmetered = part["unmetered"]

    # pumps: run hours from hourly power stats
    pumps = []
    p_ids = [r["entity_id"] for r in pack.entities("power") if pack.assets.get(r["asset"], {}).get("kind", "appliance") == "motor"]
    hstats = cli.statistics(p_ids, datetime.combine(a, time(0, 0), tzinfo=Z), win_end, "hour", ("mean", "min", "max")) if p_ids else {}
    for r in pack.entities("power"):
        rows = hstats.get(r["entity_id"], [])
        if not rows or pack.assets.get(r["asset"], {}).get("kind", "appliance") != "motor":
            continue
        _, feats = F.power_days(pack.assets.get(r["asset"]), rows, pack.time_zone, params)   # the one "running"
        hrs = [feats[d]["run_hours"] for d in feats if a <= d <= b]
        rp = [feats[d]["running_power"] for d in feats if a <= d <= b and feats[d].get("running_power")]
        if hrs:
            pumps.append({"asset": r["asset"], "name": pack.reading_name(r["entity_id"], r["name"] or r["entity_id"]),
                          "run_hours_total": round(sum(hrs), 1), "run_hours_per_day": round(sum(hrs) / len(hrs), 2),
                          "running_power_w": round(med(rp), 0) if rp else None})

    result = {"period": args.period, "start": a.isoformat(), "end": b.isoformat(), "days": n_days,
              "villa": pack.villa, "tariff": tariff, "currency": currency,
              "total_kwh": total, "total_prev_kwh": total_prev, "total_vs_prev_pct": pct_change(total, total_prev) if total_prev else None,
              "total_cost": round(total * tariff) if (total is not None and tariff) else None,
              "days_with_data": part["total_days"], "metered_kwh": part["metered"], "unmetered_kwh": unmetered,
              "unmetered_pct": round(unmetered / total * 100, 1) if (total and unmetered is not None) else None,
              "overlap_kwh": part.get("overlap"),
              "loads": loads, "movers": movers, "generation": part["generation"], "pumps": pumps,
              "basis": part["basis"], "total_basis": part["total_basis"],
              # the statistics the total is made of, for a reader of the days (reports' facts.py): one rule
              "total_from": part["total_from"], "main_meter": part.get("main_meter"), "from_cache": False}
    if part.get("unread"):
        result["unread"] = part["unread"]
    if part.get("note"):
        result["note"] = part["note"]
    result["headline"] = headline(result)
    if store:
        store.cache_put(key, result)
    return result


def calc_tag(pack) -> str:
    """What a period's figures were worked out with: the code that computes them (this script and the shared day and
    Energy-settings rules) and the knowledge pack that names them. A finished period is kept under it.

    ⚠️ A FINISHED WEEK WAS KEPT FOR EVER (villa, 2026-10-19): its figures were stored under the period alone, so an
    update that named each pump by its own device left week 42's energy table "Main Power Device" three times — the
    report made after the update read the figures made before it."""
    import hashlib
    h = hashlib.sha1()
    for f in (__file__, F.__file__, E.__file__):
        with open(f, "rb") as fh:
            h.update(fh.read())
    h.update(str(getattr(pack, "generated_at", "") or "").encode())
    return h.hexdigest()[:12]


def from_settings(prefs, pack, read, load, a, b, prev_a, prev_b) -> dict:
    """The total, the devices and what they leave, as the villa's Energy settings lay them out (the Kiosk's rule)."""
    s = E.setup(prefs, lambda sid: pack.reading_name(sid, pack.name_of(sid) or sid))
    series = read(list(dict.fromkeys(s.sources + [n.id for n in s.devices])))

    def kwh(lo, hi):
        def of(sid):
            v, days = sum_days(series.get(sid, {}), lo, hi)
            return v if days else None
        return of
    cur, prev = E.split(s, kwh(a, b)), E.split(s, kwh(prev_a, prev_b))
    read_days = lambda lo, hi: {d for sid in s.grid_in + s.solar for d, f in series[sid].items()  # noqa: E731
                                if lo <= d <= hi and f.get("kwh") is not None and not f.get("counter_reset")}
    days, prev_days = read_days(a, b), read_days(prev_a, prev_b)
    parent = s.parent_of()
    loads = []
    for u in E.ranking(cur):
        row = pack.row(u.node.id) or {}
        l = load(u.node.id, u.node.name, row.get("area"), "energy", series)
        up = parent.get(u.node.id)
        l["inside"] = up.name if up else None          # its upstream device in the settings: already in that one's kWh
        l["top_level"] = up is None
        if u.children:
            l["untracked_kwh"] = round(u.untracked, 2)  # what its own devices leave of it
        loads.append(l)
    generation = [load(sid, pack.reading_name(sid, pack.name_of(sid) or sid), (pack.row(sid) or {}).get("area"),
                       "generation", series) for sid in s.solar]
    return {"basis": "settings", "total_basis": "The villa's Energy settings: what came from the grid"
            + (" and the solar" if s.solar else "") + (", less what went back" if s.grid_out else "") + ".",
            "total": round(cur.used, 2) if days else None, "total_prev": round(prev.used, 2) if prev_days else None,
            "total_days": len(days), "loads": loads, "generation": generation,
            "metered": round(sum(r.kwh for r in cur.roots), 2), "unmetered": round(cur.untracked, 2) if days else None,
            "overlap": round(cur.overlap, 2),
            "total_from": {"grid_in": s.grid_in, "grid_out": s.grid_out, "solar": s.solar}}


def from_names(pack, params, read, load, a, b, prev_a, prev_b) -> dict:
    """The fallback when the Energy settings give no total: the meter recognised as the main one, by its name or the
    villa's main-meter setting; every other meter but its phases and "returned" counters is a load."""
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
    series = read([r["entity_id"] for r in energy_rows])
    main_eid = main_name or next((r["entity_id"] for r in energy_rows if "main" in r["asset"] and "phase" not in r["asset"]), None)
    loads = []
    for r in energy_rows:
        eid = r["entity_id"]
        if eid == main_eid or "phase" in r["asset"] or "returned" in eid:
            continue
        loads.append(load(eid, pack.reading_name(eid, r["name"] or eid), r["area"], r["family"], series))
    known_main = main_eid if main_eid in series else None
    total, total_days = (sum_days(series[known_main], a, b) if known_main else (None, 0))
    total_prev = sum_days(series[known_main], prev_a, prev_b)[0] if known_main else None
    metered = round(sum(l["kwh"] for l in loads if l["family"] == "energy"), 2)
    out = {"basis": "names", "total": total, "total_prev": total_prev, "total_days": total_days,
           "loads": [l for l in loads if l["family"] == "energy"],
           "generation": [l for l in loads if l["family"] == "generation"],
           "metered": metered, "unmetered": round(total - metered, 2) if total is not None else None,
           "total_from": {"grid_in": [known_main], "grid_out": [], "solar": []} if known_main else None,
           "main_meter": main_eid,
           "total_basis": "The villa's Energy settings name no grid meter: the total is the meter recognised as the main one."}
    # ⚠️ PLAIN WORDS, NO SETTING'S ID (owner rules): this note reaches a person through the AI
    if not main_eid:
        out["note"] = ("No total: the villa's Energy settings name no grid meter, and no meter is recognisably the main "
                       "one. Adding the grid meter to the villa system's Energy settings gives the total.")
    elif not known_main:
        out["note"] = ("The main meter chosen in the villa's settings is not one of its energy meters: the total is not "
                       "known. Adding the grid meter to the villa system's Energy settings gives the total.")
    return out


def headline(r: dict) -> str:
    if r["total_kwh"] is None:
        return "Total not known: the villa's Energy settings name no grid meter."
    # whole figures and the one day format (timeutil.day_label: "5 Oct", never 2026-10-05), as every page says them
    a, b = (day_label(date.fromisoformat(str(r[k])[:10])) for k in ("start", "end"))
    s = f"{r['villa']}: {number(r['total_kwh'], 'kWh', whole=True)} from {a} to {b}"
    if r["total_cost"] is not None:
        s += f", {fmt_money(r['total_cost'], r['currency'])}"
    if r["total_vs_prev_pct"] is not None:
        s += f" ({r['total_vs_prev_pct']:+.0f}% vs previous {r['period']})"
    top = [l for l in r["loads"] if l["family"] == "energy"][:3]
    if top:
        s += ". Largest: " + ", ".join(f"{l['name']} {number(l['share_pct'], '%', whole=True)}" for l in top)
    if r["unmetered_pct"] is not None:
        s += f". Not metered: {number(r['unmetered_pct'], '%', whole=True)}"
    if r.get("overlap_kwh"):
        s += (f". {number(r['overlap_kwh'], 'kWh', whole=True)} is counted twice: some devices are set up beside the "
              "meter they are part of, not inside it")
    return s + "."


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
