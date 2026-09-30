"""The UI server (vesta_agent.ui), through HTTP as the page uses it. Synthetic data only."""
from __future__ import annotations

import asyncio
import os

import pytest
import yaml
from aiohttp.test_utils import TestClient, TestServer

from helpers import copy_skill, settings
from vesta_agent.ui.server import UI

HDR = {"X-Vesta-UI": "1"}


@pytest.fixture
def ui(tmp_path):
    s = settings(str(tmp_path))                                  # seeds policy.yaml from the starter example
    copy_skill("reports", s.skills_dir)
    return s


def call(s, fn, deployment="standalone"):
    async def go():
        async with TestClient(TestServer(UI(s, deployment).app())) as c:
            return await fn(c)
    return asyncio.run(go())


def test_only_home_assistants_gateway_may_connect_in_the_app(ui):
    async def fn(c):
        r = await c.get("/api/policy")
        return r.status
    assert call(ui, fn, deployment="ha_app") == 403              # the test client is 127.0.0.1, not 172.30.32.2
    assert call(ui, fn, deployment="standalone") == 200


def test_a_write_without_the_pages_header_is_refused(ui):
    async def fn(c):
        doc = await (await c.get("/api/policy")).json()
        r1 = await c.put("/api/policy/text", json={"text": doc["text"], "rev": doc["rev"]})           # no header
        r2 = await c.put("/api/policy/text", data="text=x", headers=HDR)                            # a form post
        return r1.status, r2.status
    assert call(ui, fn) == (403, 403)


def test_the_forms_save_keeps_the_files_comments_and_the_agent_reads_it(ui):
    async def fn(c):
        doc = await (await c.get("/api/policy")).json()
        form = doc["form"]
        form["act_enabled"] = True
        form["people"] = [{"telegram_id": 111, "name": "Owner A", "role": "owner", "language": "en"}]
        form["allowed_services"]["light.turn_on"] = "direct"
        r = await c.put("/api/policy/form", json={"form": form, "rev": doc["rev"]}, headers=HDR)
        return r.status, await r.json()
    status, body = call(ui, fn)
    assert status == 200, body
    text = open(ui.policy_path).read()
    assert "# Chat ids. A group id is a negative number" in text                 # a comment of the example, kept
    raw = yaml.safe_load(text)
    assert raw["act_enabled"] is True and raw["allowed_services"]["light.turn_on"] == "direct"
    assert raw["people"][0]["telegram_id"] == 111


def test_a_save_the_agent_would_misread_is_refused_and_the_file_untouched(ui):
    before = open(ui.policy_path).read()

    async def fn(c):
        doc = await (await c.get("/api/policy")).json()
        form = doc["form"]
        form["people"] = [{"telegram_id": 111, "name": "X", "role": "boss", "language": "en"}]
        form["allowed_services"]["homeassistant.restart"] = "any"
        r = await c.put("/api/policy/form", json={"form": form, "rev": doc["rev"]}, headers=HDR)
        r2 = await c.put("/api/policy/text", json={"text": "people: [unclosed", "rev": doc["rev"]}, headers=HDR)
        return r.status, (await r.json())["problems"], r2.status
    status, problems, status2 = call(ui, fn)
    assert status == 400 and status2 == 400
    assert any("role must be owner or fm" in p for p in problems)
    assert any("homeassistant.restart is never allowed" in p for p in problems)
    assert open(ui.policy_path).read() == before


def test_a_file_changed_elsewhere_is_never_overwritten(ui):
    async def fn(c):
        doc = await (await c.get("/api/policy")).json()
        with open(ui.policy_path, "a") as f:                     # Studio Code Server saves meanwhile
            f.write("\n# edited elsewhere\n")
        r = await c.put("/api/policy/text", json={"text": doc["text"], "rev": doc["rev"]}, headers=HDR)
        return r.status
    assert call(ui, fn) == 409
    assert "# edited elsewhere" in open(ui.policy_path).read()


def test_skills_are_added_edited_and_deleted_while_checked_by_the_agents_parser(ui):
    async def fn(c):
        out = {}
        out["create"] = (await c.post("/api/skills", json={"name": "pool-care"}, headers=HDR)).status
        out["listed"] = [s["name"] for s in (await (await c.get("/api/skills")).json())["skills"]]
        f = await (await c.get("/api/skills/pool-care/file?path=skill.yaml")).json()
        # a schedule the parser refuses: not saved
        bad = f["content"] + "schedule:\n  - when: \"at noon\"\n    prompt: x\n"
        r = await c.put("/api/skills/pool-care/file?path=skill.yaml", json={"content": bad, "rev": f["rev"]}, headers=HDR)
        out["bad_yaml"] = (r.status, (await r.json())["problems"][0])
        # a script with a syntax error: not saved
        r = await c.put("/api/skills/pool-care/file?path=scripts/check.py", json={"content": "def (:\n", "rev": None}, headers=HDR)
        out["bad_py"] = r.status
        r = await c.put("/api/skills/pool-care/file?path=scripts/check.py", json={"content": "print('ok')\n", "rev": None}, headers=HDR)
        out["good_py"] = r.status
        good = f["content"] + "scripts:\n  check.py: {}\n"
        r = await c.put("/api/skills/pool-care/file?path=skill.yaml", json={"content": good, "rev": f["rev"]}, headers=HDR)
        out["good_yaml"] = r.status
        # deleting the script skill.yaml names would switch the skill off: refused
        out["del_used"] = (await c.delete("/api/skills/pool-care/file?path=scripts/check.py", json={}, headers=HDR)).status
        out["del_protected"] = (await c.delete("/api/skills/pool-care/file?path=SKILL.md", json={}, headers=HDR)).status
        out["traversal"] = (await c.get("/api/skills/pool-care/file?path=../../agent/policy.yaml")).status
        out["dotfile"] = (await c.put("/api/skills/pool-care/file?path=.seeded", json={"content": "", "rev": None}, headers=HDR)).status
        out["delete"] = (await c.delete("/api/skills/pool-care", json={}, headers=HDR)).status
        return out
    out = call(ui, fn)
    assert out["create"] == 200 and "pool-care" in out["listed"]
    assert out["bad_yaml"][0] == 400 and "switch this skill off" in out["bad_yaml"][1]
    assert out["bad_py"] == 400 and out["good_py"] == 200 and out["good_yaml"] == 200
    assert out["del_used"] == 400 and out["del_protected"] == 400
    assert out["traversal"] == 400 and out["dotfile"] == 400
    assert out["delete"] == 200
    assert not os.path.exists(os.path.join(ui.skills_dir, "pool-care"))
    assert os.listdir(os.path.join(ui.skills_dir, ".trash"))[0].startswith("pool-care-")      # kept, not erased


def test_the_page_and_its_files_are_served_with_a_strict_policy(ui):
    async def fn(c):
        r = await c.get("/")
        css = await c.get("/static/app.css")
        font = await c.get("/static/fonts/jost-var.woff2")
        return r.status, r.headers.get("Content-Security-Policy", ""), await r.text(), css.status, font.status
    status, csp, html, css, font = call(ui, fn)
    assert status == 200 and css == 200 and font == 200
    assert "default-src 'self'" in csp and "script-src 'self'" in csp
    assert "http://" not in html and "https://" not in html                         # nothing from the internet
