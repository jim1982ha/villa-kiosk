"""What the agent itself did, read from its own records. Read-only.

Shared by the `agent_status` tool (a person asks "what did you do last night?")
and the UI's overview: one reading of the records, two places to show it.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

# agent_status: the records worth telling a person about, and the fields of each (never a chat id or a token)
STATUS_KINDS = ("critical_event", "ladder", "executed", "requested", "approved", "refused_by_person", "failed",
                "action_failed", "send_failed", "code_script_failed", "script_refused", "pack", "ticket_skipped")
STATUS_FIELDS = ("rule", "phase", "handled", "incident", "by", "reply", "tool", "ticket", "entity", "service",
                 "skill", "script", "reason", "error", "code", "entities")


def report(state, store_path: str, hours: int = 24, now: datetime | None = None) -> dict:
    """What the agent itself did: its scheduled jobs, the alerts it followed, the buttons pressed, the
    actions asked and done, the failures. Read from its own records only; it changes nothing."""
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(hours=hours)
    jobs = []
    for k, slot in sorted(state.kv_prefix("job:").items(), key=lambda kv: kv[1]):
        try:
            if datetime.fromisoformat(slot) >= since:
                jobs.append({"job": k[4:], "ran_at": slot})
        except ValueError:
            continue
    counts: dict[str, int] = {}
    cost = 0.0
    events = []
    for c in state.calls_since(since.isoformat()):
        counts[c["kind"]] = counts.get(c["kind"], 0) + 1
        try:
            d = json.loads(c["detail"] or "{}")
        except ValueError:
            d = {}
        if c["kind"] == "run" and isinstance(d.get("cost_usd"), (int, float)):
            cost += d["cost_usd"]
        if c["kind"] in STATUS_KINDS:
            events.append({"at": c["at"], "what": c["kind"], **{k: v for k, v in d.items() if k in STATUS_FIELDS}})
    incidents = []
    if os.path.exists(store_path):
        try:
            from vesta_shared.store import Store
            st = Store(store_path)
            for i in st.incidents(open_only=False):
                if (i.get("opened_at") or "") >= since.isoformat() or not i.get("closed_at"):
                    incidents.append({k: i.get(k) for k in ("id", "rule_id", "entity_id", "opened_at", "state",
                                                             "reply", "assignee", "closed_at")})
        except Exception as e:  # noqa: BLE001 — a status answer never fails on the store
            incidents.append({"error": type(e).__name__})
    return {"since": since.isoformat(), "until": now.isoformat(), "scheduled_jobs": jobs,
            "counts": counts, "ai_cost_usd": round(cost, 3), "events": events[-60:],
            "incidents": incidents[-40:]}
