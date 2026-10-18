"""The villa's critical devices: ONE list, the one its "critical devices offline" rule watches (owner, 2026-10-18 —
architecture review, offline devices #2). Synthetic villa; ids invented."""
from __future__ import annotations

import json
import os
import subprocess
import sys

from helpers import PYTHONPATH
from vesta_shared import critical as C
from vesta_shared.ha_client import McpClient
from vesta_shared.knowledge_pack import KnowledgePack, build_pack

CONTRACT = os.path.join(os.path.dirname(__file__), "..", "..", "rootfs", "opt", "vesta", "host", "agent-contract.json")


def rule(entities, path="critical_watchdog.yaml"):
    return {"alias": "x", "use_blueprint": {"path": path, "input": {"critical_entities": entities}}}


def test_the_list_is_every_rule_built_from_the_blueprint_whatever_its_folder():
    configs = [rule(["lock.example_door", "switch.example_relay"]), rule("sensor.example_meter", "vesta/critical_watchdog.yaml"),
               rule(["lock.example_other"], "critical_condition.yaml"), {"alias": "no blueprint"}]
    assert C.critical_entities(configs) == {"lock.example_door", "switch.example_relay", "sensor.example_meter"}


def test_the_agent_and_the_kiosk_read_the_same_rule():
    # the agreement's criticalDevices (the Kiosk's file, copied): the Kiosk's Cockpit and the Agent agree on the list
    agreed = json.load(open(CONTRACT))["criticalDevices"]
    assert (C.BLUEPRINT, C.INPUT) == (agreed["blueprint"], agreed["input"])


def _pack(critical):
    reg = {"entities": [{"entity_id": "switch.example_relay", "device_id": "plug"},
                        {"entity_id": "sensor.example_pump_power", "device_id": "plug", "unit_of_measurement": "W",
                         "device_class": "power", "state_class": "measurement"},
                        {"entity_id": "sensor.example_th_humidity", "device_id": "th", "device_class": "humidity",
                         "unit_of_measurement": "%", "state_class": "measurement"}]}
    return build_pack(reg, [], {}, critical=critical)


def test_a_device_is_critical_by_any_of_its_entities_on_the_list():
    p = _pack(["switch.example_relay"])
    assert p.is_critical("switch.example_relay") and p.is_critical("sensor.example_pump_power")   # the same plug
    assert not p.is_critical("sensor.example_th_humidity") and not p.is_critical(None)
    # nothing is critical for what it is: a villa without the rule has none
    assert not any(_pack([]).is_critical(e) for e in ("switch.example_relay", "sensor.example_pump_power"))
    assert KnowledgePack(**json.loads(p.to_json())).critical == ["switch.example_relay"]      # kept in the pack


def _build(tmp_path, fx_files):
    fx = tmp_path / "fx"
    fx.mkdir(exist_ok=True)
    for name, body in fx_files.items():
        (fx / name).write_text(json.dumps(body))
    r = subprocess.run([sys.executable, "-m", "vesta_shared.build_pack", "--out", str(tmp_path / "pack.json"),
                        "--fixture-dir", str(fx)], capture_output=True, text=True, timeout=60,
                       env={**os.environ, "PYTHONPATH": PYTHONPATH})
    assert r.returncode == 0, r.stderr
    return KnowledgePack.load(str(tmp_path / "pack.json")), r.stderr


def test_the_nightly_pack_reads_the_list_from_the_villas_rule_and_keeps_it_when_unreadable(tmp_path):
    reg = {"entities": [{"entity_id": "lock.example_door", "device_id": "d1"}]}
    p, _ = _build(tmp_path, {"registry.json": reg, "automations.json": [rule(["lock.example_door"])]})
    assert p.critical == ["lock.example_door"]
    # the villa's system not readable: the last list, said, never an empty one (every device amber till the night)
    p, err = _build(tmp_path, {"automations.json": {"broken": True}})
    assert p.critical == ["lock.example_door"] and "could not be read" in err


class _Mcp:
    """ha-mcp as far as the search and the automation reads go: two pages of hits, one config each."""
    def __init__(self):
        self.calls = []

    def call_raw(self, name, args):
        self.calls.append((name, args.get("offset", args.get("identifier"))))
        if name == "ha_search":
            page = {0: {"automations": [{"entity_id": "automation.a"}], "config_has_more": True, "config_next_offset": 1},
                    1: {"automations": [{"entity_id": "automation.b"}, {"entity_id": "automation.a"}],
                        "config_has_more": False}}[args["offset"]]
            body = {"success": True, **page}
        else:
            body = {"success": True, "config": rule([f"lock.example_{args['identifier'][-1]}"])}
        return {"content": [{"type": "text", "text": json.dumps(body)}]}


def test_the_villas_rules_are_read_on_past_the_first_page_once_each():
    mcp = _Mcp()
    got = McpClient(session=mcp).automation_configs(C.BLUEPRINT)
    assert C.critical_entities(got) == {"lock.example_a", "lock.example_b"}
    assert [c for c in mcp.calls if c[0] == "ha_config_get_automation"] == [
        ("ha_config_get_automation", "automation.a"), ("ha_config_get_automation", "automation.b")]
