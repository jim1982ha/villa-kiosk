"""A skill's AI jobs — the reports: found by name, run, made without the AI, started from a chat. One module.

⚠️ OUT OF THE APP (architecture review 6, 2026-10-07). About 140 lines of app.py: a job was looked up by name three
times, "not set up" was worded twice, and the chain "the AI failed → make it without the AI → tell the owner" sat
in the middle of the agent's wiring. Tests had to build the whole agent to reach any of it.

    run(skill, job, origin)        an AI job (scheduled, or asked for in a chat: `origin`)
    start(name, chat)              the AI's start_job: as its own job, in that chat (chat_jobs.py)
    start_without_ai(...)          a report made from its figures because the AI cannot answer (ai_down.py)
    find / all / without_ai_able   the lookups
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Awaitable, Callable

from vesta_shared import agent_records

from . import job_steps
from .api_errors import AI_DOWN, for_job, why_job_sentence
from .policy import LANGUAGES as LANG
from .routing import Origin, Routing, job_to
from .skills import ai_jobs

log = logging.getLogger("vesta")


def run_folder(name: str) -> str:
    """A job run's folder under out/: the job and the time it started, unique per run."""
    return f"runs/{name}-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%f}"


def not_set(name: str) -> str:
    """What a chat reads when a job policy.yaml does not name is asked for (it has no agreed model or limit)."""
    return f"The {name} job is not set up yet (VESTA Agent page → Rules → AI jobs), so it cannot run."


#: A report asked for again this soon after it started is the same request, not a second one.
JUST_STARTED_S = 60


class AiJobs:
    def __init__(self, settings, state, policy: Callable, skills, delivery, chat_jobs, outcome, *,
                 turns, safe: Callable[[Awaitable], Awaitable[None]]):
        self.s, self.state, self.policy, self.skills = settings, state, policy, skills
        self.delivery, self.chat_jobs, self.outcome = delivery, chat_jobs, outcome
        self.turns, self._safe = turns, safe          # turn.Turns: the run itself, its terms decided there

    # ------------------------------------------------------------------ lookups
    def all(self) -> list[tuple]:
        return ai_jobs(self.skills.all())

    def find(self, name: str) -> tuple | None:
        """(skill, job) of the job with this name, or None."""
        return next(((sk, j) for sk, j in self.all() if j["name"] == name), None)

    def _language_of(self, role: str) -> str:
        for p in self.policy().entries:                # every entry: one person may be both owner and fm
            if p.role == role:
                return LANG.get(p.language, p.language)
        return "English"

    async def run(self, skill, job: dict, origin: Origin | None = None) -> None:
        """An AI job of a skill: its model and spending limit are policy.yaml's settings.jobs[name].

        ⚠️ NOT SET, NOT RUN (owner, 2026-10-01): a job policy.yaml does not name has no agreed cost, so it
        is skipped and the log says so (the VESTA Agent page offers to add it). When the limit stops it,
        the skill's `on_limit` code step still finishes the work (a report is sent with what is done)."""
        name = job["name"]
        cfg = self.policy().jobs.get(name)
        if cfg is None:
            log.warning("AI job %s (skill %s) is not set in policy.yaml: it does not run. "
                        "VESTA Agent page → Rules → AI jobs → Add them.", name, skill.name)
            self.state.log("job_not_set", {"job": name, "skill": skill.name})
            if origin:
                await self.delivery.send(origin.chat, not_set(name), origin=origin)
            return
        prompt = job["prompt"]
        try:
            prompt = prompt.format(fm_language=self._language_of("fm"), owner_language=self._language_of("owner"))
        except (KeyError, IndexError, ValueError):
            pass                        # a prompt with other braces is used as written
        if origin:
            # where it all goes is routing's (Origin JOB holds every message to that chat); the AI is only told
            # it was asked for, so it does not write "as scheduled"
            prompt += "\n\nThis was asked for in a chat, not on schedule."
        # ⚠️ ITS OWN FOLDER (architecture review 14): the AI run and the steps after it (on_limit) read and write there,
        # never in another report's — the weekly and monthly reports start together when the 1st is a Monday
        folder = self.s.in_folder(run_folder(name))
        started = datetime.now(timezone.utc).isoformat()
        to = Routing(self.policy()).target(job_to(job, origin), origin)
        log.info("AI job %s started (%s, limit %g USD)%s", name, cfg["profile"], cfg["limit_usd"],
                 " on request" if origin else "")
        if origin:
            res = await self.turns.job(name, cfg, prompt, origin, folder, to)
        else:
            async with self.chat_jobs.held(to, name):       # on schedule: asked for meanwhile, it is "already being made"
                res = await self.turns.job(name, cfg, prompt, origin, folder, to)
        if res.failed:
            # before 0.6.41 a failed job logged "done" and nobody was told: the report simply never came
            problem = res.problem or "unknown"
            log.warning("AI job %s did not run: %s", name, problem)
            made = await self.run_without_ai(skill, job, problem, origin, folder)
            if to and not made:
                await self.delivery.send(to, for_job(name, problem), origin=origin)
            return
        log.info("AI job %s done (%s USD%s)", name, res.cost_usd,
                 ", stopped at its limit" if res.stopped_at_limit else "")
        if res.stopped_at_limit and job.get("on_limit"):
            await job_steps.run(folder, self.state, self.skills, self.outcome, skill, job["on_limit"],
                                {"to": job_to(job, origin), "started": started, "limit": f"{cfg['limit_usd']:g}"}, origin)

    async def run_without_ai(self, skill, job: dict, problem: str, origin: Origin | None = None, folder=None) -> bool:
        """The job's `without_ai` steps (skill.yaml), when the AI could not run: True when they sent its work.

        ⚠️ A REPORT EVEN WITHOUT THE AI (owner, 2026-10-07: the Anthropic credit ran out and the weekly never came).
        The figures and charts are code; only VESTA's readings need the AI. The steps run in order, each must
        succeed (a later one reads an earlier one's file: a stale file must never stand in for a failed step), and
        what a step decides to send is sent. The page and its message say why the AI was missing; the Costs tab
        shows the run (a "without_ai" record, no cost)."""
        steps = [st for st in job.get("without_ai") or [] if not (origin and st["on_schedule_only"])]
        if not steps:
            return False
        name = job["name"]
        folder = folder or self.s.in_folder(run_folder(name))      # its own, or the failed AI run's
        done = await job_steps.run(folder, self.state, self.skills, self.outcome, skill, steps,
                                   {"to": job_to(job, origin), "why": why_job_sentence(problem)}, origin)
        sent, failed = done.sent, done.failed
        self.state.log(agent_records.WITHOUT_AI, agent_records.without_ai(name, problem, sent, failed))
        log.warning("AI job %s made without the AI (%s): %s", name, problem,
                    f"stopped at {failed}" if failed else f"{sent} message(s) sent")
        return sent > 0

    async def start(self, name: str, chat: int, role: str | None = None) -> str:
        """A job a skill marks on_request, started from a chat: its own model and limit, and what the person who asked
        (`role`) may use there (turn.job_terms)."""
        found = self.find(name)
        if not found or not found[1].get("on_request"):
            return f"There is no job {name} that can be started from a chat."
        if name not in self.policy().jobs:
            return not_set(name)
        sk, job = found
        # ⚠️ THE AGENT SAYS WHETHER IT IS RUNNING, NOT THE AI'S MEMORY (villa, 2026-10-07 01:22): asked again 30 s after
        # the report was sent, the AI answered "already being generated" from the conversation and started nothing.
        # A second start while one runs would make the report twice.
        cfg = self.policy().jobs[name]
        started = self.chat_jobs.start(chat, name, lambda origin: self.run(sk, job, origin), role=role)
        at = self.chat_jobs.started_at(chat, name)
        when = datetime.fromtimestamp(at or time.time(), ZoneInfo(self.s.timezone)).strftime("%H:%M")
        # ⚠️ THE START TIME, SAID BY THE AGENT (owner, 2026-10-09: the waiting message read "Still in progress" for a
        # report that had just started). The model called start_job twice in one turn, the second answer said "still
        # running", and the model told the person that. A report started in the last minute IS just started: both
        # answers say so, with its time, and say what to tell the person.
        if started or (at is not None and time.time() - at < JUST_STARTED_S):
            return (f"Started {name} now, at {when} (brain {cfg['profile']}, limit {cfg['limit_usd']:g} USD). Tell the "
                    "person in one short sentence that it has just started and will arrive in this chat in a few "
                    "minutes. Do not say it is still running or in progress.")
        return (f"The {name} report asked for here started at {when} and is still being made: its result will be sent "
                "here when it is ready. Tell the person when it started.")

    def without_ai_able(self) -> list[dict]:
        """The jobs a person may start from a chat that can be made without the AI (skill.yaml without_ai), set up."""
        jobs = self.policy().jobs
        return [j for _, j in self.all() if j.get("on_request") and j.get("without_ai") and j["name"] in jobs]

    def start_without_ai(self, name: str, problem: str, chat: int, waiting_mid: int | None = None) -> str:
        """A report made from its figures because the AI cannot answer (named in a message, or its button pressed:
        `waiting_mid`, the pressed message), sent here. What the person is told."""
        found = self.find(name)
        if not found or not any(j["name"] == name for j in self.without_ai_able()):
            return "This report cannot be made without the AI."
        sk, job = found

        async def made(origin: Origin) -> None:
            if not await self.run_without_ai(sk, job, problem if problem in AI_DOWN else "unknown", origin):
                await self.delivery.send(chat, f"The {name} report could not be made without the AI either: its "
                                               "figures could not be read. Try again later.", origin=origin)
        started = self.chat_jobs.start(chat, name, made, waiting_mid)
        at = self.chat_jobs.started_at(chat, name)
        # the same "just started" window as start (architecture review 12: this path had none)
        if started or (at is not None and time.time() - at < JUST_STARTED_S):
            return f"Making the {job['button']} without the AI, from its figures and charts: it will be sent here."
        when = datetime.fromtimestamp(at or time.time(), ZoneInfo(self.s.timezone)).strftime("%H:%M")
        return f"This report is already being made since {when}: it will be sent here."
