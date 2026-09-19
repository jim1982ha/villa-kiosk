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

    async def rpc(self, url: str, body: dict[str, Any]) -> dict[str, Any]:
        """One JSON-RPC round trip to the gateway.

        ⚠️ IT ACCEPTS EITHER SHAPE. A stateless_http MCP server answers plain
        JSON or an SSE frame depending on the Accept header it is given, and
        which one arrives is not something this layer can dictate.
        """
        import json

        headers = {"Content-Type": "application/json",
                   "Accept": "application/json, text/event-stream"}
        async with self._session.post(url, json=body, headers=headers) as resp:
            text = await resp.text()
        if resp.status >= 400:
            raise RuntimeError(f"the gateway answered HTTP {resp.status}")
        text = text.strip()
        if text.startswith("data:"):
            # SSE: the payload is the last `data:` line of the frame.
            payloads = [line[5:].strip() for line in text.splitlines()
                        if line.startswith("data:")]
            text = payloads[-1] if payloads else ""
        try:
            return json.loads(text)
        except ValueError as exc:
            raise RuntimeError(
                f"the gateway answered something that is not JSON-RPC: {exc}") from exc

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
