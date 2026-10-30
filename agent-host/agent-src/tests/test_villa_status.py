"""The villa's status as the AI is given it (owner, 2026-10-10: "what's the status of the villa now?" got "everything
ok" while three pump devices were offline): every reason named, given before each answer, never left to the AI."""
from __future__ import annotations

import asyncio
import os
import sys

from ai_fake import FakeAI
from helpers import STARTER_SKILLS, make_agent, make_skill

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
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner"}],
                              "chats": {"owner": OWNER_CHAT}})
    make_skill(v.s.skills_dir, "lookout", {"description": "x", "before_answer": "look.py",
                                           "scripts": {"look.py": {}}},
               {"look.py": "import json; print(json.dumps({'text': 'V: AMBER\\nOffline (1): Jacuzzi pump plug'}))\n"})
    ai = FakeAI("V is amber: the Jacuzzi pump plug is offline.").install(monkeypatch)
    asyncio.run(v.converse(OWNER_CHAT, v.policy().person(OWNER), "what's the status of the villa now?"))
    (run,) = ai.runs
    assert "Checked just now by the lookout skill" in run["prompt"] and "Offline (1): Jacuzzi pump plug" in run["prompt"]
    # a check that cannot run is said, never silently left out
    with open(os.path.join(v.s.skills_dir, "lookout", "scripts", "look.py"), "w") as f:
        f.write("import sys; sys.exit(3)\n")
    asyncio.run(v.converse(OWNER_CHAT, v.policy().person(OWNER), "and now?"))
    assert "check could not run just now" in ai.runs[-1]["prompt"]


def test_the_villa_concierge_skill_asks_for_its_status_before_every_answer():
    from vesta_agent.skills import parse_skill
    sk = parse_skill("villa-concierge", os.path.join(STARTER_SKILLS, "villa-concierge"))
    assert sk.before_answer == "concierge.py status"


def test_a_device_on_the_villas_critical_list_offline_is_red_the_others_amber(tmp_path):
    # owner, 2026-10-18: the one list is the villa's "critical devices offline" rule's — a relay listed, its plug's
    # power sensor dropping with it, is red "Now"; a pump plug not listed stays amber "Offline"
    import concierge
    from vesta_shared.store import Store
    pack = _pack()
    pack.critical = ["switch.jacuzzi_relay"]
    pack.entity_devices = {"switch.jacuzzi_relay": "plug1"}
    states = {"sensor.jacuzzi_pump_power": {"state": "unavailable"}, "sensor.jet_pump_power": {"state": "unavailable"}}
    s = concierge.status(pack, states, Store(str(tmp_path / "s.sqlite")))
    assert s["colour"] == "red" and s["problems"] == ["Jacuzzi pump plug offline"] and s["offline"] == ["Jet pump plug"]


def test_the_status_before_an_answer_reads_no_history(tmp_path, monkeypatch, capsys):
    # owner, 2026-10-30: a spoken "turn on the gym light" waited 41.5 s on this check, which read since when each
    # offline device went, device by device, for lines that never say how long: the status reads the states only
    import json
    import concierge
    from fixture_client import FixtureClient
    pack = str(tmp_path / "pack.json")
    with open(pack, "w", encoding="utf-8") as f:
        f.write(_pack().to_json())
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {
        "sensor.jacuzzi_pump_power": {"state": "unavailable", "last_changed": "2026-10-20T00:00:00+00:00"},
        "sensor.pool_pump_power": {"state": "0.0", "last_changed": "2026-10-20T00:00:00+00:00"}}}))
    read = []
    monkeypatch.setattr(FixtureClient, "history", lambda self, ids, start, end: read.append(list(ids)) or {})
    concierge.main(["status", "--pack", pack, "--store", str(tmp_path / "s.sqlite"), "--fixture-dir", str(fx)])
    assert "Offline (1): Jacuzzi pump plug" in json.loads(capsys.readouterr().out)["text"]
    assert read == []
