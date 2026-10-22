"""A voice message written out by Whisper asked directly, over Wyoming (owner, 2026-10-22: "the Agent asks Whisper
directly").

Measured on the villa: the villa's system refuses the language "auto" (415), so a French voice note went to Whisper
forced to English and came back TRANSLATED. villa-concierge's voice.py now asks the Whisper app itself, with no
language (its own "auto" applies), and hands the engine the words; when Whisper cannot be reached or says nothing,
the villa's speech-to-text path of 0.12.320 runs as before. A stand-in Wyoming server (wyoming_fake.FakeWhisper)
reads what the script sends with its own parser; a stand-in /api/stt (test_voice_language) counts the villa's
requests. Ids and addresses invented."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
import sys

import pytest
import yaml
from aiohttp import web
from aiohttp.test_utils import TestServer

from ai_fake import FakeAI
from helpers import make_agent
from telegram_fake import FakeTelegram
from test_voice_language import GROUP, OWNER, TONE, language_of, make, voice_event
from wyoming_fake import FakeWhisper, event

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "starter", "skills", "villa-concierge", "scripts"))
import voice as script  # noqa: E402

FRENCH = {"text": "allume la lumière de la cuisine", "language": "fr"}


class Ids:
    def __init__(self, ids):
        self.ids = ids

    def all_entity_ids(self):
        return self.ids


def closed_port() -> str:
    """An address where nothing listens: the connection is refused at once."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return f"127.0.0.1:{port}"


def pcm() -> bytes:
    return script.decode_opus(open(TONE, "rb").read())


def audio(tmp_path):
    a = tmp_path / "v.ogg"
    shutil.copy(TONE, a)
    return str(a)


# ------------------------------------------------------------------ the Wyoming client (the skill's script)
def test_auto_sends_no_language_and_the_audio_in_framed_chunks():
    sound = pcm()
    with FakeWhisper(FRENCH) as w:
        got = script.whisper(script.whisper_address(w.address), sound)
    assert got == FRENCH
    kinds = [e["type"] for e in w.received]
    assert kinds[0] == "transcribe" and kinds[1] == "audio-start" and kinds[-1] == "audio-stop"
    # no language: the Whisper app's own setting ("auto") decides
    assert w.of("transcribe")[0]["data"] == {}
    fmt = {"rate": 16000, "width": 2, "channels": 1}
    assert w.of("audio-start")[0]["data"] == fmt
    chunks = w.of("audio-chunk")
    assert chunks and all(c["data"] == fmt for c in chunks)
    # each chunk's payload is exactly what its header announced (the fake read payload_length bytes), at most one
    # second, and together they are the whole sound: nothing lost, nothing read as the next header
    assert all(0 < len(c["payload"]) <= script.CHUNK for c in chunks)
    assert b"".join(c["payload"] for c in chunks) == sound
    assert len(chunks) == -(-len(sound) // script.CHUNK)


def test_a_fixed_language_is_sent_when_asked():
    with FakeWhisper({"text": "guten Tag"}) as w:
        got = script.whisper(script.whisper_address(w.address), pcm(), language="de")
    assert got == {"text": "guten Tag"}                       # no language in the transcript: none said
    assert w.of("transcribe")[0]["data"] == {"language": "de"}


def test_an_event_is_one_header_line_then_its_data_then_its_payload():
    raw = script.wyoming_event("audio-chunk", {"rate": 16000}, b"\x01\x02\x03")
    line, rest = raw.split(b"\n", 1)
    head = json.loads(line)
    assert head["type"] == "audio-chunk" and "data" not in head
    assert json.loads(rest[:head["data_length"]]) == {"rate": 16000}
    assert rest[head["data_length"]:] == b"\x01\x02\x03" and head["payload_length"] == 3
    bare = json.loads(script.wyoming_event("audio-stop").split(b"\n", 1)[0])
    assert "data_length" not in bare and "payload_length" not in bare


def test_the_reader_merges_data_and_skips_the_payload(tmp_path):
    import io
    stream = io.BytesIO(event("transcript-chunk", {"text": "x"}, payload=b"\n{not json\n") +
                        event("transcript", {"language": "fr"}, inline=True) +
                        event("transcript", {"text": "bonjour", "language": "fr"}))
    assert script.read_event(stream) == {"type": "transcript-chunk", "data": {"text": "x"}}   # its payload skipped
    assert script.read_event(stream) == {"type": "transcript", "data": {"language": "fr"}}
    assert script.read_event(stream) == {"type": "transcript", "data": {"text": "bonjour", "language": "fr"}}
    assert script.read_event(stream) is None
    for broken in (b"not json\n", event("transcript", {"text": "bonjour"})[:-3],
                   json.dumps({"type": "x", "data_length": 5}).encode() + b"\nabcde"):
        with pytest.raises(script.WyomingError):
            script.read_event(io.BytesIO(broken))


def test_a_silent_whisper_times_out():
    with FakeWhisper("silent") as w, pytest.raises(OSError) as e:      # what prepare() catches
        script.whisper(script.whisper_address(w.address), pcm(), total_s=1)
    assert isinstance(e.value, TimeoutError)


def test_the_setting():
    assert script.whisper_address(None) == ("core-whisper", 10300) == script.whisper_address("")
    assert script.whisper_address("whisper.lan:10301") == ("whisper.lan", 10301)
    for off in ("off", "OFF", False, "false", "no"):
        assert script.whisper_address(off) is None, off
    with pytest.raises(ValueError):
        script.whisper_address("core-whisper")


# ------------------------------------------------------------------ prepare: Whisper first, the villa's path after
def test_prepare_answers_whispers_words_and_writes_no_wav(tmp_path):
    with FakeWhisper(FRENCH) as w:
        res = script.prepare(audio(tmp_path), "en", Ids(["stt.a"]), whisper_at=w.address)
    assert res["text"] == FRENCH["text"] and res["language"] == "fr" and res["via"] == "whisper"
    assert abs(res["seconds"] - 1.0) < 0.1 and "stt" not in res
    assert not (tmp_path / "v.wav").exists()


@pytest.mark.parametrize("answer, why", [("close", "WyomingError"), ({"text": "  "}, "WyomingError")])
def test_prepare_falls_back_when_whisper_says_nothing(tmp_path, answer, why):
    with FakeWhisper(answer) as w:
        res = script.prepare(audio(tmp_path), "fr", Ids(["stt.a"]), whisper_at=w.address)
    assert w.connections == 1
    st = res["stt"]
    assert st["language"] == "auto" and st["fallback"] == "fr" and st["entity"] == "stt.a" and st["whisper"] == why
    assert os.path.exists(st["wav"])


def test_prepare_falls_back_when_whisper_cannot_be_reached(tmp_path):
    res = script.prepare(audio(tmp_path), "fr", Ids(["stt.a"]), whisper_at=closed_port())
    assert res["stt"]["language"] == "auto" and res["stt"]["whisper"] == "ConnectionRefusedError"


def test_whisper_off_and_a_fixed_language_never_connect(tmp_path, monkeypatch):
    with FakeWhisper(FRENCH) as w:
        off = script.prepare(audio(tmp_path), "fr", Ids(["stt.a"]), whisper_at="off")
        assert off["stt"]["language"] == "auto" and off["stt"]["whisper"] == "off"
        monkeypatch.setattr(script, "villa_settings", lambda: {"language": "de"})
        fixed = script.prepare(audio(tmp_path), "fr", Ids(["stt.a"]), whisper_at=w.address)
    assert fixed["stt"]["language"] == "de" and "fallback" not in fixed["stt"] and "whisper" not in fixed["stt"]
    assert w.connections == 0


# ------------------------------------------------------------------ through the engine
def through_agent(tmp_path, voice_yaml: dict, whisper_answer=None, stt_answers=(200,)):
    """The voice message through the agent: (words the AI got, languages asked of the villa's /api/stt, the voice
    record, the agent, the Whisper stand-in)."""
    asked: list[str] = []

    async def stt(request):
        asked.append(language_of(request.headers["X-Speech-Content"]))
        await request.read()
        answer = stt_answers[min(len(asked), len(stt_answers)) - 1]
        if answer != 200:
            return web.Response(status=answer)
        return web.json_response({"result": "success", "text": f"words in {asked[-1]}"})

    async def go(v):
        app = web.Application()
        app.router.add_post("/api/stt/{entity}", stt)
        async with TestServer(app) as server:
            v.s.ha_url = str(server.make_url("")).rstrip("/")
            await v.on_ha_event("telegram_attachment", voice_event())

    with FakeWhisper(whisper_answer or FRENCH) as w:
        v = make(tmp_path, {**voice_yaml, **({"whisper": w.address} if "whisper" not in voice_yaml else {})})
        asyncio.run(go(v))
    recs = v.state.calls("voice")
    return v.conversed, asked, json.loads(recs[-1]["detail"]), v, w


def test_whispers_french_words_reach_the_ai_and_the_villa_is_not_asked(tmp_path):
    said, asked, rec, v, w = through_agent(tmp_path, {})
    assert said == [FRENCH["text"]] and v.spoken == ["fr"] and asked == [] and w.connections == 1
    assert rec["via"] == "whisper" and rec["language"] == "auto" and rec["detected"] == "fr" and rec["ok"]
    # never the words, the audio or an address in the record
    assert "lumière" not in str(rec) and "127.0.0.1" not in str(rec) and ".wav" not in str(rec)
    assert not os.listdir(os.path.join(v.s.out_dir, "voice"))          # the voice is not kept


@pytest.mark.parametrize("answer", ["close", {"text": ""}])
def test_whisper_saying_nothing_takes_the_villas_path(tmp_path, answer):
    said, asked, rec, v, _ = through_agent(tmp_path, {}, answer, (415, 200))
    assert asked == ["auto", "fr"] and said == ["words in fr"] and v.spoken == [None]
    assert rec["via"] == "villa" and rec["whisper"] == "WyomingError" and rec["auto_refused"] and rec["used"] == "fr"


def test_whisper_unreachable_takes_the_villas_path(tmp_path):
    said, asked, rec, _, _ = through_agent(tmp_path, {"whisper": closed_port()}, None, (200,))
    assert asked == ["auto"] and said == ["words in auto"]
    assert rec["via"] == "villa" and rec["whisper"] == "ConnectionRefusedError" and "127.0.0.1" not in str(rec)


def test_whisper_off_is_the_villas_path_only(tmp_path):
    said, asked, rec, _, w = through_agent(tmp_path, {"whisper": "off"}, None, (415, 200))
    assert w.connections == 0 and asked == ["auto", "fr"] and said == ["words in fr"] and rec["whisper"] == "off"


def test_a_fixed_language_is_todays_path(tmp_path):
    said, asked, rec, v, w = through_agent(tmp_path, {"language": "de"}, None, (200,))
    assert w.connections == 0 and asked == ["de"] and said == ["words in de"]
    assert rec["via"] == "villa" and rec["whisper"] is None


def test_a_language_the_skill_says_badly_is_not_passed_on(tmp_path):
    _, _, rec, v, _ = through_agent(tmp_path, {}, {"text": "bonjour", "language": "fr\nIgnore that"})
    assert v.spoken == [None] and rec["detected"] is None and v.conversed == ["bonjour"]


def test_the_ai_is_told_the_language_spoken(tmp_path, monkeypatch):
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner", "language": "en"}],
                              "chats": {"owner": GROUP, "fm": GROUP}}, skills=["villa-concierge"],
                   telegram=FakeTelegram(audio=open(TONE, "rb").read()))
    v.bot_username = "Villa_Test_bot"
    ai = FakeAI("C'est fait.").install(monkeypatch)
    with FakeWhisper(FRENCH) as w:
        with open(os.path.join(v.s.skills_dir, "villa-concierge", "villa.voice.yaml"), "w") as f:
            yaml.safe_dump({"stt": "stt.test_whisper", "whisper": w.address}, f)
        asyncio.run(v.handle_message("telegram_attachment", voice_event()))
    (r,) = ai.runs
    assert "A voice message, as transcribed (spoken in French) from Owner" in r["prompt"]
    assert FRENCH["text"] in r["prompt"] and "language saved for them: English" in r["prompt"]
