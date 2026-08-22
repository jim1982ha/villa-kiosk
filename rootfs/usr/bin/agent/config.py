"""The agent's settings, and every kill switch. REQ-061.

⚠️ EVERY RISKY BEHAVIOUR IS REVERTIBLE IN ONE WORD. This codebase already has
the convention — `BADGE_PLACEMENT` reverts the whole placement solver,
`WALL_OCCLUSION` reverts a rendering rule — and the reason is that the thing you
most want when a new subsystem misbehaves at a villa you are not standing in is
a single flag, not a release.

⚠️ DEFAULTS ARE APPLIED AT READ TIME AND NEVER PERSISTED, AND THIS IS NOT A
STYLE CHOICE. `config/AppConfig`'s merge-on-load caused a real, hard-to-reproduce
bug: a seed spread underneath stored config RESURRECTED entries the operator had
deleted, and the report was "stale entities I can't delete". A sparse overlay
means an absent key reads as its default and a DELETED key stays deleted.

⚠️ `allowed_senders` AND `actuable_refs` SHIP EMPTY, AND A SEEDED DEFAULT IN
EITHER IS A SECURITY BUG RATHER THAN A CONVENIENCE. An `allowed_senders` with an
entry is an open bot — anyone who finds it can talk to the villa. An
`actuable_refs` with an entry is an agent that acts on a device nobody
authorised. Both must be filled in by a person, deliberately, once.

⚠️ THE KILL SWITCHES ARE INDEPENDENT AND NEST. `enabled: false` stops
everything. `act_enabled: false` leaves the agent reading and reasoning but
unable to touch the villa. A trigger flag stops one entry point. They are
separate because the reasons to reach for them are separate: a noisy agent needs
its triggers cut, a suspicious one needs its hands tied, and a broken one needs
turning off.
"""

from __future__ import annotations

from typing import Any, Dict, Final, List, Mapping, Optional, Tuple

#: ⚠️ THE SHAPE, NOT THE STORED DOCUMENT. Nothing writes this dict; it is spread
#: UNDER a stored config at read time. Adding a key here changes what an
#: unconfigured villa does, and changes nothing about one already configured.
DEFAULTS: Final[Dict[str, Any]] = {
    # ── the three kill switches ──────────────────────────────────────────
    #: ⚠️ OFF ON A FRESH INSTALL. An add-on that begins reasoning about a villa
    #: the moment it is installed, before anybody has set a budget or a
    #: recipient, is an add-on that spends money nobody agreed to.
    "enabled": False,
    #: ⚠️ OFF, AND SEPARATELY. Reading and reasoning are safe; acting is not.
    "act_enabled": False,
    "triggers": {"scheduled": True, "event": False, "chat": False},

    # ── cadence ──────────────────────────────────────────────────────────
    "triage_minutes": 15,
    "brief_cadence": "daily",

    # ── cost ─────────────────────────────────────────────────────────────
    "monthly_limit": 4_000,
    "chat_monthly_limit": 0,          # 0 = derive the share, see budget.py
    "max_turns": 8,
    "max_tool_calls": 24,

    # ── models, per tier ─────────────────────────────────────────────────
    #: ⚠️ PINNED IN CONFIG, NEVER IN CODE (ADR-016). Upgrading a model is then a
    #: config change plus an eval run, not a deploy — which is the whole reason
    #: "will the next model break my villa monitoring?" becomes answerable.
    "model_triage": "claude-haiku-4-5",
    "model_reason": "claude-opus-5",
    "model_brief": "claude-sonnet-5",

    # ── the two that MUST be empty ───────────────────────────────────────
    #: ⚠️ EMPTY MEANS NOBODY MAY TALK TO THE BOT. A sender not in this map gets
    #: no run and no reply — silence rather than a refusal, because an error
    #: reply confirms the bot is live to whoever is probing it.
    "allowed_senders": {},
    #: ⚠️ EMPTY MEANS THE AGENT MAY ACT ON NOTHING. Even with `act_enabled`
    #: true, an empty list is a complete stop — the two are AND-ed, so turning
    #: actuation on does not by itself authorise a single device.
    "actuable_refs": [],
    #: Subjects a person has told us to stop raising. Filled by the feedback
    #: loop's counter, never by the agent's judgement.
    "suppressed_subjects": [],
}

#: Keys whose default is EMPTY BY SECURITY REQUIREMENT rather than by taste. A
#: test asserts each of these is falsy in DEFAULTS, so a helpful seed cannot be
#: added without the build failing.
MUST_BE_EMPTY: Final[Tuple[str, ...]] = ("allowed_senders", "actuable_refs",
                                        "suppressed_subjects")


def view(raw: Any) -> Dict[str, Any]:
    """The EFFECTIVE config: stored values over defaults, computed per read.

    ⚠️ SHALLOW, EXCEPT FOR `triggers`, AND THE EXCEPTION IS DELIBERATE.
    `store.config_view` is shallow throughout and documents why: a nested merge
    means an operator who removes ONE key inside a slice silently gets it back
    and has no way to express its absence. `triggers` is merged one level
    because its members are independent kill switches — an operator turning
    `chat` off must not have to restate `scheduled` and `event` to keep them,
    and forgetting one would turn a switch ON, which is the wrong direction to
    fail.

    ⚠️ UNKNOWN KEYS ARE KEPT, same rule as the reports config: a config written
    by a NEWER version must survive a downgrade untouched.
    """
    out: Dict[str, Any] = {k: (dict(v) if isinstance(v, dict) else
                               list(v) if isinstance(v, list) else v)
                           for k, v in DEFAULTS.items()}
    if not isinstance(raw, Mapping):
        return out
    for key, value in raw.items():
        if key == "triggers" and isinstance(value, Mapping):
            merged = dict(DEFAULTS["triggers"])
            merged.update({str(k): bool(v) for k, v in value.items()})
            out["triggers"] = merged
            continue
        out[str(key)] = value
    return out


def errors(value: Any) -> List[str]:
    """Everything wrong with a proposed config. Empty is the pass.

    ⚠️ CHECKS ONLY KEYS IT KNOWS, and keeps the rest — same contract as
    `store.validate_config`. Refusing an unknown key would make a downgrade
    reject the newer version's settings wholesale.
    """
    problems: List[str] = []
    if not isinstance(value, Mapping):
        return ["config is not an object"]

    for flag in ("enabled", "act_enabled"):
        if flag in value and not isinstance(value[flag], bool):
            problems.append(f"{flag} must be true or false")

    triggers = value.get("triggers")
    if triggers is not None:
        if not isinstance(triggers, Mapping):
            problems.append("triggers must be an object")
        else:
            for name, on in triggers.items():
                if not isinstance(on, bool):
                    problems.append(f"triggers.{name} must be true or false")

    for name in ("triage_minutes", "monthly_limit", "chat_monthly_limit",
                 "max_turns", "max_tool_calls"):
        if name not in value:
            continue
        raw = value[name]
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            problems.append(f"{name} must be a number")
        elif raw < 0:
            problems.append(f"{name} may not be negative")

    senders = value.get("allowed_senders")
    if senders is not None:
        if not isinstance(senders, Mapping):
            problems.append("allowed_senders must be an object of id -> role")
        else:
            for sender, role in senders.items():
                if not str(sender).strip():
                    problems.append("allowed_senders has an empty sender id")
                if role not in ("owner", "facility", "ops"):
                    # ⚠️ AN UNKNOWN ROLE IS REFUSED, not defaulted. Defaulting
                    # would grant SOME access to a typo, and this map is the
                    # only thing standing between the villa and anyone who
                    # finds the bot.
                    problems.append(
                        f"allowed_senders[{sender}] role {role!r} is not one "
                        f"of owner, facility, ops")

    for name in ("actuable_refs", "suppressed_subjects"):
        if name in value and not isinstance(value[name], list):
            problems.append(f"{name} must be a list")

    return problems


def may_act(config: Optional[Mapping[str, Any]], ref: str) -> bool:
    """Is this specific device authorised for autonomous action?

    ⚠️ BOTH CONDITIONS, AND-ED. `act_enabled` is the master switch and
    `actuable_refs` is the list; neither alone is authorisation. Turning
    actuation on with an empty list authorises nothing, which is the correct
    default for a switch somebody may flip to see what happens.

    ⚠️ THIS IS NOT THE HARM GATE. `policy.may_act` still applies and still
    refuses every high-harm action regardless of what this returns — a device
    can be on this list and still never be actuated autonomously.
    """
    cfg = view(config)
    if not cfg.get("act_enabled"):
        return False
    allowed = cfg.get("actuable_refs")
    return isinstance(allowed, list) and str(ref) in [str(r) for r in allowed]


def trigger_enabled(config: Optional[Mapping[str, Any]], name: str) -> bool:
    """May this entry point start a run? `enabled` gates all of them."""
    cfg = view(config)
    if not cfg.get("enabled"):
        return False
    triggers = cfg.get("triggers")
    if not isinstance(triggers, Mapping):
        return False
    return bool(triggers.get(str(name), False))
