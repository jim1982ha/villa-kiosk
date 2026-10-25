"""A fault being confirmed (owner, 2026-10-23): "keep the Fault card visible in the Cockpit when a fault is still being
monitored … until VESTA finally closes it". A person closes an alert's fault — Done on Telegram, Close in the Cockpit —
and the alert desk reads it again after its clear_minutes (quiet_after_done). Meanwhile the Kiosk fault is resolved, as
ever, and carries `confirmsBy` (agent-contract.json ticket.fields): the moment the desk reads it again, counted from the
close. The desk's verdict: right — the fault stays resolved; still bad — it opens again; cannot tell — it stays resolved.
⚠️ EVERY CLOSE ALIKE (owner, 2026-10-25): any closed fault is watched until it can no longer come back as the same problem
— an alert's close plus the longer of the desk's wait and its reopen window (desk.watch_minutes), whoever closed it; a
night-check fault until the night check's next run. Driven through the desk, Problems and the real Kiosk class over the
fake transport. Synthetic villa."""
from __future__ import annotations

import asyncio
import importlib.util
import os
from datetime import datetime, timedelta, timezone

from helpers import STARTER_SKILLS, make_agent
from kiosk_fake import FakeKiosk
from villa_timeline import TimelineVilla
from vesta_shared.problems import Problems
from vesta_shared.store import Store

spec = importlib.util.spec_from_file_location("desk_confirm", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

FM = 222
WAIT = desk.DEFAULTS["clear_minutes"]                   # the desk's read-again wait (rules.yaml behaviour), never a copy
WATCH = desk.watch_minutes(WAIT, desk.DEFAULTS["reopen_hours"])   # how long any closed alert is watched


def run(c):
    return asyncio.run(c)


def villa(agent_kiosk=None, tmp_path=None):
    k = agent_kiosk or FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    return v, k, Store(v.s.store_path)


def door(store, now):
    """An alert on a door left unlocked; the desk's tick carries what it says (its check, its watch) as every 5 minutes."""
    ev = {"blueprint": "critical_condition", "rule_id": "automation.door", "incident_id": "automation.door-1",
          "phase": "opened", "severity": "critical", "label": "Door", "entities": ["lock.door"], "summary": "Door unlocked",
          "mode": "state", "bad_states": ["unlocked"]}
    return desk.intake(store, ev, now, occupancy_reader=lambda: "x")["incident_id"]


def the_fault(k):
    (tid,) = k._kept()
    return k.ticket(tid)


def moment(iso):
    return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))


def test_the_watch_lasts_as_long_as_the_closing_line_says():
    # "Watch 1h" on Telegram is the reopen window: the Cockpit watches it as long, and never less than the desk's wait
    assert WATCH == max(WAIT, desk.DEFAULTS["reopen_hours"] * 60) and desk.DEFAULTS["reopen_hours"] * 60 > WAIT


def test_a_done_leaves_the_fault_resolved_and_being_confirmed_until_the_watch_ends_right(tmp_path):
    v, k, st = villa(tmp_path=tmp_path)
    now = datetime.now(timezone.utc)
    iid = door(st, now)
    run(v.tickets.repair())                                              # its Kiosk fault
    desk.reply(st, iid, "done", "fm", now, name="JM")
    run(v.tickets.repair())
    t = the_fault(k)
    assert t["status"] == "resolved" and moment(t["confirmsBy"]) == now + timedelta(minutes=WATCH), t
    # read again: the door locked — confirmed, the fault still resolved, and still watched until it can no longer reopen
    out = desk.tick(st, now + timedelta(minutes=WAIT + 1),
                    client=TimelineVilla(**{"lock.door": ("locked", now - timedelta(minutes=1))}))
    assert {"action": "faults_changed"} in out["actions"]
    run(v.tickets.repair())
    t = the_fault(k)
    assert t["status"] == "resolved" and moment(t["confirmsBy"]) == now + timedelta(minutes=WATCH), t
    # the watch over: the field goes
    (task,) = st.tasks(None)
    assert Problems(st).confirms_by(task, now=now + timedelta(minutes=WATCH, seconds=1)) is None


def test_a_done_on_a_door_still_unlocked_opens_the_fault_again_without_the_field(tmp_path):
    v, k, st = villa(tmp_path=tmp_path)
    now = datetime.now(timezone.utc)
    iid = door(st, now)
    run(v.tickets.repair())
    desk.reply(st, iid, "done", "fm", now, name="JM")
    run(v.tickets.repair())
    assert "confirmsBy" in the_fault(k)
    # the Done was WATCH minutes ago: the store stamps the reopening with the clock, so the close is dated before it as it
    # would be (within one second, a close and a reopening at the same moment read as a person's close in the Kiosk)
    t = the_fault(k)
    t["resolvedAt"] = t["updates"][-1]["at"] = (now - timedelta(minutes=WAIT + 1)).isoformat(timespec="seconds")
    desk.tick(st, now + timedelta(minutes=WAIT + 1), client=TimelineVilla(**{"lock.door": ("unlocked", now - timedelta(hours=1))}))
    run(v.tickets.repair())
    t = the_fault(k)
    assert t["status"] == "open" and "confirmsBy" not in t, t


def test_a_watch_that_cannot_tell_leaves_the_fault_resolved_and_watched(tmp_path):
    v, k, st = villa(tmp_path=tmp_path)
    now = datetime.now(timezone.utc)
    iid = door(st, now)
    run(v.tickets.repair())
    desk.reply(st, iid, "done", "fm", now, name="JM")
    run(v.tickets.repair())
    out = desk.tick(st, now + timedelta(minutes=WAIT + 1), client=TimelineVilla(**{"lock.door": ("unavailable", now)}))
    assert any(s.get("mark") == "unchecked" for s in out["send"]), out["send"]     # "VESTA cannot check this one"
    run(v.tickets.repair())
    t = the_fault(k)
    assert t["status"] == "resolved" and moment(t["confirmsBy"]) == now + timedelta(minutes=WATCH), t


def test_a_close_in_the_cockpit_is_watched_too_from_the_moment_the_person_closed_it(tmp_path):
    # the Cockpit's Close is "no action needed" (kind cleared, by the profile): a PERSON's close, never the agent's own
    # clearing — taken in, its alert watched as a Done is
    v, k, st = villa(tmp_path=tmp_path)
    now = datetime.now(timezone.utc)
    iid = door(st, now)
    desk.tick(st, now, client=TimelineVilla(**{"lock.door": ("unlocked", now - timedelta(hours=1))}))
    run(v.tickets.repair())
    closed = (now - timedelta(minutes=2)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    (tid,) = k._kept()
    k.person_closes(tid, by="Owner", at=closed, cockpit=True)          # {kind: "cleared", by: "Owner"}
    run(v.tickets.repair())
    (task,) = st.tasks(None)
    assert task["status"] == "closed_in_kiosk" and st.incident(iid)["closed_at"], task
    t = the_fault(k)
    assert t["status"] == "resolved" and moment(t["confirmsBy"]) == moment(closed) + timedelta(minutes=WATCH), t
    assert not k.reopened                                                # never reopened as if nobody had closed it
    # read again WAIT minutes after the person's close, not after the agent noticed it
    out = desk.tick(st, moment(closed) + timedelta(minutes=WAIT, seconds=1),
                    client=TimelineVilla(**{"lock.door": ("locked", now)}))
    assert {"action": "faults_changed"} in out["actions"]
    run(v.tickets.repair())
    assert the_fault(k)["status"] == "resolved" and moment(the_fault(k)["confirmsBy"]) == moment(closed) + timedelta(minutes=WATCH)


def test_a_kiosk_that_does_not_read_the_field_never_gets_it(tmp_path):
    k = FakeKiosk()
    k.info["ticket_fields"] = [f for f in k.info["ticket_fields"] if f != "confirmsBy"]     # a Kiosk before 2.496.503
    v, k, st = villa(k, tmp_path)
    now = datetime.now(timezone.utc)
    iid = door(st, now)
    run(v.tickets.repair())
    desk.reply(st, iid, "done", "fm", now, name="JM")
    run(v.tickets.repair())
    t = the_fault(k)
    assert t["status"] == "resolved" and "confirmsBy" not in t, t       # resolved, exactly as before


def test_a_close_in_the_cockpit_before_the_desk_said_its_watch_gets_the_field_at_its_next_tick(tmp_path):
    # closed before any tick carried the desk's wait (an alert a minute old): the desk's next tick carries it, and the
    # fault then says when it is confirmed — still counted from the person's close
    v, k, st = villa(tmp_path=tmp_path)
    now = datetime.now(timezone.utc)
    door(st, now)
    run(v.tickets.repair())
    closed = (now - timedelta(minutes=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    (tid,) = k._kept()
    k.person_closes(tid, by="Owner", at=closed, cockpit=True)
    run(v.tickets.repair())
    assert "confirmsBy" not in the_fault(k)                              # the agent cannot know the desk's wait
    out = desk.tick(st, now + timedelta(minutes=1), client=TimelineVilla(**{"lock.door": ("locked", now)}))
    assert {"action": "faults_changed"} in out["actions"]
    run(v.tickets.repair())
    assert moment(the_fault(k)["confirmsBy"]) == moment(closed) + timedelta(minutes=WATCH)


def test_a_watched_fault_a_person_reopens_in_the_kiosk_is_no_longer_being_confirmed(tmp_path):
    v, k, st = villa(tmp_path=tmp_path)
    now = datetime.now(timezone.utc)
    iid = door(st, now)
    run(v.tickets.repair())
    desk.reply(st, iid, "done", "fm", now, name="JM")
    run(v.tickets.repair())
    (tid,) = k._kept()
    k.person_reopens(tid, by="Owner")                                    # the Kiosk's "Reopen fault" keeps every field
    assert "confirmsBy" in the_fault(k)
    run(v.tickets.repair())
    t = the_fault(k)
    assert t["status"] == "open" and "confirmsBy" not in t, t


def test_an_alert_the_villa_clears_is_watched_as_a_persons_close_is(tmp_path):
    # the owner, 2026-10-25: "it shall consistently exist for all cleared faults" — #84 cleared itself, "Watch 1h" on
    # Telegram, and its fault left the Cockpit at once
    v, k, st = villa(tmp_path=tmp_path)
    now = datetime.now(timezone.utc)
    iid = door(st, now)
    run(v.tickets.repair())
    desk.intake(st, {"blueprint": "critical_condition", "rule_id": "automation.door", "incident_id": "automation.door-1",
                     "phase": "resolved", "severity": "critical", "label": "Door", "entities": ["lock.door"]}, now,
                occupancy_reader=lambda: "x")
    run(v.tickets.repair())
    t = the_fault(k)
    closed = moment(st.incident(iid)["closed_at"])
    assert t["status"] == "resolved" and moment(t["confirmsBy"]) == closed + timedelta(minutes=WATCH), t


def test_an_alert_whose_automation_is_gone_is_not_watched(tmp_path):
    # an end that cannot come back: its close takes any watch away (desk._close without one)
    v, k, st = villa(tmp_path=tmp_path)
    now = datetime.now(timezone.utc)
    iid = door(st, now)
    desk.carry_watch(st, iid, WATCH)
    out = {"send": [], "actions": []}
    desk._close(st, st.incident(iid), now, out, "Closed.")
    (task,) = st.tasks(None)
    assert Problems(st).confirms_by(task, now=now) is None


def test_a_night_check_fault_is_watched_until_the_night_checks_next_run(tmp_path):
    # the owner, 2026-10-25: a night-check fault the same card, until the night check reads it again
    v, k, st = villa(tmp_path=tmp_path)
    p = Problems(st)
    task = {"id": 1, "source": "finding:7", "status": "cleared", "done_at": "2026-10-25T07:50:00+00:00"}
    st.last_task = lambda source: task                          # the last task of its finding: itself
    night = lambda after: datetime(2026, 10, 26, 2, 0, tzinfo=timezone.utc)
    assert p.confirms_by(task, night, now=datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)) == "2026-10-26T02:00:00+00:00"
    assert p.confirms_by(task, night, now=datetime(2026, 10, 26, 2, 1, tzinfo=timezone.utc)) is None
    assert p.confirms_by(task, None, now=datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)) is None   # no night check
    assert p.confirms_by(dict(task, status="open"), night, now=datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)) is None


def test_the_night_checks_next_run_is_read_from_its_schedule():
    from vesta_agent.scheduler import next_slot
    at = datetime(2026, 10, 25, 15, 50)
    assert next_slot("02:00", at) == datetime(2026, 10, 26, 2, 0)                 # daily: the next night
    assert next_slot("02:00", datetime(2026, 10, 25, 1, 0)) == datetime(2026, 10, 25, 2, 0)
    assert next_slot("Mon 08:00", at) == datetime(2026, 10, 26, 8, 0)             # 25/10/2026 is a Sunday
    assert next_slot("1 08:00", at) == datetime(2026, 11, 1, 8, 0)
