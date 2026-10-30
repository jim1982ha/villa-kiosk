"""VESTA answers aloud (ticket 24 of "One inbox", owner 2026-10-28: "use piper path only first"): the answer to a question
spoken on the tablet is spoken by the villa's own voice — the text-to-speech its voice settings name, asked by the
engine, its sound kept by the Kiosk and named on the answer's turn, which the tablet plays. With no text-to-speech in
those settings, the answer is text only and says spoken answers need the villa's voice. A typed question is never
answered aloud. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import os

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


def _agent(tmp_path, pipeline, voice_yaml=None):
    kiosk = FakeKiosk()
    return voice_agent(tmp_path, kiosk=kiosk, converse=True, reader=FakeHA(pipeline=pipeline),
                       voice_yaml=voice_yaml), kiosk


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


# ── In the answer's own language (owner, 2026-10-29: a French answer read by the English voice) ─────────────────────
FRENCH = "J'ai compris votre question, mais je ne trouve pas cet appareil dans la maison."


def test_an_answer_in_another_language_is_said_by_the_voice_named_for_it(tmp_path, monkeypatch):
    # the villa-concierge skill tells the language from the words and names the voice villa.voice.yaml gives it
    v, kiosk = _agent(tmp_path, {**VOICE_SET, "tts_language": "en_US", "tts_voice": "en_US-test-medium"},
                      voice_yaml={"voices": {"fr": "fr_FR-test-medium"}})
    villa = _answered(v, kiosk, monkeypatch, answer=FRENCH)
    assert [(b["language"], b["options"].get("voice")) for b in villa.spoken] == [("fr_FR", "fr_FR-test-medium")]
    assert "speech" in kiosk.conversation("owner")[-1]


def test_an_answer_in_a_language_with_no_voice_is_never_read_by_another_one(tmp_path, monkeypatch):
    v, kiosk = _agent(tmp_path, {**VOICE_SET, "tts_language": "en_US"})
    villa = _answered(v, kiosk, monkeypatch, answer=FRENCH)
    turn = kiosk.conversation("owner")[-1]
    assert villa.spoken == [] and "speech" not in turn
    assert turn["text"].startswith(FRENCH) and "could not be spoken in French" in turn["text"]


def test_a_piper_villa_with_no_voices_listed_says_each_language_in_piper_s_own(tmp_path, monkeypatch):
    # owner, 2026-10-30: "make sure this is delivered with the baseline skills": no villa.voice.yaml, a Piper voice in
    # the settings, and a French answer is still said in French (the skill's PIPER_VOICES)
    v, kiosk = _agent(tmp_path, {**VOICE_SET, "tts_language": "en_US", "tts_voice": "en_US-lessac-medium"})
    villa = _answered(v, kiosk, monkeypatch, answer=FRENCH)
    assert [(b["language"], b["options"].get("voice")) for b in villa.spoken] == [("fr_FR", "fr_FR-siwis-medium")]


def test_the_villa_s_own_voice_for_a_language_wins_over_piper_s(tmp_path, monkeypatch):
    v, kiosk = _agent(tmp_path, {**VOICE_SET, "tts_language": "en_US", "tts_voice": "en_US-lessac-medium"},
                      voice_yaml={"voices": {"fr": "fr_FR-tom-medium"}})
    villa = _answered(v, kiosk, monkeypatch, answer=FRENCH)
    assert [b["options"].get("voice") for b in villa.spoken] == ["fr_FR-tom-medium"]


def test_an_answer_in_the_voice_settings_own_language_keeps_their_voice(tmp_path, monkeypatch):
    v, kiosk = _agent(tmp_path, {**VOICE_SET, "tts_language": "en_US", "tts_voice": "en_US-test-medium"},
                      voice_yaml={"voices": {"fr": "fr_FR-test-medium"}})
    villa = _answered(v, kiosk, monkeypatch, answer="The pool pump is on and the lights are off.")
    assert [(b["language"], b["options"].get("voice")) for b in villa.spoken] == [("en_US", "en_US-test-medium")]


def test_every_language_of_the_page_is_told_from_its_words_or_its_letters():
    # owner, 2026-10-29: every language a person may be given on the VESTA Agent page prepared
    import importlib.util
    from pathlib import Path
    from vesta_agent.policy import LANGUAGES
    spec = importlib.util.spec_from_file_location(
        "concierge_voice", Path(__file__).parents[1] / "starter/skills/villa-concierge/scripts/voice.py")
    voice = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(voice)
    said = {"en": "The pool pump is on and the lights are off.",
            "fr": FRENCH,
            "id": "Pompa kolam sudah menyala dan lampu di ruang tamu tidak menyala.",
            "de": "Die Poolpumpe ist an und das Licht ist nicht an.",
            "es": "La bomba de la piscina está encendida y la luz no está encendida.",
            "it": "La pompa della piscina è accesa e la luce non è accesa.",
            "nl": "De zwembadpomp is aan en het licht in de woonkamer is niet aan.",
            "zh": "泳池水泵已开启，客厅的灯已关闭。",
            "ja": "プールのポンプはオンで、リビングの照明はオフです。",
            "ko": "수영장 펌프가 켜져 있고 거실 조명은 꺼져 있습니다."}
    assert set(said) == set(LANGUAGES)
    assert {lang: voice.language_of(text, voice.WORDS) for lang, text in said.items()} == {k: k for k in said}
    assert set(LANGUAGES) <= set(voice.NAMES)
    # a device's Latin name quoted in a Korean answer still reads as Korean
    assert voice.language_of("Pool Pump 펌프가 켜져 있습니다.", voice.WORDS) == "ko"
    # ⚠️ A SHORT ANSWER, ITS COMMON WORDS SHARED (owner, 2026-10-30: "J'ai éteint la lumière … de la salle de sport." was
    # said by the English voice: "la" and "de" are Spanish too, and a tie fell back to the settings' language)
    short = {"fr": "J'ai éteint la lumière Ceiling de la salle de sport.",
             "es": "He encendido la luz del gimnasio.",
             "it": "Ho spento la luce della palestra.",
             "en": "I have turned off the Ceiling light."}
    # and one with no common word at all: its accented letters decide
    short["fr"] = "Lumière éteinte."
    assert voice.language_of("J'ai éteint la lumière Ceiling de la salle de sport.", voice.WORDS) == "fr"
    assert voice.language_of("J'ai ouvert la porte de la cuisine.", voice.WORDS) == "fr"      # no accent: its words
    assert {lang: voice.language_of(text, voice.WORDS) for lang, text in short.items()} == {k: k for k in short}


def test_a_choice_of_voice_that_fails_is_never_the_english_voice(tmp_path, monkeypatch):
    # the skill's script stopped (its answer {}): the answer stays in words, never said by the settings' own voice
    v, kiosk = _agent(tmp_path, {**VOICE_SET, "tts_language": "en_US"})

    async def broken(text, pipeline, seconds):
        return {}
    v.aloud.speech.choose = broken
    villa = _answered(v, kiosk, monkeypatch, answer=FRENCH)
    assert villa.spoken == [] and kiosk.conversation("owner")[-1]["text"].endswith(speech.NOT_SPOKEN)


def test_one_skill_says_a_spoken_answers_voice_and_writes_out_a_voice_message(tmp_path, caplog):
    # a second skill declaring the same hook: the first by name is used, the other said in the log, never in silence
    import logging
    import shutil
    v, _ = _agent(tmp_path, VOICE_SET)
    src = os.path.join(v.s.skills_dir, "villa-concierge")
    shutil.copytree(src, os.path.join(v.s.skills_dir, "zz-other-voice"))
    with caplog.at_level(logging.WARNING, logger="vesta.skills"):
        used = [sk.name for sk, _ in v.skills.handlers("answer_aloud")]
        again = [sk.name for sk, _ in v.skills.handlers("answer_aloud")]
    assert used == again == ["villa-concierge"]
    assert sum("only villa-concierge's is used" in r.message for r in caplog.records) == 1


def test_every_spoken_answer_leaves_one_record(tmp_path, monkeypatch):
    import json
    v, kiosk = _agent(tmp_path, VOICE_SET)
    _answered(v, kiosk, monkeypatch)
    v2, kiosk2 = _agent(tmp_path / "b", {**VOICE_SET, "tts_engine": None})
    _answered(v2, kiosk2, monkeypatch)
    said = [json.loads(r["detail"]) for r in v.state.calls("aloud")]
    unsaid = [json.loads(r["detail"]) for r in v2.state.calls("aloud")]
    assert [(r["spoken"], r["bytes"]) for r in said] == [(True, len(SOUND))]
    assert [(r["spoken"], r["why"]) for r in unsaid] == [(False, "no text-to-speech in the villa's voice settings")]


def test_one_clock_for_the_whole_spoken_answer(tmp_path, monkeypatch):
    # the skill's choice took the whole limit: the sound is not asked for after it (it had a fresh limit of its own)
    v, kiosk = _agent(tmp_path, VOICE_SET)
    monkeypatch.setattr(speech, "speak_s", lambda: 1)

    async def slow(text, pipeline, seconds):
        await asyncio.sleep(1.2)
        return {"language": "en", "voice": "test-voice"}
    v.aloud.speech.choose = slow
    villa = _answered(v, kiosk, monkeypatch)
    assert villa.spoken == [] and kiosk.conversation("owner")[-1]["text"].endswith(speech.NOT_SPOKEN)
