"""The same words name the same devices in the concierge and the investigation (architecture review part three, owner
2026-11-20): one answer to "which device does a person mean" (KnowledgePack.meant: the area decides, owner
2026-10-05; accents and case folded). The investigation asked Home Assistant's search with the place as its area
filter, and named other devices for the same words. Made-up pack: every id invented."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

from helpers import STARTER_SKILLS
from vesta_shared.ha_client import HABase
from vesta_shared.knowledge_pack import KnowledgePack

sys.path.insert(0, os.path.join(STARTER_SKILLS, "villa-concierge", "scripts"))
sys.path.insert(0, os.path.join(STARTER_SKILLS, "investigate", "scripts"))
import concierge  # noqa: E402
import investigate  # noqa: E402


def row(eid, name, area):
    return {"entity_id": eid, "name": name, "area": area, "asset": eid.split(".")[1]}


ROWS = [
    # its id says "kitchen", Home Assistant says Living Room: the case that switched on the wrong light
    row("light.kitchen_and_dining_top", "Dining Table Top", "Living Room"),
    row("light.kitchen_and_dining_bottom", "Kitchen Bottom", "Kitchen"),
    row("light.spare", "Kitchen Spot", None),                  # no area: its name says the place
    row("light.terrace", "Éclairage Terrasse", "Patio"),       # an accented name
    row("light.bed_a", "Reading Lamp", "Bedroom 1"),
    row("light.bed_b", "Ceiling", "Bedroom 2"),
]


def pack():
    return KnowledgePack(villa="test", time_zone="UTC", generated_at="", ha_version=None, families={"lighting": ROWS},
                         assets={}, areas=["Bedroom 1", "Bedroom 2", "Kitchen", "Living Room", "Patio"], people=[],
                         channels={}, unknown_area=[], unclassified=[], retention={},
                         area_aliases={"Kitchen": ["Cuisine"]})


class _HA(HABase):
    """The villa's system as the investigation reads it: each entity's registry entry and state; its search finds
    nothing (the pack answers)."""

    def tool(self, name, args):
        if name == "ha_get_entity":
            return {"entity_entries": [{"entity_id": r["entity_id"], "area": r["area"]} for r in ROWS
                                       if r["entity_id"] in args["entity_id"]]}
        return {}

    def states(self, ids=None):
        return {r["entity_id"]: {"state": "off", "attributes": {"friendly_name": r["name"]}} for r in ROWS
                if ids is None or r["entity_id"] in ids}


def both(what, where):
    p = pack()
    said = sorted(r["entity_id"] for r in concierge.find(p, what, where))
    looked = sorted(e["entity_id"] for e in investigate.find(_HA(), what, where, p, datetime.now(timezone.utc))["entities"])
    assert said == looked, (what, where, said, looked)
    return said


def test_the_area_decides_in_both_skills_not_the_id():
    assert both("lights", "kitchen") == ["light.kitchen_and_dining_bottom", "light.spare"]


def test_an_alias_and_an_accent_name_the_same_area_and_device_in_both():
    assert both("lights", "Cuisiné") == both("lights", "KITCHEN")
    assert both("eclairage", None) == ["light.terrace"]


def test_a_word_shared_by_rooms_names_all_of_them_in_both():
    assert both("lights", "bedroom") == ["light.bed_a", "light.bed_b"]
