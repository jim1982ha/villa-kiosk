"""Both detection layers run; the report prints each thing once.

⚠️ WHAT THIS REPLACES. A covering blueprint being INSTALLED used to switch a
whole built-in check off, unconditionally and forever. Two consequences, and the
second was invisible:

  * A property that imported the VESTA blueprint pack and built NO automations
    from it stood every check down while nothing could ever fire — the
    brand-new deployment detecting nothing at all.
  * A rule watching four of a property's five pumps left the fifth unreported by
    ANYONE, because the check that would have caught it was off property-wide.

Now both layers run and the pipeline drops a built-in finding whose SUBJECT the
blueprint layer also reported. The blueprint always wins: it sees occupancy,
schedules and tariffs a statistical module cannot, which is the same reason the
stand-down existed.

⚠️ THE STAND-DOWN IS NOT GONE, AND MUST NOT BE. While the covering rule is
speaking, the check stays down — running it would put back the five false
positives in one week that `level_anomaly` produced on the reference villa.
Only the UNCONDITIONAL half is gone, and only after `BLUEPRINT_GRACE_DAYS` of
silence measured from when the collector started listening.
"""

from __future__ import annotations

import os
import inspect
import re
import sys
from typing import Any, Dict, List

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from reports import pipeline as pipeline_mod                      # noqa: E402
from reports.analysis import registry                             # noqa: E402
from reports.analysis.base import (Finding, ModuleContext,        # noqa: E402
                                   dedup_key, subject_key)
from reports.analysis.modules import (level_anomaly, sensor_health,  # noqa: E402,F401
                                      standby_creep)

PUMP = "sensor.pool_pump_power"
OTHER = "sensor.house_pump_power"


def _context(**kw: Any) -> ModuleContext:
    base: Dict[str, Any] = dict(
        audience="owner", cadence="weekly", now_local=None,
        capabilities=["blueprint_layer", "statistics", "energy_devices"],
        inventory={})
    base.update(kw)
    return ModuleContext(**base)


def _module(name: str) -> Any:
    return next(m for m in registry.registered() if m.name == name)


class _Group:
    """The shape `aggregate.Group` presents to the pipeline."""

    def __init__(self, *entities: str) -> None:
        self.subject_keys = {subject_key(e) for e in entities}


def _finding(subject: str) -> Dict[str, Any]:
    return Finding(ref="d0", kind="ANOMALY", severity="warning", label="Pump",
                   detail="drawing more", subject_key=subject_key(subject)).as_dict()


# ── the join key ─────────────────────────────────────────────────────────────

def test_the_subject_key_matches_across_layers_and_carries_no_identifier() -> None:
    """⚠️ THE HASH IS THE WHOLE DESIGN. The two layers must recognise the same
    equipment, and a `Finding` may not carry an entity id — entity ids name
    rooms and people, and findings are shipped to a third-party model."""
    key = subject_key("sensor.emmas_bedroom_window")
    assert "emmas" not in key and "bedroom" not in key and "sensor." not in key
    assert key == subject_key("sensor.emmas_bedroom_window")
    assert key != subject_key("sensor.other")
    assert key in _Group("sensor.emmas_bedroom_window").subject_keys


def test_the_dedup_key_cannot_serve_as_the_subject_key() -> None:
    """⚠️ WHY A SECOND HASH EXISTS AT ALL. `dedup_key` is prefixed by the
    MODULE, so two layers describing one pump would never match — and two
    checks about one pump SHOULD stay distinct, which is what it is for."""
    assert dedup_key("standby_creep", PUMP) != dedup_key("sensor_health", PUMP)
    assert subject_key(PUMP) == subject_key(PUMP)
    assert not dedup_key("standby_creep", PUMP).startswith(subject_key(PUMP))


def test_every_module_sets_a_subject_key() -> None:
    """⚠️ A FINDING WITH NO SUBJECT CAN NEVER BE DEDUPLICATED — it would be
    reported alongside the blueprint's own line about the same device, which is
    the duplicate this whole mechanism exists to prevent. Derived from the
    source so a fourth module is covered on the day it is written."""
    root = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports",
                        "analysis", "modules")
    for name in sorted(os.listdir(root)):
        if not name.endswith(".py") or name == "__init__.py":
            continue
        source = open(os.path.join(root, name), encoding="utf-8").read()
        if "Finding(" not in source:
            continue
        assert "subject_key=" in source, (
            f"{name} builds findings without a subject key, so nothing it "
            f"reports can ever yield to the automation layer")


# ── the deduplication ────────────────────────────────────────────────────────

def test_a_finding_the_blueprint_layer_also_reported_is_dropped() -> None:
    kept, dropped = pipeline_mod._without_blueprint_subjects(
        [_finding(PUMP)], _Group(PUMP).subject_keys)
    assert dropped == 1 and kept == []


def test_a_finding_about_a_device_nobody_watches_survives() -> None:
    """⚠️ THE CASE THE OLD ARRANGEMENT COULD NOT REACH. A rule watching four of
    five pumps left the fifth unreported by anyone, because the check that would
    have caught it was switched off property-wide."""
    kept, dropped = pipeline_mod._without_blueprint_subjects(
        [_finding(OTHER)], _Group(PUMP).subject_keys)
    assert dropped == 0 and len(kept) == 1


def test_a_group_covering_several_devices_suppresses_all_of_them() -> None:
    """`maintenance_silence` fires with every silent entity in one payload."""
    subjects = _Group(PUMP, OTHER, "light.hall").subject_keys
    kept, dropped = pipeline_mod._without_blueprint_subjects(
        [_finding(PUMP), _finding(OTHER)], subjects)
    assert dropped == 2 and kept == []


def test_a_finding_with_no_subject_is_never_dropped() -> None:
    """⚠️ STATED RATHER THAN LEFT TO THE COMPARISON. An empty string matches
    nothing today; a future finding that forgets its subject must not become
    silently droppable if that ever changes."""
    bare = Finding(ref="d0", kind="OBSERVATION", severity="info",
                   label="x", detail="y").as_dict()
    kept, dropped = pipeline_mod._without_blueprint_subjects(
        [bare], _Group(PUMP).subject_keys)
    assert dropped == 0 and kept == [bare]


def test_no_blueprint_activity_drops_nothing() -> None:
    findings = [_finding(PUMP), _finding(OTHER)]
    kept, dropped = pipeline_mod._without_blueprint_subjects(findings, set())
    assert dropped == 0 and kept == findings


def test_the_subject_key_does_not_reach_the_narration_payload() -> None:
    """⚠️ IT IS A HASH AND IT STILL DOES NOT TRAVEL. `payload.build` loops over
    the ALLOW-LIST rather than over the input, so a field is admitted only by
    being named — and this one is not. Checked against the contract rather than
    against the builder, because the contract is what the guarantee rests on."""
    from reports.contracts import PAYLOAD_ALLOWED_FIELDS
    assert "subject_key" not in PAYLOAD_ALLOWED_FIELDS
    from reports.narrate import payload as payload_mod
    reduced = payload_mod.finding_payload(_finding(PUMP))
    assert "subject_key" not in reduced
    whole = payload_mod.build([_finding(PUMP)], audience="owner",
                              cadence="weekly", period="2026-08")
    assert "subject_key" not in str(whole)
    # ⚠️ AND `audit()` IS THE INDEPENDENT SECOND OPINION, not a restatement of
    # the builder — a non-empty audit means DO NOT SEND.
    assert payload_mod.audit(whole) == []


# ── the gate ─────────────────────────────────────────────────────────────────

def test_a_speaking_blueprint_still_stands_its_module_down() -> None:
    """⚠️ THE HALF THAT MUST NOT CHANGE. Running a statistical check beside a
    blueprint that is actively reporting is how the reference villa got five
    false positives in one week."""
    ok, _, detail = registry.gate(
        _module("sensor_health"),
        _context(silent_blueprints=[], heard_nothing_for_days=999.0), {}, 60)
    assert ok is False
    assert detail == "your own automations already cover this"


def test_a_silent_blueprint_within_the_grace_window_still_stands_it_down() -> None:
    """A listener that came up recently has no standing to call a monthly rule
    silent, so the conservative answer holds and the brief says which rule."""
    ok, reason, detail = registry.gate(
        _module("sensor_health"),
        _context(silent_blueprints=["maintenance_silence"],
                 heard_nothing_for_days=3.0), {}, 60)
    assert ok is False
    # ⚠️ THE DETAIL IS THE BLUEPRINT NAME, NOT A SENTENCE (2.578.0). The brief
    # gathers these under one sub-heading and writes the explanation once.
    assert reason == "covered_but_silent"
    assert detail == "Maintenance silence"


def test_a_long_silent_blueprint_lets_its_module_run() -> None:
    """⚠️ THIS IS THE FRESH-INSTALL FIX. Pack imported, no automations built,
    nothing can ever fire — and the check used to stay off forever."""
    ok, reason, _ = registry.gate(
        _module("sensor_health"),
        _context(silent_blueprints=["maintenance_silence"],
                 heard_nothing_for_days=registry.BLUEPRINT_GRACE_DAYS + 1), {}, 60)
    assert ok is True, f"still refused: {reason}"


def test_an_unknown_listening_time_leaves_the_stand_down_in_place() -> None:
    """None means the collector cannot say — never "long enough"."""
    ok, _, _ = registry.gate(
        _module("sensor_health"),
        _context(silent_blueprints=["maintenance_silence"],
                 heard_nothing_for_days=None), {}, 60)
    assert ok is False


def test_the_grace_outlasts_the_longest_cadence() -> None:
    """⚠️ A MONTHLY BRIEF IS 31 DAYS. A rule that legitimately fires once a
    month must not be declared silent by a check that waited three weeks."""
    assert registry.BLUEPRINT_GRACE_DAYS > 31


def test_the_grace_is_measured_from_the_listener_not_the_process() -> None:
    """⚠️ `online_since` PERSISTS ACROSS RESTARTS and `connected_since` does
    not. Measuring from the process would reset the window on every reboot, and
    a property that restarts weekly would never accumulate enough silence to
    conclude anything."""
    source = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports",
                               "collect.py"), encoding="utf-8").read()
    body = re.search(r"def listening_days\(\).*?\n\n\n", source, re.DOTALL)
    assert body, "listening_days moved — this test is blind"
    # ⚠️ COMMENTS STRIPPED FIRST. The docstring EXPLAINS why `connected_since`
    # is the wrong field, so a bare substring search finds the word it is
    # asserting the absence of, inside the sentence explaining the absence —
    # the third time this session, and exactly /dry-audit step 7's shape.
    code = re.sub(r'""".*?"""', "", body.group(0), flags=re.DOTALL)
    code = re.sub(r"^\s*#.*$", "", code, flags=re.MULTILINE)
    assert "online_since" in code
    assert "connected_since" not in code


@pytest.mark.parametrize("module_name", ["sensor_health", "standby_creep",
                                         "level_anomaly"])
def test_every_superseded_module_can_still_be_reached(module_name: str) -> None:
    """A module whose covering blueprint is silent long enough must become
    runnable — otherwise the grace window applies to one check and the others
    stay dark on a fresh install."""
    module = _module(module_name)
    ok, reason, _ = registry.gate(
        _module(module_name),
        _context(silent_blueprints=list(module.superseded_by),
                 heard_nothing_for_days=registry.BLUEPRINT_GRACE_DAYS + 1),
        {}, 999)
    assert ok is True, f"{module_name} refused with {reason}"


def test_the_silent_cover_skip_reaches_the_renderer_with_its_own_code() -> None:
    """⚠️ THE WHOLE PATH, NOT A HAND-BUILT DICT. `test_actionable`'s fixtures
    set `code` themselves, so they exercise the renderer's grouping and NOT the
    gate that produces it — a mutation changing the gate's returned reason to
    `missing_capability` survived every test in that file. The brief would have
    silently lost its sub-heading and scattered those lines again.
    """
    module = _module("sensor_health")
    ok, reason, detail = registry.gate(
        module, _context(silent_blueprints=["maintenance_silence"],
                         heard_nothing_for_days=3.0), {}, 60)
    assert ok is False
    assert reason == "covered_but_silent", (
        "the gate no longer marks this skip as its own kind, so the renderer "
        "cannot group it without parsing English")
    assert detail == "Maintenance silence", (
        "the detail must be the blueprint NAME alone — the renderer writes the "
        "sentence once, so a sentence here would repeat on every line")

    described = registry.describe_skips([{"module": module.name,
                                          "reason": reason, "detail": detail}])
    assert described[0]["code"] == "covered_but_silent", (
        "describe_skips drops the raw code, so the renderer sees only prose")


def test_the_two_keys_share_one_hash_expression() -> None:
    """⚠️ THE AGREEMENT WAS PROSE, AND PROSE DOES NOT STOP A DIVERGENCE.
    `subject_key` and `dedup_key` each spelled out
    `sha256(subject).hexdigest()[:16]`, held together only by a docstring saying
    "SAME HASH, SAME TRUNCATION ... deliberately". Cutting one at 12 would have
    left that sentence reading true while the two detection layers stopped
    recognising the same equipment — silently, because both keys stay
    well-formed. `dedup_key` now calls `subject_key`; this pins that it does.
    """
    from reports.analysis import base
    source = inspect.getsource(base.dedup_key)
    assert "subject_key(" in source, (
        "`dedup_key` must derive its digest from `subject_key`, not restate the "
        "hash — that restatement is the divergence this guards")
    assert "sha256" not in source, (
        "a second hash expression in `dedup_key` is the bug, whatever it "
        "currently computes")
    # And the observable property the convergence exists to preserve.
    for subject in ("sensor.a", "", "pump-01", "x" * 500):
        assert base.dedup_key("mod", subject) == f"mod:{base.subject_key(subject)}"
