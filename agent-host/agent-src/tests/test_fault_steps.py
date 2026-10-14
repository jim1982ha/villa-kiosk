"""A fault's step says what it is (architecture review 26, 2026-10-11).

The villa, that week: the Kiosk recognised the agent's title changes by their first words ("Now: …") and took them for
status steps — "in progress since 03:00 by VESTA Agent" replaced the facility manager's own time and name; the agent
wrote its title back over one a person had written, every night; a fault picked up after a close that did not land was
taken for a person reopening it; a night check's fault reopened in the Kiosk told nobody; and an offline lock after
Done counted as fixed. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import copy
import importlib.util
import json
import os
from datetime import datetime, timedelta, timezone

from helpers import STARTER_SKILLS, make_agent
from kiosk_fake import FakeKiosk
from vesta_agent.kiosk import Kiosk
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
    """The real Kiosk class over an in-memory Facility document (its GET and PUT of /agent/v1/fm-data)."""
    k = Kiosk("http://kiosk", "token")
    doc = {"data": {"tickets": list(tickets)}, "rev": 1}

    async def answer(method, path, body=None):
        if method == "GET":
            return 200, copy.deepcopy(doc)
        doc["data"], doc["rev"] = body["data"], doc["rev"] + 1
        return 200, {}
    k._req = answer
    return k, doc


def ticket(doc, tid="va-1") -> dict:
    return next(t for t in doc["data"]["tickets"] if t["id"] == tid)


# ---------------------------------------------------------------------- 1 · each step says what it is
def test_a_title_change_is_a_retitled_step_keeping_the_title_before_and_never_a_note():
    k, doc = kiosk_holding()
    tid = run(k.add_ticket("Motion battery at 9%"))
    assert ticket(doc, tid)["updates"][0]["title"] == "Motion battery at 9%"        # the title the agent gave it
    assert run(k.update_ticket(tid, "Motion battery at 7%"))
    t = ticket(doc, tid)
    step = t["updates"][-1]
    assert t["title"] == "Motion battery at 7%"
    assert step["kind"] == "retitled" and step["was"] == "Motion battery at 9%" and step["title"] == "Motion battery at 7%"
    assert "note" not in step                                                         # no "Now: …" for the card to guess at
    assert not run(k.update_ticket(tid, "Motion battery at 7%"))                     # already says it: nothing written


def test_every_kind_the_agent_writes_is_one_the_agreement_declares():
    from vesta_agent import kiosk
    kinds = json.load(open(CONTRACT))["ticketUpdate"]["kinds"]
    assert {kiosk.REOPENED, kiosk.RETITLED, kiosk.READING, kiosk.CLEARED} == set(kinds)


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
    assert run(k.update_ticket(tid, "Front door lock offline 3 days"))
    t = ticket(doc, tid)
    assert t["title"] == "Front door lock — part ordered"
    assert t["updates"][-1]["kind"] == "reading" and t["updates"][-1]["title"] == "Front door lock offline 3 days"
    assert not run(k.update_ticket(tid, "Front door lock offline 3 days"))           # the same reading: not again
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
    k.titles["t1"] = "Front door lock — part ordered"
    st.raise_finding("PM-X", "lock.front", "offline", "2026-10-08", "P3", "Front door lock offline 3 days", {})
    assert pb.current_title(st.task(tid)) == "Front door lock offline 3 days"         # what the night reads now
    run(v.tickets.repair())
    run(v.tickets.repair())
    assert k.titles["t1"] == "Front door lock — part ordered"
    assert k.readings == [("t1", "Front door lock offline 3 days")]                  # under it, once


def test_the_repair_says_when_an_open_problem_has_no_fault(tmp_path, caplog):
    # villa, 2026-10-14: a sensor open for five days, never in the Cockpit, and nothing anywhere said so
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    st = Store(v.s.store_path)
    st.raise_finding("PM-X", "sensor.example_room", "offline", "2026-10-09", "P3", "Example offline for 39 h", {})
    with caplog.at_level("WARNING", logger="vesta.outcome"):
        run(v.tickets.repair())
    assert "1 open problem(s) have no Kiosk fault: PM-X sensor.example_room" in caplog.text


# ---------------------------------------------------------------------- 4, 6 · a reopening is read, and someone is told
def _closed_night_fault(tmp_path, k, told):
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)

    async def tell(text):
        told.append(text)
    v.tickets.tell_fm = tell
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    fid, _ = st.raise_finding("PM-X", "sensor.pump", "power", "2026-10-07", "P3", "Pump weak", {})
    tid, _ = pb.open_task("finding", fid, "PM-X", "sensor.pump", "Pump weak")
    st.set_task_uid(tid, "t-pump")
    pb.close_finding(st.finding(fid), "2026-10-08", "Cleared")
    k.known = ["t-pump"]
    return v, st, tid


def test_a_night_fault_a_person_reopens_tells_the_facility_manager(tmp_path):
    k, told = FakeKiosk(), []
    v, st, tid = _closed_night_fault(tmp_path, k, told)
    k.closed_meta["t-pump"] = {"reopened_by": "Owner", "reopened_at": "2099-01-01T00:00:00.000Z"}
    run(v.tickets.repair())
    assert st.task(tid)["status"] == "open"
    assert len(told) == 1 and told[0].startswith("Reopened in the VESTA Kiosk by Owner on ") \
        and told[0].endswith(": Pump weak. Please look again.")
    run(v.tickets.repair())
    assert len(told) == 1                                                             # once


def test_a_fault_picked_up_after_a_close_that_did_not_land_is_closed_again_not_taken_for_a_reopening(tmp_path):
    # the agent's resolve failed (the Kiosk down a moment); Fabien then pressed "Mark in progress": no "Reopen fault"
    # step — the close is retried, nobody is told to look again at a job just taken
    k, told = FakeKiosk(), []
    v, st, tid = _closed_night_fault(tmp_path, k, told)
    k.closed_meta["t-pump"] = {"by": "Facility manager"}
    run(v.tickets.repair())
    assert st.task(tid)["status"] != "open" and "t-pump" in k.resolved and told == []


# ---------------------------------------------------------------------- 2 · a device that does not answer
T0 = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)


class Villa:
    def __init__(self, **now):
        self.now = now

    def states(self, ids):
        return {e: {"state": s, "attributes": {"friendly_name": "Laundry lock"}} for e, s in self.now.items() if e in ids}


def _door_done(store):
    ev = {"blueprint": "critical_condition", "rule_id": "automation.door", "incident_id": "automation.door-1",
          "phase": "opened", "severity": "critical", "label": "Door", "entities": ["lock.door"], "summary": "Door unlocked",
          "mode": "state", "bad_states": ["unlocked"]}
    iid = desk.intake(store, ev, T0, mode_reader=lambda: "x")["incident_id"]
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
    iid = desk.intake(store, ev, T0, mode_reader=lambda: "x")["incident_id"]
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
    assert run(k.update_ticket("va-1", "Pump at 0 %")) and run(k.update_ticket("va-2", "Pump at 0 %"))
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
    k, told = FakeKiosk(), []
    v, st, tid = _closed_night_fault(tmp_path, k, told)
    with st.db:                                                                     # closed five days ago
        st.db.execute("UPDATE tasks SET done_at=? WHERE id=?", ((datetime.now(timezone.utc) - timedelta(days=5)).isoformat(), tid))
    k.closed_meta["t-pump"] = {"reopened_by": "Owner", "reopened_at": "2099-01-01T00:00:00.000Z"}
    run(v.tickets.repair())
    assert st.task(tid)["status"] == "open" and told and told[0].startswith("Reopened in the VESTA Kiosk by Owner on 01/01/2099 00:00: ")


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
    k, told = FakeKiosk(), []
    v, st, tid = _closed_night_fault(tmp_path, k, told)
    with st.db:
        st.db.execute("UPDATE tasks SET done_at=? WHERE id=?", ((datetime.now(timezone.utc) - timedelta(days=5)).isoformat(), tid))
    run(v.tickets.repair())
    assert "t-pump" not in k.resolved and st.task(tid)["status"] != "open" and told == []


def test_a_done_on_telegram_resolves_the_fault_by_the_person(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    ev = {"blueprint": "critical_condition", "rule_id": "automation.d", "incident_id": "automation.d-1", "phase": "opened",
          "severity": "critical", "label": "Door", "entities": ["lock.d"], "summary": "Door unlocked", "mode": "state",
          "bad_states": ["unlocked"]}
    iid = desk.intake(store, ev, T0, mode_reader=lambda: "x")["incident_id"]
    out = desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=5), name="Fabien")
    (res,) = [a for a in out["actions"] if a["action"] == "ticket.resolve"]
    assert res["who"] == "Fabien"


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
