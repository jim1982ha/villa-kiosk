"""The Villa Document — profile stability, ordering, and the absent block.

⚠️ TEST-005 IS THE ONE THAT MATTERS AND IT IS A BYTE DIFF. Prompt caching matches
on an exact prefix, so "the profile is stable" is not a style preference — it is
the difference between ~75% of every triage call costing a tenth of normal and
costing full price. The failure is silent: the bill quadruples and the output
looks perfect. Only a byte comparison catches it.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Any, Dict, List

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from observe import salience, snapshot  # noqa: E402

VILLA: Dict[str, Any] = {
    "floors": ["Ground", "First"],
    "areas": ["Kitchen", "Lounge", "Plant room", "Terrace"],
    "devices_by_class": {"lights": 11, "pumps": 4, "locks": 2},
    "metered": [{"circuit": "Mains phase 1", "feeds": "kitchen and lounge"},
                {"circuit": "Pump circuit", "feeds": "the four pumps"}],
    "helpers": ["electricity tariff", "pool schedule"],
    "equipment": [{"name": "House pump", "purpose": "domestic pressure",
                   "normal": "runs mornings and evenings"}],
    "absent_capabilities": ["Water use is not metered.",
                            "No tariff is configured, so consumption cannot be "
                            "expressed as money."],
}


# ── TEST-005 · the profile is byte-stable ──────────────────────────────────

def test_two_consecutive_renders_are_byte_identical() -> None:
    """The acceptance criterion, stated as it is written."""
    first = snapshot.profile(**VILLA)
    second = snapshot.profile(**VILLA)
    assert first == second, "an unchanged villa must render an unchanged profile"
    assert first.encode() == second.encode()


def test_input_ORDER_cannot_change_the_profile() -> None:
    """⚠️ THE SUBTLE HALF. A registry read can come back in a different order
    after a restart, and an unsorted join would differ byte-for-byte over an
    unchanged villa — destroying the cache for a reason nobody would look for."""
    shuffled = dict(VILLA)
    shuffled["areas"] = list(reversed(VILLA["areas"]))
    shuffled["metered"] = list(reversed(VILLA["metered"]))
    shuffled["helpers"] = list(reversed(VILLA["helpers"]))
    shuffled["devices_by_class"] = dict(
        reversed(list(VILLA["devices_by_class"].items())))
    assert snapshot.profile(**shuffled) == snapshot.profile(**VILLA)


def test_the_profile_contains_no_timestamp_of_any_shape() -> None:
    """⚠️ TASK-012's OTHER ACCEPTANCE CRITERION. One interpolated date changes
    the prefix on every call, the cache never hits, and nothing looks wrong."""
    text = snapshot.profile(**VILLA)
    patterns = [
        r"\d{4}-\d{2}-\d{2}",                 # 2026-08-22
        r"\d{2}:\d{2}(:\d{2})?",              # 10:00, 10:00:00
        r"\b(as of|generated|updated|now|today|yesterday)\b",
        r"\brun[_ ]?id\b",
        r"\d+\s*(seconds?|minutes?|hours?|days? ago)\b",
    ]
    for pattern in patterns:
        found = re.search(pattern, text, re.I)
        assert not found, f"time-varying content in the profile: {found.group(0)!r}"


def test_a_villa_change_DOES_change_the_profile() -> None:
    """⚠️ THE OTHER DIRECTION, AND IT IS NOT REDUNDANT. A profile() that
    returned a constant would pass every stability test above while describing
    nothing — the "test passes while measuring nothing" failure this project
    has on record four times."""
    changed = dict(VILLA)
    changed["devices_by_class"] = {"lights": 12, "pumps": 4, "locks": 2}
    assert snapshot.profile(**changed) != snapshot.profile(**VILLA)


# ── ordering ────────────────────────────────────────────────────────────────

def test_the_document_puts_the_profile_first() -> None:
    """The cost requirement, as structure. Reversed, the cadence costs 4x for
    identical output."""
    doc = snapshot.villa_document(
        profile_text=snapshot.profile(**VILLA),
        delta_text=snapshot.delta(coverage={"complete": True}))
    assert doc.index(snapshot.PROFILE_HEADING) < doc.index(snapshot.DELTA_HEADING)
    assert doc.index(snapshot.CACHE_BREAKPOINT) < doc.index(snapshot.DELTA_HEADING)


def test_the_cache_prefix_ends_at_the_breakpoint_and_holds_the_whole_profile() -> None:
    doc = snapshot.villa_document(
        profile_text=snapshot.profile(**VILLA),
        delta_text=snapshot.delta(coverage={"complete": True}))
    prefix = snapshot.cache_prefix_of(doc)
    assert prefix.endswith(snapshot.CACHE_BREAKPOINT)
    assert snapshot.PROFILE_HEADING in prefix
    assert snapshot.DELTA_HEADING not in prefix, (
        "the delta must never fall inside the cached span, or a stale villa is "
        "served from cache")
    assert "Water use is not metered." in prefix


def test_a_missing_breakpoint_caches_nothing_rather_than_guessing() -> None:
    """Caching nothing costs money; caching the wrong span returns a stale
    villa. The safe failure is the expensive one."""
    assert snapshot.cache_prefix_of("no marker here") == ""


# ── the absent-capability block · TASK-013 / TEST-006 ──────────────────────

def test_the_absent_block_is_always_present_even_when_empty() -> None:
    """⚠️ "Nothing is unmeasured here" is a claim worth making. An absent
    section reads as an unanswered question."""
    text = snapshot.profile(floors=["Ground"])
    assert "What this villa cannot be asked about:" in text
    assert "Nothing known to be unmeasured." in text


def test_a_thin_deployment_produces_a_NON_EMPTY_absent_block() -> None:
    """TEST-006's acceptance criterion."""
    discovered = {
        "capabilities_missing": ["energy_water", "energy_cost"],
        "capability_absent": {
            "energy_water": "Water use is not metered.",
            "energy_cost": "No tariff is configured, so consumption cannot be "
                           "expressed as money.",
            "areas": "Devices are not assigned to areas.",
        },
    }
    sentences = snapshot.absent_sentences(discovered)
    assert len(sentences) == 2
    text = snapshot.profile(floors=["Ground"], absent_capabilities=sentences)
    assert "Water use is not metered." in text
    assert "Devices are not assigned to areas." not in text, (
        "only the capabilities actually MISSING may be rendered")


def test_the_sentences_are_verbatim_not_paraphrased() -> None:
    """⚠️ They are constants in this add-on's source, identical on every
    install. A paraphrase turns a statement somebody checked into generated
    text — and generated text about what the system cannot see is exactly the
    wrong thing to invent."""
    original = "No long-term history is being recorded, so nothing can be compared over time."
    out = snapshot.absent_sentences({
        "capabilities_missing": ["statistics"],
        "capability_absent": {"statistics": original}})
    assert out == [original]


def test_the_absent_block_is_ordered_so_the_prefix_stays_stable() -> None:
    """⚠️ `capabilities_missing` is built from a SET in discovery, and a set has
    no stable order. Unsorted, this block reshuffles between runs and breaks the
    cached prefix — the same trap as the device counts, one level up."""
    meanings = {"a_cap": "Alpha absent.", "b_cap": "Bravo absent.",
                "c_cap": "Charlie absent."}
    forward = snapshot.absent_sentences(
        {"capabilities_missing": ["a_cap", "b_cap", "c_cap"],
         "capability_absent": meanings})
    backward = snapshot.absent_sentences(
        {"capabilities_missing": ["c_cap", "a_cap", "b_cap"],
         "capability_absent": meanings})
    assert forward == backward


def test_malformed_discovery_output_degrades_to_an_empty_block() -> None:
    for junk in (None, {}, {"capabilities_missing": None},
                 {"capabilities_missing": ["x"], "capability_absent": None},
                 {"capabilities_missing": ["x"], "capability_absent": {}},
                 "not a mapping"):
        assert snapshot.absent_sentences(junk) == []


def test_it_reads_the_REAL_discovery_table_not_a_fixture_copy() -> None:
    """⚠️ Pinned against the shipped module, so a change to discovery's wording
    cannot leave this renderer quoting a sentence that no longer exists."""
    from reports import discovery
    assert discovery.CAPABILITY_ABSENT, "discovery must still hold the table"
    sample = sorted(discovery.CAPABILITY_ABSENT)[0]
    out = snapshot.absent_sentences({
        "capabilities_missing": [sample],
        "capability_absent": discovery.CAPABILITY_ABSENT})
    assert out == [discovery.CAPABILITY_ABSENT[sample].strip()]


# ── the delta ───────────────────────────────────────────────────────────────

def _salient(entity: str, score: float) -> salience.Salience:
    return salience.Salience(entity_id=entity, kind="numeric", score=score,
                             reason=f"{entity} is {score:.1f} sigma from normal")


def test_incomplete_coverage_is_stated_before_anything_is_read() -> None:
    """⚠️ "I was not listening for six hours" changes how every line below it
    should be read. A reader who learns it at the end has already believed the
    rest."""
    text = snapshot.delta(coverage={"complete": False})
    assert "INCOMPLETE" in text
    assert text.index("INCOMPLETE") < text.index("Most unusual right now")


def test_a_full_journal_says_the_limit_is_the_recorder_not_the_villa() -> None:
    text = snapshot.delta(coverage={"complete": True, "at_bound": True})
    assert "limit of the recorder, not of the villa" in text


def test_a_quiet_cycle_says_so_rather_than_printing_nothing() -> None:
    """An empty section reads as a broken renderer."""
    text = snapshot.delta(salient=[], coverage={"complete": True})
    assert "Nothing is behaving unusually for itself." in text


def test_salient_items_carry_their_reason_into_the_document() -> None:
    text = snapshot.delta(salient=[_salient("sensor.pump", 8.4)],
                          coverage={"complete": True})
    assert "sensor.pump" in text and "8.4 sigma from normal" in text


def test_unscorable_entities_are_reported_as_a_first_class_line() -> None:
    text = snapshot.delta(unscorable=40, coverage={"complete": True})
    assert "Could not be assessed: 40 entities" in text


def test_open_concerns_carry_their_age() -> None:
    text = snapshot.delta(
        concerns=[{"title": "Pool pump drawing more than usual",
                   "state": "open", "age_days": 3}],
        coverage={"complete": True})
    assert "Pool pump drawing more than usual" in text
    assert "open 3 days" in text


def test_no_open_concerns_says_none() -> None:
    assert "None." in snapshot.delta(concerns=[], coverage={"complete": True})


# ── the hard rule ───────────────────────────────────────────────────────────

def test_the_rendered_document_carries_no_entity_id() -> None:
    """⚠️ Labels, never ids. This is the largest unattended payload in the
    system, and `PAYLOAD_ALLOWED_FIELDS` bans ids from unattended payloads.

    The KNOWN GAP is asserted rather than hidden: `Salience` carries only an
    id today, so a caller that passes raw salience into the delta WILL leak
    one. The label resolver is injected at `_label_of` when it exists; this
    test pins the profile, which is the part that is already clean.
    """
    text = snapshot.profile(**VILLA)
    ids = re.findall(
        r"(?:^|[\s(])((?:sensor|switch|light|binary_sensor|climate|fan|cover|"
        r"lock|todo|automation|person|device_tracker|input_\w+)\.\w+)", text)
    assert not ids, f"entity id(s) in the profile: {ids}"
