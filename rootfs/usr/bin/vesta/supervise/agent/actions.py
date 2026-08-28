"""Every act a person can perform on an alert, wherever they perform it.

⚠️ THIS FILE EXISTS TO MAKE ONE SENTENCE TRUE BY CONSTRUCTION (owner, 2026-08-28,
about the phone buttons): *"each state shall be properly and fully synchronised
with what the VESTA Agent UI is doing, so that there can't be, by design, any
de-synchronised state"*. The only way to promise that is for the tablet and the
phone to run THE SAME CODE — not two implementations kept in step by whoever
remembers, which is `feedback_one-owner-per-predicate` — and the two-correct-
halves shape it belongs to is the one this repository has paid for most often.
⚠️ THAT SENTENCE CARRIED A COUNT ("fourteen times") FOR ONE RELEASE, AND THE
COUNT WAS BORROWED FROM A DIFFERENT PATTERN — `pin-the-caller`'s tally, in
CLAUDE.md. A number attached to the wrong rule is worse than no number, because
it reads as evidence. Found by /dry-audit Part 3 the morning after it shipped.

⚠️ AND IT ALREADY HAD ONE, BEFORE ANY BUTTON EXISTED. "Done" on the To-Do List
tab is two browser round trips — complete the item over Home Assistant's
websocket, then acknowledge the alert through this add-on — with nothing joining
them. The first succeeding and the second failing leaves a ticked job beside an
alert still being chased, which is precisely the state `reconcile_done` was
written to repair after the fact. `done` below is that pair, server-side, in one
call: the browser can no longer perform half of it.

⚠️ AN ACT IS NOT A STORE WRITE. Three of the five below are COMPOUND — a thumb
records a verdict AND teaches the flag type AND acknowledges; Done ticks AND
acknowledges — and every one of those compounds was previously assembled at a
call site. A caller that assembles is a caller that can assemble differently.

⚠️ WHAT IS DELIBERATELY NOT HERE: the decision about WHICH acts to offer lives
in `available_for`, and the decision about how to DRAW them lives with whoever
is drawing. This module answers "what does this act do", once.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from vesta.adapters.log import stage, swallow

#: Who may act on an alert at all. ⚠️ ONE TUPLE FOR EVERY SURFACE — the proxy
#: imports it rather than declaring its own, and the Telegram path checks the
#: role `policy.sender_role` resolved from the same People table. A guest may
#: FILE a fault report and may not judge one: dismissing an alert suppresses a
#: whole subject after three goes, which is a decision about what the villa
#: stops watching.
MAY_ACT: Tuple[str, ...] = ("owner", "ops")


@dataclass(frozen=True)
class Act:
    """One thing a person can do to an alert.

    `code` is the WIRE form and is one character on purpose: Telegram caps
    `callback_data` at 64 bytes and it has to carry the alert id as well.
    `id` is what an HTTP caller sends and what the tests name. They are separate
    so that renaming a button never changes what is already in flight on
    somebody's phone.
    """

    id: str
    code: str
    label: str


#: ⚠️ TWO QUESTIONS, AND THEY ARE NOT THE SAME QUESTION (2026-08-28, owner's
#: ruling). A person looking at an alert is answering either:
#:
#:    WHAT HAPPENS TO IT   Done · Need help · Nothing more   — lifecycle
#:    HOW GOOD WAS IT      +1 · -1                          — tuning
#:
#: and until 2.854.0 the second decided the first. A thumb up ACKNOWLEDGED, which
#: takes the card off the tablet's wall; a thumb down DISMISSED, which settles
#: the alert outright. So rating the supervisor's judgement quietly disposed of
#: the villa's problem — "don't make pressing it disappear the alert
#: notification", and dismissal now has its own control that says the word.
#:
#: ⚠️ THE ORDER IS THE READING ORDER on a phone, and it is not arbitrary: the
#: acts that DISCHARGE the alert come first, the one that stops the chase
#: without claiming the work is done comes next, then the one that throws it
#: away, and the rating LAST. A rating is a comment on the supervisor, not on
#: the villa, so it must never be the first thing offered.
#: ⚠️ THE LABELS ARE EMOJI, BY THE OWNER'S RULING FROM A SCREENSHOT OF THE
#: WORDED SET (2026-08-28, same day the words were added — and the same shape
#: of ruling that took them off the tablet an hour earlier). Emoji are also the
#: one decoration `style.py` says survives every notify platform, so nothing
#: here can trip a parse mode. The MEANING stays in `Outcome.note`, which is
#: what a presser is shown the moment they press; the tablet's `title`/`aria`
#: sentences are its own. ⚠️ `job` KEEPS ITS WORDS deliberately: it appears
#: alone on an alert-only notice, where there is no neighbouring set to teach a
#: reader what an unexplained glyph means — the exact reason the thumbs got
#: words this morning.
#: ⚠️ `done` IS GONE, MERGED INTO THE CLOSER (owner, 2026-08-28: "`Done` and
#: `Nothing more is needed — close this` should imply the same effect, hence
#: the same button"). The third merge of the day, and the residue of the first
#: two: once `Seen` folded in and suppression moved to the ⬇️ rating, both
#: remaining buttons ended in "handled, stop showing it" — the work-finished /
#: not-needed distinction lived only in the store, at the price of a choice the
#: reader had to make on every press. The merged act does EVERYTHING either
#: did: tick the job, record who, settle the alert.
ACTS: Tuple[Act, ...] = (
    Act("dismiss", "x", "\u2705"),
    Act("help", "h", "🆘"),
    # ⚠️ ONE ACT, NOT TWO (2026-08-28, owner: "I want the dismiss and seen
    # button to be merged in the same function, so it achieves the same, ie:
    # cancel the task"). `Seen — stop chasing` stopped the chase and left the
    # alert standing; `Dismiss completely` settled it. Both were pressed for the
    # same reason — "I do not need to hear about this again" — and offering two
    # buttons that both make an alert go away is a distinction the reader has to
    # hold rather than one the screen explains.
    #
    # ⚠️ IT DOES BOTH HALVES: acknowledges (so the chase stops and the record
    # says WHO) and then settles. Acknowledging first is what makes the merge a
    # merge rather than a replacement — dropping it would lose the name of the
    # person who dealt with it, which is the whole content of `Seen`.
    Act("job", "j", "Add to the To-Do List"),
    # ⚠️ `+1` AND `-1`, NOT THUMBS, AND THE CHANGE IS NOT COSMETIC. A thumb is a
    # verdict on a THING — people read it as approving or rejecting the alert
    # itself, which is why the down one dismissing felt natural enough to ship.
    # `+1 / -1` reads as a tally, which is exactly what it is: a nudge to the
    # rate at which this KIND of finding is raised in future. The words say
    # "like this" rather than "this", for the same reason.
    #
    # ⚠️ AND NEITHER TOUCHES THE ALERT. That is the whole point of the split, and
    # the wire codes `u`/`n` are deliberately unchanged so a button already
    # sitting in somebody's chat keeps meaning what it meant.
    Act("useful", "u", "⬆️"),
    Act("not_useful", "n", "⬇️"),
)

_BY_ID = {a.id: a for a in ACTS}
_BY_CODE = {a.code: a for a in ACTS}


def act_by_id(action_id: str) -> Optional[Act]:
    return _BY_ID.get(str(action_id or "").strip())


#: ⚠️ WIRE CODES THAT USED TO MEAN SOMETHING ELSE. A button sits in chat
#: history for ever, so a retired code must either keep meaning what its
#: presser will expect or be ignored — never re-issued. `d` (the old `Done`)
#: maps to the closer because the closer now does everything Done did, plus the
#: settle its presser always wanted. `s` (the old `Seen`) is deliberately NOT
#: mapped: Seen meant "keep it open, I have it", and closing on that press
#: would do the OPPOSITE of what the button in an old message promises — an
#: ignored press beats a betrayed one.
LEGACY_CODES: Dict[str, str] = {"d": "dismiss"}


def act_by_code(code: str) -> Optional[Act]:
    clean = str(code or "").strip()
    return _BY_CODE.get(clean) or _BY_ID.get(LEGACY_CODES.get(clean, ""))


@dataclass
class Outcome:
    """What happened, in a form both a JSON response and a button toast can use.

    ⚠️ `note` IS WRITTEN FOR A PERSON AND IS SHOWN TO ONE. Telegram puts it in
    the little toast over the chat, so it is a sentence rather than a status —
    and it doubles as the HTTP response's `note`, which is what stopped the two
    surfaces describing the same outcome differently.
    """

    ok: bool
    note: str = ""
    #: True when the alert no longer wants any buttons at all — it has been
    #: settled or acknowledged, so an affordance offering to acknowledge it
    #: again is an affordance that lies.
    spent: bool = False


def _row(concern_id: str) -> Optional[Mapping[str, Any]]:
    from vesta.supervise.agent import concerns as concerns_mod
    for row in concerns_mod.read():
        if str(row.get("id")) == str(concern_id):
            return row
    return None


def available_for(concern: Mapping[str, Any],
                  config: Optional[Mapping[str, Any]] = None) -> List[Act]:
    """Which acts apply to this alert right now.

    ⚠️ A PURE FUNCTION OF THE STORED ALERT, which is what lets the drawing side
    and the handling side agree without talking to each other: the buttons on a
    message and the guard that refuses a press are the same list, computed twice
    from the same record rather than declared once and trusted.

    ⚠️ A SETTLED ALERT OFFERS NOTHING. Its state was reached deliberately —
    closed, dismissed or verified — and every act here would either contradict
    that or be a no-op wearing a button.

    ⚠️ AN FYI OFFERS `job`, THE CLOSER AND THE RATING — NOT `done` OR `help`,
    because "Alert only" means nothing is asked of anybody and both of those
    presume somebody was. Turning the FYI into work is the one act that makes
    sense on it, and it is exactly the act the mode withheld; closing it is the
    other, because "I have read this and it can go" is still something a reader
    needs, and without it an alert-only notice could only be cleared by turning
    it into a job.
    """
    from vesta.supervise.agent import concerns as concerns_mod

    state = str(concern.get("state") or "open")
    if state in concerns_mod.SETTLED:
        return []

    # ⚠️ THE RATING PAIR IS OFFERED IN EVERY LIVE STATE, because it is not part
    # of the lifecycle at all — it says how good the alert was, which is as
    # answerable after somebody has picked the work up as before.
    #
    # ⚠️ BUT ONCE ONLY, AND `useful_at` IS THE DISCRIMINATOR (2026-08-28, owner:
    # "as soon as user click on either the +1 or -1 button, these 2 buttons
    # shall also disappear, since the rating shall only be applied once").
    # Read the STAMP, never the verdict: `useful` is `false` both for "less like
    # this" and for "nobody has said anything", so keying on it would leave a
    # `-1` still offering to be pressed while a `+1` correctly withdrew — the
    # same false/unset conflation that hid the receipt for a `-1` a release ago.
    rating = [] if str(concern.get("useful_at") or "").strip() \
        else [_BY_ID["useful"], _BY_ID["not_useful"]]
    if bool(concern.get("informational")):
        # ⚠️ AN FYI CAN BE DISMISSED TOO. Nothing is asked of the reader, but
        # "I have read this and it can go" is still an act somebody needs, and
        # without it an alert-only notice could only be cleared by turning it
        # into a job — which is the one thing the mode exists not to do.
        return [_BY_ID["job"], _BY_ID["dismiss"]] + rating

    # ⚠️ ONE SET NOW, WHATEVER THE ACKNOWLEDGEMENT SAYS. The branch that
    # differed per state withdrew `Seen`; with the merges there is nothing left
    # to withdraw — closing, asking for help and rating all still make sense on
    # an alert somebody has picked up. A branch that cannot differ is deleted.
    return [_BY_ID["dismiss"], _BY_ID["help"]] + rating


def _spent(concern_id: str, config: Optional[Mapping[str, Any]]) -> bool:
    row = _row(concern_id)
    return not available_for(row, config) if row is not None else True


async def apply(session: Any, action_id: str, concern_id: str, *,
                by: str, config: Optional[Mapping[str, Any]] = None,
                reason: str = "", now: Optional[float] = None) -> Outcome:
    """Perform one act. NEVER RAISES.

    ⚠️ `by` IS THE ACTOR AND COMES FROM THE CHANNEL, NEVER FROM THE REQUEST.
    The HTTP path reads the session's role; the Telegram path reads the role
    `policy.sender_role` resolved from the sender's id against the People table,
    before any field of the press is looked at. A caller-supplied name would let
    anyone stop the villa escalating on somebody else's behalf, which is the
    rule `/agent-acknowledge` already states and this inherits rather than
    restates.
    """
    act = act_by_id(action_id)
    if act is None:
        return Outcome(False, f"there is no {action_id!r} action")
    if not str(by or "").strip():
        return Outcome(False, "an action must say who took it")

    row = _row(concern_id)
    if row is None:
        return Outcome(False, f"no alert {concern_id}")
    if act not in available_for(row, config):
        # ⚠️ REFUSED, AND THE REFUSAL IS THE SYNCHRONISATION. A stale button on
        # a phone somebody scrolled back to is the ONE way the two surfaces can
        # still disagree, and it is answered here rather than prevented: the
        # act is checked against the store at the moment it arrives, so a press
        # can never act on the state the message was drawn in.
        return Outcome(False, "that has already been dealt with", spent=True)

    handler = _HANDLERS[act.id]
    try:
        outcome = await handler(session, row, by=by, config=config,
                                reason=reason, now=now)
    except Exception as err:  # noqa: BLE001 - a person pressed a button
        swallow(f"the {act.id!r} action failed for {concern_id}", err)
        return Outcome(False, "that did not work — it is still open")
    if outcome.ok:
        stage("action", f"{concern_id} {act.id} by {by}")
        outcome.spent = _spent(str(row.get("id") or ""), config)
    return outcome


# ── the acts themselves ─────────────────────────────────────────────────────
async def _judge(session: Any, row: Mapping[str, Any], *, useful: bool,
                 by: str, config: Optional[Mapping[str, Any]],
                 reason: str, now: Optional[float]) -> Outcome:
    """A thumb. Verdict, then the kind it teaches, then the acknowledgement.

    ⚠️ MOVED HERE VERBATIM FROM `/agent-feedback`, WHICH IS NOW ITS CALLER. The
    ORDER is load-bearing and was already reasoned there: the kind is recorded
    AFTER the verdict is stored, so a rejected verdict cannot retune anything.

    ⚠️ THE KIND IS READ FROM THE STORED ALERT, NOT WORKED OUT. `subject_key` is
    a hash, so the measurement a thumb teaches can only be the one stamped when
    the entity id was still in hand. An alert about a topic rather than a device
    has none, its verdict still counts, and it teaches nothing.

    ⚠️ IT NO LONGER ACKNOWLEDGES, AND THAT REVERSES A DECISION MADE EARLIER THE
    SAME DAY — deliberately, by the owner, after using it. The morning's ruling
    was "i like the fact that clicking on a thumb Up or Down acknowledge the
    concern"; the evening's is "don't make pressing it disappear the alert
    notification". Both are the same person describing the same press, and the
    second is the one made with the consequence in front of them: acknowledging
    is what removes a card from the tablet's wall, so rating an alert filed it
    away. A rating now records a rating. Nothing else.

    ⚠️ THE CONSEQUENCE, STATED SO IT IS NOT REDISCOVERED AS A BUG: the tablet's
    Reason tab had no acknowledge control of its own, because this act was doing
    it — the "eye" was removed on 2026-08-28 as redundant, and the redundancy is
    now gone with it. `AgentConcerns` offers the closer explicitly — one control
    since `Seen` merged into it — so clearing a card is a thing somebody chooses
    rather than a side effect of praising the villa.
    """
    from vesta.supervise.agent import concerns as concerns_mod
    from vesta.supervise.agent import flagtypes as flagtypes_mod

    concern_id = str(row.get("id") or "")
    ok, why = concerns_mod.feedback(concern_id, useful=useful,
                                    reason=str(reason or "")[:500], now=now)
    if not ok:
        return Outcome(False, why)

    kind = str(row.get("flag_type") or "")
    if kind:
        flagtypes_mod.record(kind, useful=useful)
    # ⚠️ THE ALERT IS LEFT EXACTLY WHERE IT WAS — no acknowledgement, no
    # transition. The notes say so out loud, because a press that changes
    # nothing visible reads as a press that did not register.
    return Outcome(True, "Noted — more like this. The alert is still open."
                   if useful else
                   "Noted — less like this. The alert is still open.")


async def _useful(session, row, **kw) -> Outcome:      # type: ignore[no-untyped-def]
    return await _judge(session, row, useful=True, **kw)


async def _not_useful(session, row, **kw) -> Outcome:  # type: ignore[no-untyped-def]
    return await _judge(session, row, useful=False, **kw)


async def _complete_item(session: Any, concern_id: str, *,
                         config: Optional[Mapping[str, Any]]) -> str:
    """Complete this alert's row on the configured to-do list. Never raises.

    Returns `ticked` | `none` | `failed`. ⚠️ THREE, NOT A BOOLEAN — see `_done`.
    "There was nothing to tick" and "the tick was refused" need opposite
    answers from the caller, and a boolean cannot carry that.

    ⚠️ THE TICK ITSELF LIVES IN `task.complete_items` AND THIS IS ITS CALLER
    (2026-08-28). A second writer appeared — the sweep that ticks a job whose
    alert was settled somewhere else — and two copies of "find the item by its
    bracket, then complete it" is how the join, the status filter and the
    service call drift apart. What stays here is the mapping onto three answers,
    because this is the only caller that needs them: found by its bracket, which
    is the same join every other reader uses (`ledger.TASK_PREFIX`, written by
    `task.summary_for`, parsed by `ledger.todo_tasks`).
    """
    from vesta.supervise.agent import task as task_mod

    ticked, failed = await task_mod.complete_items(session, [concern_id],
                                                   config=config)
    if failed:
        return "failed"
    # ⚠️ `none`, NOT `failed`. Nothing is wrong: this alert never raised a job
    # (an FYI does not, and neither does a villa with no list configured), or
    # somebody has already ticked it somewhere else.
    return "ticked" if ticked else "none"


async def _job(session: Any, row: Mapping[str, Any], *, by: str,
               config: Optional[Mapping[str, Any]], reason: str,
               now: Optional[float]) -> Outcome:
    """Turn an FYI into work. The one act "Alert only" deliberately withholds.

    ⚠️ IT DOES NOT UNSET `informational`. The stamp records what the villa's
    mode was when the alert was raised and relabelling it would rewrite history
    — the exact trap `Concern.informational`'s own comment exists to name. A
    person asking for a job is a decision taken after the fact, and the job is
    the record of it.
    """
    from vesta.supervise.agent import task as task_mod
    outcome = await task_mod.raise_for(session, row, config=config)
    if outcome == "off":
        return Outcome(False, "no to-do list is configured for this villa")
    if outcome != "raised":
        return Outcome(False, "the job could not be created")
    return Outcome(True, "Added to the To-Do List")


async def _help(session: Any, row: Mapping[str, Any], *, by: str,
                config: Optional[Mapping[str, Any]], reason: str,
                now: Optional[float]) -> Outcome:
    """Ask the owner now, without waiting for a band to come round.

    ⚠️ THROUGH THE SAME SEND PATH THE LADDER USES (`outbox._escalate_one`), so
    the delivery class, the routing table and the "who has already been told"
    record are the ladder's. A second sender here would be the one message that
    dodged `route.plan`, and it would leave `escalated_step` unwritten so the
    automatic ladder would later repeat by hand what a person had just done.

    ⚠️ IT DOES NOT ACKNOWLEDGE. Asking for help is the opposite of "I have this
    covered" — the chase must continue, because the person who pressed it has
    just said they cannot finish alone.
    """
    from vesta.supervise.agent import outbox as outbox_mod
    from vesta.supervise.agent import route as route_mod

    verdict = route_mod.Escalation(act=True, step="add the owner",
                                   reason=f"{by} asked for help")
    sent = await outbox_mod._escalate_one(session, row, verdict,
                                          config=config, now=now)
    return Outcome(True, "The owner has been told") if sent else \
        Outcome(False, "there is nobody else configured to tell")


async def _dismiss(session: Any, row: Mapping[str, Any], *, by: str,
                   config: Optional[Mapping[str, Any]], reason: str,
                   now: Optional[float]) -> Outcome:
    """Throw this alert away: it did not need raising, or no longer matters.

    ⚠️ THE ONLY IRREVERSIBLE ACT ON THE LIST, which is why it is the only one
    whose label says "completely". It settles the alert, so the alert leaves the
    Reason tab and the next briefing, `reconcile_settled` ticks its job off the
    facility manager's list, and `negatives_of` counts it toward silencing this
    subject in future. Every other act leaves the villa's problem standing.

    ⚠️ IT WAS THE THUMB DOWN UNTIL 2026-08-28, which is how a rating came to
    dispose of an alert. Splitting them makes the dismissal DELIBERATE, and that
    strengthens the suppression signal rather than weakening it: three presses
    of a button that says "dismiss completely" is evidence about a subject in a
    way that three presses of a thumb never was.

    ⚠️ THE REASON IS KEPT AND IS THE VALUABLE HALF — `concerns.transition`
    records it verbatim, and "the gym is closed for renovation" is a fact about
    the villa that should quiet a whole family of alerts rather than this one.
    """
    from vesta.supervise.agent import concerns as concerns_mod

    concern_id = str(row.get("id") or "")
    # ⚠️ TICK FIRST, AND A TICK HOME ASSISTANT REFUSED REFUSES THE WHOLE ACT — the rule the
    # old `Done` carried (`feedback_instruments-never-skip` inside a writer):
    # settling an alert whose job still looks undone stops the chase on work
    # nobody did. "Nothing to tick" is the opposite outcome and proceeds — an
    # FYI has no job, and a villa with no list configured must not have a dead
    # close button. `reconcile_settled` remains the net for ticks this misses.
    ticked = await _complete_item(session, concern_id, config=config)
    if ticked == "failed":
        return Outcome(False, "the job could not be ticked — nothing changed")
    # ⚠️ ACKNOWLEDGE, THEN SETTLE — in that order. The acknowledgement records
    # WHO dealt with it and must be written while the alert is still live:
    # `acknowledge` has nothing to say about a settled one. Its failure is not
    # this act's failure (an alert nobody was told about cannot be acknowledged
    # at all), so it is not checked — the settle is the act that must succeed.
    concerns_mod.acknowledge(concern_id, by=by, now=now)
    note = str(reason or "").strip()
    outcome = f"closed by {by}" + (f": {note}" if note else "")
    ok, why = concerns_mod.transition(concern_id, "dismissed",
                                      outcome=outcome, now=now)
    if not ok:
        return Outcome(False, why)
    return Outcome(True, "Closed — the job is ticked off, and nobody will "
                         "chase you about this again" if ticked == "ticked"
                   else "Closed — nobody will chase you about this again")


_HANDLERS = {
    "help": _help,
    "dismiss": _dismiss,
    "job": _job,
    "useful": _useful,
    "not_useful": _not_useful,
}
