#!/usr/bin/env python3
"""Generate the knowledge pack for a villa.

  python -m vesta_shared.build_pack --out pack.json [--fixture-dir DIR] [--bom bom.json] [--people people.yaml]

Runs nightly (the maintenance batch calls it) and on demand. It never edits
anything in Home Assistant. The people table is the one file the installer
writes by hand (roles, languages, chat ids); see agent/people.example.yaml.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

from .ha_client import client_from_args
from .knowledge_pack import build_pack, pack_diff_summary
from .store import Store


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--fixture-dir")
    ap.add_argument("--zone")
    ap.add_argument("--bom", help="JSON list of BOM rows (from vesta-bom-builder export)")
    ap.add_argument("--people", help="YAML or JSON people table")
    ap.add_argument("--channels", help="JSON {owner: chat_id, fm: chat_id}")
    ap.add_argument("--store", help="SQLite path, enables the onboarding diff")
    ap.add_argument("--villa")
    args = ap.parse_args(argv)

    cli = client_from_args(args)
    registry = cli.registry()
    if not registry.get("entities"):
        # fall back to a states dump: every state row becomes a registry row
        registry = dict(registry)
        registry["entities"] = [
            {"entity_id": eid, "name": s.get("attributes", {}).get("friendly_name"),
             "unit_of_measurement": s.get("attributes", {}).get("unit_of_measurement"),
             "device_class": s.get("attributes", {}).get("device_class"),
             "state_class": s.get("attributes", {}).get("state_class"), "state": s.get("state")}
            for eid, s in cli.states().items()]
    helpers, helper_states = cli.helpers()
    for h in helpers:
        h["state"] = helper_states.get(h.get("entity_id"))
    states = cli.states()
    bom = json.load(open(args.bom)) if args.bom else None
    people = None
    if args.people:
        if args.people.endswith((".yaml", ".yml")):
            import yaml
            people = yaml.safe_load(open(args.people)).get("people", [])
        else:
            people = json.load(open(args.people)).get("people", [])
    channels = json.loads(args.channels) if args.channels else None
    pack = build_pack(registry, helpers, states, bom, people, channels,
                      generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"), villa=args.villa)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(pack.to_json())
    summary = {"villa": pack.villa, "families": {k: len(v) for k, v in pack.families.items()},
               "assets": len(pack.assets), "unknown_area": pack.unknown_area, "unclassified": len(pack.unclassified)}
    if args.store:
        st = Store(args.store)
        watched = [r for fam in ("power", "energy", "runtime", "battery", "level", "water", "security", "generation")
                   for r in pack.families.get(fam, [])]
        first_run = st.db.execute("SELECT COUNT(*) FROM pack_seen").fetchone()[0] == 0
        new, gone = st.pack_diff(watched)
        summary["onboarding"] = (f"Initial inventory: {len(new)} monitored entities recorded, nothing to ask."
                                 if first_run else pack_diff_summary(new, gone))
        summary["new"] = [e["entity_id"] for e in new]
        summary["gone"] = [e["entity_id"] for e in gone]
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
