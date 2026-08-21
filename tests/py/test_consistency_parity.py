"""The tablet and the briefing must describe the same villa the same way.

⚠️ THE REQUIREMENT, IN THE OWNER'S WORDS, after a brief that mentioned none of
the four devices the Cockpit was listing at the same moment:

    "both supervision systems are like brother and sisters and shall always
     report consistent findings, if one say something, the other must say the
     same thing for consistency ... User shall never notice any discrepancy
     between what VESTA Kiosk UI is reporting and the alerts he is receiving on
     his device."

Every divergence in this subsystem so far has been found by a person comparing
two screens — the fault picker against the HUD badge, the menu against the
modal, Readiness against the alert count, and most recently a briefing against
the Cockpit. This is the first thing in the repo that can find one without them.

⚠️ IT RUNS THE SHIPPED CODE, BOTH SIDES. The TypeScript half is not transcribed
here: `tests/consistency/kiosk_view.ts` imports `deviceGroups.ts` and
`cockpitData.ts` and is executed by plain `node` (the same type-stripping
`test:placement` already relies on). A transcription would agree with itself
forever while the app moved, which is the failure being guarded against.

⚠️ IT DID NOT SHIP BEFORE THE CODE IT JUDGES, AND THIS PARAGRAPH SAID IT DID.
`feedback_instrument-before-fix` — never ship an instrument and the fix it
measures in one release — was cited here in a sentence describing something that
did not happen: `57de49d` contains this harness AND `reports/devices.py`, and the
parity assertions were green on their first run. A harness written alongside the
implementation it checks agrees with itself by construction; its first green is a
self-portrait, and /dry-audit caught the claim two releases later (2.573.0).

⚠️ SO THE EVIDENCE IS MUTATION TESTING, NOT THE FIRST GREEN. Nine deliberate
breaks of `devices.py` — dismissal, group folding, config debris, `disabled`,
`isUnavailable(absent)`, the stored-label precedence, the raw-slug prettifier,
the repeated-prefix dedupe — of which FIVE initially survived, because the
fixture dropped the entity before the rule was reached. Those five are what made
the fixtures real, and it is the reason for the rule recorded in CLAUDE.md: add a
rule to `devices.py` and you must add a fixture row that a REPORTED item passes
through. A parity test nobody has tried to break is a parity test that passes.

The four fixtures are deployment SHAPES, not this villa:
    bare              nothing configured anywhere
    pack-only         blueprint files imported, no automations built from them
    blueprints-live   automations firing, kiosk unconfigured
    both              a configured kiosk and a live automation layer
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from typing import Any, Dict, List

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HARNESS = os.path.join(REPO_ROOT, "tests", "consistency")
FIXTURES = os.path.join(HARNESS, "fixtures")
REGISTER = os.path.join(HARNESS, "register.mjs")
KIOSK_VIEW = os.path.join(HARNESS, "kiosk_view.ts")

sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from reports import devices as devices_mod       # noqa: E402
from reports import standing as standing_mod     # noqa: E402

FIXTURE_NAMES = ["bare", "pack-only", "blueprints-live", "both"]


def _fixture(name: str) -> Dict[str, Any]:
    with open(os.path.join(FIXTURES, f"{name}.json"), encoding="utf-8") as handle:
        return json.load(handle)


def _kiosk(name: str) -> Dict[str, Any]:
    """Run the SPA's own derivation over a fixture and return its answer."""
    node = shutil.which("node")
    if node is None:                                    # pragma: no cover
        pytest.skip("node is not installed; the TypeScript half cannot run")
    result = subprocess.run(
        [node, "--import", REGISTER, KIOSK_VIEW,
         os.path.join(FIXTURES, f"{name}.json")],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, (
        f"the kiosk harness failed on {name}:\n{result.stderr}")
    return json.loads(result.stdout)


def _addon(name: str) -> Dict[str, Any]:
    """The same questions, answered from the add-on's side."""
    fx = _fixture(name)
    entities = fx.get("states") or {}
    config = dict(fx.get("deviceConfig") or {})
    config["resolvedRooms"] = fx.get("resolvedRooms") or {}
    mesh = fx.get("meshEntityIds") or []
    fm = fx.get("fmData") or {}

    entity_map = config.get("entityMap") or {}
    groups = config.get("deviceGroups") or []
    dismissed = config.get("dismissedEntityIds") or []

    items = standing_mod.build(entities, config, fm, mesh)
    return {
        "source": "addon",
        "fixture": name,
        "selectable": sorted(devices_mod.selectable_device_ids(
            entity_map, groups, mesh, entities, dismissed)),
        "unavailable": sorted(devices_mod.unavailable_device_ids(
            entity_map, groups, mesh, entities, dismissed)),
        "attention": sorted(
            [{"id": i.subject, "kind": i.kind, "title": i.title, "room": i.room}
             for i in items],
            key=lambda row: row["id"]),
        "health": standing_mod.health(items),
    }


# ── the harness itself must not go blind ─────────────────────────────────────

def test_every_fixture_is_present_and_shaped() -> None:
    """⚠️ VACUOUS-PASS GUARD. A parity test whose fixtures vanished compares
    nothing and reports health forever — the shape of instrument this project
    has now been bitten by four times."""
    for name in FIXTURE_NAMES:
        fx = _fixture(name)
        assert fx["name"] == name
        assert fx.get("note"), f"{name} does not say what deployment it stands for"
        for key in ("states", "deviceConfig", "fmData", "meshEntityIds"):
            assert key in fx, f"{name} is missing {key}"


def test_the_typescript_half_actually_ran() -> None:
    """If the node harness silently produced nothing, every comparison below
    would be empty-against-empty and pass."""
    view = _kiosk("both")
    assert view["source"] == "kiosk"
    assert view["selectable"], "the kiosk derived no devices from the `both` fixture"
    assert view["attention"], "the kiosk found nothing wrong in a fixture built to be wrong"


# ── the parity itself ────────────────────────────────────────────────────────

@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_both_sides_agree_on_what_a_device_is(name: str) -> None:
    kiosk, addon = _kiosk(name), _addon(name)
    assert addon["selectable"] == kiosk["selectable"], (
        f"[{name}] the two sides disagree about which entities are devices.\n"
        f"  kiosk only: {sorted(set(kiosk['selectable']) - set(addon['selectable']))}\n"
        f"  add-on only: {sorted(set(addon['selectable']) - set(kiosk['selectable']))}")


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_both_sides_agree_on_what_is_offline(name: str) -> None:
    kiosk, addon = _kiosk(name), _addon(name)
    assert addon["unavailable"] == kiosk["unavailable"], (
        f"[{name}] the tablet and the briefing would report different devices "
        f"as not reporting.\n"
        f"  kiosk only: {sorted(set(kiosk['unavailable']) - set(addon['unavailable']))}\n"
        f"  add-on only: {sorted(set(addon['unavailable']) - set(kiosk['unavailable']))}")


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_the_attention_sets_are_equal(name: str) -> None:
    """⚠️ THE ONE THAT ANSWERS THE REQUEST. Not "the briefing covers the
    Cockpit" — EQUAL. A briefing that reports something the tablet does not is
    the same defect mirrored, and is the easier one to ship by accident."""
    kiosk, addon = _kiosk(name), _addon(name)
    k_ids = {row["id"] for row in kiosk["attention"]}
    a_ids = {row["id"] for row in addon["attention"]}
    assert a_ids == k_ids, (
        f"[{name}] the two surfaces would list different problems.\n"
        f"  only on the tablet: {sorted(k_ids - a_ids)}\n"
        f"  only in the brief:  {sorted(a_ids - k_ids)}")


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_both_sides_call_each_thing_the_same_name(name: str) -> None:
    """⚠️ THE NAME IS HALF THE CONSISTENCY. Identical sets described with
    different words still read as two systems: the owner's own label wins on
    the tablet, and a brief calling the device by its Home Assistant id is a
    discrepancy the person sees even though the finding matches."""
    kiosk, addon = _kiosk(name), _addon(name)
    k_by_id = {row["id"]: row for row in kiosk["attention"]}
    a_by_id = {row["id"]: row for row in addon["attention"]}
    mismatched: List[str] = []
    for subject in sorted(k_by_id.keys() & a_by_id.keys()):
        for field in ("kind", "title", "room"):
            if k_by_id[subject][field] != a_by_id[subject][field]:
                mismatched.append(
                    f"{subject}.{field}: tablet {k_by_id[subject][field]!r} "
                    f"vs brief {a_by_id[subject][field]!r}")
    assert not mismatched, f"[{name}] " + "; ".join(mismatched)


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_both_sides_agree_on_how_bad_it_is(name: str) -> None:
    kiosk, addon = _kiosk(name), _addon(name)
    assert addon["health"] == kiosk["health"], (
        f"[{name}] severity disagrees: tablet {kiosk['health']}, "
        f"brief {addon['health']}")


# ── the cross-artefact tables, derived rather than restated ──────────────────

def _ts_source(relative: str) -> str:
    with open(os.path.join(REPO_ROOT, "src", relative), encoding="utf-8") as handle:
        return handle.read()


def test_the_alarm_state_table_matches_the_kiosks() -> None:
    """⚠️ A LITERAL ON EACH SIDE OF A LANGUAGE BOUNDARY WITH NOTHING BETWEEN
    THEM — this subsystem's most repeated defect (six instances across
    2.544.0–2.546.0). Derived from the TypeScript so a device_class added there
    and forgotten here fails HERE rather than by never alerting in a brief."""
    source = _ts_source(os.path.join("config", "BinarySensorClasses.ts"))
    found = dict(re.findall(
        r"^\s*(\w+):\s*\{[^}]*?alarmState:\s*\"(on|off|none)\"", source, re.MULTILINE))
    assert found, "could not read the alarm-state table — this test is blind"
    missing = sorted(k for k in found if k not in standing_mod.ALARM_STATE)
    wrong = sorted(f"{k}: kiosk {v!r}, add-on {standing_mod.ALARM_STATE[k]!r}"
                   for k, v in found.items()
                   if k in standing_mod.ALARM_STATE and standing_mod.ALARM_STATE[k] != v)
    assert not missing, (
        f"device classes the kiosk alerts on and the brief has never heard of: "
        f"{missing}")
    assert not wrong, "; ".join(wrong)


def test_the_unlisted_class_default_matches() -> None:
    """The kiosk's DEFAULT_INFO alerts on "on". Defaulting to "never alerts"
    here would look safer and would make an unrecognised class visible on one
    surface and invisible on the other."""
    source = _ts_source(os.path.join("config", "BinarySensorClasses.ts"))
    default = re.search(r"DEFAULT_INFO[^=]*=\s*\{[^}]*?alarmState:\s*\"(\w+)\"",
                        source, re.DOTALL)
    assert default, "DEFAULT_INFO moved — this test is blind"
    assert standing_mod.DEFAULT_ALARM_STATE == default.group(1)


def test_the_pairable_suffixes_match() -> None:
    source = _ts_source(os.path.join("config", "deviceGroups.ts"))
    block = re.search(r"PAIRABLE_SUFFIXES[^=]*=\s*\[(.*?)\];", source, re.DOTALL)
    assert block, "PAIRABLE_SUFFIXES moved — this test is blind"
    pairs = re.findall(r'\["([^"]+)",\s*"([^"]+)"\]', block.group(1))
    assert [tuple(p) for p in pairs] == [tuple(p) for p in devices_mod.PAIRABLE_SUFFIXES]


def test_the_device_registry_signal_is_off_on_both_sides() -> None:
    """⚠️ `devices._primary_by_member` STATES THIS AS A FACT ABOUT THE KIOSK.
    `suggestDeviceGroups` accepts an `entityDeviceIds` map and prefers it, but
    `primaryByMember` — the only caller on the folding path — passes two
    arguments, so that half is dead on both sides. If the kiosk starts passing a
    registry, the two implementations diverge silently and that comment becomes
    the lie this test exists to prevent."""
    source = _ts_source(os.path.join("config", "deviceGroups.ts"))
    call = re.search(r"suggestDeviceGroups\(entityMap,\s*deviceGroups\)", source)
    assert call, (
        "primaryByMember now passes a device registry to suggestDeviceGroups. "
        "reports/devices.py folds without one and the two will disagree about "
        "which entities are one device.")


def test_the_dismissal_rule_matches() -> None:
    """A dismissal applies only while HA still does not know the entity. Getting
    this backwards on one side hides a live device from one surface only."""
    entities = {"switch.kept": {"entity_id": "switch.kept", "state": "off"}}
    dismissed = devices_mod.dismissed_set(["switch.kept", "sensor.ghost"], entities)
    assert dismissed == {"sensor.ghost"}


def test_the_danger_split_matches_the_kiosks() -> None:
    """⚠️ THREE SEVERITY SCALES, AND UNTIL 2.572.0 NOTHING RELATED ANY TWO.
    The kiosk's ok/warn/danger, Readiness' pass/warn/fail and the report's
    critical/warning/notice/info — one condition could read `danger` on the
    tablet and `notice` in the brief with no code disagreeing. The one that
    reaches a person on two screens at once is this split, so it is the one
    pinned: the tablet's headline colour and the notification's title marker
    must come from the same set of kinds."""
    source = _ts_source(os.path.join("components", "cockpit", "cockpitData.ts"))
    block = re.search(r"DANGER_KINDS[^=]*=\s*\[(.*?)\];", source, re.DOTALL)
    assert block, "DANGER_KINDS moved — this test is blind"
    kiosk = set(re.findall(r'"(\w+)"', block.group(1)))
    assert kiosk == set(standing_mod.DANGER_KINDS), (
        f"tablet {sorted(kiosk)} vs brief {sorted(standing_mod.DANGER_KINDS)}")


def test_every_standing_kind_has_a_severity() -> None:
    """A kind with no entry falls to the default. That default is `warning` and
    not `info` on purpose — a kind nobody has classified must not arrive as the
    quietest thing in the report — but every kind the builder actually emits
    should be classified deliberately rather than by that fallback."""
    source = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports",
                               "standing.py"), encoding="utf-8").read()
    emitted = set(re.findall(r'kind="(\w+)"', source))
    assert emitted, "could not read the emitted kinds — this test is blind"
    missing = sorted(emitted - set(standing_mod.SEVERITY_OF_KIND))
    assert not missing, f"kinds falling through to the default: {missing}"
    assert standing_mod.DEFAULT_KIND_SEVERITY != "info"


def test_the_danger_kinds_are_the_critical_ones() -> None:
    """The two tables must not be able to disagree with each other either."""
    for kind, severity in standing_mod.SEVERITY_OF_KIND.items():
        assert (severity == "critical") == (kind in standing_mod.DANGER_KINDS), (
            f"{kind} is {severity} but "
            f"{'is' if kind in standing_mod.DANGER_KINDS else 'is not'} a danger kind")


def test_readiness_uses_the_shared_device_rule() -> None:
    """⚠️ D6: `readiness.ts` had TWO definitions of "a device of this villa".
    `devices-online` called the shared rule; the camera and climate checks
    scanned by domain through a local predicate applying `disabled` and nothing
    else — so a DISMISSED camera stayed red on Readiness while being absent from
    the Cockpit, on the same screen."""
    source = _ts_source(os.path.join("fm", "readiness.ts"))
    assert "selectableDeviceIds" in source, (
        "readiness no longer derives its device set from the shared rule")
    body = re.search(r"const byDomain = \(d: string\) =>(.*?);", source, re.DOTALL)
    assert body, "byDomain moved — this test is blind"
    assert "villaDevices" in body.group(1), (
        "byDomain filters by something other than the shared device set")
    assert "disabled" not in body.group(1), (
        "a local relevance predicate is back, and it will drift again")


def test_the_unknown_state_pair_is_named_on_both_sides() -> None:
    """⚠️ ONE LITERAL ON EACH SIDE OF A LANGUAGE BOUNDARY, AGAIN. The add-on has
    carried `devices.UNKNOWN_STATES` since 2.571.0 and the kiosk had the pair
    written out at six sites and named nowhere — three on a `HassEntity` (where
    `isUnavailable` already existed and was simply not called) and three on a
    bare state string, where the predicate does not fit and only the SET does.
    Found by /dry-audit on 2026-08-21."""
    source = _ts_source(os.path.join("utils", "stateColors.ts"))
    block = re.search(r"UNKNOWN_STATES[^=]*=\s*new Set\(\[(.*?)\]\)", source, re.DOTALL)
    assert block, "UNKNOWN_STATES moved — this test is blind"
    kiosk = set(re.findall(r'"(\w+)"', block.group(1)))
    assert kiosk == set(devices_mod.UNKNOWN_STATES), (
        f"tablet {sorted(kiosk)} vs brief {sorted(devices_mod.UNKNOWN_STATES)}")


def test_the_kiosk_does_not_write_the_pair_out_again() -> None:
    """The set exists so the six sites can stop restating it; a seventh that
    restates it is the drift starting over."""
    offenders = []
    for root, _dirs, files in os.walk(os.path.join(REPO_ROOT, "src")):
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            path = os.path.join(root, name)
            with open(path, encoding="utf-8") as handle:
                for number, line in enumerate(handle, 1):
                    if line.lstrip().startswith(("//", "*", "/*")):
                        continue
                    # ⚠️ THE DECLARATION IS NOT A RESTATEMENT. `stateColors`
                    # is where the pair is allowed to appear; everywhere else
                    # must read it.
                    if "UNKNOWN_STATES" in line:
                        continue
                    if '"unavailable"' in line and '"unknown"' in line:
                        offenders.append(f"{os.path.relpath(path, REPO_ROOT)}:{number}")
    # stateColors declares it; entityState derives OFF_STATES from it.
    assert offenders == [], (
        f"the unavailable/unknown pair is written out again at: {offenders}")


def test_readiness_and_its_drill_down_count_the_same_devices() -> None:
    """⚠️ NARROWING ONE READER OF A SET AND NOT ITS NEIGHBOUR. 2.572.0 made the
    Readiness checks count villa devices; the panel they open kept listing every
    `lock.*` Home Assistant has, so the check said "2 not locked" and the drill
    down showed eight."""
    facility = _ts_source(os.path.join("components", "fm", "FacilityModal.tsx"))
    call = re.search(r"const group = check\.id === \"locks\"(.*?);", facility, re.DOTALL)
    assert call, "openCheckDevices moved — this test is blind"
    # ⚠️ EVERY BRANCH, NOT THE DISPATCH AS A WHOLE. The first version asserted
    # `"villaDevices" in` the ternary and passed while `locksGroup` was
    # unscoped, because the `lightsGroup` arm still mentioned it — a mutation
    # survived and said so. One group builder per branch, each checked.
    builders = re.findall(r"(\w+Group)\(([^)]*)\)", call.group(1))
    assert builders, "no group builders found in the dispatch"
    unscoped = [name for name, args in builders if "villaDevices" not in args]
    assert not unscoped, (
        f"these drill-down groups are not scoped to the villa's own devices, "
        f"so they contradict the check that opens them: {unscoped}")
