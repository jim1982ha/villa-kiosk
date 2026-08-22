"""The tool registry, and the loop that drives it. ARCH-012.

⚠️ THIS IS THE SAME OBJECT THE MCP SERVER WILL SERVE. Not a parallel table, not
a filtered copy — the same registry, so an in-process turn and a remote MCP call
go through one gate and produce one audit row. The moment there are two
registries there are two gates, and the second one is the one nobody tests.

⚠️ THE LOOP IS HERE, NOT IN THE PROVIDER. The SDK ships a tool runner that loops
and executes; using it would put tool execution inside the adapter, where the
policy check cannot reach it without the adapter importing policy. Owning the
loop is what keeps `may_use_tool` and `may_act` on the path of every single
call, and what makes "swapping a provider is a quality decision, never an
authority one" structurally true.

⚠️ EVERY TOOL RESULT IS SCRUBBED BEFORE IT ENTERS THE TRANSCRIPT. Once untrusted
text is in the conversation it is re-sent on every later turn and there is no
taking it back — so `redact.scrub` runs on the way in, and `redact.audit` is
consulted as a second opinion. A non-empty audit means the result is replaced by
a refusal rather than sent.

⚠️ AND THE BUDGET IS SPENT ON THE CALL, NOT ON THE CHECK. A turn that was
refused before it happened costs nothing; one that reached the provider costs
one request whatever came back.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence

from agent import audit as audit_mod
from agent import budget as budget_mod
from agent import contracts, policy as policy_mod, redact
from agent.llm.base import Provider, ToolCall, Turn
from agent.tools import ALL_TOOLS
from agent.tools.base import BaseTool, fail
from reports.log import log, swallow


class Registry:
    """Every tool this deployment offers, by name. A table, not a branch."""

    def __init__(self, tools: Sequence[BaseTool]) -> None:
        self._tools: Dict[str, BaseTool] = {}
        for tool in tools:
            if tool.name in self._tools:
                # ⚠️ REFUSED, NOT OVERWRITTEN. Two tools with one name means the
                # model's mental model and ours differ about what it just
                # called, and last-one-wins makes that silent.
                raise ValueError(f"duplicate tool name: {tool.name}")
            self._tools[tool.name] = tool

    @property
    def names(self) -> Sequence[str]:
        return tuple(self._tools)

    def describe(self) -> List[Dict[str, Any]]:
        """The tool list handed to a provider — and published over MCP."""
        return [t.describe() for t in self._tools.values()]

    def get(self, name: str) -> Optional[BaseTool]:
        return self._tools.get(str(name))

    def with_tool(self, tool: BaseTool) -> "Registry":
        """A NEW registry carrying one more tool. ⚠️ NEW, NOT MUTATED.

        The chat path adds a `reply` bound to one conversation. Mutating the
        shared registry would leave that binding in place for every later run —
        including scheduled ones with no conversation at all — so the next
        brief would hold a tool pointing at whoever last sent a message.
        """
        return Registry(list(self._tools.values()) + [tool])


def build_registry(tools: Optional[Sequence[BaseTool]] = None) -> Registry:
    """The deployment's registry. ⚠️ ONE construction site, so the MCP server
    and the in-process loop cannot drift into two different tool sets."""
    return Registry(list(tools) if tools is not None
                    else [cls() for cls in ALL_TOOLS])


@dataclass
class RunResult:
    """CTR-007. What a whole run produced."""

    run_id: str
    status: str = "answered"
    text: str = ""
    turns: int = 0
    tool_calls: int = 0
    declined_reason: str = ""
    evidence: List[Dict[str, Any]] = field(default_factory=list)
    usage: Dict[str, int] = field(default_factory=dict)


async def run(*, run_id: str, provider: Provider, registry: Registry,
              policy: policy_mod.RunPolicy, model: str,
              system: Sequence[Mapping[str, Any]],
              messages: Sequence[Mapping[str, Any]],
              config: Optional[Mapping[str, Any]] = None,
              actor: str = "system", trigger: str = "scheduled",
              kind: str = "run") -> RunResult:
    """One reasoning run: turn, tools, turn, until it stops or a bound binds.

    ⚠️ EVERY BOUND IS CHECKED BEFORE THE CALL AND THE RUN DECLINES RATHER THAN
    FAILING. A spent budget, an open breaker and an exhausted turn cap are all
    correct outcomes; collapsing them into a failure would make a working system
    look broken in every count that matters and hide the one case that needs an
    engineer.
    """
    result = RunResult(run_id=run_id)
    audit_mod.record_run(run_id, actor=actor, trigger=trigger,
                         verdict="started")
    breaker = budget_mod.shared_breaker()
    convo: List[Dict[str, Any]] = [dict(m) for m in messages]

    while True:
        if breaker.is_open():
            return _decline(result, "the provider is in a cooling-off period "
                                    "after repeated failures", run_id, actor)

        bounded = policy_mod.within_budget(
            policy, turns=result.turns, tool_calls=result.tool_calls)
        if not bounded.allowed:
            return _decline(result, bounded.reason, run_id, actor)

        money = budget_mod.check(config, kind=kind)
        if not money.allowed:
            return _decline(result, money.reason, run_id, actor)

        turn = await provider.run(system=system, messages=convo,
                                  tools=registry.describe(), model=model)
        # ⚠️ SPENT HERE — the call happened, whatever came back.
        budget_mod.spend(kind)
        result.turns += 1
        for name, count in (turn.usage or {}).items():
            result.usage[name] = result.usage.get(name, 0) + int(count)

        if turn.declined:
            breaker.record_failure()
            return _decline(result, turn.declined, run_id, actor)
        breaker.record_success()

        if not turn.wants_tools:
            result.text = turn.text
            result.status = "answered"
            audit_mod.record_run(run_id, actor=actor, trigger=trigger,
                                 verdict="answered")
            return result

        convo.append({"role": "assistant", "content": _assistant_content(turn)})
        results: List[Dict[str, Any]] = []
        for call in turn.tool_calls:
            results.append(await _invoke(call, registry=registry, policy=policy,
                                         run_id=run_id, actor=actor,
                                         result=result))
        convo.append({"role": "user", "content": results})


@dataclass
class Invocation:
    """CTR-017. One gated tool call, whoever asked for it."""

    blocks: List[Dict[str, Any]]
    allowed: bool = True
    verdict: str = "allow"


async def invoke(registry: Registry, *, policy: policy_mod.RunPolicy,
                 name: str, args: Mapping[str, Any], run_id: str,
                 actor: str) -> Invocation:
    """Gate it, run it, scrub it, record it. THE one place all four happen.

    ⚠️ ARCH-012 — THIS FUNCTION IS WHY "ONE GATE, TWO CONSUMERS" IS A FACT
    RATHER THAN A CLAIM. The in-process loop and the MCP server both reach a
    tool only through here, so there is exactly ONE call to `may_use_tool`,
    exactly ONE call to `record_intent`, and exactly one scrub. Two paths that
    each did their own gating would agree on the day they were written and
    diverge on the first change to either — and the second gate is the one
    nobody tests. TEST-017 asserts the AUDIT ROWS match across both paths,
    which is the assertion that would fail if this were ever inlined back.

    ⚠️ IT NEVER RAISES. Every refusal is a `fail()` block the caller can hand
    back, because a tool error is data on both paths.
    """
    tool = registry.get(name)
    if tool is None:
        # ⚠️ A HALLUCINATED TOOL IS DATA, NOT AN ERROR. The model must be able
        # to read that the tool does not exist and choose another one.
        return Invocation([fail("not_found", f"no tool named {str(name)!r}")],
                          allowed=False, verdict="deny")

    verdict = policy_mod.may_use_tool(policy, name, tool.mode)
    audit_mod.record_intent(run_id, actor=actor, tool=name,
                            args=args, verdict=verdict.verdict)
    if not verdict.allowed:
        return Invocation([fail("not_permitted", verdict.reason)],
                          allowed=False, verdict=verdict.verdict)

    blocks = await tool.call(args)

    # ⚠️ SCRUBBED ON THE WAY IN, BEFORE ANYTHING SEES IT. Once it is in a
    # transcript it is re-sent on every later turn; and over MCP the caller is
    # by definition outside this process.
    scrubbed = redact.scrub(blocks)
    problems = redact.audit(scrubbed)
    if problems:
        # ⚠️ A NON-EMPTY AUDIT MEANS DO NOT SEND — it is not advisory. The
        # result is replaced, and the reason is logged rather than shown, so a
        # leak cannot describe itself to the model.
        swallow("tool result refused by the redaction audit",
                RuntimeError("; ".join(problems[:3])))
        return Invocation([fail("internal",
                                "the result could not be shown safely")],
                          allowed=False, verdict="deny")

    return Invocation(scrubbed, allowed=True, verdict=verdict.verdict)


async def _invoke(call: ToolCall, *, registry: Registry,
                  policy: policy_mod.RunPolicy, run_id: str, actor: str,
                  result: RunResult) -> Dict[str, Any]:
    """The loop's wrapper around `invoke`: count it, and keep the evidence."""
    result.tool_calls += 1
    outcome = await invoke(registry, policy=policy, name=call.name,
                           args=call.args, run_id=run_id, actor=actor)
    if outcome.allowed:
        result.evidence.append({
            "tool": call.name,
            "args_digest": contracts.args_digest(call.args),
            "summary": _summarise(outcome.blocks),
        })
    return _tool_result(call, outcome.blocks)


def _assistant_content(turn: Turn) -> List[Dict[str, Any]]:
    content: List[Dict[str, Any]] = []
    if turn.text:
        content.append({"type": "text", "text": turn.text})
    for call in turn.tool_calls:
        content.append({"type": "tool_use", "id": call.id,
                        "name": call.name, "input": dict(call.args)})
    return content


def _tool_result(call: ToolCall, blocks: Any) -> Dict[str, Any]:
    return {"type": "tool_result", "tool_use_id": call.id, "content": blocks}


def _summarise(blocks: Any) -> str:
    """One short line per evidence row. ⚠️ Bounded, because evidence is stored
    with a concern and a whole tool result would be stored with it."""
    text = str(blocks)
    return text[:200] + ("…" if len(text) > 200 else "")


def _decline(result: RunResult, reason: str, run_id: str, actor: str) -> RunResult:
    result.status = "declined"
    result.declined_reason = reason
    audit_mod.record_run(run_id, actor=actor, trigger="", verdict="declined",
                         detail=reason)
    log(f"run {run_id} declined: {reason}")
    return result
