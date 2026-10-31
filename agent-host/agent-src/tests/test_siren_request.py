"""The siren's request as the owner reads it (owner's Telegram, 2026-10-31 00:19): "Intrusion suspected: 2 independent
sensors in 5min while the villa is empty: binary_sensor.parking_motion, lock.outdoor_entrance_lock. Look at the snapshot."
— no snapshot came, the devices were named by their ids, and it was the owner arriving home: the "empty" sensor went off
3 seconds after the alert, the request stayed pressable for 15 minutes. Invented entities."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
from datetime import datetime, timedelta, timezone

import pytest

from ha_fake import FakeHA, tool
from helpers import STARTER_SKILLS, make_agent
from vesta_shared import kiosk_told
from vesta_shared import result as R
from vesta_shared.knowledge_pack import build_pack
from vesta_shared.store import Store

spec = importlib.util.spec_from_file_location("desk", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

T0 = datetime(2026, 10, 1, 22, 0, tzinfo=timezone.utc)
OWNER = 111
EMPTY_SENSOR = "binary_sensor.example_villa_empty"
SIREN = "switch.example_siren"
CAMERA = "camera.example_drive"
PG = dict(blueprint="critical_presence_guard", rule="automation.critical_presence_guard_night")
REGISTRY = {"areas": [{"area_id": "drive", "name": "Drive"}, {"area_id": "hall", "name": "Hall"}],
            "entities": [{"entity_id": "binary_sensor.example_drive_motion", "name": "Drive Motion", "area_id": "drive",
                          "device_class": "motion"},
                         {"entity_id": "lock.example_entrance", "name": "Entrance Lock", "area_id": "hall"},
                         {"entity_id": CAMERA, "name": "Drive Camera", "area_id": "drive"}]}


def run(coro):
    return asyncio.run(coro)


def event(entity, started, **extra):
    rule = PG["rule"]
    return {"blueprint": PG["blueprint"], "rule_id": rule, "incident_id": f"{rule}-{started}", "phase": "opened",
            "severity": "critical", "label": "Presence while empty", "entities": [entity],
            "summary": "Presence while empty", "timestamp": T0.isoformat(), **extra}


@pytest.fixture
def pack(tmp_path, monkeypatch):
    path = str(tmp_path / "pack.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(build_pack(REGISTRY, []).to_json())
    monkeypatch.setenv("VESTA_PACK", path)
    desk._PACK.clear()
    yield path
    desk._PACK.clear()


def two_signals(store, first="binary_sensor.example_drive_motion", second="lock.example_entrance", **extra):
    desk.intake(store, event(first, 1, **extra), T0, occupancy_reader=lambda: "empty")
    return desk.intake(store, event(second, 2), T0 + timedelta(minutes=1), occupancy_reader=lambda: "empty")["siren_gate"]


# ---------------------------------------------------------------------- the desk: what the request says
def test_the_request_names_the_devices_and_the_camera_that_can_show_them(tmp_path, pack):
    gate = two_signals(Store(str(tmp_path / "s.sqlite")))
    assert gate["armed"] is True
    assert "Drive Motion, Entrance Lock" in gate["prompt"]
    assert "binary_sensor." not in gate["prompt"] and "lock." not in gate["prompt"]          # never an entity id
    # the camera the villa's system places in the area of a signal: its picture goes first, then the words to look
    assert gate["cameras"] == [CAMERA] and gate["seen"] and "snapshot" not in gate["prompt"]


def test_an_alerts_own_snapshot_comes_first(tmp_path, pack):
    gate = two_signals(Store(str(tmp_path / "s.sqlite")), snapshot="camera.example_porch")
    assert gate["cameras"] == ["camera.example_porch", CAMERA]


def test_no_camera_no_picture_mentioned(tmp_path, monkeypatch):
    # no knowledge pack (no area known) and no alert naming a camera: the request never speaks of a picture
    monkeypatch.delenv("VESTA_PACK", raising=False)
    desk._PACK.clear()
    gate = two_signals(Store(str(tmp_path / "s.sqlite")))
    desk._PACK.clear()
    assert gate["armed"] is True and gate["cameras"] == [] and gate["seen"] == ""
    assert "snapshot" not in gate["prompt"].lower() and "picture" not in gate["prompt"].lower()
    assert "binary_sensor." not in gate["prompt"] and "Presence while empty" in gate["prompt"]  # its alert's name


# ---------------------------------------------------------------------- the engine: asked, pressed, withdrawn
class Writer:
    def __init__(self):
        self.calls = []

    def call_service(self, *a):
        self.calls.append(a)

    def states(self, ids):
        return {i: {"state": "on"} for i in ids}


def villa(tmp_path, empty="on", images=None):
    states = {EMPTY_SENSOR: {"entity_id": EMPTY_SENSOR, "state": empty}}
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "JM", "role": "owner"}], "act_enabled": True,
                              "siren_entity": SIREN, "allowed_services": {"switch.turn_on": "owner"}},
                   reader=FakeHA(tools=[tool("ha_get_state")], states=states, images=images or {}))
    with open(v.s.pack_path, "w", encoding="utf-8") as f:
        f.write(build_pack(REGISTRY, []).to_json())
    kiosk_told.save(v.s.pack_path, "villaEmptySensor", EMPTY_SENSOR)              # the Kiosk's pick, as its heartbeat answer keeps it
    v.actions.writer_factory = Writer
    return v


def gate(cameras=(CAMERA,)):
    return R.siren(True, "Intrusion suspected: Drive Motion, Entrance Lock.", ("owner", "fm"), cameras=list(cameras),
                   seen="Look at the camera picture above first." if cameras else "")


def requests(v):
    return [(c, t, kb) for c, t, kb in v.tg.sent if t.startswith("Approval request")]


def test_the_picture_goes_before_the_question_and_only_then_is_it_mentioned(tmp_path):
    v = villa(tmp_path, images={CAMERA: "SlBFRw=="})
    run(v.outcome.carry_out({"siren_gate": gate()}, "alert-desk"))
    assert v.tg.photos and v.tg.photos[0][0] == OWNER
    order = [t.split("\n", 1)[0] for _, t, _ in v.tg.sent]
    assert order.index("Camera snapshot") < order.index("Approval request")
    (_, text, _), = requests(v)
    assert "Look at the camera picture above first." in text


def test_a_camera_that_gives_no_picture_is_never_mentioned(tmp_path):
    v = villa(tmp_path)                                      # the camera answers with no image
    run(v.outcome.carry_out({"siren_gate": gate()}, "alert-desk"))
    (_, text, _), = requests(v)
    assert not v.tg.photos and "picture" not in text and "snapshot" not in text.lower()


def test_someone_home_before_the_question_it_is_not_asked(tmp_path):
    v = villa(tmp_path, empty="off")
    run(v.outcome.carry_out({"siren_gate": gate()}, "alert-desk"))
    assert requests(v) == [] and not v.state.approvals_in("pending")


def _asked(v):
    run(v.outcome.carry_out({"siren_gate": gate(())}, "alert-desk"))
    (ap,) = v.state.approvals_in("pending")
    return ap


def test_approve_pressed_after_someone_came_home_never_sounds_the_siren(tmp_path):
    v = villa(tmp_path)
    ap = _asked(v)
    v.reader._states[EMPTY_SENSOR]["state"] = "off"           # the owner's phone came home
    out = v.actions.decide(ap["id"], OWNER, True, chat=OWNER)
    assert out["state"] == "withdrawn" and out["executed"] is False
    assert v.state.approval(ap["id"])["status"] == "withdrawn" and v.state.siren_stop() is None


def test_a_waiting_request_is_withdrawn_once_someone_is_home_and_every_copy_says_why(tmp_path):
    v = villa(tmp_path)
    ap = _asked(v)
    assert run(v.approvals.expire()) == 0                     # still empty: it waits
    v.reader._states[EMPTY_SENSOR]["state"] = "off"
    assert run(v.approvals.expire()) == 1
    assert v.state.approval(ap["id"])["status"] == "withdrawn"
    edited = [t for _, _, t in v.tg.edits][-1]
    assert "Withdrawn on " in edited and "the villa is no longer empty. Nothing was done." in edited


def test_a_request_a_person_asked_is_never_withdrawn(tmp_path):
    # only the siren's gate is asked "while empty": the owner asking for the siren themselves is their own decision
    v = villa(tmp_path, empty="off")
    _, msg = v.actions.request("switch", "turn_on", SIREN, {}, None, None)
    run(v.approvals.ask(msg))
    assert run(v.approvals.expire()) == 0 and v.state.approval(msg.approval_id)["status"] == "pending"
    assert json.loads(json.dumps(v.state.approval(msg.approval_id)["action"])).get("while_empty") is None


# ---------------------------------------------------------------------- the siren is always the owner's to approve
FM = 222


def rules_villa(tmp_path, rule, extra=None):
    """A villa whose rules give switch.turn_on `rule`, the siren NOT in its owner-only list; the pack knows the siren on
    one device with its plug, and a scene that sets it."""
    states = {"scene.example_alarm": {"entity_id": "scene.example_alarm", "state": "scening",
                                      "attributes": {"entity_id": [SIREN]}}}
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "JM", "role": "owner"},
                                         {"telegram_id": FM, "name": "Fabien", "role": "fm"}],
                              "act_enabled": True, "siren_entity": SIREN,
                              "allowed_services": {"switch.turn_on": rule, "scene.turn_on": "direct", **(extra or {})}},
                   reader=FakeHA(tools=[tool("ha_get_state")], states=states))
    reg = {"entities": [{"entity_id": SIREN, "device_id": "dev_siren"},
                        {"entity_id": "switch.example_siren_plug", "device_id": "dev_siren"},
                        {"entity_id": "scene.example_alarm"}]}
    with open(v.s.pack_path, "w", encoding="utf-8") as f:
        f.write(build_pack(reg, []).to_json())
    v.actions.writer_factory = Writer
    return v


def test_a_direct_rule_still_asks_the_owner_before_the_siren(tmp_path):
    v = rules_villa(tmp_path, "direct")
    jm = v.policy().person(OWNER)
    answer, msg = v.actions.request("switch", "turn_on", SIREN, {}, jm, OWNER)
    assert msg is not None and "Approval requested from the owner" in answer
    assert v.state.approval(msg.approval_id)["required_role"] == "owner"
    # the same through its plug (one device) and a scene that sets it: asked of the owner, never run at once
    for domain, eid in (("switch", "switch.example_siren_plug"), ("scene", "scene.example_alarm")):
        answer, msg = v.actions.request(domain, "turn_on", eid, {}, jm, OWNER)
        assert msg is not None and "Approval requested from the owner" in answer, (eid, answer)


def test_an_any_rule_lets_only_the_owner_approve_the_siren(tmp_path):
    v = rules_villa(tmp_path, "any")
    _, msg = v.actions.request("switch", "turn_on", SIREN, {}, None, None)
    run(v.approvals.ask(msg))
    out = v.actions.decide(msg.approval_id, FM, True, chat=FM)
    assert out["state"] is None and out["toast"] == "Only the owner can approve this."
    assert v.state.approval(msg.approval_id)["status"] == "pending"
