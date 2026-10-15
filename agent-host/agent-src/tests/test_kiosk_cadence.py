"""The agent's own timing, told to the Kiosk in its heartbeat (agent-contract.json `heartbeat`, architecture review
2026-10-15): the Kiosk's Overview (i) said "checks every 5 minutes, nightly check at 02:00 by default" whatever the villa
had set. The skill names its nightly job (`kiosk: nightly_check`); the engine reads it at every beat."""
from __future__ import annotations

import asyncio
import json
import os

import pytest
import yaml

from helpers import make_agent
from vesta_agent.kiosk import Kiosk
from vesta_agent.skills import SkillError, parse_skill

CONTRACT = os.path.join(os.path.dirname(__file__), "..", "..", "rootfs", "opt", "vesta", "host", "agent-contract.json")
BEAT = json.load(open(CONTRACT))["heartbeat"]["sample"]


def test_the_starter_skills_tell_the_agreements_sample(tmp_path):
    v = make_agent(tmp_path, {}, skills=("preventive-maintenance",))
    assert v.kiosk_cadence() == BEAT["cadence"]                    # every 5 minutes, nightly at 02:00


def test_a_villa_that_moves_its_nightly_check_says_the_new_time(tmp_path):
    v = make_agent(tmp_path, {}, skills=("preventive-maintenance",))
    path = os.path.join(v.s.skills_dir, "preventive-maintenance", "skill.yaml")
    raw = yaml.safe_load(open(path))
    raw["schedule"][0]["when"] = "04:30"
    yaml.safe_dump(raw, open(path, "w"))
    assert v.kiosk_cadence() == {"checkMinutes": 5, "nightlyAt": "04:30"}   # read again at the next beat


def test_without_a_nightly_job_no_number_is_told(tmp_path):
    v = make_agent(tmp_path, {}, skills=("alert-desk",))
    assert v.kiosk_cadence() is None


def test_kiosk_names_only_what_the_kiosk_knows(tmp_path):
    d = tmp_path / "x"
    (d / "scripts").mkdir(parents=True)
    (d / "scripts" / "a.py").write_text("print(1)\n")
    (d / "SKILL.md").write_text("---\nname: x\ndescription: x\n---\nx\n")
    for when, kiosk in (("02:00", "weekly_report"), ("Mon 02:00", "nightly_check")):
        (d / "skill.yaml").write_text(yaml.safe_dump({"description": "x", "scripts": {"a.py": {}},
                                                      "schedule": [{"when": when, "run": "a.py", "kiosk": kiosk}]}))
        with pytest.raises(SkillError, match="kiosk"):
            parse_skill("x", str(d))


def test_the_heartbeat_carries_it():
    sent = []
    k = Kiosk("http://kiosk.invalid", "t")

    async def req(method, path, body=None):
        sent.append((path, body))
        return 200, {}
    k._req = req
    asyncio.run(k.heartbeat("all quiet", BEAT["cadence"]))
    asyncio.run(k.heartbeat())
    assert sent == [("/agent/v1/heartbeat", BEAT), ("/agent/v1/heartbeat", None)]
