"""Who is who is one module, vesta_agent/roster.py (architecture review round 17, lead 1): Policy holds policy.yaml's
rules and is handed a Roster; a caller that needs only rules never builds one, and a Policy built without one refuses
to say who is who instead of answering "nobody"."""
from __future__ import annotations

import os

import pytest
import yaml

from helpers import copy_skill, keep_roster, settings
from vesta_agent import roster as roster_module
from vesta_agent.policy import Policy
from vesta_agent.roster import Roster

ANN, GROUP = 111, -100222


def test_a_policy_built_for_its_rules_refuses_to_say_who_is_who():
    rules = Policy({"act_enabled": True})
    assert rules.act_enabled                                              # its rules, read as ever
    with pytest.raises(LookupError):
        rules.roster.person(ANN)                                          # never a silent "nobody"


def test_each_chats_language_is_the_kiosks_by_the_entity_it_was_read_from(tmp_path):
    # owner, 2026-11-03: "isn't it also redundant to show … the language selection? Since it's already selected in the
    # Vesta kiosk": set in the Kiosk beside the chat, told by notify entity in its heartbeat answer
    from vesta_shared import kiosk_told, villa_recipients
    s = settings(str(tmp_path))
    villa_recipients.save(s.pack_path, {
        "owner": [{"chat": ANN, "name": "Ann", "entity": "notify.example_ann"}, {"chat": GROUP, "name": "Staff", "entity": "notify.example_staff"}],
        "fm": [{"chat": GROUP, "name": "Staff", "entity": "notify.example_staff"}, {"chat": 333, "name": "Old"}]})
    kiosk_told.keep(s.pack_path, {"chatLanguages": {"notify.Example_Ann": "fr", "notify.example_staff": "de"}})
    r = s.policy().roster
    assert r.language_of(ANN, "owner") == "fr" and r.languages_for("owner") == ["fr", "de"]
    assert r.language_of(GROUP, "fm") == "de"                             # one entity in both lists: one language
    assert r.language_of(333, "fm") == "en"                               # a row kept before 0.12.442: no entity
    kiosk_told.keep(s.pack_path, {"chatLanguages": {}})                   # the Kiosk cleared them: read again at once
    assert s.policy().roster.language_of(ANN, "owner") == "en"
    kiosk_told.keep(s.pack_path, {"chatLanguages": {"notify.example_ann": "id"}})
    kiosk_told.keep(s.pack_path, {"maintenance": False})                  # an answer without them keeps what was told
    assert s.policy().roster.language_of(ANN, "owner") == "id"


def test_whether_the_lists_were_read_is_the_kept_files_one_answer(tmp_path):
    s = settings(str(tmp_path))
    never = Roster.kept(s.pack_path)
    assert not never.read_yet and never.entries == []                     # a first start: nobody, and said so
    keep_roster(s, Roster.of(owner=[(ANN, "Ann")], fm=[(GROUP, "Staff")]))
    kept = Roster.kept(s.pack_path)
    assert kept.read_yet and [(e.telegram_id, e.role) for e in kept.entries] == [(ANN, "owner"), (GROUP, "fm")]
    assert s.policy().roster.read_yet and s.policy().roster.chats_for("fm") == [GROUP]
    keep_roster(s, Roster.of())                                           # read, and naming nobody
    assert Roster.kept(s.pack_path).read_yet and s.policy().roster.destinations == []
    assert not Roster.kept(None).read_yet                                 # no pack to sit beside


def test_the_rules_only_callers_never_need_the_villas_lists(tmp_path, monkeypatch):
    # the Limits tab, the setup copy, the page's move of an older file's AI jobs and the alert desk's siren time read
    # rules only: they built Policy without the lists, and would have read "nobody" had they asked who is who
    from vesta_agent.skills import Skills, job_owners, job_starters
    from vesta_agent.ui import policy_doc, setup_copy
    from vesta_agent.ui.limits_tab import LimitsTab
    s = settings(str(tmp_path))
    for name in ("reports", "investigate"):
        copy_skill(name, s.skills_dir)
    keep_roster(s, Roster.of(owner=[(ANN, "Ann")]))
    text = open(s.policy_path, encoding="utf-8").read()
    old = text.replace("\nsettings:\n", "\nsettings:\n  jobs:\n    fm-daily: {profile: auto, limit_usd: 1}\n", 1)
    with open(s.policy_path, "w", encoding="utf-8") as f:
        f.write(old)

    def built(*_a, **_k):
        raise AssertionError("a rules-only caller built who is who")
    monkeypatch.setattr(roster_module.Roster, "__init__", built)
    rows = LimitsTab(s, None).rows()
    assert rows
    skills = Skills(s.skills_dir)
    every = skills.all(include_off=True)
    data = setup_copy.export(s, skills, set(setup_copy.PARTS))
    assert setup_copy.preview(s, skills, setup_copy.read(data), [])
    moved = yaml.safe_load(policy_doc.ai_moved(old, job_owners(every), job_starters(every)))
    assert "jobs" not in moved["settings"] and moved["settings"]["skill_ai"]
    monkeypatch.setenv("VESTA_POLICY", s.policy_path)
    import importlib.util
    from helpers import STARTER_SKILLS
    spec = importlib.util.spec_from_file_location("desk_roster", os.path.join(STARTER_SKILLS, "alert-desk", "scripts",
                                                                              "desk.py"))
    desk = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(desk)
    assert desk.siren_minutes() == Policy({}).siren_auto_off_min
