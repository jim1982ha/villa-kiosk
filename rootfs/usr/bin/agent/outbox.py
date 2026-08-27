"""The wire from a Concern to a person's phone. TASK-106, REQ-031/033/034.

⚠️ `agent/route.py` WAS IMPORTED BY NOTHING FOR THE WHOLE OF ITS EXISTENCE. The
matrix, the hold-until-morning rule, the escalation bands and `occupancy` were
all written, all tested, and reachable from no shipped code — so a Concern
reached the concern store and the kiosk and stopped there. `TASK-063`'s first
instruction is "turn off shadow; enable delivery", and without this module that
would have enabled delivery to NOBODY: the supervised period would have measured
silence, read as success, and been cited as the evidence for retiring 71 working
blueprint instances.

⚠️ THIS MODULE DECIDES NOTHING. `route.plan` decides the channel, the hold and
the delivery class (an informational concern is told once and asks nothing);
`reports.deliver` does the sending. What lives here is the SWEEP — which
concerns are still owed a delivery, and what to record once one is made. A
second copy of the matrix here would be the routing table nobody tests.

⚠️ ONE SENDER, AND IT IS `reports/deliver.py`. That module already resolves a
target's shape (a classic notify service, an entity on the modern platform, a
Telegram chat id), already handles a Core that is mid-restart, and already logs
each attempt independently. A second sender here is how the briefing and the
alert come to disagree about what a target even is.

⚠️ A HELD CONCERN IS NOT MARKED DELIVERED, AND THAT IS THE WHOLE RELEASE
MECHANISM. "Held until morning" would otherwise mean "dropped": the sweep runs
on the triage clock, so a concern held at 02:00 is simply re-evaluated at every
later sweep and goes out on the first one where the window has passed. There is
no timer, no queue and no scheduled release to get wrong.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence

from agent import concerns as concerns_mod
from agent import config as agent_config
from agent import route as route_mod
from reports.log import stage, swallow, warn

#: How many concerns one sweep may deliver. ⚠️ A BURST GUARD, NOT A POLICY. A
#: villa that has been in shadow for a month has a backlog, and turning delivery
#: on should not put forty notifications on somebody's phone in one second. The
#: rest go on the next sweep, minutes later.
MAX_PER_SWEEP: int = 5


@dataclass
class Dispatch:
    """What one sweep did. Never an exception."""

    considered: int = 0
    sent: int = 0
    held: int = 0
    failed: int = 0
    reason: str = ""
    delivered_ids: List[str] = field(default_factory=list)

    # ⚠️ `suppressed` LEFT WITH SHADOW DELIVERY (2026-08-28). Observe mode now
    # delivers informationally instead of suppressing, so the counter could
    # only ever read 0 — the exact "instrument that lies" shape this project
    # has been caught by five times. Deleted rather than left to be misread.
    def line(self) -> str:
        if self.reason:
            return self.reason
        return (f"considered {self.considered}, sent {self.sent}, "
                f"held {self.held}"
                + (f", failed {self.failed}" if self.failed else ""))


def undelivered(rows: Optional[Sequence[Mapping[str, Any]]] = None
                ) -> List[Dict[str, Any]]:
    """Open concerns that have never been sent anywhere.

    ⚠️ KEYED ON `delivered_at` BEING ABSENT, NOT ON A SEPARATE QUEUE. The
    concern store is already the record; a queue beside it is a second thing to
    keep in step, and the first time they disagree somebody is either spammed or
    told nothing.

    ⚠️ SETTLED CONCERNS ARE NEVER DELIVERED. A concern closed or dismissed
    before the sweep reached it is a concern somebody has already dealt with,
    and sending it afterwards is the alert-fatigue failure in its purest form.
    """
    source = list(rows) if rows is not None else concerns_mod.read()
    return [dict(r) for r in source
            if str(r.get("state") or "open") not in concerns_mod.SETTLED
            and not str(r.get("delivered_at") or "").strip()]


def awaiting_acknowledgement(rows: Optional[Sequence[Mapping[str, Any]]] = None
                             ) -> List[Dict[str, Any]]:
    """Delivered concerns nobody has said "I have seen this" about.

    ⚠️ THE MIRROR OF `undelivered`, AND DELIBERATELY NOT ITS NEGATION. A concern
    that was sent and acknowledged is finished as far as escalation goes; one
    that was sent and SETTLED is also finished, but for a different reason, and
    the sweep needs to tell those apart — a settled one is what `route.escalate`
    calls a cleared condition and it must be allowed to stand down out loud
    rather than simply disappearing from the list.

    ⚠️ AN INFORMATIONAL CONCERN IS NEVER IN THIS LIST. An FYI asks for no
    acknowledgement, so nobody ever gives one — and since this list feeds the
    escalation sweep's `pending[:MAX_PER_SWEEP]` window, permanent residents
    would eventually crowd every real critical out of the first five slots.
    Excluded at the source rather than skipped in the loop, so the starvation
    is impossible by construction.
    """
    source = list(rows) if rows is not None else concerns_mod.read()
    return [dict(r) for r in source
            if str(r.get("delivered_at") or "").strip()
            and not str(r.get("acknowledged_at") or "").strip()
            and not bool(r.get("informational"))]


def _minutes_since(stamp: str, now: Optional[float] = None) -> float:
    """Minutes between an ISO stamp and now. Negative clocks read as 0.

    ⚠️ NEVER RAISES ON A MALFORMED STAMP — it returns 0, which puts the concern
    inside the first band and escalates NOTHING. A parse failure must not be
    able to page the owner at three in the morning.

    ⚠️ THE PARSE ITSELF MOVED TO `concerns.seconds_since` (2026-08-28), beside
    the `_now_iso` that WROTE the stamp. It was a second implementation of one
    format in a second module, which is how the two come to disagree the day
    the format moves. The 0-on-failure contract above is unchanged and is
    restated at the shared owner, together with the reason it is also the safe
    direction for the verification sweep — the second caller.
    """
    return concerns_mod.seconds_since(stamp, now) / 60.0


async def escalation_sweep(session: Any, *,
                           config: Optional[Mapping[str, Any]] = None,
                           now: Optional[float] = None) -> Dispatch:
    """Re-evaluate what nobody has acknowledged. NEVER RAISES.

    ⚠️ RE-EVALUATES, IT DOES NOT COUNT DOWN, and that distinction is the whole
    of ADR-008. A fixed 15/45/90-minute ladder is blind to the two facts that
    decide the answer: whether the condition CLEARED, and whether anybody has
    picked it up. `route.escalate` asks those first and reaches the bands last;
    this function's job is to ask it on a clock, not to reimplement it — a timer
    here would be the ladder coming back through the caller.

    ⚠️ THE CLOCK RUNS FROM DELIVERY, NOT FROM WHEN THE CONCERN WAS OPENED. You
    cannot acknowledge something you were never sent, so counting from
    `opened_at` would escalate a concern that was held through quiet hours the
    moment it finally arrived — punishing the reader for the delay the villa
    chose. `delivered_at` is the first instant at which silence means anything.

    ⚠️ A STAND-DOWN IS LOGGED, NOT SILENT. "The condition cleared and I stopped"
    and "nothing was due" are the same empty result and mean opposite things;
    the first is the branch that earns trust and it has to be visible to have
    earned anything.
    """
    out = Dispatch()
    pending = awaiting_acknowledgement()
    out.considered = len(pending)
    if not pending:
        # ⚠️ SAME RULE AS THE DELIVERY SWEEP. "Nothing is waiting to be chased"
        # is a fact; silence is an unanswered question.
        stage("escalation", "nothing awaiting acknowledgement")
        return out

    cfg = agent_config.view(config)
    if not cfg.get("enabled"):
        out.reason = "the agent is switched off"
        return out

    occupied = await occupancy_now(session)
    stood_down = 0
    #: verdict reason -> how many concerns it accounted for. ⚠️ KEYED BY THE
    #: REASON RATHER THAN COUNTED, because "not critical" and "too recent" are
    #: different answers to "why did nothing happen" and an operator acts on
    #: them differently.
    quiet_reasons: Dict[str, int] = {}
    for row in pending[:MAX_PER_SWEEP]:
        try:
            # ⚠️ SETTLED IS THE CLEARED CONDITION, AND IT IS THE ONE SIGNAL THIS
            # SWEEP HONESTLY HAS. A `Concern` carries no entity id — by design,
            # it hashes to `subject_key` — so nothing here can re-probe the
            # equipment. What it CAN see is that somebody closed, verified or
            # dismissed the concern since it was sent, which is exactly "this
            # resolved without an escalation being needed".
            cleared = str(row.get("state") or "open") in concerns_mod.SETTLED
            verdict = route_mod.escalate(
                minutes_open=_minutes_since(str(row.get("delivered_at") or ""),
                                            now),
                acknowledged=False,
                condition_cleared=cleared,
                severity=str(row.get("severity") or "notice"),
                facility_reachable=_facility_reachable(config),
                guests_present=bool(occupied))
            if not verdict.act:
                if verdict.step == "stand down":
                    stood_down += 1
                    stage("escalation",
                          f"concern {row.get('id')} stood down — "
                          f"{verdict.reason}")
                else:
                    # ⚠️ COUNTED, BECAUSE `considered` MUST RECONCILE. The first
                    # real capture of this tier read `considered 2, sent 0,
                    # held 0, suppressed 0, stood down 0` — five numbers
                    # accounting for none of the two, because a verdict of "only
                    # a critical escalates" or "inside the first band" fell
                    # through every bucket. Both are correct decisions and both
                    # were invisible, so the line could not be told apart from a
                    # sweep that silently dropped two concerns.
                    quiet_reasons[verdict.reason] = \
                        quiet_reasons.get(verdict.reason, 0) + 1
                continue
            # ⚠️ ONE STEP IS TAKEN ONCE. Without this the same band fires on
            # every sweep, five minutes apart, for as long as nobody answers —
            # which is the alert fatigue this whole path exists to prevent,
            # delivered by the mechanism meant to prevent it.
            if str(row.get("escalated_step") or "") == verdict.step:
                continue
            sent = await _escalate_one(session, row, verdict,
                                       config=config, now=now)
            if sent:
                out.sent += 1
                out.delivered_ids.append(str(row.get("id") or ""))
            else:
                out.failed += 1
        except Exception as err:  # noqa: BLE001 - one concern is not the sweep
            swallow(f"could not escalate concern {row.get('id')}", err)
            out.failed += 1

    quiet = ", ".join(f"{n}x {why}" for why, n in sorted(quiet_reasons.items()))
    stage("escalation", f"{out.line()}, stood down {stood_down}"
                        + (f" ({quiet})" if quiet else ""))
    return out


def _facility_reachable(config: Optional[Mapping[str, Any]]) -> bool:
    """Has the facility manager anywhere to be reached AT ALL?

    ⚠️ "CONFIGURED", NOT "AWAKE". This is the only sense of reachable the villa
    can actually check — whether a target exists for the role — and stating that
    is better than a heuristic that guesses at a person's availability. An empty
    list is what sends a critical straight to the owner while guests are in
    residence, which is the branch `route.escalate` was written for.
    """
    try:
        from reports import people as people_mod
        return bool(people_mod.targets_for_role(config, "ops"))
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the facility manager's targets", err)
        return True


async def _escalate_one(session: Any, concern: Mapping[str, Any],
                        verdict: Any, *, config: Optional[Mapping[str, Any]],
                        now: Optional[float]) -> bool:
    """Send one escalation and record which step was taken.

    ⚠️ IT GOES THROUGH `route.plan` LIKE EVERY OTHER DELIVERY. The delivery
    class and quiet hours are decided there — the way to keep every rule true
    is for the path to run THROUGH the module that decides rather than around
    it. An escalation that bypassed it would be the one message that dodged
    the routing table.
    """
    from reports import people as people_mod

    # ⚠️ THE STEP DECIDES THE AUDIENCE, WHICH IS THE WHOLE POINT OF ESCALATING.
    # "add the owner" and "every configured target" both mean people who were
    # not on the first message; resending to the same list would be a louder
    # copy of something already ignored.
    role = "owner" if verdict.step != "resend to the same target" else (
        "ops" if str(concern.get("audience")) == "facility" else "owner")
    targets = people_mod.targets_for_role(config, role)
    if verdict.step == "every configured target, once":
        targets = list(dict.fromkeys(
            list(targets) + list(people_mod.targets_for_role(config, "ops"))))
    if not targets:
        return False

    plan = route_mod.plan(concern, targets=targets, push_targets=targets,
                          occupied=None, quiet_hours=False, profile=role,
                          config=config)
    if not plan.targets:
        return False
    # ⚠️ NOT HELD. `quiet_hours=False` is passed deliberately: an escalation is
    # by definition a critical nobody has picked up, and `route.escalate` has
    # already refused every severity below critical. Holding it overnight is the
    # exact case the whole ladder exists to break.
    from reports import deliver as deliver_mod
    results = await deliver_mod.deliver(
        session, plan.targets, f"Still open: {plan.title}", plan.body)
    if not any(str(r.get("status")) == "sent" for r in results
               if isinstance(r, Mapping)):
        return False
    # ⚠️ THE ESCALATION IS A SEND IN ITS OWN RIGHT, to a profile the first one
    # may not have reached — "add the owner" is the whole point of the band.
    # Recording only the band would leave the card saying "sent to Facility
    # manager" long after the owner had also been told.
    _mark_escalated(str(concern.get("id") or ""), verdict.step, now=now,
                    profile=role)
    return True


def _mark_escalated(concern_id: str, step: str, *,
                    now: Optional[float] = None, profile: str = "") -> bool:
    """Record which band was taken. ⚠️ AFTER THE SEND, like `_mark_delivered`,
    and for the identical reason: marking first loses the escalation entirely
    when the send fails, and at worst marking second escalates twice, which a
    person notices and can say something about."""
    if not concern_id:
        return False
    try:
        rows = concerns_mod.read()
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ",
                              time.gmtime(now if now is not None else time.time()))
        for row in rows:
            if str(row.get("id")) == concern_id:
                row["escalated_step"] = str(step)
                row["escalated_at"] = stamp
                _record_send(row, profile, stamp)
                return concerns_mod._write(rows)
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow(f"could not stamp concern {concern_id} as escalated", err)
    return False


def quiet_now(config: Optional[Mapping[str, Any]] = None,
              *, now: Optional[float] = None) -> bool:
    """Is the villa inside its quiet window right now?

    ⚠️ THE WINDOW WRAPS MIDNIGHT AND THAT IS THE ONLY INTERESTING CASE. Quiet
    hours are 22:00–07:00 on every property anyone would configure, so a naive
    `start <= now <= end` is false for the entire window and the feature reads
    as "never quiet" — which looks exactly like it working, because nothing is
    ever held.

    ⚠️ LOCAL TIME, FROM THE PROPERTY'S OWN TIMEZONE. A villa at UTC+8 with a
    server thinking in UTC would hold its warnings through the afternoon and
    deliver them at three in the morning — the precise inversion of the point.
    `reports.schedule.resolve_timezone` is the one resolver and this does not
    grow a second.

    ⚠️ AND AN UNSET WINDOW MEANS NEVER QUIET, NOT ALWAYS. The keys ship empty:
    a property that has not configured quiet hours wants its warnings, not
    silence it never asked for.
    """
    cfg = agent_config.view(config)
    start = _hhmm(cfg.get("quiet_hours_start"))
    end = _hhmm(cfg.get("quiet_hours_end"))
    if start is None or end is None or start == end:
        return False

    from datetime import datetime

    from reports.schedule import resolve_timezone

    tz = resolve_timezone(str(cfg.get("timezone") or ""))
    stamp = datetime.fromtimestamp(now if now is not None else time.time(), tz)
    minutes = stamp.hour * 60 + stamp.minute
    if start < end:
        return start <= minutes < end
    # Wraps midnight: quiet from `start` to the end of the day, and from
    # midnight to `end`.
    return minutes >= start or minutes < end


def _hhmm(value: Any) -> Optional[int]:
    """`"22:30"` as minutes past midnight, or None for anything unusable."""
    parts = str(value or "").strip().split(":")
    if len(parts) != 2:
        return None
    try:
        hours, mins = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (0 <= hours < 24 and 0 <= mins < 60):
        return None
    return hours * 60 + mins


async def occupancy_now(session: Any) -> Optional[bool]:
    """Is anybody at the villa? `None` when it cannot be told.

    ⚠️ THREE-VALUED, AND THE THIRD VALUE IS THE POINT. "I cannot tell" is not
    "nobody is home": holding somebody's critical overnight on an assumption is
    the expensive way to be wrong, so `route.holds_until_morning` delivers on
    `None`. `route.occupancy` owns the rule; this only fetches the states.
    """
    if session is None:
        return None
    try:
        # ⚠️ `HassClient(session).command("get_states")`, WHICH IS HOW EVERY
        # OTHER CALLER IN THIS REPOSITORY ASKS. The first version called
        # `hass.get_states(session)` — a module-level function that has never
        # existed — so this raised `AttributeError` on EVERY sweep, was
        # swallowed, and occupancy has been `None` since the outbox was
        # written. `None` means "cannot tell" and `route.holds_until_morning`
        # delivers on it, so nothing was held that should have gone; what was
        # lost is the ability to hold anything BACK for an empty villa, and
        # `guests_present` was false for every routing decision ever made.
        from reports.hass import HassClient
        async with HassClient(session) as client:
            states = await client.command("get_states")
    except Exception as err:  # noqa: BLE001 - a sweep is not worth a failed pass
        swallow("could not read occupancy", err)
        return None
    return route_mod.occupancy(states if isinstance(states, list) else [])


async def sweep(session: Any, *,
                config: Optional[Mapping[str, Any]] = None,
                now: Optional[float] = None) -> Dispatch:
    """Deliver what is owed. NEVER RAISES — the caller is a background clock.

    ⚠️ THE DELIVERY CLASS IS DECIDED BY `route.plan`, NOT HERE, and that is
    deliberate: an informational concern's FYI copy, its no-push rule and its
    quiet-hours hold all live in the routing table, and the way to keep that
    true is for this sweep to run THROUGH the module that decides rather than
    around it.
    """
    out = Dispatch()
    pending = undelivered()
    out.considered = len(pending)
    if not pending:
        # ⚠️ A TIER THAT DID NOTHING STILL REPORTS. "No line" and "nothing to
        # carry" are the same thing in a log, so silence here made a delivery
        # tier that never ran look exactly like a villa with nothing to say —
        # the instrument shape this project has been caught by five times.
        stage("outbox", "nothing waiting")
        return out

    cfg = agent_config.view(config)
    if not cfg.get("enabled"):
        out.reason = "the agent is switched off"
        return out

    quiet = quiet_now(config, now=now)
    occupied = await occupancy_now(session)

    for row in pending[:MAX_PER_SWEEP]:
        try:
            sent = await _deliver_one(session, row, config=config,
                                      quiet=quiet, occupied=occupied, now=now)
        except Exception as err:  # noqa: BLE001 - one concern is not the sweep
            swallow(f"could not deliver concern {row.get('id')}", err)
            out.failed += 1
            continue
        if sent == "sent":
            out.sent += 1
            out.delivered_ids.append(str(row.get("id") or ""))
        elif sent == "held":
            out.held += 1
        else:
            out.failed += 1

    stage("outbox", out.line())
    return out


async def _deliver_one(session: Any, concern: Mapping[str, Any], *,
                       config: Optional[Mapping[str, Any]],
                       quiet: bool, occupied: Optional[bool],
                       now: Optional[float]) -> str:
    """One concern, routed and sent. Returns sent | held | failed."""
    from reports import deliver as deliver_mod
    from reports import people as people_mod

    audience = str(concern.get("audience") or "owner")
    # ⚠️ THE AUDIENCE IS A PROFILE HERE, AND `people` OWNS THE MAPPING. An
    # audience is who a finding is WRITTEN FOR; a role is who is logged in, and
    # `contracts` keeps the two vocabularies apart for good reasons. `ops` is
    # the Facility Manager's profile id, which is why this is a lookup and not
    # the audience string.
    role = "ops" if audience == "facility" else "owner"
    targets = people_mod.targets_for_role(config, role)
    if not targets:
        # ⚠️ THE SAME FALLBACK THE BRIEFING HAS HAD ALL ALONG, and its absence
        # here was an asymmetry nobody could see from outside: `pipeline.
        # targets_for` tries the People table, THEN the schedule's own list,
        # THEN the shared `notify_targets`. This tried the People table and
        # stopped. So a villa whose People table has no row for this profile
        # delivers its BRIEFINGS perfectly and its CONCERNS nowhere — which
        # reads as "the alerts are broken" when the alerts are unconfigured.
        # Reported as briefings arriving and concern notifications never doing.
        from reports import store as reports_store
        stored = reports_store.config_view(
            reports_store.read_json(reports_store.REPORTS_CONFIG_FILE,
                                    reports_store.EMPTY_CONFIG))
        shared = stored.get("notify_targets")
        targets = [str(t) for t in shared
                   if isinstance(t, str) and t.strip()] if isinstance(shared, list) else []
        if targets:
            warn(f"no destination is configured for the {role!r} profile; "
                 f"falling back to the shared notify list for concern {concern.get('id')}")

    plan = route_mod.plan(concern, targets=targets, push_targets=targets,
                          occupied=occupied, quiet_hours=quiet, profile=role,
                          config=config)

    # ⚠️ THE ROUTING VERDICT IS SAID OUT LOUD, AND `Delivery.reason` IS WHY IT
    # CAN BE. Every branch below was already decided correctly and reported only
    # as a tally — `considered 1, sent 0, suppressed 1` — so the two questions an
    # owner actually asks when nothing arrives ("did it decide not to, or did it
    # fail?" and "why?") were answered by a number that could not tell them
    # apart. The reason string has existed on this object since the module was
    # written and nothing had ever read it.
    ident = str(concern.get("id") or "?")
    stage("route", f"{ident} {plan.severity} → "
                   f"{len(plan.targets)} target(s)"
                   + (f", {plan.reason}" if plan.reason else ""))

    if plan.held:
        # ⚠️ NOT MARKED. The next sweep re-evaluates it, and the moment the
        # window has passed it goes. This is the whole release mechanism.
        return "held"
    if not plan.targets:
        # ⚠️ NOWHERE TO SEND IS A CONFIGURATION STATE, NOT AN ERROR — and it
        # must NOT mark the concern delivered, or configuring a target later
        # would silently skip everything raised before it.
        #
        # ⚠️ IT IS ALSO THE LIKELIEST REASON A FIRST TEST DELIVERS NOTHING, and
        # it used to be indistinguishable from a Telegram outage: both came back
        # as `failed`, one word, in a tally. A villa with nobody configured is
        # fixed on the People tab in a minute; a broken notify platform is not,
        # and sending somebody to the wrong one of those costs a round.
        warn(f"concern {ident} has nowhere to go: no destination is configured "
             f"for the {role!r} profile on the People tab")
        return "failed"

    results = await deliver_mod.deliver(session, plan.targets,
                                        plan.title, plan.body)
    landed = [str(r.get("target")) for r in results
              if isinstance(r, Mapping) and str(r.get("status")) == "sent"]
    if not landed:
        return "failed"
    _mark_delivered(str(concern.get("id") or ""), now=now, profile=role)

    # ⚠️ AFTER THE SEND, AND ONLY AFTER IT. A facility manager job raised for a concern
    # whose delivery then failed is a task nobody was told about, sitting on a
    # list with no message to explain it. Same ordering rule, same reason, as
    # `_mark_delivered` directly above.
    #
    # ⚠️ DELIVERY IS THE BAR, AND THERE IS DELIBERATELY NO SECOND ONE. Tier 4
    # has already decided this concern is worth a person's attention; a severity
    # threshold here would be a second opinion about a question that was just
    # answered, and the first villa where the two disagreed would have a job
    # nobody was told about or a message with no job behind it.
    #
    # ⚠️ EXCEPT AN FYI, WHICH RAISES NO JOB BY DEFINITION (2026-08-28, owner's
    # ruling). "Investigate & Log Only" means nothing is asked of anybody — a
    # to-do item with a Done button IS asking — so the informational stamp is
    # the one thing that stands between a concern and the task loop. This is
    # not a severity threshold: it is the same mode decision the stamp records.
    if not bool(concern.get("informational")):
        from agent import task as task_mod
        await task_mod.raise_for(session, concern, config=config)
    return "sent"


def _record_send(row: Dict[str, Any], profile: str, stamp: str) -> None:
    """Append one send to a concern's own history. ⚠️ APPEND, NEVER REPLACE —
    the escalation ladder sends to a SECOND profile, and overwriting would make
    the card claim the first send never happened."""
    if not profile:
        return
    history = row.get("deliveries")
    if not isinstance(history, list):
        history = []
    history.append({"profile": profile, "at": stamp})
    row["deliveries"] = history


def _mark_delivered(concern_id: str, *, now: Optional[float] = None,
                    profile: str = "") -> bool:
    """Stamp a concern as sent. ⚠️ AFTER THE SEND, NEVER BEFORE.

    Marking first and sending second loses the concern entirely when the send
    fails — it is stamped, so no later sweep will retry it, and nobody was ever
    told. Marking second can at worst send twice, which a person notices and can
    say something about. The audit's own intent/outcome pairing makes the same
    choice for the same reason.
    """
    if not concern_id:
        return False
    try:
        rows = concerns_mod.read()
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ",
                              time.gmtime(now if now is not None else time.time()))
        for row in rows:
            if str(row.get("id")) == concern_id:
                row["delivered_at"] = stamp
                _record_send(row, profile, stamp)
                return concerns_mod._write(rows)
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow(f"could not stamp concern {concern_id} as delivered", err)
    return False
