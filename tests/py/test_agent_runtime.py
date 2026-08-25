"""The agent loop, end to end, with zero network. TASK-032.

⚠️ EVERY FAILURE MODE THE TASK LISTS HAS A SCRIPTED CASE HERE: budget
exhaustion, an open breaker, a raising tool, a malformed call, an act outside
the allow-list, a hallucinated tool, and a repeat loop. None needs an API key.
"""

from __future__ import annotations

import dataclasses

import asyncio
import json
import os
import sys
from typing import Any, Dict, List, Mapping

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent import audit, budget, policy, registry as reg  # noqa: E402
from agent.llm.base import Turn  # noqa: E402
from agent.tools.base import BaseTool, data, fail, text  # noqa: E402
from fake_provider import FakeProvider, asks, declines, says  # noqa: E402

JAN = 1767225600.0


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(budget, "BUDGET_FILE", str(tmp_path / "b.json"))
    monkeypatch.setattr(audit, "AUDIT_FILE", str(tmp_path / "a.json"))
    monkeypatch.setattr(budget, "_BREAKER", None)


class _Echo(BaseTool):
    name = "echo"
    description = "Returns whatever it was given. A stand-in for a read tool."
    inputSchema = {"type": "object",
                   "properties": {"note": {"type": "string",
                                           "description": "anything"}}}
    mode = "READ"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        return [data({"note": str(args.get("note") or "ok")})]


class _Boom(BaseTool):
    name = "boom"
    description = "Always raises. Proves a raising tool cannot end a run."
    inputSchema = {"type": "object", "properties": {}}
    mode = "READ"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        raise RuntimeError("exploded")


class _Leaky(BaseTool):
    name = "leaky"
    description = "Returns an entity id. Proves the redaction audit blocks it."
    inputSchema = {"type": "object", "properties": {}}
    mode = "READ"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        return [data({"label": "sensor.a_secret_thing"})]


class _Act(BaseTool):
    name = "act_service"
    description = "An ACT tool, to prove the registry refuses it when unarmed."
    inputSchema = {"type": "object", "properties": {}}
    # ⚠️ `ACT`, NOT `WRITE`. This fixture was declared WRITE while the gate
    # asked `mode != "READ"`, which made the two agree for the wrong reason and
    # helped hide that every WRITE — `reply`, `raise_concern` — was gated on the
    # ACTUATION switch. A tool named `act_service` actuates; that is the mode.
    mode = "ACT"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        return [text("acted")]


def _registry() -> reg.Registry:
    return reg.build_registry([_Echo(), _Boom(), _Leaky(), _Act()])


def _policy(*, max_turns: int = 6, max_tool_calls: int = 10,
            **cfg: Any) -> policy.RunPolicy:
    """⚠️ THE CAPS ARE SET ON THE POLICY, NOT THROUGH THE CONFIG (2.756.0).
    `max_turns`/`max_tool_calls` stopped being stored keys — the store holds one
    `depth` and `config.DEPTH` maps it to a pair — so passing 6 through
    `for_run` would silently produce 4 and these tests would exercise a cap they
    did not choose. What they are about is the CAP MECHANISM, so they name the
    numbers directly and never touch the depth table."""
    base = policy.for_run(dict(cfg), tool_names=_registry().names)
    return dataclasses.replace(base, max_turns=max_turns,
                               max_tool_calls=max_tool_calls)


def _run(provider: Any, *, pol: Any = None, cfg: Any = None,
         kind: str = "run") -> reg.RunResult:
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
        reg.run(run_id="run-1", provider=provider, registry=_registry(),
                policy=pol or _policy(), model="fake-model",
                system=[{"type": "text", "text": "villa profile"}],
                messages=[{"role": "user", "content": "what is unusual?"}],
                config=cfg if cfg is not None else {"monthly_limit": 50},
                kind=kind))


# ── the happy path ─────────────────────────────────────────────────────────

def test_a_tool_call_then_an_answer() -> None:
    p = FakeProvider([asks("echo", {"note": "hello"}), says("All quiet.")])
    out = _run(p)
    assert out.status == "answered" and out.text == "All quiet."
    assert out.turns == 2 and out.tool_calls == 1
    assert out.evidence[0]["tool"] == "echo"


def test_the_tool_list_is_sent_on_every_turn() -> None:
    p = FakeProvider([asks("echo"), says("done")])
    _run(p)
    for call in p.calls:
        assert "echo" in [t["name"] for t in call["tools"]]


def test_the_conversation_grows_and_the_SYSTEM_prefix_does_not() -> None:
    """⚠️ The cached prefix must be byte-identical across turns, or caching
    never hits and the failure is silent."""
    p = FakeProvider([asks("echo"), says("done")])
    _run(p)
    assert p.calls[0]["system"] == p.calls[1]["system"]
    assert len(p.calls[1]["messages"]) > len(p.calls[0]["messages"])


# ── the failure modes the task lists ───────────────────────────────────────

def test_budget_exhaustion_DECLINES_with_a_reason() -> None:
    # ⚠️ NO `now=` HERE. The loop's own budget calls read the wall clock, so
    # seeding a different month rolls the counter away and the test measures
    # nothing — which is how the first version of this passed for the wrong
    # reason.
    for _ in range(3):
        budget.spend()
    out = _run(FakeProvider([says("never reached")]),
               cfg={"monthly_limit": 3})
    assert out.status == "declined" and "ceiling" in out.declined_reason
    assert out.turns == 0, "a refused run must not reach the provider"


def test_an_open_breaker_declines_before_calling() -> None:
    b = budget.shared_breaker()
    for _ in range(b.failures):
        b.record_failure()
    p = FakeProvider([says("never reached")])
    out = _run(p)
    assert out.status == "declined" and "cooling-off" in out.declined_reason
    assert p.calls == []


def test_repeated_provider_declines_OPEN_the_breaker() -> None:
    for _ in range(budget.shared_breaker().failures):
        _run(FakeProvider([declines("upstream 500")]))
    assert budget.shared_breaker().is_open()


def test_the_turn_cap_stops_a_repeat_loop() -> None:
    """⚠️ The monthly ceiling cannot catch a single run that loops, because it
    is one run."""
    p = FakeProvider([asks("echo") for _ in range(50)])
    out = _run(p, pol=_policy(max_turns=3,
                                     tool_names=_registry().names))
    assert out.status == "declined" and "turn cap" in out.declined_reason
    assert out.turns == 3


def test_a_raising_tool_does_not_end_the_run() -> None:
    """⚠️ Raising past a tool error ends the run and throws away every turn
    already paid for."""
    p = FakeProvider([asks("boom"), says("I could not read that.")])
    out = _run(p)
    assert out.status == "answered"
    sent = p.calls[1]["messages"][-1]["content"][0]["content"]
    assert sent[0]["error"]["code"] == "internal"


def test_a_hallucinated_tool_is_DATA_not_an_error() -> None:
    """The model must be able to read that the tool does not exist and choose
    another one."""
    p = FakeProvider([asks("rm_rf"), says("Not available, so here is what I know.")])
    out = _run(p)
    assert out.status == "answered"
    sent = p.calls[1]["messages"][-1]["content"][0]["content"]
    assert sent[0]["error"]["code"] == "not_found"


def test_an_ACT_tool_is_refused_when_actuation_is_off() -> None:
    p = FakeProvider([asks("act_service"), says("I cannot act.")])
    out = _run(p)
    sent = p.calls[1]["messages"][-1]["content"][0]["content"]
    assert sent[0]["error"]["code"] == "not_permitted"
    assert "disabled" in sent[0]["error"]["message"]


# ── what is PUBLISHED, against what is PERMITTED ───────────────────────────
# ⚠️ These two are different questions and the tests must stay different. The
# filter below is presentation — it decides what the prefix is BILLED for.
# `may_use_tool` is the gate. The test above proves the gate still fires on a
# tool the model named anyway, which is what makes this safe to do at all.

def test_an_ACT_tool_is_NOT_PUBLISHED_while_actuation_is_off() -> None:
    """⚠️ IT WAS BILLED IN THE PREFIX ON EVERY REQUEST ONLY TO BE REFUSED.
    41 of the upstream's 78 tools are ACT, and a villa ships with actuation OFF
    — so the moment an owner takes their MCP add-on out of read-only mode, that
    whole write surface lands in the cached prefix of every request without
    anyone connecting the two."""
    published = {t["name"] for t in _registry().describe(_policy())}
    assert "act_service" not in published
    assert {"echo", "boom", "leaky"} <= published


def test_the_SAME_ACT_tool_IS_published_once_actuation_is_on() -> None:
    """⚠️ THE FILTER FOLLOWS THE GATE, IT DOES NOT REPLACE IT. If this were a
    second rule it could stay shut after the owner opened the switch — a tool
    the policy permits and the model is never told about, which reads as the
    model refusing to act."""
    armed = _policy(act_enabled=True)
    assert "act_service" in {t["name"] for t in _registry().describe(armed)}


def test_triage_is_published_NO_write_surface_at_all() -> None:
    """Triage denies every non-READ mode whatever the actuation switch says, so
    none of it belongs in the tier that runs 96 times a day."""
    triage = policy.for_run({"act_enabled": True}, tier="triage",
                            tool_names=_registry().names)
    assert "act_service" not in {t["name"]
                                 for t in _registry().describe(triage)}


def test_describe_WITHOUT_a_policy_still_publishes_everything() -> None:
    """⚠️ THREE CALLERS BUILD THE POLICY *FROM* THIS LIST — `chat`, `runtime`
    and the proxy. Filtering by default would narrow `allowed_tools` to what the
    previous policy allowed: a ratchet losing a tool per construction, and the
    MCP server would quietly stop publishing its own surface."""
    assert len(_registry().describe()) == 4


def test_the_run_loop_PUBLISHES_THE_FILTERED_LIST() -> None:
    """⚠️ PIN THE CALLER. A filter nothing calls is the shape of defect this
    repository has produced thirteen times: `Registry.describe` would be correct
    and the prefix would be unchanged."""
    p = FakeProvider([says("nothing to do")])
    _run(p)
    assert "act_service" not in {t["name"] for t in p.calls[0]["tools"]}
    assert "echo" in {t["name"] for t in p.calls[0]["tools"]}


def test_a_malformed_tool_call_is_refused_by_the_tool_not_the_loop() -> None:
    p = FakeProvider([asks("echo", {"note": {"nested": "object"}}),
                      says("ok")])
    out = _run(p)
    assert out.status == "answered"


# ── the redaction audit is on the path ─────────────────────────────────────

def test_a_leaking_tool_result_NEVER_reaches_the_transcript() -> None:
    """⚠️ A non-empty audit means DO NOT SEND. And the reason is logged rather
    than shown, so a leak cannot describe itself to the model."""
    p = FakeProvider([asks("leaky"), says("done")])
    _run(p)
    sent = p.calls[1]["messages"][-1]["content"][0]["content"]
    assert sent[0]["error"]["code"] == "internal"
    from agent import refs
    assert refs.entity_ids_in(p.calls[1]["messages"]) == []


# ── budget and audit are actually written ──────────────────────────────────

def test_the_budget_is_spent_per_CALL_not_per_check() -> None:
    _run(FakeProvider([asks("echo"), says("done")]))
    assert budget.status({"monthly_limit": 50})["used"] == 2


def test_a_refused_run_costs_nothing() -> None:
    for _ in range(3):
        budget.spend()
    _run(FakeProvider([says("x")]), cfg={"monthly_limit": 3})
    assert budget.status({"monthly_limit": 3})["used"] == 3


def test_every_tool_call_leaves_an_audit_row_including_the_refused_one() -> None:
    _run(FakeProvider([asks("act_service"), says("done")]))
    tools = [r.get("tool") for r in audit.rows()]
    assert "act_service" in tools
    denied = [r for r in audit.rows() if r.get("verdict") == "deny"]
    assert denied, "a refused tool call must be recorded — it is the evidence " \
                   "the gate ran"


def test_chat_spends_against_the_chat_ceiling() -> None:
    _run(FakeProvider([says("hi")]), kind="chat",
         cfg={"monthly_limit": 50})
    assert budget.status({"monthly_limit": 50})["chat_used"] == 1


# ── the registry ───────────────────────────────────────────────────────────

def test_a_duplicate_tool_name_is_REFUSED_not_overwritten() -> None:
    """⚠️ Last-one-wins makes it silent that the model and we disagree about
    what it just called."""
    with pytest.raises(ValueError):
        reg.Registry([_Echo(), _Echo()])


def test_the_real_registry_is_built_from_ONE_place() -> None:
    """ARCH-012: the MCP server serves this same object, so the two paths
    cannot drift into different tool sets.

    ⚠️ THE SET IS `ALL_TOOLS` MINUS ANYTHING WITH NO SOURCE, AND THAT CARVE-OUT
    IS NEW (2026-08-25). `read_logs` is constructed with no log source, so it
    could only ever return "this tool is not connected to the villa's logs" —
    and once the agent went live that refusal reached the OWNER'S PHONE inside a
    warning saying log access was down. Publishing a schema that can never
    answer also spends prefix tokens in the tier where schemas are 84% of the
    bill. The equality above is kept as an equality rather than relaxed to a
    subset: a subset assertion would pass while the registry quietly lost tools
    that DO work.
    """
    live = reg.build_registry()
    from agent.tools import ALL_TOOLS
    from agent import sources as sources_mod
    withheld = {n for n in (cls().name for cls in ALL_TOOLS)
                if n in sources_mod._UNWIRED_SEEN_NAMES}
    assert set(live.names) == {cls().name for cls in ALL_TOOLS} - withheld
    assert len(live.describe()) == len(ALL_TOOLS) - len(withheld)
    assert withheld, ("nothing is withheld — if a source was wired, delete this "
                      "carve-out rather than leaving it to hide the next gap")


# ── the output ceiling, the salvage, and the last-turn notice ────────────────
def test_the_OUTPUT_CEILING_is_passed_on_every_request() -> None:
    """⚠️ PIN THE CALLER. `max_tokens` is a DEFAULT ARGUMENT on the adapter and
    `registry.run` is its only call site, so not passing it ran the whole system
    at 2048 — including turns whose `thinking` is drawn from the same budget.
    Measured before the fix: 7 of 8 supervision passes declined with
    `stop_reason=max_tokens, saw=thinking`, binning 33 billed tool calls."""
    import inspect
    from agent import registry as registry_mod
    src = inspect.getsource(registry_mod.run)
    assert "max_tokens=_output_ceiling(config)" in src, (
        "the provider is called without an output ceiling; it will use 2048")


def test_the_ceiling_comes_from_config_and_has_a_floor() -> None:
    from agent import registry as registry_mod
    assert registry_mod._output_ceiling({"max_output_tokens": 16384}) == 16384
    # ⚠️ A FLOOR, because a ceiling below the thinking budget makes every turn
    # fail in exactly the way this fixed — and 0 is a plausible typo.
    assert registry_mod._output_ceiling({"max_output_tokens": 10}) >= 1024
    assert registry_mod._output_ceiling({"max_output_tokens": "junk"}) >= 1024
    assert registry_mod._output_ceiling(None) >= 1024


def test_a_DECLINE_that_gathered_evidence_is_PARTIAL_not_a_total_loss() -> None:
    """⚠️ THE WORK WAS DONE; ONLY THE LAST SENTENCE WAS MISSING. Seven passes
    declined on their FINAL turn and threw away every tool result gathered
    before it. Only a bound-stop was rescued before; a provider decline was not."""
    import asyncio
    from agent import runtime
    from fake_provider import FakeProvider, asks, declines

    result = asyncio.run(runtime.investigate(
        provider=FakeProvider([asks("read_villa"), declines("overran")]),
        system=[], messages=[{"role": "user", "content": "hi"}],
        config={"enabled": True}, tier="reason"))

    assert result.evidence, "the tool result was discarded"
    assert result.status == "partial", result.status
    assert result.usable, "evidence already paid for was thrown away"
    assert "overran" in result.reason, (
        f"the reason was lost, so nobody can act on it: {result.reason}")


def test_a_decline_with_NO_evidence_stays_declined() -> None:
    """Nothing to salvage is not a partial success."""
    import asyncio
    from agent import runtime
    from fake_provider import FakeProvider, declines

    result = asyncio.run(runtime.investigate(
        provider=FakeProvider([declines("no credit")]),
        system=[], messages=[{"role": "user", "content": "hi"}],
        config={"enabled": True}, tier="reason"))
    assert result.status == "declined" and not result.usable


def test_the_model_is_TOLD_when_it_is_on_its_last_turn() -> None:
    """⚠️ OTHERWISE IT FINDS OUT BY BEING CUT OFF. Reported from the villa:
    "I could not answer that. turn cap of 8 reached" — after seven turns of
    reading exactly the right things."""
    from agent import registry as registry_mod
    notice = registry_mod.LAST_TURN_NOTICE.lower()
    assert "final turn" in notice and "answer now" in notice
    # ⚠️ IT NAMES THE ACTION, NOT THE LIMIT — a bare turn count is a fact about
    # our plumbing that a model can only guess how to act on.
    assert "partial" in notice, "it does not say a partial answer is wanted"


def test_the_notice_ACTUALLY_REACHES_the_model_on_its_last_turn() -> None:
    """⚠️ BEHAVIOURAL, NOT A SOURCE GREP. The first version of this test read
    the source for the append line — and stayed GREEN when that line was put
    behind `if False:`, because the string was still there to find. A pin that
    survives the mutation it exists to catch is measuring nothing.

    ⚠️ AND IT CHECKS WHERE THE NOTICE LANDS. The cache breakpoint sits on the
    last SYSTEM block, so putting it there would re-write the whole cached
    prefix — the villa document included — on every run that goes the distance.
    It must ride the tool results, which are new and uncached anyway.
    """
    import asyncio
    from agent import policy as policy_mod, registry as registry_mod
    from fake_provider import FakeProvider, asks

    # ⚠️ THREE TURNS, NOT TWO, SO THERE IS A MIDDLE ONE. At max_turns=2 every
    # turn is either the first or the last, and "fires on the last turn" is
    # indistinguishable from "fires on every turn" — a mutation to `if True:`
    # survived the two-turn version of this test.
    name = _registry().names[0]
    provider = FakeProvider([asks(name, call_id="a"),
                             asks(name, {"x": 1}, call_id="b"),
                             asks(name, {"x": 2}, call_id="c")])
    policy = policy_mod.for_run({"max_turns": 3}, tier="reason",
                                tool_names=_registry().names)
    asyncio.run(registry_mod.run(
        run_id="r", provider=provider, registry=_registry(), policy=policy,
        model="m", system=[{"type": "text", "text": "sys"}],
        messages=[{"role": "user", "content": "hi"}]))

    final = provider.calls[-1]
    flat = json.dumps(final["messages"], ensure_ascii=False)
    assert registry_mod.LAST_TURN_NOTICE in flat, (
        "the model was never told it was on its last turn")
    assert registry_mod.LAST_TURN_NOTICE not in json.dumps(final["system"], ensure_ascii=False), (
        "the notice is in the SYSTEM prompt, which invalidates the cached "
        "prefix — the villa document included — on every long run")

    for n, call in enumerate(provider.calls[:-1], start=1):
        assert registry_mod.LAST_TURN_NOTICE not in json.dumps(
            call["messages"], ensure_ascii=False), (
            f"the notice fired on turn {n} of 3; the model wraps up early and "
            "the turn budget is wasted")
