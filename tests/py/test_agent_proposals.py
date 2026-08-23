"""The confirm turn. TASK-083, REQ-029, ARCH-007, TEST-028.

⚠️ THE PROPERTY THIS FILE EXISTS FOR IS THAT THE MODEL CANNOT COMPLETE THE
FLOW. Everything else here is bookkeeping; that one is the feature. A confirm
flow the model can satisfy converts a refusal into a two-step execution and
looks like a safeguard while doing it, which is worse than having none.
"""

from __future__ import annotations

import os
import re
import sys

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

import pytest  # noqa: E402

from agent import proposals  # noqa: E402

KEY = "a1b2c3"


@pytest.fixture(autouse=True)
def _store(tmp_path, monkeypatch):
    monkeypatch.setattr(proposals, "PROPOSALS_FILE",
                        str(tmp_path / "proposals.json"))


def _propose(key: str = KEY, *, now: float = 1000.0, service: str = "unlock",
             entity_id: str = "lock.side_gate") -> bool:
    return proposals.propose(action_key=key, ref="r1", entity_id=entity_id,
                             service=service, reason="lets somebody in",
                             why="the cleaner is at the gate", now=now)


# ── the boundary ────────────────────────────────────────────────────────────
def test_NO_TOOL_can_confirm_a_proposal() -> None:
    """⚠️ THE ONE THAT MATTERS. Confirmation must arrive through an HTTP route
    with a session and a role — never through the tool registry, which the model
    drives. A tool named anything like confirm/approve/decide is this feature
    defeating itself, and it would pass every other test in this file."""
    tools_dir = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent", "tools")
    names = []
    for entry in sorted(os.listdir(tools_dir)):
        if not entry.endswith(".py"):
            continue
        with open(os.path.join(tools_dir, entry), encoding="utf-8") as handle:
            source = handle.read()
        names += re.findall(r'^\s{4}name\s*=\s*"([^"]+)"', source, re.M)
    assert names, "no tool names found — this test is checking nothing"
    for name in names:
        assert not re.search(r"confirm|approve|authoris|authoriz", name), (
            f"a tool called {name!r} exists; the confirm flow must not be "
            f"reachable from the model at all")

    # And the module the route uses must not be importable as a tool either.
    for entry in os.listdir(tools_dir):
        if entry.endswith(".py"):
            with open(os.path.join(tools_dir, entry), encoding="utf-8") as handle:
                assert "proposals" not in handle.read() or entry == "act.py", (
                    f"agent/tools/{entry} reaches into the proposal store")


def test_act_records_a_proposal_and_never_executes_one() -> None:
    """⚠️ THE TOOL PROPOSES; NOTHING IN THE TOOL LAYER DECIDES. `act.py` may
    only reach `propose` — a call to `decide` from there would be the model
    confirming its own request through one more layer."""
    act = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent", "tools",
                       "act.py")
    with open(act, encoding="utf-8") as handle:
        source = re.sub(r"#[^\n]*", "", handle.read())
    assert "proposals_mod.propose(" in source, (
        "act_service no longer records its proposal, so a high-harm request "
        "has nowhere for a person to answer it")
    assert "decide(" not in source, (
        "the tool layer can decide a proposal — the model would be confirming "
        "its own request")


# ── the lifecycle ───────────────────────────────────────────────────────────
def test_a_proposal_waits_and_is_listed() -> None:
    assert _propose()
    rows = proposals.pending(now=1001.0)
    assert len(rows) == 1
    assert rows[0]["service"] == "unlock" and rows[0]["state"] == "pending"


def test_a_confirm_returns_the_STORED_action_not_the_callers() -> None:
    """⚠️ THE CONFIRM ROUTE MUST NOT BE A WAY TO CALL AN ARBITRARY SERVICE. The
    body names WHICH proposal; the entity and service come from what was
    proposed."""
    _propose()
    out = proposals.decide(KEY, confirm=True, by="owner", now=1002.0)
    assert out["ok"] and out["state"] == "confirmed"
    assert out["proposal"]["entity_id"] == "lock.side_gate"
    assert out["proposal"]["service"] == "unlock"


def test_a_decline_returns_NO_proposal_to_execute() -> None:
    _propose()
    out = proposals.decide(KEY, confirm=False, by="owner", now=1002.0)
    assert out["ok"] and out["state"] == "declined"
    assert not out["proposal"]


def test_a_proposal_is_SINGLE_USE() -> None:
    """A double-tap on a wall tablet, a retry and a replay all reach the villa
    once."""
    _propose()
    assert proposals.decide(KEY, confirm=True, by="owner", now=1002.0)["ok"]
    again = proposals.decide(KEY, confirm=True, by="owner", now=1003.0)
    assert not again["ok"] and again["state"] == "confirmed"


def test_an_EXPIRED_proposal_cannot_be_confirmed() -> None:
    """⚠️ THE SAFETY PROPERTY, NOT HOUSEKEEPING. "Unlock the gate for the
    cleaner" is reasonable to confirm within two minutes and dangerous six hours
    later, when the cleaner has gone and the reason is forgotten."""
    _propose(now=1000.0)
    late = 1000.0 + proposals.TTL_SECONDS + 1
    assert proposals.pending(now=late) == []
    out = proposals.decide(KEY, confirm=True, by="owner", now=late)
    assert not out["ok"] and out["state"] == "expired"


def test_an_expired_proposal_is_RECORDED_not_dropped() -> None:
    """"Nobody answered in time" is the answer to "why did the gate not open",
    and a row that vanished cannot give it."""
    _propose(now=1000.0)
    proposals.pending(now=1000.0 + proposals.TTL_SECONDS + 1)
    stored = proposals._read()
    assert len(stored) == 1 and stored[0]["state"] == "expired"


def test_a_decision_needs_an_ACTOR() -> None:
    """A high-harm action that happened with nobody's name on it is one nobody
    owns.

    ⚠️ `now=` IS LOAD-BEARING HERE AND ITS ABSENCE MADE THIS TEST A LIE.
    Without it `decide` used the real clock, the fixture's proposal was already
    ten minutes stale, and the refusal under test came from EXPIRY rather than
    from the missing actor — so deleting the actor guard entirely left this
    green. Found by mutation, which is the only thing that could have found it:
    every assertion passed, for the wrong reason, in both directions.
    """
    _propose(now=1000.0)
    out = proposals.decide(KEY, confirm=True, by="", now=1001.0)
    assert not out["ok"] and out["reason"] == "no actor", (
        f"refused for the wrong reason: {out}")
    assert proposals.pending(now=1001.0), "the proposal was consumed anyway"


def test_an_unknown_key_is_refused() -> None:
    assert not proposals.decide("nope", confirm=True, by="owner")["ok"]


def test_the_same_action_does_not_queue_twice() -> None:
    """Keyed on the audit's `action_key`, so a repeated proposal of the same
    action is recognised as the same one."""
    assert _propose(now=1000.0)
    assert _propose(now=1001.0)
    assert len(proposals.pending(now=1002.0)) == 1


def test_the_queue_is_BOUNDED() -> None:
    """A queue of high-harm requests is itself a signal — the model looping, or
    somebody probing — and an unbounded list is a page nobody reads."""
    for n in range(proposals.MAX_PENDING + 3):
        _propose(f"k{n}", now=1000.0)
    assert len(proposals.pending(now=1001.0)) == proposals.MAX_PENDING


def test_an_incomplete_proposal_is_refused() -> None:
    """A proposal with no entity or no service could never be executed, and
    storing one would put an unanswerable card on the wall."""
    assert not proposals.propose(action_key="x", ref="r", entity_id="",
                                 service="unlock")
    assert not proposals.propose(action_key="x", ref="r",
                                 entity_id="lock.a", service="")
    assert not proposals.propose(action_key="", ref="r",
                                 entity_id="lock.a", service="unlock")
