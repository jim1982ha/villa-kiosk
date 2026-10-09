"""AI tools (0.6.42, owner's design of 2026-10-06): one answer, built and refused in code.

Every check drives the real Toolbox / Vesta / Skills, never a copy of their tables."""
from __future__ import annotations

import asyncio
import os

import pytest
import yaml

from helpers import copy_skill, make_agent, settings
from ai_fake import FakeAI
from ha_fake import FakeHA
from telegram_fake import FakeTelegram
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


@pytest.fixture
def agent(tmp_path, monkeypatch):
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner"},
                                         {"telegram_id": FM, "name": "FM", "role": "fm"}],
                              "chats": {"owner": OWNER_CHAT, "fm": FM_CHAT},
                              "ha_read_tools": ["ha_get_state", "ha_get_history", "ha_get_camera_image",
                                                "ha_config_set_automation", "ha_manage_theme"],
                              "settings": {"jobs": {"fm-weekly": {"profile": "economy", "limit_usd": 1}}}},
                   skills=["reports", "villa-concierge"], reader=FakeHA(tools=SERVER, images={"camera.lounge": "SlBFRw=="}))
    v.runs = FakeAI("ok").install(monkeypatch).runs
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
    allowed = tool_access.allowed_for(v.policy(), v.server_tools, person.role if person else None,
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


def _report(agent):
    from vesta_agent.skills import ai_jobs
    return agent.skills.get("reports"), next(j for _, j in ai_jobs(agent.skills.all()) if j["name"] == "fm-weekly")


def test_a_report_on_schedule_gets_everything_switched_on_never_its_skills_list(agent):
    # owner, 2026-10-10: "the report skill shall never limit the tool access. Only the user role shall control what is
    # available". Until 0.6.112 a report got only skill.yaml's `tools:` (no camera here) — on schedule nobody asked
    sk, job = _report(agent)
    assert "ha_get_camera_image" not in sk.tools
    run(agent.jobs.run(sk, job))
    (r,) = agent.runs
    assert {"ha_get_history", "ha_get_camera_image", "web_search"} <= r["tools"]
    assert "mcp__vesta__ha_get_camera_image" in r["allowed"] and "WebSearch" in r["allowed"]


def test_a_report_asked_for_by_the_facility_manager_uses_what_they_may(agent, monkeypatch):
    # architecture review 14: the job's tools were chosen with no asker — with cameras refused to the facility manager,
    # a report they asked for still looked at the cameras, and its readings landed in their chat
    policy_edit(agent, tool_access={"fm": {"cameras": False}})
    tried = {}

    async def looks(run_):
        tried["camera"] = await run_["call"]("ha_get_camera_image", {"entity_id": "camera.lounge"})
    agent.runs = FakeAI("ok", act=looks).install(monkeypatch).runs

    async def ask():
        await agent.jobs.start("fm-weekly", FM_CHAT, "fm")
        await agent.chat_jobs.idle()
    run(ask())
    (r,) = agent.runs
    assert "ha_get_camera_image" not in r["tools"] and "ha_get_history" in r["tools"]
    assert tried["camera"].get("is_error")                                  # the run was never given it
    run(agent.jobs.start("fm-weekly", OWNER_CHAT, "owner"))                  # the owner asking: theirs
    run(agent.chat_jobs.idle())
    assert "ha_get_camera_image" in agent.runs[-1]["tools"]


def test_a_skill_works_without_a_tool_switched_off_and_the_ai_is_told(agent):
    # owner, 2026-10-10: "the skill shall adjust to it". Until 0.6.112 a tool switched off stopped the skill's reports
    # and its read_skill refused the whole skill
    policy_edit(agent, ha_read_tools=["ha_get_state", "ha_get_camera_image"])        # ha_get_history off
    sk, job = _report(agent)
    (b,) = tool_access.unavailable(agent.policy(), agent.server_tools, sk)
    assert b["tool"] == "ha_get_history" and b["fix"] == "ha" and "switched off" in b["why"]
    run(agent.jobs.run(sk, job))
    assert len(agent.runs) == 1                                                      # the report ran
    tb = agent.toolbox(tool_access.allowed_for(agent.policy(), agent.server_tools, "owner", OWNER_CHAT))
    read = next(t for t in tb.tool_objects(Person(OWNER, "O", "owner"), Origin(OWNER_CHAT, CONVERSATION)) if t.name == "read_skill")
    out = run(read.handler({"skill": "reports"}))
    text = out["content"][0]["text"]
    assert not out.get("is_error") and "You do not have these tools here" in text and "ha_get_history" in text
    # a tool this Home Assistant does not have is not listed: the AI goes without it
    assert "ha_search" in sk.tools and not any(x["tool"] == "ha_search" for x in tool_access.unavailable(agent.policy(), agent.server_tools, sk))


def test_what_a_skill_lacks_is_judged_on_the_runs_own_tools(agent):
    # architecture review 14: "can this skill be used" was judged on the villa's switches — the facility manager was
    # told a skill works while their run had none of its tools
    policy_edit(agent, tool_access={"fm": {"states": False}})
    sk = agent.skills.get("villa-concierge")
    fm_tools = tool_access.allowed_for(agent.policy(), agent.server_tools, "fm", FM)
    lacks = tool_access.unavailable(agent.policy(), agent.server_tools, sk, fm_tools)
    assert any(x["tool"] == "ha_get_state" and x["fix"] is None for x in lacks)
    assert not tool_access.unavailable(agent.policy(), agent.server_tools, sk)       # the villa has it on


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
    owner = Person(OWNER, "Owner", "owner")

    def converse_after(name, args):
        async def looks(run_):
            await run_["call"](name, args)                                      # what the AI does, with the run's tools
        FakeAI("Here is the lounge now.", act=looks).install(monkeypatch)
        agent.tg.sent.clear(), agent.tg.photos.clear()
        run(agent.converse(OWNER_CHAT, owner, "show me the lounge camera"))

    converse_after("ha_get_camera_image", {"entity_id": "camera.lounge"})
    assert agent.tg.photos == [(OWNER_CHAT, ("SlBFRw==", "image/jpeg"))]
    assert [t for _, t, _ in agent.tg.sent] == ["Here is the lounge now."]       # one message: photo + caption
    agent.tg.refuse.add("photo")                                                   # Telegram refuses the picture:
    converse_after("ha_get_camera_image", {"entity_id": "camera.lounge"})          # the answer still arrives, once
    assert agent.tg.photos == [] and [t for _, t, _ in agent.tg.sent] == [
        "Here is the lounge now.\n\n(The camera picture could not be sent.)"]
    agent.tg.refuse.clear()
    converse_after("ha_get_state", {})                                           # no picture: the answer alone
    assert agent.tg.photos == [] and [t for _, t, _ in agent.tg.sent] == ["Here is the lounge now."]


def test_the_chat_shows_typing_while_the_ai_works_and_not_after(agent, monkeypatch):
    # owner, 2026-10-06: dots "like if it was starting to write", gone once the answer is there
    from vesta_agent import delivery
    monkeypatch.setattr(delivery, "TYPING_EVERY_S", 0.01)
    seen = {}

    async def works(run_):
        await asyncio.sleep(0.1)
        seen["during"] = list(agent.tg.typing_in)
    FakeAI("Done.", act=works).install(monkeypatch)

    async def main():
        await agent.converse(OWNER_CHAT, Person(OWNER, "Owner", "owner"), "hello")
        after = len(agent.tg.typing_in)
        await asyncio.sleep(0.1)
        return after
    after = run(main())
    assert len(seen["during"]) >= 3 and set(seen["during"]) == {OWNER_CHAT}     # said again while it works
    assert len(agent.tg.typing_in) == after                                      # nothing once answered
    assert [t for _, t, _ in agent.tg.sent] == ["Done."]


def test_the_names_the_ai_may_call_are_the_tools_it_was_given(agent):
    # architecture review, 2026-10-06: the SDK's list of names and the built tools were two separate decisions
    owner = Person(OWNER, "Owner", "owner")
    for allowed in (None, tool_access.allowed_for(agent.policy(), agent.server_tools, "fm", FM) - {"save_file"}):
        tb = agent.toolbox(allowed)
        names = tb.for_run(owner, Origin(OWNER_CHAT, CONVERSATION)).names
        built = {f"mcp__vesta__{t.name}" for t in tb.tool_objects(owner, Origin(OWNER_CHAT, CONVERSATION))}
        assert names - {"WebSearch"} == built
    assert "mcp__vesta__save_file" not in names                       # left out by tool_access: not built at all


def test_reading_home_assistant_does_not_write_a_record_per_call(agent):
    tb = agent.toolbox()
    tool = next(t for t in tb.tool_objects(Person(OWNER, "Owner", "owner"), Origin(OWNER_CHAT, CONVERSATION))
                if t.name == "ha_get_state")
    before = len(agent.state.calls_since("1970"))

    class Mcp:
        @staticmethod
        def call_raw(name, args):
            return {"content": [{"type": "text", "text": "{}"}]}
    agent.reader.mcp = Mcp
    for _ in range(3):
        run(tool.handler({}))
    assert len(agent.state.calls_since("1970")) == before


def test_the_saved_list_reads_back_as_the_server_gave_it(tmp_path):
    # the page judges blockers from the saved list: read back, a tool keeps whether it can ever be on
    tool_access.save_list(str(tmp_path), SERVER)
    back = {t["name"]: tool_access.readable(t) for t in tool_access.saved_server_tools(str(tmp_path))}
    assert back == {t["name"]: tool_access.readable(t) for t in SERVER}
    assert tool_access.saved_server_tools(str(tmp_path / "none")) is None


def test_a_tool_call_kept_for_the_costs_tab_loses_a_token_by_its_shape():
    # architecture review 5: runner had its own scrubber, which knew only the configured secrets
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4eXoxMjMifQ.abcdefghijk"
    (st,) = runner.kept_steps([{"tool": "ha_eval_template", "input": f"token={jwt} and password=hunter2xyz"}], ["known-secret-1"])
    assert jwt not in st["input"] and "hunter2xyz" not in st["input"] and st["tool"] == "ha_eval_template"


def test_whether_a_skill_works_is_one_answer(monkeypatch):
    # architecture review 6: the page's list and a skill's page each wrote their own "ok / why"
    monkeypatch.setattr(tool_access, "unavailable", lambda p, t, sk: [{"tool": "ha_get_history", "why": "History is off."}])
    assert tool_access.health(None, [], None, "skill.yaml: bad") == {"ok": False, "problem": "skill.yaml: bad", "line": "skill.yaml: bad", "without": []}
    assert tool_access.health(None, [], None)["problem"] == "switched off"
    h = tool_access.health(None, [], object())
    # a loaded skill works: what it goes without is said, never "not working" (owner, 2026-10-10)
    assert h["ok"] and h["problem"] is None and h["without"][0]["tool"] == "ha_get_history"
    # the list's one line (architecture review 8: the page parsed "It needs…" out of the sentence)
    assert h["line"] == "Works without a tool switched off."
    monkeypatch.setattr(tool_access, "unavailable", lambda p, t, sk: [])
    assert tool_access.health(None, [], object()) == {"ok": True, "problem": None, "line": None, "without": []}


# ---------------------------------------------------------------- architecture review 14: one turn
def test_two_reports_at_once_each_work_in_their_own_folder(agent, monkeypatch):
    # the weekly and the monthly report start together at 08:00 when the 1st is a Monday (1 February 2027): both
    # wrote facts.json / notes.json in one folder, and either page could be built from the other's figures
    from vesta_agent.skills import ai_jobs
    policy_edit(agent, settings={"jobs": {"fm-weekly": {"profile": "economy", "limit_usd": 1},
                                          "owner-monthly": {"profile": "economy", "limit_usd": 1}}})

    async def writes(run_):
        which = "weekly" if "job:fm-weekly" in run_["who"] else "monthly"
        await run_["call"]("save_file", {"name": "notes.json", "content": f'{{"report": "{which}"}}'})
        await asyncio.sleep(0.05)                                    # both runs are inside at once
    ai = FakeAI("ok", act=writes).install(monkeypatch)
    jobs = {j["name"]: (sk, j) for sk, j in ai_jobs(agent.skills.all())}

    async def both():
        await asyncio.gather(agent.jobs.run(*jobs["fm-weekly"]), agent.jobs.run(*jobs["owner-monthly"]))
    run(both())
    folders = {r["who"]: r["folder"] for r in ai.runs}
    assert len(set(folders.values())) == 2
    for who, folder in folders.items():
        want = "weekly" if "fm-weekly" in who else "monthly"
        assert open(os.path.join(folder, "notes.json")).read() == f'{{"report": "{want}"}}'
        assert os.path.dirname(folder) == os.path.join(agent.s.data_dir, "out", "runs")


def test_a_chat_and_a_report_get_their_terms_from_who_asks(agent):
    from vesta_agent.turn import chat_terms, job_terms
    from vesta_agent.routing import JOB
    pol = agent.policy()
    policy_edit(agent, tool_access={"fm": {"cameras": False}})
    pol = agent.policy()
    owner, fm = Person(OWNER, "Owner", "owner"), Person(FM, "FM", "fm")
    c = chat_terms(agent.s, pol, agent.server_tools, fm, FM)
    assert c.profile == agent.s.profile and c.limit_usd == agent.s.reply_limit_usd and "ha_get_camera_image" not in c.tools
    cfg = {"profile": "economy", "limit_usd": 2}
    assert job_terms(pol, agent.server_tools, "fm-weekly", cfg, None).tools >= {"ha_get_camera_image", "web_search"}
    asked = job_terms(pol, agent.server_tools, "fm-weekly", cfg, Origin(FM_CHAT, JOB, job="fm-weekly", role="fm"))
    assert "ha_get_camera_image" not in asked.tools and asked.model == "haiku" and asked.limit_usd == 2
    assert asked.who == "job:fm-weekly"
    assert "ha_get_camera_image" in job_terms(pol, agent.server_tools, "fm-weekly", cfg,
                                              Origin(OWNER_CHAT, JOB, job="fm-weekly", role="owner")).tools
    assert "ha_get_camera_image" in chat_terms(agent.s, pol, agent.server_tools, owner, OWNER_CHAT).tools


def test_a_scheduled_report_asked_for_meanwhile_is_already_being_made(agent, monkeypatch):
    # architecture review 14: the schedule kept its own "running" — asked for in the facility manager's chat at
    # 08:01, the same report ran a second time beside the scheduled one
    gate = asyncio.Event()

    async def slow(run_):
        await gate.wait()
    ai = FakeAI("ok", act=slow).install(monkeypatch)
    sk, job = _report(agent)

    async def go():
        scheduled = asyncio.create_task(agent.jobs.run(sk, job))
        await asyncio.sleep(0.02)
        answer = await agent.jobs.start("fm-weekly", FM_CHAT, "fm")
        gate.set()
        await scheduled
        await agent.chat_jobs.idle()
        return answer
    answer = run(go())
    assert len(ai.runs) == 1 and ("just started" in answer or "still being made" in answer)


def test_a_job_name_two_skills_declare_is_refused_and_said(agent):
    # a copied test skill declaring fm-weekly shared its settings, its Costs row and its "already running"
    from helpers import make_skill
    make_skill(agent.s.skills_dir, "reports-test", {"schedule": [{"when": "Tue 08:00", "name": "fm-weekly",
                                                                  "prompt": "x", "to": "fm"}]})
    assert "reports-test" not in agent.skills.all() and "reports" in agent.skills.all()
    assert "same name as the skill reports's" in agent.skills.problems()["reports-test"]


def test_the_ai_is_sent_to_start_job_only_when_it_has_it(agent):
    # architecture review 14: the "this is a job" refusal said "call start_job" with start_job switched off
    def refusal(person, chat):
        allowed = tool_access.allowed_for(agent.policy(), agent.server_tools, person.role, chat)
        tb = agent.toolbox(allowed)
        script = next(t for t in tb.tool_objects(person, Origin(chat, CONVERSATION)) if t.name == "run_skill_script")
        return run(script.handler({"skill": "reports", "script": "facts.py", "args": ["fm-weekly", "--energy", "week.json"]}))
    fm = Person(FM, "FM", "fm")
    assert "call start_job" in refusal(fm, FM)["content"][0]["text"]
    policy_edit(agent, tool_access={"fm": {"start_job": False}})
    said = refusal(fm, FM)
    assert said.get("is_error") and "start_job" not in said["content"][0]["text"] and "switched off" in said["content"][0]["text"]
