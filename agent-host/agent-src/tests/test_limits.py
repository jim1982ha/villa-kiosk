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
    assert src == {"code", "skill", "shared", "policy", "measured"} and data["problems"] == []
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


def test_the_agents_two_numbers_are_bounded_by_one_table_on_both_tabs(ui):
    # architecture review P (2026-10-27): "1 to 1440 minutes" and "1 to 60 minutes" were written in the agent's check,
    # the Limits tab's rows and the Rules tab's inputs. All three read policy.NUMBERS now.
    import re
    from vesta_agent.policy import NUMBERS, form_schema
    from vesta_agent.policy import problems as policy_problems
    rows = {r["id"]["path"][0]: r for r in _rows(ui)["rows"] if r["id"]["src"] == "policy" and len(r["id"]["path"]) == 1}
    schema = form_schema()["numbers"]
    for key, (default, lo, hi) in NUMBERS.items():
        assert (rows[key]["lo"], rows[key]["hi"], rows[key]["default"]) == (lo, hi, default), key
        assert schema[key] == {"lo": lo, "hi": hi}, key
        assert policy_problems({key: hi}) == [] and any(key in x for x in policy_problems({key: hi + 1})), key
    js = open(os.path.join(SRC, "vesta_agent", "ui", "static", "rules.js"), encoding="utf-8").read()
    for key in NUMBERS:
        (inp,) = re.findall(r'h\("input", \{ type: "number", ([^}]*?)value: f\.' + key, js)
        assert inp == f'...bounds("{key}"), ', key                     # its bounds from the schema, none of its own


def test_a_value_set_for_a_limit_merged_into_another_is_said_never_dropped_in_silence(ui):
    # review P (2026-10-27): eight lengths of a problem's name became problems.title_chars — a villa that had set one
    with open(os.path.join(ui.config_dir, limits.FILE), "w", encoding="utf-8") as f:
        f.write("kiosk.fault_title_chars: 300\nan.old.limit: 4\n")
    said = _rows(ui)["problems"]
    assert "kiosk.fault_title_chars is set in limits.yaml but no longer read: problems.title_chars does its job now, " \
           "set it there." in said
    assert "an.old.limit is set in limits.yaml but no longer read." in said


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
    ("vesta_agent/policy.py", "hashlib.sha1(str(profile).encode()).digest()[:4]"): "4 bytes of a hash: a tablet "
                                                                                   "conversation's id, never a text",
    # dates and times cut out of a timestamp, hashes shortened for a key, a word's prefix or suffix
    ("vesta_agent/status.py", "str(start)[:16]"): "the date and time part of a timestamp",
    ("vesta_agent/status.py", "str(a['end_time'])[:16]"): "the date and time part of a timestamp",
    ("vesta_shared/problems.py", "str(iso)[:10]"): "the date part of a timestamp",
    ("vesta_agent/state.py", "slot_iso[:10]"): "the date part of a job's slot",
    ("vesta_agent/translation.py", "unread.strip()[:120]"): "the start of an unreadable AI answer, for the log only",
    ("vesta_agent/ui/setup_copy.py", "md[3:end]"): "the front matter between its two --- lines",
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
    ("starter/skills/villa-concierge/scripts/voice.py", "data[:4]"): "a WAV's RIFF tag",
    ("starter/skills/villa-concierge/scripts/voice.py", "data[8:12]"): "a WAV's WAVE tag",
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
    ("vesta_agent/tickets.py", "headline(title)[:80]"): "a log line",
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
    assert 'same(r.value, r.default) ? "" : ` Changed from its usual ${said(r, r.default)}.`' in js


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


def test_the_alert_cards_translation_is_the_chat_answers_line_never_a_skills_pair(ui):
    # owner, 2026-10-23: "I shall not see a dedicated Job for this". A pair "Add them" wrote for the alert desk on
    # 0.12.334–335 is left in policy.yaml, never read: no line of its own here; the chats' two lines say they do it
    raw = yaml.safe_load(open(ui.policy_path, encoding="utf-8")) or {}
    raw.setdefault("settings", {})["skill_ai"] = {"alert-desk": {"brain": "economy", "limit_usd": 0.05}}
    with open(ui.policy_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(raw, f)
    rows = _rows(ui)["rows"]
    assert not [r for r in rows if r["id"].get("path", [None, None])[:2] == ["settings", "skill_ai"]]
    said = {r["id"]["path"][-1]: r["label"] for r in rows if r["id"].get("path", [None])[0] == "settings"}
    assert "an alert card's text in a chat's language" in said["profile"]
    assert "one translation of an alert card's text" in said["reply_limit_usd"]


def test_a_search_counts_its_matches_in_every_tab_title_and_opens_a_tab_that_has_some():
    # owner, 2026-10-23: "reopen" found nothing — its limit sat in Skill settings while another tab was open; "the
    # numbers between brackets shall update in each tab title"
    from pathlib import Path
    js = (Path(__file__).resolve().parents[1] / "vesta_agent" / "ui" / "static" / "limits.js").read_text()
    groups = js[js.index("const groupsNow = () =>"):js.index("const bar = h(")]
    assert "const list = rows.filter(match);" in groups and "`${title} (${list.length})`" in groups
    draw = js[js.index("const draw = () => {"):js.index("draw();\n  const search")]
    assert "if (FILTER && first && (!open || open[4] === 0)) page.tabs.limits = first[0];" in draw
    assert "oninput: (e) => { SEARCH = e.target.value; FILTER = SEARCH.trim().toLowerCase(); draw(); }" in js
    assert js.index("const table = (list)") < js.index("draw();\n  const search")      # tabbed draws at once


def test_every_number_on_the_limits_tab_shows_its_unit(ui):
    # owner, 2026-10-23: "always show the units in the value column" — the skills' and the rules' numbers had none
    from vesta_agent.ui.limits_tab import unit_of
    for n in os.listdir(os.path.join(SRC, "starter", "skills")):
        if os.path.isdir(os.path.join(SRC, "starter", "skills", n)) and n not in ("preventive-maintenance", "alert-desk", "investigate"):
            copy_skill(n, ui.skills_dir)
    rows = _rows(ui)["rows"]
    bare = [r["name"] for r in rows if r["kind"] == "number" and not r["unit"]]
    assert bare == []
    by = {r["name"]: r["unit"] for r in rows}
    assert by["rules.yaml › behaviour.reopen_hours"] == "hours" and by["rules.yaml › siren.min_signals"] == "signals"
    assert by["settings.keep.daily_figures_months"] == "months" and by["settings.reply_limit_usd"] == "US$"
    assert [unit_of(k) for k in ("cooldown_min", "drift_pct", "offline_min_s", "zero_rest_share", "rise_ratio",
                                 "waste_min_kwh", "on_threshold_floor_w", "nothing_here")] == \
        ["minutes", "%", "seconds", "share (0 to 1)", "times", "kWh", "W", ""]


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


def test_a_guide_names_its_settings_and_the_ai_reads_their_values_now(ui, tmp_path, monkeypatch):
    # owner, 2026-10-24: "every number a setting" — a guide writes the name; the page shows it as a chip, and the AI is
    # given the same value beside it (limits_tab.fill_named, used by read_skill)
    from vesta_agent.ui.limits_tab import LimitsTab, fill_named
    copy_skill("roi-energy", ui.skills_dir)
    copy_skill("reports", ui.skills_dir)
    p = os.path.join(ui.config_dir, "limits.yaml")             # the Limits tab's file, the agent's VESTA_LIMITS
    open(p, "w").write("jobs.every_minutes: 7\npack.rebuild_at: '01:45'\n")
    monkeypatch.setenv("VESTA_LIMITS", p)
    tab = LimitsTab(ui, None)                                    # no page files: the AI's tool reads it so
    pm = open(os.path.join(ui.skills_dir, "preventive-maintenance", "SKILL.md")).read()
    got = fill_named(pm, tab.names("preventive-maintenance"))
    assert "`unavailable_minutes` (10 minutes)" in got and "`jobs.every_minutes` (7 minutes)" in got
    assert "`pack.rebuild_at` (01:45 villa time)" in got
    # a job's time by the job's name, from another skill's guide (roi-energy names the reports skill's jobs)
    roi = fill_named(open(os.path.join(ui.skills_dir, "roi-energy", "SKILL.md")).read(), tab.names("roi-energy"))
    assert "`fm-weekly` (Mon 08:00 villa time)" in roi and "`min_period_days` (5 days)" in roi
    assert "Monday" not in roi.split("## Procedure")[1].split("\n")[2]
    # every guide of the starter skills names, never writes, the values this sweep found written
    import glob
    texts = {f: open(f, encoding="utf-8").read() for f in glob.glob(os.path.join(SRC, "starter", "skills", "*", "SKILL.md"))}
    for phrase in ("640 characters", "a beat every minute", "at 01:30", "24 h of history", "read 6\n   hours",
                   "last 7 days", "at least 2 hours", "At most 5 searches", "fewer than 5 days", "(its setting"):
        assert not [f for f, t in texts.items() if phrase in t], phrase


def test_a_time_of_day_is_a_limit_too(tmp_path, monkeypatch):
    p = tmp_path / "limits.yaml"
    monkeypatch.setenv("VESTA_LIMITS", str(p))
    assert limits.limit("x.at", "01:30") == "01:30"
    p.write_text("x.at: '02:15'\n")
    assert limits.limit("x.at", "01:30") == "02:15"
    p.write_text("x.at: '25:00'\n")
    os.utime(p, (time.time() + 3, time.time() + 3))
    assert limits.limit("x.at", "01:30") == "01:30"                    # not a time: the default
    assert limits.check(limits.Declared("x.at", "01:30"), "7pm") == "x.at is a time of day, HH:MM."


def test_the_ais_read_skill_tool_gives_each_named_setting_its_value(tmp_path):
    # the AI reads the guide through read_skill: the values beside the names, as the page's chips show them
    from helpers import make_agent
    v = make_agent(str(tmp_path), {"people": []}, skills=["preventive-maintenance"])
    res = asyncio.run(v.toolbox()._read_skill().handler({"skill": "preventive-maintenance"}))
    text = res["content"][0]["text"]
    assert "`unavailable_minutes` (10 minutes)" in text and "`pack.rebuild_at` (01:30 villa time)" in text


def test_the_code_is_parsed_once_per_version_of_a_file(tmp_path):
    # review K: every reading of a guide by the AI parsed the whole source tree (about a second of a stalled agent)
    from vesta_shared import limits as L
    f = tmp_path / "m.py"
    f.write_text('limit("x.a", 1, says="a", reached="b")\n')
    L._declared_in.cache_clear()
    L.scan([str(tmp_path)])
    L.scan([str(tmp_path)])
    assert L._declared_in.cache_info().misses == 1 and L._declared_in.cache_info().hits == 1
    time.sleep(0.01)
    f.write_text('limit("x.a", 2, says="a", reached="b")\n')
    assert L.scan([str(tmp_path)])[0]["x.a"].default == 2              # a changed file is read again


def test_no_guide_says_a_named_settings_unit_a_second_time(ui):
    # review K, 0.12.345: the value comes with its unit ("`siren.window_min` (5 minutes)"); a guide writing "minutes"
    # after it read "5 minutes minutes" to the AI and on the page's chip
    import glob
    import re
    from vesta_agent.ui.limits_tab import LimitsTab
    for d in os.listdir(os.path.join(SRC, "starter", "skills")):
        if not os.path.isdir(os.path.join(ui.skills_dir, d)):
            copy_skill(d, ui.skills_dir)
    tab, twice = LimitsTab(ui, None), []
    for d in sorted(os.listdir(ui.skills_dir)):
        md = open(os.path.join(ui.skills_dir, d, "SKILL.md"), encoding="utf-8").read()
        names = tab.names(d)
        for m in re.finditer(r"`([A-Za-z][\w.\-]*)`(\s*\(a limit\))?\s*([^\s.,;:)]*)", md):
            n = names.get(m.group(1))
            unit = ((n or {}).get("unit") or "").split()
            if n and (m.group(2) or (unit and m.group(3).lower() in (unit[0].lower(), unit[0].lower().rstrip("s")))):
                twice.append(f"{d}: {m.group(0)}")
    assert twice == []


def test_the_chat_reset_reads_on_the_limits_tab_as_on_the_rules_tab(ui):
    # review K, 0.12.345: Limits offered "daily_04_00" while Rules said "Every day at 02:00"
    path = os.path.join(ui.config_dir, "limits.yaml")
    open(path, "w").write("chat.reset_at: '02:00'\nchat.silence_reset_hours: 12\n")
    os.environ["VESTA_LIMITS"] = path
    try:
        row = next(r for r in _rows(ui)["rows"] if r["name"] == "settings.conversation_reset")
    finally:
        os.environ.pop("VESTA_LIMITS", None)
    assert row["choices"] == [["daily_04_00", "Every day at 02:00"], ["after_8h_silence", "After 12h of silence"],
                              ["never", "Never (/new only)"]]
    js = (Path(__file__).resolve().parents[1] / "vesta_agent" / "ui" / "static" / "limits.js").read_text()
    assert "(Array.isArray(c) ? c : [c, c])" in js


def test_a_guides_table_and_a_long_setting_name_stay_inside_a_phones_screen():
    # owner, 2026-10-24 (phone): a SKILL.md table's column broke one letter per line, a setting's chip ran past the edge
    css = (Path(__file__).resolve().parents[1] / "vesta_agent" / "ui" / "static" / "app.css").read_text()
    rule = lambda sel: css.rsplit(sel + " {", 1)[1].split("}", 1)[0]          # the last rule: the phone fix
    assert "overflow-x: auto" in rule(".md-box table.rows") and "display: block" in rule(".md-box table.rows")
    assert "word-break: normal" in rule(".md-box table.rows td, .md-box table.rows th")
    assert "overflow-wrap: anywhere" in rule("a.setting")


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


def test_a_rules_save_says_the_choice_in_its_words_in_page_changes():
    # review L (2026-10-25): a Rules-tab save read "Delete conversation context at: daily_04_00 → after_8h_silence"
    from vesta_agent.history import policy_change
    line = policy_change("settings:\n  conversation_reset: daily_04_00\n", "settings:\n  conversation_reset: after_8h_silence\n")
    assert line.endswith(": Every day at 04:00 → After 8h of silence"), line
