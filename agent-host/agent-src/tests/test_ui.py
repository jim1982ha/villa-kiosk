"""The UI server (vesta_agent.ui), through HTTP as the page uses it. Synthetic data only."""
from __future__ import annotations

from helpers import run_kit, run_terms, keep_roster
import asyncio
import os
from pathlib import Path

import pytest
import yaml
from aiohttp.test_utils import TestClient, TestServer

from helpers import copy_skill, settings, page_js, body_of
from vesta_agent.ui.server import UI
from vesta_agent.policy import PROFILES
from vesta_agent.roster import Roster

HDR = {"X-Vesta-UI": "1"}


@pytest.fixture
def ui(tmp_path):
    s = settings(str(tmp_path))                                  # seeds policy.yaml from the starter example
    copy_skill("reports", s.skills_dir)
    # a villa set up: its group in both of the VESTA Kiosk's lists of who gets the messages, as the agent read them
    keep_roster(s, Roster.of(owner=[(-100, "Villa group")], fm=[(-100, "Villa group")]))
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
        r = await c.put("/api/policy/form", json={"form": form, "rev": doc["rev"]}, headers=HDR)
        return r.status, await r.json()
    status, body = call(ui, fn)
    assert status == 200, body
    text = open(ui.policy_path).read()
    assert "# Who the agent answers, where it posts and who may approve" in text   # a comment of the example, kept
    raw = yaml.safe_load(text)
    assert raw["act_enabled"] is True and raw["allowed_services"]["light.turn_on"] == "direct"
    assert not {"languages", "people"} & set(raw)              # each chat's language is the Kiosk's (owner, 2026-11-03)


def test_a_save_the_agent_would_misread_is_refused_and_the_file_untouched(ui):
    before = open(ui.policy_path).read()

    async def fn(c):
        doc = await (await c.get("/api/policy")).json()
        form = doc["form"]
        form["allowed_services"]["homeassistant.restart"] = "any"
        r = await c.put("/api/policy/form", json={"form": form, "rev": doc["rev"]}, headers=HDR)
        r2 = await c.put("/api/policy/text", json={"text": "people: [unclosed", "rev": doc["rev"]}, headers=HDR)
        return r.status, (await r.json())["problems"], r2.status
    status, problems, status2 = call(ui, fn)
    assert status == 400 and status2 == 400
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


def test_the_header_says_the_version_whichever_tab_the_page_opens_on(ui, monkeypatch):
    # the Overview tab wrote it once its data had arrived: a page opened or reloaded on another tab had an empty header
    from dataclasses import replace
    monkeypatch.setenv("VESTA_APP_VERSION", "9.8.7")

    async def fn(c):
        return await (await c.get("/")).text()
    header = lambda s: call(s, fn).split("<header", 1)[1].split("</header>", 1)[0]   # noqa: E731
    assert ">v9.8.7<" in header(replace(ui, instance="prod"))                        # the villa's own: the app's version
    assert ">v9.8.7 · dev<" in header(replace(ui, instance="dev"))                   # another one says which


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
        return await (await c.get("/api/rules")).json(), await (await c.get("/api/policy")).json()
    ents, doc = call(ui, fn)
    assert ents["entities"] == [{"id": "scene.example_evening", "name": "Evening", "area": ""},
                                {"id": "lock.example_door", "name": "Front door", "area": "Entrance"}]
    assert "languages" not in doc                         # no menu of languages: each chat's is set in the Kiosk


def test_the_costs_tab_reads_every_run_from_the_agents_records(ui):
    import json
    from datetime import datetime, timedelta, timezone
    from vesta_agent.state import State
    owner = -100777
    keep_roster(ui, Roster.of(owner=[(owner, "Owner chat")]))
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
    assert reply["chat"] == "Owner group" and reply["asked"] == "is the pool ok?" and reply["tokens_in"] == 300
    bob = next(r for r in c["runs"] if r["person"] == "Bob")
    assert bob["model"] is None and bob["tokens_in"] is None and bob["chat"] == "private chat"   # recorded before 0.6.9
    assert len(c["by_day"]) == 30 and sum(d["cost"] for d in c["by_day"]) == 1.5
    # "Per run" and "Busiest day" are added up by the agent, never by the page (architecture review scan 4)
    assert c["per_run"] == 0.5 and c["busiest"]["cost"] == 1.25 and c["busiest"]["day"] in {d["day"] for d in c["by_day"]}
    assert "c.per_run" in page_js() and "c.busiest" in page_js() and "c.period / c.runs_count" not in page_js()


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


# ---------------------------------------------------------------- People: the VESTA Kiosk's lists, read only
# owner, 2026-11-03 ("Yes, Kiosk only", then "isn't it also redundant to show the Telegram chat ID … and also the
# language selection?"): who gets the messages, who may press their buttons and each chat's language are set in the
# Kiosk; the People card shows them, name, role and language, and edits nothing

def test_an_older_files_people_and_languages_are_dropped_by_the_pages_save(ui):
    # formats outlive their writer: a villa's file of 0.12.438 and before said who, which role and which language, and
    # 0.12.439 to 0.12.441 each chat's language: all the Kiosk's now, named nowhere, gone at the next save
    with open(ui.policy_path, "a", encoding="utf-8") as f:
        f.write("people:\n  - {telegram_id: -100, name: Old name, role: owner, language: fr}\n"
                "  - {telegram_id: 111, name: Gone, role: fm, language: de}\nchats: {fm: 222}\n"
                "languages: {-100: de}\n")

    async def fn(c):
        doc = await (await c.get("/api/rules")).json()
        before = list(doc["problems"])
        r = await c.put("/api/policy/form", json={"form": doc["form"], "rev": doc["rev"]}, headers=HDR)
        return doc, before, r.status
    doc, problems, status = call(ui, fn)
    assert problems == [] and "languages" not in doc["form"]
    assert [(p["name"], p["language"]) for p in doc["people"]] == [("Villa group", "English")]   # the Kiosk's, never the rows'
    assert status == 200
    raw = yaml.safe_load(open(ui.policy_path))
    assert not {"languages", "people", "chats"} & set(raw)


def test_the_page_says_a_moment_in_the_villas_time_as_the_messages_write_it(ui):
    # owner's UI scan, 2026-11-10: the page wrote the stored (UTC) moments in the browser's own zone and country
    # format, so a save made at 06:57 in the villa read "11/9/26, 11:57 PM" on a phone elsewhere
    import dataclasses
    from vesta_agent.history import History
    s = dataclasses.replace(ui, timezone="Asia/Bangkok")
    History(s.history_path).record("Rules", "A rule switched on", {"kind": "policy"}, None, None, at="2026-11-09T23:57:53.596569+00:00")

    async def fn(c):
        return await (await c.get("/api/history")).json()
    assert [c["at"] for c in call(s, fn)["changes"]] == ["10/11/2026 06:57"]
