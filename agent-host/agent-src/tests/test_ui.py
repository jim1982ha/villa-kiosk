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


def test_the_page_lists_the_ai_jobs_says_which_are_not_set_and_sets_them(ui):
    import yaml as _yaml
    with open(ui.policy_path) as f:
        raw = _yaml.safe_load(f)
    raw["settings"].pop("jobs", None)                                      # a policy.yaml from before 0.12.0
    with open(ui.policy_path, "w") as f:
        _yaml.safe_dump(raw, f)

    async def fn(c):
        jobs = (await (await c.get("/api/jobs")).json())["jobs"]
        before = (await (await c.get("/api/overview")).json())["jobs_not_set"]
        doc = await (await c.get("/api/policy")).json()
        form = doc["form"]
        for j in jobs:                                                     # what "Add them" does
            form["settings"]["jobs"][j["name"]] = j["default"]
        r = await c.put("/api/policy/form", json={"form": form, "rev": doc["rev"]}, headers=HDR)
        after = (await (await c.get("/api/overview")).json())["jobs_not_set"]
        return jobs, before, r.status, after
    jobs, before, status, after = call(ui, fn)
    assert {j["name"] for j in jobs} == {"fm-daily", "fm-weekly", "owner-monthly"}
    assert sorted(before) == ["fm-daily", "fm-weekly", "owner-monthly"] and status == 200 and after == []
    with open(ui.policy_path) as f:
        assert _yaml.safe_load(f)["settings"]["jobs"]["owner-monthly"] == {"profile": "performance", "limit_usd": 6}


def test_the_page_names_its_files_with_the_version_and_reports_its_errors_to_the_log(ui, caplog):
    from vesta_agent import __version__

    async def fn(c):
        html = await (await c.get("/")).text()
        js = await c.get(f"/static/{__version__}/app.js")
        err = await c.post("/api/client-error", json={"message": "TypeError: x is undefined at app.js:12"}, headers=HDR)
        return html, js.status, err.status
    html, js, err = call(ui, fn)
    assert f'src="static/{__version__}/app.js"' in html and f'href="static/{__version__}/app.css"' in html
    assert "{static}" not in html and js == 200 and err == 200
    assert any("UI: page error: TypeError: x is undefined at app.js:12" in r.getMessage() for r in caplog.records)


def test_the_page_sets_no_inline_style_its_csp_would_block():
    # seen on the villa: "Applying inline style violates ... style-src 'self'" — the style is silently dropped
    import re
    from vesta_agent.ui.server import STATIC
    js = open(os.path.join(STATIC, "app.js"), encoding="utf-8").read()
    assert not re.search(r"\bstyle\s*:", js)


def test_every_choice_is_the_pages_own_dropdown_never_the_platforms_picker():
    # owner, 2026-10-04: "a lot of dropdown menus are badly rendered" — a native <select> opens Android's grey
    # radio sheet or iOS's wheel, which no theme reaches; app.js dropdown() draws its own list instead
    import re
    from vesta_agent.ui.server import STATIC
    js = open(os.path.join(STATIC, "app.js"), encoding="utf-8").read()
    html = open(os.path.join(STATIC, "index.html"), encoding="utf-8").read()
    assert not re.search(r"""h\(\s*["']select["']|createElement\(\s*["']select""", js) and "<select" not in html
    assert js.count("dropdown(") >= 4 and "document.body.append(list)" in js


def test_the_overview_gives_the_apps_version_with_the_agents(ui, monkeypatch):
    from vesta_agent import __version__
    monkeypatch.setenv("VESTA_APP_VERSION", "9.9.9")

    async def fn(c):
        return await (await c.get("/api/overview")).json()
    o = call(ui, fn)
    assert (o["app_version"], o["version"]) == ("9.9.9", __version__)


def test_the_rules_choose_devices_from_the_villas_own_by_name(ui):
    # owner, 2026-10-01: "free form text inputs are not suitable" — the pickers list the pack's entities
    import json
    with open(ui.pack_path, "w") as f:
        json.dump({"families": {"security": [{"entity_id": "lock.example_door", "name": "Front door", "area": "Entrance"}],
                                "power": [{"entity_id": "lock.example_door", "name": "Front door", "area": "Entrance"}]},
                   "unclassified": [{"entity_id": "scene.example_evening", "name": "Evening", "area": ""}],
                   "generated_at": "2026-10-01T02:00:00+00:00"}, f)

    async def fn(c):
        return await (await c.get("/api/entities")).json(), await (await c.get("/api/policy")).json()
    ents, doc = call(ui, fn)
    assert ents["entities"] == [{"id": "scene.example_evening", "name": "Evening", "area": ""},
                                {"id": "lock.example_door", "name": "Front door", "area": "Entrance"}]
    from vesta_agent.app import LANG
    from vesta_agent.policy import LANGUAGES
    assert doc["languages"] == LANGUAGES and LANG is LANGUAGES                  # one list: the agent's and the menu's


def test_the_costs_tab_reads_every_run_from_the_agents_records(ui):
    import json
    from datetime import datetime, timedelta, timezone
    from vesta_agent.state import State
    with open(ui.policy_path) as f:
        raw = yaml.safe_load(f)
    owner = -100777
    raw["chats"] = {**(raw.get("chats") or {}), "owner": owner}
    with open(ui.policy_path, "w") as f:
        yaml.safe_dump(raw, f)
    st = State(ui.state_path)
    now = datetime.now(timezone.utc)
    rows = [((now - timedelta(hours=1)), {"who": "job:fm-weekly", "cost_usd": 1.25, "profile": "auto", "model": "claude-sonnet-5",
                                          "tokens": {"input_tokens": 1000, "output_tokens": 500, "cache_read_input_tokens": 9000}}),
            ((now - timedelta(days=2)), {"who": f"Ann@{owner}", "cost_usd": 0.2, "profile": "economy", "model": "claude-haiku-4-5",
                                         "tokens": {"input_tokens": 300, "output_tokens": 50}, "asked": "is the pool ok?"}),
            ((now - timedelta(days=40)), {"who": "Ann@1", "cost_usd": 9.0}),                              # outside 30 days
            ((now - timedelta(days=3)), {"who": "Bob@2", "cost_usd": 0.05})]                              # before 0.6.9: no model
    for at, d in rows:
        st.db.execute("insert into calls(at, kind, detail) values (?, 'run', ?)", (at.isoformat(), json.dumps(d)))
    st.db.execute("insert into calls(at, kind, detail) values (?, 'executed', '{}')", (now.isoformat(),))
    st.db.commit()

    async def fn(c):
        return await (await c.get("/api/costs?days=30")).json(), await (await c.get("/api/costs?days=999")).json()
    c, other = call(ui, fn)
    assert other["days"] == 30 and c["runs_count"] == 3 and c["period"] == 1.5
    assert [(g["name"], g["runs"], g["cost"]) for g in c["by_work"]] == [("fm-weekly", 1, 1.25), ("Chat replies", 2, 0.25)]
    assert {g["name"] for g in c["by_model"]} == {"claude-sonnet-5", "claude-haiku-4-5", "not recorded"}
    reply = next(r for r in c["runs"] if r["person"] == "Ann")
    assert reply["chat"] == "owner chat" and reply["asked"] == "is the pool ok?" and reply["tokens_in"] == 300
    bob = next(r for r in c["runs"] if r["person"] == "Bob")
    assert bob["model"] is None and bob["tokens_in"] is None and bob["chat"] == "private chat"   # recorded before 0.6.9
    assert len(c["by_day"]) == 30 and sum(d["cost"] for d in c["by_day"]) == 1.5


def test_a_run_records_its_brain_model_tokens_and_what_was_asked(ui, monkeypatch):
    # the Costs tab's source: before 0.6.9 a run kept only who and the cost
    from claude_agent_sdk import ResultMessage
    from vesta_agent import runner
    from vesta_agent.state import State

    class Fake:
        def __init__(self, options):
            self.options = options

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def query(self, prompt):
            pass

        async def receive_response(self):
            yield ResultMessage(subtype="success", duration_ms=4200, duration_api_ms=4000, is_error=False, num_turns=3,
                                session_id="s1", total_cost_usd=0.12,
                                usage={"input_tokens": 800, "output_tokens": 90, "cache_read_input_tokens": 5000})
    monkeypatch.setattr(runner, "ClaudeSDKClient", Fake)
    st = State(ui.state_path)
    asyncio.run(runner.run(ui, "sys", "prompt", None, set(), st, who="job:fm-weekly", profile="economy", asked="x" * 300))
    import json
    (d,) = [json.loads(c["detail"]) for c in st.calls_since("2000-01-01") if c["kind"] == "run"]
    assert d["profile"] == "economy" and d["model"] == runner.PROFILES["economy"][0] and d["turns"] == 3 and d["ms"] == 4200
    assert d["tokens"] == {"input_tokens": 800, "output_tokens": 90, "cache_read_input_tokens": 5000}
    assert d["cost_usd"] == 0.12 and len(d["asked"]) == 160


def test_the_page_is_told_the_schedules_and_the_brains_and_keeps_no_copy(ui):
    # architecture review, 2026-10-01: app.js re-parsed the schedule grammar and named the models itself
    async def fn(c):
        return (await (await c.get("/api/jobs")).json())["jobs"], await (await c.get("/api/policy")).json()
    jobs, doc = call(ui, fn)
    weekly = next(j for j in jobs if j["name"] == "fm-weekly")
    assert (weekly["when_words"], weekly["runs_per_month"]) == ("every Monday at 08:00", 4.35)
    daily = next(j for j in jobs if j["name"] == "fm-daily")
    assert (daily["when_words"], daily["runs_per_month"]) == ("every day at 07:00", 30.0)
    from vesta_agent.policy import PROFILES
    assert set(doc["profiles"]) == set(PROFILES) and doc["profiles"]["economy"] == "Economy (Haiku)"
    from vesta_agent.ui.server import STATIC
    js = open(os.path.join(STATIC, "app.js"), encoding="utf-8").read()
    assert "Sonnet" not in js and "Monday" not in js                       # no copy of either in the page


def test_every_set_of_figures_is_drawn_once_and_sits_two_to_a_row_on_a_phone():
    # Owner, 2026-10-02: Overview's "last 24 hours" and the Costs stacked one figure per line down a
    # phone. Both now go through figures(); its grid fits two 120px columns in a 320px card.
    import re
    from vesta_agent.ui.server import STATIC
    js = open(os.path.join(STATIC, "app.js"), encoding="utf-8").read()
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    assert js.count('class: "kpi"') == 1 and js.count("figures([") == 2   # one builder, both tabs call it
    rule = re.search(r"\.figures \{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\((\d+)px", css)
    assert rule and 2 * int(rule.group(1)) + 12 <= 320 - 2 * 20, "two figures must fit a 320px phone's card"


def test_the_title_line_holds_the_short_version_and_the_theme_toggle_on_the_right():
    # Owner, 2026-10-03: the version sat between the title and the toggle with margin-left:auto,
    # which pushed the toggle onto a line of its own on a phone.
    import re
    from vesta_agent.ui.server import STATIC
    html = open(os.path.join(STATIC, "index.html"), encoding="utf-8").read()
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    js = open(os.path.join(STATIC, "app.js"), encoding="utf-8").read()
    brand = re.search(r'<div class="brand">(.*?)</div>', html).group(1)
    assert 'id="ver"' in brand                                   # inline with the title
    assert html.index('class="brand"') < html.index('class="themes"')
    assert re.search(r"\.themes \{[^}]*margin-left: auto", css) and not re.search(r"\.ver \{[^}]*margin-left", css)
    assert "ver.textContent = `v${" in js and "ver.title = " in js   # short on screen, the full line on hover


def test_the_costs_period_sits_beside_its_label_and_a_separator_comes_before_the_figures():
    # Owner, 2026-10-03: "Period" above a full-width selector, the figures straight under it.
    from vesta_agent.ui.server import STATIC
    js = open(os.path.join(STATIC, "app.js"), encoding="utf-8").read()
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    assert 'h("label", { class: "field row" }, h("span", {}, "Period"), period)' in js
    assert 'h("div", { class: "divided" }, kpis)' in js
    assert ".field.row { flex-direction: row;" in css
