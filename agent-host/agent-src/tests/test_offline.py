"""The devices offline now — one reading (vesta_shared.offline.devices_offline) with three callers: the night check and
recheck.py, the reports' monitoring table, the concierge's status (architecture review round 3, 2026-10-19: three walks,
three groupings, three family lists)."""
from __future__ import annotations

import os
import re
import sys
from datetime import datetime, timedelta, timezone

from helpers import STARTER_SKILLS
from vesta_shared.knowledge_pack import KnowledgePack
from vesta_shared.offline import devices_offline

NOW = datetime(2026, 10, 9, 12, 0, tzinfo=timezone.utc)


def _row(eid, name, dev, fam, asset=None, platform="shelly"):
    return {"entity_id": eid, "name": name, "device_id": dev, "asset": asset or eid.split(".")[1], "family": fam,
            "platform": platform}


def _pack(**kw):
    fams = {"power": [_row("sensor.spa_pump_power", "Spa Pump Power", "plug", "power", "spa"),
                      _row("sensor.jet_pump_power", "Jet Pump Power", "plug", "power", "jet"),
                      _row("sensor.pool_pump_power", "Pool Pump Power", "plug2", "power", "pool")],
            "switch": [_row("switch.spa_relay", "Spa Relay", "plug", "switch", "spa")],
            "network": [_row("sensor.rx", "RX", "phone", "network", platform="unifi"),
                        _row("sensor.ap_rx", "AP RX", "ap", "network", platform="unifi")],
            "battery": [_row("sensor.lone_battery", "Lone Battery", None, "battery")],
            "level": [_row("sensor.tank", "Tank", "tank", "level", platform="zigbee"),
                      _row("sensor.tank2", "Tank 2", "tank2", "level", platform="zigbee"),
                      _row("sensor.tank3", "Tank 3", "tank3", "level", platform="zigbee")]}
    return KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None, families=fams,
                         assets={"spa": {"slug": "spa", "name": "Spa pump"}}, areas=[], people=[], channels={}, unknown_area=[],
                         unclassified=[], retention={},
                         devices={"plug": {"name": "Spa Plug", "manufacturer": "Shelly", "model": "Plus 1PM"},
                                  "plug2": {"name": "Pool Plug"}, "phone": {"name": "", "manufacturer": "", "model": ""},
                                  "ap": {"name": "", "manufacturer": "Ubiquiti", "model": "U6 Lite"}}, **kw)


def _off(hours):
    return {"state": "unavailable", "last_changed": (NOW - timedelta(hours=hours)).isoformat()}


STATES = {"sensor.spa_pump_power": _off(3), "sensor.jet_pump_power": _off(5), "switch.spa_relay": _off(4),
          "sensor.pool_pump_power": {"state": "unknown", "last_changed": NOW.isoformat()},
          "sensor.rx": _off(1), "sensor.ap_rx": _off(2), "sensor.lone_battery": {"state": "unavailable"},
          "sensor.tank": _off(0.1), "sensor.tank2": _off(0.2), "sensor.tank3": _off(0.05)}


def test_one_device_per_group_named_as_the_villa_names_it_since_its_first_entity_went():
    got = {g.name: g for g in devices_offline(_pack(critical=["switch.spa_relay"]), STATES, NOW,
                                             ["power", "switch", "network", "battery"])}
    # the plug is ONE group under its own name, since its first entity went (the earliest), critical for its relay
    assert set(got) == {"Spa Plug", "Unnamed Ubiquiti U6 Lite", "Lone Battery"}, sorted(got)
    plug = got["Spa Plug"]
    assert plug.entity_ids == ["sensor.spa_pump_power", "sensor.jet_pump_power", "switch.spa_relay"]
    assert plug.names == ["Spa Pump Power", "Jet Pump Power", "Spa Relay"] and plug.entity_id == "sensor.spa_pump_power"
    assert plug.since == NOW - timedelta(hours=5) and plug.hours == 5 and plug.critical is True and plug.family == "power"
    assert plug.label == "Spa Plug" and plug.asset == "spa" and plug.asset_name == "Spa pump" and plug.platform == "shelly"
    # "unknown" is not offline; a nameless Wi-Fi client is not the villa's; a sensor with no device keeps its own group
    assert "Pool Plug" not in got and "RX" not in got
    assert got["Lone Battery"].since is None and got["Lone Battery"].hours is None and got["Lone Battery"].key == "shelly:lone_battery"
    assert got["Unnamed Ubiquiti U6 Lite"].critical is False
    # a pack built before devices were kept: named by its asset, else its first entity, and still one group per device
    old = _pack(critical=[])
    old.devices = {}
    names = [g.name for g in devices_offline(old, STATES, NOW, ["power", "switch", "network", "battery"])]
    assert names == ["Spa pump", "RX", "AP RX", "Lone Battery"]


def test_the_callers_minimum_the_alerted_devices_and_the_integration_are_the_callers_own():
    pack = _pack(critical=[])
    fams = ["power", "switch", "network", "battery", "level"]
    # with no minimum every one, a device whose time is not known included; with one, only those off that long
    assert len(devices_offline(pack, STATES, NOW, fams)) == 6
    assert [g.name for g in devices_offline(pack, STATES, NOW, fams, min_minutes=90)] == \
        ["Spa Plug", "Unnamed Ubiquiti U6 Lite"]
    # a device an open alert follows (its physical device, else its entity) is left out
    assert [g.name for g in devices_offline(pack, STATES, NOW, fams, alerted=frozenset({"plug", "sensor.lone_battery"}),
                                            min_minutes=0)] == ["Unnamed Ubiquiti U6 Lite", "Tank", "Tank 2", "Tank 3"]
    # three zigbee devices offline together: one group, the integration down, standing for each of them
    (zig,) = [g for g in devices_offline(pack, STATES, NOW, fams, integration_min=3) if g.integration]
    assert zig.integration == "zigbee" and zig.entity_ids == ["sensor.tank", "sensor.tank2", "sensor.tank3"]
    assert zig.names == ["Tank", "Tank 2", "Tank 3"] and zig.hours == 0.2 and zig.since == NOW - timedelta(hours=0.2)
    assert zig.key == "zigbee" and zig.label is None and zig.critical is False
    assert [g.name for g in devices_offline(pack, STATES, NOW, fams, integration_min=4) if g.integration] == []
    # the minimum applies to the merged group: an integration down 12 minutes passes a 10-minute minimum
    assert [g.key for g in devices_offline(pack, STATES, NOW, ["level"], integration_min=3, min_minutes=10)] == ["zigbee"]
    assert [g.name for g in devices_offline(pack, STATES, NOW, ["level"], min_minutes=10)] == ["Tank 2"]   # 12min, alone


def test_the_three_callers_name_their_families_side_by_side():
    # ⚠️ THREE LISTS (architecture review round 3, 2026-10-19): the reports' reports.yaml, the night check's
    # WATCHED_FAMILIES and the concierge's FAMILIES each name their own families. Whether to make them one is the
    # owner's call; until then this test keeps the three in one place, so a change to one is read beside the others.
    import yaml
    reports = yaml.safe_load(open(os.path.join(STARTER_SKILLS, "reports", "reports.yaml")))["offline_families"]
    night = re.search(r'^WATCHED_FAMILIES = \((.*)\)$',
                      open(os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "nightly.py")).read(), re.M)
    chat = re.search(r'^FAMILIES = \((.*)\)$',
                     open(os.path.join(STARTER_SKILLS, "villa-concierge", "scripts", "concierge.py")).read(), re.M)
    assert night and chat
    night = [x.strip(' "') for x in night.group(1).split(",") if x.strip()]
    chat = [x.strip(' "') for x in chat.group(1).split(",") if x.strip()]
    assert reports == ["power", "energy", "battery", "security", "level", "network", "runtime"]
    assert night == ["power", "energy", "security", "level", "runtime", "water", "generation"]
    assert chat == ["security", "power", "energy", "runtime", "level", "battery"]
    assert set(night) - set(reports) == {"water", "generation"} and set(reports) - set(night) == {"battery", "network"}
    assert set(chat) <= set(reports)


def test_the_three_callers_read_the_one_reading(tmp_path):
    # the reports' table, the concierge's status and the night check's findings all come from devices_offline
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "villa-concierge", "scripts"))
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import concierge
    import facts
    import nightly
    from vesta_shared.store import Store
    from zoneinfo import ZoneInfo
    pack = _pack(critical=["switch.spa_relay"])
    c = facts.Ctx.__new__(facts.Ctx)
    c.pack, c.Z, c.now, c._states = pack, ZoneInfo("Asia/Makassar"), NOW, STATES
    c.cfg = {"offline_families": ["power", "switch"]}
    assert c.offline() == [{"name": "Spa Plug", "since": "2026-10-09T15:00", "critical": True, "family": "power",
                            "entity_id": "sensor.spa_pump_power"}]
    s = concierge.status(pack, STATES, Store(str(tmp_path / "s.sqlite")))
    assert s["colour"] == "red" and s["problems"] == ["Spa Plug offline"]
    assert s["offline"] == ["Lone Battery", "Tank", "Tank 2", "Tank 3"]      # its own families (level in, network out)
    from vesta_shared.params import VillaParams
    params = VillaParams(helpers=[], states={}, defaults={"unavailable_minutes": 10, "integration_down_devices": 3})
    found = nightly.offline_findings(pack, STATES, NOW, params)
    assert [(f.rule_id, f.entity_id, f.summary) for f in found] == [
        ("PM-UNAVAILABLE", "sensor.spa_pump_power", "Spa Plug has been offline for 5h."),
        ("PM-UNAVAILABLE", "sensor.tank", "zigbee integration (3 devices) has been offline for 12min.")]
    assert found[1].detail["entities"] == ["sensor.tank", "sensor.tank2", "sensor.tank3"]
    # the alert that follows the plug takes it; the integration still counts its three
    assert [f.entity_id for f in nightly.offline_findings(pack, STATES, NOW, params, {"plug"})] == ["sensor.tank"]
