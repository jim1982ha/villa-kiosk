"""The alert desk fed with vesta_critical_event as Home Assistant fires it
(shape checked live on 2026-09-30; INTEGRATION-PLAN 6b). Invented entities."""
from __future__ import annotations

import importlib.util
import json
import os
from datetime import datetime, timedelta, timezone

import pytest

from helpers import PYTHONPATH, STARTER_SKILLS
from villa_timeline import TimelineVilla
from vesta_shared.store import Store
from vesta_shared.problems import Problems
from vesta_shared import result as R

spec = importlib.util.spec_from_file_location("desk", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

T0 = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)


def event(blueprint="critical_condition", phase="opened", rule="automation.critical_condition_front_door",
          started=1790000000, entities=("lock.front_door",), label="Front door left unlocked", **extra):
    return {"blueprint": blueprint, "rule_id": rule, "incident_id": f"{rule}-{started}", "phase": phase,
            "severity": "critical", "label": label, "entities": list(entities),
            "summary": f"{label}\nFront door is unlocked", "timestamp": T0.isoformat(), **extra}


def english(settle) -> list[dict]:
    """A result's settle notes as English reads them: each chat's other languages (`note_in`, owner 2026-10-23) apart."""
    return [{k: v for k, v in x.items() if k != "note_in"} for x in settle]


def moved(res) -> bool:
    """The desk asked the engine to bring the Kiosk's faults up to date: a task's fault action carries only that
    (architecture review, 2026-10-19 — the title, note and who it used to carry were never read)."""
    return {"action": "faults_changed"} in res["actions"]


@pytest.fixture
def store(tmp_path):
    return Store(str(tmp_path / "store.sqlite"))


def test_opened_goes_to_the_fm_with_the_ladder_and_becomes_a_ticket(store):
    res = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")
    assert res["decision"] == "new"
    fm = [s for s in res["send"] if s["to"] == "fm"]
    # the incident's number is the heading the engine writes (notice.py); the skill's text is the body alone
    assert fm and fm[0]["keyboard"] is True and fm[0]["incident_id"] == res["incident_id"] and fm[0]["stage"] == "new"
    task = store.last_task(f"incident:{res['incident_id']}")
    assert moved(res) and task["entity_id"] == "lock.front_door" and task["status"] == "open"
    assert not [s for s in res["send"] if s["to"] == "owner"]        # P2: the FM only


def test_resolved_closes_the_incident_and_its_ticket(store):
    iid = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    res = desk.intake(store, event(phase="resolved"), T0 + timedelta(minutes=20))
    assert res["decision"] == "resolved" and res["incident_id"] == iid
    assert store.incident(iid)["state"] == "resolved"
    assert moved(res) and store.last_task(f"incident:{iid}")["status"] == "cleared"
    assert res["send"][0]["status"] == "Cleared on {time}. Watch 4h."   # its own part, the same words everywhere
    assert english(res["settle"]) == [{"incident_id": iid, "note": "Cleared on {time}. Watch 4h."}]
    # ⚠️ ONE CLOSING WORDING (owner, 2026-10-19): the desk's end is the closed stage's own words — what the villa's
    # template writes under its all-clear (vesta_message.jinja, "{time}" its clock), never a second copy here
    from vesta_shared.message_format import STAGE_WORDS
    assert res["settle"][0]["note"] == STAGE_WORDS["closed"] + " Watch 4h." == res["ha_messages"][0]["status"]
    # the chase stops: no reminder for it any more
    assert desk.tick(store, T0 + timedelta(minutes=30))["reasked"] == []


def test_abandoned_escalates_to_the_owner(store):
    iid = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    res = desk.intake(store, event(phase="abandoned"), T0 + timedelta(hours=6))
    assert res["decision"] == "abandoned"
    assert store.incident(iid)["state"] == "escalated"
    assert res["send"][0]["to"] == "owner"


def test_an_opened_only_rule_closes_through_the_ladder(store):
    # critical_watchdog never sends "resolved": Done must close it
    ev = event(blueprint="critical_watchdog", rule="automation.critical_watchdog_devices",
               entities=("sensor.garden_probe",), label="Device offline")
    iid = desk.intake(store, ev, T0, occupancy_reader=lambda: "occupied")["incident_id"]
    res = desk.tick(store, T0 + timedelta(minutes=16))
    assert iid in res["reasked"]
    out = desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=20))
    assert store.incident(iid)["state"] == "done"
    assert moved(out) and store.last_task(f"incident:{iid}")["status"] == "done"


def test_routing_by_blueprint(store):
    trip = desk.intake(store, event(blueprint="critical_binary_trip", rule="automation.critical_leak",
                                    entities=("binary_sensor.kitchen_leak",), label="Leak"), T0, occupancy_reader=lambda: "occupied")
    assert {s["to"] for s in trip["send"]} == {"owner", "fm"}            # P1: both chats


def test_a_repeat_inside_the_cooldown_is_counted_not_sent(store):
    desk.intake(store, event(started=1), T0, occupancy_reader=lambda: "occupied")
    res = desk.intake(store, event(started=2), T0 + timedelta(minutes=5), occupancy_reader=lambda: "occupied")
    assert res["decision"] == "counted" and res["send"] == []


def test_intrusion_arms_the_siren_gate_only_when_empty_with_two_signals(store):
    pg = dict(blueprint="critical_presence_guard", rule="automation.critical_presence_guard_night")
    a = desk.intake(store, event(entities=("binary_sensor.garden_motion",), started=1, **pg), T0, occupancy_reader=lambda: "empty")
    assert a["siren_gate"]["armed"] is False                               # one signal
    b = desk.intake(store, event(entities=("binary_sensor.gate_motion",), started=2, **pg),
                    T0 + timedelta(minutes=1), occupancy_reader=lambda: "empty")
    assert b["siren_gate"]["armed"] is True
    c = desk.intake(Store(":memory:"), event(entities=("binary_sensor.gate_motion",), **pg), T0, occupancy_reader=lambda: "occupied")
    assert c["siren_gate"]["armed"] is False


def test_villa_silent_follows_the_engine_connection_beat(store):
    store.beat("ha_events", T0.isoformat())
    assert not desk.tick(store, T0 + timedelta(minutes=10))["send"]
    res = desk.tick(store, T0 + timedelta(minutes=40))
    assert any("Villa silent" in s.get("status", "") for s in res["send"])
    store.beat("ha_events", (T0 + timedelta(minutes=41)).isoformat())
    res = desk.tick(store, T0 + timedelta(minutes=42))
    assert any("back online" in s.get("status", "") for s in res["send"])


def test_the_desk_writes_no_home_assistant_helper(store):
    # 0.2.1 wrote input_datetime.vesta_last_run every tick; presence is the Kiosk heartbeat now
    res = desk.tick(store, T0)
    assert not [a for a in res["actions"] if a.get("action", "").startswith("helper")]


def test_the_cli_reads_an_event_file(tmp_path):
    import subprocess
    import sys
    p = tmp_path / "ev.json"
    p.write_text(json.dumps(event()))
    fx = tmp_path / "fx"                                             # the villa as a test sees it: one seam, no flags
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {"binary_sensor.example_empty": {"state": "off"}}}))
    env = {**os.environ, "PYTHONPATH": PYTHONPATH}
    r = subprocess.run([sys.executable, os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"), "intake",
                        "--event", str(p), "--store", str(tmp_path / "s.sqlite"), "--fixture-dir", str(fx)],
                       capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["decision"] == "new"


def test_a_press_settles_the_alerts_buttons_by_its_option_and_names_its_label(store):
    # architecture review, 2026-10-13: the desk is given the option pressed, never the label to read back
    iid = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    res = desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=5), name="Fabien")
    assert english(res["settle"]) == [{"incident_id": iid, "note": "Done on {time} (Fabien). Watch 4h."}]
    assert desk.BUTTONS["need_help"]["mark"] == "help"
    other = desk.intake(store, event(rule="automation.other", entities=("lock.other",)), T0,
                        occupancy_reader=lambda: "occupied")["incident_id"]
    assert "settle" not in desk.reply(store, other, "whatever", "fm", T0 + timedelta(minutes=6))



def test_the_desk_reads_the_villas_parameters_kept_ten_minutes_and_never_crashes(tmp_path):
    # architecture review, 2026-10-07: in the villa the desk read its parameters from nowhere (only a test fixture),
    # so its maintenance mode and the villa's timings were never read
    from datetime import datetime, timedelta, timezone
    from vesta_shared.params import live_params
    from vesta_shared.store import Store
    store = Store(str(tmp_path / "s.sqlite"))
    calls = []

    class HA:
        def __init__(self, mode="on"):
            self.mode = mode

        def helpers(self):
            calls.append(1)
            return ([{"entity_id": "input_boolean.maintenance_mode", "helper_type": "input_boolean", "id": "maintenance_mode"}],
                    {"input_boolean.maintenance_mode": self.mode})
    t0 = datetime(2026, 10, 7, 1, 0, tzinfo=timezone.utc)
    assert live_params(HA, store, now=t0).boolean("maintenance_mode", default=False) is True
    live_params(HA, store, now=t0 + timedelta(minutes=5))
    assert len(calls) == 1                                                        # kept: not read again
    assert live_params(lambda: HA("off"), store, now=t0 + timedelta(minutes=11)).boolean("maintenance_mode", False) is False

    def down():
        raise RuntimeError("Home Assistant does not answer")
    assert live_params(down, store, now=t0 + timedelta(hours=2)).boolean("maintenance_mode", True) is False   # the last copy
    assert live_params(down, Store(str(tmp_path / "empty.sqlite")), defaults=desk.DEFAULTS).behaviour("reask_minutes") == 15  # the desk's own


def test_a_repeated_alert_says_since_when_in_the_villas_time(store, monkeypatch):
    # owner, 2026-10-07: "(4 times since 2026-10-03T00:00)" — UTC, written as a machine writes it
    desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied", zone="Asia/Makassar")
    res = desk.intake(store, event(), T0 + timedelta(hours=6), occupancy_reader=lambda: "occupied", zone="Asia/Makassar")
    assert res["send"][0]["status"].endswith("since Thu 1 Oct, 17:00")  # 09:00 UTC is 17:00 in the villa


def test_only_done_and_need_help_and_an_old_not_found_is_chased_again(tmp_path):
    # owner, 2026-10-10: "remove all the Mute and Not Found … too complex for now"
    import sqlite3
    from vesta_shared.store import Store
    assert [b["label"] for b in desk.BUTTONS.values()] == ["Done", "Need help"]      # the skill's own (skill.yaml)
    path = str(tmp_path / "old.sqlite")
    st = Store(path)
    iid = st.new_incident("k", "automation.x", "lock.x", "P2", {"message": "m"})
    st.update_incident(iid, state="not_found")
    st.db.execute("CREATE TABLE mutes (rule_id TEXT, entity_id TEXT, until TEXT, by TEXT)")   # a store from before
    st.db.commit()
    again = Store(path)                                                  # the next start: migrated once
    assert again.incident(iid)["state"] == "asked" and again.incident(iid)["asked_at"]
    tables = {r[0] for r in sqlite3.connect(path).execute("select name from sqlite_master where type='table'")}
    assert "mutes" not in tables


# ---------------------------------------------------------------------- over when Home Assistant no longer says so
class Villa(TimelineVilla):
    """Home Assistant as the desk reads it again: each entity's timeline (villa_timeline), seen from T0 on."""
    def __init__(self, **timeline):
        super().__init__(now=T0, **timeline)


def _tick(store, villa, minutes):
    villa.now = T0 + timedelta(minutes=minutes)
    return desk.tick(store, villa.now, client=villa)


LOCKS = ("lock.front_door", "lock.back_door")
BAD = ["unlocked", "open", "jammed"]


def _left_unlocked(store, entities=("lock.front_door",), abandon=True, still_true=True, **extra):
    """A door rule shaped like the live critical_condition: every watched entity, its list of bad states."""
    iid = desk.intake(store, event(entities=entities, mode="state", bad_states=BAD, **extra), T0,
                      occupancy_reader=lambda: "occupied")["incident_id"]
    if abandon:
        desk.intake(store, event(phase="abandoned", entities=entities, mode="state", bad_states=BAD, still_true=still_true,
                                 **extra), T0 + timedelta(minutes=30))
    return iid


def test_a_door_locked_after_its_rule_stopped_watching_closes_its_alert(store):
    # villa, 2026-10-10: "Entrance door unlocked" stayed an open fault hours after the door was locked — the rule had
    # given up after 30min ("abandoned") and nobody ever said the door was locked
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=95), "locked")]})
    iid = _left_unlocked(store)
    assert not _tick(store, villa, 60).get("cleared")                   # still unlocked
    assert not _tick(store, villa, 100).get("cleared")                  # locked 5min ago: not yet
    res = _tick(store, villa, 106)
    assert res["cleared"] == [iid] and store.incident(iid)["state"] == "resolved"
    assert english(res["settle"]) == [{"incident_id": iid, "note": "Cleared on {time}: front_door is locked. Watch 4h."}]
    assert moved(res) and store.last_task(f"incident:{iid}")["status"] == "cleared"   # its Kiosk fault closes too
    assert [s for s in res["send"] if s["to"] == "fm" and s["status"] == "Cleared on {time}: front_door is locked. Watch 4h."
            and s["stage"] == "closed"], res["send"]
    assert not _tick(store, villa, 120).get("cleared")                  # closed once


def test_a_door_that_keeps_changing_while_locked_closes_when_it_was_never_unlocked_in_the_last_minutes(store):
    # villa, 2026-10-15: "back for 10 minutes" was "unchanged for 10 minutes" — a state that moves between good ones
    # (locked, locking, locked) never got there; its history over the minutes decides
    m = lambda x: T0 + timedelta(minutes=x)                                             # noqa: E731
    villa = Villa(**{"lock.front_door": [(m(-10), "unlocked"), (m(40), "locked"), (m(55), "locking"), (m(57), "locked")]})
    iid = _left_unlocked(store)
    assert _tick(store, villa, 60)["cleared"] == [iid]                  # locked since 40, its last change 3min ago
    again = Villa(**{"lock.back_door": [(m(-10), "unlocked"), (m(40), "locked"), (m(53), "unlocked"), (m(57), "locked")]})
    iid2 = _left_unlocked(store, entities=("lock.back_door",))
    assert not _tick(store, again, 60).get("cleared")                   # unlocked again 7min ago: not yet
    assert _tick(store, again, 68)["cleared"] == [iid2]


def test_a_lock_gone_from_unlocked_to_jammed_is_never_cleared(store):
    # architecture review 22: 0.12.145 took "not the state it alerted on" for over — "jammed" closed the alert
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=20), "jammed"),
                                         (T0 + timedelta(minutes=300), "unknown")]})
    _left_unlocked(store)
    for minutes in (60, 200, 400, 600):                                 # jammed, then "unknown": never over
        assert not _tick(store, villa, minutes).get("cleared")


def test_a_device_that_does_not_answer_keeps_the_alert_open_and_says_so_once(store):
    # owner's choice, architecture review 29 (reversing review 23's "no stricter than the rule"): the same offline lock
    # was "Cleared: … is unavailable" here and "VESTA cannot check this one" after a Done — never "over" without proof
    timeline = {"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=90), "locked")],
                "lock.back_door": [(T0 - timedelta(days=2), "unavailable")]}
    iid = _left_unlocked(store, entities=LOCKS)
    out = _tick(store, Villa(**timeline), 101)
    assert not out["cleared"] and store.incident(iid)["closed_at"] is None
    (said,) = [s for s in out["send"] if s["to"] == "fm"]
    assert said["status"] == "back_door does not answer: VESTA cannot tell if it is right. Still open."
    assert not [s for s in _tick(store, Villa(**timeline), 106)["send"] if "does not answer" in s.get("status", "")]  # once
    timeline["lock.back_door"].append((T0 + timedelta(minutes=95), "locked"))                    # it answers, and is right
    assert _tick(store, Villa(**timeline), 120)["cleared"] == [iid]
    store2 = Store(store.path + "-2")
    desk.intake(store2, event(entities=LOCKS, mode="state", bad_states=BAD + ["unavailable"]), T0, occupancy_reader=lambda: "x")
    desk.intake(store2, event(phase="abandoned", entities=LOCKS, mode="state", bad_states=BAD + ["unavailable"],
                              still_true=True), T0 + timedelta(minutes=30))
    assert not _tick(store2, Villa(**timeline), 101).get("cleared")


def test_a_rule_watching_two_doors_is_over_when_neither_is_open(store):
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=90), "locked")],
                     "lock.back_door": [(T0 - timedelta(days=1), "locked")]})
    iid = _left_unlocked(store, entities=LOCKS)
    assert not _tick(store, villa, 95).get("cleared")
    assert _tick(store, villa, 101)["cleared"] == [iid]                 # the back door locked all along counts as fine


def test_a_condition_its_rule_still_watches_is_read_again_and_its_own_all_clear_joins_it(store):
    # owner, 2026-10-13: an alert is over when what it claims no longer holds, whichever rule sent it — the desk no
    # longer knows which rules say "resolved" themselves; one that does finds its incident closed (resolved_late)
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=15), "locked")]})
    iid = _left_unlocked(store, abandon=False)
    assert _tick(store, villa, 60)["cleared"] == [iid]
    res = desk.intake(store, event(phase="resolved"), T0 + timedelta(minutes=61))
    assert res["decision"] == "resolved_late" and not res["send"]


def test_a_rule_that_stopped_watching_once_back_to_normal_never_tells_the_owner_still_not_clear(store):
    # architecture review 22: the rule said "cleared just inside the limit", the desk told the owner "Still not clear"
    iid = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    res = desk.intake(store, event(phase="abandoned", still_true=False), T0 + timedelta(minutes=30))
    assert res["decision"] == "abandoned_cleared" and store.incident(iid)["state"] == "resolved"
    assert not [s for s in res["send"] if s["to"] == "owner"]
    # architecture review 23: Home Assistant's own message, taken over, says the same end — never "🔶 no longer tracked"
    (ha,) = res["ha_messages"]
    assert ha["status"] == "Cleared on {time}: back to normal when the alert stopped watching it. Watch 4h."


def test_a_number_or_an_alert_from_before_the_bad_states_waits_for_a_person(store):
    villa = Villa(**{"sensor.cabinet": [(T0 + timedelta(minutes=5), "40.2")],
                     "lock.front_door": [(T0 + timedelta(minutes=5), "locked")]})
    # a numeric rule sends its bad states too (the blueprint's default: unavailable) — never read as "over"
    desk.intake(store, event(rule="automation.critical_condition_cabinet", entities=("sensor.cabinet",), mode="numeric",
                             bad_states=["unavailable"]), T0, occupancy_reader=lambda: "occupied")
    desk.intake(store, event(phase="abandoned", rule="automation.critical_condition_cabinet", entities=("sensor.cabinet",),
                             mode="numeric", bad_states=["unavailable"]), T0 + timedelta(minutes=30))
    desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")                  # no bad_states: an older rule
    desk.intake(store, event(phase="abandoned"), T0 + timedelta(minutes=30))
    assert not _tick(store, villa, 120).get("cleared") and len(store.incidents(open_only=True)) == 2


def _watchdog(store, state, bad_states=None):
    extra = {"bad_states": bad_states} if bad_states else {}
    return desk.intake(store, event(blueprint="critical_watchdog", rule="automation.critical_devices_unavailable_watchdog",
                                    entities=("sensor.ap_state",), label="Critical device unavailable", state=state,
                                    **extra), T0, occupancy_reader=lambda: "occupied")["incident_id"]


def test_a_device_back_after_the_watchdog_alerted_closes_its_alert(store):
    # the watchdog says a device went bad, never that it came back — an access point "disconnected" too
    villa = Villa(**{"sensor.ap_state": [(T0 - timedelta(minutes=10), "disconnected"), (T0 + timedelta(minutes=50), "heartbeat_missed"),
                                         (T0 + timedelta(hours=2), "connected")]})
    iid = _watchdog(store, "disconnected", ["unavailable", "disconnected", "heartbeat_missed"])
    assert not _tick(store, villa, 60).get("cleared")                   # another bad state: not back
    assert _tick(store, villa, 135)["cleared"] == [iid]


def test_a_watchdog_alert_from_before_the_bad_states_still_closes_on_its_own_state(store):
    villa = Villa(**{"sensor.ap_state": [(T0 - timedelta(minutes=10), "unavailable"), (T0 + timedelta(hours=2), "connected")]})
    iid = _watchdog(store, "unavailable")
    assert _tick(store, villa, 135)["cleared"] == [iid]


def test_home_assistants_late_all_clear_joins_the_incident_the_desk_closed(store):
    # architecture review 22: closed here first, Home Assistant's "resolved" stayed a second message without its number
    villa = Villa(**{"sensor.ap_state": [(T0 - timedelta(minutes=10), "unavailable"), (T0 + timedelta(hours=2), "connected")]})
    iid = _watchdog(store, "unavailable")
    _tick(store, villa, 135)
    res = desk.intake(store, event(blueprint="critical_watchdog", rule="automation.critical_devices_unavailable_watchdog",
                                   phase="resolved", entities=("sensor.ap_state",)), T0 + timedelta(minutes=140))
    assert res["decision"] == "resolved_late" and res["ha_messages"][0]["incident_id"] == iid
    assert not res["send"] and not res["actions"]                       # never closed twice


def test_the_ticks_cli_reads_home_assistant_again(tmp_path):
    # the engine runs "desk.py tick" every 5 minutes: it must be given Home Assistant, or nothing is read again
    import subprocess
    import sys
    s = Store(str(tmp_path / "s.sqlite"))
    iid = desk.intake(s, event(blueprint="critical_watchdog", entities=("switch.pool_relay",), state="unavailable"), T0,
                      occupancy_reader=lambda: "occupied")["incident_id"]
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {"switch.pool_relay": {
        "state": "off", "last_changed": (T0 + timedelta(minutes=5)).isoformat(), "attributes": {}}}}))
    env = {**os.environ, "PYTHONPATH": PYTHONPATH}
    r = subprocess.run([sys.executable, os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"), "tick",
                        "--store", str(tmp_path / "s.sqlite"), "--fixture-dir", str(fx),
                        "--now", (T0 + timedelta(minutes=30)).isoformat()], capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["cleared"] == [iid]


def _ap(store, minutes, **extra):
    return desk.intake(store, event(blueprint="critical_watchdog", rule="automation.critical_devices_unavailable_watchdog",
                                    entities=("sensor.ap_state",), state="disconnected", bad_states=["disconnected"],
                                    started=1790000000 + minutes * 60, **extra),
                       T0 + timedelta(minutes=minutes), occupancy_reader=lambda: "occupied")


def test_an_alert_back_within_four_hours_is_the_same_incident_back_again(store):
    # architecture review 23: closed by the desk, the access point dropped again 40min later — a new number, a new "New"
    # message with buttons and a new Kiosk fault each cycle
    first = _ap(store, 0)
    iid = first["incident_id"]
    villa = Villa(**{"sensor.ap_state": [(T0 - timedelta(minutes=10), "disconnected"), (T0 + timedelta(minutes=20), "connected")]})
    assert _tick(store, villa, 35)["cleared"] == [iid]
    again = _ap(store, 75)
    assert again["decision"] == "reopened" and again["incident_id"] == iid and store.incident(iid)["closed_at"] is None
    assert [s for s in again["send"] if s["to"] == "fm" and s["status"] == "Back again: 2 times in 7 days"
            and s["keyboard"]]
    # its fault in the Kiosk open again — the same one, titled with how often (architecture review 24: a new one each time)
    (task,) = store.tasks(None)
    assert moved(again) and task["status"] == "open"
    assert Problems(store).card(task)["title"].endswith("(again: 2 times in 7 days)")
    assert len(store.incidents(open_only=False)) == 1
    # Home Assistant's later events for this new run find it
    assert json.loads(store.incident(iid)["payload"])["ha_incident"].endswith(str(1790000000 + 75 * 60))
    villa.timeline["sensor.ap_state"].append((T0 + timedelta(minutes=80), "connected"))
    _tick(store, villa, 95)
    assert _ap(store, 95 + 5 * 60)["decision"] == "new"                       # five hours on: a new problem


def _done(store, villa, iid, minutes):
    desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=minutes))
    return _tick(store, villa, minutes + 11)


def test_after_done_the_desk_reads_the_device_once_and_reopens_what_is_still_bad(store):
    # architecture review 23: "will check it stays quiet" was promised and never done
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked")]})
    iid = _left_unlocked(store, abandon=False)
    res = _done(store, villa, iid, 20)
    assert res["not_quiet"] == [iid] and store.incident(iid)["closed_at"] is None
    (fm,) = [s for s in res["send"] if s["to"] == "fm"]
    assert fm["status"] == "Done (FM), but front_door still reads unlocked: still open. VESTA keeps watching it." and fm["keyboard"]
    task = store.last_task(f"incident:{iid}")                                  # its own fault, open again
    assert moved(res) and task["status"] == "open" and task["reopen_note"] == "Still there after the close."
    assert not _tick(store, villa, 60).get("not_quiet")                         # read once


def test_a_fault_reopened_in_the_kiosk_while_the_desk_reads_the_villa_is_still_told(store):
    # architecture review, 2026-10-17: the desk read an incident's notes, then the villa, then wrote its old copy back —
    # a fault reopened in the Kiosk in between lost its note, and the facility manager was never told
    from vesta_shared.problems import Problems
    from vesta_shared.store import Notes, notes_of
    iid = _left_unlocked(store, abandon=False)
    desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=20))
    task = store.last_task(f"incident:{iid}")
    engine = Store(store.path)                                  # the agent itself: its own connection to the record

    class Reopening(Villa):
        def states(self, ids):
            if not getattr(self, "done", False):
                self.done = True
                Problems(engine).reopened_in_kiosk(task["id"], by="Wayan", said="Reopened in the Cockpit by Wayan.")
            return super().states(ids)

    villa = Reopening(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked")]})
    res = _tick(store, villa, 31)
    assert villa.done                                           # the Kiosk reopened it while the desk read the villa
    told = [m for m in res["send"] if "Reopened in the Cockpit by Wayan" in (m.get("status") or m.get("text") or "")]
    assert [m["to"] for m in told] == ["fm"], res["send"]       # the facility manager is told, once
    assert res["not_quiet"] == [] and not notes_of(store.incident(iid)).get(Notes.KIOSK_REOPENED)


def test_after_done_a_quiet_device_stays_closed_and_an_alert_without_states_promises_nothing(store):
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=15), "locked")]})
    iid = _left_unlocked(store, abandon=False)
    assert ", VESTA will monitor it for 10min." in desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=20))["send"][0]["status"]
    assert not _tick(store, villa, 31)["not_quiet"] and store.incident(iid)["closed_at"]
    villa.timeline["lock.front_door"].append((T0 + timedelta(days=3), "unlocked"))     # days later: another story
    assert not _tick(store, villa, 3 * 1440 + 30)["not_quiet"] and store.incident(iid)["closed_at"]
    other = desk.intake(store, event(rule="automation.critical_condition_other"), T0, occupancy_reader=lambda: "x")["incident_id"]
    said = desk.reply(store, other, "done", "fm", T0 + timedelta(minutes=20))["send"][0]["status"]
    assert "stays quiet" not in said


def test_one_bad_state_sent_as_text_is_one_state_not_its_letters(store):
    iid = _ap(store, 0, )["incident_id"]
    store2 = Store(store.path + "-3")
    desk.intake(store2, {**event(blueprint="critical_watchdog", entities=("sensor.ap_state",), state="disconnected"),
                         "bad_states": "disconnected"}, T0, occupancy_reader=lambda: "x")
    villa = Villa(**{"sensor.ap_state": [(T0 - timedelta(minutes=10), "disconnected")]})
    assert not _tick(store2, villa, 60).get("cleared")
    assert iid


# ------------------------------------------------------------- what an alert claims, its priority (owner, 2026-10-13)
CLAIM = "{{ (now().timestamp() - (state_attr('input_datetime.pump_last_run', 'timestamp') or 0)) >= 86400 }}"


class Claims(Villa):
    """Home Assistant rendering an alert's claim: its answer over time [(since, "true" | "false" | "unknown")]."""
    def __init__(self, said, **timeline):
        super().__init__(**timeline)
        self.said, self.rendered = said, []

    def template(self, text):
        self.rendered.append(text)
        return [r for since, r in self.said if since <= self.now][-1]


def _overdue(store, at=T0, **extra):
    """A schedule rule's "no run in over 1 day", shaped as the live blueprint sends it (its own word: warning)."""
    return desk.intake(store, event(blueprint="critical_schedule", rule="automation.pump_watchdog", phase="opened",
                                    entities=("sensor.pump_power",), label="Pump overdue", severity="warning",
                                    reason="overdue_run", **extra), at, occupancy_reader=lambda: "occupied")


def test_an_alert_is_over_once_what_it_claims_no_longer_holds_whatever_rule_sent_it(store):
    # the house pump's #5 stayed open 10 days across two real runs: its rule never says "resolved", and the desk read
    # again only two blueprints, by name. The rule's own claim, rendered by Home Assistant, decides — no rule named here
    iid = _overdue(store, claim=CLAIM)["incident_id"]
    ha = Claims([(T0, "true"), (T0 + timedelta(hours=3), "false")])
    assert not _tick(store, ha, 60).get("cleared") and ha.rendered == [CLAIM]
    assert not _tick(store, ha, 185).get("cleared")                         # false, not yet for clear_minutes
    res = _tick(store, ha, 200)
    assert res["cleared"] == [iid] and store.incident(iid)["closed_at"]
    assert res["settle"][0]["note"] == "Cleared on {time}: back to normal. Watch 4h."


@pytest.mark.parametrize("hours, says", [(1, " Watch 1h."), (4, " Watch 4h."), (0.5, " Watch 30min."), (0, "")])
def test_a_closed_alert_says_how_long_it_stays_on_watch_from_the_villas_reopen_hours(tmp_path, hours, says):
    # owner, 2026-10-23: every closing end says, last, how long the alert reopens under its own number — the villa's
    # reopen_hours as it is now (never a number written in the desk); none set (0): nothing about a watch
    from vesta_shared.params import VillaParams
    params = VillaParams(defaults={**desk.DEFAULTS, "reopen_hours": hours})
    store = Store(str(tmp_path / f"w{hours}.sqlite"))
    # the villa's own all-clear
    desk.intake(store, event(), T0, params, occupancy_reader=lambda: "occupied")
    res = desk.intake(store, event(phase="resolved"), T0 + timedelta(minutes=20), params)
    assert res["settle"][0]["note"] == "Cleared on {time}." + says
    assert res["settle"][0]["note_in"]["fr"] == "Résolu le {time}." + says.replace("Watch", "Surveillance")
    # every language ends on one stop, never a unit's own dot doubled ("4 Std..")
    assert not [t for t in res["settle"][0]["note_in"].values() if ".." in t or "。。" in t]
    # a claim no longer holding, read again by the desk
    store = Store(str(tmp_path / f"c{hours}.sqlite"))
    _overdue(store, claim=CLAIM)
    ha = Claims([(T0, "false")])
    ha.now = T0 + timedelta(minutes=30)
    desk.tick(store, ha.now, params, client=ha)
    ha.now = T0 + timedelta(minutes=45)
    closed = desk.tick(store, ha.now, params, client=ha)
    assert closed["settle"][0]["note"] == "Cleared on {time}: back to normal." + says
    # a Done that held: "Checked after …: right." then the watch
    store = Store(str(tmp_path / f"d{hours}.sqlite"))
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=3), "locked")]})
    iid = desk.intake(store, event(entities=("lock.front_door",), bad_states=BAD), T0, params,
                      occupancy_reader=lambda: "occupied")["incident_id"]
    desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=5), params)
    villa.now = T0 + timedelta(minutes=20)
    done = [s for s in desk.tick(store, villa.now, params, client=villa)["send"] if s["stage"] == "closed"]
    assert done and done[0]["status"] == "Done (FM). Checked after 10min: right." + says
    # a Done on an alert the desk cannot read again: closed at once, its watch said there (review J, 0.12.341)
    store = Store(str(tmp_path / f"n{hours}.sqlite"))
    iid = desk.intake(store, event(blueprint="critical_schedule", rule="automation.pump_watchdog",
                                   entities=("switch.pool_pump",)), T0, params,
                      occupancy_reader=lambda: "occupied")["incident_id"]
    assert not desk.judged(store.incident(iid))
    now = [s for s in desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=5), params, name="JM")["send"]
           if s["stage"] == "closed"]
    assert now and now[0]["status"] == "Done on {time} (JM)." + says


def test_a_claim_that_cannot_be_told_keeps_the_alert_open_and_says_so_once(store):
    iid = _overdue(store, claim=CLAIM)["incident_id"]
    ha = Claims([(T0, "unknown")], **{"sensor.pump_power": [(T0, "unavailable")]})
    said = [m["status"] for m in _tick(store, ha, 60)["send"] if m["stage"] == "update"]
    assert said == ["pump_power does not answer: VESTA cannot tell if it is right. Still open."]
    assert not [m for m in _tick(store, ha, 65)["send"] if m["stage"] == "update"] and not store.incident(iid)["closed_at"]


def test_a_done_on_an_alert_whose_claim_still_holds_reopens_it(store):
    iid = _overdue(store, claim=CLAIM, priority="P2")["incident_id"]
    desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=5), name="Wayan")
    res = _tick(store, Claims([(T0, "true")]), 20)
    assert res["not_quiet"] == [iid] and not store.incident(iid)["closed_at"]
    assert "Done (Wayan), but it is still reported: still open. VESTA keeps watching it." in \
        [m["status"] for m in res["send"]]


def test_the_priority_is_the_alerts_own_and_home_assistants_word_is_not_one(store):
    # "warning" was kept as the priority: it matched no people_roles — the overdue pump was never sent, never chased
    plain = _overdue(store)
    assert store.incident(plain["incident_id"])["severity"] == "P2"            # its route's, rules.yaml
    assert [m["to"] for m in plain["send"]] == ["fm"] and store.incident(plain["incident_id"])["state"] == "asked"
    urgent = desk.intake(store, event(rule="automation.other", entities=("lock.other",), priority="P1"), T0,
                         occupancy_reader=lambda: "occupied")
    assert sorted(m["to"] for m in urgent["send"]) == ["fm", "owner"]


def test_a_repeat_goes_where_its_priority_sends_it_with_home_assistants_latest_words(store):
    # owner, 2026-10-13: #5 said "last confirmed: 2026-10-01" every morning while Home Assistant's own message said
    # 2026-10-11, and went to the facility manager whatever its priority
    iid = _overdue(store, summary="Pump: last confirmed 2026-10-01", priority="P1")["incident_id"]
    res = _overdue(store, at=T0 + timedelta(days=1), summary="Pump: last confirmed 2026-10-11", priority="P1")
    assert res["decision"] == "repeat" and sorted(m["to"] for m in res["send"]) == ["fm", "owner"]
    assert all(m["text"].startswith("Pump: last confirmed 2026-10-11") for m in res["send"])
    assert res["ha_messages"][0]["text"].startswith("Pump: last confirmed 2026-10-11")


def test_an_incident_logged_under_home_assistants_word_is_chased_once_its_priority_arrives(store):
    # #5 was stored as "warning" (no ladder, no task); its next repeat carries a priority: the chase starts
    iid = _overdue(store)["incident_id"]
    store.update_incident(iid, severity="warning", state="logged")
    res = _overdue(store, at=T0 + timedelta(days=1), priority="P2")
    inc = store.incident(iid)
    assert (inc["severity"], inc["state"]) == ("P2", "asked") and res["actions"] == [{"action": "faults_changed"}]


# ── who hears each notice: ONE answer (desk.tell, architecture review 2026-10-15) ───────────────────────────────────
def _who(msgs):
    return sorted((m["to"], bool(m.get("keyboard")), bool(m.get("first_in_line"))) for m in msgs)


def test_every_notice_of_a_p1_reaches_its_priority_and_only_the_asked_role_gets_the_buttons(store):
    # owner, 2026-10-13: "consistently to any P1, P2, P3" — a P1's reminder and its reopening in the Cockpit reached
    # the facility manager alone, while the owner had the first alert
    iid = desk.intake(store, event(priority="P1"), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    both = [("fm", True, True), ("owner", False, False)]
    reminder = desk.tick(store, T0 + timedelta(minutes=16))
    assert reminder["reasked"] == [iid] and _who(reminder["send"]) == both
    escalated = desk.tick(store, T0 + timedelta(minutes=46))
    assert escalated["escalated"] == [iid] and _who(escalated["send"]) == [("owner", True, False)]
    p = json.loads(store.incident(iid)["payload"])
    store.update_incident(iid, state="asked", payload=json.dumps({**p, "kiosk_reopened": "Owner"}))
    assert _who(desk.tick(store, T0 + timedelta(minutes=50))["send"]) == both


def test_a_p2_stays_with_the_facility_manager_and_a_p3_is_never_chased(store):
    iid = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    assert _who(desk.tick(store, T0 + timedelta(minutes=16))["send"]) == [("fm", True, True)]
    p3 = desk.tell("P3", "new", incident=iid, text="x")
    assert p3 == []                                          # the morning list only (people_roles digest)
    assert _who(desk.tell("P3", "reminder", incident=iid, text="x")) == []        # a P3 repeat: nobody chased
    assert _who(desk.tell("P2", "closed", incident=iid, chased=True, text="x")) == [("fm", False, False)]


def test_the_villa_back_online_reaches_everyone_told_it_was_silent(store):
    store.beat("ha_events", T0.isoformat())
    silent = desk.tick(store, T0 + timedelta(minutes=40))["send"]
    store.beat("ha_events", (T0 + timedelta(minutes=41)).isoformat())
    back = desk.tick(store, T0 + timedelta(minutes=42))["send"]
    assert {m["to"] for m in silent} == {m["to"] for m in back} == {"owner", "fm"}


def test_the_chase_is_the_skills_rule(store, monkeypatch):
    monkeypatch.setitem(desk.CHASE, "asks", "owner")
    monkeypatch.setitem(desk.CHASE, "escalates_to", "fm")
    assert _who(desk.tell("P1", "reminder", incident=1, chased=True, text="x")) == [("fm", False, False), ("owner", True, True)]
    assert _who(desk.tell("P1", "escalated", incident=1, text="x")) == [("fm", True, False)]


def test_an_incidents_notes_change_in_place_and_an_old_or_broken_record_still_reads(store):
    # architecture review, 2026-10-17: Store.note changes only the keys it is given, against the record as it stands
    from vesta_shared.store import notes_of
    iid = desk.intake(store, event(), T0, occupancy_reader=lambda: "x")["incident_id"]
    before = notes_of(store.incident(iid))
    other = Store(store.path)
    other.note(iid, {"kiosk_reopened": "by Wayan"})                 # another writer, between a read and a write
    store.note(iid, {"check_quiet": "Done"}, drop=("clear_since",), state="done")
    after = notes_of(store.incident(iid))
    assert after == {**before, "kiosk_reopened": "by Wayan", "check_quiet": "Done"} and store.incident(iid)["state"] == "done"
    assert store.take_note(iid, "kiosk_reopened") == "by Wayan" and store.take_note(iid, "kiosk_reopened") is None
    for broken in ("not json", "[1, 2]", None):
        store.update_incident(iid, payload=broken)
        assert notes_of(store.incident(iid)) == {}
        assert store.note(iid, {"a": 1}) == {"a": 1}


def test_the_chase_roles_are_said_as_set_never_as_written_in_the_desk(store, monkeypatch):
    # owner, 2026-10-17: "the label shall never be hardcoded to a value that can be changed as parameter of the alert" —
    # "No answer from FM", "the owner is asked to act" named the chase's roles as shipped; a villa that asks the owner
    # first would read the wrong people
    monkeypatch.setattr(desk, "CHASE", {"asks": "owner", "escalates_to": "fm"})
    iid = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    assert store.incident(iid)["assignee"] == "owner"
    desk.tick(store, T0 + timedelta(minutes=16))
    out = desk.tick(store, T0 + timedelta(minutes=50))
    (esc,) = [m for m in out["send"] if m["to"] == "fm"]
    assert esc["status"].startswith("No answer from Owner after "), esc
    assert store.incident(iid)["assignee"] == "fm"
    iid2 = desk.intake(store, event(rule="automation.critical_condition_back_door"), T0,
                       occupancy_reader=lambda: "occupied")["incident_id"]
    out = desk.reply(store, iid2, "need_help", "owner", T0 + timedelta(minutes=5))
    assert any(m["status"].endswith(": FM is asked to act.") for m in out["send"]), out["send"]
    assert desk.reply(store, iid2, "other", "owner", T0 + timedelta(minutes=6), name=None)["send"][0]["status"] \
        .startswith("Noted on {time} (Owner)")


def test_a_rule_restating_itself_changes_how_its_open_alert_is_judged_and_sends_nothing(store):
    # owner, 2026-10-17 (#45): the overload limit went from 4000 to 6200 W while its alert was open — the desk kept the
    # claim it was raised with, so 6000 W on the phase kept it open for ever
    old = "{{ 'true' }}"
    new = "{{ 'false' }}"
    iid = desk.intake(store, event(claim=old), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    out = desk.intake(store, event(phase="restated", claim=new, priority="P1"), T0 + timedelta(hours=3),
                      occupancy_reader=lambda: "occupied")
    assert out["decision"] == "restated" and out["incident_id"] == iid
    assert not out["send"] and not out.get("ha_messages") and not out["actions"]
    inc = store.incident(iid)
    assert json.loads(inc["payload"])["claim"] == new and inc["severity"] == "P1"
    assert not inc["closed_at"]                                  # closed by the desk's re-reading, never by the restate
    out = desk.intake(store, event(phase="restated", claim=new, rule="automation.critical_condition_other"), T0,
                      occupancy_reader=lambda: "occupied")
    assert out["decision"] == "restated_nothing_open" and not out["send"]


def test_a_phase_the_desk_does_not_know_raises_nothing(store):
    # 2026-10-17, 14:41: "restated" reached a desk that did not know it — five false alerts, two reopenings in one
    # minute. Any phase a newer rule sends that this desk does not know is recorded, and nothing else
    iid = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    before = [dict(r) for r in store.incidents(open_only=False)]
    for rule in ("automation.critical_condition_front_door", "automation.critical_condition_other"):
        out = desk.intake(store, event(phase="rechecked", rule=rule), T0 + timedelta(hours=5),
                          occupancy_reader=lambda: "occupied")
        assert out == {"send": [], "actions": [], "incident_id": None, "decision": "phase_unknown"}, out
    assert [dict(r) for r in store.incidents(open_only=False)] == before and store.incident(iid)["closed_at"] is None
    assert desk.intake(store, {k: v for k, v in event().items() if k != "phase"}, T0 + timedelta(hours=6),
                       occupancy_reader=lambda: "occupied")["decision"] in ("repeat", "counted")   # no phase: "opened"


def test_an_alert_back_again_waits_its_own_clear_minutes_never_the_last_runs(store):
    # the villa's #54 (2026-10-18): main power unavailable, cleared after 10min back (10:50); back at 11:28, the device
    # answered at 11:30:15 and the desk closed it at 11:30:17 — the "back to normal since 10:40" of the run before was
    # never forgotten, so the new run read as 50 minutes clear
    iid = _overdue(store, claim=CLAIM)["incident_id"]
    ha = Claims([(T0, "true"), (T0 + timedelta(minutes=2), "false"), (T0 + timedelta(minutes=50), "true"),
                 (T0 + timedelta(minutes=60), "false")])
    assert not _tick(store, ha, 5).get("cleared")                              # clear since 5
    assert _tick(store, ha, 15)["cleared"] == [iid]                            # 10min clear: over
    again = _overdue(store, at=T0 + timedelta(minutes=55), claim=CLAIM, started=1790003300)
    assert again["decision"] == "reopened" and again["incident_id"] == iid
    assert not _tick(store, ha, 61).get("cleared")                             # back 1min, not 56
    assert not _tick(store, ha, 66).get("cleared")
    assert _tick(store, ha, 71)["cleared"] == [iid]                            # its own 10 minutes


def test_the_siren_reads_the_kiosks_empty_sensor(tmp_path, monkeypatch):
    # owner, 2026-10-18: the desk read input_select.villa_mode, a mode no villa had — "unknown" for every intrusion,
    # the siren could never be offered. Architecture review round 7, card 2: the sensor is the Kiosk's pick (Settings ›
    # Villa), told at each heartbeat — never one named in rules.yaml; none picked, or unreadable, is never empty
    from fixture_client import FixtureClient
    from vesta_shared import kiosk_told
    pack = str(tmp_path / "pack.json")
    monkeypatch.setenv("VESTA_PACK", pack)
    fx = tmp_path / "fx"
    fx.mkdir()
    kiosk_told.keep(pack, {"villaEmptySensor": "binary_sensor.example_empty"})
    for state, mode in (("on", "empty"), ("off", "occupied"), ("unavailable", "unknown")):
        (fx / "states.json").write_text(json.dumps({"states": {"binary_sensor.example_empty": {"state": state}}}))
        assert desk.occupancy(FixtureClient(str(fx))) == mode
    (fx / "states.json").write_text(json.dumps({"states": {"binary_sensor.example_empty": {"state": "on"}}}))
    kiosk_told.keep(pack, {"villaEmptySensor": ""})                                      # none picked: cannot tell
    assert desk.occupancy(FixtureClient(str(fx))) == "unknown"


def test_the_siren_path_end_to_end_from_the_kiosks_answer_to_the_gate(tmp_path):
    """The Kiosk's heartbeat answer names the sensor (the engine's kiosk_answered keeps it beside the pack); the real
    desk.py, run as the engine runs it (VESTA_PACK), reads it: two intrusion sensors with it "on" arm the siren gate.
    The Kiosk then says none is picked: the villa cannot be told empty, the gate stays shut."""
    import subprocess
    import sys
    from types import SimpleNamespace
    from vesta_agent.app import Vesta as App
    pack = str(tmp_path / "pack.json")
    engine = SimpleNamespace(s=SimpleNamespace(pack_path=pack))
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {"binary_sensor.example_empty": {"state": "on"}}}))
    pg = dict(blueprint="critical_presence_guard", rule="automation.critical_presence_guard_night")

    def intake(store, entity, started, minute):
        p = tmp_path / f"ev{started}.json"
        p.write_text(json.dumps(event(entities=(entity,), started=started, **pg)))
        r = subprocess.run([sys.executable, os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"), "intake",
                            "--event", str(p), "--store", str(tmp_path / store), "--fixture-dir", str(fx),
                            "--now", (T0 + timedelta(minutes=minute)).isoformat()],
                           capture_output=True, text=True, timeout=60,
                           env={**os.environ, "PYTHONPATH": PYTHONPATH, "VESTA_PACK": pack})
        assert r.returncode == 0, r.stderr
        return json.loads(r.stdout)["siren_gate"]

    App.kiosk_answered(engine, {"villaEmptySensor": "binary_sensor.example_empty"})
    intake("a.sqlite", "binary_sensor.example_garden_motion", 1, 0)
    gate = intake("a.sqlite", "binary_sensor.example_gate_motion", 2, 1)
    assert gate["armed"] is True and gate["occupancy"] == "empty"
    App.kiosk_answered(engine, {"maintenance": False})                       # the key absent: the pick is kept
    App.kiosk_answered(engine, {"villaEmptySensor": ""})                     # none picked
    intake("b.sqlite", "binary_sensor.example_garden_motion", 3, 0)
    gate = intake("b.sqlite", "binary_sensor.example_gate_motion", 4, 1)
    assert gate["armed"] is False and gate["occupancy"] == "unknown"


# ------------------------------------------------------------- an alert whose automation is gone (owner, 2026-10-18)
RULE = "automation.critical_condition_front_door"


def test_an_alert_whose_automation_is_gone_is_closed_saying_why_and_its_fault_with_it(store):
    # the laundry rule's entity ID changed while #41 was open: its next alert came as #55, and #41 could never clear
    iid = _left_unlocked(store, abandon=False)
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked")]})
    villa.gone = {RULE}
    assert _tick(store, villa, 5)["rule_gone"] == []                       # seen gone once: not yet
    clear = desk._params(None).behaviour("clear_minutes")
    res = _tick(store, villa, 5 + clear)
    assert res["rule_gone"] == [iid] and store.incident(iid)["closed_at"]
    said = [m for m in res["send"] if "no longer exists" in (m.get("status") or "")]
    assert said and "Its next alert comes with a new number." in said[0]["status"], res["send"]
    # one closing wording (owner, 2026-10-19): every end opens with the closed stage's words, its own after a colon
    from vesta_shared.message_format import STAGE_WORDS
    assert said[0]["status"].startswith(STAGE_WORDS["closed"].removesuffix(".") + ": "), said[0]["status"]
    assert res.get("settle")                                               # its messages lose their buttons
    task = store.last_task(f"incident:{iid}")
    assert task and task["status"] != "open", task                         # its Kiosk fault closes with it


def test_an_automation_back_before_the_wait_keeps_its_alert(store):
    # a restart can answer "not found" before the villa's automations are loaded: gone, then back, is still its rule
    iid = _left_unlocked(store, abandon=False)
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked")]})
    villa.gone = {RULE}
    _tick(store, villa, 5)
    villa.gone = set()
    _tick(store, villa, 6)
    villa.gone = {RULE}
    clear = desk._params(None).behaviour("clear_minutes")
    # gone again a full wait after it was FIRST seen gone: the wait starts again, from now
    assert _tick(store, villa, 5 + clear)["rule_gone"] == [] and not store.incident(iid)["closed_at"]


def test_a_villa_that_cannot_say_closes_nothing(store):
    # only the villa's own "not found" counts: a read that fails is not a deleted automation
    iid = _left_unlocked(store, abandon=False)

    class Unreadable(Villa):
        def not_found(self, entity_ids):
            raise TimeoutError("no answer")

    villa = Unreadable(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked")]})
    for m in (5, 60, 120):
        assert _tick(store, villa, m)["rule_gone"] == []
    assert not store.incident(iid)["closed_at"]


# ------------------------------------------------------------- an alert keeps its number across a rename (2026-10-18)
def test_a_renamed_rule_that_sends_its_permanent_number_keeps_its_alert(store):
    # one problem one card #1: the laundry rule's entity id changed while #41 was open; its next alert became #55
    first = desk.intake(store, event(rule_uid="1789", entities=("lock.front_door",)), T0, occupancy_reader=lambda: "x")
    again = desk.intake(store, event(rule="automation.front_door_renamed", rule_uid="1789", entities=("lock.front_door",)),
                        T0 + timedelta(minutes=40), occupancy_reader=lambda: "x")
    assert again["incident_id"] == first["incident_id"] and again["decision"] in ("repeat", "counted"), again
    assert store.incident(first["incident_id"])["rule_id"] == "automation.front_door_renamed"   # its name now


def test_an_alert_opened_before_rules_sent_their_number_is_found_and_moved_under_it(store):
    old = desk.intake(store, event(), T0, occupancy_reader=lambda: "x")["incident_id"]          # no number yet
    again = desk.intake(store, event(rule_uid="1789"), T0 + timedelta(minutes=40), occupancy_reader=lambda: "x")
    assert again["incident_id"] == old
    renamed = desk.intake(store, event(rule="automation.front_door_renamed", rule_uid="1789"), T0 + timedelta(minutes=80),
                          occupancy_reader=lambda: "x")
    assert renamed["incident_id"] == old, renamed                                                # then survives a rename


def test_an_alert_renamed_while_closed_comes_back_under_its_number(store):
    # architecture review scan 2, 2026-10-19: closed, its rule renamed, back within reopen_hours — the same number, its
    # rule's name brought up to date (open_alert did; intake's "came back" path kept the old name)
    first = desk.intake(store, event(rule_uid="1789", entities=("lock.front_door",)), T0, occupancy_reader=lambda: "x")
    desk.intake(store, event(phase="resolved", rule_uid="1789", entities=("lock.front_door",)), T0 + timedelta(minutes=20))
    assert store.incident(first["incident_id"])["closed_at"]
    back = desk.intake(store, event(rule="automation.front_door_renamed", rule_uid="1789", entities=("lock.front_door",)),
                       T0 + timedelta(minutes=60), occupancy_reader=lambda: "x")
    assert back["incident_id"] == first["incident_id"], back
    assert store.incident(first["incident_id"])["rule_id"] == "automation.front_door_renamed"


class Automations(Villa):
    """The villa's system as the desk reads it, with its automations: {entity id: their own id}."""
    def __init__(self, automations, **timeline):
        super().__init__(**timeline)
        self.automations = automations

    def all_entity_ids(self):
        return list(self.automations) + list(self.timeline)

    def states(self, ids=None):
        out = super().states([i for i in (ids or []) if not i.startswith("automation.")] if ids is not None else None)
        out.update({e: {"entity_id": e, "state": "on", "attributes": {"id": uid}} for e, uid in self.automations.items()
                    if ids is None or e in ids})
        return out


def test_a_rule_renamed_while_its_alert_is_open_is_not_gone(store):
    iid = desk.intake(store, event(rule_uid="1789", mode="state", bad_states=BAD), T0, occupancy_reader=lambda: "x")["incident_id"]
    villa = Automations({"automation.front_door_renamed": "1789"}, **{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked")]})
    villa.gone = {RULE}
    clear = desk._params(None).behaviour("clear_minutes")
    for m in (5, 5 + clear, 5 + 2 * clear):
        assert _tick(store, villa, m)["rule_gone"] == []
    assert not store.incident(iid)["closed_at"] and store.incident(iid)["rule_id"] == "automation.front_door_renamed"


def test_a_rule_deleted_while_its_alert_is_open_still_closes_it(store):
    iid = desk.intake(store, event(rule_uid="1789", mode="state", bad_states=BAD), T0, occupancy_reader=lambda: "x")["incident_id"]
    villa = Automations({"automation.something_else": "42"}, **{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked")]})
    villa.gone = {RULE}
    clear = desk._params(None).behaviour("clear_minutes")
    _tick(store, villa, 5)
    assert _tick(store, villa, 5 + clear)["rule_gone"] == [iid]


def test_a_rule_of_a_kind_with_no_route_takes_its_names_priority():
    # owner, 2026-10-19: "if the alert name has critical_ in its name: P1; if not, P2" — the kinds with a route
    # keep it, and a rule's own priority still wins
    follows = {"priority": "", "severity": "critical"}
    assert desk.priority(follows, desk.route_for("automation.critical_battery_low_battery", "critical_battery")) == "P1"
    assert desk.priority(follows, desk.route_for("automation.audit_config_integrity_critical_automation_off",
                                                 "audit_config_integrity")) == "P2"
    assert desk.priority(follows, desk.route_for("automation.shelly_pattern_pool_pump", "critical_schedule")) == "P2"
    assert desk.priority(follows, desk.route_for("automation.critical_water_leak", "critical_binary_trip")) == "P1"
    assert desk.priority({"priority": "P4"}, desk.route_for("automation.critical_battery_x", "critical_battery")) == "P4"
    assert desk.route_for("PM-SILENT")["severity"] == "P3"                 # the agent's own findings: as before
    assert desk.route_for("something_else")["severity"] == desk.RULES["defaults"]["severity"]


def test_a_priority_lowered_while_its_alert_is_chased_stops_the_chase(store):
    # architecture review, 2026-10-19 evening: a rule lowered from P2 to P3 while its alert was open changed the number
    # only — the FM reminded, the owner told after 45min, its Kiosk fault left open, for a digest item
    iid = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    assert store.incident(iid)["state"] == "asked" and store.last_task(f"incident:{iid}")["status"] == "open"
    res = desk.intake(store, event(priority="P3"), T0 + timedelta(minutes=5), occupancy_reader=lambda: "occupied")
    inc = store.incident(iid)
    assert inc["severity"] == "P3" and inc["state"] == "digest"
    assert store.last_task(f"incident:{iid}")["status"] != "open"                       # its task closed…
    assert moved(res)                                                                    # …and its Kiosk fault
    assert english(res["settle"]) == [{"incident_id": iid,                                         # every copy says why
                              "note": "Lowered to P3 on {time}: kept for the next daily digest. No reply needed."}]
    later = desk.tick(store, T0 + timedelta(minutes=60))
    assert later["reasked"] == [] and not [s for s in later["send"] if s.get("incident_id") == iid]
    # raised again: the chase starts again, as before
    desk.intake(store, event(priority="P2"), T0 + timedelta(minutes=70), occupancy_reader=lambda: "occupied")
    assert store.incident(iid)["state"] == "asked" and store.last_task(f"incident:{iid}")["status"] == "open"


def test_a_rule_saved_at_a_lower_priority_stops_the_chase_without_alerting_again(store):
    # owner, 2026-10-19 ("is it possible to lower a priority?"): the rule saved with P3 while its alert was open sends
    # "restated", not a new alert — the number changed and the FM was still reminded until the rule alerted again
    iid = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    res = desk.intake(store, event(phase="restated", priority="P3"), T0 + timedelta(minutes=5),
                      occupancy_reader=lambda: "occupied")
    inc = store.incident(iid)
    assert res["decision"] == "restated" and not res["send"]                            # still nothing sent
    assert inc["severity"] == "P3" and inc["state"] == "digest"
    assert store.last_task(f"incident:{iid}")["status"] != "open"
    assert moved(res)
    assert res["settle"] and res["settle"][0]["incident_id"] == iid
    later = desk.tick(store, T0 + timedelta(minutes=60))
    assert later["reasked"] == [] and not [s for s in later["send"] if s.get("incident_id") == iid]


def test_what_a_priority_does_is_read_from_the_settings():
    assert {p: desk.does(p) for p in ("P1", "P2", "P3", "P4")} == desk.RULES["priority_does"]
    assert desk.does("P2", {"ladder": False}) == "log"                                  # a route without the ladder


def test_lowered_then_raised_is_one_task_reopened_saying_why(store):
    # architecture review, 2026-10-19: a first opening went through open_task, which knows only OPEN tasks — lowered
    # (its task closed "Lowered to P3.") then raised, the alert got a second task and a second Kiosk fault
    iid = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    desk.intake(store, event(priority="P3"), T0 + timedelta(minutes=5), occupancy_reader=lambda: "occupied")
    assert store.last_task(f"incident:{iid}")["status"] != "open"
    res = desk.intake(store, event(priority="P2"), T0 + timedelta(minutes=70), occupancy_reader=lambda: "occupied")
    tasks = store.tasks(None)
    assert len(tasks) == 1 and tasks[0]["status"] == "open" and tasks[0]["reopen_note"] == "Raised to P2."
    assert res["actions"] == [{"action": "faults_changed"}]                             # what the fault says: the task's
    assert desk.RULES["raised_words"] == "Raised to {priority}."                        # the skill's words


def test_the_desks_durations_are_worded_as_both_apps_word_one(store, monkeypatch):
    # architecture review, 2026-10-19: "No answer after 90min", "in 5min", "for 120min" beside the agreement's
    # "1h 30min" (timeutil.lasting, agent-contract duration.cases) everywhere else
    from vesta_shared.params import VillaParams
    params = VillaParams(defaults={**desk.DEFAULTS, "reask_minutes": 90, "escalate_minutes": 150})
    iid = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    reminder = desk.tick(store, T0 + timedelta(minutes=91), params)
    assert reminder["reasked"] == [iid] and reminder["send"][0]["status"] == "No answer after 1h 30min"
    escalated = desk.tick(store, T0 + timedelta(minutes=151), params)
    assert escalated["escalated"] == [iid] and escalated["send"][0]["status"] == "No answer from FM after 2h 30min"
    monkeypatch.setitem(desk.RULES["siren"], "window_min", 90)
    monkeypatch.setattr(desk, "siren_minutes", lambda: 120)
    for n, e in enumerate(("binary_sensor.a", "binary_sensor.b")):
        store.new_incident(f"k{n}", "automation.critical_presence_guard_x", e, "P1",
                           {"message": "Motion", "blueprint": "critical_presence_guard"}, T0.isoformat())
    gate = desk.siren_gate(store, {"occupancy": "empty"}, T0 + timedelta(minutes=1))
    assert gate["armed"] and "2 independent sensors in 1h 30min while the villa is empty" in gate["prompt"]
    assert gate["prompt"].endswith("Approving sounds the siren for 2h.")
    store.beat("ha_events", T0.isoformat())
    silent = desk.tick(store, T0 + timedelta(minutes=150), params)
    assert silent["send"] and "Villa silent since" in silent["send"][0]["status"]
    inc = store.find_open_incident("critical_internet---villa_silent|agent")
    assert "for 2h 30min:" in json.loads(inc["payload"])["message"]


# ------------------------------------------------------------- when it closes, told to the Kiosk (owner, 2026-10-21)
def _closes(store, iid):
    from vesta_shared.store import Notes, notes_of
    return notes_of(store.incident(iid)).get(Notes.CLOSES_AT)


def _card_closes(store, iid):
    (task,) = [t for t in store.tasks(None) if t.get("source") == f"incident:{iid}"]
    return Problems(store).card(task)["closes_at"]


def test_a_door_locked_says_when_its_fault_closes_and_stops_saying_it_when_unlocked_again(store):
    # the villa's #65: locked at 14:38:50, still a fault at 14:45 under "Next check: within 5min" — nothing said the
    # desk waits 10 minutes clear. It now says when: the lock's change + clear_minutes, carried to the Kiosk fault
    clear = desk._params(None).behaviour("clear_minutes")
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=90), "locked"),
                                         (T0 + timedelta(minutes=97), "unlocked")]})
    iid = _left_unlocked(store)
    assert _closes(store, iid) is None
    out = _tick(store, villa, 95)
    want = (T0 + timedelta(minutes=90 + clear)).isoformat()
    assert not out.get("cleared") and _closes(store, iid) == want == _card_closes(store, iid)
    assert R.faults_changed() in out["actions"], out["actions"]                     # its Kiosk fault brought up to date
    assert R.faults_changed() not in _tick(store, villa, 96)["actions"]              # unchanged: no repair asked
    assert _closes(store, iid) == want
    out = _tick(store, villa, 98)                                                     # unlocked again: no longer closing
    assert _closes(store, iid) is None and _card_closes(store, iid) is None and R.faults_changed() in out["actions"]


def test_a_claim_says_when_it_closes_from_when_the_desk_first_saw_it_over(store):
    clear = desk._params(None).behaviour("clear_minutes")
    iid = _overdue(store, claim=CLAIM)["incident_id"]
    ha = Claims([(T0, "true"), (T0 + timedelta(minutes=2), "false")])
    assert not _tick(store, ha, 5).get("cleared")
    assert _closes(store, iid) == (T0 + timedelta(minutes=5 + clear)).isoformat()
    assert _tick(store, ha, 5 + clear)["cleared"] == [iid]


def test_the_time_a_fault_says_it_closes_is_the_time_it_closes(store, monkeypatch):
    """Architecture review, 2026-10-22: the time came from the state's last change, the close from its history. A lock
    re-reported "locked" every 2 minutes moved its time on each report; a lock asleep between its reports ("unavailable")
    showed a time when nothing closed. Both read one answer now (device_state.out_since, through read_states)."""
    from test_offline import _pack
    clear = desk._params(None).behaviour("clear_minutes")
    chatty = TimelineVilla(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"),
                                                  (T0 + timedelta(minutes=90), "locked"),
                                                  (T0 + timedelta(minutes=92), "locked"),
                                                  (T0 + timedelta(minutes=94), "locked")]})
    iid = _left_unlocked(store)
    _tick(store, chatty, 95)
    assert _closes(store, iid) == (T0 + timedelta(minutes=90 + clear)).isoformat()
    assert _tick(store, chatty, 90 + clear)["cleared"] == [iid]
    pack = _pack()
    pack.asleep_are(["lock.back_door"])
    monkeypatch.setitem(desk._PACK, "pack", pack)
    asleep = TimelineVilla(**{"lock.back_door": [(T0 - timedelta(minutes=10), "unlocked"),
                                                 (T0 + timedelta(minutes=90), "locked"),
                                                 (T0 + timedelta(minutes=91), "unavailable")]})
    iid = _left_unlocked(store, entities=("lock.back_door",))
    _tick(store, asleep, 95)
    assert _closes(store, iid) == (T0 + timedelta(minutes=90 + clear)).isoformat()
    assert _tick(store, asleep, 90 + clear)["cleared"] == [iid]


def test_a_lock_asleep_before_the_minutes_read_closes_from_its_report_never_from_their_start(store, monkeypatch):
    """Architecture review, 2026-10-22: "last report holds" was applied to now only. A lock asleep since before the
    clear minutes opened them with "unavailable"; the desk dropped that row and counted the lock out of its bad states
    since their start, so its fault closed at the first tick after locking. Its report before them now holds
    (asleep.held_window): unlocked until it reported "locked"."""
    from test_offline import _pack
    clear = desk._params(None).behaviour("clear_minutes")
    pack = _pack()
    pack.asleep_are(["lock.back_door"])
    monkeypatch.setitem(desk._PACK, "pack", pack)
    asleep = TimelineVilla(**{"lock.back_door": [(T0 - timedelta(minutes=10), "unlocked"),
                                                 (T0 - timedelta(minutes=9), "unavailable"),
                                                 (T0 + timedelta(minutes=90), "locked"),
                                                 (T0 + timedelta(minutes=91), "unavailable")]})
    iid = _left_unlocked(store, entities=("lock.back_door",))
    assert not _tick(store, asleep, 90 + clear / 2).get("cleared")
    assert _closes(store, iid) == (T0 + timedelta(minutes=90 + clear)).isoformat()
    assert _tick(store, asleep, 90 + clear)["cleared"] == [iid]


def test_maintenance_mode_is_the_kiosks_switch_and_lets_only_p1_through(store, tmp_path, monkeypatch):
    """The villa's maintenance mode (owner, 2026-10-29): the Kiosk's switch, told in its heartbeat's answer and kept
    beside the pack (vesta_shared.maintenance). While on, a P2 is not taken up (no number, no send, no fault), a P1 is;
    an answer without the switch (an older Kiosk) keeps what was told; never told, off."""
    from vesta_shared import kiosk_told, maintenance
    pack = str(tmp_path / "pack.json")
    monkeypatch.setenv("VESTA_PACK", pack)
    assert maintenance.on() is False and kiosk_told.told({"ok": True}) == {}                # never told: off
    assert kiosk_told.keep(pack, {"maintenance": True}) and maintenance.on() is True
    assert kiosk_told.save(pack, "maintenance", True) is False                              # unchanged: not written again
    p2 = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")
    assert p2["decision"] == "maintenance_mode" and not p2["send"] and p2["incident_id"] is None
    p1 = desk.intake(store, event(rule="automation.critical_condition_phase_a", priority="P1", entities=("sensor.p",),
                                  label="Phase lost"), T0, occupancy_reader=lambda: "occupied")
    assert p1["decision"] == "new" and p1["send"]
    kiosk_told.save(pack, "maintenance", False)
    assert desk.intake(store, event(rule="automation.critical_condition_back_door", entities=("lock.back",)), T0,
                       occupancy_reader=lambda: "occupied")["decision"] == "new"
    # an alert already open carries on as before (the Kiosk's promise): its repeat is counted, never held
    kiosk_told.save(pack, "maintenance", True)
    again = desk.intake(store, event(rule="automation.critical_condition_back_door", entities=("lock.back",)),
                        T0 + timedelta(minutes=1), occupancy_reader=lambda: "occupied")
    assert again["decision"] in ("counted", "repeat") and again["incident_id"] is not None
