#!/usr/bin/env python3
"""Filtration optimiser: how many hours a day the pool pump should run.

  python filtration_optimiser.py --pack pack.json [--asset pool_pump] [--fixture-dir DIR] [--as-of 2026-09-29] [--out proposal.json]

Without --asset: the villa's filtration pump, from the knowledge pack — the motor whose slug ends in "_pump" and whose
pool volume helper exists (the first by slug when several do), else the only "_pump" asset, whose missing helpers
are then named; several and none set up: each one's volume helper is named, never a guess.

hours per day = pool volume x turnovers per day / real flow

Every input is a villa parameter read from Home Assistant helpers, by
naming convention <asset>_<parameter>:

  input_number.pool_volume_m3                 required
  input_number.pool_target_turnovers_per_day  required
  input_number.pool_pump_rated_flow_m3h       required unless a flow sensor or a curve exists
  input_number.pool_pump_rated_power_w        required unless a flow sensor or a curve exists
  input_text.pool_pump_curve                  optional, JSON [[power_w, flow_m3h], ...]
  input_text.pool_pump_model                  optional, for the message
  input_number.pool_pump_blocks_per_day       optional, default 2 (behaviour)
  input_text.pool_pump_window                 optional, default "07:00-18:00" (behaviour)
  input_number.villa_fx_idr_per_usd           optional, for a USD line

The pool volume prefix is derived from the asset slug: "pool_pump" -> "pool".
A missing required helper stops the computation with a clear sentence.

The real flow comes, in order of preference, from a flow sensor of the asset
(family water, device_class volume_flow_rate), from the pump curve at the
measured running power, or from a proportional estimate on the rated point.
The message always says which of the three it used.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, time, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))

from vesta_shared import script  # noqa: E402  (client, pack, store, settings, zone: one set-up)
from vesta_shared.params import MissingParameter  # noqa: E402
from vesta_shared.stats import med  # noqa: E402
from vesta_shared.timeutil import schedule_hours_per_day, hhmm_to_minutes  # noqa: E402
from vesta_shared.messaging import fmt_money  # noqa: E402
import vesta_shared.daily as F  # noqa: E402  (a day of a meter: shared, not another skill's file)


def interpolate(curve: list[list[float]], x: float) -> float | None:
    pts = sorted((float(a), float(b)) for a, b in curve)
    if not pts:
        return None
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0) if x1 != x0 else y0
    return None


def split_blocks(hours: float, n: int, window: str) -> list[tuple[str, str]]:
    """Spread `hours` into n blocks inside the window, first block at the start, last block at the end."""
    w0, w1 = window.split("-")
    start, end = hhmm_to_minutes(w0), hhmm_to_minutes(w1)
    total = int(round(hours * 60))
    if n <= 1 or total >= end - start:
        return [(w0, f"{(start + min(total, end - start)) // 60:02d}:{(start + min(total, end - start)) % 60:02d}")]
    per = total // n
    gap = (end - start - total) // (n - 1)
    out = []
    t = start
    for i in range(n):
        length = per if i < n - 1 else total - per * (n - 1)
        out.append((f"{t // 60:02d}:{t % 60:02d}", f"{(t + length) // 60:02d}:{(t + length) % 60:02d}"))
        t += length + gap
    return out


def pool_of(slug: str) -> str:
    return slug.rsplit("_pump", 1)[0] if slug.endswith("_pump") else slug  # pool_pump -> pool


def filtration_pump(pack, params) -> tuple[str | None, list[str]]:
    """The villa's filtration pump: (its slug, the "_pump" assets considered). The first by slug whose pool has a
    volume helper; with none, the only "_pump" asset (its missing helpers are then named); several and none set
    up: None — which one filters the pool is the villa's to say, never a guess.

    ⚠️ DERIVED, NOT NAMED IN THE CODE (architecture review 13, 2026-10-09): --asset defaulted to one villa's
    "pool_pump", which the monthly report relies on (it passes no --asset)."""
    pumps = sorted(s for s in pack.assets if s.endswith("_pump"))
    with_pool = [s for s in pumps if params.optional_number(f"{pool_of(s)}_volume_m3") is not None]
    if with_pool:
        return with_pool[0], pumps
    return (pumps[0] if len(pumps) == 1 else None), pumps


def run(args) -> dict:
    ctx = script.Context.of(args, skill=os.path.dirname(HERE))
    args = ctx.args
    cli, pack, params, Z = ctx.client, ctx.pack, ctx.params, ctx.Z
    slug, pumps = (args.asset, []) if args.asset else filtration_pump(pack, params)
    if not slug and pumps:
        missing = [f"input_number.{pool_of(s)}_volume_m3 (pool volume in m3, for {s})" for s in pumps]
        return {"ok": False, "missing": missing, "message": "Cannot compute the filtration schedule yet: which pump filters "
                "the pool is not set. Missing one of: " + "; ".join(missing) + "."}
    if not slug:
        return {"ok": False, "error": "no filtration pump in the knowledge pack (an asset whose name ends in _pump): "
                                      "pass --asset"}
    asset = pack.assets.get(slug)
    if not asset:
        return {"ok": False, "error": f"asset {slug} not in the knowledge pack"}
    slug = asset["slug"]
    pool = pool_of(slug)
    today = ctx.day(args.as_of)                    # the one "which day" rule (timeutil.villa_day)
    day_end = datetime.combine(today + timedelta(days=1), time(0, 0), tzinfo=Z)

    missing = []
    def need(obj, hint):
        try:
            return params.number(obj)
        except MissingParameter:
            missing.append(f"input_number.{obj} ({hint})"); return None

    volume = need(f"{pool}_volume_m3", "pool volume in m3, plus balancing tank")
    turnovers = need(f"{pool}_target_turnovers_per_day", "how many times the water passes the filter per day")
    rated_flow = params.optional_number(f"{slug}_rated_flow_m3h")
    rated_power = params.optional_number(f"{slug}_rated_power_w")
    model = params.text_or(f"{slug}_model", "")
    curve = None
    try:
        curve = params.json(f"{slug}_curve")
    except MissingParameter:
        curve = None
    blocks_n = int(params.optional_number(f"{slug}_blocks_per_day") or params.behaviour("blocks_per_day"))
    window = params.text_or(f"{slug}_window", "07:00-18:00")

    # measured signature: last 7 days of hourly statistics
    p_eid = asset["entities"].get("power")
    measured_w, measured_hours, days_used = None, None, 0
    if p_eid:
        rows = cli.statistics([p_eid], day_end - timedelta(days=8), day_end, "hour", ("mean", "min", "max")).get(p_eid, [])
        _, feats = F.power_days(asset, rows, pack.time_zone, params)                       # the one "running"
        last7 = [feats[d] for d in sorted(feats) if today - timedelta(days=7) < d <= today]
        rp = [f["running_power"] for f in last7 if f.get("running_power")]
        rh = [f["run_hours"] for f in last7 if f.get("run_hours") is not None]
        measured_w, measured_hours, days_used = med(rp), med(rh), len(rp)

    # real flow: sensor, curve, or proportional estimate
    flow, method, confidence = None, None, None
    flow_eid = next((r["entity_id"] for r in pack.entities("water") if r["asset"] == slug and (r.get("device_class") == "volume_flow_rate" or (r.get("unit") or "").endswith("/h"))), None)
    if flow_eid:
        rows = cli.statistics([flow_eid], day_end - timedelta(days=7), day_end, "hour", ("mean",)).get(flow_eid, [])
        vals = [r["mean"] for r in rows if r.get("mean")]
        if vals:
            flow, method, confidence = med(vals), f"measured by {flow_eid}", "high"
    if flow is None and curve and measured_w:
        flow, method, confidence = interpolate(curve, measured_w), "pump curve at the measured draw", "medium"
    if flow is None and measured_w and rated_flow and rated_power:
        flow = rated_flow * measured_w / rated_power
        method, confidence = "proportional estimate from the rated point", "low"
    if flow is None:
        if not rated_flow: missing.append(f"input_number.{slug}_rated_flow_m3h (from the pump plate)")
        if not rated_power: missing.append(f"input_number.{slug}_rated_power_w (from the pump plate)")
        if not measured_w: missing.append(f"a measured running power for {slug} (no statistics in the last 7 days)")
    try:
        tariff, currency = params.tariff()
    except MissingParameter as e:          # the tariff or its currency: said with the rest, never a crash
        missing.append(f"{e.name} ({e.hint})")
    if missing:
        return {"ok": False, "asset": slug, "missing": missing,
                "message": "Cannot compute the filtration schedule yet. Missing: " + "; ".join(missing) + "."}

    hours = volume * turnovers / flow
    hours_rounded = round(hours * 2) / 2
    blocks = split_blocks(hours_rounded, blocks_n, window)
    kwh_day = measured_w * hours_rounded / 1000
    cost_month = kwh_day * tariff * 30.4

    # current: the schedule helper and what was measured
    current_sched_h = None
    if asset.get("schedule"):
        sch = params.schedule(asset["schedule"].split(".", 1)[1])
        if sch:
            hpd = schedule_hours_per_day(sch)
            current_sched_h = med(list(hpd.values()))
    current_h = measured_hours if measured_hours else current_sched_h
    delta_h = (hours_rounded - current_h) if current_h is not None else None
    delta_cost_month = delta_h * measured_w / 1000 * tariff * 30.4 if delta_h is not None else None
    fx = params.optional_number("villa_fx_idr_per_usd")

    lines = [f"Filtration for {pool.replace('_', ' ')}" + (f" ({model})" if model else "") + ":"]
    lines.append(f"Volume {volume:.0f} m3 x {turnovers:g} turnovers/day = {volume * turnovers:.0f} m3 to filter.")
    lines.append(f"Real flow {flow:.1f} m3/h ({method}, confidence {confidence}).")
    lines.append(f"That is {hours:.1f} h/day, rounded to {hours_rounded:g} h in {len(blocks)} block(s): "
                 + ", ".join(f"{a} to {b}" for a, b in blocks) + ".")
    if current_h is not None:
        lines.append(f"Today the pump runs about {current_h:.1f} h/day"
                     + (f" ({delta_h:+.1f} h/day, {fmt_money(delta_cost_month, currency)}/month)" if delta_h is not None else "") + ".")
    lines.append(f"Cost at the proposed schedule: {kwh_day:.1f} kWh/day, {fmt_money(cost_month, currency)}/month"
                 + (f" ({cost_month / fx:,.0f} USD)" if fx else "") + ".")
    if confidence == "low":
        lines.append("The flow is an estimate: a flow meter or a pressure gauge read on the filter would turn it into a measurement.")
    lines.append("The timer is manual: the pool technician sets it, VESTA checks on the power signature the next days.")

    return {"ok": True, "asset": slug, "pool": pool, "volume_m3": volume, "turnovers": turnovers,
            "flow_m3h": round(flow, 2), "flow_method": method, "flow_confidence": confidence,
            "measured_running_w": round(measured_w, 1) if measured_w else None, "measured_run_hours": measured_hours,
            "days_used": days_used, "hours_per_day": round(hours, 2), "hours_rounded": hours_rounded,
            "blocks": blocks, "window": window, "kwh_per_day": round(kwh_day, 2),
            "cost_per_month": round(cost_month), "currency": currency, "current_hours": current_h,
            "delta_hours": round(delta_h, 2) if delta_h is not None else None,
            "delta_cost_per_month": round(delta_cost_month) if delta_cost_month is not None else None,
            "message": "\n".join(lines)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    script.arguments(ap, pack=True, pack_required=True, store=False)
    ap.add_argument("--asset", help="the pump's asset slug; without it, the villa's filtration pump (filtration_pump)")
    ap.add_argument("--as-of")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    res = run(a)
    if a.out:
        json.dump(res, open(a.out, "w"), indent=1)
    print(res.get("message", json.dumps(res, indent=1)))
    return 0 if res.get("ok") else 2


if __name__ == "__main__":
    sys.exit(main())
