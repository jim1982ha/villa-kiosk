"""A true line the reader cannot act on is still a defect.

⚠️ SIX QUESTIONS ABOUT ONE DELIVERED BRIEF, ALL FAIR, NONE ANSWERABLE FROM IT.
The owner read a report on 2026-08-21 and asked, in order: what does 2,146 stand
for; which alerts; what does "Re-enable, or document as a deliberate decision"
mean and how is it relevant; are you sure about the older alert format; are you
sure these automations are off — "I am worried there is a more serious issue
here, as I doubt this recommendation is legit."

Every finding was TRUE. Checked against the live instance one by one: the amount
was Indonesian Rupiah at the villa's own configured tariff of 1700/kWh; the
three alerts were the three listed with their durations two sections above; a
guarded P1/P2 automation genuinely was switched off; the drift was real. The
report had earned none of that trust, because in each case it named the rule
FAMILY and dropped the SUBJECT — and a reader who cannot verify a line has to
choose between believing it and ignoring it.

⚠️ AND THE DATA WAS ALWAYS THERE. `Group.entities` had been exposing the entity
ids since the module was written and nothing called it; `open_tasks` dropped
them; `get_config` returned the currency beside the version and it was thrown
away. Not one of these fixes needed a new source.

⚠️ THE NAMES COME FROM `labels`, NOT THE IDS. The automation behind the loudest
of those questions is `automation.outdoor_unified_doorbell_call_and_unlock` and
displays as `critical_doorbell---parking_gate`. The id is a stale slug from
before it was renamed, so it is the ONE form in which the word "critical" is
invisible — which is exactly how I answered the question by hand, and why the
answer did not land.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from reports import aggregate as agg                              # noqa: E402
from reports.narrate import DeterministicNarrator, ReportContext  # noqa: E402
from reports.narrate.deterministic import _amount                 # noqa: E402

#: Verbatim from `ha_get_automation_traces` on the reference villa, 08:00 scan.
AUDIT_EVENT = {
    "type": "vesta_audit_event", "at": "2026-08-21T08:00:00+08:00",
    "data": {
        "blueprint": "audit_config_integrity", "rule_id": "DQ-02/DQ-03",
        "report_bucket": "Critical automation health",
        "entities": ["automation.outdoor_unified_doorbell_call_and_unlock"],
        "finding": "critical_automation_off",
        "task_text": "Re-enable, or document as a deliberate, intentional decision.",
        "timestamp": "2026-08-21T08:00:00+08:00"},
}
#: A `critical_*` payload with no `blueprint` field — the drift, as it arrives.
LEGACY_CRITICAL = {
    "type": "vesta_critical_event", "at": "2026-08-21T09:00:00+08:00",
    "data": {"report_bucket": "Pool pump schedule", "severity": "P1",
             "label": "Critical schedule — pool pump", "phase": "raised",
             "entity_id": "sensor.pool_pump_power"},
}
DISPLAY_NAME = "critical_doorbell---parking_gate"
LABELS = {"automation.outdoor_unified_doorbell_call_and_unlock": DISPLAY_NAME}


def _render(events: List[Dict[str, Any]], **kw: Any) -> str:
    context = ReportContext(
        audience="owner", cadence="daily", period="2026-08-21",
        generated_at="2026-08-21T18:20:00+08:00",
        discovery={"reachable": True, "capabilities": [], "capabilities_missing": [],
                   "capability_absent": {}, "preflight": []},
        aggregated=agg.aggregate(events), **kw)
    return DeterministicNarrator().render(context)[1]


# ── "what does 2,146 stand for?" ─────────────────────────────────────────────

def test_an_amount_carries_the_currency_home_assistant_knows() -> None:
    assert _amount(2146.0, currency="IDR") == "2,146 IDR"


def test_an_unset_currency_still_prints_bare() -> None:
    """⚠️ THE ONLY HONEST FALLBACK. Inventing a symbol from a locale is the
    thing the original decision was right to refuse; this adds a code the
    OPERATOR set, and where they have set none, nothing changes."""
    assert _amount(2146.0) == "2,146"
    assert _amount(2146.0, currency="") == "2,146"


def test_the_code_is_appended_not_turned_into_a_symbol() -> None:
    """`get_config` returns an ISO code, not a glyph. `Rp` and `IDR` are not
    interchangeable to every reader, and a wrong symbol is worse than none."""
    assert _amount(50.0, currency="IDR") == "50.00 IDR"
    assert "Rp" not in _amount(50.0, currency="IDR")


# ── "which automation?" ──────────────────────────────────────────────────────

def test_an_audit_finding_names_the_thing_it_is_about() -> None:
    body = _render([AUDIT_EVENT], labels=LABELS)
    assert "critical automation off" in body, "the finding itself is gone"
    assert DISPLAY_NAME in body, (
        "the brief still says a critical automation is off without saying "
        "which — the event named it and the renderer dropped it")


def test_it_names_the_display_name_and_not_the_entity_id() -> None:
    """⚠️ THE ID IS THE ONE NAME THAT HIDES THE POINT. `automation.outdoor_
    unified_doorbell_call_and_unlock` carries no evidence that it is a critical
    rule; `critical_doorbell---parking_gate` is the same automation and says so.
    """
    body = _render([AUDIT_EVENT], labels=LABELS)
    assert "outdoor_unified_doorbell" not in body


def test_a_caretaker_task_says_what_it_is_about() -> None:
    body = _render([AUDIT_EVENT], labels=LABELS)
    line = next(l for l in body.splitlines() if "Re-enable" in l)
    assert DISPLAY_NAME in line, (
        f"'Re-enable, or document...' with nothing to re-enable: {line!r}")


def test_an_unlabelled_entity_still_gets_a_readable_name() -> None:
    """No `labels` (Home Assistant unreachable) must degrade to a humanised id,
    never to silence — the finding is the same, only the name is poorer."""
    body = _render([AUDIT_EVENT])
    assert "Outdoor Unified Doorbell Call And Unlock" in body, (
        "the fallback must drop the domain and title-case the rest, the way "
        "`display_label` does when HA has no friendly name either")


def test_a_long_list_of_subjects_is_capped_and_counted() -> None:
    """A sweep can name twenty; a notification listing twenty is one nobody
    finishes."""
    event = {**AUDIT_EVENT, "data": {**AUDIT_EVENT["data"],
             "entities": [f"automation.rule_{i}" for i in range(9)]}}
    body = _render([event])
    assert "and 6 more" in body


# ── "which alerts?" ──────────────────────────────────────────────────────────

def test_self_resolved_alerts_are_named_not_counted() -> None:
    """⚠️ THE COUNT RESTATED THE SECTION ABOVE IT. "3 alerts resolved without
    intervention." sat under a recap that had just listed those three with
    their durations."""
    raised = {"type": "vesta_critical_event", "at": "2026-08-20T12:00:00+08:00",
              "data": {"blueprint": "critical_water_leak", "report_bucket": "Water leak",
                       "label": "Water leak", "severity": "P1", "phase": "raised",
                       "entities": ["binary_sensor.laundry_leak"],
                       "timestamp": "2026-08-20T12:00:00+08:00"}}
    cleared = {**raised, "at": "2026-08-20T12:30:00+08:00",
               "data": {**raised["data"], "phase": "cleared",
                        "timestamp": "2026-08-20T12:30:00+08:00"}}
    body = _render([raised, cleared])
    assert "resolved without intervention" not in body
    closed = body.split("Closed by itself")[1]
    assert "Water leak" in closed


# ── "are you sure about the older alert format?" ─────────────────────────────

def test_the_drift_line_names_the_rule_not_only_its_family() -> None:
    """⚠️ "(critical) uses an older alert format" NAMES ONE OF THIRTEEN RULES
    AND IDENTIFIES NONE. The parenthesised category IS the drift — a payload
    with no `blueprint` field cannot name itself — but `report_bucket` survives
    and is the operator's own words for what the rule is."""
    body = _render([LEGACY_CRITICAL])
    line = next(l for l in body.splitlines() if "older alert format" in l)
    assert "Pool pump schedule" in line, f"unactionable: {line!r}"
    assert "(critical)" in line, "the category still qualifies it"
    assert line.index("Pool pump schedule") < line.index("(critical)"), (
        "the rule is the subject of the sentence; written the other way it "
        "parses as a category doing the using")


def test_a_blueprint_that_names_itself_is_not_qualified_twice() -> None:
    """The bucket is a fallback for a payload that cannot identify itself, not
    decoration on one that can."""
    named = {"type": "vesta_roi_event", "at": "2026-08-21T12:00:00+08:00",
             "data": {"blueprint": "roi_vacancy_waste",
                      "report_bucket": "Vacancy waste - whole villa",
                      "label": "Vacancy waste", "entities": ["sensor.x"]}}
    body = _render([named])
    line = next((l for l in body.splitlines() if "older alert format" in l), "")
    assert line, "this payload is missing `timestamp`, so it should drift"
    assert "Vacancy waste - whole villa" not in line


# ── the data was always there ────────────────────────────────────────────────

def test_the_group_exposes_the_entities_its_events_named() -> None:
    """⚠️ NOT A NEW SOURCE. `Group.entities` predates every fix above; the
    renderer simply never called it. Pinned so a refactor cannot quietly take
    the subject away again."""
    groups = agg.aggregate([AUDIT_EVENT]).get("groups") or []
    assert groups
    assert groups[0].entities == [
        "automation.outdoor_unified_doorbell_call_and_unlock"]


def test_open_tasks_carry_their_subject() -> None:
    groups = agg.aggregate([AUDIT_EVENT]).get("groups") or []
    tasks = agg.open_tasks(groups)
    assert tasks and tasks[0]["entities"] == [
        "automation.outdoor_unified_doorbell_call_and_unlock"]
