"""What is happening for a chat beyond its conversation, told to the AI with every message (chat_facts.py).

Villa, 2026-10-23: at 14:40 the facility manager tapped "Daily digest" in their private chat, the AI answered "on its
way", the fm-daily job sent the digest at 14:40 — outside the conversation. At 14:50 the same conversation resumed and
the AI promised twice "the daily digest will arrive in this chat as soon as it is ready": nothing was running. Each
test goes through the agent's real path (app.converse, the job asked for through start_job, a press through
handle_callback, a stop through `restarted`) and reads the prompt the AI was given (ai_fake.FakeAI)."""
from __future__ import annotations

import asyncio
import json
import re
import time

import pytest

from ai_fake import FakeAI
from helpers import make_agent, restarted
from telegram_fake import BOT
from vesta_agent import runner
from vesta_agent.chat_facts import HEAD, NONE_PREPARED, SINCE
from vesta_agent.roster import Person
from vesta_agent.roster import Roster

FM, OWNER = 222, 111
WAYAN = Person(FM, "Wayan", "fm")
#: a moment as every notice writes it (notice.when)
AT = r"\d\d/\d\d/\d{4} \d\d:\d\d"


def run(c):
    return asyncio.run(c)


@pytest.fixture
def villa(tmp_path, monkeypatch):
    v = make_agent(tmp_path, {"settings": {"skill_ai": {"reports": {"brain": "economy", "limit_usd": 1}}}}, roster=Roster.of(owner=[(OWNER, "Owner")], fm=[(FM, "Wayan")]),
                   skills=["reports", "alert-desk"])
    v.bot_username = BOT["username"]

    async def no_steps(*a, **k):                     # a report's code steps: not run here (test_jobs.py does)
        from vesta_agent.job_steps import Done
        return Done(0, None)
    import vesta_agent.job_steps as job_steps
    monkeypatch.setattr(job_steps, "run", no_steps)
    v.job_gate = None                                 # an Event: the job waits for it before it sends its digest
    v.job_sends = True                                # False: the job's AI ends without sending anything

    async def act(call):
        if call["who"].startswith("job:"):
            if v.job_gate is not None:
                await v.job_gate.wait()
            if v.job_sends:
                await call["call"]("send_message", {"to": "here", "text": "Daily digest: all quiet."})
        elif "daily digest" in call["prompt"].lower():
            await call["call"]("start_job", {"name": "fm-daily"})

    def answer(call):
        said = "On its way." if "daily digest" in call["prompt"].lower() and not call["who"].startswith("job:") else "Noted."
        return runner.RunResult(said, "session-1", False, 0.01, [])
    v.ai = FakeAI(answer, act=act).install(monkeypatch)
    return v


def chat_prompts(v):
    return [r["prompt"] for r in v.ai.runs if not r["who"].startswith("job:")]


def say(v, text, person=WAYAN):
    """A person's message answered — and the report it asked for run to its end, in the same loop."""
    async def go():
        await v.converse(person.telegram_id, person, text)
        await v.chat_jobs.idle()
    run(go())


def test_a_report_the_job_sent_is_said_sent_and_none_is_promised(villa):
    # the villa's case: asked, sent by the job, then a new message in the same conversation
    say(villa, "Daily digest")
    assert any("Daily digest: all quiet." in t for c, t, _ in villa.tg.sent if c == FM)        # the job sent it
    say(villa, "ok, c'est noté")
    first, second = chat_prompts(villa)
    assert first.startswith(f"{HEAD} {NONE_PREPARED}") and SINCE not in first
    assert second.startswith(f"{HEAD} {NONE_PREPARED}\n{SINCE}\n")
    (line,) = [x for x in second.splitlines() if x.startswith("- ")]
    assert re.fullmatch(rf"- {AT}: the fm-daily report asked for here at {AT} by Wayan was sent here\.", line)
    assert "Being prepared for this chat now:" not in second
    # told once: the next message has nothing new to say (since the AI's last answer here)
    say(villa, "merci")
    assert SINCE not in chat_prompts(villa)[-1]


def test_a_report_being_prepared_is_named_with_its_time_and_who_asked(villa):
    async def go():
        villa.job_gate = asyncio.Event()
        await villa.converse(FM, WAYAN, "Daily digest")
        await asyncio.sleep(0.02)                         # the job runs, its digest not sent yet
        await villa.converse(FM, WAYAN, "is it ready?")
        villa.job_gate.set()
        await villa.chat_jobs.idle()
    run(go())
    asked = chat_prompts(villa)[1]
    assert re.search(rf"^{re.escape(HEAD)} Being prepared for this chat now: the fm-daily report asked for here at {AT} "
                     r"by Wayan\. Its result comes here when it is ready\.$", asked, re.M)
    assert NONE_PREPARED not in asked and SINCE not in asked


def test_a_report_that_could_not_be_prepared_is_never_said_sent(villa):
    villa.job_sends = False                              # its AI ends without sending: the one sentence goes instead
    say(villa, "Daily digest")
    say(villa, "and?")
    (line,) = [x for x in chat_prompts(villa)[-1].splitlines() if x.startswith("- ")]
    assert re.fullmatch(rf"- {AT}: the fm-daily report asked for here at {AT} by Wayan could not be prepared "
                        r"\(.+\); the chat was told\.", line)


def test_a_report_cut_by_a_restart_is_said_cut(villa):
    villa.state.keep_chat_work(FM, "fm-daily", json.dumps({"started": time.time(), "mid": None}))   # a stop cut it
    v = restarted(villa)
    v.ai = villa.ai
    say(v, "where is my digest?")
    (line,) = [x for x in chat_prompts(v)[-1].splitlines() if x.startswith("- ")]
    assert re.fullmatch(rf"- {AT}: the fm-daily report asked for here at {AT} was cut by a restart of the agent before "
                        r"it was sent; the chat was told to ask again\.", line)


def _alert(v, chat=FM):
    """An alert of incident #1 sent to the facility manager, through the one way every result goes (outcome.py)."""
    from vesta_shared.store import Store
    iid = Store(v.s.store_path).new_incident("k", "automation.x", "lock.front_door", "P2", {"message": "m"})
    run(v.outcome.carry_out({"send": [{"to": "fm", "text": "Pump stopped", "incident_id": iid, "stage": "reminder"}]},
                            "alert-desk"))
    return iid


def test_an_alerts_step_sent_here_is_told(villa):
    say(villa, "hello")
    iid = _alert(villa)
    say(villa, "what was that?")
    (line,) = [x for x in chat_prompts(villa)[-1].splitlines() if x.startswith("- ")]
    assert re.fullmatch(rf"- {AT}: alert #{iid}-P2: Reminder sent here\.", line)
    say(villa, "ok", person=Person(OWNER, "Owner", "owner"))
    assert SINCE not in chat_prompts(villa)[-1]                           # never another chat's


def test_a_report_made_without_the_ai_that_failed_too_is_said_not_prepared(villa):
    async def go():
        villa.jobs.start_without_ai("fm-daily", "credit", FM, by="Wayan")     # its steps send nothing (fixture)
        await villa.chat_jobs.idle()
        await villa.converse(FM, WAYAN, "and the digest?")
    run(go())
    (line,) = [x for x in chat_prompts(villa)[-1].splitlines() if x.startswith("- ")]
    assert line.endswith("by Wayan could not be prepared (its figures could not be read without the AI either); "
                         "the chat was told.")


def test_waiting_for_the_jobs_never_waits_on_one_that_already_ended(villa):
    # 0.12.331's CI hung 40 min: a job task that ended as its loop closed stayed in the set (its done-callback never ran)
    # and idle() awaited it again and again without ever yielding
    async def nothing():
        return None

    async def ended():
        t = asyncio.ensure_future(nothing())
        await t
        return t
    villa.chat_jobs._tasks.add(asyncio.run(ended()))
    run(asyncio.wait_for(villa.chat_jobs.idle(), 5))
    assert not villa.chat_jobs._tasks
