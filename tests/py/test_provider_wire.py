"""Does the request we build actually satisfy the Messages API? TEST-021b.

⚠️ WRITTEN AFTER THREE CONSECUTIVE 400s FOUND ONE AT A TIME ON A REAL VILLA,
each one a malformed request discovered by sending it:

    tools.0.custom.input_schema: Field required
    messages.3.content.0.tool_result.content.1: Input tag 'json' … does not
      match any of the expected tags

Both were shape mismatches between this package's internal vocabulary and the
provider's wire, and both were invisible locally because `FakeProvider`
validates nothing — correctly, since it stands in for the LOOP, so budget
exhaustion and a raising tool can be exercised with no network. What was missing
was something standing in for the API.

⚠️ THIS FILE IS THAT. It runs the REAL loop against a provider that ASSERTS the
request is well formed, over a scripted conversation that reaches every shape
the villa actually produces: a tool call, a tool result carrying JSON, a tool
that FAILS, and a final text answer. The error branch in particular had never
been sent — it was the next 400 queued behind the one that was found, unreached
only because no tool had failed yet.

⚠️ THE RULES BELOW ARE TRANSCRIBED FROM THE PROVIDER'S OWN ERROR MESSAGES AND
DOCUMENTED SHAPE, WHICH MAKES THEM A MODEL AND NOT AN ORACLE. A green run here
does not prove the API will accept the request; it proves the request has none
of the defects that have already cost a round trip. That is worth having and it
is worth being honest about — the real proof is still a live call.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List, Mapping, Sequence

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import policy as policy_mod
from vesta.supervise.agent.llm.base import ToolCall
from vesta.supervise.agent.llm.base import Turn
from vesta.supervise.agent.registry import Registry
from vesta.supervise.agent.registry import run as run_loop
from vesta.supervise.agent.tools.base import BaseTool
from vesta.supervise.agent.tools.base import data
from vesta.supervise.agent.tools.base import fail
from vesta.supervise.agent.tools.base import text

#: What a TOOL may carry. Anything else is rejected outright by the API — it
#: does not ignore unknown fields here.
TOOL_FIELDS = {"name", "description", "input_schema"}

#: Content blocks the API accepts inside `tool_result.content`. ⚠️ `json` is
#: NOT among them and neither is an untyped object; those are this package's
#: internal kinds and must be flattened before they reach the wire.
TOOL_RESULT_BLOCKS = {"text", "image", "document", "search_result"}

#: Blocks valid in a message's own content list.
MESSAGE_BLOCKS = {"text", "image", "document", "tool_use", "tool_result",
                  "thinking", "redacted_thinking"}


def _check_block(block: Any, *, where: str, allowed: set) -> None:
    assert isinstance(block, Mapping), f"{where}: block is not an object: {block!r}"
    kind = block.get("type")
    assert isinstance(kind, str) and kind, (
        f"{where}: block has no `type` — an untyped object is rejected, which "
        f"is exactly what `fail()` produces before it is flattened: {block!r}")
    assert kind in allowed, (
        f"{where}: Input tag {kind!r} does not match any of the expected tags: "
        f"{sorted(allowed)}")
    if kind == "text":
        assert isinstance(block.get("text"), str)
    if kind == "tool_use":
        for field in ("id", "name", "input"):
            assert field in block, f"{where}: tool_use has no {field!r}"
        assert isinstance(block["input"], Mapping)


def _check_request(request: Mapping[str, Any]) -> None:
    """Every rule the provider has actually enforced against us."""
    assert isinstance(request.get("model"), str) and request["model"], (
        "no model — the adapter refuses this, but the request must never "
        "reach here without one")
    assert isinstance(request.get("max_tokens"), int) and request["max_tokens"] > 0

    for i, block in enumerate(request.get("system") or []):
        _check_block(block, where=f"system.{i}", allowed={"text"})

    for name, tool in enumerate(request.get("tools") or []):
        assert isinstance(tool, Mapping)
        extra = set(tool) - TOOL_FIELDS
        assert not extra, (
            f"tools.{name}: unexpected field(s) {sorted(extra)} — this API "
            f"rejects unknown tool fields rather than ignoring them")
        for field in TOOL_FIELDS:
            assert field in tool, f"tools.{name}.custom.{field}: Field required"
        assert isinstance(tool["input_schema"], Mapping)
        assert tool["input_schema"].get("type") == "object"

    messages = request.get("messages")
    assert isinstance(messages, list) and messages, "no messages"
    for m, message in enumerate(messages):
        assert isinstance(message, Mapping), f"messages.{m}: not an object"
        assert message.get("role") in ("user", "assistant"), (
            f"messages.{m}.role: {message.get('role')!r}")
        content = message.get("content")
        if isinstance(content, str):
            continue
        assert isinstance(content, list), f"messages.{m}.content: not a list"
        for c, block in enumerate(content):
            where = f"messages.{m}.content.{c}"
            _check_block(block, where=where, allowed=MESSAGE_BLOCKS)
            if block.get("type") != "tool_result":
                continue
            assert block.get("tool_use_id"), f"{where}.tool_use_id: required"
            inner = block.get("content")
            assert isinstance(inner, list), f"{where}.content: not a list"
            for j, sub in enumerate(inner):
                _check_block(sub, where=f"{where}.tool_result.content.{j}",
                             allowed=TOOL_RESULT_BLOCKS)


class StrictProvider:
    """A provider that checks the wire and then answers from a script.

    ⚠️ IT ASSERTS RATHER THAN DECLINING. A malformed request must fail the TEST,
    not become a graceful degradation — degrading is what the real adapter does,
    and it is why three of these reached the villa looking like "the provider
    could not be reached".
    """

    name = "strict"

    def __init__(self, script: Sequence[Turn]) -> None:
        self._script = list(script)
        self.requests: List[Dict[str, Any]] = []

    def configured(self) -> bool:
        return True

    async def run(self, *, system: Sequence[Mapping[str, Any]],
                  messages: Sequence[Mapping[str, Any]],
                  tools: Sequence[Mapping[str, Any]],
                  model: str, max_tokens: int = 2048,
                  options: Any = None) -> Turn:
        # ⚠️ BUILT THE WAY THE ADAPTER BUILDS IT, by calling the adapter's own
        # translation. Re-implementing the mapping here would test this file
        # against itself and pass while the adapter stayed broken.
        from vesta.supervise.agent.llm import anthropic_sdk

        request = {
            "model": model, "max_tokens": max_tokens,
            "system": list(system),
            "messages": [anthropic_sdk._message_wire(m) for m in messages],
        }
        if tools:
            request["tools"] = [anthropic_sdk._tool_wire(t) for t in tools]
        _check_request(request)
        self.requests.append(request)
        return self._script.pop(0) if self._script else Turn(text="done")


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch) -> None:
    """⚠️ THE LOOP PERSISTS TWO THINGS AND `/data` IS THE VILLA'S PATH — an
    audit row per tool call and the budget counter per turn. Patching only the
    audit left one test failing on a PermissionError that said nothing about
    the wire, which is the same shape as every bug in this file: the rule
    applied to the site in view rather than to everything it applies to.
    `_BREAKER` is reset because it is process-wide by design, so one test's
    failures would otherwise open it for the next."""
    from vesta.supervise.agent import audit as audit_mod
    from vesta.supervise.agent import budget as budget_mod
    monkeypatch.setattr(audit_mod, "AUDIT_FILE", str(tmp_path / "audit.json"))
    monkeypatch.setattr(budget_mod, "BUDGET_FILE", str(tmp_path / "budget.json"))
    monkeypatch.setattr(budget_mod, "_BREAKER", None)


# ── the tools the scripted conversation drives ──────────────────────────────
class Reads(BaseTool):
    name = "read_probe"
    description = "Return a reading, as a real read tool does — with a number."
    inputSchema = {"type": "object",
                   "properties": {"ref": {"type": "string"}},
                   "required": ["ref"]}
    mode = "READ"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        # ⚠️ BOTH KINDS, because both have to survive the wire: prose AND a
        # structured payload. The `json` block is what produced the second 400.
        return [text("the probe reports:"), data({"watts": 340, "ref": "d1"})]


class Breaks(BaseTool):
    name = "break_probe"
    description = "A tool whose lookup misses, returning a contract error."
    inputSchema = {"type": "object", "properties": {}}
    mode = "READ"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        # ⚠️ `fail()` HAS NO `type` FIELD AT ALL — a different rejection from
        # the `json` one, and the next 400 that was waiting behind it.
        return [fail("not_found", "no such device")]


def _registry() -> Registry:
    return Registry([Reads(), Breaks()])


def _call(name: str, ident: str) -> Turn:
    return Turn(tool_calls=(ToolCall(id=ident, name=name, args={"ref": "d1"}),))


def _run(provider: StrictProvider) -> Any:
    registry = _registry()
    policy = policy_mod.for_run({}, tier="reason",
                                tool_names=[t["name"] for t in registry.describe()])
    return asyncio.run(run_loop(
        run_id="wire1", provider=provider, registry=registry, policy=policy,
        model="claude-opus-5",
        system=[{"type": "text", "text": "You supervise a villa."}],
        messages=[{"role": "user", "content": "is the pump ok?"}]))


# ── the tests ───────────────────────────────────────────────────────────────
def test_a_whole_conversation_is_well_formed_on_every_turn() -> None:
    """⚠️ THE ONE THAT WOULD HAVE CAUGHT BOTH FIELD BUGS BEFORE THE VILLA DID.

    Four turns: a tool call, a result carrying JSON, a tool that FAILS, and an
    answer. Every request is checked, not just the first — the second 400 was at
    `messages.3`, three turns in, which a single-turn test cannot reach.
    """
    provider = StrictProvider([
        _call("read_probe", "t1"),
        _call("break_probe", "t2"),
        Turn(text="The pump drew 340 W; one device could not be found."),
    ])
    result = _run(provider)
    assert result.status == "answered"
    assert len(provider.requests) == 3, (
        f"only {len(provider.requests)} turns reached the provider; the "
        f"multi-turn shapes were never checked")


def test_the_LAST_request_carries_the_whole_transcript() -> None:
    """The API is stateless, so every turn re-sends everything before it. If the
    final request were short, the checks above would have skipped most of the
    conversation without saying so."""
    provider = StrictProvider([_call("read_probe", "t1"),
                               Turn(text="done")])
    _run(provider)
    first, last = provider.requests[0], provider.requests[-1]
    assert len(last["messages"]) > len(first["messages"])
    kinds = [b.get("type") for m in last["messages"]
             if isinstance(m.get("content"), list) for b in m["content"]]
    assert "tool_use" in kinds and "tool_result" in kinds, (
        f"the transcript never contained a tool exchange: {kinds}")


def test_a_tool_ERROR_survives_the_wire_as_readable_text() -> None:
    """⚠️ A TOOL ERROR IS DATA THE MODEL ROUTES AROUND, so it must ARRIVE. Being
    rejected by the API and being silently dropped are both failures, and the
    first is what would have happened."""
    provider = StrictProvider([_call("break_probe", "t1"), Turn(text="ok")])
    _run(provider)
    last = provider.requests[-1]
    payloads = [sub["text"] for m in last["messages"]
                if isinstance(m.get("content"), list)
                for b in m["content"] if b.get("type") == "tool_result"
                for sub in b["content"]]
    assert any("not_found" in p for p in payloads), (
        f"the error never reached the model: {payloads}")


def test_a_JSON_payload_survives_the_wire_as_readable_text() -> None:
    provider = StrictProvider([_call("read_probe", "t1"), Turn(text="ok")])
    _run(provider)
    last = provider.requests[-1]
    payloads = [sub["text"] for m in last["messages"]
                if isinstance(m.get("content"), list)
                for b in m["content"] if b.get("type") == "tool_result"
                for sub in b["content"]]
    assert any("340" in p for p in payloads), (
        f"the reading was dropped, so a tool that returned data looks like one "
        f"that returned nothing: {payloads}")


def test_every_REGISTERED_tool_passes_the_tool_rules() -> None:
    """Not the two fixtures above — the real shipped set, since a schema is
    written per tool and only one of them has to be wrong."""
    from vesta.supervise.agent.llm import anthropic_sdk
    from vesta.supervise.agent.registry import build_registry

    for published in build_registry().describe():
        wire = anthropic_sdk._tool_wire(published)
        assert set(wire) == TOOL_FIELDS
        assert wire["input_schema"].get("type") == "object", (
            f"{wire['name']}'s schema is not an object schema")
        assert wire["description"], f"{wire['name']} has no description"


def test_the_checker_actually_REJECTS_the_two_shapes_that_shipped() -> None:
    """⚠️ THE VACUOUS-PASS GUARD, AND HERE IT IS THE WHOLE POINT. A validator
    that accepts everything passes every test above while checking nothing.
    These are the two real payloads, verbatim from the villa's log."""
    # ⚠️ EITHER SPELLING IN THE MESSAGE. The checker rejects this payload on
    # the unexpected-field rule before it reaches the missing-field one, where
    # the API reported the second. Both are refusals of the same request; the
    # test asserts it is REFUSED, not which sentence explains it.
    with pytest.raises(AssertionError, match="input[_S]chema|inputSchema"):
        _check_request({"model": "m", "max_tokens": 1,
                        "messages": [{"role": "user", "content": "hi"}],
                        "tools": [{"name": "x", "description": "y",
                                   "inputSchema": {"type": "object"}}]})

    with pytest.raises(AssertionError, match="json"):
        _check_request({"model": "m", "max_tokens": 1, "messages": [
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "t1",
                 "content": [{"type": "text", "text": "a"},
                             {"type": "json", "json": {"w": 1}}]}]}]})

    with pytest.raises(AssertionError, match="no `type`"):
        _check_request({"model": "m", "max_tokens": 1, "messages": [
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "t1",
                 "content": [{"error": {"code": "not_found"}}]}]}]})
