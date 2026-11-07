"""The Limits tab (owner, 2026-10-20): every limit on one page, each saved where the agent already reads it."""
from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

import pytest
import yaml
from aiohttp.test_utils import TestClient, TestServer

from helpers import copy_skill, settings
from vesta_shared import limits, skill_settings
from vesta_agent.policy import Policy
from vesta_agent.ui.server import UI
from vesta_agent.roster import Roster

HDR = {"X-Vesta-UI": "1"}
@pytest.fixture
def ui(tmp_path):
    s = settings(str(tmp_path))
    for name in ("preventive-maintenance", "alert-desk", "investigate"):
        copy_skill(name, s.skills_dir)
    return s


def call(s, fn):
    async def go():
        async with TestClient(TestServer(UI(s, "standalone").app())) as c:
            return await fn(c)
    return asyncio.run(go())


def _rows(s):
    async def fn(c):
        r = await c.get("/api/limits")
        assert r.status == 200
        return await r.json()
    return call(s, fn)


def _put(s, rid, value):
    async def fn(c):
        r = await c.put("/api/limits", json={"id": rid, "value": value}, headers=HDR)
        return r.status, await r.json()
    return call(s, fn)


def test_limit_reads_the_file_and_falls_back_on_a_bad_value(tmp_path, monkeypatch):
    p = tmp_path / "limits.yaml"
    monkeypatch.setenv("VESTA_LIMITS", str(p))
    assert limits.limit("x.rows", 100, lo=1, hi=1000) == 100            # no file: the default
    p.write_text("x.rows: 250\nx.bad: 0\nx.words: [power, water]\n")
    assert limits.limit("x.rows", 100, lo=1, hi=1000) == 250
    assert limits.limit("x.bad", 5, lo=1) == 5                           # outside its bounds: the default
    assert limits.limit("x.words", ["power"]) == ["power", "water"]
    time.sleep(0.01)
    p.write_text("x.rows: 300\n")
    os.utime(p, (time.time() + 2, time.time() + 2))
    assert limits.limit("x.rows", 100, lo=1, hi=1000) == 300             # read again when the file changes


def test_the_tab_lists_the_code_the_skills_and_the_rules(ui):
    data = _rows(ui)
    src = {r["id"]["src"] for r in data["rows"]}
    assert src == {"code", "skill", "shared", "policy", "measured"} and data["problems"] == []
    kept = next(r for r in data["rows"] if r["id"]["src"] == "measured")
    assert kept["value"] == "not measured yet" and "purge_keep_days" in kept["also"]
    pm = next(r for r in data["rows"] if r["id"].get("skill") == "preventive-maintenance"
              and r["id"]["path"] == ["behaviour", "baseline_days"])
    assert pm["value"] == 30 and "to learn each piece of equipment's normal" in pm["label"]
    assert "Skills › preventive-maintenance › Files › settings.yaml" in pm["also"]
    assert "input_number.vesta_baseline_days" in pm["also"]               # a helper wins: said where it applies
    reply = next(r for r in data["rows"] if r["id"] == {"src": "policy", "path": ["settings", "reply_limit_usd"]})
    assert reply["also"].startswith("Also in Rules")


def test_a_code_limit_is_saved_in_limits_yaml_and_read_by_limit(ui, monkeypatch):
    data = _rows(ui)
    code = next(r for r in data["rows"] if r["id"]["src"] == "code" and r["kind"] == "number")
    d = limits.Declared(code["name"], code["default"], lo=code["lo"], hi=code["hi"])
    new = code["default"] + 1 if d.hi is None or code["default"] + 1 <= d.hi else code["default"] - 1
    status, _ = _put(ui, code["id"], new)
    assert status == 200
    path = os.path.join(ui.config_dir, "limits.yaml")
    assert yaml.safe_load(open(path))[code["name"]] == new
    monkeypatch.setenv("VESTA_LIMITS", path)
    assert limits.limit(code["name"], code["default"], lo=code["lo"], hi=code["hi"]) == new
    assert next(r for r in _rows(ui)["rows"] if r["id"] == code["id"])["value"] == new
    status, body = _put(ui, code["id"], "many")
    assert status == 400 and "must be a number" in body["problems"][0]


def test_a_skill_setting_is_saved_in_the_villas_own_file_and_the_skill_reads_it(ui):
    folder = os.path.join(ui.skills_dir, "preventive-maintenance")
    shipped = open(os.path.join(folder, "settings.yaml")).read()
    status, _ = _put(ui, {"src": "skill", "skill": "preventive-maintenance", "file": "settings.yaml",
                          "path": ["behaviour", "baseline_days"]}, 21)
    assert status == 200
    assert open(os.path.join(folder, "settings.yaml")).read() == shipped          # the skill's own file untouched
    assert skill_settings.load(folder, "settings.yaml")["behaviour"]["baseline_days"] == 21
    row = next(r for r in _rows(ui)["rows"] if r["id"].get("path") == ["behaviour", "baseline_days"])
    assert row["value"] == 21 and "villa.settings.yaml" in row["also"]
    status, body = _put(ui, row["id"], -3)
    assert status == 400


def test_a_rule_is_saved_in_policy_yaml_and_checked_by_the_agents_rules(ui):
    status, _ = _put(ui, {"src": "policy", "path": ["settings", "reply_limit_usd"]}, 2.5)
    assert status == 200
    assert Policy.load(ui.policy_path).behaviour["reply_limit_usd"] == 2.5
    status, body = _put(ui, {"src": "policy", "path": ["settings", "reply_limit_usd"]}, 0.01)
    assert status == 400 and "at least 0.05" in " ".join(body["problems"])


# ------------------------------------------------------------------ nothing cut by a bare number
#: The cut-shaped numbers that are NOT limits on what the agent reads, says or keeps — each with why. A new one fails
#: the release (test below) until it is declared with limit() or added here with its reason.
def test_a_value_set_on_the_tab_reaches_the_ais_own_reads(tmp_path, monkeypatch):
    # the real caller (tools.Toolbox), not the helper alone: the AI's history read gets the villa's page size and
    # period, and a 6-hour villa logbook window set to 2 refuses 3 hours
    from ha_fake import FakeHA, tool
    from helpers import make_agent
    from vesta_agent.routing import CONVERSATION, Origin
    p = tmp_path / "limits.yaml"
    monkeypatch.setenv("VESTA_LIMITS", str(p))
    p.write_text("ai.history_rows: 500\nai.history_default_hours: 48\nlogbook.villa_window_hours: 2\n")
    ha = FakeHA(tools=[tool("ha_get_history", entity_ids="string", source="string", start_time="string", limit="number"),
                       tool("ha_get_logs", source="string", hours_back="number", entity_id="string")])
    v = make_agent(tmp_path, {"ha_read_tools": ["ha_get_history", "ha_get_logs"]}, roster=Roster.of(owner=[(111, "Owner"), (-1, "Owner chat")]), reader=ha)
    asyncio.run(v.refresh_server_tools())
    tools = {t.name: t for t in v.toolbox().tool_objects(None, Origin(-1, CONVERSATION))}
    asyncio.run(tools["ha_get_history"].handler({"entity_ids": "sensor.example_power"}))
    assert ha.calls[-1][1]["limit"] == 500 and ha.calls[-1][1]["start_time"] == "48h"
    asyncio.run(tools["ha_get_history"].handler({"entity_ids": "sensor.example_power", "limit": 20}))
    assert ha.calls[-1][1]["limit"] == 20                                     # the AI's own number stands
    assert asyncio.run(tools["ha_get_logs"].handler({"source": "logbook", "hours_back": 3})).get("is_error")


def test_a_skills_ai_jobs_have_one_brain_and_one_limit_row_saved_whole(ui):
    # owner, 2026-10-20: one brain and one limit per run for all the AI jobs of a skill — an older file's (a limit per
    # job) is shown as the skill's pair, and a change from the tab writes the pair whole, the older entries gone
    copy_skill("reports", ui.skills_dir)
    raw = yaml.safe_load(open(ui.policy_path))
    raw["settings"].pop("skill_ai", None)
    raw["settings"]["jobs"] = {"fm-daily": {"profile": "auto", "limit_usd": 1}, "owner-monthly": {"profile": "auto", "limit_usd": 6}}
    with open(ui.policy_path, "w") as f:
        yaml.safe_dump(raw, f)
    rows = [r for r in _rows(ui)["rows"] if r["id"]["src"] == "policy" and "skill_ai" in r["id"]["path"]]
    assert {tuple(r["id"]["path"]): r["value"] for r in rows} == {
        ("settings", "skill_ai", "reports", "brain"): "auto", ("settings", "skill_ai", "reports", "limit_usd"): 2.0}
    assert not any("jobs" in r["id"]["path"] for r in _rows(ui)["rows"] if r["id"]["src"] == "policy")
    status, _ = _put(ui, {"src": "policy", "path": ["settings", "skill_ai", "reports", "limit_usd"]}, 3)
    assert status == 200
    s = yaml.safe_load(open(ui.policy_path))["settings"]
    assert s["skill_ai"] == {"reports": {"brain": "auto", "limit_usd": 3}} and "jobs" not in s


def test_what_counts_as_running_is_one_row_and_its_save_changes_every_skill(ui):
    # review J, 0.12.341: on_threshold_fraction was four rows, each "the villa's one definition"; one saved at 0.5, the
    # night check read 0.5 and the reports and energy figures 0.2 — a pump ran in one message and not in another
    files = {"investigate": "settings.yaml", "preventive-maintenance": "settings.yaml", "reports": "reports.yaml",
             "roi-energy": "settings.yaml"}
    for n in files:
        if not os.path.isdir(os.path.join(ui.skills_dir, n)):
            copy_skill(n, ui.skills_dir)
    rows = [r for r in _rows(ui)["rows"] if r["name"].endswith("on_threshold_fraction")]
    assert len(rows) == 1 and rows[0]["id"] == {"src": "shared", "key": "on_threshold_fraction"}
    assert rows[0]["value"] == 0.2 and rows[0]["unit"] == "share (0 to 1)"
    assert _put(ui, rows[0]["id"], 0.5) == (200, {"ok": True})
    got = {n: skill_settings.behaviour(skill_settings.load(os.path.join(ui.skills_dir, n), f))["on_threshold_fraction"]
           for n, f in files.items()}
    assert got == {n: 0.5 for n in files}
    # each skill's villa file, never the skill's own (its updates keep coming)
    for n, f in files.items():
        assert yaml.safe_load(open(os.path.join(ui.skills_dir, n, f)))["behaviour"]["on_threshold_fraction"] == 0.2
    # a chip naming it in any skill's guide links to the one row
    assert UI(ui, "standalone").limits.names("reports")["on_threshold_fraction"]["ref"] == "shared:on_threshold_fraction"
    # skills that disagree (a villa file set by hand) are said, and one save joins them
    with open(os.path.join(ui.skills_dir, "reports", "villa.reports.yaml"), "w") as fh:
        fh.write("behaviour:\n  on_threshold_fraction: 0.3\n")
    row = next(r for r in _rows(ui)["rows"] if r["name"].endswith("on_threshold_fraction"))
    assert row["value"] == 0.5 and "Today they differ" in row["also"] and "reports 0.3" in row["also"]


def test_the_ais_read_skill_tool_gives_each_named_setting_its_value(tmp_path):
    # the AI reads the guide through read_skill: the values beside the names, as the page's chips show them
    from helpers import make_agent
    v = make_agent(str(tmp_path), {}, roster=Roster.of(), skills=["preventive-maintenance"])
    res = asyncio.run(v.toolbox()._read_skill().handler({"skill": "preventive-maintenance"}))
    text = res["content"][0]["text"]
    assert "`unavailable_minutes` (10 minutes)" in text and "`pack.rebuild_at` (01:30 villa time)" in text


def test_a_choice_is_said_in_its_words_and_a_share_stays_within_0_and_1(ui):
    # review L (2026-10-25): the save line, Page changes and "Changed from its usual" said "after_8h_silence"; a setting
    # whose unit reads "share (0 to 1)" took 5, and every skill then read 5
    st, _ = _put(ui, {"src": "policy", "path": ["settings", "conversation_reset"]}, "after_8h_silence")
    assert st == 200, _
    rows = _rows(ui)["rows"]
    share = next(r for r in rows if r["unit"] == "share (0 to 1)" and r["id"]["src"] == "skill")
    assert share["lo"] == 0 and share["hi"] == 1, share
    st, body = _put(ui, share["id"], 5)
    assert st == 400 and "a share, from 0 to 1" in body["problems"][0], body
    assert _put(ui, share["id"], 0.5)[0] == 200

    async def fn(c):
        return (await (await c.get("/api/history")).json())["changes"]
    whats = [r["what"] for r in call(ui, fn) if r["place"] == "Limits"]
    assert any(w == "settings.conversation_reset: Every day at 04:00 → After 8h of silence" for w in whats), whats
    assert any(" → 0.5" in w and ": → 0.5" not in w for w in whats), whats            # a skill's save says its value before
    js = (Path(__file__).resolve().parents[1] / "vesta_agent" / "ui" / "static" / "limits.js").read_text()
    assert "toast(`Saved: ${r.name} = ${said(r, value)}`)" in js


