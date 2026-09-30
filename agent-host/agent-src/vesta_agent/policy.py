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


class Policy:
    def __init__(self, raw: dict):
        self.raw = raw or {}
        r = self.raw
        self.act_enabled: bool = bool(r.get("act_enabled", False))
        self.approval_ttl_minutes: int = int(r.get("approval_ttl_minutes", 15))
        self.people: dict[int, Person] = {}
        for p in r.get("people") or []:
            try:
                tid = int(p.get("telegram_id") or 0)
            except (TypeError, ValueError):
                tid = 0
            if tid and p.get("role") in ROLES:
                self.people[tid] = Person(tid, str(p.get("name") or tid), p["role"], str(p.get("language") or "en"))
        chats = r.get("chats") or {}
        self.chats: dict[str, int] = {k: int(v) for k, v in chats.items() if v not in (None, "", 0, "0")}
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
        if not os.path.exists(path):
            return cls({})
        with open(path, encoding="utf-8") as f:
            return cls(yaml.safe_load(f) or {})

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


def match_any(name: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(name, p) for p in patterns)
