"""A voice message's words: fetched from Telegram, prepared by the skill that handles voice, read by Home Assistant.

Taken out of app.py (architecture review, 2026-10-07): its own external steps (Telegram's file, a skill's script,
Home Assistant's speech-to-text) and its own clean-up, testable without the rest of the agent.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

from .policy import Person
from .speech import speech_to_text
from .telegram import TelegramError

log = logging.getLogger("vesta")


class Voice:
    def __init__(self, settings, tg, skills, code_command, send, state, cf_headers: dict | None = None):
        self.s = settings
        self.cf_headers = cf_headers or {}   # Cloudflare Access, when Home Assistant is reached through it
        self.tg = tg                      # telegram.Telegram, or None (takeover off)
        self.skills = skills
        self.code_command = code_command  # app.Vesta.code_command: the skill's hook, run as a code job
        self.send = send                  # delivery.Delivery.send
        self.state = state

    async def transcribe(self, cid: int, person: Person, file_id: str) -> str | None:
        """A voice message's words, or None (the person is told why).

        ⚠️ THE SKILL DECIDES, THE ENGINE ONLY CARRIES (owner, 2026-10-05: everything tuned
        per villa lives in the skills, so a villa's skills copied to another work the same).
        The skill whose `on_event.voice_message` hook runs decodes the audio and chooses the
        speech-to-text and the language; the engine fetches the file and sends the skill's
        WAV to Home Assistant, because it holds the token and a skill script never does."""
        hook = next(((sk, sk.on_event["voice_message"]) for sk in self.skills.all().values()
                     if "voice_message" in sk.on_event), None)
        if not self.tg:
            log.info("Voice message in chat %s not read: Telegram takeover is off", cid)
            return None
        if not hook:
            await self.send(cid, "Voice messages are not set up here: no skill handles them.")
            return None
        folder = os.path.join(self.s.out_dir, "voice")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S%f}.ogg")
        wav = None
        try:
            try:
                audio = await self.tg.download(file_id)
            except TelegramError as e:
                log.warning("Voice message in chat %s: %s", cid, e)
                await self.send(cid, "This voice message could not be fetched from Telegram.")
                return None
            with open(path, "wb") as f:
                f.write(audio)
            sk, cmd = hook
            res = await asyncio.to_thread(self.code_command, sk, cmd, {"audio": path, "language": person.language}, 120)
            st = res.get("stt") if isinstance(res.get("stt"), dict) else None
            if not st:
                await self.send(cid, str(res.get("error") or "This voice message could not be prepared."))
                return None
            wav = st.get("wav")
            text, why = await speech_to_text(self.s.ha_url, self.s.ha_token, st, self.cf_headers)
            log.info("Voice message in chat %s: %s s, %s (%s)%s", cid, st.get("seconds"), st.get("entity"),
                     st.get("language"), f": {why}" if why else "")
            self.state.log("voice", {"chat": cid, "seconds": st.get("seconds"), "stt": st.get("entity"),
                                     "language": st.get("language"), "ok": bool(text), "why": why})
            if not text:
                await self.send(cid, "I could not make out this voice message. Try again, or write it.")
            return text
        finally:
            for f in (path, wav):        # a voice is the person's: kept no longer than it takes to read it
                if f and os.path.dirname(os.path.abspath(f)) == os.path.abspath(folder):
                    try:
                        os.remove(f)
                    except OSError:
                        pass
