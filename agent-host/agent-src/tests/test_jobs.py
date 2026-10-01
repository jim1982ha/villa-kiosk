"""AI jobs: named in their skill, configured in policy.yaml settings.jobs (owner, 2026-10-01).
Synthetic skills and data only."""
from __future__ import annotations

import asyncio
import os

import pytest
import yaml

from helpers import copy_skill, settings
from test_telegram_events import BOT, FakeReader, FakeTelegram
from vesta_agent import runner
from vesta_agent.app import Vesta
from vesta_agent.kiosk import Kiosk
from vesta_agent.policy import Person, Policy, problems
from vesta_agent.routing import Origin
from vesta_agent.skills import SkillError, Skills, ai_jobs

GROUP, ASKER = -100555, 444


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def agent(tmp_path, monkeypatch):
    s = settings(str(tmp_path), VESTA_TELEGRAM_ENABLED="true", VESTA_TELEGRAM_BOT_TOKEN="42:TG-TEST")
    with open(s.policy_path, "w") as f:
        yaml.safe_dump({"people": [{"telegram_id": ASKER, "name": "Asker", "role": "fm"}],
                        "chats": {"owner": GROUP, "fm": GROUP},
                        "settings": {"jobs": {"fm-weekly": {"profile": "performance", "limit_usd": 2.5}}}}, f)
    copy_skill("reports", s.skills_dir)
    v = Vesta(s, telegram=FakeTelegram(), reader=FakeReader(), kiosk=Kiosk("", ""))
    v.bot_username = BOT["username"]
    v.runs, v.code = [], []

    async def fake_run(settings_, system, prompt, server, allowed, state, who, resume=None, limit_usd=None, profile=None):
        v.runs.append({"who": who, "limit": limit_usd, "profile": profile, "prompt": prompt})
        return runner.RunResult("", None, v.stop_at_limit, 2.5, [], None)
    v.stop_at_limit = False
    monkeypatch.setattr(runner, "run", fake_run)

    async def fake_code(skill, command, timeout=900, values=None, origin=None):
        v.code.append((command.split()[0], values, origin))
        return {}
    v.run_code_job = fake_code
    v.server_tools = [{"name": "ha_get_state"}]
    return v


def job(v, name):
    return next(j for sk, j in ai_jobs(v.skills.all()) if j["name"] == name)


def test_a_job_policy_yaml_does_not_name_does_not_run(agent, caplog):
    sk = agent.skills.get("reports")
    run(agent.run_model_job(sk, job(agent, "fm-daily")))
    assert agent.runs == []
    assert any("fm-daily" in r.getMessage() and "not set in policy.yaml" in r.getMessage() for r in caplog.records)


def test_a_set_job_runs_with_its_own_brain_and_limit(agent):
    run(agent.run_model_job(agent.skills.get("reports"), job(agent, "fm-weekly")))
    (r,) = agent.runs
    assert (r["profile"], r["limit"], r["who"]) == ("performance", 2.5, "job:fm-weekly")
    assert agent.code == []                                               # finished within its limit


def test_at_its_limit_a_report_job_still_sends_its_page(agent):
    agent.stop_at_limit = True
    run(agent.run_model_job(agent.skills.get("reports"), job(agent, "fm-weekly")))
    (cmd, values, origin), = agent.code
    assert cmd == "compose.py" and values["to"] == "fm" and values["limit"] == "2.5" and values["started"]
    agent.code.clear()
    run(agent.run_model_job(agent.skills.get("reports"), job(agent, "fm-weekly"), Origin(ASKER)))
    (cmd, values, origin), = agent.code
    assert values["to"] == "here" and origin == Origin(ASKER)               # asked in a chat: back to that chat
    assert "everything you send goes to that chat" in agent.runs[-1]["prompt"]


def test_a_report_asked_for_in_a_chat_runs_as_its_job(agent):
    async def go():
        msg = await agent.start_job("fm-weekly", ASKER)
        await asyncio.sleep(0.05)
        return msg
    msg = run(go())
    assert msg.startswith("Started fm-weekly") and agent.runs[-1]["profile"] == "performance"
    assert run(agent.start_job("fm-daily", ASKER)).startswith("There is no job")      # not on_request
    tb = agent.toolbox()
    person = Person(ASKER, "Asker", "fm")
    assert "start_job" in [t.name for t in tb.tool_objects(person, ASKER, False)]
    assert "start_job" not in [t.name for t in tb.tool_objects(None, ASKER, False)]    # a job never starts a job


def test_a_job_asked_for_in_a_chat_sends_only_to_that_chat(agent):
    """The group asks for the weekly: its page and the owner lines its steps address to fm and owner all
    come back to the group, never to the fm or owner chat (owner, 2026-10-01)."""
    async def go():
        await agent.start_job("fm-weekly", ASKER)
        await asyncio.sleep(0.05)
    run(go())
    tb = agent.toolbox()
    send = next(t for t in tb.tool_objects(None, ASKER, False, requested=True) if t.name == "send_message")
    assert send.input_schema["properties"]["to"]["enum"] == ["here"]
    for to in ("fm", "owner", "here"):
        assert not run(send.handler({"to": to, "text": f"weekly for {to}"})).get("is_error")
    assert [c for c, text, _ in agent.tg.sent if text.startswith("weekly")] == [ASKER, ASKER, ASKER]
    # a script's own messages too (outcome.carry_out through the same rule)
    agent.tg.sent.clear()
    run(agent.outcome.carry_out({"send": [{"to": "fm", "text": "from the script"}]}, "reports", Origin(ASKER, requested=True)))
    assert [c for c, *_ in agent.tg.sent] == [ASKER]
    # a person answered in a chat keeps owner and fm: only a requested job is held to its chat
    plain = next(t for t in tb.tool_objects(Person(ASKER, "Asker", "fm"), ASKER, False) if t.name == "send_message")
    assert plain.input_schema["properties"]["to"]["enum"] == ["here", "owner", "fm"]


def test_an_ai_job_without_a_name_switches_its_skill_off(tmp_path):
    d = tmp_path / "s" / "pool-care"
    (d / "scripts").mkdir(parents=True)
    (d / "SKILL.md").write_text("# x\n")
    (d / "skill.yaml").write_text(yaml.safe_dump({"description": "x", "schedule": [{"when": "07:00", "prompt": "do it"}]}))
    sk = Skills(str(tmp_path / "s"))
    assert sk.all() == {} and "needs a name" in sk.problems()["pool-care"]


def test_settings_jobs_in_policy_yaml():
    p = Policy({"settings": {"jobs": {"a": {"profile": "economy", "limit_usd": 1}, "b": {"profile": "huge", "limit_usd": 1},
                                      "c": {"profile": "auto", "limit_usd": 0.01}}}})
    assert p.jobs == {"a": {"profile": "economy", "limit_usd": 1.0}}       # the agent: lenient, b and c do not run
    out = problems({"settings": {"jobs": {"b": {"profile": "huge", "limit_usd": 1}, "c": {"profile": "auto", "limit_usd": 0.01},
                                          "d": {"profile": "auto", "limit_usd": 1, "model": "x"}}}})
    assert any("jobs.b.profile" in x for x in out) and any("jobs.c.limit_usd" in x for x in out)
    assert any("jobs.d must give profile and limit_usd only" in x for x in out)
