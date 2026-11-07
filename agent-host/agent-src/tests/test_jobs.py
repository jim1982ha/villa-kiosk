"""AI jobs: named in their skill, run with their skill's one brain and limit, policy.yaml settings.skill_ai (owner,
2026-10-01; one pair a skill: 2026-10-20).
Synthetic skills and data only."""
from __future__ import annotations

import asyncio
import re
import os

import pytest
import yaml

from helpers import make_agent
from ai_fake import FakeAI
from telegram_fake import BOT
from ha_fake import FakeHA, tool
from vesta_agent import runner
from vesta_agent.policy import Policy, problems
from vesta_agent.roster import Person
from vesta_agent.routing import CONVERSATION, JOB, Origin
from vesta_agent.skills import ai_jobs
from vesta_agent.roster import Roster

GROUP, ASKER = -100555, 444


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def agent(tmp_path, monkeypatch):
    v = make_agent(tmp_path, {"ha_read_tools": ["ha_get_state"], "settings": {"skill_ai": {"reports": {"brain": "performance", "limit_usd": 2.5}}}}, roster=Roster.of(owner=[(GROUP, "Owner chat")], fm=[(ASKER, "Asker"), (GROUP, "Facility manager chat")]),
                   skills=["reports"], reader=FakeHA(tools=[tool("ha_get_state")]))
    v.bot_username = BOT["username"]
    v.code = []
    v.stop_at_limit = False
    v.runs = FakeAI(lambda run: runner.RunResult("", None, v.stop_at_limit, 2.5, [], None)).install(monkeypatch).runs

    async def fake_code(skill, command, timeout=900, values=None, origin=None):
        v.code.append((command.split()[0], values, origin))
        return {}
    v.run_code_job = fake_code

    async def fake_steps(settings, state, skills, outcome, skill, steps, values, origin=None, language=None):
        # a job's code steps (job_steps.py): recorded, not run
        for st in steps:
            v.code.append((st["run"].split()[0], values, origin))
        from vesta_agent.job_steps import Done
        return Done(0, None)
    import vesta_agent.job_steps as job_steps
    monkeypatch.setattr(job_steps, "run", fake_steps)
    v.server_tools = [{"name": "ha_get_state", "annotations": {"readOnlyHint": True}}]   # as HA MCP lists it
    return v


def job(v, name):
    return next(j for sk, j in ai_jobs(v.skills.all()) if j["name"] == name)


def _unset(agent):
    """The villa's rules without the reports skill's AI jobs set."""
    raw = yaml.safe_load(open(agent.s.policy_path)) or {}
    raw["settings"].pop("skill_ai", None)
    with open(agent.s.policy_path, "w") as f:
        yaml.safe_dump(raw, f)
    os.utime(agent.s.policy_path, (os.path.getmtime(agent.s.policy_path) + 5,) * 2)


def test_a_job_whose_skill_policy_yaml_does_not_set_does_not_run(agent, caplog):
    _unset(agent)
    sk = agent.skills.get("reports")
    run(agent.jobs.run(sk, job(agent, "fm-daily")))
    assert agent.runs == []
    assert any("fm-daily" in r.getMessage() and "not set in policy.yaml" in r.getMessage() for r in caplog.records)
    assert "not set up yet" in run(agent.jobs.start("fm-weekly", ASKER))              # asked for, not set


def test_every_job_of_a_set_skill_runs_with_its_one_brain_and_limit(agent):
    for name in ("fm-weekly", "fm-daily"):
        run(agent.jobs.run(agent.skills.get("reports"), job(agent, name)))
    assert [(r["profile"], r["limit_usd"], r["who"]) for r in agent.runs] == [
        ("performance", 2.5, "job:fm-weekly"), ("performance", 2.5, "job:fm-daily")]
    assert agent.code == []                                               # finished within its limit


def test_at_its_limit_a_report_job_still_sends_its_page(agent):
    agent.stop_at_limit = True
    run(agent.jobs.run(agent.skills.get("reports"), job(agent, "fm-weekly")))
    (cmd, values, origin), = agent.code
    assert cmd == "compose.py" and values["to"] == "fm" and values["limit"] == "2.5" and values["started"]
    agent.code.clear()
    run(agent.jobs.run(agent.skills.get("reports"), job(agent, "fm-weekly"), Origin(ASKER, JOB)))
    (cmd, values, origin), = agent.code
    assert values["to"] == "here" and origin == Origin(ASKER, JOB)               # asked in a chat: back to that chat
    assert "asked for in a chat" in agent.runs[-1]["prompt"]


def test_a_report_asked_for_in_a_chat_runs_as_its_job(agent):
    async def go():
        msg = await agent.jobs.start("fm-weekly", ASKER)
        await asyncio.sleep(0.05)
        return msg
    msg = run(go())
    assert msg.startswith("Started fm-weekly") and agent.runs[-1]["profile"] == "performance"
    assert run(agent.jobs.start("no-such-job", ASKER)).startswith("There is no no-such-job report")
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
        await agent.jobs.start("fm-weekly", ASKER)
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


def test_settings_skill_ai_in_policy_yaml():
    owners = {"a1": "a", "a2": "a", "b1": "b", "c1": "c"}
    starters = {"a": {"brain": "auto", "limit_usd": 2.0}, "b": {"brain": "auto", "limit_usd": 2.0},
                "c": {"brain": "auto", "limit_usd": 2.0}}
    p = Policy({"settings": {"skill_ai": {"a": {"brain": "economy", "limit_usd": 1}, "b": {"brain": "huge", "limit_usd": 1},
                                          "c": {"brain": "auto"}}}})
    assert p.skill_ai == {"a": {"brain": "economy", "limit_usd": 1.0}}       # the agent: lenient, b and c do not run
    assert p.job_settings(owners, starters) == {"a1": {"profile": "economy", "limit_usd": 1.0},
                                                "a2": {"profile": "economy", "limit_usd": 1.0}}
    out = problems({"settings": {"skill_ai": {"b": {"brain": "huge", "limit_usd": 1}, "c": {"brain": "auto"},
                                              "d": {"brain": "auto", "limit_usd": 0.01}}}})
    assert any("skill_ai.b.brain" in x for x in out) and any("skill_ai.c must give brain and limit_usd" in x for x in out)
    assert any("skill_ai.d.limit_usd" in x for x in out)
    # the two older shapes still read without a problem: their brain, the skill's starter limit
    old = {"settings": {"jobs": {"a1": {"profile": "economy", "limit_usd": 1}, "a2": {"profile": "auto", "limit_usd": 6}},
                        "skill_brains": {"b": "performance"}}}
    assert problems(old) == []
    assert Policy(old).job_settings(owners, starters) == {"a1": {"profile": "auto", "limit_usd": 2.0},
                                                          "a2": {"profile": "auto", "limit_usd": 2.0},
                                                          "b1": {"profile": "performance", "limit_usd": 2.0}}


def _asked_in_chat(agent, tmp_path, monkeypatch, page: bool, job_name: str = "fm-weekly", text_only: bool = False,
                   fails: str | None = None):
    """The person asks in the chat; the conversation starts the job and replies; the job (a moment later)
    sends its page — or ends without one."""
    async def act(run_):
        if run_["who"].startswith("job:"):
            await asyncio.sleep(0.02)                    # the job takes a while
            if page:
                # the page, in the run's own folder (architecture review 14: each run works in out/runs/NAME-TIME)
                os.makedirs(run_["folder"], exist_ok=True)
                open(os.path.join(run_["folder"], "fm_weekly.html"), "w").write("<html></html>")
                # through the RUN'S OWN send_message tool, as the model sends its result (architecture review 14: the
                # fake acts through the run's tools — a tool built apart would not count as the run's `sent`, and the
                # job would be judged to have delivered nothing, scan 4)
                await run_["call"]("send_message", {"to": "here", "text": "Three things need attention.",
                                                     **({} if text_only else {"attachment": "fm_weekly.html"})})
        else:
            await agent.jobs.start(job_name, ASKER)       # what the start_job tool does

    def answer(run_):
        if run_["who"].startswith("job:"):
            return runner.RunResult("", None, False, 0.1, [], None, problem=fails)
        return "Your weekly report is on its way."
    FakeAI(answer, act=act).install(monkeypatch)

    async def go():
        await agent.converse(ASKER, Person(ASKER, "Asker", "fm"), "/ask the weekly report")
        # ⚠️ WAIT FOR THE JOB, NEVER FOR A TIME (async tests wait on events): a fixed 0.1 s let a loaded run (the gate's
        # parallel suite) check before the job had sent its page — red at the gate, green alone
        await agent.chat_jobs.idle()
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


def test_the_ai_is_never_told_sent_for_a_message_telegram_refused(agent):
    send = next(t for t in agent.toolbox().tool_objects(None, Origin(ASKER, JOB)) if t.name == "send_message")
    agent.tg.refuse.add("send")
    out = run(send.handler({"to": "here", "text": "The weekly report."}))
    assert out.get("is_error") and "nothing was sent" in out["content"][0]["text"]
    agent.tg.refuse.clear()
    assert not run(send.handler({"to": "here", "text": "The weekly report."})).get("is_error")


def test_asked_again_the_agent_not_the_ais_memory_says_whether_the_report_runs(agent, monkeypatch):
    # villa, 2026-10-07 01:22: asked again 30 s after the page was sent, the AI said "already being generated"
    # from the conversation and started nothing; a second start while one ran would have made it twice
    gate = asyncio.Event()

    async def act(run_):
        if run_["who"].startswith("job:"):
            await gate.wait()
    ai = FakeAI("", act=act).install(monkeypatch)

    from vesta_agent import chat_jobs as CJ

    async def go():
        first = await agent.jobs.start("fm-weekly", ASKER)
        # owner, 2026-10-09: the model called start_job twice in one turn and told the person a report that had just
        # started was "still in progress" — asked again at once, it is still the report that just started
        twice = await agent.jobs.start("fm-weekly", ASKER)
        monkeypatch.setattr(CJ, "JUST_STARTED_S", 0)                    # later on: it is running, since its start
        again = await agent.jobs.start("fm-weekly", ASKER)
        gate.set()
        await asyncio.sleep(0.05)
        after = await agent.jobs.start("fm-weekly", ASKER)
        gate.set()
        await asyncio.sleep(0.05)
        return first, twice, again, after
    first, twice, again, after = run(go())
    # the time by the one formatter every notice uses (notice.when: 19/10/2026 08:01)
    assert re.match(r"Started fm-weekly now, at \d\d/\d\d/\d{4} \d\d:\d\d \(brain performance", first)
    assert "Do not say it is still running or in progress." in first
    assert twice.startswith("Started fm-weekly now, at ") and "still being made" not in twice
    assert re.match(r"The fm-weekly report asked for here started at \d\d/\d\d/\d{4} \d\d:\d\d and is still being made", again)
    assert after.startswith("Started fm-weekly now")                     # it ended: a new ask starts it again
    assert sum(r["who"] == "job:fm-weekly" for r in ai.runs) == 2        # never twice at once


