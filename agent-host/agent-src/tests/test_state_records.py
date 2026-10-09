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


def test_an_incidents_message_is_one_record_per_chat(tmp_path):
    s = _state(tmp_path)
    s.set_alert_skill(12, -100200, "alert-desk")
    s.set_incident_message(12, -100200, {"mid": 55, "text": "Leak", "buttons": True, "settled": False})
    s.set_incident_message(12, 3001, {"mid": 9, "text": "Leak", "buttons": False, "settled": False})
    s.set_incident_message(12, 3001, {"mid": 11, "text": "Leak, reminder", "buttons": True, "settled": False})
    s.set_incident_message(13, 3001, {"mid": 10, "text": "Other", "buttons": False, "settled": False})
    assert s.alert_skill(12, -100200) == "alert-desk" and s.alert_skill(12, 3001) is None
    assert [(c, r["mid"]) for c, r in s.incident_chats(12)] == [(-100200, 55), (3001, 11)]     # the latest, once per chat
    assert s.incident_message(13, 3001)["text"] == "Other"


def test_the_two_old_record_families_become_one_record_per_chat(tmp_path):
    # 0.12.106–0.12.114 kept incmsg: (messages with the buttons) and inclast: (the latest message), two lifetimes,
    # inclast: never pruned (architecture review 12): an agent updated in place keeps what its chats show
    from vesta_agent.state import State
    path = str(tmp_path / "s.sqlite")
    s = State(path)
    s.put("incmsg:7:3001:42", "An old alert")
    s.put("inclast:7:3001:42", "")
    s.put("inclast:7:3001:50", "")
    s.put("inclast:7:-100:44", "")
    s.put("incmsg:8:3001:60", "Another")
    s = State(path)                                                          # the next start migrates them
    assert s.incident_message(7, 3001) == {"mid": 50, "text": "", "buttons": False, "settled": False}
    assert s.incident_message(7, -100)["mid"] == 44
    assert s.incident_message(8, 3001) == {"mid": 60, "text": "Another", "buttons": True, "settled": False}
    assert s.kv_prefix("incmsg:") == {} and s.kv_prefix("inclast:") == {}


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
    s.put("saved_by_model:old.json", "old.json")
    assert s.claim_job_slot("engine:pack", "2026-10-02T01:30:00+08:00") is False
    assert s.alert_skill(7, 3001) == "alert-desk"
    assert s.saved_by_model("old.json")


def test_no_module_but_state_writes_these_key_layouts():
    owners = []
    for dirpath, _, files in os.walk(os.path.join(ROOT, "vesta_agent")):
        for f in files:
            if f.endswith(".py") and f != "state.py":
                text = open(os.path.join(dirpath, f), encoding="utf-8").read()
                if re.search(r'f?"(inc|incmsg|inclast|incthread|hasent|saved_by_model):|kv_prefix\(|state\.(get|put|drop)\(', text):
                    owners.append(f)
    assert owners == [], f"raw keys outside state.py: {owners}"


def test_an_alerts_button_records_are_kept_as_long_as_the_other_records(tmp_path):
    # architecture review, 2026-10-07: inc: / incmsg: keys were written for every alert and never deleted
    from datetime import datetime, timedelta, timezone
    from vesta_agent.state import State
    st = State(str(tmp_path / "s.sqlite"))
    st.set_alert_skill(1, -100, "alert-desk")
    st.set_incident_message(1, -100, {"mid": 55, "text": "Door open", "buttons": True, "settled": False})
    st.put("job:x", "2026-10-01")
    soon = (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()
    st.prune(runs_before="1970", records_before=soon)
    assert st.alert_skill(1, -100) is None and st.incident_chats(1) == []
    assert st.get("job:x") == "2026-10-01"                          # the scheduler's slots are not records


def test_a_state_file_from_before_gains_the_keys_date(tmp_path):
    import sqlite3
    path = str(tmp_path / "old.sqlite")
    db = sqlite3.connect(path)
    db.execute("create table kv(k text primary key, v text)")
    db.execute("insert into kv values('inc:1:-100', 'alert-desk')")
    db.commit(); db.close()
    from vesta_agent.state import State
    st = State(path)
    assert st.alert_skill(1, -100) == "alert-desk"                  # kept, its clock started now


def test_every_record_family_has_a_declared_lifetime(tmp_path):
    # architecture review 16: saved_by_model:, owner_told: and the job slots were never deleted, inc: and incthread:
    # were by name — each family had its own way, or none. Every record the state writes is in KV_FAMILIES, and prune
    # deletes exactly the RECORDS ones once old.
    from datetime import datetime, timedelta, timezone
    from vesta_agent.state import CURRENT, KV_FAMILIES, RECORDS
    s = _state(tmp_path)
    s.set_alert_skill(1, -100, "alert-desk")
    s.set_incident_message(1, -100, {"mid": 5, "text": "x", "buttons": True, "settled": False})
    s.note_ha_sent("ctx", -100, 9)
    s.mark_saved_by_model("runs/fm-weekly-1/notes.json")
    s.mark_owner_told("credit", "2026-10-01T00:00:00+00:00")
    s.claim_job_slot("reports:0:Mon 08:00", "2026-10-05T08:00:00+08:00")
    s.set_siren_stop("2026-10-05T08:00:00+00:00")
    keys = [r[0] for r in s.db.execute("select k from kv")]
    undeclared = [k for k in keys if not any(k.startswith(p) for p in KV_FAMILIES)]
    assert undeclared == [], f"a record family with no declared lifetime: {undeclared}"
    assert all(r[0] for r in s.db.execute("select at from kv")), "a record without its date cannot be pruned"
    soon = (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()
    s.prune(runs_before="1970", records_before=soon)
    left = {k for (k,) in s.db.execute("select k from kv")}
    assert all(KV_FAMILIES[p] == CURRENT for p in KV_FAMILIES if any(k.startswith(p) for k in left))
    assert not any(k.startswith(p) for k in left for p, life in KV_FAMILIES.items() if life == RECORDS)
    assert s.get("listening_since") and s.jobs_run()                               # what is current stays
    # the ones that piled up: an alert's records, Home Assistant's messages, every file the AI saved, the owner's pauses
    assert not any(k.startswith(("inc:", "incthread:", "hasent:", "saved_by_model:", "owner_told:")) for k in left)


def test_when_the_agent_started_listening_does_not_move_with_housekeeping(tmp_path):
    # read as the oldest record kept, it moved forward each night as housekeeping deleted old records
    from vesta_agent.state import State
    from vesta_shared import agent_records
    path = str(tmp_path / "s.sqlite")
    s = State(path)
    s.drop("listening_since")                                                     # an agent from before 0.6.115
    s.db.execute("insert into calls(at, kind, detail) values('2026-01-01T00:00:00+00:00', 'run', '{}')")
    s.db.commit()
    s = State(path)                                                               # it starts again: kept from its records
    s.db.execute("delete from calls")                                             # housekeeping, months later
    s.db.commit()
    assert agent_records.listening_since(path).isoformat() == "2026-01-01T00:00:00+00:00"
