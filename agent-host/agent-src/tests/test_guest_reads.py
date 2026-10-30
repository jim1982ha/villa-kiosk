"""A guest learns no more from VESTA than from the guest's own tablet (architecture review round 8: a guest asking on
the tablet was answered from the people and the motion sensors the guest's screen hides). What a guest may read is the
agreement's (agent-contract.json profiles.guest.reads), judged on the Kiosk's villa model; driven through the AI's real
tools. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import json

from ha_fake import FakeHA, tool
from helpers import make_agent
from kiosk_fake import FakeKiosk
from vesta_agent import tool_access
from vesta_agent.policy import Person
from vesta_agent.routing import CONVERSATION, Origin

LAMP, MOTION, TEMP, JO, SPEAKER = ("light.example_lamp", "binary_sensor.example_motion", "sensor.example_room_temp",
                                   "person.example_jo", "media_player.example_speaker")
VILLA = [{"entity_id": LAMP, "type": "light", "category": "light"},
         {"entity_id": MOTION, "type": "binary_sensor", "category": "security"},
         {"entity_id": TEMP, "type": "sensor", "category": "security"},       # a category the guest's tablet hides
         {"entity_id": SPEAKER, "type": "media_player", "category": None}]   # no category: domain and type alone
WINDOW, RETYPED = "binary_sensor.example_window", "light.example_cam_light"
VILLA += [{"entity_id": WINDOW, "type": "binary_sensor", "category": "comfort"},   # its type alone hides it
          {"entity_id": RETYPED, "type": "camera", "category": "light"}]         # retyped by the owner: a camera
CHAT = 900


def found(*ids) -> str:
    return json.dumps({"success": True, "entities": [{"entity_id": e, "state": "on"} for e in ids]})


def agent(tmp_path, kiosk=None):
    ha = FakeHA(tools=[tool("ha_get_state", entity_id={"type": "string"}), tool("ha_search", query={"type": "string"}),
                       tool("ha_eval_template", template={"type": "string"})],
                answers={"ha_get_state": json.dumps({"entity_id": "x", "state": "on"}),
                         "ha_search": found(LAMP, MOTION, TEMP, JO, SPEAKER)})
    if kiosk is None:
        kiosk = FakeKiosk()
        kiosk.villa = VILLA
    v = make_agent(tmp_path, {"people": [{"telegram_id": 5, "name": "Owner", "role": "owner"}], "chats": {"owner": 5},
                              "ha_read_tools": ["ha_get_state", "ha_search", "ha_eval_template"]}, reader=ha, kiosk=kiosk)
    asyncio.run(v.refresh_server_tools())
    return v


def tools_of(v, role: str) -> dict:
    allowed = tool_access.allowed_for(v.policy(), list(v.server_tools.values()) if isinstance(v.server_tools, dict)
                                      else v.server_tools, role, CHAT)
    tb = v.toolbox(allowed=allowed)
    return {t.name: t for t in tb.tool_objects(Person(CHAT, "At the tablet", role), Origin(CHAT, CONVERSATION))}


def read(t, **args) -> tuple[bool, str]:
    out = asyncio.run(t.handler(args))
    return bool(out.get("is_error")), out["content"][0]["text"] if out["content"] else ""


def test_a_guest_reads_only_what_the_guests_tablet_shows(tmp_path):
    state = tools_of(agent(tmp_path), "guest")["ha_get_state"]
    assert read(state, entity_id=LAMP)[0] is False
    assert read(state, entity_id=SPEAKER)[0] is False                    # no category: its domain and type allow it
    for hidden in (JO, MOTION, TEMP, WINDOW, RETYPED):  # a person, a motion sensor, a hidden category, a denied type
        refused, why = read(state, entity_id=hidden)
        assert refused and hidden in why, (hidden, why)


def test_a_guests_search_names_none_of_what_the_tablet_hides(tmp_path):
    search = tools_of(agent(tmp_path), "guest")["ha_search"]
    _, text = read(search, query="example")
    assert LAMP in text and SPEAKER in text
    assert not any(e in text for e in (JO, MOTION, TEMP)), text


def test_the_owner_reads_everything_as_before(tmp_path):
    tools = tools_of(agent(tmp_path), "owner")
    assert read(tools["ha_get_state"], entity_id=JO)[0] is False
    _, text = read(tools["ha_search"], query="example")
    assert all(e in text for e in (LAMP, MOTION, TEMP, JO))


def test_a_guest_has_no_tool_that_cannot_be_held_to_the_tablet(tmp_path):
    tools = tools_of(agent(tmp_path), "guest")
    assert "ha_eval_template" not in tools and "run_skill_script" not in tools and "agent_status" not in tools
    assert "ha_call_service" not in tools


def test_without_the_kiosks_villa_model_a_guest_reads_nothing(tmp_path):
    kiosk = FakeKiosk()
    kiosk.unreachable = True
    refused, why = read(tools_of(agent(tmp_path, kiosk), "guest")["ha_get_state"], entity_id=LAMP)
    assert refused and "cannot be checked" in why


def test_the_pages_guest_column_is_what_a_guests_run_keeps(tmp_path):
    v = agent(tmp_path)
    from vesta_agent.tool_access import catalog, read_list
    rows = {r["key"]: r["guest"] for r in catalog(v.policy(), read_list(v.s.data_dir), {})["roles"]}
    assert rows["states"] == ["ha_get_state", "ha_search"]
    assert rows["agent_status"] == [] and rows["start_job"] == []
