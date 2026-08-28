"""High-harm actions waiting on a person. TASK-083, REQ-029, ARCH-007.

⚠️ HUMAN-INITIATED IS NOT HUMAN-AUTHORISED, AND CHAT IS WHY. A message asking
the villa to unlock the gate arrives as text, and text is the one channel an
attacker can inject into — a delivery note taped to the door, a forwarded
message, a compromised phone. So an authenticated owner ASKING is not consent:
consent is a separate act, on a surface the model cannot reach.

⚠️ THE MODEL CANNOT SATISFY THIS FLOW, WHICH IS THE WHOLE POINT. There is no
tool that confirms a proposal — not a restricted one, not an owner-only one.
Confirmation arrives through an HTTP route with a session cookie and a role, and
this module is only reachable from there. A confirm flow the model can complete
is worse than none, because it converts a refusal into a two-step execution and
looks like a safeguard while doing it.

⚠️ EVERY PROPOSAL EXPIRES, AND THAT IS A SAFETY PROPERTY RATHER THAN
HOUSEKEEPING. "Unlock the gate for the cleaner" is a reasonable thing to confirm
within two minutes and a dangerous thing to confirm six hours later, when the
cleaner has gone and the reason is forgotten. An expired proposal is refused
with its age stated; it is never silently executed, and never silently dropped
either — `decide` says which of the two happened.

⚠️ AND A PROPOSAL IS SINGLE-USE. `decide` transitions from `pending` and
refuses anything else, so a double-tap on a wall tablet, a retried request and a
replayed one all reach the villa once. This is the same property
`audit.record_intent` gives an ACTION; a proposal needs its own because it is a
different object with a different lifetime, and the audit key is minted before
anyone has agreed to anything.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Mapping, Optional, Sequence

from vesta.adapters import store as store_mod
from vesta.adapters.log import log, swallow

#: Where proposals live. ⚠️ ITS OWN FILE, not a flag on a concern: a concern is
#: something the villa has CONCLUDED and this is something it wants PERMISSION
#: for, with a lifetime measured in minutes rather than days.
PROPOSALS_FILE: str = "/data/vesta/proposals.json"

#: How long a proposal stands. ⚠️ SHORT ON PURPOSE — see the module docstring's
#: third rule. Ten minutes is long enough to walk to the tablet and short enough
#: that the situation which justified it still exists.
TTL_SECONDS: int = 600

#: How many may wait at once. A queue of high-harm requests is itself a signal
#: that something is wrong — either the model is looping or somebody is probing
#: — and an unbounded list is a page nobody reads.
MAX_PENDING: int = 5

#: The states a proposal can be in. ⚠️ `expired` IS A DECISION THAT NOBODY MADE,
#: and it is recorded rather than inferred at read time so the history says what
#: happened rather than what the clock now implies.
STATES = ("pending", "confirmed", "declined", "expired")


def _read() -> List[Dict[str, Any]]:
    try:
        raw = store_mod.read_json(PROPOSALS_FILE, {})
        rows = raw.get("proposals") if isinstance(raw, Mapping) else None
        return [dict(r) for r in rows if isinstance(r, Mapping)] \
            if isinstance(rows, Sequence) and not isinstance(rows, str) else []
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the proposal store", err)
        return []


def _write(rows: Sequence[Mapping[str, Any]]) -> bool:
    try:
        store_mod.write_json(PROPOSALS_FILE, {"proposals": [dict(r) for r in rows]})
        return True
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not write the proposal store", err)
        return False


def _now(now: Optional[float] = None) -> float:
    return float(now if now is not None else time.time())


def _aged(row: Mapping[str, Any], now: float) -> bool:
    return float(row.get("expires_at") or 0) <= now


def propose(*, action_key: str, ref: str, entity_id: str, service: str,
            params: Optional[Mapping[str, Any]] = None, harm: str = "high",
            reason: str = "", why: str = "", run_id: str = "",
            actor: str = "system", now: Optional[float] = None) -> bool:
    """Record a high-harm action for a person to decide on.

    ⚠️ KEYED ON THE AUDIT'S `action_key`, NOT ON AN ID OF ITS OWN. That key is
    already the identity of this exact action with these exact arguments
    (`audit.record_intent` mints it before the verdict is acted on), so reusing
    it means the audit trail and the proposal cannot come apart — and a repeated
    proposal of the same action is recognised as the same one rather than
    queueing twice.

    Returns whether it was stored. ⚠️ A REFUSAL IS SILENT AND FALSE: this runs
    inside a tool call that has already produced its answer, and a queue that
    could fail a run would trade a delivered proposal for a broken turn.
    """
    key = str(action_key or "").strip()
    if not key or not str(entity_id or "").strip() or not str(service or "").strip():
        return False
    at = _now(now)
    rows = _expire(_read(), at)
    if any(r.get("action_key") == key and r.get("state") == "pending"
           for r in rows):
        # Already waiting on the same person for the same thing.
        return True
    if sum(1 for r in rows if r.get("state") == "pending") >= MAX_PENDING:
        log("proposal queue is full; not queueing another high-harm action")
        return False
    rows.append({
        "action_key": key,
        "ref": str(ref),
        "entity_id": str(entity_id),
        "service": str(service),
        "params": dict(params) if isinstance(params, Mapping) else {},
        "harm": str(harm or "high"),
        "reason": str(reason)[:300],
        "why": str(why)[:300],
        "run_id": str(run_id),
        "actor": str(actor),
        "state": "pending",
        "proposed_at": at,
        "expires_at": at + TTL_SECONDS,
    })
    _write(rows)
    log(f"proposed {service} on {ref}: waiting on a person")
    return True


def _expire(rows: List[Dict[str, Any]], now: float) -> List[Dict[str, Any]]:
    """Mark aged proposals, in place. ⚠️ RECORDED, NOT FILTERED — "nobody
    answered in time" is the answer to "why did the gate not open", and a row
    that simply vanished cannot give it."""
    for row in rows:
        if row.get("state") == "pending" and _aged(row, now):
            row["state"] = "expired"
            row["decided_at"] = now
    return rows


def pending(now: Optional[float] = None) -> List[Dict[str, Any]]:
    """Proposals still awaiting a person, newest last. Never raises."""
    at = _now(now)
    rows = _expire(_read(), at)
    _write(rows)
    return [r for r in rows if r.get("state") == "pending"]


def decide(action_key: str, *, confirm: bool, by: str,
           now: Optional[float] = None) -> Dict[str, Any]:
    """A PERSON's answer. Returns `{"ok": bool, "reason": str, ...}`.

    ⚠️ `by` IS THE ACTOR AND IS REQUIRED. A high-harm action that happened with
    nobody's name on it is one nobody owns, and "who unlocked the gate at 03:00"
    is a question that gets asked exactly once, urgently. The caller passes the
    session's ROLE, never a name from the request body — a client-supplied
    author is not an audit trail.

    ⚠️ THE PROPOSAL IS RETURNED ONLY ON A CONFIRM, and it carries the stored
    entity and service rather than anything the confirming request supplied.
    Otherwise the confirm route would be a way to execute an ARBITRARY service
    by naming a proposal — which is the flow this module exists to prevent,
    rebuilt through its own front door.
    """
    key = str(action_key or "").strip()
    who = str(by or "").strip()
    if not key:
        return {"ok": False, "reason": "no action_key"}
    if not who:
        return {"ok": False, "reason": "no actor"}

    at = _now(now)
    rows = _expire(_read(), at)
    for row in rows:
        if row.get("action_key") != key:
            continue
        state = str(row.get("state") or "")
        if state != "pending":
            # ⚠️ NAMES THE STATE IT IS IN. "Already confirmed", "expired four
            # minutes ago" and "declined by the owner" are three different
            # answers, and a caller that only learns "no" cannot tell a
            # double-tap from a stale tablet.
            #
            # ⚠️ AND THE EXPIRY IS PERSISTED ON THE WAY OUT. `_expire` marked it
            # in memory; returning without writing left the store saying
            # "pending" for something this function had just refused as
            # expired, so the next reader disagreed with the last answer. Found
            # by a mutation that survived for exactly that reason.
            _write(rows)
            return {"ok": False, "reason": f"this proposal is {state}",
                    "state": state}
        row["state"] = "confirmed" if confirm else "declined"
        row["decided_at"] = at
        row["decided_by"] = who
        _write(rows)
        log(f"proposal {row.get('service')} on {row.get('ref')} "
            f"{row['state']} by {who}")
        return {"ok": True, "reason": "", "state": row["state"],
                "proposal": dict(row) if confirm else {}}
    return {"ok": False, "reason": "no such proposal"}
