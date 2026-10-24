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
import re
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

import yaml

from vesta_shared.limits import limit

# the rules' settings as the page names them: policy.FIELDS, the one table (a path it does not know is shown as
# written). This file kept its own copy, and two labels had drifted from the page's.
from .places import title
from .policy import WORDS, Language

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


COUNTED = re.compile(r"\d+ items? → \d+ items?")


def _text(v) -> str:
    return v.decode("utf-8", "replace") if isinstance(v, bytes) else (v or "")


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

    #: where a change was made, and its chip's colour on the page (the page held this table, architecture review 9)
    CHIPS = {"Rules": "", "Limits": "", "Skills": "warn", "Release": "gray", "Import": "", "Undo": "gray"}

    def rows(self, most: int | None = None) -> list[dict]:
        out = []
        for r in self.db.execute("select id, at, place, what, target, undone_by, before is not null as had_before, "
                                 "after is not null as had_after from changes order by id desc limit ?", (most or limit(
                                     "page.changes_listed", 200, unit="changes", group="keep", lo=20, hi=5000,
                                     says="Changes made on the VESTA Agent page that Overview › Page changes lists.",
                                     reached="Older changes are not listed.", told=""),)):
            d = dict(r)
            d["target"] = json.loads(d["target"])
            d["chip"] = self.CHIPS.get(d["place"], "")
            if d["target"].get("kind") == "policy" and COUNTED.search(d["what"] or ""):
                # a line recorded before 0.12.341 said only "People: 3 items → 3 items": said again from its texts
                full = self.get(d["id"]) or {}
                d["what"] = policy_change(_text(full.get("before")), _text(full.get("after")))
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
    if parts[:2] == ["settings", "skill_brains"] and len(parts) == 3:
        return f"Brain of the {parts[2]} skill's AI jobs"
    if parts[:2] == ["settings", "skill_ai"] and len(parts) >= 3:
        return (f"{parts[2]} skill's AI jobs: " + {"brain": "brain", "limit_usd": "limit per run (US$)"}.get(parts[3], parts[3])
                if len(parts) == 4 else f"Brain and limit of the {parts[2]} skill's AI jobs")
    if parts[:2] == ["settings", "keep"] and len(parts) == 3:
        return f"Records kept: {parts[2].replace('_', ' ')}"
    if parts[0] == "allowed_services" and len(parts) >= 2:
        return f"{title('actions')}: {'.'.join(parts[1:])}"
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
    elif isinstance(a, list) and isinstance(b, list) and (a or b) and all(isinstance(x, dict) for x in a + b):
        _rows(path, a, b, out)
    elif isinstance(a, list) and isinstance(b, list) and all(isinstance(x, (str, int)) for x in a + b):
        added, gone = [x for x in b if x not in a], [x for x in a if x not in b]
        if added or gone:
            out.append(f"{_say(path)}: " + ", ".join([f"+ {x}" for x in added] + [f"− {x}" for x in gone]))
    elif a != b:
        out.append(f"{_say(path)}: {_word(a)} → {_word(b)}")


def _named(row: dict, i: int) -> str:
    return str(row.get("name") or row.get("entity_id") or row.get("telegram_id") or f"row {i + 1}")


def _identity(row: dict, i: int):
    if row.get("telegram_id") is not None:
        return ("person", str(row.get("telegram_id")), str(row.get("role") or ""))
    return ("name", _named(row, i))


def _rows(path: str, a: list[dict], b: list[dict], out: list[str]) -> None:
    """A list of rows (People): each row by its name, what changed in it said field by field — "People › Luc:
    language fr → en", "People: + Wayan", "People: − Luc".

    ⚠️ NEVER "3 items → 3 items" (owner, 2026-10-24: Page changes said only that for a person's language changed). Rows
    are matched by their name when every name is told apart, else by their place."""
    names_a, names_b = [_named(r, i) for i, r in enumerate(a)], [_named(r, i) for i, r in enumerate(b)]
    # ⚠️ A ROW IS WHO IT IS, NOT WHAT IT IS CALLED (review K, 0.12.345): two groups named alike, the first removed, read
    # as three wrong changes ending "− Luc" while Luc stayed. A person is their Telegram id and role; a row without them,
    # its name; only rows that repeat even that are matched by their place.
    ids_a, ids_b = [_identity(r, i) for i, r in enumerate(a)], [_identity(r, i) for i, r in enumerate(b)]
    if len(set(ids_a)) == len(a) and len(set(ids_b)) == len(b):
        name_of = {**dict(zip(ids_a, names_a)), **dict(zip(ids_b, names_b))}
        pairs = [(name_of[k], a[ids_a.index(k)] if k in ids_a else None, b[ids_b.index(k)] if k in ids_b else None)
                 for k in ids_a + [k for k in ids_b if k not in ids_a]]
    else:
        pairs = [(names_b[i] if i < len(b) else names_a[i], a[i] if i < len(a) else None, b[i] if i < len(b) else None)
                 for i in range(max(len(a), len(b)))]
    said = len(out)
    for name, x, y in pairs:
        if x is None:
            out.append(f"{_say(path)}: + {name}")
        elif y is None:
            out.append(f"{_say(path)}: − {name}")
        elif x != y:
            inner: list[str] = []
            for k in list(x) + [k for k in y if k not in x]:
                if x.get(k) != y.get(k):
                    shown = (lambda v: Language.name_of(v) if v else _word(v)) if k == "language" else _word
                    inner.append(f"{k.replace('_', ' ')} {shown(x.get(k))} → {shown(y.get(k))}")
            out.append(f"{_say(path)} › {name}: " + ", ".join(inner))
    if len(out) == said and a != b:
        out.append(f"{_say(path)}: order changed")


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
