"""A "has not run" alert of a device that runs only when people are in (owner, 2026-11-12, #167-P2: "is it expected to
see this alert when the villa is not occupied? … the VESTA Agent shall be clever enough to handle such cases, without
human configuration"): learned hour by hour (vesta_shared.demand), held by the alert desk while nobody was there to use
it, asked once people have been in long enough. Invented entities."""
from __future__ import annotations

import importlib.util
import os
from datetime import date, datetime, timedelta, timezone

import pytest

from helpers import STARTER_SKILLS
from vesta_shared import demand
from vesta_shared.store import Incident, Store

spec = importlib.util.spec_from_file_location("desk_held", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

PUMP, EMPTY = "sensor.pump_power", "binary_sensor.villa_empty"
T0 = datetime(2026, 11, 12, 0, 0, tzinfo=timezone.utc)
RULES = demand.Rules(min_run_hours=10, min_empty_hours=48, empty_ratio=0.25, sure=0.95, max_hold_hours=48)


def hour(h: datetime, mx: float) -> dict:
    return {"start": int(h.timestamp() * 1000), "max": mx, "mean": mx / 10}


class Villa:
    """The villa's history as the desk reads it: the pump's hourly maxima, the empty sensor's changes."""
    def __init__(self, runs: list[datetime], empty: list[tuple[datetime, str]]):
        self.runs, self.empty = runs, empty

    def statistics(self, ids, start, end, period="hour", types=()):
        rows, h = [], start.replace(minute=0, second=0, microsecond=0)
        while h < end:
            rows.append(hour(h, 2000.0 if h in self.runs else 30.0))
            h += timedelta(hours=1)
        return {PUMP: rows}

    def history(self, ids, start, end):
        before = [(t, s) for t, s in self.empty if t <= start]
        rows = ([{"state": before[-1][1], "last_changed": start.isoformat()}] if before else []) + \
            [{"state": s, "last_changed": t.isoformat()} for t, s in self.empty if start < t <= end]
        return {EMPTY: rows}


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(desk.occupancy_now, "sensor", lambda pack_path=None: EMPTY)
    return Store(str(tmp_path / "store.sqlite"))


def learned(store, follows=True, need_h=6.0):
    demand.record(store, T0.isoformat(), {PUMP: {"follows": follows, "need_h": need_h, "thr": 500.0,
                                                 "name": "Pump", "look_days": 30}})


def overdue(at=T0):
    return {"blueprint": "critical_schedule", "rule_id": "automation.pump_watchdog", "rule_uid": "1",
            "incident_id": f"automation.pump_watchdog-{int(at.timestamp())}", "phase": "opened", "severity": "warning",
            "priority": "P2", "label": "Pump", "entities": [PUMP], "reason": "overdue_run",
            "summary": "Pump has not recorded a confirmed run in over 1d.", "timestamp": at.isoformat()}


# ------------------------------------------------------------------------------------------------ what is learned
def test_a_device_that_runs_only_with_people_in_is_told_from_one_that_runs_either_way():
    # 100 hours with someone in, run in 30; 100 empty hours, run in 2 (a tap left dripping): it follows people
    v = demand.learn({"in_h": 100, "in_run_h": 30, "empty_h": 100, "empty_run_h": 2}, RULES)
    assert v["follows"] and 1 <= v["need_h"] <= 48
    # a fridge, a pool pump on its timer: as often empty as not — never held
    assert not demand.learn({"in_h": 100, "in_run_h": 30, "empty_h": 100, "empty_run_h": 25}, RULES)["follows"]
    # too little seen yet: nothing said
    assert not demand.learn({"in_h": 20, "in_run_h": 5, "empty_h": 10, "empty_run_h": 0}, RULES)["follows"]


def test_an_hour_is_empty_only_when_nobody_was_in_any_moment_of_it():
    rows = [{"state": "on", "last_changed": T0.isoformat()},
            {"state": "off", "last_changed": (T0 + timedelta(hours=2, minutes=30)).isoformat()},
            {"state": "on", "last_changed": (T0 + timedelta(hours=3, minutes=10)).isoformat()}]
    held = demand.hours_held(rows, T0, T0 + timedelta(hours=5))
    assert [held[T0 + timedelta(hours=h)] for h in range(5)] == ["empty", "empty", "occupied", "occupied", "empty"]
    assert demand.occupied_hours(rows, T0, T0 + timedelta(hours=5)) == pytest.approx(40 / 60)


# ------------------------------------------------------------------------------------------------ the alert desk
def test_its_has_not_run_alert_is_held_while_nobody_was_in_and_asked_once_people_were_in_long_enough(store):
    learned(store)
    last_run = T0 - timedelta(days=2)
    villa = Villa([last_run], [(T0 - timedelta(days=3), "on")])        # empty since before its last run
    res = desk.intake(store, overdue(), T0, client=villa, occupancy_reader=lambda: "empty")
    iid = res["incident_id"]
    # its number and its fault (on the tablet's Watch), nobody asked: no message of the desk's own
    assert res["decision"] == "held" and res["send"] == [] and {"action": "faults_changed"} in res["actions"]
    assert store.incident(iid)["state"] == Incident.HELD
    assert res["ha_messages"][0]["status"].startswith("Expected: Pump runs only when people are in, and nobody has been in")
    card = desk.Problems(store).card(store.last_task(f"incident:{iid}"))
    assert card["open"] and card["expected"] == res["ha_messages"][0]["status"]
    # never chased while held, whatever time passes
    assert desk.tick(store, T0 + timedelta(hours=5), client=villa)["send"] == []
    # people back for 4 h: still held, the words say so
    villa.empty.append((T0 + timedelta(hours=1), "off"))
    assert desk.tick(store, T0 + timedelta(hours=5), client=villa)["send"] == []
    assert "they have been in for 4h" in desk.Problems(store).card(store.last_task(f"incident:{iid}"))["expected"]
    # in for 6 h (its need) and still no run: an alert as any other, the facility manager asked
    res = desk.tick(store, T0 + timedelta(hours=7), client=villa)
    fm = [s for s in res["send"] if s["to"] == "fm"]
    assert fm and fm[0]["stage"] == "new" and fm[0]["status"] == "Still no run once people had been in for 6h"
    assert store.incident(iid)["state"] == Incident.ASKED
    assert desk.Problems(store).card(store.last_task(f"incident:{iid}"))["expected"] is None


def test_a_device_that_also_runs_while_empty_is_alerted_as_before(store):
    learned(store, follows=False)
    villa = Villa([T0 - timedelta(days=2)], [(T0 - timedelta(days=3), "on")])
    res = desk.intake(store, overdue(), T0, client=villa, occupancy_reader=lambda: "empty")
    assert res["decision"] == "new" and [s for s in res["send"] if s["to"] == "fm"]


def test_nothing_is_held_without_the_villas_history(store):
    learned(store)
    res = desk.intake(store, overdue(), T0, occupancy_reader=lambda: "empty")          # no client: cannot tell
    assert res["decision"] == "new"


def test_an_alert_already_chased_is_held_at_its_next_repeat_when_nobody_is_in(store):
    learned(store)
    villa = Villa([T0 - timedelta(days=2)], [(T0 - timedelta(days=3), "off")])       # people in all along
    iid = desk.intake(store, overdue(), T0, client=villa, occupancy_reader=lambda: "occupied")["incident_id"]
    assert store.incident(iid)["state"] == Incident.ASKED
    # they left; the next morning's repeat: people were in only ~1 h since its last run in this telling — held, the chase stops
    villa.runs = [T0 + timedelta(hours=23)]
    villa.empty = [(T0 + timedelta(hours=22), "off"), (T0 + timedelta(hours=23), "on")]
    res = desk.intake(store, overdue(T0 + timedelta(days=1)), T0 + timedelta(days=1), client=villa,
                      occupancy_reader=lambda: "empty")
    assert res["decision"] == "held" and res["send"] == [] and store.incident(iid)["state"] == Incident.HELD


# ------------------------------------------------------------------------------------------------ the night check
def test_the_night_check_does_not_call_an_empty_day_short_for_a_device_that_runs_only_with_people_in():
    import sys
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import rules
    from vesta_shared.params import VillaParams
    import yaml
    with open(os.path.join(STARTER_SKILLS, "preventive-maintenance", "settings.yaml"), encoding="utf-8") as fh:
        params = VillaParams(defaults=yaml.safe_load(fh)["behaviour"])
    day = date(2026, 11, 11)
    # it ran on one day of six: a device run now and then (the night check's "intermittent")
    series = {day - timedelta(days=i): {"run_hours": 0.5 if i == 3 else 0.0, "hours_with_data": 24} for i in range(1, 6)}
    asset = {"slug": "pump", "name": "Pump", "entities": {"power": PUMP}}
    from vesta_shared.timeutil import WEEKDAYS
    expected = {w: 0.5 for w in WEEKDAYS}
    series[day] = {"run_hours": 0.0, "hours_with_data": 24}
    found = rules.power_rules(asset, PUMP, series, day, params, expected, None, occupied={day: "empty"})
    assert [f.rule_id for f in found] == ["PM-EXPECTED-SILENT"]
    assert rules.power_rules(asset, PUMP, series, day, params, expected, None, occupied={day: "empty"},
                             follows=True) == []
    assert [f.rule_id for f in rules.power_rules(asset, PUMP, series, day, params, expected, None,
                                                 occupied={day: "occupied"}, follows=True)] == ["PM-EXPECTED-SILENT"]
