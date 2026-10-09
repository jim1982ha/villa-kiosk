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

from helpers import PYTHONPATH, ROOT, STARTER_SKILLS

NIGHTLY = os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "nightly.py")
COMPOSE = os.path.join(STARTER_SKILLS, "reports", "scripts", "compose.py")
AS_OF = "2026-10-03"                                       # the night judges 3 Oct; "now" is 4 Oct 00:00 UTC
NOW = datetime(2026, 10, 4, tzinfo=timezone.utc)


def _run(*args):
    return subprocess.run([sys.executable, *args], capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH})


def _pack(tmp, families, assets=None):
    (tmp / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "families": families, "assets": assets or {}}))


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
    restart = (NOW - timedelta(hours=34)).isoformat()      # every entity stamped by a restart 34 h ago
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


def test_a_sensor_that_froze_once_before_is_judged_by_the_days_before_it_stopped(tmp_path):
    # villa: frozen 6 days, reporting 6 days, then stopped — over 14 days it moved in under half its hours
    fx = tmp_path / "fx"
    fx.mkdir()
    since = NOW - timedelta(hours=40)
    (fx / "states.json").write_text(json.dumps({"states": {"sensor.example_th": {
        "state": "28.45", "attributes": {}, "last_changed": since.isoformat(), "last_reported": since.isoformat()}}}))
    _hourly(fx, "a", {"sensor.example_th": (since - timedelta(days=12), 8 * 24, False)})   # an earlier freeze
    _hourly(fx, "b", {"sensor.example_th": (since - timedelta(days=4), 4 * 24, True)})    # then reporting; 1/3 overall
    _pack(tmp_path, {"level": [_row("sensor.example_th", "TH temperature")]})
    _night(tmp_path, "--as-of", AS_OF)
    assert [f["entity_id"] for f in _open(tmp_path, "PM-SILENT")] == ["sensor.example_th"]


def test_a_sensor_with_no_history_is_not_called_silent(tmp_path):
    # absence is not evidence: with nothing to compare, the check says nothing
    fx = tmp_path / "fx"
    fx.mkdir()
    old = (NOW - timedelta(days=3)).isoformat()
    (fx / "states.json").write_text(json.dumps({"states": {"sensor.example_x": {
        "state": "1", "attributes": {}, "last_changed": old, "last_reported": old}}}))
    _pack(tmp_path, {"level": [_row("sensor.example_x", "X")]})
    _night(tmp_path, "--as-of", AS_OF)
    assert _open(tmp_path, "PM-SILENT") == []


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
    for day in (1, 2, 3):                                  # a restart each day: everything drops in one minute
        when = datetime(2026, 10, day, 9, 28, 30, tzinfo=timezone.utc).isoformat()
        entries += [{"entity_id": e, "state": "unavailable", "when": when} for e in crowd + relay]
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


def test_the_night_judges_the_last_finished_day(tmp_path):
    # it ran at 02:00 and judged the date it ran on: two hours of data
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {}}))
    _pack(tmp_path, {})
    res = _night(tmp_path)
    assert res["as_of"] == (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()


# ------------------------------------------------------------------------------------------ the morning
def test_the_morning_message_says_each_thing_once(tmp_path):
    from vesta_shared.store import Store
    # names come from the knowledge pack, as on the villa — not cut out of the summary's words
    _pack(tmp_path, {"level": [_row(f"sensor.example_{k}", f"Sensor {k}") for k in range(4)]})
    store = Store(str(tmp_path / "s.sqlite"))
    for k in range(4):
        store.raise_finding("PM-SILENT", f"sensor.example_{k}", "level", AS_OF, "P3",
                            f"Sensor {k} has not reported for 1.5 days although it is online.", {"hours": 36})
    store.raise_finding("PM-BATTERY-LOW", "sensor.example_bat", "battery", AS_OF, "P3",
                        "Motion battery at 11%: replace within the week.", {})
    store.raise_finding("PM-UNAVAILABLE", "lock.example_old", "availability", "2026-09-20", "P3",
                        "Old lock has been offline for 300 h.", {})
    r = _run(COMPOSE, "fm-daily", "--pack", str(tmp_path / "pack.json"), "--store", str(tmp_path / "s.sqlite"),
             "--as-of", "2026-10-04")
    assert r.returncode == 0, r.stderr
    text = "\n".join(json.loads(r.stdout)["messages"])
    assert "4 sensors have not reported: Sensor 0, Sensor 1, Sensor 2, Sensor 3." in text      # one line for the kind
    assert text.count("Motion battery") == 1                                                # new: not again under Still open
    assert "Still open: 1." in text and "Old lock" in text


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


def test_no_threshold_hides_in_the_night_check_s_code():
    # architecture review, 2026-10-07: 3 h, 72 h, 0.5, 48 h, 3 devices, 20 entities, 14 days, 7 points, −0.5/day,
    # 0.8 × nominal, 15 points were literals in the scripts; each is now a named default a villa can override
    import re
    for name in ("nightly.py", "rules.py", "features.py"):
        src = open(os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", name)).read()
        assert "behaviour_text_default(" not in src, name
        assert not re.search(r"step: float = \d", src) and "* nominal" not in src.replace('params.behaviour("battery_low_fraction_of_nominal") * nominal', ""), name


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
    assert "if res.get(FAULTS_CHANGED):" in inspect.getsource(Vesta.run_code_job)   # the engine reads that one key
