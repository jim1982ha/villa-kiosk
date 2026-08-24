"""The extraction seam: this villa's tools, over MCP, behind the same gate.

⚠️ ITS PURPOSE IS NOT HOME ASSISTANT INTEGRATION, AND MISREADING THAT IS HOW IT
WOULD GET BUILT WRONG. Nothing in this deployment calls it today. It exists so
that the day the agent runs on a second box — or a desktop client, or a console
serving several villas — there is already ONE way in, rather than a second path
invented under time pressure with its own idea of what is permitted. ADR-006.

⚠️ ONE REGISTRY, ONE GATE, TWO CONSUMERS (ARCH-012). Every call lands in
`registry.invoke`, the same function the in-process loop uses — same
`may_use_tool`, same `record_intent`, same scrub. `test_agent_mcp` asserts the
two paths write IDENTICAL AUDIT ROWS for the same call, and it asserts on the
AUDIT rather than on the response, because a matching response only proves the
tools agree while a matching audit row proves the GATE is the same object. Two
gates would agree on the day they were written and diverge on the first change
to either.

⚠️ THE EXPORT SET IS AN ALLOW-LIST OVER `contracts.TOOL_MODE`, NOT A DENY-LIST
OF NAMES (REQ-047). `READ`, plus one named write. So `act_service` — which this
line predicted before it existed (written 2.623.0; the tool arrived in 2.646.0)
— is off this surface without anybody touching this file, because it is `ACT`
and `ACT` is not on the list. A deny-list of names would have needed somebody to
remember, at exactly the moment they were thinking about actuation rather than
about MCP. **It worked**: the tool arrived and this list did not change.

⚠️ AND THE AUTHORITY STAYS VILLA-SIDE (ARCH-011). A relocated agent gains no
permission it did not have in-process: `policy.py`, the audit ledger and the
concern store are all on this side of the wire, and the caller's own beliefs
about what it may do reach nothing. That is what makes v2 relocation a config
change rather than a security redesign.

⚠️ NO TOKEN MEANS NO SERVICE, NEVER OPEN SERVICE. An unconfigured endpoint
refuses every request. The alternative — serving while unconfigured — is an
open tool surface on the LAN that nobody would notice was open.
"""

from __future__ import annotations

import hmac
import json
from dataclasses import replace
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from agent import contracts, policy as policy_mod
from agent.registry import Registry, build_registry, invoke
from agent.tools.base import BaseTool, flatten_blocks
from reports import secrets
from reports.log import log

#: The bearer token's name in the 0600 secrets file. ⚠️ It is a SECRET, not a
#: config value: `/agent-config` is readable by any authorised session, and a
#: token stored there would be handed to every browser that loads the tab.
TOKEN_NAME: str = "agent_mcp_token"

#: The protocol revision this server implements.
PROTOCOL_VERSION: str = "2025-06-18"

SERVER_NAME: str = "vesta"

#: ⚠️ THE ONE WRITE ON THIS SURFACE, NAMED RATHER THAN INFERRED. Raising a
#: concern is how a remote agent says anything at all — without it the endpoint
#: is a read-only mirror and the extraction seam does not carry the product.
#: It is also the ONLY write that cannot touch the villa: it appends a record a
#: person then reads. Everything else that writes is `ACT` and is not here.
#:
#: ⚠️ AND THE TOOL IS NOT IN THE SHIPPED REGISTRY THIS FILTERS, SO THIS SURFACE
#: CURRENTLY PUBLISHES NO WRITE AT ALL. That is a fact about the tool rather than
#: a gap in this list: `raise_concern` is built per RUN by `runtime.investigate`,
#: bound to that run's ref table, evidence accumulator and frozen policy — none
#: of which an MCP caller has. An unbound instance would resolve no handle, cite
#: no evidence and write to no store, so exporting one would publish a verb that
#: always refuses. Serving it means giving a remote caller a run to be part of,
#: which is a design question and not a line in this tuple. The allow-list stays
#: as it is: it states the intent, and `test_agent_mcp` proves it admits nothing
#: else.
EXPORTED_WRITES: Tuple[str, ...] = ("raise_concern",)

#: ⚠️ AN ALLOW-LIST OF MODES. Not `!= "ACT"` — that is a deny-list wearing an
#: allow-list's syntax, and a fourth mode added later would be exported by
#: default. See the module docstring.
EXPORTED_MODES: Tuple[str, ...] = ("READ",)


def exported(registry: Registry) -> List[BaseTool]:
    """The tools this endpoint publishes. REQ-047.

    ⚠️ THE FILTER IS THE SECURITY PROPERTY, so it is a function rather than a
    comprehension inlined into the handler — `test_agent_mcp` calls it directly
    and asserts an `ACT` tool never survives it, without needing an HTTP server.
    """
    out: List[BaseTool] = []
    for name in registry.names:
        tool = registry.get(name)
        if tool is None:
            continue
        mode = str(getattr(tool, "mode", "")).upper()
        if mode in EXPORTED_MODES or name in EXPORTED_WRITES:
            out.append(tool)
    return out


def authorised(header: Optional[str]) -> bool:
    """Is this `Authorization:` header the configured bearer token?

    ⚠️ `hmac.compare_digest`, NOT `==`. A string comparison returns early on the
    first differing byte, which leaks the token one character at a time to
    anyone who can time the response — and this endpoint is on a LAN a guest's
    phone is also on.

    ⚠️ AND AN UNCONFIGURED TOKEN REFUSES rather than admits. `secrets.get`
    returning None must never be read as "no check required".
    """
    token = secrets.get(TOKEN_NAME)
    if not token:
        return False
    value = str(header or "")
    prefix = "Bearer "
    if not value.startswith(prefix):
        return False
    return hmac.compare_digest(value[len(prefix):], str(token))


def _policy_for(config: Optional[Mapping[str, Any]],
                registry: Optional[Registry] = None,
                session: Any = None) -> policy_mod.RunPolicy:
    """The policy an MCP caller runs under.

    ⚠️ IT IS BUILT HERE, FROM CONFIG, AND NEVER FROM THE REQUEST. A caller that
    could describe its own policy would be a caller that grants itself
    permissions, which is the whole failure ARCH-011 names. `act_enabled` is
    hard `False` on this surface whatever the villa's config says — nothing
    exported here actuates, so granting it would be authority with no use, and
    authority with no use is the kind that survives a refactor unnoticed.
    """
    names = [t.name for t in exported(registry or build_registry(session=session))]
    # ⚠️ THROUGH `for_run`, NOT BY CONSTRUCTING A RunPolicy HERE. That function
    # is the one place config is read into authority; a second constructor is a
    # second interpretation of the same settings, and it would drift silently
    # because both would look right.
    base = policy_mod.for_run(config, tier="reason", tool_names=names)
    return replace(base, act_enabled=False)


# ── the JSON-RPC surface ────────────────────────────────────────────────────
def _ok(request_id: Any, result: Any) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _err(request_id: Any, code: int, message: str) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id,
            "error": {"code": code, "message": str(message)}}


async def handle(message: Mapping[str, Any], *,
                 registry: Optional[Registry] = None,
                 config: Optional[Mapping[str, Any]] = None,
                 session: Any = None,
                 actor: str = "mcp",
                 run_id: str = "") -> Optional[Dict[str, Any]]:
    """One JSON-RPC message. Returns the reply, or None for a notification.

    ⚠️ TRANSPORT-FREE ON PURPOSE. Every rule worth testing — the export filter,
    the gate, the audit row — is reachable from here with no socket, which is
    what lets `test_agent_mcp` compare an MCP call against an in-process one in
    the same process and assert on the ledger both wrote.
    """
    # ⚠️ THE SESSION REACHES THE REGISTRY HERE TOO. Without it this surface
    # published Home Assistant's own tools and answered every call to one with
    # `no session to reach the MCP server` — an MCP server advertising a
    # catalogue it cannot serve, which is worse than not advertising it.
    reg = (registry if registry is not None
           else build_registry(session=session))
    method = str(message.get("method") or "")
    request_id = message.get("id")

    if method == "initialize":
        return _ok(request_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": SERVER_NAME,
                           "version": str(contracts.CONTRACT_VERSION)},
        })

    if method in ("notifications/initialized", "notifications/cancelled"):
        # ⚠️ A NOTIFICATION HAS NO `id` AND MUST GET NO REPLY. Answering one is
        # a protocol error the client is entitled to drop the connection over.
        return None

    if method == "ping":
        return _ok(request_id, {})

    if method == "tools/list":
        return _ok(request_id, {"tools": [t.describe() for t in exported(reg)]})

    if method == "tools/call":
        params = message.get("params")
        params = params if isinstance(params, Mapping) else {}
        name = str(params.get("name") or "")
        args = params.get("arguments")
        args = args if isinstance(args, Mapping) else {}

        # ⚠️ CHECKED AGAINST THE EXPORT SET FIRST, BEFORE THE REGISTRY IS ASKED.
        # `registry.invoke` would gate it too — `_policy_for` builds
        # `allowed_tools` from the same filter — but a caller naming an
        # unexported tool deserves to be told it does not exist HERE rather
        # than to have the answer depend on two agreeing lists.
        if name not in {t.name for t in exported(reg)}:
            return _ok(request_id, {
                "isError": True,
                "content": [{"type": "text",
                             "text": f"no tool named {name!r}"}]})

        outcome = await invoke(reg, policy=_policy_for(config, reg), name=name,
                               args=args, run_id=str(run_id or _run_id()),
                               actor=str(actor))
        return _ok(request_id, {
            "isError": not outcome.allowed,
            "content": _as_content(outcome.blocks),
        })

    return _err(request_id, -32601, f"unknown method {method!r}")


def _as_content(blocks: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """Our content blocks in MCP's own shape.

    ⚠️ DELEGATES. The reduction is identical for every wire out of this package
    — see `tools.base.flatten_blocks` — and having it here as well is how the
    provider path came to be missing it entirely.
    """
    return flatten_blocks(list(blocks))


_SEQ: List[int] = [0]


def _run_id() -> str:
    """A per-call run id for an MCP caller that supplied none.

    ⚠️ SEQUENTIAL, NOT RANDOM AND NOT A HASH — the same choice `refs.py` makes.
    It has to be correlatable inside one process lifetime (an intent row and its
    outcome row) and MUST NOT be correlatable across restarts or across villas.
    """
    _SEQ[0] += 1
    return f"mcp{_SEQ[0]}"


# ── the aiohttp handler ─────────────────────────────────────────────────────
async def http_handler(request: Any) -> Any:
    """POST /agent-mcp. Streamable HTTP: one JSON-RPC message, one reply.

    ⚠️ REGISTERED ON THE PROXY BUT DELIBERATELY GIVEN NO NGINX `location`, WHICH
    IS THE OPPOSITE OF EVERY OTHER ROUTE IN THIS APP AND IS THE POINT. nginx is
    an explicit per-endpoint allow-list in front of Ingress; a route with no
    block is unreachable from the tablet, from a phone and from anything
    Home Assistant proxies — which is exactly the posture REQ-046 asks for. It
    is reachable only from inside the add-on's own network namespace.
    `test_nginx_routes` therefore has to know this route is exempt, or it would
    correctly fail; the exemption is stated there with this reason.
    """
    from aiohttp import web

    if not authorised(request.headers.get("Authorization")):
        # ⚠️ 401 WITH NO DETAIL. "Token not configured" and "wrong token" are
        # the same answer, because telling them apart tells a prober whether
        # this villa has an MCP token worth guessing.
        return web.json_response({"error": "unauthorized"}, status=401)

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return web.json_response(_err(None, -32700, "invalid JSON"), status=400)

    if not isinstance(body, Mapping):
        return web.json_response(_err(None, -32600, "expected an object"),
                                 status=400)

    # ⚠️ THE APP'S SHARED SESSION, like every other handler in the proxy. A
    # per-request ClientSession opens its own connector and TLS context for one
    # call and closes them again.
    reply = await handle(body, session=request.app["session"])
    if reply is None:
        return web.Response(status=202)
    log(f"mcp {body.get('method')!r} answered")
    return web.json_response(reply)
