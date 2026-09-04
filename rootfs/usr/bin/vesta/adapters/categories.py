"""Which of the kiosk's six categories a device belongs to — the add-on's twin
of `src/config/EntityCategories.ts`, pinned rather than trusted.

⚠️ A SECOND IMPLEMENTATION OF A SHARED PREDICATE, WHICH IS NORMALLY THIS
PROJECT'S CARDINAL SIN, AND IT IS ALLOWED FOR THE REASON `devices.py` IS. The
alternative — deriving categories in the browser and publishing them — makes a
triage pass depend on somebody having opened the tablet, so it goes BLIND
rather than sparse on the villa nobody visits and on a fresh install. So the
rule exists twice, and `tests/py/test_consistency_parity.py` runs the SHIPPED
TypeScript over the same fixtures and asserts the two answers are EQUAL, id by
id, plus source-level pins on every table below against its TypeScript twin.
Add a rule to `EntityCategories.ts` and the pin goes red here.

⚠️ WHY THE AGENT NEEDS IT (2026-09-04). The villa document's ranked excerpt is
cut to a limit, and on the reference villa the energy sensors alone fill it
every pass — so nothing about access control, lighting or comfort ever reached
the model, however unusual. `salience.rank` now reserves the excerpt across
categories within each lens, and this is the one place it can ask which
category an entity is in. "category" elsewhere in this package means the
BLUEPRINT EVENT category (`collect.category_of`: `roi`, `maintenance`); the
two words name different things and this docstring is where that is said.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, Iterable, Mapping, Optional, Tuple

#: The six, in the kiosk's own display order (`CATEGORY_ORDER`).
CATEGORIES: Tuple[str, ...] = ("comfort", "light", "network", "energy",
                                "access_control", "others")

#: `DEFAULT_CATEGORY_BY_TYPE` — a device TYPE's default. Anything absent falls
#: through to `others`.
DEFAULT_CATEGORY_BY_TYPE: Dict[str, str] = {
    "light": "light",
    "camera": "access_control",
    "lock": "access_control",
    "climate": "comfort",
    "cover": "comfort",
    "fan": "comfort",
    "sensor": "energy",
}

#: `LEGACY_DEFAULT_CATEGORY_BY_TYPE` — the PREVIOUS defaults, kept only to
#: recognise a stored category that was auto-assigned rather than chosen.
LEGACY_DEFAULT_CATEGORY_BY_TYPE: Dict[str, str] = {
    "light": "light", "camera": "network", "climate": "comfort",
    "cover": "comfort", "fan": "comfort", "sensor": "energy",
}

COMFORT_SENSOR_DC: frozenset[str] = frozenset({"temperature", "humidity"})
ACCESS_BINARY_DC: frozenset[str] = frozenset({"motion", "presence", "occupancy",
                                              "moving"})
#: `BinarySensorClasses.OPENING_DEVICE_CLASSES` — a physical opening.
OPENING_DEVICE_CLASSES: frozenset[str] = frozenset({"door", "garage_door",
                                                    "window", "opening"})

#: The two inline id hints inside `categoryForEntity`, verbatim.
COMFORT_SENSOR_ID = re.compile(r"(^|[._])(temperature|temp|humidity|humid)([._]|$)")
ACCESS_BINARY_ID = re.compile(r"(^|[._])(motion|presence|occupancy|pir|door|window|gate)([._]|$)")

#: `SWITCH_PURPOSE_HINTS` — what a generic `switch.*` is FOR, from its name.
#: `(pattern, category)`, first match wins, most specific first; the glyph
#: column the kiosk carries beside these is a badge concern and not copied.
#: ⚠️ THE PATTERN STRINGS ARE THE TYPESCRIPT'S, CHARACTER FOR CHARACTER — the
#: parity pin compares them as text, so a regex rewritten "equivalently" here
#: goes red, which is the point.
SWITCH_PURPOSE_HINTS: Tuple[Tuple[str, str], ...] = (
    (r"(?:^|[._])(?:motion|presence|occupan\w*|detect\w*)(?:[._]|$)", "access_control"),
    (r"(?:^|[._])(?:lock|unlock|door|gate)(?:[._]|$)", "access_control"),
    (r"(?:^|[._])(?:pump|filtr\w*|filter|jet|jacuzzi|spa|pool)(?:[._]|$)", "energy"),
    (r"(?:^|[._])(?:heat\w*|boiler\w*|water_?heater|thermo\w*)(?:[._]|$)", "comfort"),
    (r"(?:^|[._])(?:camera|cctv)(?:[._]|$)", "access_control"),
    (r"(?:^|[._])(?:speaker|music|audio|sonos)(?:[._]|$)", "others"),
    (r"(?:^|[._])(?:plug|socket|outlet)(?:[._]|$)", "energy"),
    (r"(?:^|[._])(?:light|lamp|led|spot)(?:[._]|$)", "light"),
    (r"(?:^|[._])(?:fan|vmc|extract\w*|vent\w*)(?:[._]|$)", "comfort"),
)
_HINTS = tuple((re.compile(p, re.IGNORECASE), c) for p, c in SWITCH_PURPOSE_HINTS)


def category_for_entity(entity_id: str, type_: str,
                        device_class: Optional[str] = None) -> str:
    """`categoryForEntity` — the DEFAULT category: device_class rule > entity
    id hint > type default > `others`. (`CATEGORY_EXCEPTIONS` is empty on both
    sides by the no-hardcoding rule and is not twinned.)"""
    dc = str(device_class or "").lower()
    ident = str(entity_id or "").lower()
    if type_ == "sensor":
        if dc in COMFORT_SENSOR_DC or COMFORT_SENSOR_ID.search(ident):
            return "comfort"
        if dc == "enum":
            return "network"
    elif type_ == "binary_sensor":
        if (dc in ACCESS_BINARY_DC or dc in OPENING_DEVICE_CLASSES
                or ACCESS_BINARY_ID.search(ident)):
            return "access_control"
    if type_ in ("switch", "input_boolean"):
        if dc == "outlet":
            return "energy"
        for pattern, category in _HINTS:
            if pattern.search(ident):
                return category
    return DEFAULT_CATEGORY_BY_TYPE.get(type_, "others")


def effective_category(entity_id: str, type_: str,
                       stored: Optional[str] = None,
                       device_class: Optional[str] = None) -> str:
    """`effectiveCategory` — a stored category the owner picked wins, unless
    it merely equals the LEGACY auto-default, in which case the current
    defaults apply (retroactively re-bucketing auto-pinned devices)."""
    legacy = LEGACY_DEFAULT_CATEGORY_BY_TYPE.get(type_, "others")
    if stored and stored != legacy:
        return str(stored)
    return category_for_entity(entity_id, type_, device_class)


def categories_for(entity_ids: Iterable[str], entity_map: Mapping[str, Any],
                   entities: Mapping[str, Any]) -> Dict[str, str]:
    """`{entity_id: category}` for the ids given, from the shared config and
    live state — the inputs `cockpitData.buildCategoryTiles` uses, with the
    domain standing in for `type` when the entity map has no row."""
    out: Dict[str, str] = {}
    for entity_id in entity_ids:
        mapping = entity_map.get(entity_id)
        mapping = mapping if isinstance(mapping, Mapping) else {}
        type_ = str(mapping.get("type") or entity_id.split(".", 1)[0])
        entity = entities.get(entity_id)
        attrs = entity.get("attributes") if isinstance(entity, Mapping) else None
        dc = attrs.get("device_class") if isinstance(attrs, Mapping) else None
        out[entity_id] = effective_category(
            entity_id, type_, mapping.get("category"),
            str(dc) if isinstance(dc, str) else None)
    return out


def categoriser(entity_map: Mapping[str, Any],
                device_class_of: Mapping[str, str]) -> Callable[[str], str]:
    """`category_of(entity_id) -> category` over a config map and a
    `{entity_id: device_class}` table — the callable `salience.rank` takes."""
    def category_of(entity_id: str) -> str:
        mapping = entity_map.get(entity_id)
        mapping = mapping if isinstance(mapping, Mapping) else {}
        type_ = str(mapping.get("type") or str(entity_id).split(".", 1)[0])
        return effective_category(str(entity_id), type_, mapping.get("category"),
                                  device_class_of.get(str(entity_id)))
    return category_of
