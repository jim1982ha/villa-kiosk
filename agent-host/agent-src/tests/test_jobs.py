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
from vesta_agent.routing import CONVERSATION, JOB, Origin
from vesta_agent.skills import SkillError, Skills, ai_jobs

GROUP, ASKER = -100555, 444


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def agent(tmp_path, monkeypatch):
    s = settings(str(tmp_path), VESTA_TELEGRAM_ENABLED="true", VESTA_TELEGRAM_BOT_TOKEN="42:TG-TEST")
    with open(s.policy_path, "w") as f:
        yaml.safe_dump({"people": [{"telegram_id": ASKER, "name": "Asker", "role": "fm"}],
                        "chats": {"owner": GROUP, "fm": GROUP}, "ha_read_tools": ["ha_get_state"],
                        "settings": {"jobs": {"fm-weekly": {"profile": "performance", "limit_usd": 2.5}}}}, f)
    copy_skill("reports", s.skills_dir)
    v = Vesta(s, telegram=FakeTelegram(), reader=FakeReader(), kiosk=Kiosk("", ""))
    v.bot_username = BOT["username"]
    v.runs, v.code = [], []

    async def fake_run(settings_, system, prompt, server, allowed, state, who, resume=None, limit_usd=None, profile=None, asked=None):
        v.runs.append({"who": who, "limit": limit_usd, "profile": profile, "prompt": prompt})
        return runner.RunResult("", None, v.stop_at_limit, 2.5, [], None)
    v.stop_at_limit = False
    monkeypatch.setattr(runner, "run", fake_run)

    async def fake_code(skill, command, timeout=900, values=None, origin=None):
        v.code.append((command.split()[0], values, origin))
        return {}
    v.run_code_job = fake_code
    v.server_tools = [{"name": "ha_get_state", "annotations": {"readOnlyHint": True}}]   # as HA MCP lists it
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
    run(agent.run_model_job(agent.skills.get("reports"), job(agent, "fm-weekly"), Origin(ASKER, JOB)))
    (cmd, values, origin), = agent.code
    assert values["to"] == "here" and origin == Origin(ASKER, JOB)               # asked in a chat: back to that chat
    assert "asked for in a chat" in agent.runs[-1]["prompt"]


def test_a_report_asked_for_in_a_chat_runs_as_its_job(agent):
    async def go():
        msg = await agent.start_job("fm-weekly", ASKER)
        await asyncio.sleep(0.05)
        return msg
    msg = run(go())
    assert msg.startswith("Started fm-weekly") and agent.runs[-1]["profile"] == "performance"
    assert run(agent.start_job("no-such-job", ASKER)).startswith("There is no job")
    assert "not set up yet" in run(agent.start_job("fm-daily", ASKER))                # asked for, not in policy.yaml
    tb = agent.toolbox()
    person = Person(ASKER, "Asker", "fm")
    assert "start_job" in [t.name for t in tb.tool_objects(person, Origin(ASKER, CONVERSATION))]
    assert "start_job" not in [t.name for t in tb.tool_objects(None, Origin(ASKER, JOB))]
    # only a conversation may start a job — never a job, even one a person asked for
    assert "start_job" not in [t.name for t in tb.tool_objects(person, Origin(ASKER, JOB))]    # a job never starts a job


def test_a_job_asked_for_in_a_chat_sends_only_to_that_chat(agent):
    """The group asks for the weekly: its page and the owner lines its steps address to fm and owner all
    come back to the group, never to the fm or owner chat (owner, 2026-10-01)."""
    async def go():
        await agent.start_job("fm-weekly", ASKER)
        await asyncio.sleep(0.05)
    run(go())
    tb = agent.toolbox()
    send = next(t for t in tb.tool_objects(None, Origin(ASKER, JOB)) if t.name == "send_message")
    assert send.input_schema["properties"]["to"]["enum"] == ["here"]
    for to in ("fm", "owner", "here"):
        assert not run(send.handler({"to": to, "text": f"weekly for {to}"})).get("is_error")
    assert [c for c, text, _ in agent.tg.sent if text.startswith("weekly")] == [ASKER, ASKER, ASKER]
    # a script's own messages too (outcome.carry_out through the same rule)
    agent.tg.sent.clear()
    run(agent.outcome.carry_out({"send": [{"to": "fm", "text": "from the script"}]}, "reports", Origin(ASKER, JOB)))
    assert [c for c, *_ in agent.tg.sent] == [ASKER]
    # a person answered in a chat: their chat only, whatever the skill's steps name (villa, 2026-10-01 17:31)
    plain = next(t for t in tb.tool_objects(Person(ASKER, "Asker", "fm"), Origin(ASKER, CONVERSATION)) if t.name == "send_message")
    assert plain.input_schema["properties"]["to"]["enum"] == ["here"]
    agent.tg.sent.clear()
    assert not run(plain.handler({"to": "fm", "text": "the weekly"})).get("is_error")
    assert [c for c, *_ in agent.tg.sent] == [ASKER]
    # a scheduled job (no chat) sends to owner or fm
    sched = next(t for t in tb.tool_objects(None, None) if t.name == "send_message")
    assert sched.input_schema["properties"]["to"]["enum"] == ["owner", "fm"]


def test_a_report_asked_for_in_a_chat_cannot_be_made_inside_the_conversation(agent):
    # villa, 2026-10-01 17:31: the AI made the weekly itself in the group's conversation instead of starting
    # the job; the skill marks the report commands job_only, so in a chat they point to start_job
    tb = agent.toolbox()
    script = next(t for t in tb.tool_objects(Person(ASKER, "Asker", "fm"), Origin(ASKER, CONVERSATION)) if t.name == "run_skill_script")
    res = run(script.handler({"skill": "reports", "script": "facts.py", "args": ["fm-weekly", "--energy", "week.json"]}))
    assert res.get("is_error") and "call start_job with name fm-weekly" in res["content"][0]["text"]
    # the job itself (no person) runs it
    job = next(t for t in tb.tool_objects(None, Origin(ASKER, JOB)) if t.name == "run_skill_script")
    res = run(job.handler({"skill": "reports", "script": "facts.py", "args": ["fm-weekly", "--energy", "week.json"]}))
    assert "start_job" not in res["content"][0]["text"]


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


def test_every_report_a_person_may_ask_for_runs_as_its_job():
    # owner, 2026-10-01: "handled consistently" — every AI job a person may ask for is tied to the
    # commands that make it (job_only), so in a chat it can only be started as its job, never made inline
    from helpers import STARTER_SKILLS
    for sk in Skills(STARTER_SKILLS).all().values():
        tied = {job for spec in sk.scripts.values() for job in spec["job_only"].values()}
        for j in sk.schedule:
            if j.get("on_request"):
                assert j["name"] in tied, f"{sk.name}: {j['name']} may be asked for but no command is job_only for it"



def _asked_in_chat(agent, tmp_path, monkeypatch, page: bool, job_name: str = "fm-weekly", text_only: bool = False):
    """The person asks in the chat; the conversation starts the job and replies; the job (a moment later)
    sends its page — or ends without one."""
    page_path = os.path.join(agent.s.out_dir, "fm_weekly.html")
    open(page_path, "w").write("<html></html>")

    async def fake_run(settings_, system, prompt, server, allowed, state, who, resume=None, limit_usd=None, profile=None, asked=None):
        if who.startswith("job:"):
            await asyncio.sleep(0.02)                    # the job takes a while
            if page:
                # through the job's own send_message tool, as the model sends its result
                send = next(t for t in agent.toolbox().tool_objects(None, Origin(ASKER, JOB)) if t.name == "send_message")
                await send.handler({"to": "here", "text": "Three things need attention.",
                                    **({} if text_only else {"attachment": "fm_weekly.html"})})
            return runner.RunResult("", None, False, 0.1, [], None)
        await agent.start_job(job_name, ASKER)           # what the start_job tool does
        return runner.RunResult("Your weekly report is on its way.", None, False, 0.01, [], None)
    monkeypatch.setattr(runner, "run", fake_run)

    async def go():
        await agent.converse(ASKER, Person(ASKER, "Asker", "fm"), "/ask the weekly report")
        await asyncio.sleep(0.1)
    run(go())
    return agent.tg


def test_a_report_asked_for_in_a_chat_is_one_message_replaced_by_the_page(agent, tmp_path, monkeypatch):
    # owner, 2026-10-04: "I don't want to see 3 messages … reply with 1 message when the report is being
    # generated, and replace it with the final notification": the waiting message goes when the page comes
    tg = _asked_in_chat(agent, tmp_path, monkeypatch, page=True)
    waiting = next(i for i, (c, text, _) in enumerate(tg.sent) if "on its way" in text)
    waiting_id = 1001 + waiting
    assert tg.deleted == [(ASKER, waiting_id)]
    assert [text for _, text, _ in tg.sent] == ["Your weekly report is on its way.", "Three things need attention."]


def test_a_job_that_ends_without_its_page_says_so_in_the_waiting_message(agent, tmp_path, monkeypatch):
    tg = _asked_in_chat(agent, tmp_path, monkeypatch, page=False)
    assert tg.deleted == []
    assert len(tg.edits) == 1 and "ended without a result" in tg.edits[0][2]


def test_a_requested_weekly_sends_only_the_page():
    import yaml as _y
    from helpers import STARTER_SKILLS
    jobs = _y.safe_load(open(os.path.join(STARTER_SKILLS, "reports", "skill.yaml")))["schedule"]
    weekly = next(j for j in jobs if j["name"] == "fm-weekly")["prompt"]
    assert "On schedule only" in weekly and "send nothing else" in weekly


def test_every_report_asked_for_in_a_chat_replaces_its_waiting_message(agent, tmp_path, monkeypatch):
    # owner, 2026-10-04: "make sure this is applied for all report messages": the daily digest is TEXT, not
    # a page, and its waiting message must go all the same
    agent.policy().jobs["fm-daily"] = {"profile": "economy", "limit_usd": 1}
    tg = _asked_in_chat(agent, tmp_path, monkeypatch, page=True, job_name="fm-daily", text_only=True)
    assert len(tg.deleted) == 1 and [t for _, t, _ in tg.sent] == ["Your weekly report is on its way.", "Three things need attention."]


def test_every_job_asked_for_in_a_chat_uses_the_same_one_message_rule():
    # all of them, by construction: the rule is the engine's, keyed on the job, not on a report
    from helpers import STARTER_SKILLS
    import yaml as _y
    names = [j["name"] for f in sorted(os.listdir(STARTER_SKILLS))
             if os.path.exists(os.path.join(STARTER_SKILLS, f, "skill.yaml"))
             for j in (_y.safe_load(open(os.path.join(STARTER_SKILLS, f, "skill.yaml"))) or {}).get("schedule") or []
             if isinstance(j, dict) and j.get("on_request")]
    assert names == ["fm-daily", "fm-weekly", "owner-monthly"], names
