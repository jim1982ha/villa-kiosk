"""Devices unavailable by design (owner 2026-10-21): a battery device asleep between its reports. One list — the VESTA
Kiosk's, handed over in its heartbeat answer and kept beside the knowledge pack — one predicate (KnowledgePack.is_asleep, a listed entity standing for
its whole physical device), read by every check that judges "unavailable" (vesta_shared.asleep)."""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

from helpers import STARTER_SKILLS
from test_offline import NOW, STATES, _pack
from vesta_agent.app import Vesta
from vesta_agent.policy import FIELDS
from vesta_agent.tools import with_asleep
from vesta_shared import asleep
from vesta_shared.knowledge_pack import KnowledgePack
from vesta_shared.offline import devices_offline


def _kept(tmp_path, ids):
    """The Kiosk's list as the agent keeps it, beside a pack at tmp_path; the pack's path."""
    pack = str(tmp_path / "pack.json")
    asleep.save(pack, ids)
    return pack


def test_the_kiosk_hands_the_list_over_and_the_agent_keeps_it_beside_its_pack(tmp_path):
    pack = str(tmp_path / "pack.json")
    assert asleep.listed(pack) == frozenset()                                        # never told: none
    assert asleep.told({"every": 60}) is None                                        # a Kiosk older than the list
    assert asleep.told({"unavailableByDesign": ["Binary_Sensor.Door", 3]}) == ["binary_sensor.door"]

    class _App:
        kiosk_answered = Vesta.kiosk_answered

        class s:
            pack_path = pack
    _App().kiosk_answered({"unavailableByDesign": ["binary_sensor.door"]})
    assert asleep.listed(pack) == {"binary_sensor.door"}
    _App().kiosk_answered({"every": 60})                                             # said nothing: kept as it was
    assert asleep.listed(pack) == {"binary_sensor.door"}
    _App().kiosk_answered({"unavailableByDesign": []})                               # emptied in the Kiosk
    assert asleep.listed(pack) == frozenset()
    # the agent's own list of 0.12.308 is gone: the Rules page no longer edits one
    assert "asleep_entities" not in FIELDS


def test_the_rules_page_drops_the_retired_own_list_on_its_next_save():
    from vesta_agent.ui import policy_doc
    out = policy_doc.apply_form("asleep_entities: [binary_sensor.door]\n", policy_doc.to_form(""))
    assert "asleep_entities" not in out


def _loaded(tmp_path, ids):
    """The pack as every reader gets it (KnowledgePack.load), the Kiosk's list `ids` kept beside it."""
    path = _kept(tmp_path, ids)
    with open(path, "w", encoding="utf-8") as f:
        f.write(_pack().to_json())
    return KnowledgePack.load(path)


def test_a_device_listed_is_never_offline_and_its_other_entities_sleep_with_it(tmp_path):
    names = [g.name for g in devices_offline(_loaded(tmp_path, ["switch.spa_relay"]), STATES, NOW,
                                             ["power", "switch", "battery"])]
    # the relay's plug (its power sensors are on the same device) is asleep; the lone battery still counts
    assert names == ["Lone Battery"]
    assert "Spa Plug" in [g.name for g in devices_offline(_loaded(tmp_path, []), STATES, NOW,
                                                          ["power", "switch", "battery"])]


def test_where_a_device_stands_is_one_answer():
    pack = _pack()
    pack.asleep_are(["binary_sensor.door"])
    assert pack.standing("binary_sensor.door", "unavailable") == "asleep"
    assert pack.standing("binary_sensor.door", "on") == "answers"            # awake: what it says
    assert pack.standing("sensor.tank", "unavailable") == "offline"
    assert pack.standing("sensor.tank", "unknown") == "no value"             # answers, with nothing to give
    assert pack.standing("sensor.tank", "") == "no value"
    assert pack.standing("sensor.gone", None) == "absent"


def test_the_last_real_state_stands_in_for_unavailable():
    class Cli:
        def history(self, ids, start, end):
            return {"binary_sensor.door": [{"state": "on", "last_changed": "2026-10-09T10:00:00+00:00"},
                                           {"state": "off", "last_changed": "2026-10-09T10:01:00+00:00"},
                                           {"state": "unavailable", "last_changed": "2026-10-09T10:04:00+00:00"}]}
    pack = _pack()
    pack.asleep_are(["binary_sensor.door"])
    got = asleep.awake_states(Cli(), pack, {"binary_sensor.door": {"state": "unavailable"},
                                            "sensor.tank": {"state": "unavailable"}}, NOW)
    assert got["binary_sensor.door"] == {"state": "off", "last_changed": "2026-10-09T10:01:00+00:00", "asleep": True}
    assert got["sensor.tank"] == {"state": "unavailable"}                       # not listed: as it reads
    t = datetime(2026, 10, 9, tzinfo=timezone.utc)
    assert asleep.without_sleep([(t, "on"), (t + timedelta(minutes=3), "unavailable"), (t + timedelta(hours=1), "off")]) \
        == [(t, "on"), (t + timedelta(hours=1), "off")]


def test_the_ai_reads_a_sleeping_device_marked_so():
    text = json.dumps({"data": {"entity_id": "binary_sensor.door", "state": "unavailable"}})
    got = json.loads(with_asleep(text, {"binary_sensor.door"}.__contains__))
    assert "Unavailable by design" in got["data"]["unavailable_by_design"]
    other = json.dumps({"entity_id": "lock.x", "state": "unavailable"})
    assert with_asleep(other, {"binary_sensor.door"}.__contains__) == other


def test_an_open_offline_fault_of_a_device_listed_since_closes(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import recheck
    from vesta_shared.store import Store
    store = Store(str(tmp_path / "s.sqlite"))
    fid, _ = store.raise_finding("PM-UNAVAILABLE", "binary_sensor.door", "availability", "2026-10-09", "P3",
                                 "Door has been offline for 2 h.", {"entities": ["binary_sensor.door"]})
    pack = _pack()
    pack.asleep_are(["binary_sensor.door"])

    class Cli:
        def states(self, ids):
            return {"binary_sensor.door": {"state": "unavailable", "last_changed": NOW.isoformat()}}

        def not_found(self, ids):
            return set()
    res = recheck.back_online(store, lambda: Cli(), NOW, 5, "UTC", pack)
    assert res["closed"] == [fid]


def test_the_alert_desk_judges_a_sleeping_door_by_its_last_report_never_by_unavailable(monkeypatch):
    # a door alert ("open"), the door asleep: the rule's claim rendered on "unavailable" says false — never "it is over"
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "alert-desk", "scripts"))
    import desk
    pack = _pack()
    pack.asleep_are(["binary_sensor.door"])
    monkeypatch.setitem(desk._PACK, "pack", pack)

    def cli(last):
        class Cli:
            def states(self, ids):
                return {"binary_sensor.door": {"state": "unavailable", "attributes": {"friendly_name": "Door"}}}

            def history(self, ids, start, end):
                return {"binary_sensor.door": [{"state": last, "last_changed": "2026-10-09T10:01:00+00:00"},
                                               {"state": "unavailable", "last_changed": "2026-10-09T10:04:00+00:00"}]}

            def template(self, text):
                return "false"
        return Cli()
    inc = {"entity_id": "binary_sensor.door", "payload": json.dumps(
        {"claim": "{{ is_state('binary_sensor.door', 'on') }}", "entities": ["binary_sensor.door"], "state": "on"})}
    assert desk.still_there(inc, cli("on")) == (True, ["Door still reads on"])
    assert desk.still_there(inc, cli("off")) == (False, [])


def test_the_retired_own_list_is_no_misspelt_section():
    # owner, 2026-10-21: "Unknown section 'asleep_entities': a misspelt name is ignored" in red on the Rules page
    from vesta_agent.ui.changes import rules_problems
    assert not [p for p in rules_problems("asleep_entities: [binary_sensor.door]\n") if "asleep_entities" in p]
    assert [p for p in rules_problems("aslep_entities: []\n") if "aslep_entities" in p]          # a real slip still is


def _night_of_a_sleeping_door(tmp, listed):
    """The night check (nightly.py, as the engine runs it) over one door sensor whose battery reads "unavailable" now,
    asleep; its last real charge, 6 %, an hour before. `listed`: the Kiosk lists the door as asleep."""
    import subprocess
    import sys
    from helpers import PYTHONPATH
    fx = tmp / "fx"
    fx.mkdir(parents=True, exist_ok=True)
    (fx / "states.json").write_text(json.dumps({"states": {"sensor.door_battery": {
        "state": "unavailable", "attributes": {"friendly_name": "Door Battery", "unit_of_measurement": "%"},
        "last_changed": "2026-10-03T23:00:00+00:00"}}}))
    (fx / "history_raw_door.json").write_text(json.dumps({"entities": [{"entity_id": "sensor.door_battery", "states": [
        {"state": "6", "last_changed": "2026-10-03T22:00:00+00:00"},
        {"state": "unavailable", "last_changed": "2026-10-03T23:00:00+00:00"}]}]}))
    pack = KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None, families={"battery": [
        {"entity_id": "sensor.door_battery", "name": "Door Battery", "device_id": "door", "asset": "door",
         "family": "battery", "platform": "tuya_local", "unit": "%"}]},
        assets={}, areas=[], people=[], channels={}, unknown_area=[], unclassified=[], retention={},
        devices={"door": {"name": "Laundry Door"}},
        entity_devices={"binary_sensor.door": "door", "sensor.door_battery": "door"})
    path = str(tmp / "pack.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(pack.to_json())
    asleep.save(path, ["binary_sensor.door"] if listed else [])
    r = subprocess.run([sys.executable, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "nightly.py"),
                        "--pack", path, "--store", str(tmp / "s.sqlite"), "--fixture-dir", str(fx), "--skip-raw",
                        "--as-of", "2026-10-03", "--out", str(tmp / "res.json")],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH})
    assert r.returncode == 0, r.stderr
    from vesta_shared.store import Store
    return {f["rule_id"] for f in Store(str(tmp / "s.sqlite")).findings("open")}


def test_a_sleeping_door_sensor_s_battery_is_judged_on_its_last_real_charge(tmp_path):
    # architecture review, 2026-10-21: asleep at 02:00 every night, its battery read "unavailable" and was never judged
    assert "PM-BATTERY-CRIT" in _night_of_a_sleeping_door(tmp_path / "a", listed=True)
    # not listed: "unavailable" is what it reads (an offline device, not a charge)
    assert "PM-BATTERY-CRIT" not in _night_of_a_sleeping_door(tmp_path / "b", listed=False)


def test_an_open_offline_fault_of_a_device_hidden_since_closes_saying_so(tmp_path, monkeypatch):
    # architecture review, 2026-10-21: hidden, it stayed until 02:00, then closed "Cleared" while still off
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import recheck
    from vesta_shared.store import Store
    store = Store(str(tmp_path / "s.sqlite"))
    fid, _ = store.raise_finding("PM-UNAVAILABLE", "switch.old_plug", "availability", "2026-10-09", "P3",
                                 "Old Plug has been offline for 2 h.", {"entities": ["switch.old_plug"]})
    keep, _ = store.raise_finding("PM-UNAVAILABLE", "switch.spa_relay", "availability", "2026-10-09", "P3",
                                  "Spa Relay has been offline for 2 h.", {"entities": ["switch.spa_relay"]})
    pack = _pack(hidden=["switch.old_plug"])

    class Cli:
        def states(self, ids):
            return {e: {"state": "unavailable", "last_changed": NOW.isoformat()} for e in ids}

        def not_found(self, ids):
            return set()
    res = recheck.back_online(store, lambda: Cli(), NOW, 5, "UTC", pack)
    assert res["closed"] == [fid]                                     # the one watched and still off stays open
    assert recheck.HIDDEN_NOTE.startswith("Closed: this device is hidden")
    assert [f["id"] for f in store.findings("open")] == [keep]


def test_the_weekly_report_reads_a_sleeping_device_s_last_real_charge(monkeypatch):
    # its battery table: a door sensor asleep when the report is made still has its line
    import importlib.util
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "reports", "scripts"))
    from types import SimpleNamespace
    spec = importlib.util.spec_from_file_location("facts", os.path.join(STARTER_SKILLS, "reports", "scripts", "facts.py"))
    facts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(facts)
    pack = _pack()
    pack.asleep_are(["sensor.lone_battery"])

    class Cli:
        def states(self, ids):
            return {"sensor.lone_battery": {"state": "unavailable", "last_changed": NOW.isoformat()}}

        def history(self, ids, start, end):
            return {"sensor.lone_battery": [{"state": "41", "last_changed": "2026-10-09T09:00:00+00:00"},
                                            {"state": "unavailable", "last_changed": NOW.isoformat()}]}
    c = SimpleNamespace(_states=None, cfg={"offline_families": []}, pack=pack, cli=Cli(), now=NOW)
    assert facts.Ctx.states(c)["sensor.lone_battery"]["state"] == "41"


def test_an_investigation_never_calls_a_sensor_with_no_value_silent(monkeypatch):
    # a wind chill with nothing to give for 6 hours on a still afternoon: shown, never "it stops reporting"
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "investigate", "scripts"))
    import investigate
    t = datetime(2026, 10, 9, 13, tzinfo=timezone.utc)
    p = {"kind": "no value", "start": t, "end": t + timedelta(hours=6), "seconds": 6 * 3600.0}
    (got,) = investigate._notable([p], {}, None)
    assert "why" not in got and "alert" not in got
    (got,) = investigate._notable([{**p, "kind": "offline"}], {}, None)
    assert "stopped reporting" in got["why"]
