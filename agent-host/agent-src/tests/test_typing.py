"""One "typing…" for every wait (owner, 2026-10-10): from the moment a message is accepted — a photo still being
fetched, a voice message transcribed — until the answer goes; the AI's answer and a report share the chat's ONE loop."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

from ai_fake import FakeAI
from helpers import make_agent, settings
from telegram_fake import FakeTelegram
from vesta_agent import delivery as delivery_module
from vesta_agent.delivery import Delivery
from vesta_agent.state import State

OWNER, GROUP = 111, -100123


def test_a_chat_has_one_typing_loop_whatever_holds_it(tmp_path, monkeypatch):
    monkeypatch.setattr(delivery_module, "TYPING_EVERY_S", 0.01)
    d = Delivery(FakeTelegram(), State(settings(str(tmp_path)).state_path), lambda: SimpleNamespace(chats={}, people={}))

    async def go():
        answer = d.hold(GROUP)
        report = d.hold(GROUP, "fm-weekly")
        assert len(d._waiting) == 1 and len(d._waiting[GROUP]["holds"]) == 2       # one loop, held by both
        await asyncio.sleep(0.05)
        answer()
        answer()                                                      # twice: harmless
        await asyncio.sleep(0.05)
        still = len(d.tg.typing_in)
        await asyncio.sleep(0.05)
        assert len(d.tg.typing_in) > still                            # the report still holds it
        report()
        await asyncio.sleep(0.05)
        after = len(d.tg.typing_in)
        await asyncio.sleep(0.05)
        assert len(d.tg.typing_in) == after and d._waiting == {}      # nothing once nobody waits
    asyncio.run(go())


def test_typing_starts_when_the_message_arrives_not_when_the_ai_starts(tmp_path, monkeypatch):
    # villa, 12:32: the photo was fetched for 2.6 s before "typing…" began
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner"}],
                              "chats": {"owner": GROUP}}, telegram=FakeTelegram(audio=b"\xff\xd8jpeg"))
    v.bot_username = "Villa_Test_bot"
    seen = {}
    real_download = v.tg.download

    async def slow_download(file_id, limit=0):
        await asyncio.sleep(0.05)
        seen["while_fetching"] = list(v.tg.typing_in)
        return await real_download(file_id, limit)
    v.tg.download = slow_download
    FakeAI("A scooter park.").install(monkeypatch)
    e = {"chat_id": GROUP, "user_id": OWNER, "file_id": "P1", "file_mime_type": "image/jpeg", "text": "/ask what is this?",
         "message_id": 3, "bot": {"username": "Villa_Test_bot"}}
    asyncio.run(v.handle_message("telegram_attachment", e))
    assert seen["while_fetching"] == [GROUP]                         # already showing while the photo is fetched
    assert v.delivery._waiting == {}                                  # and stops once the answer is out
