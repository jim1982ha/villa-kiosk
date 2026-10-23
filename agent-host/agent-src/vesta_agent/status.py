"""What the agent itself did, read from its own records. Read-only.

Shared by the `agent_status` tool (a person asks "what did you do last night?")
and the UI's overview: one reading of the records, two places to show it.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

from vesta_shared.agent_records import run_cost   # what a run cost: one reading, shared with the skills
from vesta_shared import agent_records
from vesta_shared.limits import limit
from .api_errors import cause, what_to_do, why_job_sentence
from .in_progress import CUT, ENDED, FAILED, run_ends

# agent_status: the records worth telling a person about, and the fields of each (never a chat id or a token)
STATUS_KINDS = ("critical_event", "ladder", "executed", "requested", "approved", "refused_by_person", "failed",
                "action_failed", "send_failed", "script_failed", "code_script_failed", "script_refused", "pack",
                "ticket_skipped", agent_records.JOB_NO_RESULT)
#                                   code_script_failed: a failed script before 0.6.60 (records kept settings.keep days)
STATUS_FIELDS = ("rule", "phase", "handled", "incident", "by", "reply", "tool", "ticket", "entity", "service",
                 "skill", "script", "reason", "error", "code", "entities", "job", "why")


# ⚠️ THE FIGURES ARE ADDED UP HERE, never by the page (architecture review 8): the Overview summed four failure kinds
# itself and missed action_failed — a failed action on the villa counted nowhere. A refusal (script_refused) is the
# agent's guard working, not a failure.
FAILURE_KINDS = ("failed", "action_failed", "send_failed", "script_failed", "code_script_failed", agent_records.JOB_NO_RESULT)
ACTION_KINDS = ("executed", "direct")

#: The Overview's scheduled jobs (The last 24 hours): how a run ended, in the agent's words (in_progress.py's
#: outcomes); RUNNING is a run claimed and still recorded as running; None an older row that has only the claim
RUNNING = "running"
OUTCOME_WORDS = {ENDED: "done", FAILED: "not prepared", CUT: "stopped by a restart", RUNNING: "running", None: "run"}


def unreachable(state, policy) -> list[str]:
    """Each chat of the People list that Telegram refused the agent's last message to, in words: who, what Telegram
    said, what to do. A chat no longer in People is not named (its row is gone at its next message anyway)."""
    out = []
    for chat, rec in sorted(state.unreachable().items()):
        names = [e.name for e in policy.entries if e.telegram_id == chat]
        if not names:
            continue
        fix = ("they must open a private chat with the bot and send it /start once" if chat > 0 else
               "add the bot to the group again, or put the group's new id in People (/whoami in the group shows it)")
        out.append(f"{' / '.join(dict.fromkeys(names))}: Telegram refused the last message ({rec.get('error')}). "
                   f"To fix: {fix}.")
    return out


def figures(records, cost: float | None = None) -> list[list]:
    """The period's figures from its records (rows with "kind" and "detail"), [label, value] in the order the page
    shows them. `cost` None leaves out the AI cost: the Costs tab, whose own figures already say it (owner, 2026-10-22:
    these counters moved from Overview's fixed 24 hours to the Costs tab, over the period chosen there).

    ⚠️ EACH FIGURE MEANS WHAT ITS LABEL SAYS (architecture review scan 4, 2026-10-19): "replies written" counted every
    run row — the AI jobs and the runs that failed included — while "failures" counted only the failure kinds, so a
    morning of refused calls read "6 replies written, 0 failures". Now a run is read as costs() reads it: its `who`
    (agent_records.job_of) says reply or report, its `problem` says failure; a report made without the AI is a report
    made; a job whose AI sent nothing (JOB_NO_RESULT) a failure."""
    counts: dict[str, int] = {}
    replies = reports = failures = 0
    for c in records:
        kind = c["kind"]
        counts[kind] = counts.get(kind, 0) + 1
        if kind == agent_records.RUN:
            d = agent_records.detail(c)
            if d.get("problem"):
                failures += 1
            elif agent_records.job_of(str(d.get("who") or "")) is not None:
                reports += 1
            else:
                replies += 1
        elif kind == agent_records.WITHOUT_AI:
            d = agent_records.detail(c)
            reports += 1 if int(d.get("sent") or 0) > 0 and not d.get("failed") else 0
        elif kind in FAILURE_KINDS:
            failures += 1
    n = lambda *kinds: sum(counts.get(k, 0) for k in kinds)  # noqa: E731
    # capitalised as the Costs tab's own figures, on whose line they sit (owner, 2026-10-22)
    return [["Alerts followed", n("critical_event")], ["Buttons pressed", n("ladder")],
            ["Actions done", n(*ACTION_KINDS)], ["Replies written", replies], ["Reports made", reports],
            *([["AI cost (USD)", f"{cost:.2f}"]] if cost is not None else []), ["Failures", failures]]


def jobs_run(state, since: datetime, label=None) -> list[dict]:
    """The Overview's scheduled jobs (The last 24 hours): each scheduled job claimed since `since`, with how its run
    ended — from the end row in_progress.kept writes (outcome, when, why), RUNNING while its run is still recorded, and the claim
    alone (`job:`, written before the run) for a row an older engine left. `words` is what the page draws."""
    ends, running = run_ends(state), state.runs_kept()
    out = []
    for job, slot in state.jobs_run():
        end = ends.get(job)
        if end and end.get("slot") == slot:
            outcome, at, why = end["outcome"], end["at"], end.get("why")
        elif job in running:
            outcome, at, why = RUNNING, slot, None
        else:
            outcome, at, why = None, slot, None
        try:
            if datetime.fromisoformat(at) < since:
                continue
        except ValueError:
            continue
        word = OUTCOME_WORDS.get(outcome, outcome)
        # `label`: what a person reads for the slot key (scheduler.job_label)
        out.append({"job": job, "label": label(job) if label else job, "at": at, "outcome": outcome or "claimed",
                    "why": why, "words": f"{word} ({why})" if why else word})
    return out


def report(state, store_path: str, hours: int = 24, now: datetime | None = None, label=None) -> dict:
    """What the agent itself did: its scheduled jobs, the alerts it followed, the buttons pressed, the
    actions asked and done, the failures. Read from its own records only; it changes nothing."""
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(hours=hours)
    jobs = jobs_run(state, since, label)
    counts: dict[str, int] = {}
    cost = 0.0
    events = []
    records = state.calls_since(since.isoformat())
    for c in records:
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
    events_shown = limit("ai.status_events", 60, unit="events", group="ai", lo=10, hi=2000,
                         says="The latest things the agent did that the AI is shown when asked what it did.",
                         reached="Older ones are not shown (their counts stay whole).", told="")
    incidents_shown = limit("ai.status_incidents", 40, unit="alerts", group="ai", lo=5, hi=1000,
                            says="The latest alerts the AI is shown when asked what the agent did.",
                            reached="Older ones are not shown (their counts stay whole).", told="")
    return {"since": since.isoformat(), "until": now.isoformat(), "scheduled_jobs": jobs,
            "counts": counts, "figures": figures(records, cost), "ai_cost_usd": round(cost, 3),
            "events": events[-events_shown:], "incidents": incidents[-incidents_shown:]}


def costs(state, days: int = 30, now: datetime | None = None, zone=None, chat_label=None, name_of=None,
          skill_of=None) -> dict:
    """What the AI cost, run by run, from the agent's own records (the cost the Anthropic API reported for each
    run): the VESTA Agent page's Costs tab. Each run: when, the job (a chat reply, or an AI job named as Overview
    names it: "reports › fm-daily", skills.job_title), who asked and what, the brain and model, the tokens, the cost,
    and each step in a line (step_summary). Read-only; never a chat id (`chat_label` names the chat);
    `name_of(entity_id)` names a device in a step (the knowledge pack's); `skill_of(job name)` the skill that declares
    a job (skills.job_owners) — a job no skill declares any more keeps its bare name."""
    from .skills import job_title

    def job_words(name: str) -> str:
        owner = skill_of(name) if skill_of else None
        return job_title(owner, name) if owner else name

    now = now or datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    local = (lambda t: t.astimezone(zone)) if zone else (lambda t: t)
    runs, made = [], []
    records = state.calls_since(since.isoformat())
    for c in records:
        if c["kind"] not in agent_records.COSTS_KINDS:
            continue
        d = agent_records.detail(c)
        if c["kind"] in (agent_records.WITHOUT_AI, agent_records.JOB_NO_RESULT):
            # a job made by its code steps when the AI could not run (ai_jobs.AiJobs.run_without_ai), or one whose AI
            # run sent nothing (JOB_NO_RESULT): shown among the runs beside the AI run, at no cost, not counted as one
            row = {"at": c["at"], "kind": "job", "job": job_words(str(d.get("job") or "?")), "person": None, "chat": None,
                   "asked": None, "profile": None, "model": None, "tokens_in": None, "tokens_out": None,
                   "cache_read": None, "cache_write": None, "cost": 0.0, "stopped": False, "error": None,
                   "cause": None, "what_to_do": None, "turns": None, "seconds": None, "steps": [], "skills": []}
            if c["kind"] == agent_records.WITHOUT_AI:
                row["without_ai"] = {"why": why_job_sentence(d.get("problem") or "unknown"), "sent": int(d.get("sent") or 0),
                                     "failed": d.get("failed")}
            else:
                row["no_result"] = {"why": str(d.get("why") or "the AI sent nothing")}
            made.append(row)
            continue
        who = str(d.get("who") or "")
        if agent_records.job_of(who) is not None:
            kind, job, person, chat = "job", job_words(agent_records.job_of(who) or "?"), None, None
        else:
            name, cid = agent_records.person_of(who)
            kind, job, person = "chat", "Chat replies", name or None
            chat = chat_label(cid) if chat_label and cid.lstrip("-").isdigit() else None
        tok = d.get("tokens") or {}
        cost = run_cost(d)
        runs.append({"at": c["at"], "kind": kind, "job": job, "person": person, "chat": chat, "asked": d.get("asked"),
                     "profile": d.get("profile"), "model": d.get("model"),
                     "tokens_in": tok.get("input_tokens"), "tokens_out": tok.get("output_tokens"),
                     "cache_read": tok.get("cache_read_input_tokens"), "cache_write": tok.get("cache_creation_input_tokens"),
                     "cost": round(cost, 4), "stopped": bool(d.get("stopped_at_limit")), "error": d.get("error"),
                     # cut by a stop of the agent: its tokens so far, and no cost — Anthropic reports it at a run's end
                     "interrupted": c["kind"] == agent_records.RUN_CUT,
                     # the cause in plain words and what to do (api_errors.CAUSES), for the error's (!) on the Costs tab —
                     # never the first-person sentence a chat reads (architecture review scan 4)
                     "cause": cause(d.get("problem") or "unknown") if d.get("error") else None,
                     "what_to_do": what_to_do(d.get("problem") or "unknown") if d.get("error") else None,
                     "turns": d.get("turns"), "seconds": round(d["ms"] / 1000) if isinstance(d.get("ms"), (int, float)) else None,
                     "steps": steps_of(d.get("steps"), name_of),
                     # the skills it used, in order (runner.skills_of); a run recorded before 0.6.260 has none: "—"
                     "skills": [str(x) for x in d.get("skills") or [] if x]})
    runs.sort(key=lambda r: r["at"], reverse=True)

    def total(rs):
        return round(sum(r["cost"] for r in rs), 2)

    def group(key):
        out: dict[str, dict] = {}
        for r in runs:
            k = r[key] or "not recorded"
            # `recorded`: whether its tokens were (the page compared the name with "not recorded", review 9)
            g = out.setdefault(k, {"name": k, "recorded": bool(r[key]), "runs": 0, "cost": 0.0, "tokens_in": 0, "tokens_out": 0})
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
    busiest = max(days_list, key=lambda d: by_day.get(d, 0.0)) if any(by_day.get(d) for d in days_list) else None
    return {"days": days, "today": total(in_last(1)), "last_7_days": total(in_last(7)), "this_month": total(month),
            "period": total(runs), "runs_count": len(runs),
            # the Costs tab's other two figures, added up here, never by the page (architecture review scan 4)
            "per_run": round(total(runs) / len(runs), 4) if runs else 0.0,
            "busiest": {"day": busiest, "cost": round(by_day.get(busiest, 0.0), 2) if busiest else 0.0},
            "by_day": [{"day": d, "cost": round(by_day.get(d, 0.0), 2)} for d in days_list],
            # the daily chart's Y axis, from the one axis rule (vesta_shared.axis): the page only draws it
            "axis": _cost_axis(max([by_day.get(d, 0.0) for d in days_list] + [0.01])),
            "by_job": group("job"), "by_model": group("model"),
            "runs": sorted(runs + made, key=lambda r: r["at"], reverse=True)[:limit(
                "costs.runs_listed", 300, unit="runs", group="keep", lo=20, hi=5000,
                says="The latest runs the Costs tab lists one by one.",
                reached="Older runs are not listed (the totals still count them).", told="")],
            # the Costs tab's "Tools in this period": each tool, how many runs used it and how many times
            "tools": _tool_counts(runs),
            # what the agent did in the period, on the line of the figures above (owner, 2026-10-22: moved from
            # Overview's "The last 24 hours", which counted a fixed day); the AI cost left out, `period` says it
            "activity": figures(records)}


# ---------------------------------------------------------------- a run's steps, each in a line
def steps_of(recorded, name_of=None) -> list[dict]:
    """A run's steps as the Costs tab draws them: `{n, tool, summary, raw, code}` — the line it reads and, for its tooltip,
    the arguments as they were. A step recorded before 0.6.261 kept only its line (`input`): shown as it was kept."""
    out = []
    for x in recorded or []:
        if not isinstance(x, dict):
            continue
        tool = str(x.get("tool") or "?")
        if isinstance(x.get("args"), dict):
            args = x["args"]
            summary = step_summary(tool, args, name_of)
            raw = json.dumps(args, ensure_ascii=False, indent=1, default=str) if args else ""
        else:
            summary = raw = str(x.get("input") or "")
        # `code`: the line is a command line, drawn in the typewriter face (the only one that is)
        args = x.get("args") if isinstance(x.get("args"), dict) else {}
        # `skill`: the skill the step read or ran a script of — the Costs tab's first column of a run's steps
        out.append({"n": len(out) + 1, "tool": tool, "summary": summary, "raw": raw,
                    "skill": str(args.get("skill") or "") if tool in ("read_skill", "run_skill_script") else "",
                    "code": tool == "run_skill_script" and isinstance(x.get("args"), dict)})
    return out


def summary_chars() -> int:
    """A step's line; the page ellipsizes it to its width, the tooltip has the rest."""
    return limit("costs.step_chars", 160, unit="characters", group="text", lo=40, hi=2000,
                 says="The longest line describing one step of a run on the Costs tab.",
                 reached="The line ends with \"…\".", told="person")


def step_summary(tool: str, args: dict, name_of=None) -> str:
    """One tool call in a line a person reads (owner, 2026-10-19: "I don't like the way the details are displayed"):
    read_skill → the skill; run_skill_script → its command line; a read of the villa → the devices by name and the
    period; ha_search → "lights matching “dining”"; ha_call_service → "light.turn_off · 2 lights: …"; web_search →
    the query; save_file → the file; send_message → "to here · page.html"; any other → key=value, cut."""
    a = args or {}
    if tool == "read_skill":
        said = " · ".join(str(a[k]) for k in ("skill", "file") if a.get(k))
    elif tool == "run_skill_script":
        said = command_line(a.get("script"), a.get("args"))
    elif tool in ("ha_get_history", "ha_get_state", "ha_get_logs"):
        ids, period = read_subject(tool, a)
        parts = [str(a["source"]) if tool == "ha_get_logs" and a.get("source") else None, _named(ids, name_of),
                 f"“{a['search']}”" if tool == "ha_get_logs" and a.get("search") else None, period]
        said = " · ".join(p for p in parts if p)
    elif tool == "ha_search":
        what = _plural(str(a["domain_filter"])) if a.get("domain_filter") else "anything"
        said = f"{what} matching “{a.get('query', '')}”" + (f" in {a['area_filter']}" if a.get("area_filter") else "")
    elif tool == "ha_call_service":
        ids = _ids(a.get("entity_id"))
        target = (f"{len(ids)} {_plural(ids[0].split('.')[0]) if '.' in ids[0] else 'devices'}: {_named(ids, name_of)}"
                  if len(ids) > 1 else _named(ids, name_of))
        said = " · ".join(p for p in (f"{a.get('domain', '')}.{a.get('service', '')}", target) if p)
    elif tool == "web_search":
        said = f"“{a.get('query', '')}”"
    elif tool == "save_file":
        said = str(a.get("name") or "")
    elif tool == "send_message":
        said = " · ".join(p for p in (f"to {a.get('to', '?')}", str(a.get("attachment") or "")) if p)
    else:
        said = " ".join(f"{k}={_short(v)}" for k, v in a.items())
    most = summary_chars()
    return said if len(said) <= most else said[:most - 1].rstrip() + "…"


def script_args(args) -> list[str]:
    """A script's arguments as the list the script is run with — whether the model sent a list, that list written as
    JSON text, or a command line. ⚠️ ONE READING FOR THE RUN AND THE PAGE (2026-10-19): the run did list(args) on a
    text and spread it letter by letter ("[", "\"", "-", "-", "p", …), so the call was refused and the model had to
    try again — the Costs page showed the same text letter-spaced."""
    import shlex
    if isinstance(args, str):
        try:
            back = json.loads(args)
        except ValueError:
            back = None
        if isinstance(back, list):
            return [str(x) for x in back]
        try:
            return shlex.split(args)
        except ValueError:
            return args.split()
    return [str(x) for x in args] if isinstance(args, list) else []


def command_line(script, args) -> str:
    """A script and its arguments as one would type them: "energy_period.py --period week --out week.json"."""
    import shlex
    return " ".join([str(script or "?"), *map(shlex.quote, script_args(args))])


def read_subject(tool: str, args: dict) -> tuple[list[str], str | None]:
    """What a read of the villa is about: (the entity ids it names, its period in words, None when it names none) — one
    reading for a step's line here and for the subject a command offer keeps (tools.Toolbox.about)."""
    a = args or {}
    return _ids(a.get("entity_ids") if tool == "ha_get_history" or "entity_ids" in a else a.get("entity_id")), _period(a)


def _ids(v) -> list[str]:
    """Entity ids as a tool takes them: one, a list, or "a, b" in one text."""
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    if isinstance(v, str):
        return [x.strip() for x in v.split(",") if x.strip()]
    return []


def _named(ids: list[str], name_of=None, most: int = 3) -> str:
    """The devices by name when the knowledge pack names them, else by id; the first `most`, then "+N more"."""
    shown = [(name_of(i) if name_of else None) or i for i in ids[:most]]
    return ", ".join(shown) + (f" +{len(ids) - most} more" if len(ids) > most else "")


def _period(a: dict) -> str | None:
    """The period a read covers, in words: "last 7 days, by day", "last 6 h", "from 2026-10-12 08:00"."""
    out = []
    start, rel = a.get("start_time"), None
    if isinstance(start, str) and start[:-1].isdigit() and start[-1:] in ("h", "d"):
        n = int(start[:-1])
        rel = f"last {n} h" if start[-1] == "h" else f"last {n} day" + ("s" if n != 1 else "")
    if a.get("hours_back") is not None:
        rel = f"last {a['hours_back']} h"
    if rel:
        out.append(rel)
    elif start:
        out.append(f"from {str(start)[:16].replace('T', ' ')}")
    if a.get("end_time"):
        out.append(f"to {str(a['end_time'])[:16].replace('T', ' ')}")
    if a.get("period"):
        out.append(f"by {a['period']}")
    return ", ".join(out) or None


def _plural(word: str) -> str:
    return word + ("es" if word.endswith(("s", "sh", "ch", "x")) else "s")


def _short(v, most: int | None = None) -> str:
    most = most or limit("costs.step_value_chars", 40, unit="characters", group="text", lo=10, hi=500,
                         says="The longest value of one setting a step's line on the Costs tab shows.",
                         reached="The value ends with \"…\".", told="person")
    text = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str)
    return text if len(text) <= most else text[:most - 1] + "…"


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
        if c["kind"] not in (agent_records.RUN, agent_records.RUN_CUT):     # a cut run called its tools too
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
