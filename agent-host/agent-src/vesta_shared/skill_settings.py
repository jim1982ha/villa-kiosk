"""A skill's own settings file, with the villa's on top: one reader for every skill.

⚠️ ONE WAY TO A SKILL'S SETTINGS (architecture review 7, 2026-10-07). Only the reports read a villa's own file
(villa.reports.yaml, kept by updates); the alert desk read its rules.yaml as shipped, so its routes could be
changed only by editing the file the next update replaces. And the skills' thresholds sat in the shared library
(params.BEHAVIOUR_DEFAULTS) or as literals in their scripts. Now each skill keeps them in its settings file — its
`behaviour:` section is what params.behaviour() falls back to — and the villa's `villa.<file>` refines it:

    mappings     merged key by key (a villa's threshold replaces the shipped one; the rest stays)
    lists        the villa's entries added after the shipped ones — or before, for `first` keys (the alert desk's
                 routes: the first that matches wins, so a villa's route must come first to replace one)
    other values replaced
"""
from __future__ import annotations

import os

import yaml

VILLA_PREFIX = "villa."          # skills.VILLA_PREFIX: a skill's file the villa owns, kept by updates


def merge(shipped, villa, first: tuple[str, ...] = (), key: str | None = None):
    if isinstance(shipped, dict) and isinstance(villa, dict):
        out = dict(shipped)
        for k, v in villa.items():
            out[k] = merge(shipped.get(k), v, first, k) if k in shipped else v
        return out
    if isinstance(shipped, list) and isinstance(villa, list):
        return villa + shipped if key in first else shipped + villa
    return villa if villa is not None else shipped


def _read(skill_dir: str, name: str) -> dict:
    try:
        with open(os.path.join(skill_dir, name), encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return data if isinstance(data, dict) else {}
    except OSError:
        return {}


def load(skill_dir: str, filename: str, first: tuple[str, ...] = ()) -> dict:
    """`filename` of the skill (its shipped settings), with `villa.<filename>` merged on top; {} when absent."""
    return merge(_read(skill_dir, filename), _read(skill_dir, VILLA_PREFIX + filename), first)


def retired(skill_dir: str, filename: str) -> list[str]:
    """One sentence per setting the villa's own `villa.<filename>` still sets although the skill retired it: the
    shipped file's `retired:` maps the setting's dotted path ("thresholds.pump.watch_drop_pct") to what decides it now.

    ⚠️ NAMED, NEVER SILENTLY IGNORED (owner, 2026-10-19): a villa that tuned a threshold the skill no longer reads
    would see its change do nothing, unsaid. The caller says the sentences where its reader looks (a report's
    problems, an investigation's answer)."""
    gone = _read(skill_dir, filename).get("retired") or {}
    villa = _read(skill_dir, VILLA_PREFIX + filename)
    out = []
    for path, why in gone.items():
        v = villa
        for k in str(path).split("."):
            v = v.get(k, _ABSENT) if isinstance(v, dict) else _ABSENT
        if v is not _ABSENT:
            out.append(f"{VILLA_PREFIX}{filename} sets {path}, which is no longer used: {why}")
    return out


_ABSENT = object()


def behaviour(settings: dict) -> dict[str, float]:
    """A settings file's `behaviour:` section: the defaults params.behaviour() falls back to."""
    b = settings.get("behaviour") or {}
    return {k: v for k, v in b.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
