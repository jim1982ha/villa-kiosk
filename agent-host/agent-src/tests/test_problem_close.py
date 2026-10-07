"""Architecture review 6: closing an incident or a finding closes what it owes — decided by its state, in one place
(vesta_shared.problems), not by each skill remembering to."""
from __future__ import annotations

import pytest

from vesta_shared.problems import CLEARED, DONE, Problems
from vesta_shared.store import Incident, Store

NOW = "2026-10-07T12:00:00+00:00"


def _incident_with_task(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = store.new_incident("k", "rule.example", "lock.example_door", "P2", {"message": "unlocked"}, at=NOW)
    tid, _ = Problems(store).open_task("incident", iid, "rule.example", "lock.example_door", "Door unlocked")
    return store, iid, tid


@pytest.mark.parametrize("state,closes_as", [
    (Incident.DONE, DONE), (Incident.RESOLVED, CLEARED),          # a person answered / Home Assistant cleared it
    (Incident.MUTED, None), (Incident.RECOVERED, None),           # the fault is still there: its task stays
])
def test_an_incident_closed_in_a_state_closes_its_task_only_when_that_state_ends_the_problem(tmp_path, state, closes_as):
    store, iid, tid = _incident_with_task(tmp_path)
    actions = Problems(store).close_incident(iid, state, NOW, "why", reply="x")
    inc = store.incident(iid)
    assert inc["state"] == state and inc["closed_at"] == NOW and inc["reply"] == "x"
    task = store.task(tid)
    if closes_as:
        assert task["status"] == closes_as and actions == [{"action": "ticket.resolve", "task_id": tid, "note": "why"}]
    else:
        assert task["status"] == "open" and actions == []
    # and the nightly reconcile agrees with what was decided here
    assert Problems(store).source_gone(task) == bool(closes_as)


def test_a_finding_no_longer_seen_closes_with_its_task_and_its_fault(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    fid, _ = store.raise_finding("PM-X", "sensor.example", "power", "2026-10-06", "P3", "Pump weak", {})
    tid, _ = Problems(store).open_task("finding", fid, "PM-X", "sensor.example", "Pump weak")
    actions = Problems(store).close_finding(store.finding(fid), "2026-10-07", "Cleared: the nightly check no longer sees it.")
    assert store.finding(fid)["status"] == "closed" and store.task(tid)["status"] == CLEARED
    assert actions == [{"action": "ticket.resolve", "task_id": tid, "note": "Cleared: the nightly check no longer sees it."}]
