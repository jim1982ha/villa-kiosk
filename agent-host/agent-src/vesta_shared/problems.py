"""Whether a problem is still open: one owner for the whole lifecycle.

A problem in the villa lives as up to three records of the store and one outside it:
  a FINDING     (preventive-maintenance: the night check saw it)        findings table
  an INCIDENT   (alert-desk: a VESTA rule alerted)                      incidents table
  a TASK        (the facility manager's job about it)                   tasks table
  a TICKET      (that task, as a fault in the VESTA Kiosk)              the task's todo_uid

⚠️ ONE MODULE OPENS AND CLOSES THEM (architecture review, 2026-10-01). Each used to be opened
and closed by whoever touched it: three words for "closed" ("done", "cleared",
"done_in_kiosk"), the weekly page reading findings and incidents while the daily digest and
the concierge counted tasks, and a fault closed in the Kiosk closed its task but left its
incident open — the alert desk went on chasing the facility manager and escalated to the
owner. The skills (alert-desk, preventive-maintenance, reports, villa-concierge) and the
engine's reconcile all go through here; the engine itself only moves tickets to and from
the Kiosk (vesta_agent/outcome.py).

A task knows its SOURCE ("finding:12" / "incident:5") and its CHECK (what to check on site)
as fields. (Tasks written before 0.6.16 had neither: the store rewrites them once, when it opens.)
"""
from __future__ import annotations

import json

from . import result
from .messaging import no_code as _no_code
from .store import Store, Incident

DONE = "done"                          # a person answered Done (a button, or "#N done")
CLEARED = "cleared"                    # its source is gone: the night check no longer sees it, HA cleared it
CLOSED_IN_KIOSK = "closed_in_kiosk"    # a person closed the fault in the VESTA Kiosk
#: The severities whose finding earns a task, hence a Kiosk fault.
TASK_SEVERITIES = ("P2", "P3")
STATUSES = (DONE, CLEARED, CLOSED_IN_KIOSK)

_ORDER = result.PRIORITY_ORDER

#: A state finding closed this many days ago or less that the night sees again is the SAME problem, back — not a new one.
AGAIN_DAYS = 7


def occurrences(finding: dict | None) -> list[str]:
    """The days a finding was seen in the AGAIN_DAYS up to its latest reopening (kept to that window as it reopens)."""
    if not finding:
        return []
    return json.loads(finding.get("occurrences") or "null") or [finding["opened_day"]]


def incident_runs(inc: dict) -> int:
    """How many times an incident alerted in the AGAIN_DAYS before its latest run (store.reopen_incident keeps them)."""
    from datetime import datetime, timedelta
    latest = datetime.fromisoformat(inc.get("reopened_at") or inc["opened_at"])
    runs = [o["opened_at"] for o in json.loads(inc.get("occurrences") or "[]")] + [latest.isoformat()]
    return sum(1 for r in runs if datetime.fromisoformat(r) >= latest - timedelta(days=AGAIN_DAYS))


def again_title(summary: str, again: int | None) -> str:
    """A problem's title with how often it came back: the Kiosk fault, the digest and the AI all read this one."""
    return f"{summary} (again: {again + 1} times in {AGAIN_DAYS} days)" if again else summary




def worsened(change_pct: float | None, last_reported_pct: float | None, step: float) -> bool:
    """A still-open finding earns a digest line again when it moved `step` points further from normal
    than when it was last reported."""
    return change_pct is not None and abs(change_pct) - abs(last_reported_pct or 0) >= step


def closes_tonight(open_rows: list[dict], fired: set[tuple[str, str]], state_rules, event_rules=()) -> list[dict]:
    """The open findings that close tonight: a STATE rule (a condition that holds or not) that did not fire for its
    entity — or an EVENT rule's finding kept open for its fault (record_night) that did not fire again."""
    return [o for o in open_rows if (o["rule_id"] in state_rules or o["rule_id"] in event_rules)
            and (o["rule_id"], o["entity_id"]) not in fired]


def villa_day_of(iso: str) -> str:
    """The villa's day of a stored moment, as a finding's day is written: in the zone the agent runs in (the Supervisor
    sets TZ in every app's container: the villa's)."""
    import os
    from .timeutil import villa_date
    try:
        return villa_date(iso, os.environ.get("TZ") or "UTC").isoformat()
    except Exception:  # noqa: BLE001 — a zone this machine does not know: the stored date
        return str(iso)[:10]


class Problems:
    def __init__(self, store: Store):
        self.store = store

    # ---------------------------------------------------------------- opening
    def open_task(self, source: str, source_id: int, rule_id: str, entity_id: str, summary: str,
                  check: str = "") -> tuple[int, bool]:
        """The facility manager's task about a finding or an incident: (task id, created). One open task
        per rule and entity — a second call returns the open one."""
        cur = self.store.open_task(rule_id, entity_id)
        if cur:
            return cur["id"], False
        return self.store.add_task(rule_id, entity_id, summary, source=f"{source}:{int(source_id)}",
                                   check_text=check or None), True

    def reopen_task(self, source: str, source_id: int, rule_id: str, entity_id: str, summary: str,
                    check: str = "") -> tuple[int, str]:
        """The task of a problem that came back: (task id, "open" — it still is | "reopened" — its last one, closed, open
        again under `summary` (its Kiosk fault is to be reopened: result.reopened) | "new" — it never had one).

        ⚠️ ONE PROBLEM, ONE FAULT (architecture review 24): each return opened a new task and a new Kiosk fault — 24 a day
        for one access point, each opened and resolved, nothing saying they were the same."""
        cur = self.store.open_task(rule_id, entity_id)
        if cur:
            return cur["id"], "open"
        last = self.store.last_task(f"{source}:{int(source_id)}")
        if last:
            self.store.reopen_task(last["id"], summary)
            return last["id"], "reopened"
        return self.open_task(source, source_id, rule_id, entity_id, summary, check)[0], "new"

    # ---------------------------------------------------------------- closing
    def close(self, task_id: int, status: str, note: str = "", who: str | None = None) -> None:
        """`note`, `who`: what its fault's close says and the person who closed it, kept with the task (card())."""
        if status not in STATUSES:
            raise ValueError(f"a task closes as one of {', '.join(STATUSES)}, not {status!r}")
        self.store.close_task(task_id, status, note, who)

    def clear_source(self, source: str, source_id: int, rule_id: str = "", entity_id: str = "",
                     status: str = CLEARED, note: str = "", who: str | None = None) -> list[int]:
        """Its finding or incident is over: the open task(s) about it close. Returns their ids (their
        tickets are to be resolved). A task a person reopened is closed only by a person (in_persons_hands): its
        source ending CLEARS nothing of it; a person's Done (DONE) still closes it."""
        closed = []
        for t in self.store.tasks("open"):
            if status == CLEARED and self.in_persons_hands(t):
                continue
            if t.get("source") == f"{source}:{int(source_id)}":
                self.close(t["id"], status, note, who)
                closed.append(t["id"])
        return closed

    # ⚠️ CLOSING A SOURCE CLOSES WHAT IT OWES (architecture review 6, 2026-10-07). The alert desk and the night check
    # each closed an incident or a finding, then had to remember to clear its task and resolve its Kiosk fault —
    # and to agree with source_gone() on which states end a Problem. The state decides here, once; the callers get
    # back the fault actions to carry out.
    def close_incident(self, iid: int, state: str, now_iso: str, note: str = "", who: str | None = None, **fields) -> list[dict]:
        """The incident ends in `state` (closed now). When that state ends its Problem (Incident.ANSWERED_OR_CLEARED)
        its open task closes too — done by a person, or cleared — and its Kiosk fault is to be resolved with `note`, by
        `who` when a person did it (review 29: a Telegram Done showed "resolved … by VESTA Agent" on the card)."""
        self.store.update_incident(iid, state=state, closed_at=now_iso, **fields)
        if state not in Incident.ANSWERED_OR_CLEARED:
            return []
        status = DONE if state == Incident.DONE else CLEARED
        return [result.resolved(tid, note, who) for tid in self.clear_source("incident", iid, status=status, note=note, who=who)]

    def close_finding(self, finding: dict, day: str, note: str = "") -> list[dict]:
        """The night check no longer sees a finding: it closes, its task is cleared, its Kiosk fault resolved."""
        self.store.close_finding(finding["rule_id"], finding["entity_id"], day)
        return [result.resolved(tid, note) for tid in self.clear_source("finding", finding["id"], note=note)]

    # ⚠️ THE NIGHT'S LEDGER, HERE (architecture review 7, 2026-10-07): nightly.py kept it inline — raised,
    # an event closed the same night, a rerun not news twice, worsened, closed tonight, its task opened. Which
    # rules are states and which are events, the worsened step and which severities get a task stay the skill's.
    def record_night(self, findings, day: str, _muted_at_iso: str | None = None, *, state_rules, event_rules, worsened_step: float,
                     task_severities=TASK_SEVERITIES, resolved_note: str = "") -> dict:
        """The night check's findings for `day`: {new, still_open, closed, again (came back: AGAIN_DAYS), tasks,
        resolve_actions, reopen_actions (a returning finding's fault open again)}. (`_muted_at_iso`: what a
        night check edited before 0.12.132 still passes — Mute is gone, it is ignored.)
        A finding has rule_id, entity_id, family, severity, summary, detail, check, day and as_dict()."""
        new, still_open, closed, again, fired = [], [], [], [], set()
        for f in findings:
            f.day = day
            f.detail["check"] = f.check
            fired.add((f.rule_id, f.entity_id))
            prev_row = self.store.open_finding(f.rule_id, f.entity_id)
            prev = json.loads(prev_row["detail"] or "{}") if prev_row else {}
            if prev and f.rule_id in state_rules:
                f.detail["last_reported_pct"] = prev.get("last_reported_pct", prev.get("change_pct"))
            back = self._came_back(f, day, prev_row is None and f.rule_id in state_rules)
            if back is not None:
                fid, is_new = back, False
            else:
                fid, is_new = self.store.raise_finding(f.rule_id, f.entity_id, f.family, day, f.severity, f.summary, f.detail)
            d = f.as_dict()
            d["id"] = fid
            if back is not None:
                d["again"] = len(occurrences(self.store.finding(fid))) - 1
                again.append(d)
            elif f.rule_id in event_rules:
                # ⚠️ AN EVENT WITH A FAULT STAYS OPEN A NIGHT (architecture review 30): closed the night it fired, its new
                # fault was resolved by the repair the same second — "Cleared: the check no longer sees it", the digest
                # "nothing new", the monthly page "Fixed". It closes when a night passes without it, or a person does.
                if f.severity not in task_severities:
                    self.store.close_finding(f.rule_id, f.entity_id, day)    # no fault: closes the same night, as ever
                if is_new:                                                    # a rerun of the same night: told already
                    new.append(d)
                elif f.severity in task_severities and prev_row and prev_row["opened_day"] != day:
                    still_open.append(d)                                      # again while its fault is open: the same one
            elif is_new:
                new.append(d)
            else:
                still_open.append(d)
                # a finding that worsens by `worsened_step` points earns a digest line again
                if worsened(f.detail.get("change_pct"), f.detail.get("last_reported_pct"), worsened_step):
                    d["worsened"] = True
                    f.detail["last_reported_pct"] = f.detail.get("change_pct")
                    self.store.set_finding_detail(fid, f.detail)
        resolve = []
        for o in closes_tonight(self.store.findings(status="open"), fired, state_rules, event_rules):
            closed.append(o)
            # ⚠️ ITS TASK AND ITS KIOSK TICKET CLOSE WITH IT (villa, 2026-10-01): the finding closed, the ticket
            # stayed "Open fault" for ever, and the Kiosk's Cockpit filled with faults long gone
            resolve += self.close_finding(o, day, resolved_note)
        tasks, reopen = [], []
        for d in new + again:
            if d["severity"] in task_severities:
                title = again_title(d["summary"], d.get("again"))
                if d in again:
                    tid, how = self.reopen_task("finding", d["id"], d["rule_id"], d["entity_id"], title, d.get("check") or "")
                    if how == "reopened":
                        reopen.append(result.reopened(tid, title, "Back again."))
                        continue
                    created = how == "new"
                else:
                    tid, created = self.open_task("finding", d["id"], d["rule_id"], d["entity_id"], title,
                                                  d.get("check") or "")
                if created:
                    # the Kiosk fault's title IS the task's, "(again: …)" included (architecture review 23: only the
                    # task row carried it — the Cockpit never said it)
                    tasks.append({"task_id": tid, "todo_summary": title[:250], "check": d.get("check") or "",
                                  "severity": d["severity"], "entity_id": d["entity_id"]})
        # ⚠️ AN OPEN PROBLEM THAT NEVER HAD A FAULT GETS ONE (villa, 2026-10-14: a sensor offline for five days was
        # open every night and never in the Cockpit). A task was asked for only on the night a finding was new or came
        # back, so one opened before it earned a task — written by an older night check, or at a severity without
        # one — stayed open and unseen for as long as the problem lasted. One that HAD a task is left alone: a
        # person's close keeps a still-true problem quiet, and an open task's missing fault is repair's to restore.
        for d in still_open:
            if d["severity"] not in task_severities or self.store.open_task(d["rule_id"], d["entity_id"]) \
                    or self.store.last_task(f"finding:{int(d['id'])}"):
                continue
            tid, created = self.open_task("finding", d["id"], d["rule_id"], d["entity_id"], d["summary"],
                                          d.get("check") or "")
            if created:
                tasks.append({"task_id": tid, "todo_summary": d["summary"][:250], "check": d.get("check") or "",
                              "severity": d["severity"], "entity_id": d["entity_id"]})
        return {"new": new, "still_open": still_open, "closed": closed, "again": again, "tasks": tasks,
                "resolve_actions": resolve, "reopen_actions": reopen}

    def _came_back(self, f, day: str, may: bool) -> int | None:
        """⚠️ THE SAME PROBLEM, BACK (architecture review 22): a device offline every night and back by noon was closed
        in the day (recheck.py) and raised as NEW each night — a new Kiosk fault and a "new" digest line every morning,
        never "it keeps happening". A state finding closed in the last AGAIN_DAYS days is opened again, its count kept
        (the store's reopened_day / reopened_at / occurrences). Returns its id, or None.

        ⚠️ AN OCCURRENCE OF ITS OWN (architecture review 23): reopened as it was, it kept its first day (listed "still
        open since the 5th", never "again") and the task a person closed the time before — which hid it from every
        reader while the Kiosk showed it open. A person's close counts only after the latest reopening."""
        if not may:
            return None
        from datetime import date, timedelta
        since = (date.fromisoformat(day) - timedelta(days=AGAIN_DAYS)).isoformat()
        last = self.store.last_closed_finding(f.rule_id, f.entity_id, since, day)
        if not last:
            return None
        runs = json.loads(last.get("occurrences") or "null") or [last["opened_day"]]
        # ⚠️ THE RUN BEFORE COUNTS WHEN IT ENDED IN THE WINDOW (architecture review 30): opened 20 days ago, closed
        # yesterday, back today — "(again: …)" was not said at all, the message read as a new problem
        seen = ([x for x in runs if x >= since] or [since]) + [day]
        self.store.reopen_finding(last["id"], f.severity, f.summary, f.detail, day, seen)
        return last["id"]

    def closed_in_kiosk(self, task_id: int, said: str = "Closed in the Cockpit") -> int | None:
        """A person closed the task's fault in the VESTA Kiosk: the task closes, and so does the incident
        it came from (the alert desk stops chasing it). Returns that incident's id, for its messages. `said`: who and
        when, as kiosk_words.closed writes it — the desk's check after it says it again (review 29: "Closed in the
        Kiosk, but …" had lost the person)."""
        task = self.store.task(task_id)
        self.close(task_id, CLOSED_IN_KIOSK)
        kind, sid = self._source(task)
        if kind == "incident" and sid:
            inc = self.store.incident(sid)
            if inc and not inc.get("closed_at"):
                # ⚠️ A DONE IS A DONE, WHEREVER IT IS GIVEN (architecture review 24): closed in the Kiosk, a door fault
                # skipped the check a Done button gets — the door still unlocked, it stayed closed for good. The alert
                # desk reads it again once (quiet_after_done), when its rule names its states
                p = json.loads(inc.get("payload") or "{}")
                p["check_quiet"] = said
                self.store.update_incident(sid, state=Incident.DONE, reply="Closed in the Cockpit",
                                           closed_at=self.store.now(), payload=json.dumps(p))
                return sid
        return None

    def reopened_in_kiosk(self, task_id: int, by: str = "", said: str | None = None) -> int | None:
        """A person reopened a closed task's fault in the VESTA Kiosk: the task is open again, theirs until they close
        it (the night check's "gone" never closes it); its incident, if any, opens again and its facility manager is
        asked at once (the alert desk: payload "kiosk_reopened"). Returns that incident's id.

        ⚠️ A PERSON'S REOPENING IS NEVER UNDONE (architecture review 25): the agent resolved it again within 5 minutes."""
        task = self.store.task(task_id)
        self.store.reopen_task(task_id, task.get("summary") or "", by=by or "a person")
        kind, sid = self._source(task)
        if kind == "incident" and sid:
            inc = self.store.incident(sid)
            if inc and inc.get("closed_at"):
                p = json.loads(inc.get("payload") or "{}")
                p["kiosk_reopened"] = said or by or "a person"     # kiosk_words.reopened: who and when, said once
                p.pop("check_quiet", None)
                self.store.update_incident(sid, closed_at=None, reply=None, state=Incident.ASKED,
                                           asked_at=self.store.now(), assignee="fm", payload=json.dumps(p))
                return sid
        return None

    def taken_in_kiosk(self, task_id: int, said: str) -> int | None:
        """A person took the task's fault on in the VESTA Kiosk ("Open Ticket"): the alert it came from is no longer
        chased — no reminder, no escalation (owner, 2026-10-15: "should Telegram stop chasing the facility manager?
        yes"). It stays open and ends as before. Returns the incident's id when it was still being chased, else None.
        `said`: who and when, as kiosk_words.taken writes it."""
        kind, sid = self._source(self.store.task(task_id))
        if kind != "incident" or not sid:
            return None
        inc = self.store.incident(sid)
        if not inc or inc.get("closed_at") or inc.get("state") not in Incident.CHASED:
            return None
        self.store.update_incident(sid, state=Incident.TAKEN, reply=said)
        return sid

    def unreached(self, iid: int) -> None:
        """No chat of the facility manager's received incident `iid` (Telegram refused them all): the alert desk hands
        it to the owner at its next tick (payload "unreached")."""
        inc = self.store.incident(iid)
        if inc and not inc.get("closed_at"):
            self.store.update_incident(iid, payload=json.dumps({**json.loads(inc.get("payload") or "{}"), "unreached": True}))

    # ⚠️ ONE ANSWER TO "IS IT A PERSON'S NOW?" (architecture review, 2026-10-14). reopened_in_kiosk promises a task a
    # person reopened stays theirs until they close it; the repair kept that promise, the night check's close_finding
    # did not — the owner's reopened "Pump weak" closed itself "Cleared" the next night the check no longer saw it.
    @staticmethod
    def in_persons_hands(task: dict | None) -> bool:
        """An open task whose fault a person reopened in the VESTA Kiosk: only a person closes it. (A task reopened
        because its problem came back has no `reopened_by`: the agent's own.)"""
        return bool(task) and task.get("status") == "open" and bool(task.get("reopened_by"))

    def closed_by_person(self, source: str, since: str = "") -> bool:
        """A person closed the latest task about `source` ("finding:3") — Done, or closed in the Kiosk — after `since`
        (its problem's latest return): the problem is quiet while its condition lasts. ONE reading for every list
        (open_problems, unseen); a close from before the problem came back is not this occurrence's."""
        last = self.store.last_task(source)
        return bool(last) and last.get("status") in (DONE, CLOSED_IN_KIOSK) and (last.get("done_at") or "") > (since or "")

    def source_gone(self, task: dict) -> bool:
        """True when the finding or incident a task is about is closed — the task outlived it."""
        kind, sid = self._source(task)
        if kind == "finding":
            row = self.store.finding(sid)
            return bool(row) and row["status"] != "open"
        if kind == "incident":
            # over when it was answered or cleared — not when its rule stopped watching it
            inc = self.store.incident(sid)
            return bool(inc) and bool(inc.get("closed_at")) and inc.get("state") in Incident.ENDED
        return False                                     # no source of its own: it waits for a person

    def close_outlived(self, note: str = "Cleared: the check no longer sees it.") -> list[int]:
        """Open tasks whose finding or incident is over — and that no person reopened (in_persons_hands) — close as
        cleared, `note` kept for their fault. Returns their ids. (A source closed by its own path closes its task there,
        close_incident / close_finding; this catches one that ended another way.)"""
        out = []
        for t in self.open_tasks():
            if self.source_gone(t) and not self.in_persons_hands(t):
                self.close(t["id"], CLEARED, note)
                out.append(t["id"])
        return out

    # ---------------------------------------------------------------- reading
    # ⚠️ THE CARD IS WORKED OUT, NOT PATCHED (architecture review, 2026-10-14). A change was sent to the Kiosk once; when
    # it failed (the Kiosk down a minute), the repair later guessed with what it had left — a Done pressed by Fabien became
    # "Closed by VESTA Agent — Closed: the problem is over.", and no repair in Recent work. Every fact a fault's card
    # shows is here, from the task and its problem, and tickets.repair makes the Kiosk say it.
    def card(self, task: dict) -> dict:
        """What task `task`'s Kiosk fault must say: {open, title (what is wrong now), number (its alert's "#N", or None),
        origin ("alert" | "night", or None),
        note and who (its close: what it says, the person who closed it — None: the agent's own clearing)}."""
        kind, sid = self._source(task)
        return {"open": task.get("status") == "open", "title": self.current_title(task),
                "number": sid if kind == "incident" else None,
                # where it came from, the Kiosk card's source icon (owner, 2026-10-14): an alert or the night check
                "origin": {"incident": "alert", "finding": "night"}.get(kind or ""),
                "note": task.get("close_note") or "Closed: the problem is over.", "who": task.get("closed_who") or None}

    def unseen(self) -> list[dict]:
        """Open findings that should be a fault and are not: a task severity, no open task, and no person's close
        keeping it quiet (Done, or closed in the Kiosk). record_night leaves none; tickets.repair says when any is
        found (villa, 2026-10-14: a sensor open for five days, never in the Cockpit, and nothing said so)."""
        out = []
        for f in self.store.findings(status="open"):
            if f["severity"] not in TASK_SEVERITIES or self.store.open_task(f["rule_id"], f["entity_id"]):
                continue
            if self.closed_by_person(f"finding:{int(f['id'])}", f.get("reopened_at") or ""):
                continue
            out.append(f)
        return out

    def restore_unseen(self, faults: set[str]) -> list[int]:
        """Every open problem that should be a fault and is not (unseen) gets its task back: its last one open again,
        or a new one. `faults`: the fault ids the Kiosk still holds — a task whose fault is gone loses its id, so the
        repair makes a new one. Returns the task ids.

        ⚠️ THE WARNING WAS NOT A FIX (villa, 2026-10-15): Timmerflotte_2623, offline since 9 Oct, was named "an open
        problem with no Kiosk fault" every 5 minutes for a day — its task had been closed by the agent while the
        sensor stayed dead (why: not readable from here), and record_night gives a fault only to a problem that never
        had one. The Cockpit showed the dead sensor with no Open Ticket, and nobody was asked. A person's close is
        never undone: unseen() leaves it out."""
        out = []
        for f in self.unseen():
            tid, _how = self.reopen_task("finding", f["id"], f["rule_id"], f["entity_id"], f.get("summary") or "",
                                         json.loads(f.get("detail") or "{}").get("check") or "")
            uid = (self.store.task(tid) or {}).get("todo_uid")
            if uid and uid not in faults:
                self.store.set_task_uid(tid, None)
            out.append(tid)
        return out

    def open_tasks(self) -> list[dict]:
        return self.store.tasks("open")

    def title_of(self, task: dict) -> str:
        """What is wrong, without what to check."""
        return task.get("summary") or ""

    def current_title(self, task: dict) -> str:
        """What is wrong NOW: the finding's summary as the night check last wrote it (a battery's 5 % became 0 %),
        else the task's own words. The task is written once; its finding is updated every night."""
        kind, sid = self._source(task)
        if kind == "finding":
            row = self.store.finding(sid)
            if row and row.get("status") == "open" and row.get("summary"):
                # ⚠️ THE SAME NAME AS EVERY READER (architecture review 24): the repair renamed the fault to the bare
                # summary seconds after the night wrote "(again: …)" — the Cockpit never showed it
                return again_title(row["summary"], len(occurrences(row)) - 1)
        if kind == "incident":
            # ⚠️ AN ALERT SAYS WHAT HOME ASSISTANT SAYS NOW (architecture review, 2026-10-14): Home Assistant re-worded an
            # open alert (desk RESTATED), Telegram showed the new words, the card kept the first ones
            inc = self.store.incident(sid)
            message = json.loads((inc or {}).get("payload") or "{}").get("message") if inc and not inc.get("closed_at") else None
            if message:
                return again_title(str(message)[:200], incident_runs(inc) - 1)
        return self.title_of(task)

    def check_of(self, task: dict) -> str:
        """What to check on site ("" when the task does not say)."""
        return task.get("check_text") or ""

    def open_problems(self) -> list[dict]:
        """THE answer to "what is still open", for every reader (the weekly list, the daily digest, the
        owner's lines, the concierge): the open findings and incidents, less a finding whose task a
        person has closed (done, or closed in the Kiosk) while its condition lasts. Most severe first."""
        out = []
        for f in self.store.findings(status="open"):
            # a person's close counts for THIS occurrence only: after the finding's latest reopening (_came_back)
            if f["severity"] not in _ORDER or self.closed_by_person(f"finding:{f['id']}", f.get("reopened_at") or ""):
                continue
            d = json.loads(f.get("detail") or "{}")
            since = f.get("reopened_day") or f["opened_day"]
            back = len(occurrences(f)) - 1
            out.append({"id": f"finding-{f['id']}", "source": f"finding:{f['id']}", "rule_id": f["rule_id"],
                        "entity_id": f["entity_id"], "severity": f["severity"],
                        "title": again_title(_no_code(f["summary"]), back), "again": back,
                        "check": d.get("check") or "", "since": since, "incident": None,
                        "figures": {k: v for k, v in d.items() if isinstance(v, (int, float, str)) and k != "check"}})
        for i in self.store.incidents(open_only=True):
            p = json.loads(i.get("payload") or "{}")
            out.append({"id": f"incident-{i['id']}", "source": f"incident:{i['id']}", "rule_id": i["rule_id"],
                        "entity_id": i["entity_id"], "severity": i["severity"],
                        # its latest run is when it opened, how often it came back is in its title (review 24: a
                        # reopened alert stayed "still open since the 1st", never new, never "again")
                        "title": again_title(_no_code(p.get("message") or i["rule_id"]), incident_runs(i) - 1),
                        "check": p.get("check") or "",
                        # the VILLA's day it opened (review 30: the UTC date dated an alert of 06:30 at UTC+8 the day
                        # before — under "Still open" where "Also noted" was due)
                        "since": villa_day_of(i.get("reopened_at") or i["opened_at"]), "incident": i["id"],
                        "figures": {"incident": i["id"], "occurrences": i["count"], "state": i["state"]}})
        out.sort(key=lambda r: (_ORDER.get(r["severity"], 9), r["since"]))
        return out

    def since(self, day: str) -> dict[str, list[dict]]:
        """The open problems split by when they opened: {"new": opened on or after `day`, "still_open": before it,
        "open": all of them}, each most severe first.

        ⚠️ ONE "NEW" (architecture review 13, 2026-10-09): the morning digest decided it from its own query (findings
        opened since yesterday, closed ones included) while the weekly page asked open_problems; the two disagreed
        on what was new and on how many were still open."""
        out: dict[str, list[dict]] = {"new": [], "still_open": [], "open": self.open_problems()}
        for p in out["open"]:
            out["new" if p["since"] >= day else "still_open"].append(p)
        return out

    # ---------------------------------------------------------------- inside
    @staticmethod
    def _source(task: dict | None) -> tuple[str | None, int | None]:
        src = (task or {}).get("source") or ""
        kind, _, sid = src.partition(":")
        return (kind, int(sid)) if sid.isdigit() else (None, None)
