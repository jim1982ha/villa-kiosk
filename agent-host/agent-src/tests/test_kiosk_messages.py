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
from vesta_agent.app import Vesta
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
    # its Done · Need help as Telegram shows them, none flagged (owner, 2026-10-29: the same wherever the alert shows)
    assert [sorted(b) for b in rec["buttons"]] == [["id", "kind", "label"]] * 2 and \
        [b["label"] for b in rec["buttons"]] == ["Done", "Need help"], rec["buttons"]
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

    async def go():
        # ⚠️ WAITS ON EVENTS, NEVER A STOPWATCH (git-gates-ci "Tests wait on events"; it failed twice on a busy machine
        # with "< 1 s"): the Kiosk's push may take 60s here, so an alert that waited for it could not end within 30s
        agent.messages._timeout_s = lambda: 60
        await asyncio.wait_for(alert(agent), 30)
        assert not gate.is_set(), "the alert ended while the Kiosk's push was still stuck"
        gate.set()
        await asyncio.wait_for(agent.messages.settle(), 30)
        # ...and a push the Kiosk never answers ends at its limit, never at the gate
        gate.clear()
        agent.messages._timeout_s = lambda: 0.05
        agent.messages.keep(kiosk_messages.of_note("note:slow", "T", "Owner", "words"))
        await asyncio.wait_for(agent.messages.settle(), 30)
    asyncio.run(go())
    assert any(SUMMARY in t for _c, t, _k in agent.tg.sent) or agent.tg.edits, "Telegram had the alert"
    assert "note:slow" not in agent.messages._last, "a push that timed out is tried again at the message's next change"


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


def test_the_ticket_is_named_as_telegram_names_the_alert(agent, kiosk):
    """Owner, 2026-10-28 ("consistency everywhere"): the ticket carries the alert's priority, so the tablet reads
    "#1-P2 · …" as Telegram's title "#1-P2 (new)" does — one label form, the agreement's ticket.alertLabel."""
    from vesta_shared.messaging import incident_tag
    scenario(agent, alert, lambda v: v.tickets.repair())
    (t,) = [t for t in kiosk.doc["data"]["tickets"] if t.get("alertNumber") == 1]
    assert t.get("alertPriority") == "P2", t
    assert kiosk.messages["incident:1"]["title"].startswith(incident_tag(1, "P2") + " "), kiosk.messages["incident:1"]["title"]


def test_a_ticket_made_before_gets_its_priority_at_the_next_repair(agent, kiosk):
    scenario(agent, alert, lambda v: v.tickets.repair())
    (t,) = [t for t in kiosk.doc["data"]["tickets"] if t.get("alertNumber") == 1]
    t.pop("alertPriority")                              # as an older Agent wrote it
    scenario(agent, lambda v: v.tickets.repair())
    (t,) = [t for t in kiosk.doc["data"]["tickets"] if t.get("alertNumber") == 1]
    assert t.get("alertPriority") == "P2", t


def test_one_list_of_priorities_on_both_sides():
    from vesta_shared import result
    assert list(result.PRIORITIES) == kiosk_messages.agreement.section("ticket")["priorities"]
    assert result.priority("P2") == "P2" and result.priority("P9") is None and result.priority(None) is None


def test_the_card_keeps_its_newest_runs_and_its_to_line_is_cut_like_every_text():
    cap = kiosk_messages.agreed_limit("takes")
    runs = [f"RUN-{n}" for n in range(cap + 5)]
    rec = kiosk_messages.of_parts("incident:1", {"head": "", "body": "x"}, to="T" * 999, takes=runs)
    assert rec["takes"] == runs[-cap:], "the newest runs: the villa's messages the tablet still holds"
    assert len(rec["to"]) == kiosk_messages.agreed_limit("to")


# ── a report and its page (ticket 20 of "One inbox", 2026-10-29) ────────────────────────────────────────────────────
PAGE = b"<!DOCTYPE html><html><body>The week</body></html>"


def scheduled_report(tmp_path, kiosk, people, send):
    """An agent whose skill `weekly` has one scheduled code job, `d.py`, printing `send` (its pages written in the out
    folder first); the job run as the app runs it: the scheduler's tick at its time, then every push settled."""
    import json
    from zoneinfo import ZoneInfo
    from helpers import make_skill
    from vesta_agent.scheduler import Scheduler
    v = make_agent(tmp_path, {"people": people}, kiosk=kiosk)
    make_skill(v.s.skills_dir, "weekly", {"tools": [], "schedule": [{"when": "07:00", "run": "d.py", "timeout": 60}]},
               {"d.py": f"import json\nprint(json.dumps({{'send': {json.dumps(send)!s}}}))\n"})
    for item in send:
        for att in ([item["attachment"]] if item.get("attachment") else []):
            with open(f"{v.s.out_dir}/{att}", "wb") as f:
                f.write(PAGE + att.encode())
    at = datetime(2026, 10, 26, 7, 5, tzinfo=ZoneInfo(v.s.timezone))

    async def go():
        sch = Scheduler(v.s, v.skills, v.state, v.run_code_job, v.jobs.run, lambda: asyncio.sleep(0), None, v.work)
        await sch.tick(at)
        await sch.idle()
        await v.messages.settle()
    asyncio.run(go())
    return v


def test_a_scheduled_report_is_kept_as_a_report_with_its_page(tmp_path, kiosk):
    v = scheduled_report(tmp_path, kiosk, [{"telegram_id": OWNER, "name": "Owner", "role": "owner"},
                                           {"telegram_id": FM, "name": "Wayan", "role": "fm"}],
                         [{"to": "fm", "title": "Weekly report", "text": "Two things to look at", "attachment": "week.html"},
                          {"to": "owner", "title": "Weekly report", "text": "Two things to look at", "attachment": "week.html"}])
    reports = [r for r in kiosk.messages.values() if r.get("report")]
    assert len(reports) == 2 and {r["report"] for r in reports} == {"weekly:d.py"}, kiosk.messages
    assert all(r["body"] == "Two things to look at" and r.get("page") for r in reports), reports
    assert set(kiosk.documents) == {PAGE + b"week.html"}, "the page uploaded attached to no fault"
    assert {r["page"] for r in reports} == {kiosk_messages.page_id(PAGE + b"week.html")}, "one page whatever the chats"
    assert kiosk.tickets == [], "no ticket was made for it: it lives with its message"


def test_a_report_in_two_languages_is_one_record(tmp_path, kiosk):
    scheduled_report(tmp_path, kiosk, [{"telegram_id": FM, "name": "Wayan", "role": "fm", "language": "en"},
                                       {"telegram_id": 333, "name": "Made", "role": "fm", "language": "fr"}],
                     [{"to": "fm", "language": "fr", "title": "Weekly report", "text": "Deux choses", "attachment": "w_fr.html"},
                      {"to": "fm", "language": "en", "title": "Weekly report", "text": "Two things", "attachment": "w_en.html"}])
    (rec,) = kiosk.messages.values()
    page = {lang: kiosk_messages.page_id(PAGE + f"w_{lang}.html".encode()) for lang in ("en", "fr")}
    assert rec["report"] == "weekly:d.py" and rec["body"] == "Deux choses" and rec["language"] == "fr", rec
    assert rec["page"] == page["fr"] and rec["languages"]["en"] == {"body": "Two things", "page": page["en"]}, rec


def test_only_an_html_page_goes_to_the_tablet(tmp_path, kiosk):
    scheduled_report(tmp_path, kiosk, [{"telegram_id": FM, "name": "Wayan", "role": "fm"}],
                     [{"to": "fm", "title": "Weekly figures", "text": "Attached", "attachment": "week.csv"}])
    (rec,) = kiosk.messages.values()
    assert rec["report"] == "weekly:d.py" and "page" not in rec and kiosk.documents == [], rec


def test_a_note_sent_outside_a_scheduled_run_is_no_report(agent, kiosk):
    async def note(v):
        await v.outcome.carry_out({"send": [{"to": "owner", "title": "The AI cannot answer", "text": "No credit left."}]})
    scenario(agent, note)
    (rec,) = kiosk.messages.values()
    assert "report" not in rec and "page" not in rec, rec


def test_a_report_whose_page_the_kiosk_cannot_hold_is_kept_without_it(tmp_path, kiosk):
    kiosk.documents = None                                      # a Kiosk older than 2.496.326: it keeps no page
    scheduled_report(tmp_path, kiosk, [{"telegram_id": FM, "name": "Wayan", "role": "fm"}],
                     [{"to": "fm", "title": "Weekly report", "text": "Two things", "attachment": "week.html"}])
    (rec,) = kiosk.messages.values()
    assert rec["report"] == "weekly:d.py" and "page" not in rec, rec


def test_a_chat_refusing_its_copy_leaves_the_card_whole(agent, kiosk):
    # architecture review 2026-10-29 #1: the copy Telegram refused in one chat was written to the tablet apart, with
    # none of the villa's runs the card stands for: the villa's own alert came back beside VESTA's card
    agent.tg.refuse.add(f"blocked {FM_CHAT}")
    scenario(agent, alert)
    rec = kiosk.messages["incident:1"]
    assert rec.get("takes") == ["RUN-1"], rec


def test_a_scheduled_report_rewritten_later_stays_a_report_with_its_page(tmp_path, kiosk):
    v = scheduled_report(tmp_path, kiosk, [{"telegram_id": FM, "name": "Wayan", "role": "fm"}],
                         [{"to": "fm", "title": "Night check", "text": "Pump idle", "key": "night-1", "attachment": "n.html"}])

    async def later(v):
        await v.outcome.carry_out({"edits": [{"key": "night-1", "title": "Night check", "text": "Pump idle, cleared"}]},
                                  "night-check")
    scenario(v, later)
    rec = kiosk.messages["note:night-1"]
    assert rec["body"] == "Pump idle, cleared" and rec["report"] == "weekly:d.py" and rec.get("page"), rec


def test_the_card_names_the_reader_whose_copy_telegram_refused(agent, kiosk):
    # architecture review 2026-10-29, round 2: "To:" was read from the chats that took a copy only
    from vesta_agent import layout

    async def told(v):
        v.state.set_incident_message(7, GROUP, {"mid": 1, "parts": layout.parts(body="x", head=layout.head("#7-P2", "Owner"))})
        v.thread.tell(7, layout.parts(body="x", head=layout.head("#7-P2", "FM")))
    scenario(agent, told)
    assert set(kiosk_messages.roles_of(kiosk.messages["incident:7"]["to"])) == {"Owner", "FM"}, kiosk.messages


def test_a_copy_the_kiosk_refused_is_pushed_again_unchanged(agent, kiosk):
    # architecture review 2026-10-29, round 3: a refused push stayed remembered, so the same copy was skipped after
    kiosk.message_refusals = 1
    rec = kiosk_messages.of_note("note:x", "Night check", "Owner", "Pump idle")

    async def twice(v):
        v.messages.keep(rec)
        await v.messages.settle()
        v.messages.keep(rec)
    scenario(agent, twice)
    assert kiosk.messages.get("note:x", {}).get("body") == "Pump idle", kiosk.messages


def test_the_tablets_card_tells_every_step_whoever_the_last_copy_was_drawn_for(agent, kiosk):
    """Alert #83 (owner, 2026-10-29): Telegram's copy for the owner lists the steps sent to the owner (each chat its own
    steps, 2026-10-18), but the tablet is everyone's: its card's Status is the whole story, as its short list is, never
    the last chat's that happened to be drawn."""
    scenario(agent, alert, lambda v: tick(v, 20), lambda v: tick(v, 50))
    status = kiosk.messages["incident:1"]["status"]
    assert any("Escalation sent" in line for line in status), status
    assert any("Alert sent" in line and "FM" in line for line in status), status
    assert any("Reminder sent" in line for line in status), status
    assert sum("Escalation sent" in line for line in status) == 1, status


def test_an_open_alert_with_no_step_since_the_tablet_kept_cards_gets_its_card_at_start(agent, kiosk):
    """Alert #83 (owner, 2026-10-29): no step since before the tablet kept alert cards, so the tablet showed the short
    list while Telegram showed the card. At start, every open alert's card is kept as its newest copy stands, its
    Status told for everyone; its "To:" names everyone it went to."""
    scenario(agent, alert, lambda v: tick(v, 20), lambda v: tick(v, 50))
    kiosk.messages.clear()
    for chat, rec in agent.state.incident_chats(1):       # copies drawn before their heading held every step
        head = dict(rec["parts"]["head"])
        head.pop("story", None)
        if chat == FM_CHAT:
            # ...one of them in an older wording no count draws again: it must never be the one told (round 2)
            head["history"] = ["- Alert sent long ago, in an older wording (to: FM)"]
        agent.state.set_incident_message(1, chat, {**rec, "parts": {**rec["parts"], "head": head}})
    agent.state.db.close()
    again = Vesta(agent.s, telegram=agent.tg, reader=agent.reader, kiosk=agent.kiosk)

    async def start(v):
        await v.start()
        await v.messages.settle()
    asyncio.run(start(again))
    rec = kiosk.messages["incident:1"]
    assert set(rec["roles"]) == {"FM", "Owner"}, rec
    assert any("Escalation sent" in line for line in rec["status"]), rec["status"]
    assert any("Alert sent" in line for line in rec["status"]) and any("Reminder sent" in line for line in rec["status"])
    assert sum("Escalation sent" in line for line in rec["status"]) == 1, rec["status"]
    assert [b["label"] for b in rec.get("buttons", [])] == ["Done", "Need help"], rec


def test_a_step_posted_on_an_alert_keeps_whose_it_is_for_its_redraw(agent, kiosk):
    # architecture review, 2026-10-30: Poster's kept step had no incident — a step to no role, drawn again in another
    # chat (notice.restatus), read "(to: nobody)" where the villa's own message taken over read "(to: digest)"
    from vesta_agent import layout

    scenario(agent, alert)
    said = [layout.of(rec).get("said") for _c, rec in agent.state.incident_chats(1)]
    assert said and all(isinstance(x, dict) and x.get("incident") == 1 for x in said), said
