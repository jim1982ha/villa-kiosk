"""Turn a delivered Concern into a facility manager job somebody can tick off.

⚠️ THIS CLOSES A LOOP THE CUTOVER OPENED, AND THAT IS THE WHOLE JUSTIFICATION.
The `maintenance_*`, `roi_*` and `audit_*` blueprints did two things when they
fired: they emitted their event, and they called `todo.add_item` with a facility manager
task. Retiring them kept the detection (the agent replaces it) and silently
dropped the SECOND half — raise a job, ask the facility manager, chase, escalate, tick
it off. The agent could not write a to-do item at all: nothing under `agent/`
touched a todo list, so a Concern was something to READ on the tablet and in a
brief, and never something anybody was asked to do.

⚠️ IT IS TIER 4, DETERMINISTIC, AND THE MODEL HAS NO SAY. `reason.SYSTEM`'s
boundary is that the model decides what MATTERS and never who is told or what is
executed. So this is not a tool the model can call: the outbox raises a task for
a concern it has just DELIVERED, and delivery is already the bar for "worth a
person's attention". One rule, statable in a sentence, with no severity
threshold to argue about — a second bar here would be a second opinion about
something Tier 4 already decided.

⚠️ AFTER THE SEND, NEVER BEFORE, for the same reason `_mark_delivered` is: a
task raised for a concern whose delivery then failed is a job nobody was told
about, sitting on a list, with no message to explain it.

⚠️ ONE WRITE, AND THE BRACKET IS WHAT MAKES IT USABLE:

  1. The TODO ITEM, whose summary must contain `[<rule_id>]`. That bracket is
     parsed by `ledger.TASK_PREFIX` and is the join everything downstream uses
     — the To-Do List under Act & Tell, the daily digest, and `reconcile_done`,
     which marks
     the alert seen when the item is ticked from ANY surface. An item without
     it is work nothing can trace back to its alert.
     ⚠️ It used to be the string `vesta_task_actions.yaml`'s "Done" button
     matched on. That blueprint is inert since 2026-08-28; the bracket's reader
     changed, the bracket did not.
  2. The EVENT, carrying `task_text` and `rule_id`. The blueprint triggers on
     the event, not on the todo item appearing — writing only the item produces
     a job nobody is ever asked about.

⚠️ NOTHING IS FIRED AND NOTHING LISTENS ANY MORE (2026-08-28). This module
used to fire `vesta_task_event`, which woke `vesta_task_actions.yaml` — the
blueprint that messaged the facility manager, re-asked at fifteen minutes and
escalated to the owner at forty-five. The owner's ruling retired all of it: the
Concern is the alert, and a to-do item is the record of work rather than a
second announcement of the same finding. `EVENT_TYPE` went with it; the
blueprint is inert and can be deleted from Home Assistant.

⚠️ OFF UNTIL A LIST IS NAMED. `task_list` ships empty, like every other
villa-specific setting here: which to-do list a property uses is a fact about
that property, and a seeded default would write jobs into a stranger's list.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional, Sequence, Tuple

from vesta.supervise.agent import config as agent_config
from vesta.adapters.log import stage, swallow

#: The stored key naming the facility manager list. Empty means the feature is off.
CONFIG_KEY: str = "task_list"

#: Home Assistant's `TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM`.
#:
#: ⚠️ NOT EVERY TODO LIST HAS ONE, AND SENDING A DESCRIPTION TO ONE THAT DOES
#: NOT IS A 500 THAT LOSES THE WHOLE ITEM. Found on the reference villa the
#: first time the loop was fired by hand: `todo.shopping_list` — the built-in
#: Shopping List, which is the list most people already have and the obvious
#: one to name — reports `supported_features: 15` (create, delete, update,
#: move) and refuses `description` outright. So every facility manager job this
#: module raised would have failed on that villa, `swallow`ed as "failed", with
#: the owner having configured everything correctly.
#:
#: This is `feedback_guessed-field-shapes`: the field NAME was right, the
#: capability was assumed, and a degrade-never-fail wrapper would have hidden it
#: for the life of the feature. It was found by an END-TO-END test rather than
#: by any of the 1,908 pins, because both halves — the service call and the
#: blueprint — are correct in isolation.
DESCRIPTION_FEATURE: int = 64


def list_for(config: Optional[Mapping[str, Any]] = None) -> str:
    """The configured facility manager list, or "" when the loop is switched off."""
    return str(agent_config.view(config).get(CONFIG_KEY) or "").strip()


def summary_for(concern: Mapping[str, Any]) -> str:
    """`[c12] Pool pump drawing more than usual`.

    ⚠️ THE BRACKETED ID IS LOAD-BEARING, NOT DECORATION. It is how the "Done"
    button finds the item to complete, and how the brief's acknowledgement
    counter and the tablet's Facility Manager list recognise the same job — one
    acknowledgement record rather than three.

    ⚠️ AND IT IS THE CONCERN ID, WHICH IS SHORT ON PURPOSE. Telegram caps
    `callback_data` at 64 bytes and the blueprint builds `vd:<rule_id>` from it,
    so a `subject_key` (16 hex chars) would fit and a title would not. `c12` is
    what `concerns._mint` produces.
    """
    rule_id = str(concern.get("id") or "").strip()
    title = " ".join(str(concern.get("title") or "").split())
    return f"[{rule_id}] {title}".strip()


async def _accepts_description(hass: Any, entity_id: str) -> bool:
    """Does this to-do list accept a description on an item?

    ⚠️ FALSE WHEN THE ANSWER CANNOT BE READ, WHICH IS THE SAFE DIRECTION. A
    missing description makes a job terser; a rejected one makes the job not
    exist. Guessing "yes" is how the reference villa's every task would have
    been lost, so an unreadable state degrades to the shape that always works.
    """
    try:
        states = await hass.command("get_states")
        for row in states or ():
            if not isinstance(row, Mapping):
                continue
            if str(row.get("entity_id")) != entity_id:
                continue
            attrs = row.get("attributes")
            features = int((attrs or {}).get("supported_features") or 0) \
                if isinstance(attrs, Mapping) else 0
            return bool(features & DESCRIPTION_FEATURE)
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow(f"could not read the features of {entity_id}", err)
    return False


async def complete_items(session: Any, concern_ids: Sequence[str], *,
                         config: Optional[Mapping[str, Any]] = None
                         ) -> Tuple[int, bool]:
    """Tick the job of every alert named. Returns (ticked, failed). NEVER RAISES.

    ⚠️ THE ONE PLACE A JOB IS TICKED OFF, because there are now two callers and
    they must not each grow their own: the Done button ticks ONE, and
    `reconcile_settled` ticks every job whose alert has been settled elsewhere.
    A second implementation is how the bracket join, the status filter and the
    service call drift apart.

    ⚠️ ONE LIST READ FOR THE WHOLE SET. The sweep passes every settled alert the
    villa has ever had, so asking Home Assistant per id would put a round trip
    on the clock for each one; the OPEN items are the small side, and the
    intersection is done here.

    ⚠️ FOUND BY ITS BRACKET, the same join every other reader uses —
    `ledger.TASK_PREFIX`, written by `summary_for`, parsed by
    `ledger.todo_tasks`. Matching on the title would break the moment one is
    edited.

    ⚠️ (ticked, failed) RATHER THAN A COUNT, because "nothing to tick" and "the
    tick was refused" need opposite answers from `_done` — see its docstring.
    """
    from vesta.adapters import ledger as ledger_mod
    from vesta.adapters.hass import HassClient

    wanted = {str(i) for i in concern_ids if str(i or "").strip()}
    entity_id = list_for(config)
    if not entity_id or session is None or not wanted:
        return 0, False
    ticked = 0
    try:
        async with HassClient(session) as hass:
            open_items = await ledger_mod.todo_tasks(hass, [entity_id],
                                                     status="needs_action")
            for item in open_items:
                if str(item.get("rule_id") or "") not in wanted:
                    continue
                uid = str(item.get("uid") or "")
                if not uid:
                    continue
                await hass.command(
                    "call_service", domain="todo", service="update_item",
                    target={"entity_id": entity_id},
                    service_data={"item": uid, "status": "completed"})
                ticked += 1
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not tick a job off the list", err)
        return ticked, True
    return ticked, False


async def reconcile_settled(session: Any, *,
                            config: Optional[Mapping[str, Any]] = None) -> int:
    """Tick the job of every alert that has been SETTLED. Returns how many.

    ⚠️ THE OTHER DIRECTION OF `reconcile_done`, AND IT WAS MISSING (2026-08-28,
    the owner's ruling after it was reported). A ticked job marked its alert
    seen; a settled alert did nothing to its job, and `actions._done` was the
    only thing in the tree that ever ticked one. So a thumbs-down — which
    DISMISSES the alert — left work on the facility manager's list for ever,
    with no alert behind it and nobody able to say where it came from. Same for
    an alert superseded by the next one about the same subject, and for one the
    verification sweep found had come right on its own.

    ⚠️ ONE SWEEP RATHER THAN A CALL AT EACH SITE, and that is the whole reason
    it is here. Five paths settle an alert (a thumb, a dismissal on the tablet,
    a supersede, the verification sweep, an expiry) and adding a tick to each is
    the shape of defect this subsystem produced three times in one day — one
    rule, applied at the call sites somebody happened to be looking at. Asking
    the STORE what is settled covers every path, including ones not yet written.

    ⚠️ NATURALLY IDEMPOTENT: it only ever reads items that are still open, so a
    job ticked on an earlier pass is not seen again, and a job somebody REOPENS
    is ticked once more — which is correct, its alert is still settled.
    """
    from vesta.supervise.agent import concerns as concerns_mod

    settled = [str(row.get("id") or "") for row in concerns_mod.read()
               if str(row.get("state") or "") in concerns_mod.SETTLED]
    ticked, _failed = await complete_items(session, settled, config=config)
    if ticked:
        stage("task", f"{ticked} job(s) ticked off — their alert was settled")
    return ticked


async def reconcile_done(session: Any, *,
                         config: Optional[Mapping[str, Any]] = None,
                         now: Optional[float] = None) -> int:
    """Close the alert behind every job somebody has already ticked. Returns
    how many were closed. NEVER RAISES.

    ⚠️ TWO "DONE" BUTTONS DID TWO DIFFERENT THINGS, AND THE PHONE'S DID LESS
    (2026-08-28, reported: "Can you confirm that if i click on Done, it will do
    exactly the same as if i click on Done in the Jobs tab?"). It did not.
    `AgentTodo.finish` completes the item AND acknowledges the alert, which is
    what takes the card off the Reason tab and stops the chase. The Telegram
    button — `vesta_task_actions.yaml`'s "Done - complete the item the tablet
    ticks" — only set the item to `completed`. ⚠️ THAT BUTTON NO LONGER EXISTS:
    the blueprint went inert hours later when job notifications were removed.
    This function outlived its original cause and is MORE needed without it —
    it is now the only thing that ENDS an alert when somebody ticks the item in
    Home Assistant's own panel, or by voice. So a facility manager who did
    the work and pressed Done on their phone left the concern unacknowledged:
    still on the wall, still counted as awaiting a person, and if it were
    critical, still being chased for work already finished. That is the exact
    failure the Jobs tab was built to remove, reachable from the other end.

    ⚠️ FIXED HERE RATHER THAN IN THE BLUEPRINT, AND THAT IS THE WHOLE DESIGN
    CHOICE. The blueprint is hand-delivered and needs re-importing to change, so
    a fix there reaches only a villa whose owner remembers to do it. More
    importantly, it would fix ONE button: ticking the item in Home Assistant's
    own to-do panel, or from a voice assistant, or from any other client, would
    still leave the concern standing. "The job is done" is a fact about the
    LIST, so it is read from the list — one rule, however the tick arrived.

    ⚠️ IT ACKNOWLEDGES, IT DOES NOT CLOSE. Acknowledging says a person has this;
    closing says the villa's problem is over, and only the condition clearing
    can say that (`concerns.acknowledge`'s own docstring is emphatic). A ticked
    job means somebody dealt with the work, not that the pump stopped
    misbehaving.
    """
    from vesta.supervise.agent import concerns as concerns_mod
    from vesta.adapters import ledger as ledger_mod
    from vesta.adapters.hass import HassClient

    entity_id = list_for(config)
    if not entity_id or session is None:
        return 0
    try:
        async with HassClient(session) as hass:
            done = await ledger_mod.todo_tasks(hass, [entity_id],
                                               status="completed")
    except Exception as err:  # noqa: BLE001 - a reconciliation is not worth a pass
        swallow("could not read which jobs have been ticked", err)
        return 0

    # ⚠️ THE BRACKET IS THE JOIN, and it is the same one `summary_for` writes.
    # (It was also what the blueprint's Done matched on, until that went inert.) `todo_tasks` has already
    # parsed it into `rule_id`, so nothing here re-implements the parse.
    ticked = {str(t.get("rule_id") or "") for t in done}
    ticked.discard("")
    if not ticked:
        return 0

    marked = 0
    for row in concerns_mod.read():
        if str(row.get("id")) not in ticked:
            continue
        if str(row.get("acknowledged_at") or "").strip():
            continue
        if not str(row.get("delivered_at") or "").strip():
            # Nobody was told, so there is nothing to acknowledge — and
            # `acknowledge` would happily stamp it, which would stop a chase
            # that was never going to start and hide the row from the wall.
            continue
        # ⚠️ THE SAME ACT AS PRESSING ✅, NOT A LESSER ONE (2026-08-29,
        # reported: "I checked the item in Home Assistant … nothing has been
        # modified in the Reason tab and in the Telegram message"). This used
        # to acknowledge and stop there, which was right while Done was two
        # separate things; since ✅ became tick + record + settle, an
        # acknowledgement alone left the alert OPEN — so it kept its buttons on
        # the phone and its row in the briefing, and the three surfaces
        # disagreed about an item the owner had plainly finished.
        #
        # ⚠️ THROUGH `actions.apply`, WHICH IS THE WHOLE POINT OF THAT MODULE:
        # ticking in Home Assistant, pressing the button on the phone and
        # pressing it on the tablet are now one implementation. A local
        # `transition` here would be a fourth way to end an alert, and the
        # first to fall behind. It also logs `action: cNN done by …`, so the
        # trace reads the same whichever surface did it.
        #
        # ⚠️ AND THE TICK INSIDE IT IS A NO-OP, DELIBERATELY REACHED. `_done`
        # completes the item first; this one is already completed, so it is not
        # among the open rows and the act proceeds to the settle. Cheaper to let
        # that happen than to add a "skip the tick" flag nobody else needs.
        from vesta.supervise.agent import actions as actions_mod
        outcome = await actions_mod.apply(session, "done", str(row.get("id")),
                                          by="the job was ticked",
                                          config=config, now=now)
        marked += 1 if outcome.ok else 0
    if marked:
        stage("task", f"{marked} alert(s) closed — their job was ticked")
    return marked


async def raise_for(session: Any, concern: Mapping[str, Any], *,
                    config: Optional[Mapping[str, Any]] = None) -> str:
    """Create the facility manager job and announce it. `raised | off | failed`.

    ⚠️ NEVER RAISES. It is called from the delivery sweep, which runs on a
    background clock; an exception here would take supervision down for the life
    of the process, and the concern has already reached the person either way.
    A task that could not be created is strictly less bad than that.
    """
    entity_id = list_for(config)
    if not entity_id:
        return "off"

    rule_id = str(concern.get("id") or "").strip()
    summary = summary_for(concern)
    if not rule_id or not summary:
        # ⚠️ A CONCERN WITH NO ID CANNOT BE TICKED OFF, so it must not become a
        # job. Refusing is honest; writing an item no button can ever complete
        # is a job that stays open forever and looks like nobody did it.
        return "failed"

    try:
        from vesta.adapters.hass import HassClient
        async with HassClient(session) as hass:
            # ⚠️ THE BODY GOES IN THE DESCRIPTION, NOT THE SUMMARY. A todo
            # summary is one line on a phone and in the Facility Manager list;
            # the evidence belongs where it can be read without truncating the
            # bracket every reader of this item joins on.
            #
            # ⚠️ BUT ONLY WHERE THE LIST ACCEPTS ONE — see DESCRIPTION_FEATURE.
            # The ITEM is what the loop needs; the description is what makes it
            # readable. Dropping the second to keep the first is the right
            # trade, and sending it blind cost the whole job on the commonest
            # list in Home Assistant.
            fields = {"item": summary}
            body = str(concern.get("body") or "")
            if body and await _accepts_description(hass, entity_id):
                fields["description"] = body
            await hass.command(
                "call_service", domain="todo", service="add_item",
                target={"entity_id": entity_id}, service_data=fields)
            # ⚠️ NO EVENT IS FIRED ANY MORE, AND THAT IS THE WHOLE
            # SIMPLIFICATION (2026-08-28, owner's ruling: "shall we consider
            # the Concern as an alert, and never send notification on what we
            # are calling jobs now?"). Firing `vesta_task_event` is what woke
            # `vesta_task_actions.yaml`, which then messaged the facility
            # manager, re-asked at 15 minutes and escalated to the owner at 45.
            # So ONE finding produced TWO notifications on TWO ladders — the
            # add-on chasing the concern and a blueprint chasing the to-do item
            # — and acknowledging one did not stop the other.
            #
            # ⚠️ IT DISSOLVES THAT DEFECT RATHER THAN FIXING IT. With nothing
            # fired, the blueprint never triggers: its ladder, its buttons and
            # its escalation stop existing, and the concern's own ladder is the
            # only one left. A bug you cannot express is better than a bug you
            # remembered to handle.
            #
            # ⚠️ THE ITEM IS STILL CREATED — the record survives, only the
            # announcement goes. The concern is the alert; this is the work,
            # and it is read from the To-Do List under Act & Tell, from Home
            # Assistant's own
            # to-do panel, and from the daily digest in `digest.py`.
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow(f"could not raise a facility manager task for {rule_id}", err)
        return "failed"

    stage("task", f"raised {summary!r} on {entity_id}")
    return "raised"


# ⚠️ `status()` WAS DELETED HERE, AND IT WAS MINE — written in 2.763.0 "for the
# settings screen" and never wired to one. Nothing called it for three releases.
# dry-audit Part 2's rule is that an instrument whose question nothing asks is
# not neutral: it rots until somebody reads it as meaning something.
#
# The question it was meant to answer — "is the loop switched on" — already has
# a better answer: the field on Act & Tell shows the configured list, and an
# empty one IS the off state. A second reporter of the same fact is the drift
# this repository keeps paying for.
