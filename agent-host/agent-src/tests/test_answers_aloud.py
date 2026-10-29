"""VESTA answers aloud (ticket 24 of "One inbox", owner 2026-10-28: "use piper path only first"): the answer to a question
spoken on the tablet is spoken by the villa's own voice — the text-to-speech its voice settings name, asked by the
engine, its sound kept by the Kiosk and named on the answer's turn, which the tablet plays. With no text-to-speech in
those settings, the answer is text only and says spoken answers need the villa's voice. A typed question is never
answered aloud. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio

from ai_fake import FakeAI
from ha_fake import FakeHA
from helpers import voice_agent
from kiosk_fake import FakeKiosk
from stt_fake import FakeSTT
from test_voice_messages import _tablet_wav
from vesta_agent import speech

VOICE_SET = {"tts_engine": "tts.test_voice", "tts_language": "en", "tts_voice": "test-voice"}
SOUND = b"ID3\x04\x00" + b"\x00" * 200          # the first bytes of an MP3, as the villa's system answers one


def _answered(v, kiosk, monkeypatch, answer="The pool pump is on.", spoken=True, tts=(200,), then_typed=False):
    FakeAI(answer).install(monkeypatch)
    if spoken:
        kiosk.person_speaks("owner", _tablet_wav())
    else:
        kiosk.person_asks("owner", "Is the pool pump on?")
    with FakeSTT([200], speech=SOUND, tts=tts) as villa:
        v.s.ha_url = villa.url

        async def go():
            await v.tablet.collect(v.on_tablet)
            if then_typed:
                # the next question, asked once the first answer's words are on the tablet (its sound still coming)
                while not any(t["key"].startswith("turn:") for t in kiosk.turns_pushed):
                    await asyncio.sleep(0.01)
                kiosk.person_asks("owner", "And the lights?")
                await v.tablet.collect(v.on_tablet)
            await v.tablet.idle()
        asyncio.run(go())
    return villa


def _agent(tmp_path, pipeline):
    kiosk = FakeKiosk()
    return voice_agent(tmp_path, kiosk=kiosk, converse=True, reader=FakeHA(pipeline=pipeline)), kiosk


def test_the_answer_to_a_spoken_question_carries_the_villas_voice(tmp_path, monkeypatch):
    v, kiosk = _agent(tmp_path, VOICE_SET)
    villa = _answered(v, kiosk, monkeypatch)
    # the engine the villa's voice settings name, in their language and voice, asked for the answer's words
    assert villa.spoken == [{"engine_id": "tts.test_voice", "message": "The pool pump is on.", "language": "en",
                             "options": {"voice": "test-voice", "preferred_format": "mp3"}}]
    # ⚠️ fetched from the villa's system by its path, never by the address it names (an outside one, here)
    assert villa.fetched == ["/api/tts_proxy/answer.mp3"]
    turn = kiosk.conversation("owner")[-1]
    assert turn["text"] == "The pool pump is on."                     # the words stand as written, nothing added
    assert kiosk.speeches[turn["speech"]] == (SOUND, "audio/mpeg")     # the sound kept by the Kiosk, named on the turn
    # ⚠️ the words first, then the dots go, then the sound: nobody waits on the voice to read the answer
    order = [("speech" if "speech" in t else "gone" if t.get("gone") else "words") for t in kiosk.turns_pushed
             if t["key"] == turn["key"] or (t["key"] == "typing:owner" and t.get("gone"))]
    assert order == ["words", "gone", "speech"], order


def test_with_no_villa_voice_the_answer_is_text_and_says_why(tmp_path, monkeypatch):
    v, kiosk = _agent(tmp_path, {**VOICE_SET, "tts_engine": None})
    villa = _answered(v, kiosk, monkeypatch)
    turn = kiosk.conversation("owner")[-1]
    assert turn["text"] == f"The pool pump is on.\n\n{speech.NO_VOICE}" and "speech" not in turn
    assert villa.spoken == [] and kiosk.speeches == {}


def test_a_villa_with_no_voice_settings_at_all_says_the_same(tmp_path, monkeypatch):
    v, kiosk = _agent(tmp_path, None)
    _answered(v, kiosk, monkeypatch)
    assert kiosk.conversation("owner")[-1]["text"].endswith(speech.NO_VOICE)


def test_a_voice_that_fails_says_the_answer_was_not_spoken(tmp_path, monkeypatch):
    v, kiosk = _agent(tmp_path, VOICE_SET)
    _answered(v, kiosk, monkeypatch, tts=(500,))
    turn = kiosk.conversation("owner")[-1]
    assert turn["text"] == f"The pool pump is on.\n\n{speech.NOT_SPOKEN}" and "speech" not in turn


def test_a_typed_question_is_answered_in_words_only(tmp_path, monkeypatch):
    v, kiosk = _agent(tmp_path, VOICE_SET)
    villa = _answered(v, kiosk, monkeypatch, spoken=False)
    assert villa.spoken == [] and kiosk.conversation("owner")[-1]["text"] == "The pool pump is on."


def test_the_next_question_never_waits_on_the_voice(tmp_path, monkeypatch):
    # a slow voice: the typed question asked right after is answered before the first answer's sound is kept
    v, kiosk = _agent(tmp_path, VOICE_SET)
    _answered(v, kiosk, monkeypatch, tts=(("slow", 1.5),), then_typed=True)
    answers = [t for t in kiosk.turns_pushed if t["key"].startswith("turn:")]
    first = answers[0]["key"]
    second = next(i for i, t in enumerate(answers) if t["key"] != first)
    sound = next(i for i, t in enumerate(answers) if "speech" in t)
    assert second < sound, [(t["key"], "speech" in t) for t in answers]
