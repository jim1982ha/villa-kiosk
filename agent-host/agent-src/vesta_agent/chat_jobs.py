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
import logging
import time
from typing import Awaitable, Callable

from .job_notices import JobNotices
from .routing import JOB, Origin

log = logging.getLogger("vesta")

Work = Callable[[Origin], Awaitable[None]]


class ChatJobs:
    def __init__(self, delivery, safe: Callable[[Awaitable], Awaitable[None]]):
        self.delivery = delivery
        delivery.on_job_result = self.result               # a message sent on behalf of a job is its result
        self._safe = safe                                  # logs what a task raised (app.Vesta._safe)
        self.notices = JobNotices()                        # the waiting messages, by turn
        self._jobs: dict[tuple[int, str], dict] = {}       # (chat, job) → {started, turn}: the jobs running
        self._turn: dict[int, int] = {}                    # chat → its current conversation turn
        self._typing: dict[int, tuple[asyncio.Event, asyncio.Task, set[str]]] = {}   # chat → its jobs' "typing…"
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
                self._typing_on(chat, name)

    # ------------------------------------------------------------------ a job
    def start(self, chat: int, name: str, work: Work, waiting_mid: int | None = None) -> bool:
        """Start `work` as this chat's job `name`; False when it already runs here (never twice). `waiting_mid`: the
        message that stands for it until its result (a pressed button's); without one, the turn's reply does."""
        chat = int(chat)
        if (chat, name) in self._jobs:
            return False
        key = ("press", chat, int(waiting_mid)) if waiting_mid else ("turn", chat, self._turn.get(chat, 0))
        self._jobs[(chat, name)] = {"started": time.time(), "turn": key}
        self.notices.started(key, name)
        log.info("Job %s asked for in chat %s: %s", name, chat, self.notices.describe(key))

        async def run() -> None:
            try:
                if waiting_mid:
                    await self._carry(chat, self.notices.replied(key, int(waiting_mid)))
                    self._typing_on(chat, name)
                await work(Origin(chat, JOB, job=name))
            finally:
                self._jobs.pop((chat, name), None)
                self._typing_off(chat, name)
                await self._carry(chat, self.notices.ended(key, name))
        task = asyncio.create_task(self._safe(run()))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return True

    async def result(self, origin: Origin) -> None:
        """A message sent on behalf of job `origin.job` reached `origin.chat`: its waiting message goes, its
        "typing…" stops."""
        j = self._jobs.get((int(origin.chat), origin.job or ""))
        if j is None:
            return
        log.info("Job result in chat %s: waiting notice before it: %s", origin.chat, self.notices.describe(j["turn"]))
        await self._carry(int(origin.chat), self.notices.result(j["turn"]))
        self._typing_off(int(origin.chat), origin.job or "")

    async def idle(self) -> None:
        """Until every job started here has ended (its result sent, its waiting message dealt with)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    # ------------------------------------------------------------------ the waiting message, "typing…"
    async def _carry(self, chat: int, step) -> None:
        """Carry out what job_notices.py decided about a waiting message."""
        tg = self.delivery.tg
        if step is None or tg is None:
            return
        what, mid, job = step
        log.info("Waiting message %s in chat %s: %s", mid, chat, "deleted (its result came)" if what == "delete"
                 else f"says the {job} job ended without a result")
        if what == "delete":
            await tg.delete(chat, mid)
        else:
            await tg.edit(chat, mid, f"The {job} job ended without a result this time. Ask again in a moment.")

    def _typing_on(self, chat: int, name: str) -> None:
        """⚠️ "typing…" UNTIL THE RESULT IS THERE (owner, 2026-10-07), one loop per chat whatever the number of jobs:
        a second loop would send inside the first one's 5 s, and Telegram then shows neither (measured 2026-10-09)."""
        if self.delivery.tg is None or (chat, name) not in self._jobs:
            return
        entry = self._typing.get(chat)
        if entry and not entry[0].is_set():
            entry[2].add(name)
            return
        stop = asyncio.Event()
        task = asyncio.create_task(self.delivery.typing_loop(chat, stop, name))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        self._typing[chat] = (stop, task, {name})

    def _typing_off(self, chat: int, name: str) -> None:
        entry = self._typing.get(chat)
        if not entry:
            return
        entry[2].discard(name)
        if not entry[2]:
            entry[0].set()
            self._typing.pop(chat, None)
