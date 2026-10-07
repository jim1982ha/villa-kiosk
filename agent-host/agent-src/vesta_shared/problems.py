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

from .messaging import no_code as _no_code
from .store import Store, Incident

DONE = "done"                          # a person answered Done (a button, or "#N done")
CLEARED = "cleared"                    # its source is gone: the night check no longer sees it, HA cleared it
CLOSED_IN_KIOSK = "closed_in_kiosk"    # a person closed the fault in the VESTA Kiosk
STATUSES = (DONE, CLEARED, CLOSED_IN_KIOSK)

_ORDER = {"P1": 0, "P2": 1, "P3": 2, "P4": 3}


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
            # over when it was answered or cleared — not when it was muted (the fault is still there,
            # nobody wants to be told again) nor when its rule stopped watching it
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

    # ---------------------------------------------------------------- inside
    @staticmethod
    def _source(task: dict | None) -> tuple[str | None, int | None]:
        src = (task or {}).get("source") or ""
        kind, _, sid = src.partition(":")
        return (kind, int(sid)) if sid.isdigit() else (None, None)
