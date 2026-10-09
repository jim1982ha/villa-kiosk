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



# ------------------------------------------------------------------ an incident's message
# ⚠️ ONE LAYOUT FOR EVERY MESSAGE ABOUT AN INCIDENT (owner, 2026-10-09). Each chat shows only an incident's
# LATEST message — the engine deletes the earlier ones when a new one lands (outcome.py) — so every message
# must stand on its own: its number, where it stands now, and the original alert. The number was written five
# ways ("Incident #9.", "Reminder, incident #9:", "on incident #9:", "#9", none at all on Home Assistant's own
# message), and a reminder repeated half of the alert.

def incident_tag(iid: int | str) -> str:
    """How an incident is named in every chat and report: "Incident #10"."""
    return f"Incident #{iid}"


def incident_message(iid: int | str, status: str, details: str = "", ask: str = "") -> str:
    """An incident's message: "Incident #10 · <where it stands>", then the original alert (`details`), then what
    to answer (`ask`). The words are the skill's; this is only their order."""
    head = f"{incident_tag(iid)} · {status.strip()}" if status.strip() else incident_tag(iid)
    return "\n".join(p for p in (head, (details or "").strip(), (ask or "").strip()) if p)
