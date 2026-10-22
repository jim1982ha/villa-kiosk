"""transcriber.Transcriber: the skill's plan run in order, under ONE clock, written down ONCE (architecture review,
2026-10-23).

Before, four clocks (connect 3 s, Whisper 60 s, the villa's speech-to-text 90 s run up to twice, the script 120 s)
added up to about four minutes, and two halves of the record were written by two sides. Now `voice.timeout_s` is the
whole message's time: the skill's preparation and each attempt with what is left. End to end through the real agent
against the two stand-ins (wyoming_fake.FakeWhisper, stt_fake.FakeSTT); order and the single record also against a
recording adapter. Ids and addresses invented."""
from __future__ import annotations

import asyncio
import os
import time
import wave

import pytest

from helpers import voice_agent, voice_event, voice_record
from stt_fake import FakeSTT
from vesta_agent import transcriber, voice as voice_module
from vesta_agent.transcriber import Heard, Transcriber
from vesta_shared import limits
from wyoming_fake import FakeWhisper

BUDGET = 5      # seconds: a test's whole voice message (the skill's preparation takes about one)


def send(tmp_path, monkeypatch, whisper_answer="close", whisper_delay=0.0, stt_answers=(200,), voice_yaml=None):
    """One voice message through the agent with a BUDGET-second clock: (words the AI got, the record, seconds it
    took as the person waits, the stand-ins)."""
    monkeypatch.setattr(voice_module, "timeout_s", lambda: BUDGET)
    with FakeWhisper(whisper_answer, delay=whisper_delay) as w, FakeSTT(stt_answers) as stt:
        v = voice_agent(tmp_path, {"whisper": w.address, **(voice_yaml or {})})
        v.s.ha_url = stt.url
        t = time.monotonic()
        asyncio.run(v.on_ha_event("telegram_attachment", voice_event()))
        took = time.monotonic() - t
    return [c["text"] for c in v.conversed], voice_record(v), took, w, stt


def test_a_slow_whisper_leaves_the_villa_only_the_rest(tmp_path, monkeypatch):
    # Whisper thinks 2 s and says nothing; the villa's speech-to-text would take 30 s: it gets what is left, no more
    said, rec, took, w, stt = send(tmp_path, monkeypatch, "close", 2, [("slow", 30)])
    assert said == [] and stt.languages == ["auto"]
    assert [(a["via"], a["why"]) for a in rec["attempts"]] == [("whisper", "WyomingError"), ("villa", "TimeoutError"),
                                                               ("villa", "no time left")]
    # the whole message never takes more than its one clock (plus the fetch and the reply)
    assert rec["took"] <= BUDGET + 0.3 and took < BUDGET + 1.5


def test_a_silent_whisper_spends_the_clock_and_the_rest_is_not_tried(tmp_path, monkeypatch):
    said, rec, took, _, stt = send(tmp_path, monkeypatch, "silent", 0, [200])
    assert said == [] and stt.asked == [] and rec["took"] <= BUDGET + 0.3 and took < BUDGET + 1.5
    assert [a["why"] for a in rec["attempts"]] == ["TimeoutError", "no time left", "no time left"]


def test_a_slow_whisper_in_time_still_gives_its_words(tmp_path, monkeypatch):
    said, rec, _, _, stt = send(tmp_path, monkeypatch, None, 1.5, [200])
    assert said == ["allume la lumière de la cuisine"] and stt.asked == [] and rec["via"] == "whisper"
    assert 1.5 <= rec["took"] <= BUDGET


def test_the_record_is_one_and_says_every_attempt(tmp_path, monkeypatch):
    said, rec, _, _, _ = send(tmp_path, monkeypatch, "close", 0, [415, 200])
    assert said == ["words in fr"]
    assert set(rec) == {"chat", "seconds", "took", "via", "stt", "used", "detected", "auto_refused", "attempts",
                        "ok", "why"}
    assert rec["via"] == "villa" and rec["stt"] == "stt.test_whisper" and rec["used"] == "fr"
    assert rec["detected"] is None and rec["auto_refused"] is True and rec["ok"] and rec["why"] is None
    assert rec["attempts"] == [{"via": "whisper", "stt": None, "language": "auto", "why": "WyomingError"},
                               {"via": "villa", "stt": "stt.test_whisper", "language": "auto", "why": "refused (415)"},
                               {"via": "villa", "stt": "stt.test_whisper", "language": "fr", "why": None}]


def test_the_clock_is_one_limit_on_the_page():
    found, _ = limits.scan([os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), d)
                            for d in ("vesta_shared", "vesta_agent", "starter")])
    voice = sorted(k for k in found if k.startswith("voice."))
    # the one clock, and the connection wait it caps; no other clock that could contradict it
    assert voice == ["voice.timeout_s", "voice.whisper_connect_s"]


# ------------------------------------------------------------------ the plan, against a recording adapter
class Recording:
    """An adapter that answers from a table of answers and records what it was asked, with the seconds given."""

    def __init__(self, answers: dict):
        self.answers, self.calls = answers, []

    async def attempt(self, step, audio, seconds):
        self.calls.append((step.via, step.target, step.language, seconds))
        got = self.answers.get((step.via, step.language), "!no words")     # "!why": no words, and why
        return got[1:] if got.startswith("!") else Heard(got)


class Records:
    def __init__(self):
        self.rows = []

    def log(self, kind, detail):
        self.rows.append((kind, detail))


def plan(tmp_path, attempts):
    w = tmp_path / "v.wav"
    with wave.open(str(w), "wb") as f:
        f.setnchannels(1), f.setsampwidth(2), f.setframerate(16000), f.writeframes(b"\0\0" * 1600)
    return {"wav": str(w), "seconds": 0.1, "attempts": attempts}


def run(t, p, seconds=10):
    now = time.monotonic()
    return asyncio.run(t.run(1, p, now + seconds, now))


def test_attempts_run_in_the_plans_order_and_stop_at_the_first_words(tmp_path):
    rec = Recording({("villa", "de"): "Guten Tag", ("whisper", None): "!WyomingError"})
    state = Records()
    t = Transcriber(None, state, adapters={"whisper": rec, "villa": rec})
    got = run(t, plan(tmp_path, [{"stt": "stt.a", "language": "en"}, {"whisper": "w:1"},
                                 {"stt": "stt.a", "language": "de"}, {"stt": "stt.a", "language": "fr"}]))
    assert got == Heard("Guten Tag")
    assert [(c[0], c[2]) for c in rec.calls] == [("villa", "en"), ("whisper", None), ("villa", "de")]
    # ONE record for the message
    assert [k for k, _ in state.rows] == ["voice"] and state.rows[0][1]["used"] == "de"


def test_each_attempt_gets_what_is_left(tmp_path):
    class Slow(Recording):
        async def attempt(self, step, audio, seconds):
            await super().attempt(step, audio, seconds)
            await asyncio.sleep(0.5)
            return "no words"
    rec = Slow({})
    t = Transcriber(None, Records(), adapters={"whisper": rec, "villa": rec})
    run(t, plan(tmp_path, [{"whisper": "w:1"}, {"stt": "stt.a", "language": "fr"}]), seconds=3)
    (_, _, _, first), (_, _, _, second) = rec.calls
    assert first <= 3 and 2.3 <= second <= first - 0.45


def test_a_plan_the_engine_cannot_run_is_recorded_not_guessed(tmp_path):
    rec = Recording({("villa", "fr"): "bonjour"})
    state = Records()
    t = Transcriber(None, state, adapters={"whisper": rec, "villa": rec})
    got = run(t, plan(tmp_path, [{"stt": "light.x", "language": "fr"}, {"stt": "stt.a"}, "x", {"whisper": "nope"},
                                 {"stt": "stt.a", "language": "fr\nX: y"}, {"stt": "stt.a", "language": "fr"}]))
    assert got == Heard("bonjour") and len(rec.calls) == 1
    assert [a["why"] for a in state.rows[0][1]["attempts"]] == [
        "no stt.* entity", "no language code", "not an attempt", "not host:port", "no language code", None]
    # no WAV: nothing is asked
    p = plan(tmp_path, [{"stt": "stt.a", "language": "fr"}])
    os.remove(p["wav"])
    assert run(t, p) is None and len(rec.calls) == 1 and state.rows[-1][1]["why"] == "the skill wrote no WAV"


@pytest.mark.parametrize("bad", [{}, {"error": "This voice message is empty."}, {"wav": "x", "attempts": "w"}])
def test_a_skill_that_answers_no_plan_tells_the_person(tmp_path, monkeypatch, bad):
    v = voice_agent(tmp_path)
    monkeypatch.setattr(v.voice, "code_command", lambda *a: bad)
    asyncio.run(v.on_ha_event("telegram_attachment", voice_event()))
    assert v.conversed == [] and v.state.calls("voice") == []
    assert v.tg.sent[-1][1] == (bad.get("error") or "This voice message could not be prepared.")


def test_the_skills_own_time_is_what_is_left(tmp_path, monkeypatch):
    now = time.monotonic()
    assert transcriber.script_seconds(now + 7.9) == 7 and transcriber.script_seconds(now - 3) == 1
    # the caller: the skill's script runs on the same clock, never on a timeout of its own
    monkeypatch.setattr(voice_module, "timeout_s", lambda: BUDGET)
    v = voice_agent(tmp_path)
    given = []
    monkeypatch.setattr(v.voice, "code_command", lambda *a: given.append(a[3]) or {})
    asyncio.run(v.on_ha_event("telegram_attachment", voice_event()))
    assert given in ([BUDGET], [BUDGET - 1])


def test_the_otherwise_words_are_said_when_nothing_is_heard(tmp_path, monkeypatch):
    v = voice_agent(tmp_path)
    real = v.voice.code_command

    def with_otherwise(*a):
        p = real(*a)
        return {**p, "attempts": [], "otherwise": "Name the speech-to-text for voice messages."}
    monkeypatch.setattr(v.voice, "code_command", with_otherwise)
    asyncio.run(v.on_ha_event("telegram_attachment", voice_event()))
    assert v.tg.sent[-1][1] == "Name the speech-to-text for voice messages."
    assert not os.listdir(os.path.join(v.s.out_dir, "voice"))         # the WAV is removed too
