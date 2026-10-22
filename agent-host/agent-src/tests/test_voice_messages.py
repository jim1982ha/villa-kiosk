"""A Telegram voice message, end to end through the engine (owner, 2026-10-05).

Home Assistant fires `telegram_attachment` with the file's id; the engine fetches the audio, runs the REAL
villa-concierge hook (voice.py decodes it and answers the plan: here the villa's speech-to-text, Whisper off), sends
the WAV to the villa system's speech-to-text (tests/stt_fake.py), and the words become the message. Ids invented."""
from __future__ import annotations

import asyncio
import os

import yaml

from helpers import VOICE_GROUP as GROUP, VOICE_OWNER as OWNER, voice_agent, voice_event
from stt_fake import FakeSTT
from vesta_agent import app as app_module


def test_a_private_voice_message_becomes_the_message(tmp_path):
    v = voice_agent(tmp_path)
    with FakeSTT([200]) as stt:
        v.s.ha_url = stt.url
        asyncio.run(v.on_ha_event("telegram_attachment", voice_event()))
    assert v.tg.fetched == ["FILE-1"]
    # the skill's plan: the villa's stt, the language spoken ("auto") first; the engine carried a real 16 kHz WAV
    # with the agent's token
    assert stt.asked == [("stt.test_whisper", "auto")]
    assert "sample_rate=16000" in stt.contents[0] and "channel=1" in stt.contents[0] and "bit_rate=16" in stt.contents[0]
    assert stt.tokens == ["Bearer ha-TEST-token-0000"]
    assert [(t["chat"], t["text"], t["voice"]) for t in v.conversed] == [(OWNER, "words in auto", True)]
    # the person's voice is not kept
    assert not os.listdir(os.path.join(v.s.out_dir, "voice"))


def test_a_photo_is_a_message_not_a_voice_one(tmp_path):
    # owner, 2026-10-10: a photo is read as a message (tests/test_photo_messages.py) — never transcribed as voice
    v = voice_agent(tmp_path)
    with FakeSTT() as stt:
        v.s.ha_url = stt.url
        asyncio.run(v.on_ha_event("telegram_attachment", voice_event(mime="image/jpeg")))
    assert stt.asked == [] and [t["voice"] for t in v.conversed] == [False]


def test_in_a_group_only_a_voice_reply_to_the_agent_is_read(tmp_path):
    v = voice_agent(tmp_path)
    asyncio.run(v.on_ha_event("telegram_attachment", voice_event(GROUP, OWNER)))
    assert v.tg.fetched == [] and v.conversed == []


def test_without_a_skill_for_voice_the_person_is_told(tmp_path):
    v = voice_agent(tmp_path)
    path = os.path.join(v.s.skills_dir, "villa-concierge", "skill.yaml")
    with open(path) as f:
        y = yaml.safe_load(f)
    y.pop("on_event")
    with open(path, "w") as f:
        yaml.safe_dump(y, f)
    asyncio.run(v.on_ha_event("telegram_attachment", voice_event()))
    assert v.conversed == [] and "no skill handles them" in v.tg.sent[-1][1]


def test_the_engine_no_longer_dictates_the_reply_language():
    src = open(app_module.__file__, encoding="utf-8").read()
    assert "language saved for them" in src and "Answer in {lang}" not in src
