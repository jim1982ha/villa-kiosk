"""A voice message's words: its audio fetched from where it was said, prepared by the skill that handles voice (with
its plan: which ways to write it out, in which order), then written out by transcriber.Transcriber.

⚠️ FROM ANY SOURCE (ticket 23 of "One inbox", hold to talk): a Telegram voice note (TelegramAudio, its file id) or a
question spoken on the tablet (tablet.Spoken, the WAV the Kiosk keeps) — the same skill, plan and transcriber for both.
A source fetches its bytes and hears back the words; nothing else differs.

Taken out of app.py (architecture review, 2026-10-07): its own external steps (the audio's source, a skill's script)
and its own clean-up, testable without the rest of the agent. How the words are obtained is transcriber.py
(architecture review, 2026-10-23).
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Protocol

from .policy import Person
from .telegram import TelegramError
from .transcriber import Heard, Transcriber, script_seconds, timeout_s

log = logging.getLogger("vesta")


class AudioSource(Protocol):
    """Where a voice message's audio comes from."""
    #: the file's ending as the skill's script reads it
    suffix: str

    async def fetch(self, cid: int) -> bytes | str | None:
        """The audio; or what the person reads when it cannot be had; None to say nothing."""

    async def heard(self, words: str) -> None:
        """The words written out, back to where they were said (a tablet's line shows them)."""


class TelegramAudio:
    """A Telegram voice note: its file, fetched with the bot's token."""
    suffix = ".ogg"

    def __init__(self, tg, file_id: str):
        self.tg = tg                      # telegram.Telegram, or None (takeover off)
        self.file_id = file_id

    async def fetch(self, cid: int) -> bytes | str | None:
        if not self.tg:
            log.info("Voice message in chat %s not read: \"Agent replies on Telegram\" is off", cid)
            return None
        try:
            return await self.tg.download(self.file_id)
        except TelegramError as e:
            log.warning("Voice message in chat %s: %s", cid, e)
            return "This voice message could not be fetched from Telegram."

    async def heard(self, words: str) -> None:
        pass                              # Telegram shows the voice note itself


class Voice:
    def __init__(self, settings, skills, code_command, send, state, cf_headers: dict | None = None,
                 entity_ids=None):
        self.s = settings
        self.skills = skills
        self.code_command = code_command  # app.Vesta.code_command: the skill's hook, run as a code job
        self.send = send                  # delivery.Delivery.send
        # one per app: it remembers what the villa's speech-to-text refused while the app runs. `entity_ids`: the
        # villa's devices, read only when an attempt names "the villa's only speech-to-text" (transcriber.py)
        self.transcriber = Transcriber(settings, state, cf_headers, entity_ids=entity_ids)

    async def transcribe(self, cid: int, person: Person, source: AudioSource) -> Heard | None:
        """A voice message's words, or None (the person is told why).

        ⚠️ THE SKILL DECIDES, THE ENGINE CARRIES (owner, 2026-10-05: everything tuned per villa lives in the
        skills, so a villa's skills copied to another work the same). The skill whose `on_event.voice_message`
        hook runs decodes the audio and answers the PLAN: which Whisper, which speech-to-text, which languages, in
        which order (transcriber.py). The engine fetches the audio and runs the plan, because it holds the tokens
        and a skill script never does."""
        hook = next(iter(self.skills.handlers("voice_message")), None)
        audio = await source.fetch(cid)
        if not isinstance(audio, bytes):
            if audio:
                await self.send(cid, audio)
            return None
        if not hook:
            await self.send(cid, "Voice messages are not set up here: no skill handles them.")
            return None
        folder = os.path.join(self.s.out_dir, "voice")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S%f}{source.suffix}")
        plan: dict = {}
        try:
            with open(path, "wb") as f:
                f.write(audio)
            # the one clock starts: the skill's preparation and every attempt share it (transcriber.timeout_s)
            started = time.monotonic()
            deadline = started + timeout_s()
            sk, cmd = hook
            plan = await asyncio.to_thread(self.code_command, sk, cmd, {"audio": path, "language": person.language},
                                          script_seconds(deadline))
            if not isinstance(plan.get("attempts"), list):
                await self.send(cid, str(plan.get("error") or "This voice message could not be prepared."))
                return None
            heard = await self.transcriber.run(cid, plan, deadline, started)
            if isinstance(heard, Heard) and heard.language and isinstance(plan.get("languages"), list) \
                    and plan["languages"] and str(heard.language).split("-")[0].split("_")[0].lower() \
                    not in {str(c).lower() for c in plan["languages"]}:
                # ⚠️ A LANGUAGE OUTSIDE THE VILLA'S IS NOT BELIEVED (architecture review, 2026-10-30, round 3): the
                # skill names the languages spoken here (villa.voice.yaml `languages:`); one a speech-to-text says it
                # heard outside them is a guess, never told to the AI as the language the person spoke
                heard = heard._replace(language=None)
            if isinstance(heard, Heard):
                await source.heard(heard.text)
                return heard
            await self.send(cid, heard.say)
            return None
        finally:
            for f in (path, plan.get("wav")):   # a voice is the person's: kept no longer than it takes to read it
                if f and os.path.dirname(os.path.abspath(str(f))) == os.path.abspath(folder):
                    try:
                        os.remove(f)
                    except OSError:
                        pass
