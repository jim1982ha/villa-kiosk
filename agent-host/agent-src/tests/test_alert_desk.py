"""The alert desk fed with vesta_critical_event as Home Assistant fires it
(shape checked live on 2026-09-30; INTEGRATION-PLAN 6b). Invented entities."""
from __future__ import annotations

import importlib.util
import json
import os
from datetime import datetime, timedelta, timezone

import pytest

from helpers import PYTHONPATH, STARTER_SKILLS
from vesta_shared.store import Store

spec = importlib.util.spec_from_file_location("desk", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

T0 = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)


def event(blueprint="critical_condition", phase="opened", rule="automation.critical_condition_front_door",
          started=1790000000, entities=("lock.front_door",), label="Front door left unlocked", **extra):
    return {"blueprint": blueprint, "rule_id": rule, "incident_id": f"{rule}-{started}", "phase": phase,
            "severity": "critical", "label": label, "entities": list(entities),
            "summary": f"{label}\nFront door is unlocked", "timestamp": T0.isoformat(), **extra}


@pytest.fixture
def store(tmp_path):
    return Store(str(tmp_path / "store.sqlite"))


def test_opened_goes_to_the_fm_with_the_ladder_and_becomes_a_ticket(store):
    res = desk.intake(store, event(), T0, mode_reader=lambda: "occupied")
    assert res["decision"] == "new"
    fm = [s for s in res["send"] if s["to"] == "fm"]
    assert fm and fm[0]["keyboard"] is True and f"Incident #{res['incident_id']}" in fm[0]["text"]
    ticket = [a for a in res["actions"] if a["action"] == "ticket"]
    assert ticket and ticket[0]["entity_id"] == "lock.front_door" and ticket[0]["task_id"]
    assert not [s for s in res["send"] if s["to"] == "owner"]        # P2: the FM only


def test_resolved_closes_the_incident_and_its_ticket(store):
    iid = desk.intake(store, event(), T0, mode_reader=lambda: "occupied")["incident_id"]
    res = desk.intake(store, event(phase="resolved"), T0 + timedelta(minutes=20))
    assert res["decision"] == "resolved" and res["incident_id"] == iid
    assert store.incident(iid)["state"] == "resolved"
    assert [a for a in res["actions"] if a["action"] == "ticket.resolve"]
    assert "No reply needed" in res["send"][0]["text"]
    assert res["settle"] == [{"incident_id": iid, "note": "Cleared in Home Assistant, {time}. No reply needed."}]
    # the chase stops: no reminder for it any more
    assert desk.tick(store, T0 + timedelta(minutes=30))["reasked"] == []


def test_abandoned_escalates_to_the_owner(store):
    iid = desk.intake(store, event(), T0, mode_reader=lambda: "occupied")["incident_id"]
    res = desk.intake(store, event(phase="abandoned"), T0 + timedelta(hours=6))
    assert res["decision"] == "abandoned"
    assert store.incident(iid)["state"] == "escalated"
    assert res["send"][0]["to"] == "owner"


def test_an_opened_only_rule_closes_through_the_ladder(store):
    # critical_watchdog never sends "resolved": Done must close it
    ev = event(blueprint="critical_watchdog", rule="automation.critical_watchdog_devices",
               entities=("sensor.garden_probe",), label="Device offline")
    iid = desk.intake(store, ev, T0, mode_reader=lambda: "occupied")["incident_id"]
    res = desk.tick(store, T0 + timedelta(minutes=16))
    assert iid in res["reasked"]
    out = desk.reply(store, iid, "Done", "fm", T0 + timedelta(minutes=20))
    assert store.incident(iid)["state"] == "done"
    assert [a for a in out["actions"] if a["action"] == "ticket.resolve"]


def test_routing_by_blueprint(store):
    trip = desk.intake(store, event(blueprint="critical_binary_trip", rule="automation.critical_leak",
                                    entities=("binary_sensor.kitchen_leak",), label="Leak"), T0, mode_reader=lambda: "occupied")
    assert {s["to"] for s in trip["send"]} == {"owner", "fm"}            # P1: both chats


def test_a_repeat_inside_the_cooldown_is_counted_not_sent(store):
    desk.intake(store, event(started=1), T0, mode_reader=lambda: "occupied")
    res = desk.intake(store, event(started=2), T0 + timedelta(minutes=5), mode_reader=lambda: "occupied")
    assert res["decision"] == "counted" and res["send"] == []


def test_intrusion_arms_the_siren_gate_only_when_vacant_with_two_signals(store):
    pg = dict(blueprint="critical_presence_guard", rule="automation.critical_presence_guard_night")
    a = desk.intake(store, event(entities=("binary_sensor.garden_motion",), started=1, **pg), T0, mode_reader=lambda: "vacant")
    assert a["siren_gate"]["armed"] is False                               # one signal
    b = desk.intake(store, event(entities=("binary_sensor.gate_motion",), started=2, **pg),
                    T0 + timedelta(minutes=1), mode_reader=lambda: "vacant")
    assert b["siren_gate"]["armed"] is True
    c = desk.intake(Store(":memory:"), event(entities=("binary_sensor.gate_motion",), **pg), T0, mode_reader=lambda: "occupied")
    assert c["siren_gate"]["armed"] is False


def test_villa_silent_follows_the_engine_connection_beat(store):
    store.beat("ha_events", T0.isoformat())
    assert not desk.tick(store, T0 + timedelta(minutes=10))["send"]
    res = desk.tick(store, T0 + timedelta(minutes=40))
    assert any("Villa silent" in s["text"] for s in res["send"])
    store.beat("ha_events", (T0 + timedelta(minutes=41)).isoformat())
    res = desk.tick(store, T0 + timedelta(minutes=42))
    assert any("back online" in s["text"] for s in res["send"])


def test_the_desk_writes_no_home_assistant_helper(store):
    # 0.2.1 wrote input_datetime.vesta_last_run every tick; presence is the Kiosk heartbeat now
    res = desk.tick(store, T0)
    assert not [a for a in res["actions"] if a.get("action", "").startswith("helper")]


def test_the_cli_reads_an_event_file(tmp_path):
    import subprocess
    import sys
    p = tmp_path / "ev.json"
    p.write_text(json.dumps(event()))
    fx = tmp_path / "fx"                                             # the villa as a test sees it: one seam, no flags
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {"input_select.villa_mode": {"state": "Occupied"}}}))
    env = {**os.environ, "PYTHONPATH": PYTHONPATH}
    r = subprocess.run([sys.executable, os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"), "intake",
                        "--event", str(p), "--store", str(tmp_path / "s.sqlite"), "--fixture-dir", str(fx)],
                       capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["decision"] == "new"


def test_a_text_answer_settles_the_alerts_buttons_too(store):
    # "#2 done" typed in a chat: the alert and its reminders lose their buttons, like a press
    iid = desk.intake(store, event(), T0, mode_reader=lambda: "occupied")["incident_id"]
    res = desk.reply(store, iid, "done, it was the gardener", "fm", T0 + timedelta(minutes=5))
    assert res["settle"] == [{"incident_id": iid, "note": "Done — the facility manager, {time}"}]
    assert "settle" not in desk.reply(store, iid, "what happened?", "fm", T0 + timedelta(minutes=6))



def test_the_desk_reads_the_villas_parameters_kept_ten_minutes_and_never_crashes(tmp_path):
    # architecture review, 2026-10-07: in the villa the desk read its parameters from nowhere (only a test fixture),
    # so its maintenance mode and the villa's timings were never read
    from datetime import datetime, timedelta, timezone
    from vesta_shared.params import live_params
    from vesta_shared.store import Store
    store = Store(str(tmp_path / "s.sqlite"))
    calls = []

    class HA:
        def __init__(self, mode="on"):
            self.mode = mode

        def helpers(self):
            calls.append(1)
            return ([{"entity_id": "input_boolean.maintenance_mode", "helper_type": "input_boolean", "id": "maintenance_mode"}],
                    {"input_boolean.maintenance_mode": self.mode})
    t0 = datetime(2026, 10, 7, 1, 0, tzinfo=timezone.utc)
    assert live_params(HA, store, now=t0).boolean("maintenance_mode", default=False) is True
    live_params(HA, store, now=t0 + timedelta(minutes=5))
    assert len(calls) == 1                                                        # kept: not read again
    assert live_params(lambda: HA("off"), store, now=t0 + timedelta(minutes=11)).boolean("maintenance_mode", False) is False

    def down():
        raise RuntimeError("Home Assistant does not answer")
    assert live_params(down, store, now=t0 + timedelta(hours=2)).boolean("maintenance_mode", True) is False   # the last copy
    assert live_params(down, Store(str(tmp_path / "empty.sqlite")), defaults=desk.DEFAULTS).behaviour("reask_minutes") == 15  # the desk's own


def test_a_repeated_alert_says_since_when_in_the_villas_time(store, monkeypatch):
    # owner, 2026-10-07: "(4 times since 2026-10-03T00:00)" — UTC, written as a machine writes it
    desk.intake(store, event(), T0, mode_reader=lambda: "occupied", zone="Asia/Makassar")
    res = desk.intake(store, event(), T0 + timedelta(hours=6), mode_reader=lambda: "occupied", zone="Asia/Makassar")
    text = res["send"][0]["text"]
    assert text.splitlines()[0].endswith("since Thu 1 Oct, 17:00")      # 09:00 UTC is 17:00 in the villa
