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

⚠️ HOW IT ENDED IS TOLD TO THE AI (villa, 2026-10-23): the job sends its result outside the conversation, and the AI —
whose transcript held only its own "on its way" — promised twice a digest that had come ten minutes before. Each end, as
its chat saw it (sent, could not be prepared, nothing, cut by a restart), is told to chat_facts.ChatFacts, which the AI
reads with the next message there.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable

from vesta_shared.limits import limit

from . import chat_facts
from .api_errors import CHAT, NOT_COME, NOT_PREPARED_TITLE
from .in_progress import ANSWER, ANSWER_NAME, CHAT_JOB, FAILED, HELD, TELL, InProgress, Item
from .job_notices import JobNotices
from .posting import Poster
from .routing import JOB, Origin

log = logging.getLogger("vesta")

Work = Callable[[Origin], Awaitable[None]]

#: A report asked for again this soon after it started is the same request, not a second one.
JUST_STARTED_S = 60
#: Started.kind: started by this call · started in the last JUST_STARTED_S (the same request) · running since earlier
NEW, JUST_STARTED, RUNNING_SINCE = "new", "just_started", "running_since"
#: Started.by: asked for in this chat · a scheduled run holding this chat (in_progress.InProgress.held)
ASKED, SCHEDULED = "asked", "scheduled"


@dataclass(frozen=True)
class Started:
    """What `ChatJobs.start` answers: whether this call started the job, since when it runs, and who started it.

    ⚠️ ONE ANSWER, WORDED BY THE CALLER (architecture review scan 4, 2026-10-19): start() answered a bool, and its two
    callers (ai_jobs.start, start_without_ai) each read `started_at` back, applied the "just started" window and
    formatted the time themselves — and a report running ON SCHEDULE read "asked for here started at 08:00" though
    nobody had asked. `by` says who did."""
    kind: str                     # NEW | JUST_STARTED | RUNNING_SINCE
    since: datetime               # when it started (UTC)
    by: str                       # ASKED | SCHEDULED

    def __bool__(self) -> bool:
        return self.kind == NEW


class ChatJobs:
    def __init__(self, delivery, safe: Callable[[Awaitable], Awaitable[None]], work: InProgress | None = None,
                 facts: "chat_facts.ChatFacts | None" = None, poster: Poster | None = None):
        self.delivery = delivery
        # what a chat is told of a job that did not come goes in the one layout, titled (posting.Poster; owner,
        # 2026-10-23) — a new message, or its waiting message rewritten in place
        self.poster = poster or Poster(send=delivery.send, edit=delivery.edit)
        self.facts = facts                                 # what the AI is told of this chat (chat_facts.py): each end
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
    def start(self, chat: int, name: str, work: Work, waiting_mid: int | None = None, role: str | None = None,
              by: str | None = None) -> Started:
        """Start `work` as this chat's job `name` — or say since when it already runs here (never twice: Started).
        `waiting_mid`: the message that stands for it until its result (a pressed button's); without one, the turn's
        reply does. `role`: who asked (routing.Origin.role): the run uses what they may; `by`: their name."""
        chat = int(chat)
        have = self.work.get(chat, name)
        if have is not None:
            at = float(have.started or time.time())
            by = SCHEDULED if have.kind == HELD else ASKED
            kind = JUST_STARTED if by == ASKED and time.time() - at < JUST_STARTED_S else RUNNING_SINCE
            return Started(kind, datetime.fromtimestamp(at, timezone.utc), by)
        key = ("press", chat, int(waiting_mid)) if waiting_mid else ("turn", chat, self._turn.get(chat, 0))
        job = self.work.begin(Item(CHAT_JOB, name, chat=chat, mid=waiting_mid, turn=key, by=by))
        self.notices.started(key, name)
        log.info("Job %s asked for in chat %s: %s", name, chat, self.notices.describe(key))

        async def run() -> None:
            async def ended() -> None:
                if not job.arrived and self.facts is not None:
                    self.facts.job_ended(job, chat_facts.NOTHING)      # its waiting message says it was not prepared
                await self._carry(chat, self.notices.ended(key, name))
            async with self.work.kept(job, after=lambda: self._typing_off(chat, name), ended=ended):
                if waiting_mid:
                    await self._carry(chat, self.notices.replied(key, int(waiting_mid)))
                    self._typing_on(chat, name)
                await work(Origin(chat, JOB, job=name, role=role))
        task = asyncio.create_task(self._safe(run()))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return Started(NEW, datetime.fromtimestamp(float(job.started or time.time()), timezone.utc), ASKED)

    @contextlib.asynccontextmanager
    async def answering(self, chat: int, asked: str):
        """While a person's question in `chat` is being answered: kept across a stop, so the next start tells the chat it
        was cut (recover). `asked`: what they asked, as the chat will be reminded of it.

        ⚠️ A QUESTION CUT BY A RESTART IS SAID, NOT LOST (owner, 2026-10-15: an /investigate running when the agent was
        updated "went quiet"): only a job's waiting message was kept, a question being answered lived in memory only."""
        async with self.work.kept(Item(ANSWER, ANSWER_NAME, chat=int(chat), asked=" ".join(str(asked).split())[:limit(
            "jobs.asked_chars", 80, unit="characters", group="text", lo=20, hi=2000,
            says="How much of a question an answer in progress shows on the Overview.",
            reached="The rest of the question is cut.", told="")])):
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
            if cut.kind == CHAT_JOB and self.facts is not None:
                self.facts.job_ended(cut, chat_facts.CUT)
            if self.delivery.tg is None:
                continue
            await self._say(cut.chat, cut.cut_title(), cut.cut_text(self.work.tz), over=cut.mid, new=True)
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
        if self.facts is not None and not j.facts_told:
            # its first message: what the AI is told of it from now — a report that could not be prepared said so first
            # (InProgress.verdict, before its one sentence went)
            j.facts_told = True
            self.facts.job_ended(j, chat_facts.NOT_PREPARED if j.outcome == FAILED else chat_facts.SENT, j.why)
        log.info("Job result in chat %s: waiting notice before it: %s", origin.chat, self.notices.describe(j.turn))
        await self._carry(int(origin.chat), self.notices.result(j.turn))
        self._typing_off(int(origin.chat), origin.job or "")

    async def idle(self) -> None:
        """Until every job started here has ended (its result sent, its waiting message dealt with)."""
        # ⚠️ ONLY WHAT STILL RUNS (2026-10-23): a task is dropped by its done-callback, which runs on the loop's NEXT turn;
        # one that ended as its loop closed stayed in the set for good, and awaiting finished tasks never yields — this
        # wait spun for ever (0.12.331's CI hung 40 min in the tests)
        while pending := [t for t in self._tasks if not t.done()]:
            await asyncio.gather(*pending, return_exceptions=True)
        self._tasks.difference_update([t for t in self._tasks if t.done()])

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
            # only a job whose task died (an exception) ends this way: a job whose AI sent nothing sends its own
            # sentence as its result (ai_jobs.AiJobs.run), which deletes the waiting message like any result
            await self._say(chat, NOT_PREPARED_TITLE, NOT_COME(job, "its work stopped with an error", CHAT), over=mid)

    async def _say(self, chat: int, title: str, text: str, *, over: int | None = None, new: bool = False) -> bool:
        """`text` under `title` in `chat`, in the one layout: written over message `over` (the waiting message), else —
        `new` — sent as a message of its own. False when nothing showed it.

        ⚠️ TITLED LIKE ITS TWIN (owner, 2026-10-23): ai_jobs sent "could not be prepared" titled "Report not prepared"
        while these went as bare sentences — a waiting message rewritten in place too (Poster.rewrite: the same
        title and "To:" a new one gets)."""
        if over and await self.poster.rewrite(chat, int(over), title, self.poster.to_line(chat), text):
            return True
        return bool(new and await self.poster.post(chat, text, title=title))

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
