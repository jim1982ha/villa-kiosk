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

import fnmatch
import hashlib
import re
import json
import os
from dataclasses import dataclass, field
from typing import Any

import yaml

# ------------------------------------------------------------------ constants
# Refused even with an approval record. Not configurable.
# The languages a person can be answered in: the agent writes in them, and the VESTA Agent page offers
# exactly these in its menu (owner, 2026-10-01: no free text).
LANGUAGES = {"en": "English", "fr": "French", "id": "Indonesian", "de": "German", "es": "Spanish", "it": "Italian",
             "nl": "Dutch", "zh": "Chinese", "ja": "Japanese", "ko": "Korean"}

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

ROLES = ("owner", "fm")

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
CONVERSATION_RESETS = ("daily_04_00", "after_8h_silence", "never")


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
DEFAULTS = {"act_enabled": False, "approval_ttl_minutes": 15, "siren_auto_off_min": 3}


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


def _behaviour(raw: Any) -> dict:
    """The settings block, leniently: a value not understood keeps its default."""
    v = dict(DEFAULT_BEHAVIOUR)
    raw = raw if isinstance(raw, dict) else {}
    if raw.get("profile") in PROFILES:
        v["profile"] = raw["profile"]
    try:
        limit = float(raw.get("reply_limit_usd", v["reply_limit_usd"]))
        if limit >= 0.05:
            v["reply_limit_usd"] = limit
    except (TypeError, ValueError):
        pass
    if isinstance(raw.get("web_search"), bool):
        v["web_search"] = raw["web_search"]
    if raw.get("conversation_reset") in CONVERSATION_RESETS:
        v["conversation_reset"] = raw["conversation_reset"]
    return v


def _jobs(settings: Any) -> dict[str, dict]:
    """settings.jobs: each AI job's model profile and spending limit, by the name its skill gives it.
    A job left out, or set to something not understood, is absent: it does not run (owner, 2026-10-01)."""
    raw = (settings or {}).get("jobs") if isinstance(settings, dict) else None
    out = {}
    for name, v in (raw or {}).items() if isinstance(raw, dict) else ():
        if not isinstance(v, dict) or v.get("profile") not in PROFILES:
            continue
        try:
            limit = float(v.get("limit_usd"))
        except (TypeError, ValueError):
            continue
        if limit >= 0.05:
            out[str(name)] = {"profile": v["profile"], "limit_usd": limit}
    return out


class Policy:
    def __init__(self, raw: dict):
        self.raw = raw or {}
        r = self.raw
        # an unreadable value is OFF (the default), never on: read_bool
        self.act_enabled: bool = read_bool(r.get("act_enabled", DEFAULTS["act_enabled"]), DEFAULTS["act_enabled"])[0]
        self.approval_ttl_minutes: int = _int_in(r.get("approval_ttl_minutes"), 1, 1440, DEFAULTS["approval_ttl_minutes"])
        # ⚠️ A SAFETY STOP, SO NEVER ABSENT: an unreadable value still stops the siren (and problems() says so).
        self.siren_auto_off_min: int = _int_in(r.get("siren_auto_off_min"), 1, 60, DEFAULTS["siren_auto_off_min"])
        self.behaviour: dict = _behaviour(r.get("settings"))
        self.jobs: dict[str, dict] = _jobs(r.get("settings"))
        raw_keep = (r.get("settings") or {}).get("keep") if isinstance(r.get("settings"), dict) else None
        raw_keep = raw_keep if isinstance(raw_keep, dict) else {}
        # an unreadable value keeps its default (and problems() names it): never "keep nothing"
        self.keep: dict[str, int] = {k: _int_in(raw_keep.get(k), lo, hi, d) for k, (d, lo, hi) in KEEP.items()}
        self.people: dict[int, Person] = {}
        for p in r.get("people") or [] if isinstance(r.get("people"), list) else []:
            if not isinstance(p, dict):
                continue
            tid = _id(p.get("telegram_id"))           # a person's id is positive, as problems() says
            if tid and tid > 0 and p.get("role") in ROLES:
                self.people[tid] = Person(tid, str(p.get("name") or tid), p["role"], str(p.get("language") or "en"))
        chats = r.get("chats") if isinstance(r.get("chats"), dict) else {}
        # a chat id that is not a number is skipped (problems() names it), never a crash of every message
        self.chats: dict[str, int] = {k: cid for k, v in chats.items() if (cid := _id(v))}
        self.owner_only = set(_as_list(r.get("owner_only_entities")))
        self.excluded = set(_as_list(r.get("excluded_entities")))
        self.allowed_services: dict[str, str] = {k: str(v) for k, v in (r.get("allowed_services") or {}).items()}
        self.lists = {
            "switch": set(_as_list(r.get("switch_entities"))),
            "scene": set(_as_list(r.get("scene_allowlist"))),
            "script": set(_as_list(r.get("script_allowlist"))),
            "button": set(_as_list(r.get("button_allowlist"))),
        }
        self.notify_recipients = set(_as_list(r.get("notify_recipients")))
        self.ha_read_tools: list[str] = _as_list(r.get("ha_read_tools"))
        self.siren_entity: str | None = r.get("siren_entity")
        self.system_actions = [(a.get("service"), a.get("entity_id")) for a in (r.get("system_actions") or [])]

    # ------------------------------------------------------------------ load
    @classmethod
    def load(cls, path: str) -> "Policy":
        if not path or not os.path.exists(path):
            return cls({})
        with open(path, encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        return cls(raw if isinstance(raw, dict) else {})

    # ------------------------------------------------------------------ people
    def person(self, telegram_id: int | None) -> Person | None:
        if telegram_id is None or int(telegram_id) in ANONYMOUS_TELEGRAM_IDS:
            return None
        return self.people.get(int(telegram_id))

    def chat_role(self, chat_id: int) -> str | None:
        for role, cid in self.chats.items():
            if cid == int(chat_id):
                return role
        return None

    def is_known_chat(self, chat_id: int) -> bool:
        return self.chat_role(chat_id) is not None or int(chat_id) in self.people

    # ------------------------------------------------------------------ layer 1
    def read_tool_allowed(self, name: str) -> bool:
        return name in self.ha_read_tools

    # ------------------------------------------------------------------ layer 2
    def check_service(self, domain: str, service: str, entity_id: Any = None, data: dict | None = None,
                      system: bool = False) -> Decision:
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
            if (full, ents[0] if len(ents) == 1 else None) in self.system_actions:
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
    "any": "the owner or the facility manager approves",
    "owner": "only the owner approves",
    "listed": "only the devices in the lists below, then approval",
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


def form_schema() -> dict:
    """What the page's forms offer, from the same tables the checks below read."""
    return {"rules": RULE_WORDS, "actionable": list(ACTIONABLE), "siren_domains": list(SIREN_DOMAINS),
            "lists": [{"key": k, "label": _LIST_WORDS[k][0], "hint": _LIST_WORDS[k][1], "domains": [d]}
                      for k, d in ENTITY_LISTS.items() if d]}
SECTIONS = {"settings", "act_enabled", "approval_ttl_minutes", "people", "chats", "siren_entity",
            "siren_auto_off_min", "allowed_services", "notify_recipients", "system_actions", "ha_read_tools",
            *ENTITY_LISTS}


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

    ⚠️ ONE OWNER FOR "IS THIS FILE RIGHT": the agent logs these when the file
    changes, and the UI refuses to save a file that has any. The agent itself
    stays lenient (a bad value is ignored, never a crash), so a hand edit can
    only switch something off, never stop the agent; the UI is stricter because
    it can say why before the file is written."""
    if raw is None:
        return []
    if not isinstance(raw, dict):
        return ["The file must be a set of sections (name: value), not a list or a single value."]
    out: list[str] = []
    for k in raw:
        if k not in SECTIONS:
            out.append(f"Unknown section {k!r}: a misspelt name is ignored by the agent.")

    s = raw.get("settings")
    if s is not None:
        if not isinstance(s, dict):
            out.append("settings must be a set of name: value.")
        else:
            for k, v in s.items():
                if k == "profile" and v not in PROFILES:
                    out.append(f"settings.profile must be one of {', '.join(PROFILES)}.")
                elif k == "reply_limit_usd" and (isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0.05):
                    out.append("settings.reply_limit_usd must be a number of at least 0.05.")
                elif k == "web_search" and not isinstance(v, bool):
                    out.append("settings.web_search must be true or false.")
                elif k == "conversation_reset" and v not in CONVERSATION_RESETS:
                    out.append(f"settings.conversation_reset must be one of {', '.join(CONVERSATION_RESETS)}.")
                elif k == "jobs":
                    if not isinstance(v, dict):
                        out.append("settings.jobs must be job name: {profile, limit_usd}.")
                        continue
                    for name, j in v.items():
                        if not isinstance(j, dict) or set(j) - {"profile", "limit_usd"}:
                            out.append(f"settings.jobs.{name} must give profile and limit_usd only.")
                            continue
                        if j.get("profile") not in PROFILES:
                            out.append(f"settings.jobs.{name}.profile must be one of {', '.join(PROFILES)}.")
                        lim = j.get("limit_usd")
                        if isinstance(lim, bool) or not isinstance(lim, (int, float)) or lim < 0.05:
                            out.append(f"settings.jobs.{name}.limit_usd must be a number of at least 0.05.")
                elif k == "keep":
                    if not isinstance(v, dict):
                        out.append("settings.keep must be a set of name: number.")
                        continue
                    for name, val in v.items():
                        if name not in KEEP:
                            out.append(f"Unknown settings.keep.{name} (known: {', '.join(KEEP)}).")
                            continue
                        _, lo, hi = KEEP[name]
                        if isinstance(val, bool) or not isinstance(val, int) or not lo <= val <= hi:
                            out.append(f"settings.keep.{name} must be a whole number from {lo} to {hi}.")
                elif k not in ("profile", "reply_limit_usd", "web_search", "conversation_reset"):
                    out.append(f"Unknown setting {k!r}.")
    if "act_enabled" in raw and not read_bool(raw["act_enabled"], False)[1]:
        out.append("act_enabled must be true or false.")
    for k, lo, hi in (("approval_ttl_minutes", 1, 1440), ("siren_auto_off_min", 1, 60)):
        v = raw.get(k)
        if v is not None and not read_int_in(v, lo, hi, 0)[1]:
            out.append(f"{k} must be a whole number from {lo} to {hi}.")

    people = raw.get("people")
    if people is not None:
        if not isinstance(people, list):
            out.append("people must be a list.")
        else:
            seen = set()
            for i, p in enumerate(people, 1):
                if not isinstance(p, dict):
                    out.append(f"people, entry {i}: must have telegram_id, name, role, language.")
                    continue
                tid = _id(p.get("telegram_id"))
                who = p.get("name") or f"entry {i}"
                if tid is None or tid <= 0:
                    out.append(f"people, {who}: telegram_id must be the person's Telegram id (a positive number; "
                               "/whoami shows it). Until then the agent ignores this person.")
                elif tid in seen:
                    out.append(f"people, {who}: telegram_id {tid} is listed twice.")
                else:
                    seen.add(tid)
                if p.get("role") not in ROLES:
                    out.append(f"people, {who}: role must be owner or fm.")
                if not str(p.get("name") or "").strip():
                    out.append(f"people, entry {i}: a name is needed.")
                if p.get("language") is not None and not re.match(r"^[a-z]{2,3}$", str(p.get("language"))):
                    out.append(f"people, {who}: language must be a code such as en, fr, id.")
                for extra in set(p) - {"telegram_id", "name", "role", "language"}:
                    out.append(f"people, {who}: unknown field {extra!r}.")

    chats = raw.get("chats")
    if chats is not None:
        if not isinstance(chats, dict):
            out.append("chats must be owner: <id> and fm: <id>.")
        else:
            for k, v in chats.items():
                if k not in ROLES:
                    out.append(f"chats: {k!r} is not a role (owner or fm).")
                elif v not in (None, "", 0, "0") and not _id(v):         # 0 = not set yet, as the agent reads it
                    out.append(f"chats.{k} must be a chat id (a group's is negative; /whoami in the chat shows it).")

    for key, domain in ENTITY_LISTS.items():
        v = raw.get(key)
        if v is None:
            continue
        if not isinstance(v, list):
            out.append(f"{key} must be a list of entity ids.")
            continue
        for e in v:
            if not isinstance(e, str) or not ENTITY_ID.match(e):
                out.append(f"{key}: {e!r} is not an entity id (domain.name).")
            elif domain and e.split(".")[0] != domain:
                out.append(f"{key}: {e} is not a {domain} entity.")
    siren = raw.get("siren_entity")
    if siren is not None and (not isinstance(siren, str) or not ENTITY_ID.match(siren)):
        out.append("siren_entity must be an entity id, or null.")
    elif siren is not None and siren.split(".")[0] not in SIREN_DOMAINS:
        out.append(f"siren_entity: {siren} is not a {' or '.join(SIREN_DOMAINS)} entity.")

    services = raw.get("allowed_services")
    if services is not None:
        if not isinstance(services, dict):
            out.append("allowed_services must be service: rule.")
        else:
            for svc, rule in services.items():
                if not isinstance(svc, str) or not re.match(r"^[a-z0-9_]+\.[a-z0-9_]+$", svc):
                    out.append(f"allowed_services: {svc!r} is not a service (domain.service).")
                    continue
                if svc.split(".")[0] in NEVER_DOMAINS or svc in NEVER_SERVICES or "toggle" in svc.split(".")[1]:
                    out.append(f"allowed_services: {svc} is never allowed, whatever the file says.")
                if rule not in RULES:
                    out.append(f"allowed_services: {svc} has the rule {rule!r}; use any, owner, listed or direct.")
                elif rule == "listed" and svc.split(".")[0] not in {d for d in ENTITY_LISTS.values() if d}:
                    out.append(f"allowed_services: {svc} is listed, but there is no list for {svc.split('.')[0]}.")
    for key in ("notify_recipients", "ha_read_tools"):
        v = raw.get(key)
        if v is not None and (not isinstance(v, list) or not all(isinstance(x, str) for x in v)):
            out.append(f"{key} must be a list of names.")
    acts = raw.get("system_actions")
    if acts is not None:
        if not isinstance(acts, list) or not all(isinstance(a, dict) and set(a) <= {"service", "entity_id"} for a in acts):
            out.append("system_actions must be a list of service: / entity_id: pairs.")
    return out


def match_any(name: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(name, p) for p in patterns)
