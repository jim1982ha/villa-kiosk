"""VESTA's answer spoken aloud (ticket 24 of "One inbox", owner 2026-10-28: "use piper path only first"): the answer to a
question spoken on the tablet, said by the villa's own voice — the same voice on every tablet.

⚠️ ONE ROUTE, NOTHING NAMED. The villa's voice settings (its preferred voice pipeline, read through ha-mcp's
ha_manage_pipeline `list`: read_guard.READ_ACTIONS refuses every action that writes) name the text-to-speech, its
language and its voice; the engine asks THAT one, whatever it is (Piper on the owner's villa, never written here). No
device voice (the tablet's speechSynthesis differs per tablet and may need the internet): with no text-to-speech in the
settings the answer stays words, and says why (NO_VOICE).

The sound comes from the villa's system as the villa's speech-to-text does (transcriber.VillaSpeech, the agent's token):
POST /api/tts_get_url answers where the sound is, then GET it. ⚠️ BY ITS PATH, NEVER ITS `url`: the url names the
villa's system by the address its settings give it, which may be an internet one; the path is read on the address the
agent already uses. Asked as MP3 (`preferred_format`: the villa's system converts what its engine makes): every tablet
plays it, and it is a tenth of the WAV a voice engine makes.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Awaitable, Callable, NamedTuple

import aiohttp

from vesta_shared import agreement
from vesta_shared.limits import limit

log = logging.getLogger("vesta")

#: What the answer says when the villa's voice settings name no text-to-speech (the ticket's words).
NO_VOICE = "Spoken answers need the villa's voice to be installed."
#: What it says when they name one and it gave no sound (out of reach, an error, too slow, too long).
NOT_SPOKEN = "This answer could not be spoken."
#: Why there is no sound, `Silent.kind`:
NONE = "none"        # the villa's voice settings name no text-to-speech
FAILED = "failed"    # they name one; asking it gave no sound
FORMAT = "mp3"
MIME = "audio/mpeg"


def speak_s() -> int:
    # its own clock, apart from a voice message's one (transcriber.timeout_s): saying an answer is a separate job
    return limit("speech.timeout_s", 60, unit="seconds", group="run", lo=10, hi=300,
                 says="How long the Agent waits for the villa's voice to say an answer to a question spoken on the "
                      "tablet (reading the voice settings, then making the sound).",
                 reached="The answer stays in words; it says it could not be spoken.", told="person")


class Said(NamedTuple):
    """The answer's sound, and its type."""
    audio: bytes
    mime: str


class Silent(NamedTuple):
    """No sound: its kind (above) and why, for the log (never an address or the words); `say`: what the answer says
    instead, when the skill that chose the voice wrote it (no voice for the answer's language)."""
    kind: str
    why: str
    say: str | None = None


#: The skill's choice of language and voice for an answer (on_event.answer_aloud): (the words, the voice settings, the
#: seconds left) -> {"language", "voice"} | {"say"} | None (no skill: the settings' own voice).
Choose = Callable[[str, dict, float, object], Awaitable[dict | None]]


class Speech:
    def __init__(self, settings, reader, headers: dict | None = None, choose: Choose | None = None):
        self.s = settings
        self.reader = reader            # the villa's system through ha-mcp (its voice settings)
        self.headers = headers or {}    # Cloudflare Access, when the villa's system is reached through it
        self.choose = choose            # the skill's choice of language and voice (Aloud._choose)

    async def say(self, text: str, deadline: float | None = None, asked=None) -> Said | Silent:
        """`text` in the villa's voice, before `deadline` (time.monotonic(); speak_s() from now when not given). ⚠️ IN
        THE ANSWER'S OWN LANGUAGE (owner, 2026-10-29: a French answer read by the English voice): the skill tells the
        language and names its voice, or says why there is none; never another language's voice. ⚠️ ONE CLOCK
        (architecture review, 2026-10-30): reading the settings, the skill's choice and the sound each had the whole
        limit, so an answer could take twice the setting; each now gets what is left. `asked`: the question it answers
        (answering.Asked), for the skill's choice of language."""
        deadline = deadline if deadline is not None else time.monotonic() + speak_s()

        def left() -> float:
            return max(0.0, deadline - time.monotonic())
        try:
            pipeline = await asyncio.wait_for(asyncio.to_thread(self.reader.voice_pipeline), left())
        except Exception as e:  # noqa: BLE001 — what kind of failure only
            return Silent(FAILED, f"the voice settings not read ({type(e).__name__})")
        engine = str((pipeline or {}).get("tts_engine") or "")
        if not engine:
            return Silent(NONE, "no text-to-speech in the villa's voice settings")
        if not (self.s.ha_url and self.s.ha_token):
            return Silent(FAILED, "no address or token for the villa's system")
        language, voice = pipeline.get("tts_language"), pipeline.get("tts_voice")
        if self.choose is not None:
            if left() <= 0:
                return Silent(FAILED, "no time left to choose the voice")
            chosen = await self.choose(text, pipeline, left(), asked)
            # None: no skill chooses (the settings' own voice). ⚠️ A CHOICE THAT FAILED IS NO CHOICE (architecture
            # review, 2026-10-30): its script answered {} when it stopped or timed out, read as "no skill", and a French
            # answer went to the English voice again — never read by another language's voice
            if chosen is not None:
                if chosen.get("say"):
                    return Silent(FAILED, "no voice for the answer's language", str(chosen["say"]))
                if "language" not in chosen:
                    return Silent(FAILED, "the skill choosing the voice gave no answer")
                language, voice = chosen["language"] or None, chosen.get("voice") or None
        options = {"voice": voice} if voice else {}
        body = {"engine_id": engine, "message": text, "options": {**options, "preferred_format": FORMAT},
                **({"language": language} if language else {})}
        base, h = self.s.ha_url.rstrip("/"), {**self.headers, "Authorization": f"Bearer {self.s.ha_token}"}
        cap = int(agreement.section("conversation")["voice"]["answerBytes"])
        try:
            if left() <= 0:
                return Silent(FAILED, "no time left to make the sound")
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=left()),
                                             headers=h) as http:
                async with http.post(f"{base}/api/tts_get_url", json=body) as r:
                    if r.status != 200:
                        return Silent(FAILED, f"the voice answered {r.status}")
                    path = str((await r.json(content_type=None) or {}).get("path") or "")
                if not path.startswith("/api/"):
                    return Silent(FAILED, "the voice named no sound")
                async with http.get(f"{base}{path}") as r:
                    if r.status != 200:
                        return Silent(FAILED, f"the sound answered {r.status}")
                    audio = b""
                    async for chunk in r.content.iter_chunked(65536):
                        audio += chunk
                        if len(audio) > cap:
                            break
        except Exception as e:  # noqa: BLE001 — never the URL or the token: only what kind of failure
            return Silent(FAILED, type(e).__name__)
        if not audio:
            return Silent(FAILED, "an empty sound")
        if len(audio) > cap:
            return Silent(FAILED, f"a sound over {cap // 1_000_000} MB")
        return Said(audio, MIME)


class Aloud:
    """An answer to a question spoken on the tablet, said aloud: ONE module for the whole of it (architecture review,
    2026-10-30: it was app._aloud, app._choose_voice and this module's Speech, with no record) — the skill's choice of
    language and voice (on_event.answer_aloud: skills before code), one clock (speak_s), the turn on the tablet (its
    sound named, or why not: Tablet.speak / Tablet.note), and one record per answer (kind "aloud": spoken or not, why,
    the sound's size, the time taken; never the words)."""

    def __init__(self, settings, reader, tablet, state, skills, code_command, headers: dict | None = None):
        self.s, self.tablet, self.state, self.skills, self.code_command = settings, tablet, state, skills, code_command
        self.speech = Speech(settings, reader, headers, choose=self._choose)

    async def _choose(self, text: str, pipeline: dict, seconds: float, asked=None) -> dict | None:
        """The skill's choice, or None when no skill makes one. The words, and the question's (answering.Asked), go to
        it in files, removed after."""
        import os
        hook = next(iter(self.skills.handlers("answer_aloud")), None)
        if not hook:
            return None
        folder = os.path.join(self.s.out_dir, "voice")
        os.makedirs(folder, exist_ok=True)
        stamp = time.time_ns()
        path = os.path.join(folder, f"answer-{stamp}.txt")
        question = os.path.join(folder, f"question-{stamp}.txt")
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            with open(question, "w", encoding="utf-8") as f:
                f.write(asked.question if asked else "")
            return await asyncio.to_thread(self.code_command, hook[0], hook[1],
                                           {"text": path, "language": str(pipeline.get("tts_language") or ""),
                                            "voice": str(pipeline.get("tts_voice") or ""), "question": question,
                                            "heard": str((asked.heard if asked else None) or ""),
                                            "saved": str((asked.saved if asked else None) or "")},
                                           max(1, int(seconds)))
        finally:
            for f in (path, question):
                try:
                    os.remove(f)
                except OSError:
                    pass

    async def answer(self, cid: int, mid: int | None, text: str, timeline=None, asked=None) -> bool:
        """The answer `mid` (its words already on the tablet: nobody waits on the voice to read them) said aloud, its
        sound named on the turn; else the turn says why it was not spoken. Whether it was spoken."""
        if not mid or not text:
            return False
        began = time.monotonic()
        said = await self.speech.say(text, began + speak_s(), asked)
        if isinstance(said, Said):
            if await self.tablet.speak(cid, mid, said.audio, said.mime):
                self._record(cid, True, None, len(said.audio), began)
                if timeline is not None:
                    timeline.mark("voice")              # its sound named on the answer: the tablet plays it now
                    log.info("%s", timeline.line())
                return True
            said = Silent(FAILED, "the sound not named on the answer (tablet.Tablet.speak logs why)")
        self._record(cid, False, said.why, None, began)
        await self.tablet.note(cid, mid, said.say or (NO_VOICE if said.kind == NONE else NOT_SPOKEN))
        return False

    def _record(self, cid: int, spoken: bool, why: str | None, size: int | None, began: float) -> None:
        from .tablet import profile_of
        took = round(time.monotonic() - began, 1)
        self.state.log("aloud", {"chat": cid, "spoken": spoken, "why": why, "bytes": size, "took": took})
        if spoken:
            log.info("Answer spoken in the tablet's conversation (%s, %d KB, %.1f s)", profile_of(cid), (size or 0) // 1024,
                     took)
        else:
            log.info("Answer not spoken in the tablet's conversation (%s): %s", profile_of(cid), why)


__all__ = ["Speech", "Aloud", "Said", "Silent", "NO_VOICE", "NOT_SPOKEN", "NONE", "FAILED", "speak_s"]
