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
    "light.turn_off", "light.turn_on", "fan.turn_off", "switch.turn_off",
    "switch.turn_on",
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
    # ⚠️ A ONE-LETTER STAND-IN IN `test_task_loop`, chosen so it CANNOT be
    # mistaken for a device: the test needs some non-empty list id to prove the
    # loop refuses a concern with no id, and which list it is has no bearing.
    "todo.x",
    # The upstream ref-boundary fixtures (v2.711.0). ⚠️ `fan.a` is NOT a fifth
    # placeholder — it is what `inert` MAKES of `fan.a_first_unit` by turning
    # the underscores into spaces, and the shortened form still matches the
    # detector. That is the defect those tests pin, so the manufactured id has
    # to be classified alongside the real one. The first draft of them used
    # this villa's actual fan ids, and this pin caught it.
    "fan.a", "fan.a_first_unit", "fan.b_second_unit", "light.y_main",
    # `test_journal.py`'s ring fixtures and `test_agent_proposals.py`'s. Named
    # for what they DO to the ring — one chatty, one quiet — because the
    # property under test is which of the two survives eviction, and a real
    # device id would make that read as a claim about this villa.
    "light.chatty", "sensor.chatty_signal", "sensor.busy", "sensor.quiet",
    "sensor.quiet_pump_power",
    # `test_tool_raise_concern.py`, `test_agent_escalation_wiring.py` and
    # `test_agent_approval_queue.py`. ⚠️ INVENTED, and it went red one release
    # LATE — the files were untracked when they were written, so this pin could
    # not see them until the commit made them visible. That is exactly what
    # `feedback_stage-before-gating` records, and the sequence repeated anyway:
    # the honest fix is that a new test file's ids get classified here in the
    # SAME change that writes them, not after the pin catches up.
    "sensor.example_pump_power",
    # `test_security_validation.py` (TASK-101). ⚠️ INVENTED, and it went red one
    # release late AGAIN — the note above says in as many words that a new test
    # file's ids must be classified in the SAME change that writes them, and I
    # wrote that note and then repeated the sequence. The `example_` prefix is
    # the convention: none of these is a device anywhere.
    "lock.example_front_gate", "switch.example_door_1_relay",
    "switch.example_intercom", "switch.example_thing",
    "light.example_outdoor_path",
    "lock.side_gate",
    # `test_agent_mcp.py`. A deliberately fictional id, and the test's whole
    # point is that a tool result carrying ANY raw id is refused — so the id
    # must be a real-SHAPED one and must not be a real device.
    "light.some_room_lamp",
    # `test_agent_sources.py`. Journal fixtures for the wiring tests, named
    # `probe`/`new_thing` so they are obviously invented — the SHAPE of a
    # journal row is what is under test, and a row needs an id to have a shape.
    "sensor.probe_power", "binary_sensor.probe_door", "sensor.new_thing",
    # `test_agent_route.py` and `test_agent_act.py`. Single-letter and `probe`
    # placeholders — the SHAPE of an occupancy answer and of a door relay that
    # is an ordinary `switch.*` is what is under test, and both need an id to
    # have a shape.
    "person.a", "device_tracker.b", "light.x",
    "light.probe_lamp", "switch.probe_door_relay",
    # `observe/journal.py` and its tests. Every one is a placeholder chosen to
    # be obviously fictional — the SHAPE of a state_changed event is what is
    # under test, and the allow-list comment needs *an* entity to point at.
    # ⚠️ These arrived with v2.610.0 and this pin did not fire on them, because
    # it scans TRACKED source and `observe/` was still untracked when the gate
    # was run. The commit is what made them visible. A new module therefore
    # passes this rule right up until it is committed, which is the one moment
    # nobody re-runs the suite — see the note in `_tracked_source`.
    "climate.lounge", "climate.x", "light.a", "light.b", "light.c",
    "light.quiet", "light.hall",
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
    # ⚠️ TWELVE ENTRIES LEFT WITH PH-5's DELETED TESTS (2026-08-27): the ids
    # lived only in test_aggregate/noise/verify/sections/actionable fixtures,
    # and this list's own companion assertion is what noticed — an allow-listed
    # id appearing nowhere is permission nobody asked for.
    "sensor.a_energy", "sensor.b_energy", "sensor.c",
    "sensor.p_energy", "sensor.s", "sensor.s0", "sensor.x",
    "sensor.x_energy", "sensor.new_energy", "sensor.old_energy",
    "binary_sensor.leak_x", "light.a",
    # Named for the behaviour under test, not for a device.
    "sensor.debris", "sensor.ghost", "sensor.odd", "sensor.ok",
    "sensor.other", "sensor.mesh_only", "sensor.total",
    "sensor.energy", "sensor.tariff", "sensor.temperature",
    "sensor.meter_cost", "sensor.meter_export", "sensor.meter_import",
    "sensor.combo_humidity", "sensor.combo_temperature",
    "switch.hidden", "switch.kept",
    # Generic rooms and equipment — no villa has a claim on these.
    "binary_sensor.hall_motion", "binary_sensor.laundry_leak",
    "binary_sensor.leak",
    "climate.living", "cover.blind", "cover.blind__open",
    "light.bedroom_lamp", "light.hall", "light.kitchen", "light.terrace_string",
    "lock.front", "sensor.bedroom_window",
    # The offline-block fixtures (2026-08-27). `lock.gate_` is the stem of
    # `lock.gate_a/b/c`, built by an f-string so the scan sees the prefix.
    "lock.front_gate", "lock.side_gate", "lock.gate_",
    "sensor.pump", "sensor.pump_power",
    "switch.pool_pump", "switch.pump_relay",
    # ⚠️ REAL, AND KEPT BECAUSE THE TEST IS ABOUT THE REAL SHAPE. The todo
    # parser is checked against the exact strings the villa's blueprints write;
    # a sanitised copy would stop proving the parser handles what it meets.
    # Listed so the decision is visible rather than accidental.
    "sensor.house_pump_power",
    # The shortened-label identification fixture (test_agent_cost) uses the
    # exact label shapes the reference villa's 0/5 was logged against.
    "sensor.jacuzzi_pump_energy", "sensor.jacuzzi_pump_power",
    "sensor.onsen_pump_power",
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
