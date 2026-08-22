"""The investigation loop's entry points, and the bounds nobody else owns.

⚠️ IT IS A LAYER OVER `registry.run`, NOT A SECOND LOOP. That function already
owns turn-by-turn mechanics — the gate, the budget, the breaker, the scrub — and
duplicating it here would create exactly the second authorization path
`ARCH-012` exists to prevent. What this module adds is what a LOOP cannot see
about itself: how long the whole thing has taken, whether it is going round in
circles, and which of four entry points asked.

⚠️ NOTHING HERE EVER RAISES (REQ-043). Every failure is a typed `AgentResult`
with a reason a person can act on. A supervision system that can throw is one
that goes quiet at the moment it is most needed, and the caller is a background
task nobody is watching.

⚠️ A TIMEOUT RETURNS `partial`, NOT `failed`, AND KEEPS THE EVIDENCE. Work
already paid for is work already paid for: an investigation that read three
tools and ran out of clock has three tool results worth more than a blank
failure, and the difference is visible to the reader rather than inferred.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence

from agent import config as agent_config
from agent import contracts, policy as policy_mod
from agent.llm.base import Provider
from agent.registry import Registry, RunResult, build_registry
from agent.registry import run as run_loop
from reports.log import log, swallow

#: How long a whole investigation may take, wall clock. ⚠️ NOT A TURN LIMIT —
#: `policy.max_turns` already bounds those. This bounds the case turns cannot:
#: a provider answering slowly, a tool waiting on a restarting Home Assistant.
#: Eight turns at thirty seconds each is four minutes, so this is the ceiling
#: rather than the expectation.
DEADLINE_S: float = 300.0

#: How many times the model may make the SAME call before the run stops.
#: ⚠️ TWO, NOT ONE. Asking twice is legitimate — a tool result can change
#: between turns, and a model re-reading a state after an action is behaving
#: correctly. Three identical calls with identical arguments is a loop.
MAX_IDENTICAL_CALLS: int = 2


@dataclass
class AgentResult:
    """CTR-007, as the callers see it. Never an exception."""

    run_id: str
    status: str = "answered"            # RUN_STATUS
    text: str = ""
    reason: str = ""
    trigger: str = "manual"
    turns: int = 0
    tool_calls: int = 0
    evidence: List[Dict[str, Any]] = field(default_factory=list)
    usage: Dict[str, int] = field(default_factory=dict)
    seconds: float = 0.0

    @property
    def usable(self) -> bool:
        """Did this produce something worth showing a person?

        ⚠️ `partial` COUNTS. It carries the evidence gathered before the clock
        ran out, and discarding that would throw away work already billed for.
        """
        return self.status in ("answered", "partial") and bool(
            self.text or self.evidence)


class _Bounded:
    """A provider wrapper that stops a run the loop cannot stop itself.

    ⚠️ IT WRAPS RATHER THAN PATCHING THE LOOP, so `registry.run` stays the one
    implementation and this stays testable without one. A provider is the only
    place that sees every turn boundary, which is exactly where a deadline and
    a repeat detector belong.

    ⚠️ IT DECLINES; IT DOES NOT RAISE. `Turn(declined=…)` is a value the loop
    already handles, so a bound firing takes the same path as a provider outage
    and needs no new branch anywhere.
    """

    name = "bounded"

    def __init__(self, inner: Any, *, deadline_s: float = DEADLINE_S,
                 started: Optional[float] = None,
                 max_identical: int = MAX_IDENTICAL_CALLS) -> None:
        self._inner = inner
        self._deadline_s = float(deadline_s)
        self._started = time.monotonic() if started is None else started
        self._max_identical = int(max_identical)
        self._seen: Dict[str, int] = {}
        self.stopped_by: str = ""

    def configured(self) -> bool:
        return bool(getattr(self._inner, "configured", lambda: False)())

    def _over_deadline(self) -> bool:
        return (time.monotonic() - self._started) > self._deadline_s

    def _looping(self, messages: Sequence[Mapping[str, Any]]) -> str:
        """The signature of a repeated call, or `""`.

        ⚠️ NAME PLUS ARGUMENTS, VIA `args_digest`. Name alone would stop a model
        legitimately reading two different devices with the same tool, which is
        most of what an investigation IS.
        """
        for message in reversed(list(messages)):
            content = message.get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if (isinstance(block, Mapping)
                        and block.get("type") == "tool_use"):
                    args = block.get("input")
                    key = (f"{block.get('name')}:"
                           f"{contracts.args_digest(args if isinstance(args, Mapping) else {})}")
                    self._seen[key] = self._seen.get(key, 0) + 1
                    if self._seen[key] > self._max_identical:
                        return key
            break                      # only the newest assistant turn
        return ""

    async def run(self, **kwargs: Any) -> Any:
        from agent.llm.base import Turn

        if self._over_deadline():
            self.stopped_by = "deadline"
            return Turn(declined="this investigation ran out of time")
        repeated = self._looping(kwargs.get("messages") or [])
        if repeated:
            self.stopped_by = "repeat"
            return Turn(declined="the same tool was called with the same "
                                 "arguments repeatedly, so the run was stopped")
        return await self._inner.run(**kwargs)


async def investigate(*, provider: Provider,
                      system: Sequence[Mapping[str, Any]],
                      messages: Sequence[Mapping[str, Any]],
                      config: Optional[Mapping[str, Any]] = None,
                      registry: Optional[Registry] = None,
                      tier: str = "reason",
                      trigger: str = "manual",
                      actor: str = "system",
                      run_id: str = "",
                      deadline_s: float = DEADLINE_S) -> AgentResult:
    """One investigation, from any of the four entry points. Never raises.

    ⚠️ THE FOUR ENTRY POINTS SHARE THIS FUNCTION AND DIFFER ONLY IN `trigger`.
    A scheduled escalation, a kiosk request, a chat turn and an event all need
    the same bounds, the same audit and the same refusal behaviour; giving each
    its own loop is how three of them would drift from whichever one gets
    tested.
    """
    cfg = agent_config.view(config)
    ident = str(run_id or f"{trigger}{int(time.time())}")
    started = time.monotonic()

    if not cfg.get("enabled"):
        return AgentResult(run_id=ident, status="declined", trigger=trigger,
                           reason="the agent is switched off (agent.enabled)")

    try:
        reg = registry if registry is not None else build_registry()
        policy = policy_mod.for_run(
            config, tier=tier,
            tool_names=[t["name"] for t in reg.describe()])
        bounded = _Bounded(provider, deadline_s=deadline_s, started=started)
        result: RunResult = await run_loop(
            run_id=ident, provider=bounded, registry=reg, policy=policy,
            model=str(cfg.get(f"model_{'triage' if tier == 'triage' else 'reason'}")
                      or ""),
            system=system, messages=messages, config=config,
            actor=actor, trigger=trigger,
            kind="chat" if trigger == "chat" else "run")
    except Exception as err:  # noqa: BLE001 - REQ-043: nothing escapes
        swallow(f"investigation {ident} raised", err)
        return AgentResult(run_id=ident, status="failed", trigger=trigger,
                           reason=f"the investigation could not run: {err}",
                           seconds=time.monotonic() - started)

    out = AgentResult(
        run_id=ident, status=result.status, text=result.text,
        reason=result.declined_reason, trigger=trigger, turns=result.turns,
        tool_calls=result.tool_calls, evidence=list(result.evidence),
        usage=dict(result.usage), seconds=time.monotonic() - started)

    # ⚠️ A BOUND THAT FIRED AFTER USEFUL WORK IS `partial`, NOT `declined`. The
    # loop cannot tell the difference — to it, a deadline and a dead provider
    # are the same declined turn — because only this layer knows which bound
    # stopped it and how much evidence was already in hand.
    if bounded.stopped_by and out.evidence:
        out.status = "partial"
        out.reason = (f"stopped by the {bounded.stopped_by} bound after "
                      f"{len(out.evidence)} tool result(s): {out.reason}")
    elif bounded.stopped_by:
        out.reason = f"stopped by the {bounded.stopped_by} bound: {out.reason}"

    log(f"run {ident} {out.status} in {out.seconds:.1f}s "
        f"({out.turns} turn(s), {out.tool_calls} tool call(s))")
    return out


def is_shadow(config: Optional[Mapping[str, Any]] = None) -> bool:
    """Is this deployment recording without delivering? ARCH-016.

    ⚠️ READ AT EVERY DECISION POINT, NEVER CACHED AT START-UP. Shadow mode is
    the switch an operator reaches for when something is going wrong, and one
    that needs a restart is one that does not help then.
    """
    return bool(agent_config.view(config).get("shadow"))
