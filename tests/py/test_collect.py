"""The collector — the link between the automation layer and the report.

⚠️ WHY THIS EXISTS AT ALL. The villa's 84 automation instances each "write a
report line", meaning they fire a `vesta_*` event. Home Assistant events are
transient and a search of every automation and script found ZERO listeners, so
those findings were being discarded the instant they were produced. This module
is the memory the detection layer never had.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Dict, List, Sequence

import pytest

from reports import collect, store


@pytest.fixture(autouse=True)
def buffer_file(tmp_path: Any) -> Any:
    """Every test gets its own buffer — never the real /data one."""
    original = store.REPORTS_EVENTS_FILE
    store.REPORTS_EVENTS_FILE = str(tmp_path / "events.json")
    yield store.REPORTS_EVENTS_FILE
    store.REPORTS_EVENTS_FILE = original


def _event(kind: str = "vesta_roi_event", **data: Any) -> Dict[str, Any]:
    return {"event_type": kind, "time_fired": "2026-08-20T10:00:00+00:00",
            "data": data or {"rule_id": "ROI-01", "report_bucket": "Living room AC"}}


class _FakeHass:
    """Stands in for HassClient: yields a fixed run of events, then closes."""

    def __init__(self, events: Sequence[Dict[str, Any]]) -> None:
        self._events = list(events)
        self.subscribed: List[str] = []

    async def __aenter__(self) -> "_FakeHass":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    async def subscribe(self, types: Sequence[str]) -> None:
        self.subscribed = list(types)

    async def events(self) -> AsyncIterator[Dict[str, Any]]:
        for event in self._events:
            yield event


def _collect(events: Sequence[Dict[str, Any]]) -> _FakeHass:
    fake = _FakeHass(events)
    collector = collect.Collector(None, ["vesta_roi_event"])  # type: ignore[arg-type]
    import reports.collect as module

    original = module.HassClient
    module.HassClient = lambda session: fake  # type: ignore[assignment,misc]
    try:
        asyncio.run(collector.run_once())
    finally:
        module.HassClient = original  # type: ignore[assignment]
    return fake


# ── capture ──────────────────────────────────────────────────────────────────

def test_an_event_is_persisted() -> None:
    _collect([_event()])
    assert len(collect.read_buffer()["events"]) == 1


def test_the_whole_payload_is_kept() -> None:
    """⚠️ The blueprints carry `rule_id`, `report_bucket`, duration, kWh and
    cost — a schema this add-on did not design. Picking fields here would
    second-guess it and silently drop whatever a future blueprint adds."""
    _collect([_event(rule_id="ROI-07", report_bucket="Outdoor lights",
                     duration_min=95, kwh=1.4, cost=2380)])
    data = collect.read_buffer()["events"][0]["data"]
    assert data["rule_id"] == "ROI-07"
    assert data["report_bucket"] == "Outdoor lights"
    assert data["kwh"] == 1.4 and data["cost"] == 2380


def test_the_subscription_names_its_event_types() -> None:
    """⚠️ A bare `subscribe_events` streams EVERY event Home Assistant emits,
    including `state_changed` — hundreds a minute across ~484 entities, all
    routed through this add-on's event loop to find a handful of `vesta_*`
    frames a day."""
    fake = _collect([])
    assert fake.subscribed == ["vesta_roi_event"]
    assert "" not in fake.subscribed


def test_the_buffer_is_bounded() -> None:
    """An unbounded file on /data shares a filesystem with Home Assistant's own
    database. Filling it does not degrade the kiosk, it takes down the house."""
    original = collect.MAX_EVENTS
    collect.MAX_EVENTS = 10
    try:
        _collect([_event(seq=n) for n in range(25)])
        events = collect.read_buffer()["events"]
        assert len(events) == 10
        assert events[-1]["data"]["seq"] == 24, "trim kept the OLDEST, not the newest"
    finally:
        collect.MAX_EVENTS = original


def test_which_event_types_actually_arrive_is_recorded() -> None:
    """⚠️ THE EVENT NAMES BEYOND THE FIRST ARE A GUESS. Only `vesta_roi_event`
    is documented, in `roi_idle_load.yaml`'s own description; the rest follow
    the catalog's four categories. Counting what arrives means a wrong name
    shows up as permanently absent rather than as a silence nobody questions."""
    _collect([_event(), _event(), _event("vesta_maintenance_event")])
    seen = collect.read_buffer()["seen_types"]
    assert seen["vesta_roi_event"] == 2
    assert seen["vesta_maintenance_event"] == 1


# ── coverage honesty ─────────────────────────────────────────────────────────

def test_coverage_is_incomplete_when_the_collector_started_late() -> None:
    """⚠️ A WEEK WITH NO FINDINGS AND A WEEK WITH NO LISTENER PRODUCE THE SAME
    EMPTY SECTION, and they mean opposite things. The report has to be able to
    tell the owner which one it was."""
    _collect([_event()])
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat(timespec="seconds")
    assert collect.coverage(week_ago)["complete"] is False


def test_coverage_is_complete_when_listening_predates_the_period() -> None:
    _collect([_event()])
    buffer = collect.read_buffer()
    store.write_json(store.REPORTS_EVENTS_FILE, {**buffer, "online_since": "2020-01-01T00:00:00+00:00"})
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat(timespec="seconds")
    assert collect.coverage(week_ago)["complete"] is True


def test_reconnecting_does_not_reset_the_coverage_claim() -> None:
    """Otherwise every restart would claim full coverage of a period it spent
    switched off — the report would assert something it cannot know."""
    _collect([_event()])
    first = collect.read_buffer()["online_since"]
    _collect([_event()])
    assert collect.read_buffer()["online_since"] == first


# ── querying ─────────────────────────────────────────────────────────────────

def test_events_are_filtered_by_period() -> None:
    _collect([_event()])
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(timespec="seconds")
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
    assert collect.events_since(past)
    assert collect.events_since(future) == []


# ── the capability that decides duplication ──────────────────────────────────

def test_no_events_means_no_blueprint_layer() -> None:
    """A fresh install elsewhere: the built-in modules must run, or that
    property gets a report with nothing in it."""
    assert collect.blueprint_layer_present() is False


def test_recent_events_mean_a_blueprint_layer_is_present() -> None:
    """⚠️ THIS IS WHAT STOPS THE ADD-ON DUPLICATING THE VILLA'S OWN
    AUTOMATIONS. Detected, never configured — neither deployment has to be told
    which kind it is."""
    _collect([_event()])
    assert collect.blueprint_layer_present() is True


def test_only_RECENT_events_count() -> None:
    """A property whose automations were removed months ago should fall back to
    the built-in modules rather than staying silent forever on the strength of
    stale evidence."""
    _collect([_event()])
    buffer = collect.read_buffer()
    old = (datetime.now(timezone.utc) - timedelta(days=200)).isoformat(timespec="seconds")
    buffer["events"][0]["at"] = old
    store.write_json(store.REPORTS_EVENTS_FILE, buffer)
    assert collect.blueprint_layer_present(within_days=30) is False
    assert collect.blueprint_layer_present(within_days=365) is True


# ── the gate ─────────────────────────────────────────────────────────────────

def test_modules_stand_down_when_the_automation_layer_is_present() -> None:
    """⚠️ THE DUPLICATION THIS WHOLE DESIGN EXISTS TO PREVENT. All three
    built-in modules have a deployed blueprint equivalent that does the job
    with occupancy and tariff context they cannot see."""
    from reports.analysis import gate
    from reports.analysis.modules.standby_creep import StandbyCreep
    from reports.analysis.modules.level_anomaly import LevelAnomaly
    from reports.analysis.modules.sensor_health import SensorHealth
    from reports.analysis.base import ModuleContext

    context = ModuleContext(
        audience="owner", cadence="weekly", now_local=datetime.now(timezone.utc),
        capabilities=["statistics", "energy_devices", "blueprint_layer"],
        inventory={}, settings={}, min_history_days=14, stats=None, labels={})

    for module in (StandbyCreep(), LevelAnomaly(), SensorHealth()):
        ok, reason, detail = gate(module, context, {}, 120)
        assert not ok, f"{module.name} ran alongside the automation layer"
        assert "automation layer" in detail


def test_modules_run_when_there_is_no_automation_layer() -> None:
    """The redistributable case, and why nothing was deleted."""
    from reports.analysis import gate
    from reports.analysis.modules.standby_creep import StandbyCreep
    from reports.analysis.base import ModuleContext

    context = ModuleContext(
        audience="owner", cadence="weekly", now_local=datetime.now(timezone.utc),
        capabilities=["statistics", "energy_devices"],
        inventory={}, settings={}, min_history_days=14, stats=None, labels={})
    ok, _, _ = gate(StandbyCreep(), context, {}, 120)
    assert ok, "a property with no blueprints must still get analysis"
