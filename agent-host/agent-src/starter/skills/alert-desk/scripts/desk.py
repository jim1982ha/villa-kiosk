#!/usr/bin/env python3
"""alert-desk: intake, dedup, routing, chase ladder, replies, siren gate, villa-silent watch.

Sub-commands (all print JSON the engine acts on; none sends anything itself):

  desk.py intake   --event event.json     one vesta_critical_event from Home Assistant (or a PM finding)
  desk.py tick                            every 5 min: re-asks, escalations, villa-silent check, fatigue
  desk.py reply    --incident 12 --text "Done" --from fm
  desk.py status                          open incidents, last beats

The event is the one the VESTA rules fire AFTER their own Telegram message
(checked live on 2026-09-29/30; INTEGRATION-PLAN 6b). Every phase of one incident
carries the same incident_id:
  {"blueprint": "critical_condition", "rule_id": "automation.<the rule>",
   "incident_id": "automation.<the rule>-1790000000", "phase": "opened|resolved|abandoned",
   "severity": "critical", "label": "Entrance left unlocked", "entities": ["lock.<a lock>"],
   "summary": "the rule's own message", "timestamp": "...", "reason"?: "...", ...}
Only critical_condition, critical_binary_trip and critical_presence_guard ever
send "resolved"; critical_schedule, critical_system and critical_watchdog send
"opened" only — their incidents close through the ladder (Done), or, for the two whose
condition the desk can read again, by `tick` (see SEEN_AGAIN).

The output is the engine's standard form, built with vesta_shared/result.py (the shape there, every word here):
{"send": [message], "actions": [fault | resolved | snapshot], "incident_id", "siren_gate"?, "settle"?}.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
from vesta_shared.store import Incident, Store  # noqa: E402  (PYTHONPATH is set by the engine)
from vesta_shared.params import VillaParams  # noqa: E402
from vesta_shared.timeutil import day_time_label, villa_time  # noqa: E402
from vesta_shared.problems import Problems  # noqa: E402  (a problem's lifecycle: one owner)
from vesta_shared import result as R  # noqa: E402  (what the engine is asked to do: its shape)
from vesta_shared import script  # noqa: E402  (client, store, settings, zone: one set-up)
from vesta_shared import skill_settings  # noqa: E402  (rules.yaml, the villa's on top)
from vesta_shared.messaging import incident_tag  # noqa: E402
from vesta_shared.device_state import out_of  # noqa: E402  ("is it back": one answer)

SKILL = os.path.dirname(HERE)
# rules.yaml with the villa's own villa.rules.yaml on top (kept by updates): a villa's route comes FIRST, so it
# replaces the shipped one for its blueprint (the first that matches wins). It was read as shipped only.
RULES = skill_settings.load(SKILL, "rules.yaml", first=("routes",))
DEFAULTS = skill_settings.behaviour(RULES)           # the desk's timings (rules.yaml `behaviour:`)


def _params(params: VillaParams | None) -> VillaParams:
    """The villa's parameters with the desk's own timings to fall back on (none given: the timings alone)."""
    if params is None:
        return VillaParams(defaults=DEFAULTS)
    return params if params.defaults else params.with_defaults(DEFAULTS)
LADDER_OPTIONS = ["Done", "Need help"]      # owner, 2026-10-10: Not found and Mute removed, "too complex for now"
#: What a person still being asked can answer: the last line of every message that carries the buttons.
#: The beat the engine writes every minute while its Home Assistant connection is up.
HA_BEAT = "ha_events"

#: ⚠️ OVER WHEN HOME ASSISTANT NO LONGER SAYS SO (villa, 2026-10-10: the Cockpit kept "Entrance door unlocked" hours
#: after the door was locked, and a relay "unavailable" 5 hours after it was back). critical_condition stops watching
#: after its "Repeat after" ("abandoned") — a door locked later was never said over; critical_watchdog never says a
#: device came back. For these the desk reads the entities again (tick).
#: ⚠️ BY THE RULE'S OWN BAD STATES, NEVER A GUESS (architecture review 22): 0.12.145 took the state at the alert as "the
#: problem" and any other as "over" — a lock gone from unlocked to jammed was closed as cleared, and a rule watching
#: two locks closed when the OTHER one was unlocked. The rules now send their list (bad_states) with the alert: over is
#: NO watched entity in ANY of them, each readable and out of them `clear_minutes`. A condition is judged only once its
#: rule stopped watching (until then Home Assistant says it itself), and only in its "state" mode — a number waits
#: for Home Assistant or a person.
SEEN_AGAIN = ("critical_condition", "critical_watchdog")


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


def details(payload: dict, rule_id: str) -> str:
    """The original alert — Home Assistant's own message, and what to check — as every later message about the
    incident repeats it (owner, 2026-10-09: a chat keeps only an incident's latest message, so each one says
    everything)."""
    text = payload.get("message") or rule_id
    check = route_for(rule_id, payload.get("blueprint")).get("check")
    return f"{text}\nWhat to do: {check}" if check else text


def about(inc: dict, status: str, extra: str = "") -> dict:
    """A message about an open incident, as its parts: the original alert and `extra` (what just happened, in Home
    Assistant's words) as its text, and where it stands as its status — the engine lays them out (heading, alert, status
    at the bottom: vesta_agent/layout.py), never this skill. R.message(to, **about(...))."""
    inc = dict(inc)                                # a store row (find_open_incident) or a dict
    body = details(json.loads(inc.get("payload") or "{}"), inc["rule_id"])
    return {"text": f"{body}\n{extra}" if extra else body, "status": status}


def chased(inc: dict) -> bool:
    """Someone is still asked to answer it: its messages keep the buttons."""
    inc = dict(inc)
    return inc.get("state") in Incident.CHASED and not inc.get("closed_at")


def normalise(ev: dict) -> dict:
    """The live event, or an older/internal one ({rule_id, entity_id, message}), as the desk's fields."""
    ents = ev.get("entities")
    if isinstance(ents, str):
        ents = [ents]
    eid = ev.get("entity_id") or (",".join(sorted(str(e) for e in ents)) if ents else "")
    bad = ev.get("bad_states")
    if isinstance(bad, str):                       # one state sent as text, never its letters (architecture review 23)
        ev = {**ev, "bad_states": [bad]}
    return {**ev, "entity_id": eid, "message": ev.get("summary") or ev.get("message") or ev.get("label") or ev.get("rule_id"),
            "phase": ev.get("phase") or "opened", "ha_incident": ev.get("incident_id")}


def villa_mode(client=None) -> str:
    """input_select.villa_mode, read through the script's Home Assistant client (vesta_shared.script: the live
    client, or a test's fixture folder); "unknown" when it cannot be read."""
    try:
        if client is None:
            from vesta_shared.ha_client import McpClient
            client = McpClient()
        st = client.states(["input_select.villa_mode"]).get("input_select.villa_mode") or {}
        return str(st.get("state") or "unknown").lower()
    except Exception:  # noqa: BLE001
        return "unknown"


def _find_by_ha_incident(store: Store, ha_incident: str | None, closed_within: timedelta | None = None,
                         now: datetime | None = None) -> dict | None:
    """The open incident of Home Assistant's `ha_incident` — or, with `closed_within`, one closed that recently."""
    if not ha_incident:
        return None
    rows = store.incidents(open_only=closed_within is None)
    if closed_within is not None:
        rows = [i for i in rows if i.get("closed_at") and now - datetime.fromisoformat(i["closed_at"]) <= closed_within]
    for inc in rows:
        try:
            if json.loads(inc.get("payload") or "{}").get("ha_incident") == ha_incident:
                return inc
        except ValueError:
            continue
    return None


def intake(store: Store, ev: dict, now: datetime, params: VillaParams | None = None, mode_reader=villa_mode,
           zone: str | None = None) -> dict:
    """An alert from Home Assistant. `zone`: the villa's time zone (vesta_shared.script's one rule)."""
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
    if params and params.boolean("maintenance_mode", default=False) and sev != "P1":
        out["decision"] = "maintenance_mode"; store.audit("alert-desk", "suppressed_maintenance", ev); return out
    if route.get("intrusion") and not ev.get("villa_mode"):
        ev["villa_mode"] = mode_reader()
    cur = store.find_open_incident(key)
    if cur:
        last = datetime.fromisoformat(cur["last_seen_at"])
        store.touch_incident(cur["id"], now.isoformat())
        out["incident_id"] = cur["id"]
        # the villa's time, written as every message writes one ("Mon 5 Oct, 08:00"): it showed "2026-10-03T00:00", UTC
        since = day_time_label(villa_time(cur["opened_at"], zone or "UTC"), weekday=True)
        status = f"Still there: {cur['count'] + 1} times since {since}"
        # Home Assistant's own new message for it takes the incident's number, and replaces its older ones
        out["ha_messages"] = [R.ha_message(cur["id"], context=ev.get("_context_id"), stage="reminder", **about(cur, status))]
        if (now - last) < timedelta(minutes=route["cooldown_min"]):
            out["decision"] = "counted"  # repeat inside the cooldown: no message of the desk's own
            return out
        out["decision"] = "repeat"
        ask = chased(cur)
        out["send"].append(R.message("fm", **about(cur, status), incident=cur["id"], buttons=ask, stage="reminder"))
        if route.get("intrusion"):
            out["siren_gate"] = siren_gate(store, ev, now)
        return out
    back = came_back(store, key, now, _params(params).behaviour("reopen_hours"))
    if back:
        return _reopen(store, back, ev, now, sev, route, zone, out)
    iid = store.new_incident(key, rule_id, eid, sev, ev, now.isoformat())
    out["incident_id"] = iid
    out["decision"] = "new"
    text = details(ev, rule_id)      # no status: "New" is the heading's (Incident: New #N)
    if ev.get("snapshot"):
        out["actions"].append(R.snapshot(ev["snapshot"], iid))
    out["ha_messages"] = [R.ha_message(iid, text, ev.get("_context_id"), stage="new")]
    for role in recipients(sev):
        ladder = bool(route.get("ladder", True) and role == "fm")
        out["send"].append(R.message(role, text, incident=iid, buttons=ladder, stage="new"))
    _ladder(store, iid, ev, now, sev, route, out)
    # intrusion: open the siren gate, never fire it
    if route.get("intrusion"):
        # armed: the engine asks the owner to Approve the siren (no siren set: the warning goes to owner and fm)
        out["siren_gate"] = siren_gate(store, ev, now)
    return out


def _ladder(store: Store, iid: int, ev: dict, now: datetime, sev: str, route: dict, out: dict) -> None:
    """Where an incident opened (or opened again) starts: the facility manager asked, with its task and Kiosk fault
    (P1, P2 with the ladder); the morning list (P3); the record (P4)."""
    if sev in ("P1", "P2") and route.get("ladder", True):
        store.update_incident(iid, state=Incident.ASKED, asked_at=now.isoformat(), assignee="fm")
        tid, _ = Problems(store).open_task("incident", iid, ev["rule_id"], ev.get("entity_id", ""), ev["message"][:250],
                                           route.get("check") or "")
        out["actions"].append(R.fault(ev["message"][:200], task_id=tid, check=route.get("check"), entity_id=ev.get("entity_id", "")))
    elif sev == "P3":
        store.update_incident(iid, state=Incident.DIGEST)
    else:
        store.update_incident(iid, state=Incident.LOGGED)


def came_back(store: Store, key: str, now: datetime, hours: float) -> dict | None:
    """The incident of `key` closed in the last `hours`, if any: an alert back so soon is the SAME problem again.

    ⚠️ BACK AGAIN IS NOT NEW (architecture review 23): an access point dropping every hour got a new number, a new
    "New" message with buttons and a new Kiosk fault each time the desk closed it — the "repeat after" applied only to
    an incident still open, and the retune proposal then counted the desk's own closes."""
    cutoff = (now - timedelta(hours=hours)).isoformat()
    closed = [i for i in store.incidents(open_only=False) if i["key"] == key and i.get("closed_at") and i["closed_at"] >= cutoff]
    return closed[-1] if closed else None


def _reopen(store: Store, inc: dict, ev: dict, now: datetime, sev: str, route: dict, zone: str | None, out: dict) -> dict:
    """`inc`, closed lately, open again: counted, its rule's latest states kept, its ladder (and fault) started again,
    its messages "Back again" under its own number."""
    p = json.loads(inc.get("payload") or "{}")
    for k in ("abandoned", "check_quiet"):
        p.pop(k, None)
    p.update({k: ev[k] for k in ("mode", "bad_states", "state", "ha_incident") if ev.get(k) is not None})
    store.update_incident(inc["id"], closed_at=None, reply=None, payload=json.dumps(p))
    store.touch_incident(inc["id"], now.isoformat())
    _ladder(store, inc["id"], ev, now, sev, route, out)
    inc = store.incident(inc["id"])
    since = day_time_label(villa_time(inc["opened_at"], zone or "UTC"), weekday=True)
    status = f"Back again: {inc['count']} times since {since}"
    out["incident_id"], out["decision"] = inc["id"], "reopened"
    out["ha_messages"] = [R.ha_message(inc["id"], context=ev.get("_context_id"), stage="reminder", **about(inc, status))]
    for role in recipients(sev):
        ladder = bool(route.get("ladder", True) and role == "fm")
        out["send"].append(R.message(role, **about(inc, status), incident=inc["id"], buttons=ladder, stage="reminder"))
    if route.get("intrusion"):
        out["siren_gate"] = siren_gate(store, ev, now)
    store.audit("alert-desk", "reopened", {"incident": inc["id"], "count": inc["count"]})
    return out


def resolved(store: Store, ev: dict, now: datetime) -> dict:
    """Home Assistant says the condition cleared. Close the incident; the chase stops.

    Home Assistant already sent its own all-clear to the group: the desk writes only
    when a person was being chased, to tell them no reply is needed any more."""
    out = {"send": [], "actions": [], "incident_id": None, "decision": "resolved_unknown"}
    inc = _find_by_ha_incident(store, ev.get("ha_incident")) or store.find_open_incident(f"{ev['rule_id']}|{ev.get('entity_id', '')}")
    if not inc:
        # ⚠️ ALREADY CLOSED HERE, STILL ITS MESSAGE (architecture review 22): the desk saw it over first (seen_again, a
        # Done) — Home Assistant's all-clear then stayed a second message in the group, without its incident's number
        late = _find_by_ha_incident(store, ev.get("ha_incident"), closed_within=timedelta(days=1), now=now)
        if late:
            out["incident_id"], out["decision"] = late["id"], "resolved_late"
            out["ha_messages"] = [R.ha_message(late["id"], context=ev.get("_context_id"), **about(late, ev["message"]))]
        return out
    _close(store, inc, now, out, "Cleared in Home Assistant on {time}.",
           "Closed: Home Assistant reports it cleared on {time}. No reply needed.")
    out["incident_id"], out["decision"] = inc["id"], "resolved"
    # Home Assistant's all-clear takes the incident's number and the original alert, and replaces its older ones
    out["ha_messages"] = [R.ha_message(inc["id"], context=ev.get("_context_id"), **about(inc, ev["message"]))]
    store.audit("alert-desk", "resolved", {"incident": inc["id"]})
    return out


def _close(store: Store, inc: dict, now: datetime, out: dict, settled: str, told: str,
           note: str = "Cleared: Home Assistant reports it is back to normal.") -> None:
    """An incident that is over: closed with its task and its Kiosk fault (`note`: what the fault says), its messages in
    every chat lose their buttons and say `settled`; the facility manager, when still chased, is told `told`."""
    out["actions"] += Problems(store).close_incident(inc["id"], Incident.RESOLVED, now.isoformat(), note)
    # its alert and reminders, in every chat, lose their buttons: nobody presses for something already over
    out.setdefault("settle", []).append(R.settle(inc["id"], settled))
    if inc["state"] in Incident.CHASED:
        out["send"].append(R.message("fm", **about(inc, told), incident=inc["id"], stage="update"))


def rule_states(inc: dict) -> tuple[list[str], set[str]] | None:
    """(entities, bad states) when the incident's rule said what is bad: a watchdog, a condition in "state" mode;
    None for any other (a number, an alert sent before the rules carried bad_states)."""
    p = json.loads(inc.get("payload") or "{}")
    ents = [e for e in (p.get("entities") or [inc["entity_id"]]) if e]
    if p.get("blueprint") == "critical_watchdog":
        bad = p.get("bad_states") or ([p["state"]] if p.get("state") else [])
    elif p.get("blueprint") == "critical_condition" and p.get("mode") == "state":
        bad = p.get("bad_states") or []
    else:
        return None
    return (ents, set(bad)) if ents and bad else None


def watched_for(inc: dict) -> tuple[list[str], set[str]] | None:
    """(entities, bad states) of an OPEN incident whose end the desk reads itself (SEEN_AGAIN): a watchdog's, or a
    condition's once its rule stopped watching (until then Home Assistant says it itself)."""
    p = json.loads(inc.get("payload") or "{}")
    if p.get("blueprint") == "critical_condition" and not p.get("abandoned"):
        return None
    return rule_states(inc)


def quiet_after_done(store: Store, now: datetime, client, clear_minutes: float, out: dict) -> list[int]:
    """Every incident answered Done `clear_minutes` ago or more and not yet checked, read again once: a watched entity
    still in one of its rule's bad states reopens it — "Done by …, but … still reads …" — under its own number, the
    ladder started again. Returns the ids reopened."""
    reopened = []
    for inc in store.incidents(open_only=False):
        if '"check_quiet"' not in (inc.get("payload") or ""):
            continue                                                       # most are not waiting for it: not read
        p = json.loads(inc.get("payload") or "{}")
        if not (inc.get("closed_at") and p.get("check_quiet")) or \
                now - datetime.fromisoformat(inc["closed_at"]) < timedelta(minutes=clear_minutes):
            continue
        rs = rule_states(inc)
        try:
            states = client.states(rs[0]) if rs else {}
        except Exception:  # noqa: BLE001 — Home Assistant not readable now: the next tick
            return reopened
        who = p.pop("check_quiet")
        store.update_incident(inc["id"], payload=json.dumps(p))           # checked once, whatever it reads
        still = [f"{(states[e].get('attributes') or {}).get('friendly_name') or e} still reads {states[e]['state']}"
                 for e in (rs[0] if rs else []) if (states.get(e) or {}).get("state") in rs[1]]
        if not still:
            continue
        route = route_for(inc["rule_id"], p.get("blueprint"))
        ev = {**p, "rule_id": inc["rule_id"], "entity_id": inc["entity_id"], "message": p.get("message") or inc["rule_id"]}
        store.update_incident(inc["id"], closed_at=None, reply=None)
        _ladder(store, inc["id"], ev, now, inc["severity"], route, out)
        inc = store.incident(inc["id"])
        status = f"Done by {who}, but {'; '.join(still)}: still open."
        for role in recipients(inc["severity"]):
            ladder = bool(route.get("ladder", True) and role == "fm")
            out["send"].append(R.message(role, **about(inc, status), incident=inc["id"], buttons=ladder, stage="reminder"))
        store.audit("alert-desk", "not_quiet", {"incident": inc["id"], "still": still})
        reopened.append(inc["id"])
    return reopened


def seen_again(store: Store, now: datetime, client, clear_minutes: float, out: dict) -> list[int]:
    """Every open incident Home Assistant will never say is over (watched_for), read again: one with NO watched entity
    in any of its rule's bad states — each readable, and out of them `clear_minutes` — is closed (`_close`). Returns
    their ids."""
    closed = []
    for inc in store.incidents(open_only=True):
        watched = watched_for(inc)
        if not watched:
            continue
        ents, bad = watched
        try:
            now_states = client.states(ents)
        except Exception:  # noqa: BLE001 — Home Assistant not readable now: the next tick
            return closed
        # ⚠️ NO STRICTER THAN THE RULE (architecture review 23): a rule that does not list "unavailable" treats a dead lock
        # as fine — one lock of three offline for days kept the incident open for good
        if not all(out_of(now_states.get(e) or {}, bad, now, clear_minutes, offline_ok="unavailable" not in bad) for e in ents):
            continue
        said = "; ".join(f"{(now_states[e].get('attributes') or {}).get('friendly_name') or e} is {now_states[e]['state']}"
                         for e in ents)
        _close(store, inc, now, out, f"Cleared on {{time}}: {said}.", f"Closed on {{time}}: {said}. No reply needed.",
               note="Cleared: back to normal, read again by the VESTA Agent.")
        store.audit("alert-desk", "seen_again", {"incident": inc["id"], "now": said})
        closed.append(inc["id"])
    return closed


def abandoned(store: Store, ev: dict, now: datetime) -> dict:
    """The rule stopped watching. Still true: the owner hears it, and the desk reads it again from now on (seen_again).
    Back to normal just as it gave up (its `still_true` false): the incident is over.

    ⚠️ "STOPPED WATCHING" IS NOT "STILL NOT CLEAR" (architecture review 22): the rule's own message said "cleared just
    inside the limit — back to normal now", and the desk told the owner "Still not clear" with Done / Need help."""
    out = {"send": [], "actions": [], "incident_id": None, "decision": "abandoned_unknown"}
    inc = _find_by_ha_incident(store, ev.get("ha_incident")) or store.find_open_incident(f"{ev['rule_id']}|{ev.get('entity_id', '')}")
    if not inc:
        return out
    out["incident_id"] = inc["id"]
    if str(ev.get("still_true")).lower() == "false":
        cleared = "Cleared on {time}: back to normal when Home Assistant stopped watching."
        _close(store, inc, now, out, cleared, "Closed on {time}: back to normal. No reply needed.")
        out["decision"] = "abandoned_cleared"
        # ⚠️ ITS OWN MESSAGE SAYS THE SAME END (architecture review 23): taken over with the rule's "🔶 no longer
        # tracked" as its status, Home Assistant's "✅ cleared just inside the limit" became an orange warning
        out["ha_messages"] = [R.ha_message(inc["id"], context=ev.get("_context_id"), **about(inc, cleared))]
        return out
    p = json.loads(inc.get("payload") or "{}")
    p.update({"abandoned": True, **{k: ev[k] for k in ("mode", "bad_states") if ev.get(k) is not None}})
    store.update_incident(inc["id"], payload=json.dumps(p))
    store.update_incident(inc["id"], state=Incident.ESCALATED, escalated_at=now.isoformat(), assignee="owner")
    out["decision"] = "abandoned"
    said = about(inc, "Still not clear, and the rule has stopped watching it", extra=ev["message"])
    out["ha_messages"] = [R.ha_message(inc["id"], context=ev.get("_context_id"), stage="escalated", **said)]
    out["send"].append(R.message("owner", **said, incident=inc["id"], buttons=True, stage="escalated"))
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
    return R.siren(armed, prompt, ("owner", "fm"), signals=sorted(signals), villa_mode=mode,
                   reason=None if armed else ("villa not vacant/away" if mode not in cfg["requires_villa_mode"] else "single signal"))


def reply(store: Store, iid: int, text: str, sender_role: str, now: datetime, params: VillaParams | None = None) -> dict:
    inc = store.incident(iid)
    out = {"send": [], "actions": []}
    if not inc:
        out["send"].append(R.message("here", f"There is no {incident_tag(iid)}.")); return out
    t = text.strip().lower()
    who = {"owner": "the owner", "fm": "the facility manager"}.get(sender_role, sender_role)

    def here(status: str) -> dict:
        """The answer in the chat it came from: it replaces the incident's message there, so it says it all."""
        return R.message("here", **about(inc, status), incident=iid, stage="update")
    if inc.get("closed_at"):
        out["send"].append(here("Already closed")); return out
    if t.startswith("done"):
        out["actions"] += Problems(store).close_incident(iid, Incident.DONE, now.isoformat(),
                                                         f"Done, answered by the {sender_role}.", reply=text)
        # ⚠️ A PROMISE THE CODE KEEPS (architecture review 23): "will check it stays quiet" was written since 0.9.0 and
        # nothing ever checked — a Done on a door still unlocked closed it for good. The tick reads it again (quiet_after_done)
        checks = rule_states(inc) is not None
        if checks:
            store.update_incident(iid, payload=json.dumps({**json.loads(inc.get("payload") or "{}"), "check_quiet": who}))
        out["send"].append(here(f"Closed: done, answered by {who} on {{time}}."
                                + (" The VESTA Agent will check it stays quiet." if checks else "")))
    elif t.startswith("need help"):
        store.update_incident(iid, state=Incident.ESCALATED, reply=text, escalated_at=now.isoformat(), assignee="owner")
        out["send"].append(R.message("owner", **about(inc, f"{who.capitalize()} needs help"), incident=iid, buttons=True,
                                     stage="escalated"))
        out["send"].append(here(f"Need help, answered by {who} on {{time}}: the owner has been told"))
    else:
        store.update_incident(iid, reply=text)
        out["send"].append(here(f"Noted from {who} on {{time}}: {text}"))
    # the answer, on the alert and its reminders in every chat (a button press has already done it, by name)
    said = next((w for w in LADDER_OPTIONS if t.startswith(w.lower())), None)
    if said:
        out["settle"] = [R.settle(iid, f"{said} answered by {who} on {{time}}")]
    store.audit("alert-desk", "reply", {"incident": iid, "by": sender_role, "text": text})
    return out


def tick(store: Store, now: datetime, params: VillaParams | None = None, client=None) -> dict:
    """Every 5 minutes: what Home Assistant will never say is over (`client`: its states, read again), chase ladder,
    villa-silent watch, alert fatigue."""
    params = _params(params)                       # no parameters given: the desk's own timings, never a copy here
    reask = params.behaviour("reask_minutes")
    escal = params.behaviour("escalate_minutes")
    silent_min = params.behaviour("villa_silent_minutes")
    out = {"send": [], "actions": [], "escalated": [], "reasked": []}
    if client is not None:
        out["cleared"] = seen_again(store, now, client, params.behaviour("clear_minutes"), out)
        out["not_quiet"] = quiet_after_done(store, now, client, params.behaviour("clear_minutes"), out)
    for inc in store.incidents(open_only=True):
        if inc["state"] not in (Incident.ASKED, Incident.REASKED):
            continue
        asked = datetime.fromisoformat(inc["asked_at"])
        age = now - asked
        if inc["state"] == Incident.ASKED and age >= timedelta(minutes=reask):
            store.update_incident(inc["id"], state=Incident.REASKED, reasked_at=now.isoformat())
            out["send"].append(R.message("fm", **about(inc, f"Reminder: no answer after {int(reask)} min"), stage="reminder",
                                         incident=inc["id"], buttons=True))
            out["reasked"].append(inc["id"])
        elif inc["state"] == Incident.REASKED and age >= timedelta(minutes=escal):
            store.update_incident(inc["id"], state=Incident.ESCALATED, escalated_at=now.isoformat(), assignee="owner")
            out["send"].append(R.message("owner", **about(inc, f"No answer from the facility manager after {int(escal)} min"), stage="escalated",
                                         incident=inc["id"], buttons=True))
            out["escalated"].append(inc["id"])
    # villa silent: the engine's Home Assistant connection has been down too long
    last = store.last_beat(HA_BEAT)
    if last and now - datetime.fromisoformat(last) > timedelta(minutes=silent_min):
        key = "critical_internet---villa_silent|agent"
        if not store.find_open_incident(key):
            iid = store.new_incident(key, "critical_internet---villa_silent", "agent", "P1",
                                     {"message": f"No contact with the villa's Home Assistant for {int((now - datetime.fromisoformat(last)).total_seconds() // 60)} min: internet, power or Home Assistant is down."},
                                     now.isoformat())
            store.update_incident(iid, state=Incident.ASKED, asked_at=now.isoformat(), assignee="fm")
            for role in recipients("P1"):
                out["send"].append(R.message(role, "No contact with Home Assistant. Check power, the router and the internet link.",
                                             status=f"[P1] Villa silent since {last[:16]} UTC", incident=iid, stage="new"))
    elif last:
        cur = store.find_open_incident("critical_internet---villa_silent|agent")
        if cur:
            out["actions"] += Problems(store).close_incident(cur["id"], Incident.RECOVERED, now.isoformat())
            out["send"].append(R.message("fm", **about(cur, "Closed on {time}: the villa is back online, Home Assistant answers again"), stage="update",
                                         incident=cur["id"]))
    # alert fatigue: a rule firing more than N times in 30 days without acknowledgement
    limit = params.behaviour("alert_fatigue_per_month")
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
    script.arguments(ap)                           # --store --zone --fixture-dir --now: one set-up for every script
    ap.add_argument("--event"); ap.add_argument("--incident", type=int); ap.add_argument("--text"); ap.add_argument("--from", dest="sender", default="fm")
    a = ap.parse_args(argv)
    ctx = script.Context(a, skill=SKILL, settings_file="rules.yaml")
    store = ctx.store
    now = now_utc(a.now)
    # the villa's own parameters (its maintenance mode, its timings): Home Assistant's live helpers kept ten
    # minutes (params.live_params) — a test gives its fixture folder, never a flag of its own
    params = ctx.params
    if a.cmd == "intake":
        ev = json.load(open(a.event)) if a.event else json.load(sys.stdin)
        res = intake(store, ev, now, params, lambda: villa_mode(ctx.client), zone=ctx.zone)
    elif a.cmd == "tick":
        res = tick(store, now, params, ctx.live_client)
    elif a.cmd == "reply":
        res = reply(store, a.incident, a.text or "", a.sender, now, params)
    else:
        res = {"open": store.incidents(), "beats": {n: store.last_beat(n) for n in (HA_BEAT, "agent_tick", "maintenance_nightly")}}
    print(json.dumps(res, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
