"""CLAUDE.md's FIRST hard rule, which had no automated guard at all.

⚠️ THE SWEEP ENFORCED THE SECOND HARD RULE AND NOT THE FIRST, and /dry-audit
found that on 2026-08-21 only because /phone-parity's item 14 had stumbled into
it the run before. "No internet dependency" is checked twice — by the sweep's
`https?://` grep over `src/`, and by
`test_narration_provider.test_no_provider_hostname_is_reachable_from_the_browser_bundle`.
"Nothing villa-specific ships" was checked by NOTHING. The sweep's only
`entity_id` line is about REGEX ANCHORING (`door` matching inside `outdoor`),
which is a different concern that happens to share a word.

That gap is why `sensor.<a real first name>_bedroom_window` sat at four tracked
sites for weeks — in comments arguing that entity ids must be hashed BECAUSE
they carry room and person names — and why v2.581.1 then fixed those four sites
by hand and pinned nothing, leaving the fifth unguarded. Three consecutive
releases applied a fix at the sites they had found instead of at everything the
rule applies to, which is this repo's oldest recurring mistake
(`feedback_audit-applicable-set`).

⚠️ THIS TEST FREEZES A SET; IT DOES NOT JUDGE REALNESS. No regex can separate
"this villa's camera" from "a teaching example" — `camera.hallway_cam` and
`camera.front_door` are the same shape. So every id currently in tracked source
is listed below with the reason it is there, and ANY NEW ONE FAILS until someone
classifies it. Dumb on purpose, and it cannot go blind: the failure message
names the id and the file, and adding a line is a deliberate act with a reason
attached. The same discipline as `SHARED_CONFIG_KEYS` — read the declaration,
never a sentence about it.
"""

from __future__ import annotations

import os
import re
import subprocess
from typing import Dict, List, Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_DOMAINS = ("sensor|binary_sensor|light|switch|cover|lock|fan|climate|automation|"
            "scene|script|camera|media_player|vacuum|input_number|input_boolean|"
            "number|select|button|todo|water_heater|device_tracker|person|"
            "alarm_control_panel")
#: ⚠️ THE LOOK-BEHIND IS LOAD-BEARING. Without it `this.camera.position` and
#: `scene.getMeshByName` match, and the list below triples in size with noise
#: that would train a reader to skim it.
_ENTITY_ID = re.compile(r"(?<![\w.])(?:" + _DOMAINS + r")\.[a-z][a-z0-9_]*")

#: Not entity ids at all — a Babylon API property named in prose, a CSS
#: selector, or a Home Assistant SERVICE (`todo.add_item` is a service call and
#: `lock.unlock` is the one the proxy allowlists). Harmless, and listed rather
#: than filtered by a cleverer regex so the list stays readable.
NOT_ENTITY_IDS: Set[str] = {
    "button.active", "button.cockpit",
    "camera.camera", "camera.fov", "camera.gate", "camera.radius",
    "light.diffuse", "light.excluded", "light.intensity", "light.range",
    "light.set", "light.specular",
    "lock.unlock", "todo.add_item",
    "scene.active", "scene.block", "scene.clear", "scene.collisions",
    "scene.dispose", "scene.environment", "scene.get", "scene.js",
    "scene.lights", "scene.materials", "scene.meshes", "scene.on",
    "scene.pick", "scene.register", "scene.render", "scene.textures",
    "scene.types",
}

#: Deliberately generic teaching examples. Each shows the SHAPE of an id and
#: names nobody's device: placeholder object_ids (`x`, `y`, `a`, `b`, `foo`),
#: numbered stand-ins, and the standard entity of an HA integration
#: (`sensor.moon_phase` ships with `sun`/`moon` and is not villa data).
ILLUSTRATIVE: Set[str] = {
    "binary_sensor.motion0", "binary_sensor.motion1",
    "camera.driveway", "sensor.hallway_temperature",  # the two above, replaced
    "cover.x", "cover.x__closed", "cover.x__half", "cover.x__open",
    "light.y__half", "lock.foo", "lock.foo__locked", "lock.y__locked",
    "sensor.a", "sensor.b", "sensor.moon_phase",
    "fan.ceiling_fan_",  # a PREFIX in a matcher, not an id
    "todo.shopping_list",  # HA's own default list name
}

#: ⚠️ REAL DEVICES OF THE REFERENCE DEPLOYMENT, IN COMMENTS THAT RECORD A
#: MEASURED BUG. Each is the evidence for a finding, and this project's rule is
#: that a record of an answered question is never deleted — so they are
#: ACCEPTED here rather than silently tolerated, and the owner has the list.
#: ⚠️ A NEW ENTRY IN THIS GROUP IS A DECISION, NOT A FORMALITY: prefer a
#: placeholder unless the exact id is what makes the record checkable.
ACCEPTED_IN_COMMENTS: Set[str] = {
    "automation.outdoor_unified_doorbell_call_and_unlock",
    "camera.doorbell_main", "camera.hallway_cam", "camera.livingroom_cam",
    "camera.main_house_door_cam", "camera.staircase_2f_cam",
    "climate.gym_room",
    "cover.bedroom3_curtain", "cover.curtain_big",
    "cover.curtain_big__closed", "cover.curtain_big__open",
    "fan.bathroom_ceiling_fan", "fan.ceiling_fan_kitchen",
    "fan.ceiling_fan_livingroom", "fan.ceiling_fan_patio_terrace",
    "light.bedroom_1_", "light.corridor", "light.living_room",
    "light.living_room_ceiling_led_", "light.x_ceiling_fan_light",
    "lock.front_door", "lock.front_door__locked",
    "sensor.house_pump_power_factor",
    "sensor.living_room_foo_4217_temperature", "sensor.pool_pump_energy",
    "sensor.pool_pump_power_factor",
    "switch.outdoor_swimming_pool_light_patio_top",
}

KNOWN = NOT_ENTITY_IDS | ILLUSTRATIVE | ACCEPTED_IN_COMMENTS


def _tracked_source() -> List[str]:
    out = subprocess.run(["git", "ls-files", "rootfs/", "src/"],
                         cwd=REPO_ROOT, capture_output=True, text=True)
    return [p for p in out.stdout.split() if p]


def _found() -> Dict[str, List[str]]:
    hits: Dict[str, List[str]] = {}
    for rel in _tracked_source():
        path = os.path.join(REPO_ROOT, rel)
        try:
            text = open(path, encoding="utf-8").read()
        except (OSError, UnicodeDecodeError):
            continue
        for match in _ENTITY_ID.findall(text):
            hits.setdefault(match, [])
            if rel not in hits[match]:
                hits[match].append(rel)
    return hits


def test_no_unclassified_entity_id_reaches_tracked_source() -> None:
    found = _found()
    unknown = sorted(set(found) - KNOWN)
    assert not unknown, (
        "entity ids in tracked source that nobody has classified. This repo is "
        "PUBLIC and CLAUDE.md's first hard rule is that nothing villa-specific "
        "ships — so each of these is either a placeholder (add to ILLUSTRATIVE), "
        "not an entity at all (NOT_ENTITY_IDS), or a real device whose id you "
        "must decide to keep (ACCEPTED_IN_COMMENTS) or replace:\n  "
        + "\n  ".join(f"{u}  <- {', '.join(found[u])}" for u in unknown))


def test_the_allow_list_has_no_dead_entries() -> None:
    """⚠️ AN ALLOW-LIST THAT OUTLIVES ITS ENTRIES ROTS INTO PERMISSION. A name
    left here after the code stopped using it silently re-blesses that id for
    whoever adds it back."""
    found = set(_found())
    dead = sorted(KNOWN - found)
    assert not dead, (
        "these are allow-listed but appear nowhere in tracked source — remove "
        f"them, or the list grants permission nobody asked for: {dead}")


def test_no_real_entity_id_is_rendered_as_product_copy() -> None:
    """⚠️ A COMMENT IS A RECORD; RENDERED TEXT IS THE PRODUCT. `ConfigEditor`
    printed `camera.patio_1f_cam` — one of the reference villa's actual
    cameras — inside a `<code>` element in the Settings tab, so every install
    of this add-on showed that villa's camera as its worked example. The
    accepted-in-comments group above does NOT extend here: a record explains a
    past bug to a maintainer, and this is copy a stranger reads on their wall.
    """
    offenders: List[str] = []
    for rel in _tracked_source():
        if not rel.endswith((".tsx", ".jsx")):
            continue
        for number, line in enumerate(
                open(os.path.join(REPO_ROOT, rel), encoding="utf-8")
                .read().splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith(("//", "*", "/*")):
                continue
            for match in _ENTITY_ID.findall(line):
                if match in NOT_ENTITY_IDS or match in ILLUSTRATIVE:
                    continue
                offenders.append(f"{rel}:{number}: {match}")
    assert not offenders, (
        "a real entity id in rendered TSX — this ships to every install:\n  "
        + "\n  ".join(offenders))
