"""Tier 2: does it escalate what matters, stay quiet when nothing does, and
is it structurally unable to act? TEST-012.

⚠️ THE THIRD IS THE ONE THAT MATTERS. Triage runs ~96 times a day and is the
tier most likely to be pointed at a cheaper or local model later, so its
authority must not rest on the model behaving. `policy.for_run(tier="triage")`
denies every non-READ tool before one is offered.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List, Mapping

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from vesta.supervise.agent import policy as policy_mod
from vesta.supervise.agent import registry as reg_mod
from vesta.supervise.agent import triage
from vesta.supervise.agent.registry import Registry
from vesta.supervise.agent.tools.base import BaseTool
from vesta.supervise.agent.tools.base import text
from fake_provider import FakeProvider, asks, declines, says  # noqa: E402

ON: Dict[str, Any] = {"enabled": True, "triage_minutes": 15}


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    from vesta.supervise.agent import audit as audit_mod
    from vesta.supervise.agent import budget as budget_mod
    monkeypatch.setattr(audit_mod, "AUDIT_FILE", str(tmp_path / "a.json"))
    monkeypatch.setattr(budget_mod, "BUDGET_FILE", str(tmp_path / "b.json"))
    monkeypatch.setattr(budget_mod, "_BREAKER", None)


class _Villa(BaseTool):
    name = "read_villa"
    description = "The villa document, as the triage pass already has it."
    inputSchema = {"type": "object", "properties": {}}
    mode = "READ"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        return [text("villa")]


class _Writes(BaseTool):
    name = "raise_concern"
    description = "A WRITE tool, present to prove triage cannot reach it."
    inputSchema = {"type": "object", "properties": {}}
    mode = "WRITE"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        return [text("filed")]


def _run(script: List[Any], registry: Any = None) -> Any:
    return asyncio.run(triage.run(
        provider=FakeProvider(script), document="PROFILE\n\nDELTA",
        config=ON, registry=registry or Registry([_Villa(), _Writes()])))


# ── escalating ──────────────────────────────────────────────────────────────
def test_a_seeded_anomaly_escalates_with_a_named_subject() -> None:
    out = _run([says("ESCALATE: pool pump — drawing 980 W against a usual 320")])
    assert out.status == "answered"
    assert [e.subject for e in out.escalations] == ["pool pump"]
    assert "980" in out.escalations[0].reason


def test_a_quiet_villa_escalates_NOTHING() -> None:
    out = _run([says("NOTHING")])
    assert out.escalations == [] and out.quiet


def test_several_subjects_each_get_their_own_line() -> None:
    out = _run([says("ESCALATE: pool pump — is loud\n"
                     "ESCALATE: gate — did not close")])
    assert [e.subject for e in out.escalations] == ["pool pump", "gate"]


def test_the_dashes_a_model_actually_types_all_parse() -> None:
    for dash in ("—", "--", "-", ":"):
        out = _run([says(f"ESCALATE: pool pump {dash} is loud")])
        assert out.escalations, f"{dash!r} did not parse"


def test_a_malformed_line_is_DROPPED_not_guessed_at() -> None:
    """⚠️ Inventing structure would put words in the model's mouth that the
    audit then attributes to it."""
    out = _run([says("ESCALATE:\nESCALATE: — nothing\nmaybe look at the pump?")])
    assert out.escalations == []


# ── quiet is not the same as broken ─────────────────────────────────────────
def test_a_DECLINED_pass_is_not_reported_as_quiet() -> None:
    """⚠️ A declined run has no escalations either, and reading that as
    "nothing to report" is the silent failure this subsystem keeps hitting."""
    out = _run([declines("no credit")])
    assert out.status == "declined"
    assert out.quiet is False, "a failed pass claimed the villa was quiet"
    assert "no credit" in out.reason


# ── it cannot act, and policy is why ────────────────────────────────────────
def test_triage_may_not_call_a_WRITE_tool_even_if_it_tries() -> None:
    """TEST-012. ⚠️ REFUSED BY THE GATE, not by the prompt."""
    out = _run([asks("raise_concern"), says("NOTHING")])
    assert out.status in ("answered", "declined")
    snap = policy_mod.for_run(ON, tier="triage", tool_names=["raise_concern"])
    assert policy_mod.may_use_tool(snap, "raise_concern", "WRITE").verdict == "deny"


def test_the_write_tool_is_not_even_OFFERED_to_triage() -> None:
    """Defence in depth: the gate refuses it, and the registry never shows it.
    A tool the model cannot use is a tool it should not read about."""
    narrowed = triage.registry_for(Registry([_Villa(), _Writes()]))
    assert list(narrowed.names) == ["read_villa"]


def test_the_tool_set_is_narrowed_by_NAME_not_by_mode() -> None:
    """⚠️ `read_state` is READ too, and would let a cheap pass fan out across
    the villa one entity at a time — which is the cost triage exists to avoid."""
    assert triage.TRIAGE_TOOLS == ("read_villa",)


def test_the_narrowed_registry_comes_FROM_the_real_one() -> None:
    """⚠️ ARCH-012: a second registry is a second gate, and it would be the one
    nobody tests. The narrowing must select, never construct.

    ⚠️ THE SELECTION MOVED INTO `registry.narrowed` IN 2.752.0, when the reason
    tier needed the same thing and a second copy would have been the very
    duplication this test guards. So the pin follows it: triage must DELEGATE,
    and the shared helper must SELECT from what it is given.
    """
    import inspect
    caller = inspect.getsource(triage.registry_for)
    assert "narrowed(" in caller, "triage no longer uses the shared narrowing"
    # ⚠️ CODE LINES ONLY. The first version of this check matched the word
    # `Registry(` inside the comment EXPLAINING why the construction was
    # removed — a pin failing on the prose that records its own finding.
    code = "\n".join(l for l in caller.split('"""')[-1].splitlines()
                     if not l.lstrip().startswith("#"))
    assert "Registry(" not in code, (
        "triage constructs a registry again instead of selecting from one")
    shared = inspect.getsource(reg_mod.narrowed)
    assert "full.get(n)" in shared, (
        "the shared narrowing constructs tools instead of selecting them")
    # ⚠️ AND IT MUST CARRY THE REF TABLE. A narrowed registry that drops `refs`
    # mints handles nothing can resolve, and `raise_concern` then refuses every
    # subject as "not a device handle from this run".
    assert "refs=" in shared, "the narrowing drops the run's ref table"


# ── the prompt is cacheable ─────────────────────────────────────────────────
def test_the_system_prompt_carries_no_clock_and_no_villa() -> None:
    """⚠️ It sits above the cache breakpoint on ~96 calls a day. One
    interpolated timestamp ends caching silently and the only symptom is the
    bill."""
    import re
    assert not re.search(r"\d{4}-\d{2}-\d{2}|\{[a-z_]+\}|%s", triage.SYSTEM)
    assert "{" not in triage.SYSTEM


def test_the_prompt_REFUSES_the_two_subjects_that_have_their_own_surfaces() -> None:
    """⚠️ THIS TEST REPLACES ONE THAT PINNED THE OPPOSITE RULE, AND THE OLD ONE
    WAS RIGHT WHEN IT WAS WRITTEN. It required the prompt to escalate an
    unlistening observation floor "as a subject in its own right", on the
    reasoning that "an empty escalation list would otherwise be the same answer
    as a healthy villa". True then. `collect.coverage()` did not reach the
    tablet at all.

    It does now — a whole tab, plus a section in every brief — so the escalation
    channel is no longer what distinguishes a blind supervisor from a quiet
    villa, and paying a frontier model every thirty minutes to rediscover it
    produced three of sixteen escalations on the reference villa. Three more
    were the facility record read back to the person who typed it.

    ⚠️ THE PROPERTY THE OLD TEST PROTECTED IS PINNED BELOW RATHER THAN DROPPED.
    """
    flat = " ".join(triage.SYSTEM.split())
    assert "NOT subjects" in flat, (
        "the prompt no longer tells triage what is not a subject")
    assert "reported directly on the property's screen" in flat
    assert "Somebody wrote those down" in flat
    # ⚠️ AND IT MUST NOT OVERCORRECT INTO SILENCE. Reading them as context is
    # the point; a tier told to ignore the coverage line entirely would judge
    # equipment against a window it does not know was empty.
    assert "as context for the equipment" in flat


def test_being_UNABLE_to_see_still_reaches_a_person_deterministically() -> None:
    """⚠️ THE PROPERTY, RE-HOMED. Before removing the escalation rule above I
    checked its finding survives somewhere permanent — the discipline
    /dry-audit Part 2 states for retiring any instrument. Two owners, neither
    of them a model: the brief composes a coverage section every run, and the
    diagnostics endpoint the Coverage tab reads answers the same question live.
    A villa whose add-on stopped listening is told so by both, for free.

    Derived from the shipped source rather than asserted, so the day either
    consumer drops it this fails instead of the signal going quiet."""
    # ⚠️ THE PATH IS DERIVED HERE RATHER THAN FROM A MODULE CONSTANT, because
    # this file has none — it inserts the shipped tree straight onto `sys.path`
    # at import time. Restating the walk is the smaller evil against adding a
    # constant only one test reads.
    root = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "rootfs", "usr", "bin")
    with open(os.path.join(root, "vesta", "brief", "pipeline.py"), encoding="utf-8") as h:
        pipeline_src = h.read()
    with open(os.path.join(root, "supervisor-proxy.py"), encoding="utf-8") as h:
        proxy_src = h.read()
    assert "collect.coverage(" in pipeline_src, (
        "the brief no longer computes coverage — the signal the triage rule "
        "used to carry now has no owner at all")
    # ⚠️ THIS ASSERTION WAS VACUOUS AND SAID SO OUT LOUD (fixed 2.756.0). It
    # claimed the DIAGNOSTICS endpoint reports coverage; it never did. The only
    # `reports_collect.coverage(` in the proxy lived inside the shadow-diff
    # route — a page about the cutover comparison, nothing to do with the
    # Coverage tab — so deleting that route in 2.756.0 turned this red and
    # exposed a pin that had been satisfied by an unrelated call site since the
    # day it was written. The tab's live answer has always come from the
    # collector's own state, not from `coverage()`.
    assert "reports_collect.state()" in proxy_src, (
        "the diagnostics endpoint no longer publishes the collector state, so "
        "the Coverage tab cannot answer 'is anything listening?'")


# ── cadence ─────────────────────────────────────────────────────────────────
def test_the_cadence_comes_from_config() -> None:
    assert triage.due(ON, since_minutes=20) is True
    assert triage.due(ON, since_minutes=5) is False
    assert triage.due({"triage_minutes": 0}, since_minutes=999) is False


def test_the_pass_LOGS_why_a_subject_was_not_identified(capsys: Any) -> None:
    """⚠️ `feedback_pin-the-caller`, AND MUTATION TESTING IS WHY THIS EXISTS.
    `test_subject_identity` exercises `_unidentified_note` directly and stays
    green when `triage.run` never appends it — deleting the call from the stage
    line left all 25 of those assertions passing. A diagnostic nobody emits is
    indistinguishable from no diagnostic, which is the exact shape that left the
    degradation ladder unreachable for 57 releases.

    The registry here has NO ref table, so nothing can be identified and the
    note must appear with a candidate count of zero — which is itself the
    distinction the note was added to make."""
    _run([says("ESCALATE: house pump — cycling more than usual")])
    line = capsys.readouterr().out
    assert "1 escalation(s)" in line and "0/1 identified" in line, line
    assert "unidentified: 'house pump'" in line, line
    assert "0 candidate label(s)" in line, line
