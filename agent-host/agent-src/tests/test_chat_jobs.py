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


class _Delivery:
    """What chat_jobs.py needs of delivery.Delivery: the Telegram stand-in, its REAL hold (the one "typing…" of a chat)
    over a quick typing loop."""
    from vesta_agent.delivery import Delivery as _Real
    hold = _Real.hold

    def __init__(self):
        from telegram_fake import FakeTelegram
        self.tg = FakeTelegram()
        self.on_job_result = None
        self._waiting = {}

    async def edit(self, chat, mid, text):                 # delivery.Delivery's own (architecture review 15)
        return await self.tg.edit(chat, mid, text)

    async def delete(self, chat, mid):
        return await self.tg.delete(chat, mid)

    async def typing_loop(self, chat, stop, job=None):
        while not stop.is_set():
            await self.tg.typing(chat)
            try:
                await asyncio.wait_for(stop.wait(), 0.005)
            except asyncio.TimeoutError:
                pass


async def _safe(coro):
    try:
        await coro
    except Exception:  # noqa: BLE001
        pass


def test_a_chat_job_runs_once_its_waiting_message_first_and_always_ends():
    d = _Delivery()
    jobs = ChatJobs(d, _safe)
    assert d.on_job_result == jobs.result                           # a result sent by Delivery reaches its job
    gate = asyncio.Event()
    seen = []

    async def work(origin):
        seen.append(origin)
        await gate.wait()
        raise RuntimeError("the job failed")

    async def go():
        assert jobs.start(7, "fm-weekly", work, waiting_mid=42)
        assert not jobs.start(7, "fm-weekly", work)                  # never twice in one chat
        assert jobs.start(8, "fm-weekly", lambda o: asyncio.sleep(0))  # another chat: its own
        await asyncio.sleep(0.03)
        assert jobs.running(7, "fm-weekly") and 7 in d.tg.typing_in  # "typing…" while it works
        gate.set()
        await jobs.idle()
    asyncio.run(go())
    assert seen == [Origin(7, JOB, job="fm-weekly")]                  # the job runs knowing its own name
    assert not jobs.running(7, "fm-weekly")
    # it ended without a result: its waiting message (the pressed one) says so
    assert d.tg.edits == [(7, 42, "The fm-weekly job ended without a result this time. Ask again in a moment.")]


def test_each_turn_has_its_own_waiting_message():
    # architecture review 12: the waiting message was kept by CHAT — a failed reply let the next turn's answer be
    # taken for it, and a job started in a later turn shared the earlier one's (its "on its way" never went)
    d = _Delivery()
    jobs = ChatJobs(d, _safe)
    gates = {"a": asyncio.Event(), "b": asyncio.Event()}

    def work(name):
        async def w(origin):
            await gates[name].wait()
            await d.tg.send(9, f"{name} report")
            await jobs.result(origin)
        return w

    async def go():
        jobs.turn(9)
        jobs.start(9, "a", work("a"))
        await jobs.replied(9, None)                                  # turn 1's reply never arrived
        jobs.turn(9)
        await jobs.replied(9, 500)                                   # turn 2: an answer with no job — never a waiting message
        jobs.turn(9)
        jobs.start(9, "b", work("b"))
        await jobs.replied(9, 501)                                   # turn 3 starts b: 501 stands for b
        gates["a"].set()
        await asyncio.sleep(0.02)
        assert d.tg.deleted == []                                    # a's result deletes nothing of b's, nor 500
        gates["b"].set()
        await jobs.idle()
    asyncio.run(go())
    assert d.tg.deleted == [(9, 501)]


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

    async def carry_out(self, res, skill_name, origin, folder=None):
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
