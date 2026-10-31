"""What the VESTA Kiosk tells the agent in its heartbeat answer (vesta_shared.kiosk_told): one table for every villa
setting it owns, kept beside the knowledge pack and read by every check (architecture review round 10, card 2: three
copies of the same told / save / read, and "on means empty" written three times)."""
from __future__ import annotations

import json
import os

import yaml

from helpers import STARTER_SKILLS
from vesta_agent.app import Vesta
from vesta_shared import asleep, kiosk_told, maintenance, occupancy


class _App:
    kiosk_answered = Vesta.kiosk_answered

    def __init__(self, pack):
        self.s = type("S", (), {"pack_path": pack})()


def _readers(pack):
    """What every reader of the three settings says now."""
    return asleep.listed(pack), maintenance.on(pack), occupancy.sensor(pack)


def test_one_answer_with_each_key_absent_empty_or_set_is_read_alike_by_every_reader(tmp_path):
    pack = str(tmp_path / "pack.json")
    app = _App(pack)
    nothing = (frozenset(), False, None)
    app.kiosk_answered({})                                                       # never told: each one's unset
    assert _readers(pack) == nothing
    told = {"unavailableByDesign": ["Binary_Sensor.Door", 3], "maintenance": True,
            "villaEmptySensor": "Binary_Sensor.Example_Empty"}
    app.kiosk_answered(told)
    kept = ({"binary_sensor.door"}, True, "binary_sensor.example_empty")
    assert _readers(pack) == kept
    # an older Kiosk (the keys absent), or one that cannot vouch for them (no value): what was kept stays
    for answer in ({"every": 60}, dict.fromkeys(told), {"maintenance": "yes", "villaEmptySensor": 3}):
        app.kiosk_answered(answer)
        assert _readers(pack) == kept, answer
    assert kiosk_told.keep(pack, told) == []                                     # unchanged: not written, not logged
    # emptied in the Kiosk: every reader says none
    assert len(kiosk_told.keep(pack, {"unavailableByDesign": [], "maintenance": False, "villaEmptySensor": ""})) == 3
    assert _readers(pack) == nothing


def test_the_files_kept_before_the_table_are_read_as_they_are(tmp_path):
    # no migration: the names and shapes the three copies wrote are the table's own
    pack = str(tmp_path / "pack.json")
    for name, body in (("unavailable_by_design.json", {"ids": ["binary_sensor.door"]}),
                       ("maintenance_mode.json", {"on": True}),
                       ("villa_empty_sensor.json", {"entity_id": "binary_sensor.example_empty"})):
        with open(os.path.join(tmp_path, name), "w", encoding="utf-8") as f:
            json.dump(body, f)
    assert _readers(pack) == ({"binary_sensor.door"}, True, "binary_sensor.example_empty")


def test_on_means_empty_is_written_once():
    # the sensor's readings (occupancy.SAYS) for its one reader of a reading and of a day...
    assert [occupancy.state_of(s) for s in ("on", "off", "unavailable")] == [occupancy.EMPTY, occupancy.OCCUPIED,
                                                                            occupancy.UNKNOWN]
    # ...and the reports' "electricity while empty" names no states of its own for the Kiosk's sensor
    with open(os.path.join(STARTER_SKILLS, "reports", "reports.yaml"), encoding="utf-8") as f:
        book = yaml.safe_load(f)["playbook"]
    whens = [e["when"] for entries in book.values() for e in entries if (e.get("when") or {}).get("kind") == "use_while_empty"]
    assert whens and all("empty" not in w for w in whens if not w.get("mode_entity")), whens
