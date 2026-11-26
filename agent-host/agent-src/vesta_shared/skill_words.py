"""A skill's words as the villa has them now: the file in the villa's copy of the skill, as the villa edited it — never
the starter copy a release ships. That copy is read by the build-time writers alone (message_format.jinja_words,
package_chats, package_visit_words: Home Assistant files written before a release).

⚠️ ONE COPY OF A SKILL'S WORDS AT RUN TIME (architecture review part three, owner 2026-11-20): the engine's visit bottom
line ("New alert, monitoring until 06:40") read the alert desk's words.yaml from the shipped starter folder, once, kept
for good. A villa that edited /config/skills/alert-desk/words.yaml saw its edit in every line the desk wrote and the
release's words on the same card's bottom line. Now the engine says where each skill is (`use`: the live skills,
vesta_agent.skills.Skills.folder — none for a skill switched off, refused or deleted) and a file is read again
whenever it changes.

    words(skill, key)   entry `key` of the skill's words.yaml, by language ({} when it has none, or the skill is off)
    file(skill, name)   any of the skill's files as it is now; folder(skill): where the skill is
    use(locate)         the engine, at start: a skill's name -> its folder, None when the villa has it not on
"""
from __future__ import annotations

import logging
import os
from typing import Callable

import yaml

log = logging.getLogger("vesta")

WORDS = "words.yaml"


def _in_skills_dir(name: str) -> str | None:
    """A skill's folder in the villa's skills folder (VESTA_SKILLS_DIR, else /config/skills): where a skill script,
    run by the engine, finds it — the engine's own answer is the live skills' (`use`)."""
    path = os.path.join(os.environ.get("VESTA_SKILLS_DIR") or "/config/skills", name)
    return path if os.path.isdir(path) else None


_locate: Callable[[str], str | None] = _in_skills_dir
#: each file read: {path: ((mtime_ns, size), its content)} — read again when either changes
_read: dict[str, tuple[tuple[int, int], dict]] = {}


def use(locate: Callable[[str], str | None] | None) -> None:
    """Where a skill is, by its name, from now on: the engine's live skills (None: the villa's skills folder)."""
    global _locate
    _locate = locate or _in_skills_dir


def folder(skill: str) -> str | None:
    """The villa's `skill`'s folder now (None when the villa has it not on)."""
    return _locate(skill)


def file(skill: str, name: str = WORDS) -> dict:
    """File `name` of the villa's `skill` as it is now ({} when the skill is not on, or the file is absent or not a
    mapping). ⚠️ A BROKEN EDIT IS SAID, NEVER GUESSED AROUND: logged once per change of the file, read as {}."""
    where = _locate(skill)
    if not where:
        return {}
    path = os.path.join(where, name)
    try:
        st = os.stat(path)
    except OSError:
        return {}
    stamp = (st.st_mtime_ns, st.st_size)
    got = _read.get(path)
    if got and got[0] == stamp:
        return got[1]
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except (OSError, yaml.YAMLError) as e:
        log.warning("Skill %s: %s could not be read (%s): its words are left out", skill, name, e)
        data = {}
    data = data if isinstance(data, dict) else {}
    _read[path] = (stamp, data)
    return data


def words(skill: str, key: str) -> dict[str, str]:
    """Entry `key` of the villa's `skill`'s words.yaml, by language ({language: text}; {} when it has none)."""
    entry = file(skill).get(key)
    return {str(k): str(v) for k, v in entry.items()} if isinstance(entry, dict) else {}
