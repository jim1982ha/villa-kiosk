"""The triage clock. What makes an unattended shadow period possible at all.

⚠️ WITHOUT THIS, SHADOW MODE FILLS ONLY WHEN SOMEBODY ASKS. The whole point of
a shadow period is that it accumulates evidence while nobody is watching — and
the PH-3 checkpoint cannot happen until it has. Triage existed and nothing
called it, so the store stayed empty and the emptiness looked like a quiet
villa, which is the failure this subsystem keeps rediscovering in new places.

⚠️ IT IS A FOURTH TASK IN THE SAME LOOP, not a fourth s6 service. The reports
scheduler, the collector and the observation cycle already prove the pattern; a
supervised service would be another thing to start, stop, watch and
misconfigure for no benefit.

⚠️ THE CADENCE IS RE-READ EVERY PASS, never captured at start-up — the same rule
`observe/cycle.py` states. An operator who lowers the cadence because the bill
is climbing should not have to restart the add-on to be listened to.

⚠️ AND EVERY GUARD IS ASKED PER PASS, IN COST ORDER: switched off, then the
trigger, then the budget, then the provider — each refusing before the next
costs anything. A scheduler that checked the budget after calling the model
would discover it was over the limit by going over it.

⚠️ SHADOW IS **NOT** ONE OF THOSE GUARDS, AND THIS DOCSTRING LISTED IT AS ONE
UNTIL /dry-audit CHECKED. Triage running during a shadow period is the entire
point — the evidence has to accumulate somehow — and a guard here would have
made the shadow store fill only when somebody asked, which is the defect this
module was written to fix. Shadow suppresses DELIVERY, in `route.plan`, and
nowhere else.
"""

from __future__ import annotations

import asyncio

from typing import Any, Callable, Mapping, Optional

from agent import audit
from agent import budget as budget_mod
from agent import config as agent_config
from agent import reason as reason_mod
from agent import triage as triage_mod
from reports.log import log, swallow, warn

#: How long to wait after a failed pass before trying again. ⚠️ NOT THE
#: CADENCE: a villa whose provider is down should not retry every fifteen
#: minutes for a day, and a villa whose config is simply off should cost
#: nothing at all.
RETRY_S: float = 300.0

#: The one trigger with no config flag — see `_run_once`. A person with owner
#: rights pressing a button is the authorisation; there is nothing to look up.
MANUAL: str = "manual"

#: The floor on how often triage may run, whatever config says. ⚠️ A GUARD
#: AGAINST A TYPO, not a policy. `triage_minutes: 1` is ninety-six times the
#: intended spend, and a misplaced digit should not be able to bill a month in
#: an afternoon.
MIN_MINUTES: float = 5.0


def _cadence(config: Optional[Mapping[str, Any]]) -> float:
    cfg = agent_config.view(config)
    try:
        minutes = float(cfg.get("triage_minutes") or 0)
    except (TypeError, ValueError):
        return 0.0
    return max(minutes, MIN_MINUTES) if minutes > 0 else 0.0


async def run_once(session: Any, *, config: Optional[Mapping[str, Any]] = None,
                   provider: Any = None, document: str = "",
                   trigger: str = "scheduled") -> str:
    """One triage pass, with every guard. Returns why it stopped, for the log.

    ⚠️ IT RETURNS A REASON RATHER THAN A BOOLEAN. "Nothing happened" has five
    causes here and they need different responses from an operator — switched
    off, shadowed, over budget, no provider, and nothing to escalate all look
    identical from outside, and four of them are fine.

    ⚠️ AND EVERY ONE OF THOSE OUTCOMES IS NOW WRITTEN DOWN, BY CONSTRUCTION.
    The reason was precise from the day this was written and went only to the
    add-on log, so a reader deciding the PH-3 cutover saw "the agent found
    nothing" with no way to tell a quiet pass from a pass that never happened.
    The guards are in `_run_once`, which has SIX return points; recording at
    each of them is one edit away from a sixth blind spot forever, so the
    recording lives HERE, wrapped around it, and a new guard cannot escape it.
    """
    doc = document or ""
    escalated, subjects = 0, ""
    try:
        reason = await _run_once(session, config=config, provider=provider,
                                 document=doc, trigger=trigger)
    except Exception:
        # ⚠️ RECORD, THEN RE-RAISE. run_forever swallows and logs; without this
        # the one outcome an operator most needs to see is the one absent from
        # the trace.
        audit.record_pass(reason="raised", trigger=trigger,
                          doc_chars=len(doc), doc_lines=doc.count("\n") + 1,
                          escalated=0)
        raise
    if reason.startswith("escalated "):
        head, _, subjects = reason.partition(": ")
        try:
            escalated = int(head.split()[1])
        except (IndexError, ValueError):
            escalated = 1
    audit.record_pass(reason=reason, trigger=trigger, doc_chars=len(doc),
                      doc_lines=doc.count("\n") + 1, escalated=escalated,
                      subjects=subjects,
                      model=str(agent_config.view(config).get("model_triage", "")))
    return reason


async def _run_once(session: Any, *, config: Optional[Mapping[str, Any]] = None,
                    provider: Any = None, document: str = "",
                    trigger: str = "scheduled") -> str:
    """The guards themselves. Wrapped by run_once, which records the outcome.

    ⚠️ THE TRIGGER IS ASKED ABOUT ITSELF, NOT ABOUT THE CLOCK. This gate read
    `trigger_enabled(config, "scheduled")` whatever had actually started the
    pass, so switching the SCHEDULE off also disabled the owner's own "Run a
    check now" button — and reported it as `scheduled trigger disabled`, which
    is a true sentence about a switch the presser did not touch.

    ⚠️ AND `manual` IS NOT A CONFIGURABLE TRIGGER, WHICH IS WHY IT IS EXEMPT
    RATHER THAN LOOKED UP. `triggers` ships `{scheduled, event, chat}` and has
    no `manual` key, so `trigger_enabled(config, "manual")` is False by simple
    absence — routing the button through it would have disabled the one control
    an owner uses to test any of this, and reported `manual trigger disabled`
    about a switch that does not exist. Caught before shipping by asking what
    the config actually contains rather than what the lookup implied.

    What still gates a manual run is the master `enabled` switch above, plus the
    route itself, which is owner-only because it spends the budget. A person
    with those rights pressing a button IS the authorisation.
    """
    cfg = agent_config.view(config)
    if not cfg.get("enabled"):
        return "agent disabled"
    if trigger != MANUAL and not agent_config.trigger_enabled(config, trigger):
        return f"{trigger} trigger disabled"

    money = budget_mod.check(config, kind="run")
    if not money.allowed:
        return f"budget: {money.reason}"

    if provider is None or not provider.configured():
        return "no model provider configured"

    # ⚠️ THE TRIGGER TRAVELS. `run_once` already records the PASS under it;
    # without passing it on, the RUN and its spend were filed as "scheduled"
    # whatever actually started them — see `triage.run`.
    result = await triage_mod.run(provider=provider, document=document,
                                  config=config, trigger=trigger)
    if result.status != "answered":
        return f"triage {result.status}: {result.reason}"
    if not result.escalations:
        # ⚠️ A SUCCESSFUL QUIET PASS, AND IT IS SAID DIFFERENTLY FROM A FAILED
        # ONE. `TriageResult.quiet` is only true when the pass SUCCEEDED, and
        # this log line is the human-readable half of that distinction.
        return "nothing to escalate"

    # ⚠️ THE ESCALATIONS ARE FOLLOWED, NOT FORMATTED. This function used to build
    # the sentence below and return — so Tier 2 told Tier 3 nothing, ever, and
    # the two real subjects an owner's pass escalated produced no concern at all.
    # `reason.follow_up` never raises: it is called from a background clock.
    follow = await reason_mod.follow_up(
        result.escalations, provider=provider, document=document,
        config=config, trigger=trigger)

    subjects = ", ".join(e.subject for e in result.escalations[:3])
    # ⚠️ THE CLAUSE GOES BEFORE THE COLON, and `Followup.clause` may not contain
    # one. `run_once` recovers the escalated COUNT from `head.split()[1]` and the
    # SUBJECTS from everything after the first ": ", so a clause appended at the
    # end would be filed as part of the subject list — the audit row lying about
    # what was escalated, in the record the cutover is read from.
    return (f"escalated {len(result.escalations)} "
            f"({follow.clause()}): {subjects}")


async def run_forever(session: Any,
                      config_source: Optional[Callable[[], Mapping[str, Any]]]
                      = None) -> None:
    """The triage clock. Never exits except on cancellation.

    ⚠️ IT TAKES A READER, NOT A VALUE, AND THE FIRST VERSION TOOK A VALUE while
    its own comment explained why that was wrong. A config captured at boot
    freezes the cadence and every kill switch until the add-on restarts — so an
    operator lowering the cadence because the bill is climbing, or reaching for
    the master switch because something is going wrong, would not be listened
    to. Calling the reader per pass costs one small JSON read every fifteen
    minutes.

    ⚠️ CANCELLATION RE-RAISES. aiohttp's shutdown cancels this and waits for
    it; swallowing `CancelledError` holds the whole shutdown open until the
    timeout — the trap `collect.run_forever` and `observe/cycle.py` both
    document, and the third place it would have been re-learned.
    """
    log("triage scheduler started")
    while True:
        config = config_source() if config_source else None
        minutes = _cadence(config)
        wait = RETRY_S if minutes <= 0 else minutes * 60.0
        try:
            if minutes > 0:
                outcome = await _pass(session, config)
                if outcome:
                    log(f"triage: {outcome}")
        except asyncio.CancelledError:
            log("triage scheduler stopped")
            raise
        except Exception as err:  # noqa: BLE001 - degrade, never fail
            swallow("triage pass failed", err)
            wait = RETRY_S
        await asyncio.sleep(wait)


async def _pass(session: Any, config: Optional[Mapping[str, Any]]) -> str:
    """Assemble what a pass needs, then run it. Never raises."""
    from agent import sources
    from agent.llm import anthropic_sdk
    from reports import secrets as reports_secrets

    # ⚠️ THROUGH `sources`, NEVER BY CALLING `snapshot` DIRECTLY. This line read
    # `snapshot.villa_document(profile_text=snapshot.profile(), delta_text=
    # snapshot.delta())` — no arguments, so a well-formed 480-character document
    # about an empty property, on every pass, for the whole shadow period the
    # PH-3 cutover was supposed to be decided from. `sources.build_document` is
    # the wiring; see its module header.
    # ⚠️ BEFORE THE DOCUMENT, AND IT USUALLY DOES NOTHING. It re-surveys the
    # villa's capabilities at most once a day (TASK-108, REQ-005) and returns
    # immediately on every other pass. It is here rather than inside
    # `build_document` because this is the only agent path that HAS a session —
    # the proxy's document preview does not, and must still render.
    await sources.refresh_capabilities(session)
    # ⚠️ THE SAME PLACE, THE SAME CADENCE, AND THE SAME REASON IT IS HERE. The
    # villa's ROOMS were never read at all — the document named none, so asked
    # "how many lights are on in the gym room" the agent answered that the villa
    # has no gym room, about a property whose Home Assistant has a Gym Room area
    # with a light in it. A room list changes when somebody renames a room, so
    # this does nothing on all but one pass a day, exactly like the line above.
    await sources.refresh_layout(session)
    # ⚠️ AND THE UPSTREAM TOOL CATALOGUE, ON THE SAME CLOCK (ADR-023). Home
    # Assistant's own MCP server is where HA reads come from; its tool list
    # changes when somebody updates that add-on, not every pass, so this does
    # nothing on all but one pass a day exactly like the two lines above.
    from agent import upstream as upstream_mod
    await upstream_mod.refresh(session)

    try:
        document = sources.build_document()
    except Exception as err:  # noqa: BLE001
        warn(f"triage could not assemble the villa document: {err}")
        document = f"The villa document could not be assembled: {err}"

    provider = anthropic_sdk.build(
        api_key=reports_secrets.get("anthropic") or "")
    outcome = await run_once(session, config=config, provider=provider,
                             document=document)

    # ⚠️ AFTER THE PASS, EVERY PASS, WHETHER OR NOT IT ESCALATED. The outbox is
    # what carries a Concern to a phone (TASK-106), and it must run on the clock
    # rather than only after a pass that produced something: a concern HELD for
    # quiet hours is released by a later sweep finding the window closed, and
    # that later sweep only exists if this is unconditional. Holding a concern
    # and then never looking at it again is "held until morning" meaning
    # "dropped".
    #
    # ⚠️ AND IT NEVER RAISES — `sweep` returns a typed result on every path,
    # because this is a background clock nobody is watching.
    from agent import outbox as outbox_mod
    dispatch = await outbox_mod.sweep(session, config=config)
    if dispatch.sent or dispatch.held or dispatch.failed:
        outcome = f"{outcome} | outbox: {dispatch.line()}"

    # ⚠️ A SECOND SWEEP, ON THE SAME CLOCK, AND IT IS NOT THE SAME SWEEP
    # (TASK-112). The first asks "what has never been sent"; this asks "what was
    # sent and nobody has picked up", which is the question `route.escalate` was
    # written for and which nothing asked for the whole of its existence —
    # REQ-033 was unmet not because escalation was wrong but because it had no
    # caller, exactly as the degradation ladder did.
    #
    # ⚠️ RUN AFTER, NEVER MERGED INTO THE FIRST. A concern delivered by the
    # sweep above is zero minutes old and inside the first band, so ordering
    # them this way costs nothing; merging them would mean one loop deciding
    # both "send" and "send again", and the second is the one that must be able
    # to stand down.
    escalated = await outbox_mod.escalation_sweep(session, config=config)
    if escalated.sent or escalated.failed:
        outcome = f"{outcome} | escalation: {escalated.line()}"
    return outcome
