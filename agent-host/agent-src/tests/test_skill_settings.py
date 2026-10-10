"""Architecture review 7: a skill's settings file, the villa's on top (vesta_shared.skill_settings); each skill's
thresholds in its own file, none in the shared library or a script."""
from __future__ import annotations

import glob
import os
import re

import yaml

from helpers import STARTER_SKILLS
from vesta_shared import skill_settings
from vesta_shared.params import MissingParameter, VillaParams


def test_the_villas_file_refines_the_shipped_one(tmp_path):
    (tmp_path / "rules.yaml").write_text(yaml.safe_dump({
        "behaviour": {"reask_minutes": 15, "escalate_minutes": 45}, "routes": [{"blueprint": "a", "severity": "P2"}],
        "cards": ["x"]}))
    (tmp_path / "villa.rules.yaml").write_text(yaml.safe_dump({
        "behaviour": {"reask_minutes": 5}, "routes": [{"blueprint": "a", "severity": "P1"}], "cards": ["y"]}))
    got = skill_settings.load(str(tmp_path), "rules.yaml", first=("routes",))
    assert got["behaviour"] == {"reask_minutes": 5, "escalate_minutes": 45}                 # key by key
    assert got["routes"][0]["severity"] == "P1"                                       # the villa's route wins
    assert got["cards"] == ["x", "y"]                                                 # added after
    assert skill_settings.load(str(tmp_path), "absent.yaml") == {}


def test_a_behaviour_value_comes_from_a_helper_then_the_skill_and_is_never_guessed():
    p = VillaParams(helpers=[{"entity_id": "input_number.vesta_reask_minutes"}],
                    states={"input_number.vesta_reask_minutes": "7"}, defaults={"reask_minutes": 15, "villa_silent_minutes": 30})
    assert p.behaviour("reask_minutes") == 7 and p.behaviour("villa_silent_minutes") == 30
    try:
        p.behaviour("escalate_minutes")
        raise AssertionError("a missing value was guessed")
    except MissingParameter as e:
        assert "vesta_escalate_minutes" in str(e)


def test_every_threshold_a_script_reads_is_in_its_own_skills_settings():
    for skill in glob.glob(os.path.join(STARTER_SKILLS, "*")):
        keys = set()
        for path in glob.glob(os.path.join(skill, "scripts", "*.py")):
            keys |= set(re.findall(r'behaviour\(\s*"([a-z_]+)"', open(path, encoding="utf-8").read()))
        have = set()
        for f in ("settings.yaml", "rules.yaml"):
            have |= set(skill_settings.behaviour(skill_settings.load(skill, f)))
        assert keys <= have, f"{os.path.basename(skill)} reads {sorted(keys - have)} with no default of its own"
    import vesta_shared.params as params
    assert not hasattr(params, "BEHAVIOUR_DEFAULTS")                                  # no shared table


def test_the_reports_and_the_alert_desk_name_the_same_vesta_rules():
    # the reports skill no longer reads the alert desk's folder: its own list, held equal here
    desk = yaml.safe_load(open(os.path.join(STARTER_SKILLS, "alert-desk", "rules.yaml")))
    reports = yaml.safe_load(open(os.path.join(STARTER_SKILLS, "reports", "reports.yaml")))
    assert {r["blueprint"] for r in desk["routes"] if r.get("blueprint")} == set(reports["alert_words"])
    src = open(os.path.join(STARTER_SKILLS, "reports", "scripts", "facts.py"), encoding="utf-8").read()
    assert "alert-desk" + '", "rules.yaml' not in src and '"..", "alert-desk"' not in src


def test_the_proposals_thresholds_are_the_skills():
    import sys
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "roi-energy", "scripts"))
    import proposals
    period = {"unmetered_pct": 55, "unmetered_kwh": 100, "currency": ""}
    th = dict(proposals.thresholds())
    assert any(p["kind"] == "measurement" for p in proposals.build(period, None, [], th))
    th["unmetered_min_pct"] = 60
    assert not proposals.build(period, None, [], th)
