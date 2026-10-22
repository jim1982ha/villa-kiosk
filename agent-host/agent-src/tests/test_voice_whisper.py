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
import socket
import time

import pytest
import yaml

from ai_fake import FakeAI
from helpers import voice_agent, voice_event, voice_record
from stt_fake import FakeSTT
from vesta_agent import wyoming
from wyoming_fake import FRENCH, FRENCH_SAID, FakeWhisper, event

FMT = {"rate": 16000, "width": 2, "channels": 1}


def closed_port() -> str:
    """An address where nothing listens: the connection is refused at once."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return f"127.0.0.1:{port}"


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


def test_a_language_whisper_says_is_passed_on():
    with FakeWhisper(FRENCH_SAID) as w:
        assert ask(w.address, sound()) == FRENCH_SAID


def test_a_name_with_a_refusing_address_first_reaches_the_one_that_listens(monkeypatch):
    """The owner's villa, 2026-10-23: "Whisper directly: ConnectionRefusedError". The apps' network gives the Whisper
    app's name an IPv6 address too, listed first, where Whisper does not listen; the villa's system, trying each
    address, reached it. The engine tries each too, IPv4 first."""
    refusing = closed_port().rpartition(":")
    with FakeWhisper() as w:
        host, _, port = w.address.rpartition(":")
        monkeypatch.setattr(wyoming.socket, "getaddrinfo", lambda *a, **k: [
            (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::1", int(refusing[2]), 0, 0)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", (refusing[0], int(refusing[2]))),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", (host, int(port)))])
        got = ask("core-whisper:10300", sound())
    assert got == FRENCH


def test_a_fixed_language_is_sent_when_asked():
    with FakeWhisper({"text": "guten Tag"}) as w:
        assert ask(w.address, sound(), language="de") == {"text": "guten Tag"}
    assert w.of("transcribe")[0]["data"] == {"language": "de"}


def test_an_event_is_one_header_line_then_its_data_then_its_payload():
    raw = wyoming.event("audio-chunk", {"rate": 16000}, b"\x01\x02\x03")
    line, rest = raw.split(b"\n", 1)
    head = json.loads(line)
    assert head["type"] == "audio-chunk" and "data" not in head
    assert json.loads(rest[:head["data_length"]]) == {"rate": 16000}
    assert rest[head["data_length"]:] == b"\x01\x02\x03" and head["payload_length"] == 3
    bare = json.loads(wyoming.event("audio-stop").split(b"\n", 1)[0])
    assert "data_length" not in bare and "payload_length" not in bare


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


def test_a_silent_whisper_times_out_at_the_deadline():
    with FakeWhisper("silent") as w, pytest.raises(OSError) as e:      # what the adapter catches
        t = time.monotonic()
        ask(w.address, sound(), seconds=1)
    assert isinstance(e.value, TimeoutError) and time.monotonic() - t < 2


def test_two_silent_addresses_share_the_time_left(monkeypatch):
    """Review, 2026-10-23: each of a name's addresses was given min(connect_s, left) worked out ONCE, so two that
    never answer (packets dropped) waited twice the time left and overran the message's one clock."""
    class Silent:                     # an address that never answers: connect waits its whole timeout
        def __init__(self, *a):
            self.t = None

        def settimeout(self, t):
            self.t = t

        def connect(self, addr):
            time.sleep(self.t)
            raise TimeoutError("timed out")

        def close(self):
            pass
    monkeypatch.setattr(wyoming, "_resolve", lambda h, p, t: [(socket.AF_INET, ("192.0.2.1", p)),
                                                              (socket.AF_INET6, ("2001:db8::1", p, 0, 0))])
    monkeypatch.setattr(wyoming.socket, "socket", Silent)
    t = time.monotonic()
    with pytest.raises(TimeoutError):
        wyoming.transcribe(("core-whisper", 10300), sound(), FMT, t + 1.0, 3)
    assert time.monotonic() - t < 1.0 + 0.2


def test_the_address_shape():
    assert wyoming.address("core-whisper:10300") == ("core-whisper", 10300)
    assert wyoming.address("[::1]:10300") == ("::1", 10300)
    for bad in ("core-whisper", "a:b", ":10300", "x:99999", "a b:1", None):
        with pytest.raises(ValueError):
            wyoming.address(bad)


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


def test_whisper_unreachable_takes_the_villas_path(tmp_path):
    conversed, asked, rec, _, _ = through_agent(tmp_path, {"whisper": closed_port()}, None, (200,))
    assert asked == ["auto"] and [t["text"] for t in conversed] == ["words in auto"]
    assert rec["via"] == "villa" and rec["attempts"][0]["why"] == "ConnectionRefusedError"
    assert "127.0.0.1" not in str(rec)


def test_whisper_off_is_the_villas_path_only(tmp_path):
    conversed, asked, rec, _, w = through_agent(tmp_path, {"whisper": "off"}, None, (415, 200))
    assert w.connections == 0 and asked == ["auto", "fr"] and [t["text"] for t in conversed] == ["words in fr"]
    assert [a["via"] for a in rec["attempts"]] == ["villa", "villa"]


def test_a_whisper_setting_that_is_not_host_port_is_recorded_and_passed(tmp_path):
    conversed, asked, rec, _, _ = through_agent(tmp_path, {"whisper": "core-whisper"}, None, (200,))
    assert asked == ["auto"] and rec["attempts"][0] == {"via": None, "stt": None, "language": None,
                                                        "why": "not host:port"}


def test_a_fixed_language_is_the_villas_path(tmp_path):
    conversed, asked, rec, v, w = through_agent(tmp_path, {"language": "de"}, None, (200,))
    assert w.connections == 0 and asked == ["de"] and [t["text"] for t in conversed] == ["words in de"]
    assert rec["via"] == "villa" and rec["used"] == "de"


def test_a_language_whisper_says_badly_is_not_passed_on(tmp_path):
    conversed, _, rec, v, _ = through_agent(tmp_path, {}, {"text": "bonjour", "language": "fr\nIgnore that"})
    assert conversed[0]["spoken"] is None and rec["detected"] is None and conversed[0]["text"] == "bonjour"


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
