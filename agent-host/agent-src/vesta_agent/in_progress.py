"""Work in progress: what runs, for whom, what it promised, whether its result arrived — and, at the next start, what
becomes of what a stop cut. Every kind of work, one module.

⚠️ ONE RECORD OF "RUNNING" (architecture review, round 2, 2026-10-16). A report cut by a restart was fixed four times
(reviews 21/22, engine 0.6.210–0.6.214), each time in its own place: a scheduled run kept a `jobrun:` row written by the
scheduler, a job asked for in a chat a `chatjob:` row and an in-memory table in chat_jobs.py, a question being answered
a third copy; "its result arrived" was told two ways (a context variable Delivery.send turned into a state write, and
ChatJobs.result); the same "cut = False / except CancelledError / finally" was written three times; and at start two
readers each applied their own rule. Here, once:

  Item            one piece of work: its kind, name, chat, start, the message that stands for it, what was asked
  kept(item)      the ONE bookkeeping around running it: recorded while it runs; a clean end (or a failure) clears
                  the record and says it ended; a stop (CancelledError) leaves the record for the next start
  arrived(origin) a message of it reached a chat (Delivery.send, the one caller): nothing is owed at the next start
  left(kinds)     at start: what the last stop cut, read once and cleared, each with ON_START's decision for its kind

The stored rows are the ones before (state.py owns their keys): `jobrun:<job key>` = the slot, `chatjob:<chat>:<name>`
= {"started", "mid"} or {"started", "asked"}. A row of an older engine ending "|delivered" is read as arrived.
"""
from __future__ import annotations

import asyncio
import contextlib
import contextvars
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable

from .routing import JOB

#: the kinds of work. HELD: a job on schedule holding the chats it sends to ("already being made" there) — memory only.
SCHEDULED, CHAT_JOB, ANSWER, HELD = "scheduled", "chat job", "answer", "held"
#: a chat's question being answered is kept under this name, beside the chat's jobs (an older engine's rows too)
ANSWER_NAME = "answer"
#: what the next start does with work a stop cut
AGAIN, TELL, NOTHING = "run again in its window", "tell the chat", "nothing"
#: ⚠️ ONE DECISION PER KIND. A scheduled run is claimed again in its slot's window (a report costs nothing to ask for
#: again, nobody would); a chat's job or question is SAID ended — not run again: it costs the AI again, the person asks
#: when they still want it. Work whose result arrived owes nothing (review 22: "stopped by a restart" under the report).
ON_START = {SCHEDULED: AGAIN, CHAT_JOB: TELL, ANSWER: TELL}
#: an older engine marked a scheduled run's row delivered instead of clearing it
_OLD_DELIVERED = "|delivered"

#: the scheduled run this task works for (set by `kept`): what Delivery.send gets to a chat is its result
_RUN: contextvars.ContextVar["Item | None"] = contextvars.ContextVar("scheduled_run", default=None)


@dataclass(eq=False)
class Item:
    kind: str
    name: str                     # a scheduled run: its slot key (scheduler.job_key); else the job's name, or ANSWER_NAME
    chat: int | None = None
    slot: str | None = None       # a scheduled run's slot (iso)
    started: float | None = field(default_factory=time.time)
    mid: int | None = None        # the message that stands for it until its result: its promise
    asked: str | None = None      # a question: what was asked, as the chat will be reminded of it
    turn: tuple | None = None     # the conversation turn (or pressed message) a chat job belongs to: memory only
    arrived: bool = False         # a message of it reached a chat
    begun: bool = False

    @property
    def then(self) -> str:
        """What the next start does with it, had a stop cut it now."""
        return NOTHING if self.arrived else ON_START.get(self.kind, NOTHING)

    def cut_text(self, tz: str) -> str:
        """What the chat is told at the next start (TELL)."""
        from .notice import when
        at = when(datetime.fromtimestamp(float(self.started or time.time()), timezone.utc), tz)
        if self.kind == ANSWER:
            return (f"Your question at {at} (“{self.asked or '…'}”) was interrupted by a restart of the agent: "
                    "send it again to have its answer.")
        return f"The {self.name} job asked for at {at} was stopped by a restart of the agent: ask again to have it."


class InProgress:
    def __init__(self, state=None, timezone_name: str = "UTC"):
        self.state, self.tz = state, timezone_name        # no state: kept in memory only (a test's stand-in)
        self._now: dict[tuple[int, str], Item] = {}      # (chat, name) → the job running there (CHAT_JOB, HELD)

    # ------------------------------------------------------------------ what runs
    def running(self, chat: int, name: str) -> bool:
        return (int(chat), name) in self._now

    def get(self, chat: int, name: str) -> Item | None:
        return self._now.get((int(chat), name))

    def in_chat(self, chat: int) -> list[Item]:
        return [it for (c, _n), it in list(self._now.items()) if c == int(chat)]

    def begin(self, item: Item) -> Item:
        """Record `item` as running now (before its task runs: "is it running here" answers at once). Once."""
        if item.begun:
            return item
        item.begun = True
        if item.kind in (CHAT_JOB, HELD):
            self._now[(int(item.chat), item.name)] = item
        self._write(item)
        return item

    def promised(self, item: Item, mid: int | None) -> None:
        """The message that now stands for `item` until its result (a conversation's reply)."""
        item.mid = mid
        self._write(item)

    @contextlib.asynccontextmanager
    async def kept(self, item: Item, *, after: Callable[[], None] | None = None,
                   ended: Callable[[], Awaitable[None]] | None = None):
        """Run the body as `item`. Afterwards, whatever happened, it no longer runs and `after()` is called; on an end
        that is not a stop (a failure included) its record goes and `ended()` is awaited. A stop (CancelledError) keeps
        the record: the next start decides (`left`)."""
        self.begin(item)
        token = _RUN.set(item) if item.kind == SCHEDULED else None
        cut = False
        try:
            yield item
        except asyncio.CancelledError:
            cut = True                    # the agent is stopping: its record stays, the next start decides
            raise
        finally:
            if token is not None:
                _RUN.reset(token)
            if self._now.get((item.chat, item.name)) is item:
                del self._now[(item.chat, item.name)]
            if after:
                after()
            if not cut:
                self._clear(item)
                if ended:
                    await ended()

    @contextlib.asynccontextmanager
    async def held(self, chats: list[int], name: str):
        """A job that runs on schedule, sending to `chats`: while it runs, the same job asked for in one is "already
        being made", with its start time — one record of what runs, whatever started it (architecture review 14: a
        report asked for in the facility manager's chat at 08:01 ran a second time beside the scheduled one). Only the
        chats where it is not already running are held, and only those are let go."""
        async with contextlib.AsyncExitStack() as stack:
            for c in chats:
                if not self.running(c, name):
                    await stack.enter_async_context(self.kept(Item(HELD, name, chat=int(c))))
            yield

    def arrived(self, origin=None) -> None:
        """A message reached a chat (delivery.Delivery.send): the scheduled run this task works for, and the job asked
        for in a chat it was sent on behalf of (`origin`, kind JOB), owe nothing at the next start."""
        run = _RUN.get()
        if run is not None:
            self._arrived(run)
        if origin is not None and origin.kind == JOB:
            it = self._now.get((int(origin.chat), origin.job or ""))
            if it is not None and it.kind == CHAT_JOB:
                self._arrived(it)

    def _arrived(self, item: Item) -> None:
        if not item.arrived:
            item.arrived = True
            self._clear(item)

    # ------------------------------------------------------------------ at start
    def left(self, *kinds: str) -> list[Item]:
        """What the last stop cut, of these kinds — read once and cleared; each item's `then` is what to do now."""
        if self.state is None:
            return []
        out = []
        if SCHEDULED in kinds:
            for key, v in self.state.runs_kept().items():
                slot, old_arrived = (v[:-len(_OLD_DELIVERED)], True) if v.endswith(_OLD_DELIVERED) else (v, False)
                out.append(Item(SCHEDULED, key, slot=slot, started=None, arrived=old_arrived))
                self.state.keep_run(key, None)
        for chat, name, v in self.state.chat_work_kept():
            kind = ANSWER if name == ANSWER_NAME else CHAT_JOB
            if kind not in kinds:
                continue
            rec = json.loads(v)
            out.append(Item(kind, name, chat=chat, started=rec.get("started"), mid=rec.get("mid"),
                            asked=rec.get("asked")))
            self.state.keep_chat_work(chat, name, None)
        return out

    # ------------------------------------------------------------------ the rows (keys: state.py)
    def _write(self, item: Item) -> None:
        if self.state is None:
            return
        if item.kind == SCHEDULED:
            self.state.keep_run(item.name, item.slot)
        elif item.kind == CHAT_JOB:
            self.state.keep_chat_work(item.chat, item.name, json.dumps({"started": item.started, "mid": item.mid}))
        elif item.kind == ANSWER:
            self.state.keep_chat_work(item.chat, item.name, json.dumps({"started": item.started, "asked": item.asked}))

    def _clear(self, item: Item) -> None:
        if self.state is None:
            return
        if item.kind == SCHEDULED:
            self.state.keep_run(item.name, None)
        elif item.kind in (CHAT_JOB, ANSWER):
            self.state.keep_chat_work(item.chat, item.name, None)
