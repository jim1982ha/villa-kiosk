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

from agent import policy as policy_mod, triage               # noqa: E402
from agent.registry import Registry                          # noqa: E402
from agent.tools.base import BaseTool, text                   # noqa: E402
from fake_provider import FakeProvider, asks, declines, says  # noqa: E402

ON: Dict[str, Any] = {"enabled": True, "triage_minutes": 15}


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    from agent import audit as audit_mod
    from agent import budget as budget_mod
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
    nobody tests. The narrowing must select, never construct."""
    import inspect
    source = inspect.getsource(triage.registry_for)
    assert "source.get(n)" in source


# ── the prompt is cacheable ─────────────────────────────────────────────────
def test_the_system_prompt_carries_no_clock_and_no_villa() -> None:
    """⚠️ It sits above the cache breakpoint on ~96 calls a day. One
    interpolated timestamp ends caching silently and the only symptom is the
    bill."""
    import re
    assert not re.search(r"\d{4}-\d{2}-\d{2}|\{[a-z_]+\}|%s", triage.SYSTEM)
    assert "{" not in triage.SYSTEM


def test_the_prompt_tells_it_to_report_being_UNABLE_to_see() -> None:
    """⚠️ A supervisor that cannot see is more urgent than most of what it
    would have seen — and an empty escalation list would otherwise be the same
    answer as a healthy villa."""
    # ⚠️ WHITESPACE-NORMALISED. The first version searched the raw string and
    # failed on "was not\nlistening" — a prompt is wrapped prose, so any test
    # matching a phrase in one must flatten it first or it is testing the line
    # width.
    flat = " ".join(triage.SYSTEM.split())
    assert "not listening" in flat
    assert "cannot see is a more urgent problem" in flat


# ── cadence ─────────────────────────────────────────────────────────────────
def test_the_cadence_comes_from_config() -> None:
    assert triage.due(ON, since_minutes=20) is True
    assert triage.due(ON, since_minutes=5) is False
    assert triage.due({"triage_minutes": 0}, since_minutes=999) is False
