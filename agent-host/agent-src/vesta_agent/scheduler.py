"""The schedule: what the skills declare, read again at every tick.

Every 30 seconds the scheduler lists the skills (a skill added, changed or deleted
counts at once) and starts:
  - each skill's `every_5_min` code job, every 5 minutes (the alert chase);
  - each `schedule` entry whose time has come: a code job (`run:`, no model, no
    token) or a model job (`prompt:`);
  - the engine's own job: the knowledge pack rebuilt once a day at PACK_AT,
    before the night's checks read it.

A slot is run once: its time is written in the state database before it starts,
so a restart inside the slot's 30-minute window does not run it twice.

⚠️ EVERY JOB RUNS BESIDE THE TICK, NEVER INSIDE IT (architecture review, 0.12.38). The tick
awaited each job in turn, so the 02:00 nightly check (allowed 30 minutes) or a 07:00 AI job
held the whole scheduler: the alert chase (every_5_min) did not run while it worked, and a
slot whose window closed meanwhile was lost. Each job is now a task the tick starts and
leaves; a job still running is not started again; a scheduled job waits for a pack rebuild
still in progress, so the night's checks never read a half-built pack.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .state import RUNNING_JOB

log = logging.getLogger("vesta.scheduler")

TICK_SECONDS = 30
EVERY = timedelta(minutes=5)
WINDOW = timedelta(minutes=30)
PACK_AT = "01:30"


def slot_for(spec: str, now: datetime) -> datetime | None:
    """The slot `spec` names for `now`'s day, when `now` is inside its window; else None.

    "07:00" daily · "Mon 08:00" on Mondays · "1 08:00" on the 1st of the month."""
    parts = spec.split()
    h, m = map(int, parts[-1].split(":"))
    slot = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if now < slot or now - slot > WINDOW:
        return None
    if len(parts) == 2:
        cond = parts[0]
        if cond.isdigit() and now.day != int(cond):
            return None
        if not cond.isdigit() and now.strftime("%a") != cond:
            return None
    return slot


DAYS = {"Mon": "Monday", "Tue": "Tuesday", "Wed": "Wednesday", "Thu": "Thursday", "Fri": "Friday",
        "Sat": "Saturday", "Sun": "Sunday"}


def describe(spec: str) -> tuple[str, float]:
    """A schedule in words, and how many times it runs in a month — for the VESTA Agent page, which used to
    re-parse this grammar itself (architecture review, 2026-10-01: one owner of "07:00 / Mon 08:00 / 1 08:00")."""
    parts = spec.split()
    if len(parts) == 1:
        return f"every day at {parts[0]}", 30.0
    if parts[0].isdigit():
        return f"on day {parts[0]} of each month at {parts[1]}", 1.0
    return f"every {DAYS.get(parts[0], parts[0])} at {parts[1]}", 4.35



ENGINE_JOBS = {"engine:pack": "knowledge pack", "engine:housekeeping": "housekeeping"}


def job_key(skill: str, index: int, when: str) -> str:
    """A scheduled entry's slot key — what the state records (claim_job_slot) and the Overview lists. ⚠️ Never change
    it: a new key is a slot never claimed, and today's job would run again."""
    return f"{skill}:{index}:{when}"


def job_label(key: str, skills: dict) -> str:
    """What a person reads for a slot key (owner, 2026-10-08: "reports:0:07:00" repeated the time the Ran at column
    already shows): an AI job's own name (fm-daily), a code job's skill and script (preventive-maintenance ›
    nightly.py), the engine's jobs in words — never the entry's index or time."""
    if key in ENGINE_JOBS:
        return ENGINE_JOBS[key]
    skill, _, rest = key.partition(":")
    index, _, _when = rest.partition(":")
    sk = skills.get(skill)
    try:
        job = sk.schedule[int(index)] if sk is not None else None
    except (ValueError, IndexError):
        job = None
    if job and job.get("name"):
        return job["name"]
    if job and job.get("run"):
        return f"{skill} › {str(job['run']).split()[0]}"
    return skill

class Scheduler:
    def __init__(self, settings, skills, state, run_code, run_model, rebuild_pack, housekeeping=None):
        self.s = settings
        self.skills = skills
        self.state = state
        self.run_code = run_code            # async (skill, command, timeout) -> None
        self.run_model = run_model          # async (skill, job) -> None: ai_jobs.AiJobs.run
        self.rebuild_pack = rebuild_pack    # async () -> None
        self.housekeeping = housekeeping    # async () -> None, every tick
        self._last_every: datetime | None = None
        self._running: dict[str, asyncio.Task] = {}     # job key → its task, while it runs
        # ⚠️ A RUN CUT BY A STOP IS RUN AGAIN (architecture review 21): the slot was claimed before the run, so an update
        # in the middle of the morning report lost it for the day, without a word. A run in progress is recorded
        # (state.job_running); one still recorded at start was cut, and its slot may be claimed once more in its window
        self._cut: dict[str, str] = state.jobs_cut()
        if self._cut:
            log.info("Scheduled runs cut by the last stop, run again in their window: %s", ", ".join(sorted(self._cut)))

    def _start(self, key: str, make) -> bool:
        """Start `make()` as a task unless the same job is still running. True if started."""
        t = self._running.get(key)
        if t is not None and not t.done():
            log.info("%s is still running: not started again", key)
            return False
        task = asyncio.create_task(self._guard(key, make))
        self._running[key] = task
        return True

    async def _guard(self, key: str, make) -> None:
        try:
            await make()
        except Exception:  # noqa: BLE001 — one job's failure never stops the others
            log.exception("%s failed", key)

    async def _after_pack(self) -> None:
        """A scheduled job's first step: the pack rebuild, if one is running, finishes first."""
        t = self._running.get("engine:pack")
        if t is not None and not t.done():
            await asyncio.shield(t)

    async def idle(self) -> None:
        """Every job started so far, finished (the tests and a clean stop)."""
        while any(not t.done() for t in self._running.values()):
            await asyncio.gather(*[t for t in self._running.values() if not t.done()], return_exceptions=True)

    def _claim(self, job: str, slot: datetime) -> bool:
        if self._cut.get(job) == slot.isoformat():
            del self._cut[job]
            return True
        return self.state.claim_job_slot(job, slot.isoformat())

    async def tick(self, now: datetime | None = None) -> list[str]:
        """One pass. Returns what it started, for the log and the tests."""
        now = now or datetime.now(ZoneInfo(self.s.timezone))
        started = []
        skills = self.skills.all()
        if self._last_every is None or now - self._last_every >= EVERY:
            self._last_every = now
            for sk in skills.values():
                if sk.every_5_min and self._start(f"{sk.name}:every_5_min",
                                                  lambda sk=sk: self.run_code(sk, sk.every_5_min, 300)):
                    started.append(f"{sk.name}:every_5_min")
        slot = slot_for(PACK_AT, now)
        if slot and self._claim("engine:pack", slot) and self._start("engine:pack", self.rebuild_pack):
            started.append("engine:pack")
        for sk in skills.values():
            for i, job in enumerate(sk.schedule):
                slot = slot_for(job["when"], now)
                # ⚠️ ONE KEY FOR CLAIMING THE SLOT AND FOR "STILL RUNNING" (architecture review, 2026-10-07): the slot
                # was claimed per entry (skill:i:when) and started per time (skill:when) — two jobs of a skill at the
                # same time, and the second, claimed, was refused as "still running": lost for the day
                key = job_key(sk.name, i, job["when"])
                if not slot or not self._claim(key, slot):
                    continue
                name = f"{sk.name}:{job['when']}"

                async def run(sk=sk, job=job, key=key, slot=slot):
                    self.state.job_running(key, slot.isoformat())
                    RUNNING_JOB.set(key)              # this task's own context: what it sends marks it delivered
                    cut = False
                    try:
                        await self._after_pack()
                        if job.get("run"):
                            await self.run_code(sk, job["run"], job["timeout"])
                        else:
                            await self.run_model(sk, job)
                    except asyncio.CancelledError:
                        cut = True            # the agent is stopping: the record stays for the next start
                        raise
                    finally:
                        if not cut:
                            self.state.job_running(key, None)
                if self._start(key, run):
                    started.append(name)
        if self.housekeeping:
            # beside the tick like every job, never inside it: it may wait on HA MCP (90 s) when it is down
            self._start("engine:housekeeping", self.housekeeping)
        return started

    async def run(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                await self.tick()
            except Exception:  # noqa: BLE001
                log.exception("scheduler tick failed")
            try:
                await asyncio.wait_for(stop.wait(), timeout=TICK_SECONDS)
            except asyncio.TimeoutError:
                pass
