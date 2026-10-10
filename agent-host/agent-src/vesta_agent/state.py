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


#: Every family of named records (the kv table), and how long it lives. ⚠️ DECLARED ONCE (architecture review 16,
#: 2026-10-10): each family was added with its own way of being deleted — or none. saved_by_model: (one row per file
#: the AI saved, per report run, forever), owner_told: and the job slots were never pruned; inc: and incthread: were,
#: by name. `prune` walks this table; a family written but not listed here fails tests/test_state_records.py.
#:   RECORDS  deleted with the agent's other records (settings.keep records_days)
#:   CURRENT  one row per thing that exists (a job, the siren, the agent itself): replaced, never piled up
RECORDS, CURRENT = "records", "current"
KV_FAMILIES: dict[str, str] = {
    "inc:": RECORDS,                # which skill answers an alert's buttons in a chat
    "incthread:": RECORDS,          # what a chat shows of an incident (incident_thread.py)
    "inchist:": RECORDS,            # when each notice of an incident was sent, of what kind, to whom (notice.py)
    "hasent:": RECORDS,             # Home Assistant's own messages (also cleared after 24 hours as they are written)
    "saved_by_model:": RECORDS,     # a file the AI saved (its run folder is deleted with the out folder's files)
    "owner_told:": RECORDS,         # when the owner was last told of a problem (a 12-hour pause)
    "job:": CURRENT,                # a scheduled job's last slot: the Overview's "last run", one per job
    "jobrun:": CURRENT,             # a scheduled run in progress: one left at start was cut by a stop (scheduler.py)
    "chatjob:": CURRENT,            # a job asked for in a chat, in progress: one left at start was cut (chat_jobs.py)
    "siren:": CURRENT,              # when the siren must stop
    "listening_since": CURRENT,     # when the agent's record started (agent_records.listening_since)
    "unreachable:": CURRENT,        # a chat Telegram refused the last message to (the Overview names it)
}


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
        # who decided a request, as the message names them (a group's member is in no People row: approvals.Approvals.now)
        if "decided_name" not in {r[1] for r in self.db.execute("pragma table_info(approvals)")}:
            self.db.execute("alter table approvals add column decided_name text")
        self.db.commit()
        self._migrate_incident_messages()
        # ⚠️ WHEN THE RECORD STARTED, KEPT (architecture review 16): read as the oldest record kept, it moved forward every
        # night as housekeeping deleted the old ones — a monthly report then left rules out of "what did not happen"
        if self.get("listening_since") is None:
            first = self.db.execute("select min(at) from calls").fetchone()[0]
            self.put("listening_since", first or utcnow().isoformat())

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

    # A chat Telegram refused the last message to: a person who never opened a private chat with the bot, a group the
    # bot left or whose id changed. One row per chat, gone at the next message that arrives (delivery.py).
    def unreachable(self) -> dict[int, dict]:
        return {int(k.split(":", 1)[1]): json.loads(v) for k, v in self.kv_prefix("unreachable:").items()}

    def set_unreachable(self, chat: int, error: str | None) -> None:
        if error:
            self.put(f"unreachable:{int(chat)}", json.dumps({"at": utcnow().isoformat(), "error": error[:300]}))
        elif self.get(f"unreachable:{int(chat)}") is not None:
            self.drop(f"unreachable:{int(chat)}")

    # When the siren must stop (siren.py): kept here so that a restart still stops it.
    def siren_stop(self) -> str | None:
        return self.get("siren:stop_at")

    def siren_stopping(self) -> str | None:
        """Which siren the stop is for: the one turned on, whatever the rules say by then (None: before 0.12.129)."""
        return self.get("siren:entity")

    def set_siren_stop(self, at_iso: str | None, entity: str | None = None) -> None:
        if at_iso:
            self.put("siren:stop_at", at_iso)
            if entity:
                self.put("siren:entity", entity)
        else:
            self.drop("siren:stop_at")
            self.drop("siren:entity")

    # A scheduled job's last slot: claimed once per slot, by one tick.
    def claim_job_slot(self, job: str, slot_iso: str) -> bool:
        """True if this tick claims `job` for `slot_iso`; False if it already ran in that slot.
        Under the lock: a read then a write would let two ticks both claim it."""
        with self._lock:
            k = f"job:{job}"
            r = self.db.execute("select v from kv where k=?", (k,)).fetchone()
            if r and r["v"] == slot_iso:
                return False
            self.db.execute("insert into kv(k, v, at) values(?,?,?) on conflict(k) do update set v=excluded.v, at=excluded.at",
                            (k, slot_iso, utcnow().isoformat()))
            self.db.commit()
            return True

    def job_running(self, job: str, slot_iso: str | None) -> None:
        """A scheduled run of `job` for `slot_iso` started (None: it ended, however) — scheduler.Scheduler."""
        if slot_iso:
            self.put(f"jobrun:{job}", slot_iso)
        else:
            self.drop(f"jobrun:{job}")

    def jobs_cut(self) -> dict[str, str]:
        """{job: slot} of the scheduled runs a stop cut (still recorded running), read once at start and cleared."""
        cut = {k[len("jobrun:"):]: v for k, v in self.kv_prefix("jobrun:").items()}
        for k in cut:
            self.drop(f"jobrun:{k}")
        return cut

    def chat_job(self, chat: int, name: str, record: dict | None) -> None:
        """A job asked for in `chat` runs (`record`: when it started, its waiting message) — None: it ended (chat_jobs)."""
        if record is None:
            self.drop(f"chatjob:{chat}:{name}")
        else:
            self.put(f"chatjob:{chat}:{name}", json.dumps(record))

    def chat_jobs_cut(self) -> list[tuple[int, str, dict]]:
        """(chat, job, record) of the jobs asked for in a chat that a stop cut, read once at start and cleared."""
        out = []
        for k, v in self.kv_prefix("chatjob:").items():
            _fam, chat, name = k.split(":", 2)
            out.append((int(chat), name, json.loads(v)))
            self.drop(k)
        return out

    def jobs_run(self) -> list[tuple[str, str]]:
        """(job, last slot) for every scheduled job, oldest slot first."""
        return sorted(((k[len("job:"):], v) for k, v in self.kv_prefix("job:").items()), key=lambda kv: kv[1])

    # An alert's buttons in the chats: which skill answers them there, and every message carrying them.
    def set_alert_skill(self, incident: int | str, chat: int | str, skill: str) -> None:
        self.put(f"inc:{incident}:{chat}", skill)

    def alert_skill(self, incident: int | str, chat: int | str) -> str | None:
        return self.get(f"inc:{incident}:{chat}")

    # An incident's message in each chat (incident_thread.IncidentThread): ONE record per incident and chat — the
    # message shown, its text, whether it carries the buttons and whether they were settled. ⚠️ ONE RECORD, ONE
    # LIFETIME (architecture review 12, 2026-10-09): two families (incmsg: with the buttons, inclast: the latest) had
    # two lifetimes, one was never pruned, and settling one after posting the other took the owner's new buttons.
    def incident_message(self, incident: int | str, chat: int | str) -> dict | None:
        v = self.get(f"incthread:{incident}:{chat}")
        return json.loads(v) if v else None

    def set_incident_message(self, incident: int | str, chat: int | str, record: dict) -> None:
        self.put(f"incthread:{incident}:{chat}", json.dumps(record))

    def incident_history(self, incident: int | str) -> list[dict]:
        """Every notice sent about an incident, oldest first: {at, stage, to} (notice.Notices)."""
        v = self.get(f"inchist:{incident}")
        return json.loads(v) if v else []

    def set_incident_history(self, incident: int | str, history: list[dict]) -> None:
        self.put(f"inchist:{incident}", json.dumps(history))

    def incident_chats(self, incident: int | str) -> list[tuple[int, dict]]:
        """(chat, record) of every chat this incident's message is shown in."""
        return sorted((int(k.rsplit(":", 1)[1]), json.loads(v)) for k, v in self.kv_prefix(f"incthread:{incident}:").items())

    def incident_messages_owed(self) -> list[tuple[str, int, dict]]:
        """(incident, chat, record) of every copy Telegram did not take the last change of (incident_thread.catch_up)."""
        out = []
        for k, v in self.kv_prefix("incthread:").items():
            if '"owed": true' in v:                   # most records are not: read only those
                _fam, rest = k.split(":", 1)
                iid, chat = rest.rsplit(":", 1)
                out.append((int(iid) if iid.isdigit() else iid, int(chat), json.loads(v)))
        return out

    def _migrate_incident_messages(self) -> None:
        """Records of 0.12.106–0.12.114 (incmsg: with the buttons, inclast: the latest message) into one record per
        incident and chat: the newest message wins; it carries the buttons when it was among incmsg:."""
        old = self.kv_prefix("incmsg:") | self.kv_prefix("inclast:")
        if not old:
            return
        best: dict[tuple[str, str], dict] = {}
        for k, v in old.items():
            fam, iid, chat, mid = k.split(":")
            cur = best.setdefault((iid, chat), {"mid": int(mid), "text": "", "buttons": False, "settled": False})
            if int(mid) > cur["mid"]:
                cur.update(mid=int(mid), text="", buttons=False)
            if int(mid) == cur["mid"] and fam == "incmsg":
                cur.update(text=v, buttons=True)
        for (iid, chat), rec in best.items():
            if self.incident_message(iid, chat) is None:
                self.set_incident_message(iid, chat, rec)
        with self._lock:
            self.db.execute("delete from kv where k like 'incmsg:%' or k like 'inclast:%'")
            self.db.commit()

    # Home Assistant's own Telegram messages (its telegram_sent event), by the context of the automation run that
    # sent them: a VESTA rule's vesta_critical_event comes from the same run, so its incident can take them over.
    HA_SENT_KEEP_H = 24

    def note_ha_sent(self, context_id: str, chat: int | str, message_id: int | str, at: datetime | None = None) -> None:
        now = at or utcnow()
        self.put(f"hasent:{context_id}:{chat}:{message_id}", now.isoformat())
        cutoff = (now - timedelta(hours=self.HA_SENT_KEEP_H)).isoformat()
        with self._lock:
            self.db.execute("delete from kv where k like 'hasent:%' and v < ?", (cutoff,))
            self.db.commit()

    def ha_sent(self, context_id: str) -> list[tuple[int, int]]:
        """(chat, message id) of every message Home Assistant sent in this automation run."""
        out = []
        for k in self.kv_prefix(f"hasent:{context_id}:"):
            chat, mid = k.split(":")[-2:]
            out.append((int(chat), int(mid)))
        return sorted(out)

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

    def prune(self, runs_before: str, records_before: str, sessions_before: str | None = None) -> dict[str, int]:
        """Housekeeping (settings.keep): the AI runs (the Costs tab) and the other records have their own limit. A
        pending approval is kept until it has expired and the records' limit has passed; every named record family by
        KV_FAMILIES; a conversation not used since `sessions_before` (the conversations' limit: its transcript is
        deleted then) is forgotten."""
        with self._lock:
            # the Costs tab's rows (an AI run, a job made without the AI) go by the runs' limit, together
            kinds = agent_records.COSTS_KINDS
            marks = ",".join("?" * len(kinds))
            runs = self.db.execute(f"delete from calls where kind in ({marks}) and at < ?", (*kinds, runs_before)).rowcount
            other = self.db.execute(f"delete from calls where kind not in ({marks}) and at < ?",
                                    (*kinds, records_before)).rowcount
            # ⚠️ AN APPROVAL NOBODY PRESSED (architecture review 16): it was expired only when someone pressed after its time,
            # and a pending one was never deleted — every ignored approval stayed forever
            appr = self.db.execute("delete from approvals where (status != 'pending' and created_at < ?) "
                                   "or (status = 'pending' and expires_at < ?)", (records_before, records_before)).rowcount
            sess = self.db.execute("delete from sessions where last_used < ?", (sessions_before,)).rowcount \
                if sessions_before else 0
            cont = self.db.execute("delete from continuations where created_at < ?", (records_before,)).rowcount
            msgs = self.db.execute("delete from own_messages where sent_at < ?", (records_before,)).rowcount
            for prefix, life in KV_FAMILIES.items():
                if life == RECORDS:
                    msgs += self.db.execute("delete from kv where substr(k, 1, ?) = ? and at < ?",
                                            (len(prefix), prefix, records_before)).rowcount
            self.db.commit()
        return {"runs": runs, "records": other + appr + cont + msgs + sess}

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

    def approval(self, aid: str) -> dict | None:
        r = self.db.execute("select * from approvals where id=?", (aid,)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["action"] = json.loads(d["action"])
        return d

    def approvals_decided_since(self, since_iso: str) -> list[dict]:
        """The approval requests DECIDED since `since_iso` — whenever they were asked — newest decision first."""
        rows = [dict(r) for r in self.db.execute("select * from approvals where decided_at >= ? order by decided_at desc",
                                                 (since_iso,))]
        for r in rows:
            r["action"] = json.loads(r["action"])
        return rows

    def approvals_in(self, status: str) -> list[dict]:
        """The approval requests in `status` (pending, moving…), oldest first, their action read back."""
        rows = [dict(r) for r in self.db.execute("select * from approvals where status = ? order by created_at", (status,))]
        for r in rows:
            r["action"] = json.loads(r["action"])
        return rows

    def claim_approval(self, aid: str, status: str, decided_by: int, now: datetime | None = None,
                       name: str | None = None) -> bool:
        """Move a pending approval to its decision once. False if somebody else was first."""
        now = now or utcnow()
        with self._lock:
            cur = self.db.execute(
                "update approvals set status=?, decided_by=?, decided_at=?, decided_name=? where id=? and status='pending'",
                (status, decided_by, now.isoformat(), name, aid))
            self.db.commit()
            return cur.rowcount == 1

    def finish_approval(self, aid: str, status: str, result: Any) -> None:
        with self._lock:
            self.db.execute("update approvals set status=?, result=? where id=?",
                            (status, json.dumps(result, default=str), aid))
            self.db.commit()

    def expire_approval(self, aid: str) -> bool:
        """A pending request past its time is expired — once: False when a press claimed it first (architecture review
        20: the expiry wrote "nothing was done" on a request a press had just carried out)."""
        return self._end_pending(aid, "expired")

    def undeliver_approval(self, aid: str) -> bool:
        """A pending request no chat received ends "undelivered" (approvals.Approvals.ask): nothing waits for it."""
        return self._end_pending(aid, "undelivered")

    def _end_pending(self, aid: str, status: str) -> bool:
        with self._lock:
            cur = self.db.execute("update approvals set status=?, decided_at=? where id=? and status='pending'",
                                  (status, utcnow().isoformat(), aid))
            self.db.commit()
            return cur.rowcount == 1

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
