"""The vocabulary the agent and VESTA share. CTR-001 to CTR-020.

⚠️ THIS FILE HAS A TWIN: `src/agent/agentTypes.ts`, and
`tests/py/test_contract_parity.py` fails the build if the two disagree in either
direction. That is why every enum below is a flat tuple of strings rather than
`enum.Enum` — an Enum is nicer Python and cannot be compared to a TypeScript
union without reimplementing half of it, and the failure the parity check
prevents is silent: a backend emitting a severity the SPA's union does not carry
renders an unstyled row, or drops it, on a tablet nobody is watching.

⚠️ EVERY SET MUST BE IN `CONTRACT_SETS`, AND A TEST ENFORCES THAT RATHER THAN
TRUSTING IT. `reports/contracts.py` has the same dict and the same sentence
above it, and `ZONE` and `TREND_DIRECTION` still shipped a release unregistered
— two lines below the comment warning about exactly that. So here the guard is
mechanical: `test_agent_contracts` walks this module for every module-level
tuple-of-strings and fails on any that is not registered. A set nobody
registered is a set nobody checks.

⚠️ VALUES ARE PART OF THE STORED DOCUMENT. Concerns persist to `/data`, so
RENAMING a value is a data migration and not a refactor — old rows keep the old
spelling forever. Add values; never repurpose one.

Imports nothing, by design — see the layering note in `__init__.py`.
"""

from __future__ import annotations

from typing import Any, Dict, Final, List, Optional, Tuple

#: Bumped when a value's MEANING changes, never for an addition.
CONTRACT_VERSION: Final[int] = 1

# ── CTR-002 · what caused this run ──────────────────────────────────────────
#: ⚠️ `chat` IS A FIRST-CLASS TRIGGER, NOT A SPECIAL CASE. A conversational turn
#: is the same reasoning run with a different origin and a reply at the end;
#: making it a separate path is how the two drift and how a question gets an
#: answer the scheduled brief would have contradicted.
# ⚠️ `event` WENT IN 2.762.0 — nothing ever produced one. Removing a value from
# a STORED vocabulary is normally the dangerous kind of change; it is safe here
# precisely because no code path ever called `run_once(trigger="event")`, so no
# audit row, run id or usage record on any villa can carry it. The three that
# remain are the three real entry points: the clock, the "check the villa now"
# button, and chat.
TRIGGER: Final[Tuple[str, ...]] = ("manual", "scheduled", "chat")

# ── CTR-008 · how a run ended ───────────────────────────────────────────────
#: ⚠️ `declined` IS NOT `failed`. Declining is a correct outcome — the budget
#: was spent, the breaker was open, there was nothing worth saying. Collapsing
#: the two would make a working system look broken in every count that matters,
#: and would hide the one case that needs an engineer.
RUN_STATUS: Final[Tuple[str, ...]] = ("answered", "declined", "failed", "partial")

# ── CTR-011 · severity ──────────────────────────────────────────────────────
#: Ordered least to most urgent; routing and report sections sort by this order.
#: ⚠️ THE SAME FOUR VALUES AS `reports.contracts.SEVERITY`, DELIBERATELY. P4 of
#: the consistency work found THREE severity scales with nothing relating any
#: two; the agent adopting a fifth would reopen it. They are declared separately
#: because `agent` may not import `reports` for a constant it would then be
#: unable to change independently — and a test asserts they are identical, so
#: the duplication cannot drift.
SEVERITY: Final[Tuple[str, ...]] = ("info", "notice", "warning", "critical")


def severity_rank(severity: Any) -> int:
    """Worst first: 0 is `critical`. THE ordering, for every renderer.

    ⚠️ IT WAS WRITTEN THREE TIMES AND THE TWO COPIES DISAGREED WITH THE
    PROJECT'S OWN RULE. `fallback.py` and `CockpitConcerns.tsx` each carried
    `{critical: 0, warning: 1, notice: 2, info: 3}` with an unknown severity
    defaulting to 9 — so a severity nobody had classified sorted LAST, into the
    quietest position, in both the brief and the wall. `route.py` and
    `standing.severity_of` both state the opposite rule in as many words: an
    unknown severity is treated as a WARNING, never as the quietest thing,
    because that is how a new hazard arrives unnoticed.

    ⚠️ DERIVED FROM `SEVERITY`, NOT RESTATED. Adding a fifth severity to that
    tuple now orders it everywhere; a hand-written map would have to be found
    twice, in two languages.
    """
    name = str(severity or "").lower()
    if name in SEVERITY:
        return len(SEVERITY) - 1 - SEVERITY.index(name)
    # ⚠️ AN UNKNOWN SEVERITY RANKS AS A WARNING. Same rule, same reason.
    return len(SEVERITY) - 1 - SEVERITY.index("warning")

# ── CTR-012 · who it is for ─────────────────────────────────────────────────
#: ⚠️ TAKEN FROM `reports.contracts`, NEVER RESTATED, AND THIS LINE INVENTED A
#: THIRD AUDIENCE FOR SIXTEEN RELEASES. It read `("owner", "facility", "ops")`,
#: which is wrong twice over: `ops` is a ROLE — the internal id of the Facility
#: Manager PROFILE — and the file it diverged from says in as many words that
#: audiences "are AUDIENCES, not roles … they intentionally do not map
#: one-to-one onto `auth/permissions.ts` profiles". So the list mixed the two
#: vocabularies and then named the same person twice: `facility` (the audience)
#: and `ops` (their profile). Reported from the role picker, where it read as a
#: third profile that does not exist.
#:
#: ⚠️ AN AUDIENCE IS WHO A FINDING IS WRITTEN FOR; A ROLE IS WHO IS LOGGED IN.
#: The owner may perfectly well read the facility brief, which is exactly why
#: the two sets are separate and neither may be derived from the other.
from reports.contracts import AUDIENCE  # noqa: E402  (re-exported, not copied)

#: Who may be a SENDER — the app's own profiles, and the only three there are.
#: ⚠️ MIRRORS `supervisor-proxy.AUTH_ROLES`, which is the authority, and
#: `test_role_vocabulary` fails if the two ever differ. `ops` is the Facility
#: Manager: `src/auth/roles.ts` has carried that label since long before this
#: subsystem existed, and inventing `facility` as a fourth name for the same
#: person is what produced a picker offering `facility` AND `ops`.
SENDER_ROLE: Final[Tuple[str, ...]] = ("guest", "owner", "ops")

# ── CTR-010 · a concern's lifecycle ─────────────────────────────────────────
#: ⚠️ `dismissed` IS NOT `closed`. Closed means the thing was dealt with;
#: dismissed means a person said it did not matter. They are the two halves of
#: the feedback loop and the alert-fatigue measurement reads the difference —
#: merging them would delete the only signal that says a concern was noise.
CONCERN_STATE: Final[Tuple[str, ...]] = (
    "open", "acted", "verified", "closed", "dismissed")

# ── CTR-014 · what an action would do ───────────────────────────────────────
#: ⚠️ REVERSIBILITY IS NOT A SUFFICIENT SAFETY TEST, WHICH IS WHY THERE ARE TWO
#: AXES AND NOT ONE. Unlocking a door is reversible — you can lock it again —
#: and the harm is instantaneous and permanent in effect. The state reverts; the
#: consequence does not. `policy.py` requires BOTH to pass.
HARM_CLASS: Final[Tuple[str, ...]] = ("low", "high")

#: ⚠️ THE VERDICT IS A THIRD THING, NOT A BOOLEAN. "May execute", "propose to a
#: person", and "not expressible" are three different answers, and squashing the
#: middle one into a refusal is what turns a good product ("should I unlock the
#: gate for the cleaner?") into a dead end.
POLICY_VERDICT: Final[Tuple[str, ...]] = ("allow", "propose", "deny")

# ── CTR-018 · why a tool call failed ────────────────────────────────────────
#: ⚠️ A TOOL ERROR IS DATA, NOT AN EXCEPTION. The model has to be able to read
#: what went wrong and try something else; raising past it ends the run and
#: throws away every turn already paid for.
TOOL_ERROR_CODE: Final[Tuple[str, ...]] = (
    "not_found", "unavailable", "invalid_args", "not_permitted",
    "too_large", "rate_limited", "internal")

#: ⚠️ WHAT A TOOL DOES TO THE WORLD, AND THE REASON THERE ARE THREE RATHER THAN
#: TWO. `ACT` exists BEFORE any actuating tool does, because the MCP surface is
#: an allow-list over this vocabulary (`READ`, plus one named write) — so
#: `act_service` is excluded from that surface the day it is written, by being
#: what it is, rather than by somebody remembering to add it to a deny-list.
#: REQ-047 is then structural instead of a rule in a comment.
TOOL_MODE: Final[Tuple[str, ...]] = ("READ", "WRITE", "ACT")

#: ⚠️ MCP CONTENT BLOCKS, WHICH IS WHY THIS SET EXISTS AT ALL. A tool returns
#: blocks rather than a string so the protocol this is shaped for needs no
#: translation layer later — see ADR-006 and `__init__.py`.
CONTENT_KIND: Final[Tuple[str, ...]] = ("text", "json")

#: ⚠️ EVERY SET ABOVE, AND THE TEST WALKS THE MODULE RATHER THAN TRUSTING THIS
#: LIST. Registration by hand is how `ZONE` and `TREND_DIRECTION` went a release
#: unchecked in the sibling file.
CONTRACT_SETS: Final[Dict[str, Tuple[str, ...]]] = {
    "TRIGGER": TRIGGER,
    "RUN_STATUS": RUN_STATUS,
    "SEVERITY": SEVERITY,
    "AUDIENCE": AUDIENCE,
    "SENDER_ROLE": SENDER_ROLE,
    "CONCERN_STATE": CONCERN_STATE,
    "HARM_CLASS": HARM_CLASS,
    "POLICY_VERDICT": POLICY_VERDICT,
    "TOOL_ERROR_CODE": TOOL_ERROR_CODE,
    "CONTENT_KIND": CONTENT_KIND,
    "TOOL_MODE": TOOL_MODE,
}


# ── keys and digests ────────────────────────────────────────────────────────
def subject_key(subject: str) -> str:
    """CTR-005. `sha256(subject)[:16]`, UNPREFIXED.

    ⚠️ DELEGATES — IT DOES NOT RESTATE THE HASH, AND THE FIRST DRAFT OF THIS
    FILE DID. `reports.analysis.base.subject_key` already exists and already
    answers this exact question, and its own docstring says why a second
    spelling is dangerous: "two hashes of the same string that disagree because
    one was cut at 16 and the other at 12 is the shape of bug this whole
    subsystem keeps paying for, and prose does not stop it. One expression
    does." My independent copy happened to agree, which is worse than
    disagreeing — it would have drifted the first time either was touched.
    Found by checking the claim in this docstring rather than by review.

    ⚠️ UNPREFIXED IS THE POINT, and `dedup_key` cannot serve: it is prefixed by
    the MODULE, so two layers describing one pump never match — correct there,
    because two CHECKS about one pump should stay distinct. This key asks "is
    this the same EQUIPMENT", which both detection layers must answer
    identically without either holding an identifier.

    ⚠️ THE IMPORT IS DEFERRED so `contracts` keeps its "imports nothing" property
    at module scope, which is what lets the parity test read it without dragging
    in the report pipeline. PH-5 dismantles `reports`; when `analysis/base.py`
    moves, this one line follows it and every caller is unaffected.
    """
    from reports.analysis.base import subject_key as _canonical
    return _canonical(str(subject))


def args_digest(args: Any) -> str:
    """CTR-013/CTR-020. A stable fingerprint of a tool call's arguments.

    ⚠️ THE DIGEST, NEVER THE ARGUMENTS. An audit row that stored the raw blob
    would carry entity ids, free text and whatever a guest typed into a fault
    report, into a file whose whole purpose is to be kept and read later. The
    digest answers "was this the same call" — which is all the audit and the
    idempotency check ever ask.

    ⚠️ CANONICAL JSON, or the same call fingerprints differently depending on
    dict ordering and the idempotency guard silently stops guarding.
    """
    import hashlib
    import json
    blob = json.dumps(args, sort_keys=True, separators=(",", ":"),
                      default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def action_key(run_id: str, tool: str, args: Any) -> str:
    """CTR-015. Idempotency for a mutating call.

    ⚠️ SCOPED TO THE RUN. Two runs proposing the same action are two decisions
    and both deserve an audit row; one run retrying after a timeout is the same
    decision and must not act twice.
    """
    import hashlib
    seed = f"{run_id}|{tool}|{args_digest(args)}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]


# ── validation, used by every producer ──────────────────────────────────────
def is_valid(value: Any, allowed: Tuple[str, ...]) -> bool:
    return isinstance(value, str) and value in allowed


def coerce_severity(value: Any) -> str:
    """A severity, or the safe default.

    ⚠️ AN UNRECOGNISED KIND BECOMES `warning`, NEVER `info`. The report
    subsystem already learned this: a kind nobody has classified must not arrive
    as the quietest thing in the document, because that is how a real problem
    goes unread. Loud-by-default costs one glance; quiet-by-default costs the
    finding.
    """
    return value if is_valid(value, SEVERITY) else "warning"


def concern_errors(concern: Any) -> List[str]:
    """Everything wrong with a Concern, as readable strings. CTR-010.

    ⚠️ RETURNS A LIST RATHER THAN RAISING, because the caller is the boundary
    between a model's output and a stored document. A malformed concern must be
    droppable with a reason recorded, not able to end a run that produced four
    good ones alongside it.
    """
    errors: List[str] = []
    if not isinstance(concern, dict):
        return ["concern is not an object"]
    for field in ("id", "subject_key", "title"):
        if not str(concern.get(field) or "").strip():
            errors.append(f"{field} is empty")
    if not is_valid(concern.get("severity"), SEVERITY):
        errors.append(f"severity {concern.get('severity')!r} is not one of "
                      f"{list(SEVERITY)}")
    if not is_valid(concern.get("audience"), AUDIENCE):
        errors.append(f"audience {concern.get('audience')!r} is not one of "
                      f"{list(AUDIENCE)}")
    state = concern.get("state")
    if state is not None and not is_valid(state, CONCERN_STATE):
        errors.append(f"state {state!r} is not one of {list(CONCERN_STATE)}")
    evidence = concern.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        # ⚠️ EVIDENCE IS REQUIRED, NOT ENCOURAGED. Every figure in a concern must
        # resolve to a tool result, and the only way that holds is if a concern
        # without any is refused here rather than trusted to be well behaved.
        errors.append("evidence is empty — every claim must cite a tool result")
    action = concern.get("action")
    if action is not None:
        if not isinstance(action, dict):
            errors.append("action is not an object")
        else:
            if not is_valid(action.get("harm_class"), HARM_CLASS):
                errors.append("action.harm_class is missing or invalid")
            if not isinstance(action.get("reversible"), bool):
                errors.append("action.reversible must be a bool")
    confidence = concern.get("confidence")
    if confidence is not None and not (
            isinstance(confidence, (int, float))
            and not isinstance(confidence, bool)
            and 0.0 <= float(confidence) <= 1.0):
        errors.append("confidence must be a number in 0..1")
    return errors
