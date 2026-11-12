"""The VESTA Kiosk's Facility records as the agent keeps them: a fault ticket per open task, resolved with it.

Taken out of outcome.py (architecture review, 2026-10-07): the module that carries out a script's result also held
the tickets and the alert buttons, eleven dependencies for three jobs. Its callers: the AI's create_ticket tool
(create), and the reconciliation at each start, each night and after every result that moved a fault (repair) —
a script's faults_changed action (or an older ticket / ticket.resolve / ticket.reopen) only says a fault moved
(outcome.py); what the fault must say comes from its task (Problems.card).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from vesta_shared import kiosk_words, result
from vesta_shared.problems import Problems
from vesta_shared.when import Spec

from .kiosk import ASK_HELP, CLOSE, MINE, REOPEN, TAKE, KioskError, closing, confirming, noted, placed, retitled, tagged, \
    monitoring, holding, todo, unwatched
from .kiosk import fault_title_chars
from vesta_shared.messaging import headline, incident_tag
from vesta_shared.message_format import IN_COCKPIT, ON_TELEGRAM, STEPS

log = logging.getLogger("vesta.outcome")


class Tickets:
    def __init__(self, *, kiosk, state, store_path: str,
                 timezone: str = "UTC", story: Callable[[int], list[dict]] | None = None,
                 restate_alert: Callable[[int, str], Awaitable[int]] | None = None,
                 rechecked: Callable[[], set[str]] | None = None, nightly_at: Callable[[], str | None] | None = None):
        self.kiosk = kiosk
        self.rechecked = rechecked or set     # the rules the skills read again every few minutes (Skill.rechecks; "*": all)
        self.nightly_at = nightly_at or (lambda: None)   # when the night check runs ("02:00"), the skills' schedule
        self.timezone = timezone              # the villa's: the note's time (notice.when)
        self.state = state
        self.store_path = store_path
        self.story = story or (lambda _iid: [])   # notice.Notices.story: an incident's Telegram life, for its card
        self.restate_alert = restate_alert        # incident_thread.IncidentThread.restate: an alert taken on in the Kiosk
        # ⚠️ ONE REPAIR AT A TIME (owner, 2026-10-17, #48–#50: "1 individual line per update"): every result that moves a
        # fault runs a repair, and seven alerts in one second ran seven at once — each saw the same open tasks with no
        # fault yet, and each made one. Taken in turn, the second finds the first one's fault on its task.
        self._repairing = asyncio.Lock()
        # the faults taken on by Telegram's Open Ticket whose step the next repair reads (take_on): told as Telegram's
        self._taken_on_telegram: set[str] = set()

    def _store(self):
        from vesta_shared.store import Store
        return Store(self.store_path)

    async def create(self, title: str, entity_id: str | None = None, note: str | None = None,
                            task_id: int | None = None, document: str | None = None, closed: bool = False) -> str | None:
        """A fault in the Kiosk's Facility records. With a task_id, the task remembers its ticket. `document`: an HTML
        page to keep with it (an investigation's report, owner 2026-10-11) — a Kiosk that cannot hold it gets the fault
        all the same, its note saying so. `closed`: the task's fault made closed as its task says, its short story with
        it, in one write (Problems.closed_unmade)."""
        if not self.kiosk.enabled:
            self.state.log("fault_skipped", {"reason": "no Kiosk configured", "summary": (title or "")[:80]})
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
        want = self._card(Problems(self._store()), task) if task else {"number": None, "origin": "chat", "check": None}
        tid = await self.kiosk.add_ticket(headline(title)[:fault_title_chars()], entity_id=entity_id, note=note, document_ids=docs,
                                          **({"number": want["number"]} if want["number"] else {}),
                                          **({"priority": want.get("priority")} if want["number"] and want.get("priority") else {}),
                                          **({"origin": want["origin"]} if want["origin"] else {}),
                                          **({"check": want["check"]} if want["check"] else {}),
                                          **({"pattern": self._pattern(want)} if self._pattern(want) else {}),
                                          **({"opened_at": want["began"]} if want.get("began") else {}),
                                          **(self._closed_at_birth(task, want) if closed and task else {}))
        log.info("Kiosk fault %s created: %s", tid, headline(title)[:80])
        if task_id:
            self._store().set_task_uid(int(task_id), tid)
        self.state.log("executed", {"tool": "fault", "fault": tid, "entity": entity_id})
        return tid

    def _closed_at_birth(self, task: dict, want: dict) -> dict:
        """add_ticket's `amends` and `resolved` for a fault made closed: its whole short story, then its close."""
        story = self.story(want["number"]) if want["number"] else []
        # its whole story: an incident closed at its first event has one run (a reopening's own lines only)
        since = _moment(task.get("reopened_at"))
        lines = [x for x in story if since is None or (_moment(x["at"]) or since) >= since]
        return {"amends": (noted(lines),) if lines else (),
                "resolved": {"note": want["note"], "who": want["who"], "confirms_by": want["confirms_by"],
                             "lasting": want["lasting"], "not_watched": not want["confirms_by"]}}

    def _card(self, problems: Problems, task: dict) -> dict:
        """Problems.card for `task`, with the skills' reading cadences, the night check's next run (how long a fault it
        closed is watched) and the check words this Kiosk shows."""
        return problems.card(task, self.rechecked(), self._next_night)

    def _next_night(self, after: datetime) -> datetime | None:
        """The night check's first run after `after`, in the villa's time; None without a night check."""
        spec = self.nightly_at()
        if not spec:
            return None
        try:
            zone = ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            zone = ZoneInfo("UTC")
        return Spec.parse(spec).next_after(after.astimezone(zone))

    def _pattern(self, want: dict, card: dict | None = None) -> dict | None:
        """{"titlePattern", "since"} for a fault the agent titles (a Kiosk that does not read them never gets them: its
        gate, Kiosk._gated); None for a title a person wrote, or nothing to word."""
        if not want.get("pattern") or (card or {}).get("person_titled"):
            return None
        return {"titlePattern": headline(want["pattern"])[:fault_title_chars()], "since": want["since"]}

    async def reopen(self, a: dict) -> bool:
        """{task_id, title, note}: the task's fault open again in the Kiosk under its new title — or, when it
        never had one or it is gone, a new one for the task (architecture review 24: one problem, one fault)."""
        task = self._store().task(int(a["task_id"]))
        if not task or not self.kiosk.enabled:
            return False
        uid = task.get("todo_uid")
        if uid and await self.kiosk.reopen_ticket(uid, headline(a.get("title") or task.get("summary") or ""), a.get("note")):
            log.info("Kiosk fault %s open again: %s", uid, (a.get("title") or "")[:80])
            return True
        # a new fault is a fault like any other: its note says what to check (villa, 2026-10-11: the Onsen pump's new
        # fault read "Back again." where "Check: …" belongs — the reopening's note was taken for the fault's)
        return bool(await self.create(a.get("title") or task.get("summary") or "", task.get("entity_id") or None,
                                      result.fault_note(Problems(self._store()).check_of(task)), task["id"]))

    async def take_on(self, iid: int, by: str) -> bool:
        """Alert `iid` taken on as ONE ticket by the person `by` (result.take_on: Open Ticket on Telegram), as the Kiosk's
        own Open Ticket on its card: the take-on step on the fault of its open task (Kiosk.take_ticket), then read back as
        the Kiosk's (repair: _take_in, its press TAKE) — its chase stops, every chat says "Ticket opened by …", the
        buttons that still apply kept. ⚠️ ONE MECHANISM: the press only writes what the Kiosk's button writes. False:
        the Kiosk is not configured or cannot be reached, or the alert has no open fault there yet."""
        if not self.kiosk.enabled:
            return False
        task = self._store().last_task(f"incident:{int(iid)}")
        uid = task.get("todo_uid") if task and task.get("status") == "open" else None
        if not uid:
            return False
        # ⚠️ TOLD WHERE IT WAS PRESSED (architecture review 28): read back as the Kiosk's own take-on, it was told "Ticket
        # opened in the Cockpit". Marked before the step is written: a repair already running may read it first
        self._taken_on_telegram.add(uid)
        try:
            try:
                if not await self.kiosk.take_ticket(uid, by):
                    return False
            except Exception as e:  # noqa: BLE001 — answered plainly, nothing half done
                log.warning("Incident #%s could not be taken on in the Kiosk (%s)", iid, type(e).__name__)
                return False
            await self.repair()
        finally:
            self._taken_on_telegram.discard(uid)
        return True

    async def repair(self) -> dict[str, int]:
        """The open tasks and the Kiosk's faults agree (at each start and each night, owner, 2026-10-01), in three steps:
          1. what people did in the Kiosk comes in: a fault a person closed closes its task (and the incident it came
             from: the alert's messages are settled); a fault a person reopened opens its task again, theirs;
          2. every task is made what its problem's facts say (Problems.settle_all): over — closed, still there — open;
          3. every fault is made what its task says (Problems.card): open or closed — by whom, with which note —, its
             title and its alert's number; an open task without a fault gets one.
        Returns how many faults it created, reopened and resolved, and how many presses in the Kiosk it handed to the
        alert desk (a Need help, a close it tells): {created, reopened, resolved, handed}.
        ⚠️ ONE COMPARISON, NOT NINE PATCHES (architecture review, 2026-10-14): each case was a pass of its own, and a
        close the Kiosk did not receive was redone as the agent's ("Closed: the problem is over.") — a Done pressed by
        Fabien lost his name and his repair. The card now comes from the task, whose close keeps who and why."""
        async with self._repairing:
            return await self._repair()

    async def _repair(self) -> dict[str, int]:
        nothing = {"created": 0, "reopened": 0, "resolved": 0, "handed": 0}
        if not self.kiosk.enabled:
            return nothing
        store = self._store()
        problems = Problems(store)
        try:
            held = await self.kiosk.held_tickets()
        except Exception as e:  # noqa: BLE001 — the next start or night tries again
            log.warning("The Kiosk's faults could not be read (%s)", type(e).__name__)
            return nothing
        await self.kiosk.refresh()                # a Kiosk updated since the agent started says what it shows now
        handed = await self._take_in(problems, held)
        # every problem's task as its facts say (Problems.settle_all): over — closed; still there — open (again)
        if moved := problems.settle_all(set(held)):
            now_open = sum(1 for tid in moved if (store.task(tid) or {}).get("status") == "open")
            log.info("Tasks brought in line with their problems: %s", ", ".join(
                f"{n} {w}" for n, w in ((len(moved) - now_open, "closed"), (now_open, "opened")) if n))
        moved_cards = await self._converge(problems, held)
        made = 0
        for t in problems.open_tasks():
            # ⚠️ AN ID IS NOT A FAULT (villa, 2026-10-29): the agent was moved to another VESTA Kiosk, whose store held
            # none of its faults; the open tasks kept the first Kiosk's ids, were skipped here as "has a fault", and the
            # Cockpit showed "Unavailable" with no button while the digest said "still open". A fault this Kiosk does not
            # hold (a closed one it does) is made again; the old id is kept until the new one is written (create), so a
            # store the Kiosk could not read — its read answers empty on purpose, its writes are refused — loses nothing.
            if t.get("todo_uid") and t["todo_uid"] in held:
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
                log.warning("A missing Kiosk fault could not be created: %s", e)
                if not e.refused:
                    break
            except Exception as e:  # noqa: BLE001 — the next start or night tries again
                log.warning("A missing Kiosk fault could not be created (%s)", type(e).__name__)
                break
        for t in problems.closed_unmade():
            # ⚠️ NEVER SHOWN OPEN (owner's drills, 2026-11-07, #141, #143): a visit the villa had closed while VESTA was
            # away made an open fault at its first replayed event, closed ~19s later; made closed, in one write
            try:
                if await self.create(problems.current_title(t), t.get("entity_id") or None,
                                     result.fault_note(problems.check_of(t)), t["id"], closed=True):
                    made += 1
            except Exception as e:  # noqa: BLE001 — the next repair tries again
                log.warning("A closed Kiosk fault could not be created (%s)", type(e).__name__)
                break
        if made:
            log.info("Kiosk faults created for %d task(s) that had none", made)
            # ⚠️ A NEW FAULT TELLS ITS STORY AT ONCE (owner's end-to-end test, 2026-10-30: alert #95's card on the tablet
            # had no step, and its row no time, until the next repair 4 minutes later): step 3 ran before it existed,
            # so it is brought up to date now, as every fault is (_converge: its number, its check, its short story)
            try:
                held = await self.kiosk.held_tickets()
                for k, v in (await self._converge(problems, held)).items():
                    moved_cards[k] = moved_cards.get(k, 0) + v
            except Exception as e:  # noqa: BLE001 — the next repair (5 minutes) does it
                log.warning("The new Kiosk faults could not be brought up to date (%s)", type(e).__name__)
        moved_cards["resolved"] = moved_cards.get("resolved", 0) + await self._close_doubles(problems, held)
        # an open problem with no fault and no person's close is a fault the Cockpit never shows — said, not silent
        if unseen := problems.unseen():
            log.warning("%d open problem(s) have no Kiosk fault: %s", len(unseen),
                        ", ".join(f"{f['rule_id']} {f['entity_id']}" for f in unseen[:10]))
        return {"created": made, **moved_cards, "handed": handed}

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
                if await self.kiosk.resolve_ticket(uid, note=f"A second copy of {incident_tag(n, card.get('alert_priority'))}'s fault: closed, the other one says it."):
                    closed += 1
        if closed:
            log.info("Closed %d double Kiosk fault(s) of an alert that already had one", closed)
        return closed

    async def _take_in(self, problems: Problems, held: dict[str, dict]) -> int:
        """Step 1: what a PERSON did to a fault in the Kiosk reaches its task — each press once, in the order it was made
        (kiosk.gestures). Only their presses: every other difference is the agent's to put right (_converge). How many
        presses it handed to the desk (a Need help, a close it tells).

        ⚠️ READ AS PRESSES, NEVER GUESSED FROM A SNAPSHOT (architecture review round 14, card 3): the card was reduced to
        its latest close, take-on, reopening and help, and what was new worked out by comparing their times with the
        task's — a close and a reopening between two reads were neither, and a Done on a person's ticket was handed to
        its standing alert at every read. A fault's presses are taken in after the last one read (PRESSES, kept with the
        tasks, one line per fault the Kiosk still holds); on a fault never read here (read before this) after its task
        last moved, so nothing is taken in twice."""
        read = {uid: at for uid, at in (problems.store.cache_get(PRESSES) or {}).items() if uid in held}
        tasks: dict[str, dict] = {}
        for t in problems.store.tasks(None):                # oldest first: the latest task of a fault wins
            if t.get("todo_uid"):
                tasks[t["todo_uid"]] = t
        handed = 0
        for uid, card in held.items():
            task = tasks.get(uid)
            # the last press read: its moment, and how many presses of that very moment were read (two can share one)
            mark = read.get(uid) if isinstance(read.get(uid), list) and len(read[uid]) == 2 else None
            after, seen = (_moment(mark[0]), int(mark[1])) if mark else (_last_moved(task), 0)
            same = 0
            for g in card.get("gestures") or ():
                at = _moment(g["at"])
                if after is not None and at is not None and at == after:
                    same += 1
                    if same <= seen:
                        continue
                elif after is not None and (at is None or at < after):
                    continue
                task = problems.store.task(task["id"]) if task else None   # as the press before left it
                handed += await self._press(problems, uid, card, task, g)
                if at != after:
                    after, same = at, 1
                read[uid] = [g["at"], same]
                problems.store.cache_put(PRESSES, read)
        # a person's ticket whose standing alert closed (a Done on Telegram) is resolved here
        link = problems.help
        for uid, r in link.resolves().items():
            if (held.get(uid) or {}).get("status") not in (None, "resolved"):
                await self.kiosk.resolve_ticket(uid, note=r.get("note") or None, who=r.get("who") or None)
        return handed

    async def _press(self, problems: Problems, uid: str, card: dict, task: dict | None, g: dict) -> int:
        """One press `g` of a person on Kiosk fault `uid` (kiosk.gestures), carried out on its task (`task`, as it stands
        now; None: a person's ticket, or a fault no task holds). How many presses it handed to the desk (0 or 1): a Need
        help it escalates, a close it tells."""
        kind, at, by = g["kind"], g["at"], g["by"]
        link = problems.help
        if kind == CLOSE:
            # ⚠️ A CLOSE BEFORE ITS PROBLEM CAME BACK IS NOT THIS RUN'S (architecture review 24): the task reopened after it
            # who and when, as a button's footer says it (owner, 2026-10-10): the Kiosk's own record of the close, told
            # by the alert desk in each chat's language with the watch it wrote (Notes.KIOSK_CLOSED; architecture review
            # 23, card 1: told here, it said no watch and read "(closed)")
            said = kiosk_words.closed(by, at, self.timezone, lasting=g["lasting"], nothing=bool(g.get("nothing")))
            if task and task["status"] == "open" and not _before(at, task.get("reopened_at")):
                iid = problems.closed_in_kiosk(task["id"], said, at=at, who=by or None, lasting=g["lasting"])
                log.info("Kiosk fault %s closed by a person: its task closed with it", uid)
                return int(bool(iid))
            if not uid.startswith(MINE) and (iid := link.standing(link.of_ticket(uid))):
                # a person closed their own ticket in the Kiosk: the alert standing for its Need help closes, as their
                # Done in the Cockpit — or their "Not a problem" (architecture review 23, card 2: said "Done" and read
                # again)
                problems.person_done(iid, IN_COCKPIT, who=by or None, at=at, said=said, read_again=not g["lasting"])
                return 1
        elif kind == REOPEN:
            # ⚠️ A PERSON'S REOPENING IS THEIRS (architecture review 25), WHATEVER THE FAULT'S AGE (review 29): its task
            # opens again and someone is told — an alert's by the desk (Problems.reopened_in_kiosk), a night check's by
            # its skill's recheck, from the task's untold mark (round 2, 2026-10-19)
            if task and task["status"] != "open" and _before(task.get("done_at"), at):
                problems.reopened_in_kiosk(task["id"], by, kiosk_words.reopened(by, at, self.timezone), at=at)
                log.info("Kiosk fault %s reopened by a person: its task is open again", uid)
        elif kind == TAKE:
            # ⚠️ AN ALERT TAKEN ON IN THE KIOSK IS NO LONGER CHASED (owner, 2026-10-15): "Open Ticket" on its card
            if task and task["status"] == "open":
                said = kiosk_words.taken(by, at, self.timezone,
                                         ON_TELEGRAM if uid in self._taken_on_telegram else IN_COCKPIT)
                iid = problems.taken_in_kiosk(task["id"], str(said))
                if iid and self.restate_alert:
                    await self.restate_alert(iid, said)
                if iid:
                    log.info("Incident #%s taken on in the Kiosk: no longer chased", iid)
        elif kind == ASK_HELP:
            # a person's Need help on a card in the Kiosk (owner, 2026-10-30: every card offers Done · Need help · Open
            # Ticket) reaches the owner: an alert's through its desk, any other fault's through an alert the desk opens
            # already escalated (vesta_shared.help_link)
            live = task if task and task["status"] == "open" else None
            if live is None and uid.startswith(MINE):
                return 0                                 # the agent's fault of no open task: nothing stands for it
            said = kiosk_words.helped(by, at, self.timezone)
            subject = link.of_task(live["id"]) if live else link.of_ticket(uid)
            handed = int(link.new(subject, at))
            iid = link.asked(subject, said, at, task=live, title=card.get("title") or "",
                             entity_id=card.get("entity_id") or "")
            log.info("Need help pressed in the Kiosk on %s: %s", uid,
                     f"incident #{iid} escalated" if iid else "the owner is asked by the alert desk")
            return handed
        return 0

    async def follow(self, incidents) -> None:
        """The open faults of `incidents` made what their tasks say NOW (_converge, step 3 of the repair, for them
        alone): what a result changed of an alert — the device a visit's strongest step names, its title, its
        "monitoring until" — reaches its fault in the tablet's push of each of its records (kiosk_messages: just before
        it), not after every copy.

        ⚠️ THE NAME FOLLOWS AT ITS STEP (owner's drill #135, 2026-11-07): the tablet's card read "Test lock opened…" while
        its name stayed "Test door": its words were told at once, its fault only by the repair after every Telegram copy
        and the villa's tell, which reads every task first (10 s on the villa), then by the tablet's next read."""
        wanted = {int(i) for i in incidents if str(i).isdigit()}
        if not wanted or not self.kiosk.enabled:
            return
        async with self._repairing:
            problems = Problems(self._store())
            try:
                held = await self.kiosk.held_tickets()
            except Exception as e:  # noqa: BLE001 — the repair after the result does it
                log.warning("The Kiosk's faults could not be read (%s)", type(e).__name__)
                return
            await self._converge(problems, held, only=wanted)

    async def _converge(self, problems: Problems, held: dict[str, dict], only: set[int] | None = None) -> dict[str, int]:
        """Step 3: each fault says what its task says (Problems.card). A close is redone for two days (a resolve that did
        not land: the Kiosk down a moment); past them, a fault a person moved since is theirs. `only`: the faults of
        these incidents alone (`follow`)."""
        recent = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        fixed, reopened, resolved = 0, 0, 0
        for t in problems.store.tasks(None):
            if only is not None and problems._source(t) not in {("incident", i) for i in only}:
                continue
            uid = t.get("todo_uid")
            card = held.get(uid) if uid else None
            if not card:
                continue
            want = self._card(problems, t)
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
                    title = headline(want["title"])[:fault_title_chars()]
                    # the title the agent last gave it, not the one it has: a title a person wrote stays (kiosk.retitled)
                    if title and (card.get("agent_title") or card.get("title")) != title:
                        amends.append(retitled(title))
                    # the device it is about now: its card's name (a visit's strongest step)
                    if want.get("entity_id") and card.get("entity_id") != want["entity_id"]:
                        amends.append(placed(want["entity_id"]))
                    # the alert's number, as every chat writes it, and where it came from (owner, 2026-10-14)
                    # its duration worded when shown — never on a title a person wrote: theirs, as it is
                    pattern = self._pattern(want, card) or (
                        {"titlePattern": None, "since": None} if card.get("title_pattern") else None)
                    if (want["number"] and card.get("alert_number") != want["number"]) \
                            or (want["number"] and want.get("priority") and card.get("alert_priority") != want["priority"]) \
                            or (want["origin"] and card.get("origin") != want["origin"]) \
                            or (want["check"] and card.get("check") != want["check"]) \
                            or (pattern and (card.get("title_pattern"), card.get("since")) != (pattern["titlePattern"], pattern["since"])):
                        amends.append(tagged(want["number"], want["origin"], want["check"], pattern, want.get("priority")))
                    # when the agent closes it if it stays over (owner, 2026-10-21), or that line gone when it holds again
                    if card.get("closes_at") != want["closes_at"]:
                        amends.append(closing(want["closes_at"]))
                    # an open visit: until when it is monitored, moved later at each step (owner, 2026-11-07)
                    if card.get("monitored_until") != want["monitored_until"]:
                        amends.append(monitoring(want["monitored_until"]))
                    # a held alert: why it is expected, on the tablet's Watch until it is no longer (owner, 2026-11-12)
                    if card.get("expected") != want.get("expected"):
                        amends.append(holding(want.get("expected")))
                    # an open fault is never being confirmed (a field left by a reopening that did not take it away)
                    if card.get("confirms_by"):
                        amends.append(confirming(None))
                    # what to do on site, as its problem says it NOW (Problems.card todo): the route's check edited, a
                    # finding's check rewritten by the night — written at the fault's making only until 0.12.263
                    said = result.fault_note(want["todo"])
                    if said and card.get("note") != said:
                        amends.append(todo(said))
                    # what happened on Telegram, its whole short story (owner, 2026-10-14; ticket 19 of "One inbox",
                    # 2026-10-28) — from this task's run on (an earlier run's lines belong to the fault as it was
                    # then); a Kiosk that shows no such line gets none (its gate, Kiosk._gated)
                    if want["number"]:
                        story = self.story(want["number"])
                        since = _run_start(story, t)
                        # every line of this run: the fault keeps each by its id, writing only what changed
                        # (kiosk.noted)
                        lines = [x for x in story if since is None or (_moment(x["at"]) or since) >= since]
                        if lines:
                            amends.append(noted(lines))
                    fixed += await self.kiosk.amend(uid, *amends)
                elif card["status"] != "resolved" and (t.get("done_at") or "") >= recent:
                    # nothing watched after it (no watch, no read-again): Closed at once on the tablet
                    n = await self.kiosk.resolve_ticket(uid, note=want["note"], **({"who": want["who"]} if want["who"] else {}),
                                                        confirms_by=want["confirms_by"], lasting=want["lasting"],
                                                        not_watched=not want["confirms_by"])
                    fixed += n; resolved += n
                elif card["status"] == "resolved" and (card.get("confirms_by") != want["confirms_by"]
                                                       or (want["not_watched"] and not card.get("not_watched")
                                                           and (t.get("done_at") or "") >= recent)):
                    # a person's close being confirmed (owner, 2026-10-23): "VESTA confirms by …" while the alert desk
                    # watches it, taken away once it has read it again (Problems.card confirms_by); one nothing watches
                    # says so (a visit closed in the Cockpit, drill #136-P1: on the tablet's Watch list with no state)
                    fixed += await self.kiosk.amend(uid, confirming(want["confirms_by"]),
                                                    *((unwatched(),) if want["not_watched"] else ()))
            except KioskError as e:
                # a refusal of this fault is this fault's: the next one is tried (see the repair's own loop above)
                log.warning("Kiosk fault %s could not be brought up to date: %s", uid, e)
                if not e.refused:
                    break
            except Exception as e:  # noqa: BLE001 — the next start or night tries again
                log.warning("A Kiosk fault could not be brought up to date (%s)", type(e).__name__)
                break
        if fixed:
            log.info("Kiosk faults brought up to date: %d", fixed)
        return {"reopened": reopened, "resolved": resolved}


def _run_start(story: list[dict], task: dict) -> datetime | None:
    """Where a fault's story starts: its reopening — its new run's lines only; else the start of the run it was made
    in, so the alert sent just before the fault was made is told too (ticket 19 of "One inbox": the card read from
    the first reminder on)."""
    if task.get("reopened_at"):
        return _moment(task["reopened_at"])
    made = _moment(task.get("created_at"))
    starts = [m for x in story if (s := STEPS.get(x.get("stage") or "")) and s.starts_run
              and (m := _moment(x["at"])) and (made is None or m <= made)]
    return max(starts) if starts else made


def _moment(iso: str | None) -> datetime | None:
    """A moment as the Kiosk ("…Z") or the store ("…+00:00") writes it; None when it cannot be read."""
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")) if iso else None
    except ValueError:
        return None


#: The skills' store's line of the last press taken in on each Kiosk fault ({fault id: [its `at`, how many presses of
#: that moment were taken in]}): Tickets._take_in.
PRESSES = "cockpit:presses"


def _last_moved(task: dict | None) -> datetime | None:
    """When a task was last closed or reopened: a press before it is already in it (its making is not: a fault's
    presses all come after it). None without a task, or one never moved since it was made."""
    moments = [m for m in (_moment((task or {}).get(k)) for k in ("done_at", "reopened_at")) if m]
    return max(moments) if moments else None


def _before(resolved_at: str | None, reopened_at: str | None) -> bool:
    """Is the first moment before the second? Moments as the Kiosk ("…Z") and the store ("…+00:00") write them."""
    if not (resolved_at and reopened_at):
        return False
    try:
        return datetime.fromisoformat(resolved_at.replace("Z", "+00:00")) < datetime.fromisoformat(reopened_at.replace("Z", "+00:00"))
    except ValueError:
        return False
