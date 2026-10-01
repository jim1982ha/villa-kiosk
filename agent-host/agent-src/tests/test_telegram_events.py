"""Telegram through Home Assistant's events (decision D1, section 6c): who the agent
answers, which button presses are its own, and that it never receives, never
leaves a group, and sends nothing while Telegram is off. Field names as captured
live on 2026-09-30; ids invented."""
from __future__ import annotations

import asyncio
import json
import re

import pytest
import yaml

from helpers import copy_skill, settings
from vesta_agent.app import Vesta
from vesta_agent.kiosk import Kiosk

OWNER, FM, STRANGER = 111, 222, 999
GROUP, PRIVATE = -100123, OWNER
BOT = {"id": 8000, "username": "Villa_Test_bot"}


class FakeTelegram:
    def __init__(self):
        self.sent, self.toasts, self.edits, self.next_id = [], [], [], 1000

    async def open(self):
        return BOT

    async def close(self):
        pass

    async def send(self, chat_id, text, keyboard=None, document=None, photo_b64=None):
        self.next_id += 1
        self.sent.append((chat_id, text, keyboard))
        return self.next_id

    async def answer_callback(self, qid, text):
        self.toasts.append((qid, text))

    async def edit(self, chat_id, message_id, text):
        self.edits.append((chat_id, message_id, text))

    def __getattr__(self, name):          # getUpdates, leaveChat... must never be reached
        raise AssertionError(f"Telegram.{name} must never be called")


class FakeReader:
    class mcp:
        @staticmethod
        def list_tools():
            return [{"name": "ha_get_state"}]

    def states(self, ids):
        return {}


@pytest.fixture
def agent(tmp_path):
    s = settings(str(tmp_path), VESTA_TELEGRAM_ENABLED="true", VESTA_TELEGRAM_BOT_TOKEN="42:TG-TEST")
    with open(s.policy_path, "w") as f:
        yaml.safe_dump({"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner", "language": "en"},
                                   {"telegram_id": FM, "name": "FM", "role": "fm", "language": "en"}],
                        "chats": {"owner": GROUP, "fm": GROUP}}, f)
    copy_skill("alert-desk", s.skills_dir)
    v = Vesta(s, telegram=FakeTelegram(), reader=FakeReader(), kiosk=Kiosk("", ""))
    v.bot_username = BOT["username"]
    v.conversed = []

    async def converse(cid, person, text, chat_role="private", **kw):
        v.conversed.append((cid, person.name if person else None, text))
    v.converse = converse
    return v


def text_event(chat, user, text, reply_to=None):
    d = {"id": 1, "chat_id": chat, "text": text, "user_id": user, "from_first": "X", "bot": BOT}
    if reply_to:
        d["reply_to_message_id"] = reply_to
        d["message_thread_id"] = reply_to          # what a group reply carries too (live capture)
    return d


def run(coro):
    return asyncio.run(coro)


def test_private_text_is_answered(agent):
    run(agent.on_ha_event("telegram_text", text_event(PRIVATE, OWNER, "is the pool OK?")))
    assert agent.conversed == [(PRIVATE, "Owner", "is the pool OK?")]


def test_group_chatter_is_dropped_by_code(agent):
    run(agent.on_ha_event("telegram_text", text_event(GROUP, OWNER, "hello everyone")))
    assert agent.conversed == []


def test_group_mention_reply_and_command_are_answered(agent):
    run(agent.on_ha_event("telegram_text", text_event(GROUP, OWNER, "@Villa_Test_bot  is the pool OK?")))
    assert agent.conversed[-1] == (GROUP, "Owner", "is the pool OK?")
    run(agent.on_ha_event("telegram_command", {"chat_id": GROUP, "user_id": FM, "command": "/ask",
                                               "args": ["is", "the", "pool", "OK?"], "bot": BOT}))
    assert agent.conversed[-1] == (GROUP, "FM", "is the pool OK?")
    agent.state.remember_message(GROUP, 555)
    run(agent.on_ha_event("telegram_text", text_event(GROUP, FM, "reply test", reply_to=555)))
    assert agent.conversed[-1] == (GROUP, "FM", "reply test")


def test_a_reply_to_a_home_assistant_message_is_not_for_the_agent(agent):
    run(agent.on_ha_event("telegram_text", text_event(GROUP, FM, "on my way", reply_to=629)))
    assert agent.conversed == []


def test_commands_for_home_assistant_or_another_bot_are_left_alone(agent):
    run(agent.on_ha_event("telegram_command", {"chat_id": GROUP, "user_id": OWNER, "command": "/unlock_gate",
                                               "args": [], "bot": BOT}))
    run(agent.on_ha_event("telegram_command", {"chat_id": GROUP, "user_id": OWNER, "command": "/ask@OtherBot",
                                               "args": ["x"], "bot": BOT}))
    assert agent.conversed == [] and agent.tg.sent == []


def test_an_unlisted_group_is_ignored_never_left(agent):
    run(agent.on_ha_event("telegram_text", text_event(-100999, OWNER, "@Villa_Test_bot hello")))
    assert agent.conversed == [] and agent.tg.sent == []        # FakeTelegram raises on leaveChat


def test_unregistered_people_get_their_id_in_private_only(agent):
    run(agent.on_ha_event("telegram_text", text_event(STRANGER, STRANGER, "hi")))
    assert agent.tg.sent and str(STRANGER) in agent.tg.sent[0][1]
    agent.tg.sent.clear()
    run(agent.on_ha_event("telegram_text", text_event(GROUP, STRANGER, "@Villa_Test_bot hi")))
    assert agent.tg.sent == [] and agent.conversed == []


def test_a_press_on_a_home_assistant_message_is_left_to_its_automation(agent):
    # the gate button: Home Assistant's message, Home Assistant's press — not even answered here
    press = {"id": "cb1", "data": "/unlock_gate", "command": "/unlock_gate", "chat_id": GROUP, "user_id": OWNER,
             "message": {"message_id": 616, "chat": {"id": GROUP}}, "bot": BOT}
    run(agent.on_ha_event("telegram_callback", press))
    assert agent.tg.toasts == [] and agent.tg.sent == []


def test_a_press_on_the_agents_own_message_is_handled(agent):
    mid = run(agent.send(GROUP, "Incident #1", keyboard={"inline_keyboard": []}))
    agent.state.put(f"inc:1:{GROUP}", "alert-desk")
    from vesta_shared.store import Store
    Store(agent.s.store_path).new_incident("k", "automation.x", "lock.front_door", "P2", {"message": "m"})
    press = {"id": "cb2", "data": "i:1:not_found", "chat_id": GROUP, "user_id": FM,
             "message": {"message_id": mid, "chat": {"id": GROUP}}, "bot": BOT}
    run(agent.on_ha_event("telegram_callback", press))
    assert agent.tg.toasts and agent.tg.toasts[0][1] == "Not found: noted."
    assert any("Noted for #1" in t for _, t, _ in agent.tg.sent)


def test_a_press_in_a_private_chat_is_answered_there_and_its_buttons_go(agent):
    # the facility manager's chat is the group, but the alert was pressed in a private chat:
    # the answer goes where the press was, and the pressed message loses its buttons
    mid = run(agent.send(FM, "🚨 Incident #1: pump stopped", keyboard={"inline_keyboard": [[{"text": "Done"}]]}))
    agent.state.put(f"inc:1:{FM}", "alert-desk")
    from vesta_shared.store import Store
    Store(agent.s.store_path).new_incident("k", "automation.x", "lock.front_door", "P2", {"message": "m"})
    press = {"id": "cb3", "data": "i:1:done", "chat_id": FM, "user_id": FM,
             "message": {"message_id": mid, "chat": {"id": FM}, "text": "🚨 Incident #1: pump stopped"}, "bot": BOT}
    before = len(agent.tg.sent)
    run(agent.on_ha_event("telegram_callback", press))
    replies = agent.tg.sent[before:]
    assert replies and all(chat == FM for chat, _, _ in replies)           # never the group
    (chat, m, text), = agent.tg.edits
    assert (chat, m) == (FM, mid)
    assert text.startswith("🚨 Incident #1: pump stopped\n\nDone — FM, ")    # who, what, when
    assert re.search(r", \d\d:\d\d$", text)


def test_telegram_gets_plain_text_not_markdown(agent):
    run(agent.send(PRIVATE, "## Pool\n**Pump**: `on`, see [the log](https://example.invalid/x) — 2**3 stays"))
    (_, text, _), = agent.tg.sent
    assert text == "Pool\nPump: on, see the log (https://example.invalid/x) — 2**3 stays"


def test_a_kiosk_ticket_title_has_no_leading_emoji_or_rule_code():
    from vesta_agent.outcome import ticket_title as _ticket_title
    assert _ticket_title("🚨 [VESTA-WD-01] Pump offline\nmore") == "Pump offline"
    assert _ticket_title("⚠️  Battery low") == "Battery low"
    assert _ticket_title("Battery low") == "Battery low"


def test_while_acting_is_off_the_model_is_told_not_to_offer(agent):
    s = agent.policy().summary()
    assert "Never offer" in s and "approves with a" not in s
    assert "no Markdown" in agent.system_prompt()
    assert "never answer from an earlier attempt" in agent.system_prompt()


def test_the_status_tool_reports_the_agents_own_night(agent):
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    agent.state.put("job:alert-desk:0:daily 02:00", (now - timedelta(hours=3)).isoformat())
    agent.state.put("job:reports:0:monthly 1 08:00", (now - timedelta(days=20)).isoformat())
    agent.state.log("critical_event", {"rule": "automation.x", "phase": "opened", "handled": True})
    agent.state.log("run", {"who": "FM@1", "cost_usd": 0.25, "chat": 42})
    agent.state.log("ladder", {"incident": 1, "by": "FM", "reply": "Done"})
    rep = agent.toolbox().status_report(24, now=now)
    assert [j["job"] for j in rep["scheduled_jobs"]] == ["alert-desk:0:daily 02:00"]   # last night only
    assert rep["ai_cost_usd"] == 0.25 and rep["counts"]["run"] == 1
    assert [e["what"] for e in rep["events"]] == ["critical_event", "ladder"]
    assert "chat" not in json.dumps(rep["events"])                                   # no chat ids told


def test_nothing_is_sent_while_telegram_is_off(tmp_path):
    s = settings(str(tmp_path), VESTA_TELEGRAM_ENABLED="false", VESTA_TELEGRAM_BOT_TOKEN="42:TG-TEST")
    v = Vesta(s, reader=FakeReader(), kiosk=Kiosk("", ""))
    assert v.tg is None
    assert run(v.send(PRIVATE, "hello")) is None
    assert v.state.calls("send_skipped")


def test_a_failed_skill_script_is_in_the_apps_log_with_its_reason(agent, caplog):
    import os
    d = os.path.join(agent.s.skills_dir, "pool-care")
    os.makedirs(os.path.join(d, "scripts"))
    open(os.path.join(d, "SKILL.md"), "w").write("# pool-care\n")
    open(os.path.join(d, "skill.yaml"), "w").write(yaml.safe_dump({"description": "t", "scripts": {"check.py": {}}}))
    open(os.path.join(d, "scripts", "check.py"), "w").write(
        "import sys\nprint('Traceback...', file=sys.stderr)\nprint('check needs --energy', file=sys.stderr)\nsys.exit(1)\n")
    tool = next(t for t in agent.toolbox().tool_objects(None, PRIVATE, False) if t.name == "run_skill_script")
    res = run(tool.handler({"skill": "pool-care", "script": "check.py", "args": []}))
    assert res.get("is_error")
    assert any("pool-care: check.py failed (exit 1): check needs --energy" in r.getMessage() for r in caplog.records)


def test_a_report_asked_for_in_a_chat_can_be_sent_there(agent):
    # 2026-09-30: asked in the group, the weekly page went to the fm chat (a private chat)
    # asked in a private chat; owner and fm are both the group in this policy
    here = next(t for t in agent.toolbox().tool_objects(None, PRIVATE, False) if t.name == "send_message")
    assert "here" in here.input_schema["properties"]["to"]["enum"]
    run(here.handler({"to": "here", "text": "Weekly page"}))
    assert agent.tg.sent[-1][0] == PRIVATE != GROUP
    job = next(t for t in agent.toolbox().tool_objects(None, None, False) if t.name == "send_message")
    assert job.input_schema["properties"]["to"]["enum"] == ["owner", "fm"]      # a scheduled job names a chat
