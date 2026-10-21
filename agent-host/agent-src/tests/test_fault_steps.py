"""A fault's step says what it is (architecture review 26, 2026-10-11).

The villa, that week: the Kiosk recognised the agent's title changes by their first words ("Now: …") and took them for
status steps — "in progress since 03:00 by VESTA Agent" replaced the facility manager's own time and name; the agent
wrote its title back over one a person had written, every night; a fault picked up after a close that did not land was
taken for a person reopening it; a night check's fault reopened in the Kiosk told nobody; and an offline lock after
Done counted as fixed. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
from datetime import datetime, timedelta, timezone

from villa_timeline import TimelineVilla
from helpers import STARTER_SKILLS, make_agent
from kiosk_fake import FakeKiosk
from vesta_agent.kiosk import Kiosk, retitled, tagged
from vesta_shared.problems import Problems
from vesta_shared.store import Store

spec = importlib.util.spec_from_file_location("desk26", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

CONTRACT = os.path.join(os.path.dirname(__file__), "..", "..", "rootfs", "opt", "vesta", "host", "agent-contract.json")
FM = 222


def run(c):
    return asyncio.run(c)


def kiosk_holding(*tickets) -> tuple[Kiosk, dict]:
    """The real Kiosk over an in-memory Facility document (kiosk_fake.FakeKiosk), and that document."""
    k = FakeKiosk(*tickets)
    return k, k.doc


def ticket(doc, tid="va-1") -> dict:
    return next(t for t in doc["data"]["tickets"] if t["id"] == tid)


# ---------------------------------------------------------------------- 1 · each step says what it is
def test_a_title_change_is_a_retitled_step_keeping_the_title_before_and_never_a_note():
    k, doc = kiosk_holding()
    tid = run(k.add_ticket("Motion battery at 9%"))
    assert ticket(doc, tid)["updates"][0]["title"] == "Motion battery at 9%"        # the title the agent gave it
    assert run(k.amend(tid, retitled("Motion battery at 7%")))
    t = ticket(doc, tid)
    step = t["updates"][-1]
    assert t["title"] == "Motion battery at 7%"
    assert step["kind"] == "retitled" and step["was"] == "Motion battery at 9%" and step["title"] == "Motion battery at 7%"
    assert "note" not in step                                                         # no "Now: …" for the card to guess at
    assert not run(k.amend(tid, retitled("Motion battery at 7%")))                     # already says it: nothing written


def test_the_agent_reads_its_step_kinds_from_the_agreement():
    # architecture review round 3, 2026-10-19: the five kinds were typed in kiosk.py and pinned to the file after the
    # fact; now kiosk.KINDS IS the file's list, and every kind the engine writes is one of them
    from vesta_agent import kiosk
    kinds = json.load(open(CONTRACT))["ticketUpdate"]["kinds"]
    assert list(kiosk.KINDS) == kinds
    assert {kiosk.REOPENED, kiosk.RETITLED, kiosk.READING, kiosk.NOTED, kiosk.CLEARED} <= set(kiosk.KINDS)


def test_a_reopening_in_the_kiosk_is_read_from_its_step_and_an_old_now_note_still_names_the_agents_title():
    k, _ = kiosk_holding(
        {"id": "va-1", "title": "Door", "status": "open", "updates": [
            {"at": "2026-10-10T09:00:00Z", "status": "resolved", "by": "Facility manager", "photoIds": []},
            {"at": "2026-10-10T10:00:00Z", "status": "open", "by": "Owner", "kind": "reopened", "photoIds": []},
            {"at": "2026-10-10T11:00:00Z", "status": "in_progress", "by": "Facility manager", "photoIds": []}]},
        {"id": "va-2", "title": "Pump at 2 %", "status": "in_progress", "updates": [
            {"at": "2026-10-09T09:00:00Z", "status": "in_progress", "note": "Now: Pump at 2 %", "photoIds": []}]})
    held = run(k.held_tickets())
    assert held["va-1"]["reopened_by"] == "Owner" and held["va-1"]["reopened_at"] == "2026-10-10T10:00:00Z"
    assert "reopened_at" not in held["va-2"]                                          # picked up is not reopened
    assert held["va-2"]["agent_title"] == "Pump at 2 %"


# ---------------------------------------------------------------------- 3 · a person's title stays
def test_a_title_a_person_wrote_stays_and_the_agents_reading_goes_under_it():
    k, doc = kiosk_holding()
    tid = run(k.add_ticket("Front door lock unavailable"))
    ticket(doc, tid)["title"] = "Front door lock — part ordered"                     # Fabien renames it in the Kiosk
    assert run(k.amend(tid, retitled("Front door lock offline 3 days")))
    t = ticket(doc, tid)
    assert t["title"] == "Front door lock — part ordered"
    assert t["updates"][-1]["kind"] == "reading" and t["updates"][-1]["title"] == "Front door lock offline 3 days"
    assert not run(k.amend(tid, retitled("Front door lock offline 3 days")))           # the same reading: not again
    # its problem comes back after a close: open again, still under the person's title
    t["status"], t["resolvedAt"] = "resolved", "2026-10-10T09:00:00Z"
    assert run(k.reopen_ticket(tid, "Front door lock unavailable", "Back again."))
    t = ticket(doc, tid)
    assert t["status"] == "open" and t["title"] == "Front door lock — part ordered" and t["updates"][-1]["kind"] == "reopened"


def test_the_nightly_repair_never_writes_its_title_over_a_persons(tmp_path):
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    fid, _ = st.raise_finding("PM-X", "lock.front", "offline", "2026-10-07", "P3", "Front door lock unavailable", {})
    tid, _ = pb.open_task("finding", fid, "PM-X", "lock.front", "Front door lock unavailable")
    run(v.tickets.repair())                                                           # its fault: t1
    k.person_renames("t1", "Front door lock — part ordered")
    st.raise_finding("PM-X", "lock.front", "offline", "2026-10-08", "P3", "Front door lock offline 3 days", {})
    assert pb.current_title(st.task(tid)) == "Front door lock offline 3 days"         # what the night reads now
    run(v.tickets.repair())
    run(v.tickets.repair())
    assert k.titles["t1"] == "Front door lock — part ordered"
    assert k.readings == [("t1", "Front door lock offline 3 days")]                  # under it, once


def test_the_repair_gives_an_open_problem_with_no_fault_its_fault(tmp_path, caplog):
    # villa, 2026-10-14: a sensor open for five days, never in the Cockpit, and nothing anywhere said so (0.12.193 said
    # it in the log; since 0.12.210 the repair makes the fault)
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    st = Store(v.s.store_path)
    st.raise_finding("PM-X", "sensor.example_room", "offline", "2026-10-09", "P3", "Example offline for 39 h", {})
    with caplog.at_level("WARNING", logger="vesta.outcome"):
        run(v.tickets.repair())
    assert k.tickets == [("Example offline for 39 h", "sensor.example_room")]
    assert "have no Kiosk fault" not in caplog.text


# ---------------------------------------------------------------------- 4, 6 · a reopening is read, and someone is told
PM = os.path.join(STARTER_SKILLS, "preventive-maintenance")
sys.path.insert(0, os.path.join(PM, "scripts"))


def _told(st) -> list[dict]:
    """What the preventive-maintenance recheck sends for a person's reopening (its every-5-minutes run)."""
    import recheck
    from vesta_shared import skill_settings
    return recheck.reopened_untold(st, "UTC", skill_settings.load(PM, "settings.yaml"))


def _closed_night_fault(tmp_path, k):
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    fid, _ = st.raise_finding("PM-X", "sensor.pump", "power", "2026-10-07", "P3", "Pump weak", {})
    tid, _ = pb.open_task("finding", fid, "PM-X", "sensor.pump", "Pump weak")
    st.set_task_uid(tid, "t-pump")
    pb.close_finding(st.finding(fid), "2026-10-08", "Cleared")
    k.held("t-pump")
    return v, st, tid


def test_a_night_fault_a_person_reopens_is_told_by_its_skill_once_under_the_cockpits_name(tmp_path):
    # architecture review round 2, 2026-10-19: the engine sent it itself, to "fm" under "Fault reopened in the Kiosk"
    # over a body saying "the Cockpit"; now the repair marks the reopening and the skill's recheck tells it, to the
    # role and under the title of its settings.yaml — the message then goes out through outcome like any other
    k = FakeKiosk()
    v, st, tid = _closed_night_fault(tmp_path, k)
    k.person_reopens("t-pump", by="Owner", at="2099-01-01T07:05:00.000Z")
    run(v.tickets.repair())
    assert st.task(tid)["status"] == "open" and st.task(tid)["reopened_at"] == "2099-01-01T07:05:00.000Z"  # the Kiosk's
    (m,) = _told(st)
    assert m["to"] == "fm" and m["title"] == "Fault reopened in the Cockpit" and "Kiosk" not in m["title"]
    assert m["text"] == "Reopened in the Cockpit on 01/01/2099 07:05 (Owner): Pump weak. Please look again."
    assert _told(st) == []                                                            # once
    run(v.tickets.repair())
    assert _told(st) == []                                                            # a later repair: still once
    run(v.outcome.carry_out({"send": [m]}, "preventive-maintenance"))
    (sent,) = [t for c, t, _ in v.tg.sent if c == FM]
    assert sent.startswith("Fault reopened in the Cockpit\n") and "Please look again." in sent


def test_who_is_told_of_a_reopening_and_the_title_are_the_skills_settings(tmp_path):
    import recheck
    from vesta_shared import skill_settings
    k = FakeKiosk()
    v, st, tid = _closed_night_fault(tmp_path, k)
    k.person_reopens("t-pump", by="Owner")
    run(v.tickets.repair())
    (tmp_path / "settings.yaml").write_text("reopened_in_kiosk:\n  tell: owner\n  title: Reopened fault\n")
    (m,) = recheck.reopened_untold(st, "UTC", skill_settings.load(str(tmp_path), "settings.yaml"))
    assert (m["to"], m["title"]) == ("owner", "Reopened fault")
    # without the settings nothing is sent and the task stays untold: named, never guessed
    k.person_reopens("t-pump", by="Owner", at="2099-01-02T00:00:00.000Z")
    st.close_task(tid); run(v.tickets.repair())
    assert recheck.reopened_untold(st, "UTC", {}) == [] and len(st.untold_reopenings()) == 1


def test_a_fault_picked_up_after_a_close_that_did_not_land_is_closed_again_not_taken_for_a_reopening(tmp_path):
    # the agent's resolve failed (the Kiosk down a moment); Fabien then pressed "Mark in progress": no "Reopen fault"
    # step — the close is retried, nobody is told to look again at a job just taken
    k = FakeKiosk()
    v, st, tid = _closed_night_fault(tmp_path, k)
    k.person_moves("t-pump", by="Facility manager")
    run(v.tickets.repair())
    assert st.task(tid)["status"] != "open" and "t-pump" in k.resolved and _told(st) == []


# ---------------------------------------------------------------------- 2 · a device that does not answer
T0 = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)


def Villa(**now):
    """Home Assistant's states, since a moment nobody knows (villa_timeline)."""
    return TimelineVilla(names={e: "Laundry lock" for e in now}, **now)


def _door_done(store):
    ev = {"blueprint": "critical_condition", "rule_id": "automation.door", "incident_id": "automation.door-1",
          "phase": "opened", "severity": "critical", "label": "Door", "entities": ["lock.door"], "summary": "Door unlocked",
          "mode": "state", "bad_states": ["unlocked"]}
    iid = desk.intake(store, ev, T0, occupancy_reader=lambda: "x")["incident_id"]
    desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=5))
    return iid


def test_a_lock_offline_after_done_is_said_to_be_unchecked_never_taken_for_fixed(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = _door_done(store)
    out = desk.tick(store, T0 + timedelta(minutes=20), client=Villa(**{"lock.door": "unavailable"}))
    (fm,) = [s for s in out["send"] if s["to"] == "fm"]
    assert fm["status"].endswith("Note: VESTA cannot check this one; Laundry lock does not answer.")
    assert store.incident(iid)["closed_at"] and not out["not_quiet"]


def test_a_lock_gone_from_home_assistant_after_done_is_said_to_be_unchecked(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    _door_done(store)
    out = desk.tick(store, T0 + timedelta(minutes=20), client=Villa())
    (fm,) = [s for s in out["send"] if s["to"] == "fm"]
    assert fm["status"].endswith("Note: VESTA cannot check this one; lock.door does not answer.")


def test_a_locked_door_after_done_closes_without_a_word(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    _door_done(store)
    out = desk.tick(store, T0 + timedelta(minutes=20), client=Villa(**{"lock.door": "locked"}))
    assert not [s for s in out["send"] if s["to"] == "fm"] and not out["not_quiet"]


def test_an_old_alert_whose_device_is_gone_after_done_still_says_it_cannot_check(tmp_path):
    # an alert from before the rules said their bad states, its device gone from Home Assistant: it said nothing
    store = Store(str(tmp_path / "s.sqlite"))
    ev = {"blueprint": "critical_condition", "rule_id": "automation.door", "incident_id": "automation.door-1",
          "phase": "opened", "severity": "critical", "label": "Door", "entities": ["lock.door"], "summary": "Door unlocked"}
    iid = desk.intake(store, ev, T0, occupancy_reader=lambda: "x")["incident_id"]
    desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=5))
    out = desk.tick(store, T0 + timedelta(minutes=20), client=Villa())
    (fm,) = [s for s in out["send"] if s["to"] == "fm"]
    assert fm["status"].endswith("Note: VESTA cannot check this one; lock.door does not answer.")


# ---------------------------------------------------------------------- review 29
def test_a_rename_step_from_the_kiosk_is_a_persons_title_and_an_old_ticket_is_presumed_theirs():
    from vesta_agent.kiosk import person_titled
    k, doc = kiosk_holding(
        {"id": "va-1", "title": "Pump at 2 %", "status": "open", "updates": [
            {"at": "2026-10-09T01:00:00Z", "status": "open", "photoIds": []}]},                  # before 0.12.151
        {"id": "va-2", "title": "Pump — part ordered", "status": "open", "updates": [
            {"at": "2026-10-09T01:00:00Z", "status": "open", "by": "VESTA Agent", "title": "Pump at 9 %", "photoIds": []},
            {"at": "2026-10-10T01:00:00Z", "status": "open", "by": "Facility manager", "kind": "retitled",
             "title": "Pump — part ordered", "was": "Pump at 9 %", "photoIds": []}]})
    assert person_titled(ticket(doc, "va-1")) and person_titled(ticket(doc, "va-2"))
    assert run(k.amend("va-1", retitled("Pump at 0 %"))) and run(k.amend("va-2", retitled("Pump at 0 %")))
    assert ticket(doc, "va-1")["title"] == "Pump at 2 %" and ticket(doc, "va-2")["title"] == "Pump — part ordered"
    assert ticket(doc, "va-1")["updates"][-1]["kind"] == "reading"                  # its reading under the title, never over


def test_who_resolved_and_who_reopened_are_the_cards(tmp_path):
    k, doc = kiosk_holding({"id": "va-1", "title": "Door", "status": "resolved", "resolvedAt": "2026-10-10T09:10:00Z",
                            "updates": [{"at": "2026-10-10T09:10:00Z", "status": "resolved", "by": "Facility manager",
                                         "who": "Wayan", "photoIds": []}]})
    assert run(k.held_tickets())["va-1"]["by"] == "Wayan"                          # the name typed, as the card says it
    k2, doc2 = kiosk_holding({"id": "va-2", "title": "Door", "status": "open", "updates": []})
    assert run(k2.resolve_ticket("va-2", note="Done by JM on Telegram.", who="JM"))
    assert ticket(doc2, "va-2")["updates"][-1]["who"] == "JM"                       # never only "by VESTA Agent"


def test_a_reopen_of_a_fault_closed_days_ago_is_heard(tmp_path):
    from datetime import datetime, timedelta, timezone
    k = FakeKiosk()
    v, st, tid = _closed_night_fault(tmp_path, k)
    with st.db:                                                                     # closed five days ago
        st.db.execute("UPDATE tasks SET done_at=? WHERE id=?", ((datetime.now(timezone.utc) - timedelta(days=5)).isoformat(), tid))
    k.person_reopens("t-pump", by="Owner")
    run(v.tickets.repair())
    told = _told(st)
    assert st.task(tid)["status"] == "open" and told and told[0]["text"].startswith("Reopened in the Cockpit on 01/01/2099 00:00 (Owner): ")


def test_a_person_who_renames_a_fault_to_the_agents_own_words_keeps_it():
    # only the rename step tells it apart: the title equals the agent's, yet the person chose it
    from vesta_agent.kiosk import person_titled
    t = {"id": "va-3", "title": "Pump at 9 %", "status": "open", "updates": [
        {"at": "1", "status": "open", "by": "VESTA Agent", "title": "Pump at 9 %", "photoIds": []},
        {"at": "2", "status": "open", "by": "Owner", "kind": "retitled", "title": "Pump at 9 %", "was": "Pump at 9 %",
         "photoIds": []}]}
    assert person_titled(t)


def test_an_old_closed_fault_picked_up_again_is_left_to_the_person(tmp_path):
    # the retry of a close that did not land is for two days; past them, a fault a person moved is theirs
    from datetime import datetime, timedelta, timezone
    k = FakeKiosk()
    v, st, tid = _closed_night_fault(tmp_path, k)
    with st.db:
        st.db.execute("UPDATE tasks SET done_at=? WHERE id=?", ((datetime.now(timezone.utc) - timedelta(days=5)).isoformat(), tid))
    run(v.tickets.repair())
    assert "t-pump" not in k.resolved and st.task(tid)["status"] != "open" and _told(st) == []


def test_a_done_on_telegram_resolves_the_fault_by_the_person(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    ev = {"blueprint": "critical_condition", "rule_id": "automation.d", "incident_id": "automation.d-1", "phase": "opened",
          "severity": "critical", "label": "Door", "entities": ["lock.d"], "summary": "Door unlocked", "mode": "state",
          "bad_states": ["unlocked"]}
    iid = desk.intake(store, ev, T0, occupancy_reader=lambda: "x")["incident_id"]
    out = desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=5), name="Fabien")
    # who closed it travels on the task (Problems.card), never on the action (architecture review, 2026-10-19)
    assert {"action": "faults_changed"} in out["actions"]
    task = store.last_task(f"incident:{iid}")
    assert Problems(store).card(task)["who"] == "Fabien" and task["status"] == "done"


# ---------------------------------------------------------------------- review 31
def test_a_persons_done_records_the_work_and_the_agents_own_clear_is_no_repair():
    k, doc = kiosk_holding({"id": "va-1", "title": "Gate jammed", "status": "open", "updates": []},
                           {"id": "va-2", "title": "AP offline", "status": "open", "updates": []})
    assert run(k.resolve_ticket("va-1", note="Done by Made on Telegram.", who="Made"))
    (c,) = doc["data"]["completions"]
    assert c["ticketId"] == "va-1" and c["who"] == "Made" and c["scheduleId"] == ""      # Recent work names Made
    assert "kind" not in ticket(doc, "va-1")["updates"][-1]
    assert run(k.resolve_ticket("va-2", note="Cleared: the check no longer sees it."))
    assert ticket(doc, "va-2")["updates"][-1]["kind"] == "cleared" and len(doc["data"]["completions"]) == 1


def test_a_reopening_under_a_new_title_says_the_title_it_replaced():
    k, doc = kiosk_holding()
    tid = run(k.add_ticket("Pump plug offline for 9 h"))
    ticket(doc, tid)["status"] = "resolved"
    assert run(k.reopen_ticket(tid, "Pump plug offline again", "Back again."))
    step = ticket(doc, tid)["updates"][-1]
    assert step["kind"] == "reopened" and step["was"] == "Pump plug offline for 9 h"


def test_an_open_problem_whose_fault_the_agent_closed_gets_it_back_and_a_persons_close_stays(tmp_path, caplog):
    # villa, 2026-10-15: Timmerflotte_2623, dead since 9 Oct, had no Open Ticket in the Cockpit — its task had been closed
    # by the agent while the sensor stayed dead, and the repair only warned, every 5 minutes, for a day
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    dead, _ = st.raise_finding("PM-X", "sensor.room_a", "offline", "2026-10-09", "P3", "Room A offline for 6 d", {})
    gone, _ = st.raise_finding("PM-X", "sensor.room_b", "offline", "2026-10-09", "P3", "Room B offline for 6 d", {})
    mine, _ = st.raise_finding("PM-X", "sensor.room_c", "offline", "2026-10-09", "P3", "Room C offline for 6 d", {})
    tids = [pb.open_task("finding", f, "PM-X", e, s)[0] for f, e, s in
            ((dead, "sensor.room_a", "Room A offline"), (gone, "sensor.room_b", "Room B offline"),
             (mine, "sensor.room_c", "Room C offline"))]
    run(v.tickets.repair())                                                            # t1, t2, t3
    for tid in tids[:2]:                                                               # the agent's own close
        pb.close(tid, "cleared", "Cleared: the check no longer sees it.")
        run(k.resolve_ticket(st.task(tid)["todo_uid"], note="Cleared: the check no longer sees it."))
    assert k.ticket("t1")["status"] == k.ticket("t2")["status"] == "resolved"
    k.doc["data"]["tickets"] = [t for t in k._all() if t["id"] != "t2"]               # Room B's fault no longer held
    k.person_closes("t3")                                                              # a person closed Room C's
    with caplog.at_level("WARNING", logger="vesta.outcome"):
        run(v.tickets.repair())
    assert k.ticket("t1")["status"] == "open"                                          # its own fault, open again
    assert st.task(tids[1])["status"] == "open" and st.task(tids[1])["todo_uid"] not in (None, "t2")   # a new one
    assert k.ticket(st.task(tids[1])["todo_uid"])["status"] == "open"
    assert st.task(tids[2])["status"] != "open" and k.ticket("t3")["status"] == "resolved"            # theirs stays
    assert "have no Kiosk fault" not in caplog.text


def test_each_fault_says_how_the_agent_reads_it_again_for_its_cards_next_check(tmp_path):
    # owner, 2026-10-15: "add a small text … Next check: ###, when the next test for this card will be done" — an offline
    # device is read again every few minutes (the skill's `rechecks`), a battery at the nightly check, an alert at every
    # look of the desk; a chat's fault only a person closes
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k,
                   skills=("preventive-maintenance",))
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    off, _ = st.raise_finding("PM-UNAVAILABLE", "sensor.room_a", "room_a", "2026-10-15", "P3", "Room A offline for 1 d", {})
    low, _ = st.raise_finding("PM-BATTERY-LOW", "sensor.door_b", "door_b", "2026-10-15", "P3", "Door B battery at 12%", {})
    pb.open_task("finding", off, "PM-UNAVAILABLE", "sensor.room_a", "Room A offline for 1 d")
    pb.open_task("finding", low, "PM-BATTERY-LOW", "sensor.door_b", "Door B battery at 12%")
    iid = st.new_incident("rule_x|lock.front", "rule_x", "lock.front", "P2", {"summary": "Front door unlocked"})
    pb.open_task("incident", iid, "rule_x", "lock.front", "Front door unlocked")
    # owner, 2026-10-20: every night fault is read again every 5 minutes (skill.yaml `rechecks: all`), and one device
    # with an alert AND a night fault has two faults, each saying its own clock
    both, _ = st.raise_finding("PM-BATTERY-LOW", "lock.front", "front", "2026-10-15", "P3", "Front door battery at 15%", {})
    pb.open_task("finding", both, "PM-BATTERY-LOW", "lock.front", "Front door battery at 15%")
    run(v.tickets.repair())
    by_entity = {(t.get("entityId"), t.get("origin")): t.get("check") for t in k._all()}
    assert by_entity == {("sensor.room_a", "night"): "minutes", ("sensor.door_b", "night"): "minutes",
                         ("lock.front", "alert"): "minutes", ("lock.front", "night"): "minutes"}, by_entity
    chat = run(v.tickets.create("Pool light flickers"))                                # a chat's: no clock
    assert "check" not in k.ticket(chat)
    for t in k._all():                                                                  # a fault made before 0.12.212
        t.pop("check", None)
    run(v.tickets.repair())
    assert {(t.get("entityId"), t.get("origin")): t.get("check") for t in k._all() if t["id"] != chat} == by_entity
    # a Kiosk whose info lists no ticket_checks (before 2.496.429) reads "minutes" too: the same words
    k.info.pop("ticket_checks")
    for t in k._all():
        t.pop("check", None)
    run(v.tickets.repair())
    assert {(t.get("entityId"), t.get("origin")): t.get("check") for t in k._all() if t["id"] != chat} == by_entity


def test_a_duration_in_a_faults_title_is_worded_by_the_kiosk_when_it_shows_it(tmp_path):
    # architecture review, 2026-10-15: "LG TV has been offline for 129 h", written at 02:00, was a day old by evening —
    # the card carries its title with {since} and the moment, and the Kiosk words it each time it shows it
    import sys
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import rules
    from vesta_shared.params import VillaParams
    from vesta_shared.skill_settings import load
    params = VillaParams(defaults=load(os.path.join(STARTER_SKILLS, "preventive-maintenance"), "settings.yaml")["behaviour"])
    night = datetime(2026, 10, 15, 2, 0, tzinfo=timezone.utc)
    (f,) = rules.availability_rules({"slug": "tv", "name": "LG TV"}, "switch.tv", "unavailable", 129.0, params, now=night)
    assert f.summary == "LG TV has been offline for 5 d 9 h."
    assert (f.detail["since"], f.detail["since_words"]) == ((night - timedelta(hours=129)).isoformat(), "5 d 9 h")

    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    fid, _ = st.raise_finding("PM-UNAVAILABLE", "switch.tv", "tv", "2026-10-15", "P3", f.summary, f.detail)
    pb.settle(f"finding:{fid}")
    run(v.tickets.repair())
    (t,) = k._all()
    assert (t["title"], t["titlePattern"], t["since"]) == (f.summary, "LG TV has been offline for {since}.", f.detail["since"])
    k.person_renames(t["id"], "TV — unplugged on purpose")                    # a person's title stays theirs, as it is
    run(v.tickets.repair())
    assert "titlePattern" not in k.ticket(t["id"]) and k.ticket(t["id"])["title"] == "TV — unplugged on purpose"
    older = FakeKiosk()                                                        # a Kiosk that does not read the field
    older.info["ticket_fields"] = [x for x in older.info["ticket_fields"] if x != "titlePattern"]
    v2 = make_agent(tmp_path / "older", {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=older)
    st2 = Store(v2.s.store_path)
    fid2, _ = st2.raise_finding("PM-UNAVAILABLE", "switch.tv", "tv", "2026-10-15", "P3", f.summary, f.detail)
    Problems(st2).settle(f"finding:{fid2}")
    run(v2.tickets.repair())
    assert [x.get("titlePattern") for x in older._all()] == [None]            # it never sees "{since}"


def test_a_fault_waiting_to_close_tells_the_kiosk_when_and_stops_when_it_holds_again(tmp_path):
    # owner, 2026-10-21: a door locked at 14:38:50 was still a fault at 14:45 and nothing said the desk waits 10 minutes
    # clear — the desk's moment (Notes.CLOSES_AT) is the fault's closesAt; gone from the fault when it holds again
    from vesta_shared.store import Notes
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    iid = st.new_incident("rule_x|lock.front", "rule_x", "lock.front", "P2", {"summary": "Front door unlocked"})
    pb.open_task("incident", iid, "rule_x", "lock.front", "Front door unlocked")
    run(v.tickets.repair())
    (t,) = k._all()
    assert "closesAt" not in t
    st.note(iid, {Notes.CLOSES_AT: "2026-10-21T06:48:50+00:00"})
    run(v.tickets.repair())
    assert k.ticket(t["id"])["closesAt"] == "2026-10-21T06:48:50+00:00"
    st.note(iid, drop=(Notes.CLOSES_AT,))
    run(v.tickets.repair())
    assert "closesAt" not in k.ticket(t["id"])


def test_a_fault_brought_up_to_date_is_written_once_whatever_it_needs():
    # architecture review scan 2, 2026-10-19: a new title, its tags and its Telegram lines were three reads and three
    # writes of the whole Facility record — three revisions, each one more chance a person's save is refused
    from vesta_agent.kiosk import noted, retitled, tagged
    k, doc = kiosk_holding({"id": "va-1", "title": "Pump weak", "status": "open", "openedAt": "2026-10-19T00:00:00Z",
                            "photoIds": [], "updates": [{"at": "2026-10-19T00:00:00Z", "status": "open", "photoIds": [],
                                                        "title": "Pump weak"}]})
    rev = doc["rev"]
    n = run(k.amend("va-1", retitled("Pump very weak"), tagged(5, "alert", "minutes"),
                    noted([{"at": "2026-10-19T00:05:00Z", "note": "Reminder sent (to: FM)"}])))
    t = ticket(doc)
    assert n == 3 and doc["rev"] == rev + 1, (n, doc["rev"])
    assert t["title"] == "Pump very weak" and t["alertNumber"] == 5 and t["updates"][-1]["kind"] == "noted"
    assert run(k.amend("va-1", retitled("Pump very weak"), tagged(5, "alert", "minutes"))) == 0 and doc["rev"] == rev + 1


def test_the_repair_puts_a_fault_right_in_one_write(tmp_path):
    # the same review: the repair (tickets._converge) hands every change a fault needs to ONE Kiosk.amend
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    fid, _ = st.raise_finding("PM-X", "lock.front", "offline", "2026-10-07", "P3", "Front door lock unavailable", {})
    pb.open_task("finding", fid, "PM-X", "lock.front", "Front door lock unavailable")
    run(v.tickets.repair())
    t1 = ticket(k.doc, "t1")
    for f in ("origin", "check"):
        t1.pop(f, None)                                        # a fault made before it carried them
    st.raise_finding("PM-X", "lock.front", "offline", "2026-10-08", "P3", "Front door lock offline 3 days", {})
    rev = k.doc["rev"]
    run(v.tickets.repair())
    assert k.titles["t1"] == "Front door lock offline 3 days" and ticket(k.doc, "t1").get("origin")
    assert k.doc["rev"] == rev + 1, k.doc["rev"] - rev


def test_what_a_person_did_to_a_fault_is_read_from_its_steps_alone():
    # architecture review scan 2, 2026-10-19: kiosk.fault_of, pure — the agent's own clearing is never a person's close,
    # a person's reopening and "Open Ticket" carry who and when, a step of the agent's never counts as taken
    from vesta_agent.kiosk import fault_of
    step = lambda at, status, **k: {"at": at, "status": status, "photoIds": [], **k}
    t = {"id": "va-1", "title": "Pump weak", "status": "open", "updates": [
        step("2026-10-19T00:00Z", "open", title="Pump weak"),
        step("2026-10-19T00:10Z", "resolved", kind="cleared", by="VESTA Agent"),
        step("2026-10-19T00:20Z", "open", kind="reopened", by="Owner", who="Jim"),
        step("2026-10-19T00:25Z", "in_progress", by="VESTA Agent"),
        step("2026-10-19T00:30Z", "in_progress", by="Facility manager", who="Wayan")]}
    f = fault_of(t)
    assert f["cleared"] and (f["reopened_at"], f["reopened_by"]) == ("2026-10-19T00:20Z", "Jim")
    assert (f["taken_at"], f["taken_by"]) == ("2026-10-19T00:30Z", "Wayan") and f["by"] == "Wayan"
    t["updates"] = t["updates"][:4]
    assert "taken_at" not in fault_of(t)                       # the agent's own step is never a person taking it on


# ---------------------------------------------------------------------- 7 · what to do follows its problem's words
def test_a_faults_note_follows_what_to_do_unless_a_person_wrote_it():
    # architecture review, 2026-10-19: the note was written at the fault's making only; the route's check edited, or a
    # finding's check rewritten by the night, never reached the Cockpit
    from vesta_agent.kiosk import todo
    k, doc = kiosk_holding(
        {"id": "va-1", "title": "Pump offline", "status": "open", "note": "Check: the breaker", "updates": []},
        {"id": "va-2", "title": "Pump offline", "status": "open", "note": "Part ordered, due Monday", "updates": []},
        {"id": "va-3", "title": "Pump offline", "status": "open", "updates": []},
        {"id": "va-4", "title": "Pump offline", "status": "resolved", "note": "What to do: the breaker", "updates": []})
    amend = todo("What to do: the breaker and the supply")
    assert run(k.amend("va-1", amend)) == 1 and ticket(doc, "va-1")["note"] == "What to do: the breaker and the supply"
    assert run(k.amend("va-1", amend)) == 0                                             # says it: nothing written
    assert run(k.amend("va-2", amend)) == 0 and ticket(doc, "va-2")["note"] == "Part ordered, due Monday"   # theirs
    assert run(k.amend("va-3", amend)) == 1 and ticket(doc, "va-3")["note"].startswith("What to do: ")
    assert run(k.amend("va-4", amend)) == 0                                             # closed: as it was
    assert run(k.held_tickets())["va-1"]["note"] == "What to do: the breaker and the supply"


# ---------------------------------------------------------------------- 8 · the Kiosk-version gate, the only door
def _every_write(k: Kiosk) -> dict:
    """Every write the agent makes to a fault, on Kiosk `k`: a new fault with every field, then each amend, a resolve
    (the agent's clearing, then a person's Done) and a reopening. Returns the fault as the Kiosk holds it."""
    from vesta_agent.kiosk import closing, noted, retitled, tagged, todo
    tid = run(k.add_ticket("Pump offline for 2 h", entity_id="switch.pump", note="What to do: power", document_ids=["d1"],
                           number=5, origin="alert", check="minutes",
                           pattern={"titlePattern": "Pump offline for {since}", "since": "2026-10-19T00:00:00Z"}))
    run(k.amend(tid, retitled("Pump offline for 3 h"), tagged(6, "night", "nightly", {"titlePattern": "P {since}",
                                                                                         "since": "2026-10-19T01:00:00Z"}),
                noted([{"at": "2026-10-19T00:05:00Z", "note": "Reminder sent (to: FM)"}]), todo("What to do: the plug"),
                closing("2026-10-19T00:20:00Z")))
    k.person_renames(tid, "Pump — Wayan on it")
    run(k.amend(tid, retitled("Pump offline for 4 h")))                       # under a person's title: a reading step
    run(k.resolve_ticket(tid, note="Cleared: back online."))
    run(k.reopen_ticket(tid, "Pump offline again", "Back again."))
    run(k.resolve_ticket(tid, note="Done", who="Wayan"))
    return k.ticket(tid)


def _kinds_and_fields(t: dict) -> tuple[set, set]:
    declared = set(json.load(open(CONTRACT))["ticket"]["fields"])
    return {u["kind"] for u in t["updates"] if u.get("kind") and u.get("by") != "Owner"}, set(t) & declared


def test_a_kiosk_that_lists_everything_gets_every_kind_and_field_the_agent_writes():
    kinds, fields = _kinds_and_fields(_every_write(FakeKiosk()))
    agreed = json.load(open(CONTRACT))
    assert kinds == set(agreed["ticketUpdate"]["kinds"]) and fields == set(agreed["ticket"]["fields"]), (kinds, fields)


def test_a_kiosk_that_lists_nothing_gets_only_the_agreements_base_sets():
    # architecture review, 2026-10-19: the gate was asked for ONE kind and ONE field; every other one was written
    # whatever the Kiosk — an older one shows a kind it does not know as a change of status
    agreed = json.load(open(CONTRACT))
    k = FakeKiosk()
    k.info = {"contract": 1}                                    # a Kiosk before 2.496.356: no step_kinds, no ticket_fields
    t = _every_write(k)
    kinds, fields = _kinds_and_fields(t)
    assert kinds <= set(agreed["ticketUpdate"]["kindsBeforeList"]) and kinds, kinds
    assert fields <= set(agreed["ticket"]["fieldsBeforeList"]) and fields, fields
    assert "titlePattern" not in t and "since" not in t
    assert not [u for u in t["updates"] if "Reminder sent" in str(u.get("note"))]   # never as a change of status
    assert t["alertNumber"] == 6 and t["note"] == "What to do: the plug"          # what it reads still moves


def test_an_unlisted_kind_that_changes_the_status_is_written_as_before_kinds():
    from vesta_agent.kiosk import cleared_step, last_close
    k = FakeKiosk()
    k.info = {"contract": 1, "step_kinds": ["retitled", "reading"], "ticket_fields": []}  # before "cleared", "reopened"
    tid = run(k.add_ticket("Pump weak", entity_id="switch.pump", number=5))
    run(k.resolve_ticket(tid, note="Cleared: back online."))
    t = k.ticket(tid)
    close = last_close(t["updates"])
    assert "kind" not in close and cleared_step(close)           # still read as the agent's clearing, by its note
    run(k.reopen_ticket(tid, "Pump weak again", "Back again."))
    back = k.ticket(tid)["updates"][-1]
    assert (back["status"], back.get("kind"), back["note"]) == ("open", None, "Back again.")   # a status step, as before
    assert "entityId" not in t and "alertNumber" not in t       # a Kiosk that lists no field takes none
