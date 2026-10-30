"""A device the night check found offline that is back closes its fault within minutes, not at the next night
(villa, 2026-10-10: "shelly integration (3 devices) has been offline for 9h" stayed in the Cockpit all day while every
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
                                 "x integration (3 devices) has been offline for 9h.", {"hours": 9, "entities": ENTS})
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


#: What the recheck asks of the engine when a task moved: the repair, nothing to read (architecture review, 2026-10-19)
MOVED = [{"action": "faults_changed"}]


def _open_tasks(tmp_path) -> list[dict]:
    return Store(str(tmp_path / "s.sqlite")).tasks("open")


def _closed_notes(tmp_path) -> list[str]:
    return [t["close_note"] for t in Store(str(tmp_path / "s.sqlite")).tasks(None) if t["status"] != "open"]


def _st(state, minutes_ago, now=T0):
    return {"state": state, "last_changed": (now - timedelta(minutes=minutes_ago)).isoformat(), "attributes": {}}


def test_an_integration_back_online_closes_its_fault_with_its_task(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    fid = _offline_finding(store)
    one_still_down = {ENTS[0]: _st("off", 60), ENTS[1]: _st("0.0", 60), ENTS[2]: _st("unavailable", 60)}
    assert _run(tmp_path, one_still_down, T0)["actions"] == []
    just_back = {**one_still_down, ENTS[2]: _st("0.0", 3)}
    assert _run(tmp_path, just_back, T0)["actions"] == []                  # back 3min ago: not yet
    # a device that reports again, its sensor still without a value ("unknown"), is back online
    out = _run(tmp_path, {**{e: _st("0.0", 15) for e in ENTS}, ENTS[2]: _st("unknown", 15)}, T0)
    assert out["actions"] == MOVED and out["faults_changed"] is True
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
    assert out["actions"] == MOVED
    assert _closed_notes(tmp_path) == ["Closed: this device no longer exists in the villa's system."]
    st = Store(str(tmp_path / "s.sqlite"))
    assert st.finding(weak)["status"] == "closed" and st.finding(off)["status"] == "open"
    # the other two back: the offline one closes as back online, the deleted one counting as no longer offline
    out = _run(tmp_path, {ENTS[0]: _st("off", 30), ENTS[1]: _st("0.0", 30)}, T0, not_found=[ENTS[2]])
    assert out["actions"] == MOVED and _closed_notes(tmp_path)[-1] == "Cleared: back online."


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
    from datetime import datetime, timedelta, timezone
    from vesta_shared.offline import Group, merged_integrations
    now = datetime(2026, 10, 10, 2, tzinfo=timezone.utc)
    groups = {k: Group(key=k, label=None, asset=e, asset_name=e, family="power", platform="shelly", state="unavailable",
                       since=now - timedelta(hours=9), hours=9, critical=False, names=[e], entity_ids=[e])
              for k, e in zip(("a", "b", "c"), ENTS)}
    (merged,) = merged_integrations(groups, 3, now)
    assert merged.entity_ids == ENTS and merged.integration == "shelly"


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
                                                      "again": [back], "tasks_resolved": []})
    nightly.main(["--pack", "p.json"])
    out = json.loads(capsys.readouterr().out)
    assert [m["text"] for m in out["send"]] == ["Back again:\n- Plug offline (again: 2 times in 7 days)\nWhat to do: Look."]


def test_a_sensor_that_reports_every_five_minutes_is_back_when_it_was_not_offline_in_the_last_minutes(tmp_path):
    # villa, 2026-10-15: Timmerflotte_5969 came back at 14:03 and its humidity reported every 4min 53s — its last
    # change was never 10 minutes old, and its fault stayed until 02:00. Its history over the minutes decides
    hum = "sensor.room_x_humidity"
    store = Store(str(tmp_path / "s.sqlite"))
    fid, _ = store.raise_finding("PM-UNAVAILABLE", hum, "room_x", "2026-10-09", "P3", "Room X has been offline for 1d 9h.",
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

    assert _run(tmp_path, at(T0, 7), T0)["actions"] == []              # back 7min ago: not yet
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
    out = _run(tmp_path, at(T0, 120), T0)                                # back 2h ago, last reading 0min ago
    assert out["actions"] == MOVED and _closed_notes(tmp_path) == ["Cleared: back online."]


# ------------------------------------------------------------------ gone offline: found within minutes, not at 02:00
NIGHT = datetime(2026, 10, 17, 21, 46, tzinfo=timezone.utc)


def _villa_pack(tmp_path) -> str:
    """A humidity sensor and a door lock, the lock on the villa's critical list, as the knowledge pack has them."""
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
                            "critical": True}},
        "critical": ["lock.example_door"]}))           # the villa's one list (its "critical devices offline" rule)
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
    assert _run_engine(tmp_path, states, NIGHT + timedelta(minutes=5))["actions"] == []        # 5min: not yet
    out = _run_engine(tmp_path, states, NIGHT + timedelta(minutes=11))
    assert out["actions"] == MOVED
    (task,) = _open_tasks(tmp_path)
    assert task["entity_id"] == "sensor.example_th_humidity"
    assert "offline for 11min" in task["summary"] and out["faults_changed"] is True
    assert out["send"] == []                                     # not critical: the 07:00 digest, as at night
    (f,) = Store(str(tmp_path / "s.sqlite")).findings("open")
    assert f["rule_id"] == "PM-UNAVAILABLE"
    assert _run_engine(tmp_path, states, NIGHT + timedelta(minutes=16))["actions"] == []       # once
    # its words untouched while open: restating it is the night check's (the recheck records only when it saw it)
    assert Store(str(tmp_path / "s.sqlite")).finding(f["id"])["summary"] == f["summary"]
    # back online: closed by the same 5-minute job, as before
    back = {**states, "sensor.example_th_humidity": {"state": "55", "attributes": {},
                                                     "last_changed": (NIGHT + timedelta(minutes=20)).isoformat()}}
    out = _run_engine(tmp_path, back, NIGHT + timedelta(minutes=31))
    assert out["actions"] == MOVED and _open_tasks(tmp_path) == []


def test_a_critical_device_gone_offline_tells_the_facility_manager_at_once(tmp_path):
    states = {**_off_since(NIGHT), "lock.example_door": {"state": "unavailable", "attributes": {},
                                                         "last_changed": NIGHT.isoformat()}}
    states.pop("sensor.example_th_humidity")
    out = _run_engine(tmp_path, states, NIGHT + timedelta(minutes=12))
    assert out["actions"] == MOVED and [t["entity_id"] for t in _open_tasks(tmp_path)] == ["lock.example_door"]
    (msg,) = out["send"]
    assert msg["to"] == "fm" and "Example door has been offline for 12min" in msg["text"], msg


def test_maintenance_mode_holds_a_device_gone_offline_and_the_next_check_after_it_takes_it_up(tmp_path):
    """The Kiosk's promise (MaintenanceMode.tsx): while maintenance mode is on, a new problem below P1 is not taken up —
    no message, no fault — and audited; still there when the mode ends, the next 5-minute check takes it up as usual.
    (Architecture review round 7, card 1: only the alert desk asked the switch; this door told the facility manager.)"""
    from vesta_shared import maintenance
    states = {**_off_since(NIGHT), "lock.example_door": {"state": "unavailable", "attributes": {},
                                                         "last_changed": NIGHT.isoformat()}}
    states.pop("sensor.example_th_humidity")
    maintenance.save(_villa_pack(tmp_path), True)
    held = _run_engine(tmp_path, states, NIGHT + timedelta(minutes=12))
    assert held["send"] == [] and held["actions"] == [] and _open_tasks(tmp_path) == []
    st = Store(str(tmp_path / "s.sqlite"))
    assert st.findings("open") == []
    (audit,) = st.db.execute("SELECT detail FROM audit WHERE action = 'suppressed_maintenance'").fetchall()
    assert json.loads(audit[0])["findings"][0]["entity_id"] == "lock.example_door"                  # audited
    maintenance.save(_villa_pack(tmp_path), False)
    out = _run_engine(tmp_path, states, NIGHT + timedelta(minutes=17))
    assert out["actions"] == MOVED and [t["entity_id"] for t in _open_tasks(tmp_path)] == ["lock.example_door"]
    (msg,) = out["send"]
    assert msg["to"] == "fm" and "Example door has been offline for 17min" in msg["text"], msg


def test_a_device_offline_again_within_the_week_says_so(tmp_path):
    states = _off_since(NIGHT)
    _run_engine(tmp_path, states, NIGHT + timedelta(minutes=11))
    back = {**states, "sensor.example_th_humidity": {"state": "55", "attributes": {},
                                                     "last_changed": (NIGHT + timedelta(minutes=20)).isoformat()}}
    _run_engine(tmp_path, back, NIGHT + timedelta(minutes=31))
    later = NIGHT + timedelta(hours=3)
    assert _run_engine(tmp_path, _off_since(later), later + timedelta(minutes=11))["actions"] == MOVED
    st = Store(str(tmp_path / "s.sqlite"))
    (task,) = st.tasks(None)                                                     # its own task, open again
    assert task["status"] == "open" and "(again: 2 times in 7 days)" in Problems(st).card(task)["title"], task


def test_a_device_an_offline_alert_already_follows_gets_no_second_fault(tmp_path):
    # architecture review, offline devices #3: the villa's own rule alerted at 10 minutes (#, card, its fault); this
    # check would add "Example door has been offline for 12min" and the FM's message, the same minute
    store = Store(str(tmp_path / "s.sqlite"))
    store.new_incident("watch|lock.example_door", "automation.example_watchdog", "lock.example_door", "P2",
                       {"bad_states": ["unavailable", "disconnected"], "entities": ["lock.example_door"]})
    store.new_incident("door|lock.example_door", "automation.example_unlocked", "lock.example_door", "P2",
                       {"bad_states": ["unlocked"], "entities": ["lock.example_door"]})   # another problem: no cover
    states = {**_off_since(NIGHT), "lock.example_door": {"state": "unavailable", "attributes": {},
                                                         "last_changed": NIGHT.isoformat()}}
    out = _run_engine(tmp_path, states, NIGHT + timedelta(minutes=12))
    assert [t["entity_id"] for t in _open_tasks(tmp_path)] == ["sensor.example_th_humidity"] and out["send"] == []


def test_an_open_alert_about_something_else_leaves_the_offline_fault(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    store.new_incident("door|lock.example_door", "automation.example_unlocked", "lock.example_door", "P2",
                       {"bad_states": ["unlocked"], "entities": ["lock.example_door"]})
    states = {"lock.example_door": {"state": "unavailable", "attributes": {}, "last_changed": NIGHT.isoformat()}}
    out = _run_engine(tmp_path, states, NIGHT + timedelta(minutes=12))
    assert [t["entity_id"] for t in _open_tasks(tmp_path)] == ["lock.example_door"] and len(out["send"]) == 1


# ------------------------------------------------------------------ one physical device, whatever is listed under it
def _meter_pack(tmp_path) -> str:
    """A three-phase meter as Home Assistant lists it: the meter, and one device per phase hanging under it ("via")."""
    rows = [{"entity_id": f"sensor.example_meter_{p}_power", "name": f"Meter {p} power", "area": "Hall", "family": "power",
             "asset": f"meter_{p}", "device_id": f"dev_{p}", "platform": "examplemeter"} for p in ("total", "a", "b", "c")]
    path = tmp_path / "pack.json"
    path.write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "families": {"power": rows},
        "assets": {r["asset"]: {"slug": r["asset"], "name": r["name"], "entities": {"power": r["entity_id"]},
                                "critical": False} for r in rows},
        "devices": {"dev_total": {"name": "Example Meter", "manufacturer": "", "model": "", "via": ""},
                    **{f"dev_{p}": {"name": f"Example Meter Phase {p.upper()}", "manufacturer": "", "model": "",
                                    "via": "dev_total"} for p in ("a", "b", "c")}},
        "entity_devices": {r["entity_id"]: r["device_id"] for r in rows}}))
    return str(path)


def _run_meter(tmp_path, now: datetime):
    fx = tmp_path / "fx"
    fx.mkdir(exist_ok=True)
    (fx / "states.json").write_text(json.dumps({"states": {
        f"sensor.example_meter_{p}_power": {"state": "unavailable", "attributes": {}, "last_changed": NIGHT.isoformat()}
        for p in ("total", "a", "b", "c")}}))
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "--store", str(tmp_path / "s.sqlite"),
                        "--fixture-dir", str(fx), "--now", now.isoformat()], capture_output=True, text=True, timeout=60,
                       env={**os.environ, "PYTHONPATH": PYTHONPATH, "VESTA_PACK": _meter_pack(tmp_path)})
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_a_silent_meter_and_its_phases_are_one_device_never_an_integration_down(tmp_path):
    # owner, 2026-10-18: the villa's three-phase meter went silent — the meter and its three phase devices, "4 devices
    # offline": "shelly integration (3 devices)", on a card of its own. One device, named as the meter, whatever make
    assert _run_meter(tmp_path, NIGHT + timedelta(minutes=12))["actions"] == MOVED
    (task,) = _open_tasks(tmp_path)
    assert "integration" not in task["summary"] and "Example Meter has been offline" in task["summary"], task


def test_an_alert_on_the_meter_covers_its_phases_too(tmp_path):
    # the villa's own rule alerted on the meter's total power (#56): its phases are the same device — no second fault
    Store(str(tmp_path / "s.sqlite")).new_incident(
        "watch|sensor.example_meter_total_power", "automation.example_watchdog", "sensor.example_meter_total_power", "P2",
        {"bad_states": ["unavailable"], "entities": ["sensor.example_meter_total_power"]})
    assert _run_meter(tmp_path, NIGHT + timedelta(minutes=12))["actions"] == []


# ------------------------------------------------------------------ a close while it is still there (one rule with the alert's)
def _closed_in_the_cockpit_while_offline(tmp_path):
    """The humidity sensor offline an hour, its fault made by the recheck, then closed in the Cockpit by a person now."""
    now = datetime.now(timezone.utc)                        # a person's close is stamped with the real time
    states = _off_since(now - timedelta(hours=1))
    _run_engine(tmp_path, states, now)
    st = Store(str(tmp_path / "s.sqlite"))
    (task,) = st.tasks("open")
    Problems(st).closed_in_kiosk(task["id"])
    return st, task["id"], states, datetime.fromisoformat(st.task(task["id"])["done_at"])


def test_a_night_fault_closed_while_the_device_is_still_offline_opens_again_once_read_after_the_settle_time(tmp_path):
    # owner, architecture review 2026-10-19: the pump's fault closed in the Cockpit while it was still unavailable stayed
    # closed, nothing said — an alert's close the same way was read again and reopened. One rule now
    st, tid, states, closed = _closed_in_the_cockpit_while_offline(tmp_path)
    soon = _run_engine(tmp_path, states, closed + timedelta(minutes=5))         # read again, too soon: it holds
    assert soon["actions"] == [] and soon["send"] == [] and st.task(tid)["status"] == "closed_in_kiosk"
    out = _run_engine(tmp_path, states, closed + timedelta(minutes=11))         # after the skill's 10 minutes
    task = st.task(tid)
    assert out["actions"] == MOVED and task["status"] == "open" and task["reopen_note"] == "Still there after the close."
    assert Problems(st).card(task)["reopen_note"] == "Still there after the close."           # the Cockpit card says it
    settings = yaml.safe_load(open(os.path.join(SKILL, "settings.yaml")))["still_there_after_close"]
    (msg,) = out["send"]                                                                # the facility manager, told
    assert (msg["to"], msg["title"]) == (settings["tell"], settings["title"])
    assert msg["text"].startswith("Done in the Cockpit on ") and "TH has been offline for" in msg["text"], msg
    again = _run_engine(tmp_path, states, closed + timedelta(minutes=16))
    assert again["send"] == [] and st.task(tid)["status"] == "open" and len(st.tasks(None)) == 1   # told once, one task


def test_a_close_after_the_device_came_back_stays_closed(tmp_path):
    st, tid, states, closed = _closed_in_the_cockpit_while_offline(tmp_path)
    back = {**states, "sensor.example_th_humidity": {"state": "55", "attributes": {},
                                                     "last_changed": (closed - timedelta(minutes=2)).isoformat()}}
    out = _run_engine(tmp_path, back, closed + timedelta(minutes=11))
    assert out["send"] == [] and st.task(tid)["status"] != "open"


def test_without_its_settle_time_a_persons_close_holds_and_the_missing_setting_is_named(tmp_path, monkeypatch):
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import nightly
    assert nightly.still_there_minutes({"still_there_after_close": {"minutes": 10}}) == 10.0
    assert nightly.still_there_minutes({}) is None                                      # never a default of the code



def test_an_offline_fault_an_alert_now_follows_is_handed_over_within_one_recheck(tmp_path):
    # architecture review N, 2026-10-27: offline at 5 minutes (its fault, told on Telegram), then the villa's own alert
    # took the device up at 10 — both stood in the Cockpit's Open issues until 02:00. Now the next 5-minute recheck
    # closes the fault as followed by the alert (never "cleared": the device is still off), and its message says so.
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import nightly
    (tmp_path / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "families": {"security": [{"entity_id": "lock.example_door", "name": "Example door", "area": "Garden",
                                   "family": "security", "asset": "example_door", "device_id": "dev-door"}]},
        "assets": {}}))
    store = Store(str(tmp_path / "s.sqlite"))
    fid, _ = store.raise_finding("PM-UNAVAILABLE", "lock.example_door", "security", "2026-10-10", "P2",
                                 "Example door has been offline for 1h.", {"hours": 1, "entities": ["lock.example_door"]})
    Problems(store).open_task("finding", fid, "PM-UNAVAILABLE", "lock.example_door", "Example door offline")
    (told,) = nightly.told_now({"villa": "Example Villa", "as_of": "2026-10-10", "again": [], "new_findings": [
        {"id": fid, "severity": "P2", "summary": "Example door has been offline for 1h."}]}, store=store, at=T0)
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {"lock.example_door": _st("unavailable", 70)}}))

    def tick():
        r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "--store",
                            str(tmp_path / "s.sqlite"), "--pack", str(tmp_path / "pack.json"), "--fixture-dir", str(fx),
                            "--now", T0.isoformat()],
                           capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=60)
        assert r.returncode == 0, r.stderr
        return json.loads(r.stdout)

    assert tick()["edits"] == [] and Store(str(tmp_path / "s.sqlite")).finding(fid)["status"] == "open"   # no alert
    iid = store.new_incident("watch|lock.example_door", "automation.example_watchdog", "lock.example_door", "P2",
                             {"bad_states": ["unavailable"], "entities": ["lock.example_door"]})
    out = tick()
    note = f"Followed by alert #{iid}-P2, which says when it is back."
    assert Store(str(tmp_path / "s.sqlite")).finding(fid)["status"] == "closed" and _open_tasks(tmp_path) == []
    assert _closed_notes(tmp_path) == [note] and out["faults_changed"] is True and out["actions"] == MOVED
    (e,) = out["edits"]
    assert e["key"] == told["key"] and e["text"] == f"New:\n- Example door has been offline for 1h.\nStatus:\n{note}", e
    assert tick()["edits"] == []                                                         # handed over once


import pytest  # noqa: E402


def _door_pack(tmp_path, hidden=(), asleep=False):
    """The door's pack: its lock and a Wi-Fi signal of the same device; `hidden`: entities hidden in the villa's
    system; `asleep`: the lock listed as unavailable by design (the Kiosk's list, kept beside the pack)."""
    (tmp_path / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "hidden": list(hidden),
        # a hidden entity is left out of every family (knowledge_pack `hidden`), as the pack is built
        "families": {"security": [] if "lock.example_door" in hidden else [
                         {"entity_id": "lock.example_door", "name": "Example door", "area": "Garden",
                          "family": "security", "asset": "example_door", "device_id": "dev-door"}],
                     "network": [] if "sensor.example_door_signal" in hidden else [
                         {"entity_id": "sensor.example_door_signal", "name": "Example door signal",
                          "area": "Garden", "family": "network", "asset": "example_door", "device_id": "dev-door"}]},
        "assets": {}}))
    if asleep:
        (tmp_path / "unavailable_by_design.json").write_text(json.dumps({"ids": ["lock.example_door"]}))


@pytest.mark.parametrize("ending", ["back", "asleep", "hidden", "gone", "answers", "alert"])
def test_every_way_an_offline_fault_ends_through_the_recheck_says_its_own_sentence(tmp_path, ending):
    # architecture review N card 2 (2026-10-27): every way an offline fault ends is one table (recheck.OFFLINE_ENDS),
    # asked in its order; none of its sentences may be lost — each driven through the 5-minute recheck as it runs
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import recheck
    # hidden: the whole door, its signal too — a network device is watched for going offline as well (one list,
    # offline.watched_kinds), so a signal left showing would be the door offline again
    _door_pack(tmp_path, hidden=["lock.example_door", "sensor.example_door_signal"] if ending == "hidden" else (),
               asleep=ending == "asleep")
    store = Store(str(tmp_path / "s.sqlite"))
    fid, _ = store.raise_finding("PM-UNAVAILABLE", "lock.example_door", "security", "2026-10-10", "P2",
                                 "Example door has been offline for 1h.", {"hours": 1, "entities": ["lock.example_door"]})
    Problems(store).open_task("finding", fid, "PM-UNAVAILABLE", "lock.example_door", "Example door offline")
    lock = _st("locked", 70) if ending == "back" else _st("unavailable", 70)
    signal = _st("-61", 3) if ending == "answers" else _st("unavailable", 70)
    states = {} if ending == "gone" else {"lock.example_door": lock, "sensor.example_door_signal": signal}
    iid = store.new_incident("watch|lock.example_door", "automation.example_watchdog", "lock.example_door", "P2",
                             {"bad_states": ["unavailable"], "entities": ["lock.example_door"]}) if ending == "alert" else None
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": states,
                                                "not_found": ["lock.example_door"] if ending == "gone" else []}))
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "--store", str(tmp_path / "s.sqlite"),
                        "--pack", str(tmp_path / "pack.json"), "--fixture-dir", str(fx), "--now", T0.isoformat()],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=60)
    assert r.returncode == 0, r.stderr
    said = {"back": "Cleared: back online.", "asleep": recheck.ASLEEP_NOTE, "hidden": recheck.HIDDEN_NOTE,
            "gone": recheck.GONE_NOTE, "answers": recheck.ANSWERS_NOTE,
            "alert": f"Followed by alert #{iid}-P2, which says when it is back."}[ending]
    assert Store(str(tmp_path / "s.sqlite")).finding(fid)["status"] == "closed", ending
    assert _closed_notes(tmp_path) == [said] and _open_tasks(tmp_path) == []
    assert ending in {e.name for e in recheck.OFFLINE_ENDS} | {"gone"}
