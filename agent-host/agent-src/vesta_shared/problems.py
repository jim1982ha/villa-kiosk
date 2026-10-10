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
STATUSES = (DONE, CLEARED, CLOSED_IN_KIOSK)

_ORDER = {"P1": 0, "P2": 1, "P3": 2, "P4": 3}




def worsened(change_pct: float | None, last_reported_pct: float | None, step: float) -> bool:
    """A still-open finding earns a digest line again when it moved `step` points further from normal
    than when it was last reported."""
    return change_pct is not None and abs(change_pct) - abs(last_reported_pct or 0) >= step


def closes_tonight(open_rows: list[dict], fired: set[tuple[str, str]], state_rules) -> list[dict]:
    """The open findings that close tonight: a STATE rule (a condition that holds or not) that did not fire
    for its entity. An event rule closes the night it fires, never here."""
    return [o for o in open_rows if o["rule_id"] in state_rules and (o["rule_id"], o["entity_id"]) not in fired]


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

    # ---------------------------------------------------------------- closing
    def close(self, task_id: int, status: str) -> None:
        if status not in STATUSES:
            raise ValueError(f"a task closes as one of {', '.join(STATUSES)}, not {status!r}")
        self.store.close_task(task_id, status)

    def clear_source(self, source: str, source_id: int, rule_id: str = "", entity_id: str = "",
                     status: str = CLEARED) -> list[int]:
        """Its finding or incident is over: the open task(s) about it close. Returns their ids (their
        tickets are to be resolved)."""
        closed = []
        for t in self.store.tasks("open"):
            if t.get("source") == f"{source}:{int(source_id)}":
                self.close(t["id"], status)
                closed.append(t["id"])
        return closed

    # ⚠️ CLOSING A SOURCE CLOSES WHAT IT OWES (architecture review 6, 2026-10-07). The alert desk and the night check
    # each closed an incident or a finding, then had to remember to clear its task and resolve its Kiosk fault —
    # and to agree with source_gone() on which states end a Problem. The state decides here, once; the callers get
    # back the fault actions to carry out.
    def close_incident(self, iid: int, state: str, now_iso: str, note: str = "", **fields) -> list[dict]:
        """The incident ends in `state` (closed now). When that state ends its Problem (Incident.ANSWERED_OR_CLEARED)
        its open task closes too — done by a person, or cleared — and its Kiosk fault is to be resolved with `note`."""
        self.store.update_incident(iid, state=state, closed_at=now_iso, **fields)
        if state not in Incident.ANSWERED_OR_CLEARED:
            return []
        status = DONE if state == Incident.DONE else CLEARED
        return [result.resolved(tid, note) for tid in self.clear_source("incident", iid, status=status)]

    def close_finding(self, finding: dict, day: str, note: str = "") -> list[dict]:
        """The night check no longer sees a finding: it closes, its task is cleared, its Kiosk fault resolved."""
        self.store.close_finding(finding["rule_id"], finding["entity_id"], day)
        return [result.resolved(tid, note) for tid in self.clear_source("finding", finding["id"])]

    # ⚠️ THE NIGHT'S LEDGER, HERE (architecture review 7, 2026-10-07): nightly.py kept it inline — raised,
    # an event closed the same night, a rerun not news twice, worsened, closed tonight, its task opened. Which
    # rules are states and which are events, the worsened step and which severities get a task stay the skill's.
    def record_night(self, findings, day: str, *, state_rules, event_rules, worsened_step: float,
                     task_severities=("P2", "P3"), resolved_note: str = "") -> dict:
        """The night check's findings for `day`: {new, still_open, closed, tasks, resolve_actions}.
        A finding has rule_id, entity_id, family, severity, summary, detail, check, day and as_dict()."""
        new, still_open, closed, fired = [], [], [], set()
        for f in findings:
            f.day = day
            f.detail["check"] = f.check
            fired.add((f.rule_id, f.entity_id))
            prev_row = self.store.open_finding(f.rule_id, f.entity_id)
            prev = json.loads(prev_row["detail"] or "{}") if prev_row else {}
            if prev and f.rule_id in state_rules:
                f.detail["last_reported_pct"] = prev.get("last_reported_pct", prev.get("change_pct"))
            fid, is_new = self.store.raise_finding(f.rule_id, f.entity_id, f.family, day, f.severity, f.summary, f.detail)
            d = f.as_dict()
            d["id"] = fid
            if f.rule_id in event_rules:
                self.store.close_finding(f.rule_id, f.entity_id, day)        # events close the same night
                if is_new:                                                    # a rerun of the same night: told already
                    new.append(d)
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
        for o in closes_tonight(self.store.findings(status="open"), fired, state_rules):
            closed.append(o)
            # ⚠️ ITS TASK AND ITS KIOSK TICKET CLOSE WITH IT (villa, 2026-10-01): the finding closed, the ticket
            # stayed "Open fault" for ever, and the Kiosk's Cockpit filled with faults long gone
            resolve += self.close_finding(o, day, resolved_note)
        tasks = []
        for d in new:
            if d["severity"] in task_severities:
                tid, created = self.open_task("finding", d["id"], d["rule_id"], d["entity_id"], d["summary"],
                                              d.get("check") or "")
                if created:
                    tasks.append({"task_id": tid, "todo_summary": d["summary"][:250], "check": d.get("check") or "",
                                  "severity": d["severity"], "entity_id": d["entity_id"]})
        return {"new": new, "still_open": still_open, "closed": closed, "tasks": tasks,
                "resolve_actions": resolve}

    def closed_in_kiosk(self, task_id: int) -> int | None:
        """A person closed the task's fault in the VESTA Kiosk: the task closes, and so does the incident
        it came from (the alert desk stops chasing it). Returns that incident's id, for its messages."""
        task = self.store.task(task_id)
        self.close(task_id, CLOSED_IN_KIOSK)
        kind, sid = self._source(task)
        if kind == "incident" and sid:
            inc = self.store.incident(sid)
            if inc and not inc.get("closed_at"):
                self.store.update_incident(sid, state=Incident.DONE, reply="Closed in the VESTA Kiosk",
                                           closed_at=self.store.now())
                return sid
        return None

    def source_gone(self, task: dict) -> bool:
        """True when the finding or incident a task is about is closed — the task outlived it."""
        kind, sid = self._source(task)
        if kind == "finding":
            row = self.store.finding(sid)
            return bool(row) and row["status"] != "open"
        if kind == "incident":
            # over when it was answered or cleared — not when its rule stopped watching it
            inc = self.store.incident(sid)
            return bool(inc) and bool(inc.get("closed_at")) and inc.get("state") in Incident.ANSWERED_OR_CLEARED
        return False                                     # no source of its own: it waits for a person

    # ---------------------------------------------------------------- reading
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
                return row["summary"]
        return self.title_of(task)

    def check_of(self, task: dict) -> str:
        """What to check on site ("" when the task does not say)."""
        return task.get("check_text") or ""

    def open_problems(self) -> list[dict]:
        """THE answer to "what is still open", for every reader (the weekly list, the daily digest, the
        owner's lines, the concierge): the open findings and incidents, less a finding whose task a
        person has closed (done, or closed in the Kiosk) while its condition lasts. Most severe first."""
        handled = {t["source"] for t in self.store.tasks(None)
                   if t.get("source") and t["status"] in (DONE, CLOSED_IN_KIOSK)}
        out = []
        for f in self.store.findings(status="open"):
            if f["severity"] not in _ORDER or f"finding:{f['id']}" in handled:
                continue
            d = json.loads(f.get("detail") or "{}")
            out.append({"id": f"finding-{f['id']}", "source": f"finding:{f['id']}", "rule_id": f["rule_id"],
                        "entity_id": f["entity_id"], "severity": f["severity"], "title": _no_code(f["summary"]),
                        "check": d.get("check") or "", "since": f["opened_day"], "incident": None,
                        "figures": {k: v for k, v in d.items() if isinstance(v, (int, float, str)) and k != "check"}})
        for i in self.store.incidents(open_only=True):
            p = json.loads(i.get("payload") or "{}")
            out.append({"id": f"incident-{i['id']}", "source": f"incident:{i['id']}", "rule_id": i["rule_id"],
                        "entity_id": i["entity_id"], "severity": i["severity"],
                        "title": _no_code(p.get("message") or i["rule_id"]), "check": p.get("check") or "",
                        "since": i["opened_at"][:10], "incident": i["id"],
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
