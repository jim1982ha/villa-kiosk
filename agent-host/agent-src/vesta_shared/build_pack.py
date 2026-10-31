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
import os
import sys
from datetime import datetime, timezone

from .ha_client import client_from_args, error_short_chars
from .critical import BLUEPRINT, critical_entities
from .knowledge_pack import build_pack, pack_diff_summary
from .retention import measure
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
                      generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"), villa=args.villa,
                      critical=_critical(cli, args.out), detailed_days=_detailed_days(cli))
    # ⚠️ WRITTEN BESIDE, THEN SWAPPED IN (architecture review, 2026-10-21): since 0.12.309 a pack is rebuilt in the day,
    # a minute after the villa's devices change, while the 5-minute checks read it — a pack half written read as none,
    # and for that tick a sleeping door's alert could read "over" and its device "offline"
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(pack.to_json())
    os.replace(tmp, args.out)
    summary = {"villa": pack.villa, "families": {k: len(v) for k, v in pack.families.items()},
               "assets": len(pack.assets), "unknown_area": pack.unknown_area, "unclassified": len(pack.unclassified)}
    if args.store:
        st = Store(args.store)
        watched = [r for fam in ("power", "energy", "runtime", "battery", "level", "water", "security", "generation")
                   for r in pack.families.get(fam, [])]
        # the villa's critical devices too, whatever their family: one that leaves the villa's system is missing
        # (PM-MISSING), named as the pack names it now — once gone, nothing else does
        listed = {r["entity_id"] for r in watched}
        watched += [pack.row(e) or {"entity_id": e} for e in pack.critical if e not in listed]
        watched = [{**r, "seen_name": pack.device_name(r["entity_id"], r.get("name")),
                    "device": pack.physical_device_of(r["entity_id"])} for r in watched]
        first_run = st.pack_seen_empty()
        new, gone = st.pack_diff(watched)
        summary["onboarding"] = (f"Initial inventory: {len(new)} monitored entities recorded, nothing to ask."
                                 if first_run else pack_diff_summary(new, gone))
        summary["new"] = [e["entity_id"] for e in new]
        summary["gone"] = [e["entity_id"] for e in gone]
    print(json.dumps(summary, indent=1))
    return 0


def _detailed_days(cli) -> float | None:
    """How many days of detailed history the villa's system holds, measured (vesta_shared.retention); None when it
    cannot be read now — the readers then take every period as kept, as before."""
    try:
        return measure(cli)
    except Exception as e:  # noqa: BLE001 — the villa's system not readable now
        print(f"How far the villa's history goes could not be measured ({str(e)[:error_short_chars()]}).", file=sys.stderr)
        return None


def _critical(cli, previous: str) -> list[str]:
    """The villa's critical devices (vesta_shared.critical), read from its own rule. ⚠️ A FAILED READ IS NOT "NONE":
    the last pack's list is kept — an empty one would turn every critical device amber until the next night."""
    try:
        return sorted(critical_entities(cli.automation_configs(BLUEPRINT)))
    except Exception as e:  # noqa: BLE001 — the villa's system not readable now
        print(f"The critical devices could not be read ({str(e)[:error_short_chars()]}): the last list is kept.", file=sys.stderr)
        try:
            return list(json.load(open(previous, encoding="utf-8")).get("critical") or [])
        except (OSError, ValueError):
            return []


if __name__ == "__main__":
    sys.exit(main())
