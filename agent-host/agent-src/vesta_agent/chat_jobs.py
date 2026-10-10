"""A job asked for in a chat, from its start to its end: one module, whoever starts it.

⚠️ ONE LIFECYCLE (architecture review 5, 2026-10-07). Two start paths — the AI's start_job and a report's button
when the AI is unavailable — each wrote the same steps by hand: refuse a second start, mark it running, "typing…"
and the waiting message, run it as the chat's job, then unmark it and end both. The button path forgot the waiting
message, and the job took the NEXT answer in the chat for it and deleted it (villa, 14:17). Here it is done once.

⚠️ ONE OWNER, BY TURN AND BY JOB (architecture review 12, 2026-10-09). The lifecycle was still split: the waiting
message lived in Delivery keyed by the CHAT (a failed reply let the next turn's answer be taken for it; two jobs from
two turns shared one), "typing…" lived in Delivery too, and a result said only "some job" — Delivery guessed whose.
Now this module owns all of it: a job belongs to the TURN that asked for it (or the pressed message), its result is
told by name (routing.Origin.job), and its "typing…" starts once the conversation's own has stopped with its reply.
Delivery only sends. job_notices.JobNotices still decides what happens to the waiting message, keyed by turn.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Awaitable, Callable

from .job_notices import JobNotices
from .routing import JOB, Origin

log = logging.getLogger("vesta")

Work = Callable[[Origin], Awaitable[None]]


class ChatJobs:
    def __init__(self, delivery, safe: Callable[[Awaitable], Awaitable[None]], state=None, timezone_name: str = "UTC"):
        self.delivery = delivery
        # what runs, kept across a stop (state.chat_job): a job cut by one is said ended at the next start (`recover`)
        self.state, self.tz = state, timezone_name
        delivery.on_job_result = self.result               # a message sent on behalf of a job is its result
        self._safe = safe                                  # logs what a task raised (app.Vesta._safe)
        self.notices = JobNotices()                        # the waiting messages, by turn
        self._jobs: dict[tuple[int, str], dict] = {}       # (chat, job) → {started, turn}: the jobs running
        self._turn: dict[int, int] = {}                    # chat → its current conversation turn
        self._typing: dict[tuple[int, str], Callable[[], None]] = {}   # (chat, job) → its hold of the chat's "typing…"
        # the tasks, kept: asyncio holds only a weak reference to a task nobody keeps, and `idle` waits for them
        self._tasks: set[asyncio.Task] = set()

    # ------------------------------------------------------------------ what runs
    def running(self, chat: int, name: str) -> bool:
        return (int(chat), name) in self._jobs

    def started_at(self, chat: int, name: str) -> float | None:
        """When this chat's job `name` started (time.time()), while it runs; None otherwise."""
        j = self._jobs.get((int(chat), name))
        return j["started"] if j else None

    # ------------------------------------------------------------------ a conversation's turn
    def turn(self, chat: int) -> None:
        """A person's message is being answered in `chat`: a job started now belongs to this turn, and this turn's
        reply is its waiting message."""
        self._turn[int(chat)] = self._turn.get(int(chat), 0) + 1

    async def replied(self, chat: int, mid: int | None) -> None:
        """The turn's reply was sent (`mid`; None: nothing arrived, then no message stands for its jobs). Its jobs'
        "typing…" starts now: the conversation's own stopped with the reply, and two in one chat hide each other."""
        chat = int(chat)
        key = ("turn", chat, self._turn.get(chat, 0))
        if self.notices.describe(key) == "none":
            return
        log.info("Reply %s in chat %s, while a job asked for here runs: %s", mid, chat, self.notices.describe(key))
        await self._carry(chat, self.notices.replied(key, mid))
        for (c, name), j in list(self._jobs.items()):
            if c == chat and j["turn"] == key:
                self._keep(chat, name, mid)
                self._typing_on(chat, name)

    # ------------------------------------------------------------------ a job
    def start(self, chat: int, name: str, work: Work, waiting_mid: int | None = None, role: str | None = None) -> bool:
        """Start `work` as this chat's job `name`; False when it already runs here (never twice). `waiting_mid`: the
        message that stands for it until its result (a pressed button's); without one, the turn's reply does.
        `role`: who asked (routing.Origin.role): the run uses what they may."""
        chat = int(chat)
        if (chat, name) in self._jobs:
            return False
        key = ("press", chat, int(waiting_mid)) if waiting_mid else ("turn", chat, self._turn.get(chat, 0))
        self._jobs[(chat, name)] = {"started": time.time(), "turn": key}
        self._keep(chat, name, waiting_mid)
        self.notices.started(key, name)
        log.info("Job %s asked for in chat %s: %s", name, chat, self.notices.describe(key))

        async def run() -> None:
            cut = False
            try:
                if waiting_mid:
                    await self._carry(chat, self.notices.replied(key, int(waiting_mid)))
                    self._typing_on(chat, name)
                await work(Origin(chat, JOB, job=name, role=role))
            except asyncio.CancelledError:
                cut = True                    # the agent is stopping: its record stays, the next start says so (recover)
                raise
            finally:
                self._jobs.pop((chat, name), None)
                self._typing_off(chat, name)
                if not cut:
                    if self.state is not None:
                        self.state.chat_job(chat, name, None)
                    await self._carry(chat, self.notices.ended(key, name))
        task = asyncio.create_task(self._safe(run()))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return True

    def _keep(self, chat: int, name: str, mid: int | None) -> None:
        j = self._jobs.get((chat, name))
        if self.state is not None and j is not None:
            self.state.chat_job(chat, name, {"started": j["started"], "mid": mid})

    async def recover(self) -> int:
        """At start: every job asked for in a chat that the last stop cut is said ended there — its waiting message
        says so, or a message does when it had none. Returns how many.

        ⚠️ NEVER A PROMISE LEFT HANGING (architecture review 21): the jobs running lived in memory only, so an update in
        the minutes a report was being made left "it will arrive in this chat in a few minutes" — and nothing, ever.
        It is not run again by itself: a report costs the AI again, the person asks when they still want it."""
        if self.state is None:
            return 0
        from datetime import datetime, timezone
        from .notice import when
        n = 0
        for chat, name, rec in self.state.chat_jobs_cut():
            at = when(datetime.fromtimestamp(float(rec.get("started") or time.time()), timezone.utc), self.tz)
            text = f"The {name} job asked for at {at} was stopped by a restart of the agent: ask again to have it."
            log.info("Job %s in chat %s was cut by the last stop: said so", name, chat)
            if self.delivery.tg is None:
                continue
            mid = rec.get("mid")
            if not (mid and await self.delivery.edit(chat, int(mid), text)):
                await self.delivery.send(chat, text)
            n += 1
        return n

    @contextlib.asynccontextmanager
    async def held(self, chats: list[int], name: str):
        """A job that runs on schedule, sending to `chats`: while it runs, the same job asked for in one is "already
        being made", with its start time — one record of what runs, whatever started it (architecture review 14: the
        schedule kept its own, and a report asked for in the facility manager's chat at 08:01 ran a second time
        beside the scheduled one). No waiting message, no "typing…": nobody asked."""
        mine = [k for k in ((int(c), name) for c in chats) if k not in self._jobs]
        for key in mine:
            self._jobs[key] = {"started": time.time(), "turn": None}
        try:
            yield
        finally:
            for key in mine:
                self._jobs.pop(key, None)

    async def result(self, origin: Origin) -> None:
        """A message sent on behalf of job `origin.job` reached `origin.chat`: its waiting message goes, its
        "typing…" stops."""
        j = self._jobs.get((int(origin.chat), origin.job or ""))
        if j is None or j["turn"] is None:
            return
        log.info("Job result in chat %s: waiting notice before it: %s", origin.chat, self.notices.describe(j["turn"]))
        # ⚠️ ITS RESULT CAME: NOTHING TO SAY AT THE NEXT START (architecture review 22): a stop after the report arrived
        # told the chat "it was stopped by a restart: ask again" under the report itself
        if self.state is not None:
            self.state.chat_job(int(origin.chat), origin.job or "", None)
        await self._carry(int(origin.chat), self.notices.result(j["turn"]))
        self._typing_off(int(origin.chat), origin.job or "")

    async def idle(self) -> None:
        """Until every job started here has ended (its result sent, its waiting message dealt with)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    # ------------------------------------------------------------------ the waiting message, "typing…"
    async def _carry(self, chat: int, step) -> None:
        """Carry out what job_notices.py decided about a waiting message."""
        if step is None or self.delivery.tg is None:
            return
        what, mid, job = step
        log.info("Waiting message %s in chat %s: %s", mid, chat, "deleted (its result came)" if what == "delete"
                 else f"says the {job} job ended without a result")
        if what == "delete":
            await self.delivery.delete(chat, mid)
        else:
            await self.delivery.edit(chat, mid, f"The {job} job ended without a result this time. Ask again in a moment.")

    def _typing_on(self, chat: int, name: str) -> None:
        """⚠️ "typing…" UNTIL THE RESULT IS THERE (owner, 2026-10-07): the job holds the chat's one "typing…"
        (delivery.Delivery.hold) — never a loop of its own: a second one hides the first (measured 2026-10-09)."""
        if self.delivery.tg is None or (chat, name) not in self._jobs or (chat, name) in self._typing:
            return
        self._typing[(chat, name)] = self.delivery.hold(chat, name)

    def _typing_off(self, chat: int, name: str) -> None:
        release = self._typing.pop((chat, name), None)
        if release:
            release()
