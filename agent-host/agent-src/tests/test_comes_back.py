"""What comes back is one problem, everywhere (architecture review 24, 2026-10-11), and a message says what it is.

Reopening an alert (0.12.147) changed the Telegram message only: the siren still judged it by its first opening, the
Cockpit renamed its fault without "again" and got a new fault at each return, the digest and the reports counted one
alert for 145 drops, and a closing message was headed "New". Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import importlib.util
import os
from datetime import datetime, timedelta, timezone

from villa_timeline import TimelineVilla
from helpers import STARTER_SKILLS, make_agent
from kiosk_fake import FakeKiosk
from vesta_shared.problems import Problems
from vesta_shared.store import Store
from vesta_agent.roster import Roster

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
            "occupancy": "empty", **extra}


# ---------------------------------------------------------------------- the heading says what the message is
# ---------------------------------------------------------------------- one problem, one fault, one name
def _flapping(store, times, rule="automation.ap", entity="sensor.ap"):
    iid = None
    for k in range(times):
        at = T0 + timedelta(hours=k)
        res = desk.intake(store, ev(rule, entity, k * 60, blueprint="critical_watchdog", state="disconnected",
                                    bad_states=["disconnected"]), at)
        iid = res["incident_id"]
        desk.reply(store, iid, "done", "fm", at + timedelta(minutes=5))
    return iid, res


def test_an_alert_back_again_reopens_its_own_fault_titled_with_how_often(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid, last = _flapping(store, 4)
    assert len(store.tasks(None)) == 1                                             # never a new task for it
    assert last["actions"] == [{"action": "faults_changed"}]                       # what it says: the task's (card)
    (task,) = store.tasks(None)                                                    # the first one, open again each time
    assert task["reopened_at"] and task["summary"].endswith("(4th time in 7 days)"), task   # Done since
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
    assert row["title"].endswith("(3rd time in 7 days)")
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
    assert [p["title"] for p in store.proposals()] == ["Retune 'Noisy': it fires too often"]       # unread: from its id


def test_a_reopened_task_whose_old_resolution_is_seen_reopens_its_fault_and_a_lost_resolve_is_redone(tmp_path):
    k = FakeKiosk()
    v = make_agent(tmp_path, {}, roster=Roster.of(fm=[(FM, "JM")]), kiosk=k)
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    iid = st.new_incident("k", "automation.ap", "sensor.ap", "P2", {"message": "AP down"})
    tid, _ = pb.open_task("incident", iid, "automation.ap", "sensor.ap", "AP down")
    st.set_task_uid(tid, "t-old")
    k.held("t-old", "t-lost")
    k.person_closes("t-old", by="Facility manager", at="2026-10-01T08:00:00.000Z")
    pb.close(tid, "done")
    pb.reopen_task("incident", iid, "automation.ap", "sensor.ap", "AP down (2nd time in 7 days)")
    # a closed task whose fault's resolve never reached the Kiosk
    gid = st.new_incident("g", "automation.gate", "lock.gate", "P2", {"message": "Gate open"})
    lost, _ = pb.open_task("incident", gid, "automation.gate", "lock.gate", "Gate open")
    st.set_task_uid(lost, "t-lost")
    pb.close_incident(gid, "resolved", st.now())       # its actions never carried out: the Kiosk's resolve is lost
    run(v.tickets.repair())
    # reopened under what is wrong now, as every card says it (Problems.card): the alert's own words
    assert st.task(tid)["status"] == "open" and k.reopened == [("t-old", pb.current_title(st.task(tid)))]
    assert "t-lost" in k.resolved


# ---------------------------------------------------------------------- Done, wherever it is given
def test_a_door_closed_in_the_kiosk_is_read_again_as_a_done_is(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    res = desk.intake(store, {"blueprint": "critical_condition", "rule_id": "automation.door", "incident_id": "automation.door-1",
                              "phase": "opened", "severity": "critical", "label": "Door", "entities": ["lock.door"],
                              "summary": "Door unlocked", "mode": "state", "bad_states": ["unlocked"]}, T0,
                      occupancy_reader=lambda: "x")
    iid = res["incident_id"]
    (task,) = store.tasks("open")
    Problems(store).closed_in_kiosk(task["id"])

    villa = TimelineVilla(names={"lock.door": "Door"}, **{"lock.door": ("unlocked", T0)})
    out = desk.tick(store, datetime.now(timezone.utc) + timedelta(minutes=11), client=villa)
    assert out["not_quiet"] == [iid]
    (fm,) = [s for s in out["send"] if s["to"] == "fm"]
    assert fm["status"] == "Done in the Cockpit, but Door still reads unlocked: still open. VESTA keeps watching it."


# ---------------------------------------------------------------------- what to do: one owner, the rule's words now
def test_the_check_follows_the_rules_words_on_telegram_the_digest_and_the_kiosk(tmp_path, monkeypatch):
    # architecture review, 2026-10-19: Telegram read the route's check live, the Kiosk fault's note froze it at its
    # making, the digest's "Still open" line read a key nobody wrote — three answers to "what to do"
    k = FakeKiosk()
    v = make_agent(tmp_path, {}, roster=Roster.of(fm=[(FM, "JM")]), kiosk=k)
    store = Store(v.s.store_path)
    route = next(r for r in desk.RULES["routes"] if r.get("blueprint") == "critical_watchdog")
    monkeypatch.setitem(route, "check", "Power and network of the device named.")
    first = desk.intake(store, ev("automation.ap", "sensor.ap", 0, blueprint="critical_watchdog", state="disconnected",
                                  bad_states=["disconnected"]), T0)
    iid = first["incident_id"]
    assert first["send"][0]["text"].endswith("\nWhat to do: Power and network of the device named.")
    run(v.tickets.repair())
    assert k.notes == ["What to do: Power and network of the device named."]
    # the route's words edited while the alert is open (a villa's own rules.yaml, kept by updates)
    monkeypatch.setitem(route, "check", "Look at the switch in the rack first.")
    again = desk.intake(store, ev("automation.ap", "sensor.ap", 300, blueprint="critical_watchdog", state="disconnected",
                                  bad_states=["disconnected"]), T0 + timedelta(hours=5))      # a repeat, past the cooldown
    assert again["decision"] == "repeat" and again["incident_id"] == iid
    assert again["send"][0]["text"].endswith("\nWhat to do: Look at the switch in the rack first.")
    (still,) = Problems(store).open_problems()
    assert still["check"] == "Look at the switch in the rack first."                      # the digest's line
    run(v.tickets.repair())
    assert k.notes == ["What to do: Look at the switch in the rack first."]              # the fault's note
    # edited again, with no alert in between: a tick carries it (the words have ONE owner, the route)
    monkeypatch.setitem(route, "check", "Call the network contractor.")
    desk.tick(store, T0 + timedelta(hours=5, minutes=5))
    assert Problems(store).open_problems()[0]["check"] == "Call the network contractor."
    run(v.tickets.repair())
    assert k.notes == ["What to do: Call the network contractor."]


def test_lowered_then_raised_reopens_the_one_fault_in_the_kiosk(tmp_path):
    # architecture review, 2026-10-19: an alert lowered to P3 (its task closed "Lowered to P3.") and raised back got a
    # second task and a second Cockpit fault for the same number — and the double check skips a fault a task holds
    k = FakeKiosk()
    v = make_agent(tmp_path, {}, roster=Roster.of(fm=[(FM, "JM")]), kiosk=k)
    store = Store(v.s.store_path)
    e = dict(blueprint="critical_watchdog", state="disconnected", bad_states=["disconnected"])
    iid = desk.intake(store, ev("automation.ap", "sensor.ap", 0, **e), T0)["incident_id"]
    run(v.tickets.repair())
    desk.intake(store, ev("automation.ap", "sensor.ap", 5, priority="P3", **e), T0 + timedelta(minutes=5))
    run(v.tickets.repair())
    assert k.resolved == ["t1"] and store.incident(iid)["state"] == "digest"
    res = desk.intake(store, ev("automation.ap", "sensor.ap", 70, priority="P2", **e), T0 + timedelta(minutes=70))
    run(v.tickets.repair())
    assert len(store.tasks(None)) == 1 and store.tasks(None)[0]["reopen_note"] == "Raised to P2."
    assert res["actions"] == [{"action": "faults_changed"}]
    assert len(k.tickets) == 1 and k.reopened == [("t1", "Motion at sensor.ap")]       # the same fault, open again
    assert k.ticket("t1")["updates"][-1]["note"] == "Raised to P2."
