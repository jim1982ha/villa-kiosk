#!/usr/bin/env python3
"""Build the "VESTA suggests" list from the period result and the optimiser.

  python proposals.py --period-json week.json [--optimiser-json proposal.json] [--store S]

Each proposal has a kind, a title, the detail and an estimated benefit, and
is stored once (same title = same proposal) with accept / later / ignore
replies handled by the concierge skill. No LLM here; the reports skill lets
the model phrase them.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
from vesta_shared.store import Store  # noqa: E402
from vesta_shared.messaging import fmt_money  # noqa: E402


def build(period: dict, optimiser: dict | None, findings_open: list[dict] | None = None) -> list[dict]:
    out = []
    cur = period.get("currency") or ""
    if period.get("unmetered_pct") is not None and period["unmetered_pct"] >= 50:
        out.append({"kind": "measurement", "title": "Meter the largest unmetered circuits",
                    "detail": f"{period['unmetered_pct']:.0f}% of the villa's electricity ({period['unmetered_kwh']:.0f} kWh over the period) "
                              "is not attributed to any load. Air conditioning is the usual candidate. One energy clamp per AC circuit "
                              "makes the ROI report complete and lets the agent watch each unit.",
                    "benefit": "Report coverage from " + f"{100 - period['unmetered_pct']:.0f}% to about 80%"})
    if optimiser and optimiser.get("ok") and optimiser.get("delta_hours") is not None and abs(optimiser["delta_hours"]) >= 0.5:
        sign = "more" if optimiser["delta_hours"] > 0 else "less"
        out.append({"kind": "schedule", "title": f"Set the {optimiser['pool'].replace('_', ' ')} filtration to {optimiser['hours_rounded']:g} h/day",
                    "detail": optimiser["message"],
                    "benefit": f"{abs(optimiser['delta_hours']):.1f} h/day {sign}, {fmt_money(abs(optimiser['delta_cost_per_month']), cur)}/month "
                               + ("extra, for the water quality target" if optimiser["delta_hours"] > 0 else "saved")})
    if optimiser and optimiser.get("ok") and optimiser.get("flow_confidence") == "low":
        out.append({"kind": "measurement", "title": "Add a flow meter or a filter pressure gauge readable by Home Assistant",
                    "detail": "The filtration schedule is computed on an estimated flow. A flow meter on the return line (or a pressure "
                              "transducer on the filter) turns the estimate into a measurement and makes a blocked filter visible the same day.",
                    "benefit": "Removes the main uncertainty of the filtration schedule"})
    for l in period.get("loads", []):
        # a jump is worth a line only when both the load and its baseline are material
        if l.get("vs_baseline_pct") is not None and l["vs_baseline_pct"] >= 60 and l["kwh"] >= 5 and (l.get("baseline_kwh") or 0) >= 2:
            out.append({"kind": "waste", "title": f"{l['name']}: {l['vs_baseline_pct']:+.0f}% versus its usual level",
                        "detail": f"{l['kwh']:.1f} kWh over the period against about {l['baseline_kwh']:.1f} kWh usually. "
                                  "Worth a look: a device left on, a changed schedule, or a new use.",
                        "benefit": f"Up to {fmt_money((l['kwh'] - l['baseline_kwh']) * (period.get('tariff') or 0), cur)} per period"})
    if period.get("generation"):
        out.append({"kind": "schedule", "title": "Move pump blocks into solar hours",
                    "detail": "Solar generation is measured. The filtration blocks can sit inside the generation window to use self-produced energy first.",
                    "benefit": "Self-consumption share up"})
    for f in findings_open or []:
        if f.get("rule_id") == "PM-PARAM-MISSING":
            # ⚠️ THE DEVICE'S NAME, NOT ITS ID (owner, 2026-10-07: a raw entity id ran out of its card); the title
            # stays one per device, since a proposal is stored once by title
            try:
                name = (json.loads(f.get("detail") or "{}") or {}).get("name")
            except (TypeError, ValueError):
                name = None
            out.append({"kind": "configuration", "title": f"Create the missing setting for {name or f['entity_id']}",
                        "detail": f["summary"], "benefit": "Enables one rule"})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--period-json", required=True)
    ap.add_argument("--optimiser-json")
    ap.add_argument("--store")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    period = json.load(open(a.period_json))
    opt = json.load(open(a.optimiser_json)) if a.optimiser_json else None
    store = Store(a.store) if a.store else None
    props = build(period, opt, store.findings(status="open") if store else None)
    if store:
        for p in props:
            p["id"] = store.add_proposal(p["kind"], p["title"], p["detail"], p["benefit"])
    if a.out:
        json.dump(props, open(a.out, "w"), indent=1)
    for p in props:
        print(f"- [{p['kind']}] {p['title']}  ->  {p['benefit']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
