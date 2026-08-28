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
from typing import Any, List, Mapping, Optional, Sequence, Tuple

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


#: ⚠️ THE ORDER IS THE READING ORDER on a phone, and it is not arbitrary: the
#: two acts that DISCHARGE the alert come first, the one that stops the chase
#: without claiming the work is done comes next, and the verdict on the villa's
#: judgement comes last. A thumb is a comment on the supervisor, not on the
#: villa, so it must never be the first thing offered.
ACTS: Tuple[Act, ...] = (
    Act("done", "d", "Done"),
    Act("help", "h", "Need help"),
    Act("seen", "s", "Seen — stop chasing"),
    Act("job", "j", "Add to the To-Do List"),
    Act("useful", "u", "👍"),
    Act("not_useful", "n", "👎"),
)

_BY_ID = {a.id: a for a in ACTS}
_BY_CODE = {a.code: a for a in ACTS}


def act_by_id(action_id: str) -> Optional[Act]:
    return _BY_ID.get(str(action_id or "").strip())


def act_by_code(code: str) -> Optional[Act]:
    return _BY_CODE.get(str(code or "").strip())


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
    from agent import concerns as concerns_mod
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

    ⚠️ AN FYI OFFERS `job` AND NOTHING ELSE BUT THE THUMBS, because "Alert only"
    means nothing is asked of anybody. `Done`, `Need help` and `Seen` all
    presume somebody was asked. Turning the FYI into work is the one act that
    makes sense on it, and it is exactly the act the mode withheld.
    """
    from agent import concerns as concerns_mod

    state = str(concern.get("state") or "open")
    if state in concerns_mod.SETTLED:
        return []

    thumbs = [_BY_ID["useful"], _BY_ID["not_useful"]]
    if bool(concern.get("informational")):
        return [_BY_ID["job"]] + thumbs

    # ⚠️ ACKNOWLEDGED IS NOT SETTLED. Somebody has it; the villa still has the
    # problem. So the acts that only say "I have seen this" are spent, and the
    # ones that change something — finishing the work, asking for help, judging
    # — are all still live.
    if str(concern.get("acknowledged_at") or "").strip():
        return [_BY_ID["done"], _BY_ID["help"]] + thumbs
    return [_BY_ID["done"], _BY_ID["help"], _BY_ID["seen"]] + thumbs


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

    ⚠️ AND A THUMB ACKNOWLEDGES (owner, 2026-08-28: "i like the fact that
    clicking on a thumb Up or Down acknowledge the concern"). Its failure is not
    this act's failure: a second acknowledgement is reported ok-with-a-reason by
    design, and an alert nobody was told about cannot be acknowledged at all.
    """
    from agent import concerns as concerns_mod
    from agent import flagtypes as flagtypes_mod

    concern_id = str(row.get("id") or "")
    ok, why = concerns_mod.feedback(concern_id, useful=useful,
                                    reason=str(reason or "")[:500], now=now)
    if not ok:
        return Outcome(False, why)

    kind = str(row.get("flag_type") or "")
    if kind:
        flagtypes_mod.record(kind, useful=useful)
    concerns_mod.acknowledge(concern_id, by=by, now=now)
    return Outcome(True, "Noted — thank you" if useful
                   else "Noted — you will hear less of this")


async def _useful(session, row, **kw) -> Outcome:      # type: ignore[no-untyped-def]
    return await _judge(session, row, useful=True, **kw)


async def _not_useful(session, row, **kw) -> Outcome:  # type: ignore[no-untyped-def]
    return await _judge(session, row, useful=False, **kw)


async def _seen(session: Any, row: Mapping[str, Any], *, by: str,
                config: Optional[Mapping[str, Any]], reason: str,
                now: Optional[float]) -> Outcome:
    """"I have got this." Stops the chase and claims nothing else."""
    from agent import concerns as concerns_mod
    ok, why = concerns_mod.acknowledge(str(row.get("id") or ""), by=by, now=now)
    return Outcome(ok, why or "Noted — nobody will chase you") if ok \
        else Outcome(False, why)


async def _done(session: Any, row: Mapping[str, Any], *, by: str,
                config: Optional[Mapping[str, Any]], reason: str,
                now: Optional[float]) -> Outcome:
    """The work is finished: tick the to-do item, then acknowledge the alert.

    ⚠️ BOTH HALVES, OR THE HALF THAT MATTERS IS THE ONE THAT GOES MISSING. The
    tablet's Done did these as two browser calls and the phone's old Telegram
    button did only the first — so a facility manager who finished the job left
    the alert unacknowledged: still on the wall, still counted as awaiting a
    person, and if it were critical, still being chased for work already done.

    ⚠️ A TICK THAT FAILED REFUSES THE ACKNOWLEDGEMENT; A TICK WITH NOTHING TO
    TICK DOES NOT. Those are opposite outcomes and the first cut of this
    returned one value for both — `feedback_instruments-never-skip` inside a
    writer. "No list configured, or no item for this alert" means Done is
    simply a person saying they have dealt with it, and refusing would make the
    button dead on every villa that has not finished setting up. "Home
    Assistant would not accept the tick" means the job is still visibly
    outstanding, and stamping it seen would stop the chase on work that still
    looks undone — the exact rule the tablet's two-call version enforced with
    `if (ok …)` and the reason it is preserved here rather than dropped as a
    consequence of moving server-side.
    """
    from agent import concerns as concerns_mod

    concern_id = str(row.get("id") or "")
    ticked = await _complete_item(session, concern_id, config=config)
    if ticked == "failed":
        return Outcome(False, "the job could not be ticked — nothing changed")
    ok, why = concerns_mod.acknowledge(concern_id, by=by, now=now)
    if not ok:
        return Outcome(False, why)
    return Outcome(True, "Marked done" if ticked == "ticked"
                   else "Marked done — there was no job to tick")


async def _complete_item(session: Any, concern_id: str, *,
                         config: Optional[Mapping[str, Any]]) -> str:
    """Complete this alert's row on the configured to-do list. Never raises.

    Returns `ticked` | `none` | `failed`. ⚠️ THREE, NOT A BOOLEAN — see `_done`.
    "There was nothing to tick" and "the tick was refused" need opposite
    answers from the caller, and a boolean cannot carry that.

    ⚠️ FOUND BY ITS BRACKET, WHICH IS THE SAME JOIN EVERY OTHER READER USES —
    `ledger.TASK_PREFIX`, written by `task.summary_for`, parsed by
    `ledger.todo_tasks`. Matching on the title instead would break the moment a
    title is edited, and re-implementing the parse here is how the two halves
    drift.
    """
    from agent import task as task_mod
    from vesta.adapters import ledger as ledger_mod
    from vesta.adapters.hass import HassClient

    entity_id = task_mod.list_for(config)
    if not entity_id or session is None:
        return "none"
    try:
        async with HassClient(session) as hass:
            open_items = await ledger_mod.todo_tasks(hass, [entity_id],
                                                     status="needs_action")
            # ⚠️ BY `uid`, WHICH `todo_tasks` ALREADY CARRIES for exactly this
            # reason — its own comment says the id and the list must come from
            # the pass that decided the item was ours. `todo.update_item` also
            # accepts a summary, and matching on one would miss any item whose
            # text a person had tidied.
            uid = ""
            for item in open_items:
                if str(item.get("rule_id") or "") == concern_id:
                    uid = str(item.get("uid") or "")
                    break
            if not uid:
                # ⚠️ `none`, NOT `failed`. Nothing is wrong: this alert never
                # raised a job (an FYI does not), or somebody has already
                # ticked it somewhere else.
                return "none"
            await hass.command(
                "call_service", domain="todo", service="update_item",
                target={"entity_id": entity_id},
                service_data={"item": uid, "status": "completed"})
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow(f"could not tick the job for {concern_id}", err)
        return "failed"
    return "ticked"


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
    from agent import task as task_mod
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
    from agent import outbox as outbox_mod
    from agent import route as route_mod

    verdict = route_mod.Escalation(act=True, step="add the owner",
                                   reason=f"{by} asked for help")
    sent = await outbox_mod._escalate_one(session, row, verdict,
                                          config=config, now=now)
    return Outcome(True, "The owner has been told") if sent else \
        Outcome(False, "there is nobody else configured to tell")


_HANDLERS = {
    "done": _done,
    "help": _help,
    "seen": _seen,
    "job": _job,
    "useful": _useful,
    "not_useful": _not_useful,
}
