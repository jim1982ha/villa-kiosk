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
from agent import contracts
from agent import policy as policy_mod, redact
from agent import upstream
from agent.llm.base import Provider, ToolCall, Turn
from agent.tools import ALL_TOOLS
from agent.tools.base import BaseTool, fail
from reports import usage as usage_mod
from reports.log import log, swallow


class Registry:
    """Every tool this deployment offers, by name. A table, not a branch."""

    def __init__(self, tools: Sequence[BaseTool], *, refs: Any = None) -> None:
        #: ⚠️ THIS RUN'S REF TABLE, CARRIED SO A PER-RUN TOOL CAN JOIN IT.
        #: `raise_concern` is built by `runtime.investigate` — after this — and
        #: has to resolve the SAME handles the read tools minted, because `d3`
        #: means different devices in different runs by design (`refs.py`).
        #: Building a second table there would have produced a concern about
        #: whatever device happened to sit at that index instead.
        self.refs = refs
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
        return Registry(list(self._tools.values()) + [tool], refs=self.refs)


def build_registry(tools: Optional[Sequence[BaseTool]] = None, *,
                   config: Optional[Mapping[str, Any]] = None,
                   session: Any = None) -> Registry:
    """The deployment's registry, CONNECTED TO THIS VILLA.

    ⚠️ ONE construction site, so the MCP server and the in-process loop cannot
    drift into two different tool sets.

    ⚠️ AND IT USED TO BUILD THEM WITH NO ARGUMENTS. Every tool takes its data
    source as a constructor argument, so `[cls() for cls in ALL_TOOLS]` produced
    a full registry of tools connected to nothing: `read_salient` returned `[]`
    forever and `read_logs` zero lines forever. The agent, asked about a pool
    pump on a property journalling 17,845 entries, reported a villa with no
    devices — and reasoned about the emptiness better than the tools deserved.
    `agent/sources.py` is the other half.
    """
    if tools is not None:
        return Registry(list(tools))
    try:
        from agent import sources
        refs = sources.build_refs()
        # ⚠️ THE TABLE IS BUILT HERE AND PASSED IN, rather than built inside
        # `build_tools` and lost. It is the run's only ref table: the read tools
        # mint handles into it and `raise_concern` resolves them back out of it.
        built = list(sources.build_tools(config=config, refs=refs))
        # ⚠️ THE UPSTREAM'S TOOLS JOIN THIS LIST, THEY DO NOT SIT BESIDE IT
        # (ADR-023). Home Assistant's own MCP server is where HA reads come
        # from now, and folding its `tools/list` in here is the whole
        # integration: `policy.may_use_tool` still runs per call on `tool.mode`,
        # the audit still writes an intent/outcome pair, `redact` and
        # `truncate` still apply. A second surface would be a second tool path
        # beside the audited one, and the second is the one nobody tests
        # (ARCH-012).
        #
        # ⚠️ VESTA'S OWN TOOLS ARE NOT REPLACEABLE BY IT AND STAY FIRST.
        # `read_villa`, `read_salient`, `read_concerns`, `read_coverage`,
        # `read_ledger` and `read_playbook` serve this add-on's OWN findings —
        # a briefing, an open concern, the facility record — which no upstream
        # tool can know about. A question about a report reaches them.
        # ⚠️ `refs` IS PASSED HERE FOR THE SAME REASON IT IS PASSED ABOVE, and
        # omitting it took the integration dark for six releases: an upstream
        # result carries real entity ids, `redact.audit` refuses any payload
        # holding one, and the model got "the result could not be shown safely"
        # for every question about a named device.
        built += upstream.tools_for(lambda: session, refs)
        return Registry(built, refs=refs)
    except Exception as err:  # noqa: BLE001 - a broken source is not a dead
        swallow("could not wire the tools to this villa", err)   # registry
        return Registry([cls() for cls in ALL_TOOLS])


#: What the model is told on the turn before its last. ⚠️ IT NAMES THE ACTION,
#: NOT THE LIMIT. "You have 1 turn left" is a fact about our plumbing that a
#: model can only guess how to act on; "answer now with what you have" is the
#: behaviour actually wanted. It also says partial-and-labelled beats silence,
#: because the failure this replaces was a run that read the right things for
#: seven turns and then said nothing at all.
LAST_TURN_NOTICE: str = (
    "SYSTEM: This is your final turn — no further tool calls will run. "
    "Answer now using what you already have. If it is incomplete, say so and "
    "say what is missing; a partial answer that names its gap is far more "
    "useful than no answer.")


def _output_ceiling(config: Optional[Mapping[str, Any]]) -> int:
    """How many output tokens one turn may produce, from config.

    ⚠️ READ PER RUN, NOT CACHED, so raising it takes effect on the next pass
    rather than on the next restart — this is the dial somebody reaches for
    while watching a villa fail, and a restart to apply it is a restart that
    loses the state they were watching.
    """
    from agent import config as agent_config
    raw = agent_config.view(config).get("max_output_tokens")
    try:
        return max(1024, int(raw))
    except (TypeError, ValueError):
        return 8192


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
              kind: str = "run",
              evidence: Optional[List[Dict[str, Any]]] = None) -> RunResult:
    """One reasoning run: turn, tools, turn, until it stops or a bound binds.

    ⚠️ EVERY BOUND IS CHECKED BEFORE THE CALL AND THE RUN DECLINES RATHER THAN
    FAILING. A spent budget, an open breaker and an exhausted turn cap are all
    correct outcomes; collapsing them into a failure would make a working system
    look broken in every count that matters and hide the one case that needs an
    engineer.

    ⚠️ `evidence` IS AN ACCUMULATOR THE CALLER MAY OWN, AND IT IS HOW THE
    EVIDENCE RULE IS ENFORCED AT ALL (ARCH-006). Every allowed tool call appends
    a row to it, and `raise_concern` — built per run by `runtime.investigate` —
    reads it at the moment it is called, so a figure the model writes is checked
    against what THIS run actually read. Passing the list in rather than copying
    `result.evidence` out afterwards is the whole point: the check happens mid
    run, while there is still a turn left to correct it.
    """
    result = RunResult(run_id=run_id,
                       evidence=evidence if evidence is not None else [])
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

        # ⚠️ `max_tokens` IS PASSED, AND NOT PASSING IT WAS A REAL OUTAGE. The
        # adapter's signature defaults it to 2048 and this was the only call
        # site, so every request in the system ran at that ceiling — including
        # turns whose `thinking` blocks are drawn from the same budget. See
        # `config.CONFIG_DEFAULTS["max_output_tokens"]` for the measurement.
        turn = await provider.run(system=system, messages=convo,
                                  tools=registry.describe(), model=model,
                                  max_tokens=_output_ceiling(config))
        # ⚠️ SPENT HERE — the call happened, whatever came back.
        budget_mod.spend(kind)
        # ⚠️ AND ACCOUNTED HERE, FOR THE SAME REASON AND WITH THE SAME TIMING.
        # This is the single provider call site for triage, reasoning and chat
        # alike (ARCH-012), so one line covers every agent request that can
        # exist — and it records a DECLINED turn too, because a turn that was
        # billed and unusable is precisely the spend an owner cannot otherwise
        # account for.
        usage_mod.record(source=kind if kind != "run" else trigger or "run",
                         model=model, counts=turn.usage or {},
                         actor=actor, run_id=run_id)
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
        # ⚠️ THE MODEL IS TOLD WHEN IT IS ON ITS LAST TURN, BECAUSE OTHERWISE IT
        # FINDS OUT BY BEING CUT OFF. A run that hits the cap mid-investigation
        # answers nobody and bins every tool result it gathered — reported from
        # the villa as "I could not answer that. turn cap of 8 reached", after
        # the model had spent seven turns reading exactly the right things.
        # Raising the cap would only move where that happens; the fix is that it
        # knows to conclude.
        #
        # ⚠️ APPENDED TO THE TOOL RESULTS, NOT TO THE SYSTEM PROMPT. The cache
        # breakpoint sits on the last system block (see `_cached`), so adding a
        # block there on the final turn would re-write the whole cached prefix —
        # the villa document included — for every run that goes the distance.
        # This rides content that is new and uncached anyway, so it is free.
        for call in turn.tool_calls:
            results.append(await _invoke(call, registry=registry, policy=policy,
                                         run_id=run_id, actor=actor,
                                         result=result))
        if policy.max_turns - result.turns <= 1:
            results.append({"type": "text", "text": LAST_TURN_NOTICE})
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

    # ⚠️ FENCED AFTER THE SCRUB AND THE AUDIT, NOT BEFORE. The audit walks the
    # finished object looking for what should not be there; adding our own
    # marker text first would put a string into it that the second opinion has
    # to be taught to ignore, which is how a second opinion stops being one.
    #
    # ⚠️ THIS LINE IS THE OTHER HALF OF RISK-001's CONTROL, and it did not
    # exist. `redact.wrap` was written for it and never called, so every tool
    # result reached the transcript scrubbed but undelimited — the model could
    # not see where the villa's words stopped. Found by TASK-101's adversarial
    # pass, and only after `test_reachability` was corrected to stop counting a
    # prose fragment in a TSX comment as a caller.
    return Invocation(redact.wrap_blocks(scrubbed), allowed=True,
                      verdict=verdict.verdict)


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
            "cited": _citable(outcome.blocks),
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


#: How much of a tool result a person sees on the concern it supports.
SUMMARY_CHARS: int = 200

#: How much of it the EVIDENCE RULE may check a figure against.
#: ⚠️ TWO NUMBERS BECAUSE THEY ANSWER TWO QUESTIONS, AND COLLAPSING THEM MADE
#: THE RULE ACCUSE THE MODEL OF INVENTING WHAT IT HAD JUST READ. `render.enforce`
#: strips any figure absent from the cited text, and until this split the cited
#: text WAS the 200-character summary — so a run that read a ranking of
#: twenty-five devices could source a number from the first entry and nothing
#: after it. The model would be told, correctly formatted and completely wrongly,
#: that its figure was unsourced. Storage wants brevity (2,000 concerns × N rows
#: on a villa's disk); the check wants completeness. Each gets what it needs.
#: It is set to `tools.base.DEFAULT_MAX_RESULT_CHARS` — the cap a tool applies
#: when it calls `truncate`. ⚠️ NOT EVERY TOOL DOES, so this is a real bound and
#: not a restatement of one: seven of the tool modules never call `truncate`,
#: because their results are small by construction. This is what catches the one
#: that stops being.
CITED_CHARS: int = 8_000


def _summarise(blocks: Any) -> str:
    """One short line per evidence row. ⚠️ Bounded, because evidence is stored
    with a concern and a whole tool result would be stored with it."""
    text = str(blocks)
    return text[:SUMMARY_CHARS] + ("…" if len(text) > SUMMARY_CHARS else "")


def _citable(blocks: Any) -> str:
    """The whole result, for `render.enforce` to check figures against.

    ⚠️ IN MEMORY FOR THE RUN, NOT STORED. `tools/concern.py` drops this key
    before the evidence reaches the concern store — see its `_stored_evidence`.
    """
    return str(blocks)[:CITED_CHARS]


def _decline(result: RunResult, reason: str, run_id: str, actor: str) -> RunResult:
    result.status = "declined"
    result.declined_reason = reason
    audit_mod.record_run(run_id, actor=actor, trigger="", verdict="declined",
                         detail=reason)
    log(f"run {run_id} declined: {reason}")
    return result
