"""The villa's status as the AI is given it (owner, 2026-10-10: "what's the status of the villa now?" got "everything
ok" while three pump devices were offline): every reason named, given before each answer, never left to the AI."""
from __future__ import annotations

import asyncio
import os
import sys

from ai_fake import FakeAI
from helpers import STARTER_SKILLS, make_agent, make_skill
from vesta_agent.roster import Roster

sys.path.insert(0, os.path.join(STARTER_SKILLS, "villa-concierge", "scripts"))

OWNER, OWNER_CHAT = 111, -1001


def _pack():
    from vesta_shared.knowledge_pack import KnowledgePack
    rows = [{"entity_id": "sensor.jacuzzi_pump_power", "name": "Jacuzzi Pump Power", "device_id": "plug1", "asset": "jacuzzi_pump"},
            {"entity_id": "sensor.jacuzzi_pump_energy", "name": "Jacuzzi Pump Energy", "device_id": "plug1", "asset": "jacuzzi_pump"},
            {"entity_id": "sensor.jet_pump_power", "name": "Jet Pump Power", "device_id": "plug2", "asset": "jet_pump"},
            {"entity_id": "sensor.pool_pump_power", "name": "Pool Pump Power", "device_id": "plug3", "asset": "pool_pump"}]
    return KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None,
                         families={"power": [r for r in rows if r["entity_id"].endswith("power")],
                                   "energy": [r for r in rows if r["entity_id"].endswith("energy")]},
                         assets={"jacuzzi_pump": {}, "jet_pump": {}, "pool_pump": {}}, areas=[], people=[], channels={},
                         unknown_area=[], unclassified=[], retention={},
                         devices={"plug1": {"name": "Jacuzzi pump plug"}, "plug2": {"name": "Jet pump plug"},
                                  "plug3": {"name": "Pool pump plug"}})


def test_every_offline_device_is_named_once_and_never_green(tmp_path):
    # an offline pump was a "Watch" line per SENSOR, cut at six; open problems were a count; a problem alone left the
    # villa green
    import concierge
    from vesta_shared.store import Store
    store = Store(str(tmp_path / "s.sqlite"))
    states = {"sensor.jacuzzi_pump_power": {"state": "unavailable"}, "sensor.jacuzzi_pump_energy": {"state": "unavailable"},
              "sensor.jet_pump_power": {"state": "unavailable"}, "sensor.pool_pump_power": {"state": "0.0"}}
    s = concierge.status(_pack(), states, store)
    assert s["colour"] == "amber" and s["offline"] == ["Jacuzzi pump plug", "Jet pump plug"]       # once each, by device
    assert "Offline (2): Jacuzzi pump plug; Jet pump plug" in s["text"]
    store.raise_finding("PM-RUNHOURS", "sensor.pool_pump_power", "power", "2026-10-09", "P3",
                        "Pool pump ran 7.3 h of 14.0 h yesterday", {})
    calm = concierge.status(_pack(), {"sensor.pool_pump_power": {"state": "0.0"}}, store)
    assert calm["colour"] == "amber"                                                             # never green with it open
    assert "Open problems (1): Pool pump ran 7.3 h of 14.0 h yesterday" in calm["text"]          # named, not counted
    store.close_finding("PM-RUNHOURS", "sensor.pool_pump_power", "2026-10-10")
    assert concierge.status(_pack(), {"sensor.pool_pump_power": {"state": "0.0"}}, store)["colour"] == "green"


def test_the_ai_is_given_the_check_before_every_answer(tmp_path, monkeypatch):
    # the AI took one quick look and answered "everything ok": the check is now in front of it, whatever it chooses
    v = make_agent(tmp_path, {}, roster=Roster.of(owner=[(OWNER, "Owner"), (OWNER_CHAT, "Owner chat")]))
    make_skill(v.s.skills_dir, "lookout", {"description": "x", "before_answer": "look.py",
                                           "scripts": {"look.py": {}}},
               {"look.py": "import json; print(json.dumps({'text': 'V: AMBER\\nOffline (1): Jacuzzi pump plug'}))\n"})
    ai = FakeAI("V is amber: the Jacuzzi pump plug is offline.").install(monkeypatch)
    asyncio.run(v.converse(OWNER_CHAT, v.policy().roster.person(OWNER), "what's the status of the villa now?"))
    (run,) = ai.runs
    assert "Checked just now by the lookout skill" in run["prompt"] and "Offline (1): Jacuzzi pump plug" in run["prompt"]
    # a check that cannot run is said, never silently left out
    with open(os.path.join(v.s.skills_dir, "lookout", "scripts", "look.py"), "w") as f:
        f.write("import sys; sys.exit(3)\n")
    asyncio.run(v.converse(OWNER_CHAT, v.policy().roster.person(OWNER), "and now?"))
    assert "check could not run just now" in ai.runs[-1]["prompt"]


def test_the_status_says_whether_the_villa_is_empty_from_the_kiosks_pick(tmp_path, monkeypatch):
    """Architecture review round 7, card 2: the concierge answers "is the villa empty?" from the sensor the Kiosk picked
    (vesta_shared.occupancy.sensor), the one the siren reads, given in the status before every answer."""
    import concierge
    from vesta_shared import kiosk_told
    from vesta_shared.store import Store
    monkeypatch.setenv("VESTA_PACK", str(tmp_path / "pack.json"))
    store = Store(str(tmp_path / "s.sqlite"))
    states = {"sensor.pool_pump_power": {"state": "0.0"}, "binary_sensor.example_empty": {"state": "on"}}
    s = concierge.status(_pack(), states, store)
    assert s["villa_empty"] == "unknown" and "Villa empty: cannot tell (no sensor picked in the VESTA Kiosk's " \
        "Settings › Villa)" in s["text"]
    kiosk_told.save(str(tmp_path / "pack.json"), "villaEmptySensor", "binary_sensor.example_empty")
    s = concierge.status(_pack(), states, store)
    assert s["villa_empty"] == "empty" and "Villa empty: yes (binary_sensor.example_empty)" in s["text"]
