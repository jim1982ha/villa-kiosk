"""Who gets told, by what channel, and when. REQ-031, ADR-008, TASK-060.

⚠️ NO MODEL CALL LIVES HERE AND NONE MAY. The agent proposes urgency; this
turns urgency into a destination. A model deciding whether to wake somebody at
three in the morning is the most consequential unforced error available in this
system, and the defence is that the decision is a TABLE — readable, arguable,
and the same on Tuesday as on Sunday.

⚠️ THE KIOSK IS NOT A ROUTING TARGET. The wall always renders every concern,
live and offline, with no delivery involved: it is the state of the villa rather
than a notification. Only PUSH is routed. Confusing the two is how a `notice`
ends up buzzing a phone because somebody wanted it visible.

⚠️ ESCALATION RE-EVALUATES; IT DOES NOT COUNT DOWN. The catalog's fixed
15/45-minute ladder is blind: at 3am the facility manager is asleep and a
re-send only burns trust, and if the condition CLEARED, escalating is actively
wrong. Escalating a problem that fixed itself is how a supervisor loses trust
fastest, and the branch for it did not exist before this file.

⚠️ AND MOBILE PUSH CARRIES THE SAME CONCERN ID AS THE THREAD MESSAGE. Telegram
can be muted and a critical must survive that, so push is a SECOND CHANNEL FOR
ONE CONCERN rather than a second concern — acknowledging either closes both.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from reports.narrate.style import inert

#: Severity -> (thread, push, holds-until-morning). The matrix, as a table.
#: ⚠️ `push` IS OWNER **AND** FACILITY FOR A CRITICAL, which the villa cannot
#: express until a distinct facility target exists (DQ-04). `targets_for`
#: returns what it was given rather than pretending.
@dataclass(frozen=True)
class Row:
    thread: bool
    push: bool
    quiet_hours_apply: bool
    acknowledgement: str          # required | requested | none


MATRIX: Dict[str, Row] = {
    # ⚠️ QUIET HOURS ARE IGNORED FOR A CRITICAL, 24/7. That is the whole
    # meaning of the word: if it can wait until morning it is a warning.
    "critical": Row(thread=True, push=True, quiet_hours_apply=False,
                    acknowledgement="required"),
    "warning": Row(thread=True, push=False, quiet_hours_apply=True,
                   acknowledgement="requested"),
    "notice": Row(thread=True, push=False, quiet_hours_apply=True,
                  acknowledgement="none"),
    "info": Row(thread=True, push=False, quiet_hours_apply=True,
                acknowledgement="none"),
}

#: ⚠️ AN UNKNOWN SEVERITY ROUTES AS A WARNING, NEVER AS `info`. A severity this
#: table has not heard of is one nobody has classified, and delivering it as the
#: quietest thing in the system is how a new hazard arrives unnoticed. The same
#: rule `standing.severity_of` states for kinds.
DEFAULT_ROW: Row = MATRIX["warning"]

#: The escalation bands, in minutes. ⚠️ TIME IS THE LAST QUESTION ASKED, not
#: the first — see `escalate`.
BANDS: Tuple[Tuple[int, str], ...] = (
    (15, "resend to the same target"),
    (45, "add the owner"),
    (90, "every configured target, once"),
)

#: How often the escalation sweep re-evaluates.
SWEEP_MINUTES: int = 5


@dataclass
class Delivery:
    """What to send where. Never who wrote it or why."""

    concern_id: str
    severity: str
    targets: List[str] = field(default_factory=list)
    title: str = ""
    body: str = ""
    push: bool = False
    held: bool = False
    #: ⚠️ SHADOW MODE. Distinct from `held`, which is a TIMING decision that
    #: resolves at 07:00; this one means the villa is recording and not
    #: speaking at all, and nothing resolves it but an operator.
    suppressed: bool = False
    reason: str = ""

    @property
    def sends(self) -> bool:
        return bool(self.targets) and not self.held and not self.suppressed


def row_for(severity: str) -> Row:
    return MATRIX.get(str(severity or "").lower(), DEFAULT_ROW)


def holds_until_morning(severity: str, *, occupied: Optional[bool],
                        quiet_hours: bool) -> Tuple[bool, str]:
    """Should this wait for 07:00? Returns `(held, why)`.

    ⚠️ OCCUPANCY OVERRIDES QUIET HOURS, AND `None` IS A THIRD ANSWER. A failure
    nobody is experiencing can wait for the morning; the same failure with
    people in the house is happening TO somebody. And "I cannot tell whether
    anyone is there" is not "nobody is there" — it is a reason to deliver, since
    holding a message on an assumption is the expensive way to be wrong.
    """
    row = row_for(severity)
    if not row.quiet_hours_apply:
        return False, "critical: quiet hours do not apply"
    if not quiet_hours:
        return False, "not quiet hours"
    if occupied is None:
        return False, ("occupancy unknown, so it is not held — an assumption "
                       "is not a reason to delay somebody's villa")
    if occupied:
        return False, "the villa is occupied, so somebody is experiencing this"
    return True, "held until morning: quiet hours and nobody is there"


def occupancy(states: Sequence[Mapping[str, Any]]) -> Optional[bool]:
    """Is anybody at the villa? `None` when it cannot be told.

    ⚠️ THREE-VALUED ON PURPOSE. The villa has 60 `device_tracker` and 4 `person`
    entities and routing has never used one of them; a two-valued answer would
    turn "no trackers configured" into "nobody is home", which is the reading
    that holds a critical overnight.
    """
    seen = False
    for state in states:
        if not isinstance(state, Mapping):
            continue
        entity_id = str(state.get("entity_id") or "")
        if not entity_id.startswith(("person.", "device_tracker.")):
            continue
        value = str(state.get("state") or "").lower()
        if value in ("unknown", "unavailable", ""):
            continue
        seen = True
        if value == "home":
            return True
    return False if seen else None


def plan(concern: Mapping[str, Any], *, targets: Sequence[str],
         push_targets: Sequence[str] = (), occupied: Optional[bool] = None,
         quiet_hours: bool = False,
         config: Optional[Mapping[str, Any]] = None) -> Delivery:
    """One concern, routed. ⚠️ EVERYTHING DELIVERED IS MADE INERT HERE.

    A delivered message may contain nothing a notify platform can parse as
    markup — a real friendly name with an underscore once cost a day of failed
    deliveries — and applying it at the routing boundary means every channel
    below inherits it rather than each remembering.
    """
    severity = str(concern.get("severity") or "notice").lower()
    row = row_for(severity)

    # ⚠️ SHADOW FIRST, AND THIS MODULE IS EXACTLY WHAT THAT RULE COVERS. A
    # concern being routed to a phone is the villa ORIGINATING a message —
    # the thing a shadow period must not do — as against answering a question
    # somebody typed, which it must. `test_every_UNSOLICITED_delivery_path_asks_
    # suppressed` was written one release before this file existed and FIRED ON
    # IT the first time both were in the tree, which is the whole point of
    # pinning a rule before the code it governs is written.
    from agent import shadow
    if shadow.suppressed(config):
        return Delivery(
            concern_id=str(concern.get("id") or ""), severity=severity,
            targets=[], title=inert(str(concern.get("title") or "")),
            body=inert(str(concern.get("body") or "")), push=False,
            suppressed=True,
            reason="shadow mode: recorded, delivered to nobody")
    held, why = holds_until_morning(severity, occupied=occupied,
                                    quiet_hours=quiet_hours)

    chosen: List[str] = list(targets) if row.thread else []
    if row.push:
        chosen = chosen + [t for t in push_targets if t not in chosen]

    return Delivery(
        concern_id=str(concern.get("id") or ""),
        severity=severity,
        targets=chosen,
        title=inert(str(concern.get("title") or "")),
        body=inert(str(concern.get("body") or "")),
        push=row.push,
        held=held,
        reason=why,
    )


@dataclass
class Escalation:
    act: bool
    step: str
    reason: str


def escalate(*, minutes_open: float, acknowledged: bool,
             condition_cleared: bool, severity: str = "critical",
             facility_reachable: bool = True,
             guests_present: bool = False) -> Escalation:
    """Should this be escalated right now? Asked every `SWEEP_MINUTES`.

    ⚠️ THE ORDER OF THESE QUESTIONS IS THE WHOLE DESIGN, AND TIME COMES LAST.
    The catalog's ladder asks only "how long has it been", which is blind to the
    two facts that matter most.

    1. **Did the condition CLEAR?** Then stand down and log it. This branch did
       not exist before, and escalating a problem that fixed itself is how a
       supervisor loses trust fastest.
    2. **Was it acknowledged?** Then stop. Obviously.
    3. **Is the facility manager unreachable while GUESTS are in residence?**
       Then go to the owner NOW rather than after forty-five minutes. The villa
       has 60 `device_tracker` and 4 `person` entities and this branch has never
       been available to it.
    4. **Only then, the time bands.**
    """
    if str(severity).lower() != "critical":
        return Escalation(False, "", "only a critical escalates")
    if condition_cleared:
        return Escalation(False, "stand down",
                          "the condition cleared on its own; escalating a "
                          "problem that fixed itself is how trust is lost")
    if acknowledged:
        return Escalation(False, "acknowledged", "somebody has it")
    if guests_present and not facility_reachable:
        return Escalation(True, "add the owner",
                          "the facility manager is not reachable and guests are "
                          "in residence, so this does not wait for a band")
    for after, step in reversed(BANDS):
        if minutes_open >= after:
            return Escalation(True, step, f"unacknowledged for {after}+ minutes")
    return Escalation(False, "", "inside the first band")
