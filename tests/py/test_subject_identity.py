"""One subject identity, from the model's phrasing to the delivered brief.

⚠️ THE DELIVERED BRIEF THAT FOUND IT (owner, 2026-08-30) carried "Pool Pump —
noticed, not investigated" NEXT TO "Pool Pump and Massage Jet Pump —
investigated, nothing to report" — one pump, two names, opposite verdicts. Three
defects stacked: the flag row's TITLE was the model's own phrasing, spelled
differently every pass; an escalation naming two devices kept only ONE
(`_identify` stopped at the first label match), so the other's flag could never
be stamped by the investigation that covered it; and the approval path dropped
the entity id entirely, re-filing a device subject under a `topic:` key — the
handover bug 2.752.0 closed, back through the one door where a human says yes.

The rule, stated once and owned by `contracts`: a subject's IDENTITY is its
device(s) (`subject_entities` / `subject_keys_of`); its DISPLAY NAME is the
villa's own label for them (`flag_rows` + the shared labeller); the model's
phrasing is PROVENANCE — kept in `subject`/`detail` and in the audit transcript,
never used as a grouping key or a rendered name.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import contracts as agent_contracts  # noqa: E402
from vesta.supervise.agent import triage  # noqa: E402


@dataclass
class _Esc:
    subject: str = ""
    reason: str = "because"
    entity_id: str = ""
    entity_ids: Tuple[str, ...] = ()


class _Refs:
    """The slice of a ref table `_identify` reads: known refs with labels."""

    def __init__(self, labels: Dict[str, str]) -> None:  # ref -> (label, id)
        self._rows = {f"d{i}": (label, entity)
                      for i, (label, entity) in enumerate(labels.items())}

    def known(self) -> Tuple[str, ...]:
        return tuple(self._rows)

    def label(self, ref: str) -> str:
        return self._rows.get(ref, ("", ""))[0]

    def resolve(self, ref: str) -> str:
        return self._rows.get(ref, ("", ""))[1]


VILLA = _Refs({
    "Pool pump": "switch.pool",
    "Massage jet pump": "switch.jet",
    "Massage jet pump power": "sensor.jet_power",
    "Massage jet pump power factor": "sensor.jet_pf",
})


def _identify(subject: str) -> _Esc:
    item = _Esc(subject)
    triage._identify([item], VILLA)
    return item


# ── identification: every device, in the subject's own order ────────────────

def test_a_PAIR_subject_attaches_BOTH_devices_in_subject_order() -> None:
    """⚠️ THE CASE FROM THE DELIVERED BRIEF. Keeping one device meant the
    other's flag read "noticed, not investigated" beside the investigation
    that had just covered it."""
    item = _identify("Pool Pump and Massage Jet Pump")
    assert item.entity_ids == ("switch.pool", "switch.jet"), item.entity_ids
    assert item.entity_id == "switch.pool", "the primary is what the model led with"


def test_a_NESTED_label_is_one_mention_not_two_devices() -> None:
    """⚠️ "Massage Jet Pump" is a substring of "Massage Jet Pump Power Factor".
    One mention of the specific device must not ALSO attach the general one —
    longest-label-first claims the span, and a label inside a claimed span is
    the same equipment already matched."""
    item = _identify("Massage Jet Pump Power Factor looks wrong")
    assert item.entity_ids == ("sensor.jet_pf",), item.entity_ids


def test_a_SINGLE_device_subject_is_byte_identical_to_before() -> None:
    item = _identify("the pool pump circuit is drawing oddly")
    assert item.entity_ids == ("switch.pool",)
    assert item.entity_id == "switch.pool"


def test_a_TOPIC_subject_attaches_nothing() -> None:
    """"Coverage incomplete" has no equipment behind it and must keep its
    topic key — an empty list is a real answer, not a failure."""
    item = _identify("observation coverage is incomplete")
    assert item.entity_ids == ()
    assert item.entity_id == ""


def test_the_REVERSE_containment_fallback_still_works() -> None:
    """The model shortens as often as it pads: "Massage Jet" is contained in
    the labels, not containing them, and the shortest containing label wins."""
    item = _identify("Massage Jet")
    assert item.entity_id == "switch.jet", item.entity_id


# ── the keys: one derivation, however many devices ──────────────────────────

def test_keys_fan_out_per_device_and_the_first_is_the_old_singular() -> None:
    pair = _Esc("whatever", entity_ids=("switch.pool", "switch.jet"))
    keys = agent_contracts.subject_keys_of(pair)
    assert keys == [agent_contracts.subject_key("switch.pool"),
                    agent_contracts.subject_key("switch.jet")]

    topic = agent_contracts.subject_keys_of(_Esc("Pool  Pump"))
    assert topic == [agent_contracts.subject_key("topic:pool pump")], (
        "the topic form lost its whitespace collapse")


def test_the_singular_field_still_keys_an_old_shape() -> None:
    """A rebuilt audit row may carry only `entity_id` — the plural reader must
    fall back to it, or every pre-existing row degrades to a topic key."""
    old_shape = _Esc("anything", entity_id="sensor.x")
    assert agent_contracts.subject_entities(old_shape) == ["sensor.x"]
    assert agent_contracts.subject_keys_of(old_shape) == [
        agent_contracts.subject_key("sensor.x")]


# ── the rows: villa names, model text as provenance ─────────────────────────

def _label_of(entity_id: str) -> str:
    return {"switch.pool": "Pool pump", "switch.jet": "Massage jet pump"
            }.get(entity_id, "")


def test_a_pair_flag_writes_ONE_ROW_PER_DEVICE_with_villa_names() -> None:
    """⚠️ ONE ROW PER DEVICE, because every join downstream is per-device:
    the concern keys on one device, the stamp is per key, the brief's merge
    collapses per key. A single pair-row is a row only one device can join."""
    item = _Esc("Pool Pump and Massage Jet Pump",
                entity_ids=("switch.pool", "switch.jet"))
    rows = agent_contracts.flag_rows(item, _label_of)
    assert len(rows) == 2
    assert [r["title"] for r in rows] == ["Pool pump", "Massage jet pump"], (
        "titles must be the villa's own labels, not the model's phrasing")
    assert {r["subject_key"] for r in rows} == set(
        agent_contracts.subject_keys_of(item))
    # the model's phrasing survives as provenance on every row
    assert all(r["subject"] == "Pool Pump and Massage Jet Pump" for r in rows)


def test_an_EMPTY_label_falls_back_to_the_model_text_never_the_id() -> None:
    """⚠️ The labeller degrades to "" on any failure, and a raw entity id in a
    brief is the exact leak the payload allow-list exists to stop."""
    item = _Esc("the mystery device", entity_ids=("switch.unmapped",))
    rows = agent_contracts.flag_rows(item, lambda _e: "")
    assert rows[0]["title"] == "the mystery device"
    assert "switch.unmapped" not in rows[0]["title"]


def test_a_topic_flag_writes_one_row_keyed_as_a_topic() -> None:
    rows = agent_contracts.flag_rows(_Esc("coverage  is  incomplete"))
    assert len(rows) == 1
    assert rows[0]["title"] == "coverage is incomplete"
    assert rows[0]["subject_key"] == agent_contracts.subject_key(
        "topic:coverage is incomplete")


# ── the stamp: every device's row, not the first ────────────────────────────

def test_the_investigation_stamps_EVERY_devices_flag(tmp_path, monkeypatch) -> None:
    """⚠️ PIN THE CALLER (`feedback_pin-the-caller`). A perfect key fan-out
    nobody iterates leaves the second device's flag reading "noticed, not
    investigated" beside the investigation that covered it — the delivered
    symptom, unchanged."""
    from vesta.adapters import record as record_mod, store
    # ⚠️ THE FILE, NOT DATA_DIR — the path constants are derived at import
    # time, so patching the root alone still writes to /data. Same fixture
    # shape as `test_record._isolated`.
    monkeypatch.setattr(store, "RECORD_FILE", str(tmp_path / "record.json"))
    from vesta.supervise.agent import reason

    item = _Esc("Pool Pump and Massage Jet Pump",
                entity_ids=("switch.pool", "switch.jet"))
    for row in agent_contracts.flag_rows(item, _label_of):
        assert record_mod.append(row)

    reason._mark_looked_at(item)

    outcomes = {r["subject_key"]: r.get("outcome")
                for r in record_mod.read()}
    for key in agent_contracts.subject_keys_of(item):
        assert outcomes[key] == reason.INVESTIGATED_NOTHING, (
            f"key {key} was flagged but never stamped — the second device "
            "of a pair is still invisible to its own investigation")


# ── approval: identity survives the human round-trip ────────────────────────

def test_approval_rebuilds_the_devices_from_the_audit_row() -> None:
    """⚠️ THE DOOR THE HANDOVER BUG CAME BACK THROUGH. A queued row stored only
    the subject text, so an approved investigation re-keyed a device subject as
    `topic:` — a key the rules side can never produce."""
    from vesta.supervise.agent import reason
    row = {"subject": "Pool Pump and Massage Jet Pump",
           "detail": "drawing at zero through its window",
           "entity_ids": "switch.pool,switch.jet"}
    rebuilt = reason._queued_from(row)
    assert agent_contracts.subject_entities(rebuilt) == [
        "switch.pool", "switch.jet"]
    assert agent_contracts.subject_keys_of(rebuilt)[0] == \
        agent_contracts.subject_key("switch.pool")


def test_a_PRE_EXISTING_row_without_ids_still_rebuilds() -> None:
    row = {"subject": "coverage incomplete", "detail": "gap"}
    from vesta.supervise.agent import reason
    rebuilt = reason._queued_from(row)
    assert agent_contracts.subject_entities(rebuilt) == []
    assert agent_contracts.subject_keys_of(rebuilt) == [
        agent_contracts.subject_key("topic:coverage incomplete")]


# ── the seed: the investigator is handed EVERY device ───────────────────────

class _SeedRefs:
    def __init__(self) -> None:
        self.minted: List[Tuple[str, str]] = []

    def ref_for(self, entity_id: str, label: str = "") -> str:
        self.minted.append((entity_id, label))
        return f"d{len(self.minted)}"


def test_a_pair_seed_mints_a_handle_for_each_device() -> None:
    """⚠️ The model investigating a pair used to be handed ONE handle and had
    to rediscover the other through search — the tool whose results the
    redactor refuses."""
    from vesta.supervise.agent import runtime
    refs = _SeedRefs()
    out = runtime._seeded([{"role": "user", "content": "look into it"}],
                          (("switch.pool", "switch.jet"), "Pool and Jet"),
                          refs)
    assert [m for m, _l in refs.minted] == ["switch.pool", "switch.jet"]
    note = out[0]["content"]
    assert "d1 and d2" in note, note
    assert "switch.pool" not in note, "a raw id reached the model"


def test_a_single_seed_sentence_is_byte_identical_to_before() -> None:
    """⚠️ The single-device sentence is pinned VERBATIM: chat and every
    existing investigation path must not acquire different words."""
    from vesta.supervise.agent import runtime
    refs = _SeedRefs()
    out = runtime._seeded([{"role": "user", "content": "q"}],
                          ("switch.pool", "Pool pump"), refs)
    assert out[0]["content"].startswith(
        "The device this is about is d1 (Pool pump). Use that handle when "
        "you record a concern about it.")
    assert refs.minted == [("switch.pool", "Pool pump")]
