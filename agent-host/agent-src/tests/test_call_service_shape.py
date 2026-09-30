"""An approved action, as ha-mcp itself would receive it.

⚠️ THE FIRST APPROVED ACTION ON THE VILLA FAILED: the executor sent `entity_id`
as a list and ha-mcp 8.5.0 takes one string ("Input should be a valid string").
Every earlier test used a fake writer that accepted any shape. Here the call goes
through the real path (Actions.execute -> McpClient.call_service) and is checked
against ha-mcp's own input schema for ha_call_service, saved from the server the
image ships (fixtures/ha_mcp_ha_call_service.schema.json). The container test
fails when the server in the image stops matching that file."""
from __future__ import annotations

import json
import os

import jsonschema
import pytest

from vesta_agent.actions import Actions
from vesta_agent.policy import Decision
from vesta_agent.state import State
from vesta_shared.ha_client import McpClient

SCHEMA = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "ha_mcp_ha_call_service.schema.json")))


class StrictSession:
    """ha-mcp's tools/call as far as its arguments go: refused unless they match its schema."""

    def __init__(self):
        self.calls: list[dict] = []

    def call_raw(self, name, args):
        assert name == "ha_call_service"
        try:
            jsonschema.validate(args, SCHEMA)
        except jsonschema.ValidationError as e:
            return {"isError": True, "content": [{"type": "text", "text": f"Invalid arguments: {e.message}"}]}
        self.calls.append(args)
        return {"content": [{"type": "text", "text": json.dumps({"success": True})}]}


class Writer(McpClient):
    def states(self, entity_ids=None):
        return {e: {"state": "on"} for e in entity_ids or []}


@pytest.fixture
def run(tmp_path, monkeypatch):
    monkeypatch.delenv("VESTA_HA_READ_ONLY", raising=False)
    session = StrictSession()
    actions = Actions(lambda: None, State(str(tmp_path / "state.db")),
                      lambda: Writer("http://unused", "UTC", write=True, session=session))

    def go(entity_ids, data=None):
        return actions.execute(Decision(True, "test", "any", "light", "turn_on", entity_ids, data or {})), session.calls
    return go


def test_one_device_is_one_string_and_ha_mcp_waits_for_it(run):
    result, calls = run(["light.example_pool"])
    assert result["ok"], result
    assert calls == [{"domain": "light", "service": "turn_on", "wait": True, "entity_id": "light.example_pool"}]


def test_several_devices_go_as_home_assistants_own_list_in_data(run):
    result, calls = run(["light.example_a", "light.example_b"], {"brightness_pct": 40})
    assert result["ok"], result
    (args,) = calls
    assert "entity_id" not in args                                  # never "light.a,light.b"
    assert args["data"] == {"brightness_pct": 40, "entity_id": ["light.example_a", "light.example_b"]}


def test_a_refused_call_says_so_and_confirms_nothing(run, caplog):
    import vesta_shared.ha_client as hc
    orig = hc.McpClient.call_service
    hc.McpClient.call_service = lambda self, d, s, data: self.tool("ha_call_service", {"domain": d, "service": s,
                                                                                         "entity_id": ["x.y"]})
    try:
        result, calls = run(["light.example_pool"])
    finally:
        hc.McpClient.call_service = orig
    assert not result["ok"] and calls == []
    assert any("valid" in r.message and "light.turn_on" in r.message for r in caplog.records)   # the reason, in the app's log
