"""What VESTA may touch in Home Assistant. Enforced in code, never in the prompt.

Two layers (Fabien's brief, 29 September 2026):

Layer 1, the tools the model sees: only ha-mcp tools named one by one in
policy.yaml (`ha_read_tools`) are shown to the model; `ha_call_service` is
shown as a request for approval; `create_ticket` writes a Facility record in
the VESTA Kiosk, nothing physical. Everything else does not exist for the model. A tool added
by a later ha-mcp version stays hidden until its name is added by hand.

Layer 2, what a service call may do: every call is checked on its domain,
service, target entities and data, here, before an approval is even asked and
again right before it is executed.

The villa's lists live in VESTA_AGENT_CONFIG_DIR/policy.yaml. The NEVER rules below are code on
purpose: a file on the machine must not be able to allow a restart.
"""

from __future__ import annotations

import hashlib
import logging
import re
import json
import os
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import yaml

from vesta_shared.limits import limit
from vesta_shared.timeutil import lasting
from vesta_shared.villa_recipients import LANGUAGES

from .places import title
from .roster import role_can_approve
from .siren import always_owners

if TYPE_CHECKING:
    from .roster import Roster

# ------------------------------------------------------------------ constants
# The languages a person can be answered in: the agent writes in them, and the VESTA Kiosk offers exactly these beside
# each chat (owner, 2026-10-01: no free text). ⚠️ ONE LIST, THE AGREEMENT'S (owner, 2026-11-03: each chat's language is
# set in the Kiosk): agent-contract.json `recipients.languages`, read by both apps (vesta_shared.villa_recipients).


@dataclass(frozen=True)
class Language:
    """A language of LANGUAGES: its code (what the Kiosk tells for a chat) and its name (what the AI reads and writes).

    ⚠️ ONE MATCHING OF A CODE AND A NAME (architecture review H5, 2026-10-23): "fr" ↔ "French" was matched by hand in
    four places (the job's prompt, the person's line in a conversation, send_message's versions, its description),
    each with its own fallback, and the file check let any 2–3 letters through: a facility manager saved as "pt"
    reached the AI as "German and pt", and its natural answer {"Portuguese": …} was refused. A code outside the list
    is now a problem of the file (read_policy) and English for the agent, like any value the file check names."""
    code: str

    @property
    def name(self) -> str:
        return LANGUAGES[self.code]

    @classmethod
    def of(cls, code: str | None) -> "Language":
        """A stored code's language; English for one outside the list."""
        return cls(code) if isinstance(code, str) and code in LANGUAGES else cls("en")

    @classmethod
    def parse(cls, value) -> "Language | None":
        """A code or a name, in any case ("fr", "French", "FRENCH"); None when it is not one of the list."""
        word = str(value).strip().lower()
        return next((cls(c) for c, n in LANGUAGES.items() if word in (c, n.lower())), None)

    @classmethod
    def name_of(cls, value) -> str:
        """A code's or a name's name in the list; one outside it as it was given (a language Whisper heard)."""
        lang = cls.parse(value)
        return lang.name if lang else str(value)


# Refused even with an approval record. Not configurable.
NEVER_DOMAINS = {
    "homeassistant", "hassio", "shell_command", "rest_command", "python_script",
    "pyscript", "command_line", "logger", "recorder", "system_log", "update",
    "backup", "hacs", "frontend", "persistent_notification", "conversation",
}
NEVER_SERVICES = {
    "mqtt.publish", "mqtt.dump", "automation.trigger", "automation.reload",
    "script.reload", "scene.reload", "scene.create", "scene.apply", "scene.delete",
    "input_boolean.reload", "input_number.reload", "input_text.reload", "input_select.reload",
    "zone.reload", "group.reload", "group.set", "group.remove", "template.reload",
    "script.turn_off",
}
# Keys that target entities indirectly (a whole area, a device, a label): refused,
# every call must name its entities so the entity rules can be checked.
INDIRECT_TARGET_KEYS = {"area_id", "device_id", "floor_id", "label_id"}

#: the people's roles and what the page calls them (architecture review 9: the page typed "Owner" / "Facility manager"
#: twice, and the chats' words a third time)
from vesta_shared.message_format import ROLE_WORDS  # noqa: E402  (the roles' words: "To:", history lines, the page)
ROLES = tuple(ROLE_WORDS)

# ------------------------------------------------------------------ the file's defaults, once
# ⚠️ THE ONE READER OF policy.yaml (owner, 2026-10-01): the agent, the settings loader
# (config.Settings.behaviour), the skills' scripts (siren time) and the UI's forms all
# take these values from here, never from a table of their own.
PROFILES = {
    # profile: (model for conversations, effort)
    "auto": ("sonnet", "medium"),
    "economy": ("haiku", "low"),
    "performance": ("opus", "high"),
}
#: When a chat's conversation context is deleted (settings.conversation_reset): value → what the page shows.
CONVERSATION_RESETS = ("daily_04_00", "after_8h_silence", "never")


def reset_at() -> str:
    """The daily reset's time, villa time ("daily_04_00": the stored choice keeps its first name)."""
    return limit("chat.reset_at", "04:00", unit="villa time", group="ai",
                 says="When a chat's earlier messages are forgotten each day, with \"Delete conversation context at\" "
                      "set to the daily reset.",
                 reached="Messages before it are not given to the AI any more.", told="")


def silence_reset_hours() -> int:
    """The silence after which a chat starts afresh ("after_8h_silence")."""
    return limit("chat.silence_reset_hours", 8, unit="hours", group="ai", lo=1, hi=168,
                 says="After this long without a message, a chat's earlier messages are forgotten, with \"Delete "
                      "conversation context at\" set to the silence.",
                 reached="Messages before the silence are not given to the AI any more.", told="")


def reset_words() -> dict[str, str]:
    """The choices of "Delete conversation context at", as the page shows them: their times are settings now
    (owner, 2026-10-24: "04:00" and "8 hours" were written in the words)."""
    return {"daily_04_00": f"Every day at {reset_at()}", "after_8h_silence": f"After {lasting(silence_reset_hours() * 3600)} of silence",
            "never": "Never (/new only)"}


def value_words(path: str, value) -> str | None:
    """A rule's stored value in the page's own words, where it has some (a choice's: "After 12h of silence"),
    else None — the ONE reading for the Limits tab's drop-down, its save line and Page changes (review L, 2026-10-25:
    those said "after_8h_silence", a code that names a number no longer its own)."""
    if path == "settings.conversation_reset":
        return reset_words().get(value)
    return None
#: The brains from the lightest to the strongest: an older file's jobs of one skill that named different brains give the
#: skill the strongest of them (Policy.skill_brain)
PROFILE_ORDER = ("economy", "auto", "performance")
_said_brains: set = set()          # an older file's differing brains, said once each in the log


def profile_labels() -> dict[str, str]:
    """Each brain as the VESTA Agent page shows it — "Auto (Sonnet)" — from PROFILES, so the page never
    keeps its own copy of which model a brain is."""
    return {p: f"{p.capitalize()} ({model.capitalize()})" for p, (model, _effort) in PROFILES.items()}
DEFAULT_BEHAVIOUR = {"profile": "auto", "reply_limit_usd": 1.0, "web_search": True, "conversation_reset": "daily_04_00"}
#: How long the agent keeps what it records (settings.keep; owner, 2026-10-06): before this, nothing
#: was ever deleted. name: (default, lowest, highest). The villa's history (incidents, findings, tasks,
#: proposals) is kept: a few rows a day, and the record of what happened in the villa.
KEEP = {
    "runs_days": (400, 31, 3650),           # each AI run: the Costs tab and its "Every run" (a year and a month)
    "records_days": (90, 7, 3650),          # the agent's other records: refusals, voice, approvals decided, Continue
    "conversations_days": (30, 1, 365),     # the AI's conversation transcripts (a conversation resumes for a day at most)
    "files_days": (90, 7, 3650),            # its out folder: alert copies, report pages, saved files
    "daily_figures_months": (24, 2, 120),   # the skills' daily figures per device (the baselines read 30 days)
}
#: What each of KEEP keeps, in the words the Limits tab shows on its row (owner, 2026-10-31: every row says in full
#: what it controls; "How long the agent keeps: files days." did not). housekeeping.py deletes by these, nightly.
KEEP_SAYS = {
    "runs_days": "How long each AI run is kept for the Costs tab and its list of every run.",
    "records_days": "How long the agent's other records are kept: refusals, voice messages, decided approvals, "
                    "Continue offers and the history of changes made on this page.",
    "conversations_days": "How long the AI's conversation transcripts are kept (a conversation resumes for a day at "
                          "most).",
    "files_days": "How long report pages, alert copies and files VESTA saved are kept on the villa's disk before the "
                  "nightly clean-up deletes them; skills put in the trash are deleted then too.",
    "daily_figures_months": "How long the skills keep each device's daily figures, from which its normal is learned.",
}
#: The agent's two numbers, name: (default, lowest, highest) — the ONE table the check below, the Limits tab's rows and
#: the Rules tab's inputs read (architecture review P: the bounds were written in all three).
NUMBERS = {
    "approval_ttl_minutes": (15, 1, 1440),  # how long an Approve or Refuse button works
    "siren_auto_off_min": (3, 1, 60),       # when a siren the agent switched on stops
}
#: What each of NUMBERS does, as the Limits tab's row says it (the Rules tab's short title is WORDS, beside its input)
NUMBERS_SAYS = {
    "approval_ttl_minutes": "How long the Approve and Refuse buttons of a request keep working after it is sent.",
    "siren_auto_off_min": "How long a siren the agent switched on sounds before the agent switches it off.",
}

DEFAULTS = {"act_enabled": False, **{k: d for k, (d, _lo, _hi) in NUMBERS.items()}}


@dataclass
class Decision:
    allowed: bool
    reason: str
    required_role: str | None = None      # "owner" or "any" (owner or fm)
    domain: str = ""
    service: str = ""
    entity_ids: list[str] = field(default_factory=list)
    data: dict = field(default_factory=dict)
    direct: bool = False                  # no approval when a listed person asked (rule `direct`)

    def action_hash(self) -> str:
        return action_hash(self.domain, self.service, self.entity_ids, self.data)


def action_hash(domain: str, service: str, entity_ids: list[str], data: dict) -> str:
    canon = json.dumps({"d": domain, "s": service, "e": sorted(entity_ids), "x": data or {}},
                       sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canon.encode()).hexdigest()


ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")


def _as_list(v: Any) -> list[str]:
    """Every way of writing entity ids becomes one clean list: commas split inside strings AND inside list
    items, spaces stripped, lower case (Home Assistant lowercases ids, so the checks must too)."""
    if v is None:
        return []
    items = [v] if isinstance(v, str) else list(v) if isinstance(v, (list, tuple, set)) else [v]
    out: list[str] = []
    for x in items:
        for part in str(x).split(","):
            part = part.strip().lower()
            if part:
                out.append(part)
    return out


# ⚠️ ONE READER PER KIND OF VALUE, FOR THE AGENT AND FOR problems() ALIKE (architecture review, 0.12.37). The
# file is read twice — leniently by Policy, strictly by problems() — and the two halves coerced each value their
# own way and disagreed: `act_enabled: "false"` written by hand was flagged by problems() but read as ON by the
# agent (bool("false") is True); a chat id written as text crashed Policy() (int("@villa")), and with it every
# message and job; a person with a negative id was "ignored" in words and registered in fact. Each reader below
# says whether the value is valid; the agent uses the default exactly when problems() names the value.

def read_bool(v: Any, default: bool) -> tuple[bool, bool]:
    """(value, valid): only a real true/false is valid; anything else is the default."""
    return (v, True) if isinstance(v, bool) else (default, False)


def read_int_in(v: Any, lo: int, hi: int, default: int) -> tuple[int, bool]:
    """(value, valid): a whole number in [lo, hi]; anything else (text, a bool, out of range) is the default."""
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        return default, False
    return v, True


def _int_in(v: Any, lo: int, hi: int, default: int) -> int:
    return read_int_in(v, lo, hi, default)[0]


class Policy:
    def __init__(self, raw: dict, roster: "Roster | None" = None):
        """The file's values as the agent uses them: read_policy's, the default where it names a problem.

        `roster`: who is who (vesta_agent.roster.Roster: the VESTA Kiosk's lists and each chat's language). ⚠️ A
        CALLER THAT NEEDS ONLY RULES PASSES NONE (architecture review round 17, lead 1): the page's forms, the setup
        copy, the Limits tab and the alert desk read rules only, and were silently "nobody" when one asked who is who.
        Asked of a Policy built without one, `roster` is an error, never an empty list."""
        self.raw = raw if isinstance(raw, dict) else {}
        v, self.problems = read_policy(self.raw)
        self._roster = roster
        self.act_enabled: bool = v["act_enabled"]
        self.approval_ttl_minutes: int = v["approval_ttl_minutes"]
        # ⚠️ A SAFETY STOP, SO NEVER ABSENT: an unreadable value still stops the siren (and the problem is named).
        self.siren_auto_off_min: int = v["siren_auto_off_min"]
        self.behaviour: dict = v["behaviour"]
        # ⚠️ ONE BRAIN AND ONE LIMIT FOR ALL THE AI JOBS OF A SKILL (owner, 2026-10-20): {skill: {brain, limit_usd}}.
        # What a job runs with is job_settings'. The two older shapes are still read until the page's next save moves
        # them (policy_doc.ai_moved): `jobs` {job: {limit_usd[, profile]}} and `skill_brains` {skill: brain}.
        self.skill_ai: dict[str, dict] = v["skill_ai"]
        self.jobs: dict[str, dict] = v["jobs"]
        self.skill_brains: dict[str, str] = v["skill_brains"]
        self.keep: dict[str, int] = v["keep"]
        self.owner_only: set[str] = v["owner_only"]
        self.excluded: set[str] = v["excluded"]
        self.allowed_services: dict[str, str] = v["allowed_services"]
        self.lists: dict[str, set[str]] = v["lists"]
        self.notify_recipients: set[str] = v["notify_recipients"]
        self.ha_read_tools: list[str] = v["ha_read_tools"]
        # AI tools (0.6.42; tool_access.py reads these): absent means on / everything switched on
        self.agent_tools: dict[str, bool] = v["agent_tools"]
        self.tool_access: dict[str, dict[str, bool]] = v["tool_access"]
        self.skills_off: set[str] = v["skills_off"]
        self.siren_entity: str | None = v["siren_entity"]
        self.system_actions: list[tuple[str, str | None]] = v["system_actions"]

    @property
    def owners_alone(self) -> set[str]:
        """What only the owner may approve: the owner-only list, and the configured siren whatever that list says
        (siren.always_owners: the siren's rule, one place)."""
        return always_owners(self.owner_only, self.siren_entity)

    @property
    def roster(self) -> "Roster":
        """Who is who (vesta_agent.roster). Raises for a Policy built for its rules only."""
        if self._roster is None:
            raise LookupError("This Policy was built for its rules only: who is who needs its Roster "
                              "(config.Settings.policy, ui.changes.page_policy).")
        return self._roster

    @classmethod
    def load(cls, path: str, roster: "Roster | None" = None) -> "Policy":
        """policy.yaml at `path` ({} when there is none), with `roster` (None: rules only)."""
        if not path or not os.path.exists(path):
            return cls({}, roster)
        with open(path, encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        return cls(raw if isinstance(raw, dict) else {}, roster)

    # ------------------------------------------------------------------ the AI jobs
    def skill_brain(self, skill: str | None, job_names) -> str | None:
        """The brain every AI job of `skill` runs with: its skill_brains entry — else, for an older file, the strongest
        `profile` its jobs `job_names` still give (they agreed on the villa: auto, auto, auto). None: not set."""
        if skill and skill in self.skill_brains:
            return self.skill_brains[skill]
        old = {self.jobs[n]["profile"] for n in job_names if "profile" in self.jobs.get(n, {})}
        if not old:
            return None
        strongest = max(old, key=PROFILE_ORDER.index)
        if len(old) > 1 and (skill, frozenset(old)) not in _said_brains:
            _said_brains.add((skill, frozenset(old)))
            logging.getLogger("vesta.policy").info(
                "The AI jobs of %s name different brains (%s): all of them run with the strongest, %s, until "
                "Rules › AI brains and limits sets the skill's one brain.", skill or "?", ", ".join(sorted(old)), strongest)
        return strongest

    def skill_setting(self, skill: str, owners: dict[str, str], starters: dict[str, dict]) -> dict | None:
        """The brain and the limit per run every AI job of `skill` runs with, {"brain", "limit_usd"}: its skill_ai
        entry; for an older file that set any of its jobs, the brain those set (skill_brain) and the skill's own
        starter limit (skills.Skill.jobs_default — owner, 2026-10-20: "set this limit to 2 USD", never the largest of
        the old ones). None: not set — its jobs do not run (owner, 2026-10-01)."""
        if skill in self.skill_ai:
            return dict(self.skill_ai[skill])
        mates = [n for n, s in owners.items() if s == skill]
        if skill not in self.skill_brains and not any(n in self.jobs for n in mates):
            return None
        brain = self.skill_brain(skill, mates)
        limit = (starters.get(skill) or {}).get("limit_usd")
        return {"brain": brain, "limit_usd": float(limit)} if brain and limit else None

    def job_settings(self, owners: dict[str, str], starters: dict[str, dict]) -> dict[str, dict]:
        """Each AI job that runs: {name: {profile, limit_usd}} — its skill's one brain and one limit per run.
        `owners`: {job: its skill} and `starters`: {skill: its starter values}, the skills' own declarations
        (skills.job_owners, skills.job_starters). A job whose skill is not set is absent: it does not run."""
        out = {}
        for name, skill in owners.items():
            got = self.skill_setting(skill, owners, starters)
            if got:
                out[name] = {"profile": got["brain"], "limit_usd": got["limit_usd"]}
        return out

    # ------------------------------------------------------------------ layer 2
    def check_service(self, domain: str, service: str, entity_id: Any = None, data: dict | None = None,
                      system: bool = False, siren: str | None = None) -> Decision:
        """Decide whether a service call may be asked for (and later executed).

        system=True is for the few calls the code itself makes without a person
        (the agent's own heartbeat helper): they must be listed in
        policy.system_actions, and the NEVER rules still apply.
        """
        domain = (domain or "").strip().lower()
        service = (service or "").strip().lower()
        data = dict(data or {})
        ents = _as_list(entity_id)
        if "entity_id" in data:
            ents += _as_list(data.pop("entity_id"))
        target = data.get("target")
        if isinstance(target, dict):
            target = dict(data.pop("target"))
            if "entity_id" in target:
                ents += _as_list(target.pop("entity_id"))
            if any(k in target for k in INDIRECT_TARGET_KEYS):
                return Decision(False, "Targets must be named entities, not a whole area, device or label.")
            if target:
                return Decision(False, f"Unknown target keys: {', '.join(sorted(target))}.")
        ents = sorted(set(ents))
        full = f"{domain}.{service}"
        d = Decision(False, "", None, domain, service, ents, data)

        def deny(reason: str) -> Decision:
            d.allowed, d.reason = False, reason
            return d

        if not domain or not service:
            return deny("A service needs a domain and a name.")
        if domain in NEVER_DOMAINS:
            return deny(f"{domain} services are never allowed, even with an approval.")
        if full in NEVER_SERVICES:
            return deny(f"{full} is never allowed, even with an approval.")
        if service == "toggle" or service.endswith("_toggle") or "toggle" in service:
            return deny("Toggles are refused: name the final state (turn on, turn off, lock, unlock...).")
        if any(k in data for k in INDIRECT_TARGET_KEYS):
            return deny("Targets must be named entities, not a whole area, device or label.")
        bad = [e for e in ents if not ENTITY_ID.match(e)]
        if bad:
            return deny(f"Not a valid entity id: {', '.join(bad)}.")

        if system:
            # ⚠️ THE SIREN'S OWN STOP IS ALWAYS THE AGENT'S TO MAKE (architecture review, 2026-10-07): it needed a line in
            # system_actions, which only the file holds — a siren chosen on the page kept sounding past
            # siren_auto_off_min. Switching the configured siren OFF is implied; nothing else is. `siren`: the one the agent
            # itself turned on (siren.py records it) — stopped even when the rules changed or could not be read since
            # (architecture review 18: an emptied file or another siren chosen meanwhile left it sounding).
            siren_off = any(s and ents == [s] and s.split(".")[0] in SIREN_DOMAINS and full == f"{s.split('.')[0]}.turn_off"
                            for s in (self.siren_entity, siren))
            if siren_off or (full, ents[0] if len(ents) == 1 else None) in self.system_actions:
                d.allowed, d.reason, d.required_role = True, "system action", "system"
                return d
            return deny(f"{full} is not a listed system action.")

        if domain == "notify":
            if full not in self.notify_recipients and service not in self.notify_recipients:
                return deny(f"{full} is not a listed recipient.")
            d.allowed, d.reason, d.required_role = True, "notify recipient listed", "any"
            return self._act_gate(d)

        mode = self.allowed_services.get(full)
        if mode is None:
            return deny(f"{full} is not in the allowed services of this villa.")
        if not ents:
            return deny("Name the device or devices to act on.")
        for e in ents:
            if e in self.excluded:
                return deny(f"{e} is excluded.")
            if e.split(".")[0] != domain:
                return deny(f"{e} is not a {domain} entity.")
        if mode == "listed":
            allowed = self.lists.get(domain, set())
            missing = [e for e in ents if e not in allowed]
            if missing:
                return deny(f"Not on this villa's list for {domain}: {', '.join(missing)}.")
            role = "any"
        elif mode == "owner":
            role = "owner"
        elif mode == "any":
            role = "any"
        elif mode == "direct":
            role, d.direct = "any", True
        else:
            return deny(f"Unknown rule '{mode}' for {full} in policy.yaml.")
        if any(e in self.owners_alone for e in ents):
            role, d.direct = "owner", False
        d.allowed, d.required_role = True, role
        d.reason = "allowed without approval when a person asks" if d.direct and role == "any" else "allowed with approval"
        return self._act_gate(d)

    def _act_gate(self, d: Decision) -> Decision:
        if not self.act_enabled:
            d.allowed = False
            d.reason = "Acting on the villa is not switched on yet (v1 informs only)."
        return d

    #: the roles' rule of approving (roster.role_can_approve): a Policy's callers ask it here
    role_can_approve = staticmethod(role_can_approve)

    def summary(self) -> str:
        """Plain words for the system prompt. The code holds the rules; this only tells the model."""
        if not self.act_enabled:
            return ("Acting on the villa is switched OFF: you inform only. Never offer to request an action "
                    "(no \"shall I turn it on?\", no \"do you want me to lock it?\"). If someone asks for one, say plainly "
                    "that acting is not switched on yet; do not call ha_call_service.")
        direct = sorted(k for k, v in self.allowed_services.items() if v == "direct")
        return ("Acting on the villa is switched on. An action is a request that a person approves with a "
                "button; you never execute anything yourself."
                + (f" Exception: {', '.join(direct)} run at once when the person writing to you asks for them; "
                   "ha_call_service then tells you the result: report it as it is." if direct else ""))


# ------------------------------------------------------------------ the file's own checks
# ⚠️ ONE SCHEMA FOR THE FILE, ITS CHECKS AND THE PAGE'S FORM (architecture review, 0.12.30). The page kept
# its own copies of the rules, the lists and their domains, and they drifted: "Buttons it may press" offered
# input_button entities this file's check refuses, and the siren picker offered siren entities the alert desk
# then called switch.turn_on on. The page now draws its forms from FORM_SCHEMA (served by /api/policy).
RULE_WORDS = {
    # the roles in their one set of words (message_format.ROLE_WORDS; owner, 2026-10-17: never a role's word written
    # twice — a renamed role would leave these behind)
    "any": f"the {ROLE_WORDS['owner'].lower()} or the {ROLE_WORDS['fm'].lower()} approves",
    "owner": f"only the {ROLE_WORDS['owner'].lower()} approves",
    "listed": "only the devices chosen beside it, then approval",
    "direct": "no approval when someone on the villa's lists asks",
}
RULES = tuple(RULE_WORDS)
ENTITY_LISTS = {"owner_only_entities": None, "excluded_entities": None, "switch_entities": "switch",
                "scene_allowlist": "scene", "script_allowlist": "script", "button_allowlist": "button"}
#: The siren: turned on and off with its OWN domain's service (switch.turn_on, siren.turn_on), checked like
#: any other action against allowed_services / system_actions.
SIREN_DOMAINS = ("switch", "siren")
#: What an action can be asked on: the devices "only the owner may approve" makes sense for.
ACTIONABLE = ("lock", "cover", "switch", "light", "fan", "climate", "script", "scene", "button", "input_button",
              "siren", "input_boolean", "media_player", "valve", "water_heater", "vacuum", "alarm_control_panel")
_LIST_WORDS = {
    "switch_entities": ("Switches it may turn on or off", 'Only for the switch services set to "listed".'),
    "scene_allowlist": ("Scenes it may start", "A scene can do anything: add one only after reading it."),
    "script_allowlist": ("Scripts it may run", "Same care as scenes."),
    "button_allowlist": ("Buttons it may press", "Never a restart button."),
}


#: ⚠️ ONE TABLE OF policy.yaml'S SETTINGS (architecture review, 2026-10-07). Five lists named the same sections
#: (here, the forms, the setup copy, the history's words, the page) and three wrote their labels: the history said
#: "Limit per reply (US$)" and "An Approve button works for" where the page said "(USD)" and "Approve buttons work
#: for". path → (what the page and the history call it, edited by the Rules forms, the part of a copied setup that
#: carries it — None: it stays with the villa). Everything else reads it: SECTIONS, policy_doc.FORM_KEYS,
#: setup_copy, history.WORDS, and the page through form_schema()["words"]. A section's name is its place on the page
#: (places.py), so the history and the page cannot call it two things.
FIELDS: dict[str, tuple[str, bool, str | None]] = {
    "settings": (title("ai"), True, None),                   # its keys carry their own part
    "settings.profile": ("Brain for chat answers", True, "ai"),
    "settings.reply_limit_usd": ("Limit per reply (US$)", True, "ai"),
    "settings.web_search": ("Web search", True, "ai"),
    "settings.conversation_reset": ("Delete conversation context at", True, "ai"),
    "settings.skill_ai": ("Brain and limit of a skill's AI jobs", True, "ai"),
    "settings.keep": ("How long records are kept", True, "keep"),
    "act_enabled": ("The agent may act on the villa", True, None),
    "approval_ttl_minutes": ("Approve buttons work for (minutes)", True, None),
    # an older file's chat languages, its People rows, then its one chat per role: who is who and each chat's language
    # are the VESTA Kiosk's (owner, 2026-11-03); read for nothing, dropped by the page's next save (policy_doc.kiosk_moved)
    "languages": (f"{title('people')}: language (now set in the VESTA Kiosk)", False, None),
    "people": (f"{title('people')} (the VESTA Kiosk's lists)", False, None),
    "chats": ("Chats (now the VESTA Kiosk's lists)", False, None),
    "allowed_services": (title("actions"), True, "actions"),
    "owner_only_entities": ("Only the owner may approve", True, None),
    "excluded_entities": ("Left alone", True, None),
    "siren_entity": ("Siren", True, None),
    "siren_auto_off_min": ("Siren stops after (minutes)", True, None),
    **{k: (_LIST_WORDS[k][0], True, None) for k in _LIST_WORDS},
    "ha_read_tools": (title("ha_tools"), True, "tools"),
    "agent_tools": (title("agent_tools"), True, "tools"),
    "tool_access": (title("tool_roles"), True, "tools"),
    "skills_off": ("Skills switched off", True, "tools"),
    "notify_recipients": ("Who is notified", False, None),      # edited in the file itself
    "system_actions": ("What the agent's own code may do", False, None),
}
SECTIONS = {k for k in FIELDS if "." not in k}
#: sections an older agent wrote and this one no longer reads: never "misspelt" (they were the agent's own), dropped
#: from the file at the Rules page's next save (policy_doc.apply_form)
RETIRED_SECTIONS = {
    # 0.12.308's own list, retired by 0.12.310: the devices asleep between reports are the VESTA Kiosk's list
    # (owner, 2026-10-21) — the red "Unknown section 'asleep_entities'" on the Rules page was this
    "asleep_entities",
}
WORDS = {k: v[0] for k, v in FIELDS.items()}


def form_sections() -> tuple[str, ...]:
    """The sections the Rules forms edit, in the table's order."""
    return tuple(k for k in SECTIONS_ORDER if FIELDS[k][1])


def setup_fields(part: str) -> list[str]:
    """The paths a copied setup's `part` carries ("ai", "keep", "actions", "tools")."""
    return [k for k, v in FIELDS.items() if v[2] == part]


SECTIONS_ORDER = tuple(k for k in FIELDS if "." not in k)


def form_schema() -> dict:
    """What the page's forms offer, from the same tables the checks below read."""
    return {"rules": RULE_WORDS, "actionable": list(ACTIONABLE), "siren_domains": list(SIREN_DOMAINS),
            "lists": [{"key": k, "label": _LIST_WORDS[k][0], "hint": _LIST_WORDS[k][1], "domains": [d]}
                      for k, d in ENTITY_LISTS.items() if d],
            "words": WORDS, "resets": reset_words(), "roles": ROLE_WORDS,
            "numbers": {k: {"lo": lo, "hi": hi} for k, (_d, lo, hi) in NUMBERS.items()}}

def _id(v: Any) -> int | None:
    """An id as the agent reads it (int(...)): a number, or a number written as text."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, str) and re.match(r"^-?[0-9]+$", v.strip()):
        return int(v)
    return None


def problems(raw: Any) -> list[str]:
    """What is wrong in a policy.yaml, in plain words — [] when nothing is.

    ⚠️ ONE OWNER FOR "IS THIS FILE RIGHT": the agent logs these when the file changes, and the page refuses to save
    a file that has any. Since 0.12.68 they are read_policy's own: the same pass that gives the agent its values."""
    if raw is None:
        return []
    if not isinstance(raw, dict):
        return ["The file must be a set of sections (name: value), not a list or a single value."]
    return read_policy(raw)[1]


def _one_of(value, choices) -> bool:
    """Is a value written in the file one of `choices`? ⚠️ NEVER A CRASH (architecture review 17, 2026-10-10): a list
    or a mapping where a word belongs ("profile: [opus]", by hand) made `value in choices` raise TypeError, and the
    agent stopped at every reading of its rules — no answer, no alert, and the siren's stop forgotten."""
    return isinstance(value, str) and value in choices


def read_policy(raw: dict) -> tuple[dict, list[str]]:
    """policy.yaml read ONCE: (the values the agent uses, what is wrong in plain words).

    ⚠️ ONE READING (architecture review, 2026-10-07). The file was parsed twice — leniently by Policy, strictly by
    problems() — about twenty fields each coerced two ways, and they disagreed: `allowed_services` written as a
    list crashed Policy() (and with it every reply and job: Settings.policy() did not catch it), a reply limit
    written as text was used, an unknown chat role let its group in. Now each field is read by one rule that says
    both: a value named here is the default for the agent, never a crash.
    One deliberate leniency: a device list written as text ("lock.a, lock.b") is still read, because emptying a
    PROTECTIVE list (only the owner may approve, left alone) over a slip would make the agent less safe."""
    from .tool_access import OWN, ROLE_GROUPS, CHOOSE
    out: list[str] = []
    v: dict[str, Any] = {}
    for k in raw:
        if k not in SECTIONS and k not in RETIRED_SECTIONS:
            out.append(f"Unknown section {k!r}: a misspelt name is ignored by the agent.")

    # ---- settings
    beh, jobs, keep, brains, skill_ai = dict(DEFAULT_BEHAVIOUR), {}, {k: d for k, (d, _lo, _hi) in KEEP.items()}, {}, {}
    s = raw.get("settings")
    if s is not None and not isinstance(s, dict):
        out.append("settings must be a set of name: value.")
    for k, val in (s or {}).items() if isinstance(s, dict) else ():
        if k == "profile":
            if _one_of(val, PROFILES):
                beh["profile"] = val
            else:
                out.append(f"settings.profile must be one of {', '.join(PROFILES)}.")
        elif k == "reply_limit_usd":
            if isinstance(val, bool) or not isinstance(val, (int, float)) or val < 0.05:
                out.append("settings.reply_limit_usd must be a number of at least 0.05.")
            else:
                beh["reply_limit_usd"] = float(val)
        elif k == "web_search":
            if isinstance(val, bool):
                beh["web_search"] = val
            else:
                out.append("settings.web_search must be true or false.")
        elif k == "conversation_reset":
            if _one_of(val, CONVERSATION_RESETS):
                beh["conversation_reset"] = val
            else:
                out.append(f"settings.conversation_reset must be one of {', '.join(CONVERSATION_RESETS)}.")
        elif k == "skill_ai":
            # ⚠️ ONE BRAIN AND ONE LIMIT PER RUN FOR A SKILL'S AI JOBS (owner, 2026-10-20): the reports' three jobs had
            # a brain and a limit each. An entry not understood is absent: its jobs do not run.
            if not isinstance(val, dict):
                out.append("settings.skill_ai must be skill name: {brain, limit_usd}.")
                continue
            for name, e in val.items():
                if not isinstance(e, dict) or set(e) != {"brain", "limit_usd"}:
                    out.append(f"settings.skill_ai.{name} must give brain and limit_usd.")
                    continue
                lim = e.get("limit_usd")
                if not _one_of(e.get("brain"), PROFILES):
                    out.append(f"settings.skill_ai.{name}.brain must be one of {', '.join(PROFILES)}.")
                elif isinstance(lim, bool) or not isinstance(lim, (int, float)) or lim < 0.05:
                    out.append(f"settings.skill_ai.{name}.limit_usd must be a number of at least 0.05.")
                else:
                    skill_ai[str(name)] = {"brain": e["brain"], "limit_usd": float(lim)}
        elif k == "skill_brains":
            # the 0.12.277 shape (a skill's brain; each job's limit in `jobs`): read until the page's next save
            if not isinstance(val, dict):
                out.append("settings.skill_brains must be skill name: brain.")
                continue
            for name, b in val.items():
                if _one_of(b, PROFILES):
                    brains[str(name)] = b
                else:
                    out.append(f"settings.skill_brains.{name} must be one of {', '.join(PROFILES)}.")
        elif k == "jobs":
            # an older file's AI jobs, each with its limit (and before 0.12.277 its `profile`): read until the page's
            # next save moves them to their skill's settings.skill_ai (policy_doc.ai_moved)
            if not isinstance(val, dict):
                out.append("settings.jobs must be job name: {limit_usd}.")
                continue
            for name, j in val.items():
                if not isinstance(j, dict) or set(j) - {"profile", "limit_usd"}:
                    out.append(f"settings.jobs.{name} must give limit_usd only.")
                    continue
                ok = True
                if "profile" in j and not _one_of(j.get("profile"), PROFILES):
                    out.append(f"settings.jobs.{name}.profile must be one of {', '.join(PROFILES)}.")
                    ok = False
                lim = j.get("limit_usd")
                if isinstance(lim, bool) or not isinstance(lim, (int, float)) or lim < 0.05:
                    out.append(f"settings.jobs.{name}.limit_usd must be a number of at least 0.05.")
                    ok = False
                if ok:
                    jobs[str(name)] = {"limit_usd": float(lim), **({"profile": j["profile"]} if "profile" in j else {})}
        elif k == "keep":
            # an unreadable value keeps its default: never "keep nothing"
            if not isinstance(val, dict):
                out.append("settings.keep must be a set of name: number.")
                continue
            for name, n in val.items():
                if name not in KEEP:
                    out.append(f"Unknown settings.keep.{name} (known: {', '.join(KEEP)}).")
                    continue
                d, lo, hi = KEEP[name]
                n2, valid = read_int_in(n, lo, hi, d)
                keep[name] = n2
                if not valid:
                    out.append(f"settings.keep.{name} must be a whole number from {lo} to {hi}.")
        else:
            out.append(f"Unknown setting {k!r}.")
    v["behaviour"], v["jobs"], v["keep"], v["skill_brains"], v["skill_ai"] = beh, jobs, keep, brains, skill_ai

    # ---- acting, and the two numbers
    # an unreadable value is OFF (the default), never on
    v["act_enabled"], valid = read_bool(raw.get("act_enabled", DEFAULTS["act_enabled"]), DEFAULTS["act_enabled"])
    if "act_enabled" in raw and not valid:
        out.append("act_enabled must be true or false.")
    for k, (_d, lo, hi) in NUMBERS.items():
        val = raw.get(k)
        v[k], valid = read_int_in(val, lo, hi, DEFAULTS[k])
        if val is not None and not valid:
            out.append(f"{k} must be a whole number from {lo} to {hi}.")

    # ---- who is who and each chat's language are the VESTA Kiosk's (owner, 2026-11-03): an older file's `languages:`,
    # `people:` and `chats:` are read for nothing and named nowhere (the agent's own older shapes), and the page's next
    # save drops them (policy_doc.kiosk_moved)

    # ---- the device lists (read even when written as text: see above)
    for key, domain in ENTITY_LISTS.items():
        val = raw.get(key)
        if val is None:
            continue
        if not isinstance(val, list):
            out.append(f"{key} must be a list of entity ids.")
            continue
        for e in val:
            if not isinstance(e, str) or not ENTITY_ID.match(e):
                out.append(f"{key}: {e!r} is not an entity id (domain.name).")
            elif domain and e.split(".")[0] != domain:
                out.append(f"{key}: {e} is not a {domain} entity.")
    v["owner_only"] = set(_as_list(raw.get("owner_only_entities")))
    v["excluded"] = set(_as_list(raw.get("excluded_entities")))
    v["lists"] = {d: set(_as_list(raw.get(k))) for k, d in ENTITY_LISTS.items() if d}

    # ---- the siren: an entity id of its domains, in lower case as every id the checks compare
    siren = raw.get("siren_entity")
    v["siren_entity"] = None
    if siren is not None and (not isinstance(siren, str) or not ENTITY_ID.match(siren.strip().lower())):
        out.append("siren_entity must be an entity id, or null.")
    elif siren is not None and siren.strip().lower().split(".")[0] not in SIREN_DOMAINS:
        out.append(f"siren_entity: {siren} is not a {' or '.join(SIREN_DOMAINS)} entity.")
    elif siren is not None:
        v["siren_entity"] = siren.strip().lower()

    # ---- what the agent may do: a service named here is not offered at all
    services: dict[str, str] = {}
    sraw = raw.get("allowed_services")
    if sraw is not None and not isinstance(sraw, dict):
        out.append("allowed_services must be service: rule.")
    for svc, rule in (sraw or {}).items() if isinstance(sraw, dict) else ():
        if not isinstance(svc, str) or not re.match(r"^[a-z0-9_]+\.[a-z0-9_]+$", svc):
            out.append(f"allowed_services: {svc!r} is not a service (domain.service).")
            continue
        ok = True
        if svc.split(".")[0] in NEVER_DOMAINS or svc in NEVER_SERVICES or "toggle" in svc.split(".")[1]:
            out.append(f"allowed_services: {svc} is never allowed, whatever the file says.")
            ok = False
        if not _one_of(rule, RULES):
            out.append(f"allowed_services: {svc} has the rule {rule!r}; use any, owner, listed or direct.")
            ok = False
        elif rule == "listed" and svc.split(".")[0] not in {d for d in ENTITY_LISTS.values() if d}:
            out.append(f"allowed_services: {svc} is listed, but there is no list for {svc.split('.')[0]}.")
            ok = False
        if ok:
            services[svc] = str(rule)
    v["allowed_services"] = services

    # ---- names lists
    for key in ("notify_recipients", "ha_read_tools"):
        val = raw.get(key)
        if val is not None and (not isinstance(val, list) or not all(isinstance(x, str) for x in val)):
            out.append(f"{key} must be a list of names.")
    v["notify_recipients"] = set(_as_list(raw.get("notify_recipients")))
    v["ha_read_tools"] = _as_list(raw.get("ha_read_tools"))
    for n in raw.get("ha_read_tools") if isinstance(raw.get("ha_read_tools"), list) else ():
        if isinstance(n, str) and not re.match(r"^[a-z][a-z0-9_]{1,60}$", n):
            out.append(f"ha_read_tools: {n!r} is not a tool name.")

    # ---- what the AI can use: a value not understood is ignored (on), never "everything off"
    choose = [k for k, x in OWN.items() if x[2] == CHOOSE and k != "web_search"]
    agent_tools: dict[str, bool] = {}
    at = raw.get("agent_tools")
    if at is not None and not isinstance(at, dict):
        out.append("agent_tools must be tool: true or false.")
    for k, val in (at or {}).items() if isinstance(at, dict) else ():
        if k == "web_search":
            out.append("agent_tools.web_search: web search is settings.web_search.")
        elif k not in choose:
            out.append(f"agent_tools: {k!r} is not one of the agent's tools a villa may switch off ({', '.join(choose)}).")
        elif not isinstance(val, bool):
            out.append(f"agent_tools.{k} must be true or false.")
        else:
            agent_tools[str(k)] = val
    v["agent_tools"] = agent_tools
    groups = {k for k, _ in ROLE_GROUPS}
    access: dict[str, dict[str, bool]] = {}
    ta = raw.get("tool_access")
    if ta is not None and not isinstance(ta, dict):
        out.append("tool_access must be fm: {group: true or false}.")
    for role, val in (ta or {}).items() if isinstance(ta, dict) else ():
        if role == "owner":
            out.append("tool_access.owner: the owner always has every tool that is switched on.")
        elif role != "fm":
            out.append(f"tool_access: {role!r} is not a role (fm).")
        elif not isinstance(val, dict):
            out.append("tool_access.fm must be group: true or false.")
        else:
            for g, on in val.items():
                if g not in groups:
                    out.append(f"tool_access.fm: {g!r} is not a group ({', '.join(sorted(groups))}).")
                elif not isinstance(on, bool):
                    out.append(f"tool_access.fm.{g} must be true or false.")
                else:
                    access.setdefault("fm", {})[str(g)] = on
    v["tool_access"] = access
    so = raw.get("skills_off")
    good = so if isinstance(so, list) else []
    if so is not None and (not isinstance(so, list) or not all(isinstance(x, str) and re.match(r"^[a-z0-9][a-z0-9_-]{0,60}$", x)
                                                                 for x in so)):
        out.append("skills_off must be a list of skill names.")
    v["skills_off"] = {x for x in good if isinstance(x, str)}

    # ---- the agent's own calls
    acts = raw.get("system_actions")
    if acts is not None and (not isinstance(acts, list) or not all(isinstance(a, dict) and set(a) <= {"service", "entity_id"} for a in acts)):
        out.append("system_actions must be a list of service: / entity_id: pairs.")
    v["system_actions"] = [(str(a.get("service")), a.get("entity_id")) for a in acts or []
                           if isinstance(a, dict) and set(a) <= {"service", "entity_id"}] if isinstance(acts, list) else []
    return v, out
