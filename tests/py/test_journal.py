"""The observation floor's journal — materiality, the bound, and restart.

⚠️ EVERY TEST HERE REDIRECTS THE STORE PATH. `journal.JOURNAL_FILE` is
`/data/vesta/journal.json`, which does not exist on a developer machine and must
never be written by a test run even if it does. `_at` monkeypatches the module
constant onto a tmp_path, which is also what makes "survives a restart" testable
at all: a restart is simply a second read of the same file by a fresh call.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List, Optional

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.supervise.observe import journal


@pytest.fixture(autouse=True)
def _at(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> str:
    path = str(tmp_path / "vesta" / "journal.json")
    monkeypatch.setattr(journal, "JOURNAL_FILE", path)
    return path


# ── fixtures shaped like Home Assistant's own state_changed ─────────────────

def _state(value: Any, **attrs: Any) -> Dict[str, Any]:
    return {"state": value, "attributes": dict(attrs)}


def _changed(entity: str = "light.hall", *, old: Any = "off", new: Any = "on",
             old_attrs: Optional[Dict[str, Any]] = None,
             new_attrs: Optional[Dict[str, Any]] = None,
             at: str = "2026-08-22T10:00:00+00:00") -> Dict[str, Any]:
    """One `state_changed`. `old=None` means the entity did not exist before;
    `new=None` means it was removed."""
    return {"event_type": "state_changed", "time_fired": at, "data": {
        "entity_id": entity,
        "old_state": None if old is None else _state(old, **(old_attrs or {})),
        "new_state": None if new is None else _state(new, **(new_attrs or {})),
    }}


# ── rule 1: a state value change is always material ─────────────────────────

def test_a_state_value_change_is_material() -> None:
    assert journal.is_material(_changed(old="off", new="on"))
    assert journal.is_material(_changed(old="23.4", new="23.6"))


def test_an_identical_state_with_no_allow_listed_attribute_change_is_not() -> None:
    """The whole reason this predicate exists. Home Assistant re-publishes a
    state far more often than anything changes."""
    assert not journal.is_material(_changed(old="on", new="on"))


# ── rule 2: availability, in both directions ────────────────────────────────

@pytest.mark.parametrize("old,new", [
    ("on", "unavailable"), ("unavailable", "on"),
    ("on", "unknown"), ("unknown", "on"),
])
def test_availability_transitions_are_always_material(old: str, new: str) -> None:
    """⚠️ The highest-value fault signal the villa produces, and the one a
    future "ignore small changes" refinement is most likely to filter out."""
    assert journal.is_material(_changed(old=old, new=new)), (
        f"{old} -> {new} must never be dropped")


def test_a_removed_entity_is_material() -> None:
    assert journal.is_material(_changed(new=None))
    row = journal.entry_of(_changed(new=None))
    assert row is not None and row["s"] is None


def test_a_first_sighting_is_material() -> None:
    """No old_state means nothing to compare against, so it cannot be a no-op."""
    assert journal.is_material(_changed(old=None))


# ── rule 3: the attribute allow-list ────────────────────────────────────────

def test_a_commanded_attribute_change_is_material() -> None:
    """The setpoint moved while the state stayed 'cool'. Nothing else in Home
    Assistant records that somebody made that choice."""
    event = _changed("climate.lounge", old="cool", new="cool",
                     old_attrs={"temperature": 24}, new_attrs={"temperature": 21})
    assert journal.is_material(event)
    row = journal.entry_of(event)
    assert row is not None and row["a"] == {"temperature": 21}


def test_a_mirrored_measurement_is_NOT_material() -> None:
    """⚠️ THE PRINCIPLE BEHIND THE ALLOW-LIST, pinned as behaviour.
    `current_temperature` is the room temperature, which the villa already
    publishes as its own sensor entity with its own state and statistics.
    Journalling it here duplicates that entity at lower fidelity and multiplies
    the volume of every write for nothing."""
    assert not journal.is_material(_changed(
        "climate.lounge", old="cool", new="cool",
        old_attrs={"current_temperature": 26.4},
        new_attrs={"current_temperature": 26.5}))


def test_the_allow_list_holds_only_commanded_or_discrete_names() -> None:
    """⚠️ A GUARD ON GROWTH, not on the current contents. Every addition costs
    volume on every write, so the burden of proof is on the addition - and the
    names most likely to be added by reflex are the continuously-measured ones
    this design excludes on purpose."""
    forbidden = {"current_temperature", "current_humidity", "media_position",
                 "brightness", "rgb_color", "elevation", "azimuth"}
    overlap = forbidden.intersection(journal.MATERIAL_ATTRIBUTES)
    assert not overlap, (
        f"{sorted(overlap)} mirror a continuously-measured value; each has its "
        "own entity, and admitting one multiplies journal volume for no signal")
    assert len(journal.MATERIAL_ATTRIBUTES) <= 10, (
        "keep the allow-list short - it is evaluated on every state change")


# ── shape ───────────────────────────────────────────────────────────────────

def test_a_malformed_event_is_refused_without_raising() -> None:
    for junk in (None, "", 42, [], {}, {"data": None}, {"data": {}},
                 {"data": {"entity_id": ""}}):
        assert not journal.is_material(junk)
        assert journal.entry_of(junk) is None


def test_the_row_carries_the_events_own_timestamp() -> None:
    """⚠️ Not a write-time clock. `time_fired` is when the change happened; a
    stamp taken at write time is later by however long the queue was, and much
    later after an outage - which is exactly when the history matters most."""
    row = journal.entry_of(_changed(at="2026-08-22T03:14:00+00:00"))
    assert row is not None and row["at"] == "2026-08-22T03:14:00+00:00"


# ── the store ───────────────────────────────────────────────────────────────

def test_append_writes_only_material_rows() -> None:
    written = journal.append([
        _changed("light.a", old="off", new="on"),
        _changed("light.b", old="on", new="on"),          # no-op
        _changed("lock.c", old="locked", new="unlocked"),
    ], now_iso="2026-08-22T10:00:00+00:00")
    assert written == 2
    assert [r["id"] for r in journal.read()["entries"]] == ["light.a", "lock.c"]


def test_a_restart_preserves_the_journal() -> None:
    """A restart IS a second read of the same file — no process to kill."""
    journal.append([_changed("light.a")], now_iso="2026-08-22T10:00:00+00:00")
    journal.append([_changed("light.b")], now_iso="2026-08-22T11:00:00+00:00")
    entries = journal.read()["entries"]
    assert [r["id"] for r in entries] == ["light.a", "light.b"]


def test_online_since_is_set_once_and_never_re_stamped() -> None:
    """⚠️ Re-stamping would make coverage claim the villa had only just started
    being watched, erasing the evidence of everything before the last write."""
    journal.append([_changed("light.a")], now_iso="2026-08-22T10:00:00+00:00")
    journal.append([_changed("light.b")], now_iso="2026-08-22T18:00:00+00:00")
    state = journal.read()
    assert state["online_since"] == "2026-08-22T10:00:00+00:00"
    assert state["last_seen"] == "2026-08-22T18:00:00+00:00"


def test_the_ring_bound_holds_and_keeps_the_NEWEST(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THE RISK THE TASK NAMES: disk growth if the bound is wrong. And the
    direction matters — a ring that dropped NEW rows when full would go quiet
    exactly when the villa got busy.

    ⚠️ MEASURED ON ONE ENTITY'S HISTORY, because that is what the bound is
    about. The first version wrote 25 DIFFERENT entities and asserted 15 of them
    had vanished — which is the defect `_trim`'s floor was added to fix, pinned
    as the requirement. See the test below."""
    monkeypatch.setattr(journal, "JOURNAL_MAX_ENTRIES", 10)
    for i in range(25):
        journal.append([_changed("light.chatty", new=str(i),
                                 at=f"2026-08-22T10:00:{i:02d}+00:00")],
                       now_iso=f"2026-08-22T10:00:{i:02d}+00:00")
    entries = journal.read()["entries"]
    assert len(entries) == 10, "one entity's history is not bounded by the ring"
    assert [r["s"] for r in entries] == [str(i) for i in range(15, 25)], (
        "the ring dropped the NEWEST rows — it would go quiet exactly when the "
        "villa got busy")


def test_every_entity_EVER_SEEN_keeps_at_least_one_row(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THE RING SILENTLY SHRANK THE AGENT'S ADDRESSABLE WORLD, and it took a
    transcript to find. `agent/sources.build_refs` mints one handle per entity
    in this journal, so an entity evicted by the ring becomes one the agent
    cannot address at all — it answered "no pool pump circuit shows up in what I
    can address", of a circuit drawing 863.7 W that the villa had been metering
    all along. True about the journal, false about the villa.

    The bias runs the wrong way, too: a steadily-running pump emits few state
    changes and a chatty signal-strength sensor emits thousands, so the ring
    evicts the equipment somebody would ASK about first.
    """
    monkeypatch.setattr(journal, "JOURNAL_MAX_ENTRIES", 5)
    # One quiet entity, seen once and long ago...
    journal.append([_changed("sensor.pool_pump_power", new="863.7",
                             at="2026-08-22T09:00:00+00:00")],
                   now_iso="2026-08-22T09:00:00+00:00")
    # ...then a chatty one that fills the ring many times over.
    for i in range(40):
        journal.append([_changed("sensor.chatty_signal", new=str(i),
                                 at=f"2026-08-22T10:00:{i:02d}+00:00")],
                       now_iso=f"2026-08-22T10:00:{i:02d}+00:00")

    ids = [r["id"] for r in journal.read()["entries"]]
    assert "sensor.pool_pump_power" in ids, (
        "the quiet entity was evicted, so the agent can no longer address it — "
        "which is the defect, not the bound")
    assert ids.count("sensor.chatty_signal") <= 5, (
        "the chatty entity's history is unbounded")


def test_the_floor_row_keeps_the_journal_CHRONOLOGICAL(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ `since()` COMPARES TIMESTAMPS AS STRINGS and assumes the entries are
    ordered, so a floor row merged in without sorting would make an entity's
    history end before it began — and a reader asking for "the last hour" would
    get rows from before it.

    ⚠️ EVERY ROW IS APPENDED IN ONE CALL, AND THAT IS WHAT MAKES THIS TEST ABLE
    TO FAIL. Appending one at a time trims incrementally, so the stored list is
    re-sorted on every write and the floors come back out in order however the
    merge behaves — a mutation deleting the sort SURVIVED that version. The
    ordering only breaks when a SINGLE trim sees one entity twice with another
    between: floors are collected into a dict, and updating a key keeps its
    FIRST-seen position, so `sensor.quiet`'s LAST row sits where its FIRST one
    was — before a `light.chatty` row that is older than it.
    """
    monkeypatch.setattr(journal, "JOURNAL_MAX_ENTRIES", 3)
    journal.append([
        _changed("sensor.quiet", new="1", at="2026-08-22T09:00:00+00:00"),
        _changed("light.chatty", new="x", at="2026-08-22T09:15:00+00:00"),
        _changed("sensor.quiet", new="2", at="2026-08-22T09:30:00+00:00"),
    ] + [
        _changed("sensor.busy", new=str(i), at=f"2026-08-22T11:00:{i:02d}+00:00")
        for i in range(6)
    ], now_iso="2026-08-22T11:00:05+00:00")

    entries = journal.read()["entries"]
    stamps = [str(r.get("at")) for r in entries]
    assert stamps == sorted(stamps), (
        f"the journal is no longer chronological: {stamps}")
    # And both quiet entities kept their floor, which is the point of the merge.
    ids = {r["id"] for r in entries}
    assert {"sensor.quiet", "light.chatty"} <= ids


def test_a_write_failure_degrades_and_does_not_raise(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """Package rule: a journal that cannot be written must not take down the
    process that was trying to write it."""
    def boom(*_a: Any, **_k: Any) -> None:
        raise OSError("read-only filesystem")
    monkeypatch.setattr(journal.store, "write_json", boom)
    assert journal.append([_changed()], now_iso="x") == 0


def test_reading_an_absent_or_corrupt_journal_degrades(_at: str) -> None:
    assert journal.read()["entries"] == []          # absent
    os.makedirs(os.path.dirname(_at), exist_ok=True)
    with open(_at, "w", encoding="utf-8") as handle:
        handle.write("{ not json")
    assert journal.read()["entries"] == []          # corrupt
    with open(_at, "w", encoding="utf-8") as handle:
        handle.write('["a list, not an object"]')
    assert journal.read()["entries"] == []          # wrong-typed


# ── coverage ────────────────────────────────────────────────────────────────

def test_coverage_distinguishes_quiet_from_not_listening() -> None:
    """⚠️ THE WHOLE POINT. An empty journal because nothing happened and an
    empty journal because nobody was watching are the same file and mean
    opposite things."""
    assert journal.coverage("2026-08-22T00:00:00+00:00")["complete"] is False
    journal.append([_changed()], now_iso="2026-08-22T09:00:00+00:00")
    # Listening since 09:00 cannot speak for a window that opened at 00:00 ...
    assert journal.coverage("2026-08-22T00:00:00+00:00")["complete"] is False
    # ... but can for one that opened at 10:00.
    assert journal.coverage("2026-08-22T10:00:00+00:00")["complete"] is True


def test_coverage_says_when_the_RING_is_the_reason_history_stops(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """Otherwise a full journal looks like a villa with no past."""
    monkeypatch.setattr(journal, "JOURNAL_MAX_ENTRIES", 3)
    assert journal.coverage("")["at_bound"] is False
    for i in range(5):
        journal.append([_changed(f"light.n{i}")], now_iso="2026-08-22T10:00:00+00:00")
    cov = journal.coverage("")
    # ⚠️ `>=`, NOT `==`. Since the per-entity floor was added the stored count
    # can exceed the bound by up to one row per entity — deliberately, because
    # evicting floors to hold an exact number is the addressability defect with
    # extra steps. `at_bound` still means "history older than the window is
    # gone", which is what a reader needs it to mean.
    assert cov["at_bound"] is True and cov["entries"] >= 3


def test_coverage_accepts_an_injected_normaliser() -> None:
    """`collect.as_utc_iso` is passed in rather than imported, so this module
    does not depend on the package PH-5 rewrites."""
    journal.append([_changed()], now_iso="2026-08-22T09:00:00+00:00")
    called: List[str] = []

    def fake(value: str) -> str:
        called.append(value)
        return "2026-08-22T10:00:00+00:00"

    assert journal.coverage("whenever", as_utc=fake)["complete"] is True
    assert called == ["whenever"]


def test_a_malformed_window_is_not_fatal() -> None:
    def explode(_value: str) -> str:
        raise ValueError("not a date")
    journal.append([_changed()], now_iso="2026-08-22T09:00:00+00:00")
    assert journal.coverage("garbage", as_utc=explode)["complete"] is False


# ── since ───────────────────────────────────────────────────────────────────

def test_since_filters_by_timestamp() -> None:
    journal.append([
        _changed("light.a", at="2026-08-22T08:00:00+00:00"),
        _changed("light.b", at="2026-08-22T12:00:00+00:00"),
    ], now_iso="2026-08-22T12:00:00+00:00")
    assert [r["id"] for r in journal.since("2026-08-22T10:00:00+00:00")] == ["light.b"]
    assert len(journal.since("")) == 2


# ── last_report_at ──────────────────────────────────────────────────────────

def test_last_report_at_returns_the_newest_stamp_for_that_entity() -> None:
    journal.append([
        _changed("light.a", at="2026-08-22T08:00:00+00:00"),
        _changed("light.b", at="2026-08-22T09:00:00+00:00"),
        _changed("light.a", at="2026-08-22T12:00:00+00:00"),
    ], now_iso="2026-08-22T12:00:00+00:00")
    assert journal.last_report_at("light.a") == "2026-08-22T12:00:00+00:00"
    assert journal.last_report_at("light.b") == "2026-08-22T09:00:00+00:00"


def test_last_report_at_is_EMPTY_for_an_entity_the_journal_never_heard_of() -> None:
    """⚠️ AND THE CALLER MUST NOT READ THAT AS SILENCE. The journal holds
    material CHANGES, so a steady device can be healthy and absent from it —
    `tools/concern._silence_contradiction` may only ever use a PRESENT row to
    refute a silence claim, never an absent one to support it."""
    journal.append([_changed("light.a")], now_iso="2026-08-22T10:00:00+00:00")
    assert journal.last_report_at("light.zzz") == ""
    assert journal.last_report_at("") == ""


def test_a_REMOVAL_still_counts_as_having_been_heard_from() -> None:
    """⚠️ UNLIKE `last_states`, WHICH DROPS IT. There the question is "what state
    do I seed"; here it is "did the villa hear from this id", and hearing that it
    went away is hearing from it."""
    journal.append([
        _changed("light.gone", at="2026-08-22T08:00:00+00:00"),
        _changed("light.gone", new=None, at="2026-08-22T11:00:00+00:00"),
    ], now_iso="2026-08-22T11:00:00+00:00")
    assert "light.gone" not in journal.last_states()
    assert journal.last_report_at("light.gone") == "2026-08-22T11:00:00+00:00"
