"""Every open fault of the night check read again every 5 minutes, each by the rule that found it (owner, 2026-10-19:
"just re-check the identified ones"; 2026-10-20: "simplify: remove the split, check every 5 min for all the reported
issues", "I am worried how I will judge what is a daily-check fault versus what is not"). `recheck.py`'s 5-minute
tick reads every open finding by its rule's reading (recheck.READS: the night's functions); Problems.record_rechecked
records and closes among them only. A rule judged on a finished day is read over the last finished day, its verdict
kept until the next one has finished. Invented entities."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import pytest

from helpers import PYTHONPATH, STARTER_SKILLS
from vesta_shared.problems import STILL_THERE, Problems
from vesta_shared.store import Store

SKILL = os.path.join(STARTER_SKILLS, "preventive-maintenance")
NOW = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)
BAT_LOW, BAT_CRIT, TEMP, HUMID = ("sensor.door_a_battery", "sensor.lock_b_battery", "sensor.room_c_temperature",
                                  "sensor.room_d_humidity")
PUMP = "sensor.pump_e_power"
#: What the recheck asks of the engine when a task moved: the repair
MOVED = [{"action": "faults_changed"}]


def _recheck_module():
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    spec = importlib.util.spec_from_file_location("recheck_all", os.path.join(SKILL, "scripts", "recheck.py"))
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


def _tick(tmp, now=NOW, extra=()):
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "--pack", str(tmp / "pack.json"),
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
        # a pump the pack no longer lists as an asset: nothing to read it by, left as it is
        "pump": _found(store, "PM-POWER-CHANGE", PUMP, "Pump E draws 20% lower than its normal."),
    }


def test_the_recheck_closes_what_is_gone_keeps_what_is_still_there_and_touches_nothing_else(tmp_path):
    _pack(tmp_path)
    store, f = _night_findings(tmp_path)
    # the door battery was changed (100 %), the lock's still at 5 %; the temperature reports again, the humidity is
    # still quiet since yesterday morning; the pump is whatever it is
    _villa(tmp_path, {BAT_LOW: _st("100", 60), BAT_CRIT: _st("5", 60), TEMP: _st("21.5", 5),
                      HUMID: _st("60", 30 * 60), PUMP: _st("0", 5)})
    before = {r["id"]: r for r in store.findings()}
    out = _tick(tmp_path)
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
    assert _tick(tmp_path)["actions"] == []                                                  # closed once


def test_a_reading_that_did_not_come_back_closes_nothing(tmp_path):
    _pack(tmp_path)
    store, f = _night_findings(tmp_path)
    # one with no value, the others not read; gone 5 minutes, under unavailable_minutes: not offline yet either (a
    # battery is watched for going offline too, offline.watched_kinds)
    _villa(tmp_path, {BAT_LOW: _st("unavailable", 5)})
    assert _tick(tmp_path)["actions"] == []
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
    _tick(tmp_path)
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
    assert out == {"seen": [b], "closed": [a], "handed": [], "task_ids": [ta]}
    assert [store.finding(x)["status"] for x in (a, b, c)] == ["closed", "open", "open"]
    assert store.finding(a)["closed_day"] == "2026-10-19" and store.task(ta)["close_note"] == "Cleared: gone."
    assert store.finding(b)["seen_at"] == NOW.isoformat() and store.finding(c)["seen_at"] != NOW.isoformat()
    assert store.task(tb)["status"] == store.task(tc)["status"] == "open"
    # a finding no longer open is left as it is
    assert Problems(store).record_rechecked([a], [], "2026-10-19", NOW.isoformat()) == {"seen": [], "closed": [], "handed": [],
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
def test_every_rule_of_the_night_is_read_again_every_5_minutes_and_every_card_says_so(tmp_path):
    # owner, 2026-10-20: no split — every fault's card says "Next check: within 5 min", none keeps the nightly time
    from vesta_agent.skills import KIOSK_JOBS, parse_skill
    sk = parse_skill("preventive-maintenance", SKILL)
    recheck = _recheck_module()
    import nightly as N
    rules = N.STATE_RULES | N.EVENT_RULES
    assert recheck.unreadable() == [] and set(recheck.READS) | {recheck.OFFLINE_RULE, recheck.MISSING_RULE} == rules
    assert sk.rechecks == ["*"] and sk.every_5_min == "recheck.py"
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)
    for i, rule in enumerate(sorted(rules)):
        tid, _ = pb.open_task("finding", i + 1, rule, f"sensor.x{i}", "x")
        assert pb.card(store.task(tid), set(sk.rechecks))["check"] == "minutes", rule
    # no day recheck left: one night check, the 5-minute tick, nothing else
    assert [j.get("run") for j in sk.schedule] == ["nightly.py --out nightly.json"] and KIOSK_JOBS == {"nightly_check"}


def test_a_rule_with_no_reading_stops_the_tick_and_says_which(tmp_path, monkeypatch):
    # architecture review 2026-10-20, #6: a rule the card promises to read again that recheck.py cannot read was a line
    # on stderr while its card kept promising the check
    recheck = _recheck_module()
    monkeypatch.delitem(recheck.READS, "PM-RUNHOURS")
    assert recheck.unreadable() == ["PM-RUNHOURS"]
    store = Store(str(tmp_path / "s.sqlite"))
    _found(store, "PM-BATTERY-LOW", BAT_LOW, "Door A battery at 15%.")
    with pytest.raises(recheck.Unreadable, match="PM-RUNHOURS"):
        recheck.recheck_open(store, object(), lambda: object(), NOW, None, "UTC")
    assert store.findings(status="open")[0]["status"] == "open"                         # refused, nothing read


def test_a_reconnect_loop_is_read_again_in_the_day(tmp_path):
    # owner, 2026-10-20: 17 false "dropped and reconnected" faults waited for the next night to close. The tick
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
    _tick(tmp_path)
    st = Store(str(tmp_path / "s.sqlite"))
    assert st.finding(f_fan[0])["status"] == "closed" and st.task(f_fan[1])["status"] == "cleared"
    assert st.finding(f_relay[0])["status"] == "open" and st.finding(f_relay[0])["seen_at"] == NOW.isoformat()


def test_a_loop_spread_over_the_whole_three_days_stays_open_at_noon(tmp_path):
    # architecture review, 2026-10-20: a noon recheck counted two and a half days — 12 real drops spread over the last
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
    _tick(tmp_path)
    assert Store(str(tmp_path / "s.sqlite")).finding(f_relay[0])["status"] == "open"


# ------------------------------------------------------------------------------------- a rule judged on a finished day
AS_OF = "2026-10-03"                       # the night of 4 Oct 02:00 judges 3 Oct
ENERGY, POWER = "sensor.example_pump_energy", "sensor.example_pump_power"


def _pump_days(tmp, kwh_by_day: dict):
    """A critical pump: 0.5 kWh a day for two weeks up to 2 Oct, then `kwh_by_day` ({date: kWh}); its plug reporting
    every hour of each of those days (a day it was offline is not judged)."""
    fx = tmp / "fx"
    fx.mkdir(exist_ok=True)
    if not (fx / "states.json").exists():
        (fx / "states.json").write_text(json.dumps({"states": {}}))
    from datetime import date
    kwh = {date(2026, 10, 2) - timedelta(days=i): 0.5 for i in range(15)} | kwh_by_day
    ms = lambda d: int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000)   # noqa: E731
    (fx / "stats_day_e.json").write_text(json.dumps({"period_type": "day", "entities": [
        {"entity_id": ENERGY, "statistics": [{"start": ms(d), "change": k, "sum": 0} for d, k in sorted(kwh.items())]}]}))
    (fx / "stats_hour_p.json").write_text(json.dumps({"period_type": "hour", "entities": [
        {"entity_id": POWER, "statistics": [{"start": ms(d) + h * 3600_000, "mean": 30.0 if h % 6 == 0 else 0.0,
                                             "min": 0.0, "max": 60.0 if h % 6 == 0 else 0.0}
                                            for d in sorted(kwh) for h in range(24)]}]}))
    asset = {"slug": "pump", "name": "Example pump", "critical": True, "kind": "appliance",
             "entities": {"power": POWER, "energy": ENERGY}}
    (tmp / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "families": {"power": [_row(POWER, "Pump power", "power", "pump", "dev_p")],
                     "energy": [_row(ENERGY, "Pump energy", "energy", "pump", "dev_p")]}, "assets": {"pump": asset}}))


def _night_found_a_collapse(tmp):
    from datetime import date
    _pump_days(tmp, {date(2026, 10, 2): 0.1, date(2026, 10, 3): 0.1})
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "nightly.py"), "--pack", str(tmp / "pack.json"),
                        "--store", str(tmp / "s.sqlite"), "--fixture-dir", str(tmp / "fx"), "--skip-raw",
                        "--as-of", AS_OF, "--out", str(tmp / "res.json")],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=120)
    assert r.returncode == 0, r.stderr
    found = [f for f in Store(str(tmp / "s.sqlite")).findings("open") if f["rule_id"] == "PM-ENERGY-CHANGE"]
    assert len(found) == 1
    return found[0]["id"]


def _status(tmp, fid):
    return Store(str(tmp / "s.sqlite")).finding(fid)["status"]


@pytest.mark.parametrize("next_day_kwh, closes", [(0.5, True), (0.1, False)])
def test_a_day_total_fault_never_closes_mid_day_and_closes_on_the_first_tick_after_a_clean_day(tmp_path, next_day_kwh,
                                                                                               closes):
    # owner, 2026-10-20: "today so far" would close a pump fault at 09:00, before the pump ran — a rule judged on a day's
    # total is read over the last FINISHED day, and its verdict is kept until the next one has finished
    from datetime import date
    fid = _night_found_a_collapse(tmp_path)
    # 4 Oct, noon: the pump is back to normal this morning — but the last finished day (3 Oct) still collapsed
    _pump_days(tmp_path, {date(2026, 10, 2): 0.1, date(2026, 10, 3): 0.1, date(2026, 10, 4): 0.5})
    noon = datetime(2026, 10, 4, 12, 0, tzinfo=timezone.utc)
    assert _tick(tmp_path, noon)["actions"] == [] and _status(tmp_path, fid) == "open"
    assert Store(str(tmp_path / "s.sqlite")).finding(fid)["seen_at"] == noon.isoformat()      # read, still there
    # the same day's verdict is kept: worked out once, not again every 5 minutes (here even a changed 3 Oct is not read)
    _pump_days(tmp_path, {date(2026, 10, 2): 0.5, date(2026, 10, 3): 0.5, date(2026, 10, 4): 0.5})
    assert _tick(tmp_path, noon + timedelta(minutes=5))["actions"] == [] and _status(tmp_path, fid) == "open"
    # 5 Oct: 4 Oct has finished — clean, or collapsed again
    _pump_days(tmp_path, {date(2026, 10, 2): 0.1, date(2026, 10, 3): 0.1, date(2026, 10, 4): next_day_kwh})
    early = datetime(2026, 10, 5, 0, 5, tzinfo=timezone.utc)          # its figures not settled yet: still 3 Oct's verdict
    assert _tick(tmp_path, early)["actions"] == [] and _status(tmp_path, fid) == "open"
    out = _tick(tmp_path, early + timedelta(minutes=15))
    assert _status(tmp_path, fid) == ("closed" if closes else "open")
    assert out["actions"] == (MOVED if closes else [])


# ------------------------------------------------------------------------------------- the reconnect loops' logbook
class _Logbook:
    """The villa's logbook: `rows`, each read recorded as its (start, end)."""

    def __init__(self, rows):
        self.rows, self.reads = rows, []

    def logbook_read(self, start, end, entity_id=None, now=None):
        from vesta_shared.past import Logbook
        self.reads.append((start, end))
        return Logbook([r for r in self.rows if start <= datetime.fromisoformat(r["when"]) < end], start, end)


def test_the_logbook_kept_between_ticks_counts_as_a_whole_read_and_reads_only_the_new_minutes(tmp_path):
    # villa, 2026-10-20: one read of the three days took 9 s for 14,838 rows — every 5 minutes the tick keeps the rows a
    # count needs and reads only what came since
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import features as F
    recheck = _recheck_module()
    relay, fan, noisy = "switch.example_relay", "fan.example_fan", "sensor.example_power"
    rows = [{"domain": "homeassistant", "message": "started", "when": (NOW - timedelta(days=1)).isoformat()}]
    # a drop at the restart, a drop that leaves the window between the two ticks, real drops, 50-ms blinks, noise
    for t, eid, back in [(NOW - timedelta(days=1, seconds=-30), relay, 60), (NOW - timedelta(days=3, minutes=-30), relay, 60),
                         *[(NOW - timedelta(hours=5 * k + 1), relay, 90) for k in range(8)],
                         *[(NOW - timedelta(hours=7 * k + 2), fan, 0.05) for k in range(6)],
                         (NOW + timedelta(minutes=40), relay, 120), (NOW + timedelta(minutes=70), fan, 0.05)]:
        rows += [{"entity_id": eid, "state": "unavailable", "when": t.isoformat()},
                 {"entity_id": eid, "state": "on", "when": (t + timedelta(seconds=back)).isoformat()}]
    rows += [{"entity_id": noisy, "state": str(k), "when": (NOW - timedelta(minutes=10 * k - 5)).isoformat()}
             for k in range(-12, 400)]
    cli, store = _Logbook(rows), Store(str(tmp_path / "s.sqlite"))
    later = NOW + timedelta(hours=2)
    count = lambda rows, end: F.flips_per_day(rows, "UTC", 5, 2, end=end)                         # noqa: E731
    first = recheck.loopbook(store, cli, NOW, 3)
    assert count(first.rows, NOW) == count(cli.logbook_read(NOW - timedelta(days=3), NOW).rows, NOW)
    kept = recheck.loopbook(store, cli, later, 3)
    whole = cli.logbook_read(later - timedelta(days=3), later)
    assert count(kept.rows, later) == count(whole.rows, later) and count(kept.rows, later)[relay]       # the same count
    # eight real drops and the one at the window's edge, then the edge one gone and one after NOW: nine each time
    assert sum(count(first.rows, NOW)[relay].values()) == sum(count(kept.rows, later)[relay].values()) == 9
    assert cli.reads[0] == (NOW - timedelta(days=3), NOW) and cli.reads[2] == (NOW, later)    # only the new minutes
    assert not any(r.get("entity_id") == noisy for r in kept.rows)                            # only what a count reads
    assert kept.whole


@pytest.mark.parametrize("rule,eid,level,stays", [
    ("PM-BATTERY-LOW", BAT_LOW, "22", True), ("PM-BATTERY-LOW", BAT_LOW, "25", True), ("PM-BATTERY-LOW", BAT_LOW, "26", False),
    ("PM-BATTERY-CRIT", BAT_CRIT, "15", True), ("PM-BATTERY-CRIT", BAT_CRIT, "16", False)])
def test_an_open_battery_fault_closes_only_five_points_above_its_line(tmp_path, rule, eid, level, stays):
    """Owner, 2026-10-20 ("yes, 5 points"): a battery hovering on 20/21 % is one fault, not one opened and closed a
    reading: LOW (opens at 20 %) closes above 25 %, CRIT (opens at 10 %) above 15 %."""
    _pack(tmp_path)
    store = Store(str(tmp_path / "s.sqlite"))
    fid, _ = _found(store, rule, eid, "battery low.")
    _villa(tmp_path, {eid: _st(level, 60)})
    _tick(tmp_path)
    assert Store(str(tmp_path / "s.sqlite")).finding(fid)["status"] == ("open" if stays else "closed")


def test_the_margin_never_opens_a_fault(tmp_path):
    """The margin holds an open fault only: a battery at 22 % with nothing open is not low (the night's own rule)."""
    import importlib
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    R = importlib.import_module("rules")
    from vesta_shared.params import VillaParams
    import yaml
    defaults = yaml.safe_load(open(os.path.join(SKILL, "settings.yaml")))["behaviour"]
    p = VillaParams({}, {}, defaults)
    a = {"slug": "door_a", "name": "Door A", "critical": False}
    day = NOW.date()
    assert R.battery_rules(a, BAT_LOW, "%", 22, [], p, day) == []
    assert [f.rule_id for f in R.battery_rules(a, BAT_LOW, "%", 22, [], p, day, frozenset({"PM-BATTERY-LOW"}))] == ["PM-BATTERY-LOW"]
    assert [f.rule_id for f in R.battery_rules(a, BAT_LOW, "%", 12, [], p, day, frozenset({"PM-BATTERY-CRIT"}))] == ["PM-BATTERY-CRIT"]


@pytest.mark.parametrize("best,stays", [(49.0, False), (12.0, True), (None, True)])
def test_a_battery_is_judged_on_its_best_reading_of_the_day(tmp_path, best, stays):
    """Owner, 2026-10-21: a motion sensor read 1 % between two readings near 50 % — a coin cell dipping under load. A
    battery is judged on its highest reading of the last 24 h (settings.yaml battery_level_window_hours): an open
    "replace now" whose battery read 49 % an hour ago closes on a 1 % dip; one whose best was 12 % stays; with no
    statistics, its reading now decides, as before."""
    _pack(tmp_path)
    store = Store(str(tmp_path / "s.sqlite"))
    fid, _ = _found(store, "PM-BATTERY-CRIT", BAT_CRIT, "battery low.")
    _villa(tmp_path, {BAT_CRIT: _st("1", 5)})
    if best is not None:
        t = int((NOW - timedelta(hours=2)).timestamp() * 1000)
        old = int((NOW - timedelta(hours=30)).timestamp() * 1000)          # outside the window: never counts
        (tmp_path / "fx" / "stats_hour_bat.json").write_text(json.dumps({"period_type": "hour", "entities": [
            {"entity_id": BAT_CRIT, "statistics": [{"start": old, "max": 90.0}, {"start": t, "max": best}]}]}))
    _tick(tmp_path)
    assert Store(str(tmp_path / "s.sqlite")).finding(fid)["status"] == ("open" if stays else "closed")


@pytest.mark.parametrize("was,sev,reads,now_rule", [("PM-BATTERY-LOW", "P3", "8", "PM-BATTERY-CRIT"),
                                                     ("PM-BATTERY-CRIT", "P2", "17", "PM-BATTERY-LOW")])
def test_a_battery_that_moves_a_step_is_handed_over_never_cleared(tmp_path, was, sev, reads, now_rule):
    """Architecture review, 2026-10-22: "within the week" and "replace now" are two rules, so a battery at 18 % that
    fell to 8 % closed "Cleared: the check at 14:05 no longer sees it" and nothing showed until 02:00 — and a P2 back
    at 17 % (still under its 20 % line) was marked cleared. The old step closes saying the new one, which opens now."""
    _pack(tmp_path)
    store = Store(str(tmp_path / "s.sqlite"))
    fid, tid = _found(store, was, BAT_LOW, "Door A battery: was.", sev)
    _villa(tmp_path, {BAT_LOW: _st(reads, 5)})
    out = _tick(tmp_path)
    st = Store(str(tmp_path / "s.sqlite"))
    assert st.finding(fid)["status"] == "closed"
    note = st.task(tid)["close_note"]
    assert note.startswith("Now: Door A battery") and "Cleared" not in note
    (now,) = [f for f in st.findings(status="open") if f["entity_id"] == BAT_LOW]
    assert now["rule_id"] == now_rule
    assert out["edits"] == []                                     # no P2 message rewritten as cleared


def test_a_battery_that_moves_a_step_at_night_is_handed_over(tmp_path):
    """The night's reading of the same fact (nightly.battery_moved)."""
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import nightly as N
    from types import SimpleNamespace as F
    opened = [{"rule_id": "PM-BATTERY-LOW", "entity_id": BAT_LOW}, {"rule_id": "PM-BATTERY-LOW", "entity_id": BAT_CRIT}]
    found = [F(rule_id="PM-BATTERY-CRIT", entity_id=BAT_LOW, summary="Door A battery at 8%: replace now."),
             F(rule_id="PM-BATTERY-LOW", entity_id=BAT_CRIT, summary="Lock B battery at 15%: replace within the week.")]
    assert N.battery_moved(opened, found) == {("PM-BATTERY-LOW", BAT_LOW): "Now: Door A battery at 8%: replace now."}


def test_a_restart_does_not_close_an_open_silent_fault(tmp_path):
    # villa, 2026-10-26: a restart of the villa's system stamps every sensor; the recheck read the quiet sensor as
    # "reported 6 h ago", closed its fault ("Cleared: the check at … no longer sees it"), and the night opened it again
    # a day later. Its history says it last really reported 3 days ago: the fault stays open.
    _pack(tmp_path)
    store, f = _night_findings(tmp_path)
    restart, last = NOW - timedelta(hours=6), NOW - timedelta(days=3)
    _villa(tmp_path, {TEMP: {"state": "21.5", "attributes": {}, "last_changed": restart.isoformat(),
                             "last_reported": restart.isoformat()}})
    (tmp_path / "fx" / "history_raw_a.json").write_text(json.dumps({"entities": [{"entity_id": TEMP, "states": [
        {"state": "21.1", "last_changed": (last - timedelta(minutes=5)).isoformat()},
        {"state": "21.5", "last_changed": last.isoformat()},
        {"state": "unavailable", "last_changed": (restart - timedelta(seconds=30)).isoformat()},
        {"state": "21.5", "last_changed": restart.isoformat()}]}]}))
    _tick(tmp_path)
    st = Store(str(tmp_path / "s.sqlite"))
    assert st.finding(f["temp"][0])["status"] == "open"
    assert st.finding(f["temp"][0])["seen_at"] == NOW.isoformat()                 # read again, and still there
