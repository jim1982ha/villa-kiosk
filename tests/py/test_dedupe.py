"""One switch decides which layer detects, and the report prints each thing once.

⚠️ THIS FILE USED TO TEST A SIX-OUTCOME GATE AND MOST OF IT WAS DELETED IN
2.755.0. The rule was: a covering blueprint stands a built-in check down while
it is installed, unless it has never fired, unless it has been silent longer
than a 45-day grace window measured from when the collector started listening,
unless an operator override flag is set. Every branch was individually
defensible. Together they were unstatable, and one of them could never be
reached — `seen_blueprints` never decayed, so a blueprint switched OFF but still
installed counted as live coverage forever and the grace window sat behind a
return that always fired first.

The owner replaced the whole thing with one sentence: supervision ON means the
assistant supersedes the automations; supervision OFF means the automations do
the job. There is no grace window, no installed test, no silence test and no
second flag.

What is still tested here is the part that was never about the gate: both layers
compute `subject_key` the same way, so the two can recognise the same equipment
without either holding an identifier.
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

from vesta.brief import pipeline as pipeline_mod
from vesta.brief import registry
from vesta.shared.analysis.base import (Finding, ModuleContext,        # noqa: E402
                                   dedup_key, subject_key)
from vesta.shared.analysis.modules import (level_anomaly, sensor_health,  # noqa: E402,F401
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
    key = subject_key("sensor.bedroom_window")
    assert "bedroom" not in key and "bedroom" not in key and "sensor." not in key
    assert key == subject_key("sensor.bedroom_window")
    assert key != subject_key("sensor.other")
    assert key in _Group("sensor.bedroom_window").subject_keys


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
    root = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta", "shared",
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

def test_the_subject_key_does_not_reach_the_narration_payload() -> None:
    """⚠️ IT IS A HASH AND IT STILL DOES NOT TRAVEL. `payload.build` loops over
    the ALLOW-LIST rather than over the input, so a field is admitted only by
    being named — and this one is not. Checked against the contract rather than
    against the builder, because the contract is what the guarantee rests on."""
    from vesta.shared.contracts import PAYLOAD_ALLOWED_FIELDS
    assert "subject_key" not in PAYLOAD_ALLOWED_FIELDS
    from vesta.brief.narrate import payload as payload_mod
    reduced = payload_mod.finding_payload(_finding(PUMP))
    assert "subject_key" not in reduced
    whole = payload_mod.build([_finding(PUMP)], audience="owner",
                              cadence="weekly", period="2026-08")
    assert "subject_key" not in str(whole)
    # ⚠️ AND `audit()` IS THE INDEPENDENT SECOND OPINION, not a restatement of
    # the builder — a non-empty audit means DO NOT SEND.
    assert payload_mod.audit(whole) == []


# ── the gate ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("module_name",
                         ["sensor_health", "standby_creep", "level_anomaly"])
def test_a_covered_module_RUNS_whatever_the_switch_says(module_name: str) -> None:
    """⚠️ THIS REVERSES THE PIN THAT STOOD HERE, AND THE REVERSAL IS THE
    OWNER'S REASONING, NOT A PREFERENCE (2026-08-29). The old pin held that
    supervision OFF hands the job back to the automations — written while the
    blueprints still REPORTED into the briefing. TASK-074 removed that
    reporting from every shipped blueprint, and the briefing has never read an
    automation's output anyway (`events_since` had no caller and is now
    deleted). So the stand-down traded the briefing's ONLY analysis input for
    a layer that cannot reach the briefing: supervision off produced no
    analysis from either side, however many automations the owner re-enabled.

    The automations' real job — instant alerts, straight from Home Assistant —
    never needed the gate. Both directions must RUN now, and `superseded_by`
    survives on the module purely as the record of what each check replaced.
    """
    module = _module(module_name)
    assert getattr(module, "superseded_by", ()), (
        f"{module_name} no longer names its predecessor — the record half of "
        "the old rule should survive even though the gate half is gone")
    for flag in (True, False):
        ok, reason, _ = registry.gate(
            module, _context(supervision_enabled=flag), {}, 60)
        assert ok is True, (
            f"{module_name} refused ({reason!r}) with supervision_enabled="
            f"{flag} — the stand-down is back, and with it the mode in which "
            "the briefing has no analysis at all")


def test_the_two_keys_share_one_hash_expression() -> None:
    """⚠️ THE AGREEMENT WAS PROSE, AND PROSE DOES NOT STOP A DIVERGENCE.
    `subject_key` and `dedup_key` each spelled out
    `sha256(subject).hexdigest()[:16]`, held together only by a docstring saying
    "SAME HASH, SAME TRUNCATION ... deliberately". Cutting one at 12 would have
    left that sentence reading true while the two detection layers stopped
    recognising the same equipment — silently, because both keys stay
    well-formed. `dedup_key` now calls `subject_key`; this pins that it does.
    """
    from vesta.shared.analysis import base
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


# ── the rule cannot grow back ────────────────────────────────────────────────
def test_the_gate_asks_ONE_question_and_the_machinery_is_GONE() -> None:
    """⚠️ THE POINT OF 2.755.0 WAS THE DELETION, so the deletion is what is
    pinned. Every name below was a live input to the old six-outcome gate, and
    every one of them is the kind of thing that comes back one plausible commit
    at a time: a grace window "just for the monthly rules", an installed check
    "so a fresh install is not noisy", an override flag "for the transition".

    The rule an owner was given is one sentence. If a future change needs more
    than `supervision_enabled` to decide whether a check runs, it is not a
    refinement of this rule — it is a different rule, and it needs saying out
    loud rather than accreting.
    """
    src = inspect.getsource(registry.gate)
    for gone in ("installed_blueprints", "silent_blueprints",
                 "heard_nothing_for_days", "agent_owns_analysis",
                 "BLUEPRINT_GRACE_DAYS", "blueprint_layer"):
        assert gone not in src, (
            f"the gate consults {gone} again; the rule is supervision on/off "
            "and nothing else")
    # ⚠️ THIS ASSERTION WAS PASSING ON A COMMENT (found 2026-08-29). It read
    # `count("return (False,") == 1 or "superseded" in src`, written when the
    # gate had ONE refusal. The gate has five now (capability, disabled,
    # errored, history, audience), so the first half is False and the whole
    # thing survived only because the word "superseded" appears in a COMMENT
    # explaining that the arm was removed. Strip comments and it fails; tidy
    # that comment away and it fails for the wrong reason. Meanwhile a genuine
    # new stand-down arm would sail past if it happened to use the word.
    #
    # What it is actually for: NO supervision-conditional refusal may return.
    # That is checkable against the code, so it is checked against the code.
    code = "\n".join(line for line in src.split("\n")
                     if not line.lstrip().startswith("#"))
    assert "supervision_enabled" not in code, (
        "the gate reads the supervision switch again — the stand-down arm is "
        "back, and with it the mode in which the briefing has no analysis")
    assert "superseded" not in code, (
        "the gate can emit `superseded` again; that value is historical "
        "vocabulary for reading old entries, not a live skip reason")


def test_nothing_in_the_tree_still_reads_the_deleted_machinery() -> None:
    """⚠️ A DELETION IS NOT DONE WHILE A CALLER SURVIVES. tsc and pytest both
    pass with a dead helper sitting in a module nobody imports, and the next
    reader takes its presence as evidence it is used."""
    import os
    roots = [os.path.join(REPO_ROOT, "rootfs", "usr", "bin"),
             os.path.join(REPO_ROOT, "src")]
    dead = ("BLUEPRINT_GRACE_DAYS", "covered_but_silent", "agent_owns_analysis",
            "agentOwnsAnalysis", "_without_blueprint_subjects",
            "_blueprint_subjects", "seen_blueprints", "listening_days")
    offenders = []
    for root in roots:
        for base, _dirs, files in os.walk(root):
            if "__pycache__" in base or "node_modules" in base:
                continue
            for name in files:
                if not name.endswith((".py", ".ts", ".tsx")):
                    continue
                path = os.path.join(base, name)
                with open(path, "r", encoding="utf-8") as handle:
                    body = handle.read()
                # ⚠️ CODE ONLY, AND BLOCKS ARE STRIPPED AS BLOCKS. A line filter
                # keyed on the first character passed the OPENING line of every
                # JSX and docstring comment and then flagged its continuation
                # lines, which start with an ordinary word — the same trap that
                # has now produced a false pin three times in this repo. The
                # comments recording this deletion name it deliberately, and
                # dry-audit Part 2 says a record of an answered question stays.
                body = re.sub(r"/\*[\s\S]*?\*/", "", body)
                body = re.sub(r'"""[\s\S]*?"""', "", body)
                for n, line in enumerate(body.splitlines(), 1):
                    if line.lstrip().startswith(("#", "//")):
                        continue
                    for token in dead:
                        if token in line:
                            offenders.append(
                                f"{os.path.relpath(path, REPO_ROOT)}:{n} {token}")
    assert not offenders, "deleted machinery still referenced in code:\n" + \
        "\n".join(offenders)


def test_the_pipeline_reads_the_MASTER_SWITCH_and_not_a_constant() -> None:
    """⚠️ FOUND BY MUTATION, NOT BY REVIEW. Replacing the pipeline's
    `supervision_enabled=bool(agent_cfg.get("enabled"))` with a literal `False`
    left all 1,877 tests green — every gate test builds its own context, so
    nothing checked that the one production caller passes the real value. The
    whole rule would have been correct and the villa would have stood every
    covered check down forever.

    That is `feedback_pin-the-caller`, and this repo's `two correct halves`
    defect for the fourteenth time: the helper is tested, the call is not.
    """
    src = inspect.getsource(pipeline_mod)
    call = re.search(r"supervision_enabled=([^,\n]+)", src)
    assert call, "the pipeline no longer passes supervision_enabled at all"
    reads = [m.group(1) for m in re.finditer(r"supervision_enabled=([^,\n]+)", src)]
    assert any('agent_cfg.get("enabled")' in r for r in reads), (
        "the pipeline passes something other than the villa's master switch: "
        f"{reads}")
    for r in reads:
        assert r.strip() not in ("False", "True"), (
            f"supervision_enabled is hard-coded to {r.strip()} somewhere in the "
            "pipeline, so the switch decides nothing")
