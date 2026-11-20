"""Each Telegram chat's copy of an alert lists the Status lines meant for it, in its chat's language, and is brought up
to date only by the changes meant for it (owner, 2026-11-20, live #201, reversing 2026-11-07 #146-P2 "every copy the
same lines": the owner's group, joined at the escalation, listed every reminder and still-there alert sent to the
facility manager, its bottom line "Still-there alert sent 11:29 (to: FM)"). The first alert stays in every chat; once
escalated to, the owner's group also reads how it ends. "(to: …)" says who was told. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from helpers import make_agent
from ha_fake import FakeHA, tool
from kiosk_fake import FakeKiosk
from telegram_fake import BOT
from vesta_agent.ha_events import CONTEXT_KEY
from vesta_agent.roster import Roster
from vesta_shared.store import Store

GROUP, FM = -100146, 222
RULE = "automation.critical_condition_door"


def run(coro):
    return asyncio.run(coro)


def rule(v, phase: str, n: int, mid: int, at: datetime):
    ctx = f"RUN-{n}-{phase}"
    run(v.on_ha_event("telegram_sent", {"chat_id": FM, "message_id": mid, "bot": BOT, CONTEXT_KEY: ctx}))
    run(v.on_ha_event("vesta_critical_event", {
        "blueprint": "critical_condition", "rule_id": RULE, "incident_id": f"{RULE}-{n}", "phase": phase,
        "severity": "critical", "label": "Entrance door unlocked", "entities": ["lock.example_entrance"],
        "summary": "Entrance door unlocked", "timestamp": at.isoformat(), CONTEXT_KEY: ctx}))


def tick(v, at: datetime):
    run(v.run_code_job(v.skills.get("alert-desk"), f"desk.py tick --now {at.isoformat()}", 60))


def status(v, chat) -> list[str]:
    return v.thread.shown(1)[chat]["text"].split("\nStatus:\n", 1)[1].split("\n")


def kinds(lines: list[str]) -> list[str]:
    return [ln.removeprefix("- ").split(" ")[0] for ln in lines]


def test_alert_201_each_chat_reads_its_own_lines_and_its_own_bottom_line(tmp_path):
    k = FakeKiosk()
    v = make_agent(tmp_path, {}, roster=Roster.of(owner=[(GROUP, "Owner group")], fm=[(FM, "Wayan")]),
                   skills=["alert-desk"], reader=FakeHA(tools=[tool("ha_get_state")]), kiosk=k)
    v.bot_username = BOT["username"]
    t0 = datetime.now(timezone.utc)
    rule(v, "opened", 1, 500, t0)                                   # P2: the facility manager
    run(v.tickets.repair())
    tick(v, t0 + timedelta(minutes=20))                              # reminded
    tick(v, t0 + timedelta(minutes=50))                              # escalated: the owner's group joins
    assert GROUP in v.thread.shown(1), "escalated to the owner"
    # the owner's group: the first alert (when it began), then its own escalation; the FM's: never the escalation
    group = status(v, GROUP)
    assert kinds(group[:-1]) == ["Alert"] and group[-1].startswith("⚠️ ⚙️ Escalation sent ") and \
        group[-1].endswith("(to: Owner)"), group
    assert kinds(status(v, FM)[:-1]) == ["Alert"] and "Reminder sent" in status(v, FM)[-1], status(v, FM)
    rule(v, "resolved", 1, 501, t0 + timedelta(minutes=70))          # cleared, watched: every copy says it
    assert status(v, GROUP)[-1].startswith("✅ Cleared ") and status(v, FM)[-1].startswith("✅ Cleared "), \
        (status(v, GROUP), status(v, FM))
    # back within its watch: the FM's step alone — the owner's group neither sent a message nor edited
    group_text = v.thread.shown(1)[GROUP]["text"]
    edits, sent = len(v.tg.edits), len(v.tg.sent)
    rule(v, "opened", 2, 502, t0 + timedelta(minutes=83))
    assert [i["id"] for i in Store(v.s.store_path).incidents(open_only=False)] == [1]
    assert not [e for e in v.tg.edits[edits:] if e[0] == GROUP] and not [x for x in v.tg.sent[sent:] if x[0] == GROUP]
    assert v.thread.shown(1)[GROUP]["text"] == group_text
    assert status(v, FM)[-1].startswith("⚠️ ⚙️ Back at "), status(v, FM)
    # the tablet's card is everyone's: every step, the owner's escalation and the FM's return
    card = k.messages["incident:1"]["status"]
    assert any(ln.startswith("- Escalation sent ") for ln in card) and any("Back at " in ln for ln in card), card
    run(v.tickets.repair())
    (task,) = [t for t in Store(v.s.store_path).tasks(None) if str(t.get("source")) == "incident:1"
               and t.get("status") == "open"]
    k.person_closes(task["todo_uid"], by="Owner", cockpit=True,
                    at=(datetime.now(timezone.utc) + timedelta(seconds=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))
    assert run(v.tickets.repair())["handed"] == 1
    tick(v, t0 + timedelta(minutes=96))
    group, fm = status(v, GROUP), status(v, FM)
    # its close reaches every copy, the owner's too, though the return did not (owner, 2026-11-07, #146-P2)
    for lines in (group, fm):
        assert lines[-1].startswith("✅ Done in the Cockpit ") and "(Owner)" in lines[-1], lines
    # the FM's: every step but the owner's escalation; the owner's: the first alert, its escalation, then how it ended
    assert kinds(fm[:-1]) == ["Alert", "Reminder", "Cleared", "Back"], fm
    assert kinds(group[:-1]) == ["Alert", "Escalation", "Cleared"], group
    for chat in (GROUP, FM):
        assert v.thread.shown(1)[chat]["text"].split("\n")[0].endswith(("(watch)", "(closed)")), \
            v.thread.shown(1)[chat]["text"]


def press(v, chat: int, user: int, what: str):
    """A button pressed on chat `chat`'s copy of alert #1."""
    mid = v.thread.shown(1)[chat]["mid"]
    run(v.on_ha_event("telegram_callback", {"id": f"cb-{chat}-{what}", "data": f"i:1:{what}", "chat_id": chat,
                                            "user_id": user, "message": {"message_id": mid, "chat": {"id": chat}},
                                            "bot": BOT}))


def live(v, chat) -> bool:
    """Does chat `chat`'s copy of alert #1 still offer its buttons?"""
    rec = v.thread.shown(1)[chat]
    return bool(rec.get("buttons")) and not rec.get("settled")


def test_a_press_in_either_chat_closes_every_copy_each_with_its_own_lines(tmp_path):
    # owner, 2026-11-20 (#201): "make sure the button handling is also included" — Done pressed in the owner's chat,
    # then, the alert back for the FM alone, Done in the FM's: every copy settled each time, its buttons gone, each
    # chat's Status its own lines and the close on its bottom line
    OWNER = 111
    v = make_agent(tmp_path, {}, roster=Roster.of(owner=[(OWNER, "Jm")], fm=[(FM, "Wayan")]),
                   skills=["alert-desk"], reader=FakeHA(tools=[tool("ha_get_state")]), kiosk=FakeKiosk())
    v.bot_username = BOT["username"]
    t0 = datetime.now(timezone.utc)
    rule(v, "opened", 1, 500, t0)
    tick(v, t0 + timedelta(minutes=20))
    tick(v, t0 + timedelta(minutes=50))                              # escalated: the owner's chat joins
    assert live(v, OWNER) and live(v, FM)
    press(v, OWNER, OWNER, "done")                                   # pressed in the owner's chat
    for chat in (OWNER, FM):
        assert not live(v, chat), chat
        assert status(v, chat)[-1].startswith("✅ Done ") and "(Jm)" in status(v, chat)[-1], status(v, chat)
    assert kinds(status(v, OWNER)[:-1]) == ["Alert", "Escalation"], status(v, OWNER)
    assert kinds(status(v, FM)[:-1]) == ["Alert", "Reminder"], status(v, FM)
    owner_text = v.thread.shown(1)[OWNER]["text"]
    rule(v, "opened", 2, 502, t0 + timedelta(minutes=60))            # back: the FM's step alone
    assert live(v, FM) and not live(v, OWNER), "asked again in the FM's chat only"
    assert v.thread.shown(1)[OWNER]["text"] == owner_text
    press(v, FM, FM, "done")                                         # pressed in the FM's chat
    for chat in (OWNER, FM):
        assert not live(v, chat), chat
        assert status(v, chat)[-1].startswith("✅ Done ") and "(Wayan)" in status(v, chat)[-1], status(v, chat)
    # the owner's chat, escalated to, reads how it ended since (its first close among its lines), never the return
    assert kinds(status(v, OWNER)[:-1]) == ["Alert", "Escalation", "Done"], status(v, OWNER)
    assert kinds(status(v, FM)[:-1]) == ["Alert", "Reminder", "Done", "Back"], status(v, FM)
