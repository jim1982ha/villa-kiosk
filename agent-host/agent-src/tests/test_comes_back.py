"""What comes back is one problem, everywhere (architecture review 24, 2026-10-11), and a message says what it is.

Reopening an alert (0.12.147) changed the Telegram message only: the siren still judged it by its first opening, the
Cockpit renamed its fault without "again" and got a new fault at each return, the digest and the reports counted one
alert for 145 drops, and a closing message was headed "New". Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
from datetime import datetime, timedelta, timezone

from helpers import STARTER_SKILLS, make_agent
from kiosk_fake import FakeKiosk
from vesta_shared.problems import Problems
from vesta_shared.store import Store

spec = importlib.util.spec_from_file_location("desk24", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

T0 = datetime(2026, 10, 1, 20, 0, tzinfo=timezone.utc)
FM, GROUP = 222, -100333


def run(c):
    return asyncio.run(c)


def ev(rule, entity, minutes, phase="opened", blueprint="critical_presence_guard", **extra):
    return {"blueprint": blueprint, "rule_id": rule, "incident_id": f"{rule}-{minutes}", "phase": phase,
            "severity": "critical", "label": "Motion", "entities": [entity], "summary": f"Motion at {entity}",
            "villa_mode": "vacant", **extra}


# ---------------------------------------------------------------------- the heading says what the message is
def test_a_closing_message_is_headed_closed_never_new(tmp_path):
    # owner, 2026-10-11: "For: JM, P2 Incident: New #9 … Closed on …" — "is it a closure or not?"
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]})
    n = v.notices
    assert "Incident: New #9" in n.heading(FM, 9, "fm", "new")
    assert "Incident: Closed #9" in n.heading(FM, 9, "fm", "closed")              # no history: still "Closed"
    assert "Incident: Follow Up #9" in n.heading(FM, 9, "fm", "back")
    assert "Incident: New #9" in n.heading(FM, 9, "fm")                           # no stage: by its history, as before
    run(v.outcome.carry_out({"send": [{"to": "fm", "text": "Relay offline", "incident_id": 9, "stage": "closed",
                                       "status": "Closed on {time}: back."}]}))
    assert v.tg.sent[-1][1].startswith("For: JM, Incident: Closed #9")


# ---------------------------------------------------------------------- the siren
def test_a_second_intrusion_counts_each_sensor_when_it_tripped(tmp_path):
    # review 24: the garden alert of 20:00, back at 22:00, counted as 20:00 — two sensors in a minute, no siren
    store = Store(str(tmp_path / "s.sqlite"))
    garden = desk.intake(store, ev("automation.garden", "binary_sensor.garden", 0), T0)["incident_id"]
    desk.intake(store, ev("automation.garden", "binary_sensor.garden", 5, phase="resolved"), T0 + timedelta(minutes=5))
    back = desk.intake(store, ev("automation.garden", "binary_sensor.garden", 120), T0 + timedelta(minutes=120))
    assert back["decision"] == "reopened" and back["incident_id"] == garden
    gate = desk.intake(store, ev("automation.gate", "binary_sensor.gate", 121), T0 + timedelta(minutes=121))
    assert gate["siren_gate"]["armed"] and gate["siren_gate"]["signals"] == ["binary_sensor.gate", "binary_sensor.garden"][::-1]


# ---------------------------------------------------------------------- one problem, one fault, one name
def _flapping(store, times, rule="automation.ap", entity="sensor.ap"):
    iid = None
    for k in range(times):
        at = T0 + timedelta(hours=k)
        res = desk.intake(store, ev(rule, entity, k * 60, blueprint="critical_watchdog", state="disconnected",
                                    bad_states=["disconnected"]), at)
        iid = res["incident_id"]
        desk.reply(store, iid, "Done", "fm", at + timedelta(minutes=5))
    return iid, res


def test_an_alert_back_again_reopens_its_own_fault_titled_with_how_often(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid, last = _flapping(store, 4)
    assert len(store.tasks(None)) == 1                                             # never a new task for it
    (back,) = [a for a in last["actions"] if a["action"].startswith("ticket")]
    assert back["action"] == "ticket.reopen" and back["title"].endswith("(again: 4 times in 7 days)")
    assert back["task_id"] == store.tasks(None)[0]["id"]                          # the first one, open again each time
    # its Telegram messages are "back", their history line says so
    assert {s["stage"] for s in last["send"]} == {"back"}


def test_every_run_of_an_alert_is_counted_by_the_digest_the_reports_and_the_retune(tmp_path):
    # review 24: 145 drops read as one alert opened on the 1st — 0 in the week, never "again", never "too often"
    store = Store(str(tmp_path / "s.sqlite"))
    iid, _ = _flapping(store, 3)
    store.update_incident(iid, closed_at=None)                                     # still open now
    runs = [o for o in store.incident_occurrences() if o["id"] == iid]
    assert [o["opened_at"][:13] for o in runs] == [(T0 + timedelta(hours=k)).isoformat()[:13] for k in range(3)]
    assert store.count_incidents("automation.ap", T0.isoformat()) == 3
    (row,) = [p for p in Problems(store).open_problems() if p["incident"] == iid]
    assert row["title"].endswith("(again: 3 times in 7 days)")
    assert row["since"] == (T0 + timedelta(hours=2)).isoformat()[:10]
    # its latest run is when it opened: reopened two days on, it is news that day, never "still open since the 1st"
    store.update_incident(iid, closed_at=(T0 + timedelta(days=1)).isoformat())
    store.reopen_incident(iid, (T0 + timedelta(days=2)).isoformat())
    (row,) = [p for p in Problems(store).open_problems() if p["incident"] == iid]
    assert row["since"] == (T0 + timedelta(days=2)).isoformat()[:10]


def test_the_retune_proposal_is_one_per_rule(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    for k in range(25):
        store.new_incident(f"k{k}", "automation.noisy", f"sensor.x{k}", "P3", {}, at=(T0 + timedelta(hours=k)).isoformat())
        desk.tick(store, T0 + timedelta(hours=k, minutes=1))
    assert len([p for p in store.proposals() if "automation.noisy" in p["title"]]) == 1


def test_the_kiosk_fault_keeps_again_in_its_name(tmp_path):
    # review 24: the repair renamed "(again: 2 times in 7 days)" to the bare summary seconds later
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)
    rules = dict(state_rules={"PM-UNAVAILABLE"}, event_rules=set(), worsened_step=15)

    class F:
        def __init__(self):
            self.rule_id, self.entity_id, self.family, self.severity, self.summary = "PM-UNAVAILABLE", "switch.relay", "x", "P2", "Relay offline"
            self.detail, self.check, self.day = {}, "", ""

        def as_dict(self):
            return {k: getattr(self, k) for k in ("rule_id", "entity_id", "family", "severity", "summary", "detail", "check", "day")}
    first = pb.record_night([F()], "2026-10-07", **rules)
    pb.close_finding(store.finding(first["new"][0]["id"]), "2026-10-08", "back")
    night = pb.record_night([F()], "2026-10-09", **rules)
    (back,) = night["reopen_actions"]
    assert pb.current_title(store.task(back["task_id"])) == "Relay offline (again: 2 times in 7 days)"


def test_a_reopened_task_whose_old_resolution_is_seen_reopens_its_fault_and_a_lost_resolve_is_redone(tmp_path):
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    iid = st.new_incident("k", "automation.ap", "sensor.ap", "P2", {"message": "AP down"})
    tid, _ = pb.open_task("incident", iid, "automation.ap", "sensor.ap", "AP down")
    st.set_task_uid(tid, "t-old")
    k.known = ["t-old", "t-lost"]
    k.closed_by_hand = {"t-old"}
    k.closed_meta["t-old"] = {"resolved_at": "2026-10-01T08:00:00.000Z", "by": "Facility manager"}
    pb.close(tid, "done")
    pb.reopen_task("incident", iid, "automation.ap", "sensor.ap", "AP down (again: 2 times in 7 days)")
    # a closed task whose fault's resolve never reached the Kiosk
    gid = st.new_incident("g", "automation.gate", "lock.gate", "P2", {"message": "Gate open"})
    lost, _ = pb.open_task("incident", gid, "automation.gate", "lock.gate", "Gate open")
    st.set_task_uid(lost, "t-lost")
    pb.close(lost, "cleared")
    run(v.tickets.repair())
    assert st.task(tid)["status"] == "open" and k.reopened == [("t-old", "AP down (again: 2 times in 7 days)")]
    assert "t-lost" in k.resolved


# ---------------------------------------------------------------------- Done, wherever it is given
def test_a_door_closed_in_the_kiosk_is_read_again_as_a_done_is(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    res = desk.intake(store, {"blueprint": "critical_condition", "rule_id": "automation.door", "incident_id": "automation.door-1",
                              "phase": "opened", "severity": "critical", "label": "Door", "entities": ["lock.door"],
                              "summary": "Door unlocked", "mode": "state", "bad_states": ["unlocked"]}, T0,
                      mode_reader=lambda: "x")
    iid = res["incident_id"]
    (task,) = store.tasks("open")
    Problems(store).closed_in_kiosk(task["id"])

    class Villa:
        def states(self, ids):
            return {e: {"state": "unlocked", "last_changed": T0.isoformat(), "attributes": {"friendly_name": "Door"}} for e in ids}
    out = desk.tick(store, datetime.now(timezone.utc) + timedelta(minutes=11), client=Villa())
    assert out["not_quiet"] == [iid]
    (fm,) = [s for s in out["send"] if s["to"] == "fm"]
    assert fm["status"] == "Closed in the Kiosk, but Door still reads unlocked: still open."


def test_an_alert_back_again_says_home_assistants_latest_words_and_brings_its_picture(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    desk.intake(store, ev("automation.garden", "binary_sensor.garden", 0), T0)
    desk.intake(store, ev("automation.garden", "binary_sensor.garden", 5, phase="resolved"), T0 + timedelta(minutes=5))
    back = desk.intake(store, {**ev("automation.garden", "binary_sensor.garden", 60), "summary": "Motion again at the pool",
                               "snapshot": "camera.garden"}, T0 + timedelta(minutes=60))
    assert all(s["text"].startswith("Motion again at the pool") for s in back["send"])
    assert [a for a in back["actions"] if a["action"] == "snapshot.get"]


def test_no_test_store_ships_inside_the_app():
    # review 24: a probe's d1.sqlite was committed and copied into the app's image (COPY agent-src)
    import subprocess
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["git", "ls-files", "--", "."], cwd=here, capture_output=True, text=True)
    if r.returncode:                                   # not a git checkout (an image): nothing to look at
        return
    assert [f for f in r.stdout.split() if f.endswith((".sqlite", ".db")) or ".sqlite-" in f] == []
