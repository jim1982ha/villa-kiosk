"""The skills: folders a person can add, edit and delete, found again at every use.

A skill is one folder in VESTA_SKILLS_DIR holding SKILL.md (what the model reads)
and skill.yaml (what the engine needs):

    description: one line
    tools: [ha_get_state, ha_get_history, send_message]   optional: the tools this skill uses. They limit nothing
                                     (who asks decides, tool_access.allowed_for): the AI is told which of them a
                                     run lacks, and the page offers to switch one on (tool_access.unavailable).
    scripts:                         the ONLY scripts the model may run, with the flags it may pass
      energy_period.py:
        commands: [week, month]      optional: allowed first argument (or {week: "what it does", ...})
        description: one line        optional: what the script does (the VESTA Agent page shows it)
        flags: {--period: [week, month], --out: outfile, --as-of: date, --what: text}
        inject: [pack, store, zone]  what the engine adds itself
        job_only: {week: weekly}     a command that, asked for in a chat, runs only as that AI job
    jobs_default: {brain: auto, limit_usd: 2}   the starter brain and limit per run of ALL its AI jobs: what the
                                     VESTA Agent page offers for the skill (policy.yaml settings.skill_ai sets them)
    schedule:                        what the scheduler starts
      - when: "07:00"                "HH:MM" daily, "Mon 08:00" weekly, "1 08:00" monthly
        prompt: "..."                a model job (costs tokens)
      - when: "02:00"
        run: "nightly.py --out nightly.json"   a code job (no model, no token)
        timeout: 1800
        kiosk: nightly_check         optional: this job is the nightly check the Kiosk names (its (i) says its time)
    every_5_min: "desk.py tick"      a code job every 5 minutes
    rechecks: all                    the night's findings that job reads again — `all`, or a list of rule ids (their
                                     Kiosk card: "Next check: within 5 min"; the others: the nightly time)
    on_event:
      critical_event: "desk.py intake --event {event}"
      voice_message: "voice.py prepare --audio {audio} --language {language}"   # prints {"stt": {...}}
    on_reply: "desk.py reply --incident {incident} --option {option} --from {role} --name {name}"
    buttons:                         the buttons under every message about an open alert, answered by on_reply
      - {option: done, label: Done}              option: what on_reply is given; label: the words on the button
      - {option: need_help, label: Need help, mark: help}   mark: the icon its footer shows (message_format)
    before_answer: "concierge.py status"   what the AI is given before EVERY answer in a chat: the script's "text"
    command: investigate             a skill only its "/investigate" starts (with usage, brain, limit_usd, deliver)
    offer: {label: "Investigate this", pressed: Investigating}   a command skill a chat answer may offer: a reply that
                                     names "/investigate" carries this button, which runs it on the person's question

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
from .places import where
from .intake import OWN_COMMANDS  # noqa: E402  (the agent's own commands: one list)
from typing import Any
from dataclasses import dataclass, field

import yaml

from vesta_shared.limits import limit
from vesta_shared.message_format import ROLES

log = logging.getLogger("vesta.skills")

SKILL_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,60}$")
#: A skill against this release (Skills.verdict).
OWN, GONE, SAME, UPDATE, EDITED = "own", "gone", "same", "update", "edited"
FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")
#: A file a report run left in its own folder (config.Settings.in_folder, ai_jobs.run_folder): runs/<run>/<file>.
RUN_FILE = re.compile(r"^runs/[A-Za-z0-9][A-Za-z0-9._-]{0,160}/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")


def out_files(out_root: str, runs: int | None = None) -> list[tuple[str, float]]:
    """The files an Offline Test may read, newest first: (its value, when written). Those of the out folder itself (an
    earlier Offline Test's), and those of the last `runs` report runs — `runs/<run>/<file>`.

    ⚠️ THE REPORTS' FILES TOO (architecture review 16, 2026-10-10): since each report works in its own folder (0.12.118),
    the Offline Test offered only the top of the out folder — never this morning's facts.json, sometimes one from before
    0.12.118 with old figures."""
    found: list[tuple[str, float]] = []

    def add(folder: str, prefix: str) -> None:
        try:
            names = os.listdir(folder)
        except OSError:
            return
        for n in names:
            p = os.path.join(folder, n)
            if FILE_NAME.match(n) and os.path.isfile(p):
                found.append((prefix + n, os.path.getmtime(p)))
    add(out_root, "")
    runs_dir = os.path.join(out_root, "runs")
    try:
        recent = sorted((d for d in os.listdir(runs_dir) if os.path.isdir(os.path.join(runs_dir, d))),
                        key=lambda d: os.path.getmtime(os.path.join(runs_dir, d)), reverse=True)[:runs or limit(
                            "skills.test_runs_offered", 10, unit="runs", group="keep", lo=1, hi=200,
                            says="Report runs whose files an Offline Test on the Skills tab may read.",
                            reached="Older runs' files are not offered.", told="")]
    except OSError:
        recent = []
    for d in recent:
        add(os.path.join(runs_dir, d), f"runs/{d}/")
    return sorted(found, key=lambda f: f[1], reverse=True)


def take_run_file(out_root: str, value: str) -> str:
    """A report run's file chosen in an Offline Test (`runs/<run>/<file>`), copied into the out folder itself, where the
    test runs: its plain name, checked as every file argument is. Any other value comes back unchanged."""
    if not RUN_FILE.match(value or ""):
        return value
    src = os.path.realpath(os.path.join(out_root, value))
    if not src.startswith(os.path.realpath(os.path.join(out_root, "runs")) + os.sep) or not os.path.isfile(src):
        return value
    name = os.path.basename(src)
    shutil.copyfile(src, os.path.join(out_root, name))
    return name
DATE_LIKE = re.compile(r"^[0-9T:+.\-]{4,40}$")
WHEN = re.compile(r"^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun|[1-9]|[12][0-9]|3[01]) )?([01][0-9]|2[0-3]):([0-5][0-9])$")
FLAG_KINDS = {"text", "date", "outfile", "infile", "switch"}
INJECTS = {"pack", "store", "zone"}
SEEDED = ".seeded"
# ⚠️ A NEW STARTER SKILL IS NOT A DELETED ONE (investigate, 2026-10-11): the marker said "copied once, never again",
# so a skill a later release adds was taken for one the owner deleted and never reached a villa installed before it.
# The names this install was GIVEN are kept here: a starter name not in it is new, copied once and added; a name in
# it whose folder is gone was deleted by the owner and stays deleted.
OFFERED = ".offered.json"
#: the starter skills of every install made before OFFERED existed: what such an install was given
OFFERED_BEFORE_THE_RECORD = ("alert-desk", "preventive-maintenance", "reports", "roi-energy", "villa-concierge")
# Every version of each starter skill a release has shipped, as fingerprints
# (starter/shipped-skills.json). A skill folder equal to one of them was never
# edited here, so an update may replace it; any other folder is the owner's.
SHIPPED = "shipped-skills.json"
REFERENCE = ".starter"      # the current starter skills, for reading: not loaded (a dot is not a skill name)
# ⚠️ THE VILLA'S OWN FILES IN A STARTER SKILL: a file named villa.* (e.g. reports' villa.reports.yaml, with
# the villa's playbook entries and cards) is the villa's, never shipped. It does not count as an edit of
# the skill, and an update keeps it — so the villa adds its own without losing the starter's updates.
VILLA_PREFIX = "villa."
#: the files a skill is made of: never deleted from the page (the page hid the button, the server allowed it, review 9)
REQUIRED_FILES = ("SKILL.md", "skill.yaml")
#: The events a skill's on_event answers, and how the page names each (when_it_runs).
HOOK_EVENTS = {"critical_event": "a VESTA automation's critical alert", "voice_message": "a voice message"}
JOB_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}$")
JOB_TARGETS = ROLES


class ToolError(Exception):
    pass


class SkillError(ValueError):
    pass


VILLA_CHOICES = "villa.skill.yaml"
# A schedule entry's `kiosk`: what the Kiosk calls that job, so it can say its time (the heartbeat's cadence,
# agent-contract.json `heartbeat`) — the skill names it, the engine never guesses which job is "the nightly check".
KIOSK_JOBS = {"nightly_check"}
TRASH = ".trash"              # skills deleted or replaced: kept to undo, trimmed by housekeeping (settings.keep.files_days)
TOOL = re.compile(r"^[a-z][a-z0-9_]{1,60}$")
BUTTON_OPTION = re.compile(r"^[a-z][a-z_]{0,15}$")
SKILL_COMMAND = re.compile(r"^[a-z][a-z0-9_]{1,31}$")     # Telegram's own rule for a bot command
BRAINS = ("economy", "auto", "performance")                # policy.PROFILES' names: what a skill's `brain` may say
RESERVED_COMMANDS = OWN_COMMANDS | {"/start", "/help"}   # the agent's own (one list: intake.py) and Telegram's
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
        """What the page shows of it (Skills › About, its Offline Test)."""
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
    # ⚠️ ONE BRAIN AND ONE LIMIT FOR A SKILL'S AI JOBS (owner, 2026-10-20): the starter values the page offers,
    # {"brain", "limit_usd"} — None for a skill with no AI job. policy.yaml settings.skill_ai is what they run with.
    jobs_default: dict | None = None
    every_5_min: str | None = None
    # the rules whose findings every_5_min reads again — the rest wait for the nightly check: the Kiosk card's "Next check"
    # (owner, 2026-10-15). The skill says it, the engine only carries it to the card. ["*"]: `rechecks: all`, every
    # finding (owner, 2026-10-20: "check every 5 min for all the reported issues").
    rechecks: list[str] = field(default_factory=list)
    on_event: dict[str, str] = field(default_factory=dict)
    on_reply: str | None = None
    # ⚠️ THE SKILL'S BUTTONS, NOT THE ENGINE'S (architecture review, 2026-10-13): the engine drew "Done" / "Need help" and
    # handed the skill the LABEL, which the desk read back by its first word — a button renamed on one side only would
    # have turned a press into "Noted from …" and left the alert open with no button. [{option, label, mark}], in order.
    buttons: list[dict] = field(default_factory=list)
    # ⚠️ GIVEN, NOT FETCHED (owner, 2026-10-10: "what's the status of the villa now?" got "everything ok" while three
    # pump devices were offline — the AI took one quick look instead of the skill's check). A skill's own check the
    # engine runs before each answer, its result put in front of the AI: what a person must be told is never left to
    # the AI deciding to look.
    before_answer: str | None = None
    # ⚠️ A DEVICE'S PAST, WORKED OUT — NEVER A SAMPLE OF IT (owner, 2026-10-20: "I never want to see wrong responses";
    # the House Pump's 100 newest readings, 15 minutes of rest, were answered as its whole afternoon): the command whose
    # lines answer every history read of the AI, from every reading of the period ({entities}, {start}, {end}). The
    # skill says how a past is read; the engine only puts its lines where the raw readings were (tools.Toolbox).
    reads_history: str | None = None
    # ⚠️ A SKILL ONLY ITS COMMAND STARTS (owner, 2026-10-11: investigate "only triggered when user mentions
    # /investigation in the question, and never if not" — then "only allow /investigate"): the AI never sees it among its skills, its tools refuse it,
    # and a message carrying "/<command>" tells the AI to use it (intake.gate, Toolbox.gated). Without the "/".
    command: str | None = None
    also: list[str] = field(default_factory=list)   # other spellings that start it too: command's first
    # what every answer of a command skill carries, checked after the AI's turn (app._delivered): {"page": file sent with
    # send_message, "fault_offer": the saved account a fault is offered from when the AI offered none}
    deliver: dict[str, str] = field(default_factory=dict)
    # how to write it, the skill's own example ("/investigate why did …?"): said to a person who sent the command alone
    usage: str = ""
    # ⚠️ ITS OWN BRAIN AND LIMIT (owner, 2026-10-11): an investigation run on the villa's everyday brain (Economy, haiku)
    # skipped steps and misread its own figures. A command skill may name the brain its answers use (economy / auto /
    # performance) and its limit per answer; everything else keeps the Rules page's.
    brain: str | None = None
    limit_usd: float | None = None
    # ⚠️ OFFERED FROM A CHAT (owner, 2026-10-19: a reply about the pool pump ended "write /investigate followed by your
    # question" — "a button that directly triggers the suggested investigation"): {"label": the button's words, "pressed":
    # what the message says once pressed}. Only a skill that can run on the person's question as written declares it
    # (proposals needs a number: none). The engine places and runs it (command_offers.py), the skill says whether and how.
    offer: dict[str, str] | None = None
    # ⚠️ OFFERED WITHOUT BEING NAMED (owner, 2026-10-20: asked "why has the House Pump been starting and stopping…",
    # the reply skipped the line naming /investigate the concierge skill asks for, so no button came): `offer:
    # after_reading:` — the reading tools after which a chat answer carries the button, whether or not it names the
    # command. The skill says which readings are "looking into what happened"; the engine only matches them.
    offer_after: tuple[str, ...] = ()

    @property
    def skill_md(self) -> str:
        return os.path.join(self.path, "SKILL.md")

    def script_path(self, script: str) -> str:
        return os.path.join(self.path, "scripts", script)


def when_it_runs(sk: Skill) -> list[dict]:
    """Every way the engine starts this skill, as the page's "When the skill runs" rows, in the order shown: the
    schedule, every 5 minutes, its events, an answer to its alerts, before every chat answer, the chats last.
    {when, job, script (its file), kind ("ai" / "code" / None), note?}.

    ⚠️ THE SKILL'S OWN READING (architecture review 5, 2026-10-13): the page wrote these rows itself and never learned
    `before_answer` — villa-concierge's status check runs before every answer and its page did not say so."""
    from .scheduler import describe

    def row(when, job=None, script=None, ai=False, **more):
        return {"when": when, "job": job, "script": script.split()[0] if script else None,
                "kind": "ai" if ai else "code" if script else None, **more}
    acts = [row(describe(j["when"])[0], j.get("name"), j.get("run"), ai=bool(j.get("prompt")) and not j.get("run"))
            for j in sk.schedule]
    if sk.every_5_min:
        acts.append(row("every 5 minutes", script=sk.every_5_min))
    acts += [row(HOOK_EVENTS.get(ev, ev), script=cmd) for ev, cmd in sk.on_event.items()]
    if sk.on_reply:
        acts.append(row("an answer to one of its alerts", script=sk.on_reply))
    if sk.before_answer:
        acts.append(row("before every answer in a chat", script=sk.before_answer))
    if sk.reads_history:
        acts.append(row("when the AI reads a device's history", script=sk.reads_history))
    # a command skill's row says how it is used, in the skill's own words (`usage`, an example — owner, 2026-10-19:
    # "only when a person writes /proposal" said neither what to write nor when it applies)
    # and its button (`offer`), which is the command typed for the person: the same row, said (0.12.271)
    pressed = (f" (or presses “{sk.offer['label']}” under a reply that suggests it"
               + (" or that looked into what happened" if sk.offer_after else "") + ")") if sk.offer else ""
    acts.append(row("in a chat", note=(f"only when a person writes /{sk.command}{pressed}, for example: {sk.usage}"
                                       if sk.usage else f"only when a person writes /{sk.command}{pressed}") if sk.command
                    else "when a person asks about it"))
    return acts


def _script_file_ok(skill_path: str, script: str) -> bool:
    return bool(FILE_NAME.match(script)) and script.endswith(".py") and \
        os.path.isfile(os.path.join(skill_path, "scripts", script))


def parse_skill(name: str, path: str) -> Skill:
    with open(os.path.join(path, "skill.yaml"), encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    if not isinstance(raw, dict):
        raise SkillError("skill.yaml is not a mapping")
    sk = Skill(name=name, path=path, description=str(raw.get("description") or "").strip())
    if raw.get("command") is not None:
        # one command, or a list: the first is the one the agent writes, the others start it too (a common spelling)
        given = raw["command"] if isinstance(raw["command"], list) else [raw["command"]]
        cmds = [str(c).strip().lstrip("/").lower() for c in given]
        for cmd, c in zip(cmds, given):
            if not SKILL_COMMAND.match(cmd) or "/" + cmd in RESERVED_COMMANDS:
                raise SkillError(f"command: {c} is not a free Telegram command (lower-case letters, digits, _; "
                                 f"not {', '.join(sorted(RESERVED_COMMANDS))})")
        if not cmds:
            raise SkillError("command: an empty list")
        sk.command, sk.also = cmds[0], cmds[1:]
        sk.usage = str(raw.get("usage") or "").strip()[:limit(
            "skills.usage_chars", 200, unit="characters", group="text", lo=40, hi=2000,
            says="The longest \"how to use it\" line of a skill's command, as Telegram's command menu shows it.",
            reached="The rest of the line is cut.", told="")]
        if raw.get("brain") is not None:
            if str(raw["brain"]) not in BRAINS:
                raise SkillError(f"brain: {raw['brain']} is not one of {', '.join(BRAINS)}")
            sk.brain = str(raw["brain"])
        if raw.get("limit_usd") is not None:
            try:
                sk.limit_usd = float(raw["limit_usd"])
            except (TypeError, ValueError):
                sk.limit_usd = -1.0
            if not 0.05 <= sk.limit_usd <= 20:
                raise SkillError("limit_usd: a number of US$ per answer, from 0.05 to 20")
    offer = raw.get("offer")
    if offer is not None:
        if not sk.command:
            raise SkillError("offer: only a skill with a command has it (pressing it writes that command)")
        after = offer.get("after_reading", []) if isinstance(offer, dict) else None
        if not isinstance(after, list) or not all(isinstance(t, str) and t.strip() for t in after):
            raise SkillError("offer: after_reading is a list of reading tools (ha_get_history, …)")
        offer = {k: v for k, v in offer.items() if k != "after_reading"} if isinstance(offer, dict) else offer
        if not isinstance(offer, dict) or set(offer) - {"label", "pressed", "decline"} or \
                not all(isinstance(v, str) and v.strip() for v in offer.values()) or not str(offer.get("label") or "").strip():
            raise SkillError("offer: {label: the button's words, pressed: what the message says once pressed (optional), "
                             "decline: the words of a button beside it that declines it (optional), "
                             "after_reading: the reading tools after which an answer carries it (optional)}")
        sk.offer_after = tuple(t.strip() for t in after)
        sk.offer = {k: v.strip()[:limit(
                "skills.offer_label_chars", 60, unit="characters", group="text", lo=10, hi=64,
                says="The longest text of a button a reply offers (\"🔎 Investigate this\").",
                reached="The rest of the text is cut.", told="")] for k, v in offer.items()}
    deliver = raw.get("deliver") or {}
    if deliver:
        if not sk.command:
            raise SkillError("deliver: only a skill with a command has it (its answers are the ones checked)")
        if not isinstance(deliver, dict) or set(deliver) - {"page", "fault_offer"} or \
                not all(isinstance(v, str) and FILE_NAME.match(v) for v in deliver.values()):
            raise SkillError("deliver: page and/or fault_offer, each a plain file name")
        sk.deliver = dict(deliver)
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
        if job.get("kiosk") is not None:
            if job["kiosk"] not in KIOSK_JOBS or not re.fullmatch(r"\d\d:\d\d", when):
                raise SkillError(f"schedule[{i}]: kiosk {job['kiosk']!r} must be one of {', '.join(sorted(KIOSK_JOBS))}, "
                                 "on a daily HH:MM job")
            entry["kiosk"] = job["kiosk"]
        if job.get("prompt"):
            entry.update(_ai_job(path, job, f"schedule[{i}]"))
        sk.schedule.append(entry)
    sk.jobs_default = _jobs_default(raw.get("jobs_default"), [j for j in sk.schedule if j.get("prompt")])
    if raw.get("every_5_min"):
        sk.every_5_min = _check_command(path, str(raw["every_5_min"]), "every_5_min")
    if raw.get("rechecks") is not None:
        r = raw["rechecks"]
        if not sk.every_5_min or not (r == "all" or isinstance(r, list) and all(isinstance(x, str) for x in r)):
            raise SkillError("rechecks: all, or a list of rule ids, beside the every_5_min job that reads them again")
        sk.rechecks = ["*"] if r == "all" else list(r)
    for ev, cmd in (raw.get("on_event") or {}).items():
        if ev not in HOOK_EVENTS:
            raise SkillError(f"on_event: unknown event {ev} (known: {', '.join(sorted(HOOK_EVENTS))})")
        sk.on_event[ev] = _check_command(path, str(cmd), f"on_event.{ev}")
    if raw.get("on_reply"):
        sk.on_reply = _check_command(path, str(raw["on_reply"]), "on_reply")
    sk.buttons = _buttons(raw.get("buttons"))
    if raw.get("before_answer"):
        sk.before_answer = _check_command(path, str(raw["before_answer"]), "before_answer")
    if raw.get("reads_history"):
        sk.reads_history = _check_command(path, str(raw["reads_history"]), "reads_history")
        missing = [k for k in ("{entities}", "{start}", "{end}") if k not in sk.reads_history]
        if missing:
            raise SkillError(f"reads_history: the command takes {', '.join(missing)}")
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


def _jobs_default(given, jobs: list[dict]) -> dict | None:
    """The starter brain and limit per run of a skill's AI jobs: its `jobs_default`; for a skill written before it (a
    villa's own edit, kept by updates), the strongest brain and the largest limit its jobs' own `default` gave."""
    if not jobs:
        if given is not None:
            raise SkillError("jobs_default: only a skill with AI jobs (a schedule entry with a prompt) has it")
        return None
    if given is not None:
        if not isinstance(given, dict) or set(given) - {"brain", "limit_usd"}:
            raise SkillError("jobs_default: give brain and limit_usd")
        brain = str(given.get("brain") or "auto")
        if brain not in BRAINS:
            raise SkillError(f"jobs_default.brain: {brain} is not one of {', '.join(BRAINS)}")
        try:
            lim = float(given.get("limit_usd"))
        except (TypeError, ValueError):
            lim = -1.0
        if not 0.05 <= lim <= 20:
            raise SkillError("jobs_default.limit_usd: a number of US$ per run, from 0.05 to 20")
        return {"brain": brain, "limit_usd": lim}
    olds = [j.get("default") or {} for j in jobs]
    brains = [d["profile"] for d in olds if d.get("profile") in BRAINS] or ["auto"]
    limits = [float(d["limit_usd"]) for d in olds if isinstance(d.get("limit_usd"), (int, float))] or [1.0]
    return {"brain": max(brains, key=BRAINS.index), "limit_usd": max(limits)}


def _ai_job(path: str, job: dict, where: str) -> dict:
    """An AI job's own fields (owner, 2026-10-01): its name, the chat its result goes to, whether a person may start
    it from a chat, and the code step that still finishes its work when the spending limit stops it. Its brain and its
    limit per run are its skill's (policy.yaml settings.skill_ai, owner 2026-10-20); a job's own `default` is an older
    skill's, read by _jobs_default only."""
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
    return {"name": name, "to": to, "on_request": bool(job.get("on_request")), "default": dict(default),
            # on_limit is one step (skill.yaml gives a command), parsed and run like without_ai's (job_steps.py)
            "on_limit": _without_ai(path, [str(on_limit)], f"{where}.on_limit") if on_limit else [],
            "description": str(job.get("description") or ""),
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


def _buttons(raw) -> list[dict]:
    """skill.yaml `buttons`: [{option, label, mark}] — an option is a short word (it travels in Telegram's 64 bytes of
    button data, button_data.ALERT), a label what the button says, a mark one of message_format.MARK_ICONS."""
    if raw is None:
        return []
    from vesta_shared.message_format import MARK_ICONS
    if not isinstance(raw, list) or not raw:
        raise SkillError("buttons must be a list of {option, label}")
    out = []
    for i, b in enumerate(raw):
        b = b if isinstance(b, dict) else {}
        option, label, mark = str(b.get("option") or ""), str(b.get("label") or "").strip(), b.get("mark")
        if not BUTTON_OPTION.match(option):
            raise SkillError(f"buttons[{i}]: option {option!r} must be a short word of a-z and _ (at most 16)")
        if not 0 < len(label) <= 30:
            raise SkillError(f"buttons[{i}]: label must say what the button does, in 30 characters at most")
        if mark is not None and mark not in MARK_ICONS:
            raise SkillError(f"buttons[{i}]: mark {mark!r} is not one of {', '.join(sorted(MARK_ICONS))}")
        if option in {x["option"] for x in out}:
            raise SkillError(f"buttons[{i}]: option {option} is given twice")
        out.append({"option": option, "label": label, "mark": mark})
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
    """Every AI job the skills declare, in skill order: each runs with its skill's policy.yaml settings.skill_ai."""
    return [(sk, job) for _, sk in sorted(skills.items()) for job in sk.schedule if job.get("prompt")]


def job_owners(skills: dict) -> dict[str, str]:
    """{AI job: the skill that declares it}: whose brain and limit it runs with (policy.Policy.job_settings)."""
    return {job["name"]: sk.name for sk, job in ai_jobs(skills)}


def job_title(skill: str, what: str) -> str:
    """THE words for one job of a skill, wherever the page names one (owner, 2026-10-20: "follow the same standard as
    preventive-maintenance › recheck.py"): its skill, then what ran — an AI job's name ("reports › fm-daily") or a code
    job's script ("preventive-maintenance › nightly.py"). Overview › Scheduled jobs run and the Costs tab both use it."""
    return f"{skill} › {what}"


def job_starters(skills: dict) -> dict[str, dict]:
    """{skill: its jobs' starter {"brain", "limit_usd"}} for every skill with AI jobs (Skill.jobs_default)."""
    return {sk.name: dict(sk.jobs_default) for _, sk in sorted(skills.items()) if sk.jobs_default}


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
        """Copy each starter skill ONCE — all of them on the first start, a new one on the first start of the release
        that brings it — then never again. Returns the names copied.

        ⚠️ THE RECORD, NOT THE FOLDERS, SAYS WHAT WAS GIVEN: checking "is this skill
        there?" would bring a deleted skill back at the next start."""
        os.makedirs(self.dir, exist_ok=True)
        if not self.starter_dir or not os.path.isdir(self.starter_dir):
            return []
        marker = os.path.join(self.dir, SEEDED)
        given = self._offered(set(OFFERED_BEFORE_THE_RECORD) if os.path.exists(marker) else set())
        starters = sorted(n for n in os.listdir(self.starter_dir) if os.path.isdir(os.path.join(self.starter_dir, n)))
        copied = []
        for name in starters:
            dst = os.path.join(self.dir, name)
            if name not in given and not os.path.exists(dst):
                shutil.copytree(os.path.join(self.starter_dir, name), dst, ignore=shutil.ignore_patterns("__pycache__"))
                copied.append(name)
        if not os.path.exists(marker):
            with open(marker, "w", encoding="utf-8") as f:
                f.write("The starter skills were copied here once. Delete a skill's folder to remove it; "
                        "it will not come back.\n")
        if set(starters) - given or not os.path.exists(os.path.join(self.dir, OFFERED)):
            path = os.path.join(self.dir, OFFERED)
            with open(path + ".tmp", "w", encoding="utf-8") as f:
                json.dump(sorted(given | set(starters)), f, indent=1)
            os.replace(path + ".tmp", path)          # whole or not at all: half a record would forget a deletion
        return copied

    def _offered(self, before: set[str]) -> set[str]:
        """The starter skills this install was given (OFFERED); `before` when it has no record yet."""
        try:
            with open(os.path.join(self.dir, OFFERED), encoding="utf-8") as f:
                return set(json.load(f))
        except (OSError, ValueError, TypeError):
            return before

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
        updated, kept = [], []
        for name in sorted(os.listdir(self.starter_dir)):
            if not os.path.isdir(os.path.join(self.starter_dir, name)):
                continue
            self.recover(name)
            v = self.verdict(name)
            if v == EDITED:
                kept.append(name)
            elif v == UPDATE:
                shutil.rmtree(self._replace(name), ignore_errors=True)
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
    def commands(self, include_off: bool = False) -> dict[str, str]:
        """"/command" → the skill it starts, for the skills switched on (Skill.command) — or every skill, `include_off`
        (a switched-off skill's command is answered, never dropped: intake.gate); the first name wins a clash."""
        out: dict[str, str] = {}
        for name, sk in self.all(include_off=include_off).items():
            for cmd in ([sk.command] + sk.also) if sk.command else []:
                out.setdefault("/" + cmd, name)
        return out

    def all(self, include_off: bool = False) -> dict[str, Skill]:
        """The skills the agent uses — without those the villa switched off, unless `include_off` (the page)."""
        switched_off = set(self._off() or ())
        off = set() if include_off else switched_off
        out: dict[str, Skill] = {}
        try:
            names = sorted(os.listdir(self.dir))
        except OSError:
            return out
        seen = set()
        claimed: dict[str, str] = {}       # an AI job's name → the skill that declares it
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
                # ⚠️ ONE JOB PER NAME (architecture review 14, 2026-10-10): a job's name is its key in policy.yaml (its
                # brain and limit), its Costs row and its "already running" — a copied test skill declaring fm-weekly
                # shared all three, and start_job ran whichever came first. The second one is refused, and said.
                jobs = [j["name"] for j in sk.schedule if j.get("prompt")]
                twice = next((n for n in jobs if jobs.count(n) > 1), None)
                # ⚠️ BY THE VILLA'S OWN SWITCHES, WHOEVER ASKS (architecture review 16): judged on `off`, the page's reading
                # (include_off: nothing off) let a switched-off copy claim the name first, and the live skill read "not
                # working" on the page and in the Offline Test while the agent used it. A switched-off skill claims nothing
                # and is refused for nothing: it is off.
                taken = next((n for n in jobs if n in claimed), None) if name not in switched_off else None
                if (twice and name not in switched_off) or taken:
                    whose = f"the skill {claimed[taken]}'s" if taken else "another of its own"
                    self._report(name, f"its AI job {twice or taken} has the same name as {whose}: rename it in "
                                       "skill.yaml: switched off")
                    seen.add(name)
                    continue
                self._report(name, "")
                if name not in switched_off:
                    claimed.update({n: name for n in jobs})
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
    # ⚠️ ONE VERDICT, ONE REPLACE (architecture review 16, 2026-10-10): the start-up update compared fingerprints and the
    # page compared files, each reading the shipped list itself; and "Take the release version" replaced the folder
    # without the .old step the update had — stopped between the two moves, the skill was left only in the trash, the
    # next start took it for deleted by the owner, and a stray name.new stayed.
    def _shipped(self) -> dict:
        try:
            with open(os.path.join(os.path.dirname(self.starter_dir), SHIPPED), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def verdict(self, name: str) -> str:
        """A skill against this release: OWN (not a starter skill), GONE (a starter skill not here: deleted by the owner),
        SAME (as the release), UPDATE (a version a release shipped: updated at start), EDITED (changed here). It only
        reads: the page asks it from its own process, which must never move a folder the agent may be replacing."""
        src, dst = os.path.join(self.starter_dir or "", name), os.path.join(self.dir, name)
        if not self.starter_dir or not os.path.isdir(src):
            return OWN
        if not os.path.isdir(dst):
            return GONE
        have = fingerprint(dst)
        if have == fingerprint(src):
            return SAME
        return UPDATE if have in self._shipped().get(name, []) else EDITED

    def recover(self, name: str) -> None:
        """A replacement cut short (_replace stopped between its two renames): the skill comes back as it was, the
        half-made copy goes. The agent alone calls it, at start, before anything reads the skills."""
        dst = os.path.join(self.dir, name)
        if not os.path.exists(dst) and os.path.isdir(dst + ".old"):
            os.rename(dst + ".old", dst)
        elif os.path.isdir(dst + ".old"):
            to_trash(self.dir, dst + ".old", name)       # replaced, then stopped before it was set aside: never erased
        shutil.rmtree(dst + ".new", ignore_errors=True)

    def _replace(self, name: str) -> str:
        """The skill replaced by this release's version, its villa.* files kept, in two renames with the old one set aside
        as name.old (verdict brings it back if this stops half way). Returns name.old, for the caller to drop or trash."""
        src, dst = os.path.join(self.starter_dir, name), os.path.join(self.dir, name)
        tmp, old = dst + ".new", dst + ".old"
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.copytree(src, tmp, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", VILLA_PREFIX + "*"))
        carry_villa_files(dst, tmp)                      # the villa's own files go with it
        shutil.rmtree(old, ignore_errors=True)
        os.rename(dst, old)
        os.rename(tmp, dst)
        return old

    def release_state(self, name: str) -> dict:
        """A skill against this release's starter: `follows` (equal to a version a release shipped), `edited`
        (a starter skill changed here: updates paused), `own` (not a starter skill). For an edited one, the files
        that differ, and whether the owner already chose to keep it as it is for this release."""
        v = self.verdict(name)
        if v == OWN:
            return {"state": "own"}
        dst, src = os.path.join(self.dir, name), os.path.join(self.starter_dir, name)
        have, new = skill_files(dst), skill_files(src)
        villa = sorted(k for k in have if os.path.basename(k).startswith(VILLA_PREFIX))
        if v == SAME:
            return {"state": "follows", "villa": villa}
        if v == UPDATE:
            return {"state": "follows", "villa": villa, "update_at_start": True}
        mine = {k: v_ for k, v_ in have.items() if k not in villa}
        differs = sorted(k for k in set(mine) | set(new) if mine.get(k) != new.get(k))
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
        # the same two renames as an update (_replace), the old one then trashed: never a moment with the skill only there
        return to_trash(self.dir, self._replace(name), name)

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
                        f"villa ({where('skill_commands')}, skill {skill_name}). Say so plainly; do not try another way.")
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
            most = limit("skills.text_arg_chars", 200, unit="characters", group="ai", lo=20, hi=5000,
                         says="The longest text the AI may pass to a skill script as one of its settings.",
                         reached="That script is not run; the AI is told the text is too long.", told="ai")
            if v.startswith("-") or len(v) > most:
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
        "VESTA_PACK": settings.pack_path,
        # read only, by convention and by review: the villa's policy (one reader: vesta_agent.policy)
        # and the agent's own records (what it cost, what it did) for the reports
        "VESTA_POLICY": settings.policy_path,
        # the villa's limits (vesta_shared.limits: the VESTA Agent page's Limits tab), beside policy.yaml
        "VESTA_LIMITS": os.path.join(getattr(settings, "config_dir", None) or os.path.dirname(settings.policy_path),
                                     "limits.yaml"),
        "VESTA_STATE": settings.state_path,
        "VILLA_TZ": settings.timezone,
        "TZ": settings.timezone,
        "VESTA_WEB_SEARCHES": getattr(settings, "web_searches", "") or "",
        "VESTA_WEB_SEARCH_ON": getattr(settings, "web_search_on", "") or "",
        "VESTA_ASKER": getattr(settings, "asker", "") or "",
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


def script_timeout_s() -> int:
    """How long one skill script may run when its skill names no time of its own."""
    return limit("skills.script_timeout_s", 900, unit="seconds", group="run", lo=30, hi=7200,
                 says="How long one skill script may run (the AI's, a scheduled job's step) when its skill names no "
                      "time of its own.",
                 reached="The script is stopped and counts as failed; the AI or the job is told.", told="ai")


def run_script(settings, skill: Skill, script: str, args: list[str], timeout: int | None = None) -> tuple[int, str, str]:
    """(exit code, stdout, stderr tail). Exit 2 is a script's "nothing to do / missing parameter", not a failure."""
    if not _script_file_ok(skill.path, script):
        return 127, "", f"{script} is not a script of {skill.name}"
    cmd = [sys.executable, skill.script_path(script)] + list(args) + injected(settings, skill, script)
    try:
        p = subprocess.run(cmd, cwd=settings.out_dir, env=script_env(settings), capture_output=True, text=True,
                           timeout=timeout or script_timeout_s())
    except subprocess.TimeoutExpired:
        return 124, "", "The script took too long and was stopped."
    lines = limit("errors.script_stderr_lines", 5, unit="lines", group="ai", lo=1, hi=200,
                  says="Lines of a failed script's own error output kept with its answer (what the AI and the page "
                       "read).",
                  reached="Only the last lines are kept.", told="")
    return p.returncode, (p.stdout or "").strip(), "\n".join((p.stderr or "").strip().splitlines()[-lines:])


def run_command(settings, skill: Skill, command: str, values: dict | None = None,
                timeout: int | None = None) -> tuple[int, str, str]:
    """A code job or hook from skill.yaml, placeholders filled: `desk.py intake --event {event}`."""
    parts = shlex.split(command)
    filled = [p.format(**(values or {})) if "{" in p else p for p in parts[1:]]
    return run_script(settings, skill, parts[0], filled, timeout)
