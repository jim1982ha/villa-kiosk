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
    assert v.kiosk_cadence() == {**BEAT["cadence"], "nightlyAt": "04:30"}   # read again at the next beat


def test_the_day_recheck_times_are_the_skills_day_check_jobs(tmp_path):
    # owner, 2026-10-19: "make sure you update the `Next check:` section accordingly" — the Kiosk is told the times of
    # the jobs the skill marks `kiosk: day_check`, read at each beat; none, and the cadence says none
    v = make_agent(tmp_path, {}, skills=("preventive-maintenance",))
    path = os.path.join(v.s.skills_dir, "preventive-maintenance", "skill.yaml")
    raw = yaml.safe_load(open(path))
    days = [j for j in raw["schedule"] if j.get("kiosk") == "day_check"]
    assert sorted(j["when"] for j in days) == BEAT["cadence"]["dayChecksAt"]
    assert all(j["run"] == "recheck.py day" and not j.get("prompt") for j in days)      # code only: no AI
    days[0]["when"] = "07:30"
    yaml.safe_dump(raw, open(path, "w"))
    assert v.kiosk_cadence()["dayChecksAt"] == sorted(["07:30"] + BEAT["cadence"]["dayChecksAt"][1:])
    raw["schedule"] = [j for j in raw["schedule"] if j.get("kiosk") != "day_check"]
    yaml.safe_dump(raw, open(path, "w"))
    assert v.kiosk_cadence() == {k: x for k, x in BEAT["cadence"].items() if k != "dayChecksAt"}
    # and no card says "day" any more: with no day recheck, its rules are read at night (Skill.day_checked)
    sk = v.skills.all()["preventive-maintenance"]
    assert sk.day_rechecks and sk.day_checked == []


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


def _beating(answer: dict) -> Kiosk:
    k = Kiosk("http://kiosk.invalid", "t")

    async def req(method, path, body=None):
        return 200, dict(answer)
    k._req = req
    return k


@pytest.mark.parametrize("minutes, every", [(1, 30.0), (6, 120.0), (15, 300.0)])
def test_the_interval_follows_the_kiosks_window(minutes, every):
    # architecture review, 2026-10-19: 120 s was typed, the answer thrown away — a Kiosk set to "offline after 1 minute"
    # flipped the agent online and offline every cycle. A third of the window, never under 30 s
    k = _beating({"ok": True, "offline_after_minutes": minutes})
    first = k.every                                              # before any answer: the interval it starts with
    asyncio.run(k.heartbeat())
    assert (first, k.every) == (120, every)


def test_an_answer_without_a_window_keeps_the_interval():
    k = _beating({"ok": True, "offline_after_minutes": 1})
    asyncio.run(k.heartbeat())
    k._req = _beating({"ok": True})._req
    asyncio.run(k.heartbeat())
    assert k.every == 30.0


def test_a_refused_cadence_is_said_once_and_the_beat_counts(caplog):
    k = _beating({"ok": True, "offline_after_minutes": 6, "cadence": "refused: checkMinutes 1-1440"})
    with caplog.at_level("WARNING", logger="vesta.kiosk"):
        for _ in range(3):
            asyncio.run(k.heartbeat("all quiet", BEAT["cadence"]))
    said = [r for r in caplog.records if "did not take" in r.getMessage()]
    assert len(said) == 1 and "refused: checkMinutes" in said[0].getMessage() and k.every == 120.0


def test_the_loop_waits_the_interval_the_answer_set(monkeypatch):
    import vesta_agent.kiosk as K
    k = _beating({"ok": True, "offline_after_minutes": 1})
    waited = []

    async def run():
        stop = asyncio.Event()

        async def wait_for(aw, timeout):
            waited.append(timeout)
            aw.close()
            stop.set()
            raise asyncio.TimeoutError
        monkeypatch.setattr(K.asyncio, "wait_for", wait_for)
        await k.heartbeats(stop)
    asyncio.run(run())
    assert waited == [30.0]
