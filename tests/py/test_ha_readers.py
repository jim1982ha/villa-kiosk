"""The sources `read_state`, `read_history`, `read_automation_trace` and
`read_schedule` never had. 2.923.0.

⚠️ THREE TOOLS WERE FINISHED AND THE WIRE WAS MISSING — the shape this
repository's `sources.py` header describes for `read_salient`, present one
line further down that same file for the whole life of the HA tools:
`build_tools` constructed them as `cls(refs=refs)`. They did not even refuse:
`read_state` answered `{"states": [], "count": 0}` and `read_automation_trace`
answered "no runs recorded", as DATA, on a villa journalling 1,270 entities.
The ed8d pass of 2026-09-04 shows both in the reason tier's prefix.

⚠️ SO THE TESTS THAT MATTER ARE THE ONES ABOUT THE JOIN, as in
`test_read_logs_source.py`: that a session produces a reader, that no session
produces NONE rather than an empty reader, that each reader speaks the shape
its tool promises, and that an unwired tool now REFUSES rather than answering.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import redact
from vesta.supervise.agent import refs as refs_mod
from vesta.supervise.agent import registry as registry_mod
from vesta.supervise.agent import sources
from vesta.supervise.agent.tools import ha as ha_tools


def _run(awaitable: Any) -> Any:
    return asyncio.new_event_loop().run_until_complete(awaitable)


class _Session:
    """Stands in for aiohttp's session; the readers only pass it through."""


class _FakeHass:
    """`HassClient` with canned answers per command type."""

    answers: Dict[str, Any] = {}
    calls: List[Dict[str, Any]] = []

    def __init__(self, _session: Any) -> None:
        pass

    async def __aenter__(self) -> "_FakeHass":
        return self

    async def __aexit__(self, *_: Any) -> None:
        return None

    async def command(self, command_type: str, **payload: Any) -> Any:
        _FakeHass.calls.append({"type": command_type, **payload})
        return _FakeHass.answers.get(command_type)


@pytest.fixture(autouse=True)
def _fake_hass(monkeypatch: pytest.MonkeyPatch) -> None:
    import vesta.adapters.hass as hass_mod
    _FakeHass.answers, _FakeHass.calls = {}, []
    monkeypatch.setattr(hass_mod, "HassClient", _FakeHass)


def _rest(monkeypatch: pytest.MonkeyPatch, table: Dict[str, Any]) -> List[str]:
    import vesta.adapters.hass as hass_mod
    seen: List[str] = []

    async def rest_get(_session: Any, path: str) -> Any:
        seen.append(path)
        return table.get(path.split("?", 1)[0])

    monkeypatch.setattr(hass_mod, "rest_get", rest_get)
    return seen


# ── no session, no reader ───────────────────────────────────────────────────

def test_no_session_means_NO_READER_for_every_ha_tool() -> None:
    """⚠️ Never a reader that returns `[]` — the `log_reader` rule."""
    readers = sources.ha_readers(None)
    assert set(readers) == set(ha_tools.HA_TOOLS)
    assert all(r is None for r in readers.values())
    for maker in (sources.state_reader, sources.history_reader,
                  sources.trace_reader, sources.schedule_reader):
        assert maker(None) is None, maker.__name__


def test_a_session_produces_a_reader_for_every_ha_tool() -> None:
    readers = sources.ha_readers(_Session())
    assert set(readers) == set(ha_tools.HA_TOOLS), "a tool has no reader row"
    assert all(callable(r) for r in readers.values())


# ── each reader speaks its tool's shape ─────────────────────────────────────

def test_state_reader_fetches_one_state_per_id_not_the_villa(
        monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _rest(monkeypatch, {
        "states/sensor.x": {"entity_id": "sensor.x", "state": "12",
                            "attributes": {"unit_of_measurement": "W"}},
        "states/light.a": {"entity_id": "light.a", "state": "on",
                           "attributes": {}},
    })
    read = sources.state_reader(_Session())
    assert read is not None
    rows = _run(read(["sensor.x", "light.a"]))
    assert [r["entity_id"] for r in rows] == ["sensor.x", "light.a"]
    assert seen == ["states/sensor.x", "states/light.a"], (
        "the reader must not fetch get_states for the whole villa per call")


def test_history_reader_asks_for_a_minimal_series_and_keeps_when_and_what(
        monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _rest(monkeypatch, {
        "history/period/" + sources._since_iso(None, 6): [[
            {"state": "0", "last_changed": "2026-09-04T01:00:00+00:00"},
            {"state": "850", "last_changed": "2026-09-04T02:00:00+00:00"},
        ]],
    })
    read = sources.history_reader(_Session())
    assert read is not None
    points = _run(read("sensor.x", 6))
    assert points == [{"at": "2026-09-04T01:00:00+00:00", "state": "0"},
                      {"at": "2026-09-04T02:00:00+00:00", "state": "850"}]
    assert "minimal_response" in seen[0] and "no_attributes" in seen[0]
    assert "filter_entity_id=sensor.x" in seen[0]


def test_trace_reader_joins_through_the_automations_config_id(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ A trace is keyed by the automation's config `id`, not its entity id."""
    _rest(monkeypatch, {"states/automation.a": {
        "entity_id": "automation.a", "state": "on", "attributes": {"id": "17"}}})
    _FakeHass.answers["trace/list"] = [
        {"timestamp": {"start": "2026-09-04T01:00:00+00:00"},
         "script_execution": "finished", "state": "stopped"},
        {"timestamp": {"start": "2026-09-04T03:00:00+00:00"},
         "script_execution": "timeout", "error": ""},
        {"timestamp": {"start": "2026-09-04T02:00:00+00:00"},
         "script_execution": "", "state": "running"},
    ]
    read = sources.trace_reader(_Session())
    assert read is not None
    runs = _run(read("automation.a", 2))
    assert _FakeHass.calls == [{"type": "trace/list", "domain": "automation",
                                "item_id": "17"}]
    assert [r["outcome"] for r in runs] == ["timeout", "running"], (
        "newest first, cut to the limit")
    assert set(runs[0]) == {"at", "outcome", "error"}


def test_an_automation_with_no_config_id_has_no_traces_to_list(
        monkeypatch: pytest.MonkeyPatch) -> None:
    _rest(monkeypatch, {"states/automation.a_rule": {
        "entity_id": "automation.a_rule", "state": "on", "attributes": {}}})
    read = sources.trace_reader(_Session())
    assert read is not None
    assert _run(read("automation.a_rule", 5)) == []
    assert _FakeHass.calls == [], "no id, no trace/list call"


def test_schedule_reader_joins_on_unique_id_and_flattens_the_week() -> None:
    """⚠️ Through the registry's `unique_id`, never the name: renaming a helper
    changes neither its storage id nor its entity id."""
    _FakeHass.answers["config/entity_registry/get"] = {
        "entity_id": "schedule.pool", "unique_id": "abc123"}
    _FakeHass.answers["schedule/list"] = [
        {"id": "other", "name": "Other", "monday": [{"from": "01:00:00", "to": "02:00:00"}]},
        {"id": "abc123", "name": "Pool pump",
         "monday": [{"from": "07:15:00", "to": "12:00:00"}],
         "wednesday": [{"from": "07:15:00", "to": "12:00:00"},
                       {"from": "15:00:00", "to": "18:00:00"}]},
    ]
    read = sources.schedule_reader(_Session())
    assert read is not None
    blocks = _run(read("schedule.pool"))
    assert blocks == [
        {"day": "monday", "from": "07:15:00", "to": "12:00:00"},
        {"day": "wednesday", "from": "07:15:00", "to": "12:00:00"},
        {"day": "wednesday", "from": "15:00:00", "to": "18:00:00"},
    ]


def test_a_schedule_nobody_can_find_is_an_empty_list_not_an_error() -> None:
    _FakeHass.answers["config/entity_registry/get"] = {"unique_id": "zzz"}
    _FakeHass.answers["schedule/list"] = []
    read = sources.schedule_reader(_Session())
    assert read is not None
    assert _run(read("schedule.none")) == []


# ── the tool end: refusal, publication, redaction ───────────────────────────

def test_every_ha_tool_REFUSES_when_unwired_rather_than_answering_empty() -> None:
    """⚠️ THE DEFECT ITSELF, PINNED. `{"states": [], "count": 0}` from a tool
    with no source is indistinguishable from an empty villa."""
    table = refs_mod.RefTable()
    ref = table.ref_for("sensor.x")
    for tool, args in (
            (ha_tools.ReadState(refs=table), {"refs": [ref]}),
            (ha_tools.ReadHistory(refs=table), {"ref": ref}),
            (ha_tools.ReadAutomationTrace(refs=table), {"ref": ref}),
            (ha_tools.ReadSchedule(refs=table), {"ref": ref})):
        out = _run(tool.call(args))
        assert "error" in out[0], f"{tool.name} answered with no source: {out}"
        assert out[0]["error"]["code"] == "unavailable"
        assert "not connected" in out[0]["error"]["message"]


def test_the_ha_tools_are_WITHHELD_without_a_session_and_PUBLISHED_with_one() -> None:
    """⚠️ PIN THE CALLER. Readers nothing constructs a tool with are the
    fourteenth instance of `feedback_pin-the-caller`."""
    sources._UNWIRED_SEEN.clear()
    sources._UNWIRED_SEEN_NAMES.clear()
    names_without = {t.name for t in sources.build_tools(None)}
    for cls in ha_tools.HA_TOOLS:
        assert cls.name not in names_without, f"{cls.name} published unwired"
        assert cls.name in sources._UNWIRED_SEEN_NAMES
    names_with = {t.name for t in sources.build_tools(_Session())}
    for cls in ha_tools.HA_TOOLS:
        assert cls.name in names_with, f"{cls.name} withheld with a session"
    wired = [t for t in sources.build_tools(_Session())
             if isinstance(t, ha_tools.HA_TOOLS)]
    assert all(callable(getattr(t, "_source", None)) for t in wired)


def test_read_schedule_is_offered_to_the_reason_tier() -> None:
    assert "read_schedule" in registry_mod.REASON_TOOLS


def test_a_schedule_result_survives_the_redaction_scrub() -> None:
    """⚠️ The allow-list is flat and by KEY: a block keyed by weekday would be
    scrubbed to nothing and the model would read an empty schedule."""
    table = refs_mod.RefTable()
    ref = table.ref_for("schedule.pool", "Pool pump hours")
    tool = ha_tools.ReadSchedule(
        source=lambda e: [{"day": "monday", "from": "07:15:00", "to": "12:00:00"}],
        refs=table)
    payload = _run(tool.call({"ref": ref}))[0]["json"]
    scrubbed = redact.scrub(payload)
    assert scrubbed["blocks"] == [{"day": "monday", "from": "07:15:00",
                                   "to": "12:00:00"}]
    assert redact.audit(payload) == []
    assert refs_mod.entity_ids_in(payload) == []


def test_a_synchronous_source_is_still_a_legal_source() -> None:
    """`base.resolved` tests the RESULT, so every unit test here can hand a
    tool a plain lambda while the villa hands it a coroutine."""
    table = refs_mod.RefTable()
    ref = table.ref_for("sensor.x")
    sync = ha_tools.ReadState(source=lambda ids: [
        {"entity_id": "sensor.x", "state": "1", "attributes": {}}], refs=table)

    async def later(ids: Any) -> Any:
        return [{"entity_id": "sensor.x", "state": "2", "attributes": {}}]

    coro = ha_tools.ReadState(source=later, refs=table)
    assert _run(sync.call({"refs": [ref]}))[0]["json"]["states"][0]["state"] == "1"
    assert _run(coro.call({"refs": [ref]}))[0]["json"]["states"][0]["state"] == "2"


def test_a_block_that_is_not_a_weekday_and_two_clock_times_is_dropped() -> None:
    """⚠️ SAFE BY SHAPE. Whatever the source says, a block is a weekday and two
    `HH:MM[:SS]` values; anything else — an id, a name, a sentence — is not a
    block and does not travel."""
    table = refs_mod.RefTable()
    ref = table.ref_for("schedule.pool")
    tool = ha_tools.ReadSchedule(source=lambda e: [
        {"day": "monday", "from": "07:15:00", "to": "12:00"},
        {"day": "someday", "from": "07:15:00", "to": "12:00:00"},
        {"day": "tuesday", "from": "sensor.pool_pump_power", "to": "12:00:00"},
        {"day": "wednesday", "from": "07:15:00", "to": "noon"},
    ], refs=table)
    payload = _run(tool.call({"ref": ref}))[0]["json"]
    assert payload["blocks"] == [{"day": "monday", "from": "07:15:00", "to": "12:00"}]
    assert payload["count"] == 1
