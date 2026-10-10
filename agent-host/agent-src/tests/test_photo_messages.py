"""A photo sent to the agent (owner, 2026-10-10): Fabien sent a screenshot with "/ask are you sure ?" in the group,
twice, and it was dropped without a word or a record. A photo is a message — its caption the text, by the same rules
as a text message (in a group: /ask, a mention or a reply to the agent; in a private chat: always) — and the AI sees
the picture."""
from __future__ import annotations

import asyncio
import base64

from ai_fake import FakeAI
from helpers import make_agent
from telegram_fake import FakeTelegram
from vesta_agent import intake, runner

OWNER, GROUP = 111, -100123
JPEG = b"\xff\xd8\xff\xe0fake-jpeg"


def photo_event(chat, user, caption=None, mime="image/jpeg", reply_to=None):
    e = {"chat_id": chat, "user_id": user, "from_first": "X", "file_id": "PHOTO-1", "file_mime_type": mime,
         "file_size": len(JPEG), "message_id": 9, "bot": {"username": "Villa_Test_bot"}}
    if caption is not None:
        e["text"] = caption
    if reply_to:
        e["reply_to_message_id"] = reply_to
    return e


def _Policy():
    from vesta_agent.policy import Policy
    return Policy({"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner"},
                              {"telegram_id": GROUP, "name": "Group", "role": "owner"}]})


def gate(e):
    return intake.gate("telegram_attachment", e, _Policy(), "Villa_Test_bot", lambda c, m: m == 500)


def test_a_photo_is_read_by_the_rules_of_a_text_message():
    asked = gate(photo_event(GROUP, OWNER, "/ask are you sure ?"))
    assert asked.action == "converse" and asked.photo_file == "PHOTO-1" and asked.text == "are you sure ?"
    assert gate(photo_event(GROUP, OWNER, "/ask@Villa_Test_bot check the picture")).text == "check the picture"
    assert gate(photo_event(GROUP, OWNER, "look at this")).action == "drop"               # people talking to each other
    assert gate(photo_event(GROUP, OWNER, "@Villa_Test_bot what is this?")).action == "converse"
    assert gate(photo_event(GROUP, OWNER, None, reply_to=500)).action == "converse"     # a reply to the agent
    assert gate(photo_event(GROUP, OWNER, "/ask@OtherBot hi")).action == "drop"
    private = gate(photo_event(OWNER, OWNER))                                           # a private chat: always
    assert private.action == "converse" and private.photo_file == "PHOTO-1" and private.text == ""
    pdf = gate(photo_event(OWNER, OWNER, "the invoice", mime="application/pdf"))
    assert pdf.action == "drop" and "application/pdf" in pdf.why                         # never dropped unsaid


def test_the_ai_looks_at_the_photo_with_its_caption(tmp_path, monkeypatch):
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner"}],
                              "chats": {"owner": GROUP}}, telegram=FakeTelegram(audio=JPEG))
    v.bot_username = "Villa_Test_bot"
    ai = FakeAI("The Onsen pump shows 0 W.").install(monkeypatch)
    asyncio.run(v.handle_message("telegram_attachment", photo_event(GROUP, OWNER, "/ask are you sure ?")))
    (r,) = ai.runs
    assert r["image"] == (base64.b64encode(JPEG).decode(), "image/jpeg")
    assert "photo (attached: look at it)" in r["prompt"] and "are you sure ?" in r["prompt"]
    assert r["asked"] == "[photo] are you sure ?"
    assert [t for c, t, _ in v.tg.sent if c == GROUP] == ["The Onsen pump shows 0 W."]


def test_a_photo_that_cannot_be_fetched_is_said(tmp_path, monkeypatch):
    from vesta_agent.telegram import TelegramError
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner"}],
                              "chats": {"owner": GROUP}})
    v.bot_username = "Villa_Test_bot"

    async def refused(file_id, limit=0):
        raise TelegramError("getFile: no file, or larger than the limit")
    v.tg.download = refused
    ai = FakeAI("x").install(monkeypatch)
    asyncio.run(v.handle_message("telegram_attachment", photo_event(GROUP, OWNER, "/ask are you sure ?")))
    assert ai.runs == [] and any("could not be fetched" in t for _, t, _ in v.tg.sent)


def test_the_sdk_is_sent_the_picture_and_the_text_in_one_message():
    async def first(m):
        async for x in m:
            return x
    msg = asyncio.run(first(runner.message("look", ("QUJD", "image/png"))))
    content = msg["message"]["content"]
    assert content[0] == {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "QUJD"}}
    assert content[1] == {"type": "text", "text": "look"}
    assert runner.message("plain") == "plain"
