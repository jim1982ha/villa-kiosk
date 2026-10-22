"""A voice message through the villa's speech-to-text: "auto" first, the person's saved language after, and a
refusal remembered.

Owner, 2026-10-22 ("build whichever works"): the plan asks the speech-to-text to find the language spoken; a
speech-to-text that does not take "auto" makes Home Assistant answer 415 (or 400), and the next attempt is the
person's saved language. Measured on the villa: it ALWAYS refuses "auto". So once refused, "auto" is not asked again
while the app runs (transcriber.Transcriber.refused): the next voice message goes straight to the saved language.
The villa's speech-to-text is tests/stt_fake.py; Whisper is off here (test_voice_whisper.py). Ids invented."""
from __future__ import annotations

import asyncio

from helpers import voice_agent, voice_event, voice_record
from stt_fake import FakeSTT
from vesta_agent.transcriber import LANGUAGE


def transcribe_with(tmp_path, answers, voice_yaml=None, times: int = 1):
    """`times` voice messages through ONE agent against a speech-to-text that answers `answers` in turn.
    Returns (languages asked, words the AI got, the last voice record, the agent)."""
    v = voice_agent(tmp_path, voice_yaml)
    with FakeSTT(answers) as stt:
        v.s.ha_url = stt.url
        for _ in range(times):
            asyncio.run(v.on_ha_event("telegram_attachment", voice_event()))
    return stt.languages, [t["text"] for t in v.conversed], voice_record(v), v


def test_auto_accepted_is_one_request(tmp_path):
    asked, said, rec, _ = transcribe_with(tmp_path, [200])
    assert asked == ["auto"] and said == ["words in auto"]
    assert rec["used"] == "auto" and rec["auto_refused"] is False and rec["ok"] and rec["stt"] == "stt.test_whisper"


def test_auto_refused_is_asked_again_in_the_persons_language(tmp_path):
    asked, said, rec, _ = transcribe_with(tmp_path, [415, 200])
    assert asked == ["auto", "fr"] and said == ["words in fr"]
    assert rec["used"] == "fr" and rec["auto_refused"] is True and rec["ok"]
    # never the words, the audio or the token in the record
    assert "words" not in str(rec) and "token" not in str(rec).lower() and ".wav" not in str(rec)


def test_a_refused_auto_is_not_asked_again_while_the_app_runs(tmp_path):
    asked, said, rec, _ = transcribe_with(tmp_path, [415, 200], times=2)
    # the second message goes straight to the saved language
    assert asked == ["auto", "fr", "fr"] and said == ["words in fr", "words in fr"]
    assert [(a["language"], a["why"]) for a in rec["attempts"]] == [("auto", "refused before"), ("fr", None)]
    assert rec["auto_refused"] is True
    # another run of the app asks again (the villa may have changed its speech-to-text meanwhile)
    asked, _, _, _ = transcribe_with(tmp_path / "next run", [415, 200])
    assert asked == ["auto", "fr"]


def test_a_bad_request_is_a_refusal_too(tmp_path):
    asked, said, _, _ = transcribe_with(tmp_path, [400, 200], times=2)
    assert asked == ["auto", "fr", "fr"] and said == ["words in fr", "words in fr"]


def test_any_other_failure_goes_on_to_the_next_attempt_and_is_not_remembered(tmp_path):
    asked, said, rec, _ = transcribe_with(tmp_path, [500, 200, 200], times=2)
    assert asked == ["auto", "fr", "auto"] and said == ["words in fr", "words in auto"]
    assert rec["auto_refused"] is False


def test_no_words_at_all_tells_the_person(tmp_path):
    asked, said, rec, v = transcribe_with(tmp_path, [500])
    assert asked == ["auto", "fr"] and said == [] and not rec["ok"] and rec["why"] == "answered 500"
    assert "could not make out this voice message" in v.tg.sent[-1][1]


def test_a_villa_fixed_language_is_never_auto(tmp_path):
    asked, said, rec, _ = transcribe_with(tmp_path, [415, 200], {"language": "de", "whisper": "127.0.0.1:9"})
    assert asked == ["de"] and said == [] and rec["attempts"][0]["language"] == "de" and rec["auto_refused"] is False


def test_auto_named_by_the_villa_falls_back_too(tmp_path):
    asked, said, _, _ = transcribe_with(tmp_path, [415, 200], {"language": "auto"})
    assert asked == ["auto", "fr"] and said == ["words in fr"]


def test_the_shape_check_takes_auto_and_still_refuses_junk():
    assert LANGUAGE.match("auto") and LANGUAGE.match("fr") and LANGUAGE.match("pt-BR")
    for junk in ("", "automatic", "auto; x=1", "fr\r\nX: y", "a", "auto-fr", "../x"):
        assert not LANGUAGE.match(junk), junk
