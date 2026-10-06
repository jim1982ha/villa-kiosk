"""A Telegram voice message, end to end through the engine (owner, 2026-10-05).

Home Assistant fires `telegram_attachment` with the file's id; the engine fetches
the audio, runs the REAL villa-concierge hook (voice.py decodes it, the skill picks
the speech-to-text and the language), sends the WAV to Home Assistant's
speech-to-text, and the words become the message. Ids invented."""
from __future__ import annotations

import asyncio
import os

import pytest
import yaml

from helpers import copy_skill, make_agent, settings
from telegram_fake import FakeTelegram
from ha_fake import FakeHA
from vesta_agent import app as app_module
from vesta_agent import voice as voice_module
from vesta_agent.app import Vesta
from vesta_agent.kiosk import Kiosk


OWNER, GROUP = 111, -100123
TONE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "voice_440hz.ogg")


def voice_event(chat, user, mime="audio/ogg", reply_to=None):
    e = {"chat_id": chat, "user_id": user, "from_first": "X", "file_id": "FILE-1", "file_mime_type": mime,
         "file_size": 3856, "message_id": 7, "bot": {"username": "Villa_Test_bot"}}
    if reply_to:
        e["reply_to_message_id"] = reply_to
    return e


@pytest.fixture
def agent(tmp_path, monkeypatch):
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner", "language": "fr"}],
                              "chats": {"owner": GROUP, "fm": GROUP}}, skills=["villa-concierge"],
                   telegram=FakeTelegram(audio=open(TONE, "rb").read()))
    with open(os.path.join(v.s.skills_dir, "villa-concierge", "villa.voice.yaml"), "w") as f:
        yaml.safe_dump({"stt": "stt.test_whisper"}, f)       # the villa names its speech-to-text: no lookup
    v.bot_username = "Villa_Test_bot"
    v.conversed, v.stt_calls = [], []

    async def converse(cid, person, text, chat_role="private", **kw):
        v.conversed.append((cid, text, kw.get("voice")))
    v.converse = converse

    async def fake_stt(ha_url, token, stt, headers=None):
        wav = stt["wav"]
        v.stt_calls.append({**stt, "wav_existed": os.path.exists(wav), "wav_head": open(wav, "rb").read(4)})
        return "allume la cuisine", None
    monkeypatch.setattr(voice_module, "speech_to_text", fake_stt)
    return v


def run(coro):
    return asyncio.run(coro)


def test_a_private_voice_message_becomes_the_message(agent):
    run(agent.on_ha_event("telegram_attachment", voice_event(OWNER, OWNER)))
    assert agent.tg.fetched == ["FILE-1"]
    call = agent.stt_calls[0]
    # the skill chose: the villa's stt, the person's saved language; the engine carried a real WAV
    assert call["entity"] == "stt.test_whisper" and call["language"] == "fr"
    assert call["wav_existed"] and call["wav_head"] == b"RIFF" and abs(call["seconds"] - 1.0) < 0.1
    assert agent.conversed == [(OWNER, "allume la cuisine", True)]
    # the person's voice is not kept
    assert not os.listdir(os.path.join(agent.s.out_dir, "voice"))


def test_a_photo_is_not_a_message(agent):
    run(agent.on_ha_event("telegram_attachment", voice_event(OWNER, OWNER, mime="image/jpeg")))
    assert agent.tg.fetched == [] and agent.conversed == []


def test_in_a_group_only_a_voice_reply_to_the_agent_is_read(agent):
    run(agent.on_ha_event("telegram_attachment", voice_event(GROUP, OWNER)))
    assert agent.tg.fetched == [] and agent.conversed == []


def test_without_a_skill_for_voice_the_person_is_told(agent):
    with open(os.path.join(agent.s.skills_dir, "villa-concierge", "skill.yaml")) as f:
        y = yaml.safe_load(f)
    y.pop("on_event")
    with open(os.path.join(agent.s.skills_dir, "villa-concierge", "skill.yaml"), "w") as f:
        yaml.safe_dump(y, f)
    run(agent.on_ha_event("telegram_attachment", voice_event(OWNER, OWNER)))
    assert agent.conversed == [] and "no skill handles them" in agent.tg.sent[-1][1]


def test_the_engine_no_longer_dictates_the_reply_language():
    src = open(app_module.__file__, encoding="utf-8").read()
    assert "language saved for them" in src and "Answer in {lang}" not in src
