"""One message per incident per chat (owner, 2026-10-09): "only show the latest message for a given incident, so
the Telegram channel is not overflowed", each message recalling the original alert, the incident's number always
there and always written the same way — Home Assistant's own alert included. Synthetic villa; ids invented."""
from __future__ import annotations

import re

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from helpers import make_agent, body, status
from ha_fake import FakeHA, tool
from telegram_fake import BOT
from vesta_agent.ha_events import CONTEXT_KEY

OWNER, FM = 111, 222
GROUP, FM_CHAT = -100123, 222
SUMMARY = "🔓 Laundry door unlocked\nLaundry lock is unlocked\nHeld 1 min"


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def agent(tmp_path):
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner", "language": "en"},
                                         {"telegram_id": FM, "name": "Wayan", "role": "fm", "language": "en"}],
                              "chats": {"owner": GROUP, "fm": FM_CHAT}}, skills=["alert-desk"],
                   reader=FakeHA(tools=[tool("ha_get_state")]))
    v.bot_username = BOT["username"]
    return v


def ha_alert(v, context="RUN-1", mid=500):
    """What Home Assistant does: its rule's message in the group (telegram_sent), then the rule's event — one run,
    one context."""
    run(v.on_ha_event("telegram_sent", {"chat_id": GROUP, "message_id": mid, "bot": BOT, CONTEXT_KEY: context}))
    run(v.on_ha_event("vesta_critical_event", {
        "blueprint": "critical_condition", "rule_id": "automation.critical_condition_laundry",
        "incident_id": "automation.critical_condition_laundry-1", "phase": "opened", "severity": "critical",
        "label": "Laundry door unlocked", "entities": ["lock.laundry"], "summary": SUMMARY,
        "timestamp": datetime.now(timezone.utc).isoformat(), CONTEXT_KEY: context}))


def tick(v, minutes):
    sk = v.skills.get("alert-desk")
    at = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
    run(v.run_code_job(sk, f"desk.py tick --now {at}", 60))


def shown(v, chat):
    """What the chat shows now: every message sent there that was not deleted since (its latest text, edits
    included)."""
    ids, texts = [], {}
    n = 1000
    for c, text, _kb in v.tg.sent:
        n += 1
        if c == chat:
            ids.append(n); texts[n] = text
    for c, mid, text in v.tg.edits:
        if c == chat:
            texts[mid] = text
            if mid not in ids:
                ids.append(mid)                # Home Assistant's own message, rewritten
    gone = {mid for c, mid in v.tg.deleted if c == chat}
    return [texts[m] for m in ids if m not in gone]


def test_home_assistants_alert_takes_the_incidents_number(agent):
    ha_alert(agent)
    (grp,) = shown(agent, GROUP)
    assert grp.startswith("For: ") and ", P2 Incident: New #1\n" in grp and status(grp) == "" and body(grp).startswith("🔓") and SUMMARY in grp and "What to do:" in grp
    (fm,) = shown(agent, FM_CHAT)
    assert status(fm) == "" and body(fm).startswith("🔓") and SUMMARY in fm and "Press Done" not in fm and "Reply Done" not in fm


def test_each_chat_keeps_only_the_latest_message_and_it_recalls_the_alert(agent):
    ha_alert(agent)
    tick(agent, 20)                            # the reminder replaces the alert in the FM's chat
    (fm,) = shown(agent, FM_CHAT)
    assert status(fm) == "Reminder: no answer after 15 min" and SUMMARY in fm and "What to do:" in fm
    assert agent.tg.sent[-1][2], "the reminder carries the buttons"
    tick(agent, 50)                            # the escalation replaces Home Assistant's alert in the owner's chat
    (grp,) = shown(agent, GROUP)
    assert status(grp) == "No answer from the facility manager after 45 min" and SUMMARY in grp
    assert (GROUP, 500) in agent.tg.deleted
    assert len(shown(agent, FM_CHAT)) == 1     # the FM's reminder is untouched by the owner's message


def test_an_answer_replaces_the_alert_where_it_was_given(agent):
    ha_alert(agent)
    tick(agent, 20)
    reminder = 1000 + len(agent.tg.sent)
    iid = agent.tg.sent[-1][2]["inline_keyboard"][0][0]["callback_data"].split(":")[1]
    run(agent.on_ha_event("telegram_callback", {"id": "cb", "data": f"i:{iid}:done", "chat_id": FM_CHAT, "user_id": FM,
                                                "message": {"message_id": reminder, "chat": {"id": FM_CHAT}}, "bot": BOT}))
    (fm,) = shown(agent, FM_CHAT)
    # the alert first, then where it stands, with when (owner, 2026-10-10) — and no promise of a check this alert's rule
    # gives no states for (architecture review 23: "will check it stays quiet" was never kept)
    assert re.fullmatch(r"Closed: done, answered by the facility manager on \d\d/\d\d/\d{4} \d\d:\d\d\.", status(fm)) \
        and body(fm).index(SUMMARY) < body(fm).index("Closed:")


def test_a_message_past_telegrams_48_hours_becomes_a_pointer(agent):
    ha_alert(agent)
    agent.tg.refuse.add("delete")
    tick(agent, 20)
    first_fm = next(n for n, (c, _t, _k) in enumerate(agent.tg.sent, start=1001) if c == FM_CHAT)
    assert (FM_CHAT, first_fm, "Incident #1 · see the newer message below.") in agent.tg.edits


def test_the_owner_and_the_fm_in_one_chat_get_one_message_with_the_buttons(agent):
    from vesta_shared import result as R
    res = {"send": [R.message("owner", "Incident #9 · New alert\nx"),
                    R.message("fm", "Incident #9 · New alert\nx\nPress Done or Need help.", incident=9, buttons=True),
                    R.message("owner", "Incident #9 · New alert\nx", incident=9)], "incident_id": 9}
    from vesta_agent.routing import Routing
    route = Routing(agent.policy())
    route.target = lambda to, origin=None: {"owner": [GROUP], "fm": [FM_CHAT]}[to]
    kept, _ = agent.outcome._deliveries(res["send"], route, None)
    assert [m.get("keyboard") for _, m, _ in kept] == [None, True, None]       # different chats: all three kept
    route.target = lambda to, origin=None: [GROUP]                          # the owner and the FM share the group
    kept, _ = agent.outcome._deliveries(res["send"], route, None)
    assert [(m.get("keyboard"), roles) for _, m, roles in kept if m.get("incident_id")] == [(True, {"owner", "fm"})]


def test_home_assistants_messages_of_another_run_are_never_taken(agent):
    run(agent.on_ha_event("telegram_sent", {"chat_id": GROUP, "message_id": 777, "bot": BOT, CONTEXT_KEY: "OTHER"}))
    ha_alert(agent, context="RUN-1", mid=500)
    assert all(mid != 777 for _c, mid, _t in agent.tg.edits) and (GROUP, 777) not in agent.tg.deleted


def test_need_help_reaches_the_owner_with_the_buttons_to_answer(agent):
    # architecture review 12 (live defect): the owner's escalation lost its buttons the moment it arrived — the
    # answer's settle ran after its sends and edited every message holding the buttons, the new one included
    ha_alert(agent)
    tick(agent, 20)                                                     # the FM's reminder, with the buttons
    reminder = 1000 + len(agent.tg.sent)
    iid = agent.tg.sent[-1][2]["inline_keyboard"][0][0]["callback_data"].split(":")[1]
    run(agent.on_ha_event("telegram_callback", {"id": "cb", "data": f"i:{iid}:need_help", "chat_id": FM_CHAT, "user_id": FM,
                                                "message": {"message_id": reminder, "chat": {"id": FM_CHAT}}, "bot": BOT}))
    owner = agent.thread.shown(int(iid))[GROUP]
    assert owner["buttons"] and not owner["settled"], owner
    assert status(owner["text"]) == "The facility manager needs help" and SUMMARY in owner["text"]
    assert all(mid != owner["mid"] for _, mid, _ in agent.tg.edits)     # never edited: its buttons are still there
    (fm,) = shown(agent, FM_CHAT)
    assert re.fullmatch(r"Need help, answered by the facility manager on \d\d/\d\d/\d{4} \d\d:\d\d: the owner has been told",
                        status(fm))


def test_a_second_close_changes_nothing_and_the_records_are_pruned_with_the_others(agent):
    ha_alert(agent)
    iid = 1
    # the FM's alert and Home Assistant's, taken over WITH the buttons (owner, 2026-10-10: every message of an open alert)
    assert run(agent.thread.close(iid, "Done pressed by FM on {time}")) == 2
    assert run(agent.thread.close(iid, "Done pressed by FM on {time}")) == 0
    from datetime import datetime, timedelta, timezone
    soon = (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()
    agent.state.prune(runs_before="1970", records_before=soon)
    assert agent.thread.shown(iid) == {}


def test_every_message_of_an_open_alert_has_its_buttons_in_every_chat(agent):
    # owner, 2026-10-10: "the user shall not have to type to reply anything" — the group's copy of incident #9 was Home
    # Assistant's own alert, taken over without the buttons and saying "Reply Done"
    ha_alert(agent)
    group_edit = next(kb for (c, mid, _), kb in zip(agent.tg.edits, agent.tg.edit_keyboards) if c == GROUP and mid == 500)
    assert group_edit and all(b["callback_data"].startswith("i:1:") for b in group_edit["inline_keyboard"][0])
    assert all("Reply Done" not in t for _, t, _ in agent.tg.sent) and all("Reply Done" not in t for _, _, t in agent.tg.edits)
    # a message about it with no buttons asked for still gets them while it is open
    from vesta_shared import result as R
    run(agent.outcome.carry_out({"send": [R.message("owner", "Incident #1 · still open", incident=1)]}, "alert-desk"))
    assert agent.tg.sent[-1][2], "an open alert's message carries its buttons"


def test_every_notice_has_one_heading_with_the_incidents_history(agent):
    # owner, 2026-10-10: "For: <Name>, Incident: <New/Follow Up> #N", one line per earlier notice (when, to whom), a rule,
    # then the text — the incident's line, its earlier messages and its footer were three different makings
    from vesta_shared import result as R
    run(agent.outcome.carry_out({"send": [R.message("fm", "Pump stopped", incident=7, buttons=True, stage="new")]}, "alert-desk"))
    first = agent.tg.sent[-1][1]
    assert first.startswith("For: ") and ", Incident: New #7\n-------\nPump stopped" in first
    run(agent.outcome.carry_out({"send": [R.message("owner", "Still stopped", incident=7, buttons=True,
                                                    stage="escalated")]}, "alert-desk"))
    later = agent.tg.sent[-1][1]
    head, text = later.split("\n-------\n")
    lines = head.split("\n")
    assert lines[0].endswith(", Incident: Follow Up #7") and text == "Still stopped"
    assert re.match(r"First time seen on \d\d/\d\d/\d{4} \d\d:\d\d, to .+", lines[1]) and len(lines) == 2


def test_a_fault_closed_in_the_kiosk_says_who_and_when_on_telegram():
    # owner, 2026-10-10: a Close in the Cockpit must act on the Telegram messages like a button: who, and when
    from vesta_agent.tickets import kiosk_close_note
    note = kiosk_close_note({"by": "Facility manager", "resolved_at": "2026-10-10T09:13:00.000Z"}, "Asia/Singapore")
    assert note == "Closed in the VESTA Kiosk by Facility manager on 10/10/2026 17:13."
    assert kiosk_close_note({}, "UTC") == "Closed in the VESTA Kiosk on {time}."     # an older Kiosk: noticed now


def test_the_kiosk_is_read_every_five_minutes(agent, monkeypatch):
    # it was read at start, at 01:30 and after the night check only: an alert closed in the Cockpit kept its buttons
    from vesta_agent import app as app_module
    calls = []

    async def repair():
        calls.append(1)
        return 0
    agent.tickets.repair = repair
    agent.kiosk = type("K", (), {"enabled": True})()
    clock = [1000.0]
    monkeypatch.setattr(app_module.time, "monotonic", lambda: clock[0])
    run(agent.housekeeping())
    clock[0] += 60
    run(agent.housekeeping())                                          # a minute later: not again
    clock[0] += app_module.KIOSK_EVERY_S
    run(agent.housekeeping())
    assert len(calls) == 2


def test_the_kiosk_answer_gives_who_closed_a_fault_and_when():
    # the real reader of the Kiosk's Facility records (the fake skips it): the close's profile and moment reach the note
    from vesta_agent.kiosk import Kiosk
    k = Kiosk("http://kiosk.invalid", "token")

    async def answer(method, path, body=None):
        return 200, {"data": {"tickets": [
            {"id": "va-1", "title": "Door", "status": "resolved", "resolvedAt": "2026-10-10T09:13:00.000Z",
             "updates": [{"at": "2026-10-10T09:13:00.000Z", "status": "resolved", "by": "Owner", "photoIds": []}]},
            {"id": "va-2", "title": "Pump", "status": "open"}]}}
    k._req = answer
    held = run(k.held_tickets())
    assert held["va-1"]["by"] == "Owner" and held["va-1"]["resolved_at"] == "2026-10-10T09:13:00.000Z"
    assert held["va-2"]["by"] == "" and held["va-2"]["status"] == "open"


def test_a_press_puts_where_it_stands_last_in_place_of_the_old_status():
    # owner, 2026-10-10: "the update of the message (when clicked) shall appear at the bottom, after a ------- line",
    # with its time — never stacked under an older status
    from vesta_agent import layout
    reminder = layout.parts(head="For: JM_FM", body="Door left open\nWhat to do: close it",
                            status="Reminder: no answer after 15 min")
    assert layout.render(layout.changed(reminder, status="Done pressed by JM_O on 10/10/2026 15:04")) == \
        "For: JM_FM\n-------\nDoor left open\nWhat to do: close it\n-------\nDone pressed by JM_O on 10/10/2026 15:04"
    new = layout.parts(head="For: JM_FM, Incident: New #14", body="Door left open")
    assert layout.render(layout.changed(new, status="Done pressed by JM_O on 10/10/2026 15:04")) == \
        "For: JM_FM, Incident: New #14\n-------\nDoor left open\n-------\nDone pressed by JM_O on 10/10/2026 15:04"
    # architecture review 19: the parts are kept, never cut out of the text — an alert holding its own "-------" line
    # keeps its end at a press, and a request's lead (why it is asked) stays when its body says what became of it
    odd = layout.parts(head="For: JM_FM", body="Pump log:\n-------\nstopped at 03:00")
    assert layout.render(layout.changed(odd, status="Done")).endswith("Pump log:\n-------\nstopped at 03:00\n-------\nDone")
    siren = layout.parts(head="For: the Owner", lead="Intrusion suspected: 2 sensors.", body="Turn on Siren?",
                         status="Waiting for approval")
    assert layout.render(layout.changed(siren, status="Approved by JM", body="Turned on Siren.")) == \
        "For: the Owner\n-------\nIntrusion suspected: 2 sensors.\nTurned on Siren.\n-------\nApproved by JM"


def test_home_assistants_cleared_in_time_message_says_cleared_with_its_time(agent):
    # architecture review 23: its "✅ cleared just inside the limit", taken over, read "🔶 no longer tracked"
    ha_alert(agent)
    run(agent.on_ha_event("telegram_sent", {"chat_id": GROUP, "message_id": 600, "bot": BOT, CONTEXT_KEY: "RUN-2"}))
    run(agent.on_ha_event("vesta_critical_event", {
        "blueprint": "critical_condition", "rule_id": "automation.critical_condition_laundry",
        "incident_id": "automation.critical_condition_laundry-1", "phase": "abandoned", "severity": "critical",
        "label": "Laundry door unlocked", "entities": ["lock.laundry"], "still_true": False,
        "summary": "🔶 Laundry door unlocked — no longer tracked after 30 min", CONTEXT_KEY: "RUN-2",
        "timestamp": datetime.now(timezone.utc).isoformat()}))
    adopted = [t for c, mid, t in agent.tg.edits if (c, mid) == (GROUP, 600)]
    assert adopted and re.fullmatch(r"Cleared on \d\d/\d\d/\d{4} \d\d:\d\d: back to normal when Home Assistant stopped "
                                    r"watching\.", status(adopted[-1]))
