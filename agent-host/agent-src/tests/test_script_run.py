"""script_run.py: a skill's command run by the AI, by a job or from the page is judged and recorded the same way."""
from __future__ import annotations

import asyncio
import json
import os

import pytest
import yaml

from helpers import make_agent, make_skill, page_js, settings
from telegram_fake import FakeTelegram
from ha_fake import FakeHA, tool
from vesta_agent import script_run
from vesta_agent.app import Vesta
from vesta_agent.kiosk import Kiosk
from vesta_agent.routing import CONVERSATION, Origin

CHAT = 333
SECRET = "sk-ant-TEST-0123456789abcdef"


@pytest.fixture
def agent(tmp_path):
    make_skill(os.path.join(str(tmp_path), "skills"), "probe", {"description": "t", "scripts": {"p.py": {
        "commands": {"ok": "prints a decision", "idle": "nothing to do", "boom": "fails"}}}},
        {"p.py": "import json, sys\n"
                 "cmd = sys.argv[1]\n"
                 "if cmd == 'ok': print(json.dumps({'found': 1}))\n"
                 "elif cmd == 'idle': sys.exit(2)\n"
                 f"else: print('the token is {SECRET}', file=sys.stderr); sys.exit(3)\n"})
    return make_agent(tmp_path, {"people": [{"telegram_id": CHAT, "name": "Asker", "role": "owner"}],
                                 "chats": {"owner": -1001, "fm": -1002}}, reader=FakeHA(tools=[tool("ha_get_state")]))


def _records(v, kind):
    return [json.loads(c["detail"]) for c in v.state.calls_since("1970") if c["kind"] == kind]


def test_one_verdict_whoever_runs_it(agent):
    sk = agent.skills.get("probe")
    ok = script_run.run(agent.s, agent.state, sk, "p.py", ["ok"], by=script_run.JOB)
    idle = script_run.run(agent.s, agent.state, sk, "p.py", ["idle"], by=script_run.JOB)
    boom = script_run.run(agent.s, agent.state, sk, "p.py", ["boom"], by=script_run.JOB)
    assert (ok.verdict, idle.verdict, boom.verdict) == ("done", "nothing", "stopped")
    assert ok.result() == {"found": 1} and idle.result() == {} and boom.result() == {}
    assert SECRET not in boom.text() and SECRET not in (boom.error or "") and "[redacted]" in boom.error


def test_a_failure_is_recorded_alike_by_the_ai_a_job_and_the_page(agent):
    sk = agent.skills.get("probe")
    tool = next(t for t in agent.toolbox().tool_objects(None, Origin(CHAT, CONVERSATION)) if t.name == "run_skill_script")
    out = asyncio.run(tool.handler({"skill": "probe", "script": "p.py", "args": ["boom"]}))
    assert out.get("is_error") and SECRET not in out["content"][0]["text"]
    assert agent.code_command(sk, "p.py boom") == {}
    page = agent.try_command("probe", "p.py", ["boom"])
    assert page["verdict"] == "stopped" and page["ok"] is False and SECRET not in page["error"]
    assert [r["by"] for r in _records(agent, "script_failed")] == ["ai", "job", "page"]
    # and a run that worked is one "script" record, whoever ran it
    agent.code_command(sk, "p.py ok")
    agent.try_command("probe", "p.py", ["idle"])
    assert [r["by"] for r in _records(agent, "script")] == ["job", "page"]


def test_the_overview_counts_every_failed_script():
    js = page_js()
    assert 'count("script_failed")' in js
    from vesta_agent.status import STATUS_KINDS
    assert "script_failed" in STATUS_KINDS


def test_a_script_gets_the_pack_the_store_and_the_zone_its_skill_yaml_asks_for(tmp_path):
    # 0.12.67–0.12.68: the list was emptied by a name used twice, every script ran without them (the 07:00 digest
    # stopped: "fm-daily needs --pack"); the tests passed because they give those arguments themselves
    from helpers import copy_skill
    from vesta_agent.skills import Skills, injected
    s = settings(str(tmp_path))
    copy_skill("reports", s.skills_dir)
    sk = Skills(s.skills_dir).get("reports")
    args = injected(s, sk, "compose.py")
    assert args == ["--pack", s.pack_path, "--store", s.store_path, "--zone", s.timezone]
    # and through the real run: the script sees them
    make_skill(s.skills_dir, "echo", {"description": "t", "scripts": {"e.py": {"inject": ["pack", "store", "zone"]}}},
               {"e.py": "import json, sys\nprint(json.dumps(sys.argv[1:]))\n"})
    from vesta_agent.skills import run_script
    code, out, _ = run_script(s, Skills(s.skills_dir).get("echo"), "e.py", [])
    assert code == 0 and json.loads(out) == ["--pack", s.pack_path, "--store", s.store_path, "--zone", s.timezone]


def test_a_script_called_the_wrong_way_has_stopped_not_nothing_to_do(agent):
    # argparse exits 2 on a missing argument, as a skill's "nothing to do" does: the night check missing --pack was
    # recorded as fine
    make_skill(agent.s.skills_dir, "strict", {"description": "t", "scripts": {"s.py": {}}},
               {"s.py": "import argparse\nap = argparse.ArgumentParser(); ap.add_argument('--pack', required=True)\nap.parse_args()\n"})
    ans = script_run.run(agent.s, agent.state, agent.skills.get("strict"), "s.py", [], by=script_run.JOB)
    assert ans.code == 2 and not ans.ok and ans.verdict == "stopped" and "--pack" in ans.error
    assert [r["skill"] for r in _records(agent, "script_failed")] == ["strict"]
