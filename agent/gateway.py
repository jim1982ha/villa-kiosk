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

#: The tool that answers "what is on this property, in summary".
#:
#: ⚠️ MEASURED AGAINST A REAL GATEWAY, NOT GUESSED. The first cut listed two
#: candidate tools and then tried to recognise "entities" in whatever came
#: back — it had never seen a reply. `ha_get_overview` is a SUMMARY tool: it
#: returns `system_summary.total_entities`, per-domain counts, and a sample of
#: ten entities per domain carrying friendly names and NO ids. Nothing in that
#: is an enumeration, so no amount of shape-sniffing could have found one.
#:
#: ⚠️ CHOSEN FROM WHAT THE SERVER ADVERTISES. A tool named here that the
#: connected ha-mcp does not offer is not called, and the gateway REFUSES
#: rather than reporting an empty property — an empty list and "I could not
#: ask" are different answers and only one is a reason to raise an alarm.
OVERVIEW_TOOL = "ha_get_overview"

#: The JSON-RPC handshake an MCP server expects before any tool call.
PROTOCOL_VERSION = "2025-06-18"

#: stateless_http servers answer either shape depending on the Accept header.
ACCEPT = "application/json, text/event-stream"


class GatewayError(RuntimeError):
    """The gateway could not answer. Never a silently empty result."""


#: ⚠️ THE TRANSPORT CARRIES HEADERS BOTH WAYS NOW, AND MCP REQUIRES IT. The
#: streamable-HTTP transport returns an `Mcp-Session-Id` on `initialize` that
#: every later request must echo, and it expects a protocol-version header. A
#: transport that could only send a body and return JSON could not speak the
#: protocol at all — it worked against a stub and not against a server.
#:
#: Returns (parsed JSON or None for an empty body, response headers).
Transport = Callable[
    [str, dict[str, Any], dict[str, str]],
    Awaitable[tuple[dict[str, Any] | None, dict[str, str]]],
]


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
        #: Handed out by `initialize` and required on every later request.
        self._session_id: str | None = None
        self._next_id = 1

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
        # A different server is a different tool catalogue AND a different
        # session; ADR-0012 is explicit that the catalogue must never be
        # carried across, and a session id from another server is worse.
        self._tools = {}
        self._session_id = None
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
    def _headers(self) -> dict[str, str]:
        headers = {"MCP-Protocol-Version": PROTOCOL_VERSION}
        if self._session_id:
            # ⚠️ REQUIRED ON EVERY REQUEST AFTER `initialize`. The streamable
            # HTTP transport hands out a session id and refuses later calls
            # without it; a client that drops it gets one good handshake and
            # nothing else.
            headers["Mcp-Session-Id"] = self._session_id
        return headers

    async def _rpc(self, method: str, params: dict[str, Any],
                   notify: bool = False) -> Any:
        """One JSON-RPC call. `notify` sends no id and expects no result."""
        if not self.url:
            raise GatewayError("no ha-mcp address is configured — paste it on "
                               "the add-on's Configuration page")
        request: dict[str, Any] = {"jsonrpc": "2.0", "method": method,
                                   "params": params}
        if not notify:
            request["id"] = self._next_id
            self._next_id += 1
        body, headers = await self._transport(self.url, request, self._headers())
        session = headers.get("mcp-session-id") or headers.get("Mcp-Session-Id")
        if session:
            self._session_id = session
        if notify:
            # ⚠️ AN EMPTY BODY IS CORRECT HERE AND ONLY HERE. A notification is
            # answered with 202 and nothing, which is exactly what tripped the
            # first cut into reporting "Expecting value: line 1 column 1".
            return None
        if body is None:
            raise GatewayError(
                f"{method}: reached the gateway (HTTP "
                f"{headers.get('x-vesta-status', '?')}, "
                f"{headers.get('content-type', 'no content-type')}) but the body "
                f"was empty. That is what a notification is answered with, not a "
                f"call — the address is right and something about the request is "
                f"not what this server expects.")
        if "error" in body:
            err = body["error"]
            raise GatewayError(f"{method}: {err.get('message', err)}")
        if "result" not in body:
            raise GatewayError(f"{method}: no result in the gateway's reply")
        return body["result"]

    async def connect(self) -> Link:
        """Handshake and re-read the tool catalogue. Safe to call repeatedly."""
        try:
            # A fresh handshake is a fresh session; carrying the old id across a
            # reconnect is how a client ends up talking to a session the server
            # has already forgotten.
            self._session_id = None
            await self._rpc("initialize", {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "vesta-ai", "version": "0"},
            })
            # ⚠️ REQUIRED BY THE PROTOCOL, AND EASY TO SKIP BECAUSE NOTHING
            # ANSWERS IT. The server is entitled to refuse everything until the
            # client confirms the handshake is complete.
            await self._rpc("notifications/initialized", {}, notify=True)
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

    async def overview(self) -> dict[str, Any]:
        """What the gateway says is on this property, in summary."""
        if OVERVIEW_TOOL not in self._tools:
            raise GatewayError(
                f"the connected ha-mcp does not offer `{OVERVIEW_TOOL}` — this "
                f"layer cannot see the property through it. Refusing rather "
                f"than reporting an empty one.")
        return _payload_of(await self.call_tool(OVERVIEW_TOOL, {}))

    async def entity_count(self) -> int:
        """How many entities Home Assistant knows about.

        ⚠️ THE FIGURE THE GATEWAY ITSELF REPORTS, not a length this layer
        counted. `system_summary.total_entities` is the whole property; the
        per-domain `entities` lists beside it are TRUNCATED SAMPLES of ten and
        carry no ids, so counting those would silently under-report a property
        by an order of magnitude and look entirely plausible doing it.
        """
        summary = (await self.overview()).get("system_summary")
        if not isinstance(summary, dict) or "total_entities" not in summary:
            raise GatewayError(
                f"`{OVERVIEW_TOOL}` answered without a system summary — this "
                f"gateway's replies are not the shape this layer knows. Its "
                f"tool set moves in minor releases; pin `auto_update: false` "
                f"on that add-on.")
        try:
            return int(summary["total_entities"])
        except (TypeError, ValueError):
            raise GatewayError(
                f"`{OVERVIEW_TOOL}` reported a total this layer cannot read: "
                f"{summary['total_entities']!r}") from None


def _text_of(result: dict[str, Any]) -> str:
    parts = [c.get("text", "") for c in result.get("content", [])
             if isinstance(c, dict)]
    return " ".join(p for p in parts if p) or "no detail"


def _payload_of(result: Any) -> dict[str, Any]:
    """Unwrap a tool result to the object the tool actually returned.

    ⚠️ THIS UNWRAPS THE MCP ENVELOPE AND NOTHING ELSE. The first version tried
    to RECOGNISE an entity list inside whatever came back — `entities`,
    `results`, `items`, `states` — which was guessing at a contract nobody had
    read. MCP's envelope is the only part that genuinely varies: a result may
    carry `structuredContent`, or JSON inside a text `content` block. What the
    tool put in there is the tool's business, and the caller checks it.
    """
    if isinstance(result, dict):
        inner = result.get("structuredContent")
        if isinstance(inner, dict):
            return _payload_of(inner)
        blocks = result.get("content")
        if isinstance(blocks, list):
            import json
            for block in blocks:
                if not isinstance(block, dict) or "text" not in block:
                    continue
                try:
                    parsed = json.loads(block["text"])
                except ValueError:
                    continue
                if isinstance(parsed, dict):
                    return parsed
        # Already unwrapped — a server that answers the object directly.
        if result:
            return result
    raise GatewayError(
        f"the gateway answered {type(result).__name__} with nothing this layer "
        f"can read — refusing rather than reporting an empty property")
