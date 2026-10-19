"""Work in progress (in_progress.py, architecture review round 2, 2026-10-16): one record of what runs, one bookkeeping
around running it, one entry for "its result arrived", and one decision per kind at the next start — driven through the
module's own interface, on a real State file. The whole agent through a stop and a start: test_recorded_is_shown."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

import pytest

from vesta_agent.in_progress import (AGAIN, ANSWER, CHAT_JOB, HELD, NOTHING, SCHEDULED, TELL, InProgress, Item)
from vesta_agent.routing import JOB, Origin
from vesta_agent.state import State

TZ = "Asia/Makassar"
STARTED = datetime(2026, 10, 16, 6, 30, tzinfo=timezone.utc).timestamp()      # 14:30 in TZ
SLOT = "2026-10-16T07:00:00+08:00"


def _work(tmp_path) -> InProgress:
    return InProgress(State(str(tmp_path / "state.sqlite")), TZ)


def _again(tmp_path) -> InProgress:
    """The next start: a new InProgress on the same file."""
    return _work(tmp_path)


async def _cut(work: InProgress, item: Item, before=None) -> None:
    """Run `item` until a stop cuts it (what the agent's stop does to every task)."""
    async def body():
        async with work.kept(item):
            if before:
                await before()
            await asyncio.Event().wait()
    t = asyncio.create_task(body())
    await asyncio.sleep(0)
    t.cancel()
    with pytest.raises(asyncio.CancelledError):
        await t


def test_each_kind_cut_by_a_stop_gets_its_kinds_decision_at_the_next_start(tmp_path):
    w = _work(tmp_path)

    async def stop_all():
        await _cut(w, Item(SCHEDULED, "reports:0:07:00", slot=SLOT))
        await _cut(w, Item(CHAT_JOB, "fm-weekly", chat=111, started=STARTED, mid=4242))
        await _cut(w, Item(ANSWER, "answer", chat=111, started=STARTED, asked="How is the pool?"))
    asyncio.run(stop_all())
    w = _again(tmp_path)
    (run,) = w.left(SCHEDULED)
    assert (run.name, run.slot, run.then) == ("reports:0:07:00", SLOT, AGAIN)
    answer, job = sorted(w.left(CHAT_JOB, ANSWER), key=lambda i: i.kind)
    assert (answer.kind, answer.chat, answer.mid, answer.then) == (ANSWER, 111, None, TELL)
    assert answer.cut_text(TZ) == ("Your question at 16/10/2026 14:30 (“How is the pool?”) was interrupted by a restart "
                                "of the agent: send it again to have its answer.")
    assert (job.kind, job.chat, job.mid, job.then) == (CHAT_JOB, 111, 4242, TELL)
    # the one sentence for a report that did not come (api_errors.NOT_COME), its cut variant
    assert job.cut_text(TZ) == ("The fm-weekly report you asked for at 16/10/2026 14:30 could not be prepared: the agent "
                                "was restarted meanwhile. Ask again to have it.")
    w = _again(tmp_path)
    assert w.left(SCHEDULED, CHAT_JOB, ANSWER) == []                         # read once


def test_one_kind_read_at_start_leaves_the_others_for_their_reader(tmp_path):
    # the scheduler reads its runs when it is built, chat_jobs.recover the chats' work: neither clears the other's
    w = _work(tmp_path)
    asyncio.run(_cut(w, Item(CHAT_JOB, "fm-weekly", chat=111, mid=1)))
    asyncio.run(_cut(w, Item(SCHEDULED, "reports:0:07:00", slot=SLOT)))
    assert [i.kind for i in _again(tmp_path).left(SCHEDULED)] == [SCHEDULED]
    assert [i.kind for i in _again(tmp_path).left(CHAT_JOB, ANSWER)] == [CHAT_JOB]


def test_rows_an_older_engine_left_are_read_with_the_same_decisions(tmp_path):
    st = State(str(tmp_path / "state.sqlite"))
    st.put("jobrun:reports:0:07:00", SLOT)                                     # cut before anything arrived
    st.put("jobrun:reports:1:08:00", "2026-10-16T08:00:00+08:00|delivered")   # 0.6.146–0.6.217: its report arrived
    st.put("chatjob:111:fm-weekly", json.dumps({"started": STARTED, "mid": 4242}))
    st.put("chatjob:-100333:answer", json.dumps({"started": STARTED, "asked": "/investigate the pump"}))
    w = _again(tmp_path)
    runs = {i.name: (i.slot, i.then) for i in w.left(SCHEDULED)}
    assert runs == {"reports:0:07:00": (SLOT, AGAIN), "reports:1:08:00": ("2026-10-16T08:00:00+08:00", NOTHING)}
    chats = {(i.chat, i.name): (i.kind, i.mid, i.asked, i.then) for i in w.left(CHAT_JOB, ANSWER)}
    assert chats == {(111, "fm-weekly"): (CHAT_JOB, 4242, None, TELL),
                     (-100333, "answer"): (ANSWER, None, "/investigate the pump", TELL)}
    assert st.kv_prefix("jobrun:") == {} and st.kv_prefix("chatjob:") == {}


@pytest.mark.parametrize("how", ["ends", "fails"])
def test_work_that_ends_or_fails_leaves_nothing_and_says_it_ended(tmp_path, how):
    w = _work(tmp_path)
    seen = []

    async def go():
        item = Item(CHAT_JOB, "fm-weekly", chat=111, mid=9)
        async with w.kept(item, after=lambda: seen.append(("after", w.running(111, "fm-weekly"))),
                          ended=lambda: _note(seen, "ended")):
            assert w.running(111, "fm-weekly") and w.state.chat_work_kept() != []
            if how == "fails":
                raise RuntimeError("the script failed")
    if how == "fails":
        with pytest.raises(RuntimeError):
            asyncio.run(go())
    else:
        asyncio.run(go())
    assert seen == [("after", False), "ended"]                               # no longer running, then its end is said
    assert w.state.chat_work_kept() == [] and _again(tmp_path).left(CHAT_JOB) == []


async def _note(seen, what):
    seen.append(what)


def test_work_a_stop_cuts_keeps_its_record_and_is_never_said_ended(tmp_path):
    w = _work(tmp_path)
    seen = []

    async def go():
        async def body():
            async with w.kept(Item(CHAT_JOB, "fm-weekly", chat=111, mid=9), after=lambda: seen.append("after"),
                              ended=lambda: _note(seen, "ended")):
                await asyncio.Event().wait()
        t = asyncio.create_task(body())
        await asyncio.sleep(0)
        t.cancel()
        await asyncio.gather(t, return_exceptions=True)
    asyncio.run(go())
    assert seen == ["after"] and not w.running(111, "fm-weekly")             # "typing…" let go, the chat told nothing
    assert [(i.name, i.mid) for i in _again(tmp_path).left(CHAT_JOB)] == [("fm-weekly", 9)]


def test_a_result_that_arrived_owes_nothing_whatever_kind(tmp_path):
    w = _work(tmp_path)

    async def scheduled_sends():
        w.arrived()                                                          # Delivery.send, in the run's own task

    async def go():
        await _cut(w, Item(SCHEDULED, "reports:0:07:00", slot=SLOT), before=scheduled_sends)
        job = w.begin(Item(CHAT_JOB, "fm-weekly", chat=111, mid=9))
        w.arrived(Origin(111, JOB, job="other"))                             # another job's result: not this one's
        assert not job.arrived
        w.arrived(Origin(111, JOB, job="fm-weekly"))
        assert job.arrived and job.then == NOTHING
    asyncio.run(go())
    assert _again(tmp_path).left(SCHEDULED, CHAT_JOB) == []


def test_a_message_sent_beside_a_scheduled_run_is_not_its_result(tmp_path):
    w = _work(tmp_path)

    async def go():
        async def run_cut_later():
            async with w.kept(Item(SCHEDULED, "reports:0:07:00", slot=SLOT)):
                await asyncio.Event().wait()
        run = asyncio.create_task(run_cut_later())
        await asyncio.sleep(0)

        async def a_chats_answer():
            w.arrived()                                                      # its own task: no scheduled run there
        await asyncio.create_task(a_chats_answer())
        run.cancel()
        await asyncio.gather(run, return_exceptions=True)
    asyncio.run(go())
    assert [(i.name, i.then) for i in _again(tmp_path).left(SCHEDULED)] == [("reports:0:07:00", AGAIN)]


def test_a_scheduled_job_holds_only_the_chats_where_it_is_not_already_running(tmp_path):
    w = _work(tmp_path)

    async def go():
        asked = w.begin(Item(CHAT_JOB, "fm-daily", chat=111, mid=9))
        async with w.held([111, 222], "fm-daily"):
            assert w.get(111, "fm-daily") is asked                           # the one asked for stays the record there
            assert w.get(222, "fm-daily").kind == HELD
            w.arrived(Origin(222, JOB, job="fm-daily"))                      # a held chat owes nothing: no promise made
            assert not w.get(222, "fm-daily").arrived
        assert w.get(111, "fm-daily") is asked and not w.running(222, "fm-daily")
    asyncio.run(go())
    assert w.state.chat_work_kept() == [(111, "fm-daily", json.dumps({"started": w.get(111, "fm-daily").started,
                                                                      "mid": 9}))]


@pytest.mark.parametrize("how,outcome,why", [("ends", "ended", None), ("fails", "failed", "RuntimeError: the script failed"),
                                             ("verdict", "failed", "the AI sent nothing"), ("cut", "cut", None)])
def test_how_a_scheduled_run_ended_is_written_by_the_one_bookkeeping(tmp_path, how, outcome, why):
    # architecture review scan 4 (2026-10-19): the Overview read the scheduler's claim, written BEFORE the run, and said
    # "run at 08:00" of a run that failed or was cut. kept() — the one cut/finally — writes how it ended; a body that
    # knows better than "it raised" (an AI job whose model could not run) says so with verdict()
    from vesta_agent.in_progress import FAILED, run_ends
    w = _work(tmp_path)

    async def go():
        item = Item(SCHEDULED, "reports:0:07:00", slot=SLOT)
        if how == "cut":
            await _cut(w, item)
            return
        async with w.kept(item):
            if how == "fails":
                raise RuntimeError("the script failed")
            if how == "verdict":
                assert w.verdict(FAILED, "the AI sent nothing")
    if how == "fails":
        with pytest.raises(RuntimeError):
            asyncio.run(go())
    else:
        asyncio.run(go())
    ends = run_ends(w.state)
    assert list(ends) == ["reports:0:07:00"]
    end = ends["reports:0:07:00"]
    assert (end["outcome"], end["why"], end["slot"]) == (outcome, why, SLOT) and datetime.fromisoformat(end["at"])
    assert not w.verdict(FAILED, "nothing runs here")                       # outside a scheduled run: refused


def test_a_chats_job_leaves_no_end_row(tmp_path):
    from vesta_agent.in_progress import run_ends
    w = _work(tmp_path)

    async def go():
        async with w.kept(Item(CHAT_JOB, "fm-weekly", chat=111, mid=9)):
            pass
    asyncio.run(go())
    assert run_ends(w.state) == {}
