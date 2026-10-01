"""A problem's lifecycle (vesta_shared.problems), through its own interface: a store, nothing else.
Synthetic data only."""
from __future__ import annotations

import sqlite3

import pytest

from vesta_shared.problems import CLEARED, CLOSED_IN_KIOSK, DONE, Problems
from vesta_shared.store import Store


@pytest.fixture
def pb(tmp_path):
    return Problems(Store(str(tmp_path / "s.sqlite")))


def finding(pb, rule="PM-A", eid="sensor.example_a", sev="P3"):
    fid, _ = pb.store.raise_finding(rule, eid, "level", "2026-09-30", sev, f"{eid} is off", {"check": "its battery"})
    return fid


def test_one_open_task_per_rule_and_entity(pb):
    fid = finding(pb)
    a, made = pb.open_task("finding", fid, "PM-A", "sensor.example_a", "A is off", "its battery")
    b, again = pb.open_task("finding", fid, "PM-A", "sensor.example_a", "A is off")
    assert made and not again and a == b
    t = pb.store.task(a)
    assert t["source"] == f"finding:{fid}" and pb.title_of(t) == "A is off" and pb.check_of(t) == "its battery"


def test_a_closed_source_closes_its_task_and_says_which(pb):
    fid = finding(pb)
    tid, _ = pb.open_task("finding", fid, "PM-A", "sensor.example_a", "A is off")
    other, _ = pb.open_task("finding", finding(pb, "PM-B", "sensor.example_b"), "PM-B", "sensor.example_b", "B")
    assert pb.clear_source("finding", fid) == [tid]
    assert pb.store.task(tid)["status"] == CLEARED and pb.store.task(other)["status"] == "open"


def test_closed_in_the_kiosk_closes_the_incident_it_came_from(pb):
    # villa, 2026-10-01: the task closed, the incident stayed "asked" and the desk chased and escalated
    iid = pb.store.new_incident("k", "automation.example_door", "lock.example_door", "P2", {"message": "Door open"})
    pb.store.update_incident(iid, state="asked")
    tid, _ = pb.open_task("incident", iid, "automation.example_door", "lock.example_door", "Door open")
    assert pb.closed_in_kiosk(tid) == iid
    assert pb.store.task(tid)["status"] == CLOSED_IN_KIOSK
    inc = pb.store.incident(iid)
    assert inc["closed_at"] and inc["state"] == "done"
    assert not [p for p in pb.open_problems() if p["incident"] == iid]


def test_every_reader_gets_one_answer_and_a_finding_handled_by_a_person_is_not_open(pb):
    fid = finding(pb)
    tid, _ = pb.open_task("finding", fid, "PM-A", "sensor.example_a", "A is off")
    finding(pb, "PM-B", "sensor.example_b", "P2")
    assert [p["rule_id"] for p in pb.open_problems()] == ["PM-B", "PM-A"]             # most severe first
    pb.closed_in_kiosk(tid)                                     # a person closed it; the condition may last
    assert [p["rule_id"] for p in pb.open_problems()] == ["PM-B"]


def test_a_muted_alert_is_not_over_an_answered_one_is(pb):
    iid = pb.store.new_incident("k", "automation.x", "lock.example_door", "P2", {"message": "m"})
    tid, _ = pb.open_task("incident", iid, "automation.x", "lock.example_door", "m")
    pb.store.update_incident(iid, state="muted", closed_at="2026-10-01T00:00:00+00:00")
    assert not pb.source_gone(pb.store.task(tid))                # the fault is still there
    pb.store.update_incident(iid, state="done")
    assert pb.source_gone(pb.store.task(tid))


def test_a_task_closes_only_with_a_known_word(pb):
    tid, _ = pb.open_task("finding", finding(pb), "PM-A", "sensor.example_a", "A")
    with pytest.raises(ValueError):
        pb.close(tid, "done_in_kiosk")
    pb.close(tid, DONE)


def test_a_store_from_before_sources_gains_the_columns(tmp_path):
    # ⚠️ format changes need migrations: a 0.6.15 store has tasks without source / check_text
    path = str(tmp_path / "old.sqlite")
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id TEXT, entity_id TEXT, todo_uid TEXT, "
               "summary TEXT, created_at TEXT, done_at TEXT, status TEXT DEFAULT 'open')")
    db.execute("INSERT INTO tasks (rule_id, entity_id, summary) VALUES ('PM-A', 'sensor.example_a', 'A is off. Check: its battery')")
    db.commit(); db.close()
    pb = Problems(Store(path))
    (t,) = pb.open_tasks()
    assert t["source"] is None and pb.title_of(t) == "A is off." and pb.check_of(t) == "its battery"
