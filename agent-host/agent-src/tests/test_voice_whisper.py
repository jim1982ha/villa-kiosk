"""A voice message written out by Whisper asked directly, over Wyoming (owner, 2026-10-22: "the Agent asks Whisper
directly").

Measured on the villa: the villa's system refuses the language "auto" (415), so a French voice note went to Whisper
forced to English and came back TRANSLATED. The engine (vesta_agent/wyoming.py, run by transcriber.py) asks the
Whisper app itself, with no language (its own "auto" applies). A stand-in Wyoming server (wyoming_fake.FakeWhisper)
reads what is sent with its own parser and, like the villa's Whisper, says NO language in its transcript; the villa's
speech-to-text is tests/stt_fake.py. Ids and addresses invented."""
from __future__ import annotations

import asyncio
import io
import json
import os
import time

import pytest
import yaml

from ai_fake import FakeAI
from helpers import voice_agent, voice_event, voice_record
from stt_fake import FakeSTT
from vesta_agent import wyoming
from wyoming_fake import FRENCH, FRENCH_SAID, FakeWhisper, event

FMT = {"rate": 16000, "width": 2, "channels": 1}


def sound() -> bytes:
    """2.5 s of 16-bit mono: two whole one-second chunks and a half one."""
    return bytes(range(256)) * (16000 * 2 * 5 // 2 // 256) + b"\x01\x02" * 40


def ask(where: str, pcm: bytes, seconds: float = 5, language=None) -> dict:
    return wyoming.transcribe(wyoming.address(where), pcm, FMT, time.monotonic() + seconds, 3, language)


# ------------------------------------------------------------------ the Wyoming client (the engine's)
def test_auto_sends_no_language_and_the_audio_in_framed_chunks():
    pcm = sound()
    with FakeWhisper() as w:
        got = ask(w.address, pcm)
    assert got == FRENCH                                     # the villa's Whisper: words, no language
    kinds = [e["type"] for e in w.received]
    assert kinds[0] == "transcribe" and kinds[1] == "audio-start" and kinds[-1] == "audio-stop"
    # no language: the Whisper app's own setting ("auto") decides
    assert w.of("transcribe")[0]["data"] == {}
    assert w.of("audio-start")[0]["data"] == FMT
    chunks = w.of("audio-chunk")
    assert chunks and all(c["data"] == FMT for c in chunks)
    # each chunk's payload is exactly what its header announced (the fake read payload_length bytes), at most one
    # second, and together they are the whole sound: nothing lost, nothing read as the next header
    assert all(0 < len(c["payload"]) <= 32000 for c in chunks)
    assert b"".join(c["payload"] for c in chunks) == pcm
    assert len(chunks) == -(-len(pcm) // 32000)


def test_the_reader_merges_data_and_skips_the_payload():
    stream = io.BytesIO(event("transcript-chunk", {"text": "x"}, payload=b"\n{not json\n") +
                        event("transcript", {"language": "fr"}, inline=True) +
                        event("transcript", {"text": "bonjour", "language": "fr"}))
    assert wyoming.read_event(stream) == {"type": "transcript-chunk", "data": {"text": "x"}}   # its payload skipped
    assert wyoming.read_event(stream) == {"type": "transcript", "data": {"language": "fr"}}
    assert wyoming.read_event(stream) == {"type": "transcript", "data": {"text": "bonjour", "language": "fr"}}
    assert wyoming.read_event(stream) is None
    for broken in (b"not json\n", event("transcript", {"text": "bonjour"})[:-3],
                   json.dumps({"type": "x", "data_length": 5}).encode() + b"\nabcde"):
        with pytest.raises(wyoming.WyomingError):
            wyoming.read_event(io.BytesIO(broken))


# ------------------------------------------------------------------ through the agent
def through_agent(tmp_path, voice_yaml: dict, whisper=None, stt_answers=(200,), language="fr", whisper_delay=0):
    """(the conversed the AI got, the (entity, language) asked of the villa's /api/stt, the voice record, the agent,
    the Whisper stand-in)."""
    with FakeWhisper(whisper, delay=whisper_delay) as w, FakeSTT(stt_answers) as stt:
        v = voice_agent(tmp_path, {"whisper": w.address, **voice_yaml}, language=language)
        v.s.ha_url = stt.url
        asyncio.run(v.on_ha_event("telegram_attachment", voice_event()))
    return v.conversed, stt.languages, voice_record(v), v, w


def test_whispers_french_words_reach_the_ai_and_the_villa_is_not_asked(tmp_path):
    conversed, asked, rec, v, w = through_agent(tmp_path, {}, language="en")
    assert [t["text"] for t in conversed] == [FRENCH["text"]] and asked == [] and w.connections == 1
    # the villa's Whisper says no language: none is claimed
    assert conversed[0]["spoken"] is None
    assert rec["via"] == "whisper" and rec["used"] == "auto" and rec["detected"] is None and rec["ok"]
    assert rec["attempts"] == [{"via": "whisper", "stt": None, "language": "auto", "why": None}]
    # never the words, the audio or an address in the record
    assert "lumière" not in str(rec) and "127.0.0.1" not in str(rec) and ".wav" not in str(rec)
    assert not os.listdir(os.path.join(v.s.out_dir, "voice"))          # the voice is not kept


@pytest.mark.parametrize("answer, why", [("close", "WyomingError"), ({"text": ""}, "no words")])
def test_whisper_saying_nothing_takes_the_villas_path(tmp_path, answer, why):
    conversed, asked, rec, v, _ = through_agent(tmp_path, {}, answer, (415, 200))
    assert asked == ["auto", "fr"] and [t["text"] for t in conversed] == ["words in fr"] and conversed[0]["spoken"] is None
    assert rec["via"] == "villa" and rec["auto_refused"] and rec["used"] == "fr"
    # closed before its transcript (a broken answer) and an empty transcript (heard, no words) are told apart
    assert [(a["via"], a["language"], a["why"]) for a in rec["attempts"]] == [
        ("whisper", "auto", why), ("villa", "auto", "refused (415)"), ("villa", "fr", None)]


def test_whisper_off_is_the_villas_path_only(tmp_path):
    conversed, asked, rec, _, w = through_agent(tmp_path, {"whisper": "off"}, None, (415, 200))
    assert w.connections == 0 and asked == ["auto", "fr"] and [t["text"] for t in conversed] == ["words in fr"]
    assert [a["via"] for a in rec["attempts"]] == ["villa", "villa"]


def test_a_fixed_language_is_the_villas_path(tmp_path):
    conversed, asked, rec, v, w = through_agent(tmp_path, {"language": "de"}, None, (200,))
    assert w.connections == 0 and asked == ["de"] and [t["text"] for t in conversed] == ["words in de"]
    assert rec["via"] == "villa" and rec["used"] == "de"


# ------------------------------------------------------------------ what the AI is told
def prompt_of(tmp_path, monkeypatch, answer) -> str:
    v = voice_agent(tmp_path, language="en", converse=True)
    ai = FakeAI("C'est fait.").install(monkeypatch)
    with FakeWhisper(answer) as w:
        with open(os.path.join(v.s.skills_dir, "villa-concierge", "villa.voice.yaml"), "w") as f:
            yaml.safe_dump({"stt": "stt.test_whisper", "whisper": w.address}, f)
        asyncio.run(v.handle_message("telegram_attachment", voice_event()))
    (r,) = ai.runs
    assert FRENCH["text"] in r["prompt"] and "language saved for them: English" in r["prompt"]
    return r["prompt"]


def test_as_on_the_villa_the_ai_is_told_no_language(tmp_path, monkeypatch):
    """The villa's Whisper says no language: the AI reads the words as they are, with no "spoken in" claim
    (instructions.md rule 6: it answers in the language the message is written in)."""
    p = prompt_of(tmp_path, monkeypatch, FRENCH)
    assert "A voice message, as transcribed from Owner" in p and "spoken in" not in p


def test_a_whisper_that_says_the_language_has_it_said_to_the_ai(tmp_path, monkeypatch):
    p = prompt_of(tmp_path, monkeypatch, FRENCH_SAID)
    assert "A voice message, as transcribed (spoken in French) from Owner" in p
