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


def _run(tmp_path, states: dict, now: datetime):
    fx = tmp_path / "fx"
    fx.mkdir(exist_ok=True)
    (fx / "states.json").write_text(json.dumps({"states": states}))
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
    out = _run(tmp_path, {e: _st("0.0", 15) for e in ENTS}, T0)
    assert [a["action"] for a in out["actions"]] == ["ticket.resolve"] and out["faults_changed"] is True
    assert Store(str(tmp_path / "s.sqlite")).finding(fid)["status"] == "closed"
    assert _run(tmp_path, {e: _st("0.0", 20) for e in ENTS}, T0)["actions"] == []        # closed once


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
