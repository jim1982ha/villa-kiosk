"""job_notices.py by value: every order in which a reply, a result and a job's end can reach a chat."""
from vesta_agent.job_notices import JobNotices

C = 7


def test_reply_then_result_deletes_the_reply():
    n = JobNotices(); n.started(C, "fm-weekly")
    assert n.replied(C, 100) is None
    assert n.result(C) == ("delete", 100, "")
    assert n.ended(C, "fm-weekly") is None          # the result already answered; nothing to edit


def test_result_before_the_reply_deletes_the_reply_when_it_comes():
    n = JobNotices(); n.started(C, "fm-daily")
    assert n.result(C) is None
    assert n.ended(C, "fm-daily") is None
    assert n.replied(C, 100) == ("delete", 100, "")


def test_ended_without_a_result_edits_the_reply():
    n = JobNotices(); n.started(C, "fm-weekly"); n.replied(C, 100)
    assert n.ended(C, "fm-weekly") == ("edit", 100, "fm-weekly")


def test_ended_without_a_result_before_the_reply_edits_the_reply_when_it_comes():
    n = JobNotices(); n.started(C, "fm-weekly")
    assert n.ended(C, "fm-weekly") is None
    assert n.replied(C, 100) == ("edit", 100, "fm-weekly")


def test_two_jobs_in_one_turn_wait_for_the_last_before_saying_none_came():
    n = JobNotices(); n.started(C, "a"); n.started(C, "b"); n.replied(C, 100)
    assert n.ended(C, "a") is None
    assert n.ended(C, "b") == ("edit", 100, "b")


def test_two_jobs_in_one_turn_one_result_is_enough():
    n = JobNotices(); n.started(C, "a"); n.started(C, "b"); n.replied(C, 100)
    assert n.ended(C, "a") is None
    assert n.result(C) == ("delete", 100, "")
    assert n.ended(C, "b") is None


def test_a_reply_with_no_job_is_left_alone_and_chats_are_separate():
    n = JobNotices()
    assert n.replied(C, 100) is None
    n.started(C, "a"); n.replied(C, 100)
    assert n.result(C + 1) is None and n.ended(C + 1, "a") is None
    assert n.result(C) == ("delete", 100, "")


def test_a_new_turn_after_an_unreplied_result_starts_fresh():
    n = JobNotices(); n.started(C, "a"); n.result(C)    # the reply never came (an empty answer)
    n.started(C, "b")
    assert n.replied(C, 200) is None                   # not deleted for the OLD job's result
    assert n.ended(C, "b") == ("edit", 200, "b")


def test_a_chat_jobs_typing_says_at_its_end_how_often_it_was_sent(tmp_path, caplog):
    # villa, 2026-10-09 15:27: "typing…" vanished before the weekly report came; the log held only the first one,
    # so "the repeats stopped" could not be told from "the app stopped showing them"
    import asyncio
    import logging
    from helpers import make_agent
    from vesta_agent.routing import JOB, Origin
    v = make_agent(tmp_path, {"chats": {"owner": -100777, "fm": 222}})

    async def go():
        gate = asyncio.Event()

        async def work(origin):
            await gate.wait()
        v.chat_jobs.start(-100777, "fm-weekly", work, waiting_mid=99)          # a pressed message: "typing…" at once
        await asyncio.sleep(0.05)
        await v.delivery.send(-100777, "Weekly report", origin=Origin(-100777, JOB, job="fm-weekly"))  # typing stops
        gate.set()
        await v.chat_jobs.idle()
        await asyncio.sleep(0.05)
    with caplog.at_level(logging.INFO, logger="vesta"):
        asyncio.run(go())
    said = [r.getMessage() for r in caplog.records if "sent" in r.getMessage() and "typing" in r.getMessage()]
    assert said and said[-1].startswith("\"typing…\" for fm-weekly in chat -100777: sent 1 times, 1 accepted, last accepted at ")


def test_the_typing_timeline_names_every_one_and_the_longest_silence():
    # owner, 2026-10-09 16:21: "no signal at all from a certain point" while the log only said "sent 34 times"
    from datetime import datetime
    from vesta_agent.delivery import typing_timeline
    t = datetime(2026, 10, 9, 16, 21, 52).timestamp()
    line = typing_timeline([(t, 0.2, True), (t + 4.3, 0.3, True), (t + 40, 6.5, True), (t + 44.3, 0.2, False)])
    assert line.startswith("16:21:52, 16:21:56, 16:22:32 (Telegram took 6.5 s), 16:22:36 (refused)")
    assert line.endswith("; longest gap 35.7 s after 16:21:56")
    assert typing_timeline([]) == "none sent"
