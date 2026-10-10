"""The alert desk fed with vesta_critical_event as Home Assistant fires it
(shape checked live on 2026-09-30; INTEGRATION-PLAN 6b). Invented entities."""
from __future__ import annotations

import importlib.util
import json
import os
from datetime import datetime, timedelta, timezone

import pytest

from helpers import PYTHONPATH, STARTER_SKILLS
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
    res = desk.intake(store, event(), T0, mode_reader=lambda: "occupied")
    assert res["decision"] == "new"
    fm = [s for s in res["send"] if s["to"] == "fm"]
    # the incident's number is the heading the engine writes (notice.py); the skill's text is the body alone
    assert fm and fm[0]["keyboard"] is True and fm[0]["incident_id"] == res["incident_id"] and fm[0]["stage"] == "new"
    ticket = [a for a in res["actions"] if a["action"] == "ticket"]
    assert ticket and ticket[0]["entity_id"] == "lock.front_door" and ticket[0]["task_id"]
    assert not [s for s in res["send"] if s["to"] == "owner"]        # P2: the FM only


def test_resolved_closes_the_incident_and_its_ticket(store):
    iid = desk.intake(store, event(), T0, mode_reader=lambda: "occupied")["incident_id"]
    res = desk.intake(store, event(phase="resolved"), T0 + timedelta(minutes=20))
    assert res["decision"] == "resolved" and res["incident_id"] == iid
    assert store.incident(iid)["state"] == "resolved"
    assert [a for a in res["actions"] if a["action"] == "ticket.resolve"]
    assert "No reply needed" in res["send"][0]["status"]                # where it stands: its own part (layout.py)
    assert res["settle"] == [{"incident_id": iid, "note": "Cleared in Home Assistant on {time}."}]
    # the chase stops: no reminder for it any more
    assert desk.tick(store, T0 + timedelta(minutes=30))["reasked"] == []


def test_abandoned_escalates_to_the_owner(store):
    iid = desk.intake(store, event(), T0, mode_reader=lambda: "occupied")["incident_id"]
    res = desk.intake(store, event(phase="abandoned"), T0 + timedelta(hours=6))
    assert res["decision"] == "abandoned"
    assert store.incident(iid)["state"] == "escalated"
    assert res["send"][0]["to"] == "owner"


def test_an_opened_only_rule_closes_through_the_ladder(store):
    # critical_watchdog never sends "resolved": Done must close it
    ev = event(blueprint="critical_watchdog", rule="automation.critical_watchdog_devices",
               entities=("sensor.garden_probe",), label="Device offline")
    iid = desk.intake(store, ev, T0, mode_reader=lambda: "occupied")["incident_id"]
    res = desk.tick(store, T0 + timedelta(minutes=16))
    assert iid in res["reasked"]
    out = desk.reply(store, iid, "Done", "fm", T0 + timedelta(minutes=20))
    assert store.incident(iid)["state"] == "done"
    assert [a for a in out["actions"] if a["action"] == "ticket.resolve"]


def test_routing_by_blueprint(store):
    trip = desk.intake(store, event(blueprint="critical_binary_trip", rule="automation.critical_leak",
                                    entities=("binary_sensor.kitchen_leak",), label="Leak"), T0, mode_reader=lambda: "occupied")
    assert {s["to"] for s in trip["send"]} == {"owner", "fm"}            # P1: both chats


def test_a_repeat_inside_the_cooldown_is_counted_not_sent(store):
    desk.intake(store, event(started=1), T0, mode_reader=lambda: "occupied")
    res = desk.intake(store, event(started=2), T0 + timedelta(minutes=5), mode_reader=lambda: "occupied")
    assert res["decision"] == "counted" and res["send"] == []


def test_intrusion_arms_the_siren_gate_only_when_vacant_with_two_signals(store):
    pg = dict(blueprint="critical_presence_guard", rule="automation.critical_presence_guard_night")
    a = desk.intake(store, event(entities=("binary_sensor.garden_motion",), started=1, **pg), T0, mode_reader=lambda: "vacant")
    assert a["siren_gate"]["armed"] is False                               # one signal
    b = desk.intake(store, event(entities=("binary_sensor.gate_motion",), started=2, **pg),
                    T0 + timedelta(minutes=1), mode_reader=lambda: "vacant")
    assert b["siren_gate"]["armed"] is True
    c = desk.intake(Store(":memory:"), event(entities=("binary_sensor.gate_motion",), **pg), T0, mode_reader=lambda: "occupied")
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
    (fx / "states.json").write_text(json.dumps({"states": {"input_select.villa_mode": {"state": "Occupied"}}}))
    env = {**os.environ, "PYTHONPATH": PYTHONPATH}
    r = subprocess.run([sys.executable, os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"), "intake",
                        "--event", str(p), "--store", str(tmp_path / "s.sqlite"), "--fixture-dir", str(fx)],
                       capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["decision"] == "new"


def test_a_text_answer_settles_the_alerts_buttons_too(store):
    # "#2 done" typed in a chat: the alert and its reminders lose their buttons, like a press
    iid = desk.intake(store, event(), T0, mode_reader=lambda: "occupied")["incident_id"]
    res = desk.reply(store, iid, "done, it was the gardener", "fm", T0 + timedelta(minutes=5))
    assert res["settle"] == [{"incident_id": iid, "note": "Done answered by the facility manager on {time}"}]
    assert "settle" not in desk.reply(store, iid, "what happened?", "fm", T0 + timedelta(minutes=6))



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
    desk.intake(store, event(), T0, mode_reader=lambda: "occupied", zone="Asia/Makassar")
    res = desk.intake(store, event(), T0 + timedelta(hours=6), mode_reader=lambda: "occupied", zone="Asia/Makassar")
    assert res["send"][0]["status"].endswith("since Thu 1 Oct, 17:00")  # 09:00 UTC is 17:00 in the villa


def test_only_done_and_need_help_and_an_old_not_found_is_chased_again(tmp_path):
    # owner, 2026-10-10: "remove all the Mute and Not Found … too complex for now"
    import sqlite3
    from vesta_agent.alert_buttons import LADDER
    from vesta_shared.store import Store
    assert [label for label, _ in LADDER] == ["Done", "Need help"]
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
class Villa:
    """Home Assistant's states as the desk reads them again: each entity's timeline [(since, state)]."""
    def __init__(self, **timeline):
        self.timeline = timeline
        self.now = T0

    def states(self, ids):
        out = {}
        for e in ids:
            rows = [(since, st) for since, st in self.timeline.get(e, []) if since <= self.now]
            if rows:
                since, st = rows[-1]
                out[e] = {"state": st, "last_changed": since.isoformat(), "attributes": {"friendly_name": e.split(".")[1]}}
        return out


def _tick(store, villa, minutes):
    villa.now = T0 + timedelta(minutes=minutes)
    return desk.tick(store, villa.now, client=villa)


LOCKS = ("lock.front_door", "lock.back_door")
BAD = ["unlocked", "open", "jammed"]


def _left_unlocked(store, entities=("lock.front_door",), abandon=True, still_true=True, **extra):
    """A door rule shaped like the live critical_condition: every watched entity, its list of bad states."""
    iid = desk.intake(store, event(entities=entities, mode="state", bad_states=BAD, **extra), T0,
                      mode_reader=lambda: "occupied")["incident_id"]
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
    assert [s for s in res["send"] if s["to"] == "fm" and "No reply needed" in s["status"]]
    assert not _tick(store, villa, 120).get("cleared")                  # closed once


def test_a_lock_gone_from_unlocked_to_jammed_is_never_cleared(store):
    # architecture review 22: 0.12.145 took "not the state it alerted on" for over — "jammed" closed the alert
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=20), "jammed"),
                                         (T0 + timedelta(minutes=300), "unknown")]})
    _left_unlocked(store)
    for minutes in (60, 200, 400, 600):                                 # jammed, then "unknown": never over
        assert not _tick(store, villa, minutes).get("cleared")


def test_an_offline_device_is_as_fine_to_the_desk_as_to_its_rule(store):
    # architecture review 23: one lock of three offline for days kept the incident open for good — the rule itself, not
    # listing "unavailable", treats a dead lock as fine; one that lists it does not
    timeline = {"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=90), "locked")],
                "lock.back_door": [(T0 - timedelta(days=2), "unavailable")]}
    iid = _left_unlocked(store, entities=LOCKS)
    assert _tick(store, Villa(**timeline), 101)["cleared"] == [iid]
    store2 = Store(store.path + "-2")
    desk.intake(store2, event(entities=LOCKS, mode="state", bad_states=BAD + ["unavailable"]), T0, mode_reader=lambda: "x")
    desk.intake(store2, event(phase="abandoned", entities=LOCKS, mode="state", bad_states=BAD + ["unavailable"],
                              still_true=True), T0 + timedelta(minutes=30))
    assert not _tick(store2, Villa(**timeline), 101).get("cleared")


def test_a_rule_watching_two_doors_is_over_when_neither_is_open(store):
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=90), "locked")],
                     "lock.back_door": [(T0 - timedelta(days=1), "locked")]})
    iid = _left_unlocked(store, entities=LOCKS)
    assert not _tick(store, villa, 95).get("cleared")
    assert _tick(store, villa, 101)["cleared"] == [iid]                 # the back door locked all along counts as fine


def test_a_condition_home_assistant_still_watches_is_left_to_it(store):
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=15), "locked")]})
    _left_unlocked(store, abandon=False)
    assert not _tick(store, villa, 60).get("cleared")                   # Home Assistant says "resolved" itself


def test_a_rule_that_stopped_watching_once_back_to_normal_never_tells_the_owner_still_not_clear(store):
    # architecture review 22: the rule said "cleared just inside the limit", the desk told the owner "Still not clear"
    iid = desk.intake(store, event(), T0, mode_reader=lambda: "occupied")["incident_id"]
    res = desk.intake(store, event(phase="abandoned", still_true=False), T0 + timedelta(minutes=30))
    assert res["decision"] == "abandoned_cleared" and store.incident(iid)["state"] == "resolved"
    assert not [s for s in res["send"] if s["to"] == "owner"]
    # architecture review 23: Home Assistant's own message, taken over, says the same end — never "🔶 no longer tracked"
    (ha,) = res["ha_messages"]
    assert ha["status"] == "Cleared on {time}: back to normal when Home Assistant stopped watching."


def test_a_number_or_an_alert_from_before_the_bad_states_waits_for_a_person(store):
    villa = Villa(**{"sensor.cabinet": [(T0 + timedelta(minutes=5), "40.2")],
                     "lock.front_door": [(T0 + timedelta(minutes=5), "locked")]})
    # a numeric rule sends its bad states too (the blueprint's default: unavailable) — never read as "over"
    desk.intake(store, event(rule="automation.critical_condition_cabinet", entities=("sensor.cabinet",), mode="numeric",
                             bad_states=["unavailable"]), T0, mode_reader=lambda: "occupied")
    desk.intake(store, event(phase="abandoned", rule="automation.critical_condition_cabinet", entities=("sensor.cabinet",),
                             mode="numeric", bad_states=["unavailable"]), T0 + timedelta(minutes=30))
    desk.intake(store, event(), T0, mode_reader=lambda: "occupied")                  # no bad_states: an older rule
    desk.intake(store, event(phase="abandoned"), T0 + timedelta(minutes=30))
    assert not _tick(store, villa, 120).get("cleared") and len(store.incidents(open_only=True)) == 2


def _watchdog(store, state, bad_states=None):
    extra = {"bad_states": bad_states} if bad_states else {}
    return desk.intake(store, event(blueprint="critical_watchdog", rule="automation.critical_devices_unavailable_watchdog",
                                    entities=("sensor.ap_state",), label="Critical device unavailable", state=state,
                                    **extra), T0, mode_reader=lambda: "occupied")["incident_id"]


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
                      mode_reader=lambda: "occupied")["incident_id"]
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
                       T0 + timedelta(minutes=minutes), mode_reader=lambda: "occupied")


def test_an_alert_back_within_four_hours_is_the_same_incident_back_again(store):
    # architecture review 23: closed by the desk, the access point dropped again 40 min later — a new number, a new "New"
    # message with buttons and a new Kiosk fault each cycle
    first = _ap(store, 0)
    iid = first["incident_id"]
    villa = Villa(**{"sensor.ap_state": [(T0 - timedelta(minutes=10), "disconnected"), (T0 + timedelta(minutes=20), "connected")]})
    assert _tick(store, villa, 35)["cleared"] == [iid]
    again = _ap(store, 75)
    assert again["decision"] == "reopened" and again["incident_id"] == iid and store.incident(iid)["closed_at"] is None
    assert [s for s in again["send"] if s["to"] == "fm" and s["status"].startswith("Back again: 2 times since ")
            and s["keyboard"]]
    assert [a for a in again["actions"] if a["action"] == "ticket"]           # its fault in the Kiosk again
    assert len(store.incidents(open_only=False)) == 1
    # Home Assistant's later events for this new run find it
    assert json.loads(store.incident(iid)["payload"])["ha_incident"].endswith(str(1790000000 + 75 * 60))
    villa.timeline["sensor.ap_state"].append((T0 + timedelta(minutes=80), "connected"))
    _tick(store, villa, 95)
    assert _ap(store, 95 + 5 * 60)["decision"] == "new"                       # five hours on: a new problem


def _done(store, villa, iid, minutes):
    desk.reply(store, iid, "Done", "fm", T0 + timedelta(minutes=minutes))
    return _tick(store, villa, minutes + 11)


def test_after_done_the_desk_reads_the_device_once_and_reopens_what_is_still_bad(store):
    # architecture review 23: "will check it stays quiet" was promised and never done
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked")]})
    iid = _left_unlocked(store, abandon=False)
    res = _done(store, villa, iid, 20)
    assert res["not_quiet"] == [iid] and store.incident(iid)["closed_at"] is None
    (fm,) = [s for s in res["send"] if s["to"] == "fm"]
    assert fm["status"] == "Done by the facility manager, but front_door still reads unlocked: still open." and fm["keyboard"]
    assert [a for a in res["actions"] if a["action"] == "ticket"]
    assert not _tick(store, villa, 60).get("not_quiet")                         # read once


def test_after_done_a_quiet_device_stays_closed_and_an_alert_without_states_promises_nothing(store):
    villa = Villa(**{"lock.front_door": [(T0 - timedelta(minutes=10), "unlocked"), (T0 + timedelta(minutes=15), "locked")]})
    iid = _left_unlocked(store, abandon=False)
    assert "will check it stays quiet" in desk.reply(store, iid, "Done", "fm", T0 + timedelta(minutes=20))["send"][0]["status"]
    assert not _tick(store, villa, 31)["not_quiet"] and store.incident(iid)["closed_at"]
    villa.timeline["lock.front_door"].append((T0 + timedelta(days=3), "unlocked"))     # days later: another story
    assert not _tick(store, villa, 3 * 1440 + 30)["not_quiet"] and store.incident(iid)["closed_at"]
    other = desk.intake(store, event(rule="automation.critical_condition_other"), T0, mode_reader=lambda: "x")["incident_id"]
    said = desk.reply(store, other, "Done", "fm", T0 + timedelta(minutes=20))["send"][0]["status"]
    assert "stays quiet" not in said


def test_one_bad_state_sent_as_text_is_one_state_not_its_letters(store):
    iid = _ap(store, 0, )["incident_id"]
    store2 = Store(store.path + "-3")
    desk.intake(store2, {**event(blueprint="critical_watchdog", entities=("sensor.ap_state",), state="disconnected"),
                         "bad_states": "disconnected"}, T0, mode_reader=lambda: "x")
    villa = Villa(**{"sensor.ap_state": [(T0 - timedelta(minutes=10), "disconnected")]})
    assert not _tick(store2, villa, 60).get("cleared")
    assert iid
