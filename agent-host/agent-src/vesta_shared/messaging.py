"""Chat message helpers shared by the skills.

Telegram caps a message at 4,096 characters. Long content is split on
paragraph boundaries; a report longer than two messages is sent as its HTML
page, attached, instead (the reports skill decides).
"""

from __future__ import annotations

import re

TELEGRAM_LIMIT = 4096

#: The ONE title of every message about the siren — "the siren cannot be requested" (outcome), "Siren switched off"
#: (app) — above "To:" in the one layout (architecture review round 3, 2026-10-19: "Siren request" and "Siren").
SIREN_TITLE = "Siren"
#: A photo's or a file's caption: Telegram takes 1,024, kept under it — ONE number for the agent that sends and edits it
#: and for a skill that writes one (reports' investigation summary; architecture review 32: 1,000 and 1,024 by hand)
TELEGRAM_CAPTION = 1000


def no_code(s: str) -> str:
    """No rule code in what a person reads ("[PM-02] Pump ..." -> "Pump ..."). One copy: the nightly
    check, the report facts and the problems list each had their own until 0.12.27."""
    return re.sub(r"^\s*\[[^\]]{2,80}\]\s*", "", s or "").strip()


#: A web page cited in an investigation's text: "[2]" (its place in the page's sources).
CITE = re.compile(r"\[(\d{1,2})\]")


def uncited(text: str) -> str:
    """`text` without its "[n]" references, for where there is no page to follow them to: the investigation's chat
    message and the Kiosk fault offered from it (architecture review 4, 2026-10-13: the fault's note kept "[2]")."""
    return " ".join(re.sub(r"\s*" + CITE.pattern, "", text or "").split())


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
    """How an incident is named in every chat and report: "#10" — its number as an alert's title writes it ("#10-P2
    (new)", vesta_agent/notice.py). ⚠️ ONE NAME (owner, 2026-10-12): the title said "#23-P2" and the reports, the
    concierge and a replaced copy said "Incident #23"."""
    return f"#{iid}"


def incident_message(status: str, details: str = "") -> str:
    """The text of a notice about an incident written by a skill edited before 0.12.142, which still joins its alert
    (`details`) and where it stands (`status`). Since then a skill gives the status apart (vesta_shared.result.message
    status=) and the engine lays the parts out (vesta_agent/layout.py, the one layout). Kept so such a skill still runs:
    its status is a paragraph of its alert — no "-------" line, which was a second layout (owner, 2026-10-12)."""
    body, status = (details or "").strip(), status.strip()
    return f"{body}\n\n{status}" if body and status else body or status
