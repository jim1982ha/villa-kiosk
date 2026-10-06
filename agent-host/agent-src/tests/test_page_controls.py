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
from vesta_agent.config import STARTER_DIR
from vesta_agent.policy import Policy
from vesta_agent.skills import Skills

import pytest


@pytest.fixture
def ui(tmp_path):
    s = settings(str(tmp_path))
    for name in ("reports", "villa-concierge", "alert-desk"):
        copy_skill(name, s.skills_dir)
    raw = yaml.safe_load(open(s.policy_path))
    raw["people"] = [{"telegram_id": 111, "name": "Owner", "role": "owner", "language": "en"}]
    raw["chats"] = {"owner": -1001, "fm": -1002}
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


def test_an_undo_never_overwrites_a_later_change(ui):
    async def fn(c):
        await _json(c, "put", "/api/skills/villa-concierge/on", json={"on": False})
        first = (await (await c.get("/api/history")).json())["changes"][0]
        await _json(c, "put", "/api/skills/reports/on", json={"on": False})
        return await _json(c, "post", f"/api/history/{first['id']}/undo", json={})
    st, body = call(ui, fn)
    assert st == 409 and "undo the later change first" in body["problems"][0]


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
        f.write(text.replace("cooldown_min: 15", "cooldown_min: 20", 1))
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
    assert changed and "cooldown_min: 20" in changed[0]["here"] and "cooldown_min: 15" in changed[0]["release"]
    assert st == 200 and after["release"]["state"] == "follows"
    assert open(os.path.join(ui.skills_dir, "alert-desk", "villa.notes.md")).read() == "the villa's own"
    assert st2 == 200 and "cooldown_min: 20" in open(path).read()                 # Undo: the edited one is back


def test_keep_mine_stops_offering_the_release_until_another_one(ui):
    path = os.path.join(ui.skills_dir, "alert-desk", "rules.yaml")
    with open(path, "a") as f:
        f.write("\n# mine\n")
    sk = Skills(ui.skills_dir, os.path.join(STARTER_DIR, "skills"))
    assert sk.release_state("alert-desk")["kept"] is False
    sk.keep_mine("alert-desk")
    assert sk.release_state("alert-desk")["kept"] is True


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
    raw["people"] = [{"telegram_id": 999, "name": "Them", "role": "owner", "language": "fr"}]
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
    assert Policy.load(other.policy_path).people[999].name == "Them"               # the villa's own, untouched
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
    shutil.rmtree(ui.data_dir)


def test_the_skill_page_is_read_from_the_skills_own_files_at_every_look(ui):
    # owner, 2026-10-06: "if a skill is suddenly modified to use another python file and/or another tool, the UI will
    # properly adjust". Nothing about a skill is kept by the page: it is skill.yaml as it is now, at every request.
    folder = os.path.join(ui.skills_dir, "pool-care")
    os.makedirs(os.path.join(folder, "scripts"))
    open(os.path.join(folder, "SKILL.md"), "w").write("---\nname: pool-care\n---\n")
    for f in ("check.py", "dose.py"):
        open(os.path.join(folder, "scripts", f), "w").write("print('{}')\n")
    open(os.path.join(folder, "skill.yaml"), "w").write(
        "description: pool\ntools: [ha_get_state]\nscripts:\n  check.py:\n    commands: {ph: the water's pH}\n")

    async def look(c):
        return await (await c.get("/api/skills/pool-care")).json()
    before = call(ui, look)
    with open(os.path.join(folder, "skill.yaml"), "w") as f:     # edited by hand: another script, tool, schedule
        f.write("description: pool\ntools: [ha_get_history, web_search]\n"
                "scripts:\n  check.py:\n    commands: {ph: pH, chlorine: chlorine}\n"
                "  dose.py:\n    description: how much to add\n    flags: {--litres: text, --product: [chlorine, acid]}\n"
                "schedule:\n  - when: \"Mon 09:00\"\n    run: \"check.py ph\"\n")
    after = call(ui, look)
    assert [n["tool"] for n in before["needs"]] == ["ha_get_state"]
    assert [n["tool"] for n in after["needs"]] == ["ha_get_history", "web_search"]
    assert [(s["script"], [c["name"] for c in s["commands"]]) for s in after["scripts"]] == \
        [("check.py", ["chlorine", "ph"]), ("dose.py", [])]
    dose = after["scripts"][1]
    assert dose["description"] == "how much to add" and dose["flags"] == {"--litres": "text", "--product": ["chlorine", "acid"]}
    assert any(a["when"].startswith("every Monday at 09:00") for a in after["acts"])
    from vesta_agent.ui.server import STATIC
    js = page_js()
    for starter in ("alert-desk", "villa-concierge", "roi-energy", "preventive-maintenance", "desk.py", "concierge.py"):
        assert starter not in js, f"the page names {starter}: it must come from the skill's files"


def test_try_a_command_offers_the_files_earlier_steps_left(ui):
    # 2026-10-06: compose.py fm-weekly tried from the page: "needs --facts" — the page offered no file option
    out = os.path.join(ui.data_dir, "out")
    os.makedirs(out, exist_ok=True)
    for i, n in enumerate(["notes.json", "facts.json"]):
        with open(os.path.join(out, n), "w") as f:
            f.write("{}")
        os.utime(os.path.join(out, n), (1000 + i, 1000 + i))
    os.makedirs(os.path.join(out, "a-folder"))

    async def fn(c):
        return await _json(c, "get", "/api/skills/reports")
    st, body = call(ui, fn)
    assert st == 200 and body["out_files"] == ["facts.json", "notes.json"]          # newest first, files only
    compose = next(sc for sc in body["scripts"] if sc["script"] == "compose.py")
    assert compose["flags"]["--facts"] == "infile"


def test_imported_instructions_can_be_undone_like_any_text(ui, tmp_path):
    # architecture review, 2026-10-06: a setup's instructions were recorded as a kind Undo refused
    with open(ui.instructions_path, "w") as f:
        f.write("The instructions of the villa the setup comes from.\n")
    data = _setup_zip(ui, {"instructions": True})
    other = settings(str(tmp_path / "other"))
    with open(other.instructions_path, "w") as f:
        f.write("This villa's own instructions.\n")
    zb = base64.b64encode(data).decode()

    async def fn(c):
        _, prev = await _json(c, "post", "/api/setup/import", json={"zip": zb})
        await _json(c, "post", "/api/setup/import", json={"zip": zb, "apply": True, "fingerprint": prev["fingerprint"]})
        imported = open(other.instructions_path).read()
        hist = (await (await c.get("/api/history")).json())["changes"]
        cid = next(h["id"] for h in hist if h["target"]["kind"] == "instructions")
        st, _ = await _json(c, "post", f"/api/history/{cid}/undo", json={})
        return imported, st
    imported, st = call(other, fn)
    assert imported.startswith("The instructions of the villa the setup comes from")
    assert st == 200 and open(other.instructions_path).read() == "This villa's own instructions.\n"


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
