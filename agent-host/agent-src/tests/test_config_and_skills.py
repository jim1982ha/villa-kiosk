"""Settings from the environment contract, and skills as files (owner, 2026-09-30:
"edit, update, delete, add skills without touching the codebase")."""
from __future__ import annotations

import os
import time

import pytest
import yaml

from helpers import changed_since_commit, copy_skill, settings
from vesta_agent.config import STARTER_DIR
from vesta_agent.skills import Skills, ToolError, run_command, validate_script_args


# ---------------------------------------------------------------------- settings
def test_settings_come_from_the_environment_contract_only(tmp_path):
    s = settings(str(tmp_path), VESTA_TELEGRAM_ENABLED="false", VESTA_TELEGRAM_BOT_TOKEN="42:TG-SECRET")
    assert s.ha_mcp_url == "http://127.0.0.1:9/mcp"
    assert s.timezone == "UTC"
    # the token is not even held while Telegram is off
    assert s.telegram_enabled is False and s.telegram_bot_token == ""
    s = settings(str(tmp_path), VESTA_TELEGRAM_ENABLED="true", VESTA_TELEGRAM_BOT_TOKEN="42:TG-SECRET")
    assert s.telegram_enabled and s.telegram_bot_token == "42:TG-SECRET"


def test_no_regional_time_zone_default(tmp_path):
    s = settings(str(tmp_path), TZ=None)
    os.environ.pop("TZ", None)
    assert s.timezone in ("UTC", os.environ.get("TZ", "UTC"))


def test_only_the_key_and_the_mcp_address_block_start(tmp_path):
    s = settings(str(tmp_path), ANTHROPIC_API_KEY="", VESTA_KIOSK_URL="", VESTA_HA_TOKEN="")
    blocking = [p for p, b in s.problems() if b]
    assert len(blocking) == 1 and "ANTHROPIC_API_KEY" in blocking[0]


def test_policy_and_prompt_seeded_once_and_never_merged(tmp_path):
    s = settings(str(tmp_path))
    pol = yaml.safe_load(open(s.policy_path))
    assert pol["people"] == [] and "chats" not in pol and pol["owner_only_entities"] == []
    assert "VESTA Agent" in s.instructions()
    # a person's file is kept exactly, even when it lacks everything the example has
    with open(s.policy_path, "w") as f:
        f.write("people: []\n")
    settings(str(tmp_path))
    assert open(s.policy_path).read() == "people: []\n"


def test_behaviour_settings_reload_live_and_bad_values_fall_back(tmp_path):
    s = settings(str(tmp_path))
    assert (s.profile, s.reply_limit_usd, s.web_search) == ("auto", 1.0, True)
    time.sleep(0.01)
    with open(s.policy_path, "w") as f:
        yaml.safe_dump({"settings": {"profile": "economy", "reply_limit_usd": 0.5, "web_search": False,
                                     "conversation_reset": "never"}}, f)
    os.utime(s.policy_path, (time.time() + 5, time.time() + 5))
    assert (s.profile, s.model, s.reply_limit_usd, s.web_search, s.conversation_reset) == \
        ("economy", "haiku", 0.5, False, "never")
    with open(s.policy_path, "w") as f:
        yaml.safe_dump({"settings": {"profile": "turbo", "reply_limit_usd": 0.001, "web_search": "yes"}}, f)
    os.utime(s.policy_path, (time.time() + 10, time.time() + 10))
    assert (s.profile, s.reply_limit_usd, s.web_search) == ("auto", 1.0, True)


# ---------------------------------------------------------------------- skills as files
def test_the_starter_skills_all_load():
    names = sorted(Skills(os.path.join(STARTER_DIR, "skills")).all())
    assert names == ["alert-desk", "investigate", "preventive-maintenance", "proposals", "reports", "roi-energy",
                     "villa-concierge"]


def test_seeded_once_and_a_deleted_skill_stays_deleted(tmp_path):
    sk = Skills(str(tmp_path / "skills"), os.path.join(STARTER_DIR, "skills"))
    assert len(sk.seed()) == 7
    import shutil
    shutil.rmtree(tmp_path / "skills" / "roi-energy")
    assert sk.seed() == []                      # the record, not the folders, says it was done
    assert "roi-energy" not in sk.all()


def test_a_new_starter_skill_reaches_a_villa_installed_before_it_and_a_deleted_one_stays_deleted(tmp_path):
    # 2026-10-11: the marker said "copied once", so investigate would have been taken for a skill the owner deleted
    import shutil
    from vesta_agent.skills import OFFERED, OFFERED_BEFORE_THE_RECORD, SEEDED
    skills = tmp_path / "skills"
    skills.mkdir()
    for name in OFFERED_BEFORE_THE_RECORD:                                  # a villa installed before the record...
        if name != "roi-energy":                                           # ...whose owner deleted one
            shutil.copytree(os.path.join(STARTER_DIR, "skills", name), skills / name)
    (skills / SEEDED).write_text("The starter skills were copied here once.\n")
    sk = Skills(str(skills), os.path.join(STARTER_DIR, "skills"))
    assert sk.seed() == ["investigate", "proposals"]                        # both added after that villa was made
    assert "investigate" in sk.all() and "roi-energy" not in sk.all()
    assert (skills / OFFERED).exists() and sk.seed() == []
    shutil.rmtree(skills / "investigate")                                  # deleted by the owner in turn
    assert sk.seed() == [] and "investigate" not in sk.all()


def test_an_instruction_sentence_a_release_rewrote_reaches_the_villa_file_only_where_it_still_stands(tmp_path):
    from vesta_agent.config import INSTRUCTION_REWRITES, seed_config
    s = settings(str(tmp_path))
    starter = open(os.path.join(STARTER_DIR, "config", "instructions.md"), encoding="utf-8").read()
    for old, now in INSTRUCTION_REWRITES:
        assert now in starter                                              # the starter says it the new way
    # an install from before: every rewritten sentence as it was, once each — and a second start changes nothing
    # (the new rule 4 BEGINS with the old one: replaced blindly, it grew a sentence at every start)
    before = starter
    for old, now in INSTRUCTION_REWRITES:
        before = before.replace(now, old)
    with open(s.instructions_path, "w", encoding="utf-8") as f:
        f.write(before)
    assert seed_config(s) == ["instructions.md (reworded)"] and open(s.instructions_path).read() == starter
    assert seed_config(s) == [] and open(s.instructions_path).read() == starter
    old, now = INSTRUCTION_REWRITES[0]
    with open(s.instructions_path, "w", encoding="utf-8") as f:
        f.write(f"My own rule.\n{old} No emoji.\n")
    assert seed_config(s) == ["instructions.md (reworded)"]
    assert open(s.instructions_path).read() == f"My own rule.\n{now} No emoji.\n"
    assert seed_config(s) == []                                            # once
    with open(s.instructions_path, "w", encoding="utf-8") as f:
        f.write("6. One question at most per message. Very short. My language.\n")
    seed_config(s)
    assert open(s.instructions_path).read() == "6. One question at most per message. Very short. My language.\n"


def test_every_starter_skill_version_is_recorded_as_shipped():
    # without it, the NEXT release would take this version for an edited one and never update it.
    # ⚠️ GREEN WHILE THE CHANGE IS STILL BEING MADE (retro, 2026-10-20): `ship` records the skills as it commits them, so
    # this test failed on EVERY run between a skill's edit and its release — a suite red by design, read past every
    # time. A skill not yet committed is ship's to record; once committed (CI, every later run) it must be recorded.
    import json
    from vesta_agent.skills import SHIPPED, fingerprint
    shipped = json.load(open(os.path.join(STARTER_DIR, SHIPPED)))
    for name in os.listdir(os.path.join(STARTER_DIR, "skills")):
        fp = fingerprint(os.path.join(STARTER_DIR, "skills", name))
        if fp not in shipped.get(name, []) and changed_since_commit(os.path.join(STARTER_DIR, "skills", name)):
            continue
        assert fp in shipped.get(name, []), (
            f"starter skill {name} changed: run python3 -c \"from vesta_agent.skills import record_shipped; "
            f"record_shipped('starter/skills')\" in agent-src")


def _starters(tmp_path, versions: dict[str, str]):
    """A starter folder whose skills say `versions[name]`, with a shipped list naming v1 and v2."""
    import json
    from vesta_agent.skills import SHIPPED, fingerprint
    root = tmp_path / "starter"
    shipped = {}
    for v in ("v1", "v2"):
        d = _minimal_skill(tmp_path / "hist" / v, "pool-care")
        (d / "scripts" / "check.py").write_text(f"print('{v}')\n")
        shipped.setdefault("pool-care", []).append(fingerprint(str(d)))
    for name, v in versions.items():
        d = _minimal_skill(root / "skills", name)
        (d / "scripts" / "check.py").write_text(f"print('{v}')\n")
    (root / SHIPPED).write_text(json.dumps(shipped))
    return str(root / "skills")


def test_an_untouched_starter_skill_follows_the_release(tmp_path):
    old = _starters(tmp_path / "old", {"pool-care": "v1"})
    new = _starters(tmp_path / "new", {"pool-care": "v2"})
    skills = tmp_path / "skills"
    Skills(str(skills), old).seed()
    (skills / "pool-care" / "scripts" / "__pycache__").mkdir()          # Python's cache is not an edit
    (skills / "pool-care" / "scripts" / "__pycache__" / "check.pyc").write_bytes(b"x")
    assert Skills(str(skills), new).update_starters() == (["pool-care"], [])
    assert (skills / "pool-care" / "scripts" / "check.py").read_text() == "print('v2')\n"
    assert Skills(str(skills), new).update_starters() == ([], [])      # once
    assert not (skills / ".starter").exists()


def test_an_edited_starter_skill_is_kept_and_the_new_one_left_beside_it(tmp_path):
    old = _starters(tmp_path / "old", {"pool-care": "v1"})
    new = _starters(tmp_path / "new", {"pool-care": "v2"})
    skills = tmp_path / "skills"
    Skills(str(skills), old).seed()
    (skills / "pool-care" / "SKILL.md").write_text("# pool-care\nMy own words.\n")
    sk = Skills(str(skills), new)
    assert sk.update_starters() == ([], ["pool-care"])
    assert "My own words" in (skills / "pool-care" / "SKILL.md").read_text()
    assert (skills / ".starter" / "pool-care" / "scripts" / "check.py").read_text() == "print('v2')\n"
    assert sorted(sk.all()) == ["pool-care"]                            # the reference copy is not a skill


def test_a_deleted_starter_skill_stays_deleted_and_a_cut_replacement_comes_back(tmp_path):
    old = _starters(tmp_path / "old", {"pool-care": "v1"})
    new = _starters(tmp_path / "new", {"pool-care": "v2"})
    skills = tmp_path / "skills"
    Skills(str(skills), old).seed()
    os.rename(skills / "pool-care", str(skills / "pool-care") + ".old")  # cut between the two renames
    assert Skills(str(skills), new).update_starters() == (["pool-care"], [])
    assert (skills / "pool-care" / "scripts" / "check.py").read_text() == "print('v2')\n"
    import shutil
    shutil.rmtree(skills / "pool-care")
    assert Skills(str(skills), new).update_starters() == ([], [])
    assert not (skills / "pool-care").exists()


def _minimal_skill(root, name="pool-care", **yaml_extra):
    d = root / name
    (d / "scripts").mkdir(parents=True)
    (d / "SKILL.md").write_text(f"# {name}\n")
    (d / "scripts" / "check.py").write_text("import json; print(json.dumps({'send': [{'to': 'fm', 'text': 'hello'}]}))\n")
    y = {"description": "A test skill", "scripts": {"check.py": {"flags": {"--what": "text"}}}}
    y.update(yaml_extra)
    (d / "skill.yaml").write_text(yaml.safe_dump(y))
    return d


def test_add_edit_delete_a_skill_without_restart(tmp_path):
    sk = Skills(str(tmp_path))
    assert sk.all() == {}
    d = _minimal_skill(tmp_path)
    assert list(sk.all()) == ["pool-care"]                      # added: seen at the next call
    (d / "skill.yaml").write_text(yaml.safe_dump({"description": "Edited", "scripts": {"check.py": {}},
                                                  "schedule": [{"when": "06:30", "run": "check.py"}]}))
    assert sk.get("pool-care").description == "Edited"          # edited: seen at the next call
    assert sk.get("pool-care").schedule[0]["when"] == "06:30"
    import shutil
    shutil.rmtree(d)
    assert sk.all() == {}                                       # deleted: gone with its schedule


@pytest.mark.parametrize("bad", [
    {"scripts": {"missing.py": {}}},                                   # no such script
    {"scripts": {"check.py": {"flags": {"--x": "anything"}}}},         # unknown flag kind
    {"scripts": {"check.py": {"inject": ["token"]}}},                  # not an injectable
    {"schedule": [{"when": "25:00", "run": "check.py"}]},              # not a time
    {"schedule": [{"when": "07:00"}]},                                 # neither prompt nor run
    {"on_event": {"telegram_text": "check.py"}},                       # not a hook event
    {"every_5_min": "../../../bin/sh"},                                # outside scripts/
])
def test_a_broken_skill_yaml_switches_off_that_skill_alone(tmp_path, bad, caplog):
    _minimal_skill(tmp_path, "good")
    d = _minimal_skill(tmp_path, "broken")
    (d / "skill.yaml").write_text(yaml.safe_dump(bad))
    sk = Skills(str(tmp_path))
    assert list(sk.all()) == ["good"]
    assert "broken" in sk.problems()
    sk.all()
    assert sum("Skill broken" in r.message for r in caplog.records) == 1     # said once, not every tick


def test_the_model_runs_only_declared_scripts_with_declared_flags(tmp_path):
    sk = Skills(str(tmp_path))
    _minimal_skill(tmp_path)
    skill = sk.get("pool-care")
    out = str(tmp_path / "out")
    assert validate_script_args(skill, "pool-care", "check.py", ["--what", "pump"], out) == ["--what", "pump"]
    for script, args in (("other.py", []), ("check.py", ["--store", "x"]), ("check.py", ["--what", "-rf"]),
                         ("check.py", ["--fixture-dir", "/"])):
        with pytest.raises(ToolError):
            validate_script_args(skill, "pool-care", script, args, out)
    with pytest.raises(ToolError):
        validate_script_args(None, "nope", "check.py", [], out)


def test_a_code_job_runs_with_its_placeholders_filled(tmp_path):
    s = settings(str(tmp_path))
    d = _minimal_skill(tmp_path / "skills")
    (d / "scripts" / "echo.py").write_text("import json, sys; print(json.dumps({'argv': sys.argv[1:]}))\n")
    sk = Skills(s.skills_dir).get("pool-care")
    code, out, _ = run_command(s, sk, "echo.py --incident {incident} --text {text}", {"incident": 7, "text": "Need help"})
    assert code == 0
    import json
    assert json.loads(out)["argv"][:4] == ["--incident", "7", "--text", "Need help"]


def test_the_villas_own_file_in_a_starter_skill_is_kept_and_does_not_stop_its_updates(tmp_path):
    old = _starters(tmp_path / "old", {"pool-care": "v1"})
    new = _starters(tmp_path / "new", {"pool-care": "v2"})
    skills = tmp_path / "skills"
    Skills(str(skills), old).seed()
    (skills / "pool-care" / "villa.extra.yaml").write_text("mine: true\n")
    assert Skills(str(skills), new).update_starters() == (["pool-care"], [])       # not an edit: updated
    assert (skills / "pool-care" / "scripts" / "check.py").read_text() == "print('v2')\n"
    assert (skills / "pool-care" / "villa.extra.yaml").read_text() == "mine: true\n"  # and kept


def test_a_skills_instructions_never_name_a_command_the_skill_does_not_have():
    # architecture review, 2026-10-07: villa-concierge's SKILL.md told the AI to run propose / execute / readback,
    # which the skill did not offer and could not run (read-only), while the real path is ha_call_service
    import re
    from helpers import STARTER_SKILLS
    from vesta_agent.skills import Skills
    for name, sk in Skills(STARTER_SKILLS).all().items():
        md = open(sk.skill_md, encoding="utf-8").read()
        run = " ".join([j.get("run") or "" for j in sk.schedule] + [sk.every_5_min or "", sk.on_reply or ""]
                       + list(sk.on_event.values()) + [st["run"] for j in sk.schedule for st in j.get("on_limit") or []])
        for script, cmd in re.findall(r"`([a-z_]+\.py) ([a-z][a-z_-]+)\b", md):        # a command, written as code
            spec = sk.scripts.get(script)
            if spec is None or spec.commands is None:
                continue
            assert cmd in spec.commands or f"{script} {cmd}" in run, f"{name}/SKILL.md names {script} {cmd}"


def test_a_jobs_steps_without_the_ai_name_scripts_that_exist():
    # owner, 2026-10-07: a report is still made when the AI cannot run. Another skill's script in those steps is
    # only checked when it runs (skills load one by one): a misspelt one would surface the day the credit runs out.
    import os
    import pytest
    from helpers import STARTER_SKILLS
    from vesta_agent.skills import SkillError, Skills, _without_ai
    skills = Skills(STARTER_SKILLS).all()
    steps = [st for sk in skills.values() for j in sk.schedule for st in j.get("without_ai") or []]
    assert {st["skill"] for st in steps} == {None, "roi-energy"} and len(steps) >= 10
    for st in steps:
        if st["skill"]:
            assert os.path.isfile(os.path.join(skills[st["skill"]].path, "scripts", st["run"].split()[0])), st
    with pytest.raises(SkillError, match="not a .py file in scripts"):
        _without_ai(skills["reports"].path, ["nowhere.py --x"], "w")
    with pytest.raises(SkillError, match="a command, or"):
        _without_ai(skills["reports"].path, [{"run": "facts.py", "when": "now"}], "w")


def test_take_the_release_stopped_half_way_never_leaves_the_skill_only_in_the_trash(tmp_path, monkeypatch):
    # architecture review 16: "Take the release version" moved the edited skill to the trash, then renamed the new copy
    # in — stopped between the two, the skill was only in the trash and the next start took it for deleted by the owner
    import os as _os
    from vesta_agent.skills import EDITED, TRASH
    old = _starters(tmp_path / "old", {"pool-care": "v1"})
    new = _starters(tmp_path / "new", {"pool-care": "v2"})
    skills = tmp_path / "skills"
    Skills(str(skills), old).seed()
    (skills / "pool-care" / "scripts" / "check.py").write_text("print('mine')\n")      # edited here
    s = Skills(str(skills), new)
    assert s.verdict("pool-care") == EDITED and s.release_state("pool-care")["state"] == "edited"
    real, calls = _os.rename, []

    def stops(a, b):
        calls.append(a)
        if len(calls) == 2:
            raise OSError("the agent stopped here")
        return real(a, b)
    monkeypatch.setattr(_os, "rename", stops)
    try:
        s.take_release("pool-care")
    except OSError:
        pass
    monkeypatch.setattr(_os, "rename", real)
    Skills(str(skills), new).recover("pool-care")                                       # the next start
    assert (skills / "pool-care" / "scripts" / "check.py").read_text() == "print('mine')\n"
    assert not (skills / "pool-care.new").exists() and not (skills / "pool-care.old").exists()
    # stopped after both renames, before the trash: at the next start the edited one goes to the trash, not lost
    Skills(str(skills), new)._replace("pool-care")
    Skills(str(skills), new).recover("pool-care")
    assert not (skills / "pool-care.old").exists() and (skills / TRASH).exists()
    (skills / "pool-care" / "scripts" / "check.py").write_text("print('mine')\n")
    # done whole, the edited one goes to the trash, never erased
    trash = Skills(str(skills), new).take_release("pool-care")
    assert (skills / "pool-care" / "scripts" / "check.py").read_text() == "print('v2')\n"
    assert open(_os.path.join(trash, "scripts", "check.py")).read() == "print('mine')\n" and TRASH in trash


def test_the_page_and_the_start_judge_a_skill_alike_and_the_page_moves_nothing(tmp_path):
    from vesta_agent.skills import GONE, SAME, UPDATE
    old = _starters(tmp_path / "old", {"pool-care": "v1"})
    new = _starters(tmp_path / "new", {"pool-care": "v2"})
    skills = tmp_path / "skills"
    Skills(str(skills), old).seed()
    s = Skills(str(skills), new)
    assert s.verdict("pool-care") == UPDATE and s.release_state("pool-care") == {"state": "follows", "villa": [],
                                                                               "update_at_start": True}
    s.update_starters()
    assert s.verdict("pool-care") == SAME and s.release_state("pool-care")["state"] == "follows"
    (skills / "pool-care").rename(skills / "pool-care.old")                             # mid-replacement, seen by the page
    assert s.verdict("pool-care") == GONE and (skills / "pool-care.old").exists()        # read only: nothing moved


def test_the_agent_keeps_its_last_good_rules_when_the_file_cannot_be_read(tmp_path, monkeypatch):
    # architecture review 17: an error nothing foresaw stopped every message, alert and press at each reading
    import os as _os
    from helpers import settings as _settings
    from vesta_agent import config as config_module
    s = _settings(str(tmp_path))
    with open(s.policy_path, "w") as f:
        f.write("act_enabled: true\n")
    good = s.policy()
    assert good.act_enabled is True

    def broken(path):
        raise RuntimeError("a value nothing foresaw")
    monkeypatch.setattr(config_module.Policy, "load", staticmethod(broken))
    _os.utime(s.policy_path, (1, _os.path.getmtime(s.policy_path) + 5))
    assert s.policy() is good                                                 # the last good rules, never a stop


def test_the_investigate_skill_answers_to_its_one_command():
    # owner, 2026-10-11: "remove /investigation key word, and only allow /investigate"
    sk = Skills(os.path.join(STARTER_DIR, "skills"))
    assert sk.commands() == {"/investigate": "investigate", "/proposal": "proposals"}   # owner, 2026-10-13: /proposal
    assert sk.get("investigate").command == "investigate"


def test_a_skills_brain_is_one_the_rules_know(tmp_path):
    from vesta_agent.skills import SkillError, parse_skill
    d = tmp_path / "s"
    (d / "scripts").mkdir(parents=True)
    (d / "SKILL.md").write_text("x")
    for raw, ok in (("command: look\nbrain: performance\nlimit_usd: 2\n", True), ("command: look\nbrain: genius\n", False),
                    ("command: look\nlimit_usd: 500\n", False)):
        (d / "skill.yaml").write_text("description: x\n" + raw)
        if ok:
            sk = parse_skill("s", str(d))
            assert (sk.brain, sk.limit_usd) == ("performance", 2.0)
        else:
            with pytest.raises(SkillError):
                parse_skill("s", str(d))


def test_a_skills_alert_buttons_are_checked_as_it_declares_them(tmp_path):
    # architecture review, 2026-10-13: the buttons are the skill's — an option travels in Telegram's 64 bytes of button
    # data, a mark is an icon message_format knows
    from vesta_agent.skills import SkillError, parse_skill
    d = tmp_path / "s"
    (d / "scripts").mkdir(parents=True)
    (d / "SKILL.md").write_text("x")
    good = "buttons:\n  - {option: done, label: Fait}\n  - {option: need_help, label: Besoin d'aide, mark: help}\n"
    (d / "skill.yaml").write_text("description: x\n" + good)
    assert [(b["option"], b["label"], b["mark"]) for b in parse_skill("s", str(d)).buttons] == \
        [("done", "Fait", None), ("need_help", "Besoin d'aide", "help")]
    for bad in ("buttons: []\n", "buttons:\n  - {option: Done!, label: x}\n", "buttons:\n  - {option: done}\n",
                "buttons:\n  - {option: done, label: x, mark: party}\n",
                "buttons:\n  - {option: done, label: x}\n  - {option: done, label: y}\n"):
        (d / "skill.yaml").write_text("description: x\n" + bad)
        with pytest.raises(SkillError):
            parse_skill("s", str(d))
