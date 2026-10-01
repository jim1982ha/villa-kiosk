#!/usr/bin/env python3
"""alert-desk: intake, dedup, routing, chase ladder, replies, siren gate, villa-silent watch.

Sub-commands (all print JSON the engine acts on; none sends anything itself):

  desk.py intake   --event event.json     one vesta_critical_event from Home Assistant (or a PM finding)
  desk.py tick                            every 5 min: re-asks, escalations, villa-silent check, fatigue
  desk.py reply    --incident 12 --text "Done" --from fm
  desk.py status                          open incidents, muted rules, last beats

The event is the one the VESTA rules fire AFTER their own Telegram message
(checked live on 2026-09-29/30; INTEGRATION-PLAN 6b). Every phase of one incident
carries the same incident_id:
  {"blueprint": "critical_condition", "rule_id": "automation.<the rule>",
   "incident_id": "automation.<the rule>-1790000000", "phase": "opened|resolved|abandoned",
   "severity": "critical", "label": "Entrance left unlocked", "entities": ["lock.<a lock>"],
   "summary": "the rule's own message", "timestamp": "...", "reason"?: "...", ...}
Only critical_condition, critical_binary_trip and critical_presence_guard ever
send "resolved"; critical_schedule, critical_system and critical_watchdog send
"opened" only — their incidents close through the ladder (Done / Not found).

The output is the engine's standard form: {"send": [{to, text, keyboard?}], "actions":
[{action: ticket | ticket.resolve | snapshot.get, ...}], "incident_id", "siren_gate"?}.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
from vesta_shared.store import Store  # noqa: E402  (PYTHONPATH is set by the engine)
from vesta_shared.params import VillaParams  # noqa: E402
from vesta_shared.problems import DONE, Problems  # noqa: E402  (a problem's lifecycle: one owner)

RULES = yaml.safe_load(open(os.path.join(HERE, "..", "rules.yaml"), encoding="utf-8"))
LADDER_OPTIONS = ["Done", "Not found", "Need help", "Mute"]
#: The beat the engine writes every minute while its Home Assistant connection is up.
HA_BEAT = "ha_events"


def now_utc(fake: str | None = None) -> datetime:
    return datetime.fromisoformat(fake) if fake else datetime.now(timezone.utc)


def route_for(rule_id: str, blueprint: str | None = None) -> dict:
    """A route by the rule's blueprint first (the live event names it), then by rule id prefix."""
    r = dict(RULES["defaults"])
    for cand in RULES["routes"]:
        if (blueprint and cand.get("blueprint") == blueprint) or \
                (cand.get("prefix") and rule_id.startswith(cand["prefix"])):
            r.update(cand)
            break
    return r


def recipients(severity: str) -> list[str]:
    return [role for role, sevs in RULES["people_roles"].items() if severity in sevs and role != "digest"]


def normalise(ev: dict) -> dict:
    """The live event, or an older/internal one ({rule_id, entity_id, message}), as the desk's fields."""
    ents = ev.get("entities")
    if isinstance(ents, str):
        ents = [ents]
    eid = ev.get("entity_id") or (",".join(sorted(str(e) for e in ents)) if ents else "")
    return {**ev, "entity_id": eid, "message": ev.get("summary") or ev.get("message") or ev.get("label") or ev.get("rule_id"),
            "phase": ev.get("phase") or "opened", "ha_incident": ev.get("incident_id")}


def villa_mode() -> str:
    """input_select.villa_mode, read through the read-only HA MCP client; "unknown" when it cannot be read."""
    try:
        from vesta_shared.ha_client import McpClient
        st = McpClient().states(["input_select.villa_mode"]).get("input_select.villa_mode") or {}
        return str(st.get("state") or "unknown").lower()
    except Exception:  # noqa: BLE001
        return "unknown"


def _find_by_ha_incident(store: Store, ha_incident: str | None) -> dict | None:
    if not ha_incident:
        return None
    for inc in store.incidents(open_only=True):
        try:
            if json.loads(inc.get("payload") or "{}").get("ha_incident") == ha_incident:
                return inc
        except ValueError:
            continue
    return None


def intake(store: Store, ev: dict, now: datetime, params: VillaParams | None = None, mode_reader=villa_mode) -> dict:
    ev = normalise(ev)
    if ev["phase"] == "resolved":
        return resolved(store, ev, now)
    if ev["phase"] == "abandoned":
        return abandoned(store, ev, now)
    rule_id, eid = ev["rule_id"], ev.get("entity_id", "")
    route = route_for(rule_id, ev.get("blueprint"))
    sev = route["severity"] if ev.get("severity") in (None, "critical") else ev["severity"]
    key = f"{rule_id}|{eid}"
    out = {"send": [], "actions": [], "incident_id": None, "decision": None}
    if store.is_muted(rule_id, eid, now.isoformat()):
        out["decision"] = "muted"; store.audit("alert-desk", "muted", ev); return out
    if params and params.boolean("maintenance_mode", default=False) and sev != "P1":
        out["decision"] = "maintenance_mode"; store.audit("alert-desk", "suppressed_maintenance", ev); return out
    if route.get("intrusion") and not ev.get("villa_mode"):
        ev["villa_mode"] = mode_reader()
    cur = store.find_open_incident(key)
    if cur:
        last = datetime.fromisoformat(cur["last_seen_at"])
        store.touch_incident(cur["id"], now.isoformat())
        out["incident_id"] = cur["id"]
        if (now - last) < timedelta(minutes=route["cooldown_min"]):
            out["decision"] = "counted"  # repeat inside the cooldown: no message
            return out
        out["decision"] = "repeat"
        out["send"].append({"to": "fm", "text": f"Still there: {ev['message']} ({cur['count'] + 1} times since {cur['opened_at'][:16]})."})
        if route.get("intrusion"):
            out["siren_gate"] = siren_gate(store, ev, now)
        return out
    iid = store.new_incident(key, rule_id, eid, sev, ev, now.isoformat())
    out["incident_id"] = iid
    out["decision"] = "new"
    text = ev["message"]
    if route.get("check"):
        text += f"\nWhat to do: {route['check']}"
    text += f"\nIncident #{iid}."
    if ev.get("snapshot"):
        out["actions"].append({"action": "snapshot.get", "entity_id": ev["snapshot"], "incident_id": iid})
    for role in recipients(sev):
        msg = {"to": role, "text": text}
        if route.get("ladder", True) and role == "fm":
            msg["keyboard"] = True
        out["send"].append(msg)
    if sev in ("P1", "P2") and route.get("ladder", True):
        store.update_incident(iid, state="asked", asked_at=now.isoformat(), assignee="fm")
        tid, _ = Problems(store).open_task("incident", iid, rule_id, eid, ev["message"][:250], route.get("check") or "")
        out["actions"].append({"action": "ticket", "summary": ev["message"][:200], "task_id": tid,
                               "entity_id": eid if eid and "," not in eid else None, "note": route.get("check")})
    elif sev == "P3":
        store.update_incident(iid, state="digest")
    else:
        store.update_incident(iid, state="logged")
    # intrusion: open the siren gate, never fire it
    if route.get("intrusion"):
        gate = siren_gate(store, ev, now)
        out["siren_gate"] = gate
        if gate["armed"]:
            out["send"].append({"to": "owner", "text": gate["prompt"]})
            out["send"].append({"to": "fm", "text": gate["prompt"]})
    return out


def resolved(store: Store, ev: dict, now: datetime) -> dict:
    """Home Assistant says the condition cleared. Close the incident; the chase stops.

    Home Assistant already sent its own all-clear to the group: the desk writes only
    when a person was being chased, to tell them no reply is needed any more."""
    out = {"send": [], "actions": [], "incident_id": None, "decision": "resolved_unknown"}
    inc = _find_by_ha_incident(store, ev.get("ha_incident")) or store.find_open_incident(f"{ev['rule_id']}|{ev.get('entity_id', '')}")
    if not inc:
        return out
    was_chasing = inc["state"] in ("asked", "reasked", "escalated")
    store.update_incident(inc["id"], state="resolved", closed_at=now.isoformat())
    out["incident_id"], out["decision"] = inc["id"], "resolved"
    for tid in Problems(store).clear_source("incident", inc["id"], inc["rule_id"], inc["entity_id"]):
        out["actions"].append({"action": "ticket.resolve", "task_id": tid, "note": "Cleared: Home Assistant reports it is back to normal."})
    # its alert and reminders, in every chat, lose their buttons: nobody presses for something already over
    out["settle"] = [{"incident_id": inc["id"], "note": "Cleared in Home Assistant, {time}. No reply needed."}]
    if was_chasing:
        out["send"].append({"to": "fm", "text": f"Incident #{inc['id']} closed: Home Assistant reports it cleared. No reply needed."})
    store.audit("alert-desk", "resolved", {"incident": inc["id"]})
    return out


def abandoned(store: Store, ev: dict, now: datetime) -> dict:
    """The rule stopped watching while the condition was STILL true: the owner hears it."""
    out = {"send": [], "actions": [], "incident_id": None, "decision": "abandoned_unknown"}
    inc = _find_by_ha_incident(store, ev.get("ha_incident")) or store.find_open_incident(f"{ev['rule_id']}|{ev.get('entity_id', '')}")
    if not inc:
        return out
    store.update_incident(inc["id"], state="escalated", escalated_at=now.isoformat(), assignee="owner")
    out["incident_id"], out["decision"] = inc["id"], "abandoned"
    out["send"].append({"to": "owner", "text": f"Still not clear, and the rule has stopped watching it: {ev['message']} Incident #{inc['id']}."})
    return out


def siren_minutes() -> int:
    """How long the siren sounds: policy.yaml's siren_auto_off_min, the one place it is set
    (owner, 2026-10-01). The engine reads the same value when it switches the siren off."""
    from vesta_agent.policy import Policy
    return Policy.load(os.environ.get("VESTA_POLICY", "")).siren_auto_off_min


def siren_gate(store: Store, ev: dict, now: datetime) -> dict:
    cfg = RULES["siren"]
    window = now - timedelta(minutes=cfg["window_min"])
    recent = [i for i in store.incidents(open_only=True)
              if route_for(i["rule_id"], json.loads(i.get("payload") or "{}").get("blueprint")).get("intrusion")
              and datetime.fromisoformat(i["opened_at"]) >= window]
    signals = {i["entity_id"] for i in recent}
    mode = (ev.get("villa_mode") or "unknown").lower()
    armed = len(signals) >= cfg["min_signals"] and mode in cfg["requires_villa_mode"]
    prompt = ""
    if armed:
        # The engine turns this into an Approve / Refuse request to the owner (outcome.carry_out).
        prompt = (f"Intrusion suspected: {len(signals)} independent sensors in {cfg['window_min']} min while the villa is {mode}: "
                  f"{', '.join(sorted(signals))}. Look at the snapshot. Approving sounds the siren for {siren_minutes()} min.")
    return {"armed": armed, "signals": sorted(signals), "villa_mode": mode, "prompt": prompt,
            "reason": None if armed else ("villa not vacant/away" if mode not in cfg["requires_villa_mode"] else "single signal")}


def reply(store: Store, iid: int, text: str, sender_role: str, now: datetime, params: VillaParams | None = None) -> dict:
    inc = store.incident(iid)
    out = {"send": [], "actions": []}
    if not inc:
        out["send"].append({"to": "here", "text": f"No incident #{iid}."}); return out
    t = text.strip().lower()
    if inc.get("closed_at") and not t.startswith("mute"):
        out["send"].append({"to": "here", "text": f"Incident #{iid} is already closed."}); return out
    if t.startswith("done"):
        store.update_incident(iid, state="done", reply=text, closed_at=now.isoformat())
        for tid in Problems(store).clear_source("incident", iid, inc["rule_id"], inc["entity_id"], status=DONE):
            out["actions"].append({"action": "ticket.resolve", "task_id": tid, "note": f"Done, answered by the {sender_role}."})
        out["send"].append({"to": "here", "text": f"Thanks, incident #{iid} closed. The VESTA Agent will check it stays quiet."})
    elif t.startswith("not found"):
        store.update_incident(iid, state="not_found", reply=text)
        out["send"].append({"to": "here", "text": f"Noted for #{iid}. It stays open and goes in the weekly report; tell me if it comes back."})
    elif t.startswith("need help"):
        store.update_incident(iid, state="escalated", reply=text, escalated_at=now.isoformat(), assignee="owner")
        out["send"].append({"to": "owner", "text": f"The FM needs help on incident #{iid}: {json.loads(inc['payload'] or '{}').get('message', inc['rule_id'])}."})
        out["send"].append({"to": "here", "text": "Owner notified."})
    elif t.startswith("mute"):
        days = int((params.behaviour("mute_days") if params else 30))
        until = (now + timedelta(days=days)).isoformat()
        store.mute(inc["rule_id"], inc["entity_id"], until, sender_role)
        store.update_incident(iid, state="muted", reply=text, closed_at=now.isoformat())
        out["send"].append({"to": "here", "text": f"Muted this alert for {days} days. The report will list it."})
    else:
        store.update_incident(iid, reply=text)
        out["send"].append({"to": "here", "text": f"Noted on #{iid}: {text}"})
    # the answer, on the alert and its reminders in every chat (a button press has already done it, by name)
    said = next((w for w in ("Done", "Not found", "Need help", "Mute") if t.startswith(w.lower())), None)
    if said:
        who = {"owner": "the owner", "fm": "the facility manager"}.get(sender_role, sender_role)
        out["settle"] = [{"incident_id": iid, "note": f"{said} — {who}, {{time}}"}]
    store.audit("alert-desk", "reply", {"incident": iid, "by": sender_role, "text": text})
    return out


def tick(store: Store, now: datetime, params: VillaParams | None = None) -> dict:
    """Every 5 minutes: chase ladder, villa-silent watch, alert fatigue."""
    reask = params.behaviour("reask_minutes") if params else 15
    escal = params.behaviour("escalate_minutes") if params else 45
    silent_min = params.behaviour("villa_silent_minutes") if params else 30
    out = {"send": [], "actions": [], "escalated": [], "reasked": []}
    for inc in store.incidents(open_only=True):
        if inc["state"] not in ("asked", "reasked"):
            continue
        asked = datetime.fromisoformat(inc["asked_at"])
        age = now - asked
        msg = json.loads(inc["payload"] or "{}").get("message", inc["rule_id"])
        if inc["state"] == "asked" and age >= timedelta(minutes=reask):
            store.update_incident(inc["id"], state="reasked", reasked_at=now.isoformat())
            out["send"].append({"to": "fm", "text": f"Reminder, incident #{inc['id']}: {msg}. Reply Done, Not found or Need help.",
                                "keyboard": True})
            out["reasked"].append(inc["id"])
        elif inc["state"] == "reasked" and age >= timedelta(minutes=escal):
            store.update_incident(inc["id"], state="escalated", escalated_at=now.isoformat(), assignee="owner")
            out["send"].append({"to": "owner", "text": f"No answer from the FM after {int(escal)} min on incident #{inc['id']}: {msg}."})
            out["escalated"].append(inc["id"])
    # villa silent: the engine's Home Assistant connection has been down too long
    last = store.last_beat(HA_BEAT)
    if last and now - datetime.fromisoformat(last) > timedelta(minutes=silent_min):
        key = "critical_internet---villa_silent|agent"
        if not store.find_open_incident(key):
            iid = store.new_incident(key, "critical_internet---villa_silent", "agent", "P1",
                                     {"message": f"No contact with the villa's Home Assistant for {int((now - datetime.fromisoformat(last)).total_seconds() // 60)} min: internet, power or Home Assistant is down."},
                                     now.isoformat())
            store.update_incident(iid, state="asked", asked_at=now.isoformat(), assignee="fm")
            for role in recipients("P1"):
                out["send"].append({"to": role, "text": f"[P1] Villa silent since {last[:16]} UTC: no contact with Home Assistant. Check power, the router and the internet link. Incident #{iid}."})
    elif last:
        cur = store.find_open_incident("critical_internet---villa_silent|agent")
        if cur:
            store.update_incident(cur["id"], closed_at=now.isoformat(), state="recovered")
            out["send"].append({"to": "fm", "text": "Villa back online: Home Assistant answers again."})
    # alert fatigue: a rule firing more than N times in 30 days without acknowledgement
    limit = params.behaviour("alert_fatigue_per_month") if params else 20
    since = (now - timedelta(days=30)).isoformat()
    rules = {i["rule_id"] for i in store.incidents(open_only=False) if i["opened_at"] >= since}
    for r in rules:
        n = store.count_incidents(r, since)
        if n >= limit:
            store.add_proposal("retune", f"Retune {r}: fired {n} times in 30 days",
                               f"The rule {r} fired {n} times in 30 days. Either the threshold is too tight or the device needs attention. "
                               "The VESTA Agent proposes a new threshold in the weekly report and applies nothing.", "Fewer useless messages")
    store.beat("agent_tick", now.isoformat())
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["intake", "tick", "reply", "status"])
    ap.add_argument("--store", default=os.environ.get("VESTA_STORE", "vesta_store.sqlite"))
    ap.add_argument("--event"); ap.add_argument("--incident", type=int); ap.add_argument("--text"); ap.add_argument("--from", dest="sender", default="fm")
    ap.add_argument("--now", help="ISO time, for tests")
    ap.add_argument("--helpers", help="helpers fixture JSON for parameters")
    ap.add_argument("--villa-mode", help="for tests: the villa mode instead of reading Home Assistant")
    a = ap.parse_args(argv)
    store = Store(a.store)
    now = now_utc(a.now)
    params = VillaParams.from_fixture(a.helpers) if a.helpers else None
    if a.cmd == "intake":
        ev = json.load(open(a.event)) if a.event else json.load(sys.stdin)
        reader = (lambda: a.villa_mode) if a.villa_mode else villa_mode
        res = intake(store, ev, now, params, reader)
    elif a.cmd == "tick":
        res = tick(store, now, params)
    elif a.cmd == "reply":
        res = reply(store, a.incident, a.text or "", a.sender, now, params)
    else:
        res = {"open": store.incidents(), "muted": store.mutes(), "beats": {n: store.last_beat(n) for n in (HA_BEAT, "agent_tick", "maintenance_nightly")}}
    print(json.dumps(res, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
