"""The UI server (vesta_agent.ui), through HTTP as the page uses it. Synthetic data only."""
from __future__ import annotations

import asyncio
import os

import pytest
import yaml
from aiohttp.test_utils import TestClient, TestServer

from helpers import copy_skill, settings, page_js, body_of
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
        # the tab modules app.js imports, by relative paths: served from the same versioned folder
        mods = [(await c.get(f"/static/{__version__}/{m}.js")).status for m in ("core", "costs", "overview", "rules", "skills")]
        err = await c.post("/api/client-error", json={"message": "TypeError: x is undefined at app.js:12"}, headers=HDR)
        return html, js.status, err.status, mods
    html, js, err, mods = call(ui, fn)
    assert f'src="static/{__version__}/app.js"' in html and f'href="static/{__version__}/app.css"' in html
    assert "{static}" not in html and js == 200 and err == 200 and mods == [200] * 5
    assert any("UI: page error: TypeError: x is undefined at app.js:12" in r.getMessage() for r in caplog.records)


def test_the_page_sets_no_inline_style_its_csp_would_block():
    # seen on the villa: "Applying inline style violates ... style-src 'self'" — the style is silently dropped
    import re
    from vesta_agent.ui.server import STATIC
    js = page_js()
    assert not re.search(r"\bstyle\s*:", js)


def test_every_choice_is_the_pages_own_dropdown_never_the_platforms_picker():
    # owner, 2026-10-04: "a lot of dropdown menus are badly rendered" — a native <select> opens Android's grey
    # radio sheet or iOS's wheel, which no theme reaches; app.js dropdown() draws its own list instead
    import re
    from vesta_agent.ui.server import STATIC
    js = page_js()
    html = open(os.path.join(STATIC, "index.html"), encoding="utf-8").read()
    assert not re.search(r"""h\(\s*["']select["']|createElement\(\s*["']select""", js) and "<select" not in html
    assert js.count("dropdown(") >= 4 and "floating(box, list" in js           # on the page body, through floating()


def test_editable_tables_keep_their_columns_on_a_phone():
    # owner, 2026-10-04 (a phone screenshot): one long rule widened the services table off the screen. One
    # builder (editTable): fixed columns from <col> widths, and each column's phone place named by the column
    # itself — no CSS keyed to a column's position.
    import re
    from vesta_agent.ui.server import STATIC
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    js = page_js()
    assert "table.rows.edit, table.rows.ai { table-layout: fixed; }" in css and "table.rows { table-layout" not in css   # never the data tables
    assert js.count("...editTable(") == 2 and not re.search(r"rows\.(svc|people)", css)
    places = set(re.findall(r'phone: "(\w+)"', js))
    assert places and all(f"td.ph-{p_} {{ grid-area:" in css for p_ in places | {"x"}), places


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
    # the pack's real shape (KnowledgePack): `unclassified` holds ids only, so a device the pickers offer is in a family
    with open(ui.pack_path, "w") as f:
        json.dump({"villa": "x", "time_zone": "UTC", "generated_at": "2026-10-01T02:00:00+00:00", "ha_version": None,
                   "families": {"security": [{"entity_id": "lock.example_door", "name": "Front door", "area": "Entrance"}],
                                "power": [{"entity_id": "lock.example_door", "name": "Front door", "area": "Entrance"}],
                                "scene": [{"entity_id": "scene.example_evening", "name": "Evening", "area": ""}]},
                   "assets": {}, "areas": [], "people": [], "channels": {}, "unknown_area": [],
                   "unclassified": ["sensor.example_unknown"], "retention": {}}, f)

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
    # an unknown period falls back to the tab's own default: the last 7 days (owner, 2026-10-06)
    assert other["days"] == 7 and c["runs_count"] == 3 and c["period"] == 1.5
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
    js = page_js()
    assert "Sonnet" not in js and "Monday" not in js                       # no copy of either in the page


def test_every_set_of_figures_is_drawn_once_and_sits_two_to_a_row_on_a_phone():
    # Owner, 2026-10-02: Overview's "last 24 hours" and the Costs stacked one figure per line down a
    # phone. Both now go through figures(); its grid fits two 120px columns in a 320px card.
    import re
    from vesta_agent.ui.server import STATIC
    js = page_js()
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
    js = page_js()
    brand = re.search(r'<div class="brand">(.*?)</div>', html).group(1)
    assert 'id="ver"' in brand                                   # inline with the title
    assert html.index('class="brand"') < html.index('class="themes"')
    assert re.search(r"\.themes \{[^}]*margin-left: auto", css) and not re.search(r"\.ver \{[^}]*margin-left", css)
    assert "ver.textContent = `v${" in js and "ver.title = " in js   # short on screen, the full line on hover


def test_the_costs_period_sits_on_the_titles_line_and_a_separator_comes_before_the_figures():
    # Owner, 2026-10-03: not a full-width selector with the figures straight under it; 2026-10-06: on the title's
    # line, on the right
    from vesta_agent.ui.server import STATIC
    js = page_js()
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    assert 'titleWithInfo("What the AI cost"' in js and '"h2", period)' in js
    assert 'h("div", { class: "divided" }, kpis)' in js
    assert ".card-title-right { margin-left: auto; }" in css


def test_a_runs_details_are_its_tooltip_not_table_text():
    # owner, 2026-10-04: "don't show the details description directly in the table (like chat content), but
    # add it as tooltip" — and a tap shows them, since a phone has no hover
    from vesta_agent.ui.server import STATIC
    js = page_js()
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    what = js[js.index("function runWhat(r)"):js.index("async function costs(")]
    assert 'title: details.join("\\n")' in what and '"aria-expanded"' in what
    assert ".what-tip .what-detail { display: none;" in css and '.what-tip[aria-expanded="true"] .what-detail { display: block; }' in css
    assert "runWhat(r)," in js and 'class: "muted asked"' not in js


def test_a_data_table_becomes_labelled_cards_on_a_phone():
    # owner, 2026-10-05 (a phone screenshot): Every run's columns overlapped — fixed widths had reached the
    # paged data tables, whose numbers never wrap
    from vesta_agent.ui.server import STATIC
    js = page_js()
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    assert '"data-label": td ? label[i] : null' in js
    assert "table.data td::before { content: attr(data-label);" in css and "table.data thead { display: none; }" in css


def test_a_run_recorded_before_jobs_had_names_counts_under_its_name(tmp_path):
    # owner, 2026-10-05: "reports:07:00" and "reports:1 08:00" were today's fm-daily and owner-monthly, shown
    # as two other jobs — before 0.12.0 a run was recorded as "skill:when"
    import json
    from datetime import datetime, timedelta, timezone
    from vesta_agent import status
    from vesta_agent.state import State
    st = State(str(tmp_path / "s.sqlite"))
    now = datetime.now(timezone.utc)
    for who, cost in (("job:reports:07:00", 0.04), ("job:fm-daily", 0.04), ("job:reports:1 08:00", 0.06), ("job:other:09:00", 0.01)):
        st.db.execute("insert into calls(at, kind, detail) values (?, 'run', ?)",
                      ((now - timedelta(hours=1)).isoformat(), json.dumps({"who": who, "cost_usd": cost})))
    st.db.commit()
    # 0.6.42: rewritten once, at the agent's start, instead of being read two ways by the Costs tab
    assert st.rename_job_runs({"reports:07:00": "fm-daily", "reports:1 08:00": "owner-monthly"}) == 2
    assert st.rename_job_runs({"reports:07:00": "fm-daily", "reports:1 08:00": "owner-monthly"}) == 0     # once
    c = status.costs(st, 30)
    by = {g["name"]: g["runs"] for g in c["by_work"]}
    assert by == {"fm-daily": 2, "owner-monthly": 1, "other:09:00": 1}                # an unknown one keeps its label
    import inspect
    from vesta_agent.app import Vesta
    assert "self.state.rename_job_runs({f\"{sk.name}:{j['when']}\": j[\"name\"] for sk, j in ai_jobs(self.skills.all())})" \
        in inspect.getsource(Vesta.start)                                             # pin the caller


def test_every_run_pairs_its_columns_on_a_phone():
    # owner, 2026-10-05: "When" and "What" on one line, "Tokens in / out" and "Cost" on one line
    from vesta_agent.ui.server import STATIC
    js = page_js()
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    assert '{ v: "When", half: true }, { v: "What", half: true }, "Brain · model"' in js
    assert '{ v: "Tokens in / out", cls: "num", half: true }, { v: "Cost", cls: "num", half: true }' in js
    assert "table.data tr { display: grid; grid-template-columns: 1fr 1fr;" in css and "table.data td.ph-half { grid-column: auto;" in css


def test_the_file_editors_wrap_long_lines_instead_of_scrolling_sideways():
    # owner, 2026-10-06: a skill's or the rules' long lines must be readable without scrolling right.
    # Display only: the textarea keeps its default soft wrap, so nothing is added to the saved file.
    import re
    from vesta_agent.ui.server import STATIC
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    js = page_js()
    rule = re.search(r"textarea\.editor \{([^}]*)\}", css).group(1)
    assert "white-space: pre-wrap" in rule and "overflow-wrap: anywhere" in rule
    assert 'wrap: "off"' not in js and "wrap=\"off\"" not in js and js.count('h("textarea", { class: "editor"') == 2


def test_the_page_never_uses_the_browsers_own_dialogs():
    # owner, 2026-10-06: confirm/alert/prompt are drawn by the browser, titled with the site's address.
    # Every question goes through ask(), a <dialog> in the page's style.
    import re
    from vesta_agent.ui.server import STATIC
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    import glob
    for name in sorted(os.path.basename(f) for f in glob.glob(os.path.join(STATIC, "*.js"))):
        src = open(os.path.join(STATIC, name), encoding="utf-8").read()
        code = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("//"))
        assert not re.search(r"(?<![\w.])(confirm|alert|prompt)\(", code), name
    js = page_js()
    assert "async function guard()" in js and "showModal()" in js and "dialog.ask {" in css
    assert not re.search(r"[^\w](?<!await )guard\(\)", js.replace("async function guard()", "")), "a guard() not awaited"


def test_on_a_phone_an_open_skill_hides_the_list_and_offers_the_way_back():
    # owner, 2026-10-06: "make sure mobile display is properly handled" — the list above the skill pushed it a
    # screen down; the page opens the skill alone, with "‹ All skills"
    import re
    from vesta_agent.ui.server import STATIC
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    js = page_js()
    phone = re.search(r"@media \(max-width: 760px\) \{([^}]*\}){0,6}?[^}]*?\.skills\.has-open \.skills-side \{ display: none; \}", css)
    block = css[phone.start():css.index("\n}", phone.start())] if phone else ""
    assert phone and ".back-to-list { display: inline-flex; }" in block and re.search(r"\.back-to-list \{ display: none;", css)
    assert 'pane.closest(".skills")?.classList.add("has-open")' in js and 'side.classList.add("skills-side")' in js


def test_a_skill_is_named_and_switched_in_the_list_not_again_beside_it():
    # owner, 2026-10-06: no repeated title or description over the tabs; the switch in the list, the pill by the tabs
    from vesta_agent.ui.server import STATIC
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    js = page_js()
    assert ".skill-pane > .skill-head { display: none; }" in css
    assert "skillSwitch(s.name, !s.off, select)" in js                            # one switch per skill, in the list
    assert 'h("div", { class: "skill-bar" }, tabs, pill)' in js                    # the pill on the tabs' line
    assert "d.description ?" not in js.split("async function openSkill")[1].split("function aboutSkill")[0]


def test_the_rules_lists_show_at_most_15_lines_a_page():
    # owner, 2026-10-06: "paginate all the table to display a max number of 15 lines"
    from vesta_agent.ui.server import STATIC
    js = page_js()
    assert "const PER_PAGE = 15;" in js
    edit = body_of(js, "editTable")
    assert "pagedBlock(() => rows.length" in edit and "rows.slice(from, to)" in edit      # People, What the agent may do
    assert 'cls: "svc", add: "Add a service", blank: () => ["", "any"], per: 10,' in js     # the services: 10 a page
    tools = body_of(js, "toolsCard")
    assert "pagedBlock(() => lines.length" in tools                                    # Reading Home Assistant


def test_an_info_icon_shows_a_tooltip_never_text_in_the_page():
    # owner, 2026-10-06: the (i) shows its text as a tooltip on hover and on a tap, not inserted under the title
    from vesta_agent.ui.server import STATIC
    js = page_js()
    info = body_of(js, "titleWithInfo")
    assert "infoTip(btn, text)" in info and "hidden: true" not in info and "info-text" not in js
    tip = body_of(js, "infoTip")
    for ev in ('"mouseenter"', '"focus"', '"click"'):
        assert ev in tip
    assert 'h("div", { class: "tooltip" + (kind ? " " + kind : ""), role: "tooltip" }' in tip and "floating(btn," in tip
    assert 'titleWithInfo("What the AI cost"' in js and '"h2", period)' in js            # the period on the title's line


def test_the_lists_that_float_over_the_page_share_one_way_of_doing_it():
    # owner, 2026-10-06: the device picker's list, inside a table cell, took the cell's input rules (checkboxes as
    # wide as the cell); "use the same code for similar features": the dropdown, the picker and the tooltip all
    # float through floating(), tabs through subTabs(), pages through pagedBlock()
    from vesta_agent.ui.server import STATIC
    js = page_js()
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    for owner in ("function dropdown", "const picker = ", "function infoTip"):
        part = js.split(owner)[1][:3000]
        assert "floating(" in part, owner
    for owner in ("function dropdown", "const picker = ", "function infoTip"):     # none floats a panel its own way
        assert "document.body.append(" not in js.split(owner)[1][:3000].split("\nfunction ")[0], owner
    assert js.count('class: "subtabs"') == 1 and js.count('class: "pager"') == 1
    assert "table.rows td input:not([type=checkbox]):not([type=radio])" in css


def test_the_tools_are_cards_four_a_row_and_the_ai_notes_are_behind_an_info():
    # owner, 2026-10-06: tools as cards (max 4 a row, fewer on a phone), both tabs; The AI's two notes in (i)s
    import re
    from vesta_agent.ui.server import STATIC
    js = page_js()
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    tools = body_of(js, "toolsCard")
    assert tools.count('h("div", { class: "tool-grid" }') == 2 and "switchRow" not in tools
    assert ".tool-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));" in css
    assert re.search(r"@media \(max-width: 480px\) \{ \.tool-grid \{ grid-template-columns: 1fr; \} \}", css)
    assert 'withInfo("Limit (US$)", limitNote)' in js and "At their limits" not in js.split("const ai =")[1][:400]
    assert "Everything switched on, by role" not in js
    # the New conversation menu lines up with the brain and the limit: its name under it, not a label above it
    assert 'h("td", { class: "with-caption" }, sel(SCHEMA.resets' in js


def test_copying_a_setup_uses_only_the_pages_public_methods_and_each_exists():
    # architecture review 5: setup_copy called five of the page's private methods; a rename on one side broke it
    # silently. Its calls on `ui` are the page's interface: public, and each one a real method of UI.
    import inspect
    import re
    from vesta_agent.ui import setup_copy
    from vesta_agent.ui.server import UI
    called = set(re.findall(r"\bui\.([A-Za-z_]+)\(", inspect.getsource(setup_copy)))
    assert called and not any(n.startswith("_") for n in called), called
    assert all(callable(getattr(UI, n, None)) and not inspect.iscoroutinefunction(getattr(UI, n)) for n in called), called


def test_every_write_is_checked_by_its_kind_whoever_writes_it(ui):
    # architecture review 6: the rules' problems were checked only by a save from Rules and a script's syntax only by
    # the editor — an Undo (Overview › Changes) or an imported setup wrote either unchecked
    from vesta_agent.ui.server import UI, Refused
    page = UI(ui, "standalone")
    for place in ("Undo", "Import"):
        with pytest.raises(Refused, match="cannot be read as YAML"):
            page.text_change(place, "x", {"kind": "policy"}, "people: [")
        with pytest.raises(Refused, match="line 1"):
            page.text_change(place, "x", {"kind": "file", "skill": "reports", "path": "scripts/compose.py"}, "def (:\n")
        with pytest.raises(Refused, match="not valid YAML"):
            page.text_change(place, "x", {"kind": "file", "skill": "reports", "path": "reports.yaml"}, "a: [")
    text, r = page.policy_now()
    with pytest.raises(Refused, match="changed since you opened it"):
        page.text_change("Rules", "x", {"kind": "policy"}, text, base_rev="an-old-version")
    page.text_change("Rules", "x", {"kind": "policy"}, text, base_rev=r)          # the current version: written


def test_every_error_the_page_shows_has_its_reason_in_words():
    # architecture review 7: a dropped connection threw an error with no reasons; five places then showed an empty
    # box, or a "Not changed" with no words. The page reads an error only through core.reasons().
    import glob
    import re
    from helpers import STATIC
    core = open(os.path.join(STATIC, "core.js"), encoding="utf-8").read()
    assert "problems: [UNREACHABLE]" in body_of(core, "api") and "export async function saveWith" in core
    for path in glob.glob(os.path.join(STATIC, "*.js")):
        if path.endswith(("core.js", "errors.js")):
            continue
        src = open(path, encoding="utf-8").read()
        assert not re.search(r"\b(e|err)\.problems\b", src), f"{os.path.basename(path)} reads an error's problems by hand"
    assert len(re.findall(r"page\.dirty = false; fill\(probs\); showBar\(\)", page_js())) == 1    # one save: saveWith


def test_a_rows_icon_comes_first_so_every_icon_lines_up():
    # owner, 2026-10-08: the (i) of "without the AI" sat after its pill, out of line with a failed run's (!)
    body = body_of(page_js(), "madeWithoutAi")
    assert body.index("infoButton(") < body.index('"without the AI"')
