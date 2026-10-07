"""Secrets out of anything the agent shows, keeps or hands to the model: one scrubber.

⚠️ ONE SCRUBBER (architecture review 5, 2026-10-07). runner.py had its own, which replaced only the known secrets:
the tool inputs kept for the Costs tab missed a token by its shape (a Home Assistant JWT, a bot token, a
"password=" pair) that tools.scrub caught. Every caller now uses this one.
"""
from __future__ import annotations

import re

_SECRET_PATTERNS = [
    re.compile(r"mcp_[A-Za-z0-9_-]{8,}"),
    re.compile(r"sk-ant-[A-Za-z0-9_-]{10,}"),
    re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{30,}\b"),                 # a Telegram bot token
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}"),  # a JWT (Home Assistant tokens)
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]{12,}"),
]
_SECRET_KV = re.compile(r"(?i)(\\?\"?(?:access_token|refresh_token|token|api_key|apikey|password|passwd|secret|webhook_id|client_secret)\\?\"?\s*[:=]\s*\\?\"?)([^\"\\,}&\s]{4,})")


def scrub(text: str, extra: list[str] | None = None) -> str:
    """Remove secrets from anything the model is about to read."""
    if not text:
        return text
    for sec in extra or []:
        if sec and len(sec) >= 8:
            text = text.replace(sec, "[redacted]")
    for p in _SECRET_PATTERNS:
        text = p.sub("[redacted]", text)
    return _SECRET_KV.sub(lambda m: m.group(1) + "[redacted]", text)
