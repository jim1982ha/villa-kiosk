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
from typing import Awaitable, Callable

from .in_progress import ANSWER, ANSWER_NAME, CHAT_JOB, TELL, InProgress, Item
from .job_notices import JobNotices
from .routing import JOB, Origin

log = logging.getLogger("vesta")

Work = Callable[[Origin], Awaitable[None]]


class ChatJobs:
    def __init__(self, delivery, safe: Callable[[Awaitable], Awaitable[None]], work: InProgress | None = None):
        self.delivery = delivery
        # what runs, for whom, what it promised, whether its result arrived — kept across a stop (in_progress.py): the
        # same record Delivery.send tells of an arrival and the scheduler holds its chats in
        self.work = work or InProgress()
        delivery.on_job_result = self.result               # a message sent on behalf of a job is its result
        self._safe = safe                                  # logs what a task raised (app.Vesta._safe)
        self.notices = JobNotices()                        # the waiting messages, by turn
        self._turn: dict[int, int] = {}                    # chat → its current conversation turn
        self._typing: dict[tuple[int, str], Callable[[], None]] = {}   # (chat, job) → its hold of the chat's "typing…"
        # the tasks, kept: asyncio holds only a weak reference to a task nobody keeps, and `idle` waits for them
        self._tasks: set[asyncio.Task] = set()

    # ------------------------------------------------------------------ what runs
    def running(self, chat: int, name: str) -> bool:
        return self.work.running(chat, name)

    def started_at(self, chat: int, name: str) -> float | None:
        """When this chat's job `name` started (time.time()), while it runs; None otherwise."""
        j = self.work.get(chat, name)
        return j.started if j else None

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
        for j in self.work.in_chat(chat):
            if j.turn == key:
                self.work.promised(j, mid)
                self._typing_on(chat, j.name)

    # ------------------------------------------------------------------ a job
    def start(self, chat: int, name: str, work: Work, waiting_mid: int | None = None, role: str | None = None) -> bool:
        """Start `work` as this chat's job `name`; False when it already runs here (never twice). `waiting_mid`: the
        message that stands for it until its result (a pressed button's); without one, the turn's reply does.
        `role`: who asked (routing.Origin.role): the run uses what they may."""
        chat = int(chat)
        if self.work.running(chat, name):
            return False
        key = ("press", chat, int(waiting_mid)) if waiting_mid else ("turn", chat, self._turn.get(chat, 0))
        job = self.work.begin(Item(CHAT_JOB, name, chat=chat, mid=waiting_mid, turn=key))
        self.notices.started(key, name)
        log.info("Job %s asked for in chat %s: %s", name, chat, self.notices.describe(key))

        async def run() -> None:
            async with self.work.kept(job, after=lambda: self._typing_off(chat, name),
                                      ended=lambda: self._carry(chat, self.notices.ended(key, name))):
                if waiting_mid:
                    await self._carry(chat, self.notices.replied(key, int(waiting_mid)))
                    self._typing_on(chat, name)
                await work(Origin(chat, JOB, job=name, role=role))
        task = asyncio.create_task(self._safe(run()))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return True

    @contextlib.asynccontextmanager
    async def answering(self, chat: int, asked: str):
        """While a person's question in `chat` is being answered: kept across a stop, so the next start tells the chat it
        was cut (recover). `asked`: what they asked, as the chat will be reminded of it.

        ⚠️ A QUESTION CUT BY A RESTART IS SAID, NOT LOST (owner, 2026-10-15: an /investigate running when the agent was
        updated "went quiet"): only a job's waiting message was kept, a question being answered lived in memory only."""
        async with self.work.kept(Item(ANSWER, ANSWER_NAME, chat=int(chat), asked=" ".join(str(asked).split())[:80])):
            yield

    async def recover(self) -> int:
        """At start: every job asked for in a chat, and every question being answered, that the last stop cut is said
        ended there — its waiting message says so, or a message does when it had none. Returns how many.

        ⚠️ NEVER A PROMISE LEFT HANGING (architecture review 21): the jobs running lived in memory only, so an update in
        the minutes a report was being made left "it will arrive in this chat in a few minutes" — and nothing, ever.
        It is not run again by itself (in_progress.ON_START): a report costs the AI again, the person asks when they
        still want it."""
        n = 0
        for cut in self.work.left(CHAT_JOB, ANSWER):
            if cut.then != TELL:
                continue
            log.info("Job %s in chat %s was cut by the last stop: said so", cut.name, cut.chat)
            if self.delivery.tg is None:
                continue
            text = cut.cut_text(self.work.tz)
            if not (cut.mid and await self.delivery.edit(cut.chat, int(cut.mid), text)):
                await self.delivery.send(cut.chat, text)
            n += 1
        return n

    def held(self, chats: list[int], name: str):
        """A job that runs on schedule, sending to `chats`: "already being made" there while it runs
        (in_progress.InProgress.held). No waiting message, no "typing…": nobody asked."""
        return self.work.held(chats, name)

    async def result(self, origin: Origin) -> None:
        """A message sent on behalf of job `origin.job` reached `origin.chat` (Delivery.send told in_progress first:
        nothing is owed at the next start — architecture review 22): its waiting message goes, its "typing…" stops."""
        j = self.work.get(origin.chat, origin.job or "")
        if j is None or j.turn is None:
            return
        log.info("Job result in chat %s: waiting notice before it: %s", origin.chat, self.notices.describe(j.turn))
        await self._carry(int(origin.chat), self.notices.result(j.turn))
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
        if self.delivery.tg is None or not self.work.running(chat, name) or (chat, name) in self._typing:
            return
        self._typing[(chat, name)] = self.delivery.hold(chat, name)

    def _typing_off(self, chat: int, name: str) -> None:
        release = self._typing.pop((chat, name), None)
        if release:
            release()
