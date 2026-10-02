"""The agent's own records by NAME (State, 0.6.21), not by raw keys.

Four key layouts (inc:, incmsg:, job:, saved_by_model:) were invented by four
modules, each parsing its own. They live in state.py now; the stored keys are
unchanged, so what an agent already holds is read with no migration.
"""
from __future__ import annotations

import os
import re

from helpers import ROOT

from vesta_agent.state import State


def _state(tmp_path) -> State:
    return State(str(tmp_path / "state.sqlite"))


def test_a_job_slot_is_claimed_once(tmp_path):
    s = _state(tmp_path)
    assert s.claim_job_slot("reports:0:07:00", "2026-10-03T07:00:00+08:00") is True
    assert s.claim_job_slot("reports:0:07:00", "2026-10-03T07:00:00+08:00") is False     # same slot: already ran
    assert s.claim_job_slot("reports:0:07:00", "2026-10-04T07:00:00+08:00") is True      # the next day's slot
    s.claim_job_slot("engine:pack", "2026-10-03T01:30:00+08:00")
    assert s.jobs_run() == [("engine:pack", "2026-10-03T01:30:00+08:00"), ("reports:0:07:00", "2026-10-04T07:00:00+08:00")]


def test_an_alerts_messages_are_remembered_listed_and_forgotten(tmp_path):
    s = _state(tmp_path)
    s.set_alert_skill(12, -100200, "alert-desk")
    s.remember_alert_message(12, -100200, 55, "Leak in the laundry")
    s.remember_alert_message(12, 3001, 9, "Leak in the laundry")
    s.remember_alert_message(13, 3001, 10, "Other")
    assert s.alert_skill(12, -100200) == "alert-desk" and s.alert_skill(12, 3001) is None
    assert sorted(s.alert_messages(12)) == [(-100200, 55, "Leak in the laundry"), (3001, 9, "Leak in the laundry")]
    assert s.is_alert_message(12, 3001, 9) and not s.is_alert_message(12, 3001, 10)
    s.forget_alert_message(12, 3001, 9)
    assert s.alert_messages(12) == [(-100200, 55, "Leak in the laundry")] and s.alert_messages(13)


def test_a_file_the_model_saved_is_known_as_its_own(tmp_path):
    s = _state(tmp_path)
    assert not s.saved_by_model("notes.json")
    s.mark_saved_by_model("notes.json")
    assert s.saved_by_model("notes.json") and not s.saved_by_model("facts.json")


def test_records_stored_before_the_named_records_are_read_as_they_were(tmp_path):
    # An agent updated in place keeps its sqlite file: the old raw keys must still answer.
    s = _state(tmp_path)
    s.put("job:engine:pack", "2026-10-02T01:30:00+08:00")
    s.put("inc:7:3001", "alert-desk")
    s.put("incmsg:7:3001:42", "An old alert")
    s.put("saved_by_model:old.json", "old.json")
    assert s.claim_job_slot("engine:pack", "2026-10-02T01:30:00+08:00") is False
    assert s.alert_skill(7, 3001) == "alert-desk" and s.alert_messages(7) == [(3001, 42, "An old alert")]
    assert s.saved_by_model("old.json")


def test_no_module_but_state_writes_these_key_layouts():
    owners = []
    for dirpath, _, files in os.walk(os.path.join(ROOT, "vesta_agent")):
        for f in files:
            if f.endswith(".py") and f != "state.py":
                text = open(os.path.join(dirpath, f), encoding="utf-8").read()
                if re.search(r'f?"(inc|incmsg|saved_by_model):|kv_prefix\(|state\.(get|put|drop)\(', text):
                    owners.append(f)
    assert owners == [], f"raw keys outside state.py: {owners}"
