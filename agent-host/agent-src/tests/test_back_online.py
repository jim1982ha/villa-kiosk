"""A device the night check found offline that is back closes its fault within minutes, not at the next night
(villa, 2026-10-10: "shelly integration (3 devices) has been offline for 9 h" stayed in the Cockpit all day while every
Shelly device had been back since noon). Invented entities."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import yaml

from helpers import PYTHONPATH, STARTER_SKILLS
from vesta_shared.problems import Problems
from vesta_shared.store import Store

SKILL = os.path.join(STARTER_SKILLS, "preventive-maintenance")
T0 = datetime(2026, 10, 10, 6, 0, tzinfo=timezone.utc)
ENTS = ["switch.relay_a", "sensor.pump_b_power", "sensor.pump_c_power"]


def _offline_finding(store) -> int:
    fid, _ = store.raise_finding("PM-UNAVAILABLE", ENTS[0], "integration_x", "2026-10-09", "P2",
                                 "x integration (3 devices) has been offline for 9 h.", {"hours": 9, "entities": ENTS})
    Problems(store).open_task("finding", fid, "PM-UNAVAILABLE", ENTS[0], "x integration offline")
    return fid


def _run(tmp_path, states: dict, now: datetime, not_found=()):
    fx = tmp_path / "fx"
    fx.mkdir(exist_ok=True)
    (fx / "states.json").write_text(json.dumps({"states": states, "not_found": list(not_found)}))
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "--store", str(tmp_path / "s.sqlite"),
                        "--fixture-dir", str(fx), "--now", now.isoformat()],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _st(state, minutes_ago, now=T0):
    return {"state": state, "last_changed": (now - timedelta(minutes=minutes_ago)).isoformat(), "attributes": {}}


def test_an_integration_back_online_closes_its_fault_with_its_task(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    fid = _offline_finding(store)
    one_still_down = {ENTS[0]: _st("off", 60), ENTS[1]: _st("0.0", 60), ENTS[2]: _st("unavailable", 60)}
    assert _run(tmp_path, one_still_down, T0)["actions"] == []
    just_back = {**one_still_down, ENTS[2]: _st("0.0", 3)}
    assert _run(tmp_path, just_back, T0)["actions"] == []                  # back 3 min ago: not yet
    # a device that reports again, its sensor still without a value ("unknown"), is back online
    out = _run(tmp_path, {**{e: _st("0.0", 15) for e in ENTS}, ENTS[2]: _st("unknown", 15)}, T0)
    assert [a["action"] for a in out["actions"]] == ["ticket.resolve"] and out["faults_changed"] is True
    assert Store(str(tmp_path / "s.sqlite")).finding(fid)["status"] == "closed"
    assert _run(tmp_path, {e: _st("0.0", 20) for e in ENTS}, T0)["actions"] == []        # closed once


def test_a_fault_about_a_device_deleted_from_home_assistant_closes_saying_so(tmp_path):
    # owner, 2026-10-14: a deleted light group's fault stayed open until 02:00, then read "Cleared: the nightly check
    # no longer sees it", as if the group had come back
    store = Store(str(tmp_path / "s.sqlite"))
    weak, _ = store.raise_finding("PM-BATTERY-LOW", "sensor.door_x_battery", "door_x", "2026-10-09", "P3",
                                  "Door X battery at 12%.", {})
    Problems(store).open_task("finding", weak, "PM-BATTERY-LOW", "sensor.door_x_battery", "Door X battery")
    off = _offline_finding(store)
    # read, but no state for it and Home Assistant never said "not found" (a timeout, a refusal): nothing closes
    assert _run(tmp_path, {ENTS[0]: _st("unavailable", 60)}, T0)["actions"] == []
    # the battery sensor deleted: its fault closes, saying why; one of the offline three deleted, the other two
    # still offline: that one stays open
    out = _run(tmp_path, {ENTS[0]: _st("unavailable", 60), ENTS[1]: _st("unavailable", 60)}, T0,
               not_found=["sensor.door_x_battery", ENTS[2]])
    assert [(a["action"], a["note"]) for a in out["actions"]] == [
        ("ticket.resolve", "Closed: this device no longer exists in the villa's system.")]
    st = Store(str(tmp_path / "s.sqlite"))
    assert st.finding(weak)["status"] == "closed" and st.finding(off)["status"] == "open"
    # the other two back: the offline one closes as back online, the deleted one counting as no longer offline
    out = _run(tmp_path, {ENTS[0]: _st("off", 30), ENTS[1]: _st("0.0", 30)}, T0, not_found=[ENTS[2]])
    assert [a["note"] for a in out["actions"]] == ["Cleared: back online."]


def test_the_check_runs_every_five_minutes_and_reads_nothing_when_nothing_is_offline(tmp_path):
    with open(os.path.join(SKILL, "skill.yaml"), encoding="utf-8") as f:
        assert yaml.safe_load(f)["every_5_min"] == "recheck.py"
    Store(str(tmp_path / "s.sqlite"))
    # no fixture folder at all: a read would fail — nothing offline, nothing read
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "--store", str(tmp_path / "s.sqlite"),
                        "--fixture-dir", str(tmp_path / "missing")],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=60)
    assert r.returncode == 0 and json.loads(r.stdout)["actions"] == []


def test_an_integration_down_finding_names_every_device_it_stands_for():
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import features as F
    groups = {k: {"entity_id": e, "hours": 9, "names": [e], "platform": "shelly", "critical": False}
              for k, e in zip(("a", "b", "c"), ENTS)}
    (merged,) = F.integration_down(groups, 3).values()
    assert merged["entity_ids"] == ENTS


def test_a_p2_back_again_is_told_at_once_with_how_often():
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import nightly
    said = nightly.told_now({"villa": "Example", "as_of": "2026-10-10", "new_findings": [], "again": [
                                                           {"severity": "P2", "summary": "Plug offline", "again": 2,
                                                            "check": "Look at the plug."},
                                                           {"severity": "P3", "summary": "Weak pump", "again": 1}]})
    # the night check's message in the one shape (review 30): its title as data, "Back again:", what to do
    (m,) = said
    assert m["title"] == "Example, night check on 10/10/2026." and \
        m["text"] == "Back again:\n- Plug offline (again: 3 times in 7 days)\nWhat to do: Look at the plug."


def test_the_night_runs_output_carries_those_messages(monkeypatch, capsys):
    # the caller, pinned: what main() prints is what the engine sends
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import nightly
    back = {"severity": "P2", "summary": "Plug offline", "again": 1, "check": "Look."}
    monkeypatch.setattr(nightly, "run", lambda args: {"as_of": "2026-10-10", "features_written": 0, "tasks_to_create": [],
                                                      "notes": [], "new_findings": [], "still_open": [], "closed": [],
                                                      "again": [back], "resolve_actions": []})
    nightly.main(["--pack", "p.json"])
    out = json.loads(capsys.readouterr().out)
    assert [m["text"] for m in out["send"]] == ["Back again:\n- Plug offline (again: 2 times in 7 days)\nWhat to do: Look."]


def test_a_sensor_that_reports_every_five_minutes_is_back_when_it_was_not_offline_in_the_last_minutes(tmp_path):
    # villa, 2026-10-15: Timmerflotte_5969 came back at 14:03 and its humidity reported every 4 min 53 s — its last
    # change was never 10 minutes old, and its fault stayed until 02:00. Its history over the minutes decides
    hum = "sensor.room_x_humidity"
    store = Store(str(tmp_path / "s.sqlite"))
    fid, _ = store.raise_finding("PM-UNAVAILABLE", hum, "room_x", "2026-10-09", "P3", "Room X has been offline for 1 d 9 h.",
                                 {"entities": [hum]})
    Problems(store).open_task("finding", fid, "PM-UNAVAILABLE", hum, "Room X offline")

    def at(now, back_minutes_ago):
        """Offline until `back_minutes_ago`, then a new reading every 5 minutes."""
        back = now - timedelta(minutes=back_minutes_ago)
        rows = [{"state": "unavailable", "last_changed": (back - timedelta(hours=40)).isoformat()}]
        rows += [{"state": f"{60 + k}.0", "last_changed": (back + timedelta(minutes=5 * k)).isoformat()}
                 for k in range(back_minutes_ago // 5 + 1)]
        fx = tmp_path / "fx"
        fx.mkdir(exist_ok=True)
        (fx / "history_raw_x.json").write_text(json.dumps({"entities": [{"entity_id": hum, "states": rows}]}))
        last = rows[-1]
        return {hum: {"state": last["state"], "last_changed": last["last_changed"], "attributes": {}}}

    assert _run(tmp_path, at(T0, 7), T0)["actions"] == []              # back 7 min ago: not yet
    # a history with nothing from before the minutes (the recorder lost it): it cannot be told, not yet
    (tmp_path / "fx" / "history_raw_x.json").write_text(json.dumps({"entities": [{"entity_id": hum, "states": [
        {"state": "61.0", "last_changed": (T0 - timedelta(minutes=8)).isoformat()},
        {"state": "62.0", "last_changed": (T0 - timedelta(minutes=3)).isoformat()}]}]}))
    young = {hum: {"state": "62.0", "last_changed": (T0 - timedelta(minutes=3)).isoformat(), "attributes": {}}}
    (tmp_path / "fx" / "states.json").write_text(json.dumps({"states": young}))
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "--store", str(tmp_path / "s.sqlite"),
                        "--fixture-dir", str(tmp_path / "fx"), "--now", T0.isoformat()],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=60)
    assert r.returncode == 0 and json.loads(r.stdout)["actions"] == [], r.stderr
    out = _run(tmp_path, at(T0, 120), T0)                                # back 2 h ago, last reading 0 min ago
    assert [a["note"] for a in out["actions"]] == ["Cleared: back online."]


# ------------------------------------------------------------------ gone offline: found within minutes, not at 02:00
NIGHT = datetime(2026, 10, 17, 21, 46, tzinfo=timezone.utc)


def _villa_pack(tmp_path) -> str:
    """A humidity sensor (not critical) and a door lock (critical), as the knowledge pack lists them."""
    path = tmp_path / "pack.json"
    path.write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "families": {"level": [{"entity_id": "sensor.example_th_humidity", "name": "TH humidity", "area": "Bedroom",
                                "family": "level", "asset": "th", "device_id": None}],
                     "security": [{"entity_id": "lock.example_door", "name": "Example door", "area": "Hall",
                                   "family": "security", "asset": "door", "device_id": None}]},
        "assets": {"th": {"slug": "th", "name": "TH", "entities": {"level": "sensor.example_th_humidity"}, "critical": False},
                   "door": {"slug": "door", "name": "Example door", "entities": {"security": "lock.example_door"},
                            "critical": True}}}))
    return str(path)


def _run_engine(tmp_path, states: dict, now: datetime):
    """recheck.py as the engine runs it every 5 minutes: --store only, the knowledge pack named by VESTA_PACK."""
    fx = tmp_path / "fx"
    fx.mkdir(exist_ok=True)
    (fx / "states.json").write_text(json.dumps({"states": states}))
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "--store", str(tmp_path / "s.sqlite"),
                        "--fixture-dir", str(fx), "--now", now.isoformat()], capture_output=True, text=True, timeout=60,
                       env={**os.environ, "PYTHONPATH": PYTHONPATH, "VESTA_PACK": _villa_pack(tmp_path)})
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _off_since(at, ok_door=True):
    return {"sensor.example_th_humidity": {"state": "unavailable", "last_changed": at.isoformat(), "attributes": {}},
            "lock.example_door": {"state": "locked", "last_changed": (at - timedelta(days=1)).isoformat(), "attributes": {}}}


def test_a_device_gone_offline_gets_its_fault_within_minutes_not_at_two_in_the_morning(tmp_path):
    # owner, 2026-10-18: Timmerflotte_5969 dropped at 21:46 and stood "Unavailable" in the Cockpit with no fault of the
    # agent's until the night check at 02:00
    states = _off_since(NIGHT)
    assert _run_engine(tmp_path, states, NIGHT + timedelta(minutes=5))["actions"] == []        # 5 min: not yet
    out = _run_engine(tmp_path, states, NIGHT + timedelta(minutes=11))
    (fault,) = out["actions"]
    assert fault["action"] == "ticket" and fault["entity_id"] == "sensor.example_th_humidity"
    assert "offline for 11 min" in fault["summary"] and out["faults_changed"] is True
    assert out["send"] == []                                     # not critical: the 07:00 digest, as at night
    (f,) = Store(str(tmp_path / "s.sqlite")).findings("open")
    assert f["rule_id"] == "PM-UNAVAILABLE"
    assert _run_engine(tmp_path, states, NIGHT + timedelta(minutes=16))["actions"] == []       # once
    # untouched while open: restating it is the night check's (no store write every 5 minutes)
    assert Store(str(tmp_path / "s.sqlite")).finding(f["id"])["summary"] == f["summary"]
    # back online: closed by the same 5-minute job, as before
    back = {**states, "sensor.example_th_humidity": {"state": "55", "attributes": {},
                                                     "last_changed": (NIGHT + timedelta(minutes=20)).isoformat()}}
    out = _run_engine(tmp_path, back, NIGHT + timedelta(minutes=31))
    assert [a["action"] for a in out["actions"]] == ["ticket.resolve"]


def test_a_critical_device_gone_offline_tells_the_facility_manager_at_once(tmp_path):
    states = {**_off_since(NIGHT), "lock.example_door": {"state": "unavailable", "attributes": {},
                                                         "last_changed": NIGHT.isoformat()}}
    states.pop("sensor.example_th_humidity")
    out = _run_engine(tmp_path, states, NIGHT + timedelta(minutes=12))
    (fault,) = out["actions"]
    assert fault["entity_id"] == "lock.example_door"
    (msg,) = out["send"]
    assert msg["to"] == "fm" and "Example door has been offline for 12 min" in msg["text"], msg


def test_a_device_offline_again_within_the_week_says_so(tmp_path):
    states = _off_since(NIGHT)
    _run_engine(tmp_path, states, NIGHT + timedelta(minutes=11))
    back = {**states, "sensor.example_th_humidity": {"state": "55", "attributes": {},
                                                     "last_changed": (NIGHT + timedelta(minutes=20)).isoformat()}}
    _run_engine(tmp_path, back, NIGHT + timedelta(minutes=31))
    later = NIGHT + timedelta(hours=3)
    (fault,) = _run_engine(tmp_path, _off_since(later), later + timedelta(minutes=11))["actions"]
    assert fault["action"] == "ticket.reopen" and "(again: 2 times in 7 days)" in fault["title"], fault


def test_a_device_an_offline_alert_already_follows_gets_no_second_fault(tmp_path):
    # architecture review, offline devices #3: the villa's own rule alerted at 10 minutes (#, card, its fault); this
    # check would add "Example door has been offline for 12 min" and the FM's message, the same minute
    store = Store(str(tmp_path / "s.sqlite"))
    store.new_incident("watch|lock.example_door", "automation.example_watchdog", "lock.example_door", "P2",
                       {"bad_states": ["unavailable", "disconnected"], "entities": ["lock.example_door"]})
    store.new_incident("door|lock.example_door", "automation.example_unlocked", "lock.example_door", "P2",
                       {"bad_states": ["unlocked"], "entities": ["lock.example_door"]})   # another problem: no cover
    states = {**_off_since(NIGHT), "lock.example_door": {"state": "unavailable", "attributes": {},
                                                         "last_changed": NIGHT.isoformat()}}
    out = _run_engine(tmp_path, states, NIGHT + timedelta(minutes=12))
    assert [a["entity_id"] for a in out["actions"]] == ["sensor.example_th_humidity"] and out["send"] == []


def test_an_open_alert_about_something_else_leaves_the_offline_fault(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    store.new_incident("door|lock.example_door", "automation.example_unlocked", "lock.example_door", "P2",
                       {"bad_states": ["unlocked"], "entities": ["lock.example_door"]})
    states = {"lock.example_door": {"state": "unavailable", "attributes": {}, "last_changed": NIGHT.isoformat()}}
    out = _run_engine(tmp_path, states, NIGHT + timedelta(minutes=12))
    assert [a["entity_id"] for a in out["actions"]] == ["lock.example_door"] and len(out["send"]) == 1
