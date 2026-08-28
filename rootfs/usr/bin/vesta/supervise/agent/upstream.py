"""Home Assistant's own MCP server, folded into this registry. ADR-023, TASK-113.

⚠️ THERE IS NO ADAPTER LAYER, AND THAT IS THE WHOLE POINT. `agent/registry.py`
has always been MCP-shaped — `name`, `description`, `inputSchema`,
`call -> content blocks` — because `agent/mcp_server.py` publishes it. So an
upstream `tools/list` maps into it almost exactly, and everything downstream
(`policy.may_use_tool`, the intent/outcome audit rows, `redact`, `truncate`, the
evidence contract) operates on the registry and does not change. One registry,
two backends, one gate.

⚠️ ADR-005 CHOSE THE OPPOSITE AND SET ITS OWN REVISIT CONDITION: "revisit if the
tool surface grows". It grew. ha_mcp serves 70+ tools while this add-on had four
hand-written readers and NO entity or area search at all — which is why "how
many lights are on in the gym room" was answered "the villa has no gym room",
about a room the villa owns, using a query ha_mcp has always had (v2.702.0).

⚠️ `reports/hass.py` DOES NOT LEAVE, AND THIS IS NOT A PREFERENCE. MCP is
request/response; `reports/collect.py` SUBSCRIBES to the HA event bus and is the
only thing listening to the villa's own `vesta_*` automations, which Home
Assistant discards immediately. "Consume ha_mcp for everything" is not an option
that exists. Because the websocket client therefore stays regardless, it is a
FREE fallback for an install that has no ha_mcp — which is REQ-067 honoured at
no cost.

⚠️ NOTHING HERE IS DISCOVERED BY NAME OR HARDCODED. The installed slug carries a
repository hash (`<hash>_ha_mcp`) that differs per install, so a literal would
be villa-specific data in shipped source — hard rule #1, and `test_hard_rules`
would catch it. Everything comes from the Supervisor at runtime.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List, Mapping, Optional, Sequence

from vesta.supervise.agent.tools.base import BaseTool
from vesta.supervise.agent.tools.base import DEFAULT_MAX_RESULT_CHARS
from vesta.supervise.agent.tools.base import NARROW_HINT
from vesta.supervise.agent.tools.base import fail
from vesta.supervise.agent.tools.base import truncate
from vesta.adapters.log import log, swallow

SUPERVISOR = "http://supervisor"
TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
AUTH = {"Authorization": f"Bearer {TOKEN}"}

#: How we recognise the add-on. ⚠️ A SUFFIX, NOT A SLUG. Home Assistant prefixes
#: every add-on slug with the hash of the repository it came from, so the full
#: slug is install-specific; the part after it is the add-on's own name and is
#: the same everywhere.
SLUG_SUFFIX: str = "_ha_mcp"

#: Where the tool list is kept between reads. ⚠️ ON DISK AND ON THE SAME CLOCK
#: AS THE CAPABILITY SURVEY, for the same reason: a tool list changes when
#: somebody updates an add-on, not every triage pass, and ~96 `tools/list`
#: round trips a day for an answer that moves monthly is the cost that left
#: this unwired in the first place.
CATALOGUE_FILE: str = "/data/vesta/upstream.json"
CATALOGUE_MAX_AGE_H: int = 24

#: ⚠️ THE TIMEOUT IS SHORT ON PURPOSE. This sits between a person's question and
#: its answer, and the upstream is one hop further away than the websocket it
#: replaces. A slow read must degrade to "I could not reach it" inside a turn
#: rather than holding a Telegram conversation open.
TIMEOUT_S: float = 20.0


# ── discovery ───────────────────────────────────────────────────────────────
async def _get(session: Any, url: str) -> Optional[Dict[str, Any]]:
    """One Supervisor GET, degrading to None. Never raises."""
    try:
        async with session.get(url, headers=AUTH, timeout=TIMEOUT_S) as resp:
            if resp.status != 200:
                return None
            body = await resp.json()
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow(f"could not read {url}", err)
        return None
    data = body.get("data") if isinstance(body, Mapping) else None
    return data if isinstance(data, Mapping) else None


async def endpoint(session: Any,
                   config: Optional[Mapping[str, Any]] = None) -> str:
    """The upstream's MCP URL, or "" if the add-on is not installed or running.

    ⚠️ THE SECRET PATH *IS* THE ENDPOINT — there is no `/mcp` suffix. Read from
    the add-on's own startup line rather than guessed: FastMCP reports
    `Starting MCP server 'ha-mcp' with transport 'http' (stateless) on
    http://0.0.0.0:9583/private_<...>`. A guessed `/mcp` would have 404'd.

    ⚠️ AND `(stateless)` IS WHY THIS FILE HAS NO SESSION HANDLING. Each call is
    an independent POST; there is no `initialize` handshake to keep alive, no
    session id to carry, and nothing to reconnect. That is the lowest-latency
    shape available and it removes the entire class of code that would
    otherwise sit between a question and its answer.
    """
    # ⚠️ THE CONFIGURED ADDRESS WINS, AND IS THE ONLY PATH THAT WORKS TODAY.
    # Automatic discovery needs `hassio_role: manager` — which also grants
    # installing and stopping add-ons — and this dashboard deliberately stays at
    # `default`. The owner pastes the address once; the listing below is kept
    # for a deployment that has chosen to grant the role, and costs one refused
    # request a day when it has not.
    from vesta.supervise.agent import config as agent_config
    configured = str(agent_config.view(config).get("mcp_url") or "").strip()
    if configured:
        return configured.rstrip("/")

    addons = await _get(session, f"{SUPERVISOR}/addons")
    if addons is None:
        # ⚠️ NAMES THE STEP, because "not reachable" covered four different
        # causes and the first fix addressed the wrong one. A refused LISTING is
        # a permission problem in this add-on's own manifest; a listing that
        # works and finds nothing is an ha_mcp that is absent or stopped. They
        # need opposite actions and read identically without this.
        log("upstream: the Supervisor refused the add-on listing "
            "(hassio_api + hassio_role: manager are both required)")
        return ""
    rows = (addons or {}).get("addons")
    slug = ""
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, Mapping) and str(row.get("slug", "")).endswith(SLUG_SUFFIX):
            slug = str(row.get("slug"))
            break
    if not slug:
        log(f"upstream: no add-on whose slug ends in {SLUG_SUFFIX!r} is "
            f"installed on this property")
        return ""
    info = await _get(session, f"{SUPERVISOR}/addons/{slug}/info")
    if not info or str(info.get("state")) != "started":
        # ⚠️ INSTALLED IS NOT RUNNING. A stopped add-on answers nothing, and
        # reporting it as present would make every tool call fail one by one
        # instead of falling back once.
        return ""
    host = str(info.get("hostname") or "")
    port = info.get("ingress_port")
    secret = str((info.get("options") or {}).get("secret_path") or "")
    if not host or not port:
        return ""
    return f"http://{host}:{port}{secret}"


# ── the wire ────────────────────────────────────────────────────────────────
async def rpc(session: Any, url: str, method: str,
              params: Optional[Mapping[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """One JSON-RPC call. Returns the `result` object, or None. Never raises.

    ⚠️ THE RESPONSE MAY BE JSON *OR* AN SSE FRAME, and handling only the first
    is the trap in streamable HTTP. The spec lets a server reply either way to
    the same request, so the `Accept` header offers both and the body is parsed
    by what came back rather than by what was hoped for.
    """
    payload = {"jsonrpc": "2.0", "id": 1, "method": method,
               "params": dict(params or {})}
    headers = {"Content-Type": "application/json",
               "Accept": "application/json, text/event-stream"}
    try:
        async with session.post(url, json=payload, headers=headers,
                                timeout=TIMEOUT_S) as resp:
            if resp.status >= 400:
                log(f"upstream {method} refused with HTTP {resp.status}")
                return None
            text = await resp.text()
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow(f"upstream {method} failed", err)
        return None

    body = _decode(text)
    if body is None:
        return None
    if "error" in body:
        log(f"upstream {method}: {str(body.get('error'))[:200]}")
        return None
    result = body.get("result")
    return result if isinstance(result, Mapping) else None


def _decode(text: str) -> Optional[Dict[str, Any]]:
    """A JSON body, or the last `data:` frame of an SSE stream."""
    raw = text.strip()
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
        except ValueError:
            return None
    last: Optional[Dict[str, Any]] = None
    for line in raw.splitlines():
        if line.startswith("data:"):
            try:
                parsed = json.loads(line[5:].strip())
            except ValueError:
                continue
            if isinstance(parsed, dict):
                last = parsed
    return last


# ── the read-only gate ──────────────────────────────────────────────────────
def mode_of(tool: Mapping[str, Any]) -> str:
    """`READ`, `ACT`, or a word that is neither — which DENIES.

    ⚠️ FROM THE TOOL'S OWN ANNOTATIONS, NEVER FROM ITS NAME. An unanchored name
    rule is a recurring false-positive source in this repository (`door` matches
    inside `outdoor`), and here it would fail in the dangerous direction: a tool
    called `ha_get_overview` reads, one called `ha_manage_backup` does not, and
    no prefix separates them reliably.

    ⚠️ AND AN UNANNOTATED TOOL RETURNS A MODE THAT IS NOT IN `TOOL_MODE`, which
    `policy.may_use_tool` already denies with "unknown tool mode" — deliberately
    reusing the existing fail-closed branch rather than adding a second one. A
    new upstream release adding a destructive tool is therefore unreachable
    until somebody classifies it, which is RISK-036's whole control.
    """
    ann = tool.get("annotations")
    if not isinstance(ann, Mapping):
        return "UNCLASSIFIED"
    if ann.get("readOnlyHint") is True:
        return "READ"
    # ⚠️ `destructiveHint` COUNTS, AND LEAVING IT OUT BROKE THE OWNER'S SWITCH.
    # Measured against the live server (ha-mcp 8.3.0, 78 tools): 41 of them —
    # `ha_call_service`, `ha_restart`, `ha_remove_entity`,
    # `ha_config_set_automation`, `ha_manage_backup` and the rest of the write
    # surface — declare `destructiveHint: True` and OMIT `readOnlyHint`
    # entirely. Reading only `readOnlyHint` classified all 41 as UNCLASSIFIED,
    # which denies them — the right OUTCOME while the gate is shut, and the
    # wrong REASON, because an unclassified tool stays denied even after an
    # owner turns actuation ON. The switch exists precisely so this capability
    # can be opened later; a classification that ignores the field 41 of 45
    # write tools actually use would have made it a switch that does nothing.
    if ann.get("readOnlyHint") is False or ann.get("destructiveHint") is True:
        return "ACT"
    # ⚠️ AND A TOOL THAT SAYS NEITHER IS STILL WITHHELD. Zero of the 78 are
    # silent today, so this branch is unreachable against the current upstream —
    # which is exactly why it must stay: it is the control for the release that
    # adds one (RISK-036), not for the release in front of us.
    return "UNCLASSIFIED"


class UpstreamTool(BaseTool):
    """One upstream tool, published through this registry unchanged.

    ⚠️ THE SCHEMA TRAVELS VERBATIM. Paraphrasing an upstream `inputSchema` is
    how a model is told the wrong argument names — and the upstream owns that
    contract, not us.
    """

    def __init__(self, spec: Mapping[str, Any], url: str, session_of: Any,
                 refs: Any = None) -> None:
        self.name = str(spec.get("name") or "")
        self.description = str(spec.get("description") or "")
        schema = spec.get("inputSchema")
        self.inputSchema = dict(schema) if isinstance(schema, Mapping) else {
            "type": "object", "properties": {}}
        self.mode = mode_of(spec)
        self._url = url
        self._session_of = session_of
        self._refs = refs

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        session = self._session_of()
        if session is None:
            return [fail("unavailable", "no session to reach the MCP server")]
        result = await rpc(session, self._url, "tools/call",
                           {"name": self.name, "arguments": dict(args)})
        if result is None:
            return [fail("unavailable",
                         "the Home Assistant MCP server did not answer")]
        # ⚠️ PSEUDONYMISED BEFORE TRUNCATION, AND BEFORE `redact` EVER SEES IT.
        # This tool did not build its result — Home Assistant's MCP server did,
        # and it speaks in entity ids. Every other tool in this registry calls
        # `RefTable.describe` and never holds one; this is where that boundary
        # is crossed for the ones that do.
        #
        # ⚠️ IT COST THE WHOLE INTEGRATION. `redact.audit` refuses any payload
        # containing an entity id, so from v2.705.0 to v2.710.0 EVERY upstream
        # result naming a device was replaced with "the result could not be
        # shown safely" — the model then answered from whatever aggregate it
        # still had, which is why "how many ceiling fans are on" came back as a
        # monitoring fault. Only id-free results (the floor/area list) got
        # through, which is exactly why the villa document looked healthy.
        #
        # ⚠️ AND THE REFUSAL NAMED AN ID THAT DOES NOT EXIST. `redact.scrub`
        # runs `inert`, which turns `_` into a space, so
        # `fan.a_first_unit` became `fan.a first unit` — still an entity id to
        # the detector, now a SHORTER one. So the refusal was logged against
        # `fan.a`, which is not a device of any villa, and sent the reader
        # hunting for something that never existed. Pseudonymising first means
        # scrub has no id left to mangle.
        text = _flatten(result)
        if self._refs is not None:
            from vesta.supervise.agent.refs import pseudonymise
            text = pseudonymise(text, self._refs)
        return [{"type": "text",
                 "text": truncate(text, DEFAULT_MAX_RESULT_CHARS,
                                  hint=_narrowing(self.inputSchema, args))}]


def _narrowing(schema: Mapping[str, Any], args: Mapping[str, Any]) -> str:
    """The arguments this call did NOT use, as advice for narrowing it.

    ⚠️ DERIVED FROM THE UPSTREAM SCHEMA, NEVER LISTED HERE. Naming
    `area_filter` and `domain_filter` in our source would be a second copy of a
    contract the upstream owns and renames without telling us — the same
    duplication `UpstreamTool` exists to avoid by passing `inputSchema`
    verbatim. Reading the schema means a tool added upstream tomorrow gets
    correct advice with no change here.

    ⚠️ AND ARGUMENTS ALREADY SUPPLIED ARE EXCLUDED, because telling a model to
    narrow by something it just passed is advice it cannot act on — it would
    re-send the identical call, which `_Bounded` then stops as a loop.
    """
    props = schema.get("properties")
    if not isinstance(props, Mapping):
        return NARROW_HINT
    spare = [str(name) for name in props if name not in args]
    if not spare:
        return NARROW_HINT
    # A long list reads as noise; the first few are enough to make the point
    # that this tool HAS filters, and the schema is in front of the model too.
    return ", ".join(sorted(spare)[:6])


def _flatten(result: Mapping[str, Any]) -> str:
    """An MCP result as text. ⚠️ `structuredContent` FIRST WHEN IT EXISTS: it is
    the machine-readable answer, and the text blocks beside it are usually the
    same thing pretty-printed at greater length — which matters because
    `truncate` cuts at 8,000 characters and the compact form fits more of the
    actual answer inside it."""
    structured = result.get("structuredContent")
    if isinstance(structured, (dict, list)) and structured:
        try:
            return json.dumps(structured, separators=(",", ":"))
        except (TypeError, ValueError):
            pass
    parts: List[str] = []
    for block in result.get("content") or []:
        if isinstance(block, Mapping) and block.get("type") == "text":
            parts.append(str(block.get("text") or ""))
    return "\n".join(parts) if parts else json.dumps(dict(result))[:2000]


# ── the catalogue ───────────────────────────────────────────────────────────
async def refresh(session: Any, *, config: Optional[Mapping[str, Any]] = None,
                  now: Optional[float] = None,
                  max_age_h: Optional[int] = None) -> bool:
    """Re-read the upstream tool list if the stored one is stale.

    ⚠️ A FAILED READ LEAVES THE OLD CATALOGUE IN PLACE, exactly as
    `refresh_capabilities` and `refresh_layout` do: a momentarily restarting
    add-on must not strip the agent of every Home Assistant tool it had.
    """
    if session is None:
        return False
    stamp = time.time() if now is None else now
    hours = CATALOGUE_MAX_AGE_H if max_age_h is None else max_age_h
    try:
        from vesta.adapters import store
        raw = store.read_json(CATALOGUE_FILE, {})
        at = float(raw.get("at") or 0) if isinstance(raw, Mapping) else 0.0
        if stamp - at < max(1, hours) * 3600.0:
            return False

        url = await endpoint(session, config)
        if not url:
            # ⚠️ SAY SO. This was a bare `return False` and it was the single
            # most likely failure — the add-on missing, stopped, or the
            # Supervisor refusing the listing because `hassio_api` was not
            # granted — so the one path that needed a line was the one without
            # one. Measured on the reference villa: the permission WAS missing,
            # the catalogue never loaded, and the log said nothing at all in
            # either direction. `feedback_instruments-never-skip`, in code
            # written the same day citing it.
            log("upstream: no ha_mcp add-on reachable; "
                "Home Assistant reads fall back to the built-in tools")
            return False
        result = await rpc(session, url, "tools/list")
        tools = (result or {}).get("tools")
        if not isinstance(tools, list) or not tools:
            log(f"upstream: {url.split('//')[-1].split('/')[0]} answered with "
                f"no tools; keeping the previous catalogue")
            # ⚠️ AN EMPTY LIST IS NOT AN ANSWER. Recording it would publish
            # "Home Assistant offers no tools", and the fallback readers would
            # look like a deliberate choice rather than a failure.
            return False
        store.write_json(CATALOGUE_FILE,
                         {"at": stamp, "url": url, "tools": list(tools)})
        log(f"upstream: {len(tools)} tool(s) catalogued from ha_mcp")
    except Exception as err:  # noqa: BLE001 - a survey is not worth a failed pass
        swallow("could not read the upstream tool catalogue", err)
        return False
    return True


def catalogue() -> Dict[str, Any]:
    """The stored tool list, or `{}` when nobody has read one."""
    try:
        from vesta.adapters import store
        raw = store.read_json(CATALOGUE_FILE, {})
        if not isinstance(raw, Mapping) or not raw.get("tools"):
            return {}
        return {"url": str(raw.get("url") or ""),
                "tools": [t for t in raw["tools"] if isinstance(t, Mapping)]}
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the upstream tool catalogue", err)
        return {}


def tools_for(session_of: Any, refs: Any = None) -> List[UpstreamTool]:
    """Every catalogued upstream tool, as registry tools.

    ⚠️ IT DOES NOT FILTER BY MODE, AND THAT IS DELIBERATE. `policy.may_use_tool`
    is the gate and it runs per call on `tool.mode`, so a WRITE or UNCLASSIFIED
    tool is refused there — one gate, in the place every other tool is already
    checked. Filtering here as well would be a second gate agreeing on the day
    it was written and diverging on the first change to either (ARCH-012).

    ⚠️ `refs` IS THE RUN'S TABLE AND OMITTING IT IS NOT A MINOR LOSS — it is the
    whole integration going dark, because every result naming a device is then
    refused by `redact.audit`. It defaults to None so a test can build a tool
    without one, NOT because a caller may skip it; `build_registry` passes the
    same table our own tools mint into, which is what lets the model refer to a
    device the upstream named and `raise_concern` resolve it back.
    """
    stored = catalogue()
    url = stored.get("url") or ""
    if not url:
        return []
    return [UpstreamTool(spec, url, session_of, refs)
            for spec in stored["tools"] if str(spec.get("name") or "")]


def summary() -> Dict[str, Any]:
    """What an operator needs to see in the Supervision tab: is it wired, how
    many tools, and how many of them this villa may actually call."""
    stored = catalogue()
    specs: Sequence[Mapping[str, Any]] = stored.get("tools") or []
    modes = [mode_of(s) for s in specs]
    return {
        "connected": bool(stored.get("url")),
        "tools": len(specs),
        "readable": sum(1 for m in modes if m == "READ"),
        "actuating": sum(1 for m in modes if m == "ACT"),
        "unclassified": sum(1 for m in modes if m == "UNCLASSIFIED"),
    }
