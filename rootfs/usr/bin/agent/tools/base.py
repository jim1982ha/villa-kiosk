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

from typing import Any, Dict, List, Mapping, Optional, Protocol, Sequence

from agent import contracts

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


def truncate(body: str, limit: int = DEFAULT_MAX_RESULT_CHARS) -> str:
    """Cut to `limit`, and SAY SO.

    ⚠️ THE NOTE IS THE WHOLE VALUE. A silently truncated result is a model
    reasoning confidently about the half it happened to receive, and concluding
    something false with every appearance of rigour. Told it was cut, it can ask
    for the rest — which is why the note names how much is missing.
    """
    if len(body) <= limit:
        return body
    dropped = len(body) - limit
    return (body[:limit]
            + f"\n[... {dropped} more characters not shown. Narrow the query "
              f"— window, subject or level — rather than asking for all of it.]")


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
    #: Which tiers may invoke this. ⚠️ Triage cannot act, cannot notify and
    #: cannot write — enforced by the registry reading this, never by asking the
    #: model to behave.
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
            from reports.log import swallow
            swallow(f"tool {self.name} failed", err)
            return [fail("internal", f"{self.name} could not complete: {err}")]

    def describe(self) -> Dict[str, Any]:
        """The registration record, in MCP's own shape."""
        return {"name": self.name, "description": self.description,
                "inputSchema": self.inputSchema}
