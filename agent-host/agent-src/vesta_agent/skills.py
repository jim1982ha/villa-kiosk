"""The skills: folders a person can add, edit and delete, found again at every use.

A skill is one folder in VESTA_SKILLS_DIR holding SKILL.md (what the model reads)
and skill.yaml (what the engine needs):

    description: one line
    scripts:                         the ONLY scripts the model may run, with the flags it may pass
      energy_period.py:
        commands: [week, month]      optional: allowed first argument
        flags: {--period: [week, month], --out: outfile, --as-of: date, --pdf: switch, --what: text}
        inject: [pack, store, zone]  what the engine adds itself
    schedule:                        what the scheduler starts
      - when: "07:00"                "HH:MM" daily, "Mon 08:00" weekly, "1 08:00" monthly
        prompt: "..."                a model job (costs tokens)
      - when: "02:00"
        run: "nightly.py --out nightly.json"   a code job (no model, no token)
        timeout: 1800
    every_5_min: "desk.py tick"      a code job every 5 minutes
    on_event:
      critical_event: "desk.py intake --event {event}"
    on_reply: "desk.py reply --incident {incident} --text {text} --from {role}"

Nothing is compiled or cached across calls: a changed folder counts at the next
use, a deleted one is gone with its schedule. A skill whose skill.yaml is broken
is switched off alone, and the log names it.

⚠️ THE SCRIPTS A SKILL DECLARES ARE THE ONLY ONES THAT RUN. The model has no
shell and no file tool; the flags it passes are checked here, against the
declaration, before anything starts. Writing a skill folder needs access to
/addon_configs, which already means control of Home Assistant.
"""

from __future__ import annotations

import logging
import os
import re
import shlex
import shutil
import subprocess
import sys
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
HOOK_EVENTS = {"critical_event"}


class ToolError(Exception):
    pass


class SkillError(ValueError):
    pass


@dataclass
class Skill:
    name: str
    path: str
    description: str = ""
    scripts: dict[str, dict] = field(default_factory=dict)
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


def _parse(name: str, path: str) -> Skill:
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
        sk.scripts[script] = {"cmds": set(map(str, cmds)) if cmds else None, "flags": flags, "inject": inject}
    for i, job in enumerate(raw.get("schedule") or []):
        job = job or {}
        when = str(job.get("when") or "")
        if not WHEN.match(when):
            raise SkillError(f"schedule[{i}]: when {when!r} is not HH:MM, 'Mon HH:MM' or 'D HH:MM'")
        if bool(job.get("prompt")) == bool(job.get("run")):
            raise SkillError(f"schedule[{i}]: give either prompt (model job) or run (code job)")
        if job.get("run"):
            _check_command(path, str(job["run"]), f"schedule[{i}].run")
        sk.schedule.append({"when": when, "prompt": job.get("prompt"), "run": job.get("run"),
                            "timeout": int(job.get("timeout") or 900)})
    if raw.get("every_5_min"):
        sk.every_5_min = _check_command(path, str(raw["every_5_min"]), "every_5_min")
    for ev, cmd in (raw.get("on_event") or {}).items():
        if ev not in HOOK_EVENTS:
            raise SkillError(f"on_event: unknown event {ev} (known: {', '.join(sorted(HOOK_EVENTS))})")
        sk.on_event[ev] = _check_command(path, str(cmd), f"on_event.{ev}")
    if raw.get("on_reply"):
        sk.on_reply = _check_command(path, str(raw["on_reply"]), "on_reply")
    return sk


def _check_command(path: str, cmd: str, where: str) -> str:
    try:
        parts = shlex.split(cmd)
    except ValueError as e:
        raise SkillError(f"{where}: {e}") from None
    if not parts or not _script_file_ok(path, parts[0]):
        raise SkillError(f"{where}: {parts[0] if parts else '(empty)'} is not a .py file in scripts/")
    return cmd


class Skills:
    """The skills folder, read afresh at every call."""

    def __init__(self, skills_dir: str, starter_dir: str | None = None):
        self.dir = skills_dir
        self.starter_dir = starter_dir
        self._reported: dict[str, str] = {}

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

    # ------------------------------------------------------------------ reading
    def all(self) -> dict[str, Skill]:
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
                out[name] = _parse(name, path)
                self._report(name, "")
            except (SkillError, yaml.YAMLError, OSError) as e:
                self._report(name, f"skill.yaml refused ({e}): switched off")
            seen.add(name)
        for gone in set(self._reported) - seen:
            self._reported.pop(gone, None)
        return out

    def get(self, name: str) -> Skill | None:
        return self.all().get(name)

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
    final: list[str] = []
    i = 0
    if spec["cmds"] is not None:
        if not args or args[0] not in spec["cmds"]:
            raise ToolError(f"{script} needs one of: {', '.join(sorted(spec['cmds']))}.")
        final.append(args[0])
        i = 1
    while i < len(args):
        a = args[i]
        if "=" in a and a.startswith("--"):
            a, v = a.split("=", 1)
            args[i:i + 1] = [a, v]
        kind = spec["flags"].get(a)
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
        "VILLA_TZ": settings.timezone,
        "TZ": settings.timezone,
        "VESTA_CHROMIUM": os.environ.get("VESTA_CHROMIUM", ""),
    }


def injected(settings, skill: Skill, script: str) -> list[str]:
    spec = skill.scripts.get(script) or {"inject": ["store"]}
    inject = []
    if "pack" in spec["inject"]:
        inject += ["--pack", settings.pack_path]
    if "store" in spec["inject"]:
        inject += ["--store", settings.store_path]
    if "zone" in spec["inject"]:
        inject += ["--zone", settings.timezone]
    return inject


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
