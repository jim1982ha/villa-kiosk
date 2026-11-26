"""A person's close keeps its kind's promise wherever it is pressed, and an alert's life is one answer (architecture
review, 2026-11-26: "Not a problem" was a yes/no flipped between six modules; the stage of an alert was worked out
from its notes in three). What the owner sees hangs on it: a Done is read again and watched, a "Not a problem" holds
while the problem lasts and quiets its Automation, a "No action needed" in the Cockpit says so (it was told "Done in
the Cockpit"). Pressed on Telegram, in the VESTA UI and in the Cockpit, through the desk and the faults as the engine
calls them. Invented entities."""
from __future__ import annotations

import importlib.util
import os
from datetime import datetime, timedelta, timezone

import pytest

from helpers import STARTER_SKILLS
from vesta_shared import alert_watch as W
from vesta_shared import message_format as mf
from vesta_shared.close_kind import DONE, NOT_A_PROBLEM, NOTHING
from vesta_shared.problems import NOT_A_PROBLEM as TASK_NOT_A_PROBLEM, Problems
from vesta_shared.store import Incident, Store

spec = importlib.util.spec_from_file_location("desk", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

T0 = datetime(2026, 11, 26, 9, 0, tzinfo=timezone.utc)
RULE = "automation.critical_condition_example_door"


def event(phase="opened", started=1790000000):
    return {"blueprint": "critical_condition", "rule_id": RULE, "incident_id": f"{RULE}-{started}", "phase": phase,
            "severity": "critical", "label": "Example door left unlocked", "entities": ["lock.example_door"],
            "summary": "Example door left unlocked", "timestamp": T0.isoformat()}


@pytest.fixture
def store(tmp_path):
    return Store(str(tmp_path / "store.sqlite"))


def opened(store) -> int:
    return desk.intake(store, event(), T0, occupancy_reader=lambda: "occupied")["incident_id"]


def quieted(res) -> bool:
    return any(isinstance(a, dict) and a.get("action") == "rule.quiet" for a in res["actions"])


@pytest.mark.parametrize("place", [mf.ON_TELEGRAM, mf.ON_TABLET])
@pytest.mark.parametrize("option, kind", [("done", DONE), ("not_a_problem", NOT_A_PROBLEM)])
def test_a_button_close_keeps_its_kinds_promise(store, place, option, kind):
    iid = opened(store)
    res = desk.reply(store, iid, option, "owner", T0 + timedelta(minutes=5), name="JM", place=place)
    inc = store.incident(iid)
    assert inc["reply"] == mf.done_in(place, "JM", kind)
    assert W.stage(inc, T0 + timedelta(minutes=6)) == (W.HELD if kind.holds else W.AWAITING_READ)
    assert (store.last_task(f"incident:{iid}")["status"] == TASK_NOT_A_PROBLEM) == kind.holds
    assert quieted(res) == kind.holds
    # its Automation repeats it: held, a line of its card; a Done's alert back within its watch opens again
    again = desk.intake(store, event(), T0 + timedelta(minutes=30), occupancy_reader=lambda: "occupied")
    assert (again["decision"] == "lasting") == kind.holds
    assert bool(store.incident(iid)["closed_at"]) == kind.holds


@pytest.mark.parametrize("kind", [DONE, NOTHING, NOT_A_PROBLEM])
def test_a_cockpit_close_keeps_its_kinds_promise(store, kind):
    iid = opened(store)
    task = store.last_task(f"incident:{iid}")["id"]
    at = (T0 + timedelta(minutes=5)).isoformat()
    assert Problems(store).closed_in_kiosk(task, "said", at=at, who="JM", kind=kind) == iid
    inc = store.incident(iid)
    # "No action needed in the Cockpit (JM)", never "Done in the Cockpit (JM)" for it
    assert inc["reply"] == mf.done_in(mf.IN_COCKPIT, "JM", kind)
    assert W.stage(inc, T0 + timedelta(minutes=6)) == (W.HELD if kind.holds else W.AWAITING_READ)
    assert (store.last_task(f"incident:{iid}")["status"] == TASK_NOT_A_PROBLEM) == kind.holds
    # told by the desk at its next look: a close that holds quiets its Automation, as on Telegram
    out = {"send": [], "actions": []}
    assert desk.cockpit_closes(store, out, desk.terms(), T0 + timedelta(minutes=6)) == [iid]
    assert quieted(out) == kind.holds


def test_an_alerts_life_from_open_to_over(store):
    t = W.terms(10, 1)
    iid = store.new_incident("k", RULE, "lock.example_door", "P2", {"claim": "x"}, T0.isoformat())
    W.carry(store, iid, t)
    assert W.stage(store.incident(iid), T0) == W.OPEN_NOW
    W.clearing(store, store.incident(iid), T0 + timedelta(minutes=1), 10)
    assert W.stage(store.incident(iid), T0) == W.CLEARING and W.closes_at(store.incident(iid))
    W.holds(store, iid)
    assert W.stage(store.incident(iid), T0) == W.OPEN_NOW and W.closes_at(store.incident(iid)) is None
    W.close(store, iid, Incident.DONE, T0.isoformat(), by=DONE, person="Done (JM)")
    assert W.stage(store.incident(iid), T0) == W.AWAITING_READ and W.watch_decided(store.incident(iid))
    assert W.read_again(store, store.incident(iid)) == "Done (JM)"
    watched = store.incident(iid)
    assert W.stage(watched, T0 + timedelta(minutes=30)) == W.WATCHED
    W.told_over(store, watched)
    assert W.stage(store.incident(iid), T0 + timedelta(hours=2)) == W.OVER


def test_not_a_problem_holds_until_its_all_clear_and_is_never_watched(store):
    iid = store.new_incident("k", RULE, "lock.example_door", "P2", {"claim": "x"}, T0.isoformat())
    W.carry(store, iid, W.terms(10, 4))
    W.close(store, iid, Incident.DONE, T0.isoformat(), by=NOT_A_PROBLEM)
    assert W.stage(store.incident(iid), T0 + timedelta(hours=1)) == W.HELD
    assert W.until(store.incident(iid)) is None                       # no watch, ever
    W.lasted(store, store.incident(iid))                               # the villa's all-clear for it
    assert W.stage(store.incident(iid), T0 + timedelta(hours=1)) == W.OVER
