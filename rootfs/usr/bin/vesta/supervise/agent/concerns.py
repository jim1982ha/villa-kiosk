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
things — the exact ambiguity the old blueprint stand-down papered over with a
45-day grace window (deleted in 2.755.0; the villa's supervision switch decides
now, and nothing waits). A sweep with incomplete coverage returns `cannot_verify`,
never `verified`.

⚠️ AND `dismissed` IS NOT `closed`. Closed means the thing was dealt with;
dismissed means a person said it did not matter. Collapsing them loses the only
signal alert-fatigue measurement has.
"""

from __future__ import annotations

import calendar
import time
from dataclasses import dataclass, field
from typing import (Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple)

from vesta.supervise.agent import contracts
from vesta.adapters import store
from vesta.adapters.log import stage, swallow

CONCERNS_FILE: str = f"{store.DATA_DIR}/vesta/concerns.json"

#: ⚠️ BOUNDED, like every store here. A concern is ~600 bytes with its evidence,
#: so 2,000 is months of a busy property and a hard stop against a loop filling
#: the disk on a villa nobody visits.
MAX_CONCERNS: int = 2_000

#: Chat messages remembered per alert. ⚠️ BOUNDED FOR THE SAME REASON THE STORE
#: IS: an alert escalated repeatedly would otherwise grow one row without limit.
MAX_MESSAGE_REFS: int = 6

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
    #: The investigation that produced this. ⚠️ THE LINK BACK TO THE FLAG, and
    #: it did not exist until 2.780.0: a concern recorded its subject only as
    #: `subject_key`, a HASH, so nothing could answer "did this flag turn into
    #: anything?" except by hashing an entity id the flag often does not carry —
    #: the reference villa reports `0/3 identified`. The consequence was a UI
    #: that could only ever say "no concern", including when there was one, and
    #: a Handover column stuck at 0 matched. `run_id` is the flag's own id, so
    #: the join is exact and works whether or not a device was identified.
    run_id: str = ""
    #: When this was sent to somebody, or "" if it never was.
    #: ⚠️ ON THE CONCERN, NOT IN A SEPARATE QUEUE. The store is already the
    #: record of what the villa concluded; a delivery queue beside it is a
    #: second thing to keep in step, and the first time the two disagree
    #: somebody is either spammed or told nothing. `outbox.undelivered` reads
    #: exactly this field.
    delivered_at: str = ""
    #: One entry per send: `{profile, at}`. ⚠️ A LIST, NOT A FIELD, BECAUSE
    #: ESCALATION SENDS AGAIN TO SOMEBODY ELSE. `route.escalate`'s ladder goes
    #: to the same target, then adds the owner, then reaches everyone — so a
    #: single "delivered to" would be overwritten by the second send and the
    #: card would claim the first never happened. Each entry names the PROFILE
    #: rather than the notify entity: `owner` and `ops` are what a person
    #: recognises from the People tab, and an entity id tells them nothing about
    #: who is reading it.
    #:
    #: ⚠️ `delivered_at` STAYS AND IS STILL THE FIRST SEND. `outbox.undelivered`
    #: and `awaiting_acknowledgement` both key on it, so replacing it with this
    #: list would rewrite the delivery and escalation sweeps for a display
    #: change. This is additive on purpose.
    deliveries: List[Dict[str, str]] = field(default_factory=list)
    #: When somebody said "I have seen this", and who. ⚠️ NOT A STATE — see
    #: `acknowledge`. Acknowledging stops escalation; it does not claim the
    #: problem is fixed, and a concern stays `open` until it actually is.
    acknowledged_at: str = ""
    acknowledged_by: str = ""
    #: "This was worth telling me." ⚠️ NOT A STATE — see `feedback`. It is a
    #: verdict on the SUPERVISOR, not on the villa, so it leaves the concern
    #: exactly where it was; the owner reported the thumb up making a card
    #: disappear, which is what writing `verified` here used to do.
    useful: bool = False
    useful_at: str = ""
    useful_note: str = ""
    #: ⚠️ STAMPED AT RAISE TIME FROM THE VILLA'S MODE, NEVER DERIVED FROM THE
    #: MODE LATER (2026-08-28, owner's ruling). In "Alert only" (the mode was
    #: called "Investigate & Log Only" when this was written) a
    #: concern is still raised into THIS store and still delivered — as an FYI:
    #: told once, never escalated, never turned into a to-do job, nothing asked
    #: of anybody. Reading the villa's CURRENT mode instead would relabel every
    #: past concern the moment the owner changes the setting — the same trap
    #: `TriagePass.mode` exists to avoid. The old design (a separate shadow
    #: store, delivery suppressed entirely) was the cutover-measurement era;
    #: the diff it fed was deleted in 2.756.0 and the owner has since ruled
    #: that "log only" means "tell me, ask nothing" rather than "tell nobody".
    informational: bool = False
    #: WHAT KIND this is — a measurement and a direction, never a device. See
    #: `agent/flagtypes.py`. ⚠️ STAMPED AT RAISE TIME AND FOR ONE REASON: the
    #: only place that holds the entity id is the tool that raises the concern.
    #: `subject_key` is a HASH, so a thumb pressed on the Reason tab a week
    #: later has no way to work out what kind of thing it is judging unless the
    #: answer was written down when it was known. "" is legitimate — a concern
    #: about a topic rather than a device has no measurement to name.
    flag_type: str = ""
    #: Chat messages that carry this alert's buttons: `{entity_id, message_id}`.
    #: ⚠️ HERE RATHER THAN IN A SIDE TABLE, for the reason `deliveries` is: the
    #: store is already the record of what the villa said and to whom, and a
    #: second file listing live messages is a second thing to keep in step — the
    #: first time the two disagree, a button is retired on an alert still open
    #: or left live on one already closed. See `agent/buttons.py`.
    #:
    #: ⚠️ A LIST, BECAUSE ESCALATION SENDS AGAIN TO SOMEBODY ELSE. Retiring only
    #: the first would leave the owner's copy live after the facility manager's
    #: had been answered — exactly what `deliveries` records for the same shape
    #: of mistake.
    #:
    #: ⚠️ DELIBERATELY NOT MIRRORED IN `src/agent/agentTypes.ts`, unlike
    #: `deliveries` beside it (/dry-audit, 2026-08-28). The mirror exists so a
    #: value the backend owns cannot arrive at the tablet and render as
    #: something else; this field renders nowhere and never should — it is the
    #: plumbing that lets a chat message be edited later, and putting it on the
    #: SPA's interface would invite somebody to display a message id. Recorded
    #: here so the next audit does not re-adjudicate it as a hole in the mirror.
    messages: List[Dict[str, str]] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id, "subject_key": self.subject_key,
            "run_id": self.run_id, "deliveries": list(self.deliveries),
            "title": self.title, "body": self.body,
            "severity": self.severity, "audience": self.audience,
            "confidence": self.confidence, "state": self.state,
            "opened_at": self.opened_at, "updated_at": self.updated_at,
            "evidence": list(self.evidence), "supersedes": list(self.supersedes),
            "outcome": self.outcome, "delivered_at": self.delivered_at,
            "acknowledged_at": self.acknowledged_at,
            "acknowledged_by": self.acknowledged_by,
            "informational": self.informational, "flag_type": self.flag_type,
            "useful": self.useful, "useful_at": self.useful_at,
            "useful_note": self.useful_note,
            "messages": [dict(m) for m in self.messages],
        }


def _now_iso(now: Optional[float] = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))


def seconds_since(stamp: str, now: Optional[float] = None) -> float:
    """Seconds between one of THIS module's stamps and now. Never raises.

    ⚠️ IT LIVES BESIDE `_now_iso` BECAUSE THAT IS WHAT WROTE THE STAMP. The
    reader and the writer of a format belong in one file, or the day the format
    moves only one of them follows. `outbox._minutes_since` was a second parse
    of the same string in another module and now calls this.

    ⚠️ A MALFORMED STAMP READS AS 0, AND THE SAFE DIRECTION HAPPENS TO BE THE
    SAME FOR BOTH CALLERS — which is luck worth stating rather than relying on.
    For escalation, 0 puts the concern inside the first band and escalates
    nothing: a parse failure must not be able to page somebody at three in the
    morning. For verification, 0 is younger than the watch window, so the
    concern is skipped and looked at again next pass: a parse failure must not
    be able to certify a fix nobody checked. A future caller for whom 0 is the
    DANGEROUS direction must say so at its own call site, not change this.
    """
    try:
        parsed = time.strptime(str(stamp).strip(), "%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, TypeError):
        return 0.0
    seconds = (now if now is not None else time.time()) - calendar.timegm(parsed)
    return max(0.0, seconds)


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
    stage("concern", f"{out.id} opened: {out.severity} {out.title[:60]}")
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


def note_message(concern_id: str, entity_id: str, message_id: str,
                 acts: str = "") -> bool:
    """Remember a chat message carrying this alert's buttons. See `messages`.

    ⚠️ IT REFUSES A MESSAGE WITH NO ID, because the only thing a ref is FOR is
    editing that message later and an unidentified one can never be edited.
    Storing it anyway would grow a list of things that look retirable and are
    not, and `buttons.reconcile` would walk them on every tick forever.

    ⚠️ `acts` IS WHAT THE MESSAGE IS SHOWING — the comma-joined act ids, as
    `buttons.Ref.acts`. Without it reconciliation can only ask "is this alert
    settled" and never "has what it offers changed", which is the transition an
    acknowledgement makes and the one that shipped unhandled (2026-08-28).
    """
    if not str(message_id or "").strip() or not str(entity_id or "").strip():
        return False
    rows = read()
    for row in rows:
        if str(row.get("id")) != str(concern_id):
            continue
        refs = row.get("messages")
        if not isinstance(refs, list):
            refs = []
        refs.append({"entity_id": str(entity_id),
                     "message_id": str(message_id),
                     "acts": str(acts or "")})
        # ⚠️ BOUNDED, like every list in this store. A villa escalating the same
        # alert repeatedly must not grow one row without limit.
        row["messages"] = refs[-MAX_MESSAGE_REFS:]
        return _write(rows)
    return False


def stamp_message(concern_id: str, message_id: str, acts: str) -> bool:
    """Record what ONE message is now showing, after its buttons were changed.

    ⚠️ THE PAIR OF `forget_message`: a press either ends a message (forget) or
    changes what it offers (stamp). Leaving the old stamp behind would make
    `buttons.reconcile` believe the phone is a set of buttons behind, and redraw
    it on the next tick for no reason, for the life of the alert.
    """
    if not str(message_id or "").strip():
        return False
    for row in read():
        if str(row.get("id")) != str(concern_id):
            continue
        refs = row.get("messages")
        if not isinstance(refs, list):
            return False
        return set_messages(concern_id,
                            [{**r, "acts": str(acts or "")}
                             if str(r.get("message_id") or "") == str(message_id)
                             else r
                             for r in refs if isinstance(r, Mapping)])
    return False


def forget_message(concern_id: str, message_id: str) -> bool:
    """Stop tracking ONE message — it has been retired and cannot change again.

    ⚠️ ONE, NOT ALL. An escalated alert has a message in more than one chat, and
    a press in the facility manager's chat says nothing about the copy in the
    owner's: that one still carries live buttons and must still be reconciled.
    Clearing the list here would abandon it.
    """
    if not str(message_id or "").strip():
        return False
    for row in read():
        if str(row.get("id")) != str(concern_id):
            continue
        refs = row.get("messages")
        if not isinstance(refs, list):
            return False
        return set_messages(concern_id,
                            [r for r in refs if isinstance(r, Mapping)
                             and str(r.get("message_id") or "") != str(message_id)])
    return False


def set_messages(concern_id: str,
                 refs: Sequence[Mapping[str, str]]) -> bool:
    """Replace the remembered messages — how `buttons.reconcile` forgets one.

    ⚠️ REPLACE RATHER THAN CLEAR, because a reconciliation that could not reach
    Telegram must KEEP the messages it failed to retire and try again. A `clear`
    verb would make "I gave up" the easy call to write.

    ⚠️ IT REBUILDS EACH REF FIELD BY FIELD, SO A FIELD IT DOES NOT NAME IS
    DISCARDED IN SILENCE — which is how `acts` was lost on its first run: the
    caller stamped it, this dropped it, and reconciliation redrew the same
    message on every tick because the stamp never survived the write. A new key
    on a ref belongs in this list. The rebuild stays (it is what stops a caller
    persisting arbitrary junk into the store) but it is a list to MAINTAIN, not
    a filter to trust.
    """
    rows = read()
    for row in rows:
        if str(row.get("id")) != str(concern_id):
            continue
        kept = [{"entity_id": str(r.get("entity_id") or ""),
                 "message_id": str(r.get("message_id") or ""),
                 "acts": str(r.get("acts") or "")}
                for r in refs if isinstance(r, Mapping)]
        if kept == (row.get("messages") or []):
            # ⚠️ NO WRITE WHEN NOTHING MOVED. This runs on the chase clock over
            # every alert, and rewriting the store each tick would churn the
            # disk on a villa where nothing is happening.
            return True
        row["messages"] = kept
        return _write(rows)
    return False


# ── verification ────────────────────────────────────────────────────────────
@dataclass
class Verification:
    concern_id: str
    verdict: str            # verified | recurred | cannot_verify
    reason: str = ""


def verify(concern_id: str, *, recurred: bool, coverage_complete: bool,
           recurred_as: str = "", now: Optional[float] = None) -> Verification:
    """Did the fix hold? TASK-046.

    ⚠️ COVERAGE FIRST, AND IT IS NOT A DETAIL. "It did not recur" and "I was not
    listening" are the same empty observation and opposite facts. Reusing
    `collect.coverage`'s "listening throughout" gate is what stops this becoming
    the fourth place in this codebase to claim health from silence — and it is
    checked BEFORE `recurred`, because a recurrence seen during partial coverage
    is still a real recurrence while an absence during partial coverage is
    nothing at all.

    ⚠️ A RECURRENCE RECORDS, IT DOES NOT RESURRECT (2026-08-28). This used to
    write `state = "open"`, and it was written before anything called it — when
    it was finally given a caller, that transition turned out to produce a state
    the store's own write path REFUSES. `raise_concern` rejects a second open
    concern about a subject that already has one, deliberately; a recurrence is
    detected precisely BECAUSE a successor concern exists, so re-opening the old
    one puts two open cards on one subject behind the back of the rule that
    forbids exactly that. And if the successor has itself since been settled,
    re-opening leaves a card standing for a problem nobody has.

    ⚠️ THE LIVE PROBLEM IS THE SUCCESSOR, WHICH WAS INVESTIGATED AND DELIVERED
    ON ITS OWN MERITS. What the old concern is for is the RECORD — this fix did
    not hold — and that is what `outcome` now carries, naming the concern that
    came back so the two are joined rather than merely adjacent. Telling anybody
    again would be a third message about one fact.
    """
    if recurred:
        transition(concern_id, "closed", now=now,
                   outcome=("the fix did not hold" +
                            (f" — it came back as {recurred_as}"
                             if recurred_as else "")))
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


#: How long a closed concern is watched before its fix is judged.
#: ⚠️ SEVEN DAYS, AND BOTH BOUNDS ARE REASONED. Long enough that a recurrence
#: would plausibly have happened: a villa's rhythm is weekly (weekday against
#: weekend occupancy, a cleaning visit, a pool cycle), so a shorter window
#: certifies a fix that has not yet met the conditions that broke it. Short
#: enough to sit well inside the observation journal, which the heartbeat
#: measured at ~14 days on the reference property — a window LONGER than the
#: ring would ask `coverage` about a period the journal no longer holds, and
#: every verdict would be `cannot_verify` forever.
VERIFY_AFTER_HOURS: int = 168

#: What a concern's `outcome` reads once the sweep has given up on it.
#: ⚠️ A `cannot_verify` VERDICT IS PERMANENT, AND THAT IS A FACT ABOUT COVERAGE
#: RATHER THAN A CONVENIENCE. `coverage(settled_at)` compares the collector's
#: persisted `online_since` against a moment in the PAST, and `online_since` is
#: written once at the first successful subscribe and never cleared — so the
#: answer for a fixed window can never improve. It can only get worse (a wiped
#: `/data` re-dates it LATER, i.e. less coverage), and no re-examination could
#: ever turn this verdict into `verified`.
#:
#: ⚠️ SO IT IS RECORDED, WHICH TAKES THE ROW OUT OF THE CANDIDATE SET. Without
#: it the sweep re-asked an unanswerable question about the same rows four
#: times a day forever, and its log line had to be suppressed to stop it
#: printing an identical sentence into the add-on log — an instrument silenced
#: because of what it was measuring, which is how a subsystem goes quiet
#: without going away.
UNVERIFIABLE: str = "could not verify"


@dataclass
class VerificationSweep:
    """What one pass of `verification_sweep` decided."""

    verified: int = 0
    recurred: int = 0
    cannot_verify: int = 0
    considered: int = 0

    def line(self) -> str:
        return (f"considered {self.considered}, verified {self.verified}, "
                f"recurred {self.recurred}, could not verify "
                f"{self.cannot_verify}")

    def changed(self) -> bool:
        """Did anything move? ⚠️ ALL THREE VERDICTS COUNT, because each is
        written down exactly once — see `UNVERIFIABLE`. An earlier cut excluded
        `cannot_verify` on the grounds that it "recurs on every pass by
        design"; that was true of that cut and is what made this sweep
        unobservable on a live villa, which is the shape of instrument this
        repository has been caught by five times."""
        return bool(self.verified or self.recurred or self.cannot_verify)


def _superseded_ids(rows: Sequence[Mapping[str, Any]]) -> Set[str]:
    """Ids that were closed by being REPLACED rather than by being dealt with.

    ⚠️ STRUCTURAL, NOT A STRING MATCH ON `outcome`. `_supersede_rows` writes
    "superseded by cN" there, and reading that back would make the rule depend
    on prose a future edit is free to rephrase. The successor's `supersedes`
    list is the record, and it is the same field the card renders.
    """
    out: Set[str] = set()
    for row in rows:
        for victim in (row.get("supersedes") or []):
            out.add(str(victim))
    return out


def verification_sweep(rows: Optional[Sequence[Mapping[str, Any]]] = None, *,
                       coverage_of: Optional[Any] = None,
                       now: Optional[float] = None) -> VerificationSweep:
    """Did the fixes hold? The caller TASK-046 specified and never wrote.

    ⚠️ THE FUNCTION BELOW IT HAD NO CALLER FOR ITS WHOLE EXISTENCE, which
    `test_reachability` recorded as BLOCKED rather than exempt — a finding, not
    a decision. The consequence was visible on the Reason tab the entire time:
    "Fixed and confirmed" is the one count on that screen that says something
    actually WORKED, and nothing could ever make it anything but zero.

    ⚠️ ONLY `closed` IS A CANDIDATE, and each exclusion is a different claim.
    `dismissed` means a person said it did not matter — re-examining it could
    only re-open something they asked to be rid of, which is the alert fatigue
    this whole system exists to remove. `verified` has already been judged.
    `open` and `acted` have not been settled, so there is no fix to hold.

    ⚠️ AND AN INFORMATIONAL CONCERN IS NOT VERIFIED EITHER. Nothing was asked of
    anybody, so there was no action whose success could be in question; a
    "fixed and confirmed" count inflated by FYIs would say work was done that
    nobody did.

    ⚠️ A SUPERSEDED CONCERN IS NOT A FIXED ONE. It was closed because the model
    judged a later concern to be the same standing condition — the problem was
    never resolved, it was re-described. Counting those as verified would put
    the villa's worst-behaved subjects at the top of the one count that is
    supposed to mean something improved.

    ⚠️ RECURRENCE IS READ FROM THE STORE, NOT RE-DETECTED. A later concern about
    the same subject IS the recurrence, and it arrived through the ordinary
    path — investigated, judged and delivered on its own merits. Asking the
    villa a second time would be a second opinion on a question already
    answered, and telling anybody would be a third message about one fact.
    """
    source = list(read() if rows is None else rows)
    coverage = coverage_of if coverage_of is not None else _coverage
    superseded = _superseded_ids(source)
    out = VerificationSweep()

    for row in source:
        if str(row.get("state") or "") != "closed":
            continue
        if bool(row.get("informational")):
            continue
        if str(row.get("id")) in superseded:
            continue
        # ⚠️ ALREADY GIVEN UP ON. See `UNVERIFIABLE` — the answer cannot change,
        # so asking again is cost with no possible new information.
        if str(row.get("outcome") or "").startswith(UNVERIFIABLE):
            continue
        settled_at = str(row.get("updated_at") or "")
        age_h = seconds_since(settled_at, now) / 3600.0
        if age_h < VERIFY_AFTER_HOURS:
            continue

        out.considered += 1
        came_back_as = _recurred_after(str(row.get("subject_key") or ""),
                                       settled_at, str(row.get("id")), source)
        # ⚠️ COVERAGE IS ASKED ABOUT THE WATCH WINDOW, WHICH STARTS WHEN THE
        # CONCERN WAS CLOSED — not about the last seven days. Those differ for
        # every concern the sweep is late to, and the window that matters is
        # the one the claim is about.
        try:
            complete = bool(coverage(settled_at).get("complete"))
        except Exception:  # noqa: BLE001
            # ⚠️ AN UNREADABLE COVERAGE ANSWER IS `cannot_verify`, NEVER
            # `verified`. "I could not find out whether I was listening" and "I
            # was listening" are the same empty result and opposite facts —
            # this module's founding sentence, applied to its own dependency.
            complete = False
        verdict = verify(str(row.get("id")), recurred=bool(came_back_as),
                         coverage_complete=complete,
                         recurred_as=came_back_as, now=now)
        if verdict.verdict == "verified":
            out.verified += 1
        elif verdict.verdict == "recurred":
            out.recurred += 1
        else:
            # ⚠️ WRITTEN DOWN SO IT IS NOT ASKED AGAIN, and `verify` is left
            # alone: its contract is that an unverifiable concern does not move
            # STATE, which is right and is separately pinned. This records the
            # attempt beside the state, the way an acknowledgement does.
            transition(str(row.get("id")), str(row.get("state")), now=now,
                       outcome=f"{UNVERIFIABLE} — {verdict.reason}")
            out.cannot_verify += 1

    if out.changed():
        stage("verify", out.line())
    return out


def _coverage(since_iso: str) -> Mapping[str, Any]:
    """The observation floor's own coverage gate. ⚠️ IMPORTED AT CALL TIME so
    that a test can hand `verification_sweep` a stand-in without patching a
    module attribute, and so this module keeps no import-time dependency on the
    collector."""
    from vesta.adapters import collect
    return collect.coverage(since_iso)


def _recurred_after(subject_key: str, settled_at: str, own_id: str,
                    rows: Sequence[Mapping[str, Any]]) -> str:
    """The id of the concern that came back, or "" if none did.

    ⚠️ IT RETURNS THE ID RATHER THAN A BOOLEAN because the record is the whole
    point: "the fix did not hold" is worth much less to a reader than "the fix
    did not hold — it came back as c9", which is the difference between a
    verdict and a thread they can follow.

    ⚠️ AN EMPTY SUBJECT KEY CAN NEVER RECUR. `subject_key` is a hash of an
    entity id where the investigation identified one and a topic hash where it
    did not, so two topic-keyed concerns about "coverage incomplete" share a
    key legitimately — but a concern with NO key at all would match every other
    keyless one, and a whole class of findings would certify each other as
    recurrences. Absent means unknown, and unknown is not a match.

    ⚠️ THE EARLIEST SUCCESSOR, NOT THE LATEST. If a subject failed three times,
    the fix under judgement is the one that the FIRST return disproved; naming
    the most recent would credit this concern's fix with holding through
    failures it did not survive.
    """
    if not subject_key:
        return ""
    after = sorted(str(r.get("id")) for r in rows
                   if str(r.get("subject_key") or "") == subject_key
                   and str(r.get("id")) != own_id
                   and str(r.get("opened_at") or "") > settled_at)
    return after[0] if after else ""


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

    ⚠️ "USEFUL" IS STAMPED BESIDE THE STATE AND DOES NOT TRANSITION (2026-08-27,
    reported by the owner: pressing the thumb UP made the card vanish). It used
    to write `state = "verified"`, and `verified` is SETTLED — so saying "good
    call, thank you" retired a concern nobody had acted on and nobody had even
    acknowledged. Two writers had been giving one state two meanings: the
    verification path below writes it for "the condition did not recur", which
    is a claim about the VILLA, and this wrote it for "you were right to tell
    me", which is a claim about the SUPERVISOR. The second is not a lifecycle
    event at all, so it is now recorded the way an acknowledgement is — fields
    beside an untouched state.

    ⚠️ THE PROSE ABOVE DELIBERATELY DOES NOT WRITE THAT FUNCTION'S NAME WITH
    PARENTHESES. `test_reachability` skips `#` comments but not docstrings, so
    a mention shaped like a call reads as a caller — and that function is on
    the EXEMPT map precisely because it has never had one.

    ⚠️ "NOT USEFUL" STILL TRANSITIONS, AND THE ASYMMETRY IS THE POINT. "Stop
    telling me this" is a request to retire the concern AND the signal
    `dismissals_of` counts toward suppressing the subject; "good call" is a
    compliment that changes nothing about whether the villa still has the
    problem.
    """
    note = str(reason or "").strip()
    outcome = (f"marked {'useful' if useful else 'not useful'}"
               + (f": {note}" if note else ""))
    if not useful:
        return transition(concern_id, "dismissed", outcome=outcome, now=now)

    rows = read()
    for row in rows:
        if str(row.get("id")) != str(concern_id):
            continue
        row["useful"] = True
        row["useful_at"] = _now_iso(now)
        # ⚠️ THE NOTE GOES IN ITS OWN FIELD, NOT IN `outcome`. `outcome` means
        # "why it left open", and this concern has not left.
        if note:
            row["useful_note"] = note
        row["updated_at"] = _now_iso(now)
        ok = _write(rows)
        return ok, "" if ok else "the concern store could not be written"
    return False, f"no concern {concern_id!r}"


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
