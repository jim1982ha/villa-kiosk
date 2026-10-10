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
from dataclasses import dataclass
from typing import Any

import aiohttp

from vesta_shared.messaging import split_message


log = logging.getLogger("vesta.telegram")


class TelegramError(RuntimeError):
    def __init__(self, *a, delivered: list[int] | None = None):
        super().__init__(*a)
        # the messages that DID arrive before it failed (a long reply cut in parts): never "nothing arrived"
        self.delivered: list[int] = list(delivered or [])


#: A photo's or a file's caption: the first part of its text (Telegram takes 1,024; kept under it).
CAPTION = 1000


@dataclass(frozen=True)
class Part:
    """One call to Telegram of a message: `media` "photo", "document" or None (text only)."""
    text: str
    media: str | None = None
    keyboard: dict | None = None
    reply_to: int | None = None


def layout(text: str, keyboard: dict | None = None, media: str | None = None, reply_to: int | None = None) -> list[Part]:
    """How one message reaches Telegram, in order: a photo or a file first with the start of the text as its caption,
    the rest of the text in parts it takes, the buttons on the LAST part, the reply on the first. Pure: the real
    Telegram and the tests' fake both send what it says.

    ⚠️ ONE LAYOUT (architecture review 15, 2026-10-10): it was decided inside the HTTP calls and never tested — the
    buttons of a message with a file were dropped (the file's form never carried them), a long list went out before
    its introduction, and the fake kept rules of its own."""
    text = text or ""
    parts: list[Part] = []
    if media:
        head = split_message(text, CAPTION) if text else [""]
        rest = text[len(head[0]):].lstrip("\n") if len(head) > 1 else ""
        parts.append(Part(head[0], media))
        text = rest
        if not text:
            return [Part(parts[0].text, media, keyboard, reply_to)]
    parts += [Part(p) for p in split_message(text or "…")]
    first = parts[0]
    parts[0] = Part(first.text, first.media, first.keyboard, reply_to)
    parts[-1] = Part(parts[-1].text, parts[-1].media, keyboard, parts[-1].reply_to)
    return parts


class Telegram:
    def __init__(self, token: str):
        self.token = token
        self.base = f"https://api.telegram.org/bot{token}"
        self.http: aiohttp.ClientSession | None = None
        self.username: str | None = None
        self.bot_id: int | None = None
        self._typing_warned: dict[str, float] = {}

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

    async def _post_form(self, method: str, form: aiohttp.FormData) -> dict:
        """A file upload (sendDocument, sendPhoto). ⚠️ FAILS AS api() FAILS: these posted directly, so a network
        error escaped as something other than TelegramError, past every caller's `except TelegramError`."""
        assert self.http is not None
        try:
            async with self.http.post(f"{self.base}/{method}", data=form) as r:
                body = await r.json(content_type=None)
        except Exception as e:  # never log the URL: it holds the token
            raise TelegramError(f"{method}: {type(e).__name__}") from None
        if not body.get("ok"):
            raise TelegramError(f"{method}: {body.get('error_code')} {body.get('description')}")
        return body.get("result") or {}

    async def send(self, chat_id: int, text: str, keyboard: dict | None = None, document: str | None = None,
                   photo_b64: tuple[str, str] | None = None, reply_to: int | None = None) -> list[int]:
        """Send one message as `layout` says, with at most one file or one photo. Returns the id of EVERY message it
        made, in order (a reply to any of them is a reply to the agent). Any failure is a TelegramError, carrying the
        ids that did arrive before it (`delivered`)."""
        if document and photo_b64:
            raise TelegramError("one file or one photo per message")
        ids: list[int] = []
        for part in layout(text, keyboard, "document" if document else "photo" if photo_b64 else None, reply_to):
            try:
                res = await self._part(chat_id, part, document, photo_b64)
            except TelegramError as e:
                raise TelegramError(str(e), delivered=ids) from None
            if res.get("message_id"):
                ids.append(res["message_id"])
        return ids

    async def _part(self, chat_id: int, part: Part, document: str | None, photo_b64) -> dict:
        if part.media:
            form = aiohttp.FormData()
            form.add_field("chat_id", str(chat_id))
            form.add_field("caption", part.text)
            if part.keyboard:
                form.add_field("reply_markup", json.dumps(part.keyboard))
            if part.reply_to:
                form.add_field("reply_parameters", json.dumps({"message_id": part.reply_to, "allow_sending_without_reply": True}))
            if part.media == "document":
                try:
                    with open(document, "rb") as f:
                        form.add_field("document", f.read(), filename=os.path.basename(document))
                except OSError as e:
                    raise TelegramError(f"sendDocument: the file cannot be read ({type(e).__name__})") from None
                return await self._post_form("sendDocument", form)
            import base64
            data_b64, mime = photo_b64
            form.add_field("photo", base64.b64decode(data_b64), filename="snapshot.jpg", content_type=mime or "image/jpeg")
            return await self._post_form("sendPhoto", form)     # refused: an error, never the caption alone
        data: dict[str, Any] = {"chat_id": chat_id, "text": part.text}
        if part.keyboard:
            data["reply_markup"] = part.keyboard
        if part.reply_to:
            data["reply_parameters"] = {"message_id": part.reply_to, "allow_sending_without_reply": True}
        return await self.api("sendMessage", **data) or {}

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

    async def typing(self, chat_id: int) -> bool:
        """Telegram's "typing…" under the chat's name, for about 5 s or until the bot's next message. True when
        Telegram accepted it."""
        try:
            await self.api("sendChatAction", chat_id=chat_id, action="typing")
            return True
        except TelegramError as e:
            # ⚠️ SAID, NOT HIDDEN (owner, 2026-10-07: "I don't see typing…" and the log could not tell why — this was
            # logged at debug only). Once per 10 minutes per reason, so a refusal repeated every 4 s is one line.
            import time
            now, why = time.monotonic(), str(e)
            if now - self._typing_warned.get(why, -1e9) >= 600:
                self._typing_warned[why] = now
                log.warning("Telegram refused \"typing…\" in chat %s: %s", chat_id, why)
            return False

    async def edit(self, chat_id: int, message_id: int, text: str, keyboard: dict | None = None) -> bool:
        """Rewrite one of the bot's messages: its buttons go, or become `keyboard`. False when Telegram refuses."""
        try:
            extra = {"reply_markup": keyboard} if keyboard else {}
            await self.api("editMessageText", chat_id=chat_id, message_id=message_id, text=text[:4096], **extra)
            return True
        except TelegramError as e:
            log.warning("editMessageText failed: %s", e)
            return False

def dump(obj: Any) -> str:
    return json.dumps(obj, default=str)[:500]
