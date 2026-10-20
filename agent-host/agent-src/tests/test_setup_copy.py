"""Copy the setup (owner's file, 2026-10-20: made with 0.6.277): the Limits tab's values travel, the AI settings go in
the current shape, and a skill switched off that no longer exists does not — driven through the page's own routes."""
from __future__ import annotations

import asyncio
import base64
import io
import os
import zipfile

import yaml
from aiohttp.test_utils import TestClient, TestServer

from helpers import copy_skill, settings
from vesta_agent.ui.server import UI

HDR = {"X-Vesta-UI": "1"}
PARTS = {"skills": True, "villa_files": True, "ai": True, "actions": True, "tools": True, "keep": True, "limits": True}


def _villa(tmp, policy_extra: str = "", limits_text: str | None = None):
    s = settings(str(tmp))
    for name in ("reports", "investigate"):
        copy_skill(name, s.skills_dir)
    text = open(s.policy_path, encoding="utf-8").read()
    text = text.replace("people: []", "people:\n  - {telegram_id: -100, name: Villa group, role: owner}\n"
                                      "  - {telegram_id: -100, name: Villa group FM, role: fm}", 1)
    with open(s.policy_path, "w", encoding="utf-8") as f:
        f.write(text + policy_extra)
    if limits_text is not None:
        with open(os.path.join(s.config_dir, "limits.yaml"), "w", encoding="utf-8") as f:
            f.write(limits_text)
    return s


def _call(s, fn):
    async def go():
        async with TestClient(TestServer(UI(s, "standalone").app())) as c:
            return await fn(c)
    return asyncio.run(go())


def _export(s) -> zipfile.ZipFile:
    async def fn(c):
        r = await c.post("/api/setup/export", json=PARTS, headers=HDR)
        assert r.status == 200
        return await r.read()
    return zipfile.ZipFile(io.BytesIO(_call(s, fn)))


def _import(s, data: bytes, apply: bool = False, fingerprint: str | None = None):
    async def fn(c):
        r = await c.post("/api/setup/import", json={"zip": base64.b64encode(data).decode(), "apply": apply,
                                                    "fingerprint": fingerprint}, headers=HDR)
        return r.status, await r.json()
    return _call(s, fn)


# the owner's villa, as its file said it: the AI jobs in the older shape, a skill switched off that is gone
OLD_AI = """
  jobs:
    fm-daily: {profile: auto, limit_usd: 1}
    fm-weekly: {profile: auto, limit_usd: 2}
    owner-monthly: {profile: auto, limit_usd: 6}
"""


def _with_old_ai(tmp):
    s = _villa(tmp, limits_text="investigate.max_lines: 300\n")
    text = open(s.policy_path, encoding="utf-8").read()
    assert "\nsettings:\n" in text
    with open(s.policy_path, "w", encoding="utf-8") as f:
        f.write(text.replace("\nsettings:\n", "\nsettings:" + OLD_AI, 1) + "skills_off:\n- thfdsdsjfsf\n")
    return s


def test_the_file_carries_the_current_ai_shape_known_skills_and_the_limits(tmp_path):
    z = _export(_with_old_ai(tmp_path))
    rules = yaml.safe_load(z.read("rules.yaml"))
    # the page's own move (policy_doc.ai_moved): the reports' one brain and its skill's starter limit, never the
    # largest of the old ones (owner, 2026-10-20: "set this limit to 2 USD")
    assert rules["settings"]["skill_ai"]["reports"] == {"brain": "auto", "limit_usd": 2}
    assert "jobs" not in rules["settings"] and "skill_brains" not in rules["settings"]
    assert rules.get("skills_off", []) == []
    assert yaml.safe_load(z.read("limits.yaml")) == {"investigate.max_lines": 300}


def test_an_import_shows_and_writes_the_limits_and_leaves_an_unknown_skill_out(tmp_path):
    data = _export(_with_old_ai(tmp_path / "a")).fp.getvalue()
    # a setup made elsewhere may switch off a skill this villa will not have, and name a limit this code lacks
    z = zipfile.ZipFile(io.BytesIO(data))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as out:
        for i in z.infolist():
            body = z.read(i)
            if i.filename == "rules.yaml":
                r = yaml.safe_load(body)
                r["skills_off"] = ["gone-skill", "reports"]
                body = yaml.safe_dump(r).encode()
            if i.filename == "limits.yaml":
                body = b"investigate.max_lines: 300\nnot.a.limit: 5\ninvestigate.find_matches: 100000\n"
            out.writestr(i.filename, body)
    other = _villa(tmp_path / "b")
    st, prev = _import(other, buf.getvalue())
    assert st == 200, prev
    row = next(r for r in prev["rows"] if r["kind"] == "limits")
    assert row["change"] == "changed" and row["detail"] == "investigate.max_lines: 120 → 300"
    said = " ".join(prev["misfits"])
    assert "gone-skill" in said and "not.a.limit" in said and "investigate.find_matches" in said
    st, done = _import(other, buf.getvalue(), apply=True, fingerprint=prev["fingerprint"])
    assert st == 200, done
    assert yaml.safe_load(open(os.path.join(other.config_dir, "limits.yaml"))) == {"investigate.max_lines": 300}
    pol = yaml.safe_load(open(other.policy_path))
    assert pol["skills_off"] == ["reports"]


# owner, 2026-10-20: "make sure the 'your standing rules for the agent' option is checked by default"
def test_the_standing_rules_are_ticked_at_first():
    from vesta_agent.ui.setup_copy import offer
    ticks = {p["key"]: p["on"] for p in offer()["parts"]}
    assert ticks["instructions"] is True and all(ticks.values())


# owner, 2026-10-20 ("fully fix all gaps"): the villa's own file keeps no skill it does not have — every save of the
# page cleans it, and deleting a switched-off skill takes it off the list
def test_a_page_save_drops_a_switched_off_skill_the_villa_does_not_have(tmp_path):
    s = _with_old_ai(tmp_path)
    async def fn(c):
        from vesta_agent.ui.changes import rev
        r = await c.put("/api/policy/form", json={"form": {"settings": {"web_search": True}},
                                                  "rev": rev(open(s.policy_path, "rb").read())}, headers=HDR)
        return r.status, await r.json()
    st, body = _call(s, fn)
    assert st == 200, body
    assert "thfdsdsjfsf" not in (yaml.safe_load(open(s.policy_path)).get("skills_off") or [])


def test_deleting_a_switched_off_skill_takes_it_off_the_list(tmp_path):
    s = _villa(tmp_path)
    with open(s.policy_path, "a", encoding="utf-8") as f:
        f.write("skills_off:\n- investigate\n")
    async def fn(c):
        r = await c.delete("/api/skills/investigate", json={}, headers=HDR)
        return r.status, await r.json()
    st, body = _call(s, fn)
    assert st == 200, body
    assert "investigate" not in (yaml.safe_load(open(s.policy_path)).get("skills_off") or [])


def test_known_off_keeps_a_clean_file_byte_for_byte():
    from vesta_agent.ui.policy_doc import existing_off, known_off
    text = "settings: {web_search: true}  # mine\nskills_off:\n- reports\n"
    assert known_off(text, {"reports"}) == text
    assert yaml.safe_load(known_off(text, set()))["skills_off"] == []
    assert existing_off(["a", "b"], {"b"}) == ["b"]
