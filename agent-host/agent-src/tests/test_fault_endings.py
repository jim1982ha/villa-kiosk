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
TEMP, WATCH = "sensor.example_room_temperature", "automation.example_watch"


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
    gone_from_pack = ("hidden", "missing", "hidden_battery", "rule_gone", "answers_again")
    door = [] if case in gone_from_pack else [_row(LOCK, "Example door", "security")]
    signal = [] if case in gone_from_pack else [_row(SIGNAL, "Example door signal", "network")]
    (tmp / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        # a hidden entity is left out of every family (knowledge_pack `hidden`), as the pack is built; a device gone
        # from the villa's system is in no pack any more (rebuilt without it)
        "hidden": {"hidden": [LOCK, SIGNAL], "hidden_battery": [LOCK, SIGNAL, BATT], "rule_gone": [LOCK, SIGNAL],
                   "answers_again": [LOCK, SIGNAL]}.get(case, []),
        "families": {"security": door, "network": signal,
                     "battery": [_row(BATT, "Example door", "battery")] if case == "battery" else [],
                     "level": [_row(TEMP, "Example room temperature", "level")] if case == "asleep_silent" else []},
        "assets": {}}))
    if case in ("asleep", "asleep_silent"):
        (tmp / "unavailable_by_design.json").write_text(json.dumps({"ids": [TEMP if case == "asleep_silent" else LOCK]}))
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
    if case in ("battery", "hidden_battery"):
        fid, _ = store.raise_finding("PM-BATTERY-LOW", BATT, "example_door", "2026-10-08", "P3",
                                     "Example door battery at 15%: replace within the week.", {})
    elif case == "asleep_silent":
        fid, _ = store.raise_finding("PM-SILENT", TEMP, "example_door", "2026-10-08", "P3",
                                     "Example room temperature has not reported for 2 d 3 h although it is online.", {})
    elif case in ("rule_gone", "answers_again"):
        fid, _ = store.raise_finding("PM-HIDDEN-IN-RULE", WATCH, WATCH, "2026-10-08", "P3",
                                     "The automation 'Example watch' watches 1 device hidden in the villa's system that "
                                     "no longer answers: Example door (offline).",
                                     {"name": "Example watch", "kind": "automation", "hidden": [LOCK], "count": 1})
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
    lock = {"back": _st("locked", 70), "battery": _st("locked", 70), "answers_again": _st("locked", 3)}.get(
        case, _st("unavailable", 70))
    sig = {"back": _st("-61", 70), "answers": _st("-61", 3), "battery": _st("-61", 3)}.get(case, _st("unavailable", 70))
    states = {} if case in ("gone", "missing") else {LOCK: lock, SIGNAL: sig}
    if case in ("battery", "hidden_battery"):
        states[BATT] = _st("8", 60)                       # fell under the "replace now" line
    if case == "asleep_silent":
        states[TEMP] = _st("unavailable", 60 * 51)
    gone = {"gone": ["sensor.example_old_battery"], "missing": [LOCK, SIGNAL], "rule_gone": [WATCH]}.get(case, [])
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


#: Every way a fault ends (endings.ENDS) — by how its device stands, for every kind of fault it ends (architecture
#: review 22, card 3: hidden and asleep ended the offline fault only) —: the villa's case → the ending, its sentence,
#: and whether another problem follows it now (handed over)
CASES = {
    "back": ("back", lambda tmp, iid: E.BACK_ONLINE_NOTE, False),
    "hidden": ("hidden", lambda tmp, iid: E.HIDDEN_NOTE, False),
    "hidden_battery": ("hidden", lambda tmp, iid: E.HIDDEN_NOTE, False),
    "asleep": ("asleep", lambda tmp, iid: E.ASLEEP_NOTE, False),
    "asleep_silent": ("asleep", lambda tmp, iid: E.ASLEEP_NOTE, False),
    "answers": ("answers", lambda tmp, iid: E.ANSWERS_NOTE, False),
    "alert": ("alert", lambda tmp, iid: f"Followed by alert #{iid}-P2, which says when it is back.", True),
    "missing": ("missing", lambda tmp, iid: f"Followed by: {_missing_summary(tmp)}", True),
    "gone": ("gone", lambda tmp, iid: E.GONE_NOTE, False),
    "battery": ("battery", lambda tmp, iid: "Now: Example door battery at 8%: replace now.", True),
    # a hidden-device fault is about its automation: deleted, it says so; its devices back, "back online"
    # (architecture review 22, card 7: "this device no longer exists", said of an automation)
    "rule_gone": ("rule_gone", lambda tmp, iid: "Closed: the automation 'Example watch' no longer exists in the villa's "
                                                "system.", False),
    "answers_again": ("answers_again", lambda tmp, iid: E.BACK_ONLINE_NOTE, False),
}
#: the endings told by a test of their own (their sentence carries the night's words of the fault that follows)
@pytest.mark.parametrize("case", sorted(CASES))
def test_a_fault_ends_with_the_same_sentence_whichever_check_sees_it_first(tmp_path, case):
    _, said, handed = CASES[case]
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


def _silent_then_offline(tmp, offline_fault: bool):
    """A level sensor's silence fault, the sensor offline now (`offline_fault`: its offline fault open already)."""
    tmp.mkdir(parents=True)
    (tmp / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10}, "hidden": [],
        "families": {"level": [_row(TEMP, "Example room temperature", "level")]}, "assets": {}}))
    store = Store(str(tmp / "s.sqlite"))
    fid, _ = store.raise_finding("PM-SILENT", TEMP, "example_door", "2026-10-08", "P3",
                                 "Example room temperature has not reported for 2 d 3 h although it is online.", {})
    Problems(store).settle(f"finding:{fid}")
    if offline_fault:
        oid, _ = store.raise_finding("PM-UNAVAILABLE", TEMP, "level", "2026-10-09", "P3",
                                     "Example room temperature has been offline for 1h.", {"hours": 1, "entities": [TEMP]})
        Problems(store).settle(f"finding:{oid}")
    fx = tmp / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {TEMP: _st("unavailable", 70 if offline_fault else 3)}}))
    (fx / "rules.json").write_text("[]")
    return tmp, fid


def test_a_silent_sensor_gone_offline_is_followed_by_its_offline_fault_never_cleared(tmp_path):
    """Architecture review 22, card 3: silent means online and quiet. A sensor silent for 2 days that went offline at
    11:05 closed "Cleared: the check at 11:05 no longer sees it", and came back at 11:15 as a new offline fault."""
    # offline a few minutes, no offline fault yet: not judged, kept open
    tmp, fid = _silent_then_offline(tmp_path / "early", offline_fault=False)
    _recheck(tmp)
    assert Store(str(tmp / "s.sqlite")).finding(fid)["status"] == "open"
    # its offline fault open: handed to it, by the 5-minute check and by the night alike
    for where, run in (("day", _recheck), ("night", _night)):
        tmp, fid = _silent_then_offline(tmp_path / where, offline_fault=True)
        out = run(tmp)
        note = _closed_with(tmp, fid)
        assert note.startswith("Followed by: Example room temperature has been offline"), (where, note)
        if where == "night":
            assert fid in [o["id"] for o in out["handed_over"]], out["handed_over"]


def test_a_hidden_device_fault_is_never_handed_to_a_missing_device():
    """Its devices are hidden, watched by no check: one of them missing is still the automation's problem (it names a
    device the villa no longer has), never followed by the missing fault."""
    f = {"id": 1, "rule_id": "PM-HIDDEN-IN-RULE", "entity_id": WATCH,
         "detail": json.dumps({"name": "Example watch", "kind": "automation", "hidden": [LOCK]})}
    r = E.read(None, [f], missing={("PM-HIDDEN-IN-RULE", WATCH): "Followed by: Example door is missing."})
    assert E.entities_of(f) == [LOCK]
    assert E.ending(f, r) is None
