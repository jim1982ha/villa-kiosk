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


# ── the shape the reference villa actually has ──────────────────────────────
#
# ⚠️ THIS BLOCK EXISTS BECAUSE THE FIRST FIX SHIPPED AND DID NOT WORK
# (2026-08-30). Every fixture above uses labels the model's subject CONTAINS
# ("Pool pump" inside "Pool Pump and Massage Jet Pump"), which exercises the
# forward direction. The reference villa labels its pumps "Pool Pump Power" —
# the model drops the suffix — so forward matches NOTHING there and every
# single-device subject is identified by the reverse rule instead. That rule
# only ever tested the WHOLE subject, so a compound was never inside any label
# and kept a `topic:` key: the exact reported symptom, still open after a
# release that only generalised the direction which was not doing the work.
# Labels here are archetypes with the villa's SHAPE, not its data.

SUFFIXED = _Refs({
    "Massage Jet Pump Power": "sensor.jet_power",
    "House Pump Power": "sensor.house_power",
    "Pool Pump Power": "sensor.pool_power",
    "Jacuzzi Pump Power": "sensor.jacuzzi_power",
    "Onsen Pump Power": "sensor.onsen_power",
})


def _suffixed(subject: str) -> Tuple[str, ...]:
    item = _Esc(subject)
    triage._identify([item], SUFFIXED)
    return item.entity_ids


def test_a_COMPOUND_subject_resolves_when_labels_carry_a_suffix() -> None:
    """⚠️ THE REPORTED CASE, WITH THE VILLA'S OWN LABEL SHAPE. No label is
    inside this subject, so only a per-SPAN reverse match can find either
    device."""
    assert _suffixed("Pool Pump and Massage Jet Pump") == (
        "sensor.pool_power", "sensor.jet_power")


def test_single_device_subjects_still_resolve_against_suffixed_labels() -> None:
    """The case the deleted whole-subject fallback used to answer — the span
    loop tries the maximal span first, so it answers it too."""
    assert _suffixed("Pool Pump") == ("sensor.pool_power",)
    assert _suffixed("House Pump") == ("sensor.house_power",)
    assert _suffixed("the pool pump circuit") == ("sensor.pool_power",)


def test_a_BARE_COMMON_WORD_names_no_device() -> None:
    """⚠️ THE GUARD THE DELETED FALLBACK LACKED, AND IT MATTERED. Five labels
    here end in "Pump Power", so "pump" is inside all of them; without a share
    rule the shortest-label tie-break attaches one at random — inventing a
    device the model never named. Measured with the old block still present:
    "pump" resolved to the pool pump."""
    assert _suffixed("pump") == ()
    assert _suffixed("the villa") == ()


def test_a_suffixed_label_inside_the_subject_still_wins_on_specificity() -> None:
    """Forward and reverse keep opposite tie-breaks: a label found INSIDE the
    subject is the model padding, so the longest (most specific) label wins."""
    assert _suffixed("Massage Jet Pump Power Factor") == ("sensor.jet_power",)


def test_the_share_rule_is_dimensionless() -> None:
    """⚠️ A ratio, never a character count — a threshold in characters is tuned
    to one property's naming and wrong on the next."""
    assert 0.0 < triage.REVERSE_MIN_SHARE < 1.0


# ── the instrument: WHY a subject was not identified ────────────────────────

def test_the_note_separates_a_failed_MATCH_from_an_empty_CANDIDATE_SET() -> None:
    """⚠️ `N/N identified` CANNOT TELL THESE APART, AND THEY NEED OPPOSITE FIXES
    (2026-08-30). Two consecutive live passes read `0/1 identified` for a subject
    the villa plainly has, with labels of the shape the reverse rule was built
    for. Either the matcher failed on labels it was given, or NO handle was
    minted for that device this run and there was nothing to match against —
    `_identify` only ever sees `refs.known()`, so the second is possible and is
    invisible to every test of the matcher, which hands it the labels directly.
    """
    # A populated table: the matcher was given candidates and still missed.
    matched_nothing = triage._unidentified_note([_Esc("Something Else")], VILLA)
    assert "'Something Else'" in matched_nothing
    assert "4 candidate label(s)" in matched_nothing

    # An EMPTY table: nothing could ever have matched, whatever the rule does.
    nothing_to_match = triage._unidentified_note([_Esc("Pool pump")], _Refs({}))
    assert "0 candidate label(s)" in nothing_to_match


def test_the_note_is_SILENT_when_every_subject_identified() -> None:
    assert triage._unidentified_note([_identify("Pool pump")], VILLA) == ""
    assert triage._unidentified_note([], VILLA) == ""


def test_the_note_is_CAPPED_and_says_how_many_it_hid() -> None:
    many = [_Esc(f"Unknown {i}") for i in range(6)]
    note = triage._unidentified_note(many, VILLA)
    assert "+3 more" in note, note
    assert note.count("'Unknown") == triage.MAX_REPORTED_UNIDENTIFIED


def test_the_note_carries_NO_entity_id() -> None:
    """⚠️ THE SUBJECT IS THE MODEL'S OWN WORDS, so it may be logged; the
    candidate COUNT is logged rather than the labels, which would put the
    villa's device list into the log on every quiet pass."""
    from vesta.supervise.agent import refs as refs_mod
    note = triage._unidentified_note([_Esc("Pool pump circuit")], VILLA)
    assert refs_mod.entity_ids_in(note) == [], note
    assert "switch.pool" not in note


def test_the_note_never_fails_the_PASS_that_produced_it() -> None:
    """A diagnostic on the end of a stage line must not be able to raise."""
    class _Boom:
        def known(self) -> Any:
            raise RuntimeError("table gone")

    assert triage._unidentified_note([_Esc("x")], _Boom()) == ""
    assert triage._unidentified_note([_Esc("x")], None) == (
        " (unidentified: 'x'; 0 candidate label(s))")


# ── the villa spells a number without a space; the model spells it with one ──

BEDROOM = _Refs({"Bedroom1 Light Power": "sensor.b1_light_power"})


def test_a_DIGIT_SPACED_subject_matches_the_villas_own_spelling() -> None:
    """⚠️ MEASURED ON THE PROPERTY, NOT IMAGINED (2026-08-30). Triage escalated
    "Bedroom 1 Light" against labels reading "Bedroom1 Light Power" and reported
    `0/1 identified` on two consecutive passes. The instrument added in 2.912.0
    settled which half was at fault: **1,269 candidate labels** were available,
    so the candidate set was full and the MATCHER was the problem. The subject
    and the label differ by exactly one space."""
    item = _Esc("Bedroom 1 Light")
    triage._identify([item], BEDROOM)
    assert item.entity_id == "sensor.b1_light_power"


def test_the_villas_own_spelling_still_matches_itself() -> None:
    item = _Esc("Bedroom1 Light")
    triage._identify([item], BEDROOM)
    assert item.entity_id == "sensor.b1_light_power"


def test_the_digit_rule_is_applied_to_BOTH_SIDES() -> None:
    """⚠️ IT IS A NORMALISATION, NOT A REWRITE, and that is only sound while one
    function produces both sides. Folding the subject alone would move the
    mismatch rather than remove it — a villa that labels its equipment with the
    space would then stop matching."""
    spaced = _Refs({"Bedroom 1 Light Power": "sensor.b1_light_power"})
    for subject in ("Bedroom 1 Light", "Bedroom1 Light"):
        item = _Esc(subject)
        triage._identify([item], spaced)
        assert item.entity_id == "sensor.b1_light_power", subject


def test_a_digit_that_is_NOT_after_a_word_is_untouched() -> None:
    """The rule closes a word/digit gap and nothing else: it must not join two
    numbers, or a digit to a following word."""
    assert triage._comparable("Pump 2") == "pump2"
    assert triage._comparable("3 4") == "3 4"
    assert triage._comparable("2 pumps") == "2 pumps"
    assert triage._comparable("  Pool   Pump  ") == "pool pump"
