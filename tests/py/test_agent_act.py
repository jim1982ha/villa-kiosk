"""`act_service` — the new privilege boundary. TASK-082, TASK-084.

⚠️ EVERY TEST HERE IS ABOUT SOMETHING NOT HAPPENING. That is the shape of the
subject: the tool's job is to touch the villa, and almost every case is one
where it must not.
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

from agent import audit as audit_mod                           # noqa: E402
from agent import policy as policy_mod                         # noqa: E402
from agent import proposals as proposals_mod                   # noqa: E402
from agent.refs import RefTable                                # noqa: E402
from agent.tools import act as act_mod                         # noqa: E402

LAMP = "light.probe_lamp"
DOOR = "switch.probe_door_relay"


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(audit_mod, "AUDIT_FILE", str(tmp_path / "a.json"))
    monkeypatch.setattr(proposals_mod, "PROPOSALS_FILE",
                        str(tmp_path / "p.json"))


def _refs() -> RefTable:
    table = RefTable()
    table.ref_for(LAMP)
    table.ref_for(DOOR)
    return table


def _ref_of(table: RefTable, entity_id: str) -> str:
    return next(r for r in table.known() if table.resolve(r) == entity_id)


def _tool(*, armed: bool = True, allowed: Any = None,
          calls: Any = None) -> Any:
    table = _refs()
    config: Dict[str, Any] = {
        "act_enabled": armed,
        # ⚠️ ENTITY IDS, AND BUILDING THIS FROM THE RUN'S OWN TABLE IS WHAT
        # HID THE BUG UNTIL 2.718.0. A list derived from `table` agrees with
        # that table by construction, so it could never notice that a handle
        # means a different device in the next run. See
        # `test_agent_act_allowlist.py` for the pin that would have.
        "actuable_entities": [LAMP, DOOR] if allowed is None else allowed,
        "allowed_services": ["light.turn_off", "turn_off", "switch.turn_on"],
    }
    policy = policy_mod.for_run(config, tier="reason",
                                tool_names=["act_service"])

    async def caller(entity_id: str, service: str,
                     params: Mapping[str, Any]) -> None:
        if calls is not None:
            calls.append((entity_id, service))

    tool = act_mod.build(refs=table, caller=caller, policy=policy,
                         config=config, run_id="r1", actor="owner")
    return tool, table


def _run(tool: Any, **args: Any) -> List[Dict[str, Any]]:
    args.setdefault("why", "because the reading said so")
    return asyncio.run(tool.call(args))


# ── it acts on nothing by default ───────────────────────────────────────────
def test_an_EMPTY_actuable_list_authorises_nothing() -> None:
    """⚠️ Even with actuation switched ON. A helpful default here is an
    actuating agent nobody asked for."""
    tool, table = _tool(allowed=[])
    out = _run(tool, ref=_ref_of(table, LAMP), service="turn_off")
    assert "error" in out[0] and "actuable list" in out[0]["error"]["message"]


def test_actuation_DISABLED_refuses_even_a_listed_device() -> None:
    calls: List[Any] = []
    tool, table = _tool(armed=False, calls=calls)
    out = _run(tool, ref=_ref_of(table, LAMP), service="turn_off")
    assert "error" in out[0] and calls == []


# ── the two axes ────────────────────────────────────────────────────────────
def test_a_low_harm_reversible_action_on_a_listed_device_RUNS() -> None:
    calls: List[Any] = []
    tool, table = _tool(calls=calls)
    out = _run(tool, ref=_ref_of(table, LAMP), service="turn_off")
    assert out[0].get("type") == "text" and calls == [(LAMP, "turn_off")]


def test_a_PROPOSAL_REACHES_THE_QUEUE_a_person_answers_from() -> None:
    """⚠️ BEHAVIOURAL, BECAUSE THE SOURCE-READING PIN WAS NOT ENOUGH. TASK-083's
    companion test asserts `proposals_mod.propose(` appears in `act.py`, and a
    mutation that neutered the call while leaving the text (`None and
    proposals_mod.propose(...)`) SURVIVED it. A grep proves a line exists; only
    running the tool proves it does anything.

    Until this landed, a high-harm request produced a proposal that existed
    solely in the model's own context — it could say "shall I unlock the gate?"
    and there was nowhere for anybody to say yes."""
    tool, table = _tool()
    out = _run(tool, ref=_ref_of(table, DOOR), service="turn_on")
    assert out[0]["json"]["proposed"] is True

    waiting = proposals_mod.pending()
    assert len(waiting) == 1, "the proposal never reached the queue"
    assert waiting[0]["entity_id"] == DOOR
    assert waiting[0]["service"] == "turn_on"
    # ⚠️ THE AUDIT'S OWN KEY, so the trail reads as one story: intended,
    # proposed, confirmed by a person, done.
    assert waiting[0]["action_key"] == out[0]["json"]["action_key"]


def test_a_DOOR_RELAY_is_proposed_never_executed() -> None:
    """⚠️ TASK-081's whole point: `switch.probe_door_relay` is an ordinary
    `switch.*` that physically opens something. A rule matching `lock.*` sails
    straight past it, and reversibility does not save you — unlocking a door is
    reversible and the harm is not."""
    calls: List[Any] = []
    tool, table = _tool(calls=calls)
    out = _run(tool, ref=_ref_of(table, DOOR), service="turn_on")
    assert out[0].get("type") == "json"
    assert out[0]["json"]["proposed"] is True
    assert out[0]["json"]["harm"] == "high"
    assert calls == [], "a high-harm action was executed"


def test_a_proposal_is_a_RESULT_not_an_error() -> None:
    """⚠️ The model should tell somebody what it would like to do. An error
    would read as a dead end and send it looking for another way."""
    tool, table = _tool()
    out = _run(tool, ref=_ref_of(table, DOOR), service="turn_on")
    assert "error" not in out[0]


# ── the account of why ──────────────────────────────────────────────────────
def test_an_action_with_no_REASON_is_refused() -> None:
    """⚠️ Not ceremony: the audit row is the only account of why the villa
    changed, and a blank one turns "who did this" into an unanswerable question
    three months later — which is when it is asked."""
    tool, table = _tool()
    out = asyncio.run(tool.call({"ref": _ref_of(table, LAMP),
                                 "service": "turn_off", "why": "  "}))
    assert "error" in out[0] and "say why" in out[0]["error"]["message"]


def test_every_attempt_leaves_an_audit_row() -> None:
    tool, table = _tool()
    _run(tool, ref=_ref_of(table, LAMP), service="turn_off")
    rows = [r for r in audit_mod.rows(50) if r.get("tool") == "act_service"]
    assert rows, "no intent row"
    assert any(r.get("outcome") == "done" for r in audit_mod.rows(50))


def test_a_REFUSED_action_is_recorded_too() -> None:
    """A log containing only successes cannot distinguish "nothing was refused"
    from "nothing was checked"."""
    tool, table = _tool()
    _run(tool, ref=_ref_of(table, DOOR), service="turn_on")
    assert any(r.get("verdict") == "propose" for r in audit_mod.rows(50))


# ── idempotency · TASK-084 ──────────────────────────────────────────────────
def test_the_SAME_action_twice_is_refused_the_second_time() -> None:
    """⚠️ A replayed action means the caller believes it has not acted when it
    has, and continuing quietly is how a pump gets switched twice."""
    tool, table = _tool()
    ref = _ref_of(table, LAMP)
    first = _run(tool, ref=ref, service="turn_off")
    assert first[0].get("type") == "text", first
    second = _run(tool, ref=ref, service="turn_off")
    assert "error" in second[0]
    assert "already has an outcome" in second[0]["error"]["message"]


def test_a_DIFFERENT_action_is_not_a_replay() -> None:
    tool, table = _tool()
    _run(tool, ref=_ref_of(table, LAMP), service="turn_off")
    out = _run(tool, ref=_ref_of(table, LAMP), service="turn_on")
    assert "error" not in out[0] or "already" not in str(out[0])


def test_the_digest_is_stable_under_key_ORDER() -> None:
    """⚠️ Or the same call fingerprints differently and the idempotency guard
    silently stops guarding."""
    from agent import contracts
    assert contracts.args_digest({"a": 1, "b": 2}) == \
        contracts.args_digest({"b": 2, "a": 1})


# ── the surface it must never reach ─────────────────────────────────────────
def test_act_service_is_mode_ACT_so_MCP_excludes_it_by_construction() -> None:
    """⚠️ REQ-047, and the reason `TOOL_MODE` became three-valued BEFORE this
    file existed: the MCP surface is an allow-list over modes, so this is
    excluded by BEING what it is rather than by anyone remembering to deny it."""
    from agent import mcp_server
    from agent.registry import Registry

    tool, _ = _tool()
    assert tool.mode == "ACT"
    assert mcp_server.exported(Registry([tool])) == []


def test_it_is_absent_from_the_shared_registry() -> None:
    from agent.tools import ALL_TOOLS
    assert "act_service" not in {cls().name for cls in ALL_TOOLS}


def test_it_carries_no_policy_of_its_own() -> None:
    """⚠️ Every gate is somebody else's. A tool with its own copy of the harm
    rules would be the second authorization surface, and the one nobody tests."""
    import inspect
    source = inspect.getsource(act_mod)
    for owned_elsewhere in ("HIGH_HARM_DOMAINS", "_ACCESS_WORDS",
                            "harm_class_of("):
        assert owned_elsewhere not in source, owned_elsewhere
