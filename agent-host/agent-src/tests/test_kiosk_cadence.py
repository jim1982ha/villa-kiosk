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
SAID = BEAT["cadence"]


def test_the_starter_skills_tell_the_agreements_sample(tmp_path):
    v = make_agent(tmp_path, {}, skills=("preventive-maintenance",))
    assert v.kiosk_cadence() == SAID == {"checkMinutes": 5, "nightlyAt": "02:00"}


def test_a_villa_that_moves_its_nightly_check_says_the_new_time(tmp_path):
    v = make_agent(tmp_path, {}, skills=("preventive-maintenance",))
    path = os.path.join(v.s.skills_dir, "preventive-maintenance", "skill.yaml")
    raw = yaml.safe_load(open(path))
    raw["schedule"][0]["when"] = "04:30"
    yaml.safe_dump(raw, open(path, "w"))
    assert v.kiosk_cadence() == {**SAID, "nightlyAt": "04:30"}     # read again at the next beat


def test_no_day_recheck_is_left_to_tell(tmp_path):
    # owner, 2026-10-20: no split — the day recheck at 08:00/12:00/16:00/20:00 is gone, every fault is read every 5
    # minutes, and a skill can no longer mark a job `kiosk: day_check`
    v = make_agent(tmp_path, {}, skills=("preventive-maintenance",))
    path = os.path.join(v.s.skills_dir, "preventive-maintenance", "skill.yaml")
    raw = yaml.safe_load(open(path))
    assert [j.get("kiosk") for j in raw["schedule"]] == ["nightly_check"] and "day_rechecks" not in raw
    raw["schedule"].append({"when": "12:00", "run": "recheck.py", "kiosk": "day_check"})
    yaml.safe_dump(raw, open(path, "w"))
    with pytest.raises(SkillError, match="kiosk 'day_check' must be one of nightly_check"):
        parse_skill("preventive-maintenance", os.path.dirname(path))


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
