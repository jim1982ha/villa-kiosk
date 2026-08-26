"""The approval queue: derive it, act on it, settle it. TASK-105.

⚠️ THE FEATURE THIS COMPLETES SHIPPED HALF-BUILT AND SAID SO IN ITS OWN
CHANGELOG. `investigate_mode: approve` recorded an `awaiting-approval` row per
escalated subject and spent nothing — correct, complete server behaviour with no
way for a person to see or answer it. The assertions that matter here are the
ones about SAMENESS: approving must reach the model through the function the
scheduler already uses, or there are two investigation paths and the second one
is the one that spends money unwatched.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List, Mapping

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent import audit, budget, concerns, reason, runtime, triage  # noqa: E402
from agent import scheduler  # noqa: E402
from agent.refs import RefTable  # noqa: E402
from agent.registry import Registry  # noqa: E402
from agent.tools.base import BaseTool, data  # noqa: E402
from fake_provider import FakeProvider, asks, says  # noqa: E402
from reports import usage as usage_mod  # noqa: E402

DEVICE = "sensor.example_pump_power"

APPROVE: Dict[str, Any] = {
    "enabled": True, "shadow": False, "model_triage": "t", "model_reason": "r",
    "triggers": {"scheduled": True}, "investigate_mode": "approve",
}


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(concerns, "CONCERNS_FILE", str(tmp_path / "c.json"))
    monkeypatch.setattr(budget, "BUDGET_FILE", str(tmp_path / "b.json"))
    monkeypatch.setattr(audit, "AUDIT_FILE", str(tmp_path / "a.json"))
    monkeypatch.setattr(usage_mod, "USAGE_PATH", str(tmp_path / "u.json"))
    monkeypatch.setattr(budget, "_BREAKER", None)
    monkeypatch.setattr(triage, "build_registry", _registry)
    monkeypatch.setattr(runtime, "build_registry", lambda **kw: _registry())


class _Reader(BaseTool):
    name = "read_villa"
    description = "The villa, as a document."
    inputSchema = {"type": "object", "properties": {}}
    mode = "READ"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        return [data({"ref": "d1", "state": "340", "unit": "W"})]


def _registry(*a: Any, **k: Any) -> Registry:
    table = RefTable()
    table.ref_for(DEVICE, "Pool pump")
    return Registry([_Reader()], refs=table)


def _queue_two() -> str:
    """One pass in approve mode, escalating two subjects."""
    provider = FakeProvider([says(
        "ESCALATE: Pool pump — it has been running all night\n"
        "ESCALATE: Monitoring coverage — the journal has a gap")])
    return asyncio.run(scheduler.run_once(
        None, config=dict(APPROVE), provider=provider, document="the villa",
        trigger="scheduled"))


# ── deriving the queue ──────────────────────────────────────────────────────
def test_a_queued_escalation_carries_its_subject_as_a_field() -> None:
    """⚠️ A FIELD, NOT PROSE. Approving hands the subject back to the loop, and
    recovering it by splitting `detail` is what `audit.ROW_FIELDS` records
    having been paid for one release earlier — in this same file."""
    _queue_two()
    pending = audit.pending_escalations()
    assert [r["subject"] for r in pending] == ["Pool pump", "Monitoring coverage"]
    assert pending[0]["detail"] == "it has been running all night"


def test_nothing_is_queued_when_the_villa_investigates_automatically() -> None:
    provider = FakeProvider([says("ESCALATE: Pool pump — running all night"),
                             says("nothing found")])
    asyncio.run(scheduler.run_once(
        None, config={**APPROVE, "investigate_mode": "auto"},
        provider=provider, document="d", trigger="scheduled"))
    assert audit.pending_escalations() == []


def test_the_queue_is_derived_and_never_stored() -> None:
    """⚠️ ANY LATER ROW SHARING THE RUN ID SETTLES IT. The audit is append-only
    — a row is never edited — so a queue asking "has anything else happened to
    this run id" inherits that for free, where a `pending` flag would have to be
    rewritten and would be the moment the record stopped being evidence."""
    _queue_two()
    first = audit.pending_escalations()[0]["run_id"]
    audit.record_run(first, actor="owner", trigger="approved",
                     verdict="dismissed", subject="Pool pump")
    assert [r["run_id"] for r in audit.pending_escalations()] != [first]
    assert len(audit.pending_escalations()) == 1


# ── approving ───────────────────────────────────────────────────────────────
def test_approving_runs_the_investigation_and_settles_the_item() -> None:
    _queue_two()
    item = audit.pending_escalations()[0]
    provider = FakeProvider([
        asks("read_villa", {}, "tu_1"),
        asks("raise_concern", {"title": "Pool pump running overnight",
                               "body": "It has been at 340 W.",
                               "severity": "warning", "ref": "d1"}, "tu_2"),
        says("filed")])
    ran, why = asyncio.run(reason.approve(
        item["run_id"], provider=provider, config=dict(APPROVE),
        document="the villa"))

    assert ran, why
    assert len(concerns.read()) == 1, "approving produced no concern"
    assert len(audit.pending_escalations()) == 1, "the item is still queued"


def test_approving_uses_the_run_id_it_was_given_so_the_trail_is_one_thread() -> None:
    """⚠️ NOT A FRESH ID. Minting a new one would leave the queued row pending
    for ever AND split one subject's audit trail in two — the queue is settled
    by a row sharing the id, which is the same act that records what happened."""
    _queue_two()
    item = audit.pending_escalations()[0]
    asyncio.run(reason.approve(item["run_id"],
                               provider=FakeProvider([says("nothing found")]),
                               config=dict(APPROVE), document="d"))
    same = [r for r in audit.rows(500)
            if str(r.get("run_id")) == item["run_id"]]
    assert {str(r.get("verdict")) for r in same} >= {
        "awaiting-approval", "escalated", "started"}


def test_approving_is_not_a_second_investigation_path() -> None:
    """⚠️ THE ASSERTION THE WHOLE TASK RESTS ON. The automatic arm and the
    button must reach the model through ONE function, or the second path drifts
    from whichever gets tested — and here the second path is the one that spends
    money on a press."""
    _queue_two()
    item = audit.pending_escalations()[0]
    seen: List[Dict[str, Any]] = []
    original = reason.investigate_subject

    async def spy(item_: Any, **kwargs: Any) -> bool:
        seen.append(dict(kwargs))
        return await original(item_, **kwargs)

    reason.investigate_subject = spy               # type: ignore[assignment]
    try:
        asyncio.run(reason.approve(item["run_id"],
                                   provider=FakeProvider([says("nothing")]),
                                   config=dict(APPROVE), document="d"))
    finally:
        reason.investigate_subject = original      # type: ignore[assignment]
    assert len(seen) == 1, "approval did not go through investigate_subject"
    assert seen[0]["run_id"] == item["run_id"]


def test_the_subject_comes_from_the_queue_and_not_from_the_caller() -> None:
    """⚠️ `approve` TAKES A RUN ID AND NOTHING ELSE. There is no parameter in
    which a browser could name a subject nobody escalated."""
    import inspect
    params = set(inspect.signature(reason.approve).parameters)
    assert "subject" not in params and "item" not in params, params

    _queue_two()
    item = audit.pending_escalations()[0]
    captured: List[Any] = []
    original = reason.investigate_subject

    async def spy(item_: Any, **kwargs: Any) -> bool:
        captured.append(item_)
        return await original(item_, **kwargs)

    reason.investigate_subject = spy               # type: ignore[assignment]
    try:
        asyncio.run(reason.approve(item["run_id"],
                                   provider=FakeProvider([says("nothing")]),
                                   config=dict(APPROVE), document="d"))
    finally:
        reason.investigate_subject = original      # type: ignore[assignment]
    assert captured[0].subject == "Pool pump"


def test_an_unknown_or_already_settled_item_is_refused() -> None:
    _queue_two()
    item = audit.pending_escalations()[0]
    asyncio.run(reason.approve(item["run_id"],
                               provider=FakeProvider([says("nothing")]),
                               config=dict(APPROVE), document="d"))
    ran, why = asyncio.run(reason.approve(
        item["run_id"], provider=FakeProvider([says("nothing")]),
        config=dict(APPROVE), document="d"))
    assert not ran and "not waiting" in why

    ran, why = asyncio.run(reason.approve(
        "never-existed", provider=FakeProvider([says("nothing")]),
        config=dict(APPROVE), document="d"))
    assert not ran and "not waiting" in why


def test_the_budget_binds_the_button_too() -> None:
    """⚠️ A CEILING THAT BOUND THE SCHEDULER AND NOT THE BUTTON IS A CEILING
    WITH A WAY AROUND IT. The triage pass that queued these already spent one."""
    provider = FakeProvider([says("ESCALATE: Pool pump — running all night")])
    asyncio.run(scheduler.run_once(
        None, config={**APPROVE, "monthly_limit": 1}, provider=provider,
        document="d", trigger="scheduled"))
    item = audit.pending_escalations()[0]

    ran, why = asyncio.run(reason.approve(
        item["run_id"], provider=FakeProvider([says("nothing")]),
        config={**APPROVE, "monthly_limit": 1}, document="d"))
    assert not ran and why, "the button ran an investigation over budget"
    assert audit.pending_escalations(), "a refused approval must stay queued"


# ── dismissing ──────────────────────────────────────────────────────────────
def test_dismissing_settles_without_spending() -> None:
    _queue_two()
    item = audit.pending_escalations()[0]
    ok, why = reason.dismiss(item["run_id"], reason="the pump is being serviced")
    assert ok, why
    assert len(audit.pending_escalations()) == 1
    assert not concerns.read()

    settled = [r for r in audit.rows(500)
               if str(r.get("run_id")) == item["run_id"]
               and str(r.get("verdict")) == "dismissed"]
    assert settled and settled[0]["detail"] == "the pump is being serviced"
    # ⚠️ A SECOND ROW, NEVER AN EDIT — the queued row is untouched.
    assert any(str(r.get("verdict")) == "awaiting-approval"
               for r in audit.rows(500)
               if str(r.get("run_id")) == item["run_id"])


def test_dismissing_something_not_queued_is_refused() -> None:
    ok, why = reason.dismiss("never-existed")
    assert not ok and "not waiting" in why


# ── the check ↔ flag join key ───────────────────────────────────────────────
def test_a_check_and_its_flags_share_an_EXACT_key() -> None:
    """⚠️ THE WHOLE FLAG-NESTING FEATURE RESTS ON THIS ONE ARGUMENT, and until
    2.780.0 nothing pinned it. `audit.record_pass` stored `run_id: ""`, so a
    check and the flags it produced had NOTHING in common — the UI could pair
    them only by comparing clocks, a guess that goes wrong exactly when a manual
    check overlaps the scheduled one.

    ⚠️ FOUND BY MUTATION, NOT BY REVIEW. Deleting `run_id=check_id` from the
    `record_pass` call left all 1,916 tests green while silently un-nesting
    every flag in the app: checks still rendered, flags still rendered, and they
    simply stopped being drawn together. `feedback_pin-the-caller` — the helper
    was correct and nobody was passing the argument.

    The property: a flag's id is the check's id plus `-eN`, so stripping that
    suffix returns the check. `RecentChecks.checkIdOf` performs exactly that
    strip, and this is the other half of that contract.
    """
    import re
    import time as _time

    from agent import reason as reason_mod

    # ⚠️ THE CLOCK IS PUSHED FORWARD FOR THE FLAG-ID STAGE ONLY, and without
    # this the test passes by coincidence. `_ident` falls back to
    # `int(time.time())` when it is handed no `now`, and a test completes inside
    # one second — so check and flags land on the same stamp whether or not
    # `run_once` threaded its instant through. A REAL check takes 8-28 seconds
    # and straddles second boundaries routinely, so the coincidence does not
    # hold in the field. Moving this clock five seconds makes the difference
    # between "threaded" and "happened to agree" visible.
    _real = _time.time
    reason_mod.time = type("_C", (), {"time": staticmethod(lambda: _real() + 5)})()
    try:
        _queue_two()
    finally:
        reason_mod.time = _time

    rows = audit.rows(200)
    checks = [r for r in rows if str(r.get("tool", "")).startswith("pass:")]
    flags = [r for r in rows if "-e" in str(r.get("run_id", ""))]

    assert len(checks) == 1, f"expected one check row, got {len(checks)}"
    check_id = str(checks[0].get("run_id") or "")
    assert check_id, (
        "the check row carries no run_id, so nothing can pair it with the "
        "flags it produced and the UI falls back to guessing by timestamp")

    assert len(flags) == 2, (
        f"expected the two flags this pass raised, got {len(flags)} — this "
        "test would otherwise pass vacuously")
    for f in flags:
        stripped = re.sub(r"-e\d+$", "", str(f.get("run_id") or ""))
        assert stripped == check_id, (
            f"flag {f.get('run_id')!r} does not belong to check {check_id!r}: "
            "the suffix strip RecentChecks.checkIdOf performs no longer "
            "recovers the check, so flags render outside their own check")
