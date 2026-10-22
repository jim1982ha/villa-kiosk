"""A voice message's words: fetched from Telegram, written out by the skill that handles voice (Whisper asked
directly), or read by Home Assistant from the WAV that skill prepared.

Taken out of app.py (architecture review, 2026-10-07): its own external steps (Telegram's file, a skill's script,
Home Assistant's speech-to-text) and its own clean-up, testable without the rest of the agent.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from datetime import datetime, timezone
from typing import NamedTuple

from vesta_shared.limits import limit

from .policy import Person
from .speech import LANGUAGE, refused, speech_to_text
from .telegram import TelegramError

log = logging.getLogger("vesta")

# why the skill did not use Whisper directly, as its script says it: a kind of failure ("ConnectionRefusedError",
# "off"), never an address or words; anything else is logged as "failed"
WHY_NOT_DIRECT = re.compile(r"^[A-Za-z]{1,40}$")


class Heard(NamedTuple):
    """A voice message's words, and the language Whisper heard them in (None when it was not said)."""
    text: str
    language: str | None = None


class Voice:
    def __init__(self, settings, tg, skills, code_command, send, state, cf_headers: dict | None = None):
        self.s = settings
        self.cf_headers = cf_headers or {}   # Cloudflare Access, when Home Assistant is reached through it
        self.tg = tg                      # telegram.Telegram, or None (takeover off)
        self.skills = skills
        self.code_command = code_command  # app.Vesta.code_command: the skill's hook, run as a code job
        self.send = send                  # delivery.Delivery.send
        self.state = state

    async def transcribe(self, cid: int, person: Person, file_id: str) -> Heard | None:
        """A voice message's words, or None (the person is told why).

        ⚠️ THE SKILL DECIDES, THE ENGINE ONLY CARRIES (owner, 2026-10-05: everything tuned
        per villa lives in the skills, so a villa's skills copied to another work the same).
        The skill whose `on_event.voice_message` hook runs decodes the audio and chooses the
        speech-to-text and the language; the engine fetches the file and sends the skill's
        WAV to Home Assistant, because it holds the token and a skill script never does.

        ⚠️ OR THE SKILL WRITES IT OUT ITSELF (owner, 2026-10-22, "the Agent asks Whisper directly"): Home
        Assistant cannot ask Whisper to find the language spoken, so the skill may ask Whisper over Wyoming
        (no token) and answer {"text", "language", "via": "whisper"}; the engine takes those words as they are
        and runs speech_to_text only when the skill answers an "stt" spec."""
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
            res = await asyncio.to_thread(self.code_command, sk, cmd, {"audio": path, "language": person.language},
                                         limit("voice.script_timeout_s", 120, unit="seconds", group="run", lo=10,
                                               hi=1800,
                                               says="How long a skill may take to prepare a voice message to be "
                                                    "written out.",
                                               reached="The voice message is not understood; the person is told.",
                                               told="person"))
            heard = res.get("text")
            if isinstance(heard, str) and heard.strip():
                spoken = str(res.get("language") or "")
                spoken = spoken if LANGUAGE.match(spoken) and spoken != "auto" else None
                log.info("Voice message in chat %s: %s s, Whisper directly (asked auto, detected %s)", cid,
                         res.get("seconds"), spoken or "not said")
                self.state.log("voice", {"chat": cid, "seconds": res.get("seconds"), "via": "whisper", "stt": None,
                                         "language": "auto", "detected": spoken, "used": spoken,
                                         "auto_refused": False, "ok": True, "why": None})
                return Heard(heard.strip(), spoken)
            st = res.get("stt") if isinstance(res.get("stt"), dict) else None
            if not st:
                await self.send(cid, str(res.get("error") or "This voice message could not be prepared."))
                return None
            wav = st.get("wav")
            # The skill's language first ("auto": the speech-to-text finds it); when the villa's system
            # REFUSES it (415/400: this speech-to-text does not take it), once more in the skill's
            # `fallback` (the person's saved language). A timeout or a network error is not retried.
            asked, fallback = st.get("language"), st.get("fallback")
            used = asked
            text, why = await speech_to_text(self.s.ha_url, self.s.ha_token, st, self.cf_headers)
            was_refused = refused(why)
            if was_refused and fallback and str(fallback) != str(asked):
                used = fallback
                text, why = await speech_to_text(self.s.ha_url, self.s.ha_token, {**st, "language": fallback},
                                                  self.cf_headers)
            auto_refused = asked == "auto" and was_refused
            direct = st.get("whisper")
            direct = (str(direct) if WHY_NOT_DIRECT.match(str(direct)) else "failed") if direct else None
            log.info("Voice message in chat %s: %s s, %s (asked %s, used %s%s%s)%s", cid, st.get("seconds"),
                     st.get("entity"), asked, used, ", auto refused" if auto_refused else "",
                     f", Whisper directly: {direct}" if direct else "", f": {why}" if why else "")
            self.state.log("voice", {"chat": cid, "seconds": st.get("seconds"), "via": "villa",
                                     "stt": st.get("entity"), "language": asked, "detected": None, "used": used,
                                     "auto_refused": auto_refused, "whisper": direct, "ok": bool(text), "why": why})
            if not text:
                await self.send(cid, "I could not make out this voice message. Try again, or write it.")
                return None
            return Heard(text)
        finally:
            for f in (path, wav):        # a voice is the person's: kept no longer than it takes to read it
                if f and os.path.dirname(os.path.abspath(f)) == os.path.abspath(folder):
                    try:
                        os.remove(f)
                    except OSError:
                        pass
