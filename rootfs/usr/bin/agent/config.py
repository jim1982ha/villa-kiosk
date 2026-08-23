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

from agent import contracts

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
    #: ⚠️ WHAT HAPPENS WHEN TRIAGE ESCALATES (ADR-021, owner decision
    #: 2026-08-23). "auto" investigates; "approve" records the escalation and
    #: waits for a person. AUTO IS THE DEFAULT, and it is safe as a default only
    #: because `shadow` below suppresses delivery — auto-in-shadow is exactly
    #: PH-3's "run everything, deliver nothing": the concerns accumulate for the
    #: diff and reach nobody. If shadow is ever turned off while this is auto,
    #: findings start messaging people, which is the cutover and is meant to be.
    "investigate_mode": "auto",
    #: ⚠️ HOW MANY INVESTIGATIONS ONE PASS MAY START. A bound on the worst case
    #: rather than a judgement about which findings matter: a pass escalating
    #: six subjects would otherwise be six frontier-model runs, and this is the
    #: tier where cost moves from per-PASS to per-FINDING. 3 by the owner's
    #: choice, on the reasoning that a real fault is still a fault fifteen
    #: minutes later — missing the top three delays it by one cadence, it does
    #: not lose it.
    "max_investigations_per_pass": 3,
    #: ⚠️ SHADOW MODE: run everything, deliver NOTHING (ARCH-016). Not a push,
    #: not a brief line, not a kiosk badge. It is how the claim that the agent
    #: outperforms the rules stops being a prediction — the concerns are
    #: recorded and diffed against what the blueprints found, with no
    #: user-visible risk while that evidence is gathered.
    #:
    #: ⚠️ DEFAULT TRUE, WHICH IS THE OPPOSITE OF EVERY OTHER FLAG HERE. The
    #: others ship off so nothing happens; this ships ON so that when the agent
    #: IS switched on, its first period is observed rather than delivered.
    #: Turning it off is the cutover decision, and it should be a decision.
    "shadow": True,

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
    # ⚠️ CHAT HAS ITS OWN TIER, AND IT IS NOT THE FRONTIER MODEL. It ran on
    # `model_reason` until 2.664.0, so every question typed at the villa was
    # answered by the most expensive model in the table — measured on the
    # reference villa at 28 requests and $1.78 in an afternoon of TESTING,
    # 100% of it opus. Answering "is the pool pump ok" is not the same task as
    # investigating why it is not: chat re-reads a document and summarises,
    # which is what the mid-tier is for. `model_reason` stays frontier because
    # judgement is what it is paid for.
    "model_chat": "claude-sonnet-5",
    "model_brief": "claude-sonnet-5",

    # ── the two that MUST be empty ───────────────────────────────────────
    #: ⚠️ EMPTY MEANS NOBODY MAY TALK TO THE BOT. A sender not in this map gets
    #: no run and no reply — silence rather than a refusal, because an error
    #: reply confirms the bot is live to whoever is probing it.
    #:
    #: ⚠️ SUPERSEDED BY `people` AND DELIBERATELY KEPT. `people.people()` reads
    #: this when the new table is empty, so a villa that configured senders
    #: before 2.651.0 does not have its bot go deaf on upgrade — the symptom
    #: would be "it stopped answering me" with nothing visibly wrong.
    "allowed_senders": {},
    #: ⚠️ ONE TABLE FOR BOTH DIRECTIONS, AND THEY ARE NOT SYMMETRIC.
    #: `{name, telegram, targets[], role}`. `telegram` is the only field that
    #: grants anything INBOUND; `targets` are notify destinations, which can
    #: only receive. A person with a device and no chat is delivery-only, which
    #: is a normal row. Empty by the same requirement as `allowed_senders`.
    "people": [],
    #: ⚠️ WHICH SERVICES, as distinct from `actuable_refs`' WHICH DEVICES —
    #: both allow-lists must pass, so `light.turn_off` on an unlisted lamp and
    #: `lock.unlock` on a listed door are refused for different reasons. Empty
    #: by the same requirement: a seeded service list authorises a verb nobody
    #: chose, on every device that ever reaches the ref list.
    "allowed_services": [],
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
MUST_BE_EMPTY: Final[Tuple[str, ...]] = ("allowed_senders", "people",
                                        "actuable_refs", "allowed_services",
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

    mode = value.get("investigate_mode")
    if mode is not None and mode not in ("auto", "approve"):
        # ⚠️ REFUSED, NOT DEFAULTED — the same rule `allowed_senders` states
        # below. Defaulting a typo here would silently pick one of two
        # behaviours that differ by whether the villa spends money unattended.
        problems.append("investigate_mode must be 'auto' or 'approve'")

    for name in ("triage_minutes", "monthly_limit", "chat_monthly_limit",
                 "max_turns", "max_tool_calls", "max_investigations_per_pass"):
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
                if role not in contracts.SENDER_ROLE:
                    # ⚠️ AN UNKNOWN ROLE IS REFUSED, not defaulted. Defaulting
                    # would grant SOME access to a typo, and this map is the
                    # only thing standing between the villa and anyone who
                    # finds the bot.
                    problems.append(
                        f"allowed_senders[{sender}] role {role!r} is not one "
                        f"of {', '.join(contracts.SENDER_ROLE)}")

    for name in ("actuable_refs", "allowed_services", "suppressed_subjects"):
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
