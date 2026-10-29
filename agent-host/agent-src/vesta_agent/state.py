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
from typing import Any, Iterable

from vesta_shared import agent_records
from vesta_shared.ha_client import error_chars
from vesta_shared.limits import limit

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
  used integer not null default 0,
  invoked text,                     -- the command skill the answer it continues was called for (review 32)
  inv text,                         -- and the investigation it belongs to: its offers, its page
  modes text                        -- unused since 0.12.179 (skill.yaml `modes` retired): kept for older files
);
-- a fault the AI offered in a chat, created only when a person presses its button (owner, 2026-10-11)
create table if not exists ticket_offers(
  id text primary key,
  created_at text not null,
  chat_id integer not null,
  title text not null,
  entity_id text,
  note text,
  shown integer not null default 0,
  used integer not null default 0,
  document text,                    -- its own copy of the page to keep with the fault (an investigation's report)
  inv text                          -- the investigation it came from (one offer each: fault_offers.py)
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
#:   BOUNDED  kept whatever their age, at most a set number: the oldest go as new ones are written
RECORDS, CURRENT, BOUNDED = "records", "current", "bounded"

KV_FAMILIES: dict[str, str] = {
    "inc:": RECORDS,                # which skill answers an alert's buttons in a chat
    "incthread:": RECORDS,          # what a chat shows of an incident (incident_thread.py)
    "inchist:": RECORDS,            # when each notice of an incident was sent, of what kind, to whom (notice.py)
    "hasent:": RECORDS,             # Home Assistant's own messages (also cleared after 24 hours as they are written)
    "saved_by_model:": RECORDS,     # a file the AI saved (its run folder is deleted with the out folder's files)
    "owner_told:": RECORDS,         # when the owner was last told of a problem (a 12-hour pause)
    "request_searches:": RECORDS,   # a command skill's request's web searches, for its page (command_request.py)
    "command_offer:": RECORDS,      # a command skill a reply offered: its skill, the person's question (command_offers.py)
    "chatfacts:": RECORDS,          # what reached a chat outside its conversation since the AI last answered (chat_facts.py)
    # retired (0.12.300: the Investigate button follows only the answer's own readings): the rows 0.12.297-299 wrote
    # are pruned with the records
    "session_read:": RECORDS,
    "job:": CURRENT,                # a scheduled job's last slot: the Overview's "last run", one per job
    "jobrun:": CURRENT,             # a scheduled run in progress: one left at start was cut by a stop (in_progress.py)
    "jobend:": CURRENT,             # how a scheduled job's last run ended (ended / failed / cut, when, why): in_progress.py
    "jobday:": CURRENT,             # the day a scheduled job last ran, by the job itself (claim_job_slot, review K/L)
    "chatjob:": CURRENT,            # a chat's job or question in progress: one left at start was cut (in_progress.py)
    "siren:": CURRENT,              # when the siren must stop
    "listening_since": CURRENT,     # when the agent's record started (agent_records.listening_since)
    "unreachable:": CURRENT,        # a chat Telegram refused the last message to (the Overview names it)
    # an alert's sentence pattern in a chat's language (translation.py): learnt once, used for every later card
    "phrase:": BOUNDED,
    # a sentence pattern the AI could not translate into a language (phrases.py): not asked again for a while
    "untranslated:": RECORDS,
    # an alert's device as the villa's system names it now, read when its alert arrives (translation.incident_names)
    "entname:": RECORDS,
}


def phrases_kept() -> int:
    """How many sentence patterns' translations are kept (State.keep_translation)."""
    return limit("alerts.translations_kept", 5000, unit="translations", group="keep", lo=100, hi=100000,
                 says="How many translated sentence patterns of the alert cards are kept, every language together.",
                 reached="The oldest ones go: a card that needs one again has it translated again.", told="")


def _fp_of(v: str) -> str | None:
    """The instructions a kept translation (or a failure) was made under: "" for one kept before they were recorded."""
    try:
        rec = json.loads(v)
    except ValueError:
        return None
    return str(rec.get("fp", "")) if isinstance(rec, dict) else None


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
        # an offer made before 0.12.164 has no page to keep with its fault; before 0.12.165, no investigation
        for col in ("document", "inv"):
            if col not in {r[1] for r in self.db.execute("pragma table_info(ticket_offers)")}:
                self.db.execute(f"alter table ticket_offers add column {col} text")
        # a Continue made before 0.12.165 continues no command skill
        for col in ("invoked", "inv", "modes"):
            if col not in {r[1] for r in self.db.execute("pragma table_info(continuations)")}:
                self.db.execute(f"alter table continuations add column {col} text")
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

    def runs_of(self, session: str, who: str, limit: int = 50) -> list[dict]:
        """The AI runs of a conversation or of its chat, newest first, their details read (agent_records.session_before)."""
        rows = self.db.execute("select detail from calls where kind=? and (json_extract(detail, '$.session')=? or "
                               "json_extract(detail, '$.who')=?) order by id desc limit ?",
                               (agent_records.RUN, session, who, limit))
        return [agent_records.detail(r) for r in rows]

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

    # A message a skill may rewrite later (result.message key=, result.edit): where it went in each chat, its title and
    # its "To:" as sent — Outcome.rewrite puts it back in the same layout (owner, 2026-10-20).
    def keep_message(self, key: str, chat: int, record: dict) -> None:
        self.put(f"message:{key}:{int(chat)}", json.dumps(record))

    @staticmethod
    def _fallback_key(key: str, chat: int, text: str) -> str:
        import hashlib
        return f"message_fallback:{key}:{int(chat)}:{hashlib.sha1(text.encode()).hexdigest()}"

    def fallback_told(self, key: str, chat: int, text: str) -> bool:
        """Was this backup of a rewrite (result.edit fallback) already sent in `chat`? Never twice: a result carried again
        (a retry, a restart) finds it marked."""
        return self.get(self._fallback_key(key, chat, text)) is not None

    def mark_fallback_told(self, key: str, chat: int, text: str) -> None:
        self.put(self._fallback_key(key, chat, text), "1")

    def kept_messages(self, key: str) -> dict[int, dict]:
        out = {}
        for k, v in self.kv_prefix(f"message:{key}:").items():
            try:
                out[int(k.rsplit(":", 1)[1])] = json.loads(v)
            except (ValueError, IndexError):
                continue
        return out

    # An alert card's sentence pattern in a chat's language (translation.py, owner 2026-10-23): {1}, {2}… are its
    # values. ⚠️ KEPT WHATEVER ITS AGE (the owner's "forever"), BOUNDED: the oldest go once phrases_kept() are held.
    # What is kept, asked again or forgotten is phrases.Phrases' rule; these only store it. `fp`: the instructions it
    # was translated under (phrases.fingerprint) — a row of other instructions is not this one.
    @staticmethod
    def _phrase_hash(skeleton: str, fp: str) -> str:
        import hashlib
        return hashlib.sha256(f"{fp}\n{skeleton}".encode()).hexdigest()

    def translation(self, lang: str, skeleton: str, fp: str = "") -> str | None:
        """The translation kept of `skeleton` into `lang` under instructions `fp`; None when there is none."""
        try:
            rec = json.loads(self.get(f"phrase:{lang}:{self._phrase_hash(skeleton, fp)}") or "null")
        except ValueError:
            return None
        return rec["to"] if isinstance(rec, dict) and rec.get("en") == skeleton and rec.get("fp", "") == fp \
            and isinstance(rec.get("to"), str) else None

    def keep_translation(self, lang: str, skeleton: str, text: str, fp: str = "") -> None:
        self.put(f"phrase:{lang}:{self._phrase_hash(skeleton, fp)}",
                 json.dumps({"en": skeleton, "to": text, "fp": fp}, ensure_ascii=False))
        with self._lock:
            over = self.db.execute("select count(*) from kv where substr(k, 1, 7) = 'phrase:'").fetchone()[0] - phrases_kept()
            if over > 0:
                self.db.execute("delete from kv where k in (select k from kv where substr(k, 1, 7) = 'phrase:' "
                                "order by at, rowid limit ?)", (over,))
                self.db.commit()

    def untranslated(self, lang: str, skeleton: str, fp: str = "") -> dict | None:
        """When and why `skeleton` could not be translated into `lang` last ({at, why}); None when it never failed."""
        try:
            rec = json.loads(self.get(f"untranslated:{lang}:{self._phrase_hash(skeleton, fp)}") or "null")
        except ValueError:
            return None
        return rec if isinstance(rec, dict) and rec.get("en") == skeleton and rec.get("fp", "") == fp else None

    def note_untranslated(self, lang: str, skeleton: str, fp: str, at: str, why: str, *, kind: str = "",
                          reader: int | None = None) -> None:
        rec = {"en": skeleton, "fp": fp, "at": at, "why": why, **({"kind": kind, "reader": reader} if kind else {})}
        self.put(f"untranslated:{lang}:{self._phrase_hash(skeleton, fp)}", json.dumps(rec, ensure_ascii=False))

    def clear_untranslated(self, lang: str, skeleton: str, fp: str = "") -> None:
        self.drop(f"untranslated:{lang}:{self._phrase_hash(skeleton, fp)}")

    def translations_kept(self) -> dict[str, int]:
        """How many sentence patterns are kept translated, per language (the VESTA Agent page's count)."""
        out: dict[str, int] = {}
        for (k,) in self.db.execute("select k from kv where substr(k, 1, 7) = 'phrase:'"):
            lang = k.split(":")[1]
            out[lang] = out.get(lang, 0) + 1
        return out

    def forget_translations(self, lang: str | None = None) -> int:
        """Every translation kept, and every failure remembered, of `lang` (None: of every language) deleted: the next
        card asks the AI again. How many translations went."""
        tail = f"{lang}:" if lang else ""
        with self._lock:
            n = self.db.execute("delete from kv where substr(k, 1, ?) = ?", (7 + len(tail), f"phrase:{tail}")).rowcount
            self.db.execute("delete from kv where substr(k, 1, ?) = ?", (13 + len(tail), f"untranslated:{tail}"))
            self.db.commit()
        return n

    def keep_only_translations_of(self, fp: str) -> int:
        """The translations and failures of other instructions than `fp` deleted (phrases.Phrases: they are never
        read again). How many rows went."""
        with self._lock:
            gone = [k for k, v in self.db.execute("select k, v from kv where substr(k, 1, 7) = 'phrase:' "
                                                  "or substr(k, 1, 13) = 'untranslated:'")
                    if _fp_of(v) != fp]
            self.db.executemany("delete from kv where k=?", [(k,) for k in gone])
            self.db.commit()
        return len(gone)

    # An alert's device as the villa's system names it now (its friendly name), read when its alert arrives: a name
    # in the alert's text is a value, never words to translate (translation.incident_names). One row per entity.
    def note_entity_names(self, names: dict[str, str]) -> None:
        for eid, name in names.items():
            self.put(f"entname:{eid}", name)

    def all_entity_names(self) -> list[str]:
        """Every name the villa's system gave an alert's device (translation.villa_names: a villa message's values)."""
        return sorted(set(self.kv_prefix("entname:").values()))

    def entity_names(self, entity_ids: Iterable[str]) -> dict[str, str]:
        out = {}
        for eid in entity_ids:
            v = self.get(f"entname:{eid}")
            if v:
                out[eid] = v
        return out

    # A chat Telegram refused the last message to: a person who never opened a private chat with the bot, a group the
    # bot left or whose id changed. One row per chat, gone at the next message that arrives (delivery.py).
    def unreachable(self) -> dict[int, dict]:
        return {int(k.split(":", 1)[1]): json.loads(v) for k, v in self.kv_prefix("unreachable:").items()}

    def set_unreachable(self, chat: int, error: str | None) -> None:
        if error:
            self.put(f"unreachable:{int(chat)}", json.dumps({"at": utcnow().isoformat(), "error": error[:error_chars()]}))
        elif self.get(f"unreachable:{int(chat)}") is not None:
            self.drop(f"unreachable:{int(chat)}")

    # The last question collected from the tablets (tablet.py): kept here so that a restart answers each once.
    def tablet_after(self) -> int | None:
        """The last of the tablets' questions collected from the Kiosk (tablet.Tablet.collect): a restart never answers
        one twice. None: none collected yet (or the Kiosk's store started again)."""
        got = self.get("tablet.inbox_after")
        return int(got) if got and str(got).lstrip("-").isdigit() else None

    def set_tablet_after(self, seq: int | None) -> None:
        if seq is None:
            self.drop("tablet.inbox_after")
        else:
            self.put("tablet.inbox_after", str(int(seq)))

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
    def claim_job_slot(self, job: str, slot_iso: str, ident: str | None = None) -> bool:
        """True if this tick claims `job` for `slot_iso`; False if it already ran in that slot.
        Under the lock: a read then a write would let two ticks both claim it.

        `ident`: the job itself (scheduler.job_ident: its skill and name). ⚠️ A TIME MOVED AFTER IT RAN IS THE SAME JOB
        (review J, 0.12.341): the key holds the time, so a report moved from 07:00 to 07:15 at 07:20 ran again. ⚠️ BY
        THE JOB, NEVER BY ITS PLACE (review K, 0.12.345): that check went by the entry's place in the list, so deleting
        the daily report made the weekly one, now first, read the daily's "ran today" and not run. The job's day is kept
        under its own name ("jobday:")."""
        with self._lock:
            k = f"job:{job}"
            r = self.db.execute("select v from kv where k=?", (k,)).fetchone()
            if r and r["v"] == slot_iso:
                return False
            day = slot_iso[:10]
            if ident is not None:
                d = self.db.execute("select v from kv where k=?", (f"jobday:{ident}",)).fetchone()
                if d and d["v"] == day:
                    return False
                self.db.execute("insert into kv(k, v, at) values(?,?,?) on conflict(k) do update set v=excluded.v, at=excluded.at",
                                (f"jobday:{ident}", day, utcnow().isoformat()))
            self.db.execute("insert into kv(k, v, at) values(?,?,?) on conflict(k) do update set v=excluded.v, at=excluded.at",
                            (k, slot_iso, utcnow().isoformat()))
            self.db.commit()
            return True

    # Work in progress (in_progress.py owns what each row means; the keys are here, unchanged since 0.12.144/0.6.210)
    def keep_run(self, job: str, value: str | None) -> None:
        """A scheduled run of `job` in progress (its slot; None: nothing left to take up)."""
        if value is None:
            self.drop(f"jobrun:{job}")
        else:
            self.put(f"jobrun:{job}", value)

    def runs_kept(self) -> dict[str, str]:
        """{job: value} of every scheduled run's row."""
        return {k[len("jobrun:"):]: v for k, v in self.kv_prefix("jobrun:").items()}

    def keep_run_end(self, job: str, value: str) -> None:
        """How `job`'s last scheduled run ended (in_progress.py writes it, its json; one row per job)."""
        self.put(f"jobend:{job}", value)

    def run_ends(self) -> dict[str, str]:
        """{job: value} of every scheduled job's last end."""
        return {k[len("jobend:"):]: v for k, v in self.kv_prefix("jobend:").items()}

    def keep_chat_work(self, chat: int, name: str, value: str | None) -> None:
        """A chat's job or question in progress (its record, json; None: nothing left to take up)."""
        if value is None:
            self.drop(f"chatjob:{chat}:{name}")
        else:
            self.put(f"chatjob:{chat}:{name}", value)

    def chat_work_kept(self) -> list[tuple[int, str, str]]:
        """(chat, name, value) of every chat's job or question in progress."""
        out = []
        for k, v in self.kv_prefix("chatjob:").items():
            _fam, chat, name = k.split(":", 2)
            out.append((int(chat), name, v))
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

    def incident_runs(self, incident: int | str) -> list[str]:
        """The villa's automation runs incident `incident` took over (their context ids), oldest first."""
        v = self.get(f"incruns:{incident}")
        return json.loads(v) if v else []

    def add_incident_run(self, incident: int | str, run: str) -> bool:
        """Run `run` belongs to incident `incident` now; False when it already did."""
        runs = self.incident_runs(incident)
        if run in runs:
            return False
        self.put(f"incruns:{incident}", json.dumps(runs + [run]))
        return True

    def incident_history(self, incident: int | str) -> list[dict]:
        """Every notice sent about an incident, oldest first: {at, stage, to} (notice.Notices)."""
        v = self.get(f"inchist:{incident}")
        return json.loads(v) if v else []

    def set_incident_history(self, incident: int | str, history: list[dict]) -> None:
        self.put(f"inchist:{incident}", json.dumps(history))

    def incident_histories_since(self, since_iso: str | None) -> dict[int, list[dict]]:
        """{incident: its history} of every incident whose history was written at or after `since_iso` (every one when
        None): a history last written before then has no line after it (chat_facts.ChatFacts reads this)."""
        rows = self.db.execute("select k, v from kv where substr(k, 1, 8)='inchist:'" +
                               (" and at >= ?" if since_iso else ""), (since_iso,) if since_iso else ())
        out = {}
        for r in rows:
            iid = r["k"][len("inchist:"):]
            if iid.isdigit():
                out[int(iid)] = json.loads(r["v"])
        return out

    # What reached a chat outside its conversation since the AI last answered there (chat_facts.py): ONE row per chat,
    # {"told": when the AI was last told, "items": [{"at", "said"}]}, replaced, its items capped.
    def chat_facts(self, chat: int) -> dict:
        v = self.get(f"chatfacts:{int(chat)}")
        return json.loads(v) if v else {}

    def set_chat_facts(self, chat: int, record: dict) -> None:
        self.put(f"chatfacts:{int(chat)}", json.dumps(record))

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
    @staticmethod
    def ha_sent_keep_h() -> int:
        return limit("alerts.villa_messages_kept_hours", 24, unit="hours", group="keep", lo=1, hi=720,
                     says="How long the agent remembers the villa's own Telegram alerts, to put its alert story under "
                          "them.",
                     reached="An older one of the villa's alerts gets its story in a new message.", told="")

    # The villa's handovers taken in (app.on_critical), by their own `incident_id` and phase: one taken in live is never
    # taken in again by the catch-up at start (missed_alerts.py). Kept the villa messages' hours, as their messages are.
    def alert_seen(self, key: str, at: datetime | None = None) -> bool:
        """Whether this handover was taken in already; it counts as taken in from now."""
        now = at or utcnow()
        if self.get(f"alertseen:{key}") is not None:
            return True
        self.put(f"alertseen:{key}", now.isoformat())
        cutoff = (now - timedelta(hours=self.ha_sent_keep_h())).isoformat()
        with self._lock:
            self.db.execute("delete from kv where k like 'alertseen:%' and v < ?", (cutoff,))
            self.db.commit()
        return False

    def note_ha_sent(self, context_id: str, chat: int | str, message_id: int | str, at: datetime | None = None) -> None:
        now = at or utcnow()
        self.put(f"hasent:{context_id}:{chat}:{message_id}", now.isoformat())
        cutoff = (now - timedelta(hours=self.ha_sent_keep_h())).isoformat()
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

    def keep_request_searches(self, inv: str, queries: list[str]) -> None:
        """A command skill's request's web searches so far (command_request.Searches): its page must list their sources,
        whichever of its turns made them — an update in between included."""
        self.put(f"request_searches:{inv}", json.dumps(list(queries)))

    def request_searches(self, inv: str) -> list[str]:
        try:
            kept = json.loads(self.get(f"request_searches:{inv}") or "[]")
        except ValueError:
            return []
        return [str(q) for q in kept] if isinstance(kept, list) else []

    # A command skill a chat reply offered (command_offers.py): the button's data holds only its id — Telegram allows 64
    # bytes, the person's question is longer.
    def new_command_offer(self, chat: int, skill: str, question: str, by: int | None, about: str = "") -> str:
        """`about`: what the turn it came under read (command_offers.about), passed to the request at the press."""
        oid = secrets.token_urlsafe(9)
        self.put(f"command_offer:{oid}", json.dumps({"chat": int(chat), "skill": skill, "question": question, "by": by,
                                                     "about": about, "used": False}))
        return oid

    def command_offer_kept(self, oid: str) -> bool:
        """Whether offer `oid` is still on record (used or not): a press of one pruned with the records is told so."""
        return self.get(f"command_offer:{oid}") is not None

    def command_offer(self, oid: str, chat: int) -> dict | None:
        """The offer pressed in `chat`, still unused; None when it is not this chat's, gone, or already pressed."""
        try:
            o = json.loads(self.get(f"command_offer:{oid}") or "null")
        except ValueError:
            return None
        return o if isinstance(o, dict) and o.get("chat") == int(chat) and not o.get("used") else None

    def claim_command_offer(self, oid: str, chat: int) -> dict | None:
        """The offer, used up by this press — None when another press already took it (a double tap, a second person):
        one request per offer, like start_job's "already being made"."""
        with self._lock:
            r = self.db.execute("select v from kv where k=?", (f"command_offer:{oid}",)).fetchone()
            try:
                o = json.loads(r["v"]) if r else None
            except ValueError:
                o = None
            if not isinstance(o, dict) or o.get("chat") != int(chat) or o.get("used"):
                return None
            self.db.execute("update kv set v=? where k=?", (json.dumps({**o, "used": True}), f"command_offer:{oid}"))
            self.db.commit()
        return o

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

    def prune(self, runs_before: str, records_before: str, sessions_before: str | None = None,
              open_incidents: Iterable[int | str] = ()) -> dict[str, int]:
        """Housekeeping (settings.keep): the AI runs (the Costs tab) and the other records have their own limit. A
        pending approval is kept until it has expired and the records' limit has passed; every named record family by
        KV_FAMILIES; a conversation not used since `sessions_before` (the conversations' limit: its transcript is
        deleted then) is forgotten.

        ⚠️ AN OPEN ALERT KEEPS ITS RECORDS (architecture review 5, 2026-10-13): pruned by age alone, an alert still open
        past records_days lost its messages — Done did nothing (not the agent's message any more) and a close in the
        Kiosk could not take its buttons off. `open_incidents`: their records and messages wait for the close."""
        with self._lock:
            kept_keys, kept_msgs = set(), set()
            for iid in open_incidents:
                kept_keys |= set(self.kv_prefix(f"inc:{iid}:")) | {f"inchist:{iid}"}
                for k, v in self.kv_prefix(f"incthread:{iid}:").items():
                    kept_keys.add(k)
                    kept_msgs.add((int(k.rsplit(":", 1)[1]), int(json.loads(v).get("mid") or 0)))
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
            cont += self.db.execute("delete from ticket_offers where created_at < ?", (records_before,)).rowcount
            old = [(r["chat_id"], r["message_id"]) for r in self.db.execute(
                "select chat_id, message_id from own_messages where sent_at < ?", (records_before,))]
            gone = [m for m in old if m not in kept_msgs]
            self.db.executemany("delete from own_messages where chat_id=? and message_id=?", gone)
            msgs = len(gone)
            for prefix, life in KV_FAMILIES.items():
                if life == RECORDS:
                    keys = [r["k"] for r in self.db.execute("select k from kv where substr(k, 1, ?) = ? and at < ?",
                                                            (len(prefix), prefix, records_before)) if r["k"] not in kept_keys]
                    self.db.executemany("delete from kv where k=?", [(k,) for k in keys])
                    msgs += len(keys)
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

    # The answer that told the person who asked of a request shown elsewhere (approvals.Approvals.answered): rewritten
    # with each step of the request, then forgotten once it is settled.
    def keep_approval_answer(self, aid: str, chat: int, mid: int, text: str) -> None:
        self.put(f"approval_answer:{aid}", json.dumps({"chat": int(chat), "mid": int(mid), "text": text}))

    def approval_answer(self, aid: str) -> dict | None:
        got = self.get(f"approval_answer:{aid}")
        return json.loads(got) if got else None

    def drop_approval_answer(self, aid: str) -> None:
        self.drop(f"approval_answer:{aid}")

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
    def new_continuation(self, chat_id: int, session_id: str, requested_by: int | None,
                         invoked: str | None = None, inv: str | None = None) -> str:
        """⚠️ A CONTINUE CARRIES WHAT IT CONTINUES (review 32): the command skill its answer was called for and the
        investigation it belongs to — kept per chat, a "thanks" in between made the old Continue lose its skill."""
        cid = secrets.token_urlsafe(9)
        with self._lock:
            self.db.execute("insert into continuations(id, created_at, chat_id, session_id, requested_by, invoked, inv) "
                            "values(?,?,?,?,?,?,?)",
                            (cid, utcnow().isoformat(), int(chat_id), session_id, requested_by, invoked, inv))
            self.db.commit()
        return cid

    # ------------------------------------------------------------------ a fault offered in a chat
    def new_ticket_offer(self, chat_id: int, title: str, entity_id: str | None, note: str | None,
                         inv: str | None = None) -> str:
        oid = secrets.token_urlsafe(9)
        with self._lock:
            self.db.execute("insert into ticket_offers(id, created_at, chat_id, title, entity_id, note, inv) "
                            "values(?,?,?,?,?,?,?)", (oid, utcnow().isoformat(), int(chat_id), title, entity_id, note, inv))
            self.db.commit()
        return oid

    def pending_offers(self, chat_id: int) -> list[dict]:
        """The faults offered in this chat that no message carries yet (fault_offers.FaultOffers shows them)."""
        with self._lock:
            return [dict(r) for r in self.db.execute("select * from ticket_offers where chat_id=? and shown=0 "
                                                      "order by created_at", (int(chat_id),))]

    def offers_shown(self, ids: list[str]) -> None:
        """⚠️ SHOWN ONCE IT ARRIVED (review 32): marked before the answer went out, an answer Telegram refused lost its
        offer for good."""
        with self._lock:
            self.db.executemany("update ticket_offers set shown=1 where id=?", [(i,) for i in ids])
            self.db.commit()

    def offers_of(self, inv: str) -> int:
        """How many faults one investigation offered (one each: a Continue after a limit offered a second)."""
        with self._lock:
            return self.db.execute("select count(*) from ticket_offers where inv=?", (inv,)).fetchone()[0]

    def set_offer_document(self, oid: str, path: str) -> None:
        with self._lock:
            self.db.execute("update ticket_offers set document=? where id=?", (path, oid))
            self.db.commit()

    def claim_ticket_offer(self, oid: str, chat_id: int) -> dict | None:
        """The offer, claimed for one press (None: no such offer, or pressed already); `release_ticket_offer`
        gives it back when the Kiosk did not record the fault, so the button still works."""
        with self._lock:
            n = self.db.execute("update ticket_offers set used=1 where id=? and chat_id=? and used=0", (oid, int(chat_id))).rowcount
            self.db.commit()
            r = self.db.execute("select * from ticket_offers where id=?", (oid,)).fetchone() if n else None
        return dict(r) if r else None

    def release_ticket_offer(self, oid: str) -> None:
        with self._lock:
            self.db.execute("update ticket_offers set used=0 where id=?", (oid,))
            self.db.commit()

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
