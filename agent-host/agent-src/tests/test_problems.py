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


def test_an_answered_alert_is_over_one_still_open_or_back_to_normal_is_not(pb):
    iid = pb.store.new_incident("k", "automation.x", "lock.example_door", "P2", {"message": "m"})
    tid, _ = pb.open_task("incident", iid, "automation.x", "lock.example_door", "m")
    assert not pb.source_gone(pb.store.task(tid))                # still open
    pb.store.update_incident(iid, state="recovered", closed_at="2026-10-01T00:00:00+00:00")
    assert not pb.source_gone(pb.store.task(tid))                # back to normal by itself: its fault waits for a person
    pb.store.update_incident(iid, state="done")
    assert pb.source_gone(pb.store.task(tid))
    # an alert muted before Mute was removed (0.12.132) is over too (architecture review 19: test_problem_close)
    pb.store.update_incident(iid, state="muted")
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
    assert t["source"] == "none:0" and pb.title_of(t) == "A is off." and pb.check_of(t) == "its battery"


def test_an_old_task_is_given_the_source_of_its_rule_and_device_once(tmp_path):
    # 0.6.42: the readers lost their second way of reading a 0.6.15 task; the store rewrites it instead
    path = str(tmp_path / "old.sqlite")
    st = Store(path)
    fid, _ = st.raise_finding("PM-A", "sensor.example_a", "level", "2026-09-30", "P3", "A", {})
    iid = st.new_incident("k", "automation.example_door", "lock.example_door", "P2", {"message": "Door"})
    for rule, ent in (("PM-A", "sensor.example_a"), ("automation.example_door", "lock.example_door"), ("PM-B", "x.y")):
        st.db.execute("INSERT INTO tasks (rule_id, entity_id, summary, created_at) VALUES (?, ?, 'Old', '2026-09-30')",
                      (rule, ent))
    st.db.commit()
    pb = Problems(Store(path))
    assert [t["source"] for t in pb.open_tasks()] == [f"finding:{fid}", f"incident:{iid}", "none:0"]
    st.close_finding("PM-A", "sensor.example_a", "2026-10-01")
    old_finding, _, nothing = pb.open_tasks()
    assert pb.source_gone(old_finding) and not pb.source_gone(nothing)


def test_the_store_owns_its_sql_and_an_incidents_states_have_one_spelling():
    # architecture review, 2026-10-07: nightly.py, problems.py and the night's tidy wrote SQL on the store's tables;
    # the desk spelt each incident state by hand and problems.py had its own "answered or cleared"
    import glob
    import os
    import re
    from helpers import ROOT, STARTER_SKILLS
    files = glob.glob(os.path.join(STARTER_SKILLS, "*", "scripts", "*.py")) + \
        [f for f in glob.glob(os.path.join(ROOT, "vesta_shared", "*.py")) if not f.endswith("store.py")] + \
        [os.path.join(ROOT, "vesta_agent", "housekeeping.py")]
    for f in files:
        src = open(f, encoding="utf-8").read()
        assert not re.search(r"\.db\.execute\(\s*[\"'](SELECT|UPDATE|DELETE|INSERT)", src), f
        assert not re.search(r"update_incident\([^)]*state=[\"']", src), f
