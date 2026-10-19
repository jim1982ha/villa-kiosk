"""A fault a person reopened in the VESTA Kiosk is theirs until a person closes it (architecture review, 2026-10-14).

The villa's promise (Problems.reopened_in_kiosk): "the night check's 'gone' never closes it". The repair kept it; the
night check's close_finding did not — the owner reopened "Pump weak", the next night no longer saw it, and the card
closed itself "Cleared". Synthetic villa; ids invented."""
from __future__ import annotations

import os
import tempfile

from vesta_shared.problems import Problems
from vesta_shared.store import Incident, Store


def villa():
    st = Store(os.path.join(tempfile.mkdtemp(), "s.sqlite"))
    return st, Problems(st)


def reopened_night_fault(st, pb):
    fid, _ = st.raise_finding("PM-X", "sensor.example_pump", "power", "2026-10-07", "P3", "Pump weak", {})
    tid, _ = pb.open_task("finding", fid, "PM-X", "sensor.example_pump", "Pump weak")
    pb.closed_in_kiosk(tid)                        # the facility manager closes it in the Cockpit
    pb.reopened_in_kiosk(tid, by="Owner")          # the owner is not convinced: reopens it
    return fid, tid


def test_the_night_no_longer_seeing_it_does_not_close_a_fault_a_person_reopened():
    st, pb = villa()
    fid, tid = reopened_night_fault(st, pb)
    acts = pb.close_finding(st.finding(fid), "2026-10-09", "Cleared")
    assert acts == [] and st.task(tid)["status"] == "open"
    assert pb.in_persons_hands(st.task(tid))


def test_an_alert_clearing_does_not_close_it_either_but_a_persons_done_does():
    st, pb = villa()
    iid = st.new_incident("k", "door_unlocked", "lock.example_door", "P2", {})
    tid, _ = pb.open_task("incident", iid, "door_unlocked", "lock.example_door", "Door unlocked")
    pb.closed_in_kiosk(tid)
    pb.reopened_in_kiosk(tid, by="Owner")
    assert pb.close_incident(iid, Incident.RESOLVED, st.now(), "Cleared in Home Assistant") == []
    assert st.task(tid)["status"] == "open"                        # Home Assistant clearing it: still the owner's
    done = pb.close_incident(iid, Incident.DONE, st.now(), "Done by Wayan on Telegram.", who="Wayan")
    assert done == [{"action": "faults_changed"}] and st.task(tid)["status"] == "done"


def test_a_problem_that_came_back_is_the_agents_and_closes_with_its_source():
    st, pb = villa()
    fid, _ = st.raise_finding("PM-X", "sensor.example_pump", "power", "2026-10-07", "P3", "Pump weak", {})
    tid, _ = pb.open_task("finding", fid, "PM-X", "sensor.example_pump", "Pump weak")
    pb.close(tid, "cleared")
    pb.reopen_task("finding", fid, "PM-X", "sensor.example_pump", "Pump weak (again: 2 times in 7 days)")
    assert not pb.in_persons_hands(st.task(tid))
    assert pb.close_finding(st.finding(fid), "2026-10-09") == [{"action": "faults_changed"}]
    assert st.task(tid)["status"] == "cleared"


def test_every_list_reads_a_persons_close_the_same_way():
    st, pb = villa()
    fid, _ = st.raise_finding("PM-X", "sensor.example_pump", "power", "2026-10-07", "P3", "Pump weak", {})
    tid, _ = pb.open_task("finding", fid, "PM-X", "sensor.example_pump", "Pump weak")
    pb.closed_in_kiosk(tid)
    assert pb.unseen() == [] and [p for p in pb.open_problems() if p["source"] == f"finding:{fid}"] == []
