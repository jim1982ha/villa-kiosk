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


def test_a_villa_setting_a_retired_key_is_told_never_ignored(tmp_path):
    # owner, 2026-10-19: a villa.<file> override of a removed key must be named
    (tmp_path / "s.yaml").write_text(yaml.safe_dump({"thresholds": {"a": 1},
                                                     "retired": {"thresholds.pump.drop": "the night check decides it"}}))
    assert skill_settings.retired(str(tmp_path), "s.yaml") == []                       # no villa file: nothing to say
    (tmp_path / "villa.s.yaml").write_text(yaml.safe_dump({"thresholds": {"a": 2, "pump": {"other": 1}}}))
    assert skill_settings.retired(str(tmp_path), "s.yaml") == []                       # a sibling key is not the retired one
    (tmp_path / "villa.s.yaml").write_text(yaml.safe_dump({"thresholds": {"pump": {"drop": 5}}}))
    assert skill_settings.retired(str(tmp_path), "s.yaml") == [
        "villa.s.yaml sets thresholds.pump.drop, which is no longer used: the night check decides it"]


def test_the_investigations_retired_running_settings_are_named(tmp_path):
    # /investigate's own "running" settings retired (2026-10-19): a villa file still setting them is told in its answer
    import shutil
    shutil.copy(os.path.join(STARTER_SKILLS, "investigate", "settings.yaml"), tmp_path / "settings.yaml")
    (tmp_path / "villa.settings.yaml").write_text(yaml.safe_dump({"behaviour": {"running_min": 5, "high_quantile": 0.99,
                                                                                "running_fraction": 0.2, "flat_spread": 0.4}}))
    told = skill_settings.retired(str(tmp_path), "settings.yaml")
    assert sorted(t.split(" sets ")[1].split(",")[0] for t in told) == [
        "behaviour.high_quantile", "behaviour.running_fraction", "behaviour.running_min"]
    src = open(os.path.join(STARTER_SKILLS, "investigate", "scripts", "investigate.py"), encoding="utf-8").read()
    assert 'skill_settings.retired(SKILL, "settings.yaml")' in src


def test_every_skill_runs_by_the_same_share_of_its_peak():
    # owner, 2026-10-19: "running" is the villa's one rule (vesta_shared.daily.running_threshold); its share is written
    # in each skill that asks it, so the files are held equal — the villa helper vesta_on_threshold_fraction changes all
    files = {"preventive-maintenance": "settings.yaml", "roi-energy": "settings.yaml", "reports": "reports.yaml",
             "investigate": "settings.yaml"}
    got = {s: yaml.safe_load(open(os.path.join(STARTER_SKILLS, s, f)))["behaviour"]["on_threshold_fraction"]
           for s, f in files.items()}
    assert len(set(got.values())) == 1, got
    for s, f in files.items():
        assert "vesta_on_threshold_fraction" in open(os.path.join(STARTER_SKILLS, s, f)).read(), s   # how to change it


def test_the_proposals_thresholds_are_the_skills():
    import sys
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "roi-energy", "scripts"))
    import proposals
    period = {"unmetered_pct": 55, "unmetered_kwh": 100, "currency": ""}
    th = dict(proposals.thresholds())
    assert any(p["kind"] == "measurement" for p in proposals.build(period, None, [], th))
    th["unmetered_min_pct"] = 60
    assert not proposals.build(period, None, [], th)


def test_a_close_in_the_cockpit_holds_as_long_for_a_night_fault_as_for_an_alert():
    """Owner, architecture review 2026-10-19: one rule with the alert desk's — a person's close of a fault still there
    reopens after the same minutes whichever skill found it. Tied by a comment only until the review of 2026-10-22."""
    def read(skill, name):
        with open(os.path.join(STARTER_SKILLS, skill, name), encoding="utf-8") as f:
            return yaml.safe_load(f)
    desk = read("alert-desk", "rules.yaml")
    night = read("preventive-maintenance", "settings.yaml")
    # ⚠️ DEFINED ONCE (architecture review round 11, card 1): the night check reads the desk's own setting, no copy
    assert "minutes" not in night["still_there_after_close"]
    import sys
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import nightly
    assert nightly.still_there_minutes(night) == float(desk["behaviour"]["clear_minutes"])
