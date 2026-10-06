"""The in-memory stand-in for the agent's read-only Home Assistant client (vesta_shared.ha_client.McpClient).

⚠️ ONE STAND-IN, HELD TO THE REAL ONE (architecture review, 2026-10-07): five test files each wrote a `Reader`
that differed only in the tools listed and a camera's picture. tests/test_fakes.py fails when this stops having
the real client's methods with the same parameters.

    FakeHA()                                        # no tools
    FakeHA(tools=[{"name": "ha_get_state", "annotations": {"readOnlyHint": True}}])
    FakeHA(tools=..., images={"camera.lounge": "SlBFRw=="}, answers={"ha_get_state": "{}"})

`calls` records each tool called through the session (name, arguments).
"""
from __future__ import annotations

READ_ONLY = {"readOnlyHint": True}


class _Session:
    def __init__(self, ha: "FakeHA"):
        self.ha = ha
        self.server_info = {"name": "ha-mcp", "version": ha.version}

    def list_tools(self) -> list[dict]:
        return list(self.ha.tools)

    def call_raw(self, name: str, args: dict) -> dict:
        self.ha.calls.append((name, dict(args or {})))
        img = self.ha.images.get((args or {}).get("entity_id")) if name == "ha_get_camera_image" else None
        if img:
            return {"content": [{"type": "image", "data": img, "mimeType": "image/jpeg"}]}
        return {"content": [{"type": "text", "text": self.ha.answers.get(name, "{}")}]}


class FakeHA:
    def __init__(self, tools=(), images: dict[str, str] | None = None, answers: dict[str, str] | None = None,
                 states: dict[str, dict] | None = None, version: str = "8.6.0"):
        self.tools, self.images, self.answers = list(tools), dict(images or {}), dict(answers or {})
        self._states, self.version, self.calls = dict(states or {}), version, []
        self.mcp = _Session(self)

    def states(self, entity_ids=None) -> dict[str, dict]:
        return {e: s for e, s in self._states.items() if entity_ids is None or e in entity_ids}

    def tool_content(self, name: str, args: dict) -> list[dict]:
        return self.mcp.call_raw(name, args).get("content", [])


def tool(name: str, read_only: bool = True, **schema) -> dict:
    """A tool as HA MCP lists it: read-only unless said otherwise, its arguments when given."""
    t = {"name": name, "annotations": dict(READ_ONLY) if read_only else {"destructiveHint": True}}
    if schema:
        t["inputSchema"] = {"type": "object", "properties": {k: {"type": v} for k, v in schema.items()}}
    return t
