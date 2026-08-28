"""The observation cycle — cadence, diffing, and staying out of the loop's way.

⚠️ THE CYCLE POLLS, AND `REQ-001` SAYS IT MAY: its acceptance is "a change made
in HA appears within ONE CYCLE", which is poll semantics written as a criterion.
The cost is that a value which changes and changes back inside one cadence is
invisible — acceptable for "what is unusual", "what stopped reporting" and
"what drifted", all of which are about levels sustained over hours, and NOT
acceptable for anything counting transitions. That limitation is asserted here
rather than left to be discovered as a wrong answer.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List, Mapping

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.supervise.observe import cycle
from vesta.supervise.observe import journal
from vesta.adapters import store


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(journal, "JOURNAL_FILE",
                        str(tmp_path / "vesta" / "journal.json"))
    cycle._LAST.clear()


def _state(entity: str, value: Any, **attrs: Any) -> Dict[str, Any]:
    return {"entity_id": entity, "state": value, "attributes": dict(attrs),
            "last_changed": "2026-08-22T10:00:00+00:00"}


# ── cadence ─────────────────────────────────────────────────────────────────

def test_the_cadence_comes_from_config_not_a_literal() -> None:
    """⚠️ TASK-014's constraint. A villa with a slow HA and one with 3,000
    entities want different numbers; a period compiled into the image is a
    per-property constant by another name."""
    assert cycle.cadence_minutes({"observe_cycle_minutes": 30}) == 30.0
    assert cycle.cadence_minutes({"observe_cycle_minutes": 5}) == 5.0


def test_an_absent_or_unusable_cadence_falls_back_to_the_default() -> None:
    for junk in (None, {}, {"observe_cycle_minutes": None},
                 {"observe_cycle_minutes": "banana"},
                 {"observe_cycle_minutes": float("nan")}):
        assert cycle.cadence_minutes(junk) == float(cycle.CADENCE_DEFAULT_MINUTES)


def test_the_cadence_has_a_floor_so_a_typo_cannot_hammer_home_assistant() -> None:
    """⚠️ The damage a zero would do is to the HA instance, not to this add-on
    — exactly the kind a config typo must not be able to cause."""
    for tiny in (0, -1, 0.001):
        assert cycle.cadence_minutes({"observe_cycle_minutes": tiny}) == \
            float(cycle.CADENCE_MIN_MINUTES)


def test_the_key_is_a_real_config_key_the_store_defines() -> None:
    """Not an unknown key that merely survives `config_view` by accident."""
    assert cycle.CADENCE_KEY in store.CONFIG_DEFAULTS
    assert store.CONFIG_DEFAULTS[cycle.CADENCE_KEY] == cycle.CADENCE_DEFAULT_MINUTES


def test_config_view_round_trips_the_cadence() -> None:
    view = store.config_view({"observe_cycle_minutes": 45})
    assert cycle.cadence_minutes(view) == 45.0
    assert cycle.cadence_minutes(store.config_view({})) == 15.0


# ── diffing ─────────────────────────────────────────────────────────────────

def test_a_changed_state_produces_a_state_changed_event() -> None:
    before = cycle._index([_state("light.a", "off")])
    after = cycle._index([_state("light.a", "on")])
    events = cycle.diff_states(before, after, "2026-08-22T10:05:00+00:00")
    assert len(events) == 1
    assert events[0]["event_type"] == "state_changed"
    assert events[0]["data"]["old_state"]["state"] == "off"
    assert events[0]["data"]["new_state"]["state"] == "on"
    assert journal.is_material(events[0])


def test_an_unchanged_state_produces_nothing() -> None:
    same = cycle._index([_state("light.a", "on")])
    assert cycle.diff_states(same, same, "x") == []


def test_a_disappeared_entity_produces_a_removal_event() -> None:
    """⚠️ A removal is a fact about the villa. Without this it would silently
    cease to appear, which reads identically to never having existed."""
    before = cycle._index([_state("light.gone", "on")])
    events = cycle.diff_states(before, {}, "2026-08-22T10:05:00+00:00")
    assert len(events) == 1 and events[0]["data"]["new_state"] is None
    assert journal.is_material(events[0])


def test_the_first_cycle_treats_every_entity_as_new() -> None:
    """⚠️ Correct, and not noise: the journal genuinely has no record of any of
    them, and one baseline row per entity is what makes cycle two meaningful."""
    after = cycle._index([_state("light.a", "on"), _state("light.b", "off")])
    events = cycle.diff_states({}, after, "x")
    assert len(events) == 2
    assert all(e["data"]["old_state"] is None for e in events)


def test_only_allow_listed_attributes_are_retained_between_cycles() -> None:
    """⚠️ This dict is held in memory for every entity in the villa between
    cycles. Retaining HA's full state objects to answer "did it change" is a
    leak with a respectable name."""
    indexed = cycle._index([_state(
        "climate.x", "cool", temperature=21, current_temperature=26.4,
        friendly_name="Lounge AC", supported_features=17)])
    kept = indexed["climate.x"]["attributes"]
    assert kept == {"temperature": 21}
    assert "current_temperature" not in kept and "friendly_name" not in kept


def test_a_mirrored_measurement_moving_alone_produces_no_event() -> None:
    """The materiality rule surviving the round trip through the index: only
    allow-listed attributes are kept, so a room warming by a tenth of a degree
    cannot manufacture a journal row."""
    before = cycle._index([_state("climate.x", "cool", temperature=21,
                                  current_temperature=26.4)])
    after = cycle._index([_state("climate.x", "cool", temperature=21,
                                 current_temperature=26.9)])
    assert cycle.diff_states(before, after, "x") == []


def test_malformed_rows_are_skipped_rather_than_crashing_the_cycle() -> None:
    indexed = cycle._index([None, "junk", {}, {"entity_id": ""},
                            _state("light.ok", "on")])  # type: ignore[list-item]
    assert list(indexed) == ["light.ok"]


# ── one cycle end to end ────────────────────────────────────────────────────

class _FakeHass:
    """Stands in for HassClient. Records what was asked for."""

    def __init__(self, states: List[Dict[str, Any]]) -> None:
        self.states, self.asked = states, []      # type: ignore[var-annotated]

    async def __aenter__(self) -> "_FakeHass":
        return self

    async def __aexit__(self, *_a: Any) -> bool:
        return False

    async def command(self, command_type: str, **_p: Any) -> Any:
        self.asked.append(command_type)
        return self.states


def _run(coro: Any) -> Any:
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


def test_a_cycle_journals_what_changed_and_reports_counts(
        monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeHass([_state("light.a", "on"), _state("light.b", "off")])
    monkeypatch.setattr(cycle, "HassClient", lambda _s: fake)

    first = _run(cycle.run_once(None, now_iso="2026-08-22T10:00:00+00:00"))  # type: ignore[arg-type]
    assert first["entities"] == 2
    assert first["changed"] == 2 and first["journalled"] == 2
    assert fake.asked == ["get_states"]

    # Nothing moved: a second cycle journals nothing.
    second = _run(cycle.run_once(None, now_iso="2026-08-22T10:15:00+00:00"))  # type: ignore[arg-type]
    assert second["changed"] == 0 and second["journalled"] == 0

    # One entity moves.
    fake.states = [_state("light.a", "off"), _state("light.b", "off")]
    third = _run(cycle.run_once(None, now_iso="2026-08-22T10:30:00+00:00"))  # type: ignore[arg-type]
    assert third["changed"] == 1 and third["journalled"] == 1
    assert [r["id"] for r in journal.read()["entries"]][-1] == "light.a"


def test_the_cycle_returns_counts_rather_than_logging_them(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ `log.py` is this subsystem's ONE entry point for output. A module that
    printed its own line would be the second, and `run_forever` owns the line so
    the cycle stays testable without capturing stdout."""
    monkeypatch.setattr(cycle, "HassClient", lambda _s: _FakeHass([]))
    counts = _run(cycle.run_once(None))  # type: ignore[arg-type]
    assert set(counts) >= {"entities", "changed", "journalled"}


# ── the proxy wiring ────────────────────────────────────────────────────────

PROXY = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")


def _proxy_source() -> str:
    with open(PROXY, encoding="utf-8") as handle:
        return handle.read()


def test_the_cycle_is_registered_as_a_task_in_the_existing_loop() -> None:
    """⚠️ TASK-014's constraint: no new s6 service. A third supervised service
    would be a third thing to start, stop, watch and misconfigure."""
    source = _proxy_source()
    assert "observe_cycle.run_forever" in source
    assert 'a["observe_cycle"] = asyncio.create_task(' in source


def test_the_cycle_task_is_cancelled_on_cleanup() -> None:
    """⚠️ Otherwise aiohttp's shutdown is held open until the timeout — the
    same trap the two existing tasks are cancelled to avoid."""
    source = _proxy_source()
    # ⚠️ ANCHOR ON THE DEFINITION, NOT THE WORD. `on_cleanup` first appears
    # inside a COMMENT in on_start ("Cancelled in on_cleanup so ..."), so
    # splitting on the bare string read the wrong region and this assertion
    # failed against correct code.
    body = source.split("async def on_cleanup")[1][:400]
    assert '"observe_cycle"' in body, (
        "the observation task must be cancelled alongside the other two")


def test_no_new_s6_service_was_added() -> None:
    services = os.path.join(REPO_ROOT, "rootfs", "etc", "s6-overlay",
                            "s6-rc.d")
    if not os.path.isdir(services):
        pytest.skip("no s6 tree in this checkout")
    assert not any("observe" in name for name in os.listdir(services)), (
        "the observation cycle must run in the existing loop, not as a service")


# ── a restart is not a cold start ───────────────────────────────────────────

def test_a_RESTART_rejournals_only_what_actually_moved(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THE DEFECT THAT FILLED THE RING, AND THE REASON THE OWNER SAW A
    "journal full" CONCERN. `_LAST` is process memory and the journal is on
    disk; nothing joined them, so every restart saw `previous = {}`, called all
    1,256 entities new and wrote the whole villa in one cycle — ~12 cycles, i.e.
    three hours of history, evicted to re-record states already held. Eleven
    restarts in one afternoon of dev releases cost over a day of the window.
    """
    fake = _FakeHass([_state("light.a", "on"), _state("light.b", "off"),
                      _state("light.c", "on")])
    monkeypatch.setattr(cycle, "HassClient", lambda _s: fake)
    first = _run(cycle.run_once(None, now_iso="2026-08-22T10:00:00+00:00"))  # type: ignore[arg-type]
    assert first["changed"] == 3 and first["seeded"] == 0, "cold start sweeps"

    # The process restarts: memory is gone, the journal is not.
    cycle._LAST.clear()
    fake.states = [_state("light.a", "off"), _state("light.b", "off"),
                   _state("light.c", "on")]
    after = _run(cycle.run_once(None, now_iso="2026-08-22T10:15:00+00:00"))  # type: ignore[arg-type]
    assert after["seeded"] == 3, "the baseline must come back from the journal"
    assert after["changed"] == 1 and after["journalled"] == 1, (
        "only light.a moved while the process was down; the other two were "
        "already on record and re-recording them is what evicted the history")


def test_the_COLD_start_sweep_is_preserved(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THE OTHER HALF, AND IT IS NOT SYMMETRIC WITH THE ONE ABOVE. On a
    genuinely empty journal the sweep is correct — one baseline row per entity
    is what makes cycle two's diff mean anything. The fix must be able to tell
    the two apart, and it does so by what the journal HOLDS rather than by a
    flag somebody has to set."""
    monkeypatch.setattr(cycle, "HassClient",
                        lambda _s: _FakeHass([_state("light.a", "on"),
                                              _state("light.b", "off")]))
    counts = _run(cycle.run_once(None, now_iso="2026-08-22T10:00:00+00:00"))  # type: ignore[arg-type]
    assert counts["seeded"] == 0 and counts["changed"] == 2


def test_a_SEEDED_baseline_does_not_fabricate_an_attribute_change(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THE SAME DEFECT AT A TENTH OF THE SIZE, and the reason `attributes`
    seeds as None rather than `{}`. A journal row carries `a` only when a
    material attribute CHANGED, so there is no full attribute set to seed with
    — and comparing an empty dict against a real one re-journals every climate
    unit, cover and battery device on every restart."""
    fake = _FakeHass([_state("climate.x", "cool", temperature=21)])
    monkeypatch.setattr(cycle, "HassClient", lambda _s: fake)
    _run(cycle.run_once(None, now_iso="2026-08-22T10:00:00+00:00"))  # type: ignore[arg-type]

    cycle._LAST.clear()
    counts = _run(cycle.run_once(None, now_iso="2026-08-22T10:15:00+00:00"))  # type: ignore[arg-type]
    assert counts["seeded"] == 1
    assert counts["changed"] == 0, (
        "nothing moved, but the seeded baseline knows no attributes — an "
        "unknown compared as {} reports a change that did not happen")


def test_an_entity_REMOVED_before_the_restart_is_not_seeded(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """Its last row is a removal, it is already recorded as gone, and seeding
    it would make the next cycle emit a SECOND removal for an entity that left
    the villa weeks ago."""
    fake = _FakeHass([_state("light.a", "on"), _state("light.b", "on")])
    monkeypatch.setattr(cycle, "HassClient", lambda _s: fake)
    _run(cycle.run_once(None, now_iso="2026-08-22T10:00:00+00:00"))  # type: ignore[arg-type]
    fake.states = [_state("light.a", "on")]          # light.b disappears
    _run(cycle.run_once(None, now_iso="2026-08-22T10:15:00+00:00"))  # type: ignore[arg-type]

    cycle._LAST.clear()
    counts = _run(cycle.run_once(None, now_iso="2026-08-22T10:30:00+00:00"))  # type: ignore[arg-type]
    assert counts["seeded"] == 1, "the removed entity must not come back"
    assert counts["changed"] == 0


def test_last_states_takes_the_NEWEST_row_per_entity() -> None:
    """The seed is only as good as this: an older row winning would restore a
    stale baseline and re-journal the entity on the next cycle."""
    journal.append([{"event_type": "state_changed", "time_fired": "t1",
                     "data": {"entity_id": "light.a", "old_state": None,
                              "new_state": {"state": "on", "attributes": {}}}},
                    {"event_type": "state_changed", "time_fired": "t2",
                     "data": {"entity_id": "light.a",
                              "old_state": {"state": "on", "attributes": {}},
                              "new_state": {"state": "off",
                                            "attributes": {}}}}],
                   now_iso="t2")
    assert journal.last_states() == {"light.a": "off"}
