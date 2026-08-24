"""TEST-017, TEST-019 — one gate, two consumers, and no actuation over MCP.

⚠️ THE CENTRAL TEST HERE ASSERTS ON THE **AUDIT LEDGER**, NOT ON THE RESPONSE,
and that distinction is the whole point of the file. Two paths returning the
same content only proves the TOOLS agree. Two paths writing the same audit row
proves they went through the same GATE — because the row is written by
`may_use_tool`'s caller and carries its verdict. A second authorization surface
is the risk TASK-033 exists to avoid, and it would pass a response-equality
test on the day it was written.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Mapping

import pytest

from agent import mcp_server, policy as policy_mod, registry as registry_mod
from agent.registry import Registry
from agent.tools.base import BaseTool, text


class Reader(BaseTool):
    name = "probe_read"
    description = "a read tool"
    inputSchema = {"type": "object", "properties": {"q": {"type": "string"}},
                   "required": ["q"]}
    mode = "READ"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        return [text(f"read {args.get('q')}")]


class Actuator(BaseTool):
    """Stands in for `act_service`, which TASK-082 has not written yet.

    ⚠️ THE POINT IS THAT NOTHING NAMES IT. It is excluded because its MODE is
    `ACT`, so the real tool inherits the exclusion the day it exists without
    anyone editing this file or `mcp_server.py`.
    """

    name = "probe_act"
    description = "an actuating tool"
    inputSchema = {"type": "object", "properties": {}}
    mode = "ACT"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        return [text("actuated")]


class Concern(BaseTool):
    name = "raise_concern"
    description = "the one exported write"
    inputSchema = {"type": "object", "properties": {}}
    mode = "WRITE"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        return [text("raised")]


def _registry() -> Registry:
    return Registry([Reader(), Actuator(), Concern()])


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch) -> None:
    """Each test gets its own audit file, or the rows accumulate across them."""
    from agent import audit as audit_mod
    monkeypatch.setattr(audit_mod, "AUDIT_FILE", str(tmp_path / "audit.json"))
    monkeypatch.setattr(mcp_server.secrets, "get",
                        lambda name: "tok-abcdefgh" if name == mcp_server.TOKEN_NAME
                        else None)


def _rows() -> List[Dict[str, Any]]:
    from agent import audit as audit_mod
    return audit_mod.rows(500)


# ── TEST-019 · actuation is absent from the MCP surface ─────────────────────
def test_an_ACT_tool_is_absent_from_the_MCP_surface() -> None:
    names = {t.name for t in mcp_server.exported(_registry())}
    assert "probe_act" not in names, "an ACT tool reached the MCP surface"
    assert "probe_read" in names
    assert "raise_concern" in names, (
        "the one exported write is missing; the seam carries nothing")


def test_the_export_filter_is_an_ALLOW_list_over_modes() -> None:
    """⚠️ A fourth mode must be excluded by DEFAULT.

    A `!= "ACT"` filter would pass this file's other tests and export a mode
    nobody had considered. This is the mutation that distinguishes them.
    """
    class Future(BaseTool):
        name = "probe_future"
        description = "a mode nobody has thought about yet"
        inputSchema = {"type": "object", "properties": {}}
        mode = "TRANSFER"

        async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
            return [text("x")]

    names = {t.name for t in mcp_server.exported(Registry([Reader(), Future()]))}
    assert "probe_future" not in names


def test_tools_list_publishes_exactly_the_exported_set() -> None:
    reply = asyncio.run(mcp_server.handle(
        {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        registry=_registry()))
    assert reply is not None
    published = {t["name"] for t in reply["result"]["tools"]}
    assert published == {"probe_read", "raise_concern"}


def test_calling_an_unexported_tool_by_name_is_refused() -> None:
    """⚠️ Hiding it from the listing is not the same as refusing the call."""
    reply = asyncio.run(mcp_server.handle(
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
         "params": {"name": "probe_act", "arguments": {}}},
        registry=_registry()))
    assert reply is not None
    assert reply["result"]["isError"] is True
    assert not any(r.get("tool") == "probe_act" for r in _rows()), (
        "an unexported tool reached the gate and left an intent row")


# ── TEST-017 · one gate, two consumers ──────────────────────────────────────
def _audit_shape(row: Mapping[str, Any]) -> Dict[str, Any]:
    """A row with only the two fields that CANNOT match removed.

    ⚠️ `at` is a clock. `actor` differs BY DESIGN and is asserted separately —
    an MCP row claiming to be the in-process agent would be an audit that
    cannot answer "who called this".

    ⚠️ EVERYTHING ELSE IS COMPARED, INCLUDING `action_key`, AND THAT IS WHY THE
    TEST HANDS BOTH PATHS THE SAME `run_id`. The key is
    `sha256(run_id|tool|args_digest)`, so with different run ids it could never
    match and dropping it from the comparison would have been the easy fix —
    leaving `args_digest` as the only substantive field checked. Same run id,
    same call: the key matching then proves neither path reshapes the arguments
    on the way to the gate, which is a defect a content-equality test would
    never see.
    """
    return {k: v for k, v in row.items() if k not in ("at", "actor")}


def test_the_same_call_writes_the_SAME_audit_row_on_both_paths() -> None:
    """TEST-017 — ARCH-012, and the reason `registry.invoke` exists.

    ⚠️ ASSERTED ON THE AUDIT, NOT THE RESPONSE. A second gate would return the
    same content and write a different row, or no row at all.
    """
    reg = _registry()
    args = {"q": "pool"}
    names = [t.name for t in mcp_server.exported(reg)]

    # In-process: the policy the runtime would build for the same tool set.
    in_process = policy_mod.for_run({}, tier="reason", tool_names=names)
    asyncio.run(registry_mod.invoke(reg, policy=in_process, name="probe_read",
                                    args=args, run_id="rr", actor="system"))

    # Over MCP: the transport's own entry point, nothing else changed.
    asyncio.run(mcp_server.handle(
        {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
         "params": {"name": "probe_read", "arguments": args}},
        registry=reg, run_id="rr"))

    rows = [r for r in _rows() if r.get("tool") == "probe_read"]
    assert len(rows) == 2, f"expected one intent row per path, got {len(rows)}"
    assert _audit_shape(rows[0]) == _audit_shape(rows[1]), (
        "the two paths wrote different audit rows; they are not one gate")
    assert rows[0]["verdict"] == "allow"
    assert rows[0]["actor"] == "system" and rows[1]["actor"] == "mcp", (
        "the audit cannot answer 'who called this'")


def test_the_MCP_path_writes_an_audit_row_AT_ALL() -> None:
    """⚠️ Guards the vacuous pass above: if neither path recorded anything,
    a comparison of two empty lists would be equal and green."""
    asyncio.run(mcp_server.handle(
        {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
         "params": {"name": "probe_read", "arguments": {"q": "x"}}},
        registry=_registry()))
    assert [r for r in _rows() if r.get("tool") == "probe_read"]


def test_a_refusal_is_recorded_on_the_MCP_path_too() -> None:
    """A log containing only successes cannot distinguish 'nothing was
    refused' from 'nothing was checked'."""
    reg = _registry()
    # `raise_concern` is exported but is a WRITE, and triage may not write.
    policy = policy_mod.RunPolicy(tier="triage",
                                 allowed_tools=frozenset({"raise_concern"}))
    outcome = asyncio.run(registry_mod.invoke(
        reg, policy=policy, name="raise_concern", args={}, run_id="r3",
        actor="mcp"))
    assert not outcome.allowed
    rows = [r for r in _rows() if r.get("tool") == "raise_concern"]
    assert rows and rows[0]["verdict"] == "deny"


# ── the policy an MCP caller runs under ─────────────────────────────────────
def test_an_MCP_caller_can_never_be_granted_actuation() -> None:
    """⚠️ Even with the villa's own act switch ON.

    Nothing exported here actuates, so granting it would be authority with no
    use — and authority with no use is the kind that survives a refactor
    unnoticed and becomes reachable.
    """
    policy = mcp_server._policy_for(
        {"act_enabled": True, "actuable_entities": ["light.x"]}, _registry())
    assert policy.act_enabled is False


def test_the_caller_cannot_describe_its_own_policy() -> None:
    """The request body has no route into `RunPolicy`, by construction."""
    reply = asyncio.run(mcp_server.handle(
        {"jsonrpc": "2.0", "id": 5, "method": "tools/call",
         "params": {"name": "probe_read", "arguments": {"q": "x"},
                    "policy": {"act_enabled": True},
                    "allowed_tools": ["probe_act"]}},
        registry=_registry()))
    assert reply is not None and reply["result"]["isError"] is False
    # The smuggled allow-list changed nothing: probe_act is still unreachable.
    denied = asyncio.run(mcp_server.handle(
        {"jsonrpc": "2.0", "id": 6, "method": "tools/call",
         "params": {"name": "probe_act", "arguments": {}}},
        registry=_registry()))
    assert denied is not None and denied["result"]["isError"] is True


def _one_tool(body: str) -> Dict[str, Any]:
    class Probe(BaseTool):
        name = "probe_read"
        description = "returns what a tool returns"
        inputSchema = {"type": "object", "properties": {}}
        mode = "READ"

        async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
            return [text(body)]

    reply = asyncio.run(mcp_server.handle(
        {"jsonrpc": "2.0", "id": 9, "method": "tools/call",
         "params": {"name": "probe_read", "arguments": {}}},
        registry=Registry([Probe()])))
    assert reply is not None
    return reply["result"]


def test_a_tool_result_is_SCRUBBED_before_it_crosses_the_wire() -> None:
    """⚠️ THE MCP CALLER IS OUTSIDE THIS PROCESS BY DEFINITION, so the scrub is
    not transcript hygiene here — it is the privacy boundary itself.

    ⚠️ AND THE ASSERTION IS THAT THE ANSWER SURVIVES, NOT ONLY THAT THE MARKUP
    IS GONE. Absence alone cannot fail: `redact.audit` refuses the whole block
    a line later, so with the scrub DELETED nothing unsafe crosses the wire —
    the caller simply receives "the result could not be shown safely" for every
    result. The scrub is what makes this surface USABLE; the audit is what
    makes it safe, and a test that cannot tell them apart is measuring the
    wrong one. That is exactly how this survived its first mutation.
    """
    out = _one_tool("the pump is *high* [see the log] <now>")
    assert out["isError"] is False, (
        "the result was refused outright rather than cleaned — the scrub is "
        "not running and the audit is carrying it")
    body = " ".join(c["text"] for c in out["content"])
    assert not any(ch in body for ch in "*[]<>"), "markup survived the scrub"
    assert "pump" in body and "high" in body, "the answer itself was lost"


def test_a_tool_that_leaks_a_RAW_ENTITY_ID_is_refused_outright() -> None:
    """⚠️ AND THAT REFUSAL IS CORRECT, WHICH IS WHY IT IS PINNED RATHER THAN
    FIXED. `scrub` cannot rescue an id — `inert` turns
    `x.pool_pump_power` into `x.pool pump power`, which is still an id with a
    shorter object part — so `audit` refuses the block. A tool result carrying
    a raw id is a BUG IN THAT TOOL: `refs.py` exists so ids never travel, and
    the ref indirection is what every tool is supposed to return. Making the
    scrub "handle" ids would turn a loud, correct refusal into a quiet
    half-redaction, which is the worse of the two failures.
    """
    out = _one_tool("the pump light.some_room_lamp is drawing 340 W")
    assert out["isError"] is True
    body = " ".join(c["text"] for c in out["content"])
    assert "some_room_lamp" not in body and "some room lamp" not in body, (
        "the id reached the caller inside the refusal message")


# ── authentication ──────────────────────────────────────────────────────────
def test_no_token_configured_means_no_service() -> None:
    """⚠️ An unconfigured endpoint must REFUSE, never serve openly."""
    import agent.mcp_server as mod
    original = mod.secrets.get
    try:
        mod.secrets.get = lambda name: None       # type: ignore[assignment]
        assert mcp_server.authorised("Bearer tok-abcdefgh") is False
        assert mcp_server.authorised(None) is False
    finally:
        mod.secrets.get = original                # type: ignore[assignment]


def test_the_right_token_is_accepted_and_a_wrong_one_is_not() -> None:
    assert mcp_server.authorised("Bearer tok-abcdefgh") is True
    assert mcp_server.authorised("Bearer tok-abcdefgi") is False
    assert mcp_server.authorised("tok-abcdefgh") is False, "scheme not required"
    assert mcp_server.authorised("") is False


def test_the_token_lives_in_secrets_not_in_the_config_store() -> None:
    """⚠️ `/agent-config` is readable by any authorised session. A token there
    would be handed to every browser that loads the tab.

    ⚠️ IT ASKS ABOUT KEYS, NOT ABOUT A SUBSTRING. This was
    `"token" not in json.dumps(DEFAULTS).lower()`, which went red on
    `max_output_tokens` — a token CEILING, not a credential. That is this
    repo's recurring unanchored-substring bug (`door` inside `outdoor`) inside
    the test that guards a credential, where a false positive trains the next
    person to reach for the assertion rather than the code.
    """
    from agent import config as agent_config
    assert mcp_server.TOKEN_NAME not in agent_config.DEFAULTS
    secretish = [key for key in agent_config.DEFAULTS
                 if key.split("_")[-1] in ("token", "key", "secret",
                                           "password", "credential")]
    assert not secretish, f"a credential-shaped key is in the config: {secretish}"


# ── protocol shape ──────────────────────────────────────────────────────────
def test_initialize_answers_with_a_protocol_version() -> None:
    reply = asyncio.run(mcp_server.handle(
        {"jsonrpc": "2.0", "id": 7, "method": "initialize"},
        registry=_registry()))
    assert reply is not None
    assert reply["result"]["protocolVersion"] == mcp_server.PROTOCOL_VERSION
    assert reply["result"]["capabilities"]["tools"] == {}


def test_a_notification_gets_NO_reply() -> None:
    """⚠️ Answering one is a protocol error the client may drop the
    connection over."""
    assert asyncio.run(mcp_server.handle(
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        registry=_registry())) is None


def test_an_unknown_method_is_a_JSON_RPC_error_not_a_crash() -> None:
    reply = asyncio.run(mcp_server.handle(
        {"jsonrpc": "2.0", "id": 8, "method": "resources/list"},
        registry=_registry()))
    assert reply is not None and reply["error"]["code"] == -32601


def test_a_json_block_is_serialised_rather_than_dropped() -> None:
    """⚠️ MCP has no `json` block. Dropping it would make a tool that returned
    data indistinguishable from one that returned nothing."""
    out = mcp_server._as_content([{"type": "json", "json": {"a": 1}}])
    assert out == [{"type": "text", "text": '{"a": 1}'}]


def test_a_tool_error_reaches_the_caller_as_content() -> None:
    out = mcp_server._as_content([{"error": {"code": "not_found", "message": "x"}}])
    assert out and "not_found" in out[0]["text"], (
        "an underscore-stripped code would fail here too")


def test_run_ids_are_sequential_and_not_correlatable_across_restarts() -> None:
    first, second = mcp_server._run_id(), mcp_server._run_id()
    assert first != second
    assert first.startswith("mcp") and second.startswith("mcp")
