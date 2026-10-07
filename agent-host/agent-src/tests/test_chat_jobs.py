"""Architecture review 5: a job asked for in a chat (chat_jobs.py), a job's code steps (job_steps.py) and what a
person gets when the AI cannot answer (ai_down.py) — each driven through its own interface."""
from __future__ import annotations

import asyncio

import pytest

from vesta_agent import ai_down, job_steps
from vesta_agent.chat_jobs import ChatJobs
from vesta_agent.routing import JOB, Origin, job_to

WEEKLY = {"name": "fm-weekly", "button": "Weekly report"}
DAILY = {"name": "fm-daily", "button": "Daily digest"}


class Notes:
    """Delivery's job steps, in order."""
    def __init__(self):
        self.seen = []

    def job_started(self, chat, name):
        self.seen.append(("started", chat, name))

    async def job_waiting(self, chat, mid):
        self.seen.append(("waiting", chat, mid))

    async def job_ended(self, chat, name):
        self.seen.append(("ended", chat, name))


async def _safe(coro):
    try:
        await coro
    except Exception:  # noqa: BLE001
        pass


def test_a_chat_job_runs_once_its_waiting_message_first_and_always_ends():
    notes = Notes()
    jobs = ChatJobs(notes, _safe)
    gate = asyncio.Event()

    async def work(origin):
        notes.seen.append(("work", origin))
        await gate.wait()
        raise RuntimeError("the job failed")

    async def go():
        assert jobs.start(7, "fm-weekly", work, waiting_mid=42)
        assert not jobs.start(7, "fm-weekly", work)                  # never twice in one chat
        assert jobs.start(8, "fm-weekly", lambda o: asyncio.sleep(0))  # another chat: its own
        await asyncio.sleep(0.01)
        assert jobs.running(7, "fm-weekly")
        gate.set()
        while jobs.running(7, "fm-weekly") or jobs.running(8, "fm-weekly"):
            await asyncio.sleep(0.005)
    asyncio.run(go())
    mine = [s for s in notes.seen if s[0] == "work" or s[1] == 7]
    assert mine == [("started", 7, "fm-weekly"), ("waiting", 7, 42), ("work", Origin(7, JOB)), ("ended", 7, "fm-weekly")]


def test_a_jobs_result_goes_to_the_chat_that_asked_else_its_own_target():
    assert job_to({"to": "fm"}, Origin(1, JOB)) == "here"
    assert job_to({"to": "fm"}, None) == "fm" and job_to({}, None) == "owner"


@pytest.mark.parametrize("text,problem,expect", [
    ("Generate the weekly report for last week now", "credit", ("start", "fm-weekly")),
    ("the daily digest please", "offline", ("start", "fm-daily")),
    ("Generate the report for last week now", "credit", ("buttons", 2)),
    ("what do you see in the living camera now?", "credit", ("nothing",)),
    ("Generate the weekly report", "too_long", ("nothing",)),          # not the AI being unavailable
    ("weekly report or daily digest?", "credit", ("buttons", 2)),      # two named: the person chooses
])
def test_what_a_person_gets_when_the_ai_cannot_answer(text, problem, expect):
    off = ai_down.offer(text, problem, [WEEKLY, DAILY])
    got = ("start", off.start["name"]) if off.start else ("buttons", len(off.buttons)) if off.buttons else ("nothing",)
    assert got == expect


def test_a_report_button_carries_the_problem_and_the_job():
    assert ai_down.keyboard("credit", [WEEKLY]) == {"inline_keyboard": [[{"text": "Weekly report",
                                                                          "callback_data": "w:credit:fm-weekly"}]]}


# ---------------------------------------------------------------- job steps
class _Skill:
    def __init__(self, name):
        self.name = name


class _Skills:
    def __init__(self, *names):
        self._all = {n: _Skill(n) for n in names}

    def all(self):
        return self._all


class _Outcome:
    def __init__(self):
        self.out = []

    async def carry_out(self, res, skill_name, origin):
        self.out.append((res, skill_name, origin))
        return {"sent": len(res.get("send") or [])}


def _answers(monkeypatch, codes):
    from vesta_agent import script_run
    ran = []

    def fake(settings, state, sk, command, values, timeout=900):
        ran.append((sk.name, command.format(**values)))
        code, out = codes.get(command.split()[0], (0, "{}"))
        return script_run.ScriptAnswer(code, out, "boom" if code else "", 0.0)
    monkeypatch.setattr(job_steps.script_run, "run_command", fake)
    return ran


def test_job_steps_stop_at_a_failure_and_skip_what_is_for_the_schedule_only(monkeypatch):
    ran = _answers(monkeypatch, {"b.py": (1, ""), "page.py": (0, '{"send": [{"to": "here", "text": "x"}]}')})
    out = _Outcome()
    steps = [{"run": "a.py", "skill": "other"}, {"run": "page.py --to {to}", "skill": None},
             {"run": "owner.py", "skill": None, "on_schedule_only": True}, {"run": "b.py", "skill": None},
             {"run": "c.py", "skill": None}]
    done = asyncio.run(job_steps.run(None, None, _Skills("other"), out, _Skill("rep"), steps, {"to": "here"}, Origin(1, JOB)))
    assert ran == [("other", "a.py"), ("rep", "page.py --to here"), ("rep", "b.py")]     # c.py never ran
    assert done.sent == 1 and done.failed == "b.py" and out.out[0][1] == "rep"


def test_a_step_of_a_skill_that_is_not_installed_stops_the_steps(monkeypatch):
    ran = _answers(monkeypatch, {})
    done = asyncio.run(job_steps.run(None, None, _Skills(), _Outcome(), _Skill("rep"),
                                     [{"run": "a.py", "skill": "gone"}, {"run": "b.py", "skill": None}], {}))
    assert ran == [] and done.failed == "a.py (gone: not installed)"
