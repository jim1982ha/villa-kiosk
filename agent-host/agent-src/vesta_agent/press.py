"""A press on one of the agent's buttons, as every handler gets it — whatever place it was pressed in.

⚠️ WHO PRESSED, ON WHICH MESSAGE, NEVER TELEGRAM'S WORDING OF IT (architecture review, 2026-10-29). The handlers read the
raw Telegram callback themselves — the presser's first name (approvals, command offers), the pressed message's text
(approvals, a report button), its rows of buttons (command offers), its id inside the callback (alert buttons), whether
its words were a file's caption (Delivery.settle) — so a press made anywhere else (the tablet, ticket 22 of "One inbox")
would have had to be dressed up as a Telegram callback, field by field. Here a press is what the handlers need to know,
read from Telegram in ONE place (`from_telegram`); the tablet's press is the second reading.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Awaitable, Callable

from .policy import Person


@dataclass
class Press:
    """A press, as its handler gets it."""
    chat: int
    mid: int | None                      # the message pressed
    presser: int | None                  # who pressed (their id where they pressed)
    person: Person | None                # who that is, with the role they press with there (Policy.member)
    parts: list[str]                     # the button's own data after its kind (button_data.read)
    toast: Callable[[str], Awaitable]    # the short notice over the button
    name: str | None = None              # the presser's name as the place gives it (Telegram's first name)
    words: str = ""                      # the pressed message's words, as it shows them now
    rows: list[list[dict]] = field(default_factory=list)   # its buttons, row by row ({"text", "callback_data"})
    caption: bool = False                # its words are a picture's or a file's caption (a shorter limit)


def from_telegram(q: dict, chat: int, person: Person | None, parts: list[str],
                  toast: Callable[[str], Awaitable]) -> Press:
    """A Telegram button press, as Home Assistant fired it (telegram_callback): the ONE reading of its fields."""
    msg = q.get("message") or {}
    mid = msg.get("message_id")
    return Press(chat=chat, mid=int(mid) if str(mid or "").lstrip("-").isdigit() else None, presser=q.get("user_id"),
                 person=person, parts=parts, toast=toast, name=q.get("from_first"),
                 words=str(msg.get("text") or msg.get("caption") or ""),
                 rows=[list(r) for r in ((msg.get("reply_markup") or {}).get("inline_keyboard") or []) if isinstance(r, list)],
                 caption=msg.get("caption") is not None or bool(msg.get("document") or msg.get("photo")))
