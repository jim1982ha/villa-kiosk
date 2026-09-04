"""`rule_calibration` — the check that watches the watchers. 2.924.0.

⚠️ EVERY FIXTURE IS THE SHAPE OF A REAL INCIDENT from 2026-09-02 → 04: a
clear threshold equal to its trip, incidents ending by timeout, a phase
crossing its limit most days, a pump that takes 6–11 minutes against a
10-minute grace. The point of each positive test is that the finding would
have preceded the alert the owner actually received.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.adapters import automations as automations_mod
from vesta.adapters import discovery
from vesta.shared import instants
from vesta.brief import registry
from vesta.shared.analysis.base import ModuleContext
from vesta.shared.analysis.modules import rule_calibration as rc
from vesta.supervise.agent import refs as refs_mod

ZONE = timezone(timedelta(hours=8))
NOW = datetime(2026, 9, 4, 9, 0, tzinfo=ZONE)


def _ctx(view: Any, **kw: Any) -> ModuleContext:
    async def fetch(*, band_days: int, start_days: int) -> Any:
        return view

    base: Dict[str, Any] = {
        "audience": "owner", "cadence": "daily", "now_local": NOW,
        "capabilities": ["automations"], "inventory": {},
        "settings": {}, "min_history_days": 14, "stats": None, "labels": {},
        "automations": fetch if view is not None else None,
        "supervision_enabled": True,
    }
    base.update(kw)
    return ModuleContext(**base)


def _run(view: Any) -> List[Any]:
    return asyncio.run(rc.RuleCalibration().run(_ctx(view)))


def _condition(**inputs: Any) -> Dict[str, Any]:
    base = {"alert_mode": "numeric", "direction": "above", "threshold": 4000,
            "watched_entities": ["sensor.phase_c"]}
    base.update(inputs)
    return {"entity_id": "automation.a_rule", "alias": "critical_condition---x",
            "stem": "critical_condition", "enabled": True,
            "label": "Mains phase overload", "inputs": base}


# ── the adapter's small parsers ─────────────────────────────────────────────

def test_a_duration_input_is_read_as_seconds() -> None:
    assert instants.seconds_of({"hours": 0, "minutes": 10, "seconds": 0}) == 600
    assert instants.seconds_of({"days": 1}) == 86_400
    assert instants.seconds_of(90) == 90
    assert instants.seconds_of("nope") == 0 and instants.seconds_of(None) == 0


def test_a_blueprint_path_reduces_to_its_stem() -> None:
    assert automations_mod.stem_of("critical_condition.yaml") == "critical_condition"
    assert automations_mod.stem_of("vesta/critical_schedule.yaml") == "critical_schedule"
    assert automations_mod.stem_of("") == ""


# ── check 1 · no hysteresis · needs no history ─────────────────────────────

def test_a_clear_threshold_equal_to_its_trip_is_a_finding_on_day_zero() -> None:
    found = _run({"instances": [_condition()], "firings": {}})
    checks = {f.metric for f in found}
    assert "no_hysteresis" in checks
    one = next(f for f in found if f.metric == "no_hysteresis")
    assert one.kind == "DATA_QUALITY" and one.severity == "warning"
    assert "same number it trips at (4000)" in one.detail
    assert "Mains phase overload" in one.label


def test_a_clear_margin_silences_the_hysteresis_check() -> None:
    found = _run({"instances": [_condition(clear_margin=200)], "firings": {}})
    assert all(f.metric != "no_hysteresis" for f in found)


def test_a_state_mode_rule_has_no_threshold_to_judge() -> None:
    found = _run({"instances": [_condition(alert_mode="state")], "firings": {}})
    assert found == []


def test_a_switched_off_rule_is_not_judged() -> None:
    off = dict(_condition()); off["enabled"] = False
    assert _run({"instances": [off], "firings": {}}) == []


# ── check 2 · ends by timeout · a majority, not a rate ─────────────────────

def test_incidents_ending_by_timeout_more_often_than_clearing_is_a_finding() -> None:
    firings = {"critical_condition---x": {"times": 3, "phases": {
        "opened": 3, "timeout": 2, "cleared": 1}}}
    found = _run({"instances": [_condition(clear_margin=200)], "firings": firings})
    one = next(f for f in found if f.metric == "ends_by_timeout")
    assert "2 of its last 3 incidents ended by timeout" in one.detail


def test_a_rule_that_mostly_clears_is_not_a_finding() -> None:
    firings = {"critical_condition---x": {"times": 3, "phases": {
        "opened": 3, "timeout": 1, "cleared": 2}}}
    found = _run({"instances": [_condition(clear_margin=200)], "firings": firings})
    assert all(f.metric != "ends_by_timeout" for f in found)


def test_a_rule_that_sends_no_phase_is_never_judged_on_how_it_ended() -> None:
    firings = {"critical_condition---x": {"times": 14, "phases": {}}}
    found = _run({"instances": [_condition(clear_margin=200)], "firings": firings})
    assert all(f.metric != "ends_by_timeout" for f in found)


# ── check 3 · at its limit · most days observed ────────────────────────────

def _hourly(days: int, crossing_days: int, threshold: float) -> List[Dict[str, Any]]:
    rows = []
    for d in range(days):
        day = (NOW - timedelta(days=days - d)).replace(hour=0, minute=0)
        for h in range(24):
            start = int((day + timedelta(hours=h)).timestamp() * 1000)
            peak = threshold + 500 if (d < crossing_days and h == 14) else threshold - 1500
            rows.append({"start": start, "mean": threshold - 2000, "max": peak,
                         "min": threshold - 3000})
    return rows


def test_crossing_the_limit_on_most_days_asks_for_the_rating_to_be_confirmed() -> None:
    inst = _condition(clear_margin=200)
    inst["hourly"] = {"sensor.phase_c": _hourly(10, 7, 4000)}
    found = _run({"instances": [inst], "firings": {}})
    one = next(f for f in found if f.metric == "at_its_limit")
    assert "7 of the last 10 days" in one.detail and "confirm the rating" in one.detail
    assert one.observed == 7 and one.baseline == 10


def test_one_hot_afternoon_is_not_a_finding() -> None:
    inst = _condition(clear_margin=200)
    inst["hourly"] = {"sensor.phase_c": _hourly(10, 1, 4000)}
    found = _run({"instances": [inst], "firings": {}})
    assert all(f.metric != "at_its_limit" for f in found)


# ── check 4 · grace inside the jitter · the pool pump, a week early ────────

def _schedule(delays_min: List[float], grace_min: float,
              threshold: float = 600) -> Dict[str, Any]:
    blocks = [{"day": d, "from": "07:15:00", "to": "12:00:00"}
              for d in instants.WEEKDAYS]
    history: List[Dict[str, Any]] = []
    for back, delay in enumerate(delays_min, start=1):
        day = (NOW - timedelta(days=back)).replace(hour=7, minute=15, second=0)
        history.append({"at": (day - timedelta(minutes=30)).astimezone(timezone.utc).isoformat(),
                        "state": "0"})
        history.append({"at": (day + timedelta(minutes=delay)).astimezone(timezone.utc).isoformat(),
                        "state": str(threshold + 200)})
    return {"entity_id": "automation.a_rule", "alias": "critical_schedule---pump",
            "stem": "critical_schedule", "enabled": True, "label": "Pool pump start",
            "inputs": {"expected_schedule": "schedule.pool", "power_sensor": "sensor.pump_power",
                       "power_threshold": threshold,
                       "duration_offline": {"minutes": grace_min}},
            "blocks": blocks, "history": history}


def test_a_grace_window_narrower_than_the_starts_seen_is_a_finding() -> None:
    found = _run({"instances": [_schedule([6, 11, 8, 9, 10.5, 7, 9], 10)], "firings": {}})
    one = next(f for f in found if f.metric == "grace_inside_jitter")
    assert "allows 10 min" in one.detail and "2 of them longer than allowed" in one.detail
    assert one.unit == "min" and one.observed == 11.0 and one.baseline == 10.0


def test_a_grace_just_inside_the_slowest_start_is_flagged_before_it_alarms() -> None:
    """⚠️ THE WEEK-EARLY CASE: nothing has exceeded the grace yet, but the
    grace sits within one spread of the slowest start seen."""
    found = _run({"instances": [_schedule([6, 9.5, 8, 9, 9.8, 7, 9.6], 10)], "firings": {}})
    one = next(f for f in found if f.metric == "grace_inside_jitter")
    assert "within a minute of the allowance" in one.detail


def test_a_generous_grace_is_not_a_finding() -> None:
    found = _run({"instances": [_schedule([6, 11, 8, 9, 10.5, 7, 9], 30)], "firings": {}})
    assert all(f.metric != "grace_inside_jitter" for f in found)


def test_too_few_observed_starts_is_silent() -> None:
    found = _run({"instances": [_schedule([6, 11], 5)], "firings": {}})
    assert all(f.metric != "grace_inside_jitter" for f in found)


# ── the contract every module keeps ────────────────────────────────────────

def test_no_view_means_no_findings_not_a_crash() -> None:
    assert asyncio.run(rc.RuleCalibration().run(_ctx(None))) == []


def test_findings_carry_a_subject_key_and_no_entity_id() -> None:
    inst = _condition()
    inst["hourly"] = {"sensor.phase_c": _hourly(10, 7, 4000)}
    for f in _run({"instances": [inst], "firings": {}}):
        assert f.subject_key and f.dedup_key.startswith("rule_calibration.")
        assert refs_mod.entity_ids_in(f.as_dict()) == [], f.as_dict()


def test_two_faults_on_one_rule_are_two_findings_with_two_dedup_keys() -> None:
    inst = _condition()
    inst["hourly"] = {"sensor.phase_c": _hourly(10, 7, 4000)}
    found = _run({"instances": [inst], "firings": {}})
    assert len({f.dedup_key for f in found}) == len(found) >= 2


# ── the gate honours a module that needs no baseline ───────────────────────

def test_the_gate_does_not_demand_history_of_a_baseline_free_module() -> None:
    module = next(m for m in registry.registered() if m.name == "rule_calibration")
    ok, reason, _ = registry.gate(module, _ctx({"instances": []}), {}, 0)
    assert ok is True, reason
    baseline = next(m for m in registry.registered() if m.name == "sensor_health")
    ok, reason, _ = registry.gate(
        baseline, _ctx({}, capabilities=["statistics", "energy_devices"]), {}, 0)
    assert ok is False and reason == "insufficient_history"


def test_the_module_is_registered_and_requires_the_capability() -> None:
    module = next(m for m in registry.registered() if m.name == "rule_calibration")
    assert tuple(module.requires) == (discovery.CAP_AUTOMATIONS,)
    assert module.min_days == 0


# ── the seams: pipeline, registry copy, discovery ──────────────────────────

def test_the_pipeline_injects_the_fetcher_and_the_registry_copies_it() -> None:
    """⚠️ PIN THE CALLER, TWICE. A defaulted field is the trap `registry`'s own
    comment names: omit it in either place and the module silently sees None."""
    import inspect
    from vesta.brief import pipeline
    assert "automations=automations_mod.fetcher(session, now_local, tally)" in (
        inspect.getsource(pipeline.analyse))
    assert "automations=context.automations" in inspect.getsource(registry.run_all)


def test_discovery_records_the_capability_from_the_alias_prefilter() -> None:
    states = [
        {"entity_id": "automation.a_rule", "attributes": {"friendly_name": "critical_condition---x"}},
        {"entity_id": "automation.b", "attributes": {"friendly_name": "morning lights"}},
        {"entity_id": "light.a", "attributes": {"friendly_name": "critical_condition---not an automation"}},
    ]
    assert automations_mod.critical_automation_ids(states) == ["automation.a_rule"]
    assert discovery.CAP_AUTOMATIONS in discovery.ALL_CAPABILITIES
    assert discovery.CAP_AUTOMATIONS in discovery.CAPABILITY_ABSENT


# ── the survey ──────────────────────────────────────────────────────────────

class _Hass:
    answers: Dict[str, Any] = {}

    def __init__(self, _s: Any) -> None:
        pass

    async def __aenter__(self) -> "_Hass":
        return self

    async def __aexit__(self, *_: Any) -> None:
        return None

    async def command(self, kind: str, **payload: Any) -> Any:
        return _Hass.answers.get(kind)


def test_the_survey_reads_only_vesta_critical_rules_and_enriches_by_stem(
        monkeypatch: pytest.MonkeyPatch) -> None:
    import vesta.adapters.hass as hass_mod
    _Hass.answers = {
        "get_states": [
            {"entity_id": "automation.a_rule", "state": "on",
             "attributes": {"friendly_name": "critical_condition---x", "id": "1"}},
            {"entity_id": "automation.b", "state": "on",
             "attributes": {"friendly_name": "critical_condition---y", "id": "2"}},
            {"entity_id": "automation.c", "state": "on",
             "attributes": {"friendly_name": "morning lights", "id": "3"}},
        ],
        "recorder/statistics_during_period": {"sensor.phase_c": [{"start": 1, "max": 1.0}]},
    }
    configs = {
        "config/automation/config/1": {"alias": "critical_condition---x", "use_blueprint": {
            "path": "critical_condition.yaml",
            "input": {"alert_mode": "numeric", "threshold": 4000,
                      "watched_entities": ["sensor.phase_c"], "alert_label": "Overload"}}},
        "config/automation/config/2": {"alias": "critical_condition---y", "use_blueprint": {
            "path": "somebody_elses.yaml", "input": {}}},
    }
    calls: List[str] = []

    async def rest_get(_s: Any, path: str) -> Any:
        calls.append(path)
        return configs.get(path)

    monkeypatch.setattr(hass_mod, "HassClient", _Hass)
    monkeypatch.setattr(hass_mod, "rest_get", rest_get)
    view = asyncio.run(automations_mod.survey(object(), NOW, band_days=28, start_days=7))
    assert [i["entity_id"] for i in view["instances"]] == ["automation.a_rule"], (
        "a rule built from a foreign blueprint, or not from a blueprint, is not surveyed")
    assert "config/automation/config/3" not in calls, "the prefilter must skip morning lights"
    one = view["instances"][0]
    assert one["label"] == "Overload" and one["stem"] == "critical_condition"
    assert one["hourly"] == {"sensor.phase_c": [{"start": 1, "max": 1.0}]}
    assert "firings" in view
