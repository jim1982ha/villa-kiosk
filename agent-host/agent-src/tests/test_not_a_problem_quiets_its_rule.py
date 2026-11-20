""""Not a problem" stops its rule's repeats (owner, 2026-11-21): the door left unlocked on purpose was still sent to
Telegram every 30 minutes by its rule. A person's "Not a problem" — on Telegram or in the Cockpit — tells the villa's
rule (the event its repeat wait hears) that this run sends the alert no more for the desk's quiet_hours since the
close; a repeat that still comes within that time (Home Assistant restarted the run) tells it again; after it, the
rule repeats as before and VESTA tells it nothing. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from helpers import make_agent
from ha_fake import FakeHA, tool
from telegram_fake import BOT
from vesta_agent.roster import Roster
from vesta_shared.result import QUIET_EVENT
from vesta_shared.timeutil import moment

OWNER, FM, GROUP = 111, 222, -100123
RULE = "automation.critical_condition_example_door"


def run(coro):
    return asyncio.run(coro)


class Villa:
    """The villa's side of the executor's writes: the events it heard."""
    events: list = []

    def fire_event(self, event_type, data):
        Villa.events.append((event_type, dict(data)))
        return {"success": True}

    def call_service(self, domain, service, data):
        return {}

    def states(self, entity_ids=None):
        return {}


@pytest.fixture
def agent(tmp_path):
    v = make_agent(tmp_path, {}, roster=Roster.of(owner=[(OWNER, "Owner"), (GROUP, "Owner chat")], fm=[(FM, "Wayan")]),
                   skills=["alert-desk"], reader=FakeHA(tools=[tool("ha_get_state")]))
    v.bot_username = BOT["username"]
    Villa.events = []
    v.actions.writer_factory = Villa
    return v


def alert(v, run_no: int, at: datetime | None = None):
    """The rule's alert (its first, or a repeat of run `run_no`)."""
    run(v.on_ha_event("vesta_critical_event", {
        "blueprint": "critical_condition", "rule_id": RULE, "incident_id": f"{RULE}-{run_no}", "phase": "opened",
        "severity": "critical", "label": "Door unlocked", "entities": ["lock.example_door"],
        "bad_states": ["unlocked"], "mode": "state", "summary": "Door is unlocked for 10min",
        "timestamp": (at or datetime.now(timezone.utc)).isoformat(), "priority": "P1"}))


def press(v, option="not_a_problem"):
    """The owner's "Not a problem" (or `option`) on the alert's card in the group."""
    mid = v.thread.shown(1)[GROUP]["mid"]
    run(v.on_ha_event("telegram_callback", {"id": "cb", "data": f"i:1:{option}", "chat_id": GROUP, "user_id": OWNER,
                                            "message": {"message_id": mid, "chat": {"id": GROUP}}, "bot": BOT}))


def quiets() -> list[dict]:
    return [d for t, d in Villa.events if t == QUIET_EVENT]


def test_not_a_problem_on_telegram_tells_the_rules_run_to_stop_for_a_day(agent):
    alert(agent, 1)
    assert quiets() == []                                       # an alert alone tells the rule nothing
    pressed = datetime.now(timezone.utc)
    press(agent)
    (q,) = quiets()
    assert q["rule_id"] == RULE and q["incident_id"] == f"{RULE}-1"
    assert abs((moment(q["until"]) - pressed) - timedelta(hours=24)) < timedelta(minutes=1), q


def test_a_done_leaves_the_rule_to_repeat(agent):
    alert(agent, 1)
    press(agent, "done")
    alert(agent, 1)
    assert quiets() == []


def test_a_repeat_within_the_day_tells_it_again_and_one_after_it_is_left_to_repeat(agent):
    alert(agent, 1)
    press(agent)
    (first,) = quiets()
    # Home Assistant restarted: the same problem under another run, which never heard the first
    alert(agent, 2)
    assert [q["incident_id"] for q in quiets()] == [f"{RULE}-1", f"{RULE}-2"]
    assert quiets()[1]["until"] == first["until"]               # the day counts from the press, never from a repeat
    # a repeat that still gets through late in the day (the event unheard) is told again, with the same end
    now = datetime.now(timezone.utc)
    assert repeat_at(agent, 2, now + timedelta(hours=23)) == "lasting"
    assert len(quiets()) == 3 and quiets()[2]["until"] == first["until"], quiets()
    # the day over, the rule repeats as before: VESTA records each repeat on the closed card, tells the rule nothing
    assert repeat_at(agent, 2, now + timedelta(hours=25)) == "lasting"
    assert len(quiets()) == 3, quiets()


def repeat_at(v, run_no: int, at: datetime) -> str:
    """A repeat of run `run_no` read by the desk at `at` (its own clock), carried out as the engine does: its decision."""
    import json
    import os
    path = os.path.join(v.s.out_dir, f"repeat-{run_no}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"blueprint": "critical_condition", "rule_id": RULE, "incident_id": f"{RULE}-{run_no}",
                   "phase": "opened", "severity": "critical", "label": "Door unlocked",
                   "entities": ["lock.example_door"], "bad_states": ["unlocked"], "mode": "state",
                   "summary": "Door is unlocked", "timestamp": at.isoformat(), "priority": "P1"}, f)
    res = run(v.run_code_job(v.skills.get("alert-desk"), f"desk.py intake --event {path} --now {at.isoformat()}", 60))
    return res.get("decision")


def test_not_a_problem_in_the_cockpit_tells_the_rule_too(tmp_path):
    from test_cockpit_languages import RULE as K_RULE, villa
    from test_cockpit_close_told import told
    v, k, uid = villa(tmp_path)
    Villa.events = []
    v.actions.writer_factory = Villa
    now = datetime.now(timezone.utc)
    k.person_closes(uid, by="Luc", at=now.strftime("%Y-%m-%dT%H:%M:00.000Z"), lasting=True, cockpit=True)
    assert run(v.tickets.repair())["handed"] == 1
    told(v, now + timedelta(minutes=1))
    (q,) = quiets()
    assert q["rule_id"] == K_RULE and q["incident_id"].startswith(f"{K_RULE}-"), q
