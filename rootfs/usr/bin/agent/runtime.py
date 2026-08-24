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
from agent import sources as sources_mod
from agent.tools import act as act_mod
from agent.tools import concern as concern_mod
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
                      session: Any = None,
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
        # ⚠️ THE SESSION IS FORWARDED, AND OMITTING IT TOOK HOME ASSISTANT AWAY
        # FROM THE REASONING TIER WITHOUT A WORD. `build_registry` folds the
        # upstream MCP catalogue in and binds each tool to `lambda: session`, so
        # a session-less registry PUBLISHES every Home Assistant tool and every
        # call to one returns `no session to reach the MCP server` — into the
        # transcript, where no log line ever sees it. The model is told it can
        # read the villa and then cannot, on every scheduled investigation.
        # (The reference villa catalogues 39; a property that has not put its
        # MCP add-on in read-only mode sees 78. The count is per-site and the
        # defect was not.)
        #
        # ⚠️ THE SESSION EXISTED THE WHOLE TIME AND WAS DROPPED ONE FRAME UP:
        # `scheduler._run_once` takes it and called `triage.run`/
        # `reason.follow_up` without it. Chat was the only path that passed one,
        # which is why questions typed at the villa worked and scheduled passes
        # quietly ran on the built-in readers alone.
        reg = (registry if registry is not None
               else build_registry(config=config, session=session))

        # ⚠️ THE RUN'S EVIDENCE, OWNED HERE BECAUSE TWO THINGS NEED IT AT
        # DIFFERENT TIMES: the loop appends to it as tools return, and
        # `raise_concern` reads it mid-run to check the figures the model wrote.
        # Copying it out of the RunResult afterwards would put the evidence rule
        # after the last chance to correct anything.
        evidence: List[Dict[str, Any]] = []

        # ⚠️ THE WRITE TOOL IS FOR THE REASONING TIER AND NOT FOR TRIAGE — two
        # independent barriers, both cheap. `policy.may_use_tool` denies every
        # WRITE to the triage tier whatever the registry holds, and triage
        # additionally never sees the tool: `triage.registry_for` narrows to
        # `read_villa` by name, and adding this one afterwards would have widened
        # the tier that runs ninety-six times a day past the one tool it may use.
        writes = tier != "triage"

        # ⚠️ THE POLICY IS SNAPSHOTTED OVER THE FINAL TOOL SET, INCLUDING THE ONE
        # NOT BUILT YET. `may_use_tool` denies any name not in `allowed_tools`,
        # so a tool registered after the snapshot is a tool the gate refuses —
        # which would have made this whole feature a `not_permitted` block. The
        # name comes off the class, so the two can never drift.
        names = [t["name"] for t in reg.describe()]
        if writes:
            names.append(concern_mod.RaiseConcern.name)
            # ⚠️ THE NAME GOES IN BEFORE THE SNAPSHOT AND THE TOOL IS BUILT
            # AFTER IT, for the reason stated above: `may_use_tool` denies any
            # name not in `allowed_tools`, so the order is what makes the tool
            # reachable at all. Unconditional here and conditional below —
            # naming it costs nothing (`may_use_tool` still refuses ACT while
            # the switch is off, and 2.716.0 stops it being PUBLISHED), whereas
            # deciding here would need `act_enabled` before the policy that
            # computes it exists, which is a second copy of that expression.
            names.append(act_mod.ActService.name)
        policy = policy_mod.for_run(config, tier=tier, tool_names=names)

        if writes:
            # ⚠️ EVERY PER-RUN BINDING IS A CONSTRUCTOR ARGUMENT, never assigned
            # afterwards: this run's refs, this run's evidence, this run's policy
            # snapshot. The sink is what carries the policy and the config, so
            # the model can neither choose its store nor outlive a suppression —
            # see `tools/concern.py:writer`.
            reg = reg.with_tool(concern_mod.RaiseConcern(
                refs=getattr(reg, "refs", None),
                evidence_source=lambda: evidence,
                sink=concern_mod.writer(policy, config)))

        # ⚠️ THE ACTUATOR, AND UNTIL 2.718.0 NOTHING BUILT ONE. `act.build` had
        # exactly one caller in the tree and it was its own test, so
        # `act_enabled: true` on a villa with a populated `actuable_entities`
        # produced no `act_service` tool at all — a switch that did nothing,
        # with TASK-082 marked COMPLETE. The tool itself was finished and
        # correct; only this line was missing.
        #
        # ⚠️ `policy.act_enabled`, NOT `cfg.get("act_enabled")`. `for_run`
        # already AND-s the setting with `tier != "triage"`, so asking the
        # policy is asking the one place config is read into authority — and
        # re-deriving it here is how the volume tier would eventually be handed
        # an actuator by someone editing one of the two copies.
        #
        # ⚠️ AND IT IS STILL GUARDED THREE MORE TIMES BELOW THIS LINE, none of
        # which this replaces: `config.may_act` refuses any ref an owner has not
        # named (`actuable_entities` ships EMPTY, so turning the switch on
        # authorises nothing by itself), `policy.may_act` refuses every
        # high-harm action at any confidence and offers it as a proposal
        # instead, and `allowed_services` refuses any verb nobody listed.
        if policy.act_enabled:
            reg = reg.with_tool(act_mod.build(
                refs=getattr(reg, "refs", None),
                # ⚠️ None WITHOUT A SESSION, which `ActService` reports as
                # "no service caller is wired" rather than pretending. See
                # `sources.service_caller`.
                caller=sources_mod.service_caller(session),
                policy=policy, config=config, run_id=ident, actor=actor))

        bounded = _Bounded(provider, deadline_s=deadline_s, started=started)
        result: RunResult = await run_loop(
            run_id=ident, provider=bounded, registry=reg, policy=policy,
            model=str(cfg.get(f"model_{'triage' if tier == 'triage' else 'reason'}")
                      or ""),
            system=system, messages=messages, config=config,
            actor=actor, trigger=trigger,
            kind="chat" if trigger == "chat" else "run", evidence=evidence)
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

    # ⚠️ AND EVIDENCE ALREADY PAID FOR IS NEVER THROWN AWAY, WHATEVER DECLINED
    # THE RUN. The branch above rescued only a run stopped by one of THIS
    # module's bounds; every other decline — a provider that overran its output
    # ceiling, a spent budget, an open breaker — discarded the lot. Measured on
    # the reference villa before `max_output_tokens` was passed at all: seven
    # supervision passes declined on the FINAL turn, taking 33 already-billed
    # tool results with them, because the model spent that turn's tokens
    # thinking and emitted nothing. The work was done; only the last sentence
    # was missing, which is exactly what the degradation ladder composes.
    #
    # ⚠️ THE AUDIT ROW STILL SAYS `declined`, DELIBERATELY. It records what the
    # PROVIDER did; this field records whether the result is usable. Rewriting
    # the audit here would make "how often does the provider fail" unanswerable
    # from the record.
    elif out.status == "declined" and out.evidence:
        out.status = "partial"
        out.reason = (f"the answer was not composed, but "
                      f"{len(out.evidence)} tool result(s) were gathered: "
                      f"{out.reason}")

    # ⚠️ WHICH TOOLS, NOT JUST HOW MANY, AND THE COUNT WAS THE ONLY THING
    # RECORDED. The prefix instrument (2.715.0) measured that TOOL SCHEMAS ARE
    # 84% of the investigation tier's prefix — 113,393 chars, 32.7k tokens, 44
    # tools — against a playbook at 11% and the villa document at 4%. Cost is
    # `prefix x turns` and these runs take 8 turns, so one investigation reads
    # ~313k cached tokens and five sixths of that is a tool catalogue.
    #
    # ⚠️ SO THE OBVIOUS FIX IS TO PUBLISH FEWER TOOLS TO THIS TIER, AND
    # "obvious" is exactly the word this repository distrusts. Seven perf
    # hypotheses here have been argued from plausibility and disproved, and
    # "no investigation needs `ha_eval_template`" is one more until something
    # measures it. `audit.record_intent` already stores the name of every call,
    # but nothing aggregates them and the ledger is an owner-only endpoint —
    # so the applicable set was unreadable from the one place it is decided.
    #
    # ⚠️ NAMES, DEDUPLICATED, WITH THE CALL COUNT. A run that reads the same
    # tool six times says something different about that tool from six runs that
    # each read it once, and only the second is evidence for keeping it.
    used: Dict[str, int] = {}
    for row in out.evidence:
        name = str(row.get("tool") or "")
        if name:
            used[name] = used.get(name, 0) + 1
    log(f"run {ident} {out.status} in {out.seconds:.1f}s "
        f"({out.turns} turn(s), {out.tool_calls} tool call(s))")
    if used:
        # ⚠️ ITS OWN LINE, so a grep for `tools used` answers "what does this
        # tier actually reach for" across every run without matching the
        # summary above it.
        ranked = sorted(used.items(), key=lambda kv: (-kv[1], kv[0]))
        log(f"run {ident} tools used: "
            + " ".join(f"{n}x{c}" for n, c in ranked))
    return out


# ⚠️ `is_shadow` LIVED HERE AND IS GONE. It was a second predicate for the
# question `shadow.suppressed` already answers, written because this module
# needed the answer and the other module was not in view — the same shape as
# every duplication /dry-audit exists to find, and nothing ever called it.
# `agent/shadow.py` owns the question and carries the reasoning.
