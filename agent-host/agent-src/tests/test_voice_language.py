"""A voice message's language: "auto" first, the person's saved language when the villa's system refuses it.

Owner, 2026-10-22 ("build whichever works"): the skill asks the speech-to-text to find the language spoken;
a speech-to-text that does not take "auto" makes Home Assistant answer 415 (or 400), and then, and only then,
the engine tries once more in the person's saved language. A real HTTP server stands in for Home Assistant's
POST /api/stt/<entity>, so the header the villa's system reads is the one checked. Ids invented."""
from __future__ import annotations

import asyncio
import functools
import os
import shutil

import yaml
from aiohttp import web
from aiohttp.test_utils import TestServer

from helpers import make_agent
from telegram_fake import FakeTelegram
from vesta_agent import speech, voice as voice_module

OWNER, GROUP = 111, -100123
ROOT = os.path.dirname(os.path.abspath(__file__))
TONE = os.path.join(ROOT, "fixtures", "voice_440hz.ogg")


def voice_event():
    return {"chat_id": OWNER, "user_id": OWNER, "from_first": "X", "file_id": "FILE-1", "file_mime_type": "audio/ogg",
            "file_size": 3856, "message_id": 7, "bot": {"username": "Villa_Test_bot"}}


def make(tmp_path, voice_yaml: dict | None = None):
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner", "language": "fr"}],
                              "chats": {"owner": GROUP, "fm": GROUP}}, skills=["villa-concierge"],
                   telegram=FakeTelegram(audio=open(TONE, "rb").read()))
    with open(os.path.join(v.s.skills_dir, "villa-concierge", "villa.voice.yaml"), "w") as f:
        yaml.safe_dump({"stt": "stt.test_whisper", **(voice_yaml or {})}, f)
    v.bot_username = "Villa_Test_bot"
    v.conversed = []

    async def converse(cid, person, text, chat_role="private", **kw):
        v.conversed.append(text)
    v.converse = converse
    return v


def language_of(header: str) -> str:
    return dict(p.strip().split("=", 1) for p in header.split(";"))["language"]


def transcribe_with(tmp_path, answers, voice_yaml=None):
    """The voice message through the agent against a stand-in speech-to-text that answers `answers` in turn
    (a status, or "slow"). Returns (languages asked, words the AI got, the voice record)."""
    v = make(tmp_path, voice_yaml)
    asked = []

    async def stt(request):
        asked.append(language_of(request.headers["X-Speech-Content"]))
        await request.read()
        answer = answers[min(len(asked), len(answers)) - 1]
        if answer == "slow":
            await asyncio.sleep(2)
            answer = 200
        if answer != 200:
            return web.Response(status=answer)
        return web.json_response({"result": "success", "text": f"words in {asked[-1]}"})

    async def go():
        app = web.Application()
        app.router.add_post("/api/stt/{entity}", stt)
        async with TestServer(app) as server:
            v.s.ha_url = str(server.make_url("")).rstrip("/")
            await v.on_ha_event("telegram_attachment", voice_event())
    asyncio.run(go())
    rec = [r for r in v.state.calls("voice")]
    import json
    return asked, v.conversed, json.loads(rec[-1]["detail"]) if rec else None


def test_auto_accepted_is_one_request(tmp_path):
    asked, said, rec = transcribe_with(tmp_path, [200])
    assert asked == ["auto"] and said == ["words in auto"]
    assert rec["language"] == "auto" and rec["used"] == "auto" and rec["auto_refused"] is False and rec["ok"]


def test_auto_refused_is_asked_again_in_the_persons_language(tmp_path):
    asked, said, rec = transcribe_with(tmp_path, [415, 200])
    assert asked == ["auto", "fr"] and said == ["words in fr"]
    assert rec["language"] == "auto" and rec["used"] == "fr" and rec["auto_refused"] is True and rec["ok"]
    # never the words, the audio or the token in the record
    assert "words" not in str(rec) and "token" not in str(rec).lower() and ".wav" not in str(rec)


def test_a_bad_request_is_a_refusal_too(tmp_path):
    asked, said, _ = transcribe_with(tmp_path, [400, 200])
    assert asked == ["auto", "fr"] and said == ["words in fr"]


def test_any_other_failure_is_not_retried(tmp_path, monkeypatch):
    asked, said, rec = transcribe_with(tmp_path, [500, 200])
    assert asked == ["auto"] and said == [] and rec["auto_refused"] is False and not rec["ok"]
    # a timeout either
    monkeypatch.setattr(voice_module, "speech_to_text", functools.partial(speech.speech_to_text, timeout=1))
    asked, said, rec = transcribe_with(tmp_path / "slow", ["slow", 200])
    assert asked == ["auto"] and said == [] and rec["why"] == "TimeoutError"


def test_a_villa_fixed_language_is_never_auto(tmp_path):
    asked, said, rec = transcribe_with(tmp_path, [415, 200], {"language": "de"})
    assert asked == ["de"] and said == [] and rec["used"] == "de" and rec["auto_refused"] is False


def test_auto_named_by_the_villa_falls_back_too(tmp_path):
    asked, said, _ = transcribe_with(tmp_path, [415, 200], {"language": "auto"})
    assert asked == ["auto", "fr"] and said == ["words in fr"]


def test_the_shape_check_takes_auto_and_still_refuses_junk(tmp_path):
    wav = tmp_path / "v.wav"
    shutil.copy(TONE, wav)
    assert speech.LANGUAGE.match("auto") and speech.LANGUAGE.match("fr") and speech.LANGUAGE.match("pt-BR")
    for junk in ("", "automatic", "auto; x=1", "fr\r\nX: y", "a", "auto-fr", "../x"):
        assert not speech.LANGUAGE.match(junk), junk
        text, why = asyncio.run(speech.speech_to_text("http://127.0.0.1:9", "t", {
            "entity": "stt.x", "language": junk, "wav": str(wav)}))
        assert text is None and why == "the skill named no language code"
