#!/usr/bin/env python3
"""Every 5 minutes: a device the night check found offline that is back closes its fault now.

  python recheck.py --store vesta_store.sqlite [--fixture-dir DIR] [--now 2026-10-10T14:00:00+00:00]

⚠️ NOT THE NEXT NIGHT (villa, 2026-10-10): "shelly integration (3 devices) has been offline for 9 h" stayed an open
fault in the Cockpit all day while every Shelly device had been back since noon — the night check closes a finding
only when it runs again, at 02:00. An offline finding is a state anyone can read again: here its devices are read
every 5 minutes, and once all are back online (`back_online_minutes`), it closes as the night check would close it
(vesta_shared.problems: its task and its Kiosk fault with it). Nothing is read when no device is found offline.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from vesta_shared import result, script  # noqa: E402
from vesta_shared.device_state import OFFLINE, out_of  # noqa: E402  ("is it back": one answer)
from vesta_shared.problems import Problems  # noqa: E402

OFFLINE_RULE = "PM-UNAVAILABLE"


def back_online(store, client, now: datetime, minutes: float, zone: str) -> dict:
    """{closed: [finding ids], actions: [the Kiosk faults to resolve]}. `client()`: Home Assistant, asked for only when
    a device is found offline."""
    rows = [f for f in store.findings(status="open") if f["rule_id"] == OFFLINE_RULE]
    if not rows or client() is None:
        return {"closed": [], "actions": []}
    ents = {f["id"]: json.loads(f.get("detail") or "{}").get("entities") or [f["entity_id"]] for f in rows}
    states = client().states(sorted({e for es in ents.values() for e in es}))
    day = now.astimezone(ZoneInfo(zone)).date().isoformat()
    closed, actions = [], []
    for f in rows:
        if all(out_of(states.get(e) or {}, OFFLINE, now, minutes, unknown_tells=True) for e in ents[f["id"]]):
            actions += Problems(store).close_finding(f, day, "Cleared: back online.")
            closed.append(f["id"])
    if closed:
        store.audit("preventive-maintenance", "back_online", {"findings": closed})
    return {"closed": closed, "actions": actions}


def main(argv=None):
    ap = argparse.ArgumentParser()
    script.arguments(ap)
    a = ap.parse_args(argv)
    ctx = script.Context(a, skill=os.path.dirname(HERE))
    now = datetime.fromisoformat(a.now) if getattr(a, "now", None) else datetime.now(timezone.utc)
    res = back_online(ctx.store, lambda: ctx.live_client, now, ctx.params.behaviour("back_online_minutes"), ctx.zone)
    print(json.dumps({"actions": res["actions"], result.FAULTS_CHANGED: bool(res["closed"])}, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
