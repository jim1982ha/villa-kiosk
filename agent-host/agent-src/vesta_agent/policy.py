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
from typing import Any

import yaml

from vesta_shared.limits import limit

from .places import title

# ------------------------------------------------------------------ constants
# The languages a person can be answered in: the agent writes in them, and the VESTA Agent page offers
# exactly these in its menu (owner, 2026-10-01: no free text).
LANGUAGES = {"en": "English", "fr": "French", "id": "Indonesian", "de": "German", "es": "Spanish", "it": "Italian",
             "nl": "Dutch", "zh": "Chinese", "ja": "Japanese", "ko": "Korean"}


@dataclass(frozen=True)
class Language:
    """A language of LANGUAGES: its code (what policy.yaml stores) and its name (what the AI reads and writes).

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
        """A stored code's language; English for one outside the list (read_policy has named it)."""
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
# Telegram ids that are not a person: an admin posting as the group, a channel.
ANONYMOUS_TELEGRAM_IDS = {1087968824, 136817688, 777000}

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
    return {"daily_04_00": f"Every day at {reset_at()}", "after_8h_silence": f"After {silence_reset_hours()} hours of silence",
            "never": "Never (/new only)"}


def value_words(path: str, value) -> str | None:
    """A rule's stored value in the page's own words, where it has some (a choice's: "After 12 hours of silence"),
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
#: A value the file leaves out. The starter policy.example.yaml writes the same ones.
#: What a person policy.yaml does not know reads, wherever they write or press (one wording: a button press in
#: actions.py said "registered with VESTA", the others "the VESTA Agent" — review 6).
NOT_REGISTERED = "You are not registered with the VESTA Agent."

#: The agent's two numbers, name: (default, lowest, highest) — the ONE table the check below, the Limits tab's rows and
#: the Rules tab's inputs read (architecture review P: the bounds were written in all three).
NUMBERS = {
    "approval_ttl_minutes": (15, 1, 1440),  # how long an Approve or Refuse button works
    "siren_auto_off_min": (3, 1, 60),       # when a siren the agent switched on stops
}

DEFAULTS = {"act_enabled": False, **{k: d for k, (d, _lo, _hi) in NUMBERS.items()}}


@dataclass
class Person:
    telegram_id: int
    name: str
    role: str
    language: str = "en"


@dataclass
class Decision:
    allowed: bool
    reason: str
    required_role: str | None = None      # "owner" or "any" (owner or fm)
    domain: str = ""
    service: str = ""
    entity_ids: list[str] = field(default_factory=list)
    data: dict = field(default_factory=dict)
    direct: bool = False                  # no approval when a registered person asked (rule `direct`)

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
    def __init__(self, raw: dict):
        """The file's values as the agent uses them: read_policy's, the default where it names a problem."""
        self.raw = raw if isinstance(raw, dict) else {}
        v, self.problems = read_policy(self.raw)
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
        self.people: dict[int, Person] = v["people"]            # by Telegram id: the owner's entry when it has two
        self.entries: list[Person] = v["entries"]               # every entry, one per id and role (a group's included)
        # ⚠️ WHERE EACH ROLE'S MESSAGES GO IS THE PEOPLE LIST (owner, 2026-10-10: "each message shall be sent to either the
        # Owner profiles or the Facility Manager profiles"): every chat id listed with a role, a person's or a group's.
        # The Chats card (one chat per role) is gone; an older file's `chats:` is read as two more of these.
        self.destinations: list[tuple[int, str]] = v["destinations"]
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

    # ------------------------------------------------------------------ load
    @classmethod
    def load(cls, path: str) -> "Policy":
        if not path or not os.path.exists(path):
            return cls({})
        with open(path, encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        return cls(raw if isinstance(raw, dict) else {})

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

    # ------------------------------------------------------------------ people
    def person(self, telegram_id: int | None) -> Person | None:
        if telegram_id is None or int(telegram_id) in ANONYMOUS_TELEGRAM_IDS:
            return None
        return self.people.get(int(telegram_id))

    def member(self, telegram_id: int | None, chat_id: int | None, name: str | None = None) -> Person | None:
        """Who this is, writing or pressing in `chat_id`: their People entry; else, in a GROUP the People list names, a
        member of it with the group's role — the facility manager's when the group is listed for both (the narrower).

        ⚠️ A GROUP'S MEMBERS INHERIT ITS ROLE (owner, 2026-10-10: "a person in the group can naturally send messages in
        the group, without having to be defined as a people"): a People row also sends that person every message of
        their role in private, so a group member had to choose between no answer and every alert twice. A member's rights
        hold only in that group (an anonymous admin stays nobody).

        ⚠️ THE GROUP'S ROLE, WHOEVER WRITES THERE (owner, 2026-10-10: "people in a Telegram group inherit automatically the
        role of the Telegram group they are in, irrespective of their own individual role"): a listed person kept their
        row's role in the group, so an Owner group refused the siren's approval to JM (listed as Facility manager) and
        accepted it from any unlisted member. Their own row's role holds in their private chat."""
        p = self.person(telegram_id)
        if telegram_id is None or int(telegram_id) in ANONYMOUS_TELEGRAM_IDS or chat_id is None or int(chat_id) >= 0:
            return p
        role = self.group_role(chat_id)
        if role is None:
            return p
        if p is not None:
            # ⚠️ NAMED AS THIS CHAT KNOWS THEM (architecture review 21): listed twice (JM_O, JM_FM), a person pressing in
            # a group of the facility manager's read "Done pressed by JM_FM" on an alert and "Approved by JM_O" on a
            # request — the name of a role they did not have there. One name, `name_in`'s, for every press and record
            name = self.name_in(p.telegram_id, chat_id) or p.name
            return p if (p.role, p.name) == (role, name) else Person(p.telegram_id, name, role, p.language)
        group = next((e for e in self.entries if e.telegram_id == int(chat_id) and e.role == role), None)
        return Person(int(telegram_id), (name or "").strip() or f"a member of {group.name if group else 'the group'}",
                      role, group.language if group else "en")

    def may_approve_in(self, chat_id: int, required_role: str | None) -> bool:
        """Can someone acting in `chat_id` approve a request that needs `required_role`? The rule of `member`: a private
        chat is its person's role; a listed group, its role for everyone in it — the facility manager's when listed for
        both. Where a request's buttons go (routing.approver_chats) and who may press them (actions.decide) are this one
        answer (architecture review 21: an owner's request reached a group listed for both, where "Only the owner can
        approve this." answered every press)."""
        if int(chat_id) < 0:
            role = self.group_role(chat_id)
            return role is not None and self.role_can_approve(role, required_role)
        p = self.person(chat_id)
        return p is not None and self.role_can_approve(p.role, required_role)

    def knows_chat(self, chat_id: int) -> bool:
        """Is this a chat of the People list: a listed group, or the private chat of a listed person?"""
        return bool(self.roles_in(chat_id)) or int(chat_id) in self.people

    def chats_for(self, role: str, language: str | None = None) -> list[int]:
        """Every chat a message for `role` goes to: each id listed with that role, once, in the list's order — only
        those whose row reads `language` (a code) when one is given."""
        return list(dict.fromkeys(c for c, r in self.destinations
                                  if r == role and (language is None or self.language_of(c, role) == language)))

    def language_of(self, chat_id: int, role: str | None) -> str:
        """The language a chat reads its `role`'s messages in: its row's (an older file's `chats:` has none: en). No
        role (someone asking whose role is not known): the chat's first row."""
        return next((e.language for e in self.entries if e.telegram_id == int(chat_id)
                     and (role is None or e.role == role)), "en")

    def languages_for(self, role: str) -> list[str]:
        """Every language (a code) the chats of `role` read, once, in the list's order.

        ⚠️ ONE REPORT, EVERY READER'S LANGUAGE (owner, 2026-10-23: "I received the daily report in German, whereas I
        set my language to French"): a role's report was written in its FIRST row's language and that one text went
        to every chat of the role. A role read in two languages gets one version per language (tools send_message)."""
        return list(dict.fromkeys(self.language_of(c, role) for c in self.chats_for(role)))

    def roles_in(self, chat_id: int) -> set[str]:
        """The roles a chat is listed with ({} for a chat the People list does not name)."""
        return {r for c, r in self.destinations if c == int(chat_id)}

    def group_role(self, chat_id: int) -> str | None:
        """The ONE role everyone in a listed GROUP acts with — the facility manager's when the group is listed for both
        (never more where facility managers read) — or None for a private chat or a group the People list does not
        name. ⚠️ ONE ANSWER (architecture review, 2026-10-15): written three times (member, may_approve_in,
        tool_access), and reviews 18 and 21 were each one of them disagreeing with the others."""
        if int(chat_id) >= 0:
            return None
        roles = self.roles_in(chat_id)
        return ("fm" if "fm" in roles else "owner") if roles else None

    def name_in(self, telegram_id: int, chat_id: int) -> str | None:
        """A person's name as this chat knows them: their entry for a role the chat is listed with (Fabien_FM in a chat
        of the facility manager's only), else their name — the owner's entry when they have both."""
        roles = self.roles_in(chat_id)
        named = [e.name for e in self.entries if e.telegram_id == int(telegram_id) and e.role in roles]
        p = self.person(telegram_id)
        return named[0] if len(set(named)) == 1 else (p.name if p else None)

    def chat_label(self, chat_id: int) -> str:
        """Which chat this is, in words, never who is in it: "owner and fm group", "private chat"."""
        roles = " and ".join(sorted(self.roles_in(chat_id)))
        kind = "group" if int(chat_id) < 0 else "private chat"
        return f"{roles} {kind}" if roles else kind

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
        if any(e in self.owner_only for e in ents):
            role = "owner"
        d.allowed, d.required_role = True, role
        d.reason = "allowed without approval when a person asks" if d.direct and role == "any" else "allowed with approval"
        return self._act_gate(d)

    def _act_gate(self, d: Decision) -> Decision:
        if not self.act_enabled:
            d.allowed = False
            d.reason = "Acting on the villa is not switched on yet (v1 informs only)."
        return d

    @staticmethod
    def role_can_approve(person_role: str, required_role: str | None) -> bool:
        if required_role == "owner":
            return person_role == "owner"
        if required_role == "any":
            return person_role in ROLES
        return False

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
    "direct": "no approval when a registered person asks",
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
    "people": (title("people"), True, None),
    # an older file's one chat per role: read as rows of People, and moved there by the page's next save (policy_doc)
    "chats": ("Chats (now rows of People)", False, None),
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


def legacy_chats(raw: dict) -> dict[str, int]:
    """An older file's `chats:` section ({owner: id, fm: id}), its readable values only: what it said before People
    became the one list. Nothing is named wrong in it — the page moves it into People at its next save."""
    craw = raw.get("chats") if isinstance(raw, dict) else None
    return {k: _id(craw[k]) for k in ROLES if k in craw and _id(craw[k])} if isinstance(craw, dict) else {}


def legacy_rows(raw: dict) -> tuple[list[dict], dict[str, int]]:
    """An older file's chats as the page moves them: (the People rows it adds, the chats it leaves in `chats:`).

    ⚠️ A ROW OF PEOPLE WITH A POSITIVE ID IS A REGISTERED PERSON (architecture review 18). The old card's private chat of
    someone People does not list only RECEIVED its role's messages; made a row, it could write to the agent, press Done
    and approve. So a row is added only for a group, or for a chat of someone already listed (their other role); any
    other chat stays in `chats:`, where the agent still posts and nobody gains a right. One reading for the page
    (policy_doc) and its test; the agent reads every old chat as a destination (read_policy)."""
    plist = raw.get("people") if isinstance(raw, dict) and isinstance(raw.get("people"), list) else []
    listed = {(_id(p.get("telegram_id")), p.get("role")) for p in plist if isinstance(p, dict)}
    persons = {tid for tid, _ in listed if tid and tid > 0}
    rows, kept = [], {}
    for role, cid in legacy_chats(raw).items():
        if (cid, role) in listed:
            continue
        if cid < 0 or cid in persons:
            rows.append({"telegram_id": cid, "name": f"{ROLE_WORDS[role]} chat", "role": role, "language": "en"})
        else:
            kept[role] = cid
    return rows, kept


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

    # ---- people: a person is registered exactly when their id is valid; the first of a repeated id counts. A GROUP is
    # listed here too (a negative id): it is where its role's messages go, never a person — nobody writes as a group.
    people: dict[int, Person] = {}
    # ⚠️ ONE PERSON, TWO ROLES (owner, 2026-10-10: "allow a same Telegram ID to be defined both as owner and FM"): an id
    # may be listed once per role, each entry with its own name ("Fabien" the owner, "Fabien_FM" the facility manager).
    # The person is recognised with the owner's rights, the wider; each role's name is used where that role is meant.
    entries: list[Person] = []
    plist = raw.get("people")
    if plist is not None and not isinstance(plist, list):
        out.append("people must be a list.")
    for i, p in enumerate(plist or [] if isinstance(plist, list) else [], 1):
        if not isinstance(p, dict):
            out.append(f"people, entry {i}: must have telegram_id, name, role, language.")
            continue
        tid = _id(p.get("telegram_id"))
        who = p.get("name") or f"entry {i}"
        ok = True
        if tid is None or tid == 0:
            out.append(f"people, {who}: telegram_id must be the person's or the group's Telegram id (a group's is "
                       "negative; /whoami in the chat shows it). Until then the agent ignores this entry.")
            ok = False
        elif any(e.telegram_id == tid and e.role == p.get("role") for e in entries):
            out.append(f"people, {who}: telegram_id {tid} is listed twice as {p.get('role')}.")
            ok = False
        if not _one_of(p.get("role"), ROLES):
            out.append(f"people, {who}: role must be owner or fm.")
            ok = False
        name = str(p.get("name") or "").strip()
        if not name:
            out.append(f"people, entry {i}: a name is needed.")
        lang = p.get("language")
        # ⚠️ ONE OF THE MENU'S LANGUAGES (architecture review H5, 2026-10-23): any 2–3 letters passed here, though the
        # page offers only LANGUAGES; "pt" then reached the AI as a bare code. Named, and English until it is changed.
        if lang is not None and not _one_of(lang, LANGUAGES):
            out.append(f"people, {who}: language must be one of {', '.join(LANGUAGES)} (the page's menu); until then "
                       "the agent writes to them in English.")
            lang = None
        for extra in set(p) - {"telegram_id", "name", "role", "language"}:
            out.append(f"people, {who}: unknown field {extra!r}.")
        if ok:
            person = Person(tid, name or str(tid), p["role"], str(lang or "en"))
            entries.append(person)
            if tid > 0 and (tid not in people or person.role == "owner"):
                people[tid] = person
    v["people"] = people
    v["entries"] = entries
    v["destinations"] = [(e.telegram_id, e.role) for e in entries]
    # an older file's `chats:` (one chat per role, before 0.12.128): still where that role's messages go — a
    # destination only, never a person, so a private chat named there gains no rights it did not have. Its readable
    # values say nothing; one that cannot be read is named, as before.
    craw = raw.get("chats")
    if craw is not None and not isinstance(craw, dict):
        out.append("chats must be owner: <id> and fm: <id> (better: rows of People).")
    for k, val in (craw or {}).items() if isinstance(craw, dict) else ():
        if k not in ROLES:
            out.append(f"chats: {k!r} is not a role (owner or fm).")
        elif not _id(val) and val not in (None, "", 0, "0"):         # 0 = not set yet
            out.append(f"chats.{k} must be a chat id (a group's is negative; /whoami in the chat shows it).")
    for role, cid in legacy_chats(raw).items():
        if (cid, role) not in v["destinations"]:
            v["destinations"].append((cid, role))
    # ⚠️ EACH ROLE HAS SOMEWHERE TO GO (owner, 2026-10-10: "the People section requires at least 1 entry with Owner role,
    # and 1 entry with Facility Manager role"): without one, that role's alerts, reminders, escalations and approvals
    # go nowhere. Named here, the page refuses a save that would leave a role out; the agent still runs meanwhile.
    # (a file with no People section at all is a part of one — a snippet a test or an import checks — not a villa's file:
    # every villa's file has the section, the starter's included)
    for role in ROLES if "people" in raw or "chats" in raw else ():
        if not any(r == role for _c, r in v["destinations"]):
            out.append(f"people: at least one {ROLE_WORDS[role]} is needed (a person or a group): "
                       f"without one, the messages for the {ROLE_WORDS[role].lower()} go nowhere.")

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
