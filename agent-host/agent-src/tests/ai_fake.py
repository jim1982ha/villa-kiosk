"""The in-memory stand-in for vesta_agent.runner.run: the one the tests use instead of the AI.

⚠️ ONE STAND-IN, HELD TO THE REAL ONE'S PARAMETERS (architecture review, 2026-10-06). Each test file wrote its
own `fake_run`, some spelling out run()'s keyword arguments and some not, so a new argument broke them one by one
or slipped past unseen. tests/test_ai_fake.py fails when FakeAI.run and runner.run stop taking the same
parameters.

    ai = FakeAI("Here it is.").install(monkeypatch)      # every AI run answers this
    ai.runs                                              # what each run was given (who, prompt, allowed, …)

`answer` may be a function of the run (a dict of its arguments) returning the text, or a RunResult; `act` an
async function of the run, called first — for what the AI does with its tools. `problem` makes every run fail
that way (api_errors' words: "credit", "offline" …).
"""
from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable

from vesta_agent import runner


class FakeAI:
    def __init__(self, answer: Any = "ok", *, problem: str | None = None, stopped_at_limit: bool = False,
                 cost_usd: float | None = 0.01, act: Callable[[dict], Awaitable[None]] | None = None,
                 delay_s: float = 0.0):
        self.answer, self.problem, self.stopped_at_limit = answer, problem, stopped_at_limit
        self.cost_usd, self.act, self.delay_s = cost_usd, act, delay_s
        self.runs: list[dict] = []

    async def run(self, settings, system_prompt, prompt, server, allowed, state, who,
                  resume=None, limit_usd=None, profile=None, asked=None) -> runner.RunResult:
        call = {"who": who, "prompt": prompt, "allowed": allowed, "resume": resume, "limit_usd": limit_usd,
                "profile": profile, "asked": asked, "system_prompt": system_prompt}
        self.runs.append(call)
        if self.act:
            await self.act(call)
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        out = self.answer(call) if callable(self.answer) else self.answer
        if isinstance(out, runner.RunResult):
            return out
        return runner.RunResult(out or "", None, self.stopped_at_limit, self.cost_usd, [],
                                f"api {self.problem}" if self.problem else None, self.problem)

    def install(self, monkeypatch) -> "FakeAI":
        monkeypatch.setattr(runner, "run", self.run)
        return self
