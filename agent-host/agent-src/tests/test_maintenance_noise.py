"""The nightly maintenance checks against the noise a real villa makes (synthetic: no villa data).

villa, 2026-10-04: one morning message carried 24 "new" lines and repeated them under "Still open".
18 were sensors that only report on a change (curtains, rain gauges at 0), stamped by a Home Assistant
restart; three were one relay counted once per entity, its restarts counted as its own drops; a pump's
"collapse" was the 2-hour stub of the night the check ran, and a day its plug was offline.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone

from helpers import PYTHONPATH, STARTER_SKILLS

NIGHTLY = os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "nightly.py")
COMPOSE = os.path.join(STARTER_SKILLS, "reports", "scripts", "compose.py")
AS_OF = "2026-10-03"                                       # the night judges 3 Oct; "now" is 4 Oct 00:00 UTC
NOW = datetime(2026, 10, 4, tzinfo=timezone.utc)


def _run(*args):
    return subprocess.run([sys.executable, *args], capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH})


def _pack(tmp, families, assets=None, **more):
    (tmp / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "families": families, "assets": assets or {}, **more}))


def _row(eid, name, family="level", asset=None, device=None):
    return {"entity_id": eid, "name": name, "area": "Garden", "family": family, "asset": asset or eid.split(".")[1],
            "device_id": device}


def _hourly(fx, name, series):
    """{entity_id: (first hour, hours, moving)} as HA's hourly statistics."""
    ents = []
    for eid, (start, n, moving) in series.items():
        t0 = int(start.timestamp() * 1000)
        ents.append({"entity_id": eid, "statistics": [
            {"start": t0 + h * 3600_000, "mean": 20.0 + (h % 5 if moving else 0), "min": 20.0 + (h % 5 if moving else 0),
             "max": (20.5 + h % 5) if moving else 20.0} for h in range(n)]})
    (fx / f"stats_hour_{name}.json").write_text(json.dumps({"period_type": "hour", "entities": ents}))


def _night(tmp, *extra):
    r = _run(NIGHTLY, "--pack", str(tmp / "pack.json"), "--store", str(tmp / "s.sqlite"), "--fixture-dir", str(tmp / "fx"),
             "--skip-raw", "--out", str(tmp / "res.json"), *extra)
    assert r.returncode == 0, r.stderr
    return json.load(open(tmp / "res.json"))


def _open(tmp, rule):
    from vesta_shared.store import Store
    return [f for f in Store(str(tmp / "s.sqlite")).findings("open") if f["rule_id"] == rule]


# ------------------------------------------------------------------------------------------------ silence
def test_only_a_sensor_that_normally_reports_all_the_time_can_be_silent(tmp_path):
    fx = tmp_path / "fx"
    fx.mkdir()
    restart = (NOW - timedelta(hours=34)).isoformat()      # every entity stamped by a restart 34h ago
    ids = {"sensor.example_temperature": True, "sensor.example_curtain": False, "sensor.example_rain": False}
    (fx / "states.json").write_text(json.dumps({"states": {
        eid: {"state": "1", "attributes": {}, "last_changed": restart, "last_reported": restart} for eid in ids}}))
    # before the restart: the temperature moved every hour; the curtain twice a day; the rain gauge never
    _hourly(fx, "a", {"sensor.example_temperature": (NOW - timedelta(days=14), 13 * 24, True),
                      "sensor.example_rain": (NOW - timedelta(days=14), 13 * 24, False)})
    curtain = []
    t0 = int((NOW - timedelta(days=14)).timestamp() * 1000)
    for h in range(13 * 24):
        moved = h % 24 in (9, 18)
        curtain.append({"start": t0 + h * 3600_000, "mean": 50.0 if moved else (100.0 if (h // 12) % 2 else 0.0),
                        "min": 0.0 if moved else (100.0 if (h // 12) % 2 else 0.0),
                        "max": 100.0 if moved else (100.0 if (h // 12) % 2 else 0.0)})
    (fx / "stats_hour_b.json").write_text(json.dumps({"period_type": "hour", "entities": [
        {"entity_id": "sensor.example_curtain", "statistics": curtain}]}))
    _pack(tmp_path, {"level": [_row(e, e.split("_")[-1].title()) for e in ids]})
    _night(tmp_path, "--as-of", AS_OF)
    assert [f["entity_id"] for f in _open(tmp_path, "PM-SILENT")] == ["sensor.example_temperature"]


def _restarted_sensor(fx, restart, last, eid="sensor.example_th"):
    """`eid` reading 27.5 since `last`, its stamps rewritten by a restart of the villa's system at `restart`."""
    (fx / "states.json").write_text(json.dumps({"states": {eid: {
        "state": "27.5", "attributes": {}, "last_changed": restart.isoformat(), "last_reported": restart.isoformat()}}}))
    (fx / "history_raw_a.json").write_text(json.dumps({"entities": [{"entity_id": eid, "states": [
        {"state": "27.1", "last_changed": (last - timedelta(minutes=5)).isoformat()},
        {"state": "27.5", "last_changed": last.isoformat()},                          # its last real reading
        {"state": "unavailable", "last_changed": (restart - timedelta(seconds=30)).isoformat()},
        {"state": "27.5", "last_changed": restart.isoformat()}]}]}))                 # the restart's rewrite
    # the villa's own "started" entry, which tells the night which stamps are a restart's (nightly.restart_stamps)
    (fx / "logbook.json").write_text(json.dumps({"entries": [
        {"when": restart.isoformat(), "domain": "homeassistant", "name": "Home Assistant", "message": "started"}]}))


def test_a_restart_inside_the_silence_hours_does_not_hide_a_silent_sensor(tmp_path):
    # villa, 2026-10-26: the check filtered on the restart's stamp before reading the history — 6 h after a restart a
    # sensor silent for 3 days was "quiet for 6 h", not found until a day after the restart
    fx = tmp_path / "fx"
    fx.mkdir()
    last = NOW - timedelta(days=3)
    _restarted_sensor(fx, NOW - timedelta(hours=6), last)
    _hourly(fx, "a", {"sensor.example_th": (last - timedelta(days=10), 10 * 24, True)})
    _pack(tmp_path, {"level": [_row("sensor.example_th", "TH temperature")]})
    _night(tmp_path, "--as-of", AS_OF)
    (f,) = _open(tmp_path, "PM-SILENT")
    assert "has not reported for 3d " in f["summary"], f["summary"]


def test_one_silent_device_is_one_finding(tmp_path):
    # villa: "Temp and Humidity0 Battery has not reported" twice, beside its temperature and its pressure
    fx = tmp_path / "fx"
    fx.mkdir()
    old = (NOW - timedelta(hours=40)).isoformat()
    ids = ["sensor.example_th_temperature", "sensor.example_th_pressure", "sensor.example_th_battery"]
    (fx / "states.json").write_text(json.dumps({"states": {
        e: {"state": "1", "attributes": {}, "last_changed": old, "last_reported": old} for e in ids}}))
    _hourly(fx, "a", {e: (NOW - timedelta(days=14), 12 * 24, True) for e in ids})
    _pack(tmp_path, {"level": [_row(e, "TH " + e.split("_")[-1], asset="th", device="dev-th") for e in ids]})
    _night(tmp_path, "--as-of", AS_OF)
    (f,) = _open(tmp_path, "PM-SILENT")
    assert f["summary"].startswith("TH temperature (+2 entities of the same device) has not reported"), f["summary"]


# ------------------------------------------------------------------------------------------ reconnect loops
def test_a_restart_is_not_a_device_dropping_and_one_device_is_one_finding(tmp_path):
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {}}))
    crowd = [f"sensor.example_other_{k}" for k in range(25)]
    relay = ["switch.example_relay", "update.example_relay_firmware", "sensor.example_relay_uptime"]
    entries = []
    for day in (1, 2, 3):                                  # a restart each day: everything drops, Home Assistant says so
        when = datetime(2026, 10, day, 9, 28, 30, tzinfo=timezone.utc).isoformat()
        entries += [{"entity_id": e, "state": "unavailable", "when": when} for e in crowd + relay]
        entries.append({"name": "Home Assistant", "message": "started", "domain": "homeassistant",
                        "when": datetime(2026, 10, day, 9, 29, 5, tzinfo=timezone.utc).isoformat()})
    for k in range(4):                                     # and the relay's own drops: 4, not 4 + 3 restarts
        when = datetime(2026, 10, 2, 11, 5 * k, tzinfo=timezone.utc).isoformat()
        entries += [{"entity_id": e, "state": "unavailable", "when": when} for e in relay]
    (fx / "logbook.json").write_text(json.dumps({"entries": entries}))
    rows = [_row(e, "Pool relay", family="network", asset="relay", device="dev-relay") for e in relay]
    _pack(tmp_path, {"network": rows}, {"relay": {"slug": "relay", "name": "Pool relay", "entities": {}}})
    _night(tmp_path, "--as-of", AS_OF)
    assert _open(tmp_path, "PM-RECONNECT-LOOP") == []      # 4 own drops: under the 10 a loop needs; restarts not counted
    for k in range(4, 12):
        when = datetime(2026, 10, 3, 11, 5 * k, tzinfo=timezone.utc).isoformat()
        entries += [{"entity_id": e, "state": "unavailable", "when": when} for e in relay]
    (fx / "logbook.json").write_text(json.dumps({"entries": entries}))
    _night(tmp_path, "--as-of", AS_OF)
    (f,) = _open(tmp_path, "PM-RECONNECT-LOOP")            # one device, one line, named in words
    assert f["summary"].startswith("Pool relay dropped and reconnected 12 times"), f["summary"]


# ---------------------------------------------------------------------------------------------- offline
def test_unknown_is_not_offline(tmp_path):
    # a wind chill on a warm day is "unknown": no value to give, while its station reports
    fx = tmp_path / "fx"
    fx.mkdir()
    old = (NOW - timedelta(hours=36)).isoformat()
    (fx / "states.json").write_text(json.dumps({"states": {
        "sensor.example_windchill": {"state": "unknown", "attributes": {}, "last_changed": old, "last_reported": old},
        "sensor.example_lost": {"state": "unavailable", "attributes": {}, "last_changed": old, "last_reported": old}}}))
    _pack(tmp_path, {"level": [_row("sensor.example_windchill", "Wind chill"), _row("sensor.example_lost", "Lost one")]})
    _night(tmp_path, "--as-of", AS_OF)
    assert [f["entity_id"] for f in _open(tmp_path, "PM-UNAVAILABLE")] == ["sensor.example_lost"]
    assert _open(tmp_path, "PM-SILENT") == []
    # the moment it went offline, for the card's duration worded when shown (architecture review, 2026-10-15)
    (lost,) = _open(tmp_path, "PM-UNAVAILABLE")
    since = datetime.fromisoformat(json.loads(lost["detail"])["since"])
    assert abs((since - datetime.fromisoformat(old)).total_seconds()) < 1 and json.loads(lost["detail"])["since_words"] in lost["summary"]


# ------------------------------------------------------------------------------------------------ energy
def _pump(tmp, last_days_kwh, power_gap_days=()):
    """A critical pump: 0.5 kWh a day for 14 days, then `last_days_kwh`; its power plug without data on
    `power_gap_days` (offset from AS_OF, 0 = AS_OF)."""
    fx = tmp / "fx"
    fx.mkdir(exist_ok=True)
    (fx / "states.json").write_text(json.dumps({"states": {}}))
    end = date.fromisoformat(AS_OF)
    days = [end - timedelta(days=i) for i in range(15, -1, -1)]
    kwh = [0.5] * (len(days) - len(last_days_kwh)) + list(last_days_kwh)
    day_rows = [{"start": int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000), "change": k, "sum": 0}
                for d, k in zip(days, kwh)]
    (fx / "stats_day_e.json").write_text(json.dumps({"period_type": "day", "entities": [
        {"entity_id": "sensor.example_pump_energy", "statistics": day_rows}]}))
    gaps = {end - timedelta(days=g) for g in power_gap_days}
    hour_rows = []
    for d in days:
        if d in gaps:
            continue
        t0 = int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000)
        hour_rows += [{"start": t0 + h * 3600_000, "mean": 30.0 if h % 6 == 0 else 0.0, "min": 0.0,
                       "max": 60.0 if h % 6 == 0 else 0.0} for h in range(24)]
    (fx / "stats_hour_p.json").write_text(json.dumps({"period_type": "hour", "entities": [
        {"entity_id": "sensor.example_pump_power", "statistics": hour_rows}]}))
    asset = {"slug": "pump", "name": "Example pump", "critical": True, "kind": "appliance",
             "entities": {"power": "sensor.example_pump_power", "energy": "sensor.example_pump_energy"}}
    _pack(tmp, {"power": [_row("sensor.example_pump_power", "Pump power", "power", "pump")],
                "energy": [_row("sensor.example_pump_energy", "Pump energy", "energy", "pump")]}, {"pump": asset})


def test_a_day_the_meter_was_offline_is_not_a_collapse(tmp_path):
    _pump(tmp_path, [0.1, 0.1], power_gap_days=(0, 1))
    _night(tmp_path, "--as-of", AS_OF)
    assert _open(tmp_path, "PM-ENERGY-CHANGE") == []


def test_a_real_collapse_on_days_with_data_still_raises(tmp_path):
    # the control: the same drop with the plug reporting is a finding
    _pump(tmp_path, [0.1, 0.1])
    _night(tmp_path, "--as-of", AS_OF)
    assert len(_open(tmp_path, "PM-ENERGY-CHANGE")) == 1


# ------------------------------------------------------------------------------------------ the morning
# ------------------------------------------------------------------------------------------ run twice
def test_the_same_night_run_again_is_not_a_crash_nor_news_again(tmp_path):
    # villa, 2026-10-06: nightly.py tried from the page for a day the scheduled night had already judged:
    # "sqlite3.IntegrityError: UNIQUE constraint failed: findings.rule_id, findings.entity_id, findings.opened_day".
    # An event (here the meter going backwards) is recorded and closed the night it fires; the rerun wrote it again.
    _pump(tmp_path, [-3.0, 0.5])
    first = _night(tmp_path, "--as-of", AS_OF)
    assert [d["rule_id"] for d in first["new_findings"]].count("PM-COUNTER-RESET") == 1
    again = _night(tmp_path, "--as-of", AS_OF)
    assert "PM-COUNTER-RESET" not in [d["rule_id"] for d in again["new_findings"]]   # told once, the first night


def test_the_night_tells_the_engine_when_the_kiosks_faults_change(tmp_path):
    # architecture review 13 (live defect): the engine repairs the Kiosk's faults when a result says they changed; it
    # looked for new_findings / still_open / closed, which the night check computed but never printed
    from vesta_shared.result import FAULTS_CHANGED
    _pump(tmp_path, [0.1, 0.1])
    r = _run(NIGHTLY, "--pack", str(tmp_path / "pack.json"), "--store", str(tmp_path / "s.sqlite"),
             "--fixture-dir", str(tmp_path / "fx"), "--skip-raw", "--as-of", AS_OF)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)[FAULTS_CHANGED] is True                # a collapse found: the faults change
    quiet = tmp_path / "quiet"
    quiet.mkdir()
    _pump(quiet, [0.5, 0.5])
    r = _run(NIGHTLY, "--pack", str(quiet / "pack.json"), "--store", str(quiet / "s.sqlite"),
             "--fixture-dir", str(quiet / "fx"), "--skip-raw", "--as-of", AS_OF)
    assert json.loads(r.stdout)[FAULTS_CHANGED] is False               # nothing found: nothing to repair
    import inspect
    from vesta_agent.app import Vesta
    # the engine reads that one key (driven: outcome._moves_faults, what carry_out repairs by)
    from vesta_agent.outcome import _moves_faults
    assert _moves_faults({FAULTS_CHANGED: True}) and not _moves_faults({FAULTS_CHANGED: False})
    assert "carry_out" in inspect.getsource(Vesta.run_code_job)


# ------------------------------------------------------------------------- one device, its name, its own uptime
def _relay(tmp, started, uptime_first=False):
    """A Wi-Fi relay whose switch is classified and whose uptime sensor and restart button are not (no family): 6 drops
    of the switch on 2 Oct, 6 of the uptime sensor on 3 Oct (`uptime_first`: the other way round); the uptime sensor
    says the relay started at `started`."""
    fx = tmp / "fx"
    fx.mkdir()
    ids = ["switch.example_relay", "sensor.example_relay_uptime", "button.example_relay_restart"]
    (fx / "states.json").write_text(json.dumps({"states": {
        "switch.example_relay": {"state": "off", "attributes": {}, "last_changed": "2026-10-03T20:00:00+00:00"},
        "sensor.example_relay_uptime": {"state": started, "attributes": {"device_class": "uptime"},
                                        "last_changed": "2026-10-03T20:00:00+00:00"}}}))
    rows = [{"entity_id": ids[0] if (day == 2) != uptime_first else ids[1], "state": "unavailable",
             "when": datetime(2026, 10, day, 9 + k, 5, tzinfo=timezone.utc).isoformat()} for day in (2, 3) for k in range(6)]
    (fx / "logbook.json").write_text(json.dumps({"entries": rows}))
    _pack(tmp, {"runtime": [_row(ids[0], "Example relay switch", family="runtime", asset="example_relay", device="dev-1")]},
          unclassified=ids[1:], entity_devices={e: "dev-1" for e in ids},
          devices={"dev-1": {"name": "Example Relay", "manufacturer": "", "model": ""}})


def test_a_device_reconnecting_is_one_fault_named_for_it_and_wifi_when_it_never_restarted(tmp_path):
    # 2026-10-13: a relay's switch and its uptime sensor (in no family) were two faults, the second named from an entity
    # id, a third named after its "Restart" button elsewhere; and "a Wi-Fi or power problem" for a relay whose own uptime
    # showed no restart for 11 days
    _relay(tmp_path, "2026-09-20T00:00:00+00:00")
    _night(tmp_path, "--as-of", AS_OF)
    (f,) = _open(tmp_path, "PM-RECONNECT-LOOP")
    assert f["summary"] == ("Example Relay dropped and reconnected 12 times in 3 days: a Wi-Fi problem on its side: it "
                            "never restarted, so its power held."), f["summary"]


def test_one_odd_day_is_not_an_energy_change(tmp_path):
    # 2026-10-13: "used 0.36 kWh/day over the last 2 days (+117%)" was one long run and one day it barely ran, averaged
    _pump(tmp_path, [1.8, 0.02])
    _night(tmp_path, "--as-of", AS_OF)
    assert _open(tmp_path, "PM-ENERGY-CHANGE") == []


def test_several_devices_losing_one_access_point_together_are_counted_not_taken_for_a_restart(tmp_path):
    # 2026-10-13: the old filter left out any minute with 20 entities dropping — three Wi-Fi relays of nine entities each
    # losing their access point together were "a restart", their drops never counted. Home Assistant says when it restarts.
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {}}))
    devices = {f"dev-{d}": [f"sensor.example_relay{d}_part{k}" for k in range(9)] for d in range(3)}
    entries = [{"entity_id": e, "state": "unavailable", "when": datetime(2026, 10, 3, 8 + k, 5, tzinfo=timezone.utc).isoformat()}
               for k in range(10) for ents in devices.values() for e in ents]
    (fx / "logbook.json").write_text(json.dumps({"entries": entries}))
    rows = [_row(e, f"Relay {d}", family="network", asset=f"relay{d[-1]}", device=d) for d, ents in devices.items() for e in ents]
    _pack(tmp_path, {"network": rows})
    _night(tmp_path, "--as-of", AS_OF)
    assert len(_open(tmp_path, "PM-RECONNECT-LOOP")) == 3                # one per device, each its 10 drops


def test_a_hidden_entity_dropping_is_no_reconnect_fault(tmp_path):
    # owner, 2026-10-19: a TV hidden in the villa's system was "dropped and reconnected 10 times in 3 days" — hidden
    # entities are checked by nothing (knowledge_pack: left out of every family, listed in `hidden`)
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {}}))
    entries = [{"entity_id": "media_player.example_tv", "state": "unavailable",
                "when": datetime(2026, 10, 3, 11, 5 * k, tzinfo=timezone.utc).isoformat()} for k in range(12)]
    (fx / "logbook.json").write_text(json.dumps({"entries": entries}))
    _pack(tmp_path, {"network": []}, {}, hidden=["media_player.example_tv"])
    _night(tmp_path, "--as-of", AS_OF)
    assert _open(tmp_path, "PM-RECONNECT-LOOP") == []
    _pack(tmp_path, {"network": []}, {})                   # the same TV, not hidden: its fault
    _night(tmp_path, "--as-of", AS_OF)
    assert len(_open(tmp_path, "PM-RECONNECT-LOOP")) == 1


def test_an_offline_fault_an_alert_took_over_is_handed_over_never_cleared(tmp_path):
    # architecture review scan 1, 2026-10-19: offline at 5 minutes (its fault, recheck.py), then the villa's own rule
    # alerted at 10 — at 02:00 the night left the device out (the alert follows it) and closed its fault "Cleared: the
    # nightly check no longer sees it" while it was still off. Now it closes as followed by the alert, and is no "closed"
    from vesta_shared.store import Store
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {"lock.example_door": {
        "state": "unavailable", "attributes": {}, "last_changed": "2026-10-03T20:00:00+00:00"}}}))
    (fx / "logbook.json").write_text(json.dumps({"entries": []}))
    _pack(tmp_path, {"availability": [_row("lock.example_door", "Example door", family="availability", device="dev-door")]})
    store = Store(str(tmp_path / "s.sqlite"))
    store.raise_finding("PM-UNAVAILABLE", "lock.example_door", "availability", "2026-10-03", "P3", "offline", {})
    iid = store.new_incident("watch|lock.example_door", "automation.example_watchdog", "lock.example_door", "P2",
                             {"bad_states": ["unavailable"], "entities": ["lock.example_door"]})
    res = _night(tmp_path, "--as-of", AS_OF)
    assert _open(tmp_path, "PM-UNAVAILABLE") == []                       # one problem: the alert's
    assert res["closed"] == [] and [f["entity_id"] for f in res["handed_over"]] == ["lock.example_door"], res
    assert iid


# ------------------------------------------------------------------------------------------ battery margin
def test_the_night_keeps_an_open_low_battery_until_five_points_above_its_line(tmp_path):
    """Owner, 2026-10-20 ("yes, 5 points"): the night closes a state rule it no longer finds — a LOW battery read at
    22 % is still the open fault (closes above 25 %), never closed tonight to reopen at 20 % tomorrow."""
    from vesta_shared.store import Store
    row = {**_row("sensor.example_bat", "Door battery", "battery", "door"), "unit": "%"}
    _pack(tmp_path, {"battery": [row]})
    Store(str(tmp_path / "s.sqlite")).raise_finding("PM-BATTERY-LOW", "sensor.example_bat", "door", "2026-10-01", "P3",
                                                    "Door battery at 19%: replace within the week.", {})
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {"sensor.example_bat": {"state": "22", "attributes": {}}}}))
    _night(tmp_path, "--as-of", AS_OF)
    assert len(_open(tmp_path, "PM-BATTERY-LOW")) == 1


def test_a_battery_that_moves_a_step_overnight_is_handed_over_never_cleared(tmp_path):
    """Architecture review, 2026-10-22: the night closed "within the week" as "Cleared: the nightly check no longer
    sees it" while opening "replace now" for the same battery (nightly.battery_moved)."""
    from vesta_shared.problems import Problems
    from vesta_shared.store import Store
    fx = tmp_path / "fx"
    fx.mkdir()
    eid = "sensor.example_lock_battery"
    _pack(tmp_path, {"battery": [{**_row(eid, "Example lock battery", "battery", "example_lock"), "unit": "%"}]})
    st = Store(str(tmp_path / "s.sqlite"))
    fid, _ = st.raise_finding("PM-BATTERY-LOW", eid, "battery", "2026-10-02", "P3", "Example lock battery at 18%.", {})
    (tid,) = Problems(st).settle(f"finding:{fid}")
    t = (NOW - timedelta(hours=1)).isoformat()
    (fx / "states.json").write_text(json.dumps({"states": {
        eid: {"state": "6", "attributes": {}, "last_changed": t, "last_reported": t}}}))
    res = _night(tmp_path, "--as-of", AS_OF)
    st = Store(str(tmp_path / "s.sqlite"))
    assert st.finding(fid)["status"] == "closed" and res["closed"] == [] and res["edits"] == []
    assert st.task(tid)["close_note"].startswith("Now: ") and "replace now" in st.task(tid)["close_note"]
    assert [f["rule_id"] for f in _open(tmp_path, "PM-BATTERY-CRIT")] == ["PM-BATTERY-CRIT"]
