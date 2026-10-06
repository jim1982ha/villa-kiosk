"""skills.Script: a skill's script, its commands and this villa's choice of what the AI may run — one reading."""
from __future__ import annotations

import os

import yaml

from helpers import copy_skill
from vesta_agent.skills import VILLA_CHOICES, Skills, switch_command


def _concierge(tmp_path):
    copy_skill("villa-concierge", str(tmp_path))
    return lambda: Skills(str(tmp_path)).get("villa-concierge")


def test_switching_commands_off_and_on_is_written_and_read_back_the_same(tmp_path):
    load = _concierge(tmp_path)
    folder = load().path
    with open(os.path.join(folder, VILLA_CHOICES), "w") as f:
        yaml.safe_dump({"stt": "stt.example"}, f)                          # another choice of the villa: kept

    def switch(command, on):
        text = switch_command(folder, load().scripts["concierge.py"], command, on)
        with open(os.path.join(folder, VILLA_CHOICES), "w") as f:
            f.write(text or "")
        return load().scripts["concierge.py"]

    sc = switch("find", False)
    assert not sc.runnable("find") and sc.runnable("status") and "find" not in sc.runnable_commands()
    sc = switch(None, False)                                               # the whole script
    assert sc.off_all and not sc.runnable("status") and sc.view()["whole_off"]
    sc = switch("status", True)                                            # one back on: the others stay off
    assert not sc.off_all and sc.runnable("status") and not sc.runnable("find")
    for c in sorted(sc.commands):
        sc = switch(c, True)
    assert not sc.any_off
    assert yaml.safe_load(open(os.path.join(folder, VILLA_CHOICES))) == {"stt": "stt.example"}
