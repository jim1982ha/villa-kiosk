"""Telegram through Home Assistant's events (decision D1, section 6c): who the agent
answers, which button presses are its own, and that it never receives, never
leaves a group, and sends nothing while Telegram is off. Field names as captured
live on 2026-09-30; ids invented."""
from __future__ import annotations

import asyncio

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
        self.sent, self.toasts, self.next_id = [], [], 1000

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

    async def edit(self, *a):
        pass

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


def test_nothing_is_sent_while_telegram_is_off(tmp_path):
    s = settings(str(tmp_path), VESTA_TELEGRAM_ENABLED="false", VESTA_TELEGRAM_BOT_TOKEN="42:TG-TEST")
    v = Vesta(s, reader=FakeReader(), kiosk=Kiosk("", ""))
    assert v.tg is None
    assert run(v.send(PRIVATE, "hello")) is None
    assert v.state.calls("send_skipped")
