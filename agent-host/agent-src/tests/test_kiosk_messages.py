"""Every message the agent writes on Telegram is also kept for the tablet, as it stands now (ticket 25 of "One inbox",
owner 2026-10-28), through the Kiosk fake: an alert it took over, a reminder rewriting it, the night check's message and
its rewrite, a note to the owner, a snapshot, an approval — one record per thread, replaced when it is rewritten, in the
background and never in the way of the message itself. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from helpers import make_agent
from ha_fake import FakeHA, tool
from kiosk_fake import FakeKiosk
from telegram_fake import BOT
from vesta_agent import kiosk_messages
from vesta_agent.ha_events import CONTEXT_KEY

OWNER, FM = 111, 222
GROUP, FM_CHAT = -100123, 222
SUMMARY = "🔓 Laundry door unlocked\nLaundry lock is unlocked\nHeld 1min"


def policy():
    return {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner", "language": "en"},
                       {"telegram_id": FM, "name": "Wayan", "role": "fm", "language": "en"}],
            "chats": {"owner": GROUP, "fm": FM_CHAT}}


@pytest.fixture
def kiosk():
    return FakeKiosk()


@pytest.fixture
def agent(tmp_path, kiosk):
    v = make_agent(tmp_path, policy(), skills=["alert-desk"], reader=FakeHA(tools=[tool("ha_get_state")]), kiosk=kiosk)
    v.bot_username = BOT["username"]
    return v


async def alert(v, context="RUN-1", mid=500):
    """Home Assistant's alert in the group, then its rule's event: VESTA takes the alert over."""
    await v.on_ha_event("telegram_sent", {"chat_id": GROUP, "message_id": mid, "bot": BOT, CONTEXT_KEY: context})
    await v.on_ha_event("vesta_critical_event", {
        "blueprint": "critical_condition", "rule_id": "automation.critical_condition_laundry",
        "incident_id": "automation.critical_condition_laundry-1", "phase": "opened", "severity": "critical",
        "label": "Laundry door unlocked", "entities": ["lock.laundry"], "summary": SUMMARY,
        "timestamp": datetime.now(timezone.utc).isoformat(), CONTEXT_KEY: context})


async def tick(v, minutes):
    sk = v.skills.get("alert-desk")
    at = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
    await v.run_code_job(sk, f"desk.py tick --now {at}", 60)


def scenario(v, *steps):
    """The steps (async callables taking the agent), then every push waited for, in ONE loop (the pushes are background
    tasks: a loop closed between two `asyncio.run`s would cancel them)."""
    async def go():
        for step in steps:
            await step(v)
        await v.messages.settle()
    asyncio.run(go())


def test_an_alert_it_took_over_is_kept_and_a_reminder_replaces_it(agent, kiosk):
    scenario(agent, alert)
    (rec,) = kiosk.messages.values()
    assert rec["key"] == "incident:1" and rec["title"].startswith("#1-P2") and SUMMARY in rec["body"]
    assert rec["roles"] == ["FM"] and rec["to"] == "FM" and rec["stage"] == "new" and rec["at"], rec
    form = kiosk_messages.agreement.section("vestaMessage")["incidentKey"]
    assert rec["key"] == form.replace("{number}", "1"), "the key in the agreement's form, the one the tablet reads"
    assert {b["kind"] for b in rec["buttons"]} == {"i"} and all(b["label"] and b["id"].startswith("1:") for b in rec["buttons"])
    assert "callback_data" not in str(rec) and "inline_keyboard" not in str(rec), "VESTA's button kind and id, nothing else"
    scenario(agent, tick_20 := (lambda v: tick(v, 20)))
    assert list(kiosk.messages) == ["incident:1"], "the reminder REPLACES the alert's record: one record per thread"
    now = kiosk.messages["incident:1"]
    assert any("Reminder sent" in line for line in now["status"]) and now["stage"] == "existing", now
    assert len(kiosk.pushed) > 1, "each step was pushed, the Kiosk replaced"
    scenario(agent, lambda v: tick(v, 50))
    assert any("Escalation sent" in line for line in kiosk.messages["incident:1"]["status"])


def test_a_press_that_closes_it_is_the_records_new_state(agent, kiosk):
    scenario(agent, alert, lambda v: tick(v, 20))
    data = next(b for b in kiosk.messages["incident:1"]["buttons"] if b["id"].endswith(":done"))
    iid = data["id"].split(":")[0]
    reminder = 1000 + len(agent.tg.sent)

    async def press(v):
        await v.on_ha_event("telegram_callback", {"id": "cb", "data": f"i:{iid}:done", "chat_id": FM_CHAT, "user_id": FM,
                                                  "message": {"message_id": reminder, "chat": {"id": FM_CHAT}}, "bot": BOT})
    scenario(agent, press)
    rec = kiosk.messages["incident:1"]
    assert "buttons" not in rec, "a settled message withdraws its buttons"
    assert any("Done" in line and "Wayan" in line for line in rec["status"]), rec["status"]


def test_the_night_checks_message_and_its_rewrite_are_one_record(agent, kiosk):
    send = {"send": [{"to": "owner", "title": "Night check", "text": "Findings:\n- Pump idle", "key": "night-2026-10-28"}]}
    edit = {"edits": [{"key": "night-2026-10-28", "title": "Night check", "text": "Findings:\n- ~Pump idle~ cleared"}]}

    async def first(v):
        await v.outcome.carry_out(send, "night-check")

    async def second(v):
        await v.outcome.carry_out(edit, "night-check")
    scenario(agent, first)
    assert list(kiosk.messages) == ["note:night-2026-10-28"]
    assert kiosk.messages["note:night-2026-10-28"]["title"] == "Night check" and "Pump idle" in kiosk.messages["note:night-2026-10-28"]["body"]
    scenario(agent, second)
    assert list(kiosk.messages) == ["note:night-2026-10-28"], "the rewrite replaces the first version"
    assert "cleared" in kiosk.messages["note:night-2026-10-28"]["body"]


def test_a_note_to_the_owner_is_kept_once_even_sent_to_two_chats(agent, kiosk):
    async def note(v):
        await v.outcome.carry_out({"send": [{"to": "owner", "title": "The AI cannot answer", "text": "No credit left."},
                                            {"to": "fm", "title": "The AI cannot answer", "text": "No credit left."}]})
    scenario(agent, note)
    assert list(kiosk.messages) and len(kiosk.messages) == 1, "the same words to two chats are one line"
    (rec,) = kiosk.messages.values()
    assert rec["key"].startswith("note:") and rec["body"] == "No credit left."


def test_a_reply_to_a_person_is_not_kept_for_the_tablet(agent, kiosk):
    from vesta_agent.routing import Origin, JOB
    async def reply(v):
        await v.outcome.carry_out({"send": [{"to": "here", "title": "Your report", "text": "Here it is."}]},
                                  origin=Origin(chat=FM_CHAT, kind=JOB, job="x", role="fm"))
    scenario(agent, reply)
    assert kiosk.messages == {}, "an answer a person asked for in their chat is the conversation's (ticket 21), not a notice"


def test_the_tablet_still_gets_it_when_telegram_is_off(tmp_path, kiosk):
    v = make_agent(tmp_path, policy(), kiosk=kiosk, telegram_on=False)

    async def note(v):
        await v.outcome.carry_out({"send": [{"to": "owner", "title": "Siren stopped", "text": "The siren was stopped."}]})
    scenario(v, note)
    assert [r["title"] for r in kiosk.messages.values()] == ["Siren stopped"], "Telegram off or refused: the tablet has it"


def test_a_snapshot_or_approval_is_kept_when_telegram_took_nothing(tmp_path, kiosk):
    v = make_agent(tmp_path, policy(), kiosk=kiosk, telegram_on=False)

    async def snap(v):
        await v.poster.post(GROUP, "Camera snapshot", incident=1, photo=("QUJD", "image/jpeg"), thread="snapshot-1")
    scenario(v, snap)
    assert kiosk.messages["thread:snapshot-1"]["photo"] == "QUJD", "no Telegram: the tablet still has the snapshot"


def test_a_snapshot_under_an_alert_carries_its_picture(agent, kiosk):
    async def snap(v):
        await v.poster.post(GROUP, "Camera snapshot", incident=1, photo=("QUJD", "image/jpeg"), thread="snapshot-1")
    scenario(agent, alert, snap)
    rec = kiosk.messages["thread:snapshot-1"]
    assert rec["photo"] == "QUJD" and rec["body"] == "Camera snapshot"
    assert "photo" not in kiosk.messages["incident:1"], "the alert itself carries none"


def test_a_close_and_a_take_on_in_the_cockpit_replace_the_record(agent, kiosk):
    scenario(agent, alert)
    assert kiosk.messages["incident:1"]["buttons"]

    async def taken(v):
        await v.thread.restate(1, "Taken on in the Cockpit by Wayan.")
    scenario(agent, taken)
    rec = kiosk.messages["incident:1"]
    assert rec["status"][-1].endswith("Taken on in the Cockpit by Wayan.") and "buttons" not in rec, rec

    async def closed(v):
        await v.thread.close(1, "Closed on {time}: cleared.")
    scenario(agent, closed)
    rec = kiosk.messages["incident:1"]
    assert "Closed on" in rec["status"][-1] and "buttons" not in rec, rec


def test_an_identical_push_is_skipped_and_a_changed_one_is_not(agent, kiosk):
    first = kiosk_messages.of_note("note:x", "Title", "Owner", "Words")

    async def go():
        agent.messages.keep(first)
        await agent.messages.settle()
        agent.messages.keep({**first, "at": "2030-01-01T00:00:00+00:00"})     # the same words, drawn again later
        await agent.messages.settle()
        agent.messages.keep(kiosk_messages.of_note("note:x", "Title", "Owner", "Other words"))
        await agent.messages.settle()
    asyncio.run(go())
    assert [r["body"] for r in kiosk.pushed] == ["Words", "Other words"]


def test_an_alert_burst_is_pushed_in_order_with_the_newest_last(agent, kiosk):
    async def go():
        for n in range(5):                    # five changes before the first push has finished
            agent.messages.keep(kiosk_messages.of_note("note:x", "T", "Owner", f"version {n}"))
        await agent.messages.settle()
    asyncio.run(go())
    assert kiosk.messages["note:x"]["body"] == "version 4" and [r["body"] for r in kiosk.pushed][-1] == "version 4"
    assert [r["body"] for r in kiosk.pushed] == sorted(r["body"] for r in kiosk.pushed), "never out of order"


def test_a_slow_kiosk_never_delays_the_message_and_loses_only_its_copy(agent, kiosk):
    gate = asyncio.Event()

    async def stuck(record):
        await gate.wait()
        return True
    kiosk.keep_message = stuck
    agent.messages._timeout_s = lambda: 0.05

    async def go():
        t0 = asyncio.get_running_loop().time()
        await alert(agent)
        assert asyncio.get_running_loop().time() - t0 < 1, "the alert did not wait for the Kiosk"
        await asyncio.wait_for(agent.messages.settle(), 2)          # the limit ends the push, never the gate
    asyncio.run(go())
    assert any(SUMMARY in t for _c, t, _k in agent.tg.sent) or agent.tg.edits, "Telegram had the alert"
    assert agent.messages._last == {}, "a push that timed out is tried again at the message's next change"


def test_a_kiosk_that_cannot_be_reached_or_keeps_none_changes_nothing(agent, kiosk):
    kiosk.keeps_messages = False                    # an older Kiosk answers 404
    scenario(agent, alert, lambda v: tick(v, 20))
    assert kiosk.messages == {} and agent.tg.sent, "the alert and its reminder went to Telegram"

    from vesta_agent.kiosk import KioskError

    async def down(record):
        raise KioskError("POST /agent/v1/vesta-message: ClientConnectorError")
    kiosk.keep_message = down
    scenario(agent, lambda v: tick(v, 50))
    assert agent.tg.sent[-1], "an unreachable Kiosk loses the copy and nothing else"


def test_no_kiosk_no_push(tmp_path):
    v = make_agent(tmp_path, policy(), skills=["alert-desk"], reader=FakeHA(tools=[tool("ha_get_state")]))
    v.bot_username = BOT["username"]
    scenario(v, alert)
    assert v.messages._running == {} and v.messages._last == {}


def test_the_records_limits_are_the_agreements(agent):
    limits = kiosk_messages.agreement.section("vestaMessage")["limits"]
    rec = kiosk_messages.of_note("note:x", "T" * 900, "Owner & FM", "b" * 99999, status="s" * 9999)
    assert len(rec["title"]) == limits["title"] and len(rec["body"]) == limits["body"]
    assert len(rec["status"][0]) == limits["statusLine"] and rec["roles"] == ["Owner", "FM"]


def test_a_report_cut_by_a_restart_is_kept_for_the_tablet_but_a_question_is_not(agent, kiosk):
    from vesta_agent.in_progress import ANSWER, CHAT_JOB, Item

    async def cut(v):
        for item in (Item(CHAT_JOB, "fm-weekly", chat=FM_CHAT, started=1.0), Item(ANSWER, "answer", chat=FM_CHAT, started=1.0,
                                                                                 asked="How is the pool?")):
            async def body():
                async with v.work.kept(item):
                    await asyncio.Event().wait()
            t = asyncio.create_task(body())
            await asyncio.sleep(0)
            t.cancel()
            await asyncio.gather(t, return_exceptions=True)
        await v.chat_jobs.recover()
    scenario(agent, cut)
    assert any("could not be prepared" in r["body"] for r in kiosk.messages.values()), kiosk.messages
    assert not any("interrupted by a restart" in r["body"] for r in kiosk.messages.values()), "a question is ticket 21's"


def test_a_fault_a_person_reopens_in_the_cockpit_reaches_the_tablet(tmp_path, kiosk):
    import importlib.util
    import os
    from helpers import STARTER_SKILLS
    from vesta_shared.problems import Problems
    from vesta_shared.store import Store
    spec = importlib.util.spec_from_file_location("desk25k", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
    desk = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(desk)
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=kiosk)
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    iid = st.new_incident("automation.door|lock.door", "automation.door", "lock.door", "P2", {"message": "Door unlocked"})
    tid, _ = pb.open_task("incident", iid, "automation.door", "lock.door", "Door unlocked")
    st.set_task_uid(tid, "t-door")
    pb.close_incident(iid, "resolved", datetime.now(timezone.utc).isoformat(), "Cleared")
    kiosk.held("t-door")
    kiosk.person_reopens("t-door", by="Owner")
    asyncio.run(v.tickets.repair())
    out = desk.tick(st, datetime.now(timezone.utc))

    async def tell(v):
        await v.outcome.carry_out({"send": out["send"], "incident_id": iid}, "alert-desk")
    scenario(v, tell)
    (rec,) = [r for k, r in kiosk.messages.items() if k == f"incident:{iid}"]
    assert any("Reopened in the Cockpit" in line for line in rec["status"]), rec


def test_a_scheduled_digest_is_kept_but_the_same_report_asked_for_in_a_chat_is_not(tmp_path, kiosk):
    from helpers import make_skill
    from vesta_agent import job_steps
    from vesta_agent.routing import JOB, Origin
    v = make_agent(tmp_path, policy(), kiosk=kiosk)
    make_skill(v.s.skills_dir, "digest", {"tools": []}, {"d.py": (
        "import json\nprint(json.dumps({'send': [{'to': 'owner', 'title': 'Morning digest', "
        "'text': 'New since yesterday: nothing. Still open: 1.'}]}))\n")})
    sk = v.skills.get("digest")

    async def run_one(origin):
        await job_steps.run(v.s, v.state, v.skills, v.outcome, sk, [{"run": "d.py"}], {"to": "owner"}, origin)
    scenario(v, lambda v: run_one(None))
    assert [r["title"] for r in kiosk.messages.values()] == ["Morning digest"]
    kiosk.messages.clear()
    scenario(v, lambda v: run_one(Origin(chat=OWNER, kind=JOB, job="digest", role="owner")))
    assert kiosk.messages == {}


def test_the_card_names_the_villa_run_it_took_over(agent, kiosk):
    """Tickets 26-27 of "One inbox" (owner 2026-10-28: "update the existing card, the same way it is done on Telegram"):
    the villa's own alert of a run VESTA took over gives way to VESTA's card on the tablet."""
    scenario(agent, alert)
    assert kiosk.messages["incident:1"]["takes"] == ["RUN-1"]

    async def again(v):
        await alert(v, context="RUN-2", mid=501)          # the villa's same alert, a new run (its repeat)
    scenario(agent, again)
    assert kiosk.messages["incident:1"]["takes"] == ["RUN-1", "RUN-2"], kiosk.messages["incident:1"]


def test_a_run_whose_telegram_message_never_came_still_gives_way_to_the_card(agent, kiosk, monkeypatch):
    from vesta_agent import outcome as outcome_mod
    monkeypatch.setattr(outcome_mod, "HA_SENT_WAIT_S", ())
    scenario(agent, alert)

    async def no_telegram(v):     # the villa announced it, Telegram refused it: nothing to take over there
        await v.outcome.adopt_ha({"incident_id": 1, "context": "RUN-3", "text": "x"})
    scenario(agent, no_telegram)
    assert kiosk.messages["incident:1"]["takes"] == ["RUN-1", "RUN-3"]
