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


def tg_len(text: str) -> int:
    """A text's length as Telegram counts it: UTF-16 units (an emoji is two)."""
    return len(text.encode("utf-16-le")) // 2


def split_message(text: str, limit: int = TELEGRAM_LIMIT) -> list[str]:
    """`text` in parts Telegram takes (at most `limit` of its units each), IN ORDER, cut between paragraphs, else
    between lines, else — a single line longer than a message — inside it.

    ⚠️ IN ORDER (architecture review 15, 2026-10-10): a paragraph longer than a message (a long list with no blank
    line) was sent before the text above it, cut in the middle of a line — the list arrived first, its introduction
    second."""
    if tg_len(text) <= limit:
        return [text]
    pieces: list[str] = []                       # the smallest units, in order, each with what joins it to the next
    for para in text.split("\n\n"):
        lines = para.split("\n")
        for i, line in enumerate(lines):
            while tg_len(line) > limit:          # one line longer than a message: cut inside it
                cut = limit
                while tg_len(line[:cut]) > limit:
                    cut -= 1
                pieces.append(line[:cut] + "\n")
                line = line[cut:]
            pieces.append(line + ("\n" if i < len(lines) - 1 else "\n\n"))
    parts, cur = [], ""
    for p in pieces:
        if cur and tg_len((cur + p).rstrip()) > limit:
            parts.append(cur.rstrip())
            cur = ""
        cur += p
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


#: The line between a notice's parts: its heading, the alert, where it stands (vesta_agent/notice.py, incident_thread.py).
RULE = "-------"


def incident_message(status: str, details: str = "") -> str:
    """The body of a notice about an incident: the original alert (`details`), then — under a line — where it stands
    (`status`; "{time}" in it is the villa's time when it is sent). Its number, who it is for and its earlier notices
    are the heading the engine writes (vesta_agent/notice.py); what to answer is the buttons under it (owner,
    2026-10-10: "never mention any redundant text like Reply Done or Need help").

    ⚠️ THE ALERT FIRST, WHERE IT STANDS LAST (owner, 2026-10-10): "the update of the message shall appear at the bottom,
    after a ------- line", with its time. A button pressed later replaces that last part (IncidentThread.close).
    Since 0.12.142 a skill gives the status apart (vesta_shared.result.message status=) and the engine lays the parts out
    (vesta_agent/layout.py): this stays only for a skill edited before, which still joins them."""
    body, status = (details or "").strip(), status.strip()
    return f"{body}\n{RULE}\n{status}" if body and status else body or status
