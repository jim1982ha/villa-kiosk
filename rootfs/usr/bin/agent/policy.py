"""THE authorization boundary. ARCH-002. Nothing here may be a model.

⚠️ THIS IS THE ONLY CONTROL THAT EXISTS. The add-on holds a Supervisor token,
which bypasses the browser's own service gate entirely — `auth/permissions.ts`
governs what a TAB may ask for and has no bearing on what this process can do.
So there is no second line: if this file is wrong, nothing else catches it.

⚠️ NO MODEL CALL MAY EXIST IN THIS FILE, AT ANY CONFIDENCE, FOR ANY REASON. The
model decides what MATTERS; it never decides what is PERMITTED. A gate that asks
a model whether something is safe has delegated the decision to the thing it
exists to constrain, and every prompt-injection defence downstream becomes
decorative. `test_agent_policy` greps this module for a provider import.

⚠️ REVERSIBILITY IS NOT A SUFFICIENT SAFETY TEST, AND AN EARLIER DRAFT OF THIS
DESIGN GATED ON IT ALONE. Unlocking a door is reversible — you can lock it
again — and the harm is instantaneous and permanent in effect. So is opening a
gate, disabling a camera, silencing an alarm. THE STATE REVERTS; THE CONSEQUENCE
DOES NOT. Both axes must pass.

⚠️ AND THE HIGH-HARM SET KEYS ON EFFECT, NOT ON ENTITY DOMAIN. At the reference
villa the parking doorbell's Door 1 and Door 2 relays are ordinary `switch.*`
entities that physically open things. A rule matching `lock.*` sails straight
past both. Domain is a hint; the device's own integration and model are the
evidence.

⚠️ CONFIG IS READ ONCE PER RUN, NOT PER DECISION. A gate that re-reads config
between decisions can be widened mid-run by anything that can write the file,
and the run that is already reasoning about an action is exactly the wrong
moment to grant it more authority. `for_run` snapshots; every later question is
answered from the snapshot.

⚠️ THE DEFAULT IS DENY. Every unknown — an unrecognised tool, an unclassified
device, a malformed action, a missing config — resolves to refusal. The
rollback for this whole module is "deny everything", and the agent degrades to
read-only rather than to unconstrained.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, FrozenSet, List, Mapping, Optional, Sequence, Tuple

from agent import contracts

# ── the high-harm classification ────────────────────────────────────────────

#: Entity domains that are high-harm on their face.
HIGH_HARM_DOMAINS: FrozenSet[str] = frozenset({
    "lock", "alarm_control_panel", "camera", "climate",
})

#: ⚠️ INTEGRATIONS WHOSE `switch.*` ENTITIES PHYSICALLY OPEN THINGS. This is the
#: half a domain check cannot see. A doorbell or intercom integration publishing
#: a relay as a switch is the exact case that made the two-axis gate necessary,
#: and it is why `harm_class_of` takes the integration and the device class
#: rather than only the entity id.
HIGH_HARM_INTEGRATIONS: FrozenSet[str] = frozenset({
    "hikvision", "doorbird", "intercom", "unifi_access", "akuvox", "2n",
})

#: Device classes that mean "this opens or secures something", whatever domain
#: the entity happens to live in.
HIGH_HARM_DEVICE_CLASSES: FrozenSet[str] = frozenset({
    "door", "garage", "gate", "lock", "shutter", "awning",
})

#: Words in an entity id that indicate an access relay. ⚠️ ANCHORED ON
#: `(?:^|[._])`, because `door` matches inside `outdoor` and `\b` does not help
#: — `_` is a word character. This repo has paid for that error more than once,
#: and here the cost of the unanchored version is a gate that classifies the
#: OUTDOOR LIGHTS as an access relay and refuses to switch them.
_ACCESS_WORDS = ("door", "gate", "relay", "lock", "barrier", "intercom",
                 "entrance", "unlock")

#: Services that never execute autonomously regardless of what they act on.
HIGH_HARM_SERVICES: FrozenSet[str] = frozenset({
    "unlock", "open", "open_cover", "alarm_disarm", "alarm_arm_home",
    "alarm_arm_away", "turn_off_alarm", "disable_motion_detection",
    "delete", "remove", "restart", "reload", "stop",
})


def _anchored(entity_id: str, word: str) -> bool:
    import re
    return bool(re.search(rf"(?:^|[._]){re.escape(word)}(?:[._]|$)",
                          entity_id.lower()))


def harm_class_of(entity_id: str, *, integration: str = "",
                  device_class: str = "", service: str = "") -> str:
    """`"high"` or `"low"`. CTR-014.

    ⚠️ ANY ONE SIGNAL IS ENOUGH TO MAKE IT HIGH. This is an OR, deliberately:
    an unclassified device that looks like an access relay by name is treated as
    one, and being wrong in that direction costs a proposal the owner has to
    confirm. Being wrong the other way opens a door.
    """
    ident = str(entity_id or "").lower()
    domain = ident.split(".", 1)[0] if "." in ident else ""
    if domain in HIGH_HARM_DOMAINS:
        return "high"
    if str(integration or "").lower() in HIGH_HARM_INTEGRATIONS:
        return "high"
    if str(device_class or "").lower() in HIGH_HARM_DEVICE_CLASSES:
        return "high"
    if str(service or "").lower().rsplit(".", 1)[-1] in HIGH_HARM_SERVICES:
        return "high"
    if any(_anchored(ident, word) for word in _ACCESS_WORDS):
        return "high"
    return "low"


# ── the snapshot ────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class RunPolicy:
    """One run's authority, frozen at the moment the run started.

    ⚠️ `frozen=True` IS THE MECHANISM, NOT A STYLE CHOICE. It is what makes "a
    mid-run config change cannot widen authority" true rather than intended.
    """

    act_enabled: bool = False
    allowed_tools: FrozenSet[str] = frozenset()
    allowed_services: FrozenSet[str] = frozenset()
    suppressed_subjects: FrozenSet[str] = frozenset()
    max_turns: int = 8
    max_tool_calls: int = 24
    tier: str = "reason"


def for_run(config: Optional[Mapping[str, Any]],
            *, tier: str = "reason",
            tool_names: Sequence[str] = ()) -> RunPolicy:
    """Snapshot this run's authority. Read config ONCE, here, and nowhere else.

    ⚠️ TRIAGE CANNOT ACT, CANNOT NOTIFY AND CANNOT WRITE, and that is enforced
    here rather than requested in a prompt. It is the volume tier — 96 runs a
    day — and the one most likely to be pointed at a cheaper model later.
    """
    cfg = config if isinstance(config, Mapping) else {}
    act = bool(cfg.get("agent_act_enabled", False)) and tier != "triage"
    allowed = frozenset(
        str(n) for n in (cfg.get("agent_allowed_services") or ())
        if isinstance(n, str))
    suppressed = frozenset(
        str(k) for k in (cfg.get("agent_suppressed_subjects") or ())
        if isinstance(k, str))
    tools = frozenset(str(n) for n in tool_names)
    return RunPolicy(
        act_enabled=act,
        allowed_tools=tools,
        allowed_services=allowed,
        suppressed_subjects=suppressed,
        max_turns=_positive(cfg.get("agent_max_turns"), 8),
        max_tool_calls=_positive(cfg.get("agent_max_tool_calls"), 24),
        tier=str(tier),
    )


def _positive(value: Any, default: int) -> int:
    try:
        out = int(value)
    except (TypeError, ValueError, OverflowError):
        # ⚠️ OverflowError IS THE ONE THAT IS EASY TO MISS: `int(float("inf"))`
        # raises it rather than ValueError, so a config carrying an infinity
        # would crash the run at the exact moment it was deciding authority.
        # Found by a test, not by review.
        return default
    return out if out > 0 else default


# ── the decisions ───────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Decision:
    verdict: str                 # POLICY_VERDICT
    reason: str
    harm_class: str = "low"

    @property
    def allowed(self) -> bool:
        return self.verdict == "allow"


def may_use_tool(policy: RunPolicy, tool_name: str, mode: str = "READ") -> Decision:
    """May this run call this tool at all?

    ⚠️ UNKNOWN TOOL, UNKNOWN MODE AND UNKNOWN TIER ALL DENY. A tool the registry
    did not hand us is a tool nobody reviewed.
    """
    name = str(tool_name or "")
    if name not in policy.allowed_tools:
        return Decision("deny", f"{name!r} is not registered for this run")
    if str(mode).upper() != "READ":
        if policy.tier == "triage":
            return Decision("deny", "triage may not call a write tool")
        if not policy.act_enabled:
            return Decision("deny", "actuation is disabled for this run")
    return Decision("allow", "registered and permitted")


def may_act(policy: RunPolicy, *, entity_id: str, service: str,
            reversible: bool, integration: str = "",
            device_class: str = "") -> Decision:
    """THE gate. Two axes, and both must pass.

    ⚠️ THE HIGH-HARM ROW IS A DENY-LIST IN CODE, NOT A SETTING. An owner cannot
    allow-list a door lock into autonomous actuation, because no chain of
    reasoning should be able to open a door in an empty villa. What they CAN do
    is answer the proposal.

    ⚠️ AND THE ORDER MATTERS: harm is decided BEFORE the allow-list is
    consulted, so a high-harm service cannot be granted by adding it to config.
    Reversing these two lines would make the deny-list a default rather than a
    rule.
    """
    harm = harm_class_of(entity_id, integration=integration,
                         device_class=device_class, service=service)

    if harm == "high":
        # ⚠️ PROPOSE, NEVER EXECUTE — at any confidence, from any trigger, with
        # or without config. "Should I unlock the gate for the cleaner?" is a
        # good product; "I unlocked the gate for someone claiming to be the
        # cleaner" is a liability.
        return Decision("propose",
                        "high-harm actions are never executed autonomously; "
                        "this is offered to a person to confirm", "high")

    if not policy.act_enabled:
        return Decision("deny", "actuation is disabled for this run", harm)
    if not reversible:
        return Decision("propose",
                        "irreversible actions are offered, never executed", harm)
    key = f"{str(entity_id).split('.', 1)[0]}.{str(service).rsplit('.', 1)[-1]}"
    if key not in policy.allowed_services and str(service) not in policy.allowed_services:
        return Decision("deny",
                        f"{key!r} is not in this property's allow-list", harm)
    return Decision("allow", "low harm, reversible, allow-listed", harm)


def is_suppressed(policy: RunPolicy, subject_key: str) -> bool:
    """Has a person told us to stop raising this subject?

    ⚠️ DETERMINISTIC, BY A COUNTER UPSTREAM, NEVER BY AGENT JUDGEMENT. "Stop
    telling me about the gym lights" must work reliably rather than
    probabilistically — that is the whole difference between a feedback loop and
    a suggestion.
    """
    return str(subject_key or "") in policy.suppressed_subjects


def within_budget(policy: RunPolicy, *, turns: int, tool_calls: int) -> Decision:
    if turns >= policy.max_turns:
        return Decision("deny", f"turn cap of {policy.max_turns} reached")
    if tool_calls >= policy.max_tool_calls:
        return Decision("deny", f"tool-call cap of {policy.max_tool_calls} reached")
    return Decision("allow", "within budget")


def concern_admissible(policy: RunPolicy, concern: Any) -> Decision:
    """A concern the run produced: is it well formed, and is it wanted?

    ⚠️ VALIDATION BEFORE SUPPRESSION, so a malformed concern is reported as
    malformed rather than as suppressed — those call for completely different
    responses and one of them is a bug in this system.
    """
    errors = contracts.concern_errors(concern)
    if errors:
        return Decision("deny", "; ".join(errors))
    if is_suppressed(policy, str(concern.get("subject_key") or "")):
        return Decision("deny", "this subject has been suppressed by a person")
    return Decision("allow", "well formed and not suppressed")
