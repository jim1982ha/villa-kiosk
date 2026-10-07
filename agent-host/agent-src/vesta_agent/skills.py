"""The skills: folders a person can add, edit and delete, found again at every use.

A skill is one folder in VESTA_SKILLS_DIR holding SKILL.md (what the model reads)
and skill.yaml (what the engine needs):

    description: one line
    tools: [ha_get_state, ha_get_history, send_message]   optional: the tools the AI needs for this skill's
                                     job — its AI jobs get only these (among those switched on), and the skill is
                                     "not working" while one is switched off (tool_access.py). Absent: everything.
    scripts:                         the ONLY scripts the model may run, with the flags it may pass
      energy_period.py:
        commands: [week, month]      optional: allowed first argument (or {week: "what it does", ...})
        description: one line        optional: what the script does (the VESTA Agent page shows it)
        flags: {--period: [week, month], --out: outfile, --as-of: date, --what: text}
        inject: [pack, store, zone]  what the engine adds itself
        job_only: {week: weekly}     a command that, asked for in a chat, runs only as that AI job
    schedule:                        what the scheduler starts
      - when: "07:00"                "HH:MM" daily, "Mon 08:00" weekly, "1 08:00" monthly
        prompt: "..."                a model job (costs tokens)
      - when: "02:00"
        run: "nightly.py --out nightly.json"   a code job (no model, no token)
        timeout: 1800
    every_5_min: "desk.py tick"      a code job every 5 minutes
    on_event:
      critical_event: "desk.py intake --event {event}"
      voice_message: "voice.py prepare --audio {audio} --language {language}"   # prints {"stt": {...}}
    on_reply: "desk.py reply --incident {incident} --text {text} --from {role}"

Nothing is compiled or cached across calls: a changed folder counts at the next
use, a deleted one is gone with its schedule. A skill whose skill.yaml is broken
is switched off alone, and the log names it. A skill the villa switched off
(policy.yaml skills_off, the VESTA Agent page's switch) is not loaded either.

THE VILLA'S CHOICES FOR A SKILL (0.6.42) are in its villa.skill.yaml, written by the
page's command checkboxes: `off_commands: {concierge.py: [find], proposals.py: true}`.
A villa.* file is the villa's (VILLA_PREFIX): the skill still follows the releases,
and copying the folder to another villa carries the choice.

⚠️ THE SCRIPTS A SKILL DECLARES ARE THE ONLY ONES THAT RUN. The model has no
shell and no file tool; the flags it passes are checked here, against the
declaration, before anything starts. Writing a skill folder needs access to
/addon_configs, which already means control of Home Assistant.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import sys
from typing import Any
from dataclasses import dataclass, field

import yaml

log = logging.getLogger("vesta.skills")

SKILL_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,60}$")
FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")
DATE_LIKE = re.compile(r"^[0-9T:+.\-]{4,40}$")
WHEN = re.compile(r"^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun|[1-9]|[12][0-9]|3[01]) )?([01][0-9]|2[0-3]):([0-5][0-9])$")
FLAG_KINDS = {"text", "date", "outfile", "infile", "switch"}
INJECTS = {"pack", "store", "zone"}
SEEDED = ".seeded"
# Every version of each starter skill a release has shipped, as fingerprints
# (starter/shipped-skills.json). A skill folder equal to one of them was never
# edited here, so an update may replace it; any other folder is the owner's.
SHIPPED = "shipped-skills.json"
REFERENCE = ".starter"      # the current starter skills, for reading: not loaded (a dot is not a skill name)
# ⚠️ THE VILLA'S OWN FILES IN A STARTER SKILL: a file named villa.* (e.g. reports' villa.reports.yaml, with
# the villa's playbook entries and cards) is the villa's, never shipped. It does not count as an edit of
# the skill, and an update keeps it — so the villa adds its own without losing the starter's updates.
VILLA_PREFIX = "villa."
HOOK_EVENTS = {"critical_event", "voice_message"}
JOB_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}$")
JOB_TARGETS = ("owner", "fm")


class ToolError(Exception):
    pass


class SkillError(ValueError):
    pass


VILLA_CHOICES = "villa.skill.yaml"
TRASH = ".trash"              # skills deleted or replaced: kept to undo, trimmed by housekeeping (settings.keep.files_days)
TOOL = re.compile(r"^[a-z][a-z0-9_]{1,60}$")
KEPT = ".kept.json"           # starter skills the owner chose to keep as edited, with the release they kept them at


@dataclass
class Script:
    """One script of a skill as its skill.yaml declares it, with this villa's choice of what the AI may run.

    ⚠️ ONE READING OF A SCRIPT (architecture review, 2026-10-07): it was a dict of five keys — `cmds` None for "no
    commands", `off` an empty set, True or a set of commands — that the AI's tools, the page and the checks each
    decoded, and the page wrote the villa's choice back by hand. Ask it instead."""
    name: str
    commands: dict[str, str] | None          # command → what it does (skill.yaml); None: the script takes none
    flags: dict[str, Any] = field(default_factory=dict)
    inject: list[str] = field(default_factory=list)
    job_only: dict[str, str] = field(default_factory=dict)   # command → the AI job it is, asked for in a chat
    description: str = ""
    off_all: bool = False                    # villa.skill.yaml: the whole script switched off for the AI
    off: set[str] = field(default_factory=set)               # villa.skill.yaml: these commands switched off

    def runnable(self, command: str | None = None) -> bool:
        """Whether the AI may run it (and this command of it) here."""
        return not self.off_all and not (command is not None and command in self.off)

    def runnable_commands(self) -> list[str]:
        return [c for c in sorted(self.commands or ()) if self.runnable(c)]

    @property
    def any_off(self) -> bool:
        return self.off_all or bool(self.off)

    def view(self) -> dict:
        """What the page shows of it (Skills → About, Try a command)."""
        return {"script": self.name, "description": self.description,
                "flags": {k: (list(v) if isinstance(v, tuple) else v) for k, v in self.flags.items()},
                "whole_off": self.off_all,
                "commands": [{"name": c, "words": (self.commands or {}).get(c, ""), "on": self.runnable(c),
                              "job_only": self.job_only.get(c)} for c in sorted(self.commands or ())]}

    def switched(self, command: str | None, on: bool):
        """villa.skill.yaml's off_commands entry for this script once `command` (None: the whole script) is
        switched on or off: True, a list of commands, or None (nothing off)."""
        if command is None:
            return None if on else True
        now = set(self.commands or ()) if self.off_all else set(self.off)
        now = (now - {command}) if on else (now | {command})
        return sorted(now) or None


@dataclass
class Skill:
    name: str
    path: str
    description: str = ""
    tools: list[str] | None = None
    scripts: dict[str, Script] = field(default_factory=dict)
    schedule: list[dict] = field(default_factory=list)
    every_5_min: str | None = None
    on_event: dict[str, str] = field(default_factory=dict)
    on_reply: str | None = None

    @property
    def skill_md(self) -> str:
        return os.path.join(self.path, "SKILL.md")

    def script_path(self, script: str) -> str:
        return os.path.join(self.path, "scripts", script)


def _script_file_ok(skill_path: str, script: str) -> bool:
    return bool(FILE_NAME.match(script)) and script.endswith(".py") and \
        os.path.isfile(os.path.join(skill_path, "scripts", script))


def parse_skill(name: str, path: str) -> Skill:
    with open(os.path.join(path, "skill.yaml"), encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    if not isinstance(raw, dict):
        raise SkillError("skill.yaml is not a mapping")
    sk = Skill(name=name, path=path, description=str(raw.get("description") or "").strip())
    for script, spec in (raw.get("scripts") or {}).items():
        spec = spec or {}
        if not _script_file_ok(path, script):
            raise SkillError(f"scripts: {script} is not a .py file in scripts/")
        flags = {}
        for flag, kind in (spec.get("flags") or {}).items():
            if not str(flag).startswith("--"):
                raise SkillError(f"scripts.{script}: flag {flag} must start with --")
            if isinstance(kind, list):
                kind = tuple(str(k) for k in kind)
            elif kind not in FLAG_KINDS:
                raise SkillError(f"scripts.{script}: flag {flag} has an unknown kind {kind!r}")
            flags[str(flag)] = kind
        inject = [str(i) for i in (spec.get("inject") or [])]
        if not set(inject) <= INJECTS:
            raise SkillError(f"scripts.{script}: inject may only name {', '.join(sorted(INJECTS))}")
        cmds = spec.get("commands")
        words = {str(k): str(v or "") for k, v in cmds.items()} if isinstance(cmds, dict) else {}
        job_only = {str(k): str(v) for k, v in (spec.get("job_only") or {}).items()}
        sk.scripts[script] = Script(script, ({str(c): words.get(str(c), "") for c in cmds} if cmds else None), flags,
                                    inject, job_only, str(spec.get("description") or "").strip())
    tools = raw.get("tools")
    if tools is not None:
        if not isinstance(tools, list) or not all(isinstance(t, str) and TOOL.match(t) for t in tools):
            raise SkillError("tools must be a list of tool names (ha_get_state, send_message, web_search...)")
        sk.tools = list(dict.fromkeys(tools))
    _villa_choices(sk)
    for i, job in enumerate(raw.get("schedule") or []):
        job = job or {}
        when = str(job.get("when") or "")
        if not WHEN.match(when):
            raise SkillError(f"schedule[{i}]: when {when!r} is not HH:MM, 'Mon HH:MM' or 'D HH:MM'")
        if bool(job.get("prompt")) == bool(job.get("run")):
            raise SkillError(f"schedule[{i}]: give either prompt (model job) or run (code job)")
        if job.get("run"):
            _check_command(path, str(job["run"]), f"schedule[{i}].run")
        entry = {"when": when, "prompt": job.get("prompt"), "run": job.get("run"),
                 "timeout": int(job.get("timeout") or 900)}
        if job.get("prompt"):
            entry.update(_ai_job(path, job, f"schedule[{i}]"))
        sk.schedule.append(entry)
    if raw.get("every_5_min"):
        sk.every_5_min = _check_command(path, str(raw["every_5_min"]), "every_5_min")
    for ev, cmd in (raw.get("on_event") or {}).items():
        if ev not in HOOK_EVENTS:
            raise SkillError(f"on_event: unknown event {ev} (known: {', '.join(sorted(HOOK_EVENTS))})")
        sk.on_event[ev] = _check_command(path, str(cmd), f"on_event.{ev}")
    if raw.get("on_reply"):
        sk.on_reply = _check_command(path, str(raw["on_reply"]), "on_reply")
    asked = {j["name"] for j in sk.schedule if j.get("on_request")}
    for script, spec in sk.scripts.items():
        for cmd, job in spec.job_only.items():
            if job not in asked:
                raise SkillError(f"scripts.{script}.job_only: {job} is not an AI job of this skill a person may ask for")
    return sk


def _villa_choices(sk: Skill) -> None:
    """villa.skill.yaml's switched-off commands, onto the scripts. LENIENT: a script or command this version of the
    skill no longer has is ignored (an update must never switch a skill off because of an old choice)."""
    try:
        with open(os.path.join(sk.path, VILLA_CHOICES), encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
    except FileNotFoundError:
        return
    except (OSError, yaml.YAMLError) as e:
        raise SkillError(f"{VILLA_CHOICES} cannot be read ({e})") from None
    off = raw.get("off_commands") if isinstance(raw, dict) else None
    for script, which in (off or {}).items() if isinstance(off, dict) else ():
        spec = sk.scripts.get(str(script))
        if not spec:
            continue
        if which is True:
            spec.off_all = True
        elif isinstance(which, list) and spec.commands:
            spec.off = {str(c) for c in which if str(c) in spec.commands}


def villa_choices(skill_path: str) -> dict:
    """villa.skill.yaml as written ({} when absent): the page edits it."""
    try:
        with open(os.path.join(skill_path, VILLA_CHOICES), encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        return raw if isinstance(raw, dict) else {}
    except (OSError, yaml.YAMLError):
        return {}


def switch_command(skill_path: str, script: Script, command: str | None, on: bool) -> str | None:
    """villa.skill.yaml's text once a command (None: the whole script) is switched on or off for the AI; None when
    the file is left with nothing in it. Its other choices are kept as written."""
    choices = villa_choices(skill_path)
    off = dict(choices.get("off_commands") or {})
    entry = script.switched(command, on)
    if entry is None:
        off.pop(script.name, None)
    else:
        off[script.name] = entry
    keep = {k: v for k, v in choices.items() if k != "off_commands" and v}
    if off:
        keep["off_commands"] = off
    return ("# This villa's choices for this skill, made on the VESTA Agent page (Skills): kept by updates.\n"
            + yaml.safe_dump(keep, sort_keys=False)) if keep else None


def _ai_job(path: str, job: dict, where: str) -> dict:
    """An AI job's own fields (owner, 2026-10-01): its name — the key of its model and spending limit in
    policy.yaml settings.jobs, without which it does not run —, the chat its result goes to, whether a
    person may start it from a chat, the starter values the VESTA Agent page offers, and the code step
    that still finishes its work when the spending limit stops it."""
    name = str(job.get("name") or "")
    if not JOB_NAME.match(name):
        raise SkillError(f"{where}: an AI job needs a name (lower case, digits, - and _), the key of its "
                         "model and limit in policy.yaml")
    to = job.get("to")
    if to is not None and to not in JOB_TARGETS:
        raise SkillError(f"{where}: to must be owner or fm")
    default = job.get("default") or {}
    if not isinstance(default, dict) or set(default) - {"profile", "limit_usd"}:
        raise SkillError(f"{where}: default may give only profile and limit_usd")
    on_limit = job.get("on_limit")
    if on_limit:
        _check_command(path, str(on_limit), f"{where}.on_limit")
    return {"name": name, "to": to, "on_request": bool(job.get("on_request")), "default": dict(default),
            "on_limit": str(on_limit) if on_limit else None, "description": str(job.get("description") or ""),
            # the button that makes it without the AI when the AI cannot answer (app: AI_DOWN), its words the skill's
            "button": str(job.get("button") or name),
            "without_ai": _without_ai(path, job.get("without_ai"), f"{where}.without_ai")}


def _without_ai(path: str, steps, where: str) -> list[dict]:
    """The code steps that still make a job's work when the AI cannot run (no credit, a refused key, Anthropic
    unreachable…), in order: `"script.py args"` (this skill's), or `{skill: <another skill>, run: "script.py args",
    on_schedule_only: true}`. Another skill's script is checked when it runs: skills load one by one."""
    if steps is None:
        return []
    if not isinstance(steps, list):
        raise SkillError(f"{where}: a list of code steps")
    out = []
    for i, step in enumerate(steps):
        at = f"{where}[{i}]"
        step = {"run": step} if isinstance(step, str) else step
        if not isinstance(step, dict) or not step.get("run") or set(step) - {"run", "skill", "on_schedule_only"}:
            raise SkillError(f"{at}: a command, or {{skill, run, on_schedule_only}}")
        other = step.get("skill")
        if other is None:
            _check_command(path, str(step["run"]), at)
        elif not SKILL_NAME.match(str(other)):
            raise SkillError(f"{at}: skill must be a skill's folder name")
        else:
            try:
                first = shlex.split(str(step["run"]))[:1]
            except ValueError as e:
                raise SkillError(f"{at}: {e}") from None
            if not first or not FILE_NAME.match(first[0]) or not first[0].endswith(".py"):
                raise SkillError(f"{at}: {first[0] if first else '(empty)'} is not a .py file name")
        out.append({"run": str(step["run"]), "skill": str(other) if other else None,
                    "on_schedule_only": bool(step.get("on_schedule_only"))})
    return out


def _check_command(path: str, cmd: str, where: str) -> str:
    try:
        parts = shlex.split(cmd)
    except ValueError as e:
        raise SkillError(f"{where}: {e}") from None
    if not parts or not _script_file_ok(path, parts[0]):
        raise SkillError(f"{where}: {parts[0] if parts else '(empty)'} is not a .py file in scripts/")
    return cmd


def ai_jobs(skills: dict) -> list[tuple["Skill", dict]]:
    """Every AI job the skills declare, in skill order: what policy.yaml settings.jobs configures."""
    return [(sk, job) for _, sk in sorted(skills.items()) for job in sk.schedule if job.get("prompt")]


class Skills:
    """The skills folder, read afresh at every call."""

    def __init__(self, skills_dir: str, starter_dir: str | None = None, off=None):
        self.dir = skills_dir
        self.starter_dir = starter_dir
        self._reported: dict[str, str] = {}
        # the skills the villa switched off (policy.yaml skills_off), read at every call
        self._off = off or (lambda: set())

    # ------------------------------------------------------------------ seeding
    def seed(self) -> list[str]:
        """Copy the starter skills ONCE, on the first start, then never again.

        ⚠️ THE MARKER, NOT THE FOLDERS, SAYS IT WAS DONE: checking "is this skill
        there?" would bring a deleted skill back at the next start."""
        os.makedirs(self.dir, exist_ok=True)
        marker = os.path.join(self.dir, SEEDED)
        if os.path.exists(marker) or not self.starter_dir or not os.path.isdir(self.starter_dir):
            return []
        copied = []
        for name in sorted(os.listdir(self.starter_dir)):
            src = os.path.join(self.starter_dir, name)
            dst = os.path.join(self.dir, name)
            if os.path.isdir(src) and not os.path.exists(dst):
                shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__"))
                copied.append(name)
        with open(marker, "w", encoding="utf-8") as f:
            f.write("The starter skills were copied here once. Delete a skill's folder to remove it; "
                    "it will not come back.\n")
        return copied

    # ------------------------------------------------------------------ updating
    def update_starters(self) -> tuple[list[str], list[str]]:
        """Bring each starter skill that was NEVER EDITED here to this release's version.

        Returns (updated, kept). ⚠️ AN EDITED SKILL IS NEVER TOUCHED: "edited" means
        its files match no version a release shipped. It is kept as it is, and the
        new version is left in skills/.starter/ to compare or copy by hand. A
        deleted starter skill stays deleted. Without this, a starter skill's first
        copy would stay on the machine forever, whatever later releases fix in it."""
        if not self.starter_dir or not os.path.isdir(self.starter_dir):
            return [], []
        try:
            with open(os.path.join(os.path.dirname(self.starter_dir), SHIPPED), encoding="utf-8") as f:
                shipped: dict = json.load(f)
        except (OSError, ValueError):
            shipped = {}
        updated, kept = [], []
        for name in sorted(os.listdir(self.starter_dir)):
            src, dst = os.path.join(self.starter_dir, name), os.path.join(self.dir, name)
            if not os.path.isdir(src):
                continue
            old = dst + ".old"
            if not os.path.exists(dst) and os.path.isdir(old):
                os.rename(old, dst)                       # a replacement cut short: the skill comes back as it was
            if not os.path.isdir(dst):
                continue                                  # deleted by the owner, or never copied
            have, new = fingerprint(dst), fingerprint(src)
            if have == new:
                continue
            if have not in shipped.get(name, []):
                kept.append(name)
                continue
            tmp = dst + ".new"
            shutil.rmtree(tmp, ignore_errors=True)
            shutil.copytree(src, tmp, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", VILLA_PREFIX + "*"))
            carry_villa_files(dst, tmp)                      # the villa's own files go with it
            shutil.rmtree(old, ignore_errors=True)
            os.rename(dst, old)
            os.rename(tmp, dst)
            shutil.rmtree(old, ignore_errors=True)
            updated.append(name)
        ref = os.path.join(self.dir, REFERENCE)
        shutil.rmtree(ref, ignore_errors=True)
        if kept:
            os.makedirs(ref, exist_ok=True)
            for name in kept:
                shutil.copytree(os.path.join(self.starter_dir, name), os.path.join(ref, name),
                                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        return updated, kept

    # ------------------------------------------------------------------ reading
    def all(self, include_off: bool = False) -> dict[str, Skill]:
        """The skills the agent uses — without those the villa switched off, unless `include_off` (the page)."""
        off = set() if include_off else set(self._off() or ())
        out: dict[str, Skill] = {}
        try:
            names = sorted(os.listdir(self.dir))
        except OSError:
            return out
        seen = set()
        for name in names:
            path = os.path.join(self.dir, name)
            if not SKILL_NAME.match(name) or not os.path.isdir(path):
                continue
            if not os.path.isfile(os.path.join(path, "SKILL.md")) or not os.path.isfile(os.path.join(path, "skill.yaml")):
                self._report(name, "needs both SKILL.md and skill.yaml: switched off")
                seen.add(name)
                continue
            try:
                sk = parse_skill(name, path)
                self._report(name, "")
                if name not in off:
                    out[name] = sk
            except (SkillError, yaml.YAMLError, OSError) as e:
                self._report(name, f"skill.yaml refused ({e}): switched off")
            seen.add(name)
        for gone in set(self._reported) - seen:
            self._reported.pop(gone, None)
        return out

    def get(self, name: str) -> Skill | None:
        return self.all().get(name)

    # ------------------------------------------------------------------ against the release (the page)
    def release_state(self, name: str) -> dict:
        """A skill against this release's starter: `follows` (equal to a version a release shipped), `edited`
        (a starter skill changed here: updates paused), `own` (not a starter skill). For an edited one, the files
        that differ, and whether the owner already chose to keep it as it is for this release."""
        dst = os.path.join(self.dir, name)
        src = os.path.join(self.starter_dir, name) if self.starter_dir else ""
        if not src or not os.path.isdir(src):
            return {"state": "own"}
        have, new = skill_files(dst), skill_files(src)
        villa = sorted(k for k in have if os.path.basename(k).startswith(VILLA_PREFIX))
        mine = {k: v for k, v in have.items() if k not in villa}
        differs = sorted(k for k in set(mine) | set(new) if mine.get(k) != new.get(k))
        if not differs:
            return {"state": "follows", "villa": villa}
        try:
            with open(os.path.join(os.path.dirname(self.starter_dir), SHIPPED), encoding="utf-8") as f:
                shipped = json.load(f).get(name, [])
        except (OSError, ValueError):
            shipped = []
        if fingerprint(dst) in shipped:
            return {"state": "follows", "villa": villa, "update_at_start": True}
        return {"state": "edited", "villa": villa, "differs": differs,
                "only_here": sorted(set(mine) - set(new)), "only_release": sorted(set(new) - set(mine)),
                "kept": self._kept().get(name) == fingerprint(src)}

    def _kept(self) -> dict:
        try:
            with open(os.path.join(self.dir, KEPT), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def keep_mine(self, name: str) -> None:
        """The owner keeps the edited skill as it is for THIS release: the page stops offering the release's
        version until a later release brings another one."""
        kept = self._kept()
        kept[name] = fingerprint(os.path.join(self.starter_dir, name))
        with open(os.path.join(self.dir, KEPT), "w", encoding="utf-8") as f:
            json.dump(kept, f, indent=1, sort_keys=True)

    def take_release(self, name: str) -> str:
        """The skill replaced by this release's version; its villa.* files kept. The edited folder goes to the trash
        (to_trash; returned), never erased. From then on the skill follows the releases again."""
        src, dst = os.path.join(self.starter_dir, name), os.path.join(self.dir, name)
        tmp = dst + ".new"
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.copytree(src, tmp, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", VILLA_PREFIX + "*"))
        carry_villa_files(dst, tmp)
        trash = to_trash(self.dir, dst, name)
        os.rename(tmp, dst)
        return trash

    def _report(self, name: str, problem: str) -> None:
        """Log a skill's problem once, and once more when it is fixed — never every tick."""
        if self._reported.get(name, "") == problem:
            return
        if problem:
            log.error("Skill %s: %s", name, problem)
        elif name in self._reported:
            log.info("Skill %s: switched on again", name)
        self._reported[name] = problem

    def problems(self) -> dict[str, str]:
        return {k: v for k, v in self._reported.items() if v}


# ---------------------------------------------------------------------- the model's script calls
def validate_script_args(skill: Skill | None, skill_name: str, script: str, args: list[str], out_dir: str) -> list[str]:
    """Check what the model asked for against the skill's declaration. Raises ToolError."""
    if skill is None:
        raise ToolError(f"There is no skill {skill_name}.")
    spec = skill.scripts.get(script)
    if not spec:
        raise ToolError(f"{skill_name}/{script} is not a script this skill lets you run.")
    args = [str(a) for a in (args or [])]
    if not spec.runnable(args[0] if spec.commands is not None and args else None):
        raise ToolError(f"{script}{' ' + args[0] if spec.commands is not None and args else ''} is switched off for this "
                        f"villa (VESTA Agent page → Skills → {skill_name}). Say so plainly; do not try another way.")
    final: list[str] = []
    i = 0
    if spec.commands is not None:
        if not args or args[0] not in spec.commands:
            raise ToolError(f"{script} needs one of: {', '.join(sorted(spec.commands))}.")
        final.append(args[0])
        i = 1
    while i < len(args):
        a = args[i]
        if "=" in a and a.startswith("--"):
            a, v = a.split("=", 1)
            args[i:i + 1] = [a, v]
        kind = spec.flags.get(a)
        if kind is None:
            raise ToolError(f"{a} is not allowed for {script}.")
        if kind == "switch":
            final.append(a)
            i += 1
            continue
        if i + 1 >= len(args):
            raise ToolError(f"{a} needs a value.")
        v = args[i + 1]
        if isinstance(kind, tuple):
            if v not in kind:
                raise ToolError(f"{a} must be one of {', '.join(kind)}.")
        elif kind == "date":
            if not DATE_LIKE.match(v):
                raise ToolError(f"{a} takes a date or time.")
        elif kind in ("outfile", "infile"):
            if not FILE_NAME.match(v) or v.startswith("."):
                raise ToolError(f"{a} takes a plain file name, no folder.")
            v = os.path.join(out_dir, v)
            if kind == "infile" and not os.path.exists(v):
                raise ToolError(f"{os.path.basename(v)} does not exist yet in the out folder.")
        elif kind == "text":
            if v.startswith("-") or len(v) > 200:
                raise ToolError(f"{a} takes a short text.")
        final += [a, v]
        i += 2
    return final


def script_env(settings) -> dict:
    """What a skill script gets: the read-only HA MCP client's address, the store, the zone. Nothing else."""
    return {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": settings.work_dir,
        "LANG": "C.UTF-8",
        "PYTHONPATH": settings.shared_dir,
        "VESTA_HA_MCP_URL": settings.ha_mcp_url,
        "VESTA_HA_READ_ONLY": "1",
        "VESTA_STORE": settings.store_path,
        # read only, by convention and by review: the villa's policy (one reader: vesta_agent.policy)
        # and the agent's own records (what it cost, what it did) for the reports
        "VESTA_POLICY": settings.policy_path,
        "VESTA_STATE": settings.state_path,
        "VILLA_TZ": settings.timezone,
        "TZ": settings.timezone,
    }


def to_trash(skills_dir: str, path: str, name: str) -> str:
    """Move a skill folder aside, never erase it: skills/.trash/<name>-<when>, a dot folder no one loads. ⚠️ ITS DATE
    IS SET TO NOW: housekeeping keeps a trashed skill `files_days` from the day it went there — its files keep their
    own older dates, so judging them one by one would empty a skill trashed today. The ONE way into the trash."""
    from datetime import datetime, timezone
    dest = os.path.join(skills_dir, TRASH, f"{name}-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%f}")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.move(path, dest)
    os.utime(dest)
    return dest


def carry_villa_files(old: str, new: str) -> None:
    """This villa's own files (villa.*) of a skill folder, copied into its replacement where it has none: an update,
    "Take the release version" and an import all keep them (VILLA_PREFIX)."""
    for root, _, files in os.walk(old):
        for f in files:
            if f.startswith(VILLA_PREFIX):
                rel = os.path.relpath(os.path.join(root, f), old)
                if not os.path.exists(os.path.join(new, rel)):
                    os.makedirs(os.path.dirname(os.path.join(new, rel)), exist_ok=True)
                    shutil.copy2(os.path.join(root, f), os.path.join(new, rel))


def skill_files(folder: str) -> dict[str, str]:
    """Each file of a skill folder (its path inside it) → a hash of its content; Python's caches left out."""
    out = {}
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for name in files:
            if name.endswith(".pyc"):
                continue
            path = os.path.join(root, name)
            with open(path, "rb") as f:
                out[os.path.relpath(path, folder).replace(os.sep, "/")] = hashlib.sha256(f.read()).hexdigest()
    return out


def fingerprint(folder: str) -> str:
    """One hash for a skill folder's files (names and contents; not Python's caches)."""
    h = hashlib.sha256()
    for root, dirs, files in os.walk(folder):
        dirs.sort()                          # a fixed order; Python's caches hold only .pyc, skipped below
        for name in sorted(files):
            if name.endswith(".pyc") or name.startswith(VILLA_PREFIX):
                continue
            path = os.path.join(root, name)
            h.update(os.path.relpath(path, folder).replace(os.sep, "/").encode() + b"\0")
            with open(path, "rb") as f:
                h.update(hashlib.sha256(f.read()).digest())
    return h.hexdigest()


def record_shipped(starter_dir: str) -> list[str]:
    """Add this tree's starter skills to shipped-skills.json (run before a release
    that changes one; a test fails until it is done). Returns the skills added."""
    path = os.path.join(os.path.dirname(starter_dir), SHIPPED)
    try:
        with open(path, encoding="utf-8") as f:
            shipped = json.load(f)
    except (OSError, ValueError):
        shipped = {}
    added = []
    for name in sorted(os.listdir(starter_dir)):
        if os.path.isdir(os.path.join(starter_dir, name)):
            fp = fingerprint(os.path.join(starter_dir, name))
            if fp not in shipped.setdefault(name, []):
                shipped[name].append(fp)
                added.append(name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(shipped, f, indent=1, sort_keys=True)
        f.write("\n")
    return added


def injected(settings, skill: Skill, script: str) -> list[str]:
    # ⚠️ TWO NAMES (0.12.69): 0.12.67 named the declaration and the arguments both `inject`, the second emptied the
    # first, and every script ran with no --pack / --store / --zone (the 07:00 digest: "fm-daily needs --pack")
    wants = skill.scripts[script].inject if script in skill.scripts else ["store"]
    args: list[str] = []
    if "pack" in wants:
        args += ["--pack", settings.pack_path]
    if "store" in wants:
        args += ["--store", settings.store_path]
    if "zone" in wants:
        args += ["--zone", settings.timezone]
    return args


def run_script(settings, skill: Skill, script: str, args: list[str], timeout: int = 900) -> tuple[int, str, str]:
    """(exit code, stdout, stderr tail). Exit 2 is a script's "nothing to do / missing parameter", not a failure."""
    if not _script_file_ok(skill.path, script):
        return 127, "", f"{script} is not a script of {skill.name}"
    cmd = [sys.executable, skill.script_path(script)] + list(args) + injected(settings, skill, script)
    try:
        p = subprocess.run(cmd, cwd=settings.out_dir, env=script_env(settings), capture_output=True, text=True,
                           timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, "", "The script took too long and was stopped."
    return p.returncode, (p.stdout or "").strip(), "\n".join((p.stderr or "").strip().splitlines()[-5:])


def run_command(settings, skill: Skill, command: str, values: dict | None = None, timeout: int = 900) -> tuple[int, str, str]:
    """A code job or hook from skill.yaml, placeholders filled: `desk.py intake --event {event}`."""
    parts = shlex.split(command)
    filled = [p.format(**(values or {})) if "{" in p else p for p in parts[1:]]
    return run_script(settings, skill, parts[0], filled, timeout)
