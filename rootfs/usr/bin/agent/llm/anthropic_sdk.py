"""The one adapter. THE ONLY FILE IN THIS REPOSITORY THAT IMPORTS THE SDK.

⚠️ AND THE ONLY FILE THAT MAY NAME THE PROVIDER'S HOSTNAME. `tests/py/
test_narration_provider.py` derives the host list from the adapter sources and
asserts it appears nowhere under `src/` — because a provider host reachable from
the SPA bundle would be CLAUDE.md's second hard rule failing in the one place
nobody would look, and it would put an API key in a browser to do it. That test
now covers this file too.

⚠️ THE IMPORT IS DEFERRED, AND THAT IS NOT A STYLE CHOICE. `agent/` is imported
by the proxy at start-up, and the SDK is a pip package that could be missing on
a half-built image or an older install. A module-level import would take the
whole add-on down — the 3D kiosk on the wall included — because a weekly summary
could not find a library. Everything here degrades to `declined` instead.

⚠️ MODEL AND EFFORT COME FROM CONFIG, NEVER A LITERAL (ADR-016). Upgrading a
model is then a config change plus an eval run rather than a deploy, which is
what makes "will the next model break my villa monitoring?" a ten-minute
question instead of an unanswerable one.

⚠️ IT EXECUTES NO TOOL. This adapter reports what the model ASKED for and stops.
Running it is the registry's job and permitting it is `policy.py`'s, and keeping
those apart is what makes a provider swap a quality decision rather than an
authority one. The SDK's own tool runner is deliberately not used for that
reason: it loops and executes, and the loop is where the gate belongs.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence

from agent.llm.base import ToolCall, Turn
from reports.log import log, swallow

#: The provider's API host. ⚠️ THIS STRING LIVES HERE AND NOWHERE ELSE — see the
#: module docstring. It is not used to build a request (the SDK does that); it
#: is declared so the CI grep has something to derive from, which is what makes
#: "no provider host reaches the browser bundle" checkable rather than asserted.
API_HOST = "https://api.anthropic.com/"

#: Sent so the provider can attribute traffic. Carries no villa information.
CLIENT_NAME = "vesta-agent"


class AnthropicProvider:
    """One turn per `run`. No loop, no tool execution, no policy."""

    name = "anthropic"

    def __init__(self, api_key: str) -> None:
        self._key = str(api_key or "")

    def configured(self) -> bool:
        """⚠️ Separate from holding the key, so a diagnostic can ask whether a
        provider is usable without putting the credential on the caller's
        stack — the same split `reports/secrets.py` makes."""
        return bool(self._key)

    def _redacted(self, text: str) -> str:
        """Provider error text with every credential removed.

        ⚠️ IT SCRUBS THIS ADAPTER'S OWN KEY FIRST, AND `secrets.redact` ALONE IS
        NOT ENOUGH. That function replaces values it finds in the STORED
        secrets file — so it protects a key that came from there and does
        nothing at all for one passed in from anywhere else. This object HOLDS
        the key; scrubbing it here does not depend on where it came from.

        Found by a test that fed a fake SDK an exception echoing
        `x-api-key`, and watched the key reach the log in full. `secrets.redact`
        is still called afterwards, because it covers the OTHER stored
        credentials this error might carry.
        """
        out = str(text)
        if self._key and len(self._key) >= 8:
            out = out.replace(self._key, "***")
        try:
            from reports.secrets import redact
            return redact(out)
        except Exception:  # noqa: BLE001 - never let redaction itself fail open
            return out

    async def run(self, *, system: Sequence[Mapping[str, Any]],
                  messages: Sequence[Mapping[str, Any]],
                  tools: Sequence[Mapping[str, Any]],
                  model: str,
                  max_tokens: int = 2048,
                  options: Optional[Mapping[str, Any]] = None) -> Turn:
        if not self._key:
            return Turn(declined="no API key is configured")
        if not str(model or "").strip():
            # ⚠️ REFUSED RATHER THAN DEFAULTED. A default here would be a model
            # literal in code, which ADR-016 exists to prevent — and the villa
            # would silently run on a model nobody chose.
            return Turn(declined="no model configured for this tier")

        try:
            # ⚠️ THE `type: ignore` IS THE CORRECT SIGNAL, NOT A SUPPRESSION.
            # The SDK is a dependency of the IMAGE, pinned in the Dockerfile,
            # and deliberately NOT of the development environment — so
            # `mypy --strict` reporting it missing is mypy agreeing with the
            # design. This module's whole contract is that it degrades when the
            # SDK is absent, which is the state the type checker is in.
            import anthropic  # type: ignore[import-not-found]
        except Exception as err:  # noqa: BLE001
            swallow("anthropic SDK unavailable", err)
            return Turn(declined="the model SDK is not installed")

        opts = dict(options or {})
        request: Dict[str, Any] = {
            "model": str(model),
            "max_tokens": max(1, int(max_tokens)),
            "system": list(system),
            "messages": list(messages),
        }
        if tools:
            request["tools"] = [_tool_wire(t) for t in tools]
        # ⚠️ PASSED THROUGH OPAQUELY, NOT PROMOTED INTO THE PROTOCOL. `thinking`
        # and friends are this provider's vocabulary; naming them in `base.py`
        # would make the seam this adapter's client with extra steps.
        for name in ("thinking", "temperature", "top_p", "stop_sequences"):
            if name in opts:
                request[name] = opts[name]

        try:
            client = anthropic.AsyncAnthropic(api_key=self._key)
            reply = await client.messages.create(**request)
        except Exception as err:  # noqa: BLE001 - degrade, never fail
            # ⚠️ REDACTED. An HTTP client that fails mid-request echoes the
            # request — `x-api-key` included — into the exception, and
            # `swallow` writes exactly that down. `reports/secrets.redact`
            # exists for this and is used rather than reimplemented.
            safe = self._redacted(str(err))
            swallow("provider call failed", RuntimeError(safe))
            return Turn(declined=f"the provider could not be reached: {safe}")

        return _turn_of(reply)


def _tool_wire(tool: Mapping[str, Any]) -> Dict[str, Any]:
    """One tool in THIS provider's wire shape. `inputSchema` -> `input_schema`.

    ⚠️ THE REGISTRY PUBLISHES MCP'S SHAPE AND THIS API WANTS ITS OWN, AND THE
    TRANSLATION BELONGS HERE. `agent/tools/base.py` is MCP-shaped on purpose
    (ADR-006): `name`, `description`, `inputSchema` is what MCP publishes, and
    that is what makes the extraction seam free. The Messages API spells the
    third one `input_schema`. Passing the registry's dict straight through was
    the whole failure — the villa answered nothing and the API said
    `tools.0.custom.input_schema: Field required`.

    ⚠️ AND IT IS THE ADAPTER'S JOB BY THIS MODULE'S OWN CONTRACT: "everything
    provider-specific stops here". Renaming the field in `base.py` would fix
    one caller and break MCP, which is the surface the name was chosen for; a
    second adapter will have its own spelling and its own mapping right here.

    ⚠️ CAMELCASE IS DROPPED, NOT MIRRORED. Sending both is how a payload starts
    carrying two names for one thing, and this provider rejects unknown tool
    fields rather than ignoring them.
    """
    out: Dict[str, Any] = {"name": str(tool.get("name") or ""),
                           "description": str(tool.get("description") or "")}
    schema = tool.get("input_schema", tool.get("inputSchema"))
    out["input_schema"] = (dict(schema) if isinstance(schema, Mapping)
                           else {"type": "object", "properties": {}})
    return out


def _turn_of(reply: Any) -> Turn:
    """The SDK's reply, flattened into the seam's own shape.

    ⚠️ EVERYTHING PROVIDER-SPECIFIC STOPS HERE. Downstream sees `Turn`, so a
    second adapter needs no changes anywhere else — which is the only claim the
    seam actually makes today.
    """
    text_parts: List[str] = []
    calls: List[ToolCall] = []
    for block in getattr(reply, "content", None) or []:
        kind = getattr(block, "type", "")
        if kind == "text":
            text_parts.append(str(getattr(block, "text", "")))
        elif kind == "tool_use":
            args = getattr(block, "input", None)
            calls.append(ToolCall(
                id=str(getattr(block, "id", "")),
                name=str(getattr(block, "name", "")),
                args=dict(args) if isinstance(args, Mapping) else {}))

    usage_obj = getattr(reply, "usage", None)
    usage = {
        name: int(getattr(usage_obj, name, 0) or 0)
        for name in ("input_tokens", "output_tokens",
                     "cache_creation_input_tokens", "cache_read_input_tokens")
    } if usage_obj is not None else {}

    # ⚠️ THE FLATTENED TEXT DECIDES WHETHER THERE IS AN ANSWER. `"   \n  "` is
    # truthy and pure markup flattens to nothing — the narration layer already
    # paid for this once, reporting success and spending budget on an empty
    # string while quietly declining it downstream.
    text = "".join(text_parts)
    if not text.strip() and not calls:
        return Turn(usage=usage, stop_reason=str(getattr(reply, "stop_reason", "")),
                    declined="the provider returned nothing usable")

    return Turn(text=text, tool_calls=tuple(calls),
                stop_reason=str(getattr(reply, "stop_reason", "")),
                usage=usage)


#: ⚠️ A TABLE, NOT A BRANCH, and the default is DERIVED from it — the shape
#: `providers.ADAPTERS` already establishes. A second adapter is one entry here;
#: an `if provider == …` somewhere would be a second place to update and a
#: stale default waiting to happen.
ADAPTERS: Dict[str, Any] = {"anthropic": AnthropicProvider}
DEFAULT_PROVIDER = next(iter(ADAPTERS))


def build(name: str = "", *, api_key: str = "") -> Optional[Any]:
    """An adapter by name, or None. Never raises on an unknown name."""
    cls = ADAPTERS.get(str(name or DEFAULT_PROVIDER))
    return cls(api_key=api_key) if cls is not None else None
