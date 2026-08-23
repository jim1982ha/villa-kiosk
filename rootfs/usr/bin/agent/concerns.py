"""The one currency: a concern, from open to closed. CTR-010, TASK-043/046.

⚠️ EVERYTHING DOWNSTREAM OF TIER 3 HANDLES ONE RECORD TYPE. Six overlapping
ones exist today — `Item`, `Group`, `Finding`, `AttentionItem`, `standing.Item`,
`ReportHistoryEntry` — which is itself the symptom of six layers each inventing
its own vocabulary. This is the replacement, and adding a seventh is how the
same sprawl starts again.

⚠️ DEDUPLICATION IS THE AGENT'S JUDGEMENT; THE LINK IS DETERMINISTIC. The model
can see what is open (`read_concerns`) and decides whether tonight's pump noise
is last week's pump noise — a judgement no key comparison makes well, because
"the same condition" is not the same as "the same subject". What is NOT its
judgement is whether the link is recorded: `supersede()` writes the chain, and a
second concern for a subject that already has an open one is refused unless it
says what it supersedes.

⚠️ VERIFICATION REQUIRES COVERAGE, AND SAYS SO WHEN IT LACKS IT. "It did not
recur" and "I was not listening" produce the same empty result and mean opposite
things — the exact ambiguity `covered_but_silent` and the 45-day grace were
invented to paper over. A sweep with incomplete coverage returns `cannot_verify`,
never `verified`.

⚠️ AND `dismissed` IS NOT `closed`. Closed means the thing was dealt with;
dismissed means a person said it did not matter. Collapsing them loses the only
signal alert-fatigue measurement has.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from agent import contracts
from reports import store
from reports.log import log, swallow

CONCERNS_FILE: str = f"{store.DATA_DIR}/vesta/concerns.json"

#: ⚠️ BOUNDED, like every store here. A concern is ~600 bytes with its evidence,
#: so 2,000 is months of a busy property and a hard stop against a loop filling
#: the disk on a villa nobody visits.
MAX_CONCERNS: int = 2_000

#: Terminal states. ⚠️ A concern in one of these is no longer "open" for
#: deduplication, so tonight's pump noise may legitimately open a NEW concern
#: after last month's was closed — recurrence is a finding, not a duplicate.
SETTLED: Tuple[str, ...] = ("closed", "dismissed", "verified")

_EMPTY: Dict[str, Any] = {"concerns": []}


@dataclass
class Concern:
    """CTR-010. One thing worth a person's attention."""

    id: str = ""
    subject_key: str = ""
    title: str = ""
    body: str = ""
    severity: str = "notice"
    audience: str = "owner"
    confidence: float = 0.5
    state: str = "open"
    opened_at: str = ""
    updated_at: str = ""
    #: `{tool, args_digest, at, summary}` — every claim traceable.
    evidence: List[Dict[str, Any]] = field(default_factory=list)
    #: Concern ids this one replaces. Visible and auditable, never implicit.
    supersedes: List[str] = field(default_factory=list)
    #: Why it left `open`, in a person's words where a person set it.
    outcome: str = ""
    #: When this was sent to somebody, or "" if it never was.
    #: ⚠️ ON THE CONCERN, NOT IN A SEPARATE QUEUE. The store is already the
    #: record of what the villa concluded; a delivery queue beside it is a
    #: second thing to keep in step, and the first time the two disagree
    #: somebody is either spammed or told nothing. `outbox.undelivered` reads
    #: exactly this field.
    delivered_at: str = ""
    #: When somebody said "I have seen this", and who. ⚠️ NOT A STATE — see
    #: `acknowledge`. Acknowledging stops escalation; it does not claim the
    #: problem is fixed, and a concern stays `open` until it actually is.
    acknowledged_at: str = ""
    acknowledged_by: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id, "subject_key": self.subject_key,
            "title": self.title, "body": self.body,
            "severity": self.severity, "audience": self.audience,
            "confidence": self.confidence, "state": self.state,
            "opened_at": self.opened_at, "updated_at": self.updated_at,
            "evidence": list(self.evidence), "supersedes": list(self.supersedes),
            "outcome": self.outcome, "delivered_at": self.delivered_at,
            "acknowledged_at": self.acknowledged_at,
            "acknowledged_by": self.acknowledged_by,
        }


def _now_iso(now: Optional[float] = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))


def read() -> List[Dict[str, Any]]:
    """Every concern, degrading to none. Never raises."""
    raw = store.read_json(CONCERNS_FILE, dict(_EMPTY))
    rows = raw.get("concerns") if isinstance(raw, dict) else None
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def _write(rows: Sequence[Mapping[str, Any]]) -> bool:
    try:
        kept = list(rows)[-MAX_CONCERNS:]
        store.write_json(CONCERNS_FILE, {"concerns": kept})
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not write the concern store", err)
        return False
    return True


def open_for(subject_key: str, rows: Optional[Sequence[Mapping[str, Any]]] = None
             ) -> List[Dict[str, Any]]:
    """Concerns about this subject that are still live.

    ⚠️ SETTLED ONES ARE NOT LIVE, and that is what makes recurrence expressible.
    A pump fault closed in March and returning in December is a NEW concern with
    its own lifecycle, not a duplicate of a resolved one — treating it as a
    duplicate is how a system stops reporting a problem it already solved once.
    """
    key = str(subject_key)
    source: List[Dict[str, Any]] = (read() if rows is None
                                    else [dict(r) for r in rows])
    return [r for r in source
            if str(r.get("subject_key")) == key
            and str(r.get("state") or "open") not in SETTLED]


def raise_concern(concern: Concern, *, now: Optional[float] = None
                  ) -> Tuple[Optional[Concern], str]:
    """Record a concern. Returns `(stored, reason)`; `stored is None` on refusal.

    ⚠️ REFUSED RATHER THAN DEDUPLICATED SILENTLY. If the subject already has an
    open concern and this one does not say what it supersedes, it is rejected
    with a reason the model can read and act on — either link it or explain why
    it is genuinely separate. Quietly merging would hide a second, different
    fault on the same equipment; quietly duplicating is the alert fatigue the
    workbook names as the failure mode that kills systems like this one.
    """
    stamp = _now_iso(now)
    rows = read()

    # ⚠️ COMPLETED FIRST, VALIDATED SECOND. The first version checked the
    # contract before minting the id and stamping the times, so every concern
    # was refused for `id is empty` — the caller does not supply an id and is
    # not meant to. Validate what will be STORED, never what was handed in.
    out = Concern(**{**concern.as_dict(),
                     "id": concern.id or _mint(rows),
                     "opened_at": concern.opened_at or stamp,
                     "updated_at": stamp})

    problems = contracts.concern_errors(out.as_dict())
    if problems:
        return None, "; ".join(problems[:3])

    existing = open_for(out.subject_key, rows)
    if existing and not out.supersedes:
        return None, (
            f"{len(existing)} concern(s) about this subject are already open "
            f"({', '.join(str(r.get('id')) for r in existing[:3])}). Either "
            f"supersede one, or say why this is a different condition.")
    rows = _supersede_rows(rows, out.supersedes, out.id, stamp)
    rows.append(out.as_dict())
    if not _write(rows):
        return None, "the concern store could not be written"
    log(f"concern {out.id} opened: {out.severity} {out.title[:60]}")
    return out, ""


def _mint(rows: Sequence[Mapping[str, Any]]) -> str:
    """A per-store sequential id.

    ⚠️ SEQUENTIAL, NOT A HASH — the same choice `refs.py` makes. It must be
    correlatable inside one villa (a concern and the audit rows about it) and
    must NOT be correlatable across properties.
    """
    return f"c{len(rows) + 1}"


def _supersede_rows(rows: List[Dict[str, Any]], superseded: Sequence[str],
                    by_id: str, stamp: str) -> List[Dict[str, Any]]:
    """Mark the replaced concerns closed, naming what replaced them."""
    targets = {str(i) for i in superseded}
    for row in rows:
        if str(row.get("id")) in targets and str(row.get("state")) not in SETTLED:
            row["state"] = "closed"
            row["updated_at"] = stamp
            row["outcome"] = f"superseded by {by_id}"
    return rows


def transition(concern_id: str, state: str, *, outcome: str = "",
               now: Optional[float] = None) -> Tuple[bool, str]:
    """Move a concern's state. Returns `(ok, reason)`.

    ⚠️ THE TIMESTAMP IS THE POINT, NOT THE STATE. HA's todo list carries a
    status and NO completion time, which is precisely why median-time-to-clear
    is recorded in the workbook as NOT COMPUTABLE. Every transition here stamps
    `updated_at`, which is what makes verification and alert-fatigue
    measurement possible at all.
    """
    if not contracts.is_valid(state, contracts.CONCERN_STATE):
        return False, f"{state!r} is not one of {list(contracts.CONCERN_STATE)}"
    rows = read()
    for row in rows:
        if str(row.get("id")) == str(concern_id):
            row["state"] = state
            row["updated_at"] = _now_iso(now)
            if outcome:
                row["outcome"] = str(outcome)
            # ⚠️ ONE WRITE. The first version called `_write` twice inside the
            # return expression — once for the value and once for the message —
            # so every transition rewrote the store, and a failure on the second
            # call would have reported success from the first.
            ok = _write(rows)
            return ok, "" if ok else "the concern store could not be written"
    return False, f"no concern {concern_id!r}"


def acknowledge(concern_id: str, *, by: str,
                now: Optional[float] = None) -> Tuple[bool, str]:
    """"I have seen this." Stops escalation. Returns `(ok, reason)`.

    ⚠️ ACKNOWLEDGING IS NOT RESOLVING, AND THAT IS WHY THIS IS NOT A STATE.
    A person saying they have seen an alert is not saying it is fixed, and
    modelling it as a transition would force exactly that conflation — the
    concern would leave `open` and stop being something the villa is still
    carrying. The state is untouched; two fields are stamped beside it.

    ⚠️ ONE ACKNOWLEDGEMENT CLOSES THE THREAD AND THE PUSH, because there is one
    record. REQ-034's second clause asks that a concern delivered by two
    channels not need acknowledging twice; that is satisfied by construction
    here rather than by keeping two receipts in step — the concern id is the
    thing both channels carried.

    ⚠️ FIRST ONE WINS. A second acknowledgement is not an error and not an
    overwrite: escalation has already stopped, and rewriting the name would
    lose who actually picked it up. Reported as ok, with the reason saying so.
    """
    who = str(by or "").strip()
    if not who:
        # ⚠️ REFUSED RATHER THAN STAMPED ANONYMOUSLY. "Somebody has it" is the
        # whole content of an acknowledgement; without a name it says only that
        # a request arrived, and escalation would stop on that.
        return False, "an acknowledgement must say who made it"
    rows = read()
    for row in rows:
        if str(row.get("id")) != str(concern_id):
            continue
        if str(row.get("acknowledged_at") or ""):
            return True, (f"already acknowledged by "
                          f"{row.get('acknowledged_by') or 'somebody'}")
        row["acknowledged_at"] = _now_iso(now)
        row["acknowledged_by"] = who
        row["updated_at"] = _now_iso(now)
        ok = _write(rows)
        return ok, "" if ok else "the concern store could not be written"
    return False, f"no concern {concern_id!r}"


# ── verification ────────────────────────────────────────────────────────────
@dataclass
class Verification:
    concern_id: str
    verdict: str            # verified | recurred | cannot_verify
    reason: str = ""


def verify(concern_id: str, *, recurred: bool, coverage_complete: bool,
           now: Optional[float] = None) -> Verification:
    """Did the fix hold? TASK-046.

    ⚠️ COVERAGE FIRST, AND IT IS NOT A DETAIL. "It did not recur" and "I was not
    listening" are the same empty observation and opposite facts. Reusing
    `collect.coverage`'s "listening throughout" gate is what stops this becoming
    the fourth place in this codebase to claim health from silence — and it is
    checked BEFORE `recurred`, because a recurrence seen during partial coverage
    is still a real recurrence while an absence during partial coverage is
    nothing at all.
    """
    if recurred:
        transition(concern_id, "open", outcome="recurred", now=now)
        return Verification(concern_id, "recurred",
                            "the condition returned after being addressed")
    if not coverage_complete:
        return Verification(
            concern_id, "cannot_verify",
            "the observation floor was not listening throughout the window, so "
            "an absence proves nothing")
    transition(concern_id, "verified", outcome="did not recur", now=now)
    return Verification(concern_id, "verified",
                        "the condition did not return while being watched")


#: How many dismissals of one subject suppress it, and over what window.
#: ⚠️ THREE, AND THE COUNTER IS THE MECHANISM — NOT AGENT JUDGEMENT. "Stop
#: telling me about the gym lights" must work RELIABLY rather than
#: probabilistically, and that is the whole difference between a feedback loop
#: and a suggestion. RPT-05: the acknowledgement half has never existed
#: anywhere in this system, so no rule could ever be judged noisy.
DISMISSALS_TO_SUPPRESS: int = 3
DISMISSAL_WINDOW_DAYS: int = 90


def feedback(concern_id: str, *, useful: bool, reason: str = "",
             now: Optional[float] = None) -> Tuple[bool, str]:
    """Record a person's verdict on a concern. Returns `(ok, reason)`.

    ⚠️ "NOT USEFUL" IS `dismissed`, WHICH IS NOT `closed`. Closed means the
    thing was dealt with; dismissed means somebody said it did not matter, and
    collapsing them loses the only signal alert-fatigue measurement has.

    ⚠️ THE REASON IS KEPT VERBATIM AND IS THE MORE VALUABLE HALF. "Not useful —
    the gym is closed for renovation" is a fact about the villa that should stop
    the whole FAMILY of gym concerns, not just this one; PH-7 turns it into a
    memory. Storing only the count would discard exactly the part a person took
    the trouble to type.
    """
    state = "verified" if useful else "dismissed"
    note = str(reason or "").strip()
    outcome = (f"marked {'useful' if useful else 'not useful'}"
               + (f": {note}" if note else ""))
    return transition(concern_id, state, outcome=outcome, now=now)


def dismissals_of(subject_key: str,
                  rows: Optional[Sequence[Mapping[str, Any]]] = None) -> int:
    """How many times a person has dismissed this subject.

    ⚠️ COUNTED FROM THE STORE, NEVER HELD SEPARATELY. A counter kept beside the
    concerns is a counter that disagrees with them the first time one is edited
    or expires; the lifecycle IS the record.
    """
    key = str(subject_key)
    source = list(read() if rows is None else rows)
    return sum(1 for r in source
               if str(r.get("subject_key")) == key
               and str(r.get("state")) == "dismissed")


def suppressed_subjects(rows: Optional[Sequence[Mapping[str, Any]]] = None
                        ) -> List[str]:
    """Subjects a person has told us to stop raising, by count.

    ⚠️ THE OUTPUT FEEDS `policy.suppressed_subjects`, WHICH IS ALREADY THE ONE
    GATE. This function decides WHICH subjects; `policy.is_suppressed` decides
    what that means for a run. Two halves, each with one owner — putting the
    counting inside policy would make the authority boundary depend on a
    feedback tally, and putting the gate here would give the store a veto.
    """
    counts: Dict[str, int] = {}
    for row in (read() if rows is None else rows):
        if str(row.get("state")) == "dismissed":
            key = str(row.get("subject_key") or "")
            if key:
                counts[key] = counts.get(key, 0) + 1
    return sorted(k for k, n in counts.items() if n >= DISMISSALS_TO_SUPPRESS)


def summary(rows: Optional[Sequence[Mapping[str, Any]]] = None) -> Dict[str, Any]:
    """Counts the Cockpit and the brief both read. No bodies, no evidence."""
    data = list(read() if rows is None else rows)
    by_state: Dict[str, int] = {}
    by_severity: Dict[str, int] = {}
    for row in data:
        state = str(row.get("state") or "open")
        by_state[state] = by_state.get(state, 0) + 1
        if state not in SETTLED:
            sev = str(row.get("severity") or "notice")
            by_severity[sev] = by_severity.get(sev, 0) + 1
    return {"total": len(data), "open": sum(
        1 for r in data if str(r.get("state") or "open") not in SETTLED),
        "by_state": dict(sorted(by_state.items())),
        "by_severity": dict(sorted(by_severity.items())),
        "bound": MAX_CONCERNS, "at_bound": len(data) >= MAX_CONCERNS}
