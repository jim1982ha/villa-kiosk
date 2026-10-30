"""The schedule: what the skills declare, read again at every tick.

Every 30 seconds the scheduler lists the skills (a skill added, changed or deleted
counts at once) and starts:
  - each skill's `every_5_min` code job, every 5 minutes (the alert chase);
  - each `schedule` entry whose time has come: a code job (`run:`, no model, no
    token) or a model job (`prompt:`);
  - the engine's own job: the knowledge pack rebuilt once a day at pack_at() (pack.rebuild_at),
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

from vesta_shared.limits import limit
from vesta_shared.when import Spec

from .in_progress import AGAIN, SCHEDULED, InProgress, Item

log = logging.getLogger("vesta.scheduler")

TICK_SECONDS = 30
def every() -> timedelta:
    """How often the skills' frequent checks run (skill.yaml `every_5_min`: the alert chase, the faults read again,
    which devices are offline). ⚠️ A SETTING, NEVER A NUMBER WRITTEN HERE (owner, 2026-10-24: "every 5 minutes" in the
    skills' guides could not be changed): read at every tick, so a change counts from the next one; the VESTA Kiosk's
    "Next check" follows it (the heartbeat's cadence, app.Vesta._cadence)."""
    return timedelta(minutes=limit("jobs.every_minutes", 5, unit="minutes", group="run", lo=1, hi=60,
                                   says="How often the skills' frequent checks run: the alert reminders, the open "
                                        "faults read again, which devices are offline.",
                                   reached="A longer time: those checks and the Kiosk's Next check come less often.",
                                   told=""))


def window() -> timedelta:
    """How late a scheduled job still runs: a restart inside it does not lose the job, nor run it twice."""
    return timedelta(minutes=limit("jobs.catch_up_minutes", 30, unit="minutes", group="run", lo=5, hi=720,
                                   says="How late a scheduled job still runs when the agent was stopped at its time "
                                        "(an update, a restart).",
                                   reached="Later than this, that day's run is skipped.", told=""))


def pack_at() -> str:
    """When the villa's device list (the knowledge pack) is rebuilt each night, villa time: before the night's checks
    read it. A setting (owner, 2026-10-24: "01:30" written in a guide could not be changed)."""
    return limit("pack.rebuild_at", "01:30", unit="villa time", group="read",
                 says="When the villa's device list is rebuilt each night, before the night's checks read it.",
                 reached="Set after a skill's nightly check, that check reads the previous night's list.", told="")


# what a person reads for the engine's own jobs (owner, 2026-10-20: "knowledge pack" named nothing on the page)
ENGINE_JOBS = {"engine:pack": "Villa's device list (refreshed)", "engine:housekeeping": "Old records removed"}


def job_key(skill: str, schedule: list, i: int) -> str:
    """A scheduled entry's slot key — what the state records (claim_job_slot, the run and end rows) and the Overview
    lists: the job itself and its time, "reports:fm-daily@07:00".

    ⚠️ THE JOB, NEVER ITS PLACE (review L, 2026-10-25): until 0.12.350 the key held the entry's place in the list
    ("reports:0:07:00"), so deleting the daily report made the Overview name the weekly one for the daily's run. A run
    already claimed today under the older key does not run again under this one: its day is kept by its ident too
    (jobday:, claim_job_slot)."""
    return f"{job_ident(skill, schedule, i)}@{schedule[i]['when']}"


def job_of(key: str) -> str:
    """The job a slot key names, without its time ("reports:fm-daily@07:00" → "reports:fm-daily"): job_ident's."""
    return key.rsplit("@", 1)[0]


def job_ident(skill: str, schedule: list, i: int) -> str:
    """A scheduled job by itself, whatever its place or time: its skill and its name (an AI job's), or its script (a
    code job's) — with its place only when two entries of the skill share both."""
    def name(j):
        return str(j.get("name") or str(j.get("run") or "").split(" ")[0] or "")
    me = name(schedule[i])
    same = [k for k, j in enumerate(schedule) if name(j) == me]
    return f"{skill}:{me}" + (f"#{same.index(i)}" if len(same) > 1 or not me else "")


def job_label(key: str, skills: dict) -> str:
    """What a person reads for a slot key (owner, 2026-10-08: "reports:0:07:00" repeated the time the Ran at column
    already shows): its skill and what ran (skills.job_title) — an AI job's name (reports › fm-daily, owner
    2026-10-20), a code job's script (preventive-maintenance › nightly.py); the engine's jobs, which belong to no
    skill, in words — never the entry's index or time."""
    from .skills import job_title
    if key in ENGINE_JOBS:
        return ENGINE_JOBS[key]
    skill, _, rest = key.partition(":")
    if "@" not in key:
        return skill            # an older engine's key ("reports:0:07:00"): its place may name another job now
    what = rest.rsplit("@", 1)[0].split("#", 1)[0]
    return job_title(skill, what) if what else skill

class Scheduler:
    def __init__(self, settings, skills, state, run_code, run_model, rebuild_pack, housekeeping=None, work=None):
        self.s = settings
        self.skills = skills
        self.state = state
        self.work = work or InProgress(state)          # what runs and what a stop cut (in_progress.py)
        self.run_code = run_code            # async (skill, command, timeout) -> None
        self.run_model = run_model          # async (skill, job) -> None: ai_jobs.AiJobs.run
        self.rebuild_pack = rebuild_pack    # async () -> None
        self.housekeeping = housekeeping    # async () -> None, every tick
        self._last_every: datetime | None = None
        self._running: dict[str, asyncio.Task] = {}     # job key → its task, while it runs
        # ⚠️ A RUN CUT BY A STOP IS RUN AGAIN (architecture review 21): the slot was claimed before the run, so an update
        # in the middle of the morning report lost it for the day, without a word. A run in progress is recorded
        # (in_progress.InProgress.kept); one still recorded at start was cut, and its slot may be claimed once more in its
        # window — unless its report had arrived (in_progress.ON_START)
        self._cut: dict[str, str] = {r.name: r.slot for r in self.work.left(SCHEDULED) if r.then == AGAIN}
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

    @property
    def last_look(self) -> datetime | None:
        """When the every-5-minutes jobs last started (None before the first tick): the Kiosk's "Next check" counts
        from it (heartbeat cadence `lastLookAt`, owner 2026-10-21: its time moved every minute, "now + 5 min")."""
        return self._last_every

    def _claim(self, job: str, slot: datetime, ident: str | None = None) -> bool:
        if self._cut.get(job) == slot.isoformat():
            del self._cut[job]
            return True
        return self.state.claim_job_slot(job, slot.isoformat(), ident)

    def _frequent(self, sk):
        """A skill's frequent check (skill.yaml `every_5_min`), run once."""
        return self.run_code(sk, sk.every_5_min, limit(
            "jobs.five_minute_timeout_s", 300, unit="seconds", group="run", lo=30, hi=3600,
            says="How long a skill's frequent check (jobs.every_minutes) may run.",
            reached="It is stopped and counts as failed.", told="person"))

    def frequent_now(self, which) -> list[str]:
        """The frequent check of each skill `which(skill)` picks, started now rather than at its next tick (a Need help
        pressed on the tablet: app.Vesta.records_changed). One already running is run again after it: started before
        the press, it may not have seen it. The tick's own clock is left as it is. What it started or queued."""
        out = []
        for sk in self.skills.all().values():
            if not sk.every_5_min or not which(sk):
                continue
            key = f"{sk.name}:every_5_min"
            running = self._running.get(key)
            if running is not None and not running.done():
                async def after(sk=sk, running=running, key=key):
                    await asyncio.gather(running, return_exceptions=True)
                    self._start(key, lambda: self._frequent(sk))
                self._start(f"{key}:again", after)
            else:
                self._start(key, lambda sk=sk: self._frequent(sk))
            out.append(key)
        return out

    async def tick(self, now: datetime | None = None) -> list[str]:
        """One pass. Returns what it started, for the log and the tests."""
        now = now or datetime.now(ZoneInfo(self.s.timezone))
        started = []
        skills = self.skills.all()
        if self._last_every is None or now - self._last_every >= every():
            self._last_every = now
            for sk in skills.values():
                if sk.every_5_min and self._start(f"{sk.name}:every_5_min", lambda sk=sk: self._frequent(sk)):
                    started.append(f"{sk.name}:every_5_min")
        slot = Spec.parse(pack_at()).due(now, window())
        if slot and self._claim("engine:pack", slot):
            async def pack(slot=slot):
                # ⚠️ ITS END RECORDED LIKE EVERY SCHEDULED JOB'S (owner, 2026-10-20: Scheduled jobs run said "done" for
                # the night check and "run" for this one — it wrote no end row): done, or stopped by a restart
                async with self.work.kept(Item(SCHEDULED, "engine:pack", slot=slot.isoformat())):
                    await self.rebuild_pack()
            if self._start("engine:pack", pack):
                started.append("engine:pack")
        for sk in skills.values():
            for i, job in enumerate(sk.schedule):
                # ⚠️ THE LATEST SLOT, ON WHATEVER DAY IT FELL (architecture review, round 9): looked for on now's own
                # date, a 23:45 job missed by a restart across midnight was lost though its window still held it
                slot = Spec.parse(job["when"]).due(now, window())
                # ⚠️ ONE KEY FOR CLAIMING THE SLOT AND FOR "STILL RUNNING" (architecture review, 2026-10-07): the slot
                # was claimed per entry (skill:i:when) and started per time (skill:when) — two jobs of a skill at the
                # same time, and the second, claimed, was refused as "still running": lost for the day
                key = job_key(sk.name, sk.schedule, i)
                if not slot or not self._claim(key, slot, job_ident(sk.name, sk.schedule, i)):
                    continue
                name = f"{sk.name}:{job['when']}"

                async def run(sk=sk, job=job, key=key, slot=slot):
                    # kept while it runs; what it sends from this task is its result (in_progress.InProgress.arrived)
                    async with self.work.kept(Item(SCHEDULED, key, slot=slot.isoformat())):
                        await self._after_pack()
                        if job.get("run"):
                            await self.run_code(sk, job["run"], job["timeout"])
                        else:
                            await self.run_model(sk, job)
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
