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

⚠️ IT ACTS THROUGH THE RUN'S OWN TOOLS (architecture review 14, 2026-10-10). The run's record has `call(name, args)`:
the tool of that name AS THE RUN WAS GIVEN IT (tools.Kit), refused like the real guard when the run does not have
it. Tests acted through a toolbox built by hand with every tool on, so a run that was given the wrong tools — a
report asked for in the facility manager's chat — passed.
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

    async def run(self, settings, system_prompt, prompt, kit, terms, state, resume=None, asked=None,
                  image=None) -> runner.RunResult:
        tools = {t.name: t for t in kit.tools}

        async def call_tool(name: str, args: dict | None = None) -> dict:
            if name not in tools:
                # the real run's guard: a name this run was not given is denied (runner.make_guard)
                return {"content": [{"type": "text", "text": f"{name} is not one of this run's tools."}], "is_error": True}
            return await tools[name].handler(dict(args or {}))

        call = {"who": terms.who, "prompt": prompt, "allowed": kit.names, "tools": set(terms.tools), "resume": resume,
                "limit_usd": terms.limit_usd, "profile": terms.profile, "asked": asked, "system_prompt": system_prompt,
                "folder": settings.out_dir, "call": call_tool, "image": image}
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
