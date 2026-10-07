"""A job asked for in a chat, from its start to its end: one module, whoever starts it.

⚠️ ONE LIFECYCLE (architecture review 5, 2026-10-07). Two start paths — the AI's start_job and a report's button
when the AI is unavailable — each wrote the same steps by hand: refuse a second start, mark it running, "typing…"
and the waiting message, run it as the chat's job, then unmark it and end both. Three places held "which jobs run
in this chat", and the waiting message was each caller's to remember: the button path forgot it, and the job took
the NEXT answer in the chat for its waiting message and deleted it (villa, 14:17). Here it is done once.
"""
from __future__ import annotations

import asyncio
from typing import Awaitable, Callable

from .routing import JOB, Origin

Work = Callable[[Origin], Awaitable[None]]


class ChatJobs:
    def __init__(self, delivery, safe: Callable[[Awaitable], Awaitable[None]]):
        self.delivery = delivery
        self._safe = safe                                  # logs what a task raised (app.Vesta._safe)
        self._running: set[tuple[int, str]] = set()

    def running(self, chat: int, name: str) -> bool:
        return (int(chat), name) in self._running

    def start(self, chat: int, name: str, work: Work, waiting_mid: int | None = None) -> bool:
        """Start `work` as this chat's job `name`; False when it already runs here (never twice). `waiting_mid`: the
        message that stands for it until its result (a pressed button's); without one, the turn's reply is."""
        chat = int(chat)
        if (chat, name) in self._running:
            return False
        self._running.add((chat, name))
        self.delivery.job_started(chat, name)

        async def run() -> None:
            try:
                if waiting_mid:
                    await self.delivery.job_waiting(chat, int(waiting_mid))
                await work(Origin(chat, JOB))
            finally:
                self._running.discard((chat, name))
                await self.delivery.job_ended(chat, name)
        asyncio.create_task(self._safe(run()))
        return True
