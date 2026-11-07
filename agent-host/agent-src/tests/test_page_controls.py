"""The VESTA Agent page's 0.6.42 controls, through HTTP as the page uses them: the skills' switches and commands,
an edited skill against the release, Try a command, copying a setup, and the changes with their Undo."""
from __future__ import annotations

import asyncio
import base64
import io
import os
import shutil
import zipfile

import yaml

from helpers import copy_skill, settings, page_js
from test_ui import HDR, call
from vesta_agent import requests_box
from vesta_agent.policy import Policy

import pytest


@pytest.fixture
def ui(tmp_path):
    s = settings(str(tmp_path))
    for name in ("reports", "villa-concierge", "alert-desk"):
        copy_skill(name, s.skills_dir)
    raw = yaml.safe_load(open(s.policy_path))
    raw["switch_entities"] = ["switch.example_pump"]
    with open(s.policy_path, "w") as f:
        yaml.safe_dump(raw, f)
    return s


def _json(c, method, path, **kw):
    async def go():
        r = await getattr(c, method)(path, headers=HDR, **kw)
        return r.status, await r.json()
    return go()


def test_a_skill_switched_off_on_the_page_is_off_for_the_agent_and_undone(ui):
    async def fn(c):
        st, _ = await _json(c, "put", "/api/skills/villa-concierge/on", json={"on": False})
        rows = (await (await c.get("/api/skills")).json())["skills"]
        hist = (await (await c.get("/api/history")).json())["changes"]
        st2, _ = await _json(c, "post", f"/api/history/{hist[0]['id']}/undo", json={})
        return st, rows, hist, st2
    st, rows, hist, st2 = call(ui, fn)
    assert st == 200 and next(r for r in rows if r["name"] == "villa-concierge")["off"]
    assert hist[0]["place"] == "Skills" and hist[0]["what"] == "villa-concierge switched off"
    assert st2 == 200 and "villa-concierge" not in Policy.load(ui.policy_path).skills_off


def test_a_commands_checkbox_writes_the_villas_file_and_the_agent_refuses_it(ui):
    async def fn(c):
        st, _ = await _json(c, "put", "/api/skills/villa-concierge/commands", json={"script": "concierge.py", "command": "find", "on": False})
        d = await (await c.get("/api/skills/villa-concierge")).json()
        return st, d
    st, d = call(ui, fn)
    assert st == 200
    cmds = {c["name"]: c["on"] for c in d["scripts"][0]["commands"]}
    assert cmds == {"find": False, "status": True}
    assert yaml.safe_load(open(os.path.join(ui.skills_dir, "villa-concierge", "villa.skill.yaml"))) == \
        {"off_commands": {"concierge.py": ["find"]}}
    assert d["release"]["state"] == "follows"                  # the villa's own file is not an edit of the skill


def test_an_edited_skill_compares_with_the_release_and_takes_it_back(ui):
    path = os.path.join(ui.skills_dir, "alert-desk", "rules.yaml")
    text = open(path).read()
    with open(path, "w") as f:
        f.write(text.replace("cooldown_min: 30", "cooldown_min: 20", 1))
    with open(os.path.join(ui.skills_dir, "alert-desk", "villa.notes.md"), "w") as f:
        f.write("the villa's own")

    async def fn(c):
        d = await (await c.get("/api/skills/alert-desk")).json()
        cmp = await (await c.get("/api/skills/alert-desk/compare?path=rules.yaml")).json()
        st, _ = await _json(c, "post", "/api/skills/alert-desk/take-release", json={})
        after = await (await c.get("/api/skills/alert-desk")).json()
        hist = (await (await c.get("/api/history")).json())["changes"]
        st2, _ = await _json(c, "post", f"/api/history/{hist[0]['id']}/undo", json={})
        return d, cmp, st, after, st2
    d, cmp, st, after, st2 = call(ui, fn)
    assert d["release"]["state"] == "edited" and d["release"]["differs"] == ["rules.yaml"]
    changed = [r for r in cmp["rows"] if not r["same"]]
    assert changed and "cooldown_min: 20" in changed[0]["here"] and "cooldown_min: 30" in changed[0]["release"]
    assert st == 200 and after["release"]["state"] == "follows"
    assert open(os.path.join(ui.skills_dir, "alert-desk", "villa.notes.md")).read() == "the villa's own"
    assert st2 == 200 and "cooldown_min: 20" in open(path).read()                 # Undo: the edited one is back


def test_try_a_command_goes_to_the_running_agent_and_comes_back(ui):
    async def agent(stop):
        async def handle(req):
            return {"ok": True, "exit": 0, "seconds": 0.1, "output": f"{req['skill']} {req['script']} {' '.join(req['args'])}"}
        await requests_box.serve(ui.data_dir, handle, stop)

    async def fn(c):
        stop = asyncio.Event()
        task = asyncio.create_task(agent(stop))
        st, body = await _json(c, "post", "/api/skills/villa-concierge/try", json={"script": "concierge.py", "args": ["status"]})
        seen = []
        for _ in range(50):                                                          # the page: every second
            st2, got = await _json(c, "get", f"/api/tries/{body['pending']}")
            seen.append(got)
            if not got.get("pending"):
                break
            await asyncio.sleep(0.1)
        again, _ = await _json(c, "get", f"/api/tries/{body['pending']}")
        stop.set(); await task
        return st, body, st2, seen, again
    st, body, st2, seen, again = call(ui, fn)
    assert st == 200 and set(body) == {"pending"}               # answered at once: nothing waits on the script
    assert st2 == 200 and seen[-1]["output"] == "villa-concierge concierge.py status"
    assert again == 404                                                            # read once
    assert os.listdir(requests_box.folder(ui.data_dir)) == []                     # nothing left behind


def test_a_long_try_does_not_hold_up_another_request(tmp_path):
    # nightly.py runs for minutes: "Read the list again" meanwhile must still be answered
    gate = asyncio.Event()

    async def handle(req):
        if req["kind"] == "try":
            await gate.wait()
        return {"ok": True, "kind": req["kind"]}

    async def main():
        stop = asyncio.Event()
        task = asyncio.create_task(requests_box.serve(str(tmp_path), handle, stop))
        rid = requests_box.submit(str(tmp_path), "try", {"skill": "x", "script": "nightly.py", "args": []})
        while requests_box.result(str(tmp_path), rid)[0] != "running":               # the long one has started
            await asyncio.sleep(0.05)
        quick = await requests_box.ask(str(tmp_path), "refresh_tools", {}, timeout=5)
        before = requests_box.result(str(tmp_path), rid)[0]
        gate.set()
        for _ in range(50):
            state, data = requests_box.result(str(tmp_path), rid)
            if state == "done":
                break
            await asyncio.sleep(0.1)
        stop.set(); await task
        return quick, before, state, data
    quick, before, state, data = asyncio.run(main())
    assert quick == {"ok": True, "kind": "refresh_tools"} and before == "running"
    assert state == "done" and data["kind"] == "try"


def test_try_a_command_is_checked_as_the_ai_and_nothing_is_carried_out(tmp_path):
    from ha_fake import FakeHA
    from telegram_fake import FakeTelegram
    from vesta_agent.app import Vesta
    from vesta_agent.kiosk import Kiosk
    s = settings(str(tmp_path))
    copy_skill("villa-concierge", s.skills_dir)
    v = Vesta(s, telegram=FakeTelegram(), reader=FakeHA(), kiosk=Kiosk("", ""))
    refused = v.try_command("villa-concierge", "concierge.py", ["unlock", "--what", "lock"])
    assert refused["ok"] is False and "concierge.py needs one of" in refused["error"]
    assert v.try_command("villa-concierge", "voice.py", ["prepare"])["ok"] is False   # a hook's script: not the AI's
    assert v.tg.sent == []


def _setup_zip(ui, parts) -> bytes:
    async def fn(c):
        r = await c.post("/api/setup/export", json=parts, headers=HDR)
        return r.status, r.headers.get("Content-Disposition"), await r.read()
    st, disp, data = call(ui, fn)
    assert st == 200 and "vesta-agent-setup-" in disp
    return data


def test_the_setup_carries_the_skills_and_shareable_rules_and_never_the_villas_own(ui):
    with open(os.path.join(ui.skills_dir, "villa-concierge", "villa.voice.yaml"), "w") as f:
        f.write("stt: stt.example\n")
    data = _setup_zip(ui, {"skills": True, "ai": True, "actions": True, "tools": True, "keep": True})
    z = zipfile.ZipFile(io.BytesIO(data))
    names = z.namelist()
    assert "skills/reports/skill.yaml" in names and "skills/villa-concierge/villa.voice.yaml" not in names
    rules = yaml.safe_load(z.read("rules.yaml"))
    assert set(rules) <= {"settings", "allowed_services", "ha_read_tools", "agent_tools", "tool_access", "skills_off"}
    assert "instructions.md" not in names
    for villa_own in ("111", "-1001", "switch.example_pump", "Owner", "telegram_id"):
        assert villa_own not in z.read("rules.yaml").decode()


def test_an_import_shows_every_change_and_what_does_not_fit_then_applies(ui, tmp_path):
    data = _setup_zip(ui, {"skills": True, "ai": True, "actions": True, "tools": True})
    other = settings(str(tmp_path / "other"))                    # another villa: one skill, its own people
    copy_skill("reports", other.skills_dir)
    raw = yaml.safe_load(open(other.policy_path))
    raw["owner_only_entities"] = ["lock.example_own"]             # its own devices: never carried
    with open(other.policy_path, "w") as f:
        yaml.safe_dump(raw, f)
    zb = base64.b64encode(data).decode()

    async def fn(c):
        st, prev = await _json(c, "post", "/api/setup/import", json={"zip": zb})
        bad, _ = await _json(c, "post", "/api/setup/import", json={"zip": zb, "apply": True, "fingerprint": "x"})
        ok, _ = await _json(c, "post", "/api/setup/import", json={"zip": zb, "apply": True, "fingerprint": prev["fingerprint"]})
        hist = (await (await c.get("/api/history")).json())["changes"]
        return st, prev, bad, ok, hist
    st, prev, bad, ok, hist = call(other, fn)
    rows = {r["what"]: r["change"] for r in prev["rows"]}
    assert st == 200 and rows["villa-concierge"] == "added" and rows["alert-desk"] == "added" and rows["reports"] == "same"
    # this villa's switch list is empty: a "listed" service will be refused until devices are added
    assert any("switch.turn_on" in m and "list is empty" in m for m in prev["misfits"])
    assert bad == 409 and ok == 200
    assert os.path.isfile(os.path.join(other.skills_dir, "villa-concierge", "skill.yaml"))
    assert Policy.load(other.policy_path).owner_only == {"lock.example_own"}      # the villa's own, untouched
    assert {h["place"] for h in hist} == {"Import"}


def test_a_file_that_is_not_a_setup_is_refused(ui):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("setup.json", "{}")
        z.writestr("../../etc/passwd", "x")
    zb = base64.b64encode(buf.getvalue()).decode()

    async def fn(c):
        return await _json(c, "post", "/api/setup/import", json={"zip": zb})
    st, body = call(ui, fn)
    assert st == 400 and "Unexpected file" in body["problems"][0]


def test_rules_tools_are_served_from_the_agents_list(ui):
    from vesta_agent import tool_access
    tool_access.save_list(ui.data_dir, [{"name": "ha_get_state", "annotations": {"readOnlyHint": True, "title": "Get Entity State"}},
                                        {"name": "ha_restart", "annotations": {"destructiveHint": True}}], "ha-mcp 8.6.0")

    async def fn(c):
        return await (await c.get("/api/tools")).json()
    t = call(ui, fn)
    assert t["server"] == "ha-mcp 8.6.0" and t["groups"][0]["tools"][0]["title"] == "Get Entity State"
    assert [x["name"] for x in t["never"]] == ["ha_restart"]
    assert {r["key"] for r in t["roles"]} >= {"cameras", "create_ticket"}
    # each row says which tab its switch comes from (owner, 2026-10-19: the 11 rows mixed the two tabs unsaid)
    by = {r["key"]: r["from"] for r in t["roles"]}
    assert by["cameras"] == "Villa system tools" and by["create_ticket"] == "Agent tools"
    assert "(${g.from})" in page_js()                          # and the table draws it beside the name
    shutil.rmtree(ui.data_dir)


def test_an_undo_waits_for_a_later_change_to_be_undone_first(ui):
    path = os.path.join(ui.skills_dir, "alert-desk", "SKILL.md")
    original = open(path).read()

    async def fn(c):
        for text in ("first edit\n", "second edit\n"):
            _, f = await _json(c, "get", "/api/skills/alert-desk/file?path=SKILL.md")
            await _json(c, "put", "/api/skills/alert-desk/file?path=SKILL.md", json={"content": original + text, "rev": f["rev"]})
        hist = (await (await c.get("/api/history")).json())["changes"]
        older, newer = hist[1]["id"], hist[0]["id"]
        refused, _ = await _json(c, "post", f"/api/history/{older}/undo", json={})
        ok1, _ = await _json(c, "post", f"/api/history/{newer}/undo", json={})
        ok2, _ = await _json(c, "post", f"/api/history/{older}/undo", json={})
        return refused, ok1, ok2
    refused, ok1, ok2 = call(ui, fn)
    assert (refused, ok1, ok2) == (409, 200, 200) and open(path).read() == original


def test_the_agent_checks_a_try_it_finds_in_the_folder_as_the_page_does(tmp_path):
    # the requests folder is a file drop: what the agent reads there is checked again, by the same rule
    from telegram_fake import FakeTelegram
    from vesta_agent.app import Vesta
    from vesta_agent.kiosk import Kiosk
    v = Vesta(settings(str(tmp_path)), telegram=FakeTelegram(), kiosk=Kiosk("", ""), reader=object())
    out = asyncio.run(v.on_request({"kind": "try", "skill": "x", "script": "y.py", "args": ["a" * 301]}))
    assert out == {"ok": False, "error": "The command's arguments are not understood."}


def test_add_them_sets_every_missing_ai_job_with_its_starter_values_in_one_recorded_change(ui):
    # architecture review 8: the banner's button read, changed and wrote the whole form from the page. Owner,
    # 2026-10-20: one brain and one limit a skill — "Add them" gives the skill its starter pair (skill.yaml jobs_default)
    raw = yaml.safe_load(open(ui.policy_path))
    raw["settings"].pop("skill_ai", None)
    raw["settings"]["web_search"] = True
    with open(ui.policy_path, "w") as f:
        yaml.safe_dump(raw, f)

    async def fn(c):
        st, body = await _json(c, "post", "/api/jobs/missing", json={})
        st2, again = await _json(c, "post", "/api/jobs/missing", json={})
        hist = (await (await c.get("/api/history")).json())["changes"]
        jobs = (await (await c.get("/api/jobs")).json())["jobs"]
        return st, body, st2, again, hist, jobs
    st, body, st2, again, hist, jobs = call(ui, fn)
    s = yaml.safe_load(open(ui.policy_path))["settings"]
    # the alert cards' translation is not offered: it runs with the Chat answers' brain and limit (owner, 2026-10-23:
    # "I shall not see a dedicated Job for this")
    assert st == 200 and body["added"] == ["fm-daily", "fm-weekly", "owner-monthly"]
    assert st2 == 200 and again["added"] == []
    assert s["skill_ai"] == {"reports": {"brain": "auto", "limit_usd": 2.0}} and "jobs" not in s
    assert all(j["skill_ai"] == {"brain": "auto", "limit_usd": 2.0} for j in jobs)
    assert s["web_search"] is True and \
        hist[0]["what"] == "AI jobs added: fm-daily, fm-weekly, owner-monthly"


def test_switch_on_turns_each_kind_of_tool_on_where_its_switch_is(ui):
    # architecture review 8: the page knew that web search lives in settings and an agent tool is on when absent
    raw = yaml.safe_load(open(ui.policy_path))
    raw["agent_tools"] = {"create_ticket": False, "start_job": False}
    raw.setdefault("settings", {})["web_search"] = False
    raw["ha_read_tools"] = ["ha_get_state"]
    with open(ui.policy_path, "w") as f:
        yaml.safe_dump(raw, f)

    async def fn(c):
        return [(await _json(c, "post", "/api/tools/on", json={"tool": t}))[0] for t in ("web_search", "create_ticket", "ha_get_history", "ha_get_history")]
    assert call(ui, fn) == [200] * 4
    p = Policy.load(ui.policy_path)
    raw = yaml.safe_load(open(ui.policy_path))
    assert raw["settings"]["web_search"] is True and raw["agent_tools"] == {"start_job": False}
    assert p.ha_read_tools == ["ha_get_state", "ha_get_history"]                              # once, at the end


def test_the_rules_form_says_every_switch_on_or_off_and_writes_the_files_shape_back():
    # architecture review 8: the form carries true/false per switch; the file keeps "absent means on"
    from vesta_agent.ui.policy_doc import apply_form, to_form
    text = "settings:\n  web_search: false\nagent_tools:\n  create_ticket: false\ntool_access:\n  fm:\n    cameras: false\n"
    f = to_form(text)
    assert f["agent_tools"] == {"web_search": False, "create_ticket": False, "start_job": True, "agent_status": True}
    assert f["tool_access"]["fm"]["cameras"] is False and f["tool_access"]["fm"]["states"] is True
    f["agent_tools"].update(web_search=True, create_ticket=True, start_job=False)
    f["tool_access"]["fm"].update(cameras=True, logs=False)
    out = yaml.safe_load(apply_form(text, f))
    assert out["settings"]["web_search"] is True and out["agent_tools"] == {"start_job": False}
    assert out["tool_access"] == {"fm": {"logs": False}}
    assert yaml.safe_load(apply_form("", to_form(""))) in (None, {})                       # nothing written by default


def test_a_broken_policy_file_still_opens_every_tab_and_names_its_problem(ui):
    # architecture review 9: an unparseable policy.yaml made jobs, overview and skills answer 500, and Rules (file),
    # the one place to repair it, hung on "Loading…" behind them
    with open(ui.policy_path, "w") as f:
        f.write("settings:\n  profile: auto\n bad: [unclosed\n")

    async def fn(c):
        out = {}
        for p in ("/api/policy", "/api/rules", "/api/jobs", "/api/overview", "/api/skills", "/api/tools", "/api/costs?days=7"):
            r = await c.get(p, headers=HDR)
            out[p] = (r.status, await r.json())
        return out
    got = call(ui, fn)
    assert {p: s for p, (s, _) in got.items()} == {p: 200 for p in got}
    assert got["/api/policy"][1]["problems"] and got["/api/rules"][1]["problems"] and got["/api/overview"][1]["policy_problems"]
    assert "rulesFile(await api(\"GET\", \"api/policy\"))" in page_js()          # the file view asks for the file only


@pytest.mark.parametrize("old", [
    # before 0.12.277: a brain and a limit per job (the villa's file: auto, auto, auto)
    {"jobs": {"fm-daily": {"profile": "auto", "limit_usd": 1}, "fm-weekly": {"profile": "auto", "limit_usd": 2},
              "owner-monthly": {"profile": "auto", "limit_usd": 6}}},
    # 0.12.277: the skill's brain, a limit per job
    {"skill_brains": {"reports": "auto"},
     "jobs": {"fm-daily": {"limit_usd": 1}, "fm-weekly": {"limit_usd": 2}, "owner-monthly": {"limit_usd": 6}}},
])
def test_an_older_files_ai_jobs_are_read_and_moved_to_their_skill_by_the_next_save(ui, old):
    # owner, 2026-10-20 (one brain and one limit a skill): the agent reads an older file without a problem — its brain,
    # the skill's starter limit (2 US$, never the jobs' own) — and the page's next save writes the skill's pair alone,
    # comments kept
    raw = yaml.safe_load(open(ui.policy_path))
    raw["settings"].pop("skill_ai", None)
    raw["settings"].update(old)
    with open(ui.policy_path, "w") as f:
        f.write("# the villa's own note\n" + yaml.safe_dump(raw))

    async def fn(c):
        before = (await (await c.get("/api/jobs")).json())["jobs"]
        doc = await (await c.get("/api/policy")).json()
        r = await c.put("/api/policy/form", json={"form": doc["form"], "rev": doc["rev"]}, headers=HDR)
        doc2 = await (await c.get("/api/policy")).json()
        return before, r.status, doc2
    before, status, doc2 = call(ui, fn)
    assert all(j["skill_ai"] == {"brain": "auto", "limit_usd": 2.0} for j in before if j["skill"] == "reports")
    # the alert desk's translation is no job: never listed, never "not set" (owner, 2026-10-23)
    assert {j["skill"] for j in before} == {"reports"}
    assert status == 200
    written = open(ui.policy_path).read()
    s = yaml.safe_load(written)["settings"]
    assert s["skill_ai"] == {"reports": {"brain": "auto", "limit_usd": 2}} and "# the villa's own note" in written
    assert "jobs" not in s and "skill_brains" not in s
    assert doc2["form"]["settings"]["skill_ai"] == {"reports": {"brain": "auto", "limit_usd": 2}}   # read back

    # the form round-trips a change of the skill's brain and its one limit: every job runs with them
    async def change(c):
        doc = await (await c.get("/api/policy")).json()
        doc["form"]["settings"]["skill_ai"]["reports"] = {"brain": "economy", "limit_usd": 3}
        r = await c.put("/api/policy/form", json={"form": doc["form"], "rev": doc["rev"]}, headers=HDR)
        return r.status, (await (await c.get("/api/jobs")).json())["jobs"]
    status, jobs = call(ui, change)
    assert status == 200
    assert {j["name"]: (j["skill_ai"]["brain"], j["skill_ai"]["limit_usd"]) for j in jobs if j["skill"] == "reports"} == {
        "fm-daily": ("economy", 3.0), "fm-weekly": ("economy", 3.0), "owner-monthly": ("economy", 3.0)}


