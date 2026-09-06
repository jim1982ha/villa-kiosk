"""The modules get the operator's own device names.

⚠️ `ModuleContext.labels` SAID "Injected by the pipeline" AND WAS `{}` ON EVERY
PRODUCTION PATH. Both constructors passed an empty dict, `registry.run_all`
faithfully copied it to all five modules, and so `label_for`'s `known` branch —
the one carrying the longest comment in the function — was dead.

What ran instead was the fallback, which humanises the ENTITY ID: an object_id
with its underscores turned to spaces and title-cased. That string has spaces
and no dot, and `payload._looks_like_entity_id` returns False for exactly that
shape, so it passes the audit and reaches the provider. A villa that names a
device after a person had that name travel — while the operator's own label was
fetched in the same pass, eighty lines later, and handed to a field nothing
reads.

Only one fixture in the whole suite ever passed a non-empty `labels`, so the
suite could not tell production from a test.
"""

import inspect

from conftest import strip_prose

from vesta.brief import pipeline as pipeline_mod
from vesta.shared.analysis import base as base_mod


def test_the_pipeline_no_longer_hands_the_modules_an_empty_map():
    code = strip_prose(inspect.getsource(pipeline_mod.analyse))
    assert "labels={}" not in code, (
        "analyse builds a ModuleContext with no labels again, so every module "
        "falls back to humanising the entity id")
    assert "labels=dict(labels or {})" in code


def test_the_labels_are_read_BEFORE_the_analysis_that_needs_them():
    """⚠️ THE ORDERING IS THE WHOLE FIX. The map was computed from a state dump
    the pipeline already had — 80 lines after `analyse` had returned."""
    code = strip_prose(inspect.getsource(pipeline_mod.run_report))
    labels_at = code.index("labels = _entity_labels(states)")
    analyse_at = code.index("await analyse(")
    assert labels_at < analyse_at, (
        "the device labels are computed after the analysis again, so they "
        "cannot reach the modules that name devices")


def test_a_known_label_wins_over_the_humanised_id():
    """The branch that was dead in production."""
    assert base_mod.label_for("sensor.pump_power", {}) == "Pump"
    assert base_mod.label_for(
        "sensor.pump_power", {"sensor.pump_power": "Filter Pump"}) == "Filter Pump"


def test_the_fallback_still_never_prints_a_raw_id():
    """Falling back is correct when the operator has named nothing; printing
    `domain.object_id` never is."""
    out = base_mod.label_for("sensor.some_device_energy", {})
    assert "." not in out and "_" not in out, out


def test_the_humanised_fallback_is_invisible_to_the_payload_audit():
    """⚠️ WHY THE EMPTY MAP MATTERED, stated as a fact rather than an argument.

    The audit's detector is a SHAPE test, deliberately — a domain list would go
    stale. A humanised id is not that shape, so nothing downstream can catch it;
    the only defence is not to generate one when a real label exists.
    """
    from vesta.brief.narrate import payload as payload_mod

    humanised = base_mod.label_for("sensor.a_person_bedroom_window", {})
    assert not payload_mod._looks_like_entity_id(humanised), humanised
    assert payload_mod._looks_like_entity_id("sensor.a_person_bedroom_window")


def test_the_agent_tool_still_works_without_a_state_dump():
    """`labels` is defaulted, because the agent's analysis tool has no dump."""
    import asyncio
    import inspect as _inspect

    sig = _inspect.signature(pipeline_mod.analyse)
    assert sig.parameters["labels"].default is None
    assert asyncio.iscoroutinefunction(pipeline_mod.analyse)
