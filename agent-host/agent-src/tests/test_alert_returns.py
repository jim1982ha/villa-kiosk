"""An alert that goes and comes back (architecture review, 2026-10-18 — the villa's #52: "outdoor motion at night"
opened, cleared and came back four times in four hours).

1. a reopening says WHY on the Cockpit card: "Still there after the close." is not "Back again.";
2. "N times in 7 days" counts the week, every incident of the same alert — not only the runs of one number;
3. the agent's own clearing is never read as a person closing the fault in the Cockpit.
Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from kiosk_fake import FakeKiosk
from vesta_agent.kiosk import REOPENED
from vesta_agent.tickets import Tickets
from vesta_shared.problems import Problems, incident_runs
from vesta_shared.store import Incident, Store


def run(c):
    return asyncio.run(c)


class _State:
    def log(self, *_a, **_k):
        pass


def villa(tmp_path):
    k, path, settled = FakeKiosk(), str(tmp_path / "agent.db"), []

    async def settle(iid, note):
        settled.append((iid, note))
        return 0
    return k, Tickets(kiosk=k, state=_State(), store_path=path, settle_alert=settle), Store(path), settled


def an_alert_with_its_fault(k, t, st, message="Entrance door unlocked"):
    iid = st.new_incident("door|lock.example_door", "door_unlocked", "lock.example_door", "P2", {"message": message})
    tid, _ = Problems(st).open_task("incident", iid, "door_unlocked", "lock.example_door", message)
    uid = run(t.create(message, "lock.example_door", None, tid))
    return iid, tid, uid


def _cleared_then_reopened(tmp_path, **note):
    k, t, st, _ = villa(tmp_path)
    iid, tid, uid = an_alert_with_its_fault(k, t, st)
    Problems(st).close_incident(iid, Incident.RESOLVED, st.now(), "Cleared in the villa's system.")
    run(t.repair())
    assert k.ticket(uid)["status"] == "resolved"
    st.reopen_incident(iid, st.now())                   # the alert open again, as the desk reopens it
    how = Problems(st).reopen_task("incident", iid, "door_unlocked", "lock.example_door", "Entrance door unlocked", **note)
    assert how == (tid, "reopened")
    run(t.repair())                                     # what carry_out does when a desk result moved a fault
    card = k.ticket(uid)
    assert card["status"] == "open"
    return [u for u in card["updates"] if u.get("kind") == REOPENED][-1]


def test_a_door_still_unlocked_after_the_close_says_so_on_its_card(tmp_path):
    # review 25 forbade "Back again" for a door never locked; the desk wrote the right words on an action nothing read,
    # and the Kiosk filled in its own "Back again: …"
    step = _cleared_then_reopened(tmp_path, note="Still there after the close.")
    assert step["note"] == "Still there after the close.", step


def test_an_alert_that_truly_came_back_says_back_again(tmp_path):
    step = _cleared_then_reopened(tmp_path)
    assert step["note"] == "Back again.", step


def test_the_agents_own_clearing_is_never_a_person_closing_it_in_the_cockpit(tmp_path):
    # a fast flap: the close's clearing lands just after the return reopened the task — the times alone said "a person"
    k, t, st, settled = villa(tmp_path)
    iid, tid, uid = an_alert_with_its_fault(k, t, st)
    st.reopen_task(tid, "Entrance door unlocked", note="Back again.")            # the return, first
    assert run(k.resolve_ticket(uid))                                            # the agent's clearing, after it
    run(t.repair())
    assert st.task(tid)["status"] == "open", st.task(tid)
    assert not settled, settled                          # no "Closed in the Cockpit by VESTA Agent" sent anywhere
    assert k.ticket(uid)["status"] == "open"             # the repair put its fault back


def test_a_persons_close_in_the_cockpit_still_closes_the_task(tmp_path):
    # the other side of the same rule: a close a person made is theirs
    k, t, st, settled = villa(tmp_path)
    iid, tid, uid = an_alert_with_its_fault(k, t, st)
    k.person_closes(uid, at="2099-01-01T00:00:00.000Z")
    run(t.repair())
    assert st.task(tid)["status"] != "open" and settled


T0 = datetime(2026, 10, 10, 19, 0, tzinfo=timezone.utc)


def _incident(st, at, key="cam|binary_sensor.parking_motion", closed_after=timedelta(minutes=10)):
    iid = st.new_incident(key, "outdoor_motion", "binary_sensor.parking_motion", "P1", {"message": "Motion"}, at.isoformat())
    st.update_incident(iid, closed_at=(at + closed_after).isoformat())
    return iid


def test_n_times_in_7_days_counts_every_incident_of_the_same_alert(tmp_path):
    # the same camera, back more than reopen_hours after each close: a new number each night, and each read "1st time"
    st = Store(str(tmp_path / "s.sqlite"))
    old = _incident(st, T0 - timedelta(days=8))                  # outside the week
    mon = _incident(st, T0)
    tue = _incident(st, T0 + timedelta(hours=30))
    st.reopen_incident(tue, (T0 + timedelta(hours=31)).isoformat())   # a run within the 4 hours: the same number
    wed = _incident(st, T0 + timedelta(days=2))
    other = _incident(st, T0 + timedelta(days=2), key="door|lock.example_door")
    runs = {i: incident_runs(st.incident(i), st) for i in (old, mon, tue, wed, other)}
    assert runs == {old: 1, mon: 1, tue: 3, wed: 4, other: 1}, runs


def test_n_times_in_7_days_counts_the_runs_filed_under_the_rules_name(tmp_path):
    # architecture review scan 1, 2026-10-19: since 0.12.250 an alert is filed by its rule's permanent number; its runs
    # of the week filed under the rule's name before were not counted — "1st time" for the third run
    st = Store(str(tmp_path / "s.sqlite"))
    by_name = "outdoor_motion|binary_sensor.parking_motion"
    _incident(st, T0, key=by_name)
    _incident(st, T0 + timedelta(hours=30), key=by_name)
    now = _incident(st, T0 + timedelta(days=2), key="rule:1700000000000|binary_sensor.parking_motion")
    assert incident_runs(st.incident(now), st) == 3
