"""Everything that reaches a chat, and whether it did: one module, whoever is sending.

⚠️ ONE ANSWER TO "DID IT ARRIVE" (architecture review, 2026-10-06). Five callers each sent through their own
rules — the AI's send_message, a script's result (outcome.py), a conversation's reply, an AI job, the approvals —
and they disagreed where it mattered:
  - the AI was told "Sent." when Telegram had refused the message, and a script's result counted it as sent;
  - a report asked for in a chat that failed sent its reason, then its "being prepared" message ALSO turned into
    "ended without a result": two messages for one failure, the case job_notices.py exists to prevent.
Now `send` returns the message id, or None when nothing arrived (Telegram off, or refused), and every caller
reads that one answer. A message sent on behalf of a job asked for in a chat (an Origin of kind JOB) is that
job's result whatever it says — its report, its daily text, or why it could not run — so it replaces the
chat's "being prepared" message (job_notices.py decides; this module carries it out).

Also here, because they are what a chat SEES of the agent: the conversation's reply (the camera pictures the AI
looked at, its answer as the last one's caption) and "typing…" while the AI works.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import re
from typing import AsyncIterator, Callable

from .job_notices import JobNotices
from .routing import JOB, Origin, Routing
from .telegram import TelegramError

log = logging.getLogger("vesta")

TYPING_EVERY_S = 4.0             # Telegram's "typing…" lasts about 5 s
PHOTOS_PER_REPLY = 4             # the camera pictures a reply carries, the last ones looked at
NO_PICTURE = "\n\n(The camera picture could not be sent.)"

Photo = tuple[str, str]          # (base64, mime)

_MD_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")


def plain_text(s: str) -> str:
    """What Telegram shows as written: the bot sends plain text, so Markdown the model
    writes anyway (**bold**, # headings, `code`, [links](url)) would appear raw."""
    if not s:
        return s
    s = _MD_LINK.sub(r"\1 (\2)", s)
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s, flags=re.S)
    s = re.sub(r"(?<!\w)__(.+?)__(?!\w)", r"\1", s, flags=re.S)
    s = re.sub(r"`{1,3}([^`]*)`{1,3}", r"\1", s)
    s = re.sub(r"(?m)^\s{0,3}#{1,6}\s+", "", s)
    return s


class Delivery:
    def __init__(self, tg, state, policy: Callable):
        self.tg = tg                  # telegram.Telegram, or None when the takeover is off: nothing is sent
        self.state = state
        self.policy = policy
        self.notices = JobNotices()

    # ------------------------------------------------------------------ one message
    async def send(self, chat_id: int, text: str, *, keyboard: dict | None = None, approval_id: str | None = None,
                   document: str | None = None, photo: Photo | None = None, origin: Origin | None = None) -> int | None:
        """The message's id, or None: nothing arrived. `origin`: on whose behalf — a job asked for in a chat
        (kind JOB) makes this its result, which replaces the chat's "being prepared" message."""
        if self.tg is None:
            self.state.log("send_skipped", {"chat": chat_id, "reason": "Telegram is off (telegram_takeover false)"})
            log.info("Telegram off: a message for chat %s was not sent", chat_id)
            return None
        try:
            mid = await self.tg.send(int(chat_id), plain_text(text), keyboard=keyboard, document=document,
                                     photo_b64=photo)
        except TelegramError as e:
            log.warning("send failed: %s", e)
            self.state.log("send_failed", {"chat": chat_id, "error": str(e)})
            return None
        if not mid:
            return None
        self.state.remember_message(chat_id, mid)
        log.info("Sent to chat %s (%s)%s%s%s", chat_id, Routing(self.policy()).label(chat_id),
                 " with buttons" if keyboard else "", " and a file" if document else "", " and a photo" if photo else "")
        if approval_id:
            self.state.set_approval_message(approval_id, mid)
        if origin is not None and origin.kind == JOB:
            await self._notice(int(chat_id), self.notices.result(int(chat_id)))
        return mid

    # ------------------------------------------------------------------ a conversation's reply
    async def reply(self, chat_id: int, text: str, *, keyboard: dict | None = None,
                    photos: list[Photo] | tuple = ()) -> int | None:
        """The answer to a person, with the camera pictures the AI looked at (the last PHOTOS_PER_REPLY): the
        answer is the last one's caption, or follows them when it carries the Continue button. A picture
        Telegram refuses does not take the answer with it."""
        photos = list(photos)[-PHOTOS_PER_REPLY:]
        if not (text or keyboard):
            return None
        if photos and text and not keyboard:
            for p in photos[:-1]:
                await self.send(chat_id, "", photo=p)
            mid = await self.send(chat_id, text, photo=photos[-1])
            if mid is None and self.tg is not None:
                mid = await self.send(chat_id, text + NO_PICTURE)
        else:
            for p in photos:
                await self.send(chat_id, "", photo=p)
            mid = await self.send(chat_id, text or "…", keyboard=keyboard)
        await self._notice(int(chat_id), self.notices.replied(int(chat_id), mid))
        return mid

    @contextlib.asynccontextmanager
    async def typing(self, chat_id: int) -> AsyncIterator[Callable[[], None]]:
        """"typing…" in the chat until the block ends or the yielded stop() is called (owner, 2026-10-06: "like if
        it was starting to write"). Telegram shows it about 5 s, so it is said again every TYPING_EVERY_S."""
        stop = asyncio.Event()

        async def loop():
            while not stop.is_set():
                await self.tg.typing(int(chat_id))
                try:
                    await asyncio.wait_for(stop.wait(), timeout=TYPING_EVERY_S)
                except asyncio.TimeoutError:
                    pass
        task = asyncio.create_task(loop()) if self.tg is not None else None
        try:
            yield stop.set
        finally:
            stop.set()
            if task:
                await task

    # ------------------------------------------------------------------ jobs asked for in a chat
    def job_started(self, chat_id: int, job: str) -> None:
        self.notices.started(int(chat_id), job)

    async def job_ended(self, chat_id: int, job: str) -> None:
        await self._notice(int(chat_id), self.notices.ended(int(chat_id), job))

    async def _notice(self, chat_id: int, step) -> None:
        """Carry out what job_notices.py decided about a "being prepared" message."""
        if step is None or self.tg is None:
            return
        what, mid, job = step
        if what == "delete":
            await self.tg.delete(chat_id, mid)
        else:
            await self.tg.edit(chat_id, mid, f"The {job} job ended without a result this time. Ask again in a moment.")
