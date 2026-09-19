"""The only module that touches a socket.

⚠️ ONE FILE, SO THE REST OF THE LAYER STAYS TESTABLE. Every other module takes
its transport as an argument; this is where `aiohttp` is imported and where a
URL is actually opened. If a second module ever imports `aiohttp`, the seam has
been crossed and the thing that made this layer testable on a fake villa is
gone.
"""
from __future__ import annotations

from typing import Any

#: Long enough for a Supervisor under load, short enough that a wedged gateway
#: shows up as DOWN in the health entity rather than as a hang nobody can see.
TIMEOUT_SECONDS = 30


class Wire:
    """aiohttp, behind the two callables the adapters actually need."""

    def __init__(self, session: Any) -> None:
        self._session = session

    async def rpc(self, url: str, body: dict[str, Any],
                  extra: dict[str, str] | None = None
                  ) -> tuple[dict[str, Any] | None, dict[str, str]]:
        """One JSON-RPC round trip to the gateway.

        ⚠️ IT ACCEPTS EITHER SHAPE. A streamable-HTTP MCP server answers plain
        JSON or an SSE frame depending on the Accept header it is given, and
        which one arrives is not something this layer can dictate.

        ⚠️ AND AN EMPTY BODY IS A RESULT, NOT A PARSE FAILURE. A notification is
        answered with 202 and nothing at all; the first cut fed that to
        `json.loads` and reported "Expecting value: line 1 column 1 (char 0)",
        which is a true sentence about the parser and tells an operator nothing
        about their gateway.
        """
        import json

        headers = {"Content-Type": "application/json",
                   "Accept": "application/json, text/event-stream"}
        headers.update(extra or {})
        async with self._session.post(url, json=body, headers=headers) as resp:
            text = await resp.text()
            status = resp.status
            content_type = resp.headers.get("Content-Type", "")
            out_headers = {k.lower(): v for k, v in resp.headers.items()}
            # ⚠️ THE STATUS TRAVELS WITH THE HEADERS, under a name no server
            # sends. When a body is empty the only useful thing left to say is
            # what the server answered WITH — "empty body" alone sent the owner
            # looking at their secret when the answer was in the status line.
            out_headers["x-vesta-status"] = str(status)
        if status >= 400:
            raise RuntimeError(
                f"the gateway answered HTTP {status}"
                + (f": {text.strip()[:160]}" if text.strip() else ""))
        text = text.strip()
        if not text:
            return None, out_headers
        if text.startswith(("data:", "event:")):
            # SSE: the payload is the last `data:` line of the frame.
            payloads = [line[5:].strip() for line in text.splitlines()
                        if line.startswith("data:")]
            text = payloads[-1] if payloads else ""
            if not text:
                return None, out_headers
        try:
            return json.loads(text), out_headers
        except ValueError:
            # ⚠️ REPORT WHAT ARRIVED. "Not JSON" is not actionable; the status,
            # the content type and the first bytes are.
            raise RuntimeError(
                f"the gateway answered HTTP {status} as {content_type or 'no content-type'} "
                f"and the body is not JSON-RPC: {text[:160]!r}") from None

    async def post(self, url: str, body: dict[str, Any],
                   headers: dict[str, str]) -> int:
        async with self._session.post(url, json=body, headers=headers) as resp:
            return resp.status

    def ws_connect(self, url: str) -> Any:
        return self._session.ws_connect(url, heartbeat=30)


def open_session() -> Any:
    """An aiohttp session with this layer's timeout, imported here and only here."""
    import aiohttp

    return aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=TIMEOUT_SECONDS))
