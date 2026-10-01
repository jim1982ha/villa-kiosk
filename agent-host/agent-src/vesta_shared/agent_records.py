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


def run_cost(detail: dict) -> float:
    """What one AI run cost, as the Anthropic API reported it (0.0 when it reported nothing)."""
    c = (detail or {}).get("cost_usd")
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
    rows = _rows(path, "select detail from calls where kind='run' and at>=? and at<?", (since_iso, until_iso))
    return round(sum(run_cost(json.loads(d or "{}")) for (d,) in rows), 2)


def listening_since(path: str | None) -> datetime | None:
    """When the agent's own record starts (its first run or event); None without one."""
    rows = _rows(path, "select min(at) from calls", ())
    try:
        return datetime.fromisoformat(rows[0][0]) if rows and rows[0][0] else None
    except ValueError:
        return None
