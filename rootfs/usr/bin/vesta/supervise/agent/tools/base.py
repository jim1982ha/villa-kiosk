"""The tool protocol. CTR-017, CTR-018 — and the extraction seam (ADR-006).

⚠️ MCP-SHAPED FROM DAY ONE, AND THAT IS THE POINT RATHER THAN PREMATURE
ABSTRACTION. Nothing outside this process calls a tool today; the in-process
agent could have had a bespoke signature and been three lines shorter. But this
interface is what a relocated agent, a second villa's console or a desktop
client would reach through, and inventing a private protocol now is a
self-inflicted migration the first time any of those exists. `name`,
`description`, `inputSchema` and content blocks are what MCP already publishes,
so the seam is free.

⚠️ A TOOL ERROR IS A RESULT, NOT AN EXCEPTION. The model has to read what went
wrong and try something else; raising past it ends the run and throws away every
turn already paid for. `fail()` is the only way to produce one, so the shape
cannot drift between tools.

⚠️ EVERY TOOL CAPS ITS OWN RESULT, AND THIS IS WHERE THAT IS ENFORCED RATHER
THAN REMEMBERED. The API is stateless, so every turn re-sends the whole
conversation INCLUDING previous tool results — an unfiltered 4,000-line dump is
re-read on every subsequent turn, which is how an agent's cost goes
super-linear. `truncate()` cuts with an explicit note, because a silent
truncation is a model reasoning confidently about the half it was given.
"""

from __future__ import annotations

import json

from typing import Any, Dict, List, Mapping, Protocol, Sequence

from vesta.supervise.agent import contracts

#: ⚠️ A CEILING IN CHARACTERS, NOT TOKENS, AND DELIBERATELY SO. Counting tokens
#: needs the provider's own tokeniser, which differs per provider and would make
#: this module depend on the seam it sits behind. Characters are a stable
#: over-estimate every provider agrees on, and the point is a bound rather than
#: a precise one.
DEFAULT_MAX_RESULT_CHARS: int = 8_000


def text(body: str) -> Dict[str, Any]:
    """One `text` content block."""
    return {"type": "text", "text": str(body)}


def data(payload: Any) -> Dict[str, Any]:
    """One `json` content block, for something the model should parse."""
    return {"type": "json", "json": payload}


def fail(code: str, message: str) -> Dict[str, Any]:
    """CTR-018. A tool error the model can read and route around.

    ⚠️ AN UNKNOWN CODE BECOMES `internal` RATHER THAN PASSING THROUGH. A code
    outside the contract is a bug in the tool, and letting it reach the model
    teaches it a vocabulary nothing else in the system speaks.
    """
    safe = code if contracts.is_valid(code, contracts.TOOL_ERROR_CODE) else "internal"
    return {"error": {"code": safe, "message": str(message)}}


async def resolved(value: Any) -> Any:
    """`value`, awaited if it is awaitable. The one idiom every tool with an
    injected source uses.

    ⚠️ THE RESULT IS TESTED, NOT THE SOURCE DECLARED ASYNC, and that is what
    keeps a synchronous fixture — a list, a lambda — a legal source: every unit
    test of a tool constructs it with one, while the villa hands it a
    coroutine that talks to Home Assistant. `tools/logs.py` had this inline;
    the four HA tools each needed it on 2026-09-04, and four more inline copies
    is how one of them would have forgotten to await.
    """
    import inspect
    return await value if inspect.isawaitable(value) else value


def flatten_blocks(blocks: Any) -> List[Dict[str, Any]]:
    """Our block vocabulary reduced to TEXT ONLY, for a wire that has no others.

    ⚠️ THIS PACKAGE SPEAKS THREE KINDS AND EVERY WIRE OUT OF IT SPEAKS ONE.
    `text()`, `data()` (a `json` block) and `fail()` (an `error` object with no
    `type` at all) are the internal vocabulary. MCP publishes text/image/audio/
    resource; the Anthropic Messages API accepts text/image/document/…; NEITHER
    has a `json` block and neither will take an untyped object. So both need the
    same reduction, and it lives here — in the module that owns the vocabulary —
    rather than once per consumer.

    ⚠️ IT WAS WRITTEN ONCE, FOR MCP, AND NOT FOR THE PROVIDER, WHICH IS WHAT
    SHIPPED. The villa's own log: `messages.3.content.0.tool_result.content.1:
    Input tag 'json' … does not match any of the expected tags`. Three turns in,
    tools called and run, and the RESULTS could not be sent back. The error
    branch had not been reached yet and was the next 400 queued behind it.

    ⚠️ SERIALISED, NEVER DROPPED. A tool that returned data must not look like a
    tool that returned nothing — the failure being indistinguishable from
    success is the whole reason this is not two lines.
    """
    out: List[Dict[str, Any]] = []
    for block in blocks if isinstance(blocks, (list, tuple)) else []:
        if not isinstance(block, Mapping):
            continue
        kind = str(block.get("type") or "")
        if kind == "text":
            out.append({"type": "text", "text": str(block.get("text") or "")})
        elif kind == "json":
            out.append({"type": "text",
                        "text": json.dumps(block.get("json"), default=str)})
        elif "error" in block:
            out.append({"type": "text",
                        "text": json.dumps(block["error"], default=str)})
    return out


#: How to narrow, when the caller has nothing more specific to say.
#:
#: ⚠️ GENERIC ENGLISH, NOT ARGUMENT NAMES, AND THAT IS THE WEAKNESS. `subject`
#: and `level` happen to be real arguments (`tools/concern.py`, `tools/logs.py`);
#: `window` is one of nothing. A model cannot act on advice that names no
#: parameter it can pass, which is why any caller that KNOWS its own schema
#: should pass a `hint` instead of accepting this — see `upstream._narrowing`.
NARROW_HINT: str = "window, subject or level"


def is_structured(body: str) -> bool:
    """Would cutting this produce INVALID data rather than partial data?

    ⚠️ THE CONTENT DECIDES, NOT THE BRANCH THAT PRODUCED IT, and picking the
    branch is how the first cut of this rule missed. `upstream._flatten` prefers
    an MCP `structuredContent` object and falls back to the server's text
    blocks — but Home Assistant's MCP server puts JSON in those text blocks too,
    so "did we take the structured branch" answers False for a payload that is
    every bit as unsafe to cut. A body that opens a brace or a bracket is a
    structure whatever route it arrived by.
    """
    return body.lstrip()[:1] in ("{", "[")


def refuse_if_oversized(body: str, limit: int = DEFAULT_MAX_RESULT_CHARS,
                        hint: str = NARROW_HINT) -> Dict[str, Any] | None:
    """`None` when `body` fits; a refusal the model can route around when not.

    ⚠️ PROSE MAY BE TRUNCATED; A STRUCTURE MAY NOT. `truncate`'s note ("answer
    from what you can see, then narrow") is right for a log excerpt, where the
    first half is still true. Half a JSON document is not half true — the keys
    that survive are an arbitrary prefix, and any value read from it is an
    artefact of where the cut landed.

    ⚠️ THIS LIVES HERE BECAUSE PUTTING IT IN ONE TOOL DID NOT HOLD, AND THAT IS
    THE SECOND HALF OF THE SAME DEFECT. 2.990.0 wrote this rule inside
    `tools/ha.py`, reached by our own two tools, after a truncated
    `read_configuration` made the model tell the owner their meter had stopped.
    Six days later the identical failure arrived through the OTHER door: asked
    for consumption since 5pm, the model called the upstream `ha_get_history`,
    whose reply for a meter reporting once a minute is ~45,000 characters;
    `UpstreamTool` truncated it at 8,000 and the answer came back as 6.67 kWh
    against a true 3.06 kWh. Rolling a shared rule out by its existing call
    sites rather than by everything it APPLIES to leaves exactly this.

    ⚠️ AND THE REFUSAL CARRIES THE SIZE AND THE WAY OUT. `fail` is data the
    model reads and routes around; told only "too big" it re-asks the same
    question, so `hint` names arguments the called tool actually publishes.
    """
    if len(body) <= limit:
        return None
    from vesta.supervise.agent import limits as limits_mod
    limits_mod.note("too_large", f"{len(body):,} characters")
    return fail("too_large", (
        f"that returned {len(body):,} characters, far more than can be read, "
        f"and a part of it would be meaningless — half a structure is not half "
        f"an answer. Ask again for less: name the specific thing you want "
        f"rather than everything, narrow by {hint}, and use a coarser grouping "
        f"or a shorter period if the command takes one."))


def truncate(body: str, limit: int = DEFAULT_MAX_RESULT_CHARS,
             hint: str = NARROW_HINT) -> str:
    """Cut to `limit`, and SAY SO.

    ⚠️ THE NOTE IS THE WHOLE VALUE. A silently truncated result is a model
    reasoning confidently about the half it happened to receive, and concluding
    something false with every appearance of rigour. Told it was cut, it can ask
    for the rest — which is why the note names how much is missing.

    ⚠️ AND `hint` NAMES ARGUMENTS THE CALLED TOOL ACTUALLY HAS. The default is
    generic wording that matches no upstream parameter at all (see
    `NARROW_HINT`): told to narrow by a name it cannot pass, a model re-asks the
    same broad question or answers from the half it got. Measured on the villa —
    a whole-villa `ha_search` was cut, and the model reported it "could not
    resolve which lights are in the gym" instead of re-asking with the area and
    domain filters that tool publishes.
    """
    if len(body) <= limit:
        return body
    dropped = len(body) - limit
    # ⚠️ AND SAY SO TO THE READER TOO. The note below is for the MODEL; until
    # 2.981.0 the person who asked was told nothing, so an answer built on half
    # a search looked exactly like a complete one. See agent/limits.
    from vesta.supervise.agent import limits as limits_mod
    limits_mod.note("truncated", f"{dropped:,} characters not read")
    # ⚠️ AND IF IT IS A STRUCTURE, THE CALLER SHOULD NOT HAVE BROUGHT IT HERE —
    # SAY SO IN THE LOG RATHER THAN CUT IT SILENTLY. Twice now a caller has
    # handed JSON to this function and the model has answered a question with a
    # figure read out of an arbitrary prefix: `read_configuration` in 2.990.0
    # (the meter reported as dead) and every upstream tool in 2.992.0 (6.67 kWh
    # against a true 3.06). Both were found by reading the villa's recorder by
    # hand, because nothing anywhere announced the cut. A guard in a test only
    # covers the tools that exist today; this one travels with the function, so
    # the NEXT caller to make this mistake is visible in the add-on log the
    # first time it happens rather than after the wrong number reaches somebody.
    if is_structured(body):
        from vesta.adapters.log import log as _log
        _log(f"truncate: cut {dropped:,} characters off a STRUCTURED result — "
             f"a JSON fragment is invalid data, not partial data; this caller "
             f"should refuse_if_oversized() instead")
    return (body[:limit]
            + f"\n[... {dropped} more characters not shown. Narrow the query "
              f"— {hint} — rather than asking for all of it.]")


class Tool(Protocol):
    """What every tool must expose. Shaped exactly as MCP publishes it."""

    name: str
    description: str
    inputSchema: Dict[str, Any]

    async def call(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        """Content blocks, or a single error object from `fail()`."""
        ...


class BaseTool:
    """Shared plumbing. Subclasses set the four class attributes and `run`.

    ⚠️ `call` CATCHES EVERYTHING AND RETURNS AN ERROR BLOCK. The package rule is
    degrade-never-fail, and a tool that raises takes down the run rather than the
    call. The traceback still reaches the log through `swallow`; what the model
    receives is something it can act on.
    """

    name: str = ""
    description: str = ""
    inputSchema: Dict[str, Any] = {"type": "object", "properties": {}}
    #: Which tiers a tool is MEANT for. ⚠️ DOCUMENTATION, NOT ENFORCEMENT, AND
    #: THIS SAID THE OPPOSITE UNTIL /dry-audit CHECKED IT — "enforced by the
    #: registry reading this" was written when the design was drawn, and nothing
    #: has ever read `.tiers`: `grep -rn "\.tiers\b"` over the whole tree returns
    #: no reader. What actually keeps triage from writing is TWO real mechanisms
    #: below and beside it — `policy.may_use_tool` denies every non-READ `mode`
    #: to the triage tier, and `triage.registry_for` narrows the tool set to
    #: `TRIAGE_TOOLS` BY NAME. Both are tested. A reader coming here to add a
    #: tool must set `mode` correctly; setting `tiers` alone protects nothing.
    #: It is kept because it states intent at the tool, which is where a reader
    #: looks first — but a comment claiming a gate that does not exist is worse
    #: than no comment, and this one invited exactly that mistake.
    tiers: Sequence[str] = ("triage", "reason")
    #: READ or WRITE. The registry refuses a WRITE tool to a read-only run.
    mode: str = "READ"

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        raise NotImplementedError

    async def call(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        if not isinstance(args, Mapping):
            return [fail("invalid_args", "arguments must be an object")]
        missing = [name for name in self.inputSchema.get("required", [])
                   if name not in args]
        if missing:
            return [fail("invalid_args",
                         f"missing required argument(s): {', '.join(missing)}")]
        try:
            return await self.run(args)
        except Exception as err:  # noqa: BLE001 - degrade, never fail
            from vesta.adapters.log import swallow
            swallow(f"tool {self.name} failed", err)
            return [fail("internal", f"{self.name} could not complete: {err}")]

    def describe(self) -> Dict[str, Any]:
        """The registration record, in MCP's own shape."""
        return {"name": self.name, "description": self.description,
                "inputSchema": self.inputSchema}
