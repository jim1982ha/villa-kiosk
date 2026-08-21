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

# ⚠️ THE HEADINGS COME FROM THE VOCABULARY, NOT FROM A COPY. These
# asserted rendered strings like "Maintenance signals:" — so adding
# the emoji markers that make a brief scannable on a phone broke nine
# tests that were pinning PRESENTATION while claiming to pin structure.
# `style.py` is the one place a heading is decided; reading it here means
# the next change to how a brief looks touches one file.
from reports.narrate.style import (  # noqa: F401
    BULLET, SECTION_MARK, heading,
)

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
        _roi("Gym lights", 500.0, basis="estimated"),
        _roi("Pool pump", 400.0, basis="measured", rule="ROI-15")))
    assert "1 of them estimated rather than metered" in body


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
    # ⚠️ NOT `_roi(cost=0.0)` — a zero the blueprint COMPUTED is a price, and
    # the group is then priced and ranked. The case this means is nothing
    # priced at all, which is a period with no roi events in it.
    body = _render(
        discovery={**_ctx().discovery, "capabilities_missing": ["energy_cost"],
                   "capability_absent": {"energy_cost": "No tariff."}},
        aggregated=_events(_maintenance("Service the pump")))
    assert heading("money", "Avoidable cost") in body
    assert "not priced" in body or "Not calculated" in body


# ── 4. fixed and suggested ───────────────────────────────────────────────────

def test_caretaker_tasks_are_reported_not_created() -> None:
    body = _render(aggregated=_events(_maintenance("Replace the filter")))
    assert "Replace the filter" in body


def test_a_self_resolved_alert_is_counted_as_fixed() -> None:
    body = _render(aggregated=_events(
        _critical("raised", when="2026-08-20T12:00:00+08:00"),
        _critical("cleared", when="2026-08-20T12:30:00+08:00")))
    # ⚠️ NOW A BULLET UNDER ITS OWN HEADING. It was a bare sentence sitting
    # directly above the next heading — readable in a flat document, and a
    # heading that had lost its icon once every other heading gained one.
    assert heading("fixed", "Closed by itself") in body
    assert "resolved without intervention" in body


# ── 5. preventive ────────────────────────────────────────────────────────────

def test_maintenance_signals_reach_the_facility_brief() -> None:
    body = _render(audience="facility",
                   aggregated=_events(_maintenance("Service the pump")))
    assert heading("preventive", "Maintenance signals") in body


def test_only_the_money_ranking_is_audience_specific() -> None:
    """⚠️ THE SPLIT IS TINY ON PURPOSE. Withholding `preventive` from the owner
    also withheld the FORECAST findings routed to it — a finding vanishing
    because of who is reading. Only the cost ranking is now audience-specific."""
    data = _events(_roi("Gym lights", 900.0), _maintenance("Service the pump"))
    owner = _render(audience="owner", aggregated=data)
    facility = _render(audience="facility", aggregated=data)
    assert heading("money", "Avoidable cost, most expensive first") in owner
    assert heading("money", "Avoidable cost, most expensive first") not in facility
    assert heading("preventive", "Maintenance signals") in owner and heading("preventive", "Maintenance signals") in facility


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
    assert heading("trends", "Trends") in body and "Night standby" in body
    assert "Avoidable cost identified" not in body


# ── 7. monitoring health ─────────────────────────────────────────────────────

def test_a_drifted_blueprint_is_named_in_monitoring_health() -> None:
    legacy = {"type": "vesta_critical_event", "fired": "", "at": "2026-08-20T12:00:00+08:00",
              "data": {"rule_id": "P1-02", "report_bucket": "Leak",
                       "severity": "critical", "label": "Leak", "phase": "raised",
                       "entity_id": "binary_sensor.x"}}
    body = _render(aggregated=_events(legacy))
    assert heading("health", "Monitoring health") in body
    # ⚠️ REWORDED TO LEAD WITH THE ACTION. "Its findings are still counted;
    # updating it would make them more precise" spent two clauses on one idea,
    # in the densest section of the brief.
    assert "older alert format" in body
    assert "Update it to send:" in body


def test_an_unreadable_event_is_admitted_not_dropped_quietly() -> None:
    body = _render(aggregated=_events(_roi("Gym lights", 100.0),
                                      {"type": "state_changed", "data": {}}))
    assert "could not be read" in body


def test_a_skipped_module_says_so() -> None:
    body = _render(skipped=[{"module": "standby_creep",
                             "reason": "insufficient_history",
                             "detail": "needs 14 days, has 3"}])
    assert "Standby creep did not run" in body


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
             (heading("critical", "What went wrong"), heading("money", "Avoidable cost, most expensive first"),
              heading("fixed", "For the caretaker"))]
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


# ── read off the first live report, on hardware ─────────────────────────────

def test_a_priced_finding_is_ranked_even_with_no_dashboard_tariff() -> None:
    """⚠️ THE CONTRADICTION. A live report opened "Avoidable cost identified:
    26.00, across 1 finding" and then said "Avoidable cost: - Not calculated".

    `energy_cost` means a tariff on the HOME ASSISTANT ENERGY DASHBOARD — the
    source the BUILT-IN MODULES need. Every roi blueprint carries its own
    `tariff_per_kwh` and ships `cost_local` already multiplied, so a property
    with no dashboard tariff can still be told exactly what it wasted."""
    body = _render(
        discovery={**_ctx().discovery, "capabilities_missing": ["energy_cost"],
                   "capability_absent": {"energy_cost": "No tariff."}},
        aggregated=_events(_roi("Gym lights", 26.0, basis="estimated")))
    assert heading("money", "Avoidable cost, most expensive first") in body
    assert "Gym lights" in body
    assert "Not calculated" not in body, "the headline priced it; this denied it"


def test_a_maintenance_line_carries_its_measurement_not_just_a_name() -> None:
    """⚠️ A live report printed "- Pump short-cycling" and "- Pump power
    factor": two bare labels saying only that something was flagged, while the
    events carried the numbers. Maintenance blueprints emit no `detail` field —
    the measurements ARE the detail."""
    when = "2026-08-20T11:00:00+08:00"
    cycling = {"type": "vesta_maintenance_event", "fired": when, "at": when,
               "data": {"blueprint": "maintenance_cycling", "rule_id": "PM-02",
                        "report_bucket": "Pump short-cycling",
                        "entities": ["sensor.p"], "task_text": "Check the valve",
                        "transition_count": 14, "max_transitions": 6,
                        "timestamp": when}}
    body = _render(aggregated=_events(cycling))
    # `_count` suffix pluralises the stem; `max_transitions` has no unit suffix
    # and stays as written. Both are measurements the label alone did not carry.
    assert "14 transitions" in body
    assert "max transitions 6" in body


def test_a_measurement_never_repeats_money_or_housekeeping() -> None:
    """Cost and duration have their own sections and their own words; ids and
    labels are not measurements."""
    body = _render(aggregated=_events(_roi("Gym lights", 900.0)))
    assert "cost local" not in body and "report bucket" not in body
    assert "rule id" not in body and "blueprint " not in body.lower()


def test_an_all_estimated_total_is_not_counted_against_itself() -> None:
    """"across 1 finding, 1 of them estimated" counts a subset that is the
    whole set. Right arithmetic, silly sentence."""
    body = _render(aggregated=_events(_roi("Gym lights", 26.0, basis="estimated")))
    assert "1 of them estimated" not in body
    assert "estimated from assumed loads rather than metered" in body


def test_a_unit_suffixed_field_reads_as_english() -> None:
    """⚠️ "flagged after minutes 60" reached a live report. The rule is about
    how the field is NAMED, so it works on fields nobody here has seen."""
    from reports.narrate.deterministic import _phrase
    assert _phrase("flagged_after_minutes", 60) == "flagged after 60 minutes"
    assert _phrase("silent_hours", 26) == "silent 26 hours"
    assert _phrase("deviation_pct", 26.9) == "deviation 26.9%"
    assert _phrase("transition_count", 14) == "14 transitions"
    assert _phrase("transition_count", 1) == "1 transition"
    assert _phrase("some_new_field", 3) == "some new field 3"


def test_a_trend_prints_its_number_not_the_word_for_it() -> None:
    when = "2026-08-20T02:00:00+08:00"
    drift = {"type": "vesta_roi_event", "fired": when, "at": when, "data": {
        "blueprint": "roi_baseline_deviation", "rule_id": "ROI-18",
        "report_bucket": "Night standby", "entities": ["sensor.n"],
        "deviation_pct": 26.9, "basis": "trend", "timestamp": when}}
    body = _render(aggregated=_events(drift))
    assert "deviation 26.9%" in body
    assert "Night standby: drifting" not in body


# ── every aggregate group has a home ────────────────────────────────────────
# ⚠️ FOUND FROM A LIVE `_analysis` READING `groups: 6` AGAINST FIVE RENDERED.
# Two gaps at once: `audit` was claimed by no section, and an roi group that was
# neither priced nor a trend fell between `_money`'s filter and `_trends`'s.
# Worse, `_found_anything` counts groups — so the "nothing to report" sentence
# was suppressed too, and a real finding produced a report reading only
# "Prepared Friday 21 August, 01:50."

def test_every_aggregate_category_has_a_section() -> None:
    from reports.aggregate import CATEGORY_OF_EVENT
    from reports.narrate.deterministic import SECTION_FOR_CATEGORY
    missing = [c for c in set(CATEGORY_OF_EVENT.values())
               if c not in SECTION_FOR_CATEGORY]
    assert not missing, f"no section renders {missing} groups"


def test_a_group_of_every_category_actually_appears() -> None:
    """The table could name a section that does not read it — which is exactly
    how `audit` came to be listed nowhere."""
    when = "2026-08-20T11:00:00+08:00"
    samples = {
        "roi": {"blueprint": "roi_idle_load", "kwh": 1.4, "cost_local": 90.0,
                "basis": "measured", "wasted_minutes": 30.0},
        "maintenance": {"blueprint": "maintenance_condition",
                        "task_text": "check it", "flagged_after_minutes": 60},
        "audit": {"blueprint": "audit_config_integrity",
                  "finding": "2 critical automations found switched off"},
        # ⚠️ no `label` here: for a critical alert the label IS the human name
        # and correctly wins over the bucket, so setting one would make this
        # assert on a field the recap does not print.
        "critical": {"blueprint": "critical_binary_trip", "severity": "P1",
                     "phase": "raised"},
    }
    for category, extra in samples.items():
        event = {"type": f"vesta_{category}_event", "fired": when, "at": when,
                 "data": {"rule_id": "R-1", "report_bucket": f"Marker {category}",
                          "entities": ["sensor.x"], "timestamp": when, **extra}}
        body = _render(aggregated=_events(event))
        assert f"Marker {category}" in body, f"{category} groups never render"


def test_an_unpriced_waste_finding_is_stated_not_dropped() -> None:
    """A rule can measure waste without anyone having given it a tariff."""
    when = "2026-08-20T11:00:00+08:00"
    event = {"type": "vesta_roi_event", "fired": when, "at": when, "data": {
        "blueprint": "roi_runtime_cap", "rule_id": "ROI-16",
        "report_bucket": "Jacuzzi pump", "entities": ["sensor.j"],
        "runtime_hours": 3.5, "basis": "measured", "timestamp": when}}
    body = _render(aggregated=_events(event))
    assert "Jacuzzi pump" in body
    assert "not priced" in body


def test_an_unpriced_line_never_prints_a_zero() -> None:
    """⚠️ NO COST IS NOT ZERO COST — printing "0.00" reports the opposite of
    what happened."""
    when = "2026-08-20T11:00:00+08:00"
    event = {"type": "vesta_roi_event", "fired": when, "at": when, "data": {
        "blueprint": "roi_runtime_cap", "rule_id": "ROI-16",
        "report_bucket": "Jacuzzi pump", "entities": ["sensor.j"],
        "runtime_hours": 3.5, "basis": "measured", "timestamp": when}}
    body = _render(aggregated=_events(event))
    assert "0.00" not in body
    assert "Avoidable cost identified" not in body, "nothing was priced"


def test_a_report_is_never_only_a_date() -> None:
    """The floor: whatever arrives, the owner gets either a finding or the
    sentence saying which kind of nothing this is."""
    when = "2026-08-20T11:00:00+08:00"
    for category in ("roi", "maintenance", "audit", "critical"):
        event = {"type": f"vesta_{category}_event", "fired": when, "at": when,
                 "data": {"rule_id": "R-1", "report_bucket": "Something",
                          "entities": ["sensor.x"], "timestamp": when}}
        body = _render(aggregated=_events(event))
        assert len(body.splitlines()) > 1, (
            f"a {category} group rendered a report containing only a date")


def test_an_unpriced_line_states_the_duration_it_does_have() -> None:
    """⚠️ "no figure supplied" about an event carrying `runtime_hours: 3.5`.
    `_measurement` excludes duration because money and duration normally have
    their own sections — but for an unpriced line this IS that section."""
    when = "2026-08-20T11:00:00+08:00"
    event = {"type": "vesta_roi_event", "fired": when, "at": when, "data": {
        "blueprint": "roi_runtime_cap", "rule_id": "ROI-16",
        "report_bucket": "Jacuzzi pump", "entities": ["sensor.j"],
        "runtime_hours": 3.5, "basis": "measured", "timestamp": when}}
    body = _render(aggregated=_events(event))
    assert "3.5 hours run" in body
    assert "no figure supplied" not in body


def test_a_total_that_excludes_measured_waste_says_so() -> None:
    """⚠️ The headline read "52.00, across 1 finding" while the section below
    listed two — the second being real waste with no tariff behind it, absent
    from the total AND from its count. One number and two lines under-tells the
    reader, which is "say what could not be seen" failing where everyone looks."""
    when = "2026-08-20T11:00:00+08:00"
    unpriced = {"type": "vesta_roi_event", "fired": when, "at": when, "data": {
        "blueprint": "roi_runtime_cap", "rule_id": "ROI-16",
        "report_bucket": "Living room AC", "entities": ["sensor.a"],
        "kwh": 0.9, "basis": "measured", "timestamp": when}}
    body = _render(aggregated=_events(_roi("Bathroom VMC", 52.0), unpriced))
    assert "1 further finding was measured but could not be priced" in body
    assert body.count("Living room AC") == 1, "counted once, in the section"


def test_a_fully_priced_total_carries_no_such_caveat() -> None:
    """A caveat on every report is one nobody reads."""
    body = _render(aggregated=_events(_roi("A", 10.0),
                                      _roi("B", 20.0, rule="ROI-05")))
    assert "could not be priced" not in body


# ── read off the first full QA capture, on hardware ─────────────────────────

def test_an_audience_without_the_money_section_is_not_told_a_total() -> None:
    """⚠️ v2.529.0's CONTRADICTION WITH THE SIGN FLIPPED. There the headline
    priced a finding the section then denied; here it priced one the audience
    is never shown at all. A live facility brief opened "Avoidable cost
    identified: 1,051, across 3 findings; 1 further finding could not be
    priced" with no breakdown anywhere below it."""
    data = _events(_roi("Gym lights", 900.0))
    owner = _render(audience="owner", aggregated=data)
    facility = _render(audience="facility", aggregated=data)
    assert "Avoidable cost identified" in owner
    assert "Avoidable cost identified" not in facility
    assert "could not be priced" not in facility


def test_one_money_list_uses_one_number_format() -> None:
    """⚠️ A live report printed "799", "156" and "96.00" in one column.
    `_amount` decided per value; the currency is the operator's own and unknown,
    so the magnitude of the LIST decides."""
    body = _render(aggregated=_events(
        _roi("Big", 799.0), _roi("Small", 96.0, rule="ROI-05")))
    # ⚠️ "96," is correct — that comma separates the cost from the energy.
    # The defect was the DECIMALS, on one row of a column that had none.
    assert "Big: 799," in body
    assert "Small: 96," in body
    assert "96.00" not in body, "one row with decimals beside rows without"


def test_a_small_only_list_keeps_its_decimals() -> None:
    """The rule is consistency WITHIN a list, not "never show minor units" —
    a list of small figures in a currency that has them still needs them."""
    body = _render(aggregated=_events(_roi("A", 4.5), _roi("B", 9.25, rule="ROI-05")))
    assert "4.50" in body and "9.25" in body


# ── how it reads on a phone ─────────────────────────────────────────────────

def test_the_body_carries_no_markup_a_platform_could_parse() -> None:
    """⚠️ EMOJI ARE THE FORMATTING BUDGET, AND THE REASON IS PAID FOR. A
    delivered brief was mangled by a platform that parses Markdown by default:
    it ate every underscore and italicised whole paragraphs between them. The
    fix was to stop emitting markup-active characters at all, so this pins the
    absence rather than trusting the wording of each line.

    `-` is included: a leading `- ` is a list marker in every dialect, which is
    why the bullet is `•`.
    """
    body = _render(aggregated=_events(
        _critical("raised"), _roi("Vacancy waste", 1581.0),
        _maintenance("Check the valve")))
    for line in body.splitlines():
        for markup in ("**", "__", "`", "#", "* "):
            assert markup not in line, f"{markup!r} in {line!r}"
        assert not line.startswith("- "), f"markdown list marker: {line!r}"
    assert "_" not in body, "an underscore reaches a platform that italicises"


def test_every_section_is_findable_without_reading_it() -> None:
    """A brief arrives as a notification and is SCANNED. Each heading carries
    its own marker, and every other top-level line is a bullet or the opening
    summary — so there is no line that looks like a heading and is not one."""
    body = _render(aggregated=_events(
        _critical("raised"), _roi("Vacancy waste", 1581.0),
        _maintenance("Check the valve")))
    # ⚠️ THE HEADLINE IS VARIABLE-LENGTH — two lines or three, depending on
    # whether anything was priced and whether a critical alert is open — so the
    # boundary is the first BLANK line, not a count. A fixed skip made this test
    # fail on its own fixture, which is the assertion being wrong rather than
    # the renderer.
    blank = body.splitlines().index("")
    for line in body.splitlines()[blank:]:
        if not line:
            continue
        marked = any(line.startswith(m) for m in SECTION_MARK.values())
        assert marked or line.startswith(BULLET), (
            f"neither a marked heading nor a bullet: {line!r}")


def test_the_title_says_how_urgent_this_one_is() -> None:
    """⚠️ THE TITLE IS OFTEN ALL THAT IS READ — a push notification shows it and
    about two lines, a chat list shows it alone. And it must not lie: the marker
    ranks the same two sources the history entry does."""
    from reports.narrate.style import SEVERITY_MARK
    ctx = _ctx(aggregated=_events(_critical("raised")))
    title = DeterministicNarrator()._title(ctx)
    assert title.startswith(SEVERITY_MARK["critical"]), title
    quiet = DeterministicNarrator()._title(_ctx())
    assert quiet.startswith(SEVERITY_MARK["info"]), quiet


def test_checks_that_stood_down_for_the_same_reason_share_one_line() -> None:
    """⚠️ SIXTY WORDS TO SAY ONE THING. A delivered brief carried "… did not
    run: covered by this property's own automation layer, which sees occupancy
    and cost context these checks cannot" THREE TIMES, once per check, in the
    section a reader is least likely to reach. Grouping keeps every fact and
    costs a third of the space — which matters because this arrives as a phone
    notification, not a document."""
    skipped = [{"module": m, "title": t, "reason": "missing_capability",
                "detail": "your own automations already cover this"}
               for m, t in (("a", "First check"), ("b", "Second check"),
                            ("c", "Third check"))]
    body = _render(skipped=skipped)
    lines = [ln for ln in body.splitlines() if "did not run" in ln]
    assert len(lines) == 1, f"one line per reason, got {len(lines)}: {lines}"
    for name in ("First check", "Second check", "Third check"):
        assert name in lines[0], f"{name} was dropped by the grouping"
    assert "3 checks did not run" in lines[0]


def test_two_headings_in_one_section_are_separated() -> None:
    """⚠️ `render` ONLY PUTS A BLANK LINE BETWEEN SECTIONS. "Closed by itself"
    and "For the caretaker" live in the same one, so they ran together with no
    gap — visible in the first delivered brief that had both, once headings
    carried markers and the join became obvious."""
    body = _render(aggregated=_events(
        _critical("raised", when="2026-08-20T12:00:00+08:00"),
        _critical("cleared", when="2026-08-20T12:30:00+08:00"),
        _maintenance("Check the valve")))
    lines = body.splitlines()
    closed = lines.index(heading("fixed", "Closed by itself"))
    caretaker = lines.index(heading("fixed", "For the caretaker"))
    assert lines[caretaker - 1] == "", (
        "a heading that follows content needs a blank line before it")
    assert closed < caretaker
