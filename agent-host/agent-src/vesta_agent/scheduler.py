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
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

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


class Scheduler:
    def __init__(self, settings, skills, state, run_code, run_model, rebuild_pack, housekeeping=None):
        self.s = settings
        self.skills = skills
        self.state = state
        self.run_code = run_code            # async (skill, command, timeout) -> None
        self.run_model = run_model          # async (skill, prompt, name) -> None
        self.rebuild_pack = rebuild_pack    # async () -> None
        self.housekeeping = housekeeping    # async () -> None, every tick
        self._last_every: datetime | None = None

    def _claim(self, key: str, slot: datetime) -> bool:
        if self.state.get(key) == slot.isoformat():
            return False
        self.state.put(key, slot.isoformat())
        return True

    async def tick(self, now: datetime | None = None) -> list[str]:
        """One pass. Returns what it started, for the log and the tests."""
        now = now or datetime.now(ZoneInfo(self.s.timezone))
        started = []
        skills = self.skills.all()
        if self._last_every is None or now - self._last_every >= EVERY:
            self._last_every = now
            for sk in skills.values():
                if sk.every_5_min:
                    await self.run_code(sk, sk.every_5_min, 300)
                    started.append(f"{sk.name}:every_5_min")
        slot = slot_for(PACK_AT, now)
        if slot and self._claim("job:engine:pack", slot):
            await self.rebuild_pack()
            started.append("engine:pack")
        for sk in skills.values():
            for i, job in enumerate(sk.schedule):
                slot = slot_for(job["when"], now)
                if not slot or not self._claim(f"job:{sk.name}:{i}:{job['when']}", slot):
                    continue
                name = f"{sk.name}:{job['when']}"
                if job.get("run"):
                    await self.run_code(sk, job["run"], job["timeout"])
                else:
                    await self.run_model(sk, job)
                started.append(name)
        if self.housekeeping:
            await self.housekeeping()
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
