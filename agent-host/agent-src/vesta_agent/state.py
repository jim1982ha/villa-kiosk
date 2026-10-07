"""The agent's own state: approvals, conversations, Continue, and the call log.

Separate from the skills' store (vesta_store.sqlite) so the skills never see
approval records and the model cannot reach either file (it has no file tool).
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from vesta_shared import agent_records

SCHEMA = """
create table if not exists approvals(
  id text primary key,
  created_at text not null,
  expires_at text not null,
  status text not null,              -- pending, approved, refused, expired, failed, done
  requested_by integer,              -- telegram id of the person whose message led to it, null for the system
  required_role text not null,       -- owner | any
  chat_id integer not null,          -- where the buttons were sent
  message_id integer,
  action_hash text not null,
  action text not null,              -- json: domain, service, entity_ids, data, plain
  decided_by integer,
  decided_at text,
  result text
);
create table if not exists sessions(
  chat_id integer primary key,
  session_id text,
  last_used text
);
create table if not exists continuations(
  id text primary key,
  created_at text not null,
  chat_id integer not null,
  session_id text not null,
  requested_by integer,
  used integer not null default 0
);
create table if not exists kv(
  k text primary key,
  v text
);
create table if not exists own_messages(
  chat_id integer not null,
  message_id integer not null,
  sent_at text not null,
  primary key(chat_id, message_id)
);
create table if not exists calls(
  id integer primary key autoincrement,
  at text not null,
  kind text not null,                -- requested, refused, approved, executed, failed, tool_denied, ...
  detail text not null
);
"""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class State:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        # ⚠️ A KEY KNOWS WHEN IT WAS WRITTEN (architecture review, 2026-10-07): an alert's button records (inc:,
        # incmsg:) were never pruned — kv had no date. Existing rows start their clock now.
        if "at" not in {r[1] for r in self.db.execute("pragma table_info(kv)")}:
            self.db.execute("alter table kv add column at text")
            self.db.execute("update kv set at = ?", (utcnow().isoformat(),))
        self.db.commit()

    # ------------------------------------------------------------------ log
    def log(self, kind: str, detail: dict[str, Any]) -> None:
        with self._lock:
            self.db.execute("insert into calls(at, kind, detail) values(?,?,?)",
                            (utcnow().isoformat(), kind, json.dumps(detail, default=str)))
            self.db.commit()

    def calls(self, kind: str | None = None) -> list[dict]:
        q = "select * from calls" + (" where kind=?" if kind else "") + " order by id"
        return [dict(r) for r in self.db.execute(q, (kind,) if kind else ())]

    def calls_since(self, since_iso: str) -> list[dict]:
        return [dict(r) for r in self.db.execute("select * from calls where at>=? order by id", (since_iso,))]

    # ------------------------------------------------------------------ kv
    def kv_prefix(self, prefix: str) -> dict[str, str]:
        return {r["k"]: r["v"] for r in self.db.execute("select k, v from kv where substr(k, 1, ?)=?", (len(prefix), prefix))}

    def get(self, k: str, default: str | None = None) -> str | None:
        r = self.db.execute("select v from kv where k=?", (k,)).fetchone()
        return r["v"] if r else default

    def put(self, k: str, v: str) -> None:
        with self._lock:
            self.db.execute("insert into kv(k, v, at) values(?,?,?) on conflict(k) do update set v=excluded.v, at=excluded.at",
                            (k, v, utcnow().isoformat()))
            self.db.commit()

    def drop(self, k: str) -> None:
        with self._lock:
            self.db.execute("delete from kv where k=?", (k,))
            self.db.commit()

    # ------------------------------------------------------------------ named records
    # ⚠️ THE KEY LAYOUTS LIVE HERE, AND ONLY HERE (0.6.21). Four prefixes were
    # invented by four modules — inc: and incmsg: by outcome.py, job: by
    # scheduler.py (and sliced back by status.py, `k[4:]`), saved_by_model: by
    # tools.py — each parsing its own. The stored keys are unchanged, so the
    # records an agent already holds keep working with no migration.

    # When the siren must stop (siren.py): kept here so that a restart still stops it.
    def siren_stop(self) -> str | None:
        return self.get("siren:stop_at")

    def set_siren_stop(self, at_iso: str | None) -> None:
        if at_iso:
            self.put("siren:stop_at", at_iso)
        else:
            self.drop("siren:stop_at")

    # A scheduled job's last slot: claimed once per slot, by one tick.
    def claim_job_slot(self, job: str, slot_iso: str) -> bool:
        """True if this tick claims `job` for `slot_iso`; False if it already ran in that slot.
        Under the lock: a read then a write would let two ticks both claim it."""
        with self._lock:
            k = f"job:{job}"
            r = self.db.execute("select v from kv where k=?", (k,)).fetchone()
            if r and r["v"] == slot_iso:
                return False
            self.db.execute("insert into kv(k, v) values(?,?) on conflict(k) do update set v=excluded.v", (k, slot_iso))
            self.db.commit()
            return True

    def jobs_run(self) -> list[tuple[str, str]]:
        """(job, last slot) for every scheduled job, oldest slot first."""
        return sorted(((k[len("job:"):], v) for k, v in self.kv_prefix("job:").items()), key=lambda kv: kv[1])

    # An alert's buttons in the chats: which skill answers them there, and every message carrying them.
    def set_alert_skill(self, incident: int | str, chat: int | str, skill: str) -> None:
        self.put(f"inc:{incident}:{chat}", skill)

    def alert_skill(self, incident: int | str, chat: int | str) -> str | None:
        return self.get(f"inc:{incident}:{chat}")

    def remember_alert_message(self, incident: int | str, chat: int | str, message_id: int | str, text: str) -> None:
        self.put(f"incmsg:{incident}:{chat}:{message_id}", text)

    def alert_messages(self, incident: int | str) -> list[tuple[int, int, str]]:
        """(chat, message id, text) of every message still carrying this incident's buttons."""
        out = []
        for k, text in self.kv_prefix(f"incmsg:{incident}:").items():
            _, _, chat, mid = k.split(":")
            out.append((int(chat), int(mid), text))
        return out

    def forget_alert_message(self, incident: int | str, chat: int | str, message_id: int | str) -> None:
        self.drop(f"incmsg:{incident}:{chat}:{message_id}")

    # A file in the out folder that the MODEL saved (a script's output may not be overwritten by it).
    def owner_told(self, problem: str) -> str | None:
        """When the owner was last told that `problem` (no credit, a refused key) stops the agent."""
        return self.get(f"owner_told:{problem}")

    def mark_owner_told(self, problem: str, at: str) -> None:
        self.put(f"owner_told:{problem}", at)

    def mark_saved_by_model(self, name: str) -> None:
        self.put(f"saved_by_model:{name}", name)

    def saved_by_model(self, name: str) -> bool:
        return self.get(f"saved_by_model:{name}") is not None

    # ------------------------------------------------------------------ own messages
    # ⚠️ HOW A PRESS OR A REPLY IS KNOWN TO BE FOR THE AGENT. Home Assistant and the
    # agent share one bot, so "the bot sent it" says nothing: the agent keeps the id of
    # every message IT sent, and a button press or a reply counts as its own only when
    # it lands on one of these. Anything else belongs to Home Assistant's automations.
    def remember_message(self, chat_id: int, message_id: int | None, now: datetime | None = None) -> None:
        if not message_id:
            return
        with self._lock:
            self.db.execute("insert or ignore into own_messages(chat_id, message_id, sent_at) values(?,?,?)",
                            (int(chat_id), int(message_id), (now or utcnow()).isoformat()))
            self.db.commit()

    def is_own_message(self, chat_id: int | None, message_id: int | None) -> bool:
        if chat_id is None or message_id is None:
            return False
        r = self.db.execute("select 1 from own_messages where chat_id=? and message_id=?",
                            (int(chat_id), int(message_id))).fetchone()
        return r is not None

    def rename_job_runs(self, names: dict[str, str]) -> int:
        """A run recorded before jobs had names ("job:reports:07:00") is rewritten ONCE under its job's name today
        ("job:fm-daily"), so the Costs tab needs no second reading of old records (0.6.42). `names`: old → new."""
        n = 0
        with self._lock:
            for r in self.db.execute("select id, detail from calls where kind = ? and detail like '%\"job:%'",
                                     (agent_records.RUN,)).fetchall():
                d = json.loads(r["detail"] or "{}")
                new = names.get(agent_records.job_of(str(d.get("who") or "")) or "")
                if new:
                    d["who"] = agent_records.for_job(new)
                    self.db.execute("update calls set detail=? where id=?", (json.dumps(d, default=str), r["id"]))
                    n += 1
            self.db.commit()
        return n

    def prune(self, runs_before: str, records_before: str) -> dict[str, int]:
        """Housekeeping (settings.keep): the AI runs (the Costs tab) and the other records have their own
        limit; a pending approval and an unused Continue still waiting are never touched."""
        with self._lock:
            # the Costs tab's rows (an AI run, a job made without the AI) go by the runs' limit, together
            kinds = agent_records.COSTS_KINDS
            marks = ",".join("?" * len(kinds))
            runs = self.db.execute(f"delete from calls where kind in ({marks}) and at < ?", (*kinds, runs_before)).rowcount
            other = self.db.execute(f"delete from calls where kind not in ({marks}) and at < ?",
                                    (*kinds, records_before)).rowcount
            appr = self.db.execute("delete from approvals where status != 'pending' and created_at < ?",
                                   (records_before,)).rowcount
            cont = self.db.execute("delete from continuations where created_at < ?", (records_before,)).rowcount
            msgs = self.db.execute("delete from own_messages where sent_at < ?", (records_before,)).rowcount
            # an alert's button records go with the agent's other records (its messages are pruned just above)
            msgs += self.db.execute("delete from kv where (k like 'inc:%' or k like 'incmsg:%') and at < ?",
                                    (records_before,)).rowcount
            self.db.commit()
        return {"runs": runs, "records": other + appr + cont + msgs}

    # ------------------------------------------------------------------ approvals
    def new_approval(self, action: dict, action_hash: str, required_role: str, chat_id: int,
                     requested_by: int | None, ttl_minutes: int, now: datetime | None = None) -> str:
        now = now or utcnow()
        aid = secrets.token_urlsafe(9)
        with self._lock:
            self.db.execute(
                "insert into approvals(id, created_at, expires_at, status, requested_by, required_role, chat_id,"
                " action_hash, action) values(?,?,?,?,?,?,?,?,?)",
                (aid, now.isoformat(), (now + timedelta(minutes=ttl_minutes)).isoformat(), "pending",
                 requested_by, required_role, int(chat_id), action_hash, json.dumps(action, default=str)))
            self.db.commit()
        return aid

    def set_approval_message(self, aid: str, message_id: int) -> None:
        with self._lock:
            self.db.execute("update approvals set message_id=? where id=?", (message_id, aid))
            self.db.commit()

    def approval(self, aid: str) -> dict | None:
        r = self.db.execute("select * from approvals where id=?", (aid,)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["action"] = json.loads(d["action"])
        return d

    def claim_approval(self, aid: str, status: str, decided_by: int, now: datetime | None = None) -> bool:
        """Move a pending approval to its decision once. False if somebody else was first."""
        now = now or utcnow()
        with self._lock:
            cur = self.db.execute(
                "update approvals set status=?, decided_by=?, decided_at=? where id=? and status='pending'",
                (status, decided_by, now.isoformat(), aid))
            self.db.commit()
            return cur.rowcount == 1

    def finish_approval(self, aid: str, status: str, result: Any) -> None:
        with self._lock:
            self.db.execute("update approvals set status=?, result=? where id=?",
                            (status, json.dumps(result, default=str), aid))
            self.db.commit()

    def expire_approval(self, aid: str) -> None:
        with self._lock:
            self.db.execute("update approvals set status='expired' where id=? and status='pending'", (aid,))
            self.db.commit()

    # ------------------------------------------------------------------ sessions
    def session(self, chat_id: int) -> tuple[str | None, str | None]:
        r = self.db.execute("select session_id, last_used from sessions where chat_id=?", (int(chat_id),)).fetchone()
        return (r["session_id"], r["last_used"]) if r else (None, None)

    def set_session(self, chat_id: int, session_id: str | None, now: datetime | None = None) -> None:
        now = now or utcnow()
        with self._lock:
            self.db.execute("insert into sessions(chat_id, session_id, last_used) values(?,?,?) "
                            "on conflict(chat_id) do update set session_id=excluded.session_id, last_used=excluded.last_used",
                            (int(chat_id), session_id, now.isoformat()))
            self.db.commit()

    # ------------------------------------------------------------------ continue
    def new_continuation(self, chat_id: int, session_id: str, requested_by: int | None) -> str:
        cid = secrets.token_urlsafe(9)
        with self._lock:
            self.db.execute("insert into continuations(id, created_at, chat_id, session_id, requested_by) values(?,?,?,?,?)",
                            (cid, utcnow().isoformat(), int(chat_id), session_id, requested_by))
            self.db.commit()
        return cid

    def use_continuation(self, cid: str, chat_id: int, by: int | None = None) -> dict | None:
        """The continuation, used up — or {"not_yours": True}, left as it is, when `by` is not the person who
        asked (architecture review, 0.12.37: `requested_by` was written and never read, so anyone in a group
        could resume another person's conversation under their own role)."""
        with self._lock:
            r = self.db.execute("select * from continuations where id=? and chat_id=? and used=0", (cid, int(chat_id))).fetchone()
            if not r:
                return None
            if r["requested_by"] is not None and by is not None and int(r["requested_by"]) != int(by):
                return {"not_yours": True}
            self.db.execute("update continuations set used=1 where id=?", (cid,))
            self.db.commit()
            return dict(r)
