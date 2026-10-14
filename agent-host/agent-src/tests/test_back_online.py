"""A device the night check found offline that is back closes its fault within minutes, not at the next night
(villa, 2026-10-10: "shelly integration (3 devices) has been offline for 9 h" stayed in the Cockpit all day while every
Shelly device had been back since noon). Invented entities."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import yaml

from helpers import PYTHONPATH, STARTER_SKILLS
from vesta_shared.problems import Problems
from vesta_shared.store import Store

SKILL = os.path.join(STARTER_SKILLS, "preventive-maintenance")
T0 = datetime(2026, 10, 10, 6, 0, tzinfo=timezone.utc)
ENTS = ["switch.relay_a", "sensor.pump_b_power", "sensor.pump_c_power"]


def _offline_finding(store) -> int:
    fid, _ = store.raise_finding("PM-UNAVAILABLE", ENTS[0], "integration_x", "2026-10-09", "P2",
                                 "x integration (3 devices) has been offline for 9 h.", {"hours": 9, "entities": ENTS})
    Problems(store).open_task("finding", fid, "PM-UNAVAILABLE", ENTS[0], "x integration offline")
    return fid


def _run(tmp_path, states: dict, now: datetime, not_found=()):
    fx = tmp_path / "fx"
    fx.mkdir(exist_ok=True)
    (fx / "states.json").write_text(json.dumps({"states": states, "not_found": list(not_found)}))
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "--store", str(tmp_path / "s.sqlite"),
                        "--fixture-dir", str(fx), "--now", now.isoformat()],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _st(state, minutes_ago, now=T0):
    return {"state": state, "last_changed": (now - timedelta(minutes=minutes_ago)).isoformat(), "attributes": {}}


def test_an_integration_back_online_closes_its_fault_with_its_task(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    fid = _offline_finding(store)
    one_still_down = {ENTS[0]: _st("off", 60), ENTS[1]: _st("0.0", 60), ENTS[2]: _st("unavailable", 60)}
    assert _run(tmp_path, one_still_down, T0)["actions"] == []
    just_back = {**one_still_down, ENTS[2]: _st("0.0", 3)}
    assert _run(tmp_path, just_back, T0)["actions"] == []                  # back 3 min ago: not yet
    # a device that reports again, its sensor still without a value ("unknown"), is back online
    out = _run(tmp_path, {**{e: _st("0.0", 15) for e in ENTS}, ENTS[2]: _st("unknown", 15)}, T0)
    assert [a["action"] for a in out["actions"]] == ["ticket.resolve"] and out["faults_changed"] is True
    assert Store(str(tmp_path / "s.sqlite")).finding(fid)["status"] == "closed"
    assert _run(tmp_path, {e: _st("0.0", 20) for e in ENTS}, T0)["actions"] == []        # closed once


def test_a_fault_about_a_device_deleted_from_home_assistant_closes_saying_so(tmp_path):
    # owner, 2026-10-14: a deleted light group's fault stayed open until 02:00, then read "Cleared: the nightly check
    # no longer sees it", as if the group had come back
    store = Store(str(tmp_path / "s.sqlite"))
    weak, _ = store.raise_finding("PM-BATTERY-LOW", "sensor.door_x_battery", "door_x", "2026-10-09", "P3",
                                  "Door X battery at 12%.", {})
    Problems(store).open_task("finding", weak, "PM-BATTERY-LOW", "sensor.door_x_battery", "Door X battery")
    off = _offline_finding(store)
    # read, but no state for it and Home Assistant never said "not found" (a timeout, a refusal): nothing closes
    assert _run(tmp_path, {ENTS[0]: _st("unavailable", 60)}, T0)["actions"] == []
    # the battery sensor deleted: its fault closes, saying why; one of the offline three deleted, the other two
    # still offline: that one stays open
    out = _run(tmp_path, {ENTS[0]: _st("unavailable", 60), ENTS[1]: _st("unavailable", 60)}, T0,
               not_found=["sensor.door_x_battery", ENTS[2]])
    assert [(a["action"], a["note"]) for a in out["actions"]] == [
        ("ticket.resolve", "Closed: it no longer exists in Home Assistant.")]
    st = Store(str(tmp_path / "s.sqlite"))
    assert st.finding(weak)["status"] == "closed" and st.finding(off)["status"] == "open"
    # the other two back: the offline one closes as back online, the deleted one counting as no longer offline
    out = _run(tmp_path, {ENTS[0]: _st("off", 30), ENTS[1]: _st("0.0", 30)}, T0, not_found=[ENTS[2]])
    assert [a["note"] for a in out["actions"]] == ["Cleared: back online."]


def test_the_check_runs_every_five_minutes_and_reads_nothing_when_nothing_is_offline(tmp_path):
    with open(os.path.join(SKILL, "skill.yaml"), encoding="utf-8") as f:
        assert yaml.safe_load(f)["every_5_min"] == "recheck.py"
    Store(str(tmp_path / "s.sqlite"))
    # no fixture folder at all: a read would fail — nothing offline, nothing read
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "--store", str(tmp_path / "s.sqlite"),
                        "--fixture-dir", str(tmp_path / "missing")],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=60)
    assert r.returncode == 0 and json.loads(r.stdout)["actions"] == []


def test_an_integration_down_finding_names_every_device_it_stands_for():
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import features as F
    groups = {k: {"entity_id": e, "hours": 9, "names": [e], "platform": "shelly", "critical": False}
              for k, e in zip(("a", "b", "c"), ENTS)}
    (merged,) = F.integration_down(groups, 3).values()
    assert merged["entity_ids"] == ENTS


def test_a_p2_back_again_is_told_at_once_with_how_often():
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import nightly
    said = nightly.told_now({"villa": "Example", "as_of": "2026-10-10", "new_findings": [], "again": [
                                                           {"severity": "P2", "summary": "Plug offline", "again": 2,
                                                            "check": "Look at the plug."},
                                                           {"severity": "P3", "summary": "Weak pump", "again": 1}]})
    # the night check's message in the one shape (review 30): its title as data, "Back again:", what to do
    (m,) = said
    assert m["title"] == "Example, night check on 10/10/2026." and \
        m["text"] == "Back again:\n- Plug offline (again: 3 times in 7 days)\nWhat to do: Look at the plug."


def test_the_night_runs_output_carries_those_messages(monkeypatch, capsys):
    # the caller, pinned: what main() prints is what the engine sends
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import nightly
    back = {"severity": "P2", "summary": "Plug offline", "again": 1, "check": "Look."}
    monkeypatch.setattr(nightly, "run", lambda args: {"as_of": "2026-10-10", "features_written": 0, "tasks_to_create": [],
                                                      "notes": [], "new_findings": [], "still_open": [], "closed": [],
                                                      "again": [back], "resolve_actions": []})
    nightly.main(["--pack", "p.json"])
    out = json.loads(capsys.readouterr().out)
    assert [m["text"] for m in out["send"]] == ["Back again:\n- Plug offline (again: 2 times in 7 days)\nWhat to do: Look."]
