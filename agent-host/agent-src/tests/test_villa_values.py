"""The villa sends its own messages with the Agent's values, told, never pasted into a file (owner, 2026-11-26: "why
do we need to edit the packages/vesta_message.yaml every time we do a change here?"): whom each priority reaches, what
"Follow the VESTA Agent" means, the layout's and a visit's words — from the villa's alert desk as it is now, told
again whenever the villa holds other ones."""
from __future__ import annotations

import asyncio
import os

import yaml

from ha_fake import FakeHA
from helpers import make_agent
from vesta_shared.message_format import CHATS_SENSOR, VALUES_EVENT, VALUES_SENSOR


class Villa:
    """The villa's side of the Agent's writes: the events it heard."""
    events: list = []

    def fire_event(self, event_type, data):
        Villa.events.append((event_type, dict(data)))
        return {"success": True}


def _agent(tmp_path, monkeypatch, clock):
    import vesta_agent.app as app_module
    monkeypatch.setattr(app_module.time, "monotonic", lambda: clock[0])
    v = make_agent(tmp_path, {}, skills=["alert-desk"], reader=FakeHA(states={CHATS_SENSOR: {"state": "ok"}}))
    Villa.events = []
    v.actions.writer_factory = Villa
    return v


def test_the_villa_is_told_the_desks_values_and_told_again_only_when_they_differ(tmp_path, monkeypatch):
    clock = [10.0]
    v = _agent(tmp_path, monkeypatch, clock)
    asyncio.run(v.housekeeping())
    ((kind, told),) = Villa.events
    assert kind == VALUES_EVENT
    assert told["follow"]["blueprints"]["critical_watchdog"] == "P1"
    assert told["chats"]["P1"] == ["owner", "fm"] and told["chats"]["P2"] == ["fm"] and told["chats"]["P3"] == []
    assert told["layout"]["priority_to"]["P2"] == "FM" and told["visit"]["closes"] == ["done", "not_a_problem"]
    # the villa holds them (its sensor's state, their fingerprint): nothing more is told
    v.reader = FakeHA(states={CHATS_SENSOR: {"state": "ok"}, VALUES_SENSOR: {"state": told["fingerprint"]}})
    clock[0] += 300
    asyncio.run(v.housekeeping())
    assert len(Villa.events) == 1
    # the villa's own alert desk makes the device-offline rule P3: told within the next 5 minutes, no file pasted
    with open(os.path.join(v.s.skills_dir, "alert-desk", "villa.rules.yaml"), "w", encoding="utf-8") as f:
        yaml.safe_dump({"routes": [{"blueprint": "critical_watchdog", "severity": "P3"}]}, f)
    clock[0] += 300
    asyncio.run(v.housekeeping())
    assert len(Villa.events) == 2 and Villa.events[1][1]["follow"]["blueprints"]["critical_watchdog"] == "P3"
    assert Villa.events[1][1]["fingerprint"] != told["fingerprint"]


def test_a_villa_that_cannot_be_read_is_told_and_keeps_what_it_holds_when_the_desk_is_off(tmp_path, monkeypatch):
    clock = [10.0]
    v = _agent(tmp_path, monkeypatch, clock)
    v.reader = FakeHA()                                   # nothing read: told all the same
    asyncio.run(v.housekeeping())
    assert len(Villa.events) == 1
    import shutil
    shutil.rmtree(os.path.join(v.s.skills_dir, "alert-desk"))
    from vesta_shared import skill_words
    skill_words.use(lambda name: None)                    # the villa has no alert desk on: nothing to tell
    try:
        clock[0] += 300
        asyncio.run(v.housekeeping())
    finally:
        skill_words.use(v.skills.folder)
    assert len(Villa.events) == 1


def test_the_buttons_and_the_layout_say_the_words_vesta_ui_reads_them_by():
    # owner, 2026-11-26: the same button says the same word on Telegram and in VESTA UI — VESTA UI reads its words
    # from the agreement (alertButtons, layout); the desk's buttons and the layout's words are held to them here
    from pathlib import Path
    import json
    from vesta_shared.message_format import STATUS, TO, shipped_values
    path = Path(__file__).resolve().parents[2] / "rootfs" / "opt" / "vesta" / "host" / "agent-contract.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    assert dict(shipped_values()["visit"]["buttons"]) == contract["alertButtons"]
    assert contract["layout"] == {"to": TO.strip(), "status": f"{STATUS}:"}
