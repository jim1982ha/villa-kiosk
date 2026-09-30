"""Telegram Bot API, SEND ONLY.

⚠️ HOME ASSISTANT IS THE ONE RECEIVER OF THE VILLA BOT, FOR GOOD. Telegram gives
a bot one receiver; Home Assistant's telegram_bot integration is it, and its
automations (the gate button, any other) depend on it. The agent reads messages
and button presses from the events Home Assistant fires for them (ha_events.py)
and only SENDS here. So this module never calls getUpdates, and never leaveChat:
leaving a group would take the villa bot — and Home Assistant's alerts — out of it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

import aiohttp

from vesta_shared.messaging import split_message

log = logging.getLogger("vesta.telegram")


class TelegramError(RuntimeError):
    pass


class Telegram:
    def __init__(self, token: str):
        self.token = token
        self.base = f"https://api.telegram.org/bot{token}"
        self.http: aiohttp.ClientSession | None = None
        self.username: str | None = None
        self.bot_id: int | None = None

    async def open(self):
        self.http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=75))
        me = await self.api("getMe")
        self.username, self.bot_id = me.get("username"), me.get("id")
        return me

    async def close(self):
        if self.http:
            await self.http.close()

    async def api(self, method: str, **data) -> Any:
        assert self.http is not None
        try:
            async with self.http.post(f"{self.base}/{method}", json=data) as r:
                body = await r.json(content_type=None)
        except Exception as e:  # never log the URL: it holds the token
            raise TelegramError(f"{method}: {type(e).__name__}") from None
        if not body.get("ok"):
            if body.get("error_code") == 409:
                raise TelegramError("409 Conflict: a program is reading this bot with getUpdates while Home Assistant receives it")
            raise TelegramError(f"{method}: {body.get('error_code')} {body.get('description')}")
        return body.get("result")

    async def send(self, chat_id: int, text: str, keyboard: dict | None = None, document: str | None = None,
                   photo_b64: tuple[str, str] | None = None, reply_to: int | None = None) -> int | None:
        """Send text (split at Telegram's 4,096 characters); the keyboard goes on the last part. Returns its message id."""
        last_id = None
        if document:
            assert self.http is not None
            form = aiohttp.FormData()
            form.add_field("chat_id", str(chat_id))
            form.add_field("caption", text[:1000])
            form.add_field("document", open(document, "rb"), filename=os.path.basename(document))
            async with self.http.post(f"{self.base}/sendDocument", data=form) as r:
                body = await r.json(content_type=None)
            if not body.get("ok"):
                raise TelegramError(f"sendDocument: {body.get('description')}")
            if len(text) <= 1000:
                return body["result"]["message_id"]
            text = text[1000:]
        if photo_b64:
            import base64
            assert self.http is not None
            data_b64, mime = photo_b64
            form = aiohttp.FormData()
            form.add_field("chat_id", str(chat_id))
            form.add_field("caption", text[:1000])
            form.add_field("photo", base64.b64decode(data_b64), filename="snapshot.jpg", content_type=mime or "image/jpeg")
            async with self.http.post(f"{self.base}/sendPhoto", data=form) as r:
                body = await r.json(content_type=None)
            if body.get("ok"):
                return body["result"]["message_id"]
        parts = split_message(text or "…")
        for i, part in enumerate(parts):
            data: dict[str, Any] = {"chat_id": chat_id, "text": part}
            if keyboard and i == len(parts) - 1:
                data["reply_markup"] = keyboard
            if reply_to and i == 0:
                data["reply_parameters"] = {"message_id": reply_to, "allow_sending_without_reply": True}
            res = await self.api("sendMessage", **data)
            last_id = res.get("message_id")
        return last_id

    async def answer_callback(self, callback_id: str, text: str):
        try:
            await self.api("answerCallbackQuery", callback_query_id=callback_id, text=text[:190], show_alert=False)
        except TelegramError as e:
            log.warning("answerCallbackQuery failed: %s", e)

    async def edit(self, chat_id: int, message_id: int, text: str):
        try:
            await self.api("editMessageText", chat_id=chat_id, message_id=message_id, text=text[:4096])
        except TelegramError as e:
            log.warning("editMessageText failed: %s", e)

def dump(obj: Any) -> str:
    return json.dumps(obj, default=str)[:500]
