"""Architecture review 7: a skill's settings file, the villa's on top (vesta_shared.skill_settings); each skill's
thresholds in its own file, none in the shared library or a script."""
from __future__ import annotations


import yaml

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


