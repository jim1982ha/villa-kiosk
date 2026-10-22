"""The Limits tab (owner, 2026-10-20): every limit on one page, each saved where the agent already reads it."""
from __future__ import annotations

import asyncio
import os
import time

import pytest
import yaml
from aiohttp.test_utils import TestClient, TestServer

from helpers import copy_skill, settings
from vesta_shared import limits, skill_settings
from vesta_agent.policy import Policy
from vesta_agent.ui.server import UI

HDR = {"X-Vesta-UI": "1"}
SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture
def ui(tmp_path):
    s = settings(str(tmp_path))
    for name in ("preventive-maintenance", "alert-desk", "investigate"):
        copy_skill(name, s.skills_dir)
    text = open(s.policy_path, encoding="utf-8").read()
    with open(s.policy_path, "w", encoding="utf-8") as f:
        f.write(text.replace("people: []", "people:\n  - {telegram_id: -100, name: Villa group, role: owner}\n"
                                            "  - {telegram_id: -100, name: Villa group FM, role: fm}", 1))
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


def test_every_limit_of_the_code_is_declared_readably():
    found, problems = limits.scan([os.path.join(SRC, d) for d in ("vesta_shared", "vesta_agent", "starter")])
    assert problems == []
    assert len(found) >= 20
    for key, d in found.items():
        assert d.group in limits.GROUPS, key
        assert d.says and d.reached, f"{key}: the page says what it limits and what happens when it is reached"
        assert limits.check(d, d.default) is None, f"{key}: its default is outside its own bounds"


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
    assert src == {"code", "skill", "policy", "measured"} and data["problems"] == []
    kept = next(r for r in data["rows"] if r["id"]["src"] == "measured")
    assert kept["value"] == "not measured yet" and "purge_keep_days" in kept["also"]
    pm = next(r for r in data["rows"] if r["id"].get("skill") == "preventive-maintenance"
              and r["id"]["path"] == ["behaviour", "baseline_days"])
    assert pm["value"] == 30 and "window for the rolling median" in pm["label"]
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


def test_a_number_inside_a_list_is_saved_in_the_skills_file_comments_kept(ui):
    folder = os.path.join(ui.skills_dir, "alert-desk")
    data = _rows(ui)
    row = next(r for r in data["rows"] if r["id"].get("skill") == "alert-desk" and r["id"]["file"] == "rules.yaml"
               and any(isinstance(k, int) for k in r["id"]["path"]))
    comments = [ln for ln in open(os.path.join(folder, "rules.yaml")).read().splitlines() if ln.strip().startswith("#")]
    status, _ = _put(ui, row["id"], row["value"] + 5)
    assert status == 200
    after = open(os.path.join(folder, "rules.yaml")).read()
    assert all(c in after.splitlines() for c in comments)
    node = yaml.safe_load(after)
    for k in row["id"]["path"]:
        node = node[k]
    assert node == row["value"] + 5


def test_a_rule_is_saved_in_policy_yaml_and_checked_by_the_agents_rules(ui):
    status, _ = _put(ui, {"src": "policy", "path": ["settings", "reply_limit_usd"]}, 2.5)
    assert status == 200
    assert Policy.load(ui.policy_path).behaviour["reply_limit_usd"] == 2.5
    status, body = _put(ui, {"src": "policy", "path": ["settings", "reply_limit_usd"]}, 0.01)
    assert status == 400 and "at least 0.05" in " ".join(body["problems"])


def test_every_change_is_in_page_changes(ui):
    _put(ui, {"src": "policy", "path": ["approval_ttl_minutes"]}, 20)

    async def fn(c):
        return await (await c.get("/api/history")).json()
    rows = call(ui, fn)["changes"]
    assert rows[0]["place"] == "Limits" and "approval_ttl_minutes" in rows[0]["what"] and rows[0]["undoable"]


# ------------------------------------------------------------------ nothing cut by a bare number
#: The cut-shaped numbers that are NOT limits on what the agent reads, says or keeps — each with why. A new one fails
#: the release (test below) until it is declared with limit() or added here with its reason.
NOT_LIMITS = {
    # dates and times cut out of a timestamp, hashes shortened for a key, a word's prefix or suffix
    ("vesta_agent/status.py", "str(start)[:16]"): "the date and time part of a timestamp",
    ("vesta_agent/status.py", "str(a['end_time'])[:16]"): "the date and time part of a timestamp",
    ("vesta_shared/problems.py", "str(iso)[:10]"): "the date part of a timestamp",
    ("vesta_shared/timeutil.py", "s.split(\":\")[:2]"): "hours and minutes of a clock time",
    ("vesta_agent/ui/changes.py", "hashlib.sha256(data).hexdigest()[:16]"): "a file version's short hash",
    ("starter/skills/roi-energy/scripts/energy_period.py", "h.hexdigest()[:12]"): "the cache key's short hash",
    ("starter/skills/roi-energy/scripts/energy_period.py", "str(r[k])[:10]"): "the date part of a timestamp",
    ("starter/skills/investigate/scripts/investigate.py", "at(t, zone, span_days)[:-3]"): "a clock time without seconds",
    ("vesta_shared/critical.py", "name[:-5]"): "a word's suffix removed",
    ("vesta_shared/ha_client.py", "line[5:]"): "the 'data:' prefix of a stream line",
    ("vesta_agent/state.py", "k.split(\":\")[-2:]"): "the last two parts of a record key",
    ("vesta_agent/history.py", "parts[:2]"): "the first two parts of a setting's path",
    ("vesta_agent/ui/setup_copy.py", "parts[2:]"): "a path's parts after its first two",
    ("vesta_agent/layout.py", "lines[2:]"): "a message's lines after its heading",
    ("vesta_shared/page.py", "(list(m) + [\"\"])[:3]"): "three fields of a match, padded",
    ("starter/skills/villa-concierge/scripts/voice.py", "packets[2:]"): "the audio packets after the stream's two headers",
    # batch sizes of reads that go on to the end (every batch is read)
    ("vesta_shared/ha_client.py", "'limit': 50"): "a batch of a read that pages to its end",
    ("vesta_shared/ha_client.py", "'limit': 100"): "a batch of a read that pages to its end",
    ("vesta_shared/ha_client.py", "'limit': 500"): "a batch of a read that pages to its end",
    # connection plumbing: how long one connection attempt waits, not how much is read
    ("vesta_agent/ha_events.py", "timeout=20"): "one connection attempt to the villa's events",
    ("vesta_agent/ui/server.py", "timeout=45"): "the page waiting for the agent's answer to a request",
    # the log and the agent's own records only: never what a person or the AI reads
    ("vesta_agent/tickets.py", "(title or \"\")[:80]"): "a log line",
    ("vesta_agent/tickets.py", "(title or \"\")[:60]"): "a log line",
    ("vesta_agent/tickets.py", "ticket_title(title)[:80]"): "a log line",
    ("vesta_agent/tickets.py", "(a.get(\"title\") or \"\")[:80]"): "a log line",
    ("vesta_agent/tickets.py", "unseen[:10]"): "a log line",
    ("vesta_agent/tools.py", "status.step_summary(**step(name, args))[:100]"): "a log line",
    ("vesta_agent/tools.py", "answer[:80]"): "a log line",
    ("vesta_agent/tools.py", "sorted(args)[:10]"): "a refusal's log record",
    ("vesta_agent/tools.py", "why[:120]"): "a refusal's log record",
    ("vesta_agent/ui/server.py", "str(body.get(\"message\") or \"\")[:300]"): "a page error's log line",
    ("vesta_agent/ui/server.py", "str(body.get(\"agent\") or \"\")[:120]"): "a page error's log line",
    ("vesta_agent/runner.py", "str(b.input[\"skill\"])[:60]"): "a skill name, already at most 61 characters",
}
CUT_ARGS = {"limit", "max_entities_per_domain", "hours_back", "top_n", "per_domain_limit"}


def _bare_cuts() -> list[tuple[str, str]]:
    import ast

    def num(n):
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, ast.USub):
            n = n.operand
        return n.value if isinstance(n, ast.Constant) and isinstance(n.value, int) and not isinstance(n.value, bool) else None
    out = []
    for d in ("vesta_agent", "vesta_shared", "starter"):
        for dp, dn, fs in os.walk(os.path.join(SRC, d)):
            dn[:] = [x for x in dn if x not in ("__pycache__", "tests")]
            for f in fs:
                if not f.endswith(".py"):
                    continue
                p = os.path.join(dp, f)
                src = open(p, encoding="utf-8").read()
                rel = os.path.relpath(p, SRC)
                for n in ast.walk(ast.parse(src)):
                    if isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Slice):
                        if any(b is not None and num(b) is not None and abs(num(b)) >= 2
                               for b in (n.slice.lower, n.slice.upper)):
                            out.append((rel, ast.get_source_segment(src, n)))
                    elif isinstance(n, ast.Dict):
                        out += [(rel, f"{k.value!r}: {v.value}") for k, v in zip(n.keys, n.values)
                                if isinstance(k, ast.Constant) and k.value in CUT_ARGS and num(v) is not None]
                    elif isinstance(n, ast.keyword) and n.arg in CUT_ARGS | {"timeout"} and num(n.value) is not None:
                        out.append((rel, f"{n.arg}={n.value.value}"))
    return out


def test_no_list_or_text_is_cut_by_a_bare_number():
    # ⚠️ EVERY LIMIT ON THE PAGE (owner, 2026-10-20: "define all these centrally … applied exhaustively"): a slice by a
    # written number, a page size or a timeout typed into the code is a limit the Limits tab cannot show or change
    new = sorted({c for c in _bare_cuts() if c not in NOT_LIMITS})
    assert new == [], ("cut by a bare number — declare it with vesta_shared.limits.limit(), or add it to NOT_LIMITS "
                       f"with why it is not a limit: {new}")
    gone = sorted(set(NOT_LIMITS) - set(_bare_cuts()))
    assert gone == [], f"NOT_LIMITS names code that is no longer there: {gone}"


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
    v = make_agent(tmp_path, {"people": [{"telegram_id": 111, "name": "Owner", "role": "owner"}], "chats": {"owner": -1},
                              "ha_read_tools": ["ha_get_history", "ha_get_logs"]}, reader=ha)
    asyncio.run(v.refresh_server_tools())
    tools = {t.name: t for t in v.toolbox().tool_objects(None, Origin(-1, CONVERSATION))}
    asyncio.run(tools["ha_get_history"].handler({"entity_ids": "sensor.example_power"}))
    assert ha.calls[-1][1]["limit"] == 500 and ha.calls[-1][1]["start_time"] == "48h"
    asyncio.run(tools["ha_get_history"].handler({"entity_ids": "sensor.example_power", "limit": 20}))
    assert ha.calls[-1][1]["limit"] == 20                                     # the AI's own number stands
    assert asyncio.run(tools["ha_get_logs"].handler({"source": "logbook", "hours_back": 3})).get("is_error")


def test_the_days_kept_are_shown_as_measured_and_never_saved(ui):
    from vesta_shared.knowledge_pack import build_pack
    with open(ui.pack_path, "w", encoding="utf-8") as f:
        f.write(build_pack({"entities": []}, [], detailed_days=11.27).to_json())
    kept = next(r for r in _rows(ui)["rows"] if r["id"]["src"] == "measured")
    assert kept["value"] == "11.3 days" and kept["group"] == "keep"
    status, _ = _put(ui, kept["id"], 30)
    assert status == 400                                         # the villa's own setting: never set from here


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


def test_only_a_changed_value_says_it_was_changed():
    # owner's screenshot, 2026-10-20: every row read "Changed from its usual 5000" beside 5000 — the test was inverted
    from helpers import page_js
    js = page_js()
    assert 'same(r.value, r.default) ? "" : ` Changed from its usual ${shown(r.default)}.`' in js


def test_delete_skill_is_on_about_and_on_files_under_one_name():
    # owner, 2026-10-20: "Delete Skill", and on the About tab too — one button, one handler
    from helpers import page_js
    js = page_js()
    assert 'h("button", { class: "btn danger push-right", onclick: delSkill }, "Delete Skill")' in js
    assert 'card(aboutSkill(name, d), h("div", { class: "actions" }, delSkillButton()))' in js
    assert "Delete the skill\")" not in js and js.count("delSkillButton()") == 2


def test_the_tab_lists_no_value_that_changes_nothing_and_says_what_a_save_to_a_skills_file_does(ui):
    # architecture review, 2026-10-20: reports' jobs_default rows were editable while Rules decides what runs; a save to
    # a skill's own file (skill.yaml, a number inside a list) stopped its updates, unsaid
    copy_skill("reports", ui.skills_dir)
    rows = _rows(ui)["rows"]
    assert not [r for r in rows if r["id"].get("skill") == "reports" and r["id"].get("path", [None])[0] == "jobs_default"]
    inv = next(r for r in rows if r["id"].get("skill") == "investigate" and r["id"]["file"] == "skill.yaml"
               and r["id"]["path"] == ["limit_usd"])
    assert "makes this skill your own copy" in inv["also"]
    villa = next(r for r in rows if r["id"].get("path") == ["behaviour", "baseline_days"])
    assert "your own copy" not in villa["also"]                    # saved in the villa's own file: updates go on


def test_who_is_told_is_a_column_of_its_own_never_the_end_of_the_reached_sentence():
    # owner, 2026-10-22: the pill ("Nobody is told", "Only the AI is told"…) sat after "Reached: …"; now its own column,
    # between the limit and its value, still a pill (grey when nobody is told)
    from helpers import page_js
    js = page_js().split("function row(")[1].split("export async function limits")[0]
    assert 'h("div", { class: "limit-reached" }, `Reached: ${r.reached}`)' in js
    assert js.index('class: "limit-what"') < js.index('r.told ? h("span", { class: "chip tiny"') < js.index('class: "limit-value"')
    assert '["Limit", "Who is told", "Value"]' in page_js()
