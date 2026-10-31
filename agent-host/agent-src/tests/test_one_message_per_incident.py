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
from vesta_agent.layout import head_text
from vesta_agent.ha_events import CONTEXT_KEY

OWNER, FM = 111, 222
GROUP, FM_CHAT = -100123, 222
SUMMARY = "🔓 Laundry door unlocked\nLaundry lock is unlocked\nHeld 1min"


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
    assert grp.startswith("#1-P2 (new)\nTo: ") and status(grp) == "" and body(grp).startswith("🔓") and SUMMARY in grp and "What to do:" in grp
    (fm,) = shown(agent, FM_CHAT)
    assert status(fm) == "" and body(fm).startswith("🔓") and SUMMARY in fm and "Press Done" not in fm and "Reply Done" not in fm


def test_each_chat_keeps_only_the_latest_message_and_it_recalls_the_alert(agent):
    ha_alert(agent)
    tick(agent, 20)                            # the reminder replaces the alert in the FM's chat
    (fm,) = shown(agent, FM_CHAT)
    # the step says itself — what, when, to whom — before the desk's words (owner, 2026-10-16, #43)
    assert re.fullmatch(r"Reminder sent \d\d/\d\d/\d{4} \d\d:\d\d, No answer after 15min \(to: FM\)", status(fm)) \
        and SUMMARY in fm and "What to do:" in fm
    assert agent.tg.sent[-1][2], "the reminder carries the buttons"
    tick(agent, 50)                            # the escalation replaces Home Assistant's alert in the owner's chat
    (grp,) = shown(agent, GROUP)
    assert re.fullmatch(r"Escalation sent \d\d/\d\d/\d{4} \d\d:\d\d, No answer from FM after 45min \(to: Owner\)",
                        status(grp)) and SUMMARY in grp
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
    # who pressed it by name, as the button's own footer says it (owner, 2026-10-11)
    assert re.fullmatch(r"Done on \d\d/\d\d/\d{4} \d\d:\d\d \(Wayan\)\. Watch 4h\.", status(fm)) \
        and body(fm).index(SUMMARY) < fm.index("Done on ")


def test_a_message_past_telegrams_48_hours_becomes_a_pointer(agent):
    ha_alert(agent)
    agent.tg.refuse.add("delete")
    tick(agent, 20)
    first_fm = next(n for n, (c, _t, _k) in enumerate(agent.tg.sent, start=1001) if c == FM_CHAT)
    assert (FM_CHAT, first_fm, "#1-P2 · see the newer message below.") in agent.tg.edits


def test_the_owner_and_the_fm_in_one_chat_get_one_message_with_the_buttons(agent):
    from vesta_shared import result as R
    res = {"send": [R.message("owner", "Incident #9 · New alert\nx"),
                    R.message("fm", "Incident #9 · New alert\nx\nPress Done or Need help.", incident=9, buttons=True),
                    R.message("owner", "Incident #9 · New alert\nx", incident=9)], "incident_id": 9}
    from vesta_agent.routing import Routing
    route = Routing(agent.policy())
    route.target = lambda to, origin=None, language=None: {"owner": [GROUP], "fm": [FM_CHAT]}[to]
    kept, _ = route.deliveries(res["send"])
    assert [m.get("keyboard") for _, m, _ in kept] == [None, True, None]       # different chats: all three kept
    route.target = lambda to, origin=None, language=None: [GROUP]                          # the owner and the FM share the group
    kept, _ = route.deliveries(res["send"])
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
    # the escalation's step to the owner only — never the presser's chat, which got the answer (owner, 2026-10-16)
    assert re.fullmatch(r"Escalation sent .+, Need help on .+ \(Wayan\): Owner is asked to act\. \(to: Owner\)",
                        status(owner["text"])) and SUMMARY in owner["text"]
    assert all(mid != owner["mid"] for _, mid, _ in agent.tg.edits)     # never edited: its buttons are still there
    (fm,) = shown(agent, FM_CHAT)
    # the same sentence in every chat (2026-10-11); the owner's copy, the escalation, says its step first (2026-10-16)
    assert status(owner["text"]).endswith(", " + status(fm) + " (to: Owner)")
    # the Kiosk's card tells the same story, through the wiring the app gives its tickets (owner, 2026-10-14), from the
    # alert sent on (ticket 19 of "One inbox") — and Telegram's Status the same events in the same words: the press,
    # then the escalation; never an "Update sent" (architecture review, 2026-10-15)
    notes = [x["note"] for x in agent.tickets.story(int(iid))]
    assert notes == ["Alert sent (to: Facility Manager)", "Reminder sent (to: Facility Manager)",
                     "🆘 Need help on Telegram (Wayan)", "Escalation sent (to: Owner)"], notes
    # owner, 2026-10-18, #55 "each chat its own steps" (reversing part of 2026-10-11 "one incident, one picture"): the
    # FM's chat lists the FM's steps and the press, never the escalation to the owner; the owner's group the press and
    # its escalation, never the FM's alert or reminder
    def kinds(chat):
        lines = head_text(agent.notices.heading(chat, int(iid))).split("\n")[2:]
        return [next((k for k in ("Alert sent", "Reminder sent", "🆘 Need help on", "Escalation sent")
                      if l.startswith("- " + k)), l) for l in lines]
    assert kinds(FM_CHAT) == ["Alert sent", "Reminder sent", "🆘 Need help on"], kinds(FM_CHAT)
    assert kinds(GROUP) == ["🆘 Need help on", "Escalation sent"], kinds(GROUP)


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
    # owner, 2026-10-10: one heading for every notice. 2026-10-11 (#21: "redundant and at different places"), in the
    # order the owner drew: "#7 (existing)", "To: Wayan", the alert, then "Status:" — the history ("- Alert sent
    # 11/10/2026 09:57 to Wayan") and where it stands, each a block — never "For: the Owner, Incident: Follow Up #7"
    from vesta_shared import result as R
    run(agent.outcome.carry_out({"send": [R.message("fm", "Pump stopped", incident=7, buttons=True, stage="new")]}, "alert-desk"))
    first = agent.tg.sent[-1][1]
    assert re.fullmatch(r"#7 \(new\)\nTo: .+\nPump stopped\nStatus:\n⚠️ New alert", first)
    run(agent.outcome.carry_out({"send": [R.message("owner", "Still stopped", incident=7, buttons=True,
                                                    stage="escalated")]}, "alert-desk"))
    later = agent.tg.sent[-1][1]
    # in the owner's chat: "To:" names everyone the alert involves; its "Status:" only the owner's own steps (owner,
    # 2026-10-18, #55 "each chat its own steps") — the FM's alert is the FM chat's line
    assert re.fullmatch(r"#7 \(existing\)\nTo: Owner & FM\nStill stopped\nStatus:\n"
                        r"⚠️ ⚙️ Escalation sent \d\d/\d\d/\d{4} \d\d:\d\d \(to: Owner\)", later), later
    fm_lines = head_text(agent.notices.heading(FM_CHAT, 7)).split("\n")[2:]
    assert [ln.split(" ")[1] for ln in fm_lines] == ["Alert"] and fm_lines[0].endswith("(to: FM)"), fm_lines


def test_a_fault_closed_in_the_kiosk_says_who_and_when_on_telegram():
    # owner, 2026-10-10: a Close in the Cockpit must act on the Telegram messages like a button: who, and when
    from vesta_agent.tickets import kiosk_close_note
    note = kiosk_close_note({"by": "Facility manager", "resolved_at": "2026-10-10T09:13:00.000Z"}, "Asia/Singapore")
    assert note == "Done in the Cockpit on 10/10/2026 17:13 (Facility manager)."
    assert kiosk_close_note({}, "UTC") == "Done in the Cockpit on {time}."     # an older Kiosk: noticed now


def test_the_kiosk_is_read_every_five_minutes(agent, monkeypatch):
    # it was read at start, at 01:30 and after the night check only: an alert closed in the Cockpit kept its buttons
    from vesta_agent import app as app_module
    calls = []

    async def repair():
        calls.append(1)
        return 0
    agent.tickets.repair = repair
    # villa_devices: at a minute ending in 0 housekeeping reads the tool list again, and its toolbox asks for it
    agent.kiosk = type("K", (), {"enabled": True, "villa_devices": None})()
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
    from kiosk_fake import FakeKiosk
    k = FakeKiosk(
        {"id": "va-1", "title": "Door", "status": "resolved", "resolvedAt": "2026-10-10T09:13:00.000Z",
         "updates": [{"at": "2026-10-10T09:13:00.000Z", "status": "resolved", "by": "Owner", "photoIds": []}]},
        {"id": "va-2", "title": "Pump", "status": "open"})
    held = run(k.held_tickets())
    assert held["va-1"]["by"] == "Owner" and held["va-1"]["resolved_at"] == "2026-10-10T09:13:00.000Z"
    assert held["va-2"]["by"] == "" and held["va-2"]["status"] == "open"


def test_a_press_puts_where_it_stands_last_in_place_of_the_old_status():
    # owner, 2026-10-10: "the update of the message (when clicked) shall appear at the bottom", with its time — never
    # stacked under an older status; under "Status:" since 2026-10-12 (one layout, the "-------" line retired)
    from vesta_agent import layout
    reminder = layout.parts(head="Approval request\nTo: JM_FM", body="Door left open\nWhat to do: close it",
                            status="Reminder: no answer after 15min")
    assert layout.render(layout.changed(reminder, status="Done pressed by JM_O on 10/10/2026 15:04")) == \
        "Approval request\nTo: JM_FM\nDoor left open\nWhat to do: close it\nStatus:\nDone pressed by JM_O on 10/10/2026 15:04"
    new = layout.parts(head="#14-P2 (closed)\nTo: JM_FM", body="Door left open")
    assert layout.render(layout.changed(new, status="Done pressed by JM_O on 10/10/2026 15:04")) == \
        "#14-P2 (closed)\nTo: JM_FM\nDoor left open\nStatus:\n✅ Done pressed by JM_O on 10/10/2026 15:04"
    # architecture review 19: the parts are kept, never cut out of the text — an alert holding its own "-------" line
    # keeps its end at a press, and a request's lead (why it is asked) stays when its body says what became of it
    odd = layout.parts(head="Siren request\nTo: JM_FM", body="Pump log:\n\nStatus:\nstopped at 03:00")
    assert layout.render(layout.changed(odd, status="Done")).endswith("Pump log:\n\nStatus:\nstopped at 03:00\nStatus:\nDone")
    siren = layout.parts(head="Approval request\nTo: the Owner", lead="Intrusion suspected: 2 sensors.", body="Turn on Siren?",
                         status="Waiting for approval")
    assert layout.render(layout.changed(siren, status="Approved by JM", body="Turned on Siren.")) == \
        "Approval request\nTo: the Owner\nIntrusion suspected: 2 sensors.\nTurned on Siren.\nStatus:\nApproved by JM"


def test_home_assistants_cleared_in_time_message_says_cleared_with_its_time(agent):
    # architecture review 23: its "✅ cleared just inside the limit", taken over, read "🔶 no longer tracked"
    ha_alert(agent)
    run(agent.on_ha_event("telegram_sent", {"chat_id": GROUP, "message_id": 600, "bot": BOT, CONTEXT_KEY: "RUN-2"}))
    run(agent.on_ha_event("vesta_critical_event", {
        "blueprint": "critical_condition", "rule_id": "automation.critical_condition_laundry",
        "incident_id": "automation.critical_condition_laundry-1", "phase": "abandoned", "severity": "critical",
        "label": "Laundry door unlocked", "entities": ["lock.laundry"], "still_true": False,
        "summary": "🔶 Laundry door unlocked — no longer tracked after 30min", CONTEXT_KEY: "RUN-2",
        "timestamp": datetime.now(timezone.utc).isoformat()}))
    adopted = [t for c, mid, t in agent.tg.edits if (c, mid) == (GROUP, 600)]
    assert adopted and re.fullmatch(r"Cleared on \d\d/\d\d/\d{4} \d\d:\d\d: back to normal when the alert stopped "
                                    r"watching it\. Watch 4h\.", status(adopted[-1]))


def test_a_button_the_skill_renames_still_answers_the_alert(agent):
    # architecture review, 2026-10-13: the engine drew "Done" and handed the desk the LABEL, which the desk read back by
    # its first word — renamed on one side, a press became "Noted from …" and the alert stayed open with no button.
    # The buttons are the skill's (skill.yaml `buttons`); a press passes its option.
    import os
    import yaml
    path = os.path.join(agent.skills.dir, "alert-desk", "skill.yaml")
    spec = yaml.safe_load(open(path, encoding="utf-8"))
    spec["buttons"][0]["label"] = "Fait"
    with open(path, "w", encoding="utf-8") as fh:
        yaml.safe_dump(spec, fh, allow_unicode=True)
    ha_alert(agent)
    tick(agent, 20)
    kb = agent.tg.sent[-1][2]["inline_keyboard"][0]
    assert [b["text"] for b in kb] == ["Fait", "Need help"]
    iid = kb[0]["callback_data"].split(":")[1]
    run(agent.on_ha_event("telegram_callback", {"id": "cb", "data": kb[0]["callback_data"], "chat_id": FM_CHAT,
                                                "user_id": FM, "bot": BOT,
                                                "message": {"message_id": 1000 + len(agent.tg.sent), "chat": {"id": FM_CHAT}}}))
    (fm,) = shown(agent, FM_CHAT)
    assert re.fullmatch(r"Fait on \d\d/\d\d/\d{4} \d\d:\d\d \(Wayan\)\. Watch 4h\.", status(fm))
    from vesta_shared.store import Store
    assert Store(agent.s.store_path).incident(int(iid))["closed_at"]


def test_two_posts_of_one_incident_at_once_leave_one_copy_in_the_chat(tmp_path):
    # architecture review scan 1, 2026-10-19 (#55 twice in the owner's group): a post read the chat's record, waited on
    # Telegram's delete, then wrote its own — two at once both read the same record, and one new message was left with
    # nothing pointing at it. The thread changes one incident's copies one at a time.
    from vesta_agent.incident_thread import IncidentThread
    from vesta_agent.state import State
    shown: set[int] = {1}                                   # the chat's messages: message 1 is #55's copy on record

    async def delete(_chat, mid):
        await asyncio.sleep(0)                              # Telegram answers later: the other task runs meanwhile
        shown.discard(mid)
        return True

    async def edit(*_a):
        await asyncio.sleep(0)
        return True
    th = IncidentThread(State(str(tmp_path / "s.db")), "UTC", edit=edit, delete=delete)
    asyncio.run(th.post(55, GROUP, 1, {"body": "x"}))

    async def both():
        shown.update({2, 3})
        await asyncio.gather(th.post(55, GROUP, 2, {"body": "a"}), th.post(55, GROUP, 3, {"body": "b"}))
    asyncio.run(both())
    assert shown == {th.shown(55)[GROUP]["mid"]}, (shown, th.shown(55))


def test_a_press_on_a_copy_no_record_points_to_removes_it(agent):
    # the same review: a copy left behind keeps its buttons; pressed, the alert is answered and that copy goes
    ha_alert(agent)
    iid, rec = next((i, r) for i in range(1, 9) for c, r in agent.thread.shown(i).items() if c == GROUP)
    stray = rec["mid"] + 100
    assert run(agent.thread.stray(iid, GROUP, stray)) and (GROUP, stray) in agent.tg.deleted
    assert not run(agent.thread.stray(iid, GROUP, rec["mid"]))                  # its own message is never a stray


def villa_alert(v, rule: str, blueprint: str | None, context: str = "RUN-1", mid: int = 500):
    """The villa's own message in the owner's group, then its rule's event (one run, one context) — a rule of another
    priority than ha_alert's: its route in the desk's rules.yaml decides (P1 critical_binary_trip, P3 the default)."""
    run(v.on_ha_event("telegram_sent", {"chat_id": GROUP, "message_id": mid, "bot": BOT, CONTEXT_KEY: context}))
    run(v.on_ha_event("vesta_critical_event", {
        "blueprint": blueprint, "rule_id": rule, "incident_id": rule + "-1", "phase": "opened", "severity": "critical",
        "label": "Laundry door unlocked", "entities": ["lock.laundry"], "summary": SUMMARY,
        "timestamp": datetime.now(timezone.utc).isoformat(), CONTEXT_KEY: context}))


def test_the_villas_message_taken_over_is_the_desks_copy_in_that_chat(agent):
    # architecture review, 2026-10-19 (measured): a P1 rang the owner's group twice — the villa's own message was taken
    # over (number, heading, buttons), then deleted for an identical one of the desk's. ONE copy per chat, whatever
    # wrote it: the taken-over message stays, the desk's copy of the same step is not sent there; every other chat of
    # the priority gets its one message
    villa_alert(agent, "automation.critical_water_leak", "critical_binary_trip")           # P1: owner and FM
    assert agent.tg.deleted == [], agent.tg.deleted
    (grp,) = shown(agent, GROUP)
    assert grp.startswith("#1-P1 (new)\nTo: Owner & FM\n") and SUMMARY in grp
    group_edit = next(kb for (c, mid, _), kb in zip(agent.tg.edits, agent.tg.edit_keyboards) if (c, mid) == (GROUP, 500))
    assert group_edit and all(b["callback_data"].startswith("i:1:") for b in group_edit["inline_keyboard"][0])
    assert [c for c, _t, _k in agent.tg.sent] == [OWNER, FM_CHAT]          # one each; none to the group
    assert agent.thread.shown(1)[GROUP]["mid"] == 500 and agent.thread.shown(1)[GROUP]["buttons"]
    # the copies are one picture: the same heading in every chat
    heads = {c: r["text"].split("\n")[:2] for c, r in agent.thread.shown(1).items()}
    assert heads == {GROUP: ["#1-P1 (new)", "To: Owner & FM"], OWNER: ["#1-P1 (new)", "To: Owner & FM"],
                     FM_CHAT: ["#1-P1 (new)", "To: Owner & FM"]}, heads
    # a later step of the desk's (its reminder: a P1's goes to the owner and the FM) replaces the older copy where it
    # lands — the taken-over one as any other: one copy per chat, still
    tick(agent, 20)
    assert sorted(agent.tg.deleted) == sorted([(GROUP, 500), (OWNER, 1001), (FM_CHAT, 1002)]), agent.tg.deleted
    assert all(len(shown(agent, c)) == 1 and "Reminder sent" in status(shown(agent, c)[0]) for c in (GROUP, OWNER, FM_CHAT))


def test_to_follows_the_priority_a_p3_in_the_owners_group_is_never_to_owner(agent):
    # owner, 2026-10-17: "To:" follows the PRIORITY, never the roles of the chat the rule posts in. Measured
    # 2026-10-19: a P3's own message, taken over in the owner's group, read "To: Owner" — the chat's roles, since a P3
    # reaches nobody (the desk's people_roles). It reads what the priority does instead, in the desk's own words
    villa_alert(agent, "automation.maintenance_pump", None)                                 # the default route: P3
    (grp,) = shown(agent, GROUP)
    assert grp.startswith("#1-P3 (new)\nTo: digest\n") and status(grp) == "" and agent.tg.sent == [], grp
    assert agent.notices.reaches(1) == ["digest"]
    # the rule alerts again: its new message is taken over as a still-there — its step line too never names the chat
    villa_alert(agent, "automation.maintenance_pump", None, context="RUN-2", mid=501)
    (grp,) = shown(agent, GROUP)
    assert grp.startswith("#1-P3 (existing)\nTo: digest\n") and "Owner" not in grp, grp
    assert re.search(r"\n- Alert sent .+ \(to: digest\)\n", grp) and status(grp).endswith("(to: digest)"), grp
    # the Kiosk's story of it, the same words (never "Owner")
    assert all("Owner" not in x["note"] for x in agent.tickets.story(1))
    # a P2 (the FM's) in the same group: "To: FM" — and an escalation to the owner widens it (the owner IS involved)
    ha_alert(agent, context="RUN-3", mid=502)
    assert shown(agent, GROUP)[-1].startswith("#2-P2 (new)\nTo: FM\n")
    tick(agent, 20)
    tick(agent, 50)
    assert all(r["text"].split("\n")[1] == "To: Owner & FM" for r in agent.thread.shown(2).values())


def test_every_copy_carries_the_incidents_word_and_its_own_status_lines(agent):
    # architecture review, 2026-10-19 (measured): P2, the villa's copy in the owner's group; Done by Wayan; the fault
    # reopened in the Cockpit; the tick asked the FM again. The group kept "#1-P2 (closed)" over "Done on … (Wayan)."
    # while the FM's copy read "(existing)". Direction stated to the owner: the title word and "To:" are the
    # INCIDENT's — the same in every copy; the Status lines are each chat's own (#55 unchanged)
    ha_alert(agent)
    fm_mid = 1000 + len(agent.tg.sent)
    iid = int(agent.tg.sent[-1][2]["inline_keyboard"][0][0]["callback_data"].split(":")[1])
    run(agent.on_ha_event("telegram_callback", {"id": "cb", "data": f"i:{iid}:done", "chat_id": FM_CHAT, "user_id": FM,
                                                "message": {"message_id": fm_mid, "chat": {"id": FM_CHAT}}, "bot": BOT}))
    words = lambda: {c: r["text"].split("\n")[0] for c, r in agent.thread.shown(iid).items()}
    assert words() == {GROUP: "#1-P2 (watch)", FM_CHAT: "#1-P2 (watch)"}, words()   # closed, watched alike (2026-10-25)
    from vesta_shared.store import Notes, Store
    st = Store(agent.s.store_path)
    st.note(iid, {Notes.KIOSK_REOPENED: "Reopened in the Cockpit on 19/10/2026 10:00 (JM)"})
    st.update_incident(iid, closed_at=None, state="asked")
    tick(agent, 5)
    assert words() == {GROUP: "#1-P2 (existing)", FM_CHAT: "#1-P2 (existing)"}, words()
    group, fm = (agent.thread.shown(iid)[c]["text"] for c in (GROUP, FM_CHAT))
    assert re.fullmatch(r"Done on \d\d/\d\d/\d{4} \d\d:\d\d \(Wayan\)\.", status(group)), group   # its own last line
    assert status(fm).startswith("Reopen request sent ") and "Reopened in the Cockpit" in status(fm), fm
    assert "Reopen" not in group and "Done on" not in fm.rsplit("\n", 1)[1]
    assert group.split("\n")[1] == fm.split("\n")[1] == "To: FM"


def test_a_cleared_alert_is_watched_then_closed_struck_with_the_time_it_ended(agent):
    # owner, 2026-10-25 (#86): "(watch)" while it can come back as the same alert; when the watch ends, every copy says
    # so — "Closed on …: it did not come back within 1h." under its "Cleared on … Watch 1h." — "(closed)", its alert struck
    from vesta_shared import message_format as F
    from vesta_shared.alert_watch import until as watch_until
    from vesta_shared.store import Store
    from vesta_shared.timeutil import moment_label
    ha_alert(agent)
    run(agent.on_ha_event("vesta_critical_event", {
        "blueprint": "critical_condition", "rule_id": "automation.critical_condition_laundry",
        "incident_id": "automation.critical_condition_laundry-1", "phase": "resolved", "severity": "critical",
        "label": "Laundry door unlocked", "entities": ["lock.laundry"], "timestamp": datetime.now(timezone.utc).isoformat(),
        CONTEXT_KEY: "RUN-2"}))
    cards = lambda: {c: r["text"] for c, r in agent.thread.shown(1).items()}
    assert cards() and all(t.startswith("#1-P2 (watch)\n") for t in cards().values()), cards()
    assert all("strikethrough" not in [e["type"] for e in F.telegram_entities(t)] for t in cards().values())
    until = watch_until(Store(agent.s.store_path).incident(1))
    edits = len(agent.tg.edits)
    tick(agent, int((until - datetime.now(timezone.utc)).total_seconds() // 60) - 1)      # still watched: nothing
    assert len(agent.tg.edits) == edits and all(t.startswith("#1-P2 (watch)\n") for t in cards().values())
    tick(agent, int((until - datetime.now(timezone.utc)).total_seconds() // 60) + 2)      # its watch over
    for text in cards().values():
        status = text.split("\nStatus:\n")[1].split("\n")
        assert text.startswith("#1-P2 (closed)\n"), text
        assert status[-2].startswith("- Cleared on ") and "Watch" in status[-2], status
        assert status[-1].startswith("✅ Closed on ") and "did not come back within" in status[-1], status
        # the moment its watch ended (its Cockpit card's "VESTA confirms by"), never the look that noticed it
        assert status[-1].startswith(f"✅ Closed on {moment_label(until, agent.s.timezone)}:"), (status, until)
        assert "strikethrough" in [e["type"] for e in F.telegram_entities(text)], text
    edits = len(agent.tg.edits)
    tick(agent, int((until - datetime.now(timezone.utc)).total_seconds() // 60) + 7)      # said once
    assert len(agent.tg.edits) == edits
