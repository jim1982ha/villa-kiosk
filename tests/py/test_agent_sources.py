"""The wiring: are the tools actually connected to this villa?

⚠️ THE ABSENCE OF THIS FILE IS WHY THE DEFECT SHIPPED. `build_registry()` built
every tool with no arguments while each takes its data source as one, so the
whole tool surface answered about an empty property — and the full suite passed,
because every tool test constructs its subject WITH a source and every loop test
uses fakes. Nothing anywhere asked the one question this file asks: what does
`build_registry()` actually return?
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

from agent import sources                                    # noqa: E402
from agent.registry import build_registry                    # noqa: E402

#: A journal as `observe/journal.py` writes one: short keys, oldest first.
ROWS: List[Dict[str, Any]] = [
    {"at": f"2026-08-{day:02d}T09:00:00Z", "id": "sensor.probe_power",
     "s": str(300 + day)} for day in range(1, 22)
] + [
    {"at": "2026-08-22T09:00:00Z", "id": "sensor.probe_power", "s": "980"},
    {"at": "2026-08-22T09:00:00Z", "id": "binary_sensor.probe_door", "s": "on"},
    {"at": "2026-08-22T10:00:00Z", "id": "binary_sensor.probe_door", "s": "off"},
]


def test_a_ref_is_minted_for_every_entity_the_journal_has_seen() -> None:
    """⚠️ FROM WHAT WAS OBSERVED, not from the HA registry: a device the villa
    has never reported is one no tool can say anything about, so a handle for
    it invites a question with no answer."""
    refs = sources.build_refs(ROWS)
    known = set(refs.known())
    assert len(known) == 2
    assert all(refs.resolve(r) for r in known)
    assert set(refs.resolve(r) for r in known) == {
        "sensor.probe_power", "binary_sensor.probe_door"}


def test_the_scorer_returns_one_result_per_entity() -> None:
    scored = sources.build_scorer(ROWS)()
    assert len(scored) == 2, f"expected one per entity, got {len(scored)}"


def test_an_entity_with_too_little_history_comes_back_UNSCORABLE() -> None:
    """⚠️ NOT OMITTED. `read_salient(include_unscorable=True)` exists so "I
    could not assess these and here is why" is sayable; dropping them turns
    that into silence, which is the failure this whole phase keeps hitting."""
    from observe import salience as salience_mod

    thin = [{"at": "2026-08-22T09:00:00Z", "id": "sensor.new_thing", "s": "5"}]
    scored = sources.build_scorer(thin)()
    assert scored, "a brand-new entity vanished instead of being unscorable"
    assert salience_mod.unscorable(scored), "it claims to be scorable on one sample"


def test_a_STEP_CHANGE_scores_above_a_steady_series() -> None:
    """The scorer is wired to real arithmetic, not to a stub that returns
    zeroes — which would pass every other test here."""
    scored = {s.entity_id: s for s in sources.build_scorer(ROWS)()}
    power = scored["sensor.probe_power"]
    assert power.score > 0, f"a jump from ~320 to 980 scored {power.score}"
    assert power.reason, "no reason given, so the figure cannot be checked"


def test_the_profile_source_counts_DEVICES_not_journal_rows() -> None:
    """⚠️ One chatty sensor would otherwise dominate the villa's own
    description of itself: "sensor: 14,000" says nothing about how many
    sensors exist."""
    facts = sources.build_profile_source(ROWS)()
    assert facts["devices_by_class"] == {"binary_sensor": 1, "sensor": 1}


def test_build_registry_returns_tools_CONNECTED_to_something() -> None:
    """⚠️ THE TEST THAT WAS MISSING. Every tool test builds its subject WITH a
    source and every loop test uses fakes, so nothing ever asked what
    `build_registry()` itself produces. It produced tools wired to nothing, and
    the villa reported it."""
    registry = build_registry()
    assert "read_salient" in registry.names
    tool = registry.get("read_salient")
    assert tool is not None
    assert callable(getattr(tool, "_scorer", None)), (
        "read_salient came back with no scorer — it can only ever return an "
        "empty ranking, which reads as a villa with nothing unusual")
    villa = registry.get("read_villa")
    assert villa is not None
    assert callable(getattr(villa, "_profile_source", None))


def test_every_tool_in_the_registry_either_HAS_a_source_or_REFUSES() -> None:
    """⚠️ THE RULE THAT REPLACES THE SILENT EMPTY. A tool with no source is
    allowed to exist — several have none yet — but it must say so when called,
    never return a result indistinguishable from a quiet villa."""
    registry = build_registry()
    for name in registry.names:
        tool = registry.get(name)
        assert tool is not None
        wired = any(callable(getattr(tool, attr, None))
                    for attr in ("_scorer", "_source", "_profile_source"))
        has_refs = getattr(tool, "_refs", None) is not None
        if wired or has_refs or name in ("read_ledger", "read_concerns",
                                         "read_coverage"):
            continue
        blocks = asyncio.run(tool.call({}))
        assert blocks and ("error" in blocks[0]), (
            f"{name} has no source and returned {blocks!r} rather than "
            f"refusing — indistinguishable from a villa with nothing to report")


def test_a_broken_journal_does_not_take_the_registry_down() -> None:
    """A source that raises must degrade to an empty villa, not to no agent."""
    import observe.journal as journal_mod

    original = journal_mod.read
    journal_mod.read = lambda: (_ for _ in ()).throw(RuntimeError("corrupt"))
    try:
        assert sources.build_refs() is not None
        assert sources.build_scorer()() == []
        assert build_registry().names
    finally:
        journal_mod.read = original


def test_a_QUIET_entity_stays_ADDRESSABLE_after_the_ring_fills(
        tmp_path: Any, monkeypatch: Any) -> None:
    """⚠️ THE PH-2 GATE'S DEFECT, END TO END: journal → refs → "can the agent
    name this device". Reported three times from the villa — "no pool pump
    circuit shows up in what I can address" — of a circuit drawing 863.7 W.

    `build_refs` mints one handle per entity IN THE JOURNAL, which is right
    while the journal covers its window and wrong once the ring is full: what
    survives is then "whatever changed most recently", and a steadily-running
    pump emits far fewer rows than a chatty signal sensor. The equipment worth
    asking about is evicted FIRST.

    This drives the real `journal.append` and the real `build_refs` rather than
    a fixture of either, because the defect lived in the seam between them.
    """
    from observe import journal

    monkeypatch.setattr(journal, "JOURNAL_FILE", str(tmp_path / "j.json"))
    monkeypatch.setattr(journal, "JOURNAL_MAX_ENTRIES", 20)

    def changed(entity: str, value: str, at: str) -> Dict[str, Any]:
        return {"event_type": "state_changed", "time_fired": at, "data": {
            "entity_id": entity,
            "old_state": {"state": "0", "attributes": {}},
            "new_state": {"state": value, "attributes": {}}}}

    quiet = "sensor.quiet_pump_power"
    journal.append([changed(quiet, "863.7", "2026-08-22T09:00:00+00:00")],
                   now_iso="2026-08-22T09:00:00+00:00")
    # A chatty neighbour fills the ring many times over.
    for i in range(120):
        journal.append([changed("sensor.chatty_signal", str(i),
                                f"2026-08-22T1{i // 60}:{i % 60:02d}:00+00:00")],
                       now_iso="2026-08-22T12:00:00+00:00")

    table = sources.build_refs(journal.read()["entries"])
    addressable = {table.resolve(r) for r in table.known()}
    assert quiet in addressable, (
        "the pump was evicted from the journal and is therefore unnameable — "
        "the agent would answer that no such circuit exists, of equipment the "
        "villa is metering right now")
