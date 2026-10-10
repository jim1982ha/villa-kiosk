"""The siren: whatever turns it on, it stops by itself after the villa's minutes — on every path, across a restart.

⚠️ ONE OWNER FOR A SAFETY DEVICE (architecture review 6, 2026-10-07). The stop was scheduled only after an Approve
press (app.handle_callback → after_execution): a villa whose rules run the siren's turn_on `direct` turned it on
with no stop at all; and the stop was a bare timer in memory, which a restart forgot. Now every execution goes past
`executed` (actions.py calls it), which records WHEN it must stop (state.py); `watch` stops it at that time — a
restart reads the time back.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

log = logging.getLogger("vesta")
CHECK_EVERY_S = 5.0


class Siren:
    def __init__(self, policy: Callable, state, actions, tell_owner: Callable[[str], Awaitable[None]]):
        self.policy, self.state, self.actions, self.tell_owner = policy, state, actions, tell_owner

    def executed(self, domain: str, service: str, entity_ids: list[str], now: datetime | None = None) -> None:
        """Any execution on the villa (actions.py): when it turned the configured siren on, its stop is due in the
        villa's minutes. Recorded whether or not the read-back confirmed it: a stop of a silent siren costs nothing."""
        pol = self.policy()
        if not pol.siren_entity or service != "turn_on" or domain != pol.siren_entity.split(".")[0] \
                or pol.siren_entity not in (entity_ids or []):
            return
        at = (now or datetime.now(timezone.utc)) + timedelta(minutes=pol.siren_auto_off_min)
        self.state.set_siren_stop(at.isoformat(), pol.siren_entity)
        log.info("Siren on: it stops by itself at %s (%s min)", at.isoformat(timespec="seconds"), pol.siren_auto_off_min)

    async def tick(self, now: datetime | None = None) -> bool:
        """Stop the siren if its time has come; True when it was due."""
        due = self.state.siren_stop()
        if not due or datetime.fromisoformat(due) > (now or datetime.now(timezone.utc)):
            return False
        # ⚠️ THE RULES READ BEFORE THE STOP IS FORGOTTEN (architecture review 17): cleared first, a reading that failed
        # lost it for good — the siren was never switched off, even after a restart
        pol = self.policy()
        # ⚠️ THE SIREN THAT WAS TURNED ON (architecture review 18): the rules' siren may have changed since, or the rules
        # may not have been readable — the stop is for the one that sounds
        entity = self.state.siren_stopping() or pol.siren_entity
        self.state.set_siren_stop(None)
        if not entity:
            return True
        ok = await asyncio.to_thread(self.actions.system, entity.split(".")[0], "turn_off", entity, siren=entity)
        await self.tell_owner("Siren switched off." if ok else "The siren could not be switched off: check it now.")
        return True

    async def watch(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                await self.tick()
            except Exception:  # noqa: BLE001 — a failed check is tried again at the next one
                log.exception("siren check failed")
            try:
                await asyncio.wait_for(stop.wait(), timeout=CHECK_EVERY_S)
            except asyncio.TimeoutError:
                pass
