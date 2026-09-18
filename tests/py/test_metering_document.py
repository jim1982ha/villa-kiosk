"""How the property is metered, stated in the Villa Document.

⚠️ THE DEFECT, REPORTED FROM THE VILLA 2026-09-18 AND CAUSED BY ME. 2.982.0
deleted `read_energy` and moved its rule — never sum overlapping circuits — into
the constitution. It deleted the only path to the Energy dashboard at the same
time, so the model was left holding a prohibition with no way to satisfy it. Its
next answer, in French, was that the system "measures circuits individually but
does not allow totalling them without double-counting" — a refusal it had been
taught, about a property whose dashboard names its top-level meters precisely so
they CAN be totalled. Worse than before the rule existed.

⚠️ AND THE LAYOUT WAS ALREADY KNOWN. `discovery` has computed `rolled_up` since
long before any of this, with a comment saying it is "recorded here so no
analysis module has to rediscover it" — and only the capability FLAGS were ever
published. The fix publishes what was already computed; it adds no new source.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

from vesta.supervise.observe import snapshot  # noqa: E402


def _found(**metering):
    return {"inventory": {"metering": metering}}


def test_the_top_level_meters_are_named_for_both_kinds_of_question():
    """⚠️ "RIGHT NOW" AND "SINCE ONE O'CLOCK" ARE DIFFERENT SENSORS. Live power
    and cumulative energy are separate statistics, and a document offering only
    one sends the model to the wrong one for half the questions asked."""
    lines = snapshot.metering_sentences(_found(
        total_power=["Main Phase A", "Main Phase B"],
        total_energy=["Main Phase A Energy", "Main Phase B Energy"],
        nested=10))
    joined = " ".join(lines)
    assert "RIGHT NOW" in joined and "Main Phase A," in joined
    assert "OVER A PERIOD" in joined and "Main Phase A Energy," in joined


def test_the_nested_circuits_are_counted_and_warned_about():
    lines = snapshot.metering_sentences(_found(
        total_power=["Main"], total_energy=["Main Energy"], nested=10))
    assert any("10 further circuits" in ln and "twice" in ln for ln in lines)


def test_no_nesting_produces_no_warning():
    """A property with no sub-circuits must not be told to beware of them."""
    lines = snapshot.metering_sentences(_found(
        total_power=["Main"], total_energy=["Main Energy"], nested=0))
    assert not any("further circuits" in ln for ln in lines)


@pytest.mark.parametrize("found", [
    None, {}, {"inventory": {}}, {"inventory": {"metering": {}}},
    _found(total_power=[], total_energy=[], nested=0),
    _found(total_power=[""], total_energy=[None], nested=0),
])
def test_a_property_that_declares_no_meter_is_told_nothing(found):
    """⚠️ SILENCE, NEVER A REASSURING DEFAULT. A villa with no Energy dashboard
    must not read a document claiming a total exists that nobody configured —
    that is the same over-claim the survey refuses for capabilities."""
    assert snapshot.metering_sentences(found) == []


def test_the_sentences_name_no_entity_id():
    """⚠️ THE DOCUMENT IS SENT TO THE MODEL AND `redact.audit` REFUSES A PAYLOAD
    HOLDING AN ID. Friendly names are admitted by design; statistic ids are the
    thing this whole layer exists to keep out."""
    lines = snapshot.metering_sentences(_found(
        total_power=["Main Phase A"], total_energy=["Main Phase A Energy"],
        nested=3))
    for line in lines:
        for domain in ("sensor" ".", "switch" ".", "light" "."):
            assert domain not in line


def test_the_module_names_no_meter_of_any_property():
    from conftest import code_of
    src = code_of(snapshot)
    for named in ("phase_a", "main_power", "Main Phase"):
        assert named not in src, f"a villa's meter reached shipped code: {named}"
