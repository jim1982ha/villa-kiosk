"""A value a person can change is never written as a fixed number where a person or the AI reads it (owner, 2026-10-23:
the alert desk's SKILL.md said `reopen_hours` "(4)" while the villa had set 1 h). The texts follow the setting; the page
shows each value as a link to its row on the Limits tab (core.setting)."""
from __future__ import annotations

import asyncio
import importlib.util
import os
import re

import pytest
import yaml
from aiohttp.test_utils import TestClient, TestServer

from helpers import STARTER_SKILLS, body_of, copy_skill, page_js, settings
from vesta_agent.ui.server import UI

HDR = {"X-Vesta-UI": "1"}
STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vesta_agent", "ui", "static")


@pytest.fixture
def ui(tmp_path):
    s = settings(str(tmp_path))
    for name in ("preventive-maintenance", "alert-desk", "investigate", "reports"):
        copy_skill(name, s.skills_dir)
    text = open(s.policy_path, encoding="utf-8").read()          # a policy the agent's checks accept on a save
    with open(s.policy_path, "w", encoding="utf-8") as f:
        f.write(text.replace("people: []", "people:\n  - {telegram_id: -100, name: Villa group, role: owner}\n"
                                            "  - {telegram_id: -100, name: Villa group FM, role: fm}", 1))
    return s


def call(s, fn):
    async def go():
        async with TestClient(TestServer(UI(s, "standalone").app())) as c:
            return await fn(c)
    return asyncio.run(go())


def get(s, path):
    async def fn(c):
        r = await c.get(path, headers=HDR)
        assert r.status == 200, await r.text()
        return await r.json()
    return call(s, fn)


def put(s, rid, value):
    async def fn(c):
        r = await c.put("/api/limits", json={"id": rid, "value": value}, headers=HDR)
        return r.status, await r.json()
    return call(s, fn)


def row(s, ref):
    return next(r for r in get(s, "/api/limits")["rows"] if r["ref"] == ref)


# ------------------------------------------------------------------ what the AI reads: settings named, never copied
def _docs():
    for skill in sorted(os.listdir(STARTER_SKILLS)):
        p = os.path.join(STARTER_SKILLS, skill, "SKILL.md")
        if os.path.isfile(p):
            yield skill, open(p, encoding="utf-8").read()


def test_a_skill_document_never_follows_a_setting_with_its_number():
    # "`reopen_hours` (4)", "`clear_minutes` (10)": a copy that stays when the villa changes the setting
    found = [(skill, m.group(0)) for skill, text in _docs() for m in re.finditer(r"`[\w.<>]+` \(\d[^)]*\)", text)]
    assert found == []


@pytest.mark.parametrize("skill, gone", [
    ("alert-desk", ["4 as shipped", "15 and 45 minute", "a 3-minute", "inside 5 minutes", "in 30 days", "at 07:00"]),
    ("preventive-maintenance", ["02:00", "07:00", "30-day", "default 8%", "25% shorter", "5% or more", "for 24 h",
                                "Ten or more", "at 10%", "LOW above 25"]),
    ("reports", ["07:00", "08:00", "4,096"]),
    ("roi-energy", ["above 50%", "30-day", "default 2 blocks"]),
    ("investigate", ["at most 90 characters"]),
])
def test_the_skills_name_their_settings_where_they_wrote_a_number(skill, gone):
    text = dict(_docs())[skill]
    assert [g for g in gone if g in text] == []


def test_a_report_job_is_not_told_a_time_its_schedule_may_not_say():
    # "It is 07:00." while the job's `when` is a setting, and while a person asked for it at 15:00
    jobs = yaml.safe_load(open(os.path.join(STARTER_SKILLS, "reports", "skill.yaml"), encoding="utf-8"))["schedule"]
    assert [j["name"] for j in jobs if re.search(r"\d\d:\d\d", j.get("prompt") or "")] == []


def test_the_filtration_advice_says_the_days_its_limit_reads(tmp_path, monkeypatch):
    def load(days=None):
        if days is not None:
            p = tmp_path / "limits.yaml"
            p.write_text(f"filtration.measured_days: {days}\n")
            monkeypatch.setenv("VESTA_LIMITS", str(p))
        spec = importlib.util.spec_from_file_location(
            f"fo_{days}", os.path.join(STARTER_SKILLS, "roi-energy", "scripts", "filtration_optimiser.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    monkeypatch.delenv("VESTA_LIMITS", raising=False)
    monkeypatch.setenv("VESTA_AGENT_CONFIG_DIR", str(tmp_path / "none"))
    assert load().no_power("pool_pump").endswith("(no statistics in the last 7 days)")
    assert load(3).no_power("pool_pump").endswith("(no statistics in the last 3 days)")


# ------------------------------------------------------------------ the page: each value now, linked to its row
def test_a_skill_document_shows_each_setting_it_names_with_its_value_now(ui):
    doc = get(ui, "/api/skills/alert-desk/file?path=SKILL.md")
    s = doc["settings"]
    for name in ("reopen_hours", "clear_minutes", "reask_minutes", "escalate_minutes", "siren.min_signals",
                 "siren.window_min", "problems.again_days", "alerts.fatigue_window_days", "siren_auto_off_min",
                 "approval_ttl_minutes"):
        assert f"`{name}`" in doc["content"] and name in s, name               # named there, and found here
    rid = {"src": "skill", "skill": "alert-desk", "file": "rules.yaml", "path": ["behaviour", "reopen_hours"]}
    assert s["reopen_hours"]["value"] == 4 and s["reopen_hours"]["ref"] == "skill:alert-desk:rules.yaml:behaviour.reopen_hours"
    assert row(ui, s["reopen_hours"]["ref"])["id"] == rid                       # the link names the row that saves it
    assert put(ui, rid, 1)[0] == 200
    assert get(ui, "/api/skills/alert-desk/file?path=SKILL.md")["settings"]["reopen_hours"]["value"] == 1
    # a name of another skill's file, or one of a list's entries, is not this skill's: no link at all
    pm = get(ui, "/api/skills/preventive-maintenance/file?path=SKILL.md")["settings"]
    assert pm["baseline_days"]["ref"] == "skill:preventive-maintenance:settings.yaml:behaviour.baseline_days"
    assert "reopen_hours" not in pm and "routes.0.cooldown_min" not in s
    assert get(ui, "/api/skills/alert-desk/file?path=rules.yaml")["settings"] == {}
    # a name two rows answer to (investigate's own brain in its skill.yaml, and the reports' AI jobs' brain in the
    # agent rules): left out, its full path kept
    inv = get(ui, "/api/skills/investigate/file?path=SKILL.md")["settings"]
    assert "brain" not in inv and "settings.skill_ai.reports.brain" in inv


def test_how_long_page_changes_are_kept_is_the_rule_now(ui):
    kept = get(ui, "/api/history")["kept_days"]
    assert kept == {"value": 90, "ref": "policy:settings.keep.records_days"}
    assert put(ui, row(ui, kept["ref"])["id"], 30)[0] == 200
    assert get(ui, "/api/history")["kept_days"]["value"] == 30


def test_a_scheduled_jobs_time_is_a_limit_the_skill_page_links_to(ui):
    ref = "skill:reports:skill.yaml:schedule.0.when"
    r = row(ui, ref)
    assert r["value"] == "07:00" and r["kind"] == "time" and r["group"] == "skills"
    assert get(ui, "/api/skills/reports")["acts"][0]["ref"] == ref
    status, body = put(ui, r["id"], "25:00")
    assert status == 400 and body["problems"] == ["A time is HH:MM (every day), Mon HH:MM (each week) or D HH:MM (each month)."]
    assert put(ui, r["id"], "06:30")[0] == 200
    assert get(ui, "/api/skills/reports")["acts"][0]["when"] == "every day at 06:30"
    with open(os.path.join(ui.skills_dir, "reports", "skill.yaml"), encoding="utf-8") as f:
        assert yaml.safe_load(f)["schedule"][0]["when"] == "06:30"


# ------------------------------------------------------------------ the page's one look and its link
def test_a_value_a_person_can_change_has_one_look_and_opens_its_limit():
    js = page_js()
    helper = body_of(js, "setting")
    assert 'class: "setting"' in helper and "page.focusLimit = ref;" in helper and 'go("limits")' in helper
    assert "if (!ref) return String(text);" in helper                          # no row known: plain text, no link
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    assert "a.setting {" in css and "tr.flash > td {" in css
    # where the page shows such a value today
    assert "setting(`${kept.value} days`, kept.ref)" in body_of(js, "historyCard")
    assert "setting(a.when, a.ref)" in body_of(js, "aboutSkill")
    viewer = open(os.path.join(STATIC, "viewer.js"), encoding="utf-8").read()
    assert 'x.t === "code" ? named(x.v)' in viewer and "return setting(`${v}: ${value}" in viewer
    assert "ed.set(f.content, f.rev, f.settings);" in js


def test_the_limits_tab_opens_on_the_row_a_value_asked_for():
    js = open(os.path.join(STATIC, "limits.js"), encoding="utf-8").read()
    tab = body_of(js, "limits")
    assert "const focus = page.focusLimit && data.rows.find((r) => r.ref === page.focusLimit);" in tab
    assert "page.focusLimit = null;" in tab                                      # read once
    assert "SEARCH = focus.name; FILTER = focus.name.toLowerCase(); page.tabs.limits = focus.group;" in tab
    assert 'value: SEARCH' in tab                                               # the search shows its exact name
    assert "if (focus) list.sort((a, b) => (b === focus) - (a === focus));" in tab
    assert '"data-ref": r.ref' in js
    assert 'lit.scrollIntoView?.({ behavior: "smooth", block: "center" });' in tab
    assert 'lit.classList.add("flash")' in tab
