"""The VESTA Kiosk's Facility records as the agent keeps them: a fault ticket per open task, resolved with it.

Taken out of outcome.py (architecture review, 2026-10-07): the module that carries out a script's result also held
the tickets and the alert buttons, eleven dependencies for three jobs. Its callers: a script's result (ticket,
ticket.resolve), the AI's create_ticket tool, and the reconciliation at each start and each night (repair).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

from vesta_shared import result
from vesta_shared.problems import CLEARED, Problems

from .outcome_words import ticket_title

log = logging.getLogger("vesta.outcome")


def kiosk_close_note(ticket: dict, zone: str) -> str:
    """The note a fault closed in the VESTA Kiosk leaves on its alert's messages: "Closed in the VESTA Kiosk by Facility
    manager on 10/10/2026 17:13" — the profile and the moment the Kiosk recorded; the moment noticed without them."""
    from datetime import datetime
    from .notice import when
    by = f" by {ticket['by']}" if ticket.get("by") else ""
    try:
        at = when(datetime.fromisoformat(str(ticket.get("resolved_at")).replace("Z", "+00:00")), zone)
    except ValueError:
        at = "{time}"
    return f"Closed in the VESTA Kiosk{by} on {at}."


class Tickets:
    def __init__(self, *, kiosk, state, store_path: str, settle_alert: Callable[[int, str], Awaitable[int]],
                 timezone: str = "UTC"):
        self.kiosk = kiosk
        self.timezone = timezone              # the villa's: the note's time (notice.when)
        self.state = state
        self.store_path = store_path
        self.settle_alert = settle_alert      # incident_thread.IncidentThread.close: an incident closed in the Kiosk

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

    async def reopen(self, a: dict) -> bool:
        """ticket.reopen {task_id, title, note}: the task's fault open again in the Kiosk under its new title — or, when it
        never had one or it is gone, a new one for the task (architecture review 24: one problem, one fault)."""
        task = self._store().task(int(a["task_id"]))
        if not task or not self.kiosk.enabled:
            return False
        uid = task.get("todo_uid")
        if uid and await self.kiosk.reopen_ticket(uid, ticket_title(a.get("title") or task.get("summary") or ""), a.get("note")):
            log.info("Kiosk ticket %s open again: %s", uid, (a.get("title") or "")[:80])
            return True
        return bool(await self.create(a.get("title") or task.get("summary") or "", task.get("entity_id") or None,
                                      a.get("note") or None, task["id"]))

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
            if uid and states.get(uid) == "resolved" and _before(held[uid].get("resolved_at"), t.get("reopened_at")):
                # ⚠️ RESOLVED BEFORE IT CAME BACK (architecture review 24): the task reopened and its fault's reopening did
                # not reach the Kiosk — that old resolution is not a person closing it now
                await self.reopen({"task_id": t["id"], "title": t.get("summary") or ""})
                continue
            if uid and states.get(uid) == "resolved":
                iid = problems.closed_in_kiosk(t["id"])
                if iid:
                    # who and when, as a button's footer says it (owner, 2026-10-10): the Kiosk's own record of the close
                    await self.settle_alert(iid, kiosk_close_note(held.get(uid) or {}, self.timezone))
                closed += 1
            elif problems.source_gone(t) and not t.get("reopened_by"):
                problems.close(t["id"], CLEARED)
                if uid and states.get(uid) not in (None, "resolved"):
                    await self.kiosk.resolve_ticket(uid, note="Cleared: the check no longer sees it.")
                    states[uid] = "resolved"
                cleared += 1
        # ⚠️ A CLOSED TASK'S FAULT IS CLOSED (architecture review 24): a resolve that failed (the Kiosk down a moment) left
        # the fault "Open" for good — only open tasks were read. Two days back: enough for any blip.
        # ⚠️ BUT A PERSON'S REOPENING IS THEIRS (architecture review 25): the fault reopened in the Cockpit for the
        # facility manager to look was resolved again within 5 minutes. Updated in the Kiosk after the task closed: a
        # person reopened it — its task opens again and the facility manager is asked (Problems.reopened_in_kiosk)
        recent = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        for t in store.tasks(None):
            uid = t.get("todo_uid")
            if t["status"] != "open" and (t.get("done_at") or "") >= recent and uid and states.get(uid) not in (None, "resolved"):
                if _before(t.get("done_at"), held[uid].get("updated_at")):
                    problems.reopened_in_kiosk(t["id"], held[uid].get("by") or "")
                    log.info("Kiosk ticket %s reopened by a person: its task is open again", uid)
                elif await self.kiosk.resolve_ticket(uid, note="Closed: the problem is over."):
                    states[uid] = "resolved"
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


def _before(resolved_at: str | None, reopened_at: str | None) -> bool:
    """Is the first moment before the second? Moments as the Kiosk ("…Z") and the store ("…+00:00") write them."""
    if not (resolved_at and reopened_at):
        return False
    try:
        return datetime.fromisoformat(resolved_at.replace("Z", "+00:00")) < datetime.fromisoformat(reopened_at.replace("Z", "+00:00"))
    except ValueError:
        return False
