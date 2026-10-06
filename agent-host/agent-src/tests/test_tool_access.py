"""What the AI can use (0.6.42, owner's design of 2026-10-06): one answer, built and refused in code.

Every check drives the real Toolbox / Vesta / Skills, never a copy of their tables."""
from __future__ import annotations

import asyncio
import os

import pytest
import yaml

from helpers import copy_skill, settings
from test_telegram_events import FakeTelegram
from vesta_agent import runner, tool_access
from vesta_agent.app import Vesta
from vesta_agent.kiosk import Kiosk
from vesta_agent.policy import Person, Policy, problems
from vesta_agent.routing import CONVERSATION, Origin
from vesta_agent.skills import Skills, ToolError, validate_script_args

OWNER, FM, FM_CHAT, OWNER_CHAT = 111, 222, -2002, -1001
RO = {"readOnlyHint": True}
SERVER = [{"name": "ha_get_state", "annotations": RO}, {"name": "ha_get_history", "annotations": RO},
          {"name": "ha_get_camera_image", "annotations": RO,
           "inputSchema": {"type": "object", "properties": {"entity_id": {"type": "string"}}}},
          {"name": "ha_config_set_automation", "annotations": {"destructiveHint": True}},
          {"name": "ha_manage_theme", "annotations": {"readOnlyHint": False}}]


def run(c):
    return asyncio.run(c)


class Reader:
    class mcp:
        server_info = {"name": "ha-mcp", "version": "8.6.0"}

        @staticmethod
        def list_tools():
            return SERVER

    def states(self, ids):
        return {}

    def tool_content(self, name, args):
        assert name == "ha_get_camera_image"
        return [{"type": "image", "data": "SlBFRw==", "mimeType": "image/jpeg"}] if args["entity_id"] == "camera.lounge" else []


@pytest.fixture
def agent(tmp_path, monkeypatch):
    s = settings(str(tmp_path), VESTA_TELEGRAM_ENABLED="true", VESTA_TELEGRAM_BOT_TOKEN="42:TG-TEST")
    with open(s.policy_path, "w") as f:
        yaml.safe_dump({"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner"},
                                   {"telegram_id": FM, "name": "FM", "role": "fm"}],
                        "chats": {"owner": OWNER_CHAT, "fm": FM_CHAT},
                        "ha_read_tools": ["ha_get_state", "ha_get_history", "ha_get_camera_image",
                                          "ha_config_set_automation", "ha_manage_theme"],
                        "settings": {"jobs": {"fm-weekly": {"profile": "economy", "limit_usd": 1}}}}, f)
    copy_skill("reports", s.skills_dir)
    copy_skill("villa-concierge", s.skills_dir)
    v = Vesta(s, telegram=FakeTelegram(), reader=Reader(), kiosk=Kiosk("", ""))
    v.runs = []

    async def fake_run(settings_, system, prompt, server, allowed, state, who, **kw):
        v.runs.append({"who": who, "allowed": allowed})
        return runner.RunResult("ok", None, False, 0.01, [], None)
    monkeypatch.setattr(runner, "run", fake_run)
    run(v.refresh_server_tools())
    return v


def policy_edit(v, **sections):
    with open(v.s.policy_path) as f:
        raw = yaml.safe_load(f)
    raw.update(sections)
    with open(v.s.policy_path, "w") as f:
        yaml.safe_dump(raw, f)
    os.utime(v.s.policy_path, (1, os.path.getmtime(v.s.policy_path) + 5))      # a new mtime: re-read


def names(v, person, origin):
    allowed = tool_access.allowed_for_person(v.policy(), v.server_tools, person.role if person else None,
                                             origin.chat if origin else None)
    return {t.name for t in v.toolbox(allowed).tool_objects(person, origin)}


def test_only_a_tool_the_server_marks_read_only_ever_reaches_the_ai(agent):
    got = names(agent, Person(OWNER, "Owner", "owner"), Origin(OWNER_CHAT, CONVERSATION))
    assert {"ha_get_state", "ha_get_history", "ha_get_camera_image"} <= got
    # named in the file all the same: destructive, and not marked read-only
    assert "ha_config_set_automation" not in got and "ha_manage_theme" not in got


def test_the_facility_manager_loses_what_tool_access_refuses_and_so_does_their_chat(agent):
    policy_edit(agent, tool_access={"fm": {"cameras": False, "create_ticket": False}})
    owner, fm = Person(OWNER, "Owner", "owner"), Person(FM, "FM", "fm")
    assert "ha_get_camera_image" in names(agent, owner, Origin(OWNER_CHAT, CONVERSATION))
    assert "ha_get_camera_image" not in names(agent, fm, Origin(FM, CONVERSATION))
    # the owner writing in the facility manager's chat: never more there than the facility manager may use
    assert "ha_get_camera_image" not in names(agent, owner, Origin(FM_CHAT, CONVERSATION))
    assert "ha_get_state" in names(agent, fm, Origin(FM, CONVERSATION))


def test_an_own_tool_switched_off_does_not_exist_for_the_ai(agent):
    asker = Person(OWNER, "Owner", "owner")
    assert "start_job" in names(agent, asker, Origin(OWNER_CHAT, CONVERSATION))
    policy_edit(agent, agent_tools={"start_job": False, "agent_status": False})
    got = names(agent, asker, Origin(OWNER_CHAT, CONVERSATION))
    assert "start_job" not in got and "agent_status" not in got and "read_skill" in got


def test_a_report_gets_only_its_skills_tools_among_those_switched_on(agent):
    sk = agent.skills.get("reports")
    got = tool_access.allowed_for_job(agent.policy(), agent.server_tools, sk)
    assert "ha_get_history" in got and "ha_get_camera_image" not in got and "web_search" not in got
    assert {"send_message", "save_file", "read_skill", "run_skill_script"} <= got
    # a skill that lists none: everything switched on, but web search (a scheduled job never had it)
    sk.tools = None
    assert "ha_get_camera_image" in tool_access.allowed_for_job(agent.policy(), agent.server_tools, sk)
    assert "web_search" not in tool_access.allowed_for_job(agent.policy(), agent.server_tools, sk)


def test_the_run_of_a_report_is_given_exactly_those_tools(agent):
    from vesta_agent.skills import ai_jobs
    sk = agent.skills.get("reports")
    job = next(j for _, j in ai_jobs(agent.skills.all()) if j["name"] == "fm-weekly")
    run(agent.run_model_job(sk, job))
    (r,) = agent.runs
    assert "mcp__vesta__ha_get_history" in r["allowed"] and "mcp__vesta__ha_get_camera_image" not in r["allowed"]


def test_a_skill_that_needs_a_tool_switched_off_is_not_working_and_says_so(agent):
    from vesta_agent.skills import ai_jobs
    policy_edit(agent, ha_read_tools=["ha_get_state", "ha_get_camera_image"])        # ha_get_history off
    sk = agent.skills.get("reports")
    (b,) = tool_access.blockers(agent.policy(), agent.server_tools, sk)
    assert b["tool"] == "ha_get_history" and b["fix"] == "ha" and "switched off" in b["why"]
    job = next(j for _, j in ai_jobs(agent.skills.all()) if j["name"] == "fm-weekly")
    run(agent.run_model_job(sk, job))
    assert agent.runs == []                                                           # the report did not run
    assert any("fm-weekly report did not run" in t and "switched off" in t for _, t, _ in agent.tg.sent)
    tb = agent.toolbox()
    read = next(t for t in tb.tool_objects(Person(OWNER, "O", "owner"), Origin(OWNER_CHAT, CONVERSATION)) if t.name == "read_skill")
    out = run(read.handler({"skill": "reports"}))
    assert out.get("is_error") and "cannot be used now" in out["content"][0]["text"]
    # a tool this Home Assistant does not have stops nothing: the AI goes without it
    assert "ha_search" in sk.tools and not any(x["tool"] == "ha_search" for x in tool_access.blockers(agent.policy(), agent.server_tools, sk))


def test_a_skill_the_villa_switched_off_is_not_loaded(agent):
    assert "villa-concierge" in agent.skills.all()
    policy_edit(agent, skills_off=["villa-concierge"])
    assert "villa-concierge" not in agent.skills.all()
    assert "villa-concierge" in agent.skills.all(include_off=True)
    assert "villa-concierge" not in agent.system_prompt()


def test_a_command_switched_off_for_the_villa_is_refused_and_not_offered(agent):
    folder = os.path.join(agent.s.skills_dir, "villa-concierge")
    with open(os.path.join(folder, "villa.skill.yaml"), "w") as f:
        yaml.safe_dump({"off_commands": {"concierge.py": ["find"], "gone.py": True}}, f)     # an unknown one: ignored
    sk = agent.skills.get("villa-concierge")
    with pytest.raises(ToolError, match="switched off for this villa"):
        validate_script_args(sk, "villa-concierge", "concierge.py", ["find", "--what", "lights"], agent.s.out_dir)
    assert validate_script_args(sk, "villa-concierge", "concierge.py", ["status"], agent.s.out_dir) == ["status"]
    read = next(t for t in agent.toolbox().tool_objects(Person(OWNER, "O", "owner"), Origin(OWNER_CHAT, CONVERSATION))
                if t.name == "read_skill")
    text = run(read.handler({"skill": "villa-concierge"}))["content"][0]["text"]
    assert "concierge.py (status)" in text
    # a villa.* file is the villa's: the skill still follows the releases
    assert Skills(agent.s.skills_dir, agent.skills.starter_dir).release_state("villa-concierge")["state"] == "follows"


def test_each_tool_call_is_recorded_in_short_with_the_run(agent):
    from claude_agent_sdk import AssistantMessage, ToolUseBlock
    c = runner.Collector()
    c.feed(AssistantMessage(content=[ToolUseBlock("1", "mcp__vesta__run_skill_script",
                                                  {"skill": "villa-concierge", "script": "concierge.py", "args": ["find", "--what", "lights"]}),
                                     ToolUseBlock("2", "WebSearch", {"query": "storm warning Bali"}),
                                     ToolUseBlock("3", "mcp__vesta__ha_get_state", {"entity_id": "sensor.x", "vesta_part": 2})],
                            model="haiku"))
    assert c.steps == [{"tool": "run_skill_script", "input": "concierge.py find --what lights"},
                       {"tool": "web_search", "input": "storm warning Bali"},
                       {"tool": "ha_get_state", "input": '"entity_id": "sensor.x"'}]


def test_the_page_gets_the_servers_list_from_the_agent(agent):
    listed = tool_access.read_list(agent.s.data_dir)
    assert listed["server"] == "ha-mcp 8.6.0" and len(listed["tools"]) == len(SERVER)
    cat = tool_access.catalog(agent.policy(), listed, {"ha_get_state": 4})
    groups = {g["key"]: g for g in cat["groups"]}
    assert [t["name"] for t in groups["cameras"]["tools"]] == ["ha_get_camera_image"]
    assert {t["name"] for t in cat["never"]} == {"ha_config_set_automation", "ha_manage_theme"}
    assert next(t for t in groups["states"]["tools"] if t["name"] == "ha_get_state")["used"] == 4


def test_a_tool_a_later_server_adds_is_new_and_off(tmp_path):
    from datetime import datetime, timedelta, timezone
    now = datetime(2026, 10, 6, tzinfo=timezone.utc)
    tool_access.save_list(str(tmp_path), SERVER[:2], now=now - timedelta(days=10))
    tool_access.save_list(str(tmp_path), SERVER[:2] + [{"name": "ha_get_zone", "annotations": RO}], now=now)
    cat = tool_access.catalog(Policy({"ha_read_tools": ["ha_get_state"]}), tool_access.read_list(str(tmp_path)), {}, now=now)
    rows = {t["name"]: t for g in cat["groups"] for t in g["tools"]}
    assert rows["ha_get_zone"]["new"] and not rows["ha_get_zone"]["on"] and not rows["ha_get_state"]["new"]
    assert cat["new_off"] == 1


def test_the_new_sections_are_checked_before_a_save():
    assert problems({"agent_tools": {"start_job": False}, "tool_access": {"fm": {"cameras": False}},
                     "skills_off": ["roi-energy"]}) == []
    bad = problems({"agent_tools": {"read_skill": False}, "tool_access": {"owner": {}, "fm": {"zz": True}},
                    "skills_off": "roi-energy"})
    assert len(bad) == 4




def test_a_camera_picture_the_ai_looked_at_reaches_the_chat_with_its_answer(agent, monkeypatch):
    # 2026-10-06, twice: asked to show the living room camera, the AI looked with ha_get_camera_image, wrote
    # "here's the current view", and the chat got text only (an option to send it was not used by the model)
    class Session:
        @staticmethod
        def call_raw(name, args):
            if name == "ha_get_camera_image":
                return {"content": [{"type": "image", "data": "SlBFRw==", "mimeType": "image/jpeg"}]}
            return {"content": [{"type": "text", "text": "{}"}]}
    agent.reader.mcp = Session
    owner, built = Person(OWNER, "Owner", "owner"), []
    real_toolbox = agent.toolbox
    monkeypatch.setattr(agent, "toolbox", lambda allowed=None: built.append(real_toolbox(allowed)) or built[-1])

    def converse_after(name, args):
        async def the_ai(settings_, system, prompt, server, allowed, state, who, **kw):
            tool = next(t for t in built[-1].tool_objects(owner, Origin(OWNER_CHAT, CONVERSATION)) if t.name == name)
            await tool.handler(args)                                            # what the AI does in the run
            return runner.RunResult("Here is the lounge now.", None, False, 0.01, [], None)
        monkeypatch.setattr(runner, "run", the_ai)
        agent.tg.sent.clear(), agent.tg.photos.clear()
        run(agent.converse(OWNER_CHAT, owner, "show me the lounge camera"))

    converse_after("ha_get_camera_image", {"entity_id": "camera.lounge"})
    assert agent.tg.photos == [(OWNER_CHAT, ("SlBFRw==", "image/jpeg"))]
    assert [t for _, t, _ in agent.tg.sent] == ["Here is the lounge now."]       # one message: photo + caption
    converse_after("ha_get_state", {})                                           # no picture: the answer alone
    assert agent.tg.photos == [] and [t for _, t, _ in agent.tg.sent] == ["Here is the lounge now."]
