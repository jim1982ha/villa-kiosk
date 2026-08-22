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
