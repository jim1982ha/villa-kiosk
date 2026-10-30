"""An integration's state read by the AI (owner, 2026-10-30: VESTA could not tell the ZBT-2 "is not plugged in", the
integration's own reason, and gave a thinner answer than a person reading the same villa): its state and reason
only, never its options, schema or diagnostics. Synthetic villa; names invented."""
from __future__ import annotations

import asyncio
import json

from ha_fake import FakeHA, tool
from helpers import make_agent

OWNER, OWNER_CHAT = 111, -1001
ANSWER = {"success": True, "entry_id": "e1", "entry": {
    "entry_id": "e1", "domain": "example_radio", "title": "Example radio", "state": "setup_retry",
    "reason": "The device is not plugged in", "source": "usb", "options": {"api_key": "SECRET-KEY"},
    "supports_options": True}}


def _agent(tmp_path):
    ha = FakeHA(tools=[tool("ha_get_integration", entry_id="string", include_diagnostics="boolean",
                            include_options="boolean", query="string")],
                answers={"ha_get_integration": json.dumps(ANSWER)})
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner"}],
                              "chats": {"owner": OWNER_CHAT}, "ha_read_tools": ["ha_get_integration"]}, reader=ha)
    asyncio.run(v.refresh_server_tools())
    from vesta_agent.routing import CONVERSATION, Origin
    get = next(t for t in v.toolbox().tool_objects(None, Origin(OWNER_CHAT, CONVERSATION)) if t.name == "ha_get_integration")
    return ha, get


def _text(res) -> str:
    return "".join(b.get("text", "") for b in res.get("content", []))


def test_the_ai_reads_an_integration_s_state_and_reason_never_its_options(tmp_path):
    ha, get = _agent(tmp_path)
    said = _text(asyncio.run(get.handler({"entry_id": "e1"})))
    assert "The device is not plugged in" in said and "setup_retry" in said
    assert "SECRET-KEY" not in said and "api_key" not in said and "options" not in said


def test_an_integration_s_settings_and_diagnostics_are_never_asked_for(tmp_path):
    ha, get = _agent(tmp_path)
    for asked in ({"entry_id": "e1", "include_diagnostics": True}, {"entry_id": "e1", "include_options": True}):
        res = asyncio.run(get.handler(asked))
        assert res.get("is_error") or "not allowed" in _text(res)
    assert not any(name == "ha_get_integration" and set(a) - {"entry_id"} for name, a in ha.calls)


def test_a_new_villa_lets_the_ai_read_integrations():
    import os
    from helpers import ROOT
    text = open(os.path.join(ROOT, "starter", "config", "policy.example.yaml"), encoding="utf-8").read()
    assert "\n  - ha_get_integration\n" in text


def test_a_skill_script_reads_the_same_state_only():
    # one guard, two doors (read_guard): a script's client is handed the same fields as the AI
    from vesta_shared.ha_client import McpClient

    class Session:
        def call_raw(self, name, args):
            return {"content": [{"type": "text", "text": json.dumps(ANSWER)}]}

    body = McpClient("http://unused", "UTC", session=Session()).tool("ha_get_integration", {"entry_id": "e1"})
    assert body["entry"]["reason"] == "The device is not plugged in" and "options" not in body["entry"]
