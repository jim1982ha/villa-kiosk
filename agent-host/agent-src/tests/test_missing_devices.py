"""A device gone from the villa's system altogether is MISSING, not over (owner, 2026-10-31: an entrance lock its hub
stopped sharing vanished at 00:19 — no state, no registry entry — and VESTA said nothing; the owner found it on the
Kiosk's map). Driven through recheck.py and nightly.py as the engine runs them. Invented entities."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

from helpers import PYTHONPATH, STARTER_SKILLS
from vesta_shared.problems import Problems
from vesta_shared.store import Store

SKILL = os.path.join(STARTER_SKILLS, "preventive-maintenance")
T0 = datetime(2026, 10, 31, 0, 25, tzinfo=timezone.utc)
LOCK, BATT, TH = "lock.example_door", "sensor.example_door_battery", "sensor.example_th_humidity"
WATCHDOG = {"entity_id": "automation.example_watchdog", "kind": "automation", "config": {
    "alias": "Critical watchdog", "use_blueprint": {"path": "critical_watchdog.yaml",
                                                    "input": {"critical_entities": [LOCK, "switch.example_pump"]}}}}


def _pack(tmp, critical=(LOCK,)) -> str:
    """The pack as rebuilt a minute after the lock left: the lock is no longer in it, only the critical list names it."""
    path = tmp / "pack.json"
    path.write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "families": {"level": [{"entity_id": TH, "name": "TH humidity", "family": "level", "asset": "th",
                                "device_id": "dev-th"}]},
        "assets": {}, "critical": list(critical)}))
    return str(path)


def _seen(tmp):
    """The packs before: the lock and its battery seen (one device), then a pack without them."""
    st = Store(str(tmp / "s.sqlite"))
    th = {"entity_id": TH, "family": "level", "seen_name": "TH sensor", "device": "dev-th"}
    st.pack_diff([{"entity_id": LOCK, "family": "security", "seen_name": "Example door", "device": "dev-door"},
                  {"entity_id": BATT, "family": "battery", "seen_name": "Example door", "device": "dev-door"}, th])
    st.pack_diff([th])
    return st


def _fx(tmp, states: dict, not_found=(), rules=None):
    fx = tmp / "fx"
    fx.mkdir(exist_ok=True)
    (fx / "states.json").write_text(json.dumps({"states": states, "not_found": list(not_found)}))
    (fx / "rules.json").write_text(json.dumps(rules if rules is not None else [WATCHDOG]))
    return fx


def _recheck(tmp, states, now, not_found=(), critical=(LOCK,), rules=None):
    fx = _fx(tmp, states, not_found, rules)
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "--store", str(tmp / "s.sqlite"),
                        "--pack", _pack(tmp, critical), "--fixture-dir", str(fx), "--now", now.isoformat()],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _st(state="55"):
    return {"state": state, "last_changed": (T0 - timedelta(hours=1)).isoformat(), "attributes": {}}


def _missing(tmp):
    return [f for f in Store(str(tmp / "s.sqlite")).findings("open") if f["rule_id"] == "PM-MISSING"]


def test_a_critical_device_gone_from_the_villas_system_is_a_fault_within_the_five_minute_check(tmp_path):
    _seen(tmp_path)
    out = _recheck(tmp_path, {TH: _st()}, T0, not_found=[LOCK, BATT])
    (f,) = _missing(tmp_path)
    assert f["severity"] == "P2" and f["entity_id"] == LOCK
    assert f["summary"].startswith("Example door is missing from the villa's system since ")
    assert sorted(json.loads(f["detail"])["entities"]) == sorted([BATT, LOCK])  # one device, one fault
    check = json.loads(f["detail"])["check"]
    assert check == ("Re-pair it, or press Done if it was removed on purpose. "
                     "Still named in automation 'Critical watchdog': remove it there.")
    (msg,) = out["send"]
    assert msg["to"] == "fm" and "Example door is missing from the villa's system" in msg["text"]
    assert LOCK not in f["summary"] and "Home Assistant" not in msg["text"]
    # once: the next check sees it still missing and says nothing more
    assert _recheck(tmp_path, {TH: _st()}, T0 + timedelta(minutes=5), not_found=[LOCK, BATT])["send"] == []
    assert len(_missing(tmp_path)) == 1


def test_a_critical_device_the_packs_never_named_is_missing_too_named_in_words(tmp_path):
    Store(str(tmp_path / "s.sqlite"))
    _recheck(tmp_path, {TH: _st()}, T0, not_found=[LOCK])
    (f,) = _missing(tmp_path)
    assert f["summary"].startswith("Example door is missing")                  # never the raw id


def test_a_failed_read_is_never_missing(tmp_path):
    _seen(tmp_path)
    # no state for the lock, but the villa's system never answered "not found" (a timeout, a refusal)
    out = _recheck(tmp_path, {TH: _st()}, T0, not_found=[])
    assert _missing(tmp_path) == [] and out["send"] == []


def test_done_forgets_the_device_and_it_is_never_said_again(tmp_path):
    _seen(tmp_path)
    _recheck(tmp_path, {TH: _st()}, T0, not_found=[LOCK, BATT])
    st = Store(str(tmp_path / "s.sqlite"))
    (task,) = st.tasks("open")
    Problems(st).closed_in_kiosk(task["id"])
    _recheck(tmp_path, {TH: _st()}, T0 + timedelta(minutes=5), not_found=[LOCK, BATT])
    st = Store(str(tmp_path / "s.sqlite"))
    assert _missing(tmp_path) == [] and LOCK not in st.pack_seen_rows() and BATT not in st.pack_seen_rows()
    # still missing an hour on, still on the critical list: nothing opens again, nothing is sent
    out = _recheck(tmp_path, {TH: _st()}, T0 + timedelta(hours=1), not_found=[LOCK, BATT])
    assert _missing(tmp_path) == [] and out["send"] == [] and Store(str(tmp_path / "s.sqlite")).tasks("open") == []
    # ...and it answers again one day: watched again, missing again if it goes
    _recheck(tmp_path, {TH: _st(), LOCK: _st("locked")}, T0 + timedelta(hours=2))
    _recheck(tmp_path, {TH: _st()}, T0 + timedelta(hours=3), not_found=[LOCK])
    assert len(_missing(tmp_path)) == 1


def test_a_missing_device_that_comes_back_closes_its_fault(tmp_path):
    _seen(tmp_path)
    _recheck(tmp_path, {TH: _st()}, T0, not_found=[LOCK, BATT])
    out = _recheck(tmp_path, {TH: _st(), LOCK: _st("locked"), BATT: _st("80")}, T0 + timedelta(minutes=5))
    assert _missing(tmp_path) == [] and out["faults_changed"] is True
    st = Store(str(tmp_path / "s.sqlite"))
    assert st.tasks("open") == []
    assert [t["close_note"] for t in st.tasks(None)] == ["Cleared: back in the villa's system."]


def test_an_offline_fault_whose_device_is_gone_follows_the_missing_one_never_closed_in_silence(tmp_path):
    st = _seen(tmp_path)
    fid, _ = st.raise_finding("PM-UNAVAILABLE", LOCK, "security", "2026-10-30", "P3",
                              "Example door has been offline for 1h.", {"hours": 1, "entities": [LOCK]})
    Problems(st).open_task("finding", fid, "PM-UNAVAILABLE", LOCK, "Example door offline")
    # not on the critical list: found through its open fault
    _recheck(tmp_path, {TH: _st()}, T0, not_found=[LOCK, BATT], critical=())
    st = Store(str(tmp_path / "s.sqlite"))
    (m,) = _missing(tmp_path)
    assert m["severity"] == "P3"
    assert st.finding(fid)["status"] == "closed"
    notes = [t["close_note"] for t in st.tasks(None) if t["status"] != "open"]
    assert notes == [f"Followed by: {m['summary']}"]


def test_the_night_check_finds_a_device_gone_that_no_fault_was_about(tmp_path):
    _seen(tmp_path)
    fx = _fx(tmp_path, {TH: _st()}, [LOCK, BATT], rules=[])
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "nightly.py"), "--pack", _pack(tmp_path, ()),
                        "--store", str(tmp_path / "s.sqlite"), "--fixture-dir", str(fx), "--skip-raw",
                        "--as-of", "2026-10-30", "--out", str(tmp_path / "res.json")],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=120)
    assert r.returncode == 0, r.stderr
    (f,) = _missing(tmp_path)
    assert f["severity"] == "P3" and json.loads(f["detail"])["check"] == (
        "Re-pair it, or press Done if it was removed on purpose.")


def test_devices_gone_before_this_release_are_not_missing_now(tmp_path):
    import sqlite3
    path = str(tmp_path / "old.sqlite")
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE pack_seen (entity_id TEXT PRIMARY KEY, first_seen TEXT, family TEXT, area TEXT, last_seen TEXT)")
    db.executemany("INSERT INTO pack_seen VALUES (?,?,?,?,?)",
                   [(TH, "a", "level", None, "2026-10-30T01:30:00"), (LOCK, "a", "security", None, "2026-09-01T01:30:00")])
    db.commit(); db.close()
    assert set(Store(path).pack_seen_rows()) == {TH}


def _left(tmp, at: datetime):
    """The packs' last sighting set two hours before `at`, and the villa's history of the door: its lock and battery
    reporting, then each one's removal row (no state) at 00:19:32 — as the villa recorded the lock that left."""
    import sqlite3
    db = sqlite3.connect(str(tmp / "s.sqlite"))
    db.execute("UPDATE pack_seen SET last_seen=?", ((at - timedelta(hours=2)).isoformat(),))
    db.commit(); db.close()
    gone = at.replace(minute=19, second=32)
    fx = tmp / "fx"
    fx.mkdir(exist_ok=True)
    (fx / "history_raw_door.json").write_text(json.dumps({"data": {"entities": [
        {"entity_id": LOCK, "states": [{"state": "locked", "last_changed": (at - timedelta(days=3)).isoformat()},
                                       {"state": "unlocked", "last_changed": (gone - timedelta(seconds=18)).isoformat()},
                                       {"state": "locked", "last_changed": (gone - timedelta(seconds=10)).isoformat()},
                                       {"state": None, "last_changed": gone.isoformat()}]},
        {"entity_id": BATT, "states": [{"state": "80", "last_changed": (at - timedelta(days=1)).isoformat()},
                                       {"state": None, "last_changed": gone.isoformat()}]}]}}))
    return gone


def test_a_missing_device_is_missing_since_it_left_never_since_the_check_first_looked(tmp_path):
    # villa, 2026-10-31: the lock left at 00:19:32; 0.12.420, started at 13:38, said "missing … since 31/10/2026 13:38"
    # (the moment its pack first lacked it). The villa's history says when it left: its removal row, the one with no state
    from vesta_shared.timeutil import moment_label
    _seen(tmp_path)
    gone = _left(tmp_path, T0)
    _recheck(tmp_path, {TH: _st()}, T0 + timedelta(hours=13), not_found=[LOCK, BATT])
    (f,) = _missing(tmp_path)
    assert f["summary"] == f"Example door is missing from the villa's system since {moment_label(gone, 'UTC')}."
    d = json.loads(f["detail"])
    assert d["since"] == gone.isoformat() and d["since_read"] is True


def test_a_missing_fault_that_said_when_the_check_looked_is_corrected_in_place(tmp_path):
    # a fault 0.12.420 opened, "since" the check's own moment, its history never read: the next check corrects its words
    from vesta_shared.timeutil import moment_label
    st = _seen(tmp_path)
    gone = _left(tmp_path, T0)
    wrong = (T0 + timedelta(hours=13)).isoformat()
    fid, _ = st.raise_finding("PM-MISSING", LOCK, "availability", "2026-10-31", "P2",
                              f"Example door is missing from the villa's system since {moment_label(datetime.fromisoformat(wrong), 'UTC')}.",
                              {"critical": True, "entities": [LOCK, BATT], "since": wrong, "name": "Example door",
                               "named_in": [], "check": "Re-pair it, or press Done if it was removed on purpose."})
    out = _recheck(tmp_path, {TH: _st()}, T0 + timedelta(hours=14), not_found=[LOCK, BATT])
    (f,) = _missing(tmp_path)
    assert f["id"] == fid and out["send"] == []                                      # the same fault, not told again
    assert f["summary"] == f"Example door is missing from the villa's system since {moment_label(gone, 'UTC')}."
    assert json.loads(f["detail"])["since_read"] is True


def test_a_missing_device_whose_history_is_not_read_is_missing_since_the_pack_lacked_it(tmp_path):
    # no history of it: the moment a pack first no longer had it, never the moment of the check
    st = _seen(tmp_path)
    import sqlite3
    db = sqlite3.connect(str(tmp_path / "s.sqlite"))
    db.execute("UPDATE pack_seen SET last_seen=?, gone_at=? WHERE gone_at IS NOT NULL",
               ((T0 - timedelta(hours=2)).isoformat(), (T0 - timedelta(hours=1)).isoformat()))
    db.commit(); db.close()
    _recheck(tmp_path, {TH: _st()}, T0 + timedelta(hours=13), not_found=[LOCK, BATT])
    (f,) = _missing(tmp_path)
    assert json.loads(f["detail"])["since"] == (T0 - timedelta(hours=1)).isoformat()



def test_when_it_left_is_the_agreements_answer_for_each_of_its_cases():
    # ⚠️ ONE RULE, THE KIOSK'S TOO (architecture review round 10, card 1): the device window on the tablet said "last
    # seen" at the start of what it read (the state carried over to it), Telegram the removal. The agreement's
    # leftAt.cases are the rows and the answer both sides give: the Kiosk's history source runs them, so does this.
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import nightly
    from vesta_shared import agreement
    from vesta_shared.past import History

    class Cli:
        def __init__(self, rows):
            self.rows = rows

        def kept_from(self, now):
            return None

        def history_read(self, ids, start, end, now=None):
            return History({LOCK: self.rows}, start, end)
    cases = agreement.section("leftAt")["cases"]
    assert len(cases) >= 5
    for c in cases:
        got = nightly.left_at(Cli(c["rows"]), [LOCK], [{"last_seen": c["from"]}], T0)
        assert got == (c["leftAt"], True), c["_"]
