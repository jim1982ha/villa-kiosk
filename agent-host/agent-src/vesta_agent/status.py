"""What the agent itself did, read from its own records. Read-only.

Shared by the `agent_status` tool (a person asks "what did you do last night?")
and the UI's overview: one reading of the records, two places to show it.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

from vesta_shared.agent_records import run_cost   # what a run cost: one reading, shared with the skills

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
    for job, slot in state.jobs_run():
        try:
            if datetime.fromisoformat(slot) >= since:
                jobs.append({"job": job, "ran_at": slot})
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
        if c["kind"] == "run":
            cost += run_cost(d)
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


def costs(state, days: int = 30, now: datetime | None = None, zone=None, chat_label=None,
          job_names: dict[str, str] | None = None) -> dict:
    """What the AI cost, run by run, from the agent's own records (the cost the Anthropic API reported for each
    run): the VESTA Agent page's Costs tab. Each run: when, the work (a chat reply, or an AI job), who asked
    and what, the brain and model, the tokens, the cost. Read-only; never a chat id (`chat_label` names the chat)."""
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    local = (lambda t: t.astimezone(zone)) if zone else (lambda t: t)
    runs = []
    for c in state.calls_since(since.isoformat()):
        if c["kind"] != "run":
            continue
        try:
            d = json.loads(c["detail"] or "{}")
        except ValueError:
            d = {}
        who = str(d.get("who") or "")
        if who.startswith("job:"):
            # ⚠️ A RUN BEFORE 0.12.0 IS "skill:when" (jobs had no names then: "reports:07:00" is today's
            # fm-daily). `job_names` maps it to the job's name, so one job is one line (owner, 2026-10-05).
            kind, work, person, chat = "job", who[4:], None, None
            work = (job_names or {}).get(work, work)
        else:
            name, _, cid = who.partition("@")
            kind, work, person = "chat", "Chat replies", name or None
            chat = chat_label(cid) if chat_label and cid.lstrip("-").isdigit() else None
        tok = d.get("tokens") or {}
        cost = run_cost(d)
        runs.append({"at": c["at"], "kind": kind, "work": work, "person": person, "chat": chat, "asked": d.get("asked"),
                     "profile": d.get("profile"), "model": d.get("model"),
                     "tokens_in": tok.get("input_tokens"), "tokens_out": tok.get("output_tokens"),
                     "cache_read": tok.get("cache_read_input_tokens"), "cache_write": tok.get("cache_creation_input_tokens"),
                     "cost": round(cost, 4), "stopped": bool(d.get("stopped_at_limit")), "error": d.get("error"),
                     "turns": d.get("turns"), "seconds": round(d["ms"] / 1000) if isinstance(d.get("ms"), (int, float)) else None})
    runs.sort(key=lambda r: r["at"], reverse=True)

    def total(rs):
        return round(sum(r["cost"] for r in rs), 2)

    def group(key):
        out: dict[str, dict] = {}
        for r in runs:
            k = r[key] or "not recorded"
            g = out.setdefault(k, {"name": k, "runs": 0, "cost": 0.0, "tokens_in": 0, "tokens_out": 0})
            g["runs"] += 1
            g["cost"] += r["cost"]
            g["tokens_in"] += (r["tokens_in"] or 0) + (r["cache_read"] or 0) + (r["cache_write"] or 0)
            g["tokens_out"] += r["tokens_out"] or 0
        return sorted(({**g, "cost": round(g["cost"], 2)} for g in out.values()), key=lambda g: -g["cost"])

    today = local(now).date()
    by_day: dict[str, float] = {}
    for r in runs:
        day = local(datetime.fromisoformat(r["at"])).date().isoformat()
        by_day[day] = by_day.get(day, 0.0) + r["cost"]
    days_list = [(today - timedelta(days=k)).isoformat() for k in range(days - 1, -1, -1)]
    in_last = lambda n: [r for r in runs if local(datetime.fromisoformat(r["at"])).date() > today - timedelta(days=n)]  # noqa: E731
    month = [r for r in runs if local(datetime.fromisoformat(r["at"])).date().replace(day=1) == today.replace(day=1)]
    return {"days": days, "today": total(in_last(1)), "last_7_days": total(in_last(7)), "this_month": total(month),
            "period": total(runs), "runs_count": len(runs),
            "by_day": [{"day": d, "cost": round(by_day.get(d, 0.0), 2)} for d in days_list],
            "by_work": group("work"), "by_model": group("model"), "runs": runs[:300]}

