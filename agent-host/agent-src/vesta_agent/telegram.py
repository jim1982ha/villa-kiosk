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

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Callable

import aiohttp

from vesta_shared.message_format import telegram_entities
from vesta_shared.limits import limit
from vesta_shared.messaging import TELEGRAM_CAPTION, split_message, telegram_caption_chars, tight_punctuation, telegram_message_chars


log = logging.getLogger("vesta.telegram")


class TelegramError(RuntimeError):
    def __init__(self, *a, delivered: list[int] | None = None, refused: bool = False):
        super().__init__(*a)
        # the messages that DID arrive before it failed (a long reply cut in parts): never "nothing arrived"
        self.delivered: list[int] = list(delivered or [])
        # Telegram itself refused this CHAT (blocked, never started, no such chat, a group whose id changed) — not the
        # network, not the message: the only failure that says a person must act (the Overview's "not reached")
        self.refused = refused


#: Telegram's words when the chat itself cannot be written to (a 403 always is one).
CHAT_REFUSED = ("chat not found", "upgraded to a supergroup", "peer_id_invalid", "bot was kicked", "not a member")


def _failed(method: str, body: dict) -> TelegramError:
    code, words = body.get("error_code"), str(body.get("description") or "")
    refused = code == 403 or (code == 400 and any(w in words.lower() for w in CHAT_REFUSED))
    return TelegramError(f"{method}: {code} {words}", refused=refused)


#: Telegram's words when an edit changes nothing (it already shows this), or targets a photo's or a file's caption.
NOT_MODIFIED, NO_TEXT = "message is not modified", "no text in the message to edit"

#: A photo's or a file's caption: the first part of its text — its value when the agent started; the code reads
#: telegram_caption_chars() at each use (the villa's limit, changed on the page without a restart)
CAPTION = TELEGRAM_CAPTION


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
    text = tight_punctuation(text or "")       # one style before ":" in every language (messaging.tight_punctuation)
    parts: list[Part] = []
    if media:
        head = split_message(text, telegram_caption_chars()) if text else [""]
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
        return await self._call(method, lambda: {"json": data})

    async def _post_form(self, method: str, form) -> dict:
        """A file upload (sendDocument, sendPhoto). ⚠️ FAILS AS api() FAILS: these posted directly, so a network
        error escaped as something other than TelegramError, past every caller's `except TelegramError`. `form`: a
        callable making the form, since a form once posted cannot be posted again (the retry, `_call`)."""
        return await self._call(method, lambda: {"data": form()}) or {}

    async def _call(self, method: str, request: Callable[[], dict]) -> Any:
        """One call to Telegram, tried a second time when the first did not get through for a moment.

        ⚠️ A "SLOW DOWN" IS WAITED OUT, A BLIP TRIED AGAIN (architecture review, round 9: Telegram's "too many
        requests, retry in 3s" stopped an answer with four pictures after the second, and a report was never sent
        again; only the alert cards and the tablet's copies had a retry of their own). A 429 is waited out for the
        time Telegram names, when it is within telegram.retry_wait_max_s; a 5xx, a timeout or a network error is
        tried once more after telegram.retry_pause_s. A 4xx refusal is never tried again: the same call would be
        refused the same way. A long message is sent part by part through here, so a part tried again never sends
        the parts before it a second time."""
        assert self.http is not None
        for attempt in (1, 2):
            wait = None
            try:
                async with self.http.post(f"{self.base}/{method}", **request()) as r:
                    status = getattr(r, "status", None)
                    body = await r.json(content_type=None)
            except Exception as e:  # never log the URL: it holds the token
                error, wait = TelegramError(f"{method}: {type(e).__name__}"), retry_pause_s()
            else:
                if not isinstance(body, dict):
                    body = {"ok": False, "error_code": status, "description": f"HTTP {status}"}
                if body.get("ok"):
                    return body.get("result")
                code = body.get("error_code")
                if code == 409:
                    raise TelegramError("409 Conflict: a program is reading this bot with getUpdates while Home Assistant receives it")
                error = _failed(method, body)
                if code == 429:
                    after = (body.get("parameters") or {}).get("retry_after")
                    if isinstance(after, (int, float)) and not isinstance(after, bool) and 0 <= after <= retry_wait_max_s():
                        wait = after
                elif isinstance(code, int) and code >= 500:
                    wait = retry_pause_s()
            if wait is None or attempt == 2:
                raise error
            log.warning("%s, tried again in %ss", error, wait)
            await asyncio.sleep(wait)
        raise AssertionError("unreachable")

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
                raise TelegramError(str(e), delivered=ids, refused=e.refused) from None
            if res.get("message_id"):
                ids.append(res["message_id"])
        return ids

    async def _part(self, chat_id: int, part: Part, document: str | None, photo_b64) -> dict:
        if part.media:
            def form(name, content, **file) -> aiohttp.FormData:
                f = aiohttp.FormData()
                f.add_field("chat_id", str(chat_id))
                f.add_field("caption", part.text)
                for k, v in _italic("caption_entities", part.text).items():
                    f.add_field(k, json.dumps(v))
                if part.keyboard:
                    f.add_field("reply_markup", json.dumps(part.keyboard))
                if part.reply_to:
                    f.add_field("reply_parameters", json.dumps({"message_id": part.reply_to, "allow_sending_without_reply": True}))
                f.add_field(name, content, **file)
                return f
            if part.media == "document":
                try:
                    with open(document, "rb") as f:
                        content = f.read()
                except OSError as e:
                    raise TelegramError(f"sendDocument: the file cannot be read ({type(e).__name__})") from None
                return await self._post_form("sendDocument", lambda: form(
                    "document", content, filename=os.path.basename(document)))
            import base64
            data_b64, mime = photo_b64
            photo = base64.b64decode(data_b64)
            # refused: an error, never the caption alone
            return await self._post_form("sendPhoto", lambda: form(
                "photo", photo, filename="snapshot.jpg", content_type=mime or "image/jpeg"))
        data: dict[str, Any] = {"chat_id": chat_id, "text": part.text, **_italic("entities", part.text)}
        if part.keyboard:
            data["reply_markup"] = part.keyboard
        if part.reply_to:
            data["reply_parameters"] = {"message_id": part.reply_to, "allow_sending_without_reply": True}
        return await self.api("sendMessage", **data) or {}

    async def download(self, file_id: str, limit: int | None = None) -> bytes:
        """A file a person sent, by the id Home Assistant's telegram_attachment event gave.
        Telegram serves a bot files up to 20 MB."""
        limit = limit or download_max_bytes()
        assert self.http is not None
        info = await self.api("getFile", file_id=file_id)
        path = (info or {}).get("file_path")
        if not path or (info.get("file_size") or 0) > limit:
            raise TelegramError(f"getFile: no file, or larger than {limit // 1048576} MB")
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
            await self.api("answerCallbackQuery", callback_query_id=callback_id, text=text[:toast_chars()], show_alert=False)
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

    async def buttons(self, chat_id: int, message_id: int, keyboard: dict | None) -> bool:
        """Put `keyboard` under one of the bot's messages (None: its buttons go), its text or file untouched — a page
        sent with its message gets the buttons of its answer (app._converse). False when Telegram refuses."""
        try:
            await self.api("editMessageReplyMarkup", chat_id=chat_id, message_id=message_id,
                           reply_markup=keyboard or {"inline_keyboard": []})
            return True
        except TelegramError as e:
            if NOT_MODIFIED in str(e):
                return True
            log.warning("editMessageReplyMarkup failed: %s", e)
            return False

    async def edit(self, chat_id: int, message_id: int, text: str, keyboard: dict | None = None) -> bool:
        """Rewrite one of the bot's messages: its buttons go, or become `keyboard`. False when Telegram refuses."""
        text = tight_punctuation(text)
        extra = {"reply_markup": keyboard} if keyboard else {}
        try:
            await self.api("editMessageText", chat_id=chat_id, message_id=message_id, text=text[:telegram_message_chars()], **extra,
                           **_italic("entities", text[:telegram_message_chars()]))
            return True
        except TelegramError as e:
            if NOT_MODIFIED in str(e):
                return True                         # it already says this: shown
            if NO_TEXT not in str(e):
                log.warning("editMessageText failed: %s", e)
                return False
        # ⚠️ A PHOTO'S OR A FILE'S MESSAGE HAS A CAPTION, NOT A TEXT (architecture review 21): editMessageText is refused
        # there, every time — an alert sent with its file kept its buttons for good
        try:
            await self.api("editMessageCaption", chat_id=chat_id, message_id=message_id, caption=text[:telegram_caption_chars()],
                           **extra, **_italic("caption_entities", text[:telegram_caption_chars()]))
            return True
        except TelegramError as e:
            if NOT_MODIFIED in str(e):
                return True
            log.warning("editMessageCaption failed: %s", e)
            return False

def _italic(key: str, text: str) -> dict:
    """{key: how Telegram shows this message} — the one style table, vesta_shared.message_format.TELEGRAM — else {}.

    ⚠️ A STYLE THAT FAILS LEAVES THE WORDS (owner, 2026-10-23: the layout must never block a message): reading the
    message's parts raised, and the send raised with it — the chat got nothing. It goes unstyled."""
    try:
        found = telegram_entities(text)
    except Exception:  # noqa: BLE001 — whatever the style table raised, the message still goes
        log.exception("A message's style could not be worked out: it goes unstyled")
        return {}
    return {key: found} if found else {}


def dump(obj: Any) -> str:
    return json.dumps(obj, default=str)[:limit(
        "errors.telegram_answer_chars", 500, unit="characters", group="keep", lo=100, hi=20000,
        says="How much of an answer of Telegram's is kept when it refuses something (the log).",
        reached="The rest is cut.", told="")]


def download_max_bytes() -> int:
    return limit("telegram.download_bytes", 20971520, unit="bytes", group="ai", lo=1048576, hi=20971520,
                 says="The largest file a person sends that the agent fetches (Telegram serves a bot 20 MB at most).",
                 reached="The file is not fetched; the person is told.", told="person")


def toast_chars() -> int:
    return limit("telegram.toast_chars", 190, unit="characters", group="text", lo=20, hi=200,
                 says="The longest short notice shown at the top of Telegram after a button press (Telegram's own "
                      "maximum is 200).",
                 reached="The rest of the notice is cut.", told="")


def retry_wait_max_s() -> int:
    return limit("telegram.retry_wait_max_s", 30, unit="seconds", group="run", lo=0, hi=300,
                 says="The longest the agent waits when Telegram asks it to slow down (\"too many requests, retry in 3s\") "
                      "before sending the message again.",
                 reached="A longer wait is not made: that message is not sent, and the agent's log says so.", told="")


def retry_pause_s() -> int:
    return limit("telegram.retry_pause_s", 2, unit="seconds", group="run", lo=0, hi=60,
                 says="How long the agent waits before sending a message a second time when Telegram did not answer "
                      "(a network blip, Telegram busy).",
                 reached="A longer pause: such a message arrives that much later.", told="")
