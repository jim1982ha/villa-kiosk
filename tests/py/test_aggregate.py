"""Aggregation, against payloads copied from the blueprint sources.

⚠️ EVERY FIXTURE HERE MIRRORS A REAL EMIT SITE. The keys, and which of them are
optional, were read out of all 30 blueprint YAML files on 2026-08-21 — not from
their descriptions. Writing them from the prose is exactly how 2.511.0 happened:
the fixtures and the code agreed with each other, both disagreed with Home
Assistant, and 11,859 rows produced zero findings.

The four categories do NOT share a payload. Only `rule_id` and `report_bucket`
are universal, and `critical` is the outlier — it alone carries `severity`,
`phase` and `label`, and until 2026-08-21 it carried neither `blueprint` nor
`timestamp` and spelled its entities `entity_id`. Both spellings are tested
because the ring buffer holds months of events in whatever shape they were
fired.
"""

from __future__ import annotations

from typing import Any, Dict, List

from reports import aggregate


# ── fixtures shaped exactly like the deployed blueprints ─────────────────────

def _roi(bucket: str = "Living room AC", *, kwh: float = 1.4,
         cost: float = 2380.0, basis: str = "measured", rule: str = "ROI-01",
         minutes: float = 95.0, when: str = "2026-08-20T10:00:00+08:00",
         blueprint: str = "roi_idle_load") -> Dict[str, Any]:
    """`roi_idle_load` — always blueprint/entities/basis/timestamp."""
    return {"type": "vesta_roi_event", "fired": when, "at": when, "data": {
        "blueprint": blueprint, "rule_id": rule, "report_bucket": bucket,
        "entities": ["light.a", "climate.b"], "wasted_minutes": minutes,
        "watts": 880.0, "kwh": kwh, "cost_local": cost, "basis": basis,
        "timestamp": when}}


def _roi_trend(bucket: str = "Night standby") -> Dict[str, Any]:
    """`roi_baseline_deviation` — a trend flag with NO kwh and NO cost_local,
    fired through `action: event.fire` rather than the `- event:` shorthand."""
    when = "2026-08-20T02:00:00+08:00"
    return {"type": "vesta_roi_event", "fired": when, "at": when, "data": {
        "blueprint": "roi_baseline_deviation", "rule_id": "ROI-18",
        "report_bucket": bucket, "entities": ["sensor.night"],
        "current_value": 812.0, "baseline_value": 640.0,
        "deviation_pct": 26.9, "basis": "trend", "timestamp": when}}


def _maintenance(bucket: str = "House pump",
                 task: str = "Check pump power factor") -> Dict[str, Any]:
    when = "2026-08-20T11:00:00+08:00"
    return {"type": "vesta_maintenance_event", "fired": when, "at": when, "data": {
        "blueprint": "maintenance_condition", "rule_id": "PM-04",
        "report_bucket": bucket, "entities": ["sensor.pump_pf"],
        "mode": "numeric", "flagged_after_minutes": 60,
        "task_text": task, "timestamp": when}}


def _audit(bucket: str = "Coverage") -> Dict[str, Any]:
    when = "2026-08-20T09:00:00+08:00"
    return {"type": "vesta_audit_event", "fired": when, "at": when, "data": {
        "blueprint": "audit_coverage", "rule_id": "DQ-05",
        "report_bucket": bucket, "finding": "no door contacts fitted",
        "gap_descriptions": ["No door/window contacts"], "timestamp": when}}


def _critical(phase: str = "raised", *, bucket: str = "Water leak",
              when: str = "2026-08-20T12:00:00+08:00",
              legacy: bool = False) -> Dict[str, Any]:
    """`critical_binary_trip`. `legacy=True` is the pre-2026-08-21 shape:
    `entity_id` singular, and no `blueprint`/`timestamp` at all."""
    data: Dict[str, Any] = {
        "rule_id": "P1-02", "report_bucket": bucket, "severity": "critical",
        "label": "Water leak", "phase": phase, "detail": "kitchen sensor"}
    if legacy:
        data["entity_id"] = "binary_sensor.leak_kitchen"
    else:
        data["blueprint"] = "critical_binary_trip"
        data["entities"] = ["binary_sensor.leak_kitchen"]
        data["timestamp"] = when
    return {"type": "vesta_critical_event", "fired": when, "at": when, "data": data}


# ── normalisation ────────────────────────────────────────────────────────────

def test_all_four_categories_normalise() -> None:
    items = aggregate.normalise_all(
        [_roi(), _maintenance(), _audit(), _critical()])
    assert [i.category for i in items] == [
        "roi", "maintenance", "audit", "critical"]


def test_a_foreign_event_is_dropped_not_guessed() -> None:
    assert aggregate.normalise({"type": "state_changed", "data": {}}) is None
    assert aggregate.normalise({"type": "vesta_roi_event"}) is not None


def test_the_category_comes_from_the_event_type_not_the_payload() -> None:
    """⚠️ `blueprint` is a field an author fills in — the six critical files
    carried none at all until 2026-08-21. The event TYPE is what the collector
    subscribed to, so it is always present and always right."""
    event = _roi()
    event["data"]["blueprint"] = "maintenance_condition"   # a lie
    item = aggregate.normalise(event)
    assert item is not None and item.category == "roi"


def test_the_legacy_critical_shape_still_reads() -> None:
    """⚠️ NOT A MIGRATION STEP. The ring buffer holds up to MAX_EVENTS
    historical events in whatever shape they were fired, so correcting the
    blueprints only cleans data from that point forward."""
    item = aggregate.normalise(_critical(legacy=True))
    assert item is not None
    assert item.entities == ["binary_sensor.leak_kitchen"]
    assert item.blueprint == ""
    assert item.when, "must fall back to the collector's own stamp"


def test_a_string_entity_does_not_become_one_char_per_letter() -> None:
    """A single-entity blueprint input arrives as a bare string; iterating it
    yields characters."""
    event = _roi()
    event["data"]["entities"] = "sensor.only_one"
    item = aggregate.normalise(event)
    assert item is not None and item.entities == ["sensor.only_one"]


def test_the_blueprints_own_timestamp_wins_over_the_collectors() -> None:
    """Both later stamps describe when the report system heard about it, and
    `at` can be much later than the condition after an outage."""
    event = _roi(when="2026-08-20T10:00:00+08:00")
    event["at"] = "2026-08-25T00:00:00+08:00"
    item = aggregate.normalise(event)
    assert item is not None and item.when == "2026-08-20T10:00:00+08:00"


def test_severity_is_a_category_property_where_the_payload_has_none() -> None:
    """⚠️ ONLY `critical` EMITS `severity`. The other three have no such field."""
    assert aggregate.normalise(_critical()).severity == "critical"   # type: ignore[union-attr]
    assert aggregate.normalise(_roi()).severity == "info"            # type: ignore[union-attr]
    assert aggregate.normalise(_maintenance()).severity == "notice"  # type: ignore[union-attr]


def test_phase_is_none_off_the_critical_path_and_that_is_not_cleared() -> None:
    assert aggregate.normalise(_roi()).phase is None       # type: ignore[union-attr]
    assert aggregate.normalise(_critical("cleared")).phase == "cleared"  # type: ignore[union-attr]


# ── dedup ────────────────────────────────────────────────────────────────────

def test_same_rule_same_bucket_becomes_one_line() -> None:
    groups = aggregate.group(aggregate.normalise_all([_roi(), _roi(), _roi()]))
    assert len(groups) == 1
    assert groups[0].occurrences == 3


def test_the_same_rule_on_two_buckets_stays_two_lines() -> None:
    groups = aggregate.group(aggregate.normalise_all(
        [_roi("Living room AC"), _roi("Gym lights")]))
    assert len(groups) == 2


def test_dedup_survives_an_empty_rule_id() -> None:
    """⚠️ `rule_id` DEFAULTS TO `""` IN EVERY BLUEPRINT — it is optional
    traceability an operator may never fill in, so it cannot be the whole key."""
    groups = aggregate.group(aggregate.normalise_all(
        [_roi(rule=""), _roi(rule="", blueprint="roi_vacancy_waste")]))
    assert len(groups) == 2, "the blueprint name must keep them apart"


# ── money ────────────────────────────────────────────────────────────────────

def test_cost_is_summed_from_what_the_blueprint_computed() -> None:
    groups = aggregate.group(aggregate.normalise_all([_roi(cost=100.0), _roi(cost=50.0)]))
    assert groups[0].total_cost == 150.0


def test_an_unpriced_group_is_none_not_zero() -> None:
    """⚠️ `roi_baseline_deviation` is a trend flag with no money at all. Ranked
    as 0.0 it would sort below a genuinely free finding and read as
    "this cost nothing"."""
    groups = aggregate.group(aggregate.normalise_all([_roi_trend()]))
    assert groups[0].total_cost is None


def test_ranking_puts_unpriced_last_rather_than_at_zero() -> None:
    ranked = aggregate.rank(aggregate.group(aggregate.normalise_all(
        [_roi("cheap", cost=10.0), _roi_trend(), _roi("dear", cost=9000.0)])))
    assert [g.bucket for g in ranked] == ["dear", "cheap", "Night standby"]


def test_the_savings_total_excludes_trend_and_reports_its_mix() -> None:
    """The tariff is a PER-INSTANCE blueprint input, so this total sums figures
    computed under assumptions that may differ. The mix is what keeps it honest."""
    result = aggregate.savings_total(aggregate.group(aggregate.normalise_all(
        [_roi(cost=100.0, basis="measured"),
         _roi("Gym lights", cost=40.0, basis="estimated", rule="ROI-05"),
         _roi_trend()])))
    assert result["total"] == 140.0
    assert result["groups"] == 2
    assert result["basis_mix"] == {"measured": 1, "estimated": 1}


def test_a_groups_basis_is_its_WEAKEST_member() -> None:
    """A total is only as well-founded as its shakiest term; calling a sum
    `measured` because most of it was measured is a quiet over-claim."""
    groups = aggregate.group(aggregate.normalise_all(
        [_roi(basis="measured"), _roi(basis="estimated")]))
    assert groups[0].basis == "estimated"


# ── incidents ────────────────────────────────────────────────────────────────

def test_a_raise_and_a_clear_are_ONE_occurrence_not_two() -> None:
    """⚠️ Critical emits on BOTH the trip and the all-clear. Counting every
    event reports each incident twice — and reports a RESOLVED one as two
    problems."""
    groups = aggregate.group(aggregate.normalise_all(
        [_critical("raised"), _critical("cleared")]))
    assert groups[0].occurrences == 1


def test_an_unpaired_raise_is_still_open() -> None:
    groups = aggregate.group(aggregate.normalise_all([_critical("raised")]))
    assert groups[0].open_incident is True


def test_a_matched_clear_closes_it_and_gives_a_duration() -> None:
    groups = aggregate.group(aggregate.normalise_all([
        _critical("raised", when="2026-08-20T12:00:00+08:00"),
        _critical("cleared", when="2026-08-20T12:45:00+08:00")]))
    assert groups[0].open_incident is False
    assert groups[0].duration_minutes == 45.0


def test_a_duration_is_none_rather_than_guessed_when_one_end_is_missing() -> None:
    groups = aggregate.group(aggregate.normalise_all([_critical("raised")]))
    assert groups[0].duration_minutes is None


# ── the report's shapes ──────────────────────────────────────────────────────

def test_roll_up_is_by_bucket_because_report_bucket_is_not_a_room() -> None:
    """⚠️ The blueprints' own examples are "Living room AC", "Lights - monitored
    rooms" and "Gym lights" — a room, a category and a device."""
    buckets = aggregate.by_bucket(aggregate.group(aggregate.normalise_all(
        [_roi("Gym lights"), _roi("Gym lights"), _roi("Living room AC")])))
    assert list(buckets) == ["Gym lights", "Living room AC"]


def test_task_text_is_surfaced_and_deduplicated() -> None:
    tasks = aggregate.open_tasks(aggregate.group(aggregate.normalise_all(
        [_maintenance(task="Service the pump"), _maintenance(task="Service the pump")])))
    assert len(tasks) == 1 and tasks[0]["text"] == "Service the pump"


def test_findings_carry_no_entity_id_anywhere() -> None:
    """⚠️ THE PHASE 6 BOUNDARY. `ref` is opaque and `dedup_key` hashes its
    subject, so these are safe to hand to PAYLOAD_ALLOWED_FIELDS unchanged."""
    import json
    findings = aggregate.to_findings(aggregate.group(aggregate.normalise_all(
        [_roi(), _critical(), _maintenance()])))
    rendered = json.dumps([f.__dict__ for f in findings])
    for forbidden in ("light.a", "climate.b", "binary_sensor.leak_kitchen",
                      "sensor.pump_pf"):
        assert forbidden not in rendered, f"{forbidden} leaked into a Finding"


def test_aggregate_is_safe_on_an_empty_period() -> None:
    result = aggregate.aggregate([])
    assert result["groups"] == [] and result["findings"] == []
    assert result["savings"]["total"] == 0.0
    assert result["events_seen"] == 0


def test_aggregate_counts_what_it_could_not_use() -> None:
    """A dropped event must be visible, not silently absent — monitoring health
    is a report section, and "0 of 40 usable" is the finding."""
    result = aggregate.aggregate([_roi(), {"type": "state_changed", "data": {}}])
    assert result["events_seen"] == 1
    assert result["events_dropped"] == 1


# ── schema drift: tolerate the old shape, but never silently ────────────────
# ⚠️ THE POINT THE OWNER MADE, 2026-08-21: if a blueprint does not follow the
# convention, the BLUEPRINT is what needs fixing — the code must not quietly
# absorb it, because a redistributable add-on cannot carry one property's
# private dialect. The six `critical_*` files were corrected the same day.
# Tolerance stays for VERSION SKEW (the add-on updates through HA; blueprints
# are updated by hand), but it is now reported rather than hidden.

def test_a_legacy_payload_is_named_not_silently_absorbed() -> None:
    drift = aggregate.schema_drift([_critical(legacy=True)])
    assert drift["count"] == 1
    entry = drift["blueprints"][0]
    assert entry["category"] == "critical"
    # ⚠️ HUMANISED, AND THE OLD FORM IS THE DEFECT. This asserted
    # `entity_id (use entities)` — an identifier composed into a sentence, which
    # reached the owner's phone and, on a markup-parsing platform, italicised
    # the rest of the paragraph from its underscore onward.
    assert "Entity id (use entities)" in entry["legacy"]
    assert "blueprint" in entry["missing"] and "timestamp" in entry["missing"]


def test_a_conforming_payload_reports_no_drift() -> None:
    """The corrected blueprints must come back clean, or the counter is noise
    everyone learns to ignore."""
    drift = aggregate.schema_drift(
        [_roi(), _maintenance(), _audit(), _critical()])
    assert drift["count"] == 0, drift["blueprints"]


def test_audit_is_not_flagged_for_having_no_entities() -> None:
    """⚠️ BY DESIGN, NOT DRIFT. 3 of `audit`'s 5 emit sites name no entity at
    all — `audit_coverage` reports structural gaps, which are the absence of
    hardware rather than an event about a device."""
    assert aggregate.schema_drift([_audit()])["count"] == 0


def test_drift_never_suppresses_the_finding_itself() -> None:
    """A drifted blueprint still produces a usable finding. Reporting the drift
    must not cost the reader the thing the blueprint detected."""
    result = aggregate.aggregate([_critical(legacy=True)])
    assert result["events_seen"] == 1
    assert result["events_dropped"] == 0
    assert len(result["findings"]) == 1
    assert result["schema_drift"]["count"] == 1


def test_a_payload_with_no_blueprint_is_keyed_by_its_category() -> None:
    """It cannot name itself — that IS the drift — but the event type always
    knows the category, so the report can still say where to look."""
    entry = aggregate.schema_drift([_critical(legacy=True)])["blueprints"][0]
    assert entry["blueprint"] == "(critical)"


# ── the severity vocabulary ─────────────────────────────────────────────────
# ⚠️ THE BUG THAT WOULD HAVE BLANKED EVERY REPORT. `critical_*` declares
# `severity` as a select with options ["P1", "P2"] — an escalation tier, not a
# loudness. `Finding.__post_init__` RAISES on a severity outside
# contracts.SEVERITY, `to_findings` propagates, and `pipeline` catches
# aggregation failures and continues with `aggregated = {}`. One genuine P1
# water leak would have emptied every section built from blueprint events and
# produced a report reading "nothing worth reporting".
#
# Found by reading the DEPLOYED blueprint's inputs over MCP. The schema audit
# that preceded aggregate.py read the payload's KEYS and never its VALUES.

def test_a_P1_alert_does_not_take_the_whole_report_down() -> None:
    findings = aggregate.to_findings(aggregate.group(
        aggregate.normalise_all([_critical_sev("P1")])))
    assert findings[0].severity == "critical"


def test_the_escalation_tier_maps_onto_the_report_vocabulary() -> None:
    for tier, expected in (("P1", "critical"), ("P2", "warning"),
                           ("p1", "critical"), ("critical", "critical"),
                           ("warning", "warning")):
        item = aggregate.normalise(_critical_sev(tier))
        assert item is not None and item.severity == expected, tier


def test_an_unknown_severity_falls_back_rather_than_raising() -> None:
    """A vocabulary nobody here knows must not stop the report — the fallback
    is the category default, and `Finding` accepts it."""
    findings = aggregate.to_findings(aggregate.group(
        aggregate.normalise_all([_critical_sev("BANANA")])))
    assert findings[0].severity == "critical"


def test_an_unknown_severity_is_REPORTED_not_absorbed() -> None:
    """⚠️ Silent tolerance is how a blueprint drifts and nobody hears. The
    fallback keeps the report alive; the drift entry says why it was needed."""
    drift = aggregate.schema_drift([_critical_sev("BANANA")])
    assert drift["count"] == 1
    assert any("not a severity" in note
               for note in drift["blueprints"][0]["legacy"])


def test_the_documented_tiers_are_not_reported_as_drift() -> None:
    """P1/P2 are the blueprints' own documented vocabulary, not a defect — a
    counter that fires on every correct event is one nobody reads."""
    assert aggregate.schema_drift([_critical_sev("P1")])["count"] == 0
    assert aggregate.schema_drift([_critical_sev("P2")])["count"] == 0


def _critical_sev(severity: str) -> Dict[str, Any]:
    when = "2026-08-20T12:00:00+08:00"
    return {"type": "vesta_critical_event", "fired": when, "at": when, "data": {
        "blueprint": "critical_binary_trip", "rule_id": "P1-02",
        "report_bucket": "Water leak", "severity": severity,
        "label": "Water leak", "phase": "raised",
        "entities": ["binary_sensor.x"], "timestamp": when}}


# ── the aggregation's own instrument ────────────────────────────────────────

def test_summary_is_json_safe() -> None:
    """⚠️ `Group` IS NOT SERIALISABLE. Putting the raw result on `_analysis`
    would 500 the diagnostics endpoint — which is the one surface that has to
    work precisely when something else does not."""
    import json
    json.dumps(aggregate.summary(aggregate.aggregate([_roi(), _critical()])))


def test_summary_separates_no_events_from_everything_deduplicating() -> None:
    """The two produce the same empty section and mean opposite things."""
    empty = aggregate.summary(aggregate.aggregate([]))
    merged = aggregate.summary(aggregate.aggregate([_roi(), _roi(), _roi()]))
    assert empty["events_seen"] == 0 and empty["groups"] == 0
    assert merged["events_seen"] == 3 and merged["groups"] == 1


def test_summary_carries_no_bucket_or_entity_id() -> None:
    """A `report_bucket` is operator free text and entities are entity ids.
    Diagnostics, not a data export — the same rule as `collect.state()`."""
    import json
    rendered = json.dumps(aggregate.summary(aggregate.aggregate([
        _roi("<firstname>'s bedroom lamp"),
        _maintenance(bucket="<firstname>'s bedroom", task="check the lamp")])))
    for forbidden in ("<firstname>", "light.a", "sensor.pump_pf", "check the lamp"):
        assert forbidden not in rendered, f"{forbidden} leaked into diagnostics"


def test_summary_names_the_blueprint_to_update() -> None:
    """A blueprint FILE name is not villa-specific the way a bucket is, and
    naming it is the entire point of reporting drift."""
    entry = aggregate.summary(aggregate.aggregate(
        [_critical(legacy=True)]))["schema_drift"][0]
    assert entry["blueprint"] == "(critical)"
    assert entry["events"] == 1


def test_a_machine_token_never_reaches_the_prose() -> None:
    """⚠️ IT DID. The `audit_*` blueprints emit `finding: "critical_automation_off"`
    and `finding: "entity_unavailable"` — identifiers, not sentences — and a
    live report printed "Critical automation health: critical_automation_off"
    to the owner. Underscores to spaces is the whole transformation: a lookup
    of every code every blueprint might emit goes stale the day someone adds a
    mode."""
    when = "2026-08-21T09:00:00+08:00"
    event = {"type": "vesta_audit_event", "fired": when, "at": when, "data": {
        "blueprint": "audit_config_integrity", "rule_id": "DQ-02",
        "report_bucket": "Critical automation health",
        "finding": "critical_automation_off", "timestamp": when}}
    item = aggregate.normalise(event)
    assert item is not None
    assert item.detail == "critical automation off"
    assert "_" not in item.detail


def test_a_real_sentence_is_left_alone() -> None:
    """`critical` supplies `detail` as prose; it must not be word-processed."""
    item = aggregate.normalise(_critical())
    assert item is not None and item.detail == "kitchen sensor"


def test_a_rule_id_is_never_printed_raw_into_a_brief() -> None:
    """⚠️ IT REACHED THE OWNER'S PHONE TWICE — the second time AFTER I shipped
    a fix and said so.

    v2.555.0 humanised the FALLBACK in `to_findings`, reached only when a
    blueprint supplies neither label nor bucket. But
    `critical_schedule---pool_pump` is not a fallback: it is the `label` the
    automation actually sends, so the renderer read it straight off the group
    and never touched the changed code. One construction site fixed, a
    different reader still shipping the defect — /dry-audit's opening sentence.

    So this pins the RENDER path, which is the one the owner sees.
    """
    from reports.text import readable_label
    from reports.narrate.deterministic import DeterministicNarrator

    assert readable_label("critical_schedule---pool_pump") == \
        "Critical schedule — pool pump"

    # The path that actually failed: a group whose LABEL is an identifier.
    narrator = DeterministicNarrator()
    group = {"label": "critical_schedule---pool_pump", "bucket": ""}
    assert narrator._name(group, alert=True) == "Critical schedule — pool pump"


def test_humanising_never_damages_a_label_a_person_wrote() -> None:
    """⚠️ THE REASON IT IS NOT A BLANKET REWRITE. Every string below is a real
    label from the reference villa's own brief, and a naive `replace("-", " ")`
    turns "Lights - monitored rooms" into "Lights monitored rooms" — damage
    done in the name of tidiness. Whitespace is the tell: an identifier has
    none, a label written by a person does."""
    from reports.text import readable_label
    for human in ("Lights - monitored rooms", "Vacancy waste - whole villa",
                  "Bathroom VMC", "Living room AC",
                  "Entrance unlocked while vacant", "Event bus smoke test", ""):
        assert readable_label(human) == human, human
