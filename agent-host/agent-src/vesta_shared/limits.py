"""Every limit written in the code, declared where it applies and set in one file: the VESTA Agent page's Limits tab.

⚠️ ONE PLACE FOR EVERY LIMIT (owner, 2026-10-20: "define them centrally and exhaustively"). About ninety numbers
narrowed what the AI reads or what a skill reports — a page of 100 readings, the first 12 devices, 8 lines of a digest —
some typed into the code where nobody could see or change them. Each is now a call at the line it limits:

    MAX_LINES = limit("investigate.max_lines", 120, unit="lines", group="ai", lo=10, hi=2000,
                      says="Lines of one device's timeline an investigation hands the AI.",
                      reached="The rest is counted in an '… N more' line.")

`limit()` answers the villa's value from limits.yaml (the agent's config folder, beside policy.yaml) or the default
written there. The page finds every limit by READING THE SOURCE (scan): a limit declared in code is on the page by
construction, and tests/test_limits.py refuses a release that cuts a list by a bare number instead.

The key and the default are literals (the scan reads them without running anything). A long-running process reads
the file again when it changes (its modification time), so a value set on the page applies without a restart; a skill
script reads it when it starts.
"""
from __future__ import annotations

import re

import ast
import functools
import os
from dataclasses import dataclass, field
from typing import Any, Iterable

import yaml

FILE = "limits.yaml"
#: What a limit is about, in the order the page shows them
GROUPS = {
    "read": "Reading the villa's data",
    "ai": "What the AI receives",
    "run": "One AI run",
    "detect": "What counts as a problem",
    "text": "Text and messages",
    "keep": "How long things are kept",
}

_cache: dict[str, Any] = {"path": None, "mtime": None, "values": {}}


def path() -> str:
    """limits.yaml: VESTA_LIMITS, else beside policy.yaml (VESTA_POLICY, the scripts' environment), else the agent's
    config folder."""
    if os.environ.get("VESTA_LIMITS"):
        return os.environ["VESTA_LIMITS"]
    if os.environ.get("VESTA_POLICY"):
        return os.path.join(os.path.dirname(os.environ["VESTA_POLICY"]), FILE)
    return os.path.join(os.environ.get("VESTA_AGENT_CONFIG_DIR") or "/config/agent", FILE)


def values(p: str | None = None) -> dict[str, Any]:
    """The values limits.yaml sets ({} when it sets none or cannot be read), read again when the file changes."""
    p = p or path()
    try:
        m = os.path.getmtime(p)
    except OSError:
        return {}
    if _cache["path"] != p or _cache["mtime"] != m:
        try:
            with open(p, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        except (OSError, yaml.YAMLError):
            data = {}
        _cache.update(path=p, mtime=m, values=data if isinstance(data, dict) else {})
    return _cache["values"]


#: A time of day a limit can be ("01:30"): its default written so, its value the same shape, villa time
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def is_time(default) -> bool:
    """A limit whose value is a time of day ("01:30", villa time; owner, 2026-10-24: "01:30" written in a skill's guide
    could not be changed)."""
    return isinstance(default, str) and bool(_TIME.match(default))


def _fits(v, default, lo, hi) -> bool:
    if is_time(default):
        return isinstance(v, str) and bool(_TIME.match(v.strip()))
    if isinstance(default, list):
        return isinstance(v, list) and all(isinstance(x, str) for x in v)
    if isinstance(default, bool) or isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    return (lo is None or v >= lo) and (hi is None or v <= hi)


def limit(key: str, default, *, unit: str = "", group: str = "read", lo=None, hi=None, says: str = "",
          reached: str = "", told: str = ""):
    """The villa's value of this limit (limits.yaml), else `default`. A value of the wrong kind or outside [lo, hi]
    is the default (the page refuses to write one). `told`: who learns it was reached — "person", "ai", or "" (no one).
    The other arguments are what the page says of it; nothing here reads them."""
    v = values().get(key, default)
    if not _fits(v, default, lo, hi):
        return default
    if is_time(default):
        return v.strip()
    return int(v) if isinstance(default, int) and not isinstance(default, bool) and float(v).is_integer() else v


# ------------------------------------------------------------------ the page's list, read from the source
@dataclass
class Declared:
    key: str
    default: Any
    unit: str = ""
    group: str = "read"
    lo: Any = None
    hi: Any = None
    says: str = ""
    reached: str = ""
    told: str = ""
    sites: list[str] = field(default_factory=list)     # "file:line" of each call


def _literal(node):
    try:
        return ast.literal_eval(node)
    except (ValueError, SyntaxError, TypeError):
        return _Bad


class _Bad:
    pass


def calls(tree: ast.AST) -> Iterable[ast.Call]:
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None
            if name == "limit":
                yield node


@functools.lru_cache(maxsize=4096)
def _declared_in(fp: str, _mtime_ns: int, _size: int) -> tuple:
    """One file's limit() calls, (line, key, default, meta) — key None for one whose key or default is not written.
    ⚠️ PARSED ONCE PER VERSION OF THE FILE (review K, 0.12.345): every reading of a skill's guide by the AI parsed the
    whole source tree, about a second during which the agent did nothing else; the file's mtime and size key it."""
    try:
        with open(fp, encoding="utf-8") as f:
            tree = ast.parse(f.read(), fp)
    except (OSError, SyntaxError, ValueError):
        return ()
    out = []
    for c in calls(tree):
        if len(c.args) < 2:
            continue                     # the definition's own recursion, or a call that is not ours
        key, default = _literal(c.args[0]), _literal(c.args[1])
        if not isinstance(key, str) or default is _Bad:
            out.append((c.lineno, None, None, ()))
            continue
        meta = {k.arg: _literal(k.value) for k in c.keywords if k.arg}
        meta = {k: v for k, v in meta.items() if v is not _Bad and k in Declared.__dataclass_fields__}
        out.append((c.lineno, key, default, tuple(meta.items())))
    return tuple(out)


def scan(roots: Iterable[str]) -> tuple[dict[str, Declared], list[str]]:
    """Every limit() call in the .py files under `roots`: {key: Declared}, and the problems found (a key or default
    that is not a literal, one key declared with two defaults)."""
    found: dict[str, Declared] = {}
    problems: list[str] = []
    for root in roots:
        for dirpath, dirnames, files in os.walk(root):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith((".", "__")) and d != "tests")
            for fn in sorted(files):
                if not fn.endswith(".py"):
                    continue
                fp = os.path.join(dirpath, fn)
                try:
                    st = os.stat(fp)
                except OSError:
                    continue
                for lineno, key, default, meta in _declared_in(fp, st.st_mtime_ns, st.st_size):
                    site = f"{os.path.relpath(fp, root)}:{lineno}"
                    if key is None:
                        problems.append(f"{site}: limit() needs a written key and default")
                        continue
                    meta = dict(meta)
                    d = found.get(key)
                    if d is None:
                        found[key] = Declared(key, default, sites=[site], **meta)
                    else:
                        d.sites.append(site)
                        if d.default != default:
                            problems.append(f"{site}: {key} declared with {default!r}, elsewhere {d.default!r}")
                        for k, v in meta.items():                # the fullest description wins
                            if v and not getattr(d, k):
                                setattr(d, k, v)
    return found, problems


def check(d: Declared, v) -> str | None:
    """Why `v` cannot be this limit's value (the page's refusal), or None."""
    if _fits(v, d.default, d.lo, d.hi):
        return None
    if isinstance(d.default, list):
        return f"{d.key} is a list of words."
    if is_time(d.default):
        return f"{d.key} is a time of day, HH:MM."
    rng = " and ".join(x for x in (f"at least {d.lo}" if d.lo is not None else "",
                                   f"at most {d.hi}" if d.hi is not None else "") if x)
    return f"{d.key} must be a number" + (f", {rng}" if rng else "") + "."
