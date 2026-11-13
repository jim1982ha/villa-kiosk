"""Architecture review 6: the reports' module (ai_jobs.py), built without the agent — a fake delivery, fake steps."""
from __future__ import annotations

import asyncio
import types

import pytest

from ai_fake import FakeAI
from helpers import make_skill, settings
from vesta_agent import job_steps
from vesta_agent.ai_jobs import AiJobs
from vesta_agent.api_errors import for_job
from vesta_agent.chat_jobs import ChatJobs
from vesta_agent.outcome import Outcome
from vesta_agent.routing import JOB, Origin
from vesta_agent.skills import Skills
from vesta_agent.state import State
from vesta_agent.turn import Turns
from vesta_agent.roster import Roster
from vesta_agent.policy import Policy

ASKER = 77


class Delivery:
    tg = None                                       # no waiting message, no "typing…": what is sent is what is read

    def __init__(self):
        self.sent = []

    async def send(self, chat, text, origin=None, **k):
        self.sent.append((chat, text))
        return 1

    async def edit(self, chat, mid, text, keyboard=None):
        return False

    def job_started(self, chat, name):
        pass

    async def job_waiting(self, chat, mid):
        pass

    async def job_ended(self, chat, name):
        pass


class Toolbox:
    photos: list = []
    approvals: list = []

    def for_run(self, person, origin):
        from helpers import run_kit
        return run_kit()


@pytest.fixture
def jobs(tmp_path, monkeypatch):
    s = settings(str(tmp_path))
    make_skill(s.skills_dir, "rep", {"tools": [], "schedule": [{
        "when": "Mon 08:00", "name": "rep-weekly", "to": "fm", "prompt": "make it", "on_request": True,
        "button": "Weekly report", "without_ai": ["page.py --finish {to} --no-ai {why}"]}]}, {"page.py": "print('{}')\n"})
    pol = Policy({"settings": {"jobs": {"rep-weekly": {"profile": "economy", "limit_usd": 1}}}}, Roster.of(owner=[(-1, "Owners")], fm=[(-2, "Managers")]))
    told, steps = [], []

    async def tell_owner(problem, to):
        told.append((problem, to))

    async def safe(coro):
        await coro

    async def server_tools():
        return []

    async def fake_steps(settings_, state, skills, outcome, skill, st, values, origin=None):
        steps.append((skill.name, [x["run"] for x in st], values))
        return job_steps.Done(1 if steps_sent[0] else 0, None if steps_sent[0] else "page.py")
    steps_sent = [True]
    monkeypatch.setattr(job_steps, "run", fake_steps)
    monkeypatch.setattr("vesta_agent.tool_access.allowed_for", lambda *a: set())
    d = Delivery()
    st = State(s.state_path)
    turns = Turns(s, st, lambda: pol, server_tools=server_tools, toolbox=lambda allowed, settings=None, invoked=None, inv=None: Toolbox(),
                  system_prompt=lambda: "sys", tell_owner=tell_owner, safe=safe)
    # the real Outcome: a job's notice goes out the one way every message does (outcome.carry_out)
    out = Outcome(policy=lambda: pol, state=st, send=d.send, actions=None, tickets=None, buttons=None,
                  thread=None)
    j = AiJobs(s, st, lambda: pol, Skills(s.skills_dir), d, ChatJobs(d, safe), out, turns=turns, safe=safe)
    return types.SimpleNamespace(j=j, d=d, pol=pol, told=told, steps=steps, steps_sent=steps_sent)


def test_a_report_the_ai_cannot_make_goes_to_its_steps_and_the_owner_is_told(jobs, monkeypatch):
    FakeAI("", problem="credit").install(monkeypatch)
    sk, job = jobs.j.find("rep-weekly")
    asyncio.run(jobs.j.run(sk, job))
    assert jobs.steps[0][2] == {"to": "fm", "why": "The Anthropic account has run out of credit."}
    assert jobs.d.sent == [] and jobs.told == [("credit", [-2])]                 # made: no "could not be prepared"


def test_when_its_steps_fail_too_the_chat_reads_why(jobs, monkeypatch):
    FakeAI("", problem="busy").install(monkeypatch)
    jobs.steps_sent[0] = False
    sk, job = jobs.j.find("rep-weekly")
    asyncio.run(jobs.j.run(sk, job, Origin(ASKER, JOB)))
    assert jobs.d.sent == [(ASKER, f"Report not prepared\nTo: this chat\n{for_job('rep-weekly', 'busy', Origin(ASKER, JOB))}")]
    assert "Ask again" in jobs.d.sent[0][1] and "next time" not in jobs.d.sent[0][1]     # asked for here: no next time


def test_a_run_that_sent_nothing_is_recorded_counted_and_told_once(jobs, monkeypatch):
    # architecture review scan 4 (2026-10-19): the AI wrote the report and never called send_message — logged "done"
    # with its cost, counted as a reply written, nobody told on schedule
    from vesta_shared import agent_records
    from vesta_agent import status
    from vesta_agent.api_errors import NO_RESULT, NOT_COME
    FakeAI("The weekly report, written but never sent.").install(monkeypatch)
    sk, job = jobs.j.find("rep-weekly")
    asyncio.run(jobs.j.run(sk, job, Origin(ASKER, JOB)))
    why = "the AI wrote its answer but did not send it"
    assert jobs.d.sent == [(ASKER, f"Report not prepared\nTo: this chat\n{NOT_COME('rep-weekly', why, NO_RESULT)}")]
    records = jobs.j.state.calls_since("2000-01-01")
    assert [agent_records.detail(c) for c in records if c["kind"] == agent_records.JOB_NO_RESULT] == [{"job": "rep-weekly", "why": why}]
    fig = dict(status.figures(records, 0.0))
    assert fig["Failures"] == 1 and fig["Reports made"] == 0 and fig["Replies written"] == 0
    # on schedule: the one sentence goes to the job's own chat
    jobs.d.sent.clear()
    asyncio.run(jobs.j.run(sk, job))
    assert [c for c, _ in jobs.d.sent] == [-2] and jobs.d.sent[0][1].endswith(NOT_COME("rep-weekly", why, NO_RESULT))
    # the Costs tab shows the row with the words, beside the run
    rows = [r for r in status.costs(jobs.j.state)["runs"] if r.get("no_result")]
    assert len(rows) == 2 and rows[0]["no_result"] == {"why": why} and rows[0]["job"] == "rep-weekly" and rows[0]["cost"] == 0.0
    # stopped at its limit with nothing sent: the cause says so
    FakeAI("", stopped_at_limit=True).install(monkeypatch)
    jobs.d.sent.clear()
    asyncio.run(jobs.j.run(sk, job, Origin(ASKER, JOB)))
    assert jobs.d.sent[0][1].endswith(NOT_COME("rep-weekly", "it stopped at its spending limit before sending it", NO_RESULT))




def test_a_code_step_that_only_writes_faults_is_carried_out(tmp_path):
    # architecture review, 2026-11-14: a step was carried out only when it sent a message, so one that closed a fault
    # alone never reached the Agent's log nor the Kiosk
    s = settings(str(tmp_path))
    row = {"what": "closed", "rule": "PM-X", "device": "sensor.example", "words": "Pump weak", "note": "Cleared.",
           "check": "night"}
    make_skill(s.skills_dir, "rep", {"tools": []}, {"close.py": f"import json; print(json.dumps({{'fault_log': [{row!r}]}}))\n"})
    st = State(s.state_path)
    pol = Policy({}, Roster.of(owner=[(-1, "Owners")]))
    d = Delivery()
    out = Outcome(policy=lambda: pol, state=st, send=d.send, actions=None, tickets=None, buttons=None, thread=None)
    skills = Skills(s.skills_dir)
    done = asyncio.run(job_steps.run(s, st, skills, out, skills.all()["rep"], [{"run": "close.py"}], {}))
    assert done.failed is None and d.sent == []
    (logged,) = st.calls("fault_written")
    assert '"Pump weak"' in logged["detail"] and '"Cleared."' in logged["detail"]
