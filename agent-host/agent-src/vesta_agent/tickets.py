"""The VESTA Kiosk's Facility records as the agent keeps them: a fault ticket per open task, resolved with it.

Taken out of outcome.py (architecture review, 2026-10-07): the module that carries out a script's result also held
the tickets and the alert buttons, eleven dependencies for three jobs. Its callers: the AI's create_ticket tool
(create), and the reconciliation at each start, each night and after every result that moved a fault (repair) —
a script's ticket / ticket.resolve / ticket.reopen action only says a fault moved (outcome.py); what the fault must say
comes from its task (Problems.card).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

from vesta_shared import kiosk_words, result
from vesta_shared.problems import Problems

from .kiosk import MINE, NOTED, KioskError, noted, retitled, tagged, todo
from .outcome_words import ticket_title

log = logging.getLogger("vesta.outcome")


def kiosk_close_note(ticket: dict, zone: str) -> str:
    """The note a fault closed in the VESTA Kiosk leaves on its alert's messages: "Closed in the Cockpit on
    10/10/2026 17:13 (Wayan)." — who (the name typed, else the profile) and when the Kiosk recorded
    (vesta_shared.kiosk_words, plus the full stop a settle note ends with)."""
    return kiosk_words.closed(ticket.get("by") or "", ticket.get("resolved_at"), zone) + "."


class Tickets:
    def __init__(self, *, kiosk, state, store_path: str, settle_alert: Callable[[int, str], Awaitable[int]],
                 timezone: str = "UTC", story: Callable[[int], list[dict]] | None = None,
                 restate_alert: Callable[[int, str], Awaitable[int]] | None = None,
                 rechecked: Callable[[], set[str]] | None = None):
        self.kiosk = kiosk
        self.rechecked = rechecked or set     # the rules the skills read again every few minutes (Skill.rechecks)
        self.timezone = timezone              # the villa's: the note's time (notice.when)
        self.state = state
        self.store_path = store_path
        self.settle_alert = settle_alert      # incident_thread.IncidentThread.close: an incident closed in the Kiosk
        self.story = story or (lambda _iid: [])   # notice.Notices.story: an incident's Telegram life, for its card
        self.restate_alert = restate_alert        # incident_thread.IncidentThread.restate: an alert taken on in the Kiosk
        # ⚠️ ONE REPAIR AT A TIME (owner, 2026-10-17, #48–#50: "1 individual line per update"): every result that moves a
        # fault runs a repair, and seven alerts in one second ran seven at once — each saw the same open tasks with no
        # fault yet, and each made one. Taken in turn, the second finds the first one's fault on its task.
        self._repairing = asyncio.Lock()

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
        want = Problems(self._store()).card(task, self.rechecked()) if task else {"number": None, "origin": "chat", "check": None}
        tid = await self.kiosk.add_ticket(ticket_title(title)[:200], entity_id=entity_id, note=note, document_ids=docs,
                                          **({"number": want["number"]} if want["number"] else {}),
                                          **({"origin": want["origin"]} if want["origin"] else {}),
                                          **({"check": want["check"]} if want["check"] else {}),
                                          **({"pattern": self._pattern(want)} if self._pattern(want) else {}))
        log.info("Kiosk ticket %s created: %s", tid, ticket_title(title)[:80])
        if task_id:
            self._store().set_task_uid(int(task_id), tid)
        self.state.log("executed", {"tool": "ticket", "ticket": tid, "entity": entity_id})
        return tid

    def _pattern(self, want: dict, card: dict | None = None) -> dict | None:
        """{"titlePattern", "since"} for a fault the agent titles, to a Kiosk that reads them (Kiosk.takes); None for a
        title a person wrote, or nothing to word."""
        if not want.get("pattern") or not self.kiosk.takes("titlePattern") or (card or {}).get("person_titled"):
            return None
        return {"titlePattern": ticket_title(want["pattern"])[:200], "since": want["since"]}

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

    async def repair(self) -> dict[str, int]:
        """The open tasks and the Kiosk's faults agree (at each start and each night, owner, 2026-10-01), in three steps:
          1. what people did in the Kiosk comes in: a fault a person closed closes its task (and the incident it came
             from: the alert's messages are settled); a fault a person reopened opens its task again, theirs;
          2. every task is made what its problem's facts say (Problems.settle_all): over — closed, still there — open;
          3. every fault is made what its task says (Problems.card): open or closed — by whom, with which note —, its
             title and its alert's number; an open task without a fault gets one.
        Returns how many faults it created, reopened and resolved: {created, reopened, resolved}.
        ⚠️ ONE COMPARISON, NOT NINE PATCHES (architecture review, 2026-10-14): each case was a pass of its own, and a
        close the Kiosk did not receive was redone as the agent's ("Closed: the problem is over.") — a Done pressed by
        Fabien lost his name and his repair. The card now comes from the task, whose close keeps who and why."""
        async with self._repairing:
            return await self._repair()

    async def _repair(self) -> dict[str, int]:
        nothing = {"created": 0, "reopened": 0, "resolved": 0}
        if not self.kiosk.enabled:
            return nothing
        store = self._store()
        problems = Problems(store)
        try:
            held = await self.kiosk.held_tickets()
        except Exception as e:  # noqa: BLE001 — the next start or night tries again
            log.warning("The Kiosk's tickets could not be read (%s)", type(e).__name__)
            return nothing
        if not self.kiosk.says(NOTED):
            try:
                await self.kiosk.check()          # a Kiosk updated since the agent started says so now
            except Exception as e:  # noqa: BLE001 — the card's Telegram lines wait for the next repair
                log.debug("The Kiosk's info could not be read (%s)", type(e).__name__)
        await self._take_in(problems, held)
        # every problem's task as its facts say (Problems.settle_all): over — closed; still there — open (again)
        if moved := problems.settle_all(set(held)):
            log.info("Tasks brought in line with their problems: %s", ", ".join(
                f"{sum(1 for a in moved if a['action'] == k)} {w}" for k, w in
                (("ticket.resolve", "closed"), ("ticket.reopen", "reopened"), ("ticket", "new")) if any(a["action"] == k for a in moved)))
        moved_cards = await self._converge(problems, held)
        made = 0
        for t in problems.open_tasks():
            if t.get("todo_uid"):
                continue
            try:
                check = problems.check_of(t)
                # what is wrong NOW, as every card says it (Problems.card): a task restored days later kept its first words
                if await self.create(problems.current_title(t), t.get("entity_id") or None,
                                            result.fault_note(check), t["id"]):
                    made += 1
            except KioskError as e:
                # ⚠️ A REFUSED FAULT STOPS NO OTHER (architecture review round 2, 2026-10-19): one fault the proxy refused
                # ended the repair for every fault after it, every 5 minutes, and the log said "KioskError". The Kiosk's
                # own sentence is logged; only a Kiosk that cannot be reached at all ends the round (the rest would fail
                # the same way; the next repair tries again)
                log.warning("A missing Kiosk ticket could not be created: %s", e)
                if not e.refused:
                    break
            except Exception as e:  # noqa: BLE001 — the next start or night tries again
                log.warning("A missing Kiosk ticket could not be created (%s)", type(e).__name__)
                break
        if made:
            log.info("Kiosk tickets created for %d open task(s) that had none", made)
        moved_cards["resolved"] = moved_cards.get("resolved", 0) + await self._close_doubles(problems, held)
        # an open problem with no fault and no person's close is a fault the Cockpit never shows — said, not silent
        if unseen := problems.unseen():
            log.warning("%d open problem(s) have no Kiosk fault: %s", len(unseen),
                        ", ".join(f"{f['rule_id']} {f['entity_id']}" for f in unseen[:10]))
        return {"created": made, **moved_cards}

    async def _close_doubles(self, problems: Problems, held: dict[str, dict]) -> int:
        """An open fault of the agent's that no task holds, for an alert whose task holds another fault, is a double of
        that one: closed as the agent's own clearing, never deleted (owner, 2026-10-17: six "#49 · One mains phase lost"
        lines, made by repairs that ran at once before 0.12.237). Returns how many it closed."""
        mine = {t.get("todo_uid") for t in problems.store.tasks(None) if t.get("todo_uid")}
        by_number = {}
        for t in problems.store.tasks(None):
            n = problems.card(t).get("number") if t.get("todo_uid") else None
            if n is not None:
                by_number[str(n)] = t["todo_uid"]
        closed = 0
        for uid, card in held.items():
            n = card.get("alert_number")
            if uid in mine or card.get("status") == "resolved" or n is None or not uid.startswith(MINE):
                continue
            if by_number.get(str(n)) and by_number[str(n)] != uid:
                if await self.kiosk.resolve_ticket(uid, note=f"A second copy of #{n}'s fault: closed, the other one says it."):
                    closed += 1
        if closed:
            log.info("Closed %d double Kiosk fault(s) of an alert that already had one", closed)
        return closed

    async def _take_in(self, problems: Problems, held: dict[str, dict]) -> None:
        """Step 1: what a PERSON did to a fault in the Kiosk reaches its task. Only their gestures — every other
        difference is the agent's to put right (_converge)."""
        closed = 0
        for t in problems.open_tasks():
            uid = t.get("todo_uid")
            card = held.get(uid) if uid else None
            # ⚠️ RESOLVED BEFORE IT CAME BACK (architecture review 24): the task reopened after that resolution — it is not
            # a person closing it now (_converge reopens the fault)
            # ⚠️ AND NEVER THE AGENT'S OWN CLEARING (architecture review, 2026-10-18): an alert flapping within seconds had
            # its close's clearing land just after its return reopened the task, and the times said "a person closed it" —
            # "Closed in the Cockpit by VESTA Agent", the alert no longer chased. The Kiosk's step says who; times are
            # only the fallback for a record without one.
            if card and card["status"] == "resolved" and not card.get("cleared") \
                    and not _before(card.get("resolved_at"), t.get("reopened_at")):
                iid = problems.closed_in_kiosk(t["id"], kiosk_words.closed(card.get("by") or "", card.get("resolved_at"),
                                                                           self.timezone))
                if iid:
                    # who and when, as a button's footer says it (owner, 2026-10-10): the Kiosk's own record of the close
                    await self.settle_alert(iid, kiosk_close_note(card, self.timezone))
                closed += 1
        # ⚠️ A PERSON'S REOPENING IS THEIRS (architecture review 25), WHATEVER THE FAULT'S AGE (review 29): read from the
        # Kiosk's "Reopen fault" step, never guessed from timings (review 26): its task opens again and someone is told
        # — an alert's by the desk (Problems.reopened_in_kiosk), a night check's by its skill's recheck, from the task's
        # untold mark (round 2, 2026-10-19: this engine sent it itself, to a role and under a title of its own)
        for t in problems.store.tasks(None):
            uid = t.get("todo_uid")
            card = held.get(uid) if uid else None
            if t["status"] == "open" or not card or card["status"] == "resolved":
                continue
            if _before(t.get("done_at"), card.get("reopened_at")):
                by, at = card.get("reopened_by") or "", card.get("reopened_at")
                problems.reopened_in_kiosk(t["id"], by, kiosk_words.reopened(by, at, self.timezone), at=at)
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

    async def _converge(self, problems: Problems, held: dict[str, dict]) -> dict[str, int]:
        """Step 3: each fault says what its task says (Problems.card). A close is redone for two days (a resolve that did
        not land: the Kiosk down a moment); past them, a fault a person moved since is theirs."""
        recent = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        fixed, reopened, resolved = 0, 0, 0
        for t in problems.store.tasks(None):
            uid = t.get("todo_uid")
            card = held.get(uid) if uid else None
            if not card:
                continue
            want = problems.card(t, self.rechecked())
            try:
                if want["open"] and card["status"] == "resolved":
                    # its problem came back and the fault's reopening did not reach the Kiosk
                    # its own words ("Still there after the close." is not "Back again."): the task keeps them (Problems.card)
                    n = await self.reopen({"task_id": t["id"], "title": want["title"] or t.get("summary") or "",
                                           "note": want["reopen_note"]})
                    fixed += n; reopened += n
                elif want["open"]:
                    # what the fault must say now, put right in ONE write (Kiosk.amend: retitled, tagged, noted)
                    amends = []
                    title = ticket_title(want["title"])[:200]
                    # the title the agent last gave it, not the one it has: a title a person wrote stays (kiosk.retitled)
                    if title and (card.get("agent_title") or card.get("title")) != title:
                        amends.append(retitled(title))
                    # the alert's number, as every chat writes it, and where it came from (owner, 2026-10-14)
                    # its duration worded when shown — never on a title a person wrote: theirs, as it is
                    pattern = self._pattern(want, card) or (
                        {"titlePattern": None, "since": None} if card.get("title_pattern") else None)
                    if (want["number"] and card.get("alert_number") != want["number"]) \
                            or (want["origin"] and card.get("origin") != want["origin"]) \
                            or (want["check"] and card.get("check") != want["check"]) \
                            or (pattern and (card.get("title_pattern"), card.get("since")) != (pattern["titlePattern"], pattern["since"])):
                        amends.append(tagged(want["number"], want["origin"], want["check"], pattern))
                    # what to do on site, as its problem says it NOW (Problems.card todo): the route's check edited, a
                    # finding's check rewritten by the night — written at the fault's making only until 0.12.263
                    said = result.fault_note(want["todo"])
                    if said and card.get("note") != said:
                        amends.append(todo(said))
                    # what happened on Telegram — reminders, escalation, a button pressed (owner, 2026-10-14) — from this
                    # task's run on (an earlier run's lines belong to the fault as it was then)
                    if want["number"] and self.kiosk.says(NOTED):
                        since = _moment(t.get("reopened_at") or t.get("created_at"))
                        have = {at for at, _note in card.get("noted") or []}            # by its moment (kiosk.noted)
                        lines = [x for x in self.story(want["number"]) if (since is None or (_moment(x["at"]) or since) >= since)
                                 and x["at"] not in have]
                        if lines:
                            amends.append(noted(lines))
                    fixed += await self.kiosk.amend(uid, *amends)
                elif card["status"] != "resolved" and (t.get("done_at") or "") >= recent:
                    n = await self.kiosk.resolve_ticket(uid, note=want["note"], **({"who": want["who"]} if want["who"] else {}))
                    fixed += n; resolved += n
            except KioskError as e:
                # a refusal of this fault is this fault's: the next one is tried (see the repair's own loop above)
                log.warning("Kiosk ticket %s could not be brought up to date: %s", uid, e)
                if not e.refused:
                    break
            except Exception as e:  # noqa: BLE001 — the next start or night tries again
                log.warning("A Kiosk ticket could not be brought up to date (%s)", type(e).__name__)
                break
        if fixed:
            log.info("Kiosk tickets brought up to date: %d", fixed)
        return {"reopened": reopened, "resolved": resolved}


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
