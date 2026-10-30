"""A message Telegram refuses for a moment is sent again, once, never twice (architecture review, round 9: a "too many
requests, retry in 3s" stopped an answer with four pictures after the second, and a report was never sent again).

The real adapter (vesta_agent.telegram.Telegram) on a scripted HTTP session: what Telegram answered to each call."""
from __future__ import annotations

import asyncio

import aiohttp
import pytest

from vesta_agent import telegram as T
from vesta_agent.telegram import Telegram, TelegramError, layout

OK = "ok"


def ok(mid: int) -> dict:
    return {"ok": True, "result": {"message_id": mid}}


class _Answer:
    def __init__(self, body, status):
        self.body, self.status = body, status

    async def __aenter__(self):
        if isinstance(self.body, BaseException):
            raise self.body
        return self

    async def __aexit__(self, *a):
        return False

    async def json(self, content_type=None):
        return self.body


class Session:
    """Telegram's answers, one per call, in order; `posts` what each call carried (its method and text or form)."""

    def __init__(self, answers):
        self.answers, self.posts = list(answers), []

    def post(self, url, json=None, data=None):
        self.posts.append((url.rsplit("/", 1)[-1], (json or {}).get("text") if json is not None else data))
        body = self.answers.pop(0)
        status = body.get("error_code", 200) if isinstance(body, dict) else 0
        return _Answer(body, status)


@pytest.fixture
def waits(monkeypatch):
    waited = []

    async def sleep(s):
        waited.append(s)
    monkeypatch.setattr(T.asyncio, "sleep", sleep)
    return waited


def bot(answers) -> tuple[Telegram, Session]:
    tg = Telegram("42:TEST")
    tg.http = Session(answers)
    return tg, tg.http


def test_a_slow_down_is_waited_out_and_the_message_arrives_once(waits):
    tg, s = bot([{"ok": False, "error_code": 429, "description": "Too Many Requests: retry after 1",
                  "parameters": {"retry_after": 1}}, ok(7)])
    assert asyncio.run(tg.send(100, "Hello")) == [7]
    assert waits == [1]
    assert [m for m, _ in s.posts] == ["sendMessage", "sendMessage"]       # refused, then sent: one message arrived


def test_a_long_message_cut_by_a_blip_goes_on_from_the_part_that_failed(waits):
    text = "\n\n".join(c * 3000 for c in "abc")
    parts = [p.text for p in layout(text)]
    assert len(parts) == 3
    tg, s = bot([ok(1), {"ok": False, "error_code": 502, "description": "Bad Gateway"}, ok(2), ok(3)])
    assert asyncio.run(tg.send(100, text)) == [1, 2, 3]
    sent = [t for _, t in s.posts]
    assert sent == [parts[0], parts[1], parts[1], parts[2]]                 # the first part never twice
    assert waits == [T.retry_pause_s()]


def test_a_network_error_is_tried_once_more_then_said(waits):
    tg, s = bot([aiohttp.ClientConnectionError(), aiohttp.ClientConnectionError()])
    with pytest.raises(TelegramError):
        asyncio.run(tg.send(100, "Hello"))
    assert len(s.posts) == 2


def test_a_refusal_is_never_tried_again(waits):
    tg, s = bot([{"ok": False, "error_code": 400, "description": "Bad Request: chat not found"}])
    with pytest.raises(TelegramError) as e:
        asyncio.run(tg.send(100, "Hello"))
    assert e.value.refused and len(s.posts) == 1 and waits == []


def test_a_wait_longer_than_the_setting_is_not_made(waits):
    tg, s = bot([{"ok": False, "error_code": 429, "description": "Too Many Requests",
                  "parameters": {"retry_after": T.retry_wait_max_s() + 1}}])
    with pytest.raises(TelegramError):
        asyncio.run(tg.send(100, "Hello"))
    assert len(s.posts) == 1 and waits == []


def test_a_picture_is_sent_again_with_a_new_form(waits):
    import base64
    tg, s = bot([{"ok": False, "error_code": 500, "description": "Internal Server Error"}, ok(9)])
    assert asyncio.run(tg.send(100, "Gate", photo_b64=(base64.b64encode(b"jpg").decode(), "image/jpeg"))) == [9]
    (m1, f1), (m2, f2) = s.posts
    assert m1 == m2 == "sendPhoto" and f1 is not f2                         # a form once posted cannot be posted again
