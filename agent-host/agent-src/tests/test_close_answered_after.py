"""A person's close of a night-check fault is answered only by what the readings show after it (architecture review 25).
The recheck recorded a fault as seen at the moment it read it: a reconnect loop the facility manager fixed and closed
was "Fault still there after the close" at the next 5-minute check, because the window still held the drops from
before the fix (and again at every check for 3 days); a pump fixed and closed on the day the night then judged was
"still there" by that day's own figure, most of it from before the fix. Synthetic villa; names invented."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone

from helpers import STARTER_SKILLS
from test_recheck_all import PYTHONPATH, SKILL, _found, _row
from vesta_shared.problems import STILL_THERE, Problems
from vesta_shared.store import Store

sys.path.insert(0, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
import nightly  # noqa: E402
import rules as R  # noqa: E402

RELAY = "switch.example_relay"
NOW = datetime(2026, 10, 19, 17, 5, tzinfo=timezone.utc)


def _tick_with_drops(tmp_path, drops: list[datetime]) -> Store:
    (tmp_path / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "families": {"network": [_row(RELAY, "Pool relay", "network", "relay", "dev_r")]}, "assets": {}}))
    fx = tmp_path / "fx"
    fx.mkdir(exist_ok=True)
    t0 = (NOW - timedelta(minutes=30)).isoformat()
    (fx / "states.json").write_text(json.dumps({"states": {RELAY: {"state": "on", "attributes": {}, "last_changed": t0,
                                                                   "last_reported": t0}}}))
    entries = []
    for t in drops:                                       # one-minute drops
        entries += [{"entity_id": RELAY, "state": "unavailable", "when": t.isoformat()},
                    {"entity_id": RELAY, "state": "on", "when": (t + timedelta(minutes=1)).isoformat()}]
    (fx / "logbook.json").write_text(json.dumps({"entries": entries}))
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "--pack", str(tmp_path / "pack.json"),
                        "--store", str(tmp_path / "s.sqlite"), "--fixture-dir", str(fx), "--now", NOW.isoformat(),
                        "--zone", "UTC"], capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH},
                       timeout=60)
    assert r.returncode == 0, r.stderr
    return Store(str(tmp_path / "s.sqlite"))


def _a_loop_closed_2_hours_ago(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    fid, tid = _found(store, "PM-RECONNECT-LOOP", RELAY, "Pool relay dropped and reconnected 12 times in 3 days.",
                      day="2026-10-19")
    Problems(store).closed_in_kiosk(tid, "Done in the Cockpit", at=(NOW - timedelta(hours=2)).isoformat(), who="JM")
    return fid, tid


def test_a_fixed_loop_closed_by_a_person_holds_while_no_drop_follows_the_close(tmp_path):
    fid, tid = _a_loop_closed_2_hours_ago(tmp_path)
    # twelve drops, all before the fix: the window still counts them, the close stands
    st = _tick_with_drops(tmp_path, [NOW - timedelta(hours=4 + k * 1.5) for k in range(12)])
    assert st.task(tid)["status"] == "closed_in_kiosk", st.task(tid)
    assert st.finding(fid)["seen_at"] == (NOW - timedelta(hours=4)).isoformat()      # seen at its latest drop


def test_a_loop_that_drops_again_after_the_close_is_still_there(tmp_path):
    fid, tid = _a_loop_closed_2_hours_ago(tmp_path)
    st = _tick_with_drops(tmp_path, [NOW - timedelta(minutes=30)] + [NOW - timedelta(hours=4 + k * 1.5) for k in range(11)])
    assert st.task(tid)["status"] == "open" and st.task(tid)["reopen_note"] == STILL_THERE, st.task(tid)


def test_a_day_is_seen_from_its_start_so_only_a_day_after_the_close_answers_it(tmp_path, monkeypatch):
    # the pump's day rule, as the night and the recheck read it (nightly.asset_findings)
    asset = {"slug": "pump", "name": "Pump", "kind": "motor", "entities": {"power": "sensor.example_pump_power"}}

    def weak(asset_, eid, *a, **k):
        return [R.Finding("PM-POWER-CHANGE", eid, "pump", "power", "P3", "Pump draws 40% less than its normal.", {})]
    monkeypatch.setattr(nightly.R, "power_rules", weak)
    from vesta_shared.params import VillaParams
    from vesta_shared.skill_settings import load
    params = VillaParams(defaults=load(os.path.join(STARTER_SKILLS, "preventive-maintenance"), "settings.yaml")["behaviour"])
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)

    def night(day: date):
        end = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + timedelta(days=1)
        found, _ = nightly.asset_findings(None, store, params, asset, day, end, {}, {}, end + timedelta(hours=2), "UTC",
                                          timezone.utc, [], skip_raw=True, write_features=False)
        assert [f.seen_at for f in found] == [(end - timedelta(days=1)).isoformat()]
        pb.record_night(found, day.isoformat(), state_rules=nightly.STATE_RULES, event_rules=nightly.EVENT_RULES,
                        worsened_step=10, settle_minutes=10)
        (fid,) = [f["id"] for f in store.findings(status="open")]
        return store.last_task(f"finding:{fid}")

    task = night(date(2026, 10, 17))
    # fixed and closed at 15:00 on the 18th: the night of the 18th judges a day mostly from before the fix
    pb.closed_in_kiosk(task["id"], "Done in the Cockpit", at="2026-10-18T15:00:00+00:00", who="JM")
    # the Cockpit's "VESTA confirms by": the night that judges the 19th, the first whole day after the close
    monkeypatch.setenv("TZ", "UTC")
    nights = lambda after: datetime.combine(after.date() + timedelta(days=after.hour >= 2), datetime.min.time(),  # noqa: E731
                                            tzinfo=timezone.utc) + timedelta(hours=2)
    assert pb.confirms_by(store.task(task["id"]), nights, now=datetime(2026, 10, 18, 16, tzinfo=timezone.utc)) \
        == "2026-10-20T02:00:00+00:00"
    assert night(date(2026, 10, 18))["status"] == "closed_in_kiosk"
    # the 19th, a whole day after the close, still weak: the close did not fix it
    t = night(date(2026, 10, 19))
    assert t["status"] == "open" and t["reopen_note"] == STILL_THERE, t
