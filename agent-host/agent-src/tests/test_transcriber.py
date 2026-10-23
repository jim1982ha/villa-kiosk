"""transcriber.Transcriber: the skill's plan run in order, under ONE clock, written down ONCE (architecture review,
2026-10-23).

Before, four clocks (connect 3 s, Whisper 60 s, the villa's speech-to-text 90 s run up to twice, the script 120 s)
added up to about four minutes, and two halves of the record were written by two sides. Now `voice.timeout_s` is the
whole message's time: the skill's preparation and each attempt with what is left. End to end through the real agent
against the two stand-ins (wyoming_fake.FakeWhisper, stt_fake.FakeSTT); order and the single record also against a
recording adapter. Ids and addresses invented."""
from __future__ import annotations

import asyncio
import json
import os
import time
import wave

import pytest

from helpers import voice_agent, voice_event, voice_record
from stt_fake import FakeSTT
from vesta_agent import transcriber, voice as voice_module
from vesta_agent.transcriber import Heard, Missed, Transcriber, Unheard
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
        return Missed(transcriber.FAILED, got[1:]) if got.startswith("!") else Heard(got)


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
            return Missed(transcriber.FAILED, "no words")
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
    assert run(t, p) == Unheard(transcriber.DOWN) and len(rec.calls) == 1 and state.rows[-1][1]["why"] == "the skill wrote no WAV"


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

    def with_otherwise(*a):                         # a skill edited before `down`: its `otherwise` is said
        p = {k: v for k, v in real(*a).items() if k != "down"}
        return {**p, "attempts": [], "otherwise": "Name the speech-to-text for voice messages."}
    monkeypatch.setattr(v.voice, "code_command", with_otherwise)
    asyncio.run(v.on_ha_event("telegram_attachment", voice_event()))
    assert v.tg.sent[-1][1] == "Name the speech-to-text for voice messages."
    assert not os.listdir(os.path.join(v.s.out_dir, "voice"))         # the WAV is removed too


# ------------------------------------------------------------------ "the villa's only speech-to-text", found late
class Villa:
    """The villa's system as the engine's reader reaches it (the real McpClient over a stand-in session): its device
    list is these ids, or the read fails (`ids` None). `asked`: how many times the list was read."""

    def __init__(self, ids):
        self.ids, self.asked = ids, 0

    def call_raw(self, name, args):
        assert name == "ha_get_overview"
        self.asked += 1
        if self.ids is None:
            return {"isError": True, "content": [{"type": "text", "text": "timeout"}]}
        body = {"domain_stats": {d: {"entities": [{"entity_id": e} for e in self.ids if e.startswith(d + ".")]}
                                 for d in {e.split(".")[0] for e in self.ids}}}
        return {"content": [{"type": "text", "text": json.dumps(body)}]}


def unnamed(tmp_path, monkeypatch, ids, whisper_answer, stt_answers=(200,)):
    """One voice message, villa.voice.yaml naming NO speech-to-text (as shipped), Whisper first: (words the AI got,
    the record, the agent, the villa, the speech-to-text stand-in)."""
    from vesta_shared.ha_client import McpClient
    monkeypatch.setattr(voice_module, "timeout_s", lambda: BUDGET)
    villa = Villa(ids)
    with FakeWhisper(whisper_answer) as w, FakeSTT(stt_answers) as stt:
        v = voice_agent(tmp_path, {"whisper": w.address}, stt=None, reader=McpClient(session=villa))
        v.s.ha_url = stt.url
        asyncio.run(v.on_ha_event("telegram_attachment", voice_event()))
    return [c["text"] for c in v.conversed], voice_record(v), v, villa, stt


def test_whisper_answers_although_the_villas_device_list_cannot_be_read(tmp_path, monkeypatch):
    """Review, 2026-10-23: the skill read the villa's device list BEFORE Whisper was tried; that read failing ended
    the message ("This voice message could not be prepared."), Whisper never asked."""
    said, rec, v, villa, stt = unnamed(tmp_path, monkeypatch, None, None)
    assert said == ["allume la lumière de la cuisine"] and rec["via"] == "whisper"
    assert villa.asked == 0 and stt.asked == []         # Whisper gave words: the villa's system is not asked anything


def test_whisper_silent_and_the_villa_has_one_speech_to_text_it_is_used(tmp_path, monkeypatch):
    said, rec, v, villa, stt = unnamed(tmp_path, monkeypatch, ["light.x", "stt.only_one"], "close", (415, 200))
    assert said == ["words in fr"] and stt.asked == [("stt.only_one", "auto"), ("stt.only_one", "fr")]
    assert villa.asked == 1                             # looked up once for the message, kept for its next attempt
    assert rec["via"] == "villa" and rec["stt"] == "stt.only_one" and rec["used"] == "fr"
    assert [(a["stt"], a["why"]) for a in rec["attempts"]] == [
        (None, "WyomingError"), ("stt.only_one", "refused (415)"), ("stt.only_one", None)]


@pytest.mark.parametrize("ids, says, why", [
    (None, "Voice messages can't be written out right now", "the villa's devices not listed (HAError)"),
    ([], "Voice messages need a speech-to-text service in the villa's system", "no speech-to-text in the villa's system"),
    (["stt.a", "stt.b"], "The villa's system has several speech-to-text services", "2 speech-to-text services, none named")])
def test_whisper_silent_and_no_one_speech_to_text_the_person_is_told_why(tmp_path, monkeypatch, ids, says, why):
    said, rec, v, villa, stt = unnamed(tmp_path, monkeypatch, ids, "close")
    assert said == [] and stt.asked == [] and villa.asked == 1 and v.tg.sent[-1][1].startswith(says)
    assert [a["why"] for a in rec["attempts"]] == ["WyomingError", why, why] and rec["why"] == why


# ------------------------------------------------------------------ heard nothing is not "set up a speech-to-text"
SETUP = ("The villa's system has several speech-to-text services", "Voice messages need a speech-to-text service")


@pytest.mark.parametrize("ids", [["stt.a", "stt.b"], []])
def test_a_note_whisper_heard_with_no_words_is_not_told_to_set_up_a_speech_to_text(tmp_path, monkeypatch, ids):
    """Review, 2026-10-23: every failure of Whisper was its exception's name, and the person's sentence followed the
    villa's lookup alone: a silent note Whisper HEARD, in a villa with two (or no) speech-to-text services, told the
    person to name one in villa.voice.yaml. Whisper answered: the person could not be made out, nothing to set up."""
    said, rec, v, villa, stt = unnamed(tmp_path, monkeypatch, ids, {"text": ""})
    assert said == [] and stt.asked == [] and v.tg.sent[-1][1] == transcriber.UNHEARD
    assert not v.tg.sent[-1][1].startswith(SETUP)
    # the record still says why each attempt gave no words, its shape unchanged
    assert [a["why"] for a in rec["attempts"]][0] == "no words" and set(rec["attempts"][0]) == {
        "via", "stt", "language", "why"}


def test_whisper_out_of_reach_and_no_speech_to_text_the_person_is_still_told_to_set_one_up(tmp_path, monkeypatch):
    from vesta_shared.ha_client import McpClient
    monkeypatch.setattr(voice_module, "timeout_s", lambda: BUDGET)
    villa = Villa([])
    v = voice_agent(tmp_path, {"whisper": "127.0.0.1:9"}, stt=None, reader=McpClient(session=villa))
    asyncio.run(v.on_ha_event("telegram_attachment", voice_event()))
    rec = voice_record(v)
    assert v.tg.sent[-1][1].startswith(SETUP[1]) and rec["attempts"][0]["why"] == "ConnectionRefusedError"


def test_a_transcriber_that_heard_nothing_anywhere_in_the_plan_decides_the_words(tmp_path):
    """The kind, not a string: Whisper unreachable, then a named speech-to-text that answered with no words, then the
    villa's only one not found: the person reads "could not make out" (or the plan's otherwise)."""
    class Answers:
        def __init__(self, got):
            self.got = got

        async def attempt(self, step, audio, seconds):
            return self.got

        async def only(self, seconds):
            return transcriber.Unfound("several", "2 speech-to-text services, none named")
    p = {**plan(tmp_path, [{"whisper": "w:1"}, {"stt": "stt.a", "language": "fr"}, {"stt": None, "language": "fr"}]),
         "no_stt": {"several": "set one up"}}
    for villa_says, person in ((Missed(transcriber.NOTHING, "no words (success)"), transcriber.UNHEARD),
                               (Missed(transcriber.FAILED, "answered 500"), "set one up")):
        t = Transcriber(None, Records(), adapters={"whisper": Answers(Missed(transcriber.FAILED, "OSError")),
                                                   "villa": Answers(villa_says)})
        assert run(t, p) == Unheard(person)
        assert run(t, {**p, "otherwise": "say it again"}) == Unheard("say it again" if villa_says.kind ==
                                                                     transcriber.NOTHING else "set one up")


class Says:
    """An adapter answering one Missed (or Heard) every time; `only`: the villa's only speech-to-text, as found."""

    def __init__(self, got, only=None):
        self.got, self.found = got, only

    async def attempt(self, step, audio, seconds):
        return self.got

    async def only(self, seconds):
        return self.found


def test_a_service_down_is_told_to_write_never_to_try_again(tmp_path):
    """Review, 2026-10-23: Whisper out of reach and the villa's speech-to-text answering 500 — every voice note was
    told "I could not make out this voice message. Try again": the person tried again, and again. Every way failed or
    refused: the plan's `down` (the skill's words), the engine's DOWN when the plan has none."""
    p = plan(tmp_path, [{"whisper": "w:1"}, {"stt": "stt.a", "language": "auto"}, {"stt": "stt.a", "language": "fr"}])
    failed, refused = Missed(transcriber.FAILED, "answered 500"), Missed(transcriber.REFUSED, "refused (415)")
    for villa in (failed, refused):
        t = Transcriber(None, Records(), adapters={"whisper": Says(Missed(transcriber.FAILED, "ConnectionRefusedError")),
                                                   "villa": Says(villa)})
        assert run(t, p) == Unheard(transcriber.DOWN)
        assert run(t, {**p, "down": "the skill's words", "otherwise": "older words"}) == Unheard("the skill's words")
    assert "try again" not in transcriber.DOWN.lower()


def test_the_words_follow_every_attempts_kind(tmp_path):
    """Any transcriber that heard nothing: "could not make out"; else the villa's only one not found: the setup words;
    else (failed, refused, or found with no words for it): the service is down."""
    p = {**plan(tmp_path, [{"whisper": "w:1"}, {"stt": None, "language": "fr"}]),
         "no_stt": {"none": "set one up", "several": "name one"}, "down": "write it"}
    nothing, failed = Missed(transcriber.NOTHING, "no words"), Missed(transcriber.FAILED, "OSError")
    unfound = transcriber.Unfound("none", "no speech-to-text in the villa's system")
    for whisper, only, person in ((nothing, unfound, transcriber.UNHEARD),          # heard nothing beats the setup
                                  (failed, unfound, "set one up"),                   # review F: the setup words
                                  (failed, transcriber.Unfound("several", "2"), "name one"),
                                  (failed, transcriber.Unfound("failed", "not listed (HAError)"), "write it"),
                                  (failed, "stt.a", "write it")):                    # found, and it failed too
        t = Transcriber(None, Records(), adapters={"whisper": Says(whisper), "villa": Says(failed, only)})
        assert run(t, p) == Unheard(person), (whisper, only)


def test_whisper_out_of_reach_and_the_villas_speech_to_text_broken_the_person_reads_the_skills_words(tmp_path,
                                                                                                     monkeypatch):
    """End to end through the real agent and the skill's real plan: Whisper closes the connection, the villa's
    speech-to-text answers 500 every time. Skills before code: the words are the skill's plan's (`down`)."""
    monkeypatch.setattr(voice_module, "timeout_s", lambda: BUDGET)
    with FakeWhisper("close") as w, FakeSTT([500]) as stt:
        v = voice_agent(tmp_path, {"whisper": w.address})
        v.s.ha_url = stt.url
        asyncio.run(v.on_ha_event("telegram_attachment", voice_event()))
    assert v.conversed == []
    assert v.tg.sent[-1][1] == "Voice messages can't be written out right now. Please write it."
    assert all(a["why"] for a in voice_record(v)["attempts"])


def test_the_villas_speech_to_text_answering_no_words_is_heard_nothing(tmp_path):
    """POST /api/stt answering success with an empty text: its speech-to-text heard the message; an error result is a
    failure (the record keeps both whys as before)."""
    import types
    from vesta_agent.transcriber import Audio, Step, VillaSpeech
    w = plan(tmp_path, [])["wav"]
    for body, kind, why in (({"result": "success", "text": " "}, transcriber.NOTHING, "no words (success)"),
                            ({"result": "error"}, transcriber.FAILED, "no words (error)")):
        with FakeSTT([("json", body)]) as stt:
            s = types.SimpleNamespace(ha_url=stt.url, ha_token="t")
            got = asyncio.run(VillaSpeech(s).attempt(Step("villa", "stt.a", "fr"), Audio.read(w), 5))
        assert got == Missed(kind, why)


def test_a_fresh_read_of_the_villas_devices_sees_one_added_since(monkeypatch):
    """The real client: the agent's reader keeps its device list for the app's life; the voice path asks it with
    fresh=True (villa_entity_ids) so a speech-to-text added since the agent started is found."""
    from vesta_shared.ha_client import McpClient
    villa = Villa(["light.x"])
    reader = McpClient(session=villa)
    assert reader.all_entity_ids() == ["light.x"]
    villa.ids = ["light.x", "stt.added"]
    assert reader.all_entity_ids() == ["light.x"]                      # kept, not read again
    assert transcriber.villa_entity_ids(reader) == ["light.x", "stt.added"] and villa.asked == 2
