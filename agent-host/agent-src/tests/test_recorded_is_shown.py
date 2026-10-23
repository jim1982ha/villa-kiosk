"""What the agent records as done is what the owner sees (architecture review 21, 2026-10-10).

Three defects of one shape: a request approved in the seconds before an update was never ended (its buttons stayed for
good); a copy Telegram did not take the change of was recorded settled and never tried again; a request no chat received
was told to the AI as waiting. And two cut by a stop: a report asked for in a chat, and a scheduled one. Each test here
goes through the agent's real path — a press through handle_callback, a stop and a start through `restarted`."""
from __future__ import annotations

import asyncio
import re

from helpers import body, make_agent, restarted
from vesta_shared.messaging import SIREN_TITLE
from telegram_fake import BOT
from vesta_agent import button_data

JM, FABIEN, GROUP = 111, 222, -100333


def run(c):
    return asyncio.run(c)


def _villa(tmp_path, people=None, **policy):
    v = make_agent(tmp_path, {"people": people or [{"telegram_id": JM, "name": "JM", "role": "owner"},
                                                   {"telegram_id": FABIEN, "name": "Fabien", "role": "fm"}],
                              "act_enabled": True, "allowed_services": {"cover.open_cover": "any"}, **policy})

    class Writer:
        def call_service(self, *a):
            pass

        def states(self, ids):
            return {i: {"state": "open"} for i in ids}
    v.actions.writer_factory = Writer
    return v


def _press(v, msg, chat=JM, who=JM, yn="y"):
    mid = next(n for n, (c, _t, k) in enumerate(v.tg.sent, start=1001) if c == chat and k)
    data = msg.keyboard["inline_keyboard"][0][0 if yn == "y" else 1]["callback_data"]

    async def go():
        await v.on_ha_event("telegram_callback", {"id": "cb", "data": data, "chat_id": chat, "user_id": who,
                                                  "message": {"message_id": mid, "chat": {"id": chat}}, "bot": BOT})
        await v.approvals.idle()
    run(go())


# ---------------------------------------------------------------------- a stop in the middle of a press
def test_a_request_approved_seconds_before_a_restart_is_ended_at_the_start(tmp_path):
    v = _villa(tmp_path)
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().person(JM), JM)
    run(v.approvals.ask(msg))
    v.state.claim_approval(msg.approval_id, "approved", JM, name="JM")      # approved; the agent stops right here…
    v = restarted(v)                                                       # …and is back 40 s later
    assert v.state.approval(msg.approval_id)["status"] == "done"            # the curtain reads open: done
    (_, _, text), = v.tg.edits
    assert re.search(r"\nOpened .*\n\nStatus:\nApproved on \d\d/\d\d/\d{4} \d\d:\d\d \(JM\)\.$", text)


def test_a_decision_whose_copies_never_said_so_says_it_at_the_start(tmp_path):
    v = _villa(tmp_path)
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().person(JM), JM)
    run(v.approvals.ask(msg))
    v.actions.decide(msg.approval_id, JM, False, chat=JM)                  # refused; stopped before the copies changed
    assert v.tg.edits == []
    v = restarted(v)
    (_, _, text), = v.tg.edits
    assert re.search(r"\n\nStatus:\nRefused on .* \(JM\)\. Nothing was done\.$", text)
    v = restarted(v)
    assert len(v.tg.edits) == 1                                            # settled once: a later start changes nothing


# ---------------------------------------------------------------------- Telegram does not take a change
def test_a_copy_telegram_did_not_take_is_tried_again_until_it_shows(tmp_path):
    v = _villa(tmp_path)
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().person(JM), JM)
    run(v.approvals.ask(msg))
    v.tg.refuse.add("edit")                                                # a network blip, just then
    _press(v, msg)
    assert v.tg.edits == []
    (rec,) = v.approvals.thread.shown(f"approval-{msg.approval_id}").values()
    assert rec["settled"] and rec["owed"]                                  # decided — and still owed to the chat
    run(v.housekeeping())                                                  # still refused: tried again later
    v.tg.refuse.discard("edit")
    run(v.housekeeping())
    (_, _, text), = v.tg.edits
    assert re.search(r"\n\nStatus:\nApproved on .* \(JM\)\.", text)
    run(v.housekeeping())
    assert len(v.tg.edits) == 1                                            # shown: never sent again


def test_a_copy_is_tried_again_for_two_hours_whatever_the_pace_then_given_up(tmp_path, monkeypatch):
    # architecture review 22: 12 tries at one every 30 s were 6 minutes — a 10-minute internet cut outlived them
    from datetime import datetime, timedelta, timezone
    from vesta_agent import incident_thread
    v = _villa(tmp_path)
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().person(JM), JM)
    run(v.approvals.ask(msg))
    v.tg.refuse.add("edit")                                                # deleted in the chat: refused for ever
    _press(v, msg)
    for _ in range(40):                                                    # 20 minutes of passes, every 30 s
        run(v.housekeeping())
    assert v.state.incident_messages_owed()                                # still tried
    t0 = datetime.now(timezone.utc)

    class Later(datetime):
        @classmethod
        def now(cls, tz=None):
            return t0 + timedelta(hours=2, minutes=1)
    monkeypatch.setattr(incident_thread, "datetime", Later)
    run(v.housekeeping())
    assert v.state.incident_messages_owed() == []                          # two hours on: given up


def test_a_photos_message_is_changed_through_its_caption():
    # an alert sent with its file: editMessageText is refused on it, every time
    from vesta_agent.telegram import Telegram, TelegramError
    tg, calls = Telegram("42:T"), []

    async def api(method, **data):
        calls.append(method)
        if method == "editMessageText":
            raise TelegramError("editMessageText: 400 Bad Request: there is no text in the message to edit")
        return True
    tg.api = api
    assert run(tg.edit(1, 2, "Done pressed by JM")) and calls == ["editMessageText", "editMessageCaption"]

    async def same(method, **data):
        raise TelegramError(f"{method}: 400 Bad Request: message is not modified: specified new message content ...")
    tg.api = same
    assert run(tg.edit(1, 2, "Done pressed by JM"))                         # it already shows it: shown


# ---------------------------------------------------------------------- nobody received it
def test_a_request_nobody_received_is_never_waiting(tmp_path):
    v = _villa(tmp_path)
    v.tg.refuse.add("blocked")
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().person(JM), JM)
    assert run(v.approvals.ask(msg)) == 0
    assert v.state.approval(msg.approval_id)["status"] == "undelivered"
    told = v.approvals.now()
    assert "- nothing is waiting for approval" in told and "never delivered: no chat received it" in told


def test_the_intrusion_is_said_when_no_owner_chat_takes_the_siren_request(tmp_path):
    from vesta_shared import result as R
    v = _villa(tmp_path, siren_entity="switch.siren", switch_entities=["switch.siren"],
               allowed_services={"switch.turn_on": "owner"})
    _, msg = v.actions.request("switch", "turn_on", "switch.siren", {}, None, None)
    assert msg is not None                                                 # the siren CAN be requested here
    v.tg.refuse.add(f"blocked {JM}")                                       # but the owner's chat refuses it
    run(v.outcome.carry_out({"siren_gate": R.siren(True, "Intrusion suspected.", ("owner", "fm"))}, "alert-desk"))
    (chat, text, kb), = v.tg.sent
    assert chat == FABIEN and kb is None
    assert text.startswith(f"{SIREN_TITLE}\nTo: ") and \
        "\nIntrusion suspected.\n\nStatus:\nThe siren cannot be requested: no chat of the owner's" in text


# ---------------------------------------------------------------------- one name per person per chat
def test_a_person_listed_twice_is_named_one_way_in_a_chat(tmp_path):
    people = [{"telegram_id": JM, "name": "JM_O", "role": "owner"}, {"telegram_id": JM, "name": "JM_FM", "role": "fm"},
              {"telegram_id": GROUP, "name": "Group_FM", "role": "fm"}]
    from helpers import known_devices
    v = _villa(tmp_path, people=people)
    known_devices(v, "cover.bedroom3")
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().member(JM, GROUP), GROUP)
    assert msg.chats == [GROUP]
    run(v.approvals.ask(msg))
    _press(v, msg, chat=GROUP)
    (_, _, text), = v.tg.edits
    assert bool(re.search(r"\n\nStatus:\nApproved on .* \(JM_FM\)\.", text))                        # the name the group knows, as an alert press
    assert "(by JM_FM on " in v.approvals.now()
    assert v.policy().member(JM, GROUP).name == v.policy().name_in(JM, GROUP) == "JM_FM"


# ---------------------------------------------------------------------- a report cut by a stop
def test_a_report_asked_for_in_a_chat_and_cut_by_a_stop_says_so_at_the_start(tmp_path):
    v = _villa(tmp_path)

    async def forever(origin):
        await asyncio.Event().wait()

    async def ask():
        v.chat_jobs.start(JM, "weekly", forever, waiting_mid=4242)
        await asyncio.sleep(0)
    run(ask())                                                             # the run ends: the job is cut, as by a stop
    v = restarted(v)
    (chat, mid, text), = v.tg.edits
    assert (chat, mid) == (JM, 4242)
    # the one sentence for a report that did not come, its cut variant (api_errors.NOT_COME, scan 4), written over its
    # waiting message in the one layout: titled as when its AI could not run, "To:" its readers (owner, 2026-10-23)
    assert text.startswith("Report not prepared\nTo: Owner\n"), text
    assert re.fullmatch(r"The weekly report you asked for at \d\d/\d\d/\d{4} \d\d:\d\d could not be prepared: the agent "
                        r"was restarted meanwhile\. Ask again to have it\.", body(text))
    from vesta_shared.message_format import telegram_entities
    assert telegram_entities(text)[0] == {"type": "bold", "offset": 0, "length": len("Report not prepared")}
    v = restarted(v)
    assert len(v.tg.edits) == 1                                            # said once


def test_a_report_that_ended_leaves_nothing_for_the_next_start(tmp_path):
    v = _villa(tmp_path)

    async def done(origin):
        return None

    async def ask():
        v.chat_jobs.start(JM, "weekly", done, waiting_mid=4242)
        await v.chat_jobs.idle()
    run(ask())
    edits = len(v.tg.edits)
    v = restarted(v)
    assert len(v.tg.edits) == edits and v.state.chat_work_kept() == []


def test_a_scheduled_run_cut_by_a_stop_runs_again_in_its_window(tmp_path):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from vesta_agent.scheduler import Scheduler, job_key
    from vesta_agent.state import State
    from helpers import settings
    s = settings(str(tmp_path))
    st = State(s.state_path)
    ran = []

    class Skill:
        name, every_5_min = "reports", None
        schedule = [{"when": "07:00", "run": "x.py", "timeout": 60}]

    class Skills:
        def all(self):
            return {"reports": Skill()}

    async def forever(sk, cmd, timeout):
        ran.append(cmd)
        await asyncio.Event().wait()

    async def quick(sk, cmd, timeout):
        ran.append(cmd)

    async def noop():
        pass
    at = datetime(2026, 10, 10, 7, 5, tzinfo=ZoneInfo(s.timezone))

    async def tick(sch):
        await sch.tick(at)
        await asyncio.sleep(0)
    run(tick(Scheduler(s, Skills(), st, forever, None, noop)))             # started, then cut by the stop
    assert ran == ["x.py"] and st.kv_prefix("jobrun:") == {f"jobrun:{job_key('reports', 0, '07:00')}":
                                                           at.replace(minute=0).isoformat()}
    again = Scheduler(s, Skills(), st, quick, None, noop)                  # the next start
    run(tick(again))
    assert ran == ["x.py", "x.py"]                                         # run again in its window
    run(tick(again))
    run(tick(Scheduler(s, Skills(), st, quick, None, noop)))
    assert ran == ["x.py", "x.py"]                                         # once: it ended, nothing left to take up


def test_a_report_whose_result_came_is_never_said_stopped(tmp_path):
    # architecture review 22: a stop after the report arrived said "stopped by a restart: ask again" under it
    from vesta_agent.routing import JOB, Origin
    v = _villa(tmp_path)

    async def sends_then_hangs(origin):
        await v.delivery.send(JM, "The weekly report.", origin=origin)
        await asyncio.Event().wait()

    async def ask():
        v.chat_jobs.start(JM, "weekly", sends_then_hangs, waiting_mid=4242)
        for _ in range(5):
            await asyncio.sleep(0)
    run(ask())
    edits = len(v.tg.edits)
    v = restarted(v)
    assert len(v.tg.edits) == edits and not any("restarted meanwhile" in t for _, t, _ in v.tg.sent)


def test_a_scheduled_report_that_arrived_is_not_sent_again_after_a_stop(tmp_path):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from vesta_agent.in_progress import InProgress
    from vesta_agent.scheduler import Scheduler
    from vesta_agent.state import State
    from helpers import settings
    s = settings(str(tmp_path))
    st = State(s.state_path)
    ran = []

    class Skill:
        name, every_5_min = "reports", None
        schedule = [{"when": "07:00", "run": "x.py", "timeout": 60}]

    class Skills:
        def all(self):
            return {"reports": Skill()}

    async def sends_then_hangs(sk, cmd, timeout):
        ran.append(cmd)
        InProgress(st).arrived()                                           # what Delivery.send does once it arrived
        await asyncio.Event().wait()

    async def noop():
        pass
    at = datetime(2026, 10, 10, 7, 5, tzinfo=ZoneInfo(s.timezone))

    async def tick(sch):
        await sch.tick(at)
        await asyncio.sleep(0)
    run(tick(Scheduler(s, Skills(), st, sends_then_hangs, None, noop)))
    run(tick(Scheduler(s, Skills(), st, sends_then_hangs, None, noop)))   # the next start, in the same window
    assert ran == ["x.py"]


def test_a_message_sent_on_behalf_of_a_scheduled_run_marks_it_delivered(tmp_path):
    # the seam the scheduler relies on: Delivery.send, inside the run's own task
    from vesta_agent.in_progress import SCHEDULED, Item
    v = _villa(tmp_path)

    async def run_job():
        async with v.work.kept(Item(SCHEDULED, "reports:0:07:00", slot="2026-10-10T07:00:00+08:00")):
            assert v.state.runs_kept() == {"reports:0:07:00": "2026-10-10T07:00:00+08:00"}
            await v.delivery.send(JM, "The weekly report.")
            raise asyncio.CancelledError                                   # then the stop
    try:
        run(run_job())
    except asyncio.CancelledError:
        pass
    assert v.work.left(SCHEDULED) == []                                    # cut now: delivered, never run again


def test_a_copy_given_up_once_gets_its_own_two_hours_at_its_next_change(tmp_path, monkeypatch):
    # architecture review 23: the given-up copy kept its old clock, so a later failed change was given up at once
    from datetime import datetime, timedelta, timezone
    from vesta_agent import incident_thread
    v = _villa(tmp_path)
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().person(JM), JM)
    run(v.approvals.ask(msg))
    v.tg.refuse.add("edit")
    _press(v, msg)
    t0 = datetime.now(timezone.utc)

    def at(delta):
        class Later(datetime):
            @classmethod
            def now(cls, tz=None):
                return t0 + delta
        monkeypatch.setattr(incident_thread, "datetime", Later)
    at(timedelta(hours=3))
    run(v.housekeeping())
    assert v.state.incident_messages_owed() == []                          # given up
    run(v.thread.rewrite(f"approval-{msg.approval_id}", "Opened Bedroom3 Curtain."))   # a later change, refused too
    assert v.state.incident_messages_owed()                                # tried again: its own two hours


# ---------------------------------------------------------------------- a question cut by a stop
def test_a_question_being_answered_when_the_agent_stops_is_said_at_the_start(tmp_path, monkeypatch):
    # owner, 2026-10-15: an /investigate running when the agent was updated "went quiet" — the question lived in memory
    v = _villa(tmp_path)
    person = v.policy().person(JM)

    async def forever(*a, **k):
        await asyncio.Event().wait()
    monkeypatch.setattr(v, "_converse", forever)

    async def ask():
        # kept: an unreferenced task can be garbage-collected while pending ("Task was destroyed but it is pending!"),
        # its clean-up then runs as a normal end and the record goes — not a stop. asyncio.run cancels a kept one
        ask.task = asyncio.create_task(v.converse(JM, person, "/investigate What happened to the bathroom sensor yesterday?"))
        # until the question is recorded as being answered (a fixed sleep lost the race on a loaded runner)
        for _ in range(500):
            if v.state.chat_work_kept():
                return
            await asyncio.sleep(0.01)
    run(ask())                                                             # the run ends: the answer is cut, as by a stop
    v = restarted(v)
    # sent, or written over its waiting message when one had gone out already (chat_jobs.recover): on a loaded runner
    # the question had time to show "still working" before the stop
    said = [t for _, t, _ in v.tg.sent if "interrupted by a restart" in t] + \
           [t for _, _, t in v.tg.edits if "interrupted by a restart" in t]
    assert len(said) == 1 and re.fullmatch(r"Your question at \d\d/\d\d/\d{4} \d\d:\d\d \(“/investigate What happened to "
                                           r"the bathroom sensor yesterday\?”\) was interrupted by a restart of the "
                                           r"agent: send it again to have its answer\.", body(said[0])), said
    # in the one layout, under its own title (owner, 2026-10-23), sent new or written over its waiting message alike
    from vesta_shared.message_format import telegram_entities
    assert said[0].startswith("Question not answered\nTo: Owner\n"), said
    assert telegram_entities(said[0])[0] == {"type": "bold", "offset": 0, "length": len("Question not answered")}
    v = restarted(v)
    assert len([t for _, t, _ in v.tg.sent if "interrupted by a restart" in t] +
               [t for _, _, t in v.tg.edits if "interrupted by a restart" in t]) == 1    # said once


def test_a_question_answered_leaves_nothing_for_the_next_start(tmp_path, monkeypatch):
    v = _villa(tmp_path)

    async def answered(*a, **k):
        return None
    monkeypatch.setattr(v, "_converse", answered)
    run(v.converse(JM, v.policy().person(JM), "How is the pool?"))
    v = restarted(v)
    assert not [t for _, t, _ in v.tg.sent if "interrupted by a restart" in t]
