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
    (Incident.RECOVERED, None),                                   # the fault is still there: its task stays
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


class _F:
    """A finding as the night check makes it (rules.Finding's shape)."""
    def __init__(self, rule_id, entity_id, severity="P3", summary="x", change_pct=None):
        self.rule_id, self.entity_id, self.family, self.severity, self.summary = rule_id, entity_id, "power", severity, summary
        self.detail, self.check, self.day = ({"change_pct": change_pct} if change_pct is not None else {}), "look", ""

    def as_dict(self):
        return {"rule_id": self.rule_id, "entity_id": self.entity_id, "family": self.family, "severity": self.severity,
                "summary": self.summary, "detail": self.detail, "check": self.check, "day": self.day}


def test_the_nights_ledger_list_in_list_out(tmp_path):
    # architecture review 7: what a night does with its findings, without a night check or a fixture folder
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)
    rules = dict(state_rules={"S-POWER", "S-GONE"}, event_rules={"E-RUN"}, worsened_step=15)
    n1 = pb.record_night([_F("S-POWER", "a", "P2", change_pct=-20), _F("S-GONE", "b"), _F("E-RUN", "c", "P4")],
                         "2026-10-06", **rules)
    assert {d["rule_id"] for d in n1["new"]} == {"S-POWER", "S-GONE", "E-RUN"}
    assert [t["entity_id"] for t in n1["tasks"]] == ["a", "b"]                          # P2 and P3 only
    assert store.finding(next(d["id"] for d in n1["new"] if d["rule_id"] == "E-RUN"))["status"] == "closed"
    n2 = pb.record_night([_F("E-RUN", "c", "P4")], "2026-10-07", **rules)
    assert "muted" not in n2                                        # nothing is silenced any more (owner, 2026-10-10)
    # not seen tonight: closed with its task and fault
    assert sorted(c["rule_id"] for c in n2["closed"]) == ["S-GONE", "S-POWER"]
    assert sorted(a["task_id"] for a in n2["resolve_actions"]) == sorted(t["task_id"] for t in n1["tasks"])


def test_a_still_open_finding_that_worsened_is_news_again(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)
    rules = dict(state_rules={"S-POWER"}, event_rules=set(), worsened_step=15)
    pb.record_night([_F("S-POWER", "a", change_pct=-20)], "2026-10-06", **rules)
    same = pb.record_night([_F("S-POWER", "a", change_pct=-25)], "2026-10-07", **rules)
    worse = pb.record_night([_F("S-POWER", "a", change_pct=-40)], "2026-10-08", **rules)
    assert not same["new"] and not same["still_open"][0].get("worsened")
    assert worse["still_open"][0]["worsened"] is True


def test_the_same_night_run_again_tells_an_event_once(tmp_path):
    # an event finding closes the night it fires; the same night run again (the page's Try) is not news twice
    store = Store(str(tmp_path / "s.sqlite"))
    rules = dict(state_rules=set(), event_rules={"E-RUN"}, worsened_step=15)
    first = Problems(store).record_night([_F("E-RUN", "c", "P3")], "2026-10-07", **rules)
    again = Problems(store).record_night([_F("E-RUN", "c", "P3")], "2026-10-07", **rules)
    assert len(first["new"]) == 1 and again["new"] == [] and again["tasks"] == []
