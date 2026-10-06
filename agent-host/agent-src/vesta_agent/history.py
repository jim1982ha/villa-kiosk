"""Changes made on the VESTA Agent page, newest first, each one undoable (0.6.42).

Every save of the Rules (forms or file) and of a skill (a file, a switch, a command, the release's version, an
import) is one row: when, where, what changed in words, and the file's text before and after. An update that
replaced a starter skill is a row too (written by the agent, "Release"), without Undo.

⚠️ UNDO GOES THROUGH THE SAME CHECKS AS A SAVE, AND ONLY FROM WHERE THE CHANGE LEFT IT: the page writes the
"before" back only while the file still holds the "after" (else a later change would be lost) — the same rule as
a save that names the version it started from. An undo is itself a row.

Kept as long as the agent's other records (policy.yaml settings.keep.records_days).
"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

import yaml

SCHEMA = """
create table if not exists changes(
  id integer primary key autoincrement,
  at text not null,
  place text not null,            -- Rules | Skills | Release | Import
  what text not null,             -- in words
  target text not null,           -- json: {"kind": "policy"} | {"kind": "file", "skill": .., "path": ..} | {"kind": "folder", ...}
  before blob,                    -- the text (or, for a folder, where the old one was moved) before
  after blob,
  undone_by integer
);
"""
FILE_NAME = "page_history.sqlite"


class History:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self.db.commit()

    def record(self, place: str, what: str, target: dict, before, after, at: str | None = None) -> int:
        with self._lock:
            c = self.db.execute("insert into changes(at, place, what, target, before, after) values(?,?,?,?,?,?)",
                                (at or datetime.now(timezone.utc).isoformat(), place, what, json.dumps(target),
                                 before, after))
            self.db.commit()
            return c.lastrowid

    def rows(self, limit: int = 200) -> list[dict]:
        out = []
        for r in self.db.execute("select id, at, place, what, target, undone_by, before is not null as had_before, "
                                 "after is not null as had_after from changes order by id desc limit ?", (limit,)):
            d = dict(r)
            d["target"] = json.loads(d["target"])
            out.append(d)
        return out

    def get(self, cid: int) -> dict | None:
        r = self.db.execute("select * from changes where id=?", (cid,)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["target"] = json.loads(d["target"])
        return d

    def mark_undone(self, cid: int, by: int) -> None:
        with self._lock:
            self.db.execute("update changes set undone_by=? where id=?", (by, cid))
            self.db.commit()

    def prune(self, days: int, now: datetime | None = None) -> int:
        before = ((now or datetime.now(timezone.utc)) - timedelta(days=days)).isoformat()
        with self._lock:
            n = self.db.execute("delete from changes where at < ?", (before,)).rowcount
            self.db.commit()
        return n


# ---------------------------------------------------------------------- what changed, in words
def policy_change(before: str, after: str, limit: int = 3) -> str:
    """The rules' change as a line, in the page's words: "Start a report when asked in a chat: on → off; Home Assistant
    tools the AI may read with: + ha_get_todo"."""
    try:
        a, b = yaml.safe_load(before or "") or {}, yaml.safe_load(after or "") or {}
    except yaml.YAMLError:
        return "the file was rewritten"
    out: list[str] = []
    _diff("", a, b, out)
    if not out:
        return "comments or layout only"
    return "; ".join(out[:limit]) + (f"; and {len(out) - limit} more" if len(out) > limit else "")


def _word(v) -> str:
    if v is True:
        return "on"
    if v is False:
        return "off"
    if v is None:
        return "—"
    if isinstance(v, (dict, list)):
        return f"{len(v)} item{'s' if len(v) != 1 else ''}"
    return str(v)


#: The rules' sections as the page names them (a path the table does not know is shown as written).
WORDS = {"act_enabled": "The agent may act on the villa", "approval_ttl_minutes": "An Approve button works for (minutes)",
         "people": "People", "chats.owner": "Owner chat", "chats.fm": "Facility manager chat",
         "allowed_services": "What the agent may do", "owner_only_entities": "Only the owner may approve",
         "excluded_entities": "Left alone", "siren_entity": "Siren", "siren_auto_off_min": "Siren stops after (minutes)",
         "switch_entities": "Switches it may turn on or off", "scene_allowlist": "Scenes it may start",
         "script_allowlist": "Scripts it may run", "button_allowlist": "Buttons it may press",
         "ha_read_tools": "Home Assistant tools the AI may read with", "skills_off": "Skills switched off",
         "settings.profile": "Brain for chat answers", "settings.reply_limit_usd": "Limit per reply (US$)",
         "settings.web_search": "Web search", "settings.conversation_reset": "New conversation"}


def _say(path: str) -> str:
    from .tool_access import HA_GROUPS, OWN
    if path in WORDS:
        return WORDS[path]
    parts = path.split(".")
    if parts[0] == "agent_tools" and len(parts) == 2 and parts[1] in OWN:
        return OWN[parts[1]][0]
    if parts[:2] == ["tool_access", "fm"] and len(parts) == 3:
        g = HA_GROUPS.get(parts[2], (OWN.get(parts[2], (parts[2],))[0],))[0]
        return f"The facility manager may use: {g}"
    if parts[:2] == ["settings", "jobs"] and len(parts) >= 3:
        return f"{parts[2]}: " + {"profile": "brain", "limit_usd": "limit per run (US$)"}.get(parts[-1], parts[-1]) \
            if len(parts) == 4 else f"AI job {parts[2]}"
    if parts[:2] == ["settings", "keep"] and len(parts) == 3:
        return f"Records kept: {parts[2].replace('_', ' ')}"
    if parts[0] == "allowed_services" and len(parts) >= 2:
        return f"What the agent may do: {'.'.join(parts[1:])}"
    return path


def _diff(path: str, a, b, out: list[str]) -> None:
    if isinstance(a, dict) and b is None or a is None and isinstance(b, dict):
        a, b = a or {}, b or {}                          # a section added or removed: say what is in it
    if isinstance(a, list) and b is None or a is None and isinstance(b, list):
        a, b = a or [], b or []
    if path.startswith(("agent_tools.", "tool_access.")):
        a, b = (True if a is None else a), (True if b is None else b)     # absent there means on
    if isinstance(a, dict) and isinstance(b, dict):
        for k in list(a) + [k for k in b if k not in a]:
            _diff(f"{path}.{k}" if path else str(k), a.get(k), b.get(k), out)
    elif isinstance(a, list) and isinstance(b, list) and all(isinstance(x, (str, int)) for x in a + b):
        added, gone = [x for x in b if x not in a], [x for x in a if x not in b]
        if added or gone:
            out.append(f"{_say(path)}: " + ", ".join([f"+ {x}" for x in added] + [f"− {x}" for x in gone]))
    elif a != b:
        out.append(f"{_say(path)}: {_word(a)} → {_word(b)}")


def file_change(path: str, before: str | None, after: str | None) -> str:
    if before is None:
        return f"{path} created"
    if after is None:
        return f"{path} deleted"
    old, new = before.splitlines(), after.splitlines()
    import difflib
    plus = minus = 0
    for line in difflib.unified_diff(old, new, lineterm="", n=0):
        if line.startswith("+") and not line.startswith("+++"):
            plus += 1
        elif line.startswith("-") and not line.startswith("---"):
            minus += 1
    return f"{path} edited (+{plus} −{minus} lines)"
