"""The agent's own memory: what Home Assistant forgets.

SQLite file (VESTA_STORE, default ./vesta_store.sqlite). One villa per file.
Tables:
  features    nightly per-asset numbers (the feature store, kept 24 months)
  findings    open and closed maintenance findings, one row per incident
  incidents   alert-desk records with the chase ladder state
  tasks       FM tasks, each mirrored as a VESTA Kiosk ticket (its id in todo_uid), with their rule id,
              their source ("finding:N" / "incident:N") and what to check — opened and closed through
              vesta_shared.problems, the one owner of a problem's lifecycle
  proposals   "VESTA suggests" items and their accept / later / ignore status
  mutes       rule + entity snoozed until a date
  cache       rendered reports and computed periods, keyed
  pack_seen   entity ids seen in the knowledge pack, for the onboarding diff
  heartbeat   the Home Assistant connection (ha_events) and the last agent tick
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS features (
  day TEXT NOT NULL, entity_id TEXT NOT NULL, family TEXT NOT NULL,
  name TEXT NOT NULL, value REAL, meta TEXT,
  PRIMARY KEY (day, entity_id, name));
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL, entity_id TEXT NOT NULL, family TEXT,
  opened_day TEXT NOT NULL, closed_day TEXT, severity TEXT,
  summary TEXT, detail TEXT, status TEXT DEFAULT 'open',
  UNIQUE (rule_id, entity_id, opened_day));
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL, rule_id TEXT, entity_id TEXT, severity TEXT,
  opened_at TEXT NOT NULL, last_seen_at TEXT, closed_at TEXT,
  count INTEGER DEFAULT 1, state TEXT DEFAULT 'new',
  asked_at TEXT, reasked_at TEXT, escalated_at TEXT, assignee TEXT,
  reply TEXT, payload TEXT, message_ids TEXT);
CREATE INDEX IF NOT EXISTS incidents_key ON incidents(key, closed_at);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT, entity_id TEXT, todo_uid TEXT, summary TEXT,
  created_at TEXT, done_at TEXT, status TEXT DEFAULT 'open');
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT, title TEXT, detail TEXT, benefit TEXT,
  created_at TEXT, status TEXT DEFAULT 'open', decided_at TEXT);
CREATE TABLE IF NOT EXISTS mutes (
  rule_id TEXT NOT NULL, entity_id TEXT NOT NULL, until TEXT NOT NULL, by TEXT,
  PRIMARY KEY (rule_id, entity_id));
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY, created_at TEXT, value TEXT);
CREATE TABLE IF NOT EXISTS pack_seen (
  entity_id TEXT PRIMARY KEY, first_seen TEXT, family TEXT, area TEXT, last_seen TEXT);
CREATE TABLE IF NOT EXISTS heartbeat (
  name TEXT PRIMARY KEY, at TEXT);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, who TEXT, action TEXT, detail TEXT);
"""


class Incident:
    """The states an incident goes through — the alert desk's ladder — as every reader names them.

    ⚠️ ONE VOCABULARY (architecture review, 2026-10-07): the desk wrote these words, problems.py and the reports read
    them, each spelled by hand; "answered or cleared" existed twice."""
    ASKED, REASKED, ESCALATED = "asked", "reasked", "escalated"          # the facility manager is being chased
    DONE, NOT_FOUND, MUTED = "done", "not_found", "muted"                # a person's answer
    RESOLVED, RECOVERED = "resolved", "recovered"                        # its rule cleared / its source came back
    DIGEST, LOGGED = "digest", "logged"                                  # never chased: the morning list, the record
    CHASED = (ASKED, REASKED, ESCALATED)
    ANSWERED_OR_CLEARED = (DONE, RESOLVED)    # over: its task and ticket close with it (not muted, not recovered)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: str | None = None):
        self.path = path or os.environ.get("VESTA_STORE", "vesta_store.sqlite")
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        # ⚠️ A FORMAT CHANGE CARRIES ITS MIGRATION: a store written before 0.6.16 has tasks without
        # these columns, and outlives the release that adds them.
        cols = {r["name"] for r in self.db.execute("PRAGMA table_info(tasks)")}
        for col in ("source", "check_text"):
            if col not in cols:
                self.db.execute(f"ALTER TABLE tasks ADD COLUMN {col} TEXT")
        # ...and its rows are rewritten ONCE in today's shape (0.6.42), so no reader keeps a second way of
        # reading them: a task's source is the latest finding, else incident, of its rule and device
        # ("none:0" when neither exists: it then waits for a person, as before), and its "<what> Check: <how>"
        # text is split in two.
        for t in self.db.execute("SELECT id, rule_id, entity_id, summary FROM tasks WHERE source IS NULL").fetchall():
            src = "none:0"
            for kind in ("finding", "incident"):
                r = self.db.execute(f"SELECT id FROM {kind}s WHERE rule_id=? AND entity_id=? ORDER BY id DESC LIMIT 1",
                                    (t["rule_id"], t["entity_id"])).fetchone()
                if r:
                    src = f"{kind}:{r['id']}"
                    break
            what, _, check = (t["summary"] or "").partition(" Check: ")
            self.db.execute("UPDATE tasks SET source=?, summary=?, check_text=? WHERE id=?",
                            (src, what if check else t["summary"], check.strip() or None, t["id"]))
        self.db.commit()

    @staticmethod
    def now() -> str:
        return _now()

    # features ------------------------------------------------------------
    def put_feature(self, day: str, entity_id: str, family: str, name: str, value: float | None, meta: dict | None = None):
        self.db.execute("INSERT OR REPLACE INTO features VALUES (?,?,?,?,?,?)",
                        (day, entity_id, family, name, value, json.dumps(meta or {})))
        self.db.commit()

    # findings ------------------------------------------------------------
    def open_finding(self, rule_id: str, entity_id: str) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM findings WHERE rule_id=? AND entity_id=? AND status='open' ORDER BY id DESC LIMIT 1",
                               (rule_id, entity_id)).fetchone()

    def raise_finding(self, rule_id: str, entity_id: str, family: str, day: str, severity: str, summary: str, detail: dict) -> tuple[int, bool]:
        """Returns (id, is_new). An open finding for the same rule+entity is updated, not duplicated.

        ⚠️ THE SAME NIGHT RUN AGAIN (villa, 2026-10-06: nightly.py tried from the page for a day already judged) finds
        that day's row for the rule+entity, closed if it was an event (closed the night it fires): it is opened again
        and is not new — not a UNIQUE (rule_id, entity_id, opened_day) crash, not the same news twice."""
        cur = self.open_finding(rule_id, entity_id)
        if not cur:
            cur = self.db.execute("SELECT * FROM findings WHERE rule_id=? AND entity_id=? AND opened_day=?",
                                  (rule_id, entity_id, day)).fetchone()
        if cur:
            self.db.execute("UPDATE findings SET detail=?, summary=?, severity=?, status='open', closed_day=NULL WHERE id=?",
                            (json.dumps(detail), summary, severity, cur["id"]))
            self.db.commit()
            return cur["id"], False
        c = self.db.execute("INSERT INTO findings (rule_id, entity_id, family, opened_day, severity, summary, detail) VALUES (?,?,?,?,?,?,?)",
                            (rule_id, entity_id, family, day, severity, summary, json.dumps(detail)))
        self.db.commit()
        return c.lastrowid, True

    def close_finding(self, rule_id: str, entity_id: str, day: str):
        self.db.execute("UPDATE findings SET status='closed', closed_day=? WHERE rule_id=? AND entity_id=? AND status='open'",
                        (day, rule_id, entity_id))
        self.db.commit()

    def finding(self, fid: int) -> dict | None:
        r = self.db.execute("SELECT * FROM findings WHERE id=?", (fid,)).fetchone()
        return dict(r) if r else None

    def set_finding_detail(self, fid: int, detail: dict) -> None:
        self.db.execute("UPDATE findings SET detail=? WHERE id=?", (json.dumps(detail), fid))
        self.db.commit()

    def prune_features(self, before_day: str) -> int:
        """The daily figures per device older than `before_day` (housekeeping, settings.keep)."""
        n = self.db.execute("DELETE FROM features WHERE day < ?", (before_day,)).rowcount
        self.db.commit()
        return max(n, 0)

    def findings(self, status: str | None = None, since_day: str | None = None) -> list[dict]:
        q, args = "SELECT * FROM findings WHERE 1=1", []
        if status:
            q += " AND status=?"; args.append(status)
        if since_day:
            q += " AND opened_day>=?"; args.append(since_day)
        return [dict(r) for r in self.db.execute(q + " ORDER BY opened_day, id", args)]

    # incidents -----------------------------------------------------------
    def find_open_incident(self, key: str) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM incidents WHERE key=? AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (key,)).fetchone()

    def new_incident(self, key: str, rule_id: str, entity_id: str, severity: str, payload: dict, at: str | None = None) -> int:
        at = at or _now()
        c = self.db.execute("INSERT INTO incidents (key, rule_id, entity_id, severity, opened_at, last_seen_at, payload) VALUES (?,?,?,?,?,?,?)",
                            (key, rule_id, entity_id, severity, at, at, json.dumps(payload)))
        self.db.commit()
        return c.lastrowid

    def touch_incident(self, iid: int, at: str | None = None):
        self.db.execute("UPDATE incidents SET count=count+1, last_seen_at=? WHERE id=?", (at or _now(), iid))
        self.db.commit()

    def update_incident(self, iid: int, **fields):
        cols = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE incidents SET {cols} WHERE id=?", (*fields.values(), iid))
        self.db.commit()

    def incidents(self, open_only: bool = True) -> list[dict]:
        q = "SELECT * FROM incidents" + (" WHERE closed_at IS NULL" if open_only else "") + " ORDER BY opened_at"
        return [dict(r) for r in self.db.execute(q)]

    def incident(self, iid: int) -> dict | None:
        r = self.db.execute("SELECT * FROM incidents WHERE id=?", (iid,)).fetchone()
        return dict(r) if r else None

    def count_incidents(self, rule_id: str, since_iso: str) -> int:
        return self.db.execute("SELECT COUNT(*) FROM incidents WHERE rule_id=? AND opened_at>=?", (rule_id, since_iso)).fetchone()[0]

    # tasks -----------------------------------------------------------------
    def add_task(self, rule_id: str, entity_id: str, summary: str, todo_uid: str | None = None,
                 source: str | None = None, check_text: str | None = None) -> int:
        """Opening a task is vesta_shared.problems.Problems.open_task's job; this only writes the row."""
        c = self.db.execute("INSERT INTO tasks (rule_id, entity_id, todo_uid, summary, created_at, source, check_text) "
                            "VALUES (?,?,?,?,?,?,?)", (rule_id, entity_id, todo_uid, summary, _now(), source, check_text))
        self.db.commit()
        return c.lastrowid

    def set_task_uid(self, task_id: int, uid: str):
        """The Facility ticket the engine created for this task (column kept from the to-do era)."""
        self.db.execute("UPDATE tasks SET todo_uid=? WHERE id=?", (uid, task_id)); self.db.commit()

    def task(self, task_id: int) -> dict | None:
        r = self.db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return dict(r) if r else None

    def open_task(self, rule_id: str, entity_id: str) -> dict | None:
        r = self.db.execute("SELECT * FROM tasks WHERE rule_id=? AND entity_id=? AND status='open'", (rule_id, entity_id)).fetchone()
        return dict(r) if r else None

    def tasks(self, status: str | None = "open") -> list[dict]:
        q, args = "SELECT * FROM tasks", []
        if status:
            q += " WHERE status=?"; args.append(status)
        return [dict(r) for r in self.db.execute(q + " ORDER BY created_at", args)]

    def close_task(self, task_id: int, status: str = "done"):
        self.db.execute("UPDATE tasks SET status=?, done_at=? WHERE id=?", (status, _now(), task_id))
        self.db.commit()

    # proposals -------------------------------------------------------------
    def add_proposal(self, kind: str, title: str, detail: str, benefit: str) -> int:
        r = self.db.execute("SELECT id FROM proposals WHERE title=? AND status='open'", (title,)).fetchone()
        if r:
            return r["id"]
        c = self.db.execute("INSERT INTO proposals (kind, title, detail, benefit, created_at) VALUES (?,?,?,?,?)",
                            (kind, title, detail, benefit, _now()))
        self.db.commit()
        return c.lastrowid

    def proposals(self, status: str | None = "open") -> list[dict]:
        q, args = "SELECT * FROM proposals", []
        if status:
            q += " WHERE status=?"; args.append(status)
        return [dict(r) for r in self.db.execute(q + " ORDER BY created_at", args)]

    def decide_proposal(self, pid: int, status: str):
        self.db.execute("UPDATE proposals SET status=?, decided_at=? WHERE id=?", (status, _now(), pid))
        self.db.commit()

    # mutes -----------------------------------------------------------------
    def mute(self, rule_id: str, entity_id: str, until_iso: str, by: str):
        self.db.execute("INSERT OR REPLACE INTO mutes VALUES (?,?,?,?)", (rule_id, entity_id, until_iso, by))
        self.db.commit()

    def is_muted(self, rule_id: str, entity_id: str, now_iso: str | None = None) -> bool:
        now_iso = now_iso or _now()
        r = self.db.execute("SELECT until FROM mutes WHERE rule_id=? AND entity_id IN (?, '*')", (rule_id, entity_id)).fetchone()
        return bool(r and r["until"] > now_iso)

    def mutes(self) -> list[dict]:
        return [dict(r) for r in self.db.execute("SELECT * FROM mutes WHERE until>? ORDER BY until", (_now(),))]

    # cache -----------------------------------------------------------------
    def cache_get(self, key: str) -> Any | None:
        r = self.db.execute("SELECT value FROM cache WHERE key=?", (key,)).fetchone()
        return json.loads(r["value"]) if r else None

    def cache_put(self, key: str, value: Any):
        self.db.execute("INSERT OR REPLACE INTO cache VALUES (?,?,?)", (key, _now(), json.dumps(value)))
        self.db.commit()

    # pack diff -------------------------------------------------------------
    def pack_seen_empty(self) -> bool:
        """No device seen yet: the first night (every device is "new", none is announced)."""
        return self.db.execute("SELECT COUNT(*) FROM pack_seen").fetchone()[0] == 0

    def pack_diff(self, entities: list[dict]) -> tuple[list[dict], list[dict]]:
        """Returns (new, gone) versus the previous night."""
        seen = {r["entity_id"]: dict(r) for r in self.db.execute("SELECT * FROM pack_seen")}
        now = _now()
        new, current = [], set()
        for e in entities:
            current.add(e["entity_id"])
            if e["entity_id"] not in seen:
                new.append(e)
                self.db.execute("INSERT INTO pack_seen VALUES (?,?,?,?,?)", (e["entity_id"], now, e.get("family"), e.get("area"), now))
            else:
                self.db.execute("UPDATE pack_seen SET last_seen=?, family=?, area=? WHERE entity_id=?", (now, e.get("family"), e.get("area"), e["entity_id"]))
        gone = [seen[e] for e in seen if e not in current and seen[e]["last_seen"] != now]
        self.db.commit()
        return new, gone

    def first_seen(self, entity_id: str) -> str | None:
        r = self.db.execute("SELECT first_seen FROM pack_seen WHERE entity_id=?", (entity_id,)).fetchone()
        return r["first_seen"] if r else None

    # heartbeat / audit ---------------------------------------------------------
    def beat(self, name: str, at: str | None = None):
        self.db.execute("INSERT OR REPLACE INTO heartbeat VALUES (?,?)", (name, at or _now()))
        self.db.commit()

    def last_beat(self, name: str) -> str | None:
        r = self.db.execute("SELECT at FROM heartbeat WHERE name=?", (name,)).fetchone()
        return r["at"] if r else None

    def audit(self, who: str, action: str, detail: dict):
        self.db.execute("INSERT INTO audit (at, who, action, detail) VALUES (?,?,?,?)", (_now(), who, action, json.dumps(detail)))
        self.db.commit()
