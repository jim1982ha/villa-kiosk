"""Chat message helpers shared by the skills.

Telegram caps a message at 4,096 characters. Long content is split on
paragraph boundaries; a report longer than two messages is sent as its HTML
page, attached, instead (the reports skill decides).
"""

from __future__ import annotations

import re

TELEGRAM_LIMIT = 4096


def no_code(s: str) -> str:
    """No rule code in what a person reads ("[PM-02] Pump ..." -> "Pump ..."). One copy: the nightly
    check, the report facts and the problems list each had their own until 0.12.27."""
    return re.sub(r"^\s*\[[^\]]{2,80}\]\s*", "", s or "").strip()


def split_message(text: str, limit: int = TELEGRAM_LIMIT) -> list[str]:
    if len(text) <= limit:
        return [text]
    parts, cur = [], ""
    for para in text.split("\n\n"):
        if len(para) > limit:  # a single huge paragraph: hard split
            while len(para) > limit:
                parts.append(para[:limit]); para = para[limit:]
        if len(cur) + len(para) + 2 > limit:
            parts.append(cur.rstrip()); cur = para + "\n\n"
        else:
            cur += para + "\n\n"
    if cur.strip():
        parts.append(cur.rstrip())
    return parts


def fmt_money(amount: float, currency: str) -> str:
    if currency == "IDR":
        return f"{amount:,.0f} IDR"
    return f"{amount:,.2f} {currency}"


def reply_keyboard(options: list[str]) -> dict:
    """Telegram inline keyboard payload for the chase loop."""
    return {"inline_keyboard": [[{"text": o, "callback_data": o.lower().replace(" ", "_")} for o in options]]}
