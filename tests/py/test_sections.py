"""The eight sections of the Report Spec, against real aggregated data.

⚠️ THE FIXTURES GO THROUGH `aggregate.aggregate()`, NEVER HAND-BUILT GROUPS.
The renderer reads `Group` objects on the live path and plain dicts from stored
history, and a test that hands it a shape neither side produces proves nothing
about either. Building the input from blueprint-shaped events is also what makes
these tests fail if the aggregation contract moves — which is the point.

The eight, per the workbook:

  1 headline · 2 critical recap · 3 money · 4 fixed and suggested
  5 preventive · 6 trends · 7 monitoring health · 8 coverage
"""

from __future__ import annotations

from typing import Any, Dict, List

from reports import aggregate
from reports.contracts import FINDING_KIND
from reports.narrate import DeterministicNarrator, ReportContext
from reports.narrate.deterministic import SECTION_FOR_KIND


def _events(*items: Dict[str, Any]) -> Dict[str, Any]:
    return aggregate.aggregate(list(items))


def _roi(bucket: str, cost: float, *, basis: str = "measured",
         kwh: float = 1.4, rule: str = "ROI-01") -> Dict[str, Any]:
    when = "2026-08-20T10:00:00+08:00"
    return {"type": "vesta_roi_event", "fired": when, "at": when, "data": {
        "blueprint": "roi_idle_load", "rule_id": rule, "report_bucket": bucket,
        "entities": ["light.a"], "wasted_minutes": 95.0, "watts": 880.0,
        "kwh": kwh, "cost_local": cost, "basis": basis, "timestamp": when}}


def _critical(phase: str, *, bucket: str = "Water leak",
              when: str = "2026-08-20T12:00:00+08:00") -> Dict[str, Any]:
    return {"type": "vesta_critical_event", "fired": when, "at": when, "data": {
        "blueprint": "critical_binary_trip", "rule_id": "P1-02",
        "report_bucket": bucket, "severity": "critical", "label": bucket,
        "phase": phase, "entities": ["binary_sensor.x"],
        "detail": "kitchen sensor", "timestamp": when}}


def _maintenance(task: str, bucket: str = "House pump") -> Dict[str, Any]:
    when = "2026-08-20T11:00:00+08:00"
    return {"type": "vesta_maintenance_event", "fired": when, "at": when, "data": {
        "blueprint": "maintenance_condition", "rule_id": "PM-04",
        "report_bucket": bucket, "entities": ["sensor.p"], "mode": "numeric",
        "task_text": task, "detail": "power factor low", "timestamp": when}}


def _ctx(**kw: Any) -> ReportContext:
    base: Dict[str, Any] = {
        "audience": "owner", "cadence": "weekly", "period": "2026-W34",
        "generated_at": "2026-08-20T07:00:00+08:00",
        "discovery": {
            "reachable": True,
            "capabilities": ["statistics", "energy_grid", "energy_cost"],
            "capabilities_missing": [],
            "capability_absent": {},
            "preflight": [],
        },
        "findings": [], "skipped": [],
        "aggregated": {}, "collector": {},
    }
    base.update(kw)
    return ReportContext(**base)


def _render(**kw: Any) -> str:
    return DeterministicNarrator().render(_ctx(**kw))[1]


# ── 1. headline ──────────────────────────────────────────────────────────────

def test_the_headline_states_the_avoidable_cost() -> None:
    body = _render(aggregated=_events(_roi("Gym lights", 9000.0),
                                      _roi("Living room AC", 1000.0, rule="ROI-05")))
    assert "Avoidable cost identified: 10,000" in body


def test_the_headline_omits_the_number_rather_than_printing_zero() -> None:
    """⚠️ "0 wasted" IS A MEASUREMENT; nothing priced is the absence of one. A
    property with no tariff would otherwise be congratulated every week on
    having spent nothing."""
    body = _render(aggregated=_events(_maintenance("Service the pump")))
    assert "Avoidable cost identified" not in body


def test_an_estimated_figure_is_qualified_in_the_headline() -> None:
    """The tariff is a per-instance blueprint input and some loads are assumed
    rather than metered; a bare total would imply a precision it lacks."""
    body = _render(aggregated=_events(
        _roi("Gym lights", 500.0, basis="estimated")))
    assert "estimated rather than metered" in body


def test_an_unresolved_alert_is_named_in_the_headline() -> None:
    body = _render(aggregated=_events(_critical("raised")))
    assert "still unresolved" in body


# ── 2. critical recap ────────────────────────────────────────────────────────

def test_a_resolved_incident_reports_how_long_it_lasted() -> None:
    body = _render(aggregated=_events(
        _critical("raised", when="2026-08-20T12:00:00+08:00"),
        _critical("cleared", when="2026-08-20T12:45:00+08:00")))
    assert "resolved after 45 minutes" in body


def test_an_unpaired_raise_gets_no_invented_duration() -> None:
    """⚠️ The blueprints carry no incident id, so an unmatched raise has no
    honest duration. It must say "unresolved", never guess a number."""
    body = _render(aggregated=_events(_critical("raised")))
    assert "still unresolved" in body
    assert "resolved after" not in body


# ── 3. money ─────────────────────────────────────────────────────────────────

def test_money_is_ranked_most_expensive_first() -> None:
    body = _render(aggregated=_events(_roi("Cheap", 10.0),
                                      _roi("Dear", 9000.0, rule="ROI-05")))
    assert body.index("Dear") < body.index("Cheap")


def test_every_money_figure_carries_its_basis() -> None:
    body = _render(aggregated=_events(
        _roi("Metered", 900.0, basis="measured"),
        _roi("Guessed", 800.0, basis="estimated", rule="ROI-05")))
    assert "(metered)" in body
    assert "estimated from an assumed load, not metered" in body


def test_no_currency_symbol_is_invented() -> None:
    """⚠️ `cost_local` is in the operator's own currency, chosen per blueprint
    instance. Guessing a symbol is how a report claims dollars about a figure
    computed in rupiah."""
    body = _render(aggregated=_events(_roi("Gym lights", 9000.0)))
    for symbol in ("$", "€", "£", "¥", "Rp", "USD", "IDR"):
        assert symbol not in body


def test_money_admits_it_cannot_price_rather_than_going_silent() -> None:
    """⚠️ AN ABSENT SECTION READS AS "NOTHING WAS WASTED". A property with no
    tariff can identify waste and not price it, and must say so."""
    body = _render(
        discovery={**_ctx().discovery, "capabilities_missing": ["energy_cost"],
                   "capability_absent": {"energy_cost": "No tariff."}},
        aggregated=_events(_roi("Gym lights", 0.0)))
    assert "Avoidable cost:" in body
    assert "not priced" in body or "Not calculated" in body


# ── 4. fixed and suggested ───────────────────────────────────────────────────

def test_caretaker_tasks_are_reported_not_created() -> None:
    body = _render(aggregated=_events(_maintenance("Replace the filter")))
    assert "Replace the filter" in body


def test_a_self_resolved_alert_is_counted_as_fixed() -> None:
    body = _render(aggregated=_events(
        _critical("raised", when="2026-08-20T12:00:00+08:00"),
        _critical("cleared", when="2026-08-20T12:30:00+08:00")))
    assert "Resolved without intervention" in body


# ── 5. preventive ────────────────────────────────────────────────────────────

def test_maintenance_signals_reach_the_facility_brief() -> None:
    body = _render(audience="facility",
                   aggregated=_events(_maintenance("Service the pump")))
    assert "Maintenance signals:" in body


def test_only_the_money_ranking_is_audience_specific() -> None:
    """⚠️ THE SPLIT IS TINY ON PURPOSE. Withholding `preventive` from the owner
    also withheld the FORECAST findings routed to it — a finding vanishing
    because of who is reading. Only the cost ranking is now audience-specific."""
    data = _events(_roi("Gym lights", 900.0), _maintenance("Service the pump"))
    owner = _render(audience="owner", aggregated=data)
    facility = _render(audience="facility", aggregated=data)
    assert "Avoidable cost, most expensive first:" in owner
    assert "Avoidable cost, most expensive first:" not in facility
    assert "Maintenance signals:" in owner and "Maintenance signals:" in facility


def test_no_audience_can_lose_a_finding() -> None:
    """The two tables must agree: every section a KIND routes to has to be in
    every audience's list, or that reader silently never sees those findings."""
    from reports.narrate.deterministic import SECTIONS_FOR
    for audience, sections in SECTIONS_FOR.items():
        for kind, section in SECTION_FOR_KIND.items():
            assert section in sections, (
                f"{audience} never renders {section}, so {kind} findings "
                f"vanish for that reader")


def test_every_kind_renders_for_every_audience() -> None:
    """The tables agreeing is necessary, not sufficient — assert the page."""
    from reports.narrate.deterministic import SECTIONS_FOR
    for audience in SECTIONS_FOR:
        for kind in FINDING_KIND:
            body = _render(audience=audience,
                           findings=[{"label": f"D {kind}", "kind": kind,
                                      "severity": "notice", "detail": "x"}])
            assert f"D {kind}" in body, f"{kind} is invisible to {audience}"


# ── 6. trends ────────────────────────────────────────────────────────────────

def test_a_trend_is_stated_and_never_priced() -> None:
    """⚠️ `basis: trend` means a value moved against its own baseline. There is
    no kWh behind it, so it is excluded from the savings total and belongs
    here."""
    when = "2026-08-20T02:00:00+08:00"
    drift = {"type": "vesta_roi_event", "fired": when, "at": when, "data": {
        "blueprint": "roi_baseline_deviation", "rule_id": "ROI-18",
        "report_bucket": "Night standby", "entities": ["sensor.n"],
        "deviation_pct": 26.9, "basis": "trend", "timestamp": when,
        "detail": "26.9% above baseline"}}
    body = _render(aggregated=_events(drift))
    assert "Trends:" in body and "Night standby" in body
    assert "Avoidable cost identified" not in body


# ── 7. monitoring health ─────────────────────────────────────────────────────

def test_a_drifted_blueprint_is_named_in_monitoring_health() -> None:
    legacy = {"type": "vesta_critical_event", "fired": "", "at": "2026-08-20T12:00:00+08:00",
              "data": {"rule_id": "P1-02", "report_bucket": "Leak",
                       "severity": "critical", "label": "Leak", "phase": "raised",
                       "entity_id": "binary_sensor.x"}}
    body = _render(aggregated=_events(legacy))
    assert "Monitoring health:" in body
    assert "older format" in body


def test_an_unreadable_event_is_admitted_not_dropped_quietly() -> None:
    body = _render(aggregated=_events(_roi("Gym lights", 100.0),
                                      {"type": "state_changed", "data": {}}))
    assert "could not be read" in body


def test_a_skipped_module_says_so() -> None:
    body = _render(skipped=[{"module": "standby_creep",
                             "reason": "insufficient_history",
                             "detail": "needs 14 days, has 3"}])
    assert "standby_creep did not run" in body


# ── 8. coverage ──────────────────────────────────────────────────────────────

def test_a_collector_gap_invalidates_rather_than_narrows() -> None:
    """⚠️ Findings may be MISSING, not merely unmeasurable — a different claim
    from a capability this property does not have, and it goes first."""
    body = _render(collector={"connected": False,
                              "blueprint_categories": ["roi", "critical"]},
                   aggregated=_events(_roi("Gym lights", 100.0)))
    assert "were not being recorded" in body


def test_coverage_uses_the_absent_voice() -> None:
    """⚠️ Never `capability_meaning` — that table says what a capability
    ENABLES and reads as a statement of fact about a property lacking it."""
    body = _render(discovery={
        **_ctx().discovery, "capabilities_missing": ["energy_water"],
        "capability_absent": {"energy_water": "Water use is not metered."}})
    assert "Water use is not metered." in body


# ── structural invariants ────────────────────────────────────────────────────

def test_every_finding_kind_has_a_section() -> None:
    """⚠️ THE FIRST CUT ROUTED TWO KINDS AND LOST THREE. An `OBSERVATION`, a
    `FORECAST` or a `VERIFICATION` finding was computed, gated, counted in
    `ran`, and then dropped silently between the analysis and the page —
    "a module is never silently absent" failing in the one place nothing
    checked."""
    missing = [k for k in FINDING_KIND if k not in SECTION_FOR_KIND]
    assert not missing, f"no section renders {missing}"


def test_a_finding_of_every_kind_actually_appears() -> None:
    """The table above could name a section that renders nothing. Assert the
    finding reaches the page, not merely that it was routed."""
    for kind in FINDING_KIND:
        body = _render(findings=[{"label": f"Device {kind}", "kind": kind,
                                  "severity": "notice", "detail": "something"}])
        assert f"Device {kind}" in body, f"{kind} findings never render"


def test_an_unknown_kind_still_reaches_the_page() -> None:
    body = _render(findings=[{"label": "Odd one", "kind": "SOMETHING_NEW",
                              "severity": "info", "detail": "x"}])
    assert "Odd one" in body


def test_the_body_stays_plain_text() -> None:
    """`deliver.py` sends the intersection of what notify platforms accept."""
    body = _render(aggregated=_events(_roi("Gym lights", 900.0),
                                      _critical("raised"),
                                      _maintenance("Service the pump")))
    for markup in ("**", "##", "<b>", "* ", "`"):
        assert markup not in body


def test_a_report_with_everything_still_reads_top_down() -> None:
    """The eight sections keep their order whatever is present."""
    body = _render(aggregated=_events(
        _roi("Gym lights", 900.0), _critical("raised"),
        _maintenance("Service the pump")))
    order = [body.index(h) for h in
             ("What went wrong:", "Avoidable cost, most expensive first:",
              "Raised for the caretaker:")]
    assert order == sorted(order)


def test_plurals_are_english_not_string_concatenation() -> None:
    """⚠️ "2 categorys of automation alert" reached the first rendered report.
    The -y rule lives in `_plural`, not in each caller's head."""
    from reports.narrate.deterministic import _plural
    assert _plural(1, "category") == "1 category"
    assert _plural(2, "category") == "2 categories"
    assert _plural(2, "finding") == "2 findings"
    assert _plural(2, "day") == "2 days", "-ay is not -ies"
    assert _plural(2, "batch") == "2 batches"
    assert _plural(2, "person", "people") == "2 people"
