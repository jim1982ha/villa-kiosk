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

from vesta.shared.style import SEVERITY_WORD, inert, severity_line

#: Severity -> (thread, push, holds-until-morning). The matrix, as a table.
#: ⚠️ `push` IS OWNER **AND** FACILITY FOR A CRITICAL, and the villa CAN
#: express that since the People table shipped: `outbox` merges
#: `people.targets_for_role(config, "ops")` into a critical's push list, so the
#: pair is live wherever a facility person is configured. This comment said
#: "cannot ... until a distinct facility target exists (DQ-04)" long after that
#: was false — found 2026-08-30 when the HLD repeated it as a blocking gap and
#: the owner caught the document, not the comment. `targets_for` still returns
#: what it was given rather than pretending: a villa with no facility person
#: pushes to the owner alone, which is configuration, not a missing capability.
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

#: The rung 🆘 jumps straight to. ⚠️ NAMED HERE, BESIDE THE LADDER IT INDEXES,
#: because two readers need it and they are in different modules: `actions._help`
#: takes this step, and `actions.available_for` asks whether the ladder has
#: already reached it in order to decide whether 🆘 is still worth drawing. A
#: literal in each would be two spellings of one rung, and the button set would
#: stop matching the act the moment either moved. `test_help_button` pins that it
#: is a real band rather than a string nothing recognises.
HELP_STEP: str = "add the owner"

#: How often the escalation sweep re-evaluates.
#:
#: ⚠️ DERIVED FROM THE FIRST BAND, NOT DECLARED (2026-08-28, owner: "make the
#: `how often the escalation sweep re-evaluates` the same duration as the first
#: escalation duration, for consistency"). Two independent numbers for one
#: rhythm is how a 15-minute promise comes to be checked on a 5-minute clock —
#: or, as it actually shipped, on no clock at all.
#:
#: ⚠️ AND IT WAS DEAD FOR ITS WHOLE EXISTENCE. `SWEEP_MINUTES` was declared,
#: documented as the sweep's cadence, and READ BY NOTHING; the sweep's only
#: caller was the end of a triage pass, so on a villa checking every 360 minutes
#: the first band was evaluated up to 6 hours late while the concern card
#: printed "by 14:32 it is re-sent to the same place". Found by /dry-audit's
#: claim audit after the owner asked how to test the ladder — a promise on a
#: screen, a constant nobody read, and no clock between them.
SWEEP_MINUTES: int = BANDS[0][0]


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
    #: ⚠️ AN FYI, NOT A REQUEST (2026-08-28, owner's ruling). True when the
    #: concern was raised in "Alert only": told once, in the
    #: thread only, never pushed, never escalated, no job raised. This
    #: REPLACES the old `suppressed` shadow flag — observe mode used to mean
    #: "recorded, delivered to nobody", and the owner has ruled it means
    #: "delivered for information, nothing asked of you" instead.
    informational: bool = False
    reason: str = ""

    @property
    def sends(self) -> bool:
        return bool(self.targets) and not self.held


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


#: Profile id -> what a PERSON calls it. ⚠️ THE SCREEN'S WORDS, NOT THE
#: STORE'S. `ops` is the Facility manager everywhere a human can see, and a
#: message signed "ops" would name a role nobody has heard of — the same
#: mapping `AgentConcerns` keeps for the concern card, for the same reason.
PROFILE_NAME: Dict[str, str] = {
    "owner": "Owner",
    "ops": "Facility manager",
    "guest": "Guest",
}


def plan(concern: Mapping[str, Any], *, targets: Sequence[str],
         push_targets: Sequence[str] = (), occupied: Optional[bool] = None,
         quiet_hours: bool = False, profile: str = "",
         config: Optional[Mapping[str, Any]] = None) -> Delivery:
    """One concern, routed. ⚠️ EVERYTHING DELIVERED IS MADE INERT HERE.

    A delivered message may contain nothing a notify platform can parse as
    markup — a real friendly name with an underscore once cost a day of failed
    deliveries — and applying it at the routing boundary means every channel
    below inherits it rather than each remembering.
    """
    severity = str(concern.get("severity") or "notice").lower()
    row = row_for(severity)

    # ⚠️ INFORMATIONAL IS A PROPERTY OF THE CONCERN, NOT OF TODAY'S CONFIG.
    # `tools/concern.writer` stamped it at raise time from the mode the villa
    # was in, so a mode change cannot re-route history — and this routing
    # decision survives a restart, because it is read from the store rather
    # than from a setting. An FYI goes to the thread only (never a push, even
    # for a severity the matrix would push), always respects quiet hours, and
    # says in its own body that nothing is asked of the reader. The old shadow
    # branch here ("recorded, delivered to nobody") is gone by the owner's
    # ruling: Alert only (then called Investigate & Log Only) tells you once
    # instead of telling nobody.
    informational = bool(concern.get("informational"))
    if informational:
        row = Row(thread=True, push=False, quiet_hours_apply=True,
                  acknowledgement="none")
    held, why = holds_until_morning(severity, occupied=occupied,
                                    quiet_hours=quiet_hours) if not informational \
        else _held_informational(occupied=occupied, quiet_hours=quiet_hours)

    chosen: List[str] = list(targets) if row.thread else []
    if row.push:
        chosen = chosen + [t for t in push_targets if t not in chosen]

    title = inert(str(concern.get("title") or ""))
    body = inert(str(concern.get("body") or ""))
    # ⚠️ ONE HEADER SHAPE FOR EVERY NOTIFICATION (owner, 2026-08-29, from ten
    # rendered candidates): `<mark> WORD · subject`. The mark is how bad it is,
    # the word is what is being asked — so an alert-only notice keeps its real
    # severity mark and swaps the word for FYI, rather than having to choose
    # between the two. `style.severity_line` holds the shape; a brief and an
    # escalation call the same function with their own word.
    if informational:
        # ⚠️ THE MESSAGE SAYS WHAT IT IS. A concern arriving on the same chat
        # as the escalating kind must announce that nothing is asked, or the
        # reader learns to ignore the ones that do ask. `inert()` has already
        # run; the header contains nothing a notify platform parses as markup.
        title = severity_line(severity, "FYI", title)
        body = (f"{body}\n\nFor your information only — the villa is set to "
                f"Investigate and Log Only, so nothing is asked of you. This "
                f"will not be re-sent or chased.")
    else:
        title = severity_line(severity, SEVERITY_WORD.get(severity, ""), title)

    # ⚠️ AND IT SAYS THE ALERT HAS A JOB, BECAUSE OTHERWISE NOTHING DOES
    # (2026-08-28, owner: "it's currently not clear from the UI that clicking
    # on the Thumbs will create a ToDo item in the list"). It does not — a thumb
    # records a verdict and acknowledges. The item is raised by DELIVERY, before
    # anybody presses anything, and no surface mentioned it: an item appeared on
    # the list with nothing to connect it to, so its arrival was attributed to
    # whichever button had just been pressed. An invisible side effect gets
    # blamed on a visible one.
    #
    # ⚠️ CONDITIONAL ON THE JOB ACTUALLY EXISTING, on both counts. `task_list`
    # DEFAULTS TO EMPTY, so on a villa that has configured no list there is no
    # job and this must not claim one; and an FYI raises none by design. That is
    # also why this is a sentence about what Done DOES rather than a claim that
    # an item is already there — the job is raised AFTER the send, deliberately,
    # so that nothing is ever put on a list for a message that failed to leave.
    if not informational:
        from vesta.supervise.agent import task as task_mod
        if task_mod.list_for(config):
            # ⚠️ THE BODY NAMES THE BUTTON AS THE READER SEES IT — ✅, since the
            # labels became glyphs (2026-08-28). "Press Done" above a row that
            # shows no word "Done" is an instruction pointing at nothing; the
            # emoji is also the one decoration style.inert never strips.
            body = (f"{body}\n\nThis is on the To-Do List. Press \u2705 when "
                    f"it is finished and it is ticked off there too.")

    # ⚠️ THE MESSAGE SAYS WHO IT IS FOR (2026-08-27, owner's request). One
    # Telegram chat can carry both the household's alerts and the Facility
    # manager's work, and a reader had no way to tell which of them a given
    # message was written for — the audience decides the wording, the
    # escalation ladder sends the SAME concern to a second profile, and both
    # arrive looking identical. The footer is the last line, after everything
    # else, so it reads as a signature rather than as part of the finding.
    #
    # ⚠️ PLAIN TEXT, NO MARKUP, AND THAT IS NOT A STYLE CHOICE. `style.inert`
    # strips every character a notify platform could parse — underscore,
    # asterisk, backtick, brackets — because the add-on does not choose the
    # parse mode and a stray one cost a day of failed deliveries. So "small"
    # is expressed by brevity and position, the only typography a plain-text
    # channel has.
    who = PROFILE_NAME.get(str(profile or "").strip())
    if who:
        body = f"{body}\n\n— for the {who}"

    return Delivery(
        concern_id=str(concern.get("id") or ""),
        severity=severity,
        targets=chosen,
        title=title,
        body=body,
        push=row.push,
        held=held,
        informational=informational,
        reason=why,
    )


def _held_informational(*, occupied: Optional[bool], quiet_hours: bool
                        ) -> Tuple[bool, str]:
    """Quiet-hours hold for an FYI, whatever its severity says.

    ⚠️ SEVERITY IS NOT CONSULTED, ON PURPOSE. `holds_until_morning` exempts a
    critical from quiet hours — right for a message that wakes somebody to
    act, and wrong for one whose own body says nothing is asked of them. An
    informational critical still exists (the severity is the model's honest
    judgement and the card shows it); it just waits for morning like every
    other FYI. Occupancy still overrides: people in the house are experiencing
    whatever it describes.
    """
    if not quiet_hours:
        return False, "informational: not quiet hours"
    if occupied is None:
        return False, ("informational, occupancy unknown: not held — an "
                       "assumption is not a reason to delay")
    if occupied:
        return False, "informational, but the villa is occupied"
    return True, "informational: held until morning through quiet hours"


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
