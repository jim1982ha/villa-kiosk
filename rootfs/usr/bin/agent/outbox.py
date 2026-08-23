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
the targets; `shadow.suppressed` decides whether anything may be sent at all;
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
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from agent import concerns as concerns_mod
from agent import config as agent_config
from agent import route as route_mod
from reports.log import log, swallow

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
    suppressed: int = 0
    failed: int = 0
    reason: str = ""
    delivered_ids: List[str] = field(default_factory=list)

    def line(self) -> str:
        if self.reason:
            return self.reason
        return (f"considered {self.considered}, sent {self.sent}, "
                f"held {self.held}, suppressed {self.suppressed}"
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
        from reports import hass
        states = await hass.get_states(session)
    except Exception as err:  # noqa: BLE001 - a sweep is not worth a failed pass
        swallow("could not read occupancy", err)
        return None
    return route_mod.occupancy(states if isinstance(states, list) else [])


async def sweep(session: Any, *,
                config: Optional[Mapping[str, Any]] = None,
                now: Optional[float] = None) -> Dispatch:
    """Deliver what is owed. NEVER RAISES — the caller is a background clock.

    ⚠️ SHADOW IS ASKED BY `route.plan`, NOT HERE, and that is deliberate:
    `test_shadow` pins that every unsolicited delivery path consults
    `shadow.suppressed`, and the way to keep that true is for the path to run
    THROUGH the module that asks rather than around it. A suppressed plan
    returns with no targets and this records it as suppressed.
    """
    out = Dispatch()
    pending = undelivered()
    out.considered = len(pending)
    if not pending:
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
        elif sent == "suppressed":
            out.suppressed += 1
        else:
            out.failed += 1

    if out.sent or out.held or out.suppressed:
        log(f"outbox: {out.line()}")
    return out


async def _deliver_one(session: Any, concern: Mapping[str, Any], *,
                       config: Optional[Mapping[str, Any]],
                       quiet: bool, occupied: Optional[bool],
                       now: Optional[float]) -> str:
    """One concern, routed and sent. Returns sent | held | suppressed | failed."""
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

    plan = route_mod.plan(concern, targets=targets, push_targets=targets,
                          occupied=occupied, quiet_hours=quiet, config=config)
    if plan.suppressed:
        return "suppressed"
    if plan.held:
        # ⚠️ NOT MARKED. The next sweep re-evaluates it, and the moment the
        # window has passed it goes. This is the whole release mechanism.
        return "held"
    if not plan.targets:
        # ⚠️ NOWHERE TO SEND IS A CONFIGURATION STATE, NOT AN ERROR — and it
        # must NOT mark the concern delivered, or configuring a target later
        # would silently skip everything raised before it.
        return "failed"

    results = await deliver_mod.deliver(session, plan.targets,
                                        plan.title, plan.body)
    ok = any(str(r.get("status")) == "sent" for r in results
             if isinstance(r, Mapping))
    if not ok:
        return "failed"
    _mark_delivered(str(concern.get("id") or ""), now=now)
    return "sent"


def _mark_delivered(concern_id: str, *, now: Optional[float] = None) -> bool:
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
                return concerns_mod._write(rows)
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow(f"could not stamp concern {concern_id} as delivered", err)
    return False
