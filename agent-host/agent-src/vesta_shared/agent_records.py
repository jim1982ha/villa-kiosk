"""The agent's own records (VESTA_STATE, its `calls` table), read: one reader for the engine and the skills.

⚠️ ONE READING (architecture review, 2026-10-01). The engine read its records in status.py, and the
reports skill opened the same database itself for the AI's cost and "listening since" — two readers
of one table, free to disagree on what a run's cost is. Both read through here now: the engine with
its open connection (vesta_agent.state.State), a skill read-only by path.
"""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime

# ⚠️ WHAT A RUN WAS, WRITTEN AND READ HERE (architecture review 6, 2026-10-07; moved from vesta_agent/run_records.py,
# review 5). The record's kinds, its `who`, the without-AI record and the reading of a row's detail: the engine
# writes them (runner, app), the Costs tab, the Overview and housekeeping read them (status, state), a skill reads
# the cost (facts.py) — status.py parsed a row by hand three times, "run" was written in seven places, and
# housekeeping kept the without-AI rows on the other records' limit while the runs beside them went by theirs.
RUN = "run"

JOB = "job:"
WITHOUT_AI = "without_ai"        # the record's kind (state.log): a job made by its code steps, the AI unavailable


def for_job(name: str) -> str:
    return JOB + name


def for_person(name: str | None, chat) -> str:
    return f"{name or 'system'}@{chat}"


def job_of(who: str) -> str | None:
    """The job a run was for; None for a conversation."""
    return who[len(JOB):] if who.startswith(JOB) else None


def person_of(who: str) -> tuple[str | None, str]:
    """(the person's name, the chat id as written) of a conversation's run."""
    name, _, chat = who.partition("@")
    return name or None, chat


def without_ai(job: str, problem: str, sent: int, failed: str | None) -> dict:
    return {"job": job, "problem": problem, "sent": sent, "failed": failed}


COSTS_KINDS = (RUN, WITHOUT_AI)        # the Costs tab's rows: kept and pruned together (state.prune)


def detail(row) -> dict:
    """A record's detail (its JSON), {} when it is not readable."""
    try:
        d = json.loads((row["detail"] if not isinstance(row, (str, bytes)) else row) or "{}")
    except (ValueError, TypeError):
        return {}
    return d if isinstance(d, dict) else {}


def run_cost(detail: dict) -> float:
    """What one AI run cost, as the Anthropic API reported it (0.0 when it reported nothing).

    ⚠️ NO TOKENS, NO COST (villa, 2026-10-07). Refused for lack of credit, each reply was recorded at 0.033 USD with
    0 tokens in and 0 out — the Claude client's own figure, not Anthropic's bill: the Console showed 0.03 USD of Haiku
    for the whole day, against about 0.40 USD on the Costs tab. A run whose record says it read and wrote nothing cost
    nothing. A record without token counts (before 0.6.9) keeps its figure."""
    d = detail or {}
    tok = d.get("tokens")
    if isinstance(tok, dict) and "input_tokens" in tok and "output_tokens" in tok and not any(
            isinstance(v, (int, float)) and v > 0 for v in tok.values()):
        return 0.0
    c = d.get("cost_usd")
    return float(c) if isinstance(c, (int, float)) else 0.0


def _rows(path: str | None, sql: str, args: tuple) -> list:
    if not path or not os.path.exists(path):
        return []
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return db.execute(sql, args).fetchall()
    except sqlite3.Error:
        return []
    finally:
        db.close()


def cost_between(path: str | None, since_iso: str, until_iso: str) -> float | None:
    """The AI's cost between two instants (ISO, UTC); None without the agent's records."""
    if not path or not os.path.exists(path):
        return None
    rows = _rows(path, "select detail from calls where kind=? and at>=? and at<?", (RUN, since_iso, until_iso))
    return round(sum(run_cost(detail(d)) for (d,) in rows), 2)


def listening_since(path: str | None) -> datetime | None:
    """When the agent's own record starts (its first run or event); None without one. Kept once by the agent's state
    (vesta_agent.state: listening_since), never read again from the oldest record kept, which housekeeping moves on."""
    kept = _rows(path, "select v from kv where k='listening_since'", ())
    if kept and kept[0][0]:
        try:
            return datetime.fromisoformat(kept[0][0])
        except ValueError:
            pass
    rows = _rows(path, "select min(at) from calls", ())
    try:
        return datetime.fromisoformat(rows[0][0]) if rows and rows[0][0] else None
    except ValueError:
        return None
