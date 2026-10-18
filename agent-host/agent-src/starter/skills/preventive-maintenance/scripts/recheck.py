#!/usr/bin/env python3
"""Every 5 minutes: a device gone offline gets its fault now; one found offline that is back closes it now; so does
any fault about a device deleted from Home Assistant.

  python recheck.py --store vesta_store.sqlite [--pack pack.json] [--fixture-dir DIR] [--now 2026-10-10T14:00:00+00:00]

⚠️ FOUND AT ONCE, NOT AT 02:00 (owner, 2026-10-18 — architecture review, offline devices #1): Timmerflotte_5969 dropped
at 21:46 and stood "Unavailable" in the Cockpit for 4 h 14 min before the night check opened its fault. Here the
night's own reading of what is offline (nightly.offline_findings) runs every 5 minutes: a device offline
`unavailable_minutes` with no open finding gets one — its Kiosk fault, and for a critical device the facility
manager's message, as the night check sends it. It closes nothing it did not see: that stays back_online's.

⚠️ NOT THE NEXT NIGHT (villa, 2026-10-10): "shelly integration (3 devices) has been offline for 9 h" stayed an open
fault in the Cockpit all day while every Shelly device had been back since noon — the night check closes a finding
only when it runs again, at 02:00. An offline finding is a state anyone can read again: here its devices are read
every 5 minutes, and once all are back online (`back_online_minutes`), it closes as the night check would close it
(vesta_shared.problems: its task and its Kiosk fault with it).

⚠️ A DEVICE DELETED FROM HOME ASSISTANT (owner, 2026-10-14): its fault stayed open until 02:00, then closed "Cleared:
the nightly check no longer sees it" — as if it had come back. Any open finding whose every entity Home Assistant
answers "not found" for (its own 404, never a failed read) closes here, saying so. Nothing is read when nothing is open.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from vesta_shared import result, script  # noqa: E402
from vesta_shared.device_state import OFFLINE, out_for  # noqa: E402  ("is it back": one answer)
from vesta_shared.problems import Problems  # noqa: E402
from vesta_shared.timeutil import day_time_label  # noqa: E402
import nightly as N  # noqa: E402  (what is offline: the night's one reading of it)



def rechecked(skill_dir: str = os.path.dirname(HERE)) -> set[str]:
    """The rules whose findings are read again here: the skill's own `rechecks` (skill.yaml) — what the Kiosk's card
    says "Next check: within 5 min" of (architecture review, 2026-10-15: this script kept its own copy of that list)."""
    import yaml
    with open(os.path.join(skill_dir, "skill.yaml"), encoding="utf-8") as f:
        return set((yaml.safe_load(f) or {}).get("rechecks") or [])
GONE_NOTE = "Closed: this device no longer exists in the villa's system."
ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")     # only a real entity id can be "not found"


def back_online(store, client, now: datetime, minutes: float, zone: str) -> dict:
    """{closed: [finding ids], gone: [the ones whose devices no longer exist], actions: [the Kiosk faults to resolve]}.
    `client()`: Home Assistant, asked for only when a finding is open."""
    rows = store.findings(status="open")
    if not rows or client() is None:
        return {"closed": [], "gone": [], "actions": []}
    ents = {f["id"]: json.loads(f.get("detail") or "{}").get("entities") or [f["entity_id"]] for f in rows}
    ids = sorted({e for es in ents.values() for e in es if ENTITY_ID.match(str(e))})
    states = client().states(ids)
    # only what has no state is asked about: "not found" is Home Assistant's answer, a missing row is not
    gone = client().not_found([e for e in ids if e not in states]) if len(states) < len(ids) else set()
    day = now.astimezone(ZoneInfo(zone)).date().isoformat()
    closed, deleted, actions, rules = [], [], [], rechecked()
    for f in rows:
        es = ents[f["id"]]
        if es and all(e in gone for e in es):
            actions += Problems(store).close_finding(f, day, GONE_NOTE)
            closed.append(f["id"]); deleted.append(f["id"])
        elif f["rule_id"] in rules and out_for(client(), [e for e in es if e not in gone], states, OFFLINE, now,
                                                      minutes, unknown_tells=True):
            actions += Problems(store).close_finding(f, day, "Cleared: back online.")
            closed.append(f["id"])
    if closed:
        store.audit("preventive-maintenance", "back_online", {"findings": closed, "gone": deleted})
    return {"closed": closed, "gone": deleted, "actions": actions}


def gone_offline(store, pack, client, now: datetime, params, zone: str) -> dict:
    """{actions: [the Kiosk faults to open or reopen], send: [the facility manager's message for a critical device],
    found: [finding ids]}. Only a device with no open finding: one already open is the night check's to restate."""
    none = {"actions": [], "send": [], "found": []}
    if pack is None or client() is None:
        return none
    ids = sorted({r["entity_id"] for fam in N.WATCHED_FAMILIES for r in pack.entities(fam)})
    at = now.astimezone(ZoneInfo(zone))
    found = [f for f in N.offline_findings(pack, client().states(ids), at, params, N.alerted_offline(store, pack))
             if not store.open_finding(f.rule_id, f.entity_id)]
    if not found:
        return none
    day = at.date().isoformat()
    rec = Problems(store).record(found, day, state_rules=N.STATE_RULES, event_rules=N.EVENT_RULES,
                                 worsened_step=params.behaviour("worsened_step_pct"))
    actions = [result.fault(t["todo_summary"], task_id=t["task_id"], check=t.get("check"), entity_id=t.get("entity_id"))
               for t in rec["tasks"]] + rec["reopen_actions"]
    send = N.told_now({"villa": pack.villa, "as_of": day, "new_findings": rec["new"], "again": rec["again"]},
                      title=f"{pack.villa or 'The villa'}, devices offline on {day_time_label(at)}.")
    store.audit("preventive-maintenance", "gone_offline", {"findings": [d["id"] for d in rec["new"] + rec["again"]]})
    return {"actions": actions, "send": send, "found": [d["id"] for d in rec["new"] + rec["again"]]}


def main(argv=None):
    ap = argparse.ArgumentParser()
    script.arguments(ap, pack=True)
    a = ap.parse_args(argv)
    ctx = script.Context(a, skill=os.path.dirname(HERE))
    now = datetime.fromisoformat(a.now) if getattr(a, "now", None) else datetime.now(timezone.utc)
    res = back_online(ctx.store, lambda: ctx.live_client, now, ctx.params.behaviour("back_online_minutes"), ctx.zone)
    found = gone_offline(ctx.store, ctx.pack, lambda: ctx.live_client, now, ctx.params, ctx.zone)
    print(json.dumps({"actions": res["actions"] + found["actions"], "send": found["send"],
                      result.FAULTS_CHANGED: bool(res["closed"] or found["actions"])}, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
