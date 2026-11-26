"""An alert's standing, one answer to "is this the same problem as before?" (vesta_shared.alert_watch.standing;
architecture review, 2026-11-20). What the owner sees hangs on it: a repeat of an alert he closed "Not a problem" stays
quiet, an alert back within its watch is "Back" under its own number, one after it is a new number, the villa's late
all-clear says the close again. A table at the module's interface: a plain store, the closes and reopenings the alert
desk and the Cockpit make, then the verdict for the alert's next event. Invented entities."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from vesta_shared import alert_watch as W
from vesta_shared.close_kind import DONE, NOT_A_PROBLEM
from vesta_shared.problems import Problems
from vesta_shared.store import Incident, Store

T0 = datetime(2026, 11, 20, 1, 0, tzinfo=timezone.utc)
RULE, DOOR = "automation.example_door", "lock.example_door"
#: the desk's settings: back within 4h reopens it, a person's close read again after 10 minutes
TERMS = W.terms(10, 4)


def event(phase="opened", run=1, **extra) -> dict:
    """The villa's event for the door's alert, as the desk reads it (normalised); `run`: Home Assistant's run of it."""
    return {"phase": phase, "rule_id": RULE, "entity_id": DOOR, "ha_incident": f"{RULE}-{run}", **extra}


def opened(store: Store, at=T0, run=1) -> int:
    """The door's alert opened at `at` (its notes as the desk writes them: its run, its states, the desk's terms)."""
    ev = event(run=run)
    iid = store.new_incident(W.keys(ev)[0], RULE, DOOR, "P2",
                             {"ha_incident": ev["ha_incident"], "mode": "state", "bad_states": ["unlocked"],
                              "message": "Door unlocked"}, at.isoformat())
    W.carry(store, iid, TERMS)
    return iid


def not_a_problem(store: Store, iid: int, at=T0) -> None:
    W.close(store, iid, Incident.DONE, at.isoformat(), by=NOT_A_PROBLEM, reply="Not a problem on Telegram (JM)")


def done(store: Store, iid: int, at=T0) -> None:
    W.close(store, iid, Incident.DONE, at.isoformat(), by=DONE, person="Done (JM)", reply="Done on Telegram (JM)")


def cleared(store: Store, iid: int, at=T0) -> None:
    W.close(store, iid, Incident.RESOLVED, at.isoformat())


def verdict(store: Store, ev: dict, at) -> tuple[str, int | None]:
    st = W.standing(store, ev, at)
    return st.verdict, st.incident and st.incident["id"]


# ------------------------------------------------------------------------------------------------------ the table
def test_nothing_known_is_new_and_an_open_alert_carries_on(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    assert verdict(store, event(), T0) == (W.NEW, None)
    iid = opened(store)
    assert verdict(store, event(), T0 + timedelta(minutes=30)) == (W.OPEN, iid)
    # its all-clear finds it by its run, and by its alert after Home Assistant restarted (another run id)
    assert verdict(store, event("resolved"), T0 + timedelta(hours=1)) == (W.OPEN, iid)
    assert verdict(store, event("resolved", run=2), T0 + timedelta(hours=1)) == (W.OPEN, iid)


@pytest.mark.parametrize("later, why", [
    (timedelta(minutes=30), "inside its 4h watch"),
    (timedelta(hours=5), "after its watch"),
    (timedelta(hours=23), "a repeat a day on"),
])
def test_not_a_problem_holds_while_the_problem_lasts(tmp_path, later, why):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = opened(store)
    not_a_problem(store, iid, T0)
    # the rule repeats it, even under a new run after a restart: recorded, never Back, never a new number
    assert verdict(store, event(), T0 + later) == (W.LASTING, iid), why
    assert verdict(store, event(run=2), T0 + later) == (W.LASTING, iid), why


def test_not_a_problem_lasts_from_its_latest_repeat_and_ends_a_day_silent(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = opened(store)
    not_a_problem(store, iid, T0)
    W.lasted_again(store, store.incident(iid), T0 + timedelta(hours=20))       # repeated: it still lasts
    assert verdict(store, event(), T0 + timedelta(hours=40)) == (W.LASTING, iid)
    # a day without a repeat (its rule gave up, or was renamed): the next alert is a new number again
    assert verdict(store, event(), T0 + timedelta(hours=44, minutes=1)) == (W.NEW, None)


def test_the_villas_all_clear_ends_not_a_problem_and_says_the_close_again(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = opened(store)
    not_a_problem(store, iid, T0)
    st = W.standing(store, event("resolved"), T0 + timedelta(hours=1))
    assert (st.verdict, st.incident["id"], st.ends["id"]) == (W.LATE, iid, iid)
    W.lasted(store, st.ends)
    # after it, the problem is over: "Not a problem" closed with no watch (owner, 2026-11-21, #210), back is a new number
    assert verdict(store, event(run=2), T0 + timedelta(hours=2)) == (W.NEW, None)
    assert verdict(store, event(run=2), T0 + timedelta(hours=5)) == (W.NEW, None)
    # an all-clear after a restart (another run): no close to say again, the problem still ends
    store2 = Store(str(tmp_path / "t.sqlite"))
    other = opened(store2)
    not_a_problem(store2, other, T0)
    st = W.standing(store2, event("resolved", run=2), T0 + timedelta(hours=1))
    assert (st.verdict, st.incident, st.ends["id"]) == (W.NEW, None, other)


def test_a_rule_giving_up_ends_it_only_when_back_to_normal(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = opened(store)
    not_a_problem(store, iid, T0)
    still = W.standing(store, event("abandoned", still_true="true"), T0 + timedelta(minutes=30))
    normal = W.standing(store, event("abandoned", still_true="false"), T0 + timedelta(minutes=30))
    assert (still.verdict, still.ends) == (W.LATE, None)
    assert (normal.verdict, normal.ends["id"]) == (W.LATE, iid)


def test_a_late_all_clear_is_matched_for_a_day_only(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = opened(store)
    cleared(store, iid, T0)
    assert verdict(store, event("resolved"), T0 + timedelta(hours=23)) == (W.LATE, iid)
    assert verdict(store, event("resolved"), T0 + timedelta(hours=25)) == (W.NEW, None)


def test_a_cleared_alert_is_back_within_its_watch_and_new_after(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = opened(store)
    cleared(store, iid, T0)
    assert verdict(store, event(run=2), T0 + timedelta(hours=3, minutes=59)) == (W.BACK, iid)
    assert verdict(store, event(run=2), T0 + timedelta(hours=4, minutes=1)) == (W.NEW, None)
    # back, it opens again under its own number: its next repeat carries on
    W.came_back(store, iid, event(run=2), (T0 + timedelta(hours=1)).isoformat())
    assert verdict(store, event(run=2), T0 + timedelta(hours=1, minutes=5)) == (W.OPEN, iid)


def test_a_done_on_a_problem_still_there_reopens(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = opened(store)
    done(store, iid, T0)
    # its rule alerts again within the watch: Back, under its own number
    assert verdict(store, event(run=2), T0 + timedelta(minutes=5)) == (W.BACK, iid)
    # read again after its wait, still unlocked: the same run open again, the desk watching it (no all-clear will come)
    inc = store.incident(iid)
    assert [i["id"] for i in W.awaiting(store)] == [iid]
    assert not W.read_due(inc, T0 + timedelta(minutes=9), 10) and W.read_due(inc, T0 + timedelta(minutes=10), 10)
    assert W.read_again(store, inc) == "Done (JM)" and W.read_again(store, inc) is None     # read once
    W.not_over(store, iid)
    assert verdict(store, event(), T0 + timedelta(minutes=11)) == (W.OPEN, iid)
    assert W.awaiting(store) == []


def test_a_cockpit_reopen_ends_not_a_problem(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)
    iid = opened(store)
    task, _ = pb.reopen_task("incident", iid, RULE, DOOR, "Door unlocked")
    pb.close_incident(iid, Incident.DONE, T0.isoformat(), "Not a problem on Telegram (JM).", by=NOT_A_PROBLEM, terms=TERMS)
    assert verdict(store, event(), T0 + timedelta(minutes=5)) == (W.LASTING, iid)
    # a person reopens its fault in the Cockpit: open again, the problem no longer accepted
    assert pb.reopened_in_kiosk(task, by="JM") == iid
    assert verdict(store, event(), T0 + timedelta(minutes=10)) == (W.OPEN, iid)
    cleared(store, iid, T0 + timedelta(minutes=20))
    assert verdict(store, event(run=2), T0 + timedelta(minutes=30)) == (W.BACK, iid)       # never quietly lasting


def test_an_alert_found_under_its_old_name_is_filed_under_its_permanent_number(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = opened(store)                                   # filed by name: its rule sent no permanent number then
    ev = event(rule_uid="1700000000001")                  # its rule now sends one
    st = W.standing(store, ev, T0 + timedelta(minutes=5))
    assert (st.verdict, st.incident["id"]) == (W.OPEN, iid)
    assert W.file(store, st, ev)["key"] == W.keys(ev)[0]
    # then renamed: found by its number, its rule's name brought up to date — the same alert, never a second one
    ev = event(rule_uid="1700000000001", rule_id="automation.example_door_renamed")
    st = W.standing(store, ev, T0 + timedelta(minutes=10))
    assert (st.verdict, st.incident["id"]) == (W.OPEN, iid)
    assert W.file(store, st, ev)["rule_id"] == "automation.example_door_renamed"


def test_moments_in_the_villas_zone_compare_as_moments(tmp_path):
    # the villa writes some moments in its own zone: a close at 09:00+08:00 is 01:00 UTC, its watch until 05:00 UTC
    store = Store(str(tmp_path / "s.sqlite"))
    iid = opened(store)
    W.close(store, iid, Incident.RESOLVED, "2026-11-20T09:00:00+08:00")
    assert W.until(store.incident(iid)) == T0 + timedelta(hours=4)
    assert verdict(store, event(run=2), T0 + timedelta(hours=3, minutes=59)) == (W.BACK, iid)
    assert verdict(store, event("resolved"), T0 + timedelta(hours=1)) == (W.LATE, iid)
