"""villa-concierge's `find`: which devices a person means (owner, 2026-10-05).

The Home Assistant area decides; a device's name only counts when it has no area,
or when no area answers to the place; an entity id never counts. Driven by value on
a made-up pack — the villa's own data lives in tests/villa/ (gitignored).
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "starter", "skills", "villa-concierge", "scripts"))
import concierge  # noqa: E402
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402


def row(eid, name, area):
    return {"entity_id": eid, "name": name, "area": area, "asset": eid.split(".")[1]}


def pack(**extra):
    return KnowledgePack(
        villa="test", time_zone="UTC", generated_at="", ha_version=None,
        families={"lighting": [
            # its id says "kitchen", Home Assistant says Living Room: the case that switched on the wrong light
            row("light.kitchen_and_dining_top", "Dining Table Top", "Living Room"),
            row("light.kitchen_and_dining_bottom", "Kitchen Bottom", "Kitchen"),
            row("light.spare", "Kitchen Spot", None),          # no area: its name is all there is
            row("light.sofa", "Sofa Lamp", "Living Room"),
            row("light.hatch", "Kitchen Hatch", "Living Room"),  # its NAME says kitchen, its area does not
            row("light.pool_led", "Pool LED", "Garden"),
            row("light.garage_strip", "Strip", "Garden"),           # "garage" is only in its id
            row("light.bed_a", "Reading Lamp", "Bedroom 1"),
            row("light.bed_b", "Ceiling", "Bedroom 2"),
        ]},
        assets={}, areas=["Bedroom 1", "Bedroom 2", "Garden", "Kitchen", "Living Room", "Patio", "Patio Upper"], people=[], channels={},
        unknown_area=[], unclassified=[], retention={}, **extra)


def ids(rows):
    return sorted(r["entity_id"] for r in rows)


def test_the_area_decides_not_the_id():
    assert ids(concierge.find(pack(), "lights", "kitchen")) == ["light.kitchen_and_dining_bottom", "light.spare"]


def test_a_device_without_an_area_counts_by_its_name_only():
    got = ids(concierge.find(pack(), "lights", "Kitchen"))
    assert "light.spare" in got and "light.sofa" not in got


def test_an_area_alias_and_accents_name_the_same_area():
    p = pack(area_aliases={"Kitchen": ["Cuisine"]})
    assert ids(concierge.find(p, "lights", "cuisine")) == ids(concierge.find(p, "lights", "kitchen"))
    assert concierge.place(p, "Cuisiné") == ["Kitchen"]


def test_no_area_answers_then_names_decide():
    assert concierge.place(pack(), "pool") == []
    assert ids(concierge.find(pack(), "lights", "pool")) == ["light.pool_led"]


def test_an_entity_id_is_never_matched():
    assert concierge.find(pack(), "garage", None) == []
    assert ids(concierge.find(pack(), "lights", "living room")) == ["light.hatch", "light.kitchen_and_dining_top", "light.sofa"]


def test_an_old_pack_without_aliases_still_loads():
    p = pack()
    assert p.area_aliases == {} and concierge.place(p, "living room") == ["Living Room"]


def test_a_word_shared_by_rooms_names_all_of_them_an_exact_name_one():
    assert concierge.place(pack(), "bedroom") == ["Bedroom 1", "Bedroom 2"]
    assert ids(concierge.find(pack(), "lights", "bedroom")) == ["light.bed_a", "light.bed_b"]
    assert concierge.place(pack(), "bedroom 2") == ["Bedroom 2"]
    assert concierge.place(pack(), "patio") == ["Patio"]      # an area named exactly so wins over "Patio Upper"
