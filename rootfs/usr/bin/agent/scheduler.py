"""The triage clock. What makes unattended supervision possible at all.

⚠️ WITHOUT THIS, THE CONCERN STORE FILLS ONLY WHEN SOMEBODY ASKS. The whole
point of supervision is that it accumulates evidence while nobody is watching.
Triage existed and nothing called it, so the store stayed empty and the
emptiness looked like a quiet villa, which is the failure this subsystem keeps
rediscovering in new places.

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

⚠️ THE MODE IS **NOT** ONE OF THOSE GUARDS, AND THIS DOCSTRING ONCE LISTED IT
AS ONE UNTIL /dry-audit CHECKED. Triage runs in every mode — the evidence has
to accumulate somehow. What the mode decides happens LATER: "ask" holds the
investigation for approval (`reason.follow_up`), and "observe" stamps any
concern informational so it is told once and never chased (`tools/concern`).
A guard here would make the store fill only when somebody asked, which is the
defect this module was written to fix.
"""

from __future__ import annotations

import asyncio
import time

from typing import Final, Any, Callable, Mapping, Optional

from agent import audit
from agent import budget as budget_mod
from agent import config as agent_config
from agent import reason as reason_mod
from agent import route as route_mod
from agent import triage as triage_mod
from reports import store
from reports.log import log, pass_scope, stage, swallow, warn

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
    off, trigger disabled, over budget, no provider, and nothing to escalate
    all look identical from outside, and four of them are fine.

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
    cfg_now = agent_config.view(config)
    # ⚠️ ONE INSTANT FOR THE WHOLE CHECK, minted here and used by BOTH the row
    # below and every flag `reason.follow_up` records. `_ident` builds a flag id
    # as `f"{trigger}{int(now)}-e{N}"`, so sharing `now` is what makes the check
    # id a strict prefix of its flags' ids. Without it the two were joinable
    # only by comparing timestamps, which is a guess that goes wrong exactly
    # when two checks overlap — the case a manual check beside the clock creates.
    started = time.time()
    check_id = f"{trigger}{int(started)}"
    try:
        reason = await _run_once(session, config=config, provider=provider,
                                 document=doc, trigger=trigger, now=started)
    except Exception:
        # ⚠️ RECORD, THEN RE-RAISE. run_forever swallows and logs; without this
        # the one outcome an operator most needs to see is the one absent from
        # the trace.
        audit.record_pass(reason="raised", trigger=trigger,
                          doc_chars=len(doc), doc_lines=doc.count("\n") + 1,
                          escalated=0, run_id=check_id,
                          mode=str(cfg_now.get("mode") or ""))
        raise
    if reason.startswith("escalated "):
        head, _, subjects = reason.partition(": ")
        try:
            escalated = int(head.split()[1])
        except (IndexError, ValueError):
            escalated = 1
    audit.record_pass(reason=reason, trigger=trigger, doc_chars=len(doc),
                      doc_lines=doc.count("\n") + 1, escalated=escalated,
                      subjects=subjects, run_id=check_id,
                      mode=str(cfg_now.get("mode") or ""),
                      model=str(cfg_now.get("model_triage", "")))
    return reason


async def _run_once(session: Any, *, config: Optional[Mapping[str, Any]] = None,
                    provider: Any = None, document: str = "",
                    trigger: str = "scheduled",
                    now: Optional[float] = None) -> str:
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
                                  config=config, session=session,
                                  trigger=trigger)
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
        config=config, session=session, trigger=trigger, now=now)

    subjects = ", ".join(e.subject for e in result.escalations[:3])
    # ⚠️ THE CLAUSE GOES BEFORE THE COLON, and `Followup.clause` may not contain
    # one. `run_once` recovers the escalated COUNT from `head.split()[1]` and the
    # SUBJECTS from everything after the first ": ", so a clause appended at the
    # end would be filed as part of the subject list — the audit row lying about
    # what was escalated, in the record the cutover is read from.
    return (f"escalated {len(result.escalations)} "
            f"({follow.clause()}): {subjects}")


#: When a pass last ran, on disk. ⚠️ ON DISK AND NOT IN MEMORY, WHICH IS THE
#: WHOLE POINT — the loop below runs a pass BEFORE its first sleep, so every
#: process start fired one regardless of how recently the last had run. On the
#: reference villa that turned a 360-minute cadence into TEN passes in twelve
#: hours during a day of add-on updates, and four of them escalated into eleven
#: frontier-model investigations at ~$0.37 each. The cadence is a promise about
#: how often the model is asked; a restart must not be able to break it.
PASS_FILE: Final[str] = f"{store.DATA_DIR}/vesta/triage-clock.json"


def _last_pass_at() -> float:
    """Epoch seconds of the last pass, or 0.0 when there has never been one."""
    raw = store.read_json(PASS_FILE, {})
    try:
        return float(raw.get("at") or 0.0) if isinstance(raw, dict) else 0.0
    except (TypeError, ValueError):
        return 0.0


def _record_pass(now: float) -> None:
    """⚠️ WRITTEN EVEN WHEN THE PASS DECLINED. A pass that was refused by the
    budget or found nothing still consumed its slot; recording only the ones
    that did work would let a declining villa retry every restart forever."""
    try:
        store.write_json(PASS_FILE, {"at": float(now)})
    except Exception as err:  # noqa: BLE001 - a clock note is not worth a pass
        swallow("could not record the triage clock", err)


def due_in(minutes: float, now: Optional[float] = None,
           last: Optional[float] = None) -> float:
    """Seconds to wait before the next pass. Never negative, never > one period.

    ⚠️ CLAMPED AT THE TOP TOO. A clock that jumps BACKWARDS — an NTP correction
    after a power cut, which is exactly when a villa restarts — would otherwise
    compute a wait of days from a `last` in the future and silence supervision
    until somebody noticed.
    """
    period = max(0.0, minutes) * 60.0
    if period <= 0:
        return 0.0
    seen = _last_pass_at() if last is None else last
    if seen <= 0:
        return 0.0                      # never run: go now, as before
    elapsed = (time.time() if now is None else now) - seen
    return max(0.0, min(period, period - elapsed))


async def chase_forever(session: Any,
                        config_source: Optional[Callable[[], Mapping[str, Any]]]
                        = None) -> None:
    """The chase clock. Never exits except on cancellation.

    ⚠️ THE LADDER HAD NO CLOCK OF ITS OWN AND ITS BANDS ARE IN MINUTES. The
    escalation sweep's only caller was the tail of a triage pass, so on this
    property — checking every 360 minutes — a 15-minute band was evaluated up to
    six hours late, while the concern card promised a time. It went unnoticed
    because the reference villa had nobody in the facility manager role, and
    that branch skips the bands entirely and escalates at once; adding one is
    what makes the clock start mattering, and the owner adding one is what
    surfaced this.

    ⚠️ IT RUNS `dispatch`, NOT JUST THE ESCALATION SWEEP, and that is a feature
    rather than a shortcut. `dispatch` also releases concerns HELD for quiet
    hours and reconciles jobs somebody has ticked — both are time-sensitive in
    exactly the same way and both were waiting on the same six-hour clock. It
    asks no model and spends nothing; the whole function is store reads plus a
    notify call when something is genuinely due.

    ⚠️ SEPARATE TASK, NOT FOLDED INTO `run_forever`. That loop deliberately
    sleeps out the remainder of a cadence period and `continue`s, so anything
    sharing it inherits the triage cadence — which is the bug. Two rhythms, two
    tasks, and the master switch is read per tick by both.
    """
    log(f"chase clock started ({route_mod.SWEEP_MINUTES} min)")
    while True:
        try:
            config = config_source() if config_source else None
            # ⚠️ THE MASTER SWITCH IS ASKED HERE TOO. A villa with supervision
            # off must not have its concerns chased by a second loop that never
            # heard about it.
            if agent_config.view(config).get("enabled"):
                with pass_scope("chase"):
                    carried = await dispatch(session, config=config)
                    if carried:
                        log(f"outcome:{carried}")
                    # ⚠️ THE DAILY DIGEST RIDES THIS TICK RATHER THAN A FOURTH
                    # TASK. It is due at most once a local day and decides that
                    # itself from a stamp on disk, so all this loop provides is
                    # somewhere to ask often enough that "once a day" lands on
                    # the right day. A task of its own would be a fifth loop to
                    # start, stop and forget to cancel.
                    from agent import digest as digest_mod
                    said = await digest_mod.send_daily(session, config=config)
                    if said.startswith("sent "):
                        log(f"digest: {said}")
        except asyncio.CancelledError:
            log("chase clock stopped")
            raise
        except Exception as err:  # noqa: BLE001 - degrade, never fail
            swallow("chase sweep failed", err)
        await asyncio.sleep(max(1.0, route_mod.SWEEP_MINUTES * 60.0))


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
                # ⚠️ WAIT OUT WHATEVER IS LEFT OF THE PERIOD FIRST. See
                # PASS_FILE — a restart used to reset the cadence to zero.
                remaining = due_in(minutes)
                if remaining > 0:
                    # ⚠️ `clock:`, NOT `triage:`. This line is about the
                    # CADENCE and the tier below is about the model; sharing a
                    # prefix put two unrelated facts in one grep and made the
                    # trace's own tier names ambiguous.
                    log(f"clock: {remaining / 60:.0f} min left of the current "
                        f"period, not starting a pass")
                    await asyncio.sleep(remaining)
                    continue
                _record_pass(time.time())
                # ⚠️ THE SCOPE WRAPS THE WHOLE PASS, NOT `run_once`. Delivery
                # and escalation happen AFTER the model is done, and a trace
                # that stopped at the model would cut off exactly the half a
                # first end-to-end test is run to see.
                with pass_scope("scheduled"):
                    outcome = await _pass(session, config)
                    if outcome:
                        # ⚠️ `outcome:` — this is the verdict of the WHOLE pass
                        # (triage, then reasoning, then both delivery sweeps),
                        # not of the triage tier, which reports itself.
                        log(f"outcome: {outcome}")
        except asyncio.CancelledError:
            log("triage scheduler stopped")
            raise
        except Exception as err:  # noqa: BLE001 - degrade, never fail
            swallow("triage pass failed", err)
            wait = RETRY_S
        await asyncio.sleep(wait)


#: A document this short cannot be about a villa. ⚠️ THE NUMBER IS A MEASUREMENT,
#: NOT A TASTE: the empty-property document that stopped TASK-051 for a whole
#: shadow period was 480 characters, and it was well-formed — which is exactly
#: why nobody caught it. A profile naming real rooms and devices does not fit in
#: a kilobyte, so anything under one is a document about nothing.
THIN_DOCUMENT_CHARS: Final[int] = 1000


def describe_document(document: str) -> None:
    """Say what the model is about to be asked to read.

    ⚠️ THE TIER THAT HAD NO VOICE AT ALL. Its size reached the audit row and
    nothing else, so the add-on log — the instrument every field diagnosis in
    this project has actually been made from — could not distinguish a quiet
    villa from a villa the agent could not see. That is not hypothetical: the
    agent WAS blind for an entire observation period on `doc=480c/15L`, and the
    verdict read as a verdict on the agent rather than on its input.

    ⚠️ AND IT JUDGES, IT DOES NOT ONLY MEASURE. A number nobody has a threshold
    for is a number nobody reads; `WARNING` is what makes a thin document
    arrive as a fault rather than as a statistic somebody might notice.
    """
    chars, lines = len(document), document.count("\n") + 1
    stage("document", f"{chars} chars, {lines} lines")
    if chars < THIN_DOCUMENT_CHARS:
        warn(f"the villa document is {chars} chars — too thin to be about a "
             "villa; triage is about to run effectively blind")


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
    # ⚠️ AND WHAT EACH ENTITY MEASURES, ON THE SAME CLOCK AND FOR THE SAME
    # REASON (2026-08-28). `flagtypes` groups a finding by its measurement
    # and direction rather than by its device, so it needs each entity's
    # `device_class` and unit — facts that change when somebody
    # re-configures a device, not every pass. Deliberately NOT in the
    # journal: that ring is rewritten 96 times a day and its own header
    # puts the burden of proof on any addition.
    await sources.refresh_measures(session)
    # ⚠️ AND THE UPSTREAM TOOL CATALOGUE, ON THE SAME CLOCK (ADR-023). Home
    # Assistant's own MCP server is where HA reads come from; its tool list
    # changes when somebody updates that add-on, not every pass, so this does
    # nothing on all but one pass a day exactly like the two lines above.
    from agent import upstream as upstream_mod
    await upstream_mod.refresh(session, config=config)

    try:
        document = sources.build_document()
    except Exception as err:  # noqa: BLE001
        warn(f"triage could not assemble the villa document: {err}")
        document = f"The villa document could not be assembled: {err}"
    describe_document(document)

    provider = anthropic_sdk.build(
        api_key=reports_secrets.get("anthropic") or "")
    outcome = await run_once(session, config=config, provider=provider,
                             document=document)
    return outcome + await dispatch(session, config=config)


async def dispatch(session: Any,
                   *, config: Optional[Mapping[str, Any]] = None) -> str:
    """Carry whatever is waiting to the people it is for. Never raises.

    ⚠️ EXTRACTED IN 2.768.0 BECAUSE THE BUTTON DID NOT DO IT. These two sweeps
    were the tail of `_pass`, so `outbox.sweep` had exactly ONE caller — the
    scheduled clock. "Check the villa now" calls `run_once` directly, so a pass
    an owner STARTED HIMSELF could mint a concern, record it, show it on the
    tablet, and carry it to nobody: no Telegram message and no facility manager
    job until the six-hourly clock came round. Both halves were correct and
    nothing joined them, which is this repository's most-repeated defect
    (`feedback_two-correct-halves`) and was found by asking what a first
    end-to-end test would actually prove.

    ⚠️ SAFE TO CALL ON A PASS THAT ESCALATED NOTHING, and that is why it is
    unconditional rather than guarded on the outcome. Both sweeps read the
    concern store, not the pass — a concern HELD for quiet hours is released by
    a LATER sweep finding the window closed, and that later sweep only exists
    if this runs every time. Holding a concern and never looking again is
    "held until morning" meaning "dropped".
    """
    from agent import concerns as concerns_mod
    from agent import outbox as outbox_mod

    # ⚠️ A THIRD SWEEP, AND IT RUNS FIRST BECAUSE IT IS THE ONLY ONE THAT CAN
    # CHANGE WHAT THE OTHER TWO SEE. A closed concern whose condition came back
    # returns to `open`, and a delivery sweep that had already passed over it
    # would not look again until the next clock. Ordering it here costs
    # nothing: it writes at most a handful of rows and asks no model.
    #
    # ⚠️ IT LIVES ON THIS CLOCK RATHER THAN A NEW ONE FOR THE REASON THIS
    # FUNCTION EXISTS AT ALL — `dispatch` is the one place reached by ALL THREE
    # entry points: the scheduled clock (`_pass`), the owner's own "Check the
    # villa now", and the pipeline drill. A sweep wired into `_pass` instead
    # would be a verification an owner could never trigger, which is the exact
    # shape of the defect that produced this function in 2.768.0.
    #
    # ⚠️ THE DRILL REACHING IT IS WHAT MAKES THIS OBSERVABLE ON A LIVE VILLA,
    # and it is the only thing that does. The watch window is a week, so a
    # freshly-installed build has nothing to judge for seven days; firing a
    # drill runs the sweep on demand and prints its line if anything was due.
    # Without that, the first evidence this ever ran would arrive a week after
    # release, which is not a test — it is a wait.
    #
    # ⚠️ AND IT IS DELIBERATELY NOT GATED ON THE PASS HAVING FOUND ANYTHING.
    # Verification is a question about concerns closed a WEEK ago; whether
    # tonight's pass concluded anything has no bearing on it.
    held = concerns_mod.verification_sweep()
    out_verify = (f" | verify: {held.line()}" if held.changed() else "")

    # ⚠️ A TICKED JOB COUNTS AS "SOMEBODY HAS THIS", HOWEVER IT WAS TICKED, and
    # it runs BEFORE the escalation sweep below so a job finished on a phone
    # stops the chase in the same pass rather than the next one. See
    # `task.reconcile_done` for why this is not a blueprint change.
    from agent import task as task_mod
    await task_mod.reconcile_done(session, config=config)

    # ⚠️ NEVER RAISES — `sweep` returns a typed result on every path, because
    # one of its two callers is a background clock nobody is watching.
    sent = await outbox_mod.sweep(session, config=config)
    out = f" | outbox: {sent.line()}" if (sent.sent or sent.held
                                          or sent.failed) else ""

    # ⚠️ A SECOND SWEEP, AND IT IS NOT THE SAME SWEEP (TASK-112). The first asks
    # "what has never been sent"; this asks "what was sent and nobody has picked
    # up", which is the question `route.escalate` was written for and which
    # nothing asked for the whole of its existence — REQ-033 was unmet not
    # because escalation was wrong but because it had no caller.
    #
    # ⚠️ RUN AFTER, NEVER MERGED INTO THE FIRST. A concern delivered by the
    # sweep above is zero minutes old and inside the first band, so ordering
    # them this way costs nothing; merging them would mean one loop deciding
    # both "send" and "send again", and the second is the one that must be able
    # to stand down.
    escalated = await outbox_mod.escalation_sweep(session, config=config)
    if escalated.sent or escalated.failed:
        out += f" | escalation: {escalated.line()}"
    return out_verify + out
