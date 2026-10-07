"""The VESTA Kiosk's Facility records as the agent keeps them: a fault ticket per open task, resolved with it.

Taken out of outcome.py (architecture review, 2026-10-07): the module that carries out a script's result also held
the tickets and the alert buttons, eleven dependencies for three jobs. Its callers: a script's result (ticket,
ticket.resolve), the AI's create_ticket tool, and the reconciliation at each start and each night (repair).
"""
from __future__ import annotations

import logging
from typing import Awaitable, Callable

from vesta_shared import result
from vesta_shared.problems import CLEARED, Problems

from .outcome_words import ticket_title

log = logging.getLogger("vesta.outcome")


class Tickets:
    def __init__(self, *, kiosk, state, store_path: str, settle_alert: Callable[[int, str], Awaitable[int]]):
        self.kiosk = kiosk
        self.state = state
        self.store_path = store_path
        self.settle_alert = settle_alert      # alert_buttons.AlertButtons.settle: an incident closed in the Kiosk

    def _store(self):
        from vesta_shared.store import Store
        return Store(self.store_path)

    async def create(self, title: str, entity_id: str | None = None, note: str | None = None,
                            task_id: int | None = None) -> str | None:
        """A fault in the Kiosk's Facility records. With a task_id, the task remembers its ticket."""
        if not self.kiosk.enabled:
            self.state.log("ticket_skipped", {"reason": "no Kiosk configured", "summary": (title or "")[:80]})
            return None
        tid = await self.kiosk.add_ticket(ticket_title(title)[:200], entity_id=entity_id, note=note)
        log.info("Kiosk ticket %s created: %s", tid, ticket_title(title)[:80])
        if task_id:
            self._store().set_task_uid(int(task_id), tid)
        self.state.log("executed", {"tool": "ticket", "ticket": tid, "entity": entity_id})
        return tid

    async def resolve(self, a: dict) -> bool:
        """ticket.resolve {task_id | ticket_id, note?}: the Kiosk's ticket resolved."""
        task = self._store().task(int(a.get("task_id") or 0)) if a.get("task_id") else None
        uid = (task or {}).get("todo_uid") or a.get("ticket_id")
        if uid and self.kiosk.enabled and await self.kiosk.resolve_ticket(uid, note=a.get("note")):
            log.info("Kiosk ticket %s resolved", uid)
            return True
        return False

    async def repair(self) -> int:
        """The open tasks and the Kiosk's tickets agree (at each start and each night, owner, 2026-10-01):
          - a task whose ticket a person resolved in the Kiosk is closed, with the incident it came from
            (vesta_shared.problems decides; here only the Kiosk is read and the alert's messages settled);
          - a task that outlived its finding or incident is closed, its ticket resolved;
          - an open task without its ticket gets one (a task stored while the Kiosk was off, or by a
            script whose result was dropped).
        ⚠️ Without the first two the Kiosk's Cockpit only ever grew: 22 "Open fault" for problems gone."""
        if not self.kiosk.enabled:
            return 0
        store = self._store()
        problems = Problems(store)
        try:
            held = await self.kiosk.held_tickets()
        except Exception as e:  # noqa: BLE001 — the next start or night tries again
            log.warning("The Kiosk's tickets could not be read (%s)", type(e).__name__)
            return 0
        states = {tid: t["status"] for tid, t in held.items()}
        closed = cleared = 0
        for t in problems.open_tasks():
            uid = t.get("todo_uid")
            if uid and states.get(uid) == "resolved":
                iid = problems.closed_in_kiosk(t["id"])
                if iid:
                    await self.settle_alert(iid, "Closed in the VESTA Kiosk, {time}.")
                closed += 1
            elif problems.source_gone(t):
                problems.close(t["id"], CLEARED)
                if uid and states.get(uid) not in (None, "resolved"):
                    await self.kiosk.resolve_ticket(uid, note="Cleared: the check no longer sees it.")
                cleared += 1
        if closed or cleared:
            log.info("Kiosk tickets reconciled: %d task(s) closed in the Kiosk, %d cleared with their ticket", closed, cleared)
        # ⚠️ AN OPEN FAULT SAYS WHAT IS WRONG NOW (owner, 2026-10-07): the ticket kept "battery at 5 %" for days while
        # the night check's finding read 0 % — the ticket was written once
        updated = 0
        for t in problems.open_tasks():
            uid = t.get("todo_uid")
            now_title = ticket_title(problems.current_title(t))[:200]
            if uid and uid in held and held[uid]["status"] != "resolved" and now_title and held[uid]["title"] != now_title:
                try:
                    if await self.kiosk.update_ticket(uid, now_title):
                        updated += 1
                except Exception as e:  # noqa: BLE001
                    log.warning("A Kiosk ticket could not be brought up to date (%s)", type(e).__name__)
                    break
        if updated:
            log.info("Kiosk tickets brought up to date: %d", updated)
        made = 0
        for t in problems.open_tasks():
            if t.get("todo_uid"):
                continue
            try:
                check = problems.check_of(t)
                if await self.create(problems.title_of(t), t.get("entity_id") or None,
                                            result.fault_note(check), t["id"]):
                    made += 1
            except Exception as e:  # noqa: BLE001 — the next start or night tries again
                log.warning("A missing Kiosk ticket could not be created (%s)", type(e).__name__)
                break
        if made:
            log.info("Kiosk tickets created for %d open task(s) that had none", made)
        return made
