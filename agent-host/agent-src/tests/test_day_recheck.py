"""The night's open faults read again during the day (owner, 2026-10-19: "instead of waiting 24h to recheck the faults
found during the nightly check, refresh the open ones every 4 hours during the days and automatically refresh the list
(by closing the ones that are not active anymore). You don't have to trigger a full nightly check but just re-check the
identified ones"). `recheck.py day`, at the times of the schedule entries marked `kiosk: day_check`, reads the open
findings of skill.yaml `day_rechecks` by their own rule (the night's functions); Problems.record_rechecked records and
closes among them only. Invented entities."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

from helpers import PYTHONPATH, STARTER_SKILLS, copy_skill, settings
from vesta_shared.problems import STILL_THERE, Problems
from vesta_shared.store import Store

SKILL = os.path.join(STARTER_SKILLS, "preventive-maintenance")
NOW = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)
BAT_LOW, BAT_CRIT, TEMP, HUMID = ("sensor.door_a_battery", "sensor.lock_b_battery", "sensor.room_c_temperature",
                                  "sensor.room_d_humidity")
PUMP = "sensor.pump_e_power"
#: What the day recheck asks of the engine when a task moved: the repair
MOVED = [{"action": "faults_changed"}]


def _recheck_module():
    spec = importlib.util.spec_from_file_location("recheck_day", os.path.join(SKILL, "scripts", "recheck.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _row(eid, name, family, asset, device, unit=None):
    return {"entity_id": eid, "name": name, "area": "Garden", "family": family, "asset": asset, "device_id": device,
            **({"unit": unit} if unit else {})}


def _pack(tmp):
    (tmp / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "families": {"battery": [_row(BAT_LOW, "Door A battery", "battery", "door_a", "dev_a", "%"),
                                 _row(BAT_CRIT, "Lock B battery", "battery", "lock_b", "dev_b", "%")],
                     "level": [_row(TEMP, "Room C temperature", "level", "room_c", "dev_c"),
                               _row(HUMID, "Room D humidity", "level", "room_d", "dev_d")],
                     "power": [_row(PUMP, "Pump E power", "power", "pump_e", "dev_e")]},
        "assets": {}}))


def _st(state, minutes_ago):
    t = (NOW - timedelta(minutes=minutes_ago)).isoformat()
    return {"state": state, "attributes": {}, "last_changed": t, "last_reported": t}


def _villa(tmp, states: dict):
    """The villa now: `states`, and both level sensors reporting every hour for days before they went quiet."""
    fx = tmp / "fx"
    fx.mkdir(exist_ok=True)
    (fx / "states.json").write_text(json.dumps({"states": states}))
    t0 = int((NOW - timedelta(days=6)).timestamp() * 1000)
    ents = [{"entity_id": e, "statistics": [{"start": t0 + h * 3600_000, "mean": 20.0 + h % 5, "min": 20.0 + h % 5,
                                              "max": 20.5 + h % 5} for h in range(4 * 24)]} for e in (TEMP, HUMID)]
    (fx / "stats_hour_a.json").write_text(json.dumps({"period_type": "hour", "entities": ents}))


def _day(tmp, now=NOW, extra=()):
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "day", "--pack", str(tmp / "pack.json"),
                        "--store", str(tmp / "s.sqlite"), "--fixture-dir", str(tmp / "fx"), "--now", now.isoformat(),
                        "--zone", "UTC", *extra],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _found(store, rule, eid, summary, sev="P3", day="2026-10-18"):
    fid, _ = store.raise_finding(rule, eid, "x", day, sev, summary, {})
    tid = Problems(store).settle(f"finding:{fid}")[0]
    return fid, tid


def _night_findings(tmp):
    store = Store(str(tmp / "s.sqlite"))
    return store, {
        "low": _found(store, "PM-BATTERY-LOW", BAT_LOW, "Door A battery at 15%: replace within the week."),
        "crit": _found(store, "PM-BATTERY-CRIT", BAT_CRIT, "Lock B battery at 5%: replace now.", "P2"),
        "temp": _found(store, "PM-SILENT", TEMP, "Room C temperature has not reported for 1 d 6 h although it is online."),
        "humid": _found(store, "PM-SILENT", HUMID, "Room D humidity has not reported for 1 d 6 h although it is online."),
        # judged on a finished day: the day recheck leaves it to the night
        "pump": _found(store, "PM-POWER-CHANGE", PUMP, "Pump E draws 20% lower than its normal."),
    }


def test_the_day_recheck_closes_what_is_gone_keeps_what_is_still_there_and_touches_nothing_else(tmp_path):
    _pack(tmp_path)
    store, f = _night_findings(tmp_path)
    # the door battery was changed (100 %), the lock's still at 5 %; the temperature reports again, the humidity is
    # still quiet since yesterday morning; the pump is whatever it is
    _villa(tmp_path, {BAT_LOW: _st("100", 60), BAT_CRIT: _st("5", 60), TEMP: _st("21.5", 5),
                      HUMID: _st("60", 30 * 60), PUMP: _st("0", 5)})
    before = {r["id"]: r for r in store.findings()}
    out = _day(tmp_path)
    assert out["actions"] == MOVED and out["faults_changed"] is True and out["send"] == []   # nobody is messaged
    st = Store(str(tmp_path / "s.sqlite"))
    status = {k: st.finding(fid)["status"] for k, (fid, _) in f.items()}
    assert status == {"low": "closed", "crit": "open", "temp": "closed", "humid": "open", "pump": "open"}, status
    for k in ("low", "temp"):                                     # the night's own words, with the time
        assert st.task(f[k][1])["status"] == "cleared"
        assert st.task(f[k][1])["close_note"] == "Cleared: the check at 12:00 no longer sees it."
    for k in ("crit", "humid", "pump"):
        assert st.task(f[k][1])["status"] == "open"
    assert st.finding(f["crit"][0])["seen_at"] == NOW.isoformat()                         # read, recorded
    assert st.finding(f["pump"][0])["seen_at"] == before[f["pump"][0]]["seen_at"]           # never read
    # never a full night: no new finding, no feature, no night's beat
    assert {r["id"] for r in st.findings()} == set(before)
    assert st.db.execute("SELECT COUNT(*) FROM features").fetchone()[0] == 0
    assert st.last_beat("maintenance_nightly") is None
    assert _day(tmp_path)["actions"] == []                                                  # closed once


def test_a_reading_that_did_not_come_back_closes_nothing(tmp_path):
    _pack(tmp_path)
    store, f = _night_findings(tmp_path)
    _villa(tmp_path, {BAT_LOW: _st("unavailable", 60)})                  # one with no value, the others not read
    assert _day(tmp_path)["actions"] == []
    assert all(Store(str(tmp_path / "s.sqlite")).finding(fid)["status"] == "open" for fid, _ in f.values())


def test_a_persons_close_holds_and_a_problem_still_there_after_it_opens_again(tmp_path):
    _pack(tmp_path)
    store, f = _night_findings(tmp_path)
    pb = Problems(store)
    for k in ("low", "crit"):                                    # closed in the Cockpit an hour before the recheck
        pb.closed_in_kiosk(f[k][1])
        store.db.execute("UPDATE tasks SET done_at=? WHERE id=?", ((NOW - timedelta(hours=1)).isoformat(), f[k][1]))
        store.db.commit()
    pb.reopened_in_kiosk(f["temp"][1], by="Owner")               # a person's reopening: only their Done closes it
    _villa(tmp_path, {BAT_LOW: _st("100", 60), BAT_CRIT: _st("5", 60), TEMP: _st("21.5", 5), HUMID: _st("60", 30 * 60)})
    _day(tmp_path)
    st = Store(str(tmp_path / "s.sqlite"))
    # the changed battery: its finding closes, the person's close stays theirs
    assert st.finding(f["low"][0])["status"] == "closed" and st.task(f["low"][1])["status"] == "closed_in_kiosk"
    # the lock still at 5 % an hour after the close: open again, saying so (settings.yaml still_there_after_close)
    assert st.task(f["crit"][1])["status"] == "open" and st.task(f["crit"][1])["reopen_note"] == STILL_THERE
    # the temperature reports again, but a person reopened its fault: the finding closes, the task stays theirs
    assert st.finding(f["temp"][0])["status"] == "closed" and st.task(f["temp"][1])["status"] == "open"


# ------------------------------------------------------------------------------------- the ledger: record_rechecked
def test_record_rechecked_closes_only_among_what_it_read(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    a, ta = _found(store, "PM-X", "sensor.a", "A")
    b, tb = _found(store, "PM-X", "sensor.b", "B")
    c, tc = _found(store, "PM-X", "sensor.c", "C")
    out = Problems(store).record_rechecked([a, b], [b, c], "2026-10-19", NOW.isoformat(), note="Cleared: gone.",
                                           settle_minutes=10)
    assert out == {"seen": [b], "closed": [a], "task_ids": [ta]}
    assert [store.finding(x)["status"] for x in (a, b, c)] == ["closed", "open", "open"]
    assert store.finding(a)["closed_day"] == "2026-10-19" and store.task(ta)["close_note"] == "Cleared: gone."
    assert store.finding(b)["seen_at"] == NOW.isoformat() and store.finding(c)["seen_at"] != NOW.isoformat()
    assert store.task(tb)["status"] == store.task(tc)["status"] == "open"
    # a finding no longer open is left as it is
    assert Problems(store).record_rechecked([a], [], "2026-10-19", NOW.isoformat()) == {"seen": [], "closed": [],
                                                                                         "task_ids": []}


def test_a_finding_closed_in_the_day_and_seen_again_at_night_is_the_same_problem_back(tmp_path):
    # AGAIN_DAYS: closed at 12:00, found again by the next night — one fault reopened, "again", never a new one
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import rules as R
    store = Store(str(tmp_path / "s.sqlite"))
    a, ta = _found(store, "PM-BATTERY-LOW", BAT_LOW, "Door A battery at 15%.")
    Problems(store).record_rechecked([a], [], "2026-10-19", NOW.isoformat(), note="Cleared: x.")
    f = R.Finding("PM-BATTERY-LOW", BAT_LOW, "door_a", "battery", "P3", "Door A battery at 14%.", {}, "Replace it.")
    night = Problems(store).record_night([f], "2026-10-19", state_rules={"PM-BATTERY-LOW"}, event_rules=set(),
                                         worsened_step=15)
    assert [d["id"] for d in night["again"]] == [a] and night["task_ids"] == [ta]
    assert store.task(ta)["status"] == "open"


# ------------------------------------------------------------------------------------- what the skill says
def test_the_rules_read_in_the_day_are_the_skills_and_each_has_its_reading():
    from vesta_agent.skills import parse_skill
    sk = parse_skill("preventive-maintenance", SKILL)
    recheck = _recheck_module()
    assert recheck.day_rechecked() == set(sk.day_rechecks) == set(sk.day_checked)
    assert set(sk.day_rechecks) <= set(recheck.DAY_READS)            # the card's "day" only for what is read
    assert not set(sk.day_rechecks) & set(sk.rechecks)               # every 5 minutes is sooner: one clock each


def test_the_scheduler_runs_the_day_recheck_at_the_skills_times_without_the_ai(tmp_path):
    from vesta_agent.scheduler import Scheduler
    from vesta_agent.skills import Skills
    from vesta_agent.state import State
    s = settings(str(tmp_path))
    copy_skill("preventive-maintenance", s.skills_dir)
    sk = Skills(s.skills_dir).all()["preventive-maintenance"]
    code, model = [], []

    async def run_code(skill, command, timeout):
        code.append((command, timeout))

    async def run_model(skill, job):
        model.append(job)

    async def nothing():
        return None

    sch = Scheduler(s, Skills(s.skills_dir), State(s.state_path), run_code, run_model, nothing)

    async def go():
        for when in sk.day_checks_at:
            h, m = map(int, when.split(":"))
            code.clear()
            await sch.tick(datetime(2026, 10, 19, h, m + 5, tzinfo=timezone.utc))
            await sch.idle()
            assert ("recheck.py day", 600) in code, (when, code)
        code.clear()
        await sch.tick(datetime(2026, 10, 19, 10, 5, tzinfo=timezone.utc))
        await sch.idle()
    asyncio.run(go())
    assert sk.day_checks_at == ["08:00", "12:00", "16:00", "20:00"] and model == []
    assert not any(c == "recheck.py day" for c, _ in code)                           # 10:05: no day recheck


def test_a_reconnect_loop_is_read_again_in_the_day(tmp_path):
    # owner, 2026-10-20: 17 false "dropped and reconnected" faults waited for the next night to close. The day recheck
    # reads them again (the night's own reading, nightly.reconnect_findings): a fan whose "drops" were 50-ms reloads
    # closes, a relay that really drops stays.
    fan, relay = "fan.example_fan", "switch.example_relay"
    (tmp_path / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "families": {"runtime": [_row(fan, "Ceiling fan", "runtime", "fan", "dev_f")],
                     "network": [_row(relay, "Pool relay", "network", "relay", "dev_r")]}, "assets": {}}))
    store = Store(str(tmp_path / "s.sqlite"))
    f_fan = _found(store, "PM-RECONNECT-LOOP", fan, "Ceiling fan dropped and reconnected 10 times in 3 days.")
    f_relay = _found(store, "PM-RECONNECT-LOOP", relay, "Pool relay dropped and reconnected 12 times in 3 days.")
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {fan: _st("off", 60), relay: _st("on", 60)}}))
    entries = []
    for k in range(12):
        t = NOW - timedelta(hours=2 + 4 * k)
        entries += [{"entity_id": fan, "state": "unavailable", "when": t.isoformat()},
                    {"entity_id": fan, "state": "off", "when": (t + timedelta(milliseconds=50)).isoformat()},
                    {"entity_id": relay, "state": "unavailable", "when": (t + timedelta(minutes=1)).isoformat()},
                    {"entity_id": relay, "state": "on", "when": (t + timedelta(minutes=2)).isoformat()}]
    (fx / "logbook.json").write_text(json.dumps({"entries": entries}))
    _day(tmp_path)
    st = Store(str(tmp_path / "s.sqlite"))
    assert st.finding(f_fan[0])["status"] == "closed" and st.task(f_fan[1])["status"] == "cleared"
    assert st.finding(f_relay[0])["status"] == "open" and st.finding(f_relay[0])["seen_at"] == NOW.isoformat()


def test_a_loop_spread_over_the_whole_three_days_stays_open_at_noon(tmp_path):
    # architecture review, 2026-10-20: the noon recheck counted two and a half days — 12 real drops spread over the last
    # 72 hours read as 10, and the fault "cleared" at noon to open again at night
    relay = "switch.example_relay"
    (tmp_path / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "families": {"network": [_row(relay, "Pool relay", "network", "relay", "dev_r")]}, "assets": {}}))
    store = Store(str(tmp_path / "s.sqlite"))
    f_relay = _found(store, "PM-RECONNECT-LOOP", relay, "Pool relay dropped and reconnected 12 times in 3 days.")
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {relay: _st("on", 60)}}))
    entries = []
    # six drops on the afternoon three days back (inside the last 72 hours, before the calendar's three days) and five
    # yesterday: eleven in 72 hours, five in the calendar's days
    times = [NOW - timedelta(days=3) + timedelta(hours=1 + 2 * k) for k in range(6)] + \
            [NOW - timedelta(days=1) + timedelta(hours=k) for k in range(5)]
    for t in times:
        entries += [{"entity_id": relay, "state": "unavailable", "when": t.isoformat()},
                    {"entity_id": relay, "state": "on", "when": (t + timedelta(minutes=1)).isoformat()}]
    (fx / "logbook.json").write_text(json.dumps({"entries": entries}))
    _day(tmp_path)
    assert Store(str(tmp_path / "s.sqlite")).finding(f_relay[0])["status"] == "open"
