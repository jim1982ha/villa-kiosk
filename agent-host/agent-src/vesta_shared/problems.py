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
from datetime import datetime
from typing import Callable

from . import agreement, result
from .limits import limit
from .messaging import headline, incident_tag, problem_title_chars
from .store import Incident, Notes, Store, notes_of
from . import alert_watch, kiosk_words, maintenance
from . import message_format as mf
from .help_link import HelpLink

DONE = "done"                          # a person answered Done (a button, or "#N done")
CLEARED = "cleared"                    # its source is gone: the night check no longer sees it, HA cleared it
CLOSED_IN_KIOSK = "closed_in_kiosk"    # a person closed the fault in the VESTA Kiosk
#: The severities whose finding earns a task, hence a Kiosk fault.
TASK_SEVERITIES = ("P2", "P3")
STATUSES = (DONE, CLEARED, CLOSED_IN_KIOSK)


_ORDER = result.PRIORITY_ORDER

def alert_line(p: dict) -> str:
    """An open alert (Problems.open_problems' row) on one line, as every report lists it: "#9-P2 · Door unlocked" —
    its name as Telegram titles it (messaging.incident_tag) and its one name (owner, 2026-10-28: the digest's "Still
    open" and the concierge's "Open alerts" each wrote it)."""
    return f"{incident_tag(p['incident'], p.get('severity'))} · {p['title']}"


def again_days() -> int:
    """A state finding closed this many days ago or less that the night sees again is the SAME problem, back — not a
    new one; and "again: N times in D days" counts this window."""
    return limit("problems.again_days", 7, unit="days", group="detect", lo=1, hi=90,
                 says="A problem that comes back within this many days of its close is the same problem, reopened, "
                      "and its \"again: N times in D days\" counts these D days.",
                 reached="Back after longer, it is a new problem with a new number.", told="person")


#: The window when a skill script starts (it reads it once); the engine calls again_days() at each use
AGAIN_DAYS = again_days()

#: What a task's fault says when it opens again because its problem was read still there after a person closed it —
#: as the alert desk's reopening says it (its quiet_after_done), one sentence for both.
STILL_THERE = "Still there after the close."


def occurrences(finding: dict | None) -> list[str]:
    """The days a finding was seen in the AGAIN_DAYS up to its latest reopening (kept to that window as it reopens)."""
    if not finding:
        return []
    return json.loads(finding.get("occurrences") or "null") or [finding["opened_day"]]


def incident_runs(inc: dict, store: Store) -> int:
    """How many times the alert of `inc` (its key: the rule and the device) alerted in the AGAIN_DAYS up to the incident's
    latest run — every incident of that key counted, each run of each (store.reopen_incident keeps them).

    ⚠️ "N TIMES IN 7 DAYS" MEANS THE WEEK, NOT ONE NUMBER (architecture review, 2026-10-18): only the runs of the one
    incident were counted, and an alert back more than reopen_hours after its close gets a new number — the same camera
    three nights running read "New" each night, "1st time", while the line claimed to count seven days."""
    from datetime import datetime, timedelta
    latest = datetime.fromisoformat(inc.get("reopened_at") or inc["opened_at"])
    since = latest - timedelta(days=again_days())
    # ⚠️ AND UNDER ITS NAME (architecture review scan 1, 2026-10-19): an alert filed by its rule's permanent number
    # (0.12.250, "rule:<uid>|<device>") came back as the "1st time" though its runs of the week were filed under the
    # rule's name — the same rule, the same device
    keys = {inc["key"], f"{inc.get('rule_id') or ''}|{inc.get('entity_id') or ''}"}
    runs = {inc["id"]: _runs_of(inc)} | {i["id"]: _runs_of(i) for k in keys for i in store.incidents_of_key(k)}
    return sum(1 for rs in runs.values() for r in rs if since <= datetime.fromisoformat(r) <= latest)


def _runs_of(inc: dict) -> list[str]:
    """When each run of an incident opened: its earlier runs, then its current one."""
    return [o["opened_at"] for o in json.loads(inc.get("occurrences") or "[]")] + [inc.get("reopened_at") or inc["opened_at"]]


def again_title(summary: str, again: int | None) -> str:
    """`summary` with how often it came back ("(again: 3 times in 7 days)"); problem_name() is what every page shows."""
    return f"{summary} (again: {again + 1} times in {again_days()} days)" if again else summary


def problem_name(text: str, again: int | None = None) -> dict:
    """THE name of a problem, the same on every surface — the Cockpit's fault, the morning message, the weekly page,
    the playbook, the chat's villa status, the night check's message: {headline, detail}. headline: the text's first
    line with no rule code and no emoji (messaging.headline), with how often it came back, at most
    problems.title_chars long — cut before "(again: …)", never through it, so a cut again cuts nothing. detail: the
    text's other lines ("" when none), shown only where there is room for them.

    ⚠️ ONE NAME (architecture review P, 2026-10-27): an alert's text has three lines (what tripped, the reading, the
    limit held). The Cockpit kept the first and lost the "(again: …)" written after the LAST; the morning message
    showed all three with the 🚨, cut at 160 — on a long alert, through the count; the weekly page dropped the count;
    eight settings cut the same title."""
    lines = [ln.strip() for ln in (text or "").strip().splitlines() if ln.strip()]
    tail = again_title("", again)
    head = headline(text)[:max(0, problem_title_chars() - len(tail))].rstrip()
    return {"headline": head + tail, "detail": "\n".join(lines[1:])}




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


def agreed(field: str, word: str) -> str | None:
    """`word` as the agreement with the Kiosk declares it for a fault's `field` ("origins": alert, night, chat;
    "checks": minutes, day, nightly — agent-contract.json `ticket`), read from the file; None for a word it does not declare
    (the card then shows its generic icon, no clock) — never a copy of its lists here (architecture review round 3,
    2026-10-19)."""
    return word if word and word in (agreement.section("ticket").get(field) or ()) else None


def priority_of(incident: dict | None) -> str | None:
    """An incident's priority (P1…P4), or None when it says none (result.priority)."""
    return result.priority(str((incident or {}).get("severity") or ""))


def alert_name(store: Store, iid: int | str) -> str:
    """How alert `iid` is named everywhere ("#9-P2"), from the store: its priority read once, here (the night check, the
    engine's Incidents.name)."""
    return incident_tag(iid, priority_of(store.incident(int(iid)) if str(iid).isdigit() else None))


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
                    check: str = "", note: str = "Back again.") -> tuple[int, str]:
        """The task of a problem that came back: (task id, "open" — it still is | "reopened" — its last one, closed, open
        again under `summary` (its Kiosk fault is to be reopened, saying `note`: card()) | "new" — it never had one).

        ⚠️ ONE PROBLEM, ONE FAULT (architecture review 24): each return opened a new task and a new Kiosk fault — 24 a day
        for one access point, each opened and resolved, nothing saying they were the same."""
        cur = self.store.open_task(rule_id, entity_id)
        if cur:
            return cur["id"], "open"
        last = self.store.last_task(f"{source}:{int(source_id)}")
        if last:
            self.store.reopen_task(last["id"], summary, note=note)
            return last["id"], "reopened"
        return self.open_task(source, source_id, rule_id, entity_id, summary, check)[0], "new"

    # ---------------------------------------------------------------- closing
    def close(self, task_id: int, status: str, note: str = "", who: str | None = None) -> None:
        """`note`, `who`: what its fault's close says and the person who closed it, kept with the task (card())."""
        if status not in STATUSES:
            raise ValueError(f"a task closes as one of {', '.join(STATUSES)}, not {status!r}")
        self.store.close_task(task_id, status, note, who)

    # ⚠️ CLOSING A SOURCE CLOSES WHAT IT OWES (architecture review 6, 2026-10-07). The alert desk and the night check
    # each closed an incident or a finding, then had to remember to clear its task and resolve its Kiosk fault —
    # and to agree with source_gone() on which states end a Problem. The state decides here, once; the callers get
    # back the fault actions to carry out.
    def close_incident(self, iid: int, state: str, now_iso: str, note: str = "", who: str | None = None, *,
                       person: str | None = None, can_come_back: bool = True, terms: dict | None = None,
                       **fields) -> list[dict]:
        """The incident ends in `state` (closed now), with the watch that follows (alert_watch.close: `person` — a
        person closed it, as the desk's read-again says it; `can_come_back`; `terms` — the desk's, else those it
        carries). When that state ends its Problem (Incident.ANSWERED_OR_CLEARED) its open task closes too — done by a
        person, or cleared — its close saying `note`, by `who` when a person did it (review 29: a Telegram Done showed
        "resolved … by VESTA Agent" on the card). Returns a script's `actions` for it: [result.faults_changed()] when a
        task moved (result.moved)."""
        alert_watch.close(self.store, iid, state, now_iso, person=person, can_come_back=can_come_back, t=terms,
                          **fields)
        moved = self.settle(f"incident:{int(iid)}", note=note, who=who)
        # an alert standing for a fault's Need help: its close closes that fault too (a Done on Telegram, the desk's)
        moved = [*moved, *self.help.closed(iid, note, who)]
        return result.moved(moved)

    @property
    def help(self) -> HelpLink:
        """The alerts standing for a fault's Need help (vesta_shared.help_link)."""
        return HelpLink(self)

    def person_done(self, iid: int, place: str, *, who: str | None = None, at: str | None = None, said=None,
                    person: str | None = None, terms: dict | None = None) -> list[dict]:
        """A person's Done on alert `iid`, wherever it was given (`place`: message_format ON_TELEGRAM, ON_TABLET — the
        tablet's notice — or IN_COCKPIT, the card; `at`: when, now when not said): the one close of an alert by a
        person, read again by the desk (alert_watch.close: `person`, `said` the line it says again — Words for the
        Cockpit's), its reply and its fault's close note the place's words (message_format.done_in: "Done on Telegram
        (JM)"). From Telegram or the tablet its task closes as a Done (close_incident); in the Cockpit the task closed
        already (closed_in_kiosk). Returns a script's `actions` (result.moved).

        ⚠️ ONE DONE, ONE ENTRY (architecture review, 2026-10-30 evening: three closes of an alert each wrote their own
        words — the reports read "Done", "Done (Closed in the Cockpit)" and "Done (Done in the Cockpit)" for one press)."""
        words = mf.done_in(place, who)
        when = _moment(at)
        now_iso = when.isoformat() if when else self.store.now()
        if place == mf.IN_COCKPIT:
            alert_watch.close(self.store, iid, Incident.DONE, now_iso, person=kiosk_words.stored(said or words),
                              reply=words)
            return []
        return self.close_incident(iid, Incident.DONE, now_iso, f"{words}.", who=who, reply=words,
                                   person=person or words, terms=terms)

    def close_finding(self, finding: dict, day: str, note: str = "") -> list[dict]:
        """The night check no longer sees a finding: it closes, its task is cleared (its Kiosk fault follows: the
        repair). Returns a script's `actions` for it (result.moved)."""
        self.store.close_finding(finding["rule_id"], finding["entity_id"], day)
        return result.moved(self.settle(f"finding:{int(finding['id'])}", note=note))

    def seen(self, finding_id: int, at: str, settle_minutes: float | None) -> list[int]:
        """Open finding `finding_id` read still bad at `at` (a reading of its source: the recheck's, every few minutes,
        for a rule its skill reads again) — recorded, then settled: the ids of the tasks that moved. `settle_minutes`:
        how long after a person's close such a reading must come to open the task again (wants_open)."""
        self.store.finding_seen(int(finding_id), at, settle_minutes)
        return self.settle(f"finding:{int(finding_id)}")

    # ⚠️ THE NIGHT'S LEDGER, HERE (architecture review 7, 2026-10-07): nightly.py kept it inline — raised,
    # an event closed the same night, a rerun not news twice, worsened, closed tonight, its task opened. Which
    # rules are states and which are events, the worsened step and which severities get a task stay the skill's.
    def record_night(self, findings, day: str, _muted_at_iso: str | None = None, *, state_rules, event_rules, worsened_step: float,
                     resolved_note: str = "", handed_over: dict[tuple[str, str], str] | None = None,
                     at: str | None = None, settle_minutes: float | None = None) -> dict:
        """The night check's findings for `day`: {new, still_open, closed, again (came back: AGAIN_DAYS), task_ids (the
        ids of the tasks opened or opened again), resolved (the ids of the tasks closed)} — ids only: what each fault
        says is Problems.card's, the repair writes it. (`_muted_at_iso`: what a night check edited before 0.12.132
        still passes — Mute is gone, it is ignored.) `at`, `settle_minutes`: record's.
        A finding has rule_id, entity_id, family, severity, summary, detail, check, day and as_dict().
        The night sees everything: a state finding it did not see tonight closes (`record` is the rest).

        `handed_over`: (rule, entity) → the note of a finding the night left out because something else now follows it
        (an open alert on the same device): it closes with that note, never `resolved_note`, and is not counted closed.
        ⚠️ LEFT OUT IS NOT CLEARED (architecture review scan 1, 2026-10-19): a device offline at 5 minutes, then alerted
        on by the villa's rule at 10, read "Cleared: the nightly check no longer sees it" at 02:00 while still off."""
        handed_over = handed_over or {}
        out = self.record(findings, day, state_rules=state_rules, event_rules=event_rules, worsened_step=worsened_step,
                          at=at, settle_minutes=settle_minutes)
        fired = {(f.rule_id, f.entity_id) for f in findings}
        closed, resolve = [], []
        handed = []
        for o in closes_tonight(self.store.findings(status="open"), fired, state_rules, event_rules):
            note = handed_over.get((o["rule_id"], o["entity_id"]))
            (handed if note else closed).append(o)
            # ⚠️ ITS TASK AND ITS KIOSK TICKET CLOSE WITH IT (villa, 2026-10-01): the finding closed, the ticket
            # stayed "Open fault" for ever, and the Kiosk's Cockpit filled with faults long gone
            self.store.close_finding(o["rule_id"], o["entity_id"], day)
            resolve += self.settle(f"finding:{int(o['id'])}", note=note or resolved_note)
        # `resolve_actions`: kept for a skill edited before 0.12.267 (its nightly.py reads each one's task_id)
        return {**out, "closed": closed, "handed_over": handed, "resolved": resolve,
                "resolve_actions": [result.resolved(tid, (self.store.task(tid) or {}).get("close_note")) for tid in resolve]}

    # ⚠️ A RECHECK OF THE VERY FINDINGS IT READ MAY CLOSE THEM (owner, 2026-10-19: "refresh the open ones … by closing
    # the ones that are not active anymore"; 2026-10-20: every 5 minutes). "A partial reading records, only the whole
    # night may close" stays for a reading that does not say WHICH findings it judged (the 5-minute recheck's new
    # findings: record). The recheck names them: each finding it read again is a complete reading of that finding.
    def record_rechecked(self, rechecked, seen, day: str, at: str, *, note: str = "",
                         settle_minutes: float | None = None, handed: dict[int, str] | None = None) -> dict:
        """Open findings `rechecked` (ids) read again at `at` by their own rule; `seen`: those of them still found. Each
        seen is recorded as seen (Problems.seen: a person's close `settle_minutes` or more before opens its task again,
        STILL_THERE); each not seen closes on `day`, its task closing saying `note` — as record_night closes what the
        night did not see, and only among the findings read: {seen, closed (finding ids), task_ids (the tasks that
        moved)}. A finding no longer open is left as it is; an id in `seen` not read is ignored. What decides each
        task is settle()'s: a task a person reopened stays theirs, a person's close holds while it is not read again."""
        found, handed = {int(i) for i in seen}, {int(k): v for k, v in (handed or {}).items()}
        out_seen, closed, gone, moved = [], [], [], []
        for fid in sorted({int(i) for i in rechecked}):
            row = self.store.finding(fid)
            if not row or row["status"] != "open":
                continue
            if fid in found:
                moved += self.seen(fid, at, settle_minutes)
                out_seen.append(fid)
            else:
                # `handed`: finding id → its note, one followed now by another fault (as record_night's handed_over):
                # closed with that note, never counted cleared
                self.store.close_finding(row["rule_id"], row["entity_id"], day)
                moved += self.settle(f"finding:{fid}", note=handed.get(fid) or note)
                (gone if fid in handed else closed).append(fid)
        return {"seen": out_seen, "closed": closed, "handed": gone, "task_ids": moved}

    def record(self, findings, day: str, *, state_rules, event_rules, worsened_step: float, at: str | None = None,
               settle_minutes: float | None = None) -> dict:
        """Findings seen now, recorded — new, still open, back again (AGAIN_DAYS) — each with its task: {new,
        still_open, again, task_ids (the ids of the tasks opened or opened again), held (the findings maintenance mode
        kept from being taken up: maintenance.takes_up — nothing recorded, audited)}. Closes nothing: a check that reads only
        part of the villa (recheck.py, every 5 minutes) cannot say what it did not see is over.

        Each finding is recorded as SEEN at `at` (now when not said), with `settle_minutes` — the skill's settle time
        after a person's close (None: it named none, and a close then holds): the fact wants_open reads."""
        new, still_open, again, held = [], [], [], []
        for f in findings:
            # ⚠️ MAINTENANCE MODE (vesta_shared.maintenance.takes_up): a problem not open yet, below P1, is not taken
            # up — no finding, no fault, no message; audited below. Still there when the mode ends, the next check
            # finds it new
            if not self.store.open_finding(f.rule_id, f.entity_id) and not maintenance.takes_up(f.severity):
                held.append({"rule_id": f.rule_id, "entity_id": f.entity_id, "severity": f.severity})
                continue
            f.day = day
            f.detail["check"] = f.check
            prev_row = self.store.open_finding(f.rule_id, f.entity_id)
            prev = json.loads(prev_row["detail"] or "{}") if prev_row else {}
            if prev and f.rule_id in state_rules:
                f.detail["last_reported_pct"] = prev.get("last_reported_pct", prev.get("change_pct"))
            back = self._came_back(f, day, prev_row is None and f.rule_id in state_rules)
            if back is not None:
                fid, is_new = back, False
            else:
                fid, is_new = self.store.raise_finding(f.rule_id, f.entity_id, f.family, day, f.severity, f.summary, f.detail)
            self.store.finding_seen(fid, at or self.store.now(), settle_minutes)
            d = f.as_dict()
            d["id"] = fid
            if back is not None:
                d["again"] = len(occurrences(self.store.finding(fid))) - 1
                again.append(d)
            elif f.rule_id in event_rules:
                # ⚠️ AN EVENT WITH A FAULT STAYS OPEN A NIGHT (architecture review 30): closed the night it fired, its new
                # fault was resolved by the repair the same second — "Cleared: the check no longer sees it", the digest
                # "nothing new", the monthly page "Fixed". It closes when a night passes without it, or a person does.
                if f.severity not in TASK_SEVERITIES:
                    self.store.close_finding(f.rule_id, f.entity_id, day)    # no fault: closes the same night, as ever
                if is_new:                                                    # a rerun of the same night: told already
                    new.append(d)
                elif f.severity in TASK_SEVERITIES and prev_row and prev_row["opened_day"] != day:
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
        # each problem's task, as settle() works it out (architecture review, 2026-10-15): new or back — open (again);
        # still open with its task closed by the agent — open again (the same night run twice reopened the finding in
        # place and no pass looked: Timmerflotte_2623); never had one — a new one (villa, 2026-10-14). A person's close
        # keeps a still-true problem quiet: wants_open says so.
        ids, old_tasks, old_reopen = [], [], []
        for d in new + again + still_open:
            src = f"finding:{int(d['id'])}"
            had = self.store.last_task(src)
            for tid in self.settle(src):
                ids.append(tid)
                # kept for a skill edited before 0.12.267: its nightly.py / recheck.py read `tasks` (a NEW task, with its
                # words) and `reopen_actions` (a task opened again) — built from the ids; the engine reads both as
                # faults_changed
                if had and had["id"] == tid:
                    old_reopen.append(result.reopened(tid, self.source_title(src), (self.store.task(tid) or {}).get(
                        "reopen_note") or "Back again."))
                else:
                    old_tasks.append({"task_id": tid, "todo_summary": (self.store.task(tid) or {}).get("summary") or "",
                                      "check": d.get("check") or "", "severity": d["severity"], "entity_id": d["entity_id"]})
        if held:
            self.store.audit("preventive-maintenance", "suppressed_maintenance",
                             {"findings": held, "day": day})
        return {"new": new, "still_open": still_open, "again": again, "task_ids": ids, "held": held,
                "tasks": old_tasks, "reopen_actions": old_reopen}           # the last two: kept for a skill edited before 0.12.267

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
        since = (date.fromisoformat(day) - timedelta(days=again_days())).isoformat()
        last = self.store.last_closed_finding(f.rule_id, f.entity_id, since, day)
        if not last:
            return None
        runs = json.loads(last.get("occurrences") or "null") or [last["opened_day"]]
        # ⚠️ THE RUN BEFORE COUNTS WHEN IT ENDED IN THE WINDOW (architecture review 30): opened 20 days ago, closed
        # yesterday, back today — "(again: …)" was not said at all, the message read as a new problem
        seen = ([x for x in runs if x >= since] or [since]) + [day]
        self.store.reopen_finding(last["id"], f.severity, f.summary, f.detail, day, seen)
        return last["id"]

    def closed_in_kiosk(self, task_id: int, said=None, at: str | None = None, who: str | None = None) -> int | None:
        """A person closed the task's fault in the VESTA Kiosk: the task closes, and so does the incident
        it came from (the alert desk stops chasing it). Returns that incident's id, for its messages. `said`: who and
        when, as kiosk_words.closed writes it — the desk's check after it says it again (review 29: "Closed in the
        Kiosk, but …" had lost the person). `at`: when the Kiosk recorded the close (its resolvedAt) — the incident
        closes then, so the desk's watch counts from the person's close, not from when the agent read it (up to a
        Kiosk read later; owner 2026-10-23: the card says "VESTA confirms by …" counted from the close). `who`: the
        person (the alert's reply, message_format.done_in)."""
        task = self.store.task(task_id)
        self.close(task_id, CLOSED_IN_KIOSK)
        kind, sid = self._source(task)
        # a Done in the Kiosk on a fault whose Need help the owner was asked about: the alert standing for it closes too
        if kind != "incident" and (standing := self.help.standing(HelpLink.of_task(task_id))):
            kind, sid = "incident", standing
        if kind == "incident" and sid:
            inc = self.store.incident(sid)
            if inc and not inc.get("closed_at"):
                # ⚠️ A DONE IS A DONE, WHEREVER IT IS GIVEN (architecture review 24): closed in the Kiosk, a door fault
                # skipped the check a Done button gets — the door still unlocked, it stayed closed for good. The alert
                # desk reads it again once (quiet_after_done), when its rule names its states
                # `said` kept in every language it knows (kiosk_words.stored, in person_done): the desk's check after
                # it says it in each chat's (architecture review O); its watch from the person's close
                self.person_done(sid, mf.IN_COCKPIT, who=who, at=at, said=said)
                return sid
        return None

    def reopened_in_kiosk(self, task_id: int, by: str = "", said: str | None = None, at: str | None = None) -> int | None:
        """A person reopened a closed task's fault in the VESTA Kiosk (`at`: when the Kiosk recorded it): the task is
        open again, theirs until they close it (the night check's "gone" never closes it); its incident, if any, opens
        again and its facility manager is asked at once (the alert desk: payload "kiosk_reopened") — that reopening is
        told. Returns that incident's id; None when no desk tells it: the task stays an untold reopening
        (store.untold_reopenings) for a skill to tell — the preventive-maintenance recheck, every 5 minutes, under its
        own recipient and title (architecture review round 2, 2026-10-19: the engine sent it itself, to a role and
        under a title typed in vesta_agent/ — "Fault reopened in the Kiosk" over a body saying "the Cockpit").

        ⚠️ A PERSON'S REOPENING IS NEVER UNDONE (architecture review 25): the agent resolved it again within 5 minutes."""
        task = self.store.task(task_id)
        self.store.reopen_task(task_id, task.get("summary") or "", by=by or "a person", at=at)
        kind, sid = self._source(task)
        if kind == "incident" and sid:
            inc = self.store.incident(sid)
            if inc and inc.get("closed_at"):
                # kiosk_words.reopened: who and when, said once — mail to the alert desk (store.Notes), which names who
                # is asked (its chase.asks: a skill's setting, never the engine's)
                self.store.note(sid, {Notes.KIOSK_REOPENED: kiosk_words.stored(said) if said else by or "a person"},
                                drop=(alert_watch.CHECK,),
                                closed_at=None, reply=None, state=Incident.ASKED, asked_at=self.store.now())
                self.store.reopening_told(task_id)
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
        # still being chased, read and written under one lock (store.move): the desk's tick may be moving it too
        return sid if self.store.move(sid, Incident.CHASED, Incident.TAKEN, reply=said) else None

    def unreached(self, iid: int) -> None:
        """No chat of the facility manager's received incident `iid` (Telegram refused them all): the alert desk hands
        it to the owner at its next tick (payload "unreached")."""
        inc = self.store.incident(iid)
        if inc and not inc.get("closed_at"):
            self.store.note(iid, {Notes.UNREACHED: True})

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

    # ---------------------------------------------------------------- the one decision
    # ⚠️ ONE PLACE DECIDES WHETHER A PROBLEM HAS ITS FAULT (architecture review, 2026-10-15). About fourteen places in
    # five modules decided it — the night's ledger, the recheck, the desk, the repair — and three sweeps patched up
    # after them (close_outlived, restore_unseen, the night's backfill), each with its own rule: the backfill skipped a
    # finding that had ever had a task, the warning skipped only a person's close. Timmerflotte_2623 ended with its
    # finding OPEN and its task CLEARED by the agent, nobody could say by which: one way, reproduced — the recheck
    # cleared it, then the same night was run again, which reopens the day's row in place (store.raise_finding) where
    # no pass looks. Now every pass only records the facts (the source opened, closed, came back; a person's gesture)
    # and asks settle(), which works the task out from them.
    # ⚠️ A PERSON'S CLOSE HOLDS UNTIL THE SOURCE IS READ AGAIN, STILL BAD (owner, architecture review 2026-10-19): one
    # Close button, two rules — an alert closed in the Cockpit was read again after the desk's clear_minutes and
    # reopened ("…, but … still reads …: still open"), a night check's fault closed while the pump was still unavailable
    # stayed closed, nothing said, until the finding closed and came back. Now one rule: a finding read still bad
    # (record, seen: its `seen_at`) its skill's settle time or more after the close opens its task again, saying
    # STILL_THERE. An alert's reading stays the alert desk's (quiet_after_done reopens the incident, then this follows).
    def wants_open(self, source: str) -> bool:
        """Should the task about `source` ("finding:3", "incident:5") be open now? Open while its finding or incident
        lasts — a finding at a severity that earns a task — unless a person closed it since the problem's latest return
        (closed_by_person) and its source has not been read still bad since (a finding: still_there_after_close). A
        task a person REOPENED is theirs (in_persons_hands): settle closes it only on a person's Done."""
        kind, sid = self._source({"source": source})
        if kind == "finding":
            row = self.store.finding(sid)
            if not row or row["status"] != "open" or row["severity"] not in TASK_SEVERITIES:
                return False
            return not self.closed_by_person(source, row.get("reopened_at") or "") or self.still_there_after_close(source)
        if kind == "incident":
            inc = self.store.incident(sid)
            if not inc or self.source_gone({"source": source}):
                return False
            if inc.get("state") in (Incident.LOGGED, Incident.DIGEST):
                return False                     # not chased (its priority lowered while open): no task, no fault
            return not self.closed_by_person(source, inc.get("reopened_at") or "")
        return False

    @staticmethod
    def done_where(task: dict) -> str:
        """Where the person's close of `task` was given, as a line says it (message_format.DONE_IN): its close note's
        place ("Done on Telegram" — a Done on the alert standing for it), else the Cockpit's (a close in the Kiosk keeps
        no note). ⚠️ A TELEGRAM DONE WAS "CLOSED IN THE COCKPIT" (architecture review, 2026-10-30 evening): the facility
        manager read "Closed in the Cockpit on …, but still there" of a fault done on Telegram."""
        note = str(task.get("close_note") or "")
        return next((w for w in mf.DONE_IN.values() if note.startswith(w)), mf.DONE_IN[mf.IN_COCKPIT])

    def still_there_after_close(self, source: str) -> bool:
        """A person closed the latest task about finding `source`, and the finding was read still bad (its `seen_at`)
        its `settle_minutes` or more after that close. False when either is missing: a skill that names no settle time
        leaves a person's close as it is."""
        from datetime import timedelta
        kind, sid = self._source({"source": source})
        row = self.store.finding(sid) if kind == "finding" else None
        last = self.store.last_task(source)
        if not (row and last and last.get("status") in (DONE, CLOSED_IN_KIOSK)):
            return False
        seen, done, wait = _moment(row.get("seen_at")), _moment(last.get("done_at")), row.get("settle_minutes")
        try:
            return bool(seen and done and wait is not None and seen >= done + timedelta(minutes=float(wait)))
        except ValueError:
            return False

    def settle(self, source: str, note: str = "", who: str | None = None) -> list[int]:
        """The task about `source` made what wants_open says; returns the ids of the tasks that moved (opened, opened
        again, closed) — what each fault then says is card()'s, tickets.repair writes it. Over — closed (DONE when its
        incident was answered Done, by `who`; else CLEARED), its close saying `note`; still there and its last task
        closed by the agent, or by a person before the problem came back — open again ("Back again." unless `note`
        says otherwise); closed by a person and read still bad since (still_there_after_close) — open again, STILL_THERE;
        a finding still there that never had a task — a new one. An incident's first task is the desk's to open (only
        some alerts ask for one)."""
        kind, sid = self._source({"source": source})
        if kind not in ("finding", "incident"):
            return []                                    # no source of its own: it waits for a person
        last = self.store.last_task(source)
        if not self.wants_open(source):
            if not last or last["status"] != "open":
                return []
            inc = self.store.incident(sid) if kind == "incident" else None
            status = DONE if inc and inc.get("state") == Incident.DONE else CLEARED
            if status == CLEARED and self.in_persons_hands(last):
                return []                                # a person's reopening: only a person closes it (their Done does)
            self.close(last["id"], status, note, who if status == DONE else None)
            return [last["id"]]
        if last and last["status"] == "open":
            return []
        title = self.source_title(source)
        if last:
            # ⚠️ ONE OPENER (architecture review, 2026-10-19): this reopened the last task itself, the alert desk through
            # reopen_task — a third way (open_task, for a raised priority) made a second task and a second Kiosk fault
            why = STILL_THERE if kind == "finding" and self.still_there_after_close(source) else note or "Back again."
            tid, how = self.reopen_task(kind, sid, last["rule_id"], last["entity_id"], title,
                                        self.check_of(last), note=why)
            return [tid] if how == "reopened" else []
        if kind != "finding":
            return []
        row = self.store.finding(sid)
        check = json.loads(row.get("detail") or "{}").get("check") or ""
        return [self.store.add_task(row["rule_id"], row["entity_id"], title, source=source, check_text=check or None)]

    def settle_all(self, faults: set[str] | None = None) -> list[int]:
        """settle() for every open problem and every open task — the repair's one pass: the ids of the tasks that moved.
        `faults`: the fault ids the Kiosk still holds; a task brought back whose fault is gone loses its id, so the
        repair makes a new one."""
        sources = {f"finding:{int(f['id'])}" for f in self.store.findings(status="open")}
        sources |= {f"incident:{int(i['id'])}" for i in self.store.incidents(open_only=True)}
        sources |= {t["source"] for t in self.open_tasks() if t.get("source")}
        out = []
        for src in sorted(sources):
            ids = self.settle(src)
            for tid in ids:
                task = self.store.task(tid) or {}
                uid = task.get("todo_uid") if task.get("status") == "open" else None
                if uid and faults is not None and uid not in faults:
                    self.store.set_task_uid(tid, None)
            out += ids
        return out

    def source_title(self, source: str) -> str:
        """What is wrong, as the problem's source says it now ("(again: …)" included): its task's title when it opens."""
        return self.current_title({"source": source, "summary": ""})

    # ---------------------------------------------------------------- reading
    # ⚠️ THE CARD IS WORKED OUT, NOT PATCHED (architecture review, 2026-10-14). A change was sent to the Kiosk once; when
    # it failed (the Kiosk down a minute), the repair later guessed with what it had left — a Done pressed by Fabien became
    # "Closed by VESTA Agent — Closed: the problem is over.", and no repair in Recent work. Every fact a fault's card
    # shows is here, from the task and its problem, and tickets.repair makes the Kiosk say it.
    def card(self, task: dict, rechecked: frozenset[str] | set[str] = frozenset(),
             next_night: Callable[[datetime], datetime | None] | None = None) -> dict:
        """What task `task`'s Kiosk fault must say: {open, title (what is wrong now), number (its alert's "#N", or None),
        origin ("alert" | "night", or None), check (how it is read again to close it: "minutes" — an alert, at the desk's
        every look, or a finding of a rule in `rechecked` (the skills' `rechecks`; "*": every rule) — "nightly" — any
        other finding — or None),
        note and who (its close: what it says, the person who closed it — None: the agent's own clearing),
        reopen_note (what its reopening says — None: it was never reopened by its problem), confirms_by (until when its
        closed fault is watched — an ISO moment, or None: confirms_by; `next_night`: the night check's next run after a
        moment, the engine's schedule),
        todo (what to do on site, as its problem's source says it NOW: check_of — the fault's note follows it; "" when
        nothing says; not `check`, which is the recheck cadence), closes_at (when the alert desk closes it if what it
        reported stays over — an ISO moment, or None)}.

        ⚠️ A REOPENING SAYS WHY, LIKE A CLOSE (architecture review, 2026-10-18): the desk wrote "Still there after the close."
        on an action nothing read, and the Kiosk wrote its own "Back again" — a door never locked after a Done read as if
        it had come back (review 25 forbade exactly that). The words travel on the task, as the close's do."""
        kind, sid = self._source(task)
        title = self.current_title(task)
        # the alert standing for its Need help (owner, 2026-10-30): its number and its Telegram story on the card
        standing = self.help.standing(HelpLink.of_task(task["id"])) if kind != "incident" and task.get("id") else None
        # a duration in its words, worded by the Kiosk when it shows the card (architecture review, 2026-10-15): the
        # title with "{since}" where the night's words were, and the moment they count from (the rule's since_of)
        row = self.store.finding(sid) if kind == "finding" else None
        d = json.loads((row or {}).get("detail") or "{}") if row and row.get("status") == "open" else {}
        words = d.get("since_words")
        pattern = title.replace(words, "{since}", 1) if d.get("since") and words and words in title else None
        # when the desk closes it if it stays over (Notes.CLOSES_AT, owner 2026-10-21): the card's "closes at about"
        closes = notes_of(self.store.incident(sid)).get(Notes.CLOSES_AT) if kind == "incident" else None
        return {"open": task.get("status") == "open", "title": title, "closes_at": closes or None,
                "confirms_by": self.confirms_by(task, next_night),
                "pattern": pattern, "since": d.get("since") if pattern else None,
                "number": sid if kind == "incident" else standing,
                # its priority as the alert's title writes it after the number ("#5-P2", owner 2026-10-28): the Kiosk's
                # ticket is named the same; kept current, as a priority can change
                "priority": priority_of(self.store.incident(sid if kind == "incident" else standing))
                if kind == "incident" or standing else None,
                # where it came from, the Kiosk card's source icon (owner, 2026-10-14): an alert or the night check
                "origin": agreed("origins", {"incident": "alert", "finding": "night"}.get(kind or "", "")),
                # how it is read again, the card's "Next check" (owner, 2026-10-15)
                "check": agreed("checks", _check_word(kind, task.get("rule_id"), rechecked))
                if kind in ("incident", "finding") else None,
                "note": task.get("close_note") or "Closed: the problem is over.", "who": task.get("closed_who") or None,
                "reopen_note": task.get("reopen_note") or None,
                "todo": self.check_of(task)}

    # ⚠️ A PERSON'S CLOSE IS WATCHED, AND THE COCKPIT SAYS SO (owner, 2026-10-23: "keep the Fault card visible in the
    # Cockpit when a fault is still being monitored … until VESTA finally closes it"): a Done, or a Close in the Cockpit,
    # resolved the Kiosk fault at once while the alert desk still read it again after its wait (quiet_after_done).
    # ⚠️ EVERY CLOSE ALIKE (owner, 2026-10-25: "it shall consistently exist for all cleared faults … all potential
    # cases"): an alert the villa or the desk cleared, with "Watch 1h" on Telegram, left the Cockpit at once, and so did
    # a night-check fault. The same field and the same card say each close's watch.
    def confirms_by(self, task: dict, next_night: Callable[[datetime], datetime | None] | None = None,
                    now: datetime | None = None) -> str | None:
        """Until when the closed fault of `task` is watched — back within it, it reopens as the same problem: the Kiosk
        fault's `confirmsBy`. An alert's: its close plus its watch (alert_watch.until), and while the desk's
        read-again after a person's close (`check_quiet`) waits, until it is
        read. A night-check finding's: the night check's next run after its close (`next_night`), the read that would
        see it back (owner, 2026-10-25). None for a task open, an older task of the same problem, a close nothing
        watches (no watch carried, no night schedule), or a watch over."""
        from datetime import timezone
        kind, sid = self._source(task)
        if task.get("status") not in STATUSES:
            return None
        last = self.store.last_task(str(task.get("source")))
        if not (last and last["id"] == task.get("id")):
            return None
        now = now or datetime.now(timezone.utc)
        pending = False
        if kind == "incident":
            inc = self.store.incident(sid)
            until = alert_watch.until(inc)
            if until is None:
                return None
            pending = alert_watch.awaiting_read(inc)
        elif kind == "finding":
            closed = _moment(task.get("done_at"))
            until = next_night(closed) if closed and next_night else None
            if until is None:
                return None
        else:
            return None
        return until.isoformat() if now < until or pending else None

    def unseen(self) -> list[dict]:
        """Open findings that should be a fault and are not — wants_open with no open task. settle_all leaves none;
        tickets.repair says when any is found (villa, 2026-10-14: a sensor open for five days, never in the Cockpit,
        and nothing said so)."""
        out = []
        for f in self.store.findings(status="open"):
            src = f"finding:{int(f['id'])}"
            last = self.store.last_task(src)
            if self.wants_open(src) and not (last and last["status"] == "open"):
                out.append(f)
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
                return problem_name(row["summary"], len(occurrences(row)) - 1)["headline"]
        if kind == "incident":
            # ⚠️ AN ALERT SAYS WHAT HOME ASSISTANT SAYS NOW (architecture review, 2026-10-14): Home Assistant re-worded an
            # open alert (desk RESTATED), Telegram showed the new words, the card kept the first ones
            inc = self.store.incident(sid)
            message = notes_of(inc).get(Notes.MESSAGE) if inc and not inc.get("closed_at") else None
            if message:
                return problem_name(str(message), incident_runs(inc, self.store) - 1)["headline"]
        # a task with no source, or its problem over: its own words, named when it was written (never cut again)
        return headline(self.title_of(task))

    def check_of(self, task: dict) -> str:
        """What to do on site, as the problem's SOURCE says it now ("" when nothing says): an alert's route check, carried
        on its incident by the alert desk (store.Notes.CHECK, the words in its rules.yaml); a finding's `check` in its
        detail, which the night check rewrites; the task's own `check_text` only for a record from before either
        (0.6.254 and earlier), or a task with no source.

        ⚠️ ONE OWNER OF "WHAT TO DO" (architecture review, 2026-10-19): the task froze the check at its opening — the
        Kiosk fault's note and the digest kept the first words while Telegram read the route live, and a finding's
        check rewritten by the night (a pump's draw lower, then higher) never reached its card."""
        kind, sid = self._source(task)
        said = None
        if kind == "incident":
            inc = self.store.incident(sid)
            said = notes_of(inc).get(Notes.CHECK) if inc else None
        elif kind == "finding":
            row = self.store.finding(sid)
            said = json.loads(row.get("detail") or "{}").get("check") if row else None
        return str(said) if said is not None else (task.get("check_text") or "")

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
            named = problem_name(f["summary"], back)
            out.append({"id": f"finding-{f['id']}", "source": f"finding:{f['id']}", "rule_id": f["rule_id"],
                        "entity_id": f["entity_id"], "severity": f["severity"],
                        "title": named["headline"], "detail": named["detail"], "again": back,
                        "check": d.get("check") or "", "since": since, "incident": None,
                        "figures": {k: v for k, v in d.items() if isinstance(v, (int, float, str)) and k != "check"}})
        for i in self.store.incidents(open_only=True):
            p = notes_of(i)
            src = f"incident:{i['id']}"
            named = problem_name(p.get("message") or i["rule_id"], incident_runs(i, self.store) - 1)
            out.append({"id": f"incident-{i['id']}", "source": src, "rule_id": i["rule_id"],
                        "entity_id": i["entity_id"], "severity": i["severity"],
                        # its latest run is when it opened, how often it came back is in its title (review 24: a
                        # reopened alert stayed "still open since the 1st", never new, never "again")
                        "title": named["headline"], "detail": named["detail"],
                        # what to do, as the Kiosk fault's note says it (check_of): the digest's "Still open" line read a
                        # key the desk never wrote, so an alert's line had no check where a finding's had one
                        "check": self.check_of(self.store.last_task(src) or {"source": src}),
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


def _check_word(kind, rule_id, rechecked) -> str:
    """The soonest reading of a fault's problem, as the agreement's `ticket.checks` names it: "minutes" (an alert, or a
    rule read every few minutes — "*" in `rechecked`: every rule, owner 2026-10-20), else "nightly"."""
    if kind == "incident" or rule_id in rechecked or "*" in rechecked:
        return "minutes"
    return "nightly"


def _moment(iso):
    """A stored moment ("…+00:00", or the Kiosk's "…Z") as an aware datetime; None when it cannot be read."""
    from datetime import datetime, timezone
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00")) if iso else None
    except ValueError:
        return None
    return t.replace(tzinfo=timezone.utc) if t and t.tzinfo is None else t
