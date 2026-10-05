"""A voice message's WAV to Home Assistant's speech-to-text: the one Home Assistant call HA MCP cannot make.

HA MCP has no speech-to-text tool, so this posts to Home Assistant's own API
(POST /api/stt/<stt entity>) with the agent's token. It changes nothing in the
villa: audio in, text out. Which speech-to-text, which language and the audio
itself come from the skill that handles `voice_message` (its script prepared
them); this module only checks their shape and carries them.
"""

from __future__ import annotations

import logging
import re

import aiohttp

log = logging.getLogger("vesta.speech")

# What a skill script may name: the shape only — it reaches a URL path and a header.
STT_ENTITY = re.compile(r"^stt\.[a-z0-9_]+$")
LANGUAGE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$")
# The WAV voice.py writes: 16 kHz, 16-bit, mono — what Home Assistant's Wyoming speech-to-text takes.
CONTENT = "format=wav; codec=pcm; sample_rate=16000; bit_rate=16; channel=1; language={language}"


async def speech_to_text(ha_url: str, token: str, stt: dict, headers: dict | None = None,
                         timeout: int = 90) -> tuple[str | None, str | None]:
    """(text, None) or (None, why not). Never raises; never logs the token or the words."""
    entity, language, wav = str(stt.get("entity") or ""), str(stt.get("language") or ""), str(stt.get("wav") or "")
    if not STT_ENTITY.match(entity):
        return None, "the skill named no stt.* entity"
    if not LANGUAGE.match(language):
        return None, "the skill named no language code"
    if not (ha_url and token):
        return None, "no Home Assistant address or token"
    try:
        with open(wav, "rb") as f:
            body = f.read()
    except OSError:
        return None, "the skill wrote no WAV"
    h = {**(headers or {}), "Authorization": f"Bearer {token}", "Content-Type": "audio/wav",
         "X-Speech-Content": CONTENT.format(language=language)}
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as http:
            async with http.post(f"{ha_url.rstrip('/')}/api/stt/{entity}", data=body, headers=h) as r:
                if r.status != 200:
                    # 415: this speech-to-text does not take this language or format
                    return None, f"Home Assistant answered {r.status}"
                data = await r.json(content_type=None)
    except Exception as e:  # noqa: BLE001 — never the URL or the token: only what kind of failure
        return None, type(e).__name__
    text = str((data or {}).get("text") or "").strip()
    if (data or {}).get("result") != "success" or not text:
        return None, f"no words ({(data or {}).get('result') or 'no result'})"
    return text, None


__all__ = ["speech_to_text"]
