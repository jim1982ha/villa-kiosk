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
    """Every test gets its own buffer — never the real /data one.

    ⚠️ `_LIVE` IS RESET HERE TOO. It is module-level in-process state, so
    without this a test that opens a subscription leaves `connected: true`
    behind and the next test's assertion passes for the previous test's reason.
    """
    original = store.REPORTS_EVENTS_FILE
    store.REPORTS_EVENTS_FILE = str(tmp_path / "events.json")
    collect._LIVE.update({"connected_since": "", "drops": 0})
    yield store.REPORTS_EVENTS_FILE
    store.REPORTS_EVENTS_FILE = original
    collect._LIVE.update({"connected_since": "", "drops": 0})


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


def _run(fake: _FakeHass) -> _FakeHass:
    """`_collect` for a caller that built its own fake. Same patch idiom."""
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


# ── portability: the subscription must not depend on this villa ──────────────
# ⚠️ AN AUTOMATION INSTANCE IS NAMED BY WHOEVER FILLED THE FORM. On this villa
# they read `roi_idle_load---living_room_ac`; on the next property they will read
# something else entirely. Any code that parses an instance name is code that
# works on exactly one deployment. The BLUEPRINT is the same file everywhere it
# is installed, which is why the subscription is derived from that.

def test_categories_come_from_blueprints_not_automations() -> None:
    listing = {
        "roi_idle_load.yaml": {"metadata": {"author": "VESTA", "name": "VESTA ROI - Idle load"}},
        "maintenance_silence.yaml": {"metadata": {"author": "VESTA", "name": "VESTA Maintenance"}},
        "critical_watchdog.yaml": {"metadata": {"author": "VESTA", "name": "VESTA Critical"}},
    }
    assert collect._categories_from_blueprints(listing) == [
        "critical", "maintenance", "roi"]


def test_a_different_villas_blueprint_set_yields_its_own_events() -> None:
    """The portability property, stated directly: a property with categories
    this villa does not have must be subscribed to correctly, with no code
    change and no configuration."""
    listing = {
        "security_perimeter.yaml": {"metadata": {"author": "VESTA", "name": "VESTA Security"}},
        "comfort_setpoint.yaml": {"metadata": {"author": "VESTA", "name": "VESTA Comfort"}},
    }
    categories = collect._categories_from_blueprints(listing)
    events = [collect.EVENT_TEMPLATE.format(category=c) for c in categories]
    assert events == ["vesta_comfort_event", "vesta_security_event"]


def test_a_blueprint_without_the_vesta_author_field_still_counts() -> None:
    """⚠️ THE BUG THE LOG LINE CAUGHT ON ITS FIRST REAL READING.

    The reference villa's seven `critical_*` blueprints are pre-existing files
    folded into the naming scheme, and carry no author metadata. An
    author-based filter dropped every one of them — the entire P1/P2 tier,
    leaks and unlocked doors included — and the only symptom was a log line
    listing three categories instead of four.
    """
    listing = {
        "critical_watchdog.yaml": {"metadata": {"author": None, "name": "critical_watchdog"}},
        "roi_idle_load.yaml": {"metadata": {"author": "VESTA", "name": "VESTA ROI"}},
    }
    assert collect._categories_from_blueprints(listing) == ["critical", "roi"]


def test_third_party_blueprints_are_excluded_by_their_namespace() -> None:
    """A structural signal — someone else's blueprints live in a folder —
    rather than a metadata field an author may not have filled in."""
    listing = {
        "homeassistant/notify_leaving_zone.yaml": {"metadata": {"author": "Home Assistant", "name": "Notify"}},
        "sbyx/low-battery-detection.yaml": {"metadata": {"author": None, "name": "Low battery"}},
        "_archive/water_leak_tamper.yaml": {"metadata": {"author": None, "name": "Old leak rule"}},
        "roi_idle_load.yaml": {"metadata": {"author": "VESTA", "name": "VESTA ROI"}},
    }
    assert collect._categories_from_blueprints(listing) == ["roi"]


def test_a_dead_subscription_is_preferred_to_a_missing_one() -> None:
    """⚠️ THE TRADE-OFF, STATED. A local `control_*` blueprint yields a
    `vesta_control_event` subscription that will never fire — which costs
    nothing, because Home Assistant simply never sends a frame. A MISSING
    subscription loses every finding in that category forever, with no error
    anywhere. The first version optimised the wrong one.
    """
    listing = {
        "control_humidity_fan.yaml": {"metadata": {"author": None, "name": "Humidity fan"}},
        "critical_watchdog.yaml": {"metadata": {"author": None, "name": "critical_watchdog"}},
    }
    assert collect._categories_from_blueprints(listing) == ["control", "critical"]


def test_a_nested_blueprint_path_still_resolves_its_category() -> None:
    listing = {"vesta/roi_idle_load.yaml": {"metadata": {"author": "VESTA", "name": "VESTA ROI"}}}
    assert collect._categories_from_blueprints(listing) == ["roi"]


def test_a_list_shaped_response_is_accepted_too() -> None:
    """Home Assistant has changed this response shape before; a collector that
    understands only today's form breaks on upgrade."""
    listing = [{"path": "roi_idle_load.yaml", "metadata": {"author": "VESTA", "name": "VESTA ROI"}}]
    assert collect._categories_from_blueprints(listing) == ["roi"]


def test_no_vesta_blueprints_falls_back_rather_than_going_deaf() -> None:
    async def run() -> Any:
        class Empty:
            async def command(self, *a: Any, **k: Any) -> Any:
                return {}
        return await collect.discover_event_types(Empty())  # type: ignore[arg-type]

    types, categories = asyncio.run(run())
    assert types == list(collect.FALLBACK_EVENT_TYPES)
    assert categories == [], (
        "a fallback must not claim a blueprint layer — that decides whether the "
        "built-in modules stand down")


def test_an_unreachable_core_falls_back_rather_than_going_deaf() -> None:
    """A collector that gave up here would silently never listen again."""
    from reports.hass import HassUnavailable

    async def run() -> Any:
        class Broken:
            async def command(self, *a: Any, **k: Any) -> Any:
                raise HassUnavailable("down")
        return await collect.discover_event_types(Broken())  # type: ignore[arg-type]

    types, categories = asyncio.run(run())
    assert types == list(collect.FALLBACK_EVENT_TYPES)
    assert categories == [], "an unreachable Core proves nothing about the property"


def test_no_automation_instance_name_appears_in_the_collector() -> None:
    """⚠️ THE PORTABILITY RULE, ENFORCED. The `---` convention in this villa's
    automation names is a local habit, not a contract. A reference to it here —
    or to any instance name — would tie the add-on to one property."""
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(collect))
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef,
                             ast.ClassDef)):
            body = node.body
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                node.body = body[1:] or [ast.Pass()]
    code = ast.unparse(tree)
    assert "---" not in code, "the collector parses an automation instance name"
    assert "automation." not in code


# ── installed beats fired ────────────────────────────────────────────────────
# ⚠️ THE CHICKEN AND EGG, OBSERVED ON HARDWARE. The built-in modules stand down
# where a detection layer covers the ground, and that was decided by "has an
# event been seen recently" — false on a freshly installed add-on until
# something happens to fire. The reference villa's first collector run logged
# five subscriptions and then produced five duplicate findings, because nothing
# had tripped yet. A quiet villa is when duplicate findings are least wanted.

def test_installed_blueprints_are_enough_to_stand_the_modules_down() -> None:
    buffer = collect.read_buffer()
    store.write_json(store.REPORTS_EVENTS_FILE,
                     {**buffer, "blueprint_categories": ["roi", "critical"]})
    assert collect.blueprint_layer_present() is True, (
        "installed blueprints must count even before anything fires")


def test_a_property_with_no_blueprints_still_runs_the_modules() -> None:
    buffer = collect.read_buffer()
    store.write_json(store.REPORTS_EVENTS_FILE, {**buffer, "blueprint_categories": []})
    assert collect.blueprint_layer_present() is False


def test_the_categories_are_recorded_on_subscribe() -> None:
    fake = _FakeHass([])
    collector = collect.Collector(None)  # type: ignore[arg-type]
    import reports.collect as module

    async def fake_discover(hass: Any) -> Any:
        return (["vesta_roi_event"], ["roi"])

    original_client, original_discover = module.HassClient, module.discover_event_types
    module.HassClient = lambda session: fake  # type: ignore[assignment,misc]
    module.discover_event_types = fake_discover  # type: ignore[assignment]
    try:
        asyncio.run(collector.run_once())
    finally:
        module.HassClient = original_client  # type: ignore[assignment]
        module.discover_event_types = original_discover  # type: ignore[assignment]

    assert collect.read_buffer()["blueprint_categories"] == ["roi"]


def test_an_unreachable_pass_does_not_erase_what_was_established() -> None:
    """A reconnect that could not reach Core must not wipe the record and make
    the modules start duplicating again."""
    buffer = collect.read_buffer()
    store.write_json(store.REPORTS_EVENTS_FILE,
                     {**buffer, "blueprint_categories": ["roi"]})
    collector = collect.Collector(None, ["vesta_roi_event"])  # type: ignore[arg-type]
    collector._mark_online([])          # the fallback path passes no categories
    assert collect.read_buffer()["blueprint_categories"] == ["roi"]


def test_flushing_events_does_not_erase_the_blueprint_record() -> None:
    """⚠️ `_flush` rewrites the whole document, so a key it forgets is a key it
    DELETES. Dropping the categories here would make the built-in modules
    resume duplicating the automation layer on the first flush after
    connecting — a bug with a delay fuse, invisible until the first event."""
    buffer = collect.read_buffer()
    store.write_json(store.REPORTS_EVENTS_FILE,
                     {**buffer, "blueprint_categories": ["roi", "critical"]})
    _collect([_event()])
    assert collect.read_buffer()["blueprint_categories"] == ["roi", "critical"]
    assert collect.blueprint_layer_present() is True


# ── the diagnostic surface ───────────────────────────────────────────────────
# ⚠️ AN INSTRUMENT WITH NO SURFACE IS NOT AN INSTRUMENT. `seen_types` was
# recorded from the first release and exposed nowhere, so the one question it
# exists to answer — is the detection layer reaching the report? — could only be
# answered by reading a file on the host. The first person to ask looked in the
# statistics tally and got `undefined`.

def test_state_reports_what_has_been_heard() -> None:
    _collect([_event(), _event(), _event("vesta_maintenance_event")])
    got = collect.state()
    assert got["buffered"] == 3
    assert got["seen_types"]["vesta_roi_event"] == 2
    assert got["last_event_at"]


def test_connected_reflects_the_live_socket_not_the_stored_history() -> None:
    """⚠️ THE FIELD THAT COULD NEVER SAY NO.

    `listening` was `bool(online_since)` — a PERSISTED value written once and
    never cleared — so it read true forever after the first subscribe, through
    every reconnect and restart, and for a socket that died a week ago. Every
    other field on this surface is interpreted through it: `silent_types` means
    "these categories are quiet" only if something is actually listening, and
    means nothing at all if not.

    Buffered events and a set `online_since` must NOT be enough to claim a live
    connection — that combination is exactly the state a stopped collector
    leaves behind on disk.
    """
    _collect([_event(), _event()])
    buffer = collect.read_buffer()
    store.write_json(store.REPORTS_EVENTS_FILE, {
        **buffer, "online_since": "2026-01-01T00:00:00+00:00"})

    collect._LIVE["connected_since"] = ""
    assert collect.state()["connected"] is False, (
        "a stored online_since must not be reported as a live subscription")

    collect._LIVE["connected_since"] = "2026-08-21T10:00:00+00:00"
    got = collect.state()
    assert got["connected"] is True
    assert got["connected_since"] == "2026-08-21T10:00:00+00:00"
    assert got["online_since"] == "2026-01-01T00:00:00+00:00", (
        "online_since answers a different question — how much of the period "
        "this villa has had any listener — and must survive independently")


def test_a_finished_run_leaves_nothing_claiming_to_be_connected() -> None:
    """⚠️ THE CLEAR IS IN A `finally`, AND THAT IS THE WHOLE FIX.

    `run_once` returns when the socket closes and RAISES on the cancellation
    the add-on's shutdown hook delivers. A clear written after the loop would
    never run on that second path, leaving `connected: true` behind on a
    collector that has stopped — reinstating the exact defect this replaced,
    only harder to see because it would be right most of the time.

    Also asserts it was true DURING the run, or the test would pass just as
    happily against a field that is never set at all.
    """
    seen: List[bool] = []

    class _Observing(_FakeHass):
        async def events(self) -> AsyncIterator[Dict[str, Any]]:
            for event in self._events:
                seen.append(collect.state()["connected"])
                yield event

    _run(_Observing([_event(), _event()]))

    assert seen == [True, True], "connected must be true while subscribed"
    assert collect.state()["connected"] is False
    assert collect.state()["connected_since"] == ""


def test_cancellation_at_shutdown_also_clears_connected() -> None:
    """The path a real add-on restart takes. `run_forever` re-raises
    CancelledError after flushing, and the socket must not be left claimed."""

    class _Hanging(_FakeHass):
        async def events(self) -> AsyncIterator[Dict[str, Any]]:
            yield _event()
            raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        _run(_Hanging([]))

    assert collect.state()["connected"] is False


def test_drops_separates_a_stable_subscription_from_a_flapping_one() -> None:
    """`connected` is true at every glance whether the socket has been up for a
    week or reconnects every minute. The count is what tells them apart."""
    collect._LIVE["drops"] = 0
    assert collect.state()["drops"] == 0
    collect._LIVE["drops"] = 3
    assert collect.state()["drops"] == 3


def test_last_flush_is_not_read_as_the_last_event() -> None:
    """A flush is forced when the socket CLOSES, so the buffer's write time
    moves without anything arriving. Two different questions; two fields."""
    _collect([_event()])
    buffer = collect.read_buffer()
    store.write_json(store.REPORTS_EVENTS_FILE, {
        **buffer, "last_seen": "2026-08-21T23:59:00+00:00"})
    got = collect.state()
    assert got["last_flush"] == "2026-08-21T23:59:00+00:00"
    assert got["last_event_at"] != got["last_flush"]


def test_a_subscribed_but_silent_category_is_named() -> None:
    """⚠️ THE CASE THAT MATTERS. A category with a zero count is either "nothing
    of that kind happened" or "these blueprints do not emit at all" — and the
    second is what hid the entire critical tier. Naming them is what turns a
    silent total failure into a one-line read."""
    buffer = collect.read_buffer()
    store.write_json(store.REPORTS_EVENTS_FILE, {
        **buffer, "blueprint_categories": ["roi", "critical", "maintenance"],
        "seen_types": {"vesta_roi_event": 4},
        "online_since": "2026-01-01T00:00:00+00:00",
    })
    got = collect.state()
    assert got["silent_types"] == ["vesta_critical_event", "vesta_maintenance_event"]
    assert "vesta_roi_event" not in got["silent_types"]


def test_state_carries_no_event_payloads() -> None:
    """A diagnostics endpoint, not a data export. Event payloads carry entity
    ids and operator free text."""
    import json

    _collect([_event(rule_id="ROI-01", report_bucket="Emma's bedroom lamp",
                     entity_id="light.emmas_bedroom")])
    rendered = json.dumps(collect.state())
    assert "light.emmas_bedroom" not in rendered
    assert "Emma's bedroom lamp" not in rendered


def test_state_is_safe_before_anything_has_happened() -> None:
    got = collect.state()
    assert got["connected"] is False
    assert got["buffered"] == 0
    assert got["silent_types"] == []
