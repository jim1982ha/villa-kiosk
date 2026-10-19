"""An entity hidden in the villa's system is left out of what the Agent lists (owner, 2026-10-15).

A lock fitted the wrong way round is corrected at the source: a template lock reads the real one inverted, and the
real one is HIDDEN (not disabled — the template reads it). Still listed, the villa status said "Laundry Room unlocked"
of a door that was locked. Driven from ha-mcp's own answer, through the client and the pack, to the status the AI is
given — the client dropping `hidden_by` would leave every helper below green (pin the caller)."""
from __future__ import annotations

import json
import os
import sys

from helpers import STARTER_SKILLS

sys.path.insert(0, os.path.join(STARTER_SKILLS, "villa-concierge", "scripts"))

RAW, FIXED = "lock.front_door_raw", "lock.front_door"


class _Session:
    """ha-mcp as the villa answers, two locks: the real one (hidden, reads backwards) and its corrected template."""

    def call_raw(self, name, args):
        body = {
            "ha_get_overview": {"domain_stats": {"lock": {"entities": [{"entity_id": RAW}, {"entity_id": FIXED}]}}},
            "ha_get_device": {"devices": [{"device_id": "d1", "name": "Front door lock", "area_id": "hall",
                                           "manufacturer": "Example Locks", "model": "L1",
                                           "entities": [{"entity_id": RAW, "platform": "matter"}]}]},
            "ha_get_state": {"states": {RAW: {"state": "unlocked", "attributes": {"friendly_name": "Front Door Raw"}},
                                        FIXED: {"state": "locked", "attributes": {"friendly_name": "Front Door"}}}},
            "ha_get_entity": {"entity_entries": [
                {"entity_id": RAW, "original_name": "Front Door Raw", "hidden_by": "user", "disabled_by": None},
                {"entity_id": FIXED, "original_name": "Front Door", "area_id": "hall", "hidden_by": None,
                 "disabled_by": None}]},
            "ha_list_floors_areas": {"floors": [{"areas": [{"area_id": "hall", "name": "Hall"}]}]},
        }[name]
        return {"content": [{"type": "text", "text": json.dumps(body)}]}


def _pack():
    from vesta_shared.ha_client import McpClient
    from vesta_shared.knowledge_pack import build_pack
    cli = McpClient(session=_Session())
    return build_pack(cli.registry(), [], cli.states())


def test_a_hidden_lock_is_not_in_the_villa_status(tmp_path):
    import concierge
    from vesta_shared.store import Store
    pack = _pack()
    assert [r["entity_id"] for r in pack.rows()] == [FIXED]
    states = {RAW: {"state": "unlocked"}, FIXED: {"state": "locked"}}
    s = concierge.status(pack, states, Store(str(tmp_path / "s.sqlite")))
    assert "unlocked" not in s["text"] and s["colour"] == "green"


def test_a_hidden_entity_still_names_its_device():
    # an alert written before the swap still names the real lock: its device is still known
    assert _pack().device_name(RAW, None) == "Front door lock"


def test_the_ais_own_search_never_offers_a_hidden_entity(tmp_path):
    # owner, 2026-10-18: asked "turn off the TV", the AI offered three TVs, two of them hidden by the owner — the Rules
    # page says hidden devices are left out of what the AI is told. Through the real tool, the pack built as at night
    import asyncio
    from ha_fake import FakeHA, tool
    from helpers import make_agent
    from vesta_agent.routing import CONVERSATION, Origin
    pack = _pack()
    assert pack.hidden == [RAW]
    found = {"success": True, "entities": [{"entity_id": RAW, "friendly_name": "Front Door Raw"},
                                           {"entity_id": FIXED, "friendly_name": "Front Door"}],
             "by_domain": {"lock": [{"entity_id": RAW}, {"entity_id": FIXED}]}}
    v = make_agent(tmp_path, {"people": [{"telegram_id": 5, "name": "Asker", "role": "owner"}], "chats": {"owner": 5},
                              "ha_read_tools": ["ha_search"]},
                   reader=FakeHA(tools=[tool("ha_search", query={"type": "string"})],
                                 answers={"ha_search": json.dumps(found)}))
    with open(v.s.pack_path, "w") as f:
        f.write(pack.to_json())
    asyncio.run(v.refresh_server_tools())
    search = next(t for t in v.toolbox().tool_objects(None, Origin(5, CONVERSATION)) if t.name == "ha_search")
    out = asyncio.run(search.handler({"query": "door"}))
    text = out["content"][0]["text"]
    assert FIXED in text and RAW not in text, text


def test_no_read_tool_of_the_ai_shows_a_hidden_entity(tmp_path):
    # architecture review scan 3, 2026-10-19: only the search was filtered — the overview (on by default) listed the
    # hidden lock among its domain's ids, and a state read of it answered as for any device
    import asyncio
    from ha_fake import FakeHA, tool
    from helpers import make_agent
    from vesta_agent.routing import CONVERSATION, Origin
    overview = {"domains": {"lock": {"count": 2, "entities": [RAW, FIXED]}}}
    state = {"entity_id": RAW, "state": "locked"}
    v = make_agent(tmp_path, {"people": [{"telegram_id": 5, "name": "Asker", "role": "owner"}], "chats": {"owner": 5},
                              "ha_read_tools": ["ha_get_overview", "ha_get_state"]},
                   reader=FakeHA(tools=[tool("ha_get_overview"), tool("ha_get_state", entity_id={"type": "string"})],
                                 answers={"ha_get_overview": json.dumps(overview), "ha_get_state": json.dumps(state)}))
    with open(v.s.pack_path, "w") as f:
        f.write(_pack().to_json())
    asyncio.run(v.refresh_server_tools())
    tools = {t.name: t for t in v.toolbox().tool_objects(None, Origin(5, CONVERSATION))}
    seen = asyncio.run(tools["ha_get_overview"].handler({}))["content"][0]["text"]
    assert FIXED in seen and RAW not in seen, seen
    read = asyncio.run(tools["ha_get_state"].handler({"entity_id": RAW}))["content"][0]["text"]
    assert "hidden" in read and '"locked"' not in read, read
