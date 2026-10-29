"""Delivery's two places, chosen once per chat (architecture review 2026-10-29, #3): a Telegram chat and a tablet's
conversation take the same steps — send, edit, reply with a picture, delete, hold — each as it shows them, and what a
message that arrived tells is the same for both. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import base64
import inspect
import re

import pytest

from helpers import make_agent
from kiosk_fake import FakeKiosk
from vesta_agent import delivery, tablet

OWNER = 111
JPEG = (base64.b64encode(b"\xff\xd8\xff camera").decode(), "image/jpeg")


@pytest.fixture
def agent(tmp_path):
    return make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner"}]}, kiosk=FakeKiosk())


@pytest.mark.parametrize("where", ["telegram", "tablet"])
def test_both_places_take_the_same_steps(agent, where):
    chat = OWNER if where == "telegram" else tablet.chat_of("owner")
    d = agent.delivery

    async def go():
        mid = await d.send(chat, "**Hello**")
        assert mid and agent.state.is_own_message(chat, mid)                    # arrived, and the agent's own
        assert await d.edit(chat, mid, "Hello again")
        rid = await d.reply(chat, "The gate is closed.", photos=[JPEG])
        assert rid and await d.delete(chat, mid)
        release = d.hold(chat)
        release()
        release()                                                               # safe twice, wherever
        return mid, rid
    mid, rid = asyncio.run(go())
    if where == "telegram":
        assert agent.tg.sent[0][1] == "Hello"                                   # plain text, as on the tablet
        assert agent.kiosk.turns == {}
    else:
        shown = agent.kiosk.turns
        assert shown[tablet.turn_key(mid)].get("gone") is True                  # withdrawn, never removed
        assert shown[tablet.turn_key(rid)]["photos"] == [JPEG[0]]               # one turn, words and picture
        assert agent.tg.sent == []


def test_the_place_is_chosen_once():
    src = inspect.getsource(delivery.Delivery)
    assert len(re.findall(r"\.owns\(|_on_tablet|self\.tg is None", src)) == 1, "a step decides its place again"
