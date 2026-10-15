"""The VESTA Kiosk's Facility records as the agent keeps them: a fault ticket per open task, resolved with it.

Taken out of outcome.py (architecture review, 2026-10-07): the module that carries out a script's result also held
the tickets and the alert buttons, eleven dependencies for three jobs. Its callers: a script's result (ticket,
ticket.resolve), the AI's create_ticket tool, and the reconciliation at each start and each night (repair).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

from vesta_shared import kiosk_words, result
from vesta_shared.problems import Problems

from .kiosk import NOTED, KioskError
from .outcome_words import ticket_title

log = logging.getLogger("vesta.outcome")


def kiosk_close_note(ticket: dict, zone: str) -> str:
    """The note a fault closed in the VESTA Kiosk leaves on its alert's messages: "Closed in the VESTA Kiosk by Wayan on
    10/10/2026 17:13." — who (the name typed, else the profile) and when the Kiosk recorded (vesta_shared.kiosk_words)."""
    return kiosk_words.closed(ticket.get("by") or "", ticket.get("resolved_at"), zone) + "."


def kiosk_reopen_note(ticket: dict, summary: str | None, zone: str) -> str:
    """What the facility manager reads when a person reopened a fault in the VESTA Kiosk (vesta_shared.kiosk_words)."""
    return kiosk_words.reopened(ticket.get("reopened_by") or "", ticket.get("reopened_at"), zone, summary)


class Tickets:
    def __init__(self, *, kiosk, state, store_path: str, settle_alert: Callable[[int, str], Awaitable[int]],
                 timezone: str = "UTC", tell_fm: Callable[[str], Awaitable[object]] | None = None,
                 story: Callable[[int], list[dict]] | None = None,
                 restate_alert: Callable[[int, str], Awaitable[int]] | None = None):
        self.kiosk = kiosk
        self.tell_fm = tell_fm                # a message to the facility manager (a night fault reopened in the Kiosk)
        self.timezone = timezone              # the villa's: the note's time (notice.when)
        self.state = state
        self.store_path = store_path
        self.settle_alert = settle_alert      # incident_thread.IncidentThread.close: an incident closed in the Kiosk
        self.story = story or (lambda _iid: [])   # notice.Notices.story: an incident's Telegram life, for its card
        self.restate_alert = restate_alert        # incident_thread.IncidentThread.restate: an alert taken on in the Kiosk

    def _store(self):
        from vesta_shared.store import Store
        return Store(self.store_path)

    async def create(self, title: str, entity_id: str | None = None, note: str | None = None,
                            task_id: int | None = None, document: str | None = None) -> str | None:
        """A fault in the Kiosk's Facility records. With a task_id, the task remembers its ticket. `document`: an HTML
        page to keep with it (an investigation's report, owner 2026-10-11) — a Kiosk that cannot hold it gets the fault
        all the same, its note saying so."""
        if not self.kiosk.enabled:
            self.state.log("ticket_skipped", {"reason": "no Kiosk configured", "summary": (title or "")[:80]})
            return None
        docs = None
        if document:
            why = None
            try:
                with open(document, "rb") as f:
                    kept = await self.kiosk.add_document(f.read())
                docs = [kept] if kept else None
                why = None if kept else "this VESTA Kiosk cannot hold it yet"
            except OSError:
                why = "the page was no longer kept"
            except KioskError as e:
                why = f"the Kiosk could not be reached ({e})"
            if why:
                log.warning("Fault %r: its report was not attached: %s", (title or "")[:60], why)
                note = ((note or "") + f"\n(The investigation report could not be attached: {why}.)").strip()
        # its alert's number and where it came from (Problems.card); a fault with no task is a chat's ("Create this fault")
        task = self._store().task(int(task_id)) if task_id else None
        want = Problems(self._store()).card(task) if task else {"number": None, "origin": "chat"}
        tid = await self.kiosk.add_ticket(ticket_title(title)[:200], entity_id=entity_id, note=note, document_ids=docs,
                                          **({"number": want["number"]} if want["number"] else {}),
                                          **({"origin": want["origin"]} if want["origin"] else {}))
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
        # a new fault is a fault like any other: its note says what to check (villa, 2026-10-11: the Onsen pump's new
        # fault read "Back again." where "Check: …" belongs — the reopening's note was taken for the fault's)
        return bool(await self.create(a.get("title") or task.get("summary") or "", task.get("entity_id") or None,
                                      result.fault_note(Problems(self._store()).check_of(task)), task["id"]))

    async def resolve(self, a: dict) -> bool:
        """ticket.resolve {task_id | ticket_id, note?}: the Kiosk's ticket resolved."""
        task = self._store().task(int(a.get("task_id") or 0)) if a.get("task_id") else None
        uid = (task or {}).get("todo_uid") or a.get("ticket_id")
        if uid and self.kiosk.enabled and await self.kiosk.resolve_ticket(uid, note=a.get("note"), **({"who": a["who"]} if a.get("who") else {})):
            log.info("Kiosk ticket %s resolved", uid)
            return True
        return False

    async def repair(self) -> int:
        """The open tasks and the Kiosk's faults agree (at each start and each night, owner, 2026-10-01), in three steps:
          1. what people did in the Kiosk comes in: a fault a person closed closes its task (and the incident it came
             from: the alert's messages are settled); a fault a person reopened opens its task again, theirs;
          2. a task that outlived its finding or incident closes (Problems.close_outlived);
          3. every fault is made what its task says (Problems.card): open or closed — by whom, with which note —, its
             title and its alert's number; an open task without a fault gets one.
        Returns how many faults were created.
        ⚠️ ONE COMPARISON, NOT NINE PATCHES (architecture review, 2026-10-14): each case was a pass of its own, and a
        close the Kiosk did not receive was redone as the agent's ("Closed: the problem is over.") — a Done pressed by
        Fabien lost his name and his repair. The card now comes from the task, whose close keeps who and why."""
        if not self.kiosk.enabled:
            return 0
        store = self._store()
        problems = Problems(store)
        try:
            held = await self.kiosk.held_tickets()
        except Exception as e:  # noqa: BLE001 — the next start or night tries again
            log.warning("The Kiosk's tickets could not be read (%s)", type(e).__name__)
            return 0
        if not self.kiosk.says(NOTED):
            try:
                await self.kiosk.check()          # a Kiosk updated since the agent started says so now
            except Exception as e:  # noqa: BLE001 — the card's Telegram lines wait for the next repair
                log.debug("The Kiosk's info could not be read (%s)", type(e).__name__)
        await self._take_in(problems, held)
        if cleared := problems.close_outlived():
            log.info("Tasks closed with their problem gone: %d", len(cleared))
        await self._converge(problems, held)
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
        # an open problem with no fault and no person's close is a fault the Cockpit never shows — said, not silent
        if unseen := problems.unseen():
            log.warning("%d open problem(s) have no Kiosk fault: %s", len(unseen),
                        ", ".join(f"{f['rule_id']} {f['entity_id']}" for f in unseen[:10]))
        return made

    async def _take_in(self, problems: Problems, held: dict[str, dict]) -> None:
        """Step 1: what a PERSON did to a fault in the Kiosk reaches its task. Only their gestures — every other
        difference is the agent's to put right (_converge)."""
        closed = 0
        for t in problems.open_tasks():
            uid = t.get("todo_uid")
            card = held.get(uid) if uid else None
            # ⚠️ RESOLVED BEFORE IT CAME BACK (architecture review 24): the task reopened after that resolution — it is not
            # a person closing it now (_converge reopens the fault)
            if card and card["status"] == "resolved" and not _before(card.get("resolved_at"), t.get("reopened_at")):
                iid = problems.closed_in_kiosk(t["id"], kiosk_words.closed(card.get("by") or "", card.get("resolved_at"),
                                                                           self.timezone))
                if iid:
                    # who and when, as a button's footer says it (owner, 2026-10-10): the Kiosk's own record of the close
                    await self.settle_alert(iid, kiosk_close_note(card, self.timezone))
                closed += 1
        # ⚠️ A PERSON'S REOPENING IS THEIRS (architecture review 25), WHATEVER THE FAULT'S AGE (review 29): read from the
        # Kiosk's "Reopen fault" step, never guessed from timings (review 26): its task opens again and the facility
        # manager is asked — an alert's by the desk (Problems.reopened_in_kiosk), a night check's fault here
        for t in problems.store.tasks(None):
            uid = t.get("todo_uid")
            card = held.get(uid) if uid else None
            if t["status"] == "open" or not card or card["status"] == "resolved":
                continue
            if _before(t.get("done_at"), card.get("reopened_at")):
                if not problems.reopened_in_kiosk(t["id"], card.get("reopened_by") or "",
                                                  kiosk_reopen_note(card, None, self.timezone)) and self.tell_fm:
                    await self.tell_fm(kiosk_reopen_note(card, t.get("summary") or card["title"], self.timezone))
                log.info("Kiosk ticket %s reopened by a person: its task is open again", uid)
        if closed:
            log.info("Kiosk tickets closed by a person: %d task(s) closed with them", closed)
        # ⚠️ AN ALERT TAKEN ON IN THE KIOSK IS NO LONGER CHASED (owner, 2026-10-15): "Open Ticket" on its card, and
        # Telegram kept reminding the facility manager, then escalating to the owner — of a job someone had taken
        for t in problems.open_tasks():
            card = held.get(t.get("todo_uid") or "")
            if not card or card["status"] != "in_progress" or not card.get("taken_at"):
                continue
            said = kiosk_words.taken(card.get("taken_by") or "", card.get("taken_at"), self.timezone)
            iid = problems.taken_in_kiosk(t["id"], said)
            if iid and self.restate_alert:
                await self.restate_alert(iid, said)
            if iid:
                log.info("Incident #%s taken on in the Kiosk: no longer chased", iid)

    async def _converge(self, problems: Problems, held: dict[str, dict]) -> None:
        """Step 3: each fault says what its task says (Problems.card). A close is redone for two days (a resolve that did
        not land: the Kiosk down a moment); past them, a fault a person moved since is theirs."""
        recent = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        fixed = 0
        for t in problems.store.tasks(None):
            uid = t.get("todo_uid")
            card = held.get(uid) if uid else None
            if not card:
                continue
            want = problems.card(t)
            try:
                if want["open"] and card["status"] == "resolved":
                    # its problem came back and the fault's reopening did not reach the Kiosk
                    fixed += await self.reopen({"task_id": t["id"], "title": t.get("summary") or ""})
                elif want["open"]:
                    title = ticket_title(want["title"])[:200]
                    # the title the agent last gave it, not the one it has: a title a person wrote stays (Kiosk.update_ticket)
                    if title and (card.get("agent_title") or card.get("title")) != title:
                        fixed += await self.kiosk.update_ticket(uid, title)
                    # the alert's number, as every chat writes it, and where it came from (owner, 2026-10-14)
                    if (want["number"] and card.get("alert_number") != want["number"]) \
                            or (want["origin"] and card.get("origin") != want["origin"]):
                        fixed += await self.kiosk.tag_ticket(uid, want["number"], want["origin"])
                    # what happened on Telegram — reminders, escalation, a button pressed (owner, 2026-10-14) — from this
                    # task's run on (an earlier run's lines belong to the fault as it was then)
                    if want["number"] and self.kiosk.says(NOTED):
                        since = _moment(t.get("reopened_at") or t.get("created_at"))
                        have = {at for at, _note in card.get("noted") or []}            # by its moment (Kiosk.note_ticket)
                        lines = [x for x in self.story(want["number"]) if (since is None or (_moment(x["at"]) or since) >= since)
                                 and x["at"] not in have]
                        if lines:
                            fixed += await self.kiosk.note_ticket(uid, lines)
                elif card["status"] != "resolved" and (t.get("done_at") or "") >= recent:
                    fixed += await self.kiosk.resolve_ticket(uid, note=want["note"],
                                                             **({"who": want["who"]} if want["who"] else {}))
            except Exception as e:  # noqa: BLE001 — the next start or night tries again
                log.warning("A Kiosk ticket could not be brought up to date (%s)", type(e).__name__)
                break
        if fixed:
            log.info("Kiosk tickets brought up to date: %d", fixed)


def _moment(iso: str | None) -> datetime | None:
    """A moment as the Kiosk ("…Z") or the store ("…+00:00") writes it; None when it cannot be read."""
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")) if iso else None
    except ValueError:
        return None


def _before(resolved_at: str | None, reopened_at: str | None) -> bool:
    """Is the first moment before the second? Moments as the Kiosk ("…Z") and the store ("…+00:00") write them."""
    if not (resolved_at and reopened_at):
        return False
    try:
        return datetime.fromisoformat(resolved_at.replace("Z", "+00:00")) < datetime.fromisoformat(reopened_at.replace("Z", "+00:00"))
    except ValueError:
        return False
