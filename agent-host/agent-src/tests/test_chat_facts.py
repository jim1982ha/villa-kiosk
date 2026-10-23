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
from vesta_agent import button_data, runner
from vesta_agent.chat_facts import HEAD, NONE_PREPARED, SINCE, ChatFacts
from vesta_agent.in_progress import InProgress
from vesta_agent.policy import Person
from vesta_agent.state import State

FM, OWNER = 222, 111
WAYAN = Person(FM, "Wayan", "fm")
#: a moment as every notice writes it (notice.when)
AT = r"\d\d/\d\d/\d{4} \d\d:\d\d"


def run(c):
    return asyncio.run(c)


@pytest.fixture
def villa(tmp_path, monkeypatch):
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner", "language": "en"},
                                         {"telegram_id": FM, "name": "Wayan", "role": "fm", "language": "en"}],
                              "settings": {"skill_ai": {"reports": {"brain": "economy", "limit_usd": 1}}}},
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
    assert re.fullmatch(rf"- {AT}: alert #{iid}: Reminder sent here\.", line)
    say(villa, "ok", person=Person(OWNER, "Owner", "owner"))
    assert SINCE not in chat_prompts(villa)[-1]                           # never another chat's


def test_a_button_pressed_on_an_alert_here_is_told_with_who(villa):
    iid = _alert(villa)
    say(villa, "seen it")                                                 # the step is behind the AI now
    mid = villa.state.incident_message(iid, FM)["mid"]
    run(villa.on_ha_event("telegram_callback", {"id": "cb", "data": button_data.make(button_data.ALERT, iid, "done"),
                                                "chat_id": FM, "user_id": FM, "bot": BOT,
                                                "message": {"message_id": mid, "chat": {"id": FM}, "text": "Pump"}}))
    say(villa, "is the pump alert still open?")
    lines = [x for x in chat_prompts(villa)[-1].splitlines() if x.startswith("- ")]
    assert re.fullmatch(rf"- {AT}: Done pressed on alert #{iid} by Wayan\.", lines[0])


def test_a_fault_offer_decided_by_its_button_is_told(villa):
    oid = villa.state.new_ticket_offer(FM, "Pool pump: check the float", None, None, None)
    villa.state.offers_shown([oid])
    mid = run(villa.delivery.send(FM, "An answer with its offer", keyboard={"inline_keyboard": [[{"text": "x"}]]}))
    say(villa, "hello")
    run(villa.on_ha_event("telegram_callback", {"id": "cb", "data": button_data.make(button_data.TICKET, oid, "n"),
                                                "chat_id": FM, "user_id": FM, "bot": BOT,
                                                "message": {"message_id": mid, "chat": {"id": FM}, "text": "x"}}))
    say(villa, "so, is the fault created?")
    (line,) = [x for x in chat_prompts(villa)[-1].splitlines() if x.startswith("- ")]
    assert re.fullmatch(rf"- {AT}: Don't create it pressed on the fault offered here \(“Pool pump: check the float”\) "
                        r"by Wayan: no fault was created\.", line)


def test_only_the_latest_are_shown_the_rest_counted(tmp_path):
    from datetime import datetime, timedelta, timezone
    facts = ChatFacts(State(str(tmp_path / "s.sqlite")), InProgress())
    t0 = datetime(2026, 10, 23, 6, 0, tzinfo=timezone.utc)
    for n in range(7):
        facts.pressed(FM, "Done", f"alert #{n}", "Wayan", at=t0 + timedelta(minutes=n))
    lines = facts.now(FM).splitlines()
    assert lines[1:3] == [SINCE, "- … 2 earlier"] and lines[3].endswith("alert #2 by Wayan.") and len(lines) == 8
    facts.told(FM, t0 + timedelta(minutes=4))                              # the AI answered after the fifth
    assert len(facts.state.chat_facts(FM)["items"]) == 2                   # what it was told is not kept
    assert [x for x in facts.now(FM).splitlines() if x.startswith("- ")] == [
        "- 23/10/2026 06:05: Done pressed on alert #5 by Wayan.", "- 23/10/2026 06:06: Done pressed on alert #6 by Wayan."]


def test_a_report_whose_work_died_is_said_ended_with_nothing(villa):
    async def dies(origin):
        raise RuntimeError("the job's task died")

    async def go():
        villa.chat_jobs.start(FM, "fm-daily", dies, waiting_mid=4242, by="Wayan")
        await villa.chat_jobs.idle()
        await villa.converse(FM, WAYAN, "and the digest?")
    run(go())
    (line,) = [x for x in chat_prompts(villa)[-1].splitlines() if x.startswith("- ")]
    assert re.fullmatch(rf"- {AT}: the fm-daily report asked for here at {AT} by Wayan ended without sending anything; "
                        r"the chat was told it could not be prepared\.", line)


def test_a_result_that_came_while_its_turn_was_still_answering_is_told_next(villa):
    # the AI's last answer here is the message it was told the facts with — not when its turn ended: a report sent
    # while the turn that asked for it was still being answered is still news at the next message
    async def act(call):
        if call["who"].startswith("job:"):
            await call["call"]("send_message", {"to": "here", "text": "Daily digest: all quiet."})
        elif "daily digest" in call["prompt"].lower():
            await call["call"]("start_job", {"name": "fm-daily"})
            # the job's result arrives before this answer is done — when the loop lets it: on a slow runner (2 CPUs) the
            # result waited for this very answer and the two waited on each other for ever (CI, 0.12.331). Bounded: either
            # way the next message must be told it was sent
            for _ in range(400):
                if any("all quiet" in t for _c, t, _k in villa.tg.sent):
                    break
                await asyncio.sleep(0.005)
    villa.ai.act = act
    say(villa, "Daily digest")
    say(villa, "thanks")
    assert re.search(rf"^- {AT}: the fm-daily report asked for here at {AT} by Wayan was sent here\.$",
                     chat_prompts(villa)[-1], re.M)


def test_a_report_whose_result_came_is_no_longer_being_prepared(villa):
    async def act(call):
        if call["who"].startswith("job:"):
            await call["call"]("send_message", {"to": "here", "text": "Daily digest: all quiet."})
            await villa.job_gate.wait()                    # sent, its run not over yet
        elif "daily digest" in call["prompt"].lower():
            await call["call"]("start_job", {"name": "fm-daily"})
    villa.ai.act = act

    async def go():
        villa.job_gate = asyncio.Event()
        await villa.converse(FM, WAYAN, "Daily digest")
        while not any("all quiet" in t for _c, t, _k in villa.tg.sent):
            await asyncio.sleep(0.005)
        await villa.converse(FM, WAYAN, "got it?")
        villa.job_gate.set()
        await villa.chat_jobs.idle()
    run(go())
    got = chat_prompts(villa)[-1]
    assert got.startswith(f"{HEAD} {NONE_PREPARED}") and "by Wayan was sent here." in got


def test_a_report_made_without_the_ai_that_failed_too_is_said_not_prepared(villa):
    async def go():
        villa.jobs.start_without_ai("fm-daily", "credit", FM, by="Wayan")     # its steps send nothing (fixture)
        await villa.chat_jobs.idle()
        await villa.converse(FM, WAYAN, "and the digest?")
    run(go())
    (line,) = [x for x in chat_prompts(villa)[-1].splitlines() if x.startswith("- ")]
    assert line.endswith("by Wayan could not be prepared (its figures could not be read without the AI either); "
                         "the chat was told.")


def test_a_report_running_on_schedule_for_this_chat_is_named_as_scheduled(villa):
    async def go():
        async with villa.chat_jobs.held([FM], "fm-daily"):           # the scheduled run sends here
            await villa.converse(FM, WAYAN, "anything for me today?")
    run(go())
    assert re.search(rf"^{re.escape(HEAD)} Being prepared for this chat now: the fm-daily report, on schedule since {AT}\. ",
                     chat_prompts(villa)[-1], re.M)


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
