"""Telegram Bot API: SEND, and fetch a file a person sent (a voice message).

⚠️ HOME ASSISTANT IS THE ONE RECEIVER OF THE VILLA BOT, FOR GOOD. Telegram gives
a bot one receiver; Home Assistant's telegram_bot integration is it, and its
automations (the gate button, any other) depend on it. The agent reads messages
and button presses from the events Home Assistant fires for them (ha_events.py)
and only SENDS here. So this module never calls getUpdates, and never leaveChat:
leaving a group would take the villa bot — and Home Assistant's alerts — out of it.
The one read: a file Home Assistant's event named by its id (getFile, then the
file itself) — the voice message a person sent, which no event carries.
"""

from __future__ import annotations

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
            with open(document, "rb") as f:
                form.add_field("document", f.read(), filename=os.path.basename(document))
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
            if not body.get("ok"):
                # was a silent fall back to the caption alone: "here is the photo" with no photo
                raise TelegramError(f"sendPhoto: {body.get('description')}")
            if len(text) <= 1000:
                return body["result"]["message_id"]
            text = text[1000:]                               # a caption holds 1,000: the rest follows as text
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

    async def download(self, file_id: str, limit: int = 20 * 1024 * 1024) -> bytes:
        """A file a person sent, by the id Home Assistant's telegram_attachment event gave.
        Telegram serves a bot files up to 20 MB."""
        assert self.http is not None
        info = await self.api("getFile", file_id=file_id)
        path = (info or {}).get("file_path")
        if not path or (info.get("file_size") or 0) > limit:
            raise TelegramError("getFile: no file, or larger than 20 MB")
        try:
            async with self.http.get(f"https://api.telegram.org/file/bot{self.token}/{path}") as r:
                if r.status != 200:
                    raise TelegramError(f"file: HTTP {r.status}")
                return await r.read()
        except TelegramError:
            raise
        except Exception as e:  # never log the URL: it holds the token
            raise TelegramError(f"file: {type(e).__name__}") from None

    async def answer_callback(self, callback_id: str, text: str):
        try:
            await self.api("answerCallbackQuery", callback_query_id=callback_id, text=text[:190], show_alert=False)
        except TelegramError as e:
            log.warning("answerCallbackQuery failed: %s", e)

    async def delete(self, chat_id: int, message_id: int) -> bool:
        """Delete one of the bot's own messages (a bot may, for 48 hours). False when Telegram refuses."""
        try:
            await self.api("deleteMessage", chat_id=chat_id, message_id=message_id)
            return True
        except TelegramError as e:
            log.warning("deleteMessage failed: %s", e)
            return False

    async def typing(self, chat_id: int) -> None:
        """Telegram's "typing…" under the chat's name, for about 5 s or until the bot's next message."""
        try:
            await self.api("sendChatAction", chat_id=chat_id, action="typing")
        except TelegramError as e:
            log.debug("sendChatAction failed: %s", e)

    async def edit(self, chat_id: int, message_id: int, text: str):
        try:
            await self.api("editMessageText", chat_id=chat_id, message_id=message_id, text=text[:4096])
        except TelegramError as e:
            log.warning("editMessageText failed: %s", e)

def dump(obj: Any) -> str:
    return json.dumps(obj, default=str)[:500]
