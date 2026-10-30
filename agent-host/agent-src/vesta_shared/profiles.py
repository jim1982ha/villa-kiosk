"""The VESTA Kiosk's profiles (owner, ops, guest), as the agreement carries them (agent-contract.json `profiles`): each
one's words, and what a person signed in as it may read. The Kiosk derives them from its own role table and read rule;
this module asks the agreement and never copies the rule (architecture review round 8: the Facility Manager had three
names, and a guest asking VESTA on the tablet learned what the guest's tablet hides).

A profile answers as one of the Agent's roles (`conversation.profiles`: ops is the facility manager).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import agreement

#: The arguments that name the devices a call reads.
_ENTITY_ARGS = ("entity_id", "entity_ids")
#: An entity id as an answer names one ("light.kitchen")
_ENTITY = re.compile(r"^[a-z_][a-z0-9_]*\.[a-z0-9_]+$")


def all_profiles() -> dict[str, dict]:
    return {k: v for k, v in agreement.section("profiles").items() if isinstance(v, dict)}


def profile_of(role: str | None) -> str | None:
    """The Kiosk profile a role of the Agent is ("fm" → "ops"); None when the agreement names none."""
    return next((p for p, r in (agreement.section("conversation").get("profiles") or {}).items() if r == role), None)


def word(role: str, key: str = "label", default: str | None = None) -> str:
    """A role's word from its profile: `label` ("Facility Manager"), `short` where space is tight ("FM"), `initials`,
    `description`. `default` (else the role itself) when the agreement says none."""
    got = (all_profiles().get(profile_of(role) or "") or {}).get(key)
    return got if isinstance(got, str) and got else (default if default is not None else role)


def step_by(step: dict) -> str:
    """Who took a step on a Facility fault, in the words the profiles say now: its `role` (a profile id, the Kiosk
    since 2.496.623) by that profile's label; else its `by`, a label an older Kiosk wrote, mapped from a former one
    ("Facility manager" → "Facility Manager"); else `by` as written (the Agent's own, or a person's name)."""
    profiles = all_profiles()
    role = step.get("role")
    if isinstance(role, str) and isinstance((profiles.get(role) or {}).get("label"), str):
        return profiles[role]["label"]
    by = str(step.get("by") or "")
    for p in profiles.values():
        if by and by in (p.get("formerLabels") or ()) and isinstance(p.get("label"), str):
            return p["label"]
    return by


@dataclass
class Reads:
    """What a person signed in as one profile may read, the agreement's rule (`profiles.<id>.reads`): an entity when its
    domain is in `domains`, its device's type not in `deniedTypes` and its device's category in `categories` (a device
    the villa model gives no category: by the first two alone); `people` false: nothing that says who is home."""
    domains: frozenset | None              # None: every domain
    denied_types: frozenset
    categories: frozenset | None           # None: every category
    people: bool
    #: the VESTA Kiosk's villa model, entity → {type, category} (/agent/v1/villa-model)
    devices: dict = field(default_factory=dict)
    #: the entities that say who is home beside the people's own (the villa's "empty" sensor, a presence count)
    people_ids: frozenset = frozenset()

    @classmethod
    def for_role(cls, role: str | None, devices: dict | None = None, people_ids=()) -> "Reads | None":
        """The reads of `role`'s profile; None when its profile reads everything (or the agreement names none for it)."""
        rule = (all_profiles().get(profile_of(role) or "") or {}).get("reads")
        if not isinstance(rule, dict):
            return None
        every = lambda v: v == "all"                                         # noqa: E731
        reads = cls(domains=None if every(rule.get("domains")) else frozenset(rule.get("domains") or ()),
                    denied_types=frozenset(rule.get("deniedTypes") or ()),
                    categories=None if every(rule.get("categories")) else frozenset(rule.get("categories") or ()),
                    people=bool(rule.get("people")), devices=dict(devices or {}), people_ids=frozenset(people_ids))
        if reads.domains is None and reads.categories is None and not reads.denied_types and reads.people:
            return None
        return reads

    def allows(self, entity_id: str) -> bool:
        domain = entity_id.partition(".")[0]
        if self.domains is not None and domain not in self.domains:
            return False
        device = self.devices.get(entity_id) or {}
        if (device.get("type") or domain) in self.denied_types:
            return False
        category = device.get("category")
        if self.categories is not None and category and category not in self.categories:
            return False
        if not self.people and (domain in ("person", "device_tracker") or entity_id in self.people_ids):
            return False
        return True

    def refused(self, name: str, args: dict) -> str | None:
        """Why this call is refused for this profile: a device it may not read is named. (Which TOOLS the person's run
        has is tool_access.allowed_for's.)"""
        for k in _ENTITY_ARGS:
            v = args.get(k)
            ids = v if isinstance(v, list) else str(v).split(",") if v else []
            hidden = [str(e).strip() for e in ids if "." in str(e) and not self.allows(str(e).strip())]
            if hidden:
                return ("Not shown to this person on the tablet, so not told to them either: " + ", ".join(hidden)
                        + ". Answer without it, and say it is not something you can tell them.")
        return None

    def hides(self, value: str) -> bool:
        """Whether an id in a tool's answer is a device this profile may not read (tools.without_hidden)."""
        return bool(_ENTITY.match(value)) and not self.allows(value)
