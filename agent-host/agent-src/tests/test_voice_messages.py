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
    from vesta_agent import answering
    src = open(app_module.__file__, encoding="utf-8").read() + open(answering.__file__, encoding="utf-8").read()
    assert "language saved for them" in src and "Answer in {lang}" not in src


# ── A question spoken on the tablet (ticket 23 of "One inbox", hold to talk) ─────────────────────────────────────────
# The tablet uploads the agreement's WAV (16 kHz, 16-bit, mono) to the Kiosk; the engine fetches it from the Kiosk,
# once, and runs the same path as a Telegram voice note: the skill's plan, then the transcriber. The words heard become
# the person's question in the thread, then the conversation's message.

def _tablet_wav(seconds: float = 1.0) -> bytes:
    """A 440 Hz tone as the tablet records it (messages/voice.ts encodeWav: 16 kHz, 16-bit, mono)."""
    import math
    import struct
    pcm = b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / 16000))) for i in range(int(16000 * seconds)))
    return (b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 16000, 32000, 2, 16)
            + b"data" + struct.pack("<I", len(pcm)) + pcm)


def _hear_tablet(v):
    async def go():
        await v.tablet.collect(v.on_tablet)
        await v.tablet.idle()
    asyncio.run(go())


def test_a_question_spoken_on_the_tablet_is_written_out_and_answered(tmp_path):
    from kiosk_fake import FakeKiosk
    from vesta_agent import tablet
    kiosk = FakeKiosk()
    v = voice_agent(tmp_path, kiosk=kiosk)
    kiosk.person_speaks("owner", _tablet_wav())
    with FakeSTT([200]) as stt:
        v.s.ha_url = stt.url
        _hear_tablet(v)
    # the skill's plan ran on the tablet's WAV: a real 16 kHz mono WAV to the villa's speech-to-text
    assert stt.asked == [("stt.test_whisper", "auto")]
    assert "sample_rate=16000" in stt.contents[0] and "channel=1" in stt.contents[0]
    # the words heard are the person's question in the thread, then the conversation's message, said to be spoken
    assert kiosk.heard == {"ask:1": "words in auto"}
    assert [(t["chat"], t["text"], t["voice"]) for t in v.conversed] == [(tablet.chat_of("owner"), "words in auto", True)]
    # fetched from the Kiosk once (gone there), nothing asked of Telegram, the voice not kept here either
    assert kiosk.voices == {} and v.tg.fetched == []
    assert not os.listdir(os.path.join(v.s.out_dir, "voice"))


def test_with_telegram_off_the_tablet_is_still_heard(tmp_path):
    # the audio comes from any source (ticket 23): a villa with no Telegram at all still hears its tablet
    from kiosk_fake import FakeKiosk
    kiosk = FakeKiosk()
    v = voice_agent(tmp_path, kiosk=kiosk, telegram_on=False)
    kiosk.person_speaks("ops", _tablet_wav())
    with FakeSTT([200]) as stt:
        v.s.ha_url = stt.url
        _hear_tablet(v)
    assert kiosk.heard == {"ask:1": "words in auto"} and [t["text"] for t in v.conversed] == ["words in auto"]


def test_a_spoken_question_no_longer_kept_is_said_on_the_tablet(tmp_path):
    from kiosk_fake import FakeKiosk
    kiosk = FakeKiosk()
    v = voice_agent(tmp_path, kiosk=kiosk)
    kiosk.person_speaks("owner", _tablet_wav())
    kiosk.voices.clear()                                  # read already, or older than the Kiosk keeps a question
    _hear_tablet(v)
    assert v.conversed == [] and kiosk.heard == {}
    assert "no longer kept" in kiosk.conversation("owner")[-1]["text"]


def test_a_spoken_question_not_made_out_is_said_and_its_line_keeps_no_words(tmp_path):
    from kiosk_fake import FakeKiosk
    kiosk = FakeKiosk()
    v = voice_agent(tmp_path, kiosk=kiosk)
    kiosk.person_speaks("owner", _tablet_wav())
    with FakeSTT([("json", {"result": "success", "text": ""})]) as stt:
        v.s.ha_url = stt.url
        _hear_tablet(v)
    assert v.conversed == [] and kiosk.heard == {}
    said = kiosk.conversation("owner")[-1]["text"]
    assert said and v.tg.sent == []                       # told on the tablet, never on Telegram
