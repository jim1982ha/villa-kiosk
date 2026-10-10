"""Everything that reaches a chat, and whether it did: one module, whoever is sending.

⚠️ ONE ANSWER TO "DID IT ARRIVE" (architecture review, 2026-10-06). Five callers each sent through their own
rules — the AI's send_message, a script's result (outcome.py), a conversation's reply, an AI job, the approvals —
and they disagreed where it mattered:
  - the AI was told "Sent." when Telegram had refused the message, and a script's result counted it as sent;
  - a report asked for in a chat that failed sent its reason, then its "being prepared" message ALSO turned into
    "ended without a result": two messages for one failure, the case job_notices.py exists to prevent.
Now `send` returns the message id, or None when nothing arrived (Telegram off, or refused), and every caller
reads that one answer. A message sent on behalf of a job asked for in a chat (an Origin of kind JOB) is that
job's result whatever it says — its report, its daily text, or why it could not run — and chat_jobs.py, told by
`on_job_result`, takes its "being prepared" message away (architecture review 12: the waiting message and the job's
"typing…" were kept here, keyed by chat; they are chat_jobs.ChatJobs's now).

Also here, because they are what a chat SEES of the agent: the conversation's reply (the camera pictures the AI
looked at, its answer as the last one's caption) and "typing…" while the AI works.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import re
from datetime import datetime
from typing import AsyncIterator, Awaitable, Callable

from vesta_shared.messaging import TELEGRAM_LIMIT, split_message, tg_len

from .routing import JOB, Origin, Routing
from .telegram import TelegramError

log = logging.getLogger("vesta")

# Telegram's "typing…" lasts about 5 s. ⚠️ JUST PAST ITS END, NEVER INSIDE IT (owner, 2026-10-09, measured): every
# signal accepted in both runs, yet at 4.4 s apart the group showed it with long gaps and at 2.4 s apart a private chat
# never showed it at all — sent while the previous one still runs, Telegram does not pass it on. Every 5.5 s each one
# arrives once the last has ended.
TYPING_EVERY_S = 5.5
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


def fit(text: str, limit: int = TELEGRAM_LIMIT) -> str:
    """One message's text at most `limit` (Telegram's units), cut between lines with "…" — for an edit, which cannot
    be split as a send is."""
    if tg_len(text) <= limit:
        return text
    head = split_message(text, limit - 2)[0]
    return head.rstrip() + "\n…"


def typing_timeline(times: list[tuple[float, float, bool]]) -> str:
    """Every "typing…" of a job, for the log: its time, how long Telegram took when that was over a second (and a
    refusal), then the longest silence between two of them — over Telegram's 5 seconds, the sign went out."""
    if not times:
        return "none sent"
    parts = []
    for at, took, ok in times:
        p = datetime.fromtimestamp(at).strftime("%H:%M:%S")
        if took >= 1:
            p += f" (Telegram took {took:.1f} s)"
        if not ok:
            p += " (refused)"
        parts.append(p)
    gaps = [(b[0] - a[0], a[0]) for a, b in zip(times, times[1:])]
    longest = max(gaps) if gaps else (0.0, times[0][0])
    return (", ".join(parts) + f"; longest gap {longest[0]:.1f} s after "
            f"{datetime.fromtimestamp(longest[1]).strftime('%H:%M:%S')}")


class Delivery:
    def __init__(self, tg, state, policy: Callable):
        self.tg = tg                  # telegram.Telegram, or None when the takeover is off: nothing is sent
        self.state = state
        self.policy = policy
        # a message sent on behalf of a job asked for in a chat is its result: chat_jobs.ChatJobs.result, set by it
        self.on_job_result: Callable[[Origin], Awaitable[None]] | None = None
        self._waiting: dict[int, dict] = {}   # chat → its one "typing…" loop and what holds it (hold)

    # ------------------------------------------------------------------ one message
    async def send(self, chat_id: int, text: str, *, keyboard: dict | None = None, document: str | None = None, photo: Photo | None = None, origin: Origin | None = None) -> int | None:
        """The message's id, or None: nothing arrived. `origin`: on whose behalf — a job asked for in a chat
        (kind JOB) makes this its result, which replaces the chat's "being prepared" message."""
        if self.tg is None:
            self.state.log("send_skipped", {"chat": chat_id, "reason": "Telegram is off (\"Agent replies on Telegram\" is off)"})
            log.info("Telegram off: a message for chat %s was not sent", chat_id)
            return None
        try:
            ids = await self.tg.send(int(chat_id), plain_text(text), keyboard=keyboard, document=document,
                                     photo_b64=photo)
        except TelegramError as e:
            ids = e.delivered
            log.warning("send failed%s: %s", f" after {len(ids)} part(s) arrived" if ids else "", e)
            self.state.log("send_failed", {"chat": chat_id, "error": str(e), "parts_arrived": len(ids)})
            if not ids:
                # ⚠️ NAMED ON THE OVERVIEW (owner, 2026-10-10): with every chat of a role in People, a person who never
                # sent /start to the bot silently missed every message meant for them. Only when TELEGRAM refused the
                # chat (architecture review 18): a network blip at 01:30 said "send /start" all day.
                if getattr(e, "refused", False):
                    self.state.set_unreachable(chat_id, str(e))
                return None
            # ⚠️ PARTLY ARRIVED IS NOT "NOTHING ARRIVED" (architecture review 15): a reply whose picture and first part
            # arrived was sent again whole, with "the picture could not be sent" — the person read it twice
        # ⚠️ EVERY PART IS THE AGENT'S (architecture review 15): only the last was remembered, so in a group a reply to
        # the first part of a long answer was taken for people talking to each other, and dropped without a word
        for mid in ids:
            self.state.remember_message(chat_id, mid)
        mid = ids[-1] if ids else None
        if not mid:
            return None
        self.state.set_unreachable(chat_id, None)
        self.state.job_delivered()                              # a scheduled run's message arrived: never run twice
        log.info("Sent to chat %s (%s)%s%s%s", chat_id, Routing(self.policy()).label(chat_id),
                 " with buttons" if keyboard else "", " and a file" if document else "", " and a photo" if photo else "")
        if origin is not None and origin.kind == JOB and self.on_job_result:
            await self.on_job_result(origin)                    # its waiting message goes, its "typing…" stops
        return mid

    # ------------------------------------------------------------------ a message already there
    # ⚠️ ONE WAY TO TELEGRAM FOR A MESSAGE'S WHOLE LIFE (architecture review 15, 2026-10-10): sending came here, but the
    # incident thread, the chat jobs and the button presses edited and deleted on Telegram themselves — each deciding
    # again whether Telegram was on, cutting a long text where a send splits it, and skipping plain_text.
    async def edit(self, chat_id: int, message_id: int, text: str, keyboard: dict | None = None) -> bool:
        """Rewrite one of the agent's messages (its buttons go, or become `keyboard`), as a send would show it: plain
        text, and — one message cannot be split — at most Telegram's limit, cut between lines. False: Telegram is off,
        or refused."""
        if self.tg is None:
            return False
        text = fit(plain_text(text))
        ok = await self.tg.edit(int(chat_id), int(message_id), text, keyboard)
        if not ok:
            self.state.log("edit_refused", {"chat": chat_id, "message": message_id})
        return bool(ok)

    async def delete(self, chat_id: int, message_id: int) -> bool:
        """Delete one of the agent's messages. False: Telegram is off, or refused (past its 48 hours)."""
        if self.tg is None:
            return False
        return bool(await self.tg.delete(int(chat_id), int(message_id)))

    async def toast(self, callback_id: str | None, text: str) -> None:
        """The short notice over a pressed button."""
        if self.tg is not None and callback_id:
            await self.tg.answer_callback(str(callback_id), text)

    # ------------------------------------------------------------------ a conversation's reply
    async def reply(self, chat_id: int, text: str, *, keyboard: dict | None = None,
                    photos: list[Photo] | tuple = ()) -> int | None:
        """The answer to a person, with the camera pictures the AI looked at (the last PHOTOS_PER_REPLY): the
        answer is the last one's caption, or follows them when it carries the Continue button. A picture
        Telegram refuses does not take the answer with it."""
        photos = list(photos)[-PHOTOS_PER_REPLY:]
        if not (text or keyboard):
            # ⚠️ NO WORDS, STILL THE PICTURES (architecture review 19): a reply whose sentence was dropped (an approval
            # request shown in the chat says it all) lost the camera picture asked for with it
            mid = None
            for p in photos:
                mid = await self.send(chat_id, "", photo=p) or mid
            return mid
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
        return mid

    # ⚠️ ONE "TYPING…" FOR EVERY WAIT (owner, 2026-10-10: "make sure each message sent to the agent triggers this Typing
    # notification in a consistent way, for all the time the user is waiting for any reply ... coded one time"). A chat
    # is WAITING while anything holds it — a message being read (a photo fetched, a voice message transcribed), the AI
    # answering, a report being made — and shows "typing…" from the first hold to the last release, by ONE loop: two
    # loops in one chat hide each other (measured 2026-10-09). The conversation's own and a job's were two mechanisms
    # (here and chat_jobs.py); a photo's download ran before either, 2.6 s with nothing shown (villa, 12:32).
    def hold(self, chat_id: int, label: str | None = None) -> Callable[[], None]:
        """The chat waits for the agent from now: "typing…" shows until every hold of it is released. Returns the
        release (safe to call twice). `label`: a job's name, for the loop's account in the log at its end."""
        if self.tg is None:
            return lambda: None
        chat = int(chat_id)
        w = self._waiting.get(chat)
        if w is None:
            w = {"stop": asyncio.Event(), "holds": {}, "labels": set()}
            w["task"] = asyncio.create_task(self.typing_loop(chat, w["stop"], w["labels"]))
            self._waiting[chat] = w
        token = object()
        w["holds"][token] = label
        if label:
            w["labels"].add(label)

        def release() -> None:
            if w["holds"].pop(token, False) is False:
                return                                    # released already
            if not w["holds"]:
                w["stop"].set()
                if self._waiting.get(chat) is w:
                    self._waiting.pop(chat, None)
        return release

    @contextlib.asynccontextmanager
    async def typing(self, chat_id: int, held: Callable[[], None] | None = None) -> AsyncIterator[Callable[[], None]]:
        """"typing…" in the chat until the block ends or the yielded stop() is called (owner, 2026-10-06: "like if
        it was starting to write"): a hold (above). `held`: one taken earlier, when the wait began before this block —
        the message arrived, then its photo was fetched."""
        release = held or self.hold(chat_id)
        try:
            yield release
        finally:
            release()

    async def typing_loop(self, chat_id: int, stop: asyncio.Event, labels: set[str] | None = None) -> None:
        """One chat's "typing…", said again every TYPING_EVERY_S until `stop`. `labels`: the jobs that held it, for
        the account the loop gives at its end (how many were sent, and when)."""
        said = False
        sent = accepted = 0
        last = None
        times: list[tuple[float, float, bool]] = []         # (sent at, seconds Telegram took, accepted)
        loop = asyncio.get_running_loop()
        while not stop.is_set():
            t0 = loop.time()
            at = datetime.now()
            ok = await self.tg.typing(int(chat_id))
            times.append((at.timestamp(), loop.time() - t0, bool(ok)))
            sent += 1
            if ok:
                accepted += 1
                last = at.strftime("%H:%M:%S")
            if ok and not said:
                # ⚠️ PROOF IT WAS SHOWN (owner, 2026-10-07: "no typing indication", and the log had no refusal either):
                # one line per answer when Telegram accepts it, so "not seen" can be told from "not sent"
                said = True
                log.info("\"typing…\" accepted by Telegram in chat %s", chat_id)
            try:
                await asyncio.wait_for(stop.wait(), timeout=TYPING_EVERY_S)
            except asyncio.TimeoutError:
                pass
        job = ", ".join(sorted(labels or ()))
        if job:
            # ⚠️ SAID AT THE END (villa, 2026-10-09 15:27: "typing…" vanished before the weekly report came, and the log
            # held only the first one): whether the repeats ran until the result, or stopped early
            log.info("\"typing…\" for %s in chat %s: sent %d times, %d accepted, last accepted at %s",
                     job, chat_id, sent, accepted, last or "never")
            # ⚠️ EVERY ONE, WITH ITS TIME (owner, 2026-10-09 16:21: "no signal at all from a certain point" while the count
            # said 34 of 34): the count could not tell an even spread from bursts with long silences between them
            log.info("\"typing…\" for %s in chat %s: %s", job, chat_id, typing_timeline(times))
