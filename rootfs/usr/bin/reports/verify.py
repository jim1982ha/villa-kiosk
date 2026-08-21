"""Closing the loop: a problem reported, acted on, and gone.

This is what turns a report into a RECORD. "The house pump has been
short-cycling" is a measurement; "the house pump was short-cycling, somebody
serviced it on the 9th, and it has not done it since" is a story with an end,
and it is the one thing here that cannot be got from Home Assistant by looking.

⚠️ A VERIFICATION IS A CLAIM ABOUT SOMETHING NOT HAPPENING, WHICH IS THE MOST
DANGEROUS KIND OF CLAIM THIS SUBSYSTEM MAKES. Everything else in the report says
"this occurred, here is the measurement". This says "this stopped" — inferred
from an ABSENCE — and an absence has three causes, only one of which is a
repair:

    the problem was fixed          ...the claim
    the rule stopped being able to evaluate
    nobody was listening

So all three of these must hold before anything is said, and the third is a hard
gate rather than a caveat:

  1. it happened BEFORE this period      (from the collector's own ring)
  2. somebody DID something              (a completed caretaker task, or a
                                          resolved Facility Manager ticket)
  3. it has not happened SINCE           (and the collector was up throughout)

Two of the three would be a guess dressed as a conclusion. A repair with no
prior occurrence is somebody tidying the list; a silence with no repair is a
quiet fortnight.

⚠️ NO ENTITY ID LEAVES THIS MODULE. The Facility Manager join runs ON entity
ids — a ticket names the device it was about, and so does the event — but the
`Finding` it produces carries the report bucket and a hashed `dedup_key`, the
same boundary `aggregate.to_findings` keeps. The join is internal; the claim is
not.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from .analysis.base import Finding, dedup_key
from .ledger import resolved_tickets_for

#: How the evidence is described, per route. Kept as prose rather than a code so
#: the renderer never has to translate one — and so the reader is told WHICH
#: kind of evidence this is, because "the caretaker ticked it off" and "a ticket
#: was closed with a cost against it" are different strengths of claim.
#: ⚠️ "FACILITY MANAGER", NEVER "CARETAKER" — the owner's standing rule, and
#: this string is the one that slipped through it. The kiosk names the role that
#: way everywhere (workspace, permission, profile), so a brief using a second
#: word for the same person reads as a different person. Reported twice: once as
#: the rule, and once when this line reached a delivered brief anyway.
#: The blueprints' own `caretaker_todo_list` input keeps its name — that is the
#: operator's YAML, not prose anybody reads. `test_no_reader_sees_caretaker`
#: pins the distinction so the next string cannot slip the same way.
#: ⚠️ SUBJECT-FREE, SO IT READS FOR ONE ITEM OR A GROUP. When several
#: verifications share the same evidence the renderer HOISTS this clause above
#: them and prints it once — and "the Facility Manager marked IT done" then
#: refers to three things at once, which a delivered brief showed. A clause with
#: no pronoun is correct in both positions and needs no plural variant.
EVIDENCE_TASK = "marked done by the Facility Manager"
EVIDENCE_TICKET = "closed with a maintenance ticket"


def _day(iso: str) -> str:
    """A date a person writes: "21 Aug". Empty when there is nothing to say.

    ⚠️ NOT THE ISO FORM. "up to 2026-08-21" mid-sentence is a machine's date in
    a human's paragraph, and the brief is read on a phone.
    """
    try:
        return datetime.fromisoformat(str(iso)).strftime("%-d %b")
    except (TypeError, ValueError):
        return ""


def _key(item: Any) -> str:
    """The rule this occurrence belongs to. Same join as `ledger.reconcile`."""
    return str(getattr(item, "rule_id", "") or "").strip()


def _entities(item: Any) -> List[str]:
    value = getattr(item, "entities", None)
    return [str(e) for e in value] if isinstance(value, (list, tuple)) else []


def verify(prior: Sequence[Any],
           current: Sequence[Any],
           completed_tasks: Sequence[Dict[str, str]],
           fm_data: Optional[Dict[str, Any]] = None,
           *,
           listening_throughout: bool = True) -> List[Finding]:
    """Findings for problems that were reported, acted on, and have stopped.

    `prior` and `current` are normalised `aggregate.Item`s from before and
    inside the reporting window. `completed_tasks` comes from
    `ledger.todo_tasks(..., status="completed")`.

    ⚠️ `listening_throughout` IS A GATE, NOT A QUALIFIER. If the collector was
    down for part of the period then "it has not happened since" is a statement
    about the LISTENER, not about the villa, and no wording makes that safe to
    print. Returning nothing is the honest outcome — the coverage section
    already says the listener was down, which is the true finding.
    """
    if not listening_throughout:
        return []

    done_by_rule = {
        str(task.get("rule_id") or "").strip(): str(task.get("text") or "")
        for task in completed_tasks
        if isinstance(task, dict) and str(task.get("rule_id") or "").strip()
    }
    recurring = {_key(item) for item in current if _key(item)}

    # Oldest-first so the label and entity set come from the first occurrence
    # and the count is of the whole run.
    by_rule: Dict[str, List[Any]] = {}
    for item in prior:
        rule = _key(item)
        if rule:
            by_rule.setdefault(rule, []).append(item)

    findings: List[Finding] = []
    for index, (rule, items) in enumerate(sorted(by_rule.items())):
        if rule in recurring:
            continue  # still happening; not a repair

        evidence, closed_at, cost_id = _evidence(rule, items, done_by_rule, fm_data)
        if evidence is None:
            continue  # nothing was done; this is a quiet fortnight, not a fix

        bucket = str(getattr(items[0], "bucket", "") or "")
        label = str(getattr(items[0], "label", "") or "") or bucket
        occurrences = len(items)
        last_seen = max((str(getattr(i, "when", "") or "") for i in items),
                        default="")

        findings.append(Finding(
            ref=f"v{index}",
            kind="VERIFICATION",
            severity="info",
            label=label or rule,
            detail=_sentence(occurrences, last_seen, evidence, closed_at, cost_id),
            # ⚠️ THE SAME SUBJECT `aggregate` HASHES, so a verification and the
            # finding it closes share a dedup key and a reader can see they are
            # the same thing across two reports.
            dedup_key=dedup_key("verify", f"{rule}|{bucket}"),
        ))
    return findings


def _evidence(rule: str, items: Sequence[Any], done_by_rule: Dict[str, str],
              fm_data: Optional[Dict[str, Any]]
              ) -> tuple[Optional[str], str, str]:
    """What was done about this rule, if anything.

    ⚠️ THE TICKET IS THE STRONGER EVIDENCE AND IS CHECKED FIRST. A completed
    todo item means somebody ticked a box; a resolved Facility Manager ticket
    means somebody recorded a repair, with a date and often a cost against it.
    Where both exist the report should say the stronger thing.
    """
    if fm_data:
        for entity_id in _entities(items[0]):
            for ticket in resolved_tickets_for(fm_data, entity_id):
                return (EVIDENCE_TICKET,
                        str(ticket.get("resolvedAt") or ""),
                        str(ticket.get("costId") or ""))
    if rule in done_by_rule:
        return (EVIDENCE_TASK, "", "")
    return (None, "", "")


def _sentence(occurrences: int, last_seen: str, evidence: str,
              closed_at: str, cost_id: str) -> str:
    """The claim, with every qualifier it has earned and none it has not.

    ⚠️ "HAS NOT RECURRED SINCE" IS THE STRONGEST FORM PERMITTED, and it is not
    "fixed". The report observed an absence over one period; it did not inspect
    the pump. A reader who is told "resolved" and finds it broken next week
    stops reading the report, and there is no way to earn that word back.
    """
    # ⚠️ SENTENCES, NOT A CHAIN OF SEMICOLONS. This rendered as "reported once
    # up to 2026-08-21; the caretaker marked the job done; has not recurred
    # since" — three clauses welded together, an ISO date mid-prose, and no
    # subject on the last one. Reported as "very badly rendered text". Each
    # clause answers a different question (how often, who acted, what since),
    # so each gets a sentence and the date gets a form people write.
    times = f"{occurrences} times" if occurrences != 1 else "once"
    when = f", last on {_day(last_seen)}" if _day(last_seen) else ""
    closed = f" on {_day(closed_at)}" if _day(closed_at) else ""
    # ⚠️ THE COST ITSELF IS NOT PRINTED. `costId` is a reference into the
    # Facility Manager store; resolving it here would put an operator's own
    # figures into prose that Phase 6 may send onward, and `ledger.py`'s third
    # rule is that free text and totals do not travel from that store.
    priced = ", with a cost recorded against it" if cost_id else ""
    return (f"reported {times}{when}. "
            f"{evidence[0].upper()}{evidence[1:]}{closed}{priced}, "
            f"with no recurrence since.")
