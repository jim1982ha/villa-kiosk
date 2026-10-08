"""What the agent itself did, read from its own records. Read-only.

Shared by the `agent_status` tool (a person asks "what did you do last night?")
and the UI's overview: one reading of the records, two places to show it.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from vesta_shared.agent_records import run_cost   # what a run cost: one reading, shared with the skills
from vesta_shared import agent_records
from .api_errors import why_job_sentence

# agent_status: the records worth telling a person about, and the fields of each (never a chat id or a token)
STATUS_KINDS = ("critical_event", "ladder", "executed", "requested", "approved", "refused_by_person", "failed",
                "action_failed", "send_failed", "script_failed", "code_script_failed", "script_refused", "pack",
                "ticket_skipped")    # code_script_failed: a failed script before 0.6.60 (records kept settings.keep days)
STATUS_FIELDS = ("rule", "phase", "handled", "incident", "by", "reply", "tool", "ticket", "entity", "service",
                 "skill", "script", "reason", "error", "code", "entities")


# ⚠️ THE FIGURES ARE ADDED UP HERE, never by the page (architecture review 8): the Overview summed four failure kinds
# itself and missed action_failed — a failed action on the villa counted nowhere. A refusal (script_refused) is the
# agent's guard working, not a failure.
FAILURE_KINDS = ("failed", "action_failed", "send_failed", "script_failed", "code_script_failed")
ACTION_KINDS = ("executed", "direct")


def figures(counts: dict[str, int], cost: float) -> list[list]:
    """The period's figures, [label, value] in the order the Overview shows them."""
    n = lambda *kinds: sum(counts.get(k, 0) for k in kinds)  # noqa: E731
    return [["alerts followed", n("critical_event")], ["buttons pressed", n("ladder")],
            ["actions done", n(*ACTION_KINDS)], ["replies written", n(agent_records.RUN)],
            ["AI cost (USD)", f"{cost:.2f}"], ["failures", n(*FAILURE_KINDS)]]


def report(state, store_path: str, hours: int = 24, now: datetime | None = None, label=None) -> dict:
    """What the agent itself did: its scheduled jobs, the alerts it followed, the buttons pressed, the
    actions asked and done, the failures. Read from its own records only; it changes nothing."""
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(hours=hours)
    jobs = []
    for job, slot in state.jobs_run():
        try:
            if datetime.fromisoformat(slot) >= since:
                # `label`: what a person reads for the slot key (scheduler.job_label) — the time is `ran_at`'s
                jobs.append({"job": job, "label": label(job) if label else job, "ran_at": slot})
        except ValueError:
            continue
    counts: dict[str, int] = {}
    cost = 0.0
    events = []
    for c in state.calls_since(since.isoformat()):
        counts[c["kind"]] = counts.get(c["kind"], 0) + 1
        d = agent_records.detail(c)
        if c["kind"] == agent_records.RUN:
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
            "counts": counts, "figures": figures(counts, cost), "ai_cost_usd": round(cost, 3), "events": events[-60:],
            "incidents": incidents[-40:]}


def _error_words(problem: str | None) -> str:
    from .api_errors import FOR_PERSON
    return FOR_PERSON.get(problem or "unknown", FOR_PERSON["unknown"])


def costs(state, days: int = 30, now: datetime | None = None, zone=None, chat_label=None) -> dict:
    """What the AI cost, run by run, from the agent's own records (the cost the Anthropic API reported for each
    run): the VESTA Agent page's Costs tab. Each run: when, the work (a chat reply, or an AI job), who asked
    and what, the brain and model, the tokens, the cost. Read-only; never a chat id (`chat_label` names the chat)."""
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    local = (lambda t: t.astimezone(zone)) if zone else (lambda t: t)
    runs, made = [], []
    for c in state.calls_since(since.isoformat()):
        if c["kind"] not in agent_records.COSTS_KINDS:
            continue
        d = agent_records.detail(c)
        if c["kind"] == agent_records.WITHOUT_AI:
            # a job made by its code steps when the AI could not run (ai_jobs.AiJobs.run_without_ai): shown among the runs,
            # at no cost, and not counted as an AI run
            made.append({"at": c["at"], "kind": "job", "work": str(d.get("job") or "?"), "person": None, "chat": None,
                         "asked": None, "profile": None, "model": None, "tokens_in": None, "tokens_out": None,
                         "cache_read": None, "cache_write": None, "cost": 0.0, "stopped": False, "error": None,
                         "error_words": None, "turns": None, "seconds": None, "steps": [],
                         "without_ai": {"why": why_job_sentence(d.get("problem") or "unknown"), "sent": int(d.get("sent") or 0),
                                        "failed": d.get("failed")}})
            continue
        who = str(d.get("who") or "")
        if agent_records.job_of(who) is not None:
            kind, work, person, chat = "job", agent_records.job_of(who), None, None
        else:
            name, cid = agent_records.person_of(who)
            kind, work, person = "chat", "Chat replies", name or None
            chat = chat_label(cid) if chat_label and cid.lstrip("-").isdigit() else None
        tok = d.get("tokens") or {}
        cost = run_cost(d)
        runs.append({"at": c["at"], "kind": kind, "work": work, "person": person, "chat": chat, "asked": d.get("asked"),
                     "profile": d.get("profile"), "model": d.get("model"),
                     "tokens_in": tok.get("input_tokens"), "tokens_out": tok.get("output_tokens"),
                     "cache_read": tok.get("cache_read_input_tokens"), "cache_write": tok.get("cache_creation_input_tokens"),
                     "cost": round(cost, 4), "stopped": bool(d.get("stopped_at_limit")), "error": d.get("error"),
                     # the reason in plain words (api_errors.FOR_PERSON), for the error's (!) on the Costs tab
                     "error_words": _error_words(d.get("problem")) if d.get("error") else None,
                     "turns": d.get("turns"), "seconds": round(d["ms"] / 1000) if isinstance(d.get("ms"), (int, float)) else None,
                     "steps": [x for x in d.get("steps") or [] if isinstance(x, dict)]})
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
            # the daily chart's Y axis, from the one axis rule (vesta_shared.axis): the page only draws it
            "axis": _cost_axis(max([by_day.get(d, 0.0) for d in days_list] + [0.01])),
            "by_work": group("work"), "by_model": group("model"),
            "runs": sorted(runs + made, key=lambda r: r["at"], reverse=True)[:300],
            # the Costs tab's "Tools in this period": each tool, how many runs used it and how many times
            "tools": _tool_counts(runs)}


def _tool_counts(runs: list[dict]) -> list[dict]:
    out: dict[str, dict] = {}
    for r in runs:
        for t in {x.get("tool") for x in r["steps"]}:
            out.setdefault(t, {"tool": t, "runs": 0, "calls": 0})["runs"] += 1
        for x in r["steps"]:
            out[x.get("tool")]["calls"] += 1
    return sorted(out.values(), key=lambda g: (-g["calls"], g["tool"] or ""))


def tool_usage(state, days: int = 7, now: datetime | None = None) -> dict[str, int]:
    """How many times each tool was called in the last `days` (Rules › AI tools: "used 12× this week")."""
    since = (now or datetime.now(timezone.utc)) - timedelta(days=days)
    out: dict[str, int] = {}
    for c in state.calls_since(since.isoformat()):
        if c["kind"] != agent_records.RUN:
            continue
        for x in agent_records.detail(c).get("steps") or []:
            if isinstance(x, dict) and x.get("tool"):
                out[x["tool"]] = out.get(x["tool"], 0) + 1
    return out


def _cost_axis(top: float) -> dict:
    """The Costs chart's axis, 0 to a round value at or over `top`, labelled in US$ (vesta_shared.axis)."""
    from vesta_shared.axis import nice_axis
    a = nice_axis(0.0, top)
    return {"top": a["last"], "ticks": a["ticks"], "labels": ["$" + t for t in a["labels"]]}
