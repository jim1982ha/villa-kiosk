"""Home Assistant's MCP server, through this registry. TASK-113/114, ADR-023.

⚠️ THE GATE UNDER TEST IS NOT A NEW ONE, AND THAT IS THE FINDING. `policy` has
had a three-valued mode vocabulary since 2.623.0 and already denies an unknown
mode with "a tool whose mode nobody has classified is a tool nobody has
reviewed". So an unannotated upstream tool fails closed through machinery that
was already written and already tested; the work here is classifying correctly
and proving the classification reaches that gate.
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

from agent import contracts, policy as policy_mod, upstream   # noqa: E402

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

READ_TOOL = {"name": "ha_search", "description": "find entities",
             "inputSchema": {"type": "object", "properties": {}},
             "annotations": {"readOnlyHint": True}}
ACT_TOOL = {"name": "ha_call_service", "description": "call a service",
            "inputSchema": {"type": "object", "properties": {}},
            "annotations": {"readOnlyHint": False}}
BARE_TOOL = {"name": "ha_something_new", "description": "who knows",
             "inputSchema": {"type": "object", "properties": {}}}


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(upstream, "CATALOGUE_FILE", str(tmp_path / "u.json"))


def _store(tools: List[Dict[str, Any]], url: str = "http://x:9583/s") -> None:
    from reports import store
    store.write_json(upstream.CATALOGUE_FILE,
                     {"at": 1.0, "url": url, "tools": tools})


# ── the gate ────────────────────────────────────────────────────────────────
def test_an_UNANNOTATED_tool_gets_a_mode_the_policy_refuses() -> None:
    """⚠️ FAIL CLOSED, THROUGH THE EXISTING BRANCH. A future ha_mcp release
    adding a destructive tool must be unreachable until somebody classifies it —
    RISK-036 — and the way to get that without a second gate is to return a mode
    `TOOL_MODE` does not contain, which `may_use_tool` already denies."""
    assert upstream.mode_of(BARE_TOOL) not in contracts.TOOL_MODE
    policy = policy_mod.for_run({"act_enabled": True}, tier="reason",
                                tool_names=["ha_something_new"])
    verdict = policy_mod.may_use_tool(policy, "ha_something_new",
                                      upstream.mode_of(BARE_TOOL))
    assert verdict.verdict == "deny", verdict.reason


def test_a_WRITE_tool_is_refused_while_the_villa_is_watch_only() -> None:
    """The owner's requirement: VESTA may not change an entity state until
    somebody opens the gate. `act_enabled` ships false."""
    policy = policy_mod.for_run({"act_enabled": False}, tier="reason",
                                tool_names=["ha_call_service"])
    assert policy_mod.may_use_tool(
        policy, "ha_call_service", upstream.mode_of(ACT_TOOL)).verdict == "deny"


def test_the_same_tool_is_allowed_once_the_gate_is_OPEN() -> None:
    """⚠️ FUTURE-PROOFING IS A REQUIREMENT, NOT A COURTESY. The setting exists so
    actuation can be turned on later without a second architecture; a gate that
    could not open would have been a deletion wearing a switch."""
    policy = policy_mod.for_run({"act_enabled": True}, tier="reason",
                                tool_names=["ha_call_service"])
    assert policy_mod.may_use_tool(
        policy, "ha_call_service", upstream.mode_of(ACT_TOOL)).verdict == "allow"


def test_a_READ_tool_is_allowed_in_watch_only() -> None:
    """Otherwise the integration is pointless: reading is the whole purpose."""
    policy = policy_mod.for_run({"act_enabled": False}, tier="reason",
                                tool_names=["ha_search"])
    assert policy_mod.may_use_tool(
        policy, "ha_search", upstream.mode_of(READ_TOOL)).verdict == "allow"


# ── the catalogue ───────────────────────────────────────────────────────────
def test_the_upstream_schema_travels_VERBATIM() -> None:
    """⚠️ PARAPHRASING AN INPUT SCHEMA IS HOW A MODEL IS TOLD THE WRONG ARGUMENT
    NAMES, and the upstream owns that contract, not us."""
    schema = {"type": "object", "properties": {"area_filter": {"type": "string"}},
              "required": ["area_filter"]}
    _store([{**READ_TOOL, "inputSchema": schema}])
    tool = upstream.tools_for(lambda: None)[0]
    assert tool.inputSchema == schema
    assert tool.name == "ha_search"


def test_NO_catalogue_means_no_upstream_tools_not_an_error() -> None:
    """An install with no ha_mcp is a supported state and the commonest one on a
    fresh clone. It keeps every tool it had — REQ-067."""
    assert upstream.tools_for(lambda: None) == []
    assert upstream.catalogue() == {}


def test_an_EMPTY_tool_list_is_never_recorded(monkeypatch: pytest.MonkeyPatch) -> None:
    """Recording it would publish "Home Assistant offers no tools", and the
    fallback readers would look like a choice rather than a failure."""
    async def _endpoint(session: Any) -> str:
        return "http://x:9583/s"

    async def _rpc(*a: Any, **kw: Any) -> Dict[str, Any]:
        return {"tools": []}

    monkeypatch.setattr(upstream, "endpoint", _endpoint)
    monkeypatch.setattr(upstream, "rpc", _rpc)
    assert asyncio.run(upstream.refresh(object(), now=1e12)) is False
    assert upstream.catalogue() == {}


def test_a_FAILED_read_leaves_the_previous_catalogue(monkeypatch: pytest.MonkeyPatch) -> None:
    """Same rule as the capability survey and the layout: a restarting add-on
    must not strip the agent of every Home Assistant tool it had."""
    _store([READ_TOOL])

    async def _endpoint(session: Any) -> str:
        return ""

    monkeypatch.setattr(upstream, "endpoint", _endpoint)
    assert asyncio.run(upstream.refresh(object(), now=1e12)) is False
    assert len(upstream.catalogue()["tools"]) == 1


# ── the wire ────────────────────────────────────────────────────────────────
def test_an_SSE_framed_reply_is_decoded_like_a_json_one() -> None:
    """⚠️ STREAMABLE HTTP MAY ANSWER EITHER WAY TO THE SAME REQUEST, and handling
    only JSON is the trap. Both forms carry the same result object."""
    assert upstream._decode('{"result":{"tools":[]}}')["result"] == {"tools": []}
    framed = 'event: message\ndata: {"result":{"tools":[1]}}\n\n'
    assert upstream._decode(framed)["result"] == {"tools": [1]}
    assert upstream._decode("not json at all") is None


def test_structured_content_is_preferred_over_prose() -> None:
    """⚠️ IT FITS MORE ANSWER INSIDE `truncate`'s 8,000 characters. The text
    blocks are usually the same answer pretty-printed at greater length, and a
    wide history is exactly where the cut bites."""
    out = upstream._flatten({"structuredContent": {"count": 2},
                             "content": [{"type": "text", "text": "x" * 500}]})
    assert out == '{"count":2}'


def test_the_endpoint_is_the_SECRET_PATH_with_no_suffix() -> None:
    """⚠️ READ FROM THE ADD-ON'S OWN STARTUP LINE, NOT GUESSED. FastMCP reports
    `transport 'http' (stateless) on http://0.0.0.0:9583/private_<...>` — the
    secret path IS the endpoint. A guessed `/mcp` suffix would have 404'd."""
    import inspect
    src = inspect.getsource(upstream.endpoint)
    assert '{secret}' in src and '/mcp"' not in src


def test_no_install_specific_slug_is_hardcoded() -> None:
    """⚠️ THE SLUG CARRIES A REPOSITORY HASH AND DIFFERS PER INSTALL, so a
    literal would be villa-specific data in shipped source — hard rule #1."""
    import inspect
    src = inspect.getsource(upstream)
    assert upstream.SLUG_SUFFIX == "_ha_mcp"
    assert "81f33d0f" not in src


def test_the_scheduler_REFRESHES_the_catalogue() -> None:
    """⚠️ `feedback_pin-the-caller`, fourth release running. A catalogue nothing
    refreshes is a registry with no Home Assistant tools in it, for ever."""
    src = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent",
                            "scheduler.py"), encoding="utf-8").read()
    code = "\n".join(l for l in src.splitlines()
                     if not l.strip().startswith("#"))
    assert "upstream_mod.refresh(" in code


def test_the_registry_FOLDS_THEM_IN_rather_than_beside() -> None:
    """One registry, two backends, one gate (ARCH-012). A parallel surface is a
    second tool path beside the audited one."""
    src = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent",
                            "registry.py"), encoding="utf-8").read()
    code = "\n".join(l for l in src.splitlines()
                     if not l.strip().startswith("#"))
    assert "upstream.tools_for(" in code


# ── classification against the REAL upstream (ha-mcp 8.3.0, 78 tools) ────────
# ⚠️ THESE SHAPES ARE COPIED FROM A LIVE `tools/list`, NOT INVENTED. The first
# classifier read only `readOnlyHint` and the live server does not set it on the
# write surface at all: 41 of 78 tools declare `destructiveHint: True` and omit
# it. They were therefore UNCLASSIFIED — denied, which is the right outcome
# while the gate is shut and the WRONG REASON, because an unclassified tool
# stays denied after an owner opens it. A fixture invented from the MCP spec
# would have agreed with the code and shipped a switch that did nothing.

DESTRUCTIVE_NO_READONLY = {
    "name": "ha_call_service", "description": "call a service",
    "inputSchema": {"type": "object", "properties": {}},
    "annotations": {"title": "Call Service", "destructiveHint": True,
                    "idempotentHint": False, "openWorldHint": True}}
SILENT = {"name": "ha_future_tool", "description": "?",
          "inputSchema": {"type": "object", "properties": {}},
          "annotations": {"title": "Future", "openWorldHint": True}}


def test_destructiveHint_alone_is_ACT_not_unclassified() -> None:
    """⚠️ 41 OF THE LIVE SERVER'S 78 TOOLS ARE THIS SHAPE. Classifying them as
    unclassified denies them for a reason the owner's switch cannot override."""
    assert upstream.mode_of(DESTRUCTIVE_NO_READONLY) == "ACT"

    shut = policy_mod.for_run({"act_enabled": False}, tier="reason",
                              tool_names=["ha_call_service"])
    assert policy_mod.may_use_tool(shut, "ha_call_service", "ACT").verdict == "deny"
    # ⚠️ AND THE SWITCH ACTUALLY WORKS, which is what the old classification
    # silently broke.
    open_ = policy_mod.for_run({"act_enabled": True}, tier="reason",
                               tool_names=["ha_call_service"])
    assert policy_mod.may_use_tool(open_, "ha_call_service", "ACT").verdict == "allow"


def test_a_tool_that_declares_NOTHING_is_still_withheld() -> None:
    """⚠️ UNREACHABLE AGAINST TODAY'S UPSTREAM — zero of the 78 are silent — and
    that is exactly why it stays. It is the control for the release that adds
    one (RISK-036), not for the release in front of us."""
    assert upstream.mode_of(SILENT) not in contracts.TOOL_MODE
    open_ = policy_mod.for_run({"act_enabled": True}, tier="reason",
                               tool_names=["ha_future_tool"])
    assert policy_mod.may_use_tool(
        open_, "ha_future_tool", upstream.mode_of(SILENT)).verdict == "deny"


def test_the_tools_our_questions_need_are_READABLE() -> None:
    """Verified against the live server: every one of these is readOnlyHint
    true, so watch-only does not block the thing the integration is for."""
    for name in ("ha_search", "ha_get_history", "ha_get_state",
                 "ha_list_floors_areas", "ha_get_automation_traces"):
        spec = {"name": name, "description": "", "inputSchema": {},
                "annotations": {"readOnlyHint": True, "idempotentHint": True}}
        assert upstream.mode_of(spec) == "READ", name


def test_every_proxy_helper_the_SCHEDULER_calls_actually_runs() -> None:
    """⚠️ THE TRIAGE CLOCK CRASHED ON EVERY PASS FROM v2.643.0 TO v2.707.0.
    `_agent_config_now` referenced `agent_config` as a module-level name while
    the file only ever imports it INSIDE other functions, so every call raised
    `NameError` inside `scheduler.run_forever` — for sixty releases.

    ⚠️ NOTHING CAUGHT IT BECAUSE NOTHING LOOKED. The loop is a background task,
    `run_forever` catches everything so the add-on stayed healthy, and a clock
    that never ticks is indistinguishable from a villa with nothing to report:
    no passes, no findings, no spend. Every instrument agreed with every other
    one, and all of them were describing a subsystem that had never run.

    Import-checking the whole proxy here is not possible (it needs aiohttp and a
    Supervisor token), so this asserts the narrower property that failed: a
    name used in a function body is either imported in that body, imported at
    module scope, or defined in the file.
    """
    import ast

    path = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")
    tree = ast.parse(open(path, encoding="utf-8").read())

    module_names = set()
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                module_names.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            module_names.add(node.name)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    module_names.add(t.id)

    #: The agent/reports packages, which are the ones imported function-locally
    #: and therefore the ones that can be referenced without being in scope.
    #: ⚠️ NOT `upstream` — it is a local variable name in this file's websocket
    #: relay (`to_upstream`, `to_client`), and including it reported three
    #: false hits. A checker that cries wolf gets muted, which is how the real
    #: one would have been skipped over.
    watched = {"agent_config", "agent_concerns", "agent_sources"}
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        local = {a.asname or a.name.split(".")[0]
                 for n in ast.walk(node)
                 if isinstance(n, (ast.Import, ast.ImportFrom))
                 for a in n.names}
        # Parameters and assignments are local names too, not missing imports.
        local |= {a.arg for a in node.args.args + node.args.kwonlyargs}
        local |= {t.id for n in ast.walk(node) if isinstance(n, ast.Assign)
                  for t in n.targets if isinstance(t, ast.Name)}
        for inner in ast.walk(node):
            if (isinstance(inner, ast.Name) and inner.id in watched
                    and inner.id not in local and inner.id not in module_names):
                offenders.append(f"{node.name}() uses {inner.id!r}, never imported")
    assert not offenders, (
        "these crash the moment they are called:\n  " + "\n  ".join(sorted(set(offenders))))
