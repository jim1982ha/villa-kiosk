"""A press, as every handler gets it (press.py; architecture review 2026-10-29): who pressed, on which message, its
words and buttons — read from Telegram's callback in ONE place, so the tablet's press (ticket 22 of "One inbox") is a
second reading, never a Telegram callback dressed up field by field."""
from __future__ import annotations

import os

from vesta_agent import press

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_a_telegram_callback_is_read_once_into_a_press():
    rows = [[{"text": "Investigate", "callback_data": "c:1"}, {"text": "No", "callback_data": "d:1"}]]
    q = {"user_id": 111, "from_first": "Jo", "message": {"message_id": 42, "caption": "The page", "document": {},
                                                          "reply_markup": {"inline_keyboard": rows}}}

    async def toast(_t):
        return None
    p = press.from_telegram(q, -100, None, ["1"], toast)
    assert (p.chat, p.mid, p.presser, p.name, p.words, p.rows, p.caption) == (-100, 42, 111, "Jo", "The page", rows, True)
    plain = press.from_telegram({"message": {"message_id": "7", "text": "Hello"}}, 5, None, [], toast)
    assert (plain.mid, plain.words, plain.rows, plain.caption, plain.name) == (7, "Hello", [], False, None)


