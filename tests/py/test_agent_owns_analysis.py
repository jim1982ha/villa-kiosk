"""Who owns detection: the agent, or this property's blueprints.

⚠️ THIS FLAG REMOVES A GUARDRAIL, SO EVERY TEST HERE IS ABOUT WHAT SURVIVES.
`registry.py` has said since 2.572.0 that the stand-down MUST NOT be deleted —
running a statistical module beside an occupancy-aware blueprint produced five
false positives in one week. The claim being pinned is narrower than "it is
safe": a rule that is actually SPEAKING still wins on its own equipment, via
`pipeline._without_blueprint_subjects`, per DEVICE. Only a rule's mere PRESENCE
stops deciding.
"""

from __future__ import annotations

import inspect
import os
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from reports import pipeline, store  # noqa: E402
from reports.analysis import base, registry  # noqa: E402


class _Module:
    name = "level_anomaly"
    superseded_by = ("roi_baseline_deviation",)
    requires: tuple = ()
    min_days = 0
    audiences = ("owner",)


def _context(**over):
    kw = dict(
        audience="owner", cadence="daily",
        now_local=datetime.now(timezone.utc),
        capabilities=["blueprint_layer"], inventory={}, settings={},
        min_history_days=0, stats=None, labels={},
        silent_blueprints=[],
        installed_blueprints=["roi_baseline_deviation"],
        heard_nothing_for_days=1.0,
    )
    kw.update(over)
    return base.ModuleContext(**kw)


def _gate(ctx):
    return registry.gate(_Module(), ctx, {}, 999)


# ── the behaviour being bought ──────────────────────────────────────────────

def test_an_installed_blueprint_suppresses_the_module_by_DEFAULT() -> None:
    """The shipped behaviour, unchanged. A fresh install with blueprints still
    defers to them — this add-on is redistributable and there the rules are the
    better-informed layer."""
    ok, reason, _ = _gate(_context())
    assert ok is False and reason == "missing_capability"


def test_agent_ownership_makes_the_module_RUN_anyway() -> None:
    ok, reason, detail = _gate(_context(agent_owns_analysis=True))
    assert ok is True, f"still gated: {reason} {detail}"


def test_it_beats_EVERY_arm_of_the_stand_down_not_just_the_first() -> None:
    """⚠️ THE THREE ARMS FAIL DIFFERENTLY AND A FIX FOR ONE IS NOT A FIX FOR
    THREE: not-installed, installed-and-silent-within-grace, and
    installed-and-seen. The owner's villa is the LAST of those — a retired but
    still-installed blueprint, which is neither absent nor silent — and it is
    the one no waiting period ever releases."""
    for over in (
        {"installed_blueprints": [], "silent_blueprints": []},
        {"silent_blueprints": ["roi_baseline_deviation"],
         "heard_nothing_for_days": 1.0},
        {"silent_blueprints": [], "heard_nothing_for_days": None},
    ):
        ok, reason, _ = _gate(_context(agent_owns_analysis=True, **over))
        assert ok is True, f"{over} still gated by {reason}"


def test_a_retired_but_installed_blueprint_is_suppressed_FOREVER_without_it() -> None:
    """⚠️ THE DEFECT THIS FLAG EXISTS FOR, PINNED AS A FACT RATHER THAN PROSE.
    `silent_blueprints` is installed-minus-EVER-seen and the seen flag never
    decays, so a blueprint that fired once and was retired is neither absent nor
    silent. No value of `heard_nothing_for_days` — not 45, not 10,000 — releases
    it, because the grace arm is only REACHED by a blueprint that is silent."""
    for days in (0.0, 45.0, 10_000.0):
        ok, reason, _ = _gate(_context(heard_nothing_for_days=days))
        assert ok is False and reason == "missing_capability", days


def test_the_duplicate_protection_is_NOT_what_was_removed() -> None:
    """⚠️ THE WHOLE SAFETY ARGUMENT. Overlap is still prevented one layer up,
    per DEVICE, preferring the blueprint. If this ever stops being true the flag
    becomes 'delete the stand-down', which registry.py forbids."""
    findings = [{"subject_key": "aaa", "title": "built-in"},
                {"subject_key": "bbb", "title": "built-in other"}]
    kept, dropped = pipeline._without_blueprint_subjects(findings, {"aaa"})
    assert dropped == 1
    assert [f["subject_key"] for f in kept] == ["bbb"]


# ── the wiring, which is where this shape of change actually breaks ─────────

def test_the_flag_REACHES_the_gate_from_the_real_config() -> None:
    """⚠️ PIN THE CALLER. The first draft read it off `settings`, which at that
    call site is the `modules` SLICE of the config — so a top-level key was
    always None and the flag would have been defined, defaulted, documented and
    dead. Caught before commit; pinned so it cannot come back."""
    src = inspect.getsource(pipeline)
    assert 'agent_owns_analysis=bool(config.get("agent_owns_analysis"))' in src, (
        "the scheduler does not pass the flag from the config")
    assert "agent_owns_analysis=agent_owns_analysis)" in src, (
        "run_report does not forward it to analyse")
    assert 'settings.get("agent_owns_analysis")' not in src, (
        "read off the modules slice again — that key is never there")


def test_it_is_a_real_config_key_with_a_wire_name() -> None:
    """Both halves of the store-envelope lesson: a default the store knows, and
    a camelCase mapping, or the app writes a key nothing reads."""
    assert store.CONFIG_DEFAULTS["agent_owns_analysis"] is False
    assert store.config_view({"agent_owns_analysis": True})[
        "agent_owns_analysis"] is True
    api = os.path.join(REPO_ROOT, "src", "reports", "reportsApi.ts")
    with open(api, encoding="utf-8") as handle:
        assert 'agent_owns_analysis: "agentOwnsAnalysis"' in handle.read()
