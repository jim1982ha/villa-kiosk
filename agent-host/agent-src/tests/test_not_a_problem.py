"""What the owner knows better than the checks (owner, 2026-11-02): a pump stopped on purpose was "ran shorter than
expected" every night, and a close came back as "still there".

1. A schedule nobody uses sets no expectation: the night check judges run hours only while an automation using the
   schedule is switched on (nightly.schedule_unused).
2. "Not a problem while it lasts": a close in the Kiosk that holds while the problem lasts, never read again; the
   problem back after it ended is a new occurrence. Synthetic data only."""
from __future__ import annotations

import importlib.util
import os
import sys
from datetime import datetime, timedelta, timezone

from ha_fake import FakeHA
from helpers import STARTER_SKILLS
from vesta_agent import kiosk
from vesta_shared import alert_watch
from vesta_shared.problems import CLOSED_IN_KIOSK, NOT_A_PROBLEM, Problems
from vesta_shared.store import Store

sys.path.insert(0, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
_spec = importlib.util.spec_from_file_location("nightly_nap", os.path.join(STARTER_SKILLS, "preventive-maintenance",
                                                                          "scripts", "nightly.py"))
N = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(N)

SCHEDULE = "schedule.example_pump_expected_runtime"


def user(eid: str, kind: str = "automation", names: str = SCHEDULE) -> dict:
    return {"entity_id": eid, "kind": kind, "config": {"triggers": [{"trigger": "state", "entity_id": names}]}}


def villa(rules, **states) -> FakeHA:
    return FakeHA(rules=rules, states={k: {"entity_id": k, "state": v} for k, v in states.items()})


# ---------------------------------------------------------------------- 1 · the schedule's users
def test_a_schedule_whose_only_automation_is_off_sets_no_expectation():
    cli = villa([user("automation.example_pump_daily")], **{"automation.example_pump_daily": "off"})
    assert N.schedule_unused(cli, SCHEDULE) == ["automation.example_pump_daily"]


def test_one_automation_on_keeps_the_check():
    cli = villa([user("automation.a"), user("automation.b")], **{"automation.a": "off", "automation.b": "on"})
    assert N.schedule_unused(cli, SCHEDULE) is None


def test_no_user_a_script_or_an_unknown_state_keeps_the_check():
    assert N.schedule_unused(villa([]), SCHEDULE) is None                                      # its own timer
    assert N.schedule_unused(villa([user("script.x", "script")]), SCHEDULE) is None             # runs when called
    assert N.schedule_unused(villa([user("automation.a")]), SCHEDULE) is None                  # state not read


def test_a_longer_id_is_not_the_schedule():
    cli = villa([user("automation.a", names=SCHEDULE + "_2")], **{"automation.a": "off"})
    assert N.schedule_unused(cli, SCHEDULE) is None


# ---------------------------------------------------------------------- 2 · not a problem while it lasts
def _finding(pb: Problems):
    fid, _ = pb.store.raise_finding("PM-RUNHOURS", "sensor.example_pump_power", "power", "2026-11-01", "P3",
                                    "Example pump ran shorter than expected", {})
    tid, _ = pb.open_task("finding", fid, "PM-RUNHOURS", "sensor.example_pump_power", "Example pump ran shorter")
    return fid, tid


def test_a_close_that_lasts_is_never_read_again_still_there(tmp_path):
    pb = Problems(Store(str(tmp_path / "s.sqlite")))
    fid, tid = _finding(pb)
    pb.closed_in_kiosk(tid, lasting=True)
    assert pb.store.task(tid)["status"] == NOT_A_PROBLEM
    later = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    pb.seen(fid, later, 60)                                        # read still bad well past the settle time
    assert not pb.wants_open(f"finding:{fid}") and pb.store.task(tid)["status"] == NOT_A_PROBLEM
    assert pb.confirms_by(pb.store.task(tid), next_night=lambda d: d + timedelta(hours=8)) is None   # straight to Closed


def test_a_plain_close_still_reopens_still_there(tmp_path):
    pb = Problems(Store(str(tmp_path / "s.sqlite")))
    fid, tid = _finding(pb)
    pb.closed_in_kiosk(tid)
    assert pb.store.task(tid)["status"] == CLOSED_IN_KIOSK
    pb.seen(fid, (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(), 60)
    assert pb.wants_open(f"finding:{fid}")


def test_an_alert_closed_as_not_a_problem_is_not_read_again(tmp_path):
    pb = Problems(Store(str(tmp_path / "s.sqlite")))
    iid = pb.store.new_incident("k", "automation.example_door", "lock.example_door", "P2", {"message": "Door open"})
    pb.store.update_incident(iid, state="asked")
    tid, _ = pb.open_task("incident", iid, "automation.example_door", "lock.example_door", "Door open")
    assert pb.closed_in_kiosk(tid, lasting=True) == iid
    assert pb.store.task(tid)["status"] == NOT_A_PROBLEM and not alert_watch.awaiting_read(pb.store.incident(iid))
    other = pb.store.new_incident("k2", "automation.example_gate", "lock.example_gate", "P2", {"message": "Gate open"})
    pb.store.update_incident(other, state="asked")
    t2, _ = pb.open_task("incident", other, "automation.example_gate", "lock.example_gate", "Gate open")
    pb.closed_in_kiosk(t2)
    assert alert_watch.awaiting_read(pb.store.incident(other))     # a plain close is read again, as before


def test_the_kiosk_close_says_it_lasts():
    step = {"at": "2026-11-02T10:00:00Z", "status": "resolved", "by": "Owner", "kind": "cleared", "lasting": True}
    held = kiosk.fault_of({"id": "va-1", "title": "x", "status": "resolved", "resolvedAt": step["at"], "updates": [step]})
    plain = kiosk.fault_of({"id": "va-2", "title": "x", "status": "resolved", "resolvedAt": step["at"],
                            "updates": [{**step, "lasting": None}]})
    assert [g["lasting"] for g in held["gestures"]] == [True] and [g["lasting"] for g in plain["gestures"]] == [False]
