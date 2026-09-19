"""ha-mcp: the gateway for everything the layer asks about the villa.

⚠️ THE MODEL NEVER SEES THESE TOOLS, AND THAT IS THE WHOLE ECONOMICS OF IT.
Registering ha-mcp as an MCP server on the model was measured at 47k-88k tokens
of prefix — against a plan whose entire monthly budget is ~205k. Our own code
calling it over plain HTTP costs zero prefix, which is why ADR-0012 could give
the owner the single gateway they asked for three times.

⚠️ AND IT IS AN ORDINARY OUTBOUND HTTP CALL. No `hassio_api`, no `hassio_role`:
the secret is a path prefix, so addressing is the whole of the credential. The
privilege is not avoided but RELOCATED — every read executes inside a process
that holds `manager` — which is a reason to read narrowly, not a reason to relax.

⚠️ THE TOOL CATALOGUE IS RE-READ ON EVERY CONNECT, NEVER CACHED FOR THE
PROCESS'S LIFE. ha-mcp ships roughly biweekly with no deprecation policy and
moves its tool set in MINOR releases; a long-lived client that caches the
catalogue is bitten silently after an auto-update. This was observed during the
investigation, on the investigating harness itself.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable

from agent.health import Link, LinkState

#: What we are willing to call to enumerate the villa, best first.
#:
#: ⚠️ CHOSEN FROM WHAT THE SERVER ADVERTISES, NEVER ASSUMED. A tool named here
#: that the connected ha-mcp does not offer is skipped; if NONE of them is
#: offered the gateway REFUSES rather than returning an empty villa, because an
#: empty list and "I could not ask" are different answers and only one of them
#: is a reason to raise an alarm.
ENTITY_TOOLS: tuple[str, ...] = ("ha_get_overview", "ha_search")

#: The JSON-RPC handshake an MCP server expects before any tool call.
PROTOCOL_VERSION = "2025-06-18"

#: stateless_http servers answer either shape depending on the Accept header.
ACCEPT = "application/json, text/event-stream"


class GatewayError(RuntimeError):
    """The gateway could not answer. Never a silently empty result."""


Transport = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]


def endpoint(url: str, secret: str) -> str:
    """Join the address an operator pasted with the secret they pasted.

    The secret is a PATH PREFIX, so the two compose into one URL — and an
    operator who pasted a URL that already ends with the secret must not end up
    calling it twice. Being forgiving here costs nothing; a 404 an hour after
    installation costs an evening.
    """
    base = (url or "").strip().rstrip("/")
    tail = (secret or "").strip().strip("/")
    if not base or not tail:
        return base
    return base if base.endswith("/" + tail) else f"{base}/{tail}"


class Gateway:
    """A thin JSON-RPC client for one ha-mcp server.

    `transport` is injected so every test pins what the gateway ASKED rather
    than what a live property happened to answer.
    """

    def __init__(self, url: str, secret: str, transport: Transport) -> None:
        self.url = endpoint(url, secret)
        self._transport = transport
        self._tools: dict[str, dict[str, Any]] = {}
        self._link = Link(LinkState.UNKNOWN, "not connected yet")

    def reconfigure(self, url: str, secret: str) -> bool:
        """Point at a different ha-mcp. Returns whether anything changed.

        ⚠️ WITHOUT THIS, A SAVED ADDRESS NEVER ARRIVED. The settings screen
        writes the file, the layer re-reads it on its heartbeat — and this
        object was built once at startup from the values that existed then, so
        it went on reporting "no ha-mcp address is configured" forever while the
        operator looked at an address they had definitely saved. Re-reading the
        settings is not the same as applying them.
        """
        fresh = endpoint(url, secret)
        if fresh == self.url:
            return False
        self.url = fresh
        # A different server is a different tool catalogue, and ADR-0012 is
        # explicit that it must never be carried across.
        self._tools = {}
        self._link = Link(LinkState.UNKNOWN, "address changed — not connected yet")
        return True

    # ── state ──────────────────────────────────────────────────────────────
    @property
    def link(self) -> Link:
        return self._link

    @property
    def tools(self) -> tuple[str, ...]:
        return tuple(sorted(self._tools))

    # ── wire ───────────────────────────────────────────────────────────────
    async def _rpc(self, method: str, params: dict[str, Any]) -> Any:
        if not self.url:
            raise GatewayError("no ha-mcp address is configured — paste it on "
                               "the add-on's Configuration page")
        body = await self._transport(self.url, {
            "jsonrpc": "2.0", "id": 1, "method": method, "params": params,
        })
        if "error" in body:
            err = body["error"]
            raise GatewayError(f"{method}: {err.get('message', err)}")
        if "result" not in body:
            raise GatewayError(f"{method}: no result in the gateway's reply")
        return body["result"]

    async def connect(self) -> Link:
        """Handshake and re-read the tool catalogue. Safe to call repeatedly."""
        try:
            await self._rpc("initialize", {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "vesta-ai", "version": "0"},
            })
            listed = await self._rpc("tools/list", {})
            tools = listed.get("tools", []) if isinstance(listed, dict) else []
            # Re-read, not merge: a tool REMOVED upstream must disappear here
            # too, or the layer keeps calling something that no longer exists.
            self._tools = {t["name"]: t for t in tools if isinstance(t, dict)
                           and "name" in t}
            if not self._tools:
                self._link = Link(LinkState.DOWN, "the gateway advertises no tools")
            else:
                self._link = Link(LinkState.UP, f"{len(self._tools)} tools")
        except GatewayError as exc:
            self._tools = {}
            self._link = Link(LinkState.DOWN, str(exc))
        except Exception as exc:  # transport failures are the common case
            self._tools = {}
            self._link = Link(LinkState.DOWN, f"{type(exc).__name__}: {exc}")
        return self._link

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        if name not in self._tools:
            raise GatewayError(
                f"the connected ha-mcp does not offer `{name}` — it advertises "
                f"{len(self._tools)} tools. Its tool set moves in minor releases; "
                f"pin `auto_update: false` on that add-on.")
        result = await self._rpc("tools/call", {"name": name, "arguments": arguments})
        if isinstance(result, dict) and result.get("isError"):
            raise GatewayError(f"{name}: {_text_of(result)}")
        return result

    async def entities(self) -> list[dict[str, Any]]:
        """Every entity the villa has, read read-only through the gateway."""
        for name in ENTITY_TOOLS:
            if name in self._tools:
                return _entities_from(await self.call_tool(name, {}))
        raise GatewayError(
            "the connected ha-mcp offers none of "
            f"{', '.join(ENTITY_TOOLS)} — this layer cannot enumerate the villa "
            "through it. Refusing rather than reporting an empty property.")


def _text_of(result: dict[str, Any]) -> str:
    parts = [c.get("text", "") for c in result.get("content", [])
             if isinstance(c, dict)]
    return " ".join(p for p in parts if p) or "no detail"


def _entities_from(result: Any) -> list[dict[str, Any]]:
    """Pull entity rows out of whatever shape the tool answered with.

    ⚠️ SHAPE-TOLERANT ON PURPOSE, BUT NOT SILENTLY. MCP wraps a tool result in
    `content` blocks and may also carry `structuredContent`; which one a given
    ha-mcp release uses is not a contract we control. What this must never do is
    return [] for a shape it did not recognise — that reads as "the villa has no
    entities", which is a sentence this layer would act on.
    """
    if isinstance(result, dict):
        for key in ("structuredContent", "result"):
            if isinstance(result.get(key), (dict, list)):
                return _entities_from(result[key])
        for key in ("entities", "results", "items", "states"):
            if isinstance(result.get(key), list):
                return [e for e in result[key] if isinstance(e, dict)]
        if "content" in result:
            import json
            for block in result.get("content", []):
                if not isinstance(block, dict) or "text" not in block:
                    continue
                try:
                    return _entities_from(json.loads(block["text"]))
                except ValueError:
                    continue
        raise GatewayError(
            f"the gateway answered a shape this layer does not recognise "
            f"(keys: {sorted(result)[:6]}) — refusing rather than reporting an "
            f"empty villa")
    if isinstance(result, list):
        return [e for e in result if isinstance(e, dict)]
    raise GatewayError(f"the gateway answered {type(result).__name__}, not entities")
