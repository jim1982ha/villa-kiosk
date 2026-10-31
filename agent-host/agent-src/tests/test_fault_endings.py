"""Every way a fault ends says the same sentence, whichever check notices first (architecture review round 13, card 2,
2026-11-01): a deleted device (14 Oct), a hidden one (19 Oct) and a device still off (21 Oct) read "Cleared: the
nightly check no longer sees it" when the 02:00 night check saw them first, and their own sentence when the 5-minute
recheck did; each fix went into one check only. ONE table of endings (preventive-maintenance endings.py), each case
driven through recheck.py AND nightly.py as the engine runs them, from the same villa. Invented entities."""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import pytest

from helpers import PYTHONPATH, STARTER_SKILLS
from vesta_shared.problems import Problems
from vesta_shared.store import Store

SKILL = os.path.join(STARTER_SKILLS, "preventive-maintenance")
sys.path.insert(0, os.path.join(SKILL, "scripts"))
import endings as E  # noqa: E402

NOW = datetime(2026, 10, 10, 0, 0, tzinfo=timezone.utc)     # the night of the 9th ends here: both checks read it
NIGHT_OF = "2026-10-09"
LOCK, SIGNAL, BATT = "lock.example_door", "sensor.example_door_signal", "sensor.example_door_battery"


def _st(state, minutes_ago):
    t = (NOW - timedelta(minutes=minutes_ago)).isoformat()
    return {"state": state, "attributes": {}, "last_changed": t, "last_reported": t}


def _row(eid, name, family):
    return {"entity_id": eid, "name": name, "area": "Garden", "family": family, "asset": "example_door",
            "device_id": "dev-door", **({"unit": "%"} if family == "battery" else {})}


def _villa(tmp, case: str):
    """The villa as `case` leaves it, in its own folder: the pack, the store with ONE open fault and its task, the
    villa's states. Returns (the folder, the fault's id, the alert's id or None)."""
    tmp.mkdir(parents=True)
    door = [] if case in ("hidden", "missing") else [_row(LOCK, "Example door", "security")]
    signal = [] if case in ("hidden", "missing") else [_row(SIGNAL, "Example door signal", "network")]
    (tmp / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        # a hidden entity is left out of every family (knowledge_pack `hidden`), as the pack is built; a device gone
        # from the villa's system is in no pack any more (rebuilt without it)
        "hidden": [LOCK, SIGNAL] if case == "hidden" else [],
        "families": {"security": door, "network": signal,
                     "battery": [_row(BATT, "Example door", "battery")] if case == "battery" else []},
        "assets": {}}))
    if case == "asleep":
        (tmp / "unavailable_by_design.json").write_text(json.dumps({"ids": [LOCK]}))
    store = Store(str(tmp / "s.sqlite"))
    if case == "missing":
        # the door was in the packs (one device), then a pack no longer had it: the baseline of what may go missing
        store.pack_diff([{"entity_id": LOCK, "family": "security", "seen_name": "Example door", "device": "dev-door"},
                         {"entity_id": SIGNAL, "family": "network", "seen_name": "Example door", "device": "dev-door"}])
        store.pack_diff([])
        db = sqlite3.connect(str(tmp / "s.sqlite"))
        db.execute("UPDATE pack_seen SET last_seen=?, gone_at=?",
                   ((NOW - timedelta(hours=2)).isoformat(), (NOW - timedelta(hours=1)).isoformat()))
        db.commit(); db.close()
    if case == "battery":
        fid, _ = store.raise_finding("PM-BATTERY-LOW", BATT, "example_door", "2026-10-08", "P3",
                                     "Example door battery at 15%: replace within the week.", {})
    elif case == "gone":
        # a fault about something the villa's system deleted and no pack watched (never missing): it is gone
        fid, _ = store.raise_finding("PM-BATTERY-LOW", "sensor.example_old_battery", "old", "2026-10-08", "P3",
                                     "Old battery at 15%: replace within the week.", {})
    else:
        fid, _ = store.raise_finding("PM-UNAVAILABLE", LOCK, "security", "2026-10-08", "P2",
                                     "Example door has been offline for 1h.", {"hours": 1, "entities": [LOCK]})
    Problems(store).settle(f"finding:{fid}")
    iid = store.new_incident("watch|lock.example_door", "automation.example_watchdog", LOCK, "P2",
                             {"bad_states": ["unavailable"], "entities": [LOCK]}) if case == "alert" else None
    lock = {"back": _st("locked", 70), "battery": _st("locked", 70)}.get(case, _st("unavailable", 70))
    sig = {"back": _st("-61", 70), "answers": _st("-61", 3), "battery": _st("-61", 3)}.get(case, _st("unavailable", 70))
    states = {} if case in ("gone", "missing") else {LOCK: lock, SIGNAL: sig}
    if case == "battery":
        states[BATT] = _st("8", 60)                       # fell under the "replace now" line
    gone = {"gone": ["sensor.example_old_battery"], "missing": [LOCK, SIGNAL]}.get(case, [])
    fx = tmp / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": states, "not_found": gone}))
    (fx / "rules.json").write_text("[]")
    return tmp, fid, iid


def _recheck(tmp):
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "recheck.py"), "--store", str(tmp / "s.sqlite"),
                        "--pack", str(tmp / "pack.json"), "--fixture-dir", str(tmp / "fx"), "--now", NOW.isoformat(),
                        "--zone", "UTC"],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _night(tmp):
    r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "nightly.py"), "--pack", str(tmp / "pack.json"),
                        "--store", str(tmp / "s.sqlite"), "--fixture-dir", str(tmp / "fx"), "--skip-raw",
                        "--as-of", NIGHT_OF, "--out", str(tmp / "res.json")],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=120)
    assert r.returncode == 0, r.stderr
    return json.loads((tmp / "res.json").read_text())


def _closed_with(tmp, fid) -> str:
    st = Store(str(tmp / "s.sqlite"))
    assert st.finding(fid)["status"] == "closed"
    (task,) = [t for t in st.tasks(None) if t["source"] == f"finding:{fid}"]
    assert task["status"] != "open"
    return task["close_note"]


def _missing_summary(tmp) -> str:
    (m,) = [f for f in Store(str(tmp / "s.sqlite")).findings("open") if f["rule_id"] == "PM-MISSING"]
    return m["summary"]


#: Every way a fault ends (endings.ENDS), its sentence, and whether another problem follows it now (handed over)
CASES = {
    "back": (lambda tmp, iid: E.BACK_ONLINE_NOTE, False),
    "hidden": (lambda tmp, iid: E.HIDDEN_NOTE, False),
    "asleep": (lambda tmp, iid: E.ASLEEP_NOTE, False),
    "answers": (lambda tmp, iid: E.ANSWERS_NOTE, False),
    "alert": (lambda tmp, iid: f"Followed by alert #{iid}-P2, which says when it is back.", True),
    "missing": (lambda tmp, iid: f"Followed by: {_missing_summary(tmp)}", True),
    "gone": (lambda tmp, iid: E.GONE_NOTE, False),
    "battery": (lambda tmp, iid: "Now: Example door battery at 8%: replace now.", True),
}


def test_the_table_is_every_ending():
    assert set(CASES) == {e.name for e in E.ENDS}


@pytest.mark.parametrize("case", sorted(CASES))
def test_a_fault_ends_with_the_same_sentence_whichever_check_sees_it_first(tmp_path, case):
    said, handed = CASES[case]
    day, fid, iid = _villa(tmp_path / "day", case)
    out = _recheck(day)
    night, nfid, niid = _villa(tmp_path / "night", case)
    res = _night(night)
    assert (nfid, niid) == (fid, iid)
    by_day, by_night = _closed_with(day, fid), _closed_with(night, nfid)
    assert by_day == by_night == said(day, iid), (case, by_day, by_night)
    assert "no longer sees it" not in by_night
    # handed over: another problem follows it, never counted cleared (nor its message marked cleared)
    assert (nfid in [o["id"] for o in res["handed_over"]]) is handed
    assert (nfid in [o["id"] for o in res["closed"]]) is not handed
    assert out["faults_changed"] is True


def test_what_no_ending_explains_still_closes_as_no_longer_seen(tmp_path):
    # the door's battery changed (100 %): no ending explains it, its problem is simply gone — the one case "no longer
    # sees it" is left for, said by each check its own way (the recheck with its time)
    for where, run, note in (("day", _recheck, E.cleared_note(NOW, "UTC")), ("night", _night, E.cleared_note())):
        tmp, fid, _ = _villa(tmp_path / where, "battery")
        states = json.loads((tmp / "fx" / "states.json").read_text())
        states["states"][BATT] = _st("100", 60)
        (tmp / "fx" / "states.json").write_text(json.dumps(states))
        run(tmp)
        assert _closed_with(tmp, fid) == note, where
    assert E.cleared_note() == "Cleared: the nightly check no longer sees it."
