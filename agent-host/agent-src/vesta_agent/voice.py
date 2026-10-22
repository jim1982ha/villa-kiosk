"""A voice message's words: fetched from Telegram, its audio prepared by the skill that handles voice (with its
plan: which ways to write it out, in which order), then written out by transcriber.Transcriber.

Taken out of app.py (architecture review, 2026-10-07): its own external steps (Telegram's file, a skill's script)
and its own clean-up, testable without the rest of the agent. How the words are obtained is transcriber.py
(architecture review, 2026-10-23).
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone

from .policy import Person
from .telegram import TelegramError
from .transcriber import Heard, Transcriber, script_seconds, timeout_s

log = logging.getLogger("vesta")


class Voice:
    def __init__(self, settings, tg, skills, code_command, send, state, cf_headers: dict | None = None,
                 entity_ids=None):
        self.s = settings
        self.tg = tg                      # telegram.Telegram, or None (takeover off)
        self.skills = skills
        self.code_command = code_command  # app.Vesta.code_command: the skill's hook, run as a code job
        self.send = send                  # delivery.Delivery.send
        # one per app: it remembers what the villa's speech-to-text refused while the app runs. `entity_ids`: the
        # villa's devices, read only when an attempt names "the villa's only speech-to-text" (transcriber.py)
        self.transcriber = Transcriber(settings, state, cf_headers, entity_ids=entity_ids)

    async def transcribe(self, cid: int, person: Person, file_id: str) -> Heard | None:
        """A voice message's words, or None (the person is told why).

        ⚠️ THE SKILL DECIDES, THE ENGINE CARRIES (owner, 2026-10-05: everything tuned per villa lives in the
        skills, so a villa's skills copied to another work the same). The skill whose `on_event.voice_message`
        hook runs decodes the audio and answers the PLAN: which Whisper, which speech-to-text, which languages, in
        which order (transcriber.py). The engine fetches the file and runs the plan, because it holds the token
        and a skill script never does."""
        hook = next(((sk, sk.on_event["voice_message"]) for sk in self.skills.all().values()
                     if "voice_message" in sk.on_event), None)
        if not self.tg:
            log.info("Voice message in chat %s not read: \"Agent replies on Telegram\" is off", cid)
            return None
        if not hook:
            await self.send(cid, "Voice messages are not set up here: no skill handles them.")
            return None
        folder = os.path.join(self.s.out_dir, "voice")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S%f}.ogg")
        plan: dict = {}
        try:
            try:
                audio = await self.tg.download(file_id)
            except TelegramError as e:
                log.warning("Voice message in chat %s: %s", cid, e)
                await self.send(cid, "This voice message could not be fetched from Telegram.")
                return None
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
            if isinstance(heard, Heard):
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
