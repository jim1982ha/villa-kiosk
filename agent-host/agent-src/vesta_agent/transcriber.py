"""How a voice message becomes words: the skill's plan, run in order, under one clock, written down once.

⚠️ ONE MODULE FOR THE WHOLE PATH (architecture review, 2026-10-23). Before, the skill's script decided "Whisper
directly or the villa's system", made the Wyoming call itself and answered either words or a speech-to-text spec;
the engine branched on that, asked the villa's system with its own retry, and each side wrote half of the record.
Four clocks (connect 3 s, Whisper 60 s, the villa's speech-to-text 90 s run up to twice, the script 120 s) added up
to about four minutes, and the script's could be set below Whisper's, so the script was killed before the
fallback ran. And when Whisper was out of reach, the villa's system was asked "auto" (which it always refuses
here) and then the person's saved language: a French voice note came back in English.

Now the skill answers a PLAN (the villa's choices: which Whisper, whether at all, a fixed language, the order):

    {"wav": "/…/voice.wav", "seconds": 3.2,
     "attempts": [{"whisper": "core-whisper:10300"},
                  {"stt": "stt.x", "language": "auto"},
                  {"stt": "stt.x", "language": "fr"}],
     "otherwise": "words for the person when no attempt gives words",          (optional)
     "no_stt": {"none": "…", "several": "…"}}   (optional: the person's words when "the only one" is not one)

An attempt may name the villa's speech-to-text without an entity, `{"stt": null, "language": …}`: "the villa's
only one". ⚠️ FOUND LATE, BY THE ENGINE (review, 2026-10-23): the skill asked the villa's system for its whole device
list BEFORE Whisper was tried; when that read failed the script stopped and the person read "This voice message
could not be prepared", Whisper never asked. Now `VillaSpeech.only` looks it up when such an attempt is reached
(once per message, the answer kept for its next attempts), within what is left of the clock; a failed, empty or
ambiguous lookup is that attempt's why, and when nothing gives words the person reads the plan's `no_stt` words
for "none" or "several".

and `Transcriber` runs the attempts in order through two adapters with one interface (`attempt(step, audio,
seconds) -> Heard | why`): `WhisperDirect` (wyoming.py) and `VillaSpeech` (POST /api/stt/<entity>, the agent's
token, the one Home Assistant call HA MCP cannot make; it changes nothing in the villa). It stops at the first words.
ONE limit, `voice.timeout_s`, covers the whole message (the skill preparing the audio, then every attempt): each
attempt gets what is left, so a slow Whisper leaves the villa's system only the rest and the total never exceeds it.
`voice.whisper_connect_s` only shortens the wait for Whisper's connection, never beyond what is left.

What the villa's system REFUSED (415/400: this speech-to-text does not take that language), it is not asked again
while the app runs: `Transcriber.refused` holds (entity, language), and that attempt is skipped ("refused before"),
so after one refusal of "auto" the fallback goes straight to the saved language. A restart forgets it (the villa
may have changed its speech-to-text meanwhile); one refused request is all it costs.

ONE record per message, kind "voice": via, used, detected, auto_refused, every attempt with why it gave no words,
the seconds taken. Never the words, the audio, an address or the token.
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
import time
import wave
from dataclasses import dataclass
from typing import NamedTuple, Protocol

import aiohttp

from vesta_shared.limits import limit

from . import wyoming

log = logging.getLogger("vesta")

# What a plan may name: the shape only — it reaches a URL path and a header. "auto" asks the speech-to-text to find
# the language itself (a skill's choice; the villa's system may refuse it).
STT_ENTITY = re.compile(r"^stt\.[a-z0-9_]+$")
LANGUAGE = re.compile(r"^(auto|[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?)$")
# What Home Assistant answers when the speech-to-text does not take this language or format: 415 when the
# speech-to-text refuses the metadata (check_metadata), 400 when the header itself is not accepted.
REFUSED = (400, 415)
CONTENT = "format=wav; codec=pcm; sample_rate={rate}; bit_rate={bits}; channel={channels}; language={language}"
UNHEARD = "I could not make out this voice message. Try again, or write it."


def timeout_s() -> int:
    """The one clock of a voice message: from the skill preparing its audio to the last attempt's answer."""
    return limit("voice.timeout_s", 120, unit="seconds", group="run", lo=20, hi=600,
                 says="How long a voice message may take to be written out: the skill preparing it, then each way "
                      "of writing it out in turn, each with the time left.",
                 reached="The voice message is not understood; the person is told.", told="person")


def connect_s() -> float:
    return limit("voice.whisper_connect_s", 3, unit="seconds", group="run", lo=1, hi=30,
                 says="How long the Agent waits to reach Whisper directly with a voice message (never more than the "
                      "voice message has left).",
                 reached="The voice message goes to the next way of writing it out.", told="")


class Heard(NamedTuple):
    """A voice message's words, and the language Whisper said it heard them in (None when it did not say)."""
    text: str
    language: str | None = None


class Unheard(NamedTuple):
    """No words: what the person reads instead."""
    say: str


class Unfound(NamedTuple):
    """The villa's only speech-to-text, not found: `kind` "none", "several" or "failed"; `why` for the record."""
    kind: str
    why: str


class Step(NamedTuple):
    """One attempt of a plan: via "whisper" (target host:port) or "villa" (target an stt.* entity; None: the villa's
    only one, looked up when the attempt is reached)."""
    via: str
    target: str | None
    language: str | None        # None: Whisper's own setting decides


@dataclass
class Audio:
    """The WAV the skill wrote: its samples and their format."""
    path: str
    pcm: bytes
    rate: int
    width: int
    channels: int

    @classmethod
    def read(cls, path: str) -> "Audio":
        with wave.open(path, "rb") as w:
            return cls(path, w.readframes(w.getnframes()), w.getframerate(), w.getsampwidth(), w.getnchannels())


def step_of(raw) -> Step | str:
    """A plan's attempt checked, or why it cannot be run."""
    if not isinstance(raw, dict):
        return "not an attempt"
    lang = raw.get("language")
    if lang is not None and not LANGUAGE.match(str(lang)):
        return "no language code"
    if "whisper" in raw:
        try:
            wyoming.address(raw["whisper"])
        except ValueError:
            return "not host:port"
        return Step("whisper", str(raw["whisper"]), None if lang in (None, "auto") else str(lang))
    if "stt" in raw:
        # null: the villa's only one (looked up later); anything else reaches a URL path, so its shape is checked
        if raw["stt"] is not None and not STT_ENTITY.match(str(raw["stt"])):
            return "no stt.* entity"
        if lang is None:
            return "no language code"
        return Step("villa", None if raw["stt"] is None else str(raw["stt"]), str(lang))
    return "neither whisper nor stt"


class Adapter(Protocol):
    async def attempt(self, step: Step, audio: Audio, seconds: float) -> Heard | str: ...


class WhisperDirect:
    """The Whisper app over Wyoming (no token)."""

    async def attempt(self, step: Step, audio: Audio, seconds: float) -> Heard | str:
        fmt = {"rate": audio.rate, "width": audio.width, "channels": audio.channels}
        try:
            got = await asyncio.to_thread(wyoming.transcribe, wyoming.address(step.target), audio.pcm, fmt,
                                          time.monotonic() + seconds, connect_s(), step.language)
        except (OSError, wyoming.WyomingError, ValueError) as e:
            return type(e).__name__           # a kind of failure, never an address or the words
        said = str(got.get("language") or "")
        return Heard(got["text"], said if LANGUAGE.match(said) and said != "auto" else None)


def villa_entity_ids(reader) -> list[str]:
    """Every entity id the villa's system has NOW (the reader keeps its list for the app's life otherwise: a
    speech-to-text added since would not be seen)."""
    return reader.all_entity_ids(fresh=True)


class VillaSpeech:
    """Home Assistant's speech-to-text, POST /api/stt/<entity>, with the agent's token."""

    def __init__(self, settings, headers: dict | None = None, entity_ids=None):
        self.s = settings
        self.headers = headers or {}      # Cloudflare Access, when Home Assistant is reached through it
        self.entity_ids = entity_ids      # () -> the villa's entity ids (villa_entity_ids over the app's reader)

    async def only(self, seconds: float) -> str | Unfound:
        """The villa's one speech-to-text entity, or why there is none to use. Several and none named: not guessed."""
        if self.entity_ids is None:
            return Unfound("failed", "no way to list the villa's devices")
        try:
            ids = await asyncio.wait_for(asyncio.to_thread(self.entity_ids), seconds)
        except Exception as e:  # noqa: BLE001 — what kind of failure only, never an address
            return Unfound("failed", f"the villa's devices not listed ({type(e).__name__})")
        found = sorted(str(e) for e in ids if STT_ENTITY.match(str(e)))
        if len(found) == 1:
            return found[0]
        if not found:
            return Unfound("none", "no speech-to-text in the villa's system")
        return Unfound("several", f"{len(found)} speech-to-text services, none named")

    async def attempt(self, step: Step, audio: Audio, seconds: float) -> Heard | str:
        if not (self.s.ha_url and self.s.ha_token):
            return "no address or token for the villa's system"
        try:
            with open(audio.path, "rb") as f:
                body = f.read()
        except OSError:
            return "the skill wrote no WAV"
        h = {**self.headers, "Authorization": f"Bearer {self.s.ha_token}", "Content-Type": "audio/wav",
             "X-Speech-Content": CONTENT.format(rate=audio.rate, bits=audio.width * 8, channels=audio.channels,
                                                language=step.language)}
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=seconds)) as http:
                async with http.post(f"{self.s.ha_url.rstrip('/')}/api/stt/{step.target}", data=body,
                                     headers=h) as r:
                    if r.status in REFUSED:
                        return refusal(r.status)
                    if r.status != 200:
                        return f"answered {r.status}"
                    data = await r.json(content_type=None)
        except Exception as e:  # noqa: BLE001 — never the URL or the token: only what kind of failure
            return type(e).__name__
        text = str((data or {}).get("text") or "").strip()
        if (data or {}).get("result") != "success" or not text:
            return f"no words ({(data or {}).get('result') or 'no result'})"
        return Heard(text)


def refusal(status: int) -> str:
    return f"refused ({status})"


def refused(why) -> bool:
    """Whether an attempt's why-not is the villa's system refusing the language or format."""
    return why in {refusal(s) for s in REFUSED}


REFUSED_BEFORE = "refused before"


class Transcriber:
    def __init__(self, settings, state, headers: dict | None = None, adapters: dict | None = None, entity_ids=None):
        self.state = state
        self.adapters: dict[str, Adapter] = adapters or {"whisper": WhisperDirect(),
                                                         "villa": VillaSpeech(settings, headers, entity_ids)}
        # (stt entity, language) the villa's system refused while this app runs: never asked again (module doc)
        self.refused: set[tuple[str, str]] = set()

    async def run(self, cid: int, plan: dict, deadline: float, started: float) -> Heard | Unheard:
        """The first words of the plan's attempts, each given what is left before `deadline` (time.monotonic());
        when none gives words, what the person reads instead. Writes the one "voice" record and the one log line."""
        tried: list[dict] = []
        heard: Heard | None = None
        done: Step | None = None
        only: str | Unfound | None = None       # the villa's only speech-to-text, looked up once for this message
        try:
            audio = Audio.read(str(plan.get("wav") or ""))
        except (OSError, EOFError, wave.Error):
            audio, why = None, "the skill wrote no WAV"
        else:
            why = "the skill planned no attempt"
        for raw in (plan.get("attempts") if isinstance(plan.get("attempts"), list) else []) if audio else []:
            step = step_of(raw)
            if isinstance(step, str):
                tried.append({"via": None, "stt": None, "language": None, "why": step})
                why = step
                continue
            left = deadline - time.monotonic()
            if step.via == "villa" and step.target is None and left > 0:
                if only is None:
                    finder = getattr(self.adapters["villa"], "only", None)
                    only = await finder(left) if finder else Unfound("failed", "no way to list the villa's devices")
                if isinstance(only, str):
                    step = step._replace(target=only)
                left = deadline - time.monotonic()
            row = {"via": step.via, "stt": step.target if step.via == "villa" else None,
                   "language": step.language or "auto"}
            if step.via == "villa" and step.target is None:
                got = only.why if isinstance(only, Unfound) else "no time left"
            elif step.via == "villa" and (step.target, step.language) in self.refused:
                got = REFUSED_BEFORE
            elif left <= 0:
                got = "no time left"
            else:
                got = await self.adapters[step.via].attempt(step, audio, left)
            if isinstance(got, Heard):
                tried.append({**row, "why": None})
                heard, done = got, step
                break
            if step.via == "villa" and refused(got):
                self.refused.add((step.target, step.language))
            tried.append({**row, "why": got})
            why = got
        auto_refused = any(t["via"] == "villa" and t["language"] == "auto" and (refused(t["why"]) or
                                                                                 t["why"] == REFUSED_BEFORE)
                           for t in tried)
        took = round(time.monotonic() - started, 1)
        rec = {"chat": cid, "seconds": plan.get("seconds"), "took": took,
               "via": done.via if done else None, "stt": done.target if done and done.via == "villa" else None,
               "used": (done.language or "auto") if done else None, "detected": heard.language if heard else None,
               "auto_refused": auto_refused, "attempts": tried, "ok": heard is not None,
               "why": None if heard else why}
        self.state.log("voice", rec)
        log.info("Voice message in chat %s: %s s of audio, %s in %s s (%s)", cid, plan.get("seconds"),
                 f"words from {_name(done)}" + (f", detected {heard.language}" if heard and heard.language else "")
                 if done else "no words", took,
                 "; ".join(f"{_name(t)}: {t['why'] or 'words'}" for t in tried) or why)
        if heard:
            return heard
        words = plan.get("no_stt") if isinstance(plan.get("no_stt"), dict) else {}
        said = words.get(only.kind) if isinstance(only, Unfound) else None
        return Unheard(str(said or plan.get("otherwise") or UNHEARD))


def _name(step) -> str:
    """An attempt as the log says it: never an address."""
    if isinstance(step, Step):
        via, stt, lang = step.via, step.target if step.via == "villa" else None, step.language or "auto"
    else:
        via, stt, lang = step["via"], step["stt"], step["language"]
    if via == "whisper":
        return "Whisper directly" + (f" in {lang}" if lang != "auto" else "")
    if not via:
        return "an attempt not understood"
    return f"{stt or 'the only speech-to-text'} in {lang}"


def script_seconds(deadline: float) -> int:
    """The skill's own time to prepare the audio: what is left of the one clock (whole seconds, at least one)."""
    return max(1, math.floor(deadline - time.monotonic()))


__all__ = ["Transcriber", "Heard", "Unheard", "Step", "villa_entity_ids", "Audio", "step_of", "timeout_s",
           "script_seconds", "UNHEARD"]
