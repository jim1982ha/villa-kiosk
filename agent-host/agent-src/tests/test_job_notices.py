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
