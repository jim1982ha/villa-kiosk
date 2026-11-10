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
    # its title's moment as every Status line and the agreement write one, never "17 Oct, 21:58" (architecture review 25)
    assert msg["title"] == "Example Villa, devices offline on 17/10/2026 21:58.", msg["title"]


def test_a_critical_device_offline_a_second_time_the_same_day_is_told_as_back_again(tmp_path):
    # architecture review, 2026-11-10: offline at 10:00, back at 10:20, offline again at 15:00 — the second outage was
    # told to no one before the night check (the fault opened again in silence, without its "2nd time"), and the first
    # message stayed on "Cleared". The same outage on the NEXT day was told "Back again … (2nd time in 7 days)"
    day = datetime(2026, 10, 17, 10, 0, tzinfo=timezone.utc)
    door = lambda state, at: {"lock.example_door": {"state": state, "attributes": {}, "last_changed": at.isoformat()}}
    (first,) = _run_engine(tmp_path, door("unavailable", day), day + timedelta(minutes=12))["send"]
    back = _run_engine(tmp_path, door("locked", day + timedelta(minutes=20)), day + timedelta(minutes=50))
    assert back["send"] == [] and _open_tasks(tmp_path) == []
    (cleared,) = back["edits"]
    assert cleared["key"] == first["key"] and "Cleared on 17/10/2026 10:50" in cleared["text"]
    again = day + timedelta(hours=5)
    out = _run_engine(tmp_path, door("unavailable", again), again + timedelta(minutes=12))
    (msg,) = out["send"]
    assert msg["to"] == "fm" and msg["title"] == "Example Villa, devices offline on 17/10/2026 15:12."
    assert msg["text"].startswith("Back again:\n- Example door has been offline for 12min. (2nd time in 7 days)"), msg["text"]
    # its fault in the VESTA UI is open again, and the first message says so: its watch is over
    assert out["actions"] == MOVED and [t["entity_id"] for t in _open_tasks(tmp_path)] == ["lock.example_door"]
    (edit,) = out["edits"]
    assert edit["key"] == first["key"] and edit["title"] == first["title"]
    assert "Cleared on 17/10/2026 10:50" in edit["text"] and edit["text"].endswith("\nBack at 17/10/2026 15:12 (to: FM)")
    assert len(Store(str(tmp_path / "s.sqlite")).findings()) == 1                         # the same problem, not a second one
    # told once: the checks that follow say nothing more
    quiet = _run_engine(tmp_path, door("unavailable", again), again + timedelta(minutes=17))
    assert quiet["send"] == [] and quiet["edits"] == []


def test_maintenance_mode_holds_a_device_gone_offline_and_the_next_check_after_it_takes_it_up(tmp_path):
    """The Kiosk's promise (MaintenanceMode.tsx): while maintenance mode is on, a new problem below P1 is not taken up —
    no message, no fault — and audited; still there when the mode ends, the next 5-minute check takes it up as usual.
    (Architecture review round 7, card 1: only the alert desk asked the switch; this door told the facility manager.)"""
    from vesta_shared import kiosk_told
    states = {**_off_since(NIGHT), "lock.example_door": {"state": "unavailable", "attributes": {},
                                                         "last_changed": NIGHT.isoformat()}}
    states.pop("sensor.example_th_humidity")
    kiosk_told.save(_villa_pack(tmp_path), "maintenance", True)
    held = _run_engine(tmp_path, states, NIGHT + timedelta(minutes=12))
    assert held["send"] == [] and held["actions"] == [] and _open_tasks(tmp_path) == []
    st = Store(str(tmp_path / "s.sqlite"))
    assert st.findings("open") == []
    (audit,) = st.db.execute("SELECT detail FROM audit WHERE action = 'suppressed_maintenance'").fetchall()
    assert json.loads(audit[0])["findings"][0]["entity_id"] == "lock.example_door"                  # audited
    kiosk_told.save(_villa_pack(tmp_path), "maintenance", False)
    out = _run_engine(tmp_path, states, NIGHT + timedelta(minutes=17))
    assert out["actions"] == MOVED and [t["entity_id"] for t in _open_tasks(tmp_path)] == ["lock.example_door"]
    (msg,) = out["send"]
    assert msg["to"] == "fm" and "Example door has been offline for 17min" in msg["text"], msg


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
    # the alert desk's clear_minutes, its villa's own on top (architecture review round 11, card 1: defined once)
    (tmp_path / "rules.yaml").write_text("behaviour:\n  clear_minutes: 10\n")
    (tmp_path / "villa.rules.yaml").write_text("behaviour:\n  clear_minutes: 25\n")
    monkeypatch.setattr(nightly, "DESK", str(tmp_path))
    assert nightly.still_there_minutes({"still_there_after_close": {"minutes": 10}}) == 25.0   # its own copy: unread
    monkeypatch.setattr(nightly, "DESK", str(tmp_path / "none"))
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


# Every way a fault ends, through this recheck AND the night check: test_fault_endings.py (one table).


