"""`act_service` — the agent touching the villa. TASK-082, the new privilege.

⚠️ IT ACTS ON NOTHING UNTIL AN OWNER NAMES SOMETHING. `actuable_entities` ships
EMPTY and `act_enabled` ships false, and the two are AND-ed: turning actuation
on with an empty list authorises exactly nothing. A helpful default here is an
actuating agent nobody asked for.

⚠️ EVERY GATE IS SOMEBODY ELSE'S. This file resolves a ref, asks `policy.may_act`
and calls a service. It decides nothing: not what is high harm, not whether the
run may act, not whether this exact action already happened. A tool that carried
its own copy of any of those would be the second authorization surface ARCH-011
exists to prevent — and it would be the one nobody tests.

⚠️ `mode = "ACT"`, WHICH IS WHAT KEEPS IT OFF THE MCP SURFACE. `mcp_server`
exports an ALLOW-LIST over `contracts.TOOL_MODE` — `READ`, plus one named write
— so this is excluded by BEING what it is rather than by anybody remembering to
deny it. That was the point of making the mode vocabulary three-valued before
this file existed.

⚠️ A HIGH-HARM ACTION IS A PROPOSAL AND NEVER AN EXECUTION, AT ANY CONFIDENCE,
FROM ANY TRIGGER. "Should I unlock the gate for the cleaner?" is a good product;
"I unlocked the gate for someone claiming to be the cleaner" is a liability. The
refusal is `policy`'s and this returns it verbatim rather than interpreting it.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from vesta.supervise.agent import audit as audit_mod
from vesta.supervise.agent import config as agent_config
from vesta.supervise.agent import proposals as proposals_mod
from vesta.supervise.agent import policy as policy_mod
from vesta.supervise.agent.tools.base import BaseTool
from vesta.supervise.agent.tools.base import data
from vesta.supervise.agent.tools.base import fail
from vesta.supervise.agent.tools.base import text
from vesta.adapters.log import log, swallow

#: Services that put a device back where it was. ⚠️ A LIST OF VERBS, NOT A
#: JUDGEMENT ABOUT DEVICES: `turn_off` is reversible on a lamp and on a pump.
#: Whether the DEVICE may be touched at all is `policy.may_act`'s question, and
#: reversibility alone was never sufficient — unlocking a door is reversible.
REVERSIBLE_SERVICES: Tuple[str, ...] = (
    "turn_on", "turn_off", "toggle", "set_temperature", "set_hvac_mode",
    "set_percentage", "set_preset_mode", "open_cover", "close_cover",
    "stop_cover", "select_option", "set_value",
)


class ActService(BaseTool):
    """Call one Home Assistant service on one authorised device."""

    name = "act_service"
    description = (
        "Act on one device: turn something on or off, set a temperature, open "
        "or close a cover. You may only touch devices an owner has explicitly "
        "authorised, and an action that could let somebody in or silence an "
        "alarm is never executed — it is offered to a person to confirm.")
    inputSchema: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "ref": {"type": "string",
                    "description": "The device handle, from a read tool."},
            "service": {"type": "string",
                        "description": "e.g. turn_off, set_temperature."},
            "params": {"type": "object",
                       "description": "Service data, if the service needs any."},
            "why": {"type": "string",
                    "description": "One sentence: why this, now. Recorded."},
        },
        "required": ["ref", "service", "why"],
    }
    tiers: Sequence[str] = ("reason",)
    mode = "ACT"

    def __init__(self, *, refs: Any = None, caller: Any = None,
                 policy: Optional[policy_mod.RunPolicy] = None,
                 config: Optional[Mapping[str, Any]] = None,
                 run_id: str = "", actor: str = "system") -> None:
        self._refs = refs
        #: `caller(entity_id, service, params) -> awaitable`. Injected for the
        #: same reason every other tool's source is: this file must be testable
        #: without a villa, and `tools/ha.py` owns the HA client.
        self._caller = caller
        self._policy = policy
        self._config = config
        self._run_id = str(run_id)
        self._actor = str(actor)
        self.performed: List[Dict[str, str]] = []

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        ref = str(args.get("ref") or "")
        service = str(args.get("service") or "").strip()
        why = str(args.get("why") or "").strip()
        params = args.get("params")
        params = dict(params) if isinstance(params, Mapping) else {}

        if not why:
            # ⚠️ REFUSED WITHOUT A REASON, and this is not ceremony. The audit
            # row is the only account of why the villa changed; a blank one
            # turns "who did this" into an unanswerable question three months
            # later, which is when it is asked.
            return [fail("invalid_args", "say why, in one sentence")]

        entity_id = self._refs.resolve(ref) if self._refs else None
        if not entity_id:
            return [fail("not_found", f"no device with handle {ref!r}")]

        if self._policy is None:
            return [fail("unavailable", "this run has no policy, so it cannot "
                                        "act — that is a fault, not a refusal")]

        # ⚠️ CONFIG'S ALLOW-LIST FIRST, AS A SEPARATE QUESTION FROM POLICY'S.
        # `config.may_act` asks "did an owner name THIS DEVICE"; `policy.may_act`
        # asks "may this run act at all, and is this action safe". Both must
        # pass and neither implies the other.
        # ⚠️ THE RESOLVED ENTITY ID, NOT THE HANDLE. Handles are per-run and
        # meaningless across runs by design, so asking with `ref` compared a
        # stored allow-list against a SLOT NUMBER: `["d1"]` authorised whichever
        # device this run read first. The refusal still names the handle,
        # because that is the only identifier the model is allowed to see.
        if not agent_config.may_act(self._config, entity_id):
            return [fail("not_permitted",
                         f"{ref} is not on this villa's actuable list")]

        verdict = policy_mod.may_act(
            self._policy, entity_id=entity_id, service=service,
            reversible=service in REVERSIBLE_SERVICES)

        try:
            key = audit_mod.record_intent(
                self._run_id, actor=self._actor, tool=self.name,
                args={"ref": ref, "service": service, "params": params},
                verdict=verdict.verdict)
        except audit_mod.Replayed as err:
            # ⚠️ AN EXCEPTION HERE AND A VALUE EVERYWHERE ELSE, DELIBERATELY.
            # A replayed action means the caller believes it has not acted when
            # it has, and continuing past that quietly is how a pump gets
            # switched twice. It is converted to a tool error so the MODEL can
            # read it, while the interruption still happened.
            return [fail("not_permitted", str(err))]

        if verdict.verdict == "propose":
            # ⚠️ A PROPOSAL IS A RESULT, NOT A FAILURE. The model should tell
            # somebody what it would like to do; returning an error would make
            # it read this as a dead end and try something else.
            #
            # ⚠️ AND IT IS NOW RECORDED WHERE A PERSON CAN ANSWER IT (TASK-083).
            # Until this line the proposal existed only in the model's own
            # context: it could say "shall I unlock the gate?" and there was
            # nowhere for anybody to say yes — a refusal wearing a question's
            # clothes. `proposals.propose` puts it on a surface the MODEL CANNOT
            # REACH; there is deliberately no confirm TOOL, because a confirm
            # flow the model can complete is worse than none.
            proposals_mod.propose(
                action_key=key, ref=ref, entity_id=entity_id, service=service,
                params=params, harm=verdict.harm_class, reason=verdict.reason,
                why=why, run_id=self._run_id, actor=self._actor)
            return [data({"proposed": True, "ref": ref, "service": service,
                          "harm": verdict.harm_class, "reason": verdict.reason,
                          "action_key": key,
                          # ⚠️ THE MODEL IS TOLD IT MUST ASK, in the tool result
                          # rather than only in the system prompt, because this
                          # is the turn where it decides what to say next.
                          "awaiting": "a person must confirm this on the "
                                      "Cockpit; it expires in "
                                      f"{proposals_mod.TTL_SECONDS // 60} "
                                      "minutes"})]
        if not verdict.allowed:
            return [fail("not_permitted", verdict.reason)]

        if self._caller is None:
            return [fail("unavailable", "no service caller is wired")]
        try:
            await self._caller(entity_id, service, params)
        except Exception as err:  # noqa: BLE001 - degrade, never fail
            swallow(f"act_service {service} failed", err)
            audit_mod.record_outcome(self._run_id, action_key=key,
                                     outcome="failed", detail=str(err)[:200])
            return [fail("internal", f"the service call failed: {err}")]

        audit_mod.record_outcome(self._run_id, action_key=key, outcome="done",
                                 detail=why[:200])
        self.performed.append({"ref": ref, "service": service})
        log(f"act_service {service} on {ref} ({self._run_id})")
        return [text(f"Done: {service} on {ref}.")]


def build(*, refs: Any = None, caller: Any = None,
          policy: Optional[policy_mod.RunPolicy] = None,
          config: Optional[Mapping[str, Any]] = None,
          run_id: str = "", actor: str = "system") -> ActService:
    """One actuator, bound to one run.

    ⚠️ ABSENT FROM `ALL_TOOLS`, LIKE `reply`. An unbound instance has no policy
    and no caller, so collecting it would offer every scheduled run a verb it
    cannot use — and would put an ACT tool in the registry the MCP server
    filters, where its exclusion should never have to be relied upon.
    """
    return ActService(refs=refs, caller=caller, policy=policy, config=config,
                      run_id=run_id, actor=actor)


#: ⚠️ DELIBERATELY EMPTY — see `build`. `test_agent_contracts` names this file's
#: class in its EXEMPT map with the reason.
ACT_TOOLS: Tuple[type, ...] = ()
