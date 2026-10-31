"""The UI server (vesta_agent.ui), through HTTP as the page uses it. Synthetic data only."""
from __future__ import annotations

from helpers import run_kit, run_terms
import asyncio
import os
from pathlib import Path

import pytest
import yaml
from aiohttp.test_utils import TestClient, TestServer

from helpers import copy_skill, settings, page_js, body_of
from vesta_agent.ui.server import UI
from vesta_agent.policy import PROFILES

HDR = {"X-Vesta-UI": "1"}


@pytest.fixture
def ui(tmp_path):
    s = settings(str(tmp_path))                                  # seeds policy.yaml from the starter example
    copy_skill("reports", s.skills_dir)
    # a villa set up: one Owner and one Facility manager in People (the page refuses a save without them)
    text = open(s.policy_path, encoding="utf-8").read()
    with open(s.policy_path, "w", encoding="utf-8") as f:
        f.write(text.replace("people: []", "people:\n  - {telegram_id: -100, name: Villa group, role: owner}\n"
                                            "  - {telegram_id: -100, name: Villa group FM, role: fm}", 1))
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
        form["allowed_services"]["light.turn_on"] = "direct"
        # owner, 2026-10-10: People needs at least one Owner and one Facility manager — without the latter, refused
        form["people"] = [{"telegram_id": 111, "name": "Owner A", "role": "owner", "language": "en"}]
        refused = await c.put("/api/policy/form", json={"form": form, "rev": doc["rev"]}, headers=HDR)
        form["people"].append({"telegram_id": -100, "name": "Villa group", "role": "fm", "language": "en"})
        r = await c.put("/api/policy/form", json={"form": form, "rev": doc["rev"]}, headers=HDR)
        return refused.status, await refused.json(), r.status, await r.json()
    no_fm, why, status, body = call(ui, fn)
    assert no_fm == 400 and any("at least one Facility Manager" in p for p in why["problems"])
    assert status == 200, body
    text = open(ui.policy_path).read()
    assert "# People, and where the agent posts" in text                 # a comment of the example, kept
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
    raw["settings"].pop("skill_ai", None)                                  # a policy.yaml from before 0.12.0
    with open(ui.policy_path, "w") as f:
        _yaml.safe_dump(raw, f)

    async def fn(c):
        jobs = (await (await c.get("/api/jobs")).json())["jobs"]
        before = (await (await c.get("/api/overview")).json())["jobs_not_set"]
        doc = await (await c.get("/api/policy")).json()
        form = doc["form"]
        for j in jobs:                                                     # what "Add them" does: the skill's pair
            form["settings"]["skill_ai"][j["skill"]] = j["skill_default"]
        r = await c.put("/api/policy/form", json={"form": form, "rev": doc["rev"]}, headers=HDR)
        after = (await (await c.get("/api/overview")).json())["jobs_not_set"]
        return jobs, before, r.status, after
    jobs, before, status, after = call(ui, fn)
    assert {j["name"] for j in jobs} == {"fm-daily", "fm-weekly", "owner-monthly"}
    assert sorted(before) == ["fm-daily", "fm-weekly", "owner-monthly"] and status == 200 and after == []
    with open(ui.policy_path) as f:
        written = _yaml.safe_load(f)["settings"]
    assert written["skill_ai"] == {"reports": {"brain": "auto", "limit_usd": 2.0}} and "jobs" not in written


def test_the_page_names_its_files_with_the_version_and_reports_its_errors_to_the_log(ui, caplog):
    from vesta_agent import __version__

    async def fn(c):
        html = await (await c.get("/")).text()
        js = await c.get(f"/static/{__version__}/app.js")
        # the tab modules app.js imports, by relative paths: served from the same versioned folder
        mods = [(await c.get(f"/static/{__version__}/{m}.js")).status for m in ("core", "costs", "overview", "rules", "skills", "markdown")]
        err = await c.post("/api/client-error", json={"message": "TypeError: x is undefined at app.js:12"}, headers=HDR)
        return html, js.status, err.status, mods
    html, js, err, mods = call(ui, fn)
    assert f'src="static/{__version__}/app.js"' in html and f'href="static/{__version__}/app.css"' in html
    assert "{static}" not in html and js == 200 and err == 200 and mods == [200] * 6
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
    from vesta_agent.policy import LANGUAGES
    assert doc["languages"] == LANGUAGES                  # one list: the agent's (policy.Language) and the menu's


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
    # the job named by its skill, as Overview names it (owner, 2026-10-20: "reports › …")
    assert [(g["name"], g["runs"], g["cost"]) for g in c["by_job"]] == [("reports › fm-weekly", 1, 1.25), ("Chat replies", 2, 0.25)]
    assert {g["name"] for g in c["by_model"]} == {"claude-sonnet-5", "claude-haiku-4-5", "not recorded"}
    # the group says itself that nothing was recorded (the page compared the name, architecture review 9)
    assert {g["name"]: g["recorded"] for g in c["by_model"]}["not recorded"] is False and "g.recorded ?" in page_js()
    reply = next(r for r in c["runs"] if r["person"] == "Ann")
    assert reply["chat"] == "owner group" and reply["asked"] == "is the pool ok?" and reply["tokens_in"] == 300
    bob = next(r for r in c["runs"] if r["person"] == "Bob")
    assert bob["model"] is None and bob["tokens_in"] is None and bob["chat"] == "private chat"   # recorded before 0.6.9
    assert len(c["by_day"]) == 30 and sum(d["cost"] for d in c["by_day"]) == 1.5
    # "Per run" and "Busiest day" are added up by the agent, never by the page (architecture review scan 4)
    assert c["per_run"] == 0.5 and c["busiest"]["cost"] == 1.25 and c["busiest"]["day"] in {d["day"] for d in c["by_day"]}
    assert "c.per_run" in page_js() and "c.busiest" in page_js() and "c.period / c.runs_count" not in page_js()


def test_a_reply_at_the_tablet_names_no_chat_and_a_telegram_one_keeps_its_chat(ui):
    # owner, 2026-10-31: Every run read "Reply to Owner at the tablet  private chat" — a tablet's conversation is no
    # Telegram chat, and its person already says "at the tablet". Its chat's words are none, by construction
    # (policy.chat_label), wherever a run's chat is said; a Telegram reply keeps "owner group"
    import json
    from datetime import datetime, timedelta, timezone
    from vesta_agent.policy import Policy, tablet_chat, tablet_person
    from vesta_agent.state import State
    tab = tablet_chat("owner")
    assert tab is not None and tablet_person(tab).name == "Owner at the tablet"
    st = State(ui.state_path)
    now = datetime.now(timezone.utc)
    for who in (f"Owner at the tablet@{tab}", "Villa group@-100"):
        st.db.execute("insert into calls(at, kind, detail) values (?, 'run', ?)",
                      ((now - timedelta(hours=1)).isoformat(), json.dumps({"who": who, "cost_usd": 0.01, "asked": "hi"})))
    st.db.commit()

    async def fn(c):
        return await (await c.get("/api/costs?days=7")).json()
    runs = {r["person"]: r["chat"] for r in call(ui, fn)["runs"]}
    assert runs == {"Owner at the tablet": None, "Villa group": "fm and owner group"}, runs
    pol = Policy.load(ui.policy_path)
    assert pol.chat_label(tab) == "" and pol.chat_label(-100) == "fm and owner group"


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
    # ⚠️ THE QUESTION WHOLE (owner, 2026-10-19): it was cut at 160 characters, mid-word, on the row and in its tooltip
    question = ("I have the feeling that my pool pump is not right, its consumption is unstable within a day " * 7)[:600]
    asyncio.run(runner.run(ui, "sys", "prompt", run_kit(), run_terms(who="job:fm-weekly", profile="economy"), st, asked=question))
    asyncio.run(runner.run(ui, "sys", "prompt", run_kit(), run_terms(who="job:fm-weekly", profile="economy"), st,
                           asked="y" * 2500 + " password=hunter2xyz"))
    import json
    d, pasted = [json.loads(c["detail"]) for c in st.calls_since("2000-01-01") if c["kind"] == "run"]
    assert d["profile"] == "economy" and d["model"] == PROFILES["economy"][0] and d["turns"] == 3 and d["ms"] == 4200
    assert d["tokens"] == {"input_tokens": 800, "output_tokens": 90, "cache_read_input_tokens": 5000}
    assert d["cost_usd"] == 0.12 and d["asked"] == question and len(question) == 600
    assert pasted["asked"] == "y" * runner.asked_chars() and runner.asked_chars() == 2000          # a limit still, a generous one

    async def fn(c):
        return await (await c.get("/api/costs?days=7")).json()
    served = call(ui, fn)
    assert question in [r["asked"] for r in served["runs"]]                                     # served whole
    # shown whole under the run (runMore), never cut (owner, 2026-10-31: once, no longer quoted on the run's line)
    more = body_of(page_js(), "runMore")
    assert 'r.asked ? h("p", { class: "run-asked" }, `“${r.asked}”`) : null' in more and ".slice(" not in more


def test_a_question_keeps_no_secret():
    from vesta_agent import runner
    assert runner.kept_asked("my key is password=hunter2xyz ok", []) == "my key is password=[redacted] ok"
    assert runner.kept_asked("", []) is None and runner.kept_asked(None, []) is None


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
    assert js.count('class: "kpi"') == 1 and js.count("figures([") == 1 and "figures(" not in js.split("export async function overview")[1].split("export ")[0]
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
    assert re.search(r"\.themes(, \.seg)? \{[^}]*margin-left: auto", css) and not re.search(r"\.ver \{[^}]*margin-left", css)
    assert "ver.textContent = `v${" in js and "ver.title = " in js   # short on screen, the full line on hover


def test_the_costs_period_sits_on_the_titles_line_and_the_figures_follow_with_no_separator():
    # Owner, 2026-10-03: not a full-width selector with the figures straight under it; 2026-10-06: on the title's
    # line, on the right; 2026-10-22: no line between the title row and the figures
    from vesta_agent.ui.server import STATIC
    js = page_js()
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    assert 'titleWithInfo(place("cost")' in js and '"h2", period)' in js
    assert '"h2", period),\n      kpis, h("div", { class: "divided" }' in js
    assert ".card-title-right { margin-left: auto; }" in css


def test_a_runs_question_is_shown_once_under_the_row_with_its_steps():
    # owner, 2026-10-04: the details reachable by a tap on a phone. Owner, 2026-10-19: the steps squeezed into the What
    # column pushed the row tall and floated the other columns — they open on demand, on a line of their own under the
    # row, across every column. Owner, 2026-10-31: the question was quoted on the run's line too, three lines of what
    # the pill opens whole: it is shown once, there; a run with a question and no step gets the pill all the same
    from vesta_agent.ui.server import STATIC
    js = page_js()
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    what, more = body_of(js, "runWhat"), body_of(js, "runMore")
    assert "r.asked" not in what.replace("steps.length || r.asked ? moreButton(", "") and "what-asked" not in js + css
    assert 'steps.length || r.asked ? moreButton(steps.length ? plural(steps.length, "step", "steps") : "Whole question")' in what
    assert "moreButton(" in what and 'class: "steps"' not in what and "table.data.runs td { vertical-align: top; }" in css
    assert 'h("tr", { class: "row-more", hidden: true }, cell({ v: r.more, colspan: head.length }))' in body_of(js, "paged")
    assert "{ more: (r.steps || []).length || r.asked ? runMore(r) : null, cells: [" in body_of(js, "costs")
    # each step: the agent's line, its arguments as they were in the tooltip — never the page's own JSON of them
    assert 'h("li", { title: x.raw || null }' in more and "x.summary" in more and "JSON.stringify" not in more + what
    assert "x.input" not in js
    assert "white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" in css[css.index("ol.steps .step-sum {"):]
    assert "table.data tr.row-more[hidden] { display: none; }" in css                     # the phone's grid rows too


def test_a_data_table_becomes_labelled_cards_on_a_phone():
    # owner, 2026-10-05 (a phone screenshot): Every run's columns overlapped — fixed widths had reached the
    # paged data tables, whose numbers never wrap
    from vesta_agent.ui.server import STATIC
    js = page_js()
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    assert 'cell(c, "td", { label: label[i] })' in body_of(js, "paged")
    assert '"data-label": label' in body_of(js, "cell")
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
    by = {g["name"]: g["runs"] for g in c["by_job"]}
    assert by == {"fm-daily": 2, "owner-monthly": 1, "other:09:00": 1}                # an unknown one keeps its label
    import inspect
    from vesta_agent.app import Vesta
    assert "self.state.rename_job_runs({f\"{sk.name}:{j['when']}\": j[\"name\"] for sk, j in ai_jobs(self.skills.all())})" \
        in inspect.getsource(Vesta.start)                                             # pin the caller


def _phone_css() -> str:
    """The page's rules for a phone's width (every @media (max-width: 600px) block), as one text."""
    import re
    from vesta_agent.ui.server import STATIC
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    out, at = [], 0
    while (m := re.compile(r"@media \(max-width: 600px\) \{").search(css, at)):
        depth, k = 1, m.end()
        while depth:
            depth += {"{": 1, "}": -1}.get(css[k], 0)
            k += 1
        out.append(css[m.end():k - 1])
        at = k
    return "\n".join(out)


def test_every_runs_card_on_a_phone_puts_each_name_left_and_its_value_right_on_one_line():
    # owner, 2026-10-31 (a phone): Every run paired When with What and Tokens in / out with Cost, each name over its
    # value — What's value sat left in its half, Cost's name on the right. Now every line is its name on the left, its
    # value on the same line at the right; no column of any list shares a line with another
    import re
    js = page_js()
    phone = _phone_css()
    runs = body_of(js, "costs")
    head = runs[runs.index('paged(["When"'):runs.index("runRows, 10")]
    assert "half" not in head and "half" not in body_of(js, "paged") and "ph-half" not in phone
    # one line per value: the row a block, each cell a row of name then value, never a column of them
    assert "table.data, table.data tbody, table.data tr, table.data td { display: block;" in phone
    assert not re.search(r"table\.data tr \{[^}]*display: grid", phone)
    td = re.search(r"\n\s*table\.data td \{([^}]*)\}", phone).group(1)
    assert "display: flex;" in td and "justify-content: space-between;" in td and "flex-direction" not in td
    assert not re.search(r"table\.data td[^{]*\{[^}]*flex-direction: column", phone)
    # What: its label and its chat at the right as they wrap (its pieces were left in its half)
    assert "table.data td > .what { justify-items: end; text-align: right; }" in phone
    assert "table.data td > .what .what-head { justify-content: flex-end; }" in phone
    # the steps' pill after the card's last line, at the right (owner, 2026-10-31): the one button, placed on the row's
    # card (room kept under the last line, open or shut), so it still opens the line under its own row
    assert "table.data tr:has(.more-btn) { position: relative; padding-bottom: 46px; }" in phone
    assert "table.data tr .more-btn { position: absolute; right: 0; bottom: 10px; margin: 0; }" in phone
    assert not re.search(r"table\.data td[^{]*\{[^}]*position: relative", phone)
    assert "table.data tr:has(+ tr.row-more:not([hidden])) { border-bottom: 0; }" in phone
    assert 'const more = btn.closest("tr")?.nextElementSibling;' in body_of(js, "moreButton")


def test_a_top_tabs_name_stays_on_one_line():
    # owner, 2026-10-31 (a phone): "(file)" fell under "Rules"; the bar scrolls sideways instead
    import re
    from vesta_agent.ui.server import STATIC
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    rule = re.search(r"\n\.tabs button \{([^}]*)\}", css).group(1)
    assert "white-space: nowrap;" in rule and "flex: none;" in rule
    assert "overflow-x: auto;" in re.search(r"\n\.tabs \{([^}]*)\}", css).group(1)


def test_the_file_editors_wrap_long_lines_instead_of_scrolling_sideways():
    # owner, 2026-10-06: a skill's or the rules' long lines must be readable without scrolling right.
    # Display only: the textarea keeps its default soft wrap, so nothing is added to the saved file.
    import re
    from vesta_agent.ui.server import STATIC
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    js = page_js()
    rule = re.search(r"textarea\.editor \{([^}]*)\}", css).group(1)
    assert "white-space: pre-wrap" in rule and "overflow-wrap: anywhere" in rule
    assert 'wrap: "off"' not in js and "wrap=\"off\"" not in js and js.count('h("textarea", { class: "editor"') == 1   # one editor (viewer.fileEditor)


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
    assert "pagedBlock(() => rows.length" in edit and "rows.slice(from, to)" in edit      # People, Allowed actions
    assert 'cls: "svc", add: "Add a service", blank: () => ["", "any"], per: 10,' in js     # the services: 10 a page
    tools = body_of(js, "toolsCard")
    assert "pagedBlock(() => lines.length" in tools                                    # Home Assistant tools


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
    assert 'titleWithInfo(place("cost")' in js and '"h2", period)' in js            # the period on the title's line


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
    assert re.search(r'\{ cls: "with-caption", v: \[\s*sel\(SCHEMA\.resets', js)


def test_copying_a_setup_uses_only_the_pages_public_methods_and_each_exists():
    # architecture review 5: setup_copy called five of the page's private methods; a rename on one side broke it
    # silently. Architecture review 9: it writes through changes.PageFiles (no HTTP class), only by public methods.
    import inspect
    import re
    from vesta_agent.ui import setup_copy
    from vesta_agent.ui.changes import PageFiles
    called = set(re.findall(r"\bpf\.([A-Za-z_]+)\(", inspect.getsource(setup_copy)))
    assert called and not any(n.startswith("_") for n in called), called
    assert all(callable(getattr(PageFiles, n, None)) for n in called), called
    assert "ui." not in inspect.getsource(setup_copy.apply)


def test_every_write_is_checked_by_its_kind_whoever_writes_it(ui):
    # architecture review 6: the rules' problems were checked only by a save from Rules and a script's syntax only by
    # the editor — an Undo (Overview › Changes) or an imported setup wrote either unchecked
    # architecture review 9: the checks live in changes.PageFiles, tested here without the page server
    from vesta_agent.history import History
    from vesta_agent.ui.changes import PageFiles, Refused
    page = PageFiles(ui, History(ui.history_path))
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


def test_a_skills_command_cards_show_no_options_and_their_explanation_is_an_i():
    # owner, 2026-10-08: "--as-of, --out, --skip-raw: too much detail for this view"; the sentence under the title
    # becomes its (i), as every other explanation on the page
    js = page_js()
    about = body_of(js, "aboutSkill")
    assert "sc.flags" not in about and 'class: "flag"' not in about
    assert '["commands", ABOUT_TEXT.commands, ABOUT_TEXT.switches, runs]' in about and 'h("p", { class: "muted small" }, "Switch a command off' not in js


def test_a_scheduled_job_is_named_not_its_slot_key():
    # owner, 2026-10-08: "reports:0:07:00" repeated the time the Ran at column shows
    import types
    from vesta_agent.scheduler import job_key, job_label
    skills = {"reports": types.SimpleNamespace(schedule=[{"when": "07:00", "name": "fm-daily", "prompt": "x"}]),
              "preventive-maintenance": types.SimpleNamespace(schedule=[{"when": "02:00", "run": "nightly.py --x"}])}
    assert job_label(job_key("reports", skills["reports"].schedule, 0), skills) == "reports › fm-daily"
    assert job_label(job_key("preventive-maintenance", skills["preventive-maintenance"].schedule, 0), skills) == \
        "preventive-maintenance › nightly.py"
    assert job_label("engine:pack", skills) == "Villa's device list (refreshed)"
    # an older engine's key names its place, which may be another job's now (review L): its skill only
    assert job_label("gone:3:Mon 08:00", skills) == "gone" and job_label("reports:0:07:00", skills) == "reports"
    assert job_key("reports", skills["reports"].schedule, 0) == "reports:fm-daily@07:00"     # the job itself


def test_deleting_a_job_never_lends_its_run_to_another_job_on_the_overview(tmp_path):
    # review L (2026-10-25): the daily report ran at 07:00, the owner deleted it, and "Scheduled jobs run" read
    # "reports › fm-weekly" — the run was kept under the entry's place in the list, and the weekly one took that place
    from vesta_agent.scheduler import job_key, job_label
    from vesta_agent.state import State
    from vesta_agent import status
    from datetime import datetime, timedelta, timezone
    import types
    st = State(str(tmp_path / "state.db"))
    daily, weekly = {"when": "07:00", "name": "fm-daily", "prompt": "x"}, {"when": "Mon 08:00", "name": "fm-weekly", "prompt": "y"}
    slot = datetime.now(timezone.utc).isoformat()
    assert st.claim_job_slot(job_key("reports", [daily, weekly], 0), slot, "reports:fm-daily")
    after = {"reports": types.SimpleNamespace(schedule=[weekly])}               # the daily job deleted
    rows = status.jobs_run(st, datetime.now(timezone.utc) - timedelta(hours=1), label=lambda k: job_label(k, after))
    assert [r["label"] for r in rows] == ["reports › fm-daily"], rows
    assert "j.label || j.job" in page_js()


def test_the_costs_tab_is_two_cards_of_two_tabs_and_the_page_one_width():
    # owner, 2026-10-08: By job (was By work) + By model in one card, Every run + Tools in another; the page half again as wide
    js = body_of(page_js(), "costs")
    assert js.count("tabbedCard(") == 2 and all(f'place("{k}")' in js for k in ("by_job", "by_model", "every_run", "tools_called"))
    css = open(os.path.join(os.path.dirname(__file__), "..", "vesta_agent", "ui", "static", "app.css"), encoding="utf-8").read()
    assert "--page-width: 1650px" in css and "1100px" not in css and css.count("max-width: var(--page-width)") == 4
    assert ".skills { display: grid; grid-template-columns: 364px 1fr;" in css     # the skills list, 30% wider


def test_the_cost_chart_is_drawn_at_the_cards_width_not_stretched():
    # owner, 2026-10-08: on the wider page the 640-unit chart stretched to ~500 px tall
    js = body_of(page_js(), "costs")
    assert "const W = Math.max(320, Math.round(($view.clientWidth" in js and "const W = 640" not in js


def test_a_skills_about_is_two_tabs_then_its_commands_each_with_its_offline_test():
    # owner, 2026-10-08: "Try a command" became an "Offline Test" pill on each command card, in a popup; when it runs
    # on top, then the commands and tools as two tabs. The rows come from the agent (test_page_controls); the names are
    # places.py's. Kept here: the page draws no "Try a command" any more, and a pill opens the popup.
    js = page_js()
    assert "Try a command" not in body_of(js, "openSkill") and "popup(" in body_of(js, "offlineTestPill")
    assert 'tabbed("about"' in body_of(js, "aboutSkill") and "offlineTestPill(" in body_of(js, "aboutSkill")

def test_a_tip_or_list_opened_inside_a_popup_is_drawn_inside_it():
    # a modal <dialog> is the top layer: the Offline Test popup's (i) opened its tip on the body, UNDER the popup
    fl = body_of(page_js(), "floating")
    assert 'anchor.closest("dialog[open]") || document.body).append(panel)' in fl and "document.body.append(panel)" not in fl


def test_the_offline_test_pill_sits_on_the_card_top_line_and_its_popup_opens_with_no_tip():
    # owner, 2026-10-08: the pill left of the switch (a line saved), "Test" alone on a narrow card; the popup opened
    # with the title's (i) tip showing: showModal focuses the first control, the (i), and a focus opens its tip
    js, css = page_js(), open(os.path.join(os.path.dirname(__file__), "..", "vesta_agent", "ui", "static", "app.css")).read()
    about = body_of(js, "aboutSkill")
    assert about.count("action: c.on ? offlineTestPill(") == 1 and about.count("action: !sc.whole_off ? offlineTestPill(") == 1
    assert "card-actions" not in about
    assert 'h("div", { class: "tool-card-side" }, action, sw)' in body_of(js, "toggleCard")
    assert 'h("span", { class: "long" }, "Offline "), "Test")' in body_of(js, "offlineTestPill")
    assert "@container (max-width: 300px) { .pill-btn .long { display: none; } }" in css and ".tool-card { container-type: inline-size; }" in css
    assert 'class: "btn ghost", autofocus: true' in body_of(js, "popup")


def test_the_offline_test_popup_has_no_subtitle_nor_options_heading_and_its_title_names_the_script():
    # owner, 2026-10-08: no subtitle, no "Options"; the title names the script (two scripts share fm-weekly)
    js = page_js()
    assert '"Options"' not in body_of(js, "tryPanel") and "${script.script} ${command}" in body_of(js, "offlineTestPill")

def test_every_table_and_every_tabbed_section_comes_from_one_builder():
    # owner, 2026-10-08: "all the tables formatted the same way, from the same centralised code" — a skill's "When is
    # it called" was a grid of its own, its second column elsewhere than every table's; four tab sections were each
    # drawn by hand. core.table builds every <table> (paged, editTable, the AI's work, the tools by role) and
    # core.tabbed every tab bar over a body.
    import re
    from helpers import page_js as _js
    from vesta_agent.ui.server import STATIC
    files = {f: open(os.path.join(STATIC, f), encoding="utf-8").read() for f in os.listdir(STATIC) if f.endswith(".js")}
    for f, src in files.items():
        hand = re.findall(r'h\("(table|thead|tbody|th|td)"', src)
        # a <tbody> its caller redraws is allowed: table() takes it as its body
        if f == "core.js":
            assert set(hand) <= {"table", "thead", "tbody"} and src.count('h("table"') == 1, hand   # core.table
        else:
            assert set(hand) <= {"tbody"}, (f, hand)
        assert "subTabs(" not in src or f in ("core.js", "skills.js"), f          # skills.js: About / Files / Compare
    assert files["skills.js"].count("subTabs(") == 1
    about = body_of(_js(), "aboutSkill")
    assert 'paged(["When", "What runs"]' in about and '"kv"' not in _js()
    for f, call in (("costs.js", 'tabbed(id, tabs)'), ("overview.js", 'tabbed("setup"'), ("rules.js", 'tabbed("tools"'), ("skills.js", 'tabbed("about"')):
        assert call in files[f], f
    assert 'table(head, body, { cls: `data ${cls}`.trim(), widths })' in body_of(_js(), "paged")          # a paged table is a data table
    assert "table([...columns.map((c) => c.title)" in body_of(_js(), "editTable")


def test_every_place_is_named_once_and_the_page_reads_the_names_from_the_server(ui):
    # owner, 2026-10-08: "all the titles and sub-titles consistent, so the user knows what shows what, and where it is
    # linked to". The same tools were "What the AI can use" in Rules and "Tools used by the Skill" on a skill, and
    # "Overview › Changes" sent the reader to a card titled "Changes made on these pages". places.py names each place
    # once; the page gets the table in its HTML, the server's sentences use it too.
    import glob, json, re
    from vesta_agent.places import PLACES, where
    from vesta_agent.ui.server import STATIC

    async def fn(c):
        return await (await c.get("/")).text()
    html = call(ui, fn)
    m = re.search(r'<script type="application/json" id="places">(.*?)</script>', html, re.S)
    from vesta_agent.places import ORDER, TABBED
    assert m and json.loads(m.group(1)) == {"places": {k: list(v) for k, v in PLACES.items()}, "order": ORDER, "tabbed": TABBED} and "{places}" not in html
    # the page's where() is the server's: "Tab › Card"
    assert "`${PLACES[k][1]} › ${place(k)}`" in page_js() and where("tools") == "Rules › AI tools"
    # a {slot} is filled the same way on both sides (owner, 2026-10-08: "When the reports skill runs")
    from vesta_agent.places import title
    assert (title("skill_when", skill="reports"), title("skill_when")) == ("When the reports skill runs", "When the skill runs")
    assert '.replace(/\\{(\\w+)\\} ?/g, (_, v) => (names[v] ? `${names[v]} ` : ""))' in page_js()
    assert 'place("skill_when", { skill: name })' in body_of(page_js(), "aboutSkill")
    # no title of two words or more is written by hand in the page's code, nor a "Tab › …" sentence
    # (the code without its comments, whole-line or at a line's end: a comment may name a place)
    js = {f: "\n".join(re.sub(r"(^|\s)//.*$", "", l) for l in open(f, encoding="utf-8").read().split("\n"))
          for f in glob.glob(os.path.join(STATIC, "*.js"))}
    for name, _ in PLACES.values():
        if " " in name:
            for f, code in js.items():
                assert not re.search(r'["`]' + re.escape(name) + r'["`]', code), (name, f)
    for f, code in js.items():
        assert not re.search(r'["`][^"`]*\b(Rules|Skills|Costs|Overview) › ', code), f
    # the names the agent used before this table are gone from its code and its page
    old = ("What the AI can use", "What the agent may do", "Who may use what", "The agent's own tools", "Reading Home Assistant",
           "Changes made on these pages", "Overview › Changes", "What the AI may run", "Where it went", "Tools it gets")
    # the agent's code, and the starter skills and config (a SKILL.md is what the AI reads, and may quote in a chat)
    root = os.path.join(os.path.dirname(__file__), "..")
    for f in glob.glob(os.path.join(root, "vesta_agent", "**", "*.*"), recursive=True) + glob.glob(os.path.join(root, "starter", "**", "*.*"), recursive=True):
        if f.endswith((".py", ".js", ".css", ".html", ".md", ".yaml")) and not f.endswith("places.py"):
            text = open(f, encoding="utf-8").read()
            assert not [o for o in old if o in text], (f, [o for o in old if o in text])


def test_rules_shows_ai_tools_right_below_ai_brains_and_limits():
    # owner, 2026-10-08: "move the AI tools section below the AI brains and limits section". The order is data
    # (places.ORDER, drawn by core.inOrder): this reads the list, not a line of code (architecture review 9)
    from vesta_agent.places import ORDER
    rules = ORDER["rules"]
    assert rules.index("tools") == rules.index("ai") + 1 and rules[-1] == "tools"
    assert 'inOrder("rules", {' in body_of(page_js(), "rulesForms")


def test_take_the_release_version_is_on_the_compare_tab_too():
    # owner, 2026-10-08: "i don't see any Take the release version button" — it was only in the banner, which
    # "Keep mine" hides for the rest of the release, while the Compare tab described it
    js = page_js()
    assert "takeReleaseButton(name)" in body_of(js, "comparePanel") and js.count('"Take the release version");') == 1
    assert "takeReleaseButton(name)" in body_of(js, "openSkill")


def _node(module: str, fn: str, text: str):
    """A function of one of the page's plain modules run by Node, as the browser runs it (no page needed)."""
    import json, shutil, subprocess
    from vesta_agent.ui.server import STATIC
    node = shutil.which("node")
    assert node, "Node is needed to test the page's file readers (GitHub's runners have it)"     # never skipped
    code = (f"import {{ {fn} }} from " + json.dumps("file://" + os.path.join(STATIC, module)) + ";"
            f"let t = ''; process.stdin.on('data', (d) => t += d).on('end', () => console.log(JSON.stringify({fn}(t))));")
    r = subprocess.run([node, "--input-type=module", "-e", code], input=text, capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _markdown(text: str):
    return _node("markdown.js", "parse", text)


def test_a_markdown_file_is_read_as_blocks_never_as_markup():
    # owner, 2026-10-08: "show the formatted md file instead of the raw version" — no library (no internet), no HTML
    b = _markdown("---\nname: reports\ndescription: a: b\n---\n\n# Title\n\nSome **bold _and_ it** `x*y` "
                  "[web](https://e.org) <script>alert(1)</script>\n<!-- left out\nof the page -->\n\n- one\n  - two\n"
                  "  more of two\n1. first\n\n| a | b |\n|---|:-:|\n| `c` | d |\n\n```yaml\nk: v\n```\n> said\n\n---\n")
    assert [x["t"] for x in b] == ["meta", "h", "p", "list", "table", "code", "quote", "hr"]
    assert b[0]["rows"] == [["name", "reports"], ["description", "a: b"]] and b[1] == {"t": "h", "level": 1, "inl": [{"t": "text", "v": "Title"}]}
    p = b[2]["inl"]
    assert p[1] == {"t": "b", "c": [{"t": "text", "v": "bold "}, {"t": "i", "c": [{"t": "text", "v": "and"}]}, {"t": "text", "v": " it"}]}
    assert {"t": "code", "v": "x*y"} in p and {"t": "a", "href": "https://e.org", "c": [{"t": "text", "v": "web"}]} in p
    assert p[-1] == {"t": "text", "v": " <script>alert(1)</script>"}           # text, drawn as text: never markup
    assert "left out" not in json_dumps(b)                                    # an HTML comment is not read
    assert [(i["depth"], i["ordered"]) for i in b[3]["items"]] == [(0, False), (1, False), (0, True)]
    assert b[3]["items"][1]["inl"] == [{"t": "text", "v": "two more of two"}]
    assert b[4]["head"] == [[{"t": "text", "v": "a"}], [{"t": "text", "v": "b"}]] and b[4]["rows"] == [[[{"t": "code", "v": "c"}], [{"t": "text", "v": "d"}]]]
    assert b[5] == {"t": "code", "lang": "yaml", "text": "k: v"} and b[6]["inl"] == [{"t": "text", "v": "said"}]
    # a "#" in front of a list line is a heading, as the owner found (2026-10-08): the reader shows it as one
    assert _markdown("# - `scripts/facts.py` every figure")[0]["t"] == "h"


def json_dumps(x):
    import json
    return json.dumps(x)


def test_a_markdown_or_yaml_file_opens_formatted_and_its_raw_text_is_one_press_away():
    # owner, 2026-10-08: a skill's Markdown, then "do this for Rules (file) too": ONE editor (viewer.fileEditor), both
    # places; its drawing is plain data (markdown.js, yaml.js), tested in Node below; no markup ever reaches the page
    js = page_js()
    assert "fileEditor(path," in body_of(js, "openSkill") and 'fileEditor("policy.yaml",' in body_of(js, "rulesFile")
    assert 'page.fileView || "formatted"' in body_of(js, "fileViewer") and "innerHTML" not in js

def test_a_yaml_file_is_coloured_piece_by_piece_and_nothing_is_lost():
    import json
    from vesta_agent.config import STARTER_DIR
    text = open(os.path.join(STARTER_DIR, "config", "policy.example.yaml"), encoding="utf-8").read()
    got = _node("yaml.js", "lines", text)
    assert "\n".join("".join(p["v"] for p in line) for line in got) == text.replace("\r\n", "\n")   # as written
    ex = _node("yaml.js", "lines", 'settings:\n  profile: economy   # the brain\n  n: 1.5\n  on: true\n  s: "a # b"\n  - item # c\nurl: http://x#y\n# all')
    kinds = [[p["t"] for p in line if p["t"] not in ("text", "ind")] for line in ex]
    assert kinds == [["key", "colon"], ["key", "colon", "val", "com"], ["key", "colon", "num"], ["key", "colon", "bool"],
                     ["key", "colon", "str"], ["dash", "val", "com"], ["key", "colon", "val"], ["com"]]
    assert ex[6][-1]["v"] == "http://x#y" and ex[4][-1] == {"t": "str", "v": '"a # b"'}         # a # inside a word or quotes stays


def test_a_cell_of_several_pieces_stays_one_value_on_a_phone():
    # owner, 2026-10-08 (a phone): "fm-daily" sat mid-card and its "AI job" chip at the edge, the card spreading them
    cell = body_of(page_js(), "cell")
    assert 'label !== null && Array.isArray(v)' in cell and 'many ? h("span", { class: "cell-v" }, v) : v' in cell



def test_the_tabs_roles_and_change_chips_are_named_by_the_agent(ui):
    # architecture review 9: names still typed on the page — the top tabs, the roles, the Page changes chips
    from vesta_agent.places import TABS
    from vesta_agent.policy import ROLE_WORDS, form_schema

    async def fn(c):
        html = await (await c.get("/")).text()
        await c.put("/api/skills/reports/on", json={"on": False}, headers=HDR)
        return html, (await (await c.get("/api/history")).json())["changes"]
    html, changes = call(ui, fn)
    assert "{tab:" not in html and all(f">{name}<" in html or f">{name} <" in html for name in TABS.values())
    assert form_schema()["roles"] == ROLE_WORDS and "SCHEMA.roles" in page_js() and '"Facility manager"' not in page_js()
    assert changes[0]["place"] == "Skills" and changes[0]["chip"] == "warn" and "const PLACE = {" not in page_js()


def test_every_class_the_stylesheet_styles_is_used_by_the_page():
    # architecture review 9: app.css only grew — rules for .ok, ul.plain, .inline, .files.views, code.flag, h3s that no
    # longer exist. A class named nowhere in the page's code (comments left out) is a dead rule. Classes built from a
    # prefix (`ph-${…}`, `y-${…}`) are named by the prefix.
    import glob, re
    from vesta_agent.ui.server import STATIC
    css = re.sub(r"/\*.*?\*/", "", open(os.path.join(STATIC, "app.css"), encoding="utf-8").read(), flags=re.S)
    code = "\n".join(re.sub(r"(^|\s)//.*$", "", line) for f in glob.glob(os.path.join(STATIC, "*.js"))
                     for line in open(f, encoding="utf-8").read().split("\n"))
    code += open(os.path.join(STATIC, "index.html"), encoding="utf-8").read()
    words = set(re.findall(r"[A-Za-z][\w-]*", code))
    dead = sorted({c for c in re.findall(r"\.([a-zA-Z][\w-]*)", css) if c not in words and not c.startswith(("ph-", "y-")) and c != "woff2"})
    assert dead == [], dead
    assert not re.search(r"\bcol:nth-child|th:nth-child\(\d", css)          # a column is named (core.table widths), not counted


def test_files_keep_their_order_and_picking_a_skill_keeps_the_list(ui):
    # owner, 2026-10-08: the open file moved to the front of the file tabs; the skills list vanished and came back on
    # every pick; "Formatted / Raw" read as "View / Edit"
    from vesta_agent.ui.server import STATIC
    js = page_js()
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    assert "order: -1" not in css and "on.offsetTop > first.offsetTop" in body_of(js, "openSkill")
    skills = body_of(js, "skills")
    assert "onclick: () => show(s.name)" in skills and "openSkill(name, pane," in skills
    assert '[["formatted", "View"], ["raw", "Edit"]]' in body_of(js, "fileViewer")


def test_rules_reminds_to_install_the_agent_before_new_alert_rules():
    # owner, 2026-10-17 (the 14:41 alert storm): a gentle reminder directly under the "Acting on the villa" switch, in
    # the page's muted sub-line style, never a colour of its own — 2026-10-18: what HE must watch, in his words
    # (critical automations, their entity ID, their title), never how the Agent works inside
    js = body_of(page_js(), "rulesForms")
    acting = js[js.index("const acting = "):js.index("const sel = ")]
    reminder = ("Install VESTA Agent updates as soon as they're offered: an update to the villa's critical automations may "
                "need the matching Agent. Changing a critical automation's entity ID closes its open alert; its title can "
                "change freely.")
    assert f'h("div", {{ class: "muted" }}, "{reminder}")' in acting, acting
    assert acting.index("title-switch") < acting.index(reminder)
    # the platform underneath is never named (owner, 2026-10-15) — the page's own words are not in
    # test_no_platform_name's files, so this line is held to it here
    from test_no_platform_name import NAMED
    line = acting[acting.index('h("div", { class: "muted" }, "Install VESTA Agent'):]
    assert not NAMED.search(line.split("));", 1)[0]), line


def test_a_job_is_named_by_its_skill_on_the_costs_tab_as_on_the_overview(tmp_path):
    # owner, 2026-10-20: "fm-daily" alone after the notion of "work" went; the standard is "preventive-maintenance ›
    # recheck.py" — one rule (skills.job_title) for Overview › Scheduled jobs run and Costs › Cost breakdown / runs
    import json
    from datetime import datetime, timedelta, timezone
    from vesta_agent import status
    from vesta_agent.state import State
    from vesta_agent.skills import job_title
    st = State(str(tmp_path / "s.db"))
    now = datetime.now(timezone.utc)
    for d in ({"who": "job:fm-daily", "cost_usd": 0.3}, {"who": "job:old-job", "cost_usd": 0.1}, {"who": "Ann@1", "cost_usd": 0.2}):
        st.db.execute("insert into calls(at, kind, detail) values (?, 'run', ?)", ((now - timedelta(hours=1)).isoformat(), json.dumps(d)))
    st.db.commit()
    c = status.costs(st, 7, now=now, skill_of={"fm-daily": "reports"}.get)
    assert job_title("reports", "fm-daily") == "reports › fm-daily"
    assert {g["name"] for g in c["by_job"]} == {"reports › fm-daily", "old-job", "Chat replies"}   # a job no skill declares: its name
    assert {r["job"] for r in c["runs"]} == {"reports › fm-daily", "old-job", "Chat replies"}
    js = page_js()
    assert 'groupTable(c.by_job, "Job")' in js and 'place("by_job")' in js and "Work" not in body_of(js, "costs")


def test_a_runs_steps_put_the_number_first_across_the_whole_width():
    # owner, 2026-10-20: "#" as the first column, the table using all the width on a desktop
    more = body_of(page_js(), "runMore")
    head = more[more.index('"steps-head"'):]
    assert head.index('"#"') < head.index('"Skill"') < head.index('"Tool"') < head.index('"What it did"')
    row = more[more.index("steps.map"):]
    assert row.index("String(x.n)") < row.index("x.skill") < row.index("x.tool")
    css = open(os.path.join(os.path.dirname(__file__), "..", "vesta_agent", "ui", "static", "app.css"), encoding="utf-8").read()
    rule = css[css.index("ol.steps {"):css.index("}", css.index("ol.steps {"))]
    assert "width: 100%" in rule and "minmax(0, 1fr)" in rule


def test_the_skill_runs_when_column_is_one_width_on_every_skill():
    # owner, 2026-10-20: proposals' "in a chat" wrapped on two lines while preventive-maintenance's When column was
    # wide — the column followed each skill's text. One width, never wrapped, wide enough for every When the engine
    # writes for the starter skills.
    import glob
    from vesta_agent import skills as S
    from vesta_agent.ui.server import STATIC
    css = open(os.path.join(STATIC, "app.css"), encoding="utf-8").read()
    assert ("table.data.skill-runs th:first-child, table.data.skill-runs td:first-child "
            "{ width: 18em; white-space: nowrap; }") in css
    assert '{ cls: "skill-runs" }' in body_of(page_js(), "aboutSkill")
    starter = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "starter", "skills")
    whens = {a["when"] for d in glob.glob(os.path.join(starter, "*"))
             for a in S.when_it_runs(S.parse_skill(os.path.basename(d), d))}
    assert "in a chat" in whens and max(map(len, whens)) <= 36, sorted(whens, key=len)[-3:]   # ~0.5em a character


def test_the_limits_tab_opened_from_a_value_goes_back_to_where_it_was_pressed():
    # owner, 2026-10-24: "a Back button, so that I can come back to the same page I clicked from … at the top right
    # corner on the same line as the title Limits"
    js = page_js()
    setting = body_of(js, "setting")
    assert "page.back = { tab: page.current, here: page.here, y: window.scrollY };" in setting
    assert 'titleWithInfo("Limits", lead, "h2", backButton())' in body_of(js, "limits")
    back = body_of(js, "goBack")
    assert "go(b.tab);" in back and "await b.here();" in back and "window.scrollTo({ top: b.y });" in back
    go = body_of(js, "go")
    assert 'if (tab !== "limits") page.back = null;' in go and "page.here = null;" in go
    # a skill and its file are drawn again as they were
    assert "page.here = () => skills(name, path);" in body_of(js, "openSkill")
    assert "await openSkill(select, pane, list.find((s) => s.name === select), at);" in body_of(js, "skills")


def test_a_skills_frequent_checks_say_their_rhythm_and_link_to_its_setting(ui):
    copy_skill("alert-desk", ui.skills_dir)

    async def fn(c):
        r = await c.get("/api/skills/alert-desk")
        return (await r.json())["acts"]
    acts = call(ui, fn)
    row = next(a for a in acts if a.get("every"))
    assert row["when"] == "every 5 minutes" and row["ref"] == "code:jobs.every_minutes"
    # the guides name the setting, never the number, and never "(its setting)": the chip says it
    import glob
    for md in glob.glob(os.path.join(os.path.dirname(__file__), "..", "starter", "skills", "*", "SKILL.md")):
        text = open(md, encoding="utf-8").read()
        assert "(its setting" not in text and "every 5 min" not in text.lower(), md


def test_asleep_between_reports_says_where_it_is_set_behind_its_titles_info_never_under_it():
    # owner, 2026-10-24: "remove this text … and show it in a (i) icon next to the 'asleep between report' title"
    # owner, 2026-10-30: the Kiosk's list is not kept in policy.yaml, so it is Knowledge › Asleep between reports
    from helpers import body_of, page_js
    js = page_js()
    card = body_of(js, "asleepCard")
    assert js.count("Set in the VESTA Kiosk") == 1
    # card(): its lead is the title's (i) whenever the card has content (core.card), and the chips end the card
    assert 'card(place("asleep"), "Set in the VESTA Kiosk' in card
    assert card.rstrip().endswith(': [h("span", { class: "muted" }, "None")]));\n}') or \
        '[h("span", { class: "muted" }, "None")]));' in card


def test_a_numbered_step_keeps_its_own_number_when_its_points_split_the_list():
    # owner, 2026-10-24: investigate's "## The procedure" read "1." for every step — each step, its points and a blank
    # line made a list of its own, and every list started again at 1
    guide = (Path(__file__).resolve().parents[1] / "starter" / "skills" / "investigate" / "SKILL.md").read_text()
    blocks = _markdown(guide)
    firsts = [b["items"][0]["n"] for b in blocks if b["t"] == "list" and b["items"][0]["ordered"]]
    assert firsts[:3] == [1, 2, 3], firsts                                  # each split list starts at its own step
    b = _markdown("1. one\n\n   - a point\n\n2. two\n3. three\n- bullet")
    assert [(i["ordered"], i["n"]) for x in b for i in x["items"]] == [(True, 1), (False, None), (True, 2), (True, 3),
                                                                       (False, None)]
    js = (Path(__file__).resolve().parents[1] / "vesta_agent" / "ui" / "static" / "viewer.js").read_text()
    assert 'it.ordered && it.n > 1 ? h(tag, { start: String(it.n) }) : h(tag)' in js           # drawn from there


def _skill_file(entries: dict[str, str | bytes]) -> str:
    """A .skill file as Claude's skill packager makes it: a zip of one folder, base64 for the page's JSON body."""
    import base64, io, zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, body in entries.items():
            z.writestr(name, body)
    return base64.b64encode(buf.getvalue()).decode()


STANDARD_SKILL = {
    "pool-care/SKILL.md": "---\nname: pool-care\ndescription: Keeps the pool clean: when to run the pump.\n---\n\n# Pool care\n",
    "pool-care/scripts/check.py": "print('ok')\n",
    "pool-care/references/chemistry.md": "# pH\n",
    "__MACOSX/pool-care/._SKILL.md": b"\x00",
}


def test_a_skill_file_made_offline_is_imported_as_claude_imports_one(ui):
    # owner, 2026-10-25: "an Import Skill button next to New Skill … import a .skill file generated offline, the same
    # way Claude allows"
    async def fn(c):
        r = await c.post("/api/skills/import", json={"data": _skill_file(STANDARD_SKILL)}, headers=HDR)
        got = (r.status, await r.json())
        listed = {s["name"]: s for s in (await (await c.get("/api/skills")).json())["skills"]}
        again = await c.post("/api/skills/import", json={"data": _skill_file(STANDARD_SKILL)}, headers=HDR)
        return got, listed, again.status, (await again.json())["problems"][0]
    (status, body), listed, again, why = call(ui, fn)
    assert status == 200 and body["name"] == "pool-care"
    assert body["notes"] == ["Kept, not run until skill.yaml declares them: check.py."]     # only declared scripts run
    folder = os.path.join(ui.skills_dir, "pool-care")
    assert sorted(os.listdir(folder)) == ["SKILL.md", "references", "scripts", "skill.yaml"]   # no Mac junk
    assert yaml.safe_load(open(os.path.join(folder, "skill.yaml")))["description"].startswith("Keeps the pool clean")
    assert listed["pool-care"]["ok"] and "Keeps the pool clean" in listed["pool-care"]["description"]
    assert again == 409 and "already exists" in why                                     # never replaced
    js = (Path(__file__).resolve().parents[1] / "vesta_agent" / "ui" / "static" / "skills.js").read_text()
    assert '"New skill"), importSkillButton()' in js and '"Import skill")' in js           # beside New skill


@pytest.mark.parametrize("entries, says", [
    ({"x/SKILL.md": "# no front matter\n"}, "no description"),
    ({"x/README.md": "hi"}, "SKILL.md is missing"),
    ({"x/SKILL.md": "---\nname: Bad Name\ndescription: d\n---\n"}, "cannot be a skill here"),
    ({"x/SKILL.md": "---\nname: x\ndescription: d\n---\n", "x/../evil.py": "1"}, "Unexpected file"),
    ({"x/SKILL.md": "---\nname: x\ndescription: d\n---\n", "x/skill.yaml": "schedule:\n  - when: noon\n    prompt: p\n"},
     "would switch this skill off"),
])
def test_a_skill_file_that_cannot_be_a_skill_here_is_refused_and_nothing_is_written(ui, entries, says):
    async def fn(c):
        r = await c.post("/api/skills/import", json={"data": _skill_file(entries)}, headers=HDR)
        return r.status, (await r.json())["problems"][0]
    status, why = call(ui, fn)
    assert status in (400, 409) and says in why, why
    assert sorted(n for n in os.listdir(ui.skills_dir) if not n.startswith(".")) == ["reports"]   # nothing left behind


def test_a_skill_file_with_its_files_at_the_top_is_named_by_its_skill_md():
    from vesta_agent.ui.setup_copy import read_skill
    import base64
    got = read_skill(base64.b64decode(_skill_file({"SKILL.md": "---\nname: tide\ndescription: d\n---\n"})))
    assert got["name"] == "tide" and set(got["files"]) == {"SKILL.md", "skill.yaml"} and got["notes"] == []


def test_a_phones_keyboard_opening_never_closes_a_floating_list_being_typed_in():
    # owner, 2026-10-31 (phone): the owner-only devices' list, a tap in the device list's search box, and the keyboard
    # vanished at once — the keyboard resizes the page and scrolls the field into view, and the panel closed on both.
    # The decision (float.afterMove) driven in Node, as the browser runs it; its wiring in the one floating()
    import json, shutil, subprocess
    from vesta_agent.ui.server import STATIC
    node = shutil.which("node")
    assert node, "Node is needed to test the page's plain modules (GitHub's runners have it)"     # never skipped
    code = ("import { afterMove } from " + json.dumps("file://" + os.path.join(STATIC, "float.js")) + ";"
            "console.log(JSON.stringify([[false, true], [false, false], [true, false], [true, true]]"
            ".map(([p, f]) => afterMove(p, f))));")
    r = subprocess.run([node, "--input-type=module", "-e", code], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    # typing in it: placed again; the page moved with the focus elsewhere: closed; its own list scrolled: kept
    assert json.loads(r.stdout) == ["place", "close", "keep", "keep"]
    fl = body_of(page_js(), "floating")
    assert "panel.contains(document.activeElement)" in fl and 'window.addEventListener("resize", moved)' in fl
    assert 'window.addEventListener("resize", close)' not in fl
    # iPhone: the keyboard moves the visual viewport, often with no resize of the window; absent, the window's alone
    assert 'vv.addEventListener("resize", moved)' in fl and "window.visualViewport || null" in fl
