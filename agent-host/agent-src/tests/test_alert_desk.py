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

spec = importlib.util.spec_from_file_location("desk", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

T0 = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)


def event(blueprint="critical_condition", phase="opened", rule="automation.critical_condition_front_door",
          started=1790000000, entities=("lock.front_door",), label="Front door left unlocked", **extra):
    return {"blueprint": blueprint, "rule_id": rule, "incident_id": f"{rule}-{started}", "phase": phase,
            "severity": "critical", "label": label, "entities": list(entities),
            "summary": f"{label}\nFront door is unlocked", "timestamp": T0.isoformat(), **extra}


@pytest.fixture
def store(tmp_path):
    return Store(str(tmp_path / "store.sqlite"))


def test_opened_goes_to_the_fm_with_the_ladder_and_becomes_a_ticket(store):
    res = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")
    assert res["decision"] == "new"
    fm = [s for s in res["send"] if s["to"] == "fm"]
    # the incident's number is the heading the engine writes (notice.py); the skill's text is the body alone
    assert fm and fm[0]["keyboard"] is True and fm[0]["incident_id"] == res["incident_id"] and fm[0]["stage"] == "new"
    ticket = [a for a in res["actions"] if a["action"] == "ticket"]
    assert ticket and ticket[0]["entity_id"] == "lock.front_door" and ticket[0]["task_id"]
    assert not [s for s in res["send"] if s["to"] == "owner"]        # P2: the FM only


def test_resolved_closes_the_incident_and_its_ticket(store):
    iid = desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    res = desk.intake(store, event(phase="resolved"), T0 + timedelta(minutes=20))
    assert res["decision"] == "resolved" and res["incident_id"] == iid
    assert store.incident(iid)["state"] == "resolved"
    assert [a for a in res["actions"] if a["action"] == "ticket.resolve"]
    assert res["send"][0]["status"] == "Cleared on {time}."   # its own part, the same words everywhere
    assert res["settle"] == [{"incident_id": iid, "note": "Cleared on {time}."}]
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
    assert [a for a in out["actions"] if a["action"] == "ticket.resolve"]


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
    (fx / "states.json").write_text(json.dumps({"states": {"binary_sensor.villa_empty": {"state": "off"}}}))
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
    assert res["settle"] == [{"incident_id": iid, "note": "Done pressed by Fabien on {time}."}]
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
    # given up after 30 min ("abandoned") and nobody ever said the door was locked
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=95), "locked")]})
    iid = _left_unlocked(store)
    assert not _tick(store, villa, 60).get("cleared")                   # still unlocked
    assert not _tick(store, villa, 100).get("cleared")                  # locked 5 min ago: not yet
    res = _tick(store, villa, 106)
    assert res["cleared"] == [iid] and store.incident(iid)["state"] == "resolved"
    assert res["settle"] == [{"incident_id": iid, "note": "Cleared on {time}: front_door is locked."}]
    assert [a for a in res["actions"] if a["action"] == "ticket.resolve"]          # its Kiosk fault closes too
    assert [s for s in res["send"] if s["to"] == "fm" and s["status"] == "Cleared on {time}: front_door is locked."
            and s["stage"] == "closed"], res["send"]
    assert not _tick(store, villa, 120).get("cleared")                  # closed once


def test_a_door_that_keeps_changing_while_locked_closes_when_it_was_never_unlocked_in_the_last_minutes(store):
    # villa, 2026-10-15: "back for 10 minutes" was "unchanged for 10 minutes" — a state that moves between good ones
    # (locked, locking, locked) never got there; its history over the minutes decides
    m = lambda x: T0 + timedelta(minutes=x)                                             # noqa: E731
    villa = Villa(**{"lock.front_door": [(m(-10), "unlocked"), (m(40), "locked"), (m(55), "locking"), (m(57), "locked")]})
    iid = _left_unlocked(store)
    assert _tick(store, villa, 60)["cleared"] == [iid]                  # locked since 40, its last change 3 min ago
    again = Villa(**{"lock.back_door": [(m(-10), "unlocked"), (m(40), "locked"), (m(53), "unlocked"), (m(57), "locked")]})
    iid2 = _left_unlocked(store, entities=("lock.back_door",))
    assert not _tick(store, again, 60).get("cleared")                   # unlocked again 7 min ago: not yet
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
    assert ha["status"] == "Cleared on {time}: back to normal when the alert stopped watching it."


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
    # architecture review 23: closed by the desk, the access point dropped again 40 min later — a new number, a new "New"
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
    (back,) = [a for a in again["actions"] if a["action"] == "ticket.reopen"]
    assert back["title"].endswith("(again: 2 times in 7 days)") and not [a for a in again["actions"] if a["action"] == "ticket"]
    assert len(store.tasks(None)) == 1
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
    assert fm["status"] == "Done pressed by FM, but front_door still reads unlocked: still open. VESTA keeps watching it." and fm["keyboard"]
    assert [a for a in res["actions"] if a["action"] == "ticket.reopen"]      # its own fault, open again
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
    assert "VESTA will check it stays right." in desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=20))["send"][0]["status"]
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
    assert res["settle"][0]["note"] == "Cleared on {time}: it is no longer reported."


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
    assert "Done pressed by Wayan, but it is still reported: still open. VESTA keeps watching it." in \
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
    assert (inc["severity"], inc["state"]) == ("P2", "asked") and [a["action"] for a in res["actions"]] == ["ticket"]


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
        .startswith("Noted from Owner on ")


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
    # the villa's #54 (2026-10-18): main power unavailable, cleared after 10 min back (10:50); back at 11:28, the device
    # answered at 11:30:15 and the desk closed it at 11:30:17 — the "back to normal since 10:40" of the run before was
    # never forgotten, so the new run read as 50 minutes clear
    iid = _overdue(store, claim=CLAIM)["incident_id"]
    ha = Claims([(T0, "true"), (T0 + timedelta(minutes=2), "false"), (T0 + timedelta(minutes=50), "true"),
                 (T0 + timedelta(minutes=60), "false")])
    assert not _tick(store, ha, 5).get("cleared")                              # clear since 5
    assert _tick(store, ha, 15)["cleared"] == [iid]                            # 10 min clear: over
    again = _overdue(store, at=T0 + timedelta(minutes=55), claim=CLAIM, started=1790003300)
    assert again["decision"] == "reopened" and again["incident_id"] == iid
    assert not _tick(store, ha, 61).get("cleared")                             # back 1 min, not 56
    assert not _tick(store, ha, 66).get("cleared")
    assert _tick(store, ha, 71)["cleared"] == [iid]                            # its own 10 minutes


def test_the_siren_reads_the_villas_one_empty_helper(tmp_path):
    # owner, 2026-10-18: the desk read input_select.villa_mode, a mode no villa had — "unknown" for every intrusion,
    # the siren could never be offered. The helper the presence rules read answers; missing is never empty
    from fixture_client import FixtureClient
    fx = tmp_path / "fx"
    fx.mkdir()
    for state, mode in (("on", "empty"), ("off", "occupied"), ("unavailable", "unknown")):
        (fx / "states.json").write_text(json.dumps({"states": {"binary_sensor.villa_empty": {"state": state}}}))
        assert desk.occupancy(FixtureClient(str(fx))) == mode
    (fx / "states.json").write_text(json.dumps({"states": {"input_select.villa_mode": {"state": "vacant"}}}))
    assert desk.occupancy(FixtureClient(str(fx))) == "unknown"
