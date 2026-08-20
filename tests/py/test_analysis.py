"""The module system's gate, and the first module's judgement.

Two things are being pinned. First that **a module is never silently absent** —
every one either runs or produces a skip with a reason that reaches the report.
Second that `standby_creep` finds what it should and, more importantly, does
NOT find what it should not: the primary product risk here is alert fatigue,
and a module that cries wolf is worse than one that says nothing.

⚠️ EVERY SERIES IS SYNTHETIC AND SHAPED TO A KNOWN ANSWER. Testing an anomaly
detector against real data proves only that it agrees with itself; these
fixtures encode what the right answer IS.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Sequence

import pytest

from reports.analysis import ModuleContext, gate, run_all
from reports.analysis.base import Finding, resolve_threshold
from reports.analysis.modules.standby_creep import (
    DEFAULT_RISE_FRACTION,
    StandbyCreep,
    _daily_idle_floors,
    _label_for,
)

NOW = datetime(2026, 8, 20, 7, 0, tzinfo=timezone.utc)


def _epoch_ms(day: str, hour: int) -> int:
    """⚠️ HOME ASSISTANT'S ACTUAL WIRE FORMAT: epoch MILLISECONDS.

    The fixtures here originally used ISO strings, invented by the author of
    the code under test — so the tests and the code agreed with each other and
    both disagreed with Home Assistant. Phase 3's first live run returned zero
    findings from 11,859 rows with every unit test green. Fixtures now default
    to the real shape; `_hours_iso` below keeps one test on the legacy form so
    both remain supported.
    """
    naive = datetime.strptime(f"{day} {hour:02d}", "%Y-%m-%d %H")
    return int(naive.replace(tzinfo=timezone.utc).timestamp() * 1000)


def _hours(day: str, idle: float, active: float,
           idle_hours: int = 10) -> List[Dict[str, Any]]:
    """One day of hourly rows, in HA's real format."""
    rows: List[Dict[str, Any]] = [
        {"start": _epoch_ms(day, h), "change": idle} for h in range(idle_hours)]
    rows += [{"start": _epoch_ms(day, h), "change": active}
             for h in range(idle_hours, 24)]
    return rows


def _hours_iso(day: str, idle: float, active: float,
               idle_hours: int = 10) -> List[Dict[str, Any]]:
    """The legacy ISO-string form, still accepted."""
    rows: List[Dict[str, Any]] = [
        {"start": f"{day}T{h:02d}:00:00", "change": idle}
        for h in range(idle_hours)]
    rows += [{"start": f"{day}T{h:02d}:00:00", "change": active}
             for h in range(idle_hours, 24)]
    return rows


def _series(idle_by_day: Sequence[float], active: float = 1.0) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for index, idle in enumerate(idle_by_day):
        rows += _hours(f"2026-07-{index + 1:02d}", idle, active)
    return rows


def _context(inventory_ids: Sequence[str], series: Dict[str, Any],
             **kw: Any) -> ModuleContext:
    async def fetch(ids: Sequence[str], days: int) -> Dict[str, Any]:
        return series

    base: Dict[str, Any] = {
        "audience": "owner", "cadence": "weekly", "now_local": NOW,
        "capabilities": ["statistics", "energy_devices"],
        "inventory": {"energy": {"devices": list(inventory_ids)}},
        "settings": {}, "min_history_days": 14, "stats": fetch, "labels": {},
    }
    base.update(kw)
    return ModuleContext(**base)


# ── the idle floor ───────────────────────────────────────────────────────────

def test_idle_floors_are_one_per_day() -> None:
    floors = _daily_idle_floors(_series([0.1] * 5))
    assert len(floors) == 5


def test_a_day_with_too_few_readings_is_dropped_not_filled() -> None:
    """⚠️ A floor computed from three hours is not a floor. Inventing one is
    how a gap in the recorder becomes a finding about a pump."""
    rows = _series([0.1] * 3)
    rows += [{"start": _epoch_ms("2026-07-09", 0), "change": 5.0}]  # one lone hour
    floors = _daily_idle_floors(rows)
    assert len(floors) == 3, "the one-hour day must not produce a floor"


def test_a_meter_reset_is_skipped_not_counted() -> None:
    """`total_increasing` permits a reset, which arrives as a negative change.
    The hour is unusable; the day may still be fine."""
    rows = _hours("2026-07-01", 0.1, 1.0)
    rows.append({"start": _epoch_ms("2026-07-01", 23), "change": -500.0})
    floors = _daily_idle_floors(rows)
    assert len(floors) == 1
    assert floors[0] > 0


def test_the_idle_floor_tracks_idling_not_usage() -> None:
    """⚠️ THE WHOLE IDEA. A device used far more heavily, with the SAME idle
    level, must produce the same floor — otherwise the module reports usage
    changes as equipment faults."""
    light = _daily_idle_floors(_hours("2026-07-01", 0.1, 1.0, idle_hours=20))
    heavy = _daily_idle_floors(_hours("2026-07-01", 0.1, 9.0, idle_hours=12))
    assert abs(light[0] - heavy[0]) < 0.01, (light, heavy)


# ── the module's judgement ───────────────────────────────────────────────────

def _run(series_values: Sequence[float], **kw: Any) -> List[Finding]:
    series = {"sensor.x_energy": _series(series_values)}
    return asyncio.run(StandbyCreep().run(_context(["sensor.x_energy"], series, **kw)))


def test_a_steady_device_produces_nothing() -> None:
    """The most important negative. Alert fatigue is the primary product risk."""
    assert _run([0.10] * 28) == []


def test_a_noisy_but_stable_device_produces_nothing() -> None:
    """A device whose idle floor wanders week to week must not be reported for
    wandering — that is what the learned sigma test is for."""
    wobble = [0.10, 0.13, 0.08, 0.12, 0.09, 0.11, 0.14] * 4
    assert _run(wobble) == []


def test_a_device_that_got_QUIETER_produces_nothing() -> None:
    """A fall in idle draw is not this module's question."""
    assert _run([0.20] * 21 + [0.10] * 7) == []


def test_a_clear_creep_is_found() -> None:
    """21 steady days, then 7 at nearly double. This is the case the module
    exists for and it must be unambiguous."""
    findings = _run([0.10] * 21 + [0.19] * 7)
    assert len(findings) == 1
    finding = findings[0]
    assert finding.kind == "ANOMALY"
    assert finding.baseline is not None and finding.observed is not None
    assert finding.observed > finding.baseline
    assert finding.delta is not None and finding.delta >= DEFAULT_RISE_FRACTION


def test_a_rise_below_the_threshold_is_not_reported() -> None:
    """10% is a real change and not one worth a notification."""
    assert _run([0.10] * 21 + [0.11] * 7) == []


def test_an_operator_threshold_overrides_the_default() -> None:
    """⚠️ The precedence rule, end to end: an operator who wants to hear about
    smaller changes on their property gets to say so."""
    gentle = [0.10] * 21 + [0.115] * 7
    assert _run(gentle) == []
    loud = _run(gentle, settings={"rise_fraction": 0.10})
    assert len(loud) == 1


def test_severity_escalates_with_the_size_of_the_change() -> None:
    modest = _run([0.10] * 21 + [0.16] * 7)
    severe = _run([0.10] * 21 + [0.40] * 7)
    assert modest and severe
    assert modest[0].severity == "notice"
    assert severe[0].severity == "warning"


def test_a_finding_carries_no_entity_id() -> None:
    """⚠️ THE PRIVACY SHAPE. Entity ids carry room and person names, and Phase
    6 sends findings to a third party. `ref` is an opaque handle; the label is
    what a human reads."""
    finding = _run([0.10] * 21 + [0.19] * 7)[0]
    rendered = str(finding.as_dict())
    assert "sensor.x_energy" not in rendered
    assert finding.ref.startswith("d")


def test_confidence_falls_with_an_incomplete_window() -> None:
    """A conclusion drawn from half a window must not present itself with the
    same authority as one drawn from all of it."""
    full = _run([0.10] * 21 + [0.19] * 7)[0]
    partial = _run([0.10] * 14 + [0.19] * 4)
    assert partial, "18 days should still be enough to conclude"
    assert partial[0].confidence < full.confidence
    assert partial[0].completeness < full.completeness


def test_too_little_history_produces_nothing() -> None:
    assert _run([0.10] * 8 + [0.19] * 3) == []


def test_a_dedup_key_is_stable_for_the_same_condition() -> None:
    """Phase 4 needs to tell a NEW problem from one reported three weeks
    running — the key must not embed the measurement."""
    first = _run([0.10] * 21 + [0.19] * 7)[0]
    second = _run([0.10] * 21 + [0.25] * 7)[0]
    assert first.dedup_key == second.dedup_key


# ── the gate ─────────────────────────────────────────────────────────────────

def test_capability_is_checked_before_anything_else() -> None:
    """⚠️ THE ORDER IS THE MESSAGE. "This property has no device metering" is
    more useful than "you have not enabled it" about a module that could never
    have worked — and telling them to enable it would just move the skip."""
    context = _context([], {}, capabilities=["statistics"],
                       settings={"enabled": False})
    ok, reason, _ = gate(StandbyCreep(), context, {}, 30)
    assert not ok and reason == "missing_capability"


def test_an_operator_can_switch_a_module_off() -> None:
    context = _context([], {}, settings={"enabled": False})
    ok, reason, _ = gate(StandbyCreep(), context, {}, 30)
    assert not ok and reason == "disabled"


def test_insufficient_history_is_named_as_such() -> None:
    ok, reason, detail = gate(StandbyCreep(), _context([], {}), {}, 3)
    assert not ok and reason == "insufficient_history"
    assert "3" in detail


def test_audience_mismatch_is_named() -> None:
    class OwnerOnly(StandbyCreep):
        audiences = ("owner",)

    context = _context([], {}, audience="facility")
    ok, reason, _ = gate(OwnerOnly(), context, {}, 30)
    assert not ok and reason == "audience_mismatch"


def test_three_failures_disable_a_module() -> None:
    ok, reason, detail = gate(StandbyCreep(), _context([], {}),
                              {"standby_creep": 3}, 30)
    assert not ok and reason == "errored"
    assert "3" in detail


def test_a_healthy_module_passes_the_gate() -> None:
    """Guard against every gate test above passing vacuously."""
    ok, reason, _ = gate(StandbyCreep(), _context([], {}), {}, 30)
    assert ok and reason == ""


# ── the runner ───────────────────────────────────────────────────────────────

def test_a_module_that_throws_becomes_a_skip_not_a_dead_pass() -> None:
    """⚠️ ONE MODULE MUST NOT TAKE THE PASS DOWN."""
    from reports.analysis import registry

    class Exploding:
        name = "exploding"
        requires: Sequence[str] = ()
        audiences: Sequence[str] = ("owner",)
        min_days = 0

        async def run(self, context: ModuleContext) -> List[Finding]:
            raise RuntimeError("boom")

    saved = registry._snapshot()
    registry._reset_for_tests()
    registry.register(Exploding())  # type: ignore[arg-type]
    try:
        findings, skipped, counts, ran = asyncio.run(
            run_all(_context([], {}), {}, 30))
    finally:
        registry._reset_for_tests()
        for name, module in saved.items():
            registry.register(module)

    assert findings == []
    assert skipped and skipped[0]["reason"] == "errored"
    assert counts["exploding"] == 1, "a failure must be counted toward disabling"
    assert ran == [], "a module that threw did not run"


def test_a_module_that_hangs_is_timed_out() -> None:
    from reports.analysis import registry

    class Hanging:
        name = "hanging"
        requires: Sequence[str] = ()
        audiences: Sequence[str] = ("owner",)
        min_days = 0

        async def run(self, context: ModuleContext) -> List[Finding]:
            await asyncio.sleep(60)
            return []

    saved = registry._snapshot()
    registry._reset_for_tests()
    registry.register(Hanging())  # type: ignore[arg-type]
    original = registry.MODULE_TIMEOUT_S
    registry.MODULE_TIMEOUT_S = 0.05
    try:
        _, skipped, counts, ran = asyncio.run(run_all(_context([], {}), {}, 30))
    finally:
        registry.MODULE_TIMEOUT_S = original
        registry._reset_for_tests()
        for name, module in saved.items():
            registry.register(module)

    assert skipped[0]["reason"] == "timed_out"
    assert counts["hanging"] == 1
    assert ran == [], "a module that timed out did not run"


def test_a_successful_run_clears_the_failure_count() -> None:
    """Otherwise a module that failed twice months ago is one bad week from
    being disabled forever."""
    findings, skipped, counts, ran = asyncio.run(
        run_all(_context(["sensor.x_energy"],
                         {"sensor.x_energy": _series([0.1] * 28)}),
                {"standby_creep": 2}, 30))
    assert counts["standby_creep"] == 0
    assert ran == ["standby_creep"], "a module that ran must be reported as such"


# ── thresholds ───────────────────────────────────────────────────────────────

def test_threshold_precedence() -> None:
    """operator → learned → dimensionless default."""
    assert resolve_threshold({"k": 0.9}, "k", 0.5, 0.4) == 0.9
    assert resolve_threshold({}, "k", 0.5, 0.4) == 0.5
    assert resolve_threshold({}, "k", None, 0.4) == 0.4


def test_a_boolean_annotation_is_not_a_threshold() -> None:
    """`isinstance(True, int)` is True in Python — a JSON `true` would become a
    threshold of 1.0."""
    assert resolve_threshold({"k": True}, "k", None, 0.4) == 0.4


def test_label_never_prints_an_entity_id() -> None:
    assert _label_for("sensor.pool_pump_energy", {}) == "Pool Pump"
    assert _label_for("sensor.x", {"sensor.x": "Chest Freezer"}) == "Chest Freezer"


@pytest.mark.parametrize("kind", ["NONSENSE", ""])
def test_a_finding_refuses_an_unknown_kind(kind: str) -> None:
    """The contract is shared with the SPA; an unknown value renders as
    nothing there and must fail here instead."""
    with pytest.raises(ValueError):
        Finding(ref="d0", kind=kind, severity="info", label="x", detail="y")


def test_the_dedup_key_carries_no_identifier_but_is_stable() -> None:
    """⚠️ Caught by `test_a_finding_carries_no_entity_id` on its first run: the
    key was `module:entity_id`, so every Finding carried an entity id in plain
    text. A dedup key only needs to be stable and unique, never readable."""
    from reports.analysis.base import dedup_key

    key = dedup_key("standby_creep", "sensor.emmas_bedroom_window")
    assert "emmas" not in key and "bedroom" not in key and "sensor." not in key
    assert key.startswith("standby_creep:"), "the module must stay diagnosable"
    assert key == dedup_key("standby_creep", "sensor.emmas_bedroom_window")
    assert key != dedup_key("standby_creep", "sensor.other")


# ── the portability rule, enforced ───────────────────────────────────────────

def test_no_analysis_module_contains_a_physical_constant() -> None:
    """⚠️ "A LITERAL WATTAGE IN CODE IS A DEFECT" — the plan states it; this
    enforces it.

    A threshold that works for one villa's pool pump is wrong for the next
    property's underfloor heating, and the failure is silent: the module runs,
    produces plausible findings, and they are wrong everywhere except where it
    was written. Every threshold must be a RATIO or learned from the device's
    own distribution.

    Docstrings are stripped with `ast`, because this module's comments discuss
    "12 W" and "3 kW" precisely to explain why the code must not contain them —
    a line filter matches that prose and fails on the explanation. That exact
    false positive already happened once, in the delivery test.
    """
    import ast
    import inspect

    from reports.analysis import base, registry, robust
    from reports.analysis.modules import standby_creep

    for module in (base, registry, robust, standby_creep):
        tree = ast.parse(inspect.getsource(module))
        for node in ast.walk(tree):
            if isinstance(node, (ast.Module, ast.FunctionDef,
                                 ast.AsyncFunctionDef, ast.ClassDef)):
                body = node.body
                if (body and isinstance(body[0], ast.Expr)
                        and isinstance(body[0].value, ast.Constant)
                        and isinstance(body[0].value.value, str)):
                    node.body = body[1:] or [ast.Pass()]
        code = ast.unparse(tree).lower()
        for unit in (" w'", '"w"', "watt", "kwh/day", " kw ", "amps", "volts"):
            assert unit not in code, f"{module.__name__} contains {unit!r}"


def test_the_stripper_still_sees_real_code() -> None:
    """Guard against the test above passing over an empty string."""
    import ast
    import inspect

    from reports.analysis.modules import standby_creep

    code = ast.unparse(ast.parse(inspect.getsource(standby_creep)))
    assert "IDLE_PERCENTILE" in code


def test_every_module_threshold_is_dimensionless() -> None:
    """The defaults themselves, checked as values: a fraction or a count of
    sigmas, never a quantity with a unit."""
    from reports.analysis.modules import standby_creep as sc

    assert 0.0 < sc.DEFAULT_RISE_FRACTION < 10.0, "a ratio, not a quantity"
    assert 0.0 < sc.IDLE_PERCENTILE < 1.0, "a percentile"
    assert 0.0 < sc.MIN_FLOOR_OF_MEDIAN < 1.0, "a fraction of the device's own median"
    assert 0.0 < sc.DEFAULT_SIGMA < 100.0, "a count of robust sigmas"


# ── the wire format ──────────────────────────────────────────────────────────
# ⚠️ THE BUG THAT COST PHASE 3 ITS FIRST LIVE RUN. HA sends `start` as epoch
# MILLISECONDS; the code did `str(start)[:10]`, correct for an ISO string and
# catastrophic for a number — the first ten characters of a millisecond
# timestamp change every HOUR. Every hour became its own day, every bucket held
# one row, the half-a-day guard dropped all of them, and 18 meters with 11,859
# rows produced zero findings at every threshold down to 3%.

def test_epoch_milliseconds_bucket_by_day() -> None:
    from reports.analysis.modules.standby_creep import _day_key

    same_day = {_day_key(_epoch_ms("2026-07-01", h), timezone.utc)
                for h in range(24)}
    assert same_day == {"2026-07-01"}, same_day


def test_epoch_seconds_are_understood_too() -> None:
    """HA changed this format once and may again; a module that only knows the
    current wire format breaks on upgrade."""
    from reports.analysis.modules.standby_creep import _day_key

    ms = _epoch_ms("2026-07-01", 12)
    assert _day_key(ms // 1000, timezone.utc) == _day_key(ms, timezone.utc)


def test_iso_strings_are_still_accepted() -> None:
    from reports.analysis.modules.standby_creep import _day_key

    assert _day_key("2026-07-01T13:00:00", timezone.utc) == "2026-07-01"


def test_junk_produces_no_day_rather_than_a_wrong_one() -> None:
    from reports.analysis.modules.standby_creep import _day_key

    for junk in (None, True, "", "short", float("nan")):
        assert _day_key(junk, timezone.utc) == "", junk


def test_days_are_bucketed_in_LOCAL_time() -> None:
    """⚠️ "A day" means the villa's day. On a UTC+8 property, UTC bucketing
    splits every local day across two buckets and puts the small hours —
    exactly when a device is idle — in the wrong one."""
    from zoneinfo import ZoneInfo

    from reports.analysis.modules.standby_creep import _day_key

    # 20:00 UTC on the 1st is 04:00 on the 2nd in Singapore.
    stamp = _epoch_ms("2026-07-01", 20)
    assert _day_key(stamp, timezone.utc) == "2026-07-01"
    assert _day_key(stamp, ZoneInfo("Asia/Singapore")) == "2026-07-02"


def test_the_module_works_end_to_end_on_the_real_wire_format() -> None:
    """The regression at full size: the same creep the module is built to find,
    expressed the way Home Assistant actually sends it."""
    findings = _run([0.10] * 21 + [0.19] * 7)
    assert len(findings) == 1, "epoch-ms rows must produce the same finding"


def test_the_legacy_iso_format_still_produces_the_same_finding() -> None:
    rows: List[Dict[str, Any]] = []
    for index, idle in enumerate([0.10] * 21 + [0.19] * 7):
        rows += _hours_iso(f"2026-07-{index + 1:02d}", idle, 1.0)
    findings = asyncio.run(StandbyCreep().run(
        _context(["sensor.x_energy"], {"sensor.x_energy": rows})))
    assert len(findings) == 1


def test_the_original_expression_would_still_fail_this() -> None:
    """⚠️ Pin the BUG, not only the fix.

    `str(start)[:10]` is what shipped. Asserting that it still produces 24
    distinct "days" from one day of hourly rows means the regression cannot be
    reintroduced by someone simplifying `_day_key` back to a slice — the test
    above would keep passing on the fixture while the code broke on the wire.
    """
    stamps = [_epoch_ms("2026-07-01", h) for h in range(24)]
    naive_buckets = {str(s)[:10] for s in stamps}
    assert len(naive_buckets) == 24, (
        "the original slice must still be shown to be wrong; if this ever "
        "collapses to 1, the fixture no longer reproduces the failure")
