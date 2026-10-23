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
from datetime import datetime, timezone
from typing import Awaitable, Callable

from vesta_shared import agent_records

from . import job_steps
from .api_errors import AI_DOWN, CHAT, NO_RESULT, NOT_COME, for_job, why_job, why_job_sentence
from .chat_jobs import JUST_STARTED, NEW, SCHEDULED, Started
from .in_progress import ENDED, FAILED
from .notice import when
from .places import where
from .routing import Origin, Routing, job_to
from .skills import ai_jobs, job_owners, job_starters

log = logging.getLogger("vesta")


def run_folder(name: str) -> str:
    """A job run's folder under out/: the job and the time it started, unique per run."""
    return f"runs/{name}-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%f}"


def not_set(name: str) -> str:
    """What a chat reads when a job policy.yaml does not name is asked for (it has no agreed model or limit)."""
    return f"The {name} report is not set up yet ({where('ai')}), so it cannot run."


def being_made(name: str, st: Started, tz: str) -> str:
    """A report already running when it is asked for again: since when, and who started it — "scheduled at 08:00" for
    a run nobody asked for (it read "asked for here started at 08:00", architecture review scan 4). The one sentence
    for the AI's instruction and for the person pressing a report button; the time by the one formatter (notice.when)."""
    at = when(st.since, tz)
    if st.by == SCHEDULED:
        return (f"The {name} report scheduled at {at} is still being made: its result will be sent here when it is "
                "ready.")
    return (f"The {name} report asked for here started at {at} and is still being made: its result will be sent here "
            "when it is ready.")


#: What a job's AI run left when it sent nothing: the cause its chat and its Costs row read
_NO_RESULT = {"limit": "it stopped at its spending limit before sending it",
              "unsent": "the AI wrote its answer but did not send it", "nothing": "the AI ended its work without sending anything"}


class AiJobs:
    def __init__(self, settings, state, policy: Callable, skills, delivery, chat_jobs, outcome, *,
                 turns, safe: Callable[[Awaitable], Awaitable[None]]):
        self.s, self.state, self.policy, self.skills = settings, state, policy, skills
        self.delivery, self.chat_jobs, self.outcome = delivery, chat_jobs, outcome
        self.turns, self._safe = turns, safe          # turn.Turns: the run itself, its terms decided there

    # ------------------------------------------------------------------ lookups
    def all(self) -> list[tuple]:
        return ai_jobs(self.skills.all())

    def settings(self) -> dict[str, dict]:
        """Each job that runs: {name: {profile, limit_usd}} — its skill's one brain and one limit per run
        (policy.job_settings)."""
        every = self.skills.all()
        return self.policy().job_settings(job_owners(every), job_starters(every))

    def find(self, name: str) -> tuple | None:
        """(skill, job) of the job with this name, or None."""
        return next(((sk, j) for sk, j in self.all() if j["name"] == name), None)

    def _language_of(self, role: str, origin: Origin | None = None) -> str:
        """The language(s) the job writes in for `role` ("German and French"), its readers' (routing.Routing.readers):
        the first row's alone sent the facility manager's daily report in German to a facility manager who reads
        French (owner, 2026-10-23). With several, send_message takes one version per language (Routing.versions).
        Asked for in a chat, the asker's alone: told the role's two, the job wrote German first and the French asker
        got it (architecture review H2, 2026-10-23)."""
        names = [lang.name for lang, _chats in Routing(self.policy()).readers(role, origin)]
        return " and ".join(names) if names else "English"

    async def run(self, skill, job: dict, origin: Origin | None = None) -> None:
        """An AI job of a skill: its brain and its spending limit per run are its skill's one pair, policy.yaml
        settings.skill_ai (owner, 2026-10-20).

        ⚠️ NOT SET, NOT RUN (owner, 2026-10-01): a job policy.yaml does not name has no agreed cost, so it
        is skipped and the log says so (the VESTA Agent page offers to add it). When the limit stops it,
        the skill's `on_limit` code step still finishes the work (a report is sent with what is done)."""
        name = job["name"]
        cfg = self.settings().get(name)
        work = self.chat_jobs.work                     # in_progress.InProgress: a scheduled run's end row says how it went
        if cfg is None:
            log.warning("AI job %s (skill %s) is not set in policy.yaml: it does not run (%s: Add them).",
                        name, skill.name, where("ai"))
            self.state.log("job_not_set", {"job": name, "skill": skill.name})
            work.verdict(FAILED, f"not set up in {where('ai')}")
            if origin:
                await self.delivery.send(origin.chat, not_set(name), origin=origin)
            return
        prompt = job["prompt"]
        try:
            prompt = prompt.format(fm_language=self._language_of("fm", origin),
                                   owner_language=self._language_of("owner", origin))
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
            res = await self.turns.job(name, cfg, prompt, origin, folder, to, skill.name)
        else:
            async with self.chat_jobs.held(to, name):       # on schedule: asked for meanwhile, it is "already being made"
                res = await self.turns.job(name, cfg, prompt, origin, folder, to, skill.name)
        if res.failed:
            # before 0.6.41 a failed job logged "done" and nobody was told: the report simply never came
            problem = res.problem or "unknown"
            log.warning("AI job %s did not run: %s", name, problem)
            made = await self.run_without_ai(skill, job, problem, origin, folder)
            work.verdict(ENDED if made else FAILED, f"made without the AI: {why_job(problem)}" if made else why_job(problem))
            if to and not made:
                await self.outcome.carry_out({"send": [{"to": job_to(job, origin), "title": "Report not prepared",
                                                        "text": for_job(name, problem, origin)}]},
                                             origin=origin)
            return
        log.info("AI job %s done (%s USD%s)", name, res.cost_usd,
                 ", stopped at its limit" if res.stopped_at_limit else "")
        delivered = res.sent
        if res.stopped_at_limit and job.get("on_limit"):
            delivered += await self.on_limit(folder, skill, job, origin, started, cfg["limit_usd"])
        if delivered == 0:
            # ⚠️ A RUN THAT SENT NOTHING IS ITS OWN OUTCOME (architecture review scan 4, 2026-10-19): the AI wrote the
            # report (res.text) and never called send_message — the run was logged "done" with its cost, counted as a
            # reply written, and on schedule nobody was told; in a chat the waiting message was edited to "ended
            # without a result" as if the task had died. Now: recorded, a failure on the Overview, and ONE sentence
            # sent as the job's result (so the waiting message goes like any result), to the chat that asked or the
            # job's own `to`.
            why = _NO_RESULT["limit" if res.stopped_at_limit else "unsent" if res.text.strip() else "nothing"]
            log.warning("AI job %s sent nothing: %s", name, why)
            self.state.log(agent_records.JOB_NO_RESULT, agent_records.no_result(name, why))
            work.verdict(FAILED, why)
            await self.outcome.carry_out({"send": [{"to": job_to(job, origin), "title": "Report not prepared",
                                                    "text": NOT_COME(name, why, NO_RESULT)}]}, origin=origin)

    async def on_limit(self, folder, skill, job: dict, origin: Origin | None, started: str, limit_usd: float) -> int:
        """The job's `on_limit` steps (skill.yaml) when its spending limit stopped it: the messages they sent.

        ⚠️ ONE PAGE PER LANGUAGE ITS READERS READ (architecture review H1, 2026-10-23): the steps ran once, on the first
        language's notes.json, and that page went to every chat of the role — the facility manager who reads French got
        the German readings although the AI had written the French ones. They now run once per language of the job's
        readers (Routing.readers), `{suffix}` naming that language's files ("" for the first, "_French" for another:
        the reports skill's "Several languages"), and what they send goes to that language's chats only. Read in one
        language, they run once, as before."""
        to = job_to(job, origin)
        readers = Routing(self.policy()).readers(to, origin)
        several = len(readers) > 1
        sent = 0
        for n, lang in enumerate([lang for lang, _chats in readers] or [None]):
            done = await job_steps.run(folder, self.state, self.skills, self.outcome, skill, job["on_limit"],
                                       {"to": to, "started": started, "limit": f"{limit_usd:g}",
                                        "suffix": f"_{lang.name}" if n and lang else ""}, origin,
                                       language=lang.code if several and lang else None)
            sent += done.sent
        return sent

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

    async def start(self, name: str, chat: int, role: str | None = None, by: str | None = None) -> str:
        """A job a skill marks on_request, started from a chat: its own model and limit, and what the person who asked
        (`role`) may use there (turn.job_terms). `by`: their name (what the AI is told of the chat: chat_facts.py)."""
        found = self.find(name)
        if not found or not found[1].get("on_request"):
            return f"There is no {name} report that can be started from a chat."
        jobs = self.settings()
        if name not in jobs:
            return not_set(name)
        sk, job = found
        # ⚠️ THE AGENT SAYS WHETHER IT IS RUNNING, NOT THE AI'S MEMORY (villa, 2026-10-07 01:22): asked again 30 s after
        # the report was sent, the AI answered "already being generated" from the conversation and started nothing.
        # A second start while one runs would make the report twice (chat_jobs.ChatJobs.start: Started).
        cfg = jobs[name]
        st = self.chat_jobs.start(chat, name, lambda origin: self.run(sk, job, origin), role=role, by=by)
        # ⚠️ THE START TIME, SAID BY THE AGENT (owner, 2026-10-09: the waiting message read "Still in progress" for a
        # report that had just started). The model called start_job twice in one turn, the second answer said "still
        # running", and the model told the person that. A report started in the last minute IS just started
        # (chat_jobs.JUST_STARTED_S): both answers say so, with its time, and say what to tell the person.
        if st.kind in (NEW, JUST_STARTED):
            return (f"Started {name} now, at {when(st.since, self.s.timezone)} (brain {cfg['profile']}, limit "
                    f"{cfg['limit_usd']:g} USD). Tell the person in one short sentence that it has just started and will "
                    "arrive in this chat in a few minutes. Do not say it is still running or in progress.")
        return being_made(name, st, self.s.timezone) + " Tell the person when it started."

    def without_ai_able(self) -> list[dict]:
        """The jobs a person may start from a chat that can be made without the AI (skill.yaml without_ai), set up."""
        jobs = self.settings()
        return [j for _, j in self.all() if j.get("on_request") and j.get("without_ai") and j["name"] in jobs]

    def start_without_ai(self, name: str, problem: str, chat: int, waiting_mid: int | None = None,
                         by: str | None = None) -> str:
        """A report made from its figures because the AI cannot answer (named in a message, or its button pressed:
        `waiting_mid`, the pressed message), sent here. What the person is told."""
        found = self.find(name)
        if not found or not any(j["name"] == name for j in self.without_ai_able()):
            return "This report cannot be made without the AI."
        sk, job = found

        async def made(origin: Origin) -> None:
            if not await self.run_without_ai(sk, job, problem if problem in AI_DOWN else "unknown", origin):
                self.chat_jobs.work.verdict(FAILED, "its figures could not be read without the AI either")
                await self.delivery.send(chat, NOT_COME(name, "its figures could not be read without the AI either", CHAT),
                                         origin=origin)
        st = self.chat_jobs.start(chat, name, made, waiting_mid, by=by)
        # the same "just started" window as start (architecture review 12: this path had none)
        if st.kind in (NEW, JUST_STARTED):
            return f"Making the {job['button']} without the AI, from its figures and charts: it will be sent here."
        return being_made(name, st, self.s.timezone)
