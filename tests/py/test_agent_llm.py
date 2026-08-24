"""The provider seam. ARCH-013: one protocol, one implementation.

⚠️ EVERY TEST HERE RUNS WITHOUT AN API KEY AND WITHOUT NETWORK. The adapter is
exercised through a fake SDK object, because a seam whose tests need a live
provider is a seam nobody runs the tests for.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import sys
from typing import Any, Dict, List, Mapping

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from agent.llm import anthropic_sdk, base  # noqa: E402


def _run(coro: Any) -> Any:
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


# ── the cache breakpoint ───────────────────────────────────────────────────

def test_the_breakpoint_sits_on_the_STABLE_block_only() -> None:
    """⚠️ Caching matches an exact prefix. One interpolated timestamp above the
    breakpoint means it never hits — and the failure is silent: the bill goes
    up and the output looks perfect."""
    blocks = base.system_blocks("stable villa profile", "fresh period delta")
    assert len(blocks) == 2
    assert blocks[0]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in blocks[1]
    assert blocks[0]["text"] == "stable villa profile"


def test_the_fresh_half_is_a_SEPARATE_block_not_appended() -> None:
    """Appending would move the breakpoint's content on every call — the same
    failure wearing a different hat."""
    a = base.system_blocks("profile", "delta one")
    b = base.system_blocks("profile", "delta two")
    assert a[0] == b[0], "the cached block must be byte-identical across calls"
    assert a[1] != b[1]


def test_no_fresh_half_means_one_block() -> None:
    assert len(base.system_blocks("profile")) == 1


# ── declining vs failing ───────────────────────────────────────────────────

def test_no_api_key_DECLINES_rather_than_raising() -> None:
    out = _run(anthropic_sdk.AnthropicProvider("").run(
        system=[], messages=[], tools=[], model="claude-opus-5"))
    assert out.declined and "API key" in out.declined
    assert out.text == "" and not out.wants_tools


def test_no_model_is_REFUSED_not_defaulted() -> None:
    """⚠️ A default here would be a model literal in code, which ADR-016 exists
    to prevent — and the villa would silently run on a model nobody chose."""
    out = _run(anthropic_sdk.AnthropicProvider("k").run(
        system=[], messages=[], tools=[], model=""))
    assert "no model configured" in out.declined


def test_configured_is_separate_from_holding_the_key() -> None:
    """So a diagnostic can ask whether a provider is usable without putting the
    credential on the caller's stack — the split `secrets.py` makes."""
    assert anthropic_sdk.AnthropicProvider("k").configured() is True
    assert anthropic_sdk.AnthropicProvider("").configured() is False


# ── flattening a reply ─────────────────────────────────────────────────────

class _Block:
    def __init__(self, **kw: Any) -> None:
        self.__dict__.update(kw)


class _Reply:
    def __init__(self, content: List[Any], stop_reason: str = "end_turn",
                 usage: Any = None) -> None:
        self.content, self.stop_reason, self.usage = content, stop_reason, usage


def test_text_and_tool_calls_are_both_flattened() -> None:
    reply = _Reply([
        _Block(type="text", text="The pool pump "),
        _Block(type="text", text="looks unusual."),
        _Block(type="tool_use", id="tu_1", name="read_salient",
               input={"limit": 5}),
    ])
    turn = anthropic_sdk._turn_of(reply)
    assert turn.text == "The pool pump looks unusual."
    assert turn.wants_tools and turn.tool_calls[0].name == "read_salient"
    assert turn.tool_calls[0].args == {"limit": 5}


def test_an_EMPTY_answer_declines_rather_than_reporting_success() -> None:
    """⚠️ THE NARRATION LAYER PAID FOR THIS ONCE: `"   \\n  "` is truthy and
    pure markup flattens to nothing, so it reported success, spent the budget
    and logged "narrated by" while the pipeline quietly declined the string.
    The FLATTENED text decides."""
    for empty in ("", "   \n  ", "\t\n"):
        turn = anthropic_sdk._turn_of(_Reply([_Block(type="text", text=empty)]))
        assert turn.declined, f"{empty!r} must not read as an answer"


def test_a_tool_call_with_no_text_is_NOT_empty() -> None:
    """A model that only asked for a tool has answered perfectly well."""
    turn = anthropic_sdk._turn_of(_Reply([
        _Block(type="tool_use", id="t", name="read_villa", input={})]))
    assert not turn.declined and turn.wants_tools


def test_usage_is_reported_including_the_cache_counters() -> None:
    """⚠️ Reported, not trusted for billing — `budget.py` counts REQUESTS. These
    exist so a human can notice a cached prefix that stopped being cached."""
    turn = anthropic_sdk._turn_of(_Reply(
        [_Block(type="text", text="x")],
        usage=_Block(input_tokens=100, output_tokens=20,
                     cache_read_input_tokens=6000,
                     cache_creation_input_tokens=0)))
    assert turn.usage["cache_read_input_tokens"] == 6000
    assert turn.usage["input_tokens"] == 100


def test_a_malformed_reply_does_not_raise() -> None:
    for junk in (_Reply([]), _Reply([_Block(type="unknown")]),
                 _Block(content=None)):
        anthropic_sdk._turn_of(junk)


# ── the adapter does not act ───────────────────────────────────────────────

def test_the_adapter_executes_no_tool_and_imports_no_policy() -> None:
    """⚠️ It reports what the model ASKED for and stops. Running it is the
    registry's job and permitting it is policy.py's — keeping those apart is
    what makes a provider swap a quality decision, never an authority one. The
    SDK's own tool runner is not used for exactly this reason: it loops and
    executes, and the loop is where the gate belongs."""
    source = inspect.getsource(anthropic_sdk)
    for forbidden in ("from agent import policy", "import policy",
                      "tool_runner", "policy.may_act", "budget.spend"):
        assert forbidden not in source, (
            f"{forbidden!r} in the adapter — it must carry no authority")


def test_base_imports_nothing_third_party() -> None:
    """The protocol must be readable without the SDK installed."""
    import ast
    tree = ast.parse(inspect.getsource(base))
    names: List[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names.append(node.module or "")
    assert all(n.split(".")[0] in ("__future__", "dataclasses", "typing")
               for n in names), names


def test_the_SDK_import_is_DEFERRED_not_module_level() -> None:
    """⚠️ `agent/` is imported by the proxy at start-up. A module-level SDK
    import would take the whole add-on down — the 3D kiosk included — because a
    pip package was missing on a half-built image."""
    import ast
    tree = ast.parse(inspect.getsource(anthropic_sdk))
    for node in ast.iter_child_nodes(tree):          # module level only
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            mods = ([a.name for a in node.names] if isinstance(node, ast.Import)
                    else [node.module or ""])
            assert not any("anthropic" in m for m in mods), (
                "the SDK import must be inside the function that needs it")


# ── the table ──────────────────────────────────────────────────────────────

def test_the_default_provider_is_DERIVED_from_the_table() -> None:
    """⚠️ A table, not a branch, and a derived default — the shape
    `providers.ADAPTERS` establishes, so a second adapter cannot leave a stale
    default behind."""
    assert anthropic_sdk.DEFAULT_PROVIDER in anthropic_sdk.ADAPTERS
    assert anthropic_sdk.DEFAULT_PROVIDER == next(iter(anthropic_sdk.ADAPTERS))


def test_an_unknown_provider_name_returns_None_rather_than_raising() -> None:
    assert anthropic_sdk.build("nope") is None
    assert anthropic_sdk.build() is not None


def test_the_adapter_DECLARES_its_host_so_the_CI_grep_has_a_source() -> None:
    """⚠️ THE OTHER HALF OF THE HOSTNAME RULE, AND IT WAS MISSING. The narration
    test derives the host list from the adapter sources and asserts it is absent
    from `src/`. Emptying `API_HOST` here survived mutation testing, because the
    OTHER adapter still supplied a host and the absence check still passed —
    so the derivation would have silently stopped covering this file.

    The string is not used to build a request; the SDK does that. It is declared
    so the check has something to find."""
    assert anthropic_sdk.API_HOST.startswith("https://"), (
        "the adapter must declare its provider host, or the CI grep that keeps "
        "it out of the browser bundle has nothing to derive from this file")
    assert "anthropic.com" in anthropic_sdk.API_HOST


def test_a_provider_error_is_REDACTED_before_it_is_logged_or_returned() -> None:
    """⚠️ AN HTTP CLIENT THAT FAILS MID-REQUEST ECHOES THE REQUEST — `x-api-key`
    included — into the exception, and `swallow` writes exactly that down.
    `reports/secrets.redact` exists for this; nothing here reimplements it.

    Nothing covered this path, and removing the redaction survived mutation
    testing."""
    import types
    secret = "sk-ant-api03-THIS-IS-THE-KEY"

    class _Messages:
        async def create(self, **_kw: Any) -> Any:
            raise RuntimeError(
                f"400 Bad Request: headers={{'x-api-key': '{secret}'}}")

    class _Client:
        def __init__(self, **_kw: Any) -> None:
            self.messages = _Messages()

    fake = types.ModuleType("anthropic")
    fake.AsyncAnthropic = _Client          # type: ignore[attr-defined]
    sys.modules["anthropic"] = fake
    try:
        turn = _run(anthropic_sdk.AnthropicProvider(secret).run(
            system=[], messages=[], tools=[], model="claude-opus-5"))
    finally:
        sys.modules.pop("anthropic", None)

    assert turn.declined, "a failed call declines rather than raising"
    assert secret not in turn.declined, (
        "the API key reached the returned message — and from there the log")


def test_there_is_exactly_ONE_adapter() -> None:
    """⚠️ ARCH-013. One seam, one implementation — building the generalisation
    against a single example is how an abstraction acquires the shape of its
    only implementation and then fits nothing else."""
    assert len(anthropic_sdk.ADAPTERS) == 1


def _capture_request(tools: Any) -> Dict[str, Any]:
    """Run the adapter against a fake SDK and return the request it built."""
    import types

    seen: Dict[str, Any] = {}

    class _Messages:
        async def create(self, **kw: Any) -> Any:
            seen.update(kw)
            return types.SimpleNamespace(
                content=[types.SimpleNamespace(type="text", text="ok")],
                usage=None, stop_reason="end_turn")

    class _Client:
        def __init__(self, **_kw: Any) -> None:
            self.messages = _Messages()

    fake = types.ModuleType("anthropic")
    fake.AsyncAnthropic = _Client          # type: ignore[attr-defined]
    sys.modules["anthropic"] = fake
    try:
        _run(anthropic_sdk.AnthropicProvider("k").run(
            system=[], messages=[], tools=tools, model="claude-opus-5"))
    finally:
        sys.modules.pop("anthropic", None)
    return seen


def _capture_request_messages(messages: Any) -> Dict[str, Any]:
    """`_capture_request`, driving the MESSAGES half instead of the tools."""
    import types

    seen: Dict[str, Any] = {}

    class _Messages:
        async def create(self, **kw: Any) -> Any:
            seen.update(kw)
            return types.SimpleNamespace(
                content=[types.SimpleNamespace(type="text", text="ok")],
                usage=None, stop_reason="end_turn")

    class _Client:
        def __init__(self, **_kw: Any) -> None:
            self.messages = _Messages()

    fake = types.ModuleType("anthropic")
    fake.AsyncAnthropic = _Client          # type: ignore[attr-defined]
    sys.modules["anthropic"] = fake
    try:
        _run(anthropic_sdk.AnthropicProvider("k").run(
            system=[], messages=messages, tools=[], model="claude-opus-5"))
    finally:
        sys.modules.pop("anthropic", None)
    return seen


def test_a_tool_is_sent_as_input_schema_not_inputSchema() -> None:
    """⚠️ THE REGISTRY PUBLISHES MCP'S SHAPE; THIS API WANTS ITS OWN.

    `agent/tools/base.py` emits `inputSchema` on purpose — that is what MCP
    publishes and what makes the extraction seam free (ADR-006). The Messages
    API spells it `input_schema`. The registry's dict was passed straight
    through, so the villa answered nothing and the API said
    `tools.0.custom.input_schema: Field required`. Found on the real property,
    on the first call that ever reached Anthropic with a tool attached.

    ⚠️ NOTHING CAUGHT IT BECAUSE THE FAKE PROVIDER DOES NOT VALIDATE THE WIRE.
    It stands in for the LOOP, which is the right scope for it — this is the
    test that stands in for the API.
    """
    from agent.registry import build_registry

    published = {t["name"]: t for t in build_registry().describe()}
    request = _capture_request(list(published.values()))
    assert request["tools"], "no tools reached the request"
    for tool in request["tools"]:
        assert "input_schema" in tool, f"{tool.get('name')} has no input_schema"
        assert "inputSchema" not in tool, (
            f"{tool.get('name')} still carries MCP's camelCase spelling; this "
            f"provider rejects unknown tool fields rather than ignoring them")
        assert set(tool) == {"name", "description", "input_schema"}
        # ⚠️ THE CONTENT, NOT ONLY THE KEY. Asserting `isinstance(dict)` let a
        # mutation survive that renamed nothing and simply DROPPED the schema —
        # every tool would have been sent an empty one, telling the model each
        # takes no arguments, with no 400 and nothing on screen to show for it.
        assert tool["input_schema"] == published[tool["name"]]["inputSchema"], (
            f"{tool['name']}'s schema was not carried across")
    assert any(t["input_schema"].get("properties")
               for t in request["tools"]), (
        "every schema is empty; the comparison above is vacuous")


def test_a_tool_with_no_schema_still_sends_a_valid_one() -> None:
    """⚠️ `input_schema` is REQUIRED, so an absent one must become an empty
    object rather than being omitted — omitting it is the 400 this fixes."""
    request = _capture_request([{"name": "x", "description": "y"}])
    assert request["tools"][0]["input_schema"] == {"type": "object",
                                                   "properties": {}}


def test_no_tools_means_the_field_is_ABSENT_not_empty() -> None:
    """An empty `tools` list is not the same as no tools; the API treats a
    present-but-empty list as a tool-using request."""
    assert "tools" not in _capture_request([])


def test_a_tool_result_carrying_JSON_is_flattened_to_text() -> None:
    """⚠️ THE API HAS NO `json` CONTENT BLOCK.

    Measured on the real villa, three turns into a real conversation with the
    tools already run: `messages.3.content.0.tool_result.content.1: Input tag
    'json' found using 'type' does not match any of the expected tags`. The
    reduction existed — for MCP, written when the MCP server was built — and the
    provider path simply never got it.
    """
    from agent.tools.base import data, fail, text as text_block

    request = _capture_request_messages([{
        "role": "user",
        "content": [{"type": "tool_result", "tool_use_id": "t1",
                     "content": [text_block("here"), data({"w": 340})]}],
    }])
    blocks = request["messages"][0]["content"][0]["content"]
    assert [b["type"] for b in blocks] == ["text", "text"]
    assert "340" in blocks[1]["text"], (
        "the payload was dropped, so a tool that returned data looks like one "
        "that returned nothing")


def test_a_tool_ERROR_is_flattened_too() -> None:
    """⚠️ `fail()` RETURNS AN OBJECT WITH NO `type` AT ALL, so it is rejected
    for a different reason than `json` is — and it was the next 400 queued
    behind that one, unreached only because no tool had failed yet."""
    from agent.tools.base import fail

    request = _capture_request_messages([{
        "role": "user",
        "content": [{"type": "tool_result", "tool_use_id": "t1",
                     "content": [fail("not_found", "no such device")]}],
    }])
    blocks = request["messages"][0]["content"][0]["content"]
    assert blocks and blocks[0]["type"] == "text"
    assert "not_found" in blocks[0]["text"]


def test_text_and_tool_use_blocks_are_NOT_rewritten() -> None:
    """⚠️ A TRANSLATION, NOT A FILTER. The transcript is what the model reads
    back on every later turn; an adapter that rewrites blocks it does not need
    to becomes a second author of it."""
    original = [{"type": "text", "text": "thinking"},
                {"type": "tool_use", "id": "t1", "name": "read_villa",
                 "input": {"window": "12h"}}]
    request = _capture_request_messages([{"role": "assistant",
                                          "content": original}])
    assert request["messages"][0]["content"] == original


def test_a_message_with_plain_string_content_survives() -> None:
    request = _capture_request_messages([{"role": "user", "content": "hello"}])
    assert request["messages"][0] == {"role": "user", "content": "hello"}


def test_the_flattener_has_exactly_one_implementation() -> None:
    """⚠️ IT WAS WRITTEN TWICE-MINUS-ONE: once for MCP, not at all for the
    provider, which is precisely how the provider path shipped broken. Both
    wires need the same reduction, so it lives in the module that owns the
    block vocabulary and both callers delegate."""
    import inspect

    from agent import mcp_server
    from agent.tools import base as tools_base

    assert "flatten_blocks" in inspect.getsource(mcp_server._as_content)
    for name in ("mcp_server", "anthropic_sdk"):
        module = (mcp_server if name == "mcp_server" else anthropic_sdk)
        source = inspect.getsource(module)
        assert 'json.dumps(block.get("json")' not in source, (
            f"{name} re-implements the reduction instead of delegating")
    assert callable(tools_base.flatten_blocks)


def test_the_SYSTEM_PROMPT_is_cache_marked_so_a_tool_loop_is_not_paid_for_twice() -> None:
    """⚠️ THE VILLA DOCUMENT IS RE-SENT ON EVERY TURN, and a tool-using answer
    is four or five turns. Measured on the reference villa while TESTING: 28
    requests, 313,736 input tokens, $1.78 — ~11,000 tokens of the same document,
    re-billed at full price, again and again.

    A cache breakpoint on the last system block covers the whole prefix, so
    every repeat send becomes a cache READ. This is the single largest cost
    lever in the subsystem and it is invisible in behaviour, which is why it
    needs a test rather than a reviewer.
    """
    from agent.llm import anthropic_sdk

    out = anthropic_sdk._cached([{"type": "text", "text": "a"},
                                 {"type": "text", "text": "b"}])
    assert out[-1].get("cache_control") == {"type": "ephemeral"}, (
        "the system prompt carries no cache breakpoint — every turn of every "
        "conversation re-pays for the whole Villa Document")
    assert "cache_control" not in out[0], (
        "a breakpoint on every block spends the provider's limited budget on a "
        "prefix that is already contiguous")

    # ⚠️ AND THE REQUEST MUST ACTUALLY USE IT. Testing `_cached` alone left a
    # mutation that deleted the call from the request body ALIVE — the helper
    # stayed correct and nobody called it, which is the defect shape this
    # project has now paid for four times (the shipped playbooks nothing
    # loaded, the review queue with no surface, the shadow diff with no
    # caller, `/agent-run-now` with no button).
    import inspect
    import re

    source = re.sub(r"#[^\n]*", "", inspect.getsource(anthropic_sdk))
    assert re.search(r'"system":\s*_cached\(', source), (
        "the request builds its system block without the cache breakpoint — "
        "`_cached` is correct and unreachable")


def test_a_callers_OWN_cache_boundary_is_left_alone() -> None:
    """A caller that has thought about its own boundaries knows more than this
    function does."""
    from agent.llm import anthropic_sdk

    mine = {"type": "text", "text": "a", "cache_control": {"type": "persistent"}}
    assert anthropic_sdk._cached([mine])[-1]["cache_control"] == {"type": "persistent"}


def test_CHAT_does_not_default_to_the_frontier_model() -> None:
    """⚠️ IT DID, AND THE BILL SAID SO: every question typed at the villa was
    answered by `model_reason`, which defaults to the most expensive model in
    the table. 100% of one afternoon's testing spend, on opus, for questions a
    mid-tier model answers."""
    from agent import config as agent_config

    view = agent_config.view({})
    assert view.get("model_chat"), "chat has no tier of its own again"
    assert "opus" not in str(view.get("model_chat")), (
        "chat defaults to the frontier model — the single most expensive "
        "default in this add-on, on its most frequent request")


def test_an_EMPTY_end_turn_is_a_FINISHED_run_not_a_failure() -> None:
    """⚠️ "I HAVE NOTHING MORE TO SAY" IS NOT "I FAILED". A model that answered
    through the `reply` tool, got "Sent." back and had nothing to add returns
    `end_turn` with an empty content array. Read as a decline it declined the
    whole run, and chat then apologised on top of a correct answer."""
    turn = anthropic_sdk._turn_of(_Reply([], stop_reason="end_turn"))
    assert not turn.declined, turn.declined
    assert not turn.text and not turn.wants_tools


def test_an_empty_reply_that_was_CUT_OFF_still_declines() -> None:
    """The discrimination is the stop reason, not the emptiness. `max_tokens`
    with no blocks is an answer that never arrived."""
    for why in ("max_tokens", "refusal", ""):
        turn = anthropic_sdk._turn_of(_Reply([], stop_reason=why))
        assert turn.declined, f"stop_reason={why!r} must still decline"


def test_blocks_that_FLATTEN_to_nothing_still_decline() -> None:
    """⚠️ EMPTY MEANS NO BLOCKS AT ALL. A whitespace text block and a reply of
    pure `thinking` are failures to answer — the model tried to speak and
    produced nothing — and only an empty array says it deliberately did not."""
    assert anthropic_sdk._turn_of(
        _Reply([_Block(type="text", text="  \n ")], "end_turn")).declined
    assert anthropic_sdk._turn_of(
        _Reply([_Block(type="thinking")], "end_turn")).declined


# ── two cache breakpoints: the stable half must outlive the volatile one ─────
def test_the_STABLE_half_is_cached_SEPARATELY_from_the_villa_document() -> None:
    """⚠️ ONE BREAKPOINT MEANT THE DOCUMENT INVALIDATED THE TOOL SCHEMAS. The
    villa document is rebuilt from the journal, which gains rows every few
    minutes, so two conversations ninety seconds apart had different documents
    and the WHOLE prefix — every upstream tool schema included — was re-written
    at 1.25x. Measured: one chat request billed $0.2586 for 157 output tokens,
    and 13 such writes were 38% of a morning's spend."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))), "rootfs", "usr", "bin"))
    from agent import playbooks

    blocks = anthropic_sdk._cached(
        playbooks.system_blocks("owner", instructions="I", document="D"))
    marked = [i for i, b in enumerate(blocks) if b.get("cache_control")]
    assert len(marked) == 2, (
        f"expected a stable and a volatile breakpoint, got {marked}")
    # ⚠️ THE ORDER IS THE CONTRACT: a breakpoint covers everything BEFORE it, so
    # the stable one must sit before the document or it caches nothing extra.
    assert blocks[marked[0]]["text"] == "I"
    assert blocks[marked[1]]["text"] == "D"


def test_a_changed_DOCUMENT_leaves_the_stable_prefix_byte_identical() -> None:
    """The property that makes the split worth anything: the blocks before the
    volatile one must not move when the villa document changes."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))), "rootfs", "usr", "bin"))
    from agent import playbooks

    a = anthropic_sdk._cached(playbooks.system_blocks(
        "owner", instructions="I", document="MONDAY"))
    b = anthropic_sdk._cached(playbooks.system_blocks(
        "owner", instructions="I", document="TUESDAY -- longer, more rows"))
    assert a[:-1] == b[:-1], (
        "the document changed and the cached stable prefix moved with it")
    assert a[-1] != b[-1]


def test_cached_is_ADDITIVE_and_never_overwrites_a_callers_breakpoint() -> None:
    """⚠️ THE WHOLE SPLIT RIDES ON THIS. `system_blocks` marks the stable
    boundary and `_cached` adds the final one; if it overwrote instead, there
    would be one breakpoint again and the fix would silently do nothing."""
    given = [{"type": "text", "text": "s", "cache_control": {"type": "custom"}},
             {"type": "text", "text": "d"}]
    out = anthropic_sdk._cached(given)
    assert out[0]["cache_control"] == {"type": "custom"}
    assert out[1]["cache_control"] == {"type": "ephemeral"}
