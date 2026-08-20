"""The verification loop: reported, acted on, and gone.

⚠️ EVERY TEST HERE GUARDS A CLAIM ABOUT SOMETHING NOT HAPPENING, which is the
most dangerous kind this subsystem makes. Every other finding says "this
occurred, here is the measurement"; a verification says "this stopped", inferred
from an ABSENCE — and an absence has three causes, only one of which is a
repair. The negative cases below are therefore the point of the file, not its
edge cases.
"""

from __future__ import annotations

from typing import Any, Dict, List

from reports import aggregate, verify

WHEN_OLD = "2026-07-01T10:00:00+08:00"
WHEN_NEW = "2026-08-20T10:00:00+08:00"


def _item(rule: str = "PM-02", *, when: str = WHEN_OLD,
          bucket: str = "Pump short-cycling",
          entity: str = "sensor.house_pump_power") -> Any:
    event = {"type": "vesta_maintenance_event", "fired": when, "at": when,
             "data": {"blueprint": "maintenance_cycling", "rule_id": rule,
                      "report_bucket": bucket, "entities": [entity],
                      "task_text": "Check the valve", "timestamp": when}}
    item = aggregate.normalise(event)
    assert item is not None
    return item


def _done(rule: str = "PM-02") -> List[Dict[str, str]]:
    return [{"rule_id": rule, "text": "Check the valve"}]


def _fm(entity: str = "sensor.house_pump_power", *, cost: str = "c1") -> Dict[str, Any]:
    return {"tickets": [{"entityId": entity, "resolvedAt": "2026-08-09T09:00:00+08:00",
                         "costId": cost, "description": "replaced the check valve"}]}


# ── the claim ────────────────────────────────────────────────────────────────

def test_reported_then_done_then_quiet_is_a_verification() -> None:
    found = verify.verify([_item()], [], _done(), None)
    assert len(found) == 1
    assert found[0].kind == "VERIFICATION"
    assert "has not recurred since" in found[0].detail


def test_a_resolved_ticket_is_evidence_too() -> None:
    found = verify.verify([_item()], [], [], _fm())
    assert len(found) == 1
    assert "maintenance ticket was closed" in found[0].detail


def test_the_ticket_is_preferred_over_a_ticked_box() -> None:
    """⚠️ A completed todo item means somebody ticked a box; a resolved ticket
    means somebody recorded a repair, with a date and often a cost."""
    found = verify.verify([_item()], [], _done(), _fm())
    assert "maintenance ticket was closed" in found[0].detail
    assert "marked the job done" not in found[0].detail


def test_a_recorded_cost_is_mentioned_but_never_printed() -> None:
    """⚠️ `costId` is a REFERENCE into the Facility Manager store. Resolving it
    would put an operator's own figures into prose Phase 6 may send onward, and
    `ledger.py`'s third rule is that totals do not travel from that store."""
    found = verify.verify([_item()], [], [], _fm(cost="c1"))
    assert "with a cost recorded against it" in found[0].detail
    assert "c1" not in found[0].detail


# ── the three ways it must refuse ────────────────────────────────────────────

def test_still_happening_is_not_a_repair() -> None:
    found = verify.verify([_item()], [_item(when=WHEN_NEW)], _done(), _fm())
    assert found == []


def test_silence_with_no_repair_is_a_quiet_fortnight() -> None:
    """Two of the three conditions is a guess dressed as a conclusion."""
    assert verify.verify([_item()], [], [], None) == []


def test_a_repair_with_no_prior_occurrence_is_somebody_tidying_the_list() -> None:
    assert verify.verify([], [], _done(), _fm()) == []


def test_nothing_is_claimed_when_the_collector_was_down() -> None:
    """⚠️ A HARD GATE, NOT A QUALIFIER. If the listener was down for part of the
    period then "it has not happened since" is a statement about the LISTENER,
    not the villa, and no wording makes that safe to print. The coverage section
    already says the listener was down — that is the true finding."""
    assert verify.verify([_item()], [], _done(), _fm(),
                         listening_throughout=False) == []


# ── what must not travel ─────────────────────────────────────────────────────

def test_no_entity_id_survives_into_the_finding() -> None:
    """⚠️ The Facility Manager join RUNS on entity ids — a ticket names the
    device and so does the event — but the claim must not carry one."""
    import json
    found = verify.verify([_item()], [], _done(), _fm())
    rendered = json.dumps([f.__dict__ for f in found])
    assert "sensor.house_pump_power" not in rendered
    assert "replaced the check valve" not in rendered, "ticket free text"


def test_the_dedup_key_ties_it_to_the_finding_it_closes() -> None:
    """A verification and the problem it closes should be recognisable as the
    same subject across two reports."""
    a = verify.verify([_item()], [], _done(), None)[0]
    b = verify.verify([_item(when="2026-06-01T10:00:00+08:00")], [], _done(), None)[0]
    assert a.dedup_key == b.dedup_key
    assert "PM-02" not in a.dedup_key, "the subject is hashed"


# ── wording ──────────────────────────────────────────────────────────────────

def test_the_word_fixed_is_never_used() -> None:
    """⚠️ "HAS NOT RECURRED SINCE" IS THE STRONGEST FORM PERMITTED. The report
    observed an absence over one period; it did not inspect the pump. A reader
    told "resolved" who finds it broken next week stops reading the report, and
    there is no way to earn that word back."""
    found = verify.verify([_item()], [], _done(), _fm())
    lowered = found[0].detail.lower()
    for forbidden in ("fixed", "resolved", "repaired", "no longer a problem"):
        assert forbidden not in lowered, f"{forbidden!r} overclaims"


def test_a_single_occurrence_reads_as_english() -> None:
    assert "reported once" in verify.verify([_item()], [], _done(), None)[0].detail


def test_several_occurrences_are_counted() -> None:
    found = verify.verify([_item(), _item(), _item()], [], _done(), None)
    assert "reported 3 times" in found[0].detail


# ── the rendered result ──────────────────────────────────────────────────────

def test_a_verification_reaches_the_report() -> None:
    """`SECTION_FOR_KIND` routes VERIFICATION to "Fixed and suggested", and
    that section reads module findings — both pinned in test_sections."""
    from reports.narrate import DeterministicNarrator, ReportContext
    found = verify.verify([_item()], [], _done(), None)
    context = ReportContext(
        audience="owner", cadence="weekly", period="P",
        generated_at="2026-08-21T02:00:00+08:00",
        discovery={"reachable": True, "capabilities": [],
                   "capabilities_missing": [], "capability_absent": {},
                   "preflight": []},
        findings=[f.as_dict() for f in found])
    body = DeterministicNarrator().render(context)[1]
    assert "Pump short-cycling" in body
    assert "has not recurred since" in body
    assert "nothing has been assessed" not in body


def test_a_verification_gets_its_own_heading() -> None:
    """⚠️ It rendered as a bare bullet above "Raised for the caretaker",
    orphaned under nothing. A verification is the one line in the report that
    says a story ENDED, which is exactly the line a reader should be able to
    find."""
    from reports.narrate import DeterministicNarrator, ReportContext
    found = verify.verify([_item()], [], _done(), None)
    body = DeterministicNarrator().render(ReportContext(
        audience="owner", cadence="weekly", period="P",
        generated_at="2026-08-21T02:00:00+08:00",
        discovery={"reachable": True, "capabilities": [],
                   "capabilities_missing": [], "capability_absent": {},
                   "preflight": []},
        findings=[f.as_dict() for f in found]))[1]
    lines = body.splitlines()
    bullet = next(i for i, ln in enumerate(lines) if ln.startswith("- "))
    assert lines[bullet - 1] == "Followed up:", (
        "the verification bullet has no heading above it")
