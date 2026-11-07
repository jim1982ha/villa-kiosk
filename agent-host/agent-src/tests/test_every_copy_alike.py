"""Every copy of an alert tells the same Status, in its chat's language, and is brought up to date at every change of
the alert — whichever chat that step was sent to (owner, 2026-11-07, live #146-P2: the facility manager's chat read
"Alert sent / Reminder sent / Cleared … Watch 1h / Back at …, 4th time / ✅ Done in the Cockpit", the owner's group,
joined at the escalation, only "Still-there alert sent … / ✅ Cleared … Watch 1h" — filtered by its role, and never
edited at the return nor at the Done). "(to: …)" says who was told. Synthetic villa; ids invented."""
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


def test_alert_146_every_copy_tells_the_same_status_and_ends_closed(tmp_path):
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
    rule(v, "resolved", 1, 501, t0 + timedelta(minutes=70))          # cleared, watched
    assert status(v, GROUP) == status(v, FM), (status(v, GROUP), status(v, FM))
    rule(v, "opened", 2, 502, t0 + timedelta(minutes=83))            # back within its watch: the same alert
    assert [i["id"] for i in Store(v.s.store_path).incidents(open_only=False)] == [1]
    assert status(v, GROUP) == status(v, FM), ("the return reaches every copy", status(v, GROUP), status(v, FM))
    run(v.tickets.repair())
    (task,) = [t for t in Store(v.s.store_path).tasks(None) if str(t.get("source")) == "incident:1"
               and t.get("status") == "open"]
    k.person_closes(task["todo_uid"], by="Owner", cockpit=True,
                    at=(datetime.now(timezone.utc) + timedelta(seconds=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))
    assert run(v.tickets.repair())["handed"] == 1
    tick(v, t0 + timedelta(minutes=96))
    group, fm = status(v, GROUP), status(v, FM)
    assert group == fm, ("every copy the same lines", group, fm)
    assert fm[-1].startswith("✅ Done in the Cockpit ") and "(Owner)" in fm[-1], fm
    assert any(ln.startswith("- Reminder sent ") and ln.endswith("(to: FM)") for ln in fm), fm
    assert any(ln.startswith("- Back at ") for ln in fm), fm
    for chat in (GROUP, FM):
        assert v.thread.shown(1)[chat]["text"].split("\n")[0].endswith(("(watch)", "(closed)")), \
            v.thread.shown(1)[chat]["text"]
