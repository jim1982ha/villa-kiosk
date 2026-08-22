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
    # HA SERVICE names used as policy fixtures — `light.turn_off` is a service
    # call, not an entity. Same class as `lock.unlock` directly above.
    "light.turn_off", "fan.turn_off", "switch.turn_off",
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
    # Placeholders in `clean_summary`'s docstring and its tests: the SHAPE of a
    # redacted line is what is under test, not any villa's device.
    "automation.a", "sensor.a_power_factor", "sensor.b_power_factor",
    "binary_sensor.motion0", "binary_sensor.motion1",
    "camera.driveway", "sensor.hallway_temperature",  # the two above, replaced
    "cover.x", "cover.x__closed", "cover.x__half", "cover.x__open",
    "light.y__half", "lock.foo", "lock.foo__locked", "lock.y__locked",
    "sensor.a", "sensor.b", "sensor.moon_phase",
    "fan.ceiling_fan_",  # a PREFIX in a matcher, not an id
    "todo.shopping_list",  # HA's own default list name
    # `observe/journal.py` and its tests. Every one is a placeholder chosen to
    # be obviously fictional — the SHAPE of a state_changed event is what is
    # under test, and the allow-list comment needs *an* entity to point at.
    # ⚠️ These arrived with v2.610.0 and this pin did not fire on them, because
    # it scans TRACKED source and `observe/` was still untracked when the gate
    # was run. The commit is what made them visible. A new module therefore
    # passes this rule right up until it is committed, which is the one moment
    # nobody re-runs the suite — see the note in `_tracked_source`.
    "climate.lounge", "climate.x", "light.a", "light.b", "light.hall",
    "light.n", "lock.c", "switch.a", "switch.new", "lock.front", "lock.a",
    "sensor.pump", "sensor.seeded", "sensor.flat", "sensor.spike",
    "sensor.drift", "sensor.new", "sensor.x", "sensor.q", "sensor.weak",
    "sensor.quiet", "sensor.loud", "sensor.unscorable", "sensor.pool",
    "light.gone", "light.ok",  # observe/cycle.py's diff fixtures
    # agent tool fixtures and the dotted-path probes. `sensor.probe` is the
    # literal prefix of an f-string (`f"sensor.probe{i}_power"`), which is what
    # the scanner sees — a real id never has that shape.
    "sensor.thin", "sensor.a_thing", "sensor.b_thing", "sensor.x_thing",
    "sensor.hidden_thing", "switch.buried_thing", "sensor.probe",
    "sensor.probe_temperature", "binary_sensor.probe_moisture",
    "lock.probe_entrance", "automation.a_rule",
    # agent/policy.py fixtures. Every one is shaped to isolate ONE rule of the
    # harm gate — the domain probes carry no access word, and the anchor probes
    # carry "outdoor"/"indoor" precisely to prove `door` does not match inside
    # them.
    "alarm_control_panel.house", "camera.hall_cam", "camera.living_room",
    "climate.lounge_unit", "light.a_thing", "light.hall_thing",
    "light.indoor_lighting", "light.outdoor_terrace", "lock.a_thing",
    "media_player.a_thing", "sensor.a_secret_thing", "switch.gate_opener",
    "switch.outdoor_probe_light", "switch.parking_door_1_relay",
    "switch.plain_thing", "switch.some_relay",
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

#: ⚠️ TEST FIXTURES, WHICH THIS PIN DID NOT SCAN UNTIL 2026-08-22. `tests/` is
#: tracked and therefore published, and the scan covered `rootfs/` and `src/`
#: only — the two directories I happened to be fixing when I wrote it. So
#: v2.581.1 sanitised a real first name at four sites and left it at NINETEEN
#: more, in files this very test could not see. `grep -l` inside the test built
#: to enforce `grep -L`.
#:
#: ⚠️ MOST OF THESE ARE DELIBERATELY SYNTHETIC and are listed rather than
#: pattern-matched, because "looks synthetic" is a judgement no regex makes:
#: `sensor.pump_power` and `sensor.house_pump_power` differ only in whether a
#: real villa happens to have one. Freezing the set is the same discipline the
#: groups above use — a new fixture id fails until somebody classifies it.
FIXTURES: Set[str] = {
    # Single letters and obvious stand-ins.
    "sensor.a_energy", "sensor.b_energy", "sensor.c", "sensor.j", "sensor.n",
    "sensor.p", "sensor.p_energy", "sensor.s", "sensor.s0", "sensor.x",
    "sensor.x_energy", "sensor.new_energy", "sensor.old_energy",
    "binary_sensor.x", "binary_sensor.leak_x", "climate.b", "light.a",
    "automation.rule_", "automation.outdoor_",
    # Named for the behaviour under test, not for a device.
    "sensor.debris", "sensor.ghost", "sensor.night", "sensor.odd", "sensor.ok",
    "sensor.only_one", "sensor.other", "sensor.mesh_only", "sensor.total",
    "sensor.energy", "sensor.tariff", "sensor.temperature",
    "sensor.meter_cost", "sensor.meter_export", "sensor.meter_import",
    "sensor.combo_humidity", "sensor.combo_temperature",
    "switch.hidden", "switch.kept",
    # Generic rooms and equipment — no villa has a claim on these.
    "binary_sensor.hall_motion", "binary_sensor.laundry_leak",
    "binary_sensor.leak", "binary_sensor.leak_kitchen",
    "climate.living", "cover.blind", "cover.blind__open",
    "light.bedroom_lamp", "light.hall", "light.kitchen", "light.terrace_string",
    "lock.front", "sensor.bedroom_window",
    "sensor.pump", "sensor.pump_pf", "sensor.pump_power",
    "switch.pool_pump", "switch.pump_relay",
    # ⚠️ REAL, AND KEPT BECAUSE THE TEST IS ABOUT THE REAL SHAPE. The todo
    # parser is checked against the exact strings the villa's blueprints write;
    # a sanitised copy would stop proving the parser handles what it meets.
    # Listed so the decision is visible rather than accidental.
    "sensor.house_pump_pf", "sensor.house_pump_power",
    "sensor.jacuzzi_pump_power_factor", "sensor.pool_pump_power",
    "sensor.swimming_pool_massage_jet_pump_power_factor",
    "light.master_bedroom_master_bedroom_light_ceiling",
}

KNOWN = NOT_ENTITY_IDS | ILLUSTRATIVE | ACCEPTED_IN_COMMENTS | FIXTURES


def _tracked_source() -> List[str]:
    """Everything the public repository publishes, not two directories of it.

    ⚠️ THIS SCANNED `rootfs/` AND `src/` ONLY, AND `tests/` IS TRACKED TOO. The
    rule is "this repo is public and nothing villa-specific may ship"; the
    applicable set is therefore every tracked file, and I scoped the pin to the
    two directories I happened to be fixing when I wrote it — `grep -l` inside
    the very test built to enforce `grep -L`. Asked directly whether anything
    villa-specific had reached the repo, which is how it surfaced.
    """
    out = subprocess.run(["git", "ls-files", "rootfs/", "src/", "tests/"],
                         cwd=REPO_ROOT, capture_output=True, text=True)
    return [p for p in out.stdout.split()
            # ⚠️ EXCEPT THIS FILE. The allow-list below NAMES every id, so
            # scanning it would report each one as its own violation — the same
            # reason `text.py` is exempt from the hand-quoting scan.
            if p and not p.endswith("test_hard_rules.py")]


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
