"""job_notices.py by value: every order in which a reply, a result and a job's end can reach a chat."""
from vesta_agent.job_notices import JobNotices

C = 7


def test_reply_then_result_deletes_the_reply():
    n = JobNotices(); n.started(C, "fm-weekly")
    assert n.replied(C, 100) is None
    assert n.result(C) == ("delete", 100, "")
    assert n.ended(C, "fm-weekly") is None          # the result already answered; nothing to edit


def test_ended_without_a_result_edits_the_reply():
    n = JobNotices(); n.started(C, "fm-weekly"); n.replied(C, 100)
    assert n.ended(C, "fm-weekly") == ("edit", 100, "fm-weekly")


def test_two_jobs_in_one_turn_wait_for_the_last_before_saying_none_came():
    n = JobNotices(); n.started(C, "a"); n.started(C, "b"); n.replied(C, 100)
    assert n.ended(C, "a") is None
    assert n.ended(C, "b") == ("edit", 100, "b")


