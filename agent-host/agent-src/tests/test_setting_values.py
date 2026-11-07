"""A value a person can change is never written as a fixed number where a person or the AI reads it (owner, 2026-10-23:
the alert desk's SKILL.md said `reopen_hours` "(4)" while the villa had set 1 h). The texts follow the setting; the page
shows each value as a link to its row on the Limits tab (core.setting)."""
from __future__ import annotations

import asyncio
import os

import pytest
import yaml
from aiohttp.test_utils import TestClient, TestServer

from helpers import copy_skill, settings
from vesta_agent.ui.server import UI

HDR = {"X-Vesta-UI": "1"}
STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vesta_agent", "ui", "static")


@pytest.fixture
def ui(tmp_path):
    s = settings(str(tmp_path))
    for name in ("preventive-maintenance", "alert-desk", "investigate", "reports"):
        copy_skill(name, s.skills_dir)
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
# ------------------------------------------------------------------ the page: each value now, linked to its row
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
