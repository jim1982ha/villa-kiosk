"""While the villa's system restarts, no check opens or closes a fault, and every fault a check opens or closes is a line
in the Agent's log (owner, 2026-11-13: stopped 14:43:20, started 14:47:43; at 14:49 the 5-minute check cleared two
automation faults whose device was still offline, and the log said nothing). One settle time for every check: the
agreement's restartSettle (vesta_shared.restart). Driven through nightly.py and recheck.py as the engine runs them,
the villa's logbook given as its rows. Invented entities."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import types
from datetime import datetime, timedelta, timezone

import pytest

from helpers import PYTHONPATH, STARTER_SKILLS
from vesta_agent.outcome import fault_lines
from vesta_shared import agreement, restart
from vesta_shared.problems import Problems, Resting
from vesta_shared import result as R
from vesta_shared.store import Store

NIGHTLY = os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "nightly.py")
RULE = "PM-HIDDEN-IN-RULE"
RAW = "lock.example_door"
WATCHDOG = {"entity_id": "automation.example_watchdog", "kind": "automation", "config": {
    "id": "1", "alias": "Example watchdog",
    "use_blueprint": {"path": "critical_watchdog.yaml", "input": {"critical_entities": [RAW]}}}}
SETTLE = agreement.section("restartSettle")["minutes"]


def _ha(message, at):
    return {"name": "Home Assistant", "message": message, "domain": "homeassistant", "when": at.isoformat()}


def _night(tmp, as_of, state="unavailable", changed="2026-10-03T00:00:00+00:00", logbook=(), now=None):
    """The night check of `as_of`, run at `now` (the next midnight when not said), the hidden device in `state` since
    `changed`: its result."""
    fx = tmp / "fx"
    fx.mkdir(exist_ok=True)
    (fx / "states.json").write_text(json.dumps({"states": {
        RAW: {"state": state, "attributes": {"friendly_name": "Example Door"}, "last_changed": changed}}}))
    (fx / "rules.json").write_text(json.dumps([WATCHDOG]))
    (fx / "logbook.json").write_text(json.dumps({"entries": list(logbook)}))
    (tmp / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "families": {}, "assets": {}, "hidden": [RAW]}))
    r = subprocess.run([sys.executable, NIGHTLY, "--pack", str(tmp / "pack.json"), "--store", str(tmp / "s.sqlite"),
                        "--fixture-dir", str(fx), "--skip-raw", "--as-of", as_of, "--now",
                        (now or datetime.fromisoformat(as_of).replace(tzinfo=timezone.utc) + timedelta(days=1)).isoformat()],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=120)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _open(tmp):
    return [f for f in Store(str(tmp / "s.sqlite")).findings("open") if f["rule_id"] == RULE]


def test_the_night_check_opens_and_closes_nothing_while_the_villas_system_restarts_and_says_so_once(tmp_path):
    out = _night(tmp_path, "2026-10-03")
    (f,) = _open(tmp_path)
    (row,) = out[R.FAULT_LOG]                                     # its opening, in the Agent's log
    assert row["what"] == R.OPENED and row["words"] == f["summary"] and row["check"] == R.NIGHT_CHECK
    # the next night ends at 00:00 on the 5th, the villa's system started two minutes before: the door answers, but
    # nothing is closed — one line says the check rested
    night_end = datetime(2026, 10, 5, tzinfo=timezone.utc)
    restarting = [_ha("stopped", night_end - timedelta(minutes=4)), _ha("started", night_end - timedelta(minutes=2))]
    out = _night(tmp_path, "2026-10-04", state="unlocked", logbook=restarting)
    assert [g["id"] for g in _open(tmp_path)] == [f["id"]]
    assert len(fault_lines(out[R.FAULT_LOG])) == 1 and out[R.FAULT_LOG][0]["what"] == R.SKIPPED
    # settled, the next night closes it, saying how it ended
    out = _night(tmp_path, "2026-10-05", state="unlocked", logbook=restarting)
    assert _open(tmp_path) == []
    (row,) = out[R.FAULT_LOG]
    assert row["what"] == R.CLOSED and row["words"] == f["summary"] and row["note"]
    (line,) = fault_lines(out[R.FAULT_LOG])
    assert f["summary"] in line and row["note"] in line


def test_a_device_answering_with_no_value_just_now_is_not_back(tmp_path):
    # a device still loading answers "unknown" first: the fault that opened because it did not answer stays open,
    # and closes once that has held the settle time (the same test opens it and closes it)
    _night(tmp_path, "2026-10-03")
    (f,) = _open(tmp_path)
    just = (datetime(2026, 10, 5, tzinfo=timezone.utc) - timedelta(minutes=SETTLE - 1)).isoformat()
    _night(tmp_path, "2026-10-04", state="unknown", changed=just)
    assert [g["id"] for g in _open(tmp_path)] == [f["id"]]
    _night(tmp_path, "2026-10-05", state="unknown", changed=just)
    assert _open(tmp_path) == []


class _Villa:
    """The villa's system as far as its logbook goes: its rows."""

    def __init__(self, rows):
        self.rows = rows

    def logbook(self, start, end, entity_id=None):
        return [r for r in self.rows if start <= datetime.fromisoformat(r["when"]) < end]


def test_an_agreement_without_the_settle_time_still_lets_the_villas_system_settle(monkeypatch):
    # without the value the rest was off: the 5-minute check then cleared faults while the devices were loading
    now = datetime(2026, 11, 13, 14, 49, tzinfo=timezone.utc)
    monkeypatch.setattr(agreement, "section", lambda name: {})
    started = _Villa([_ha("stopped", now - timedelta(minutes=6)), _ha("started", now - timedelta(minutes=2))])
    assert restart.settling(started, now)
    assert restart.settling(_Villa([_ha("stopped", now - timedelta(minutes=1))]), now)         # still starting
    assert not restart.settling(started, now + timedelta(minutes=restart.DEFAULT_MINUTES))


def test_a_device_that_dropped_while_the_villas_system_was_stopped_did_not_drop_on_its_own():
    # a stop that lasts longer than the settle time: the device went "unavailable" with the stop, answered after the
    # start — the restart's, never a reconnect of its own
    spec = importlib.util.spec_from_file_location(
        "pm_features", os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "features.py"))
    features = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(features)
    t = datetime(2026, 11, 13, 14, 43, tzinfo=timezone.utc)
    rows = [_ha("stopped", t),
            {"when": (t + timedelta(minutes=1)).isoformat(), "entity_id": "switch.example_relay", "state": "unavailable"},
            _ha("started", t + timedelta(minutes=SETTLE + 4)),
            {"when": (t + timedelta(minutes=SETTLE + 5)).isoformat(), "entity_id": "switch.example_relay", "state": "on"},
            {"when": (t + timedelta(hours=3)).isoformat(), "entity_id": "switch.example_relay", "state": "unavailable"},
            {"when": (t + timedelta(hours=3, minutes=5)).isoformat(), "entity_id": "switch.example_relay", "state": "on"}]
    drops = features.drop_times(rows, restart.minutes())
    assert drops == {"switch.example_relay": [t + timedelta(hours=3)]}                # its own drop only


def test_a_night_check_of_an_earlier_day_rests_while_the_villas_system_restarts_now_and_asks_to_run_again(tmp_path):
    # architecture review, 2026-11-14: the rest was judged at the end of the day judged, so a night check of an earlier
    # day, run while the villa's system restarted, read loading devices as back and closed their faults
    _night(tmp_path, "2026-10-03")
    (f,) = _open(tmp_path)
    now = datetime(2026, 10, 20, 2, 0, tzinfo=timezone.utc)
    restarting = [_ha("stopped", now - timedelta(minutes=3)), _ha("started", now - timedelta(minutes=1))]
    out = _night(tmp_path, "2026-10-04", state="unlocked", logbook=restarting, now=now)
    assert [g["id"] for g in _open(tmp_path)] == [f["id"]]                     # nothing closed
    (line,) = fault_lines(out[R.FAULT_LOG])
    assert "runs again" in line
    again = datetime.fromisoformat(out[R.RUN_AGAIN_AT])                         # once it has settled, never sooner
    assert now + timedelta(minutes=SETTLE) <= again < now + timedelta(minutes=SETTLE + 1)


def test_a_restart_in_the_middle_of_a_long_reading_rests_its_writes_even_once_settled(tmp_path, monkeypatch):
    # architecture review, 2026-11-14: judged once at the end of a run of up to 30 minutes, a restart in its middle,
    # settled by the end, was not seen, and what was read while the devices loaded was written
    began = datetime(2026, 11, 13, 2, 0, tzinfo=timezone.utc)
    clock = [0.0]
    monkeypatch.setattr(restart, "time", types.SimpleNamespace(monotonic=lambda: clock[0]))
    store = Store(str(tmp_path / "s.sqlite"))
    fid, _ = store.raise_finding("PM-X", "sensor.example", "power", "2026-11-12", "P3", "Pump weak", {})
    villa = _Villa([_ha("stopped", began + timedelta(minutes=10)), _ha("started", began + timedelta(minutes=13))])
    run = Problems.session(store, villa, R.NIGHT_CHECK, now=began)
    assert not run.rested                                                      # nothing restarting when it began
    clock[0] = 30 * 60                                                         # its writes, 30 minutes on: settled
    with pytest.raises(Resting):
        Problems(store).close_finding(store.finding(fid), "2026-11-12", "Cleared.")
    assert store.finding(fid)["status"] == "open"
    assert len(fault_lines(run.log())) == 1 and run.log()[0]["what"] == R.SKIPPED


class _F:
    """A finding as the night check makes it (rules.Finding's shape)."""
    def __init__(self, rule_id, entity_id, severity, summary):
        self.rule_id, self.entity_id, self.family, self.severity, self.summary = rule_id, entity_id, "power", severity, summary
        self.detail, self.check, self.day = {}, "look", ""

    def as_dict(self):
        return {"rule_id": self.rule_id, "entity_id": self.entity_id, "family": self.family, "severity": self.severity,
                "summary": self.summary, "detail": self.detail, "check": self.check, "day": self.day}


def test_the_agents_log_follows_each_faults_card_and_only_what_has_one(tmp_path):
    # architecture review, 2026-11-14: the log followed the findings: a one-night note with no card read "Fault opened"
    # then "Fault closed", and a card opened again or given new words said nothing
    store = Store(str(tmp_path / "s.sqlite"))
    run = Problems.session(store, None, R.NIGHT_CHECK)
    pb = Problems(store)
    rules = dict(state_rules={"S-POWER"}, event_rules={"E-RUN"}, worsened_step=15, resolved_note="Cleared.")

    def night(day, *found):
        n = len(run.rows)
        pb.record_night(list(found), day, **rules)
        return fault_lines(run.log()[n:])
    assert night("2026-10-06", _F("S-POWER", "sensor.a", "P2", "Pump weak"), _F("E-RUN", "sensor.c", "P4", "Ran once")) \
        == ['Fault opened: "Pump weak" (the night check)']                      # the note with no card: no fault
    assert night("2026-10-07", _F("S-POWER", "sensor.a", "P2", "Pump weaker")) \
        == ['Fault reworded: "Pump weaker" (the night check: was Pump weak)']
    assert night("2026-10-08") == ['Fault closed: "Pump weaker" (the night check: Cleared.)']
    (line,) = night("2026-10-09", _F("S-POWER", "sensor.a", "P2", "Pump weak"))
    assert line.startswith('Fault reopened: "Pump weak') and line.endswith("(the night check: Back again.)")
