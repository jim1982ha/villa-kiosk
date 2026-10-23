"""A fault being confirmed (owner, 2026-10-23): "keep the Fault card visible in the Cockpit when a fault is still being
monitored … until VESTA finally closes it". A person closes an alert's fault — Done on Telegram, Close in the Cockpit —
and the alert desk reads it again after its clear_minutes (quiet_after_done). Meanwhile the Kiosk fault is resolved, as
ever, and carries `confirmsBy` (agent-contract.json ticket.fields): the moment the desk reads it again, counted from the
close. The desk's verdict takes it away: right — the fault stays resolved; still bad — it opens again; cannot tell — it
stays resolved. Driven through the desk, Problems and the real Kiosk class over the fake transport. Synthetic villa."""
from __future__ import annotations

import asyncio
import importlib.util
import os
from datetime import datetime, timedelta, timezone

from helpers import STARTER_SKILLS, make_agent
from kiosk_fake import FakeKiosk
from villa_timeline import TimelineVilla
from vesta_shared.store import Store

spec = importlib.util.spec_from_file_location("desk_confirm", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

FM = 222
WATCH = desk.DEFAULTS["clear_minutes"]                  # the desk's own wait (rules.yaml behaviour), never a copy


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


def test_a_done_leaves_the_fault_resolved_and_being_confirmed_until_the_watch_ends_right(tmp_path):
    v, k, st = villa(tmp_path=tmp_path)
    now = datetime.now(timezone.utc)
    iid = door(st, now)
    run(v.tickets.repair())                                              # its Kiosk fault
    desk.reply(st, iid, "done", "fm", now, name="JM")
    run(v.tickets.repair())
    t = the_fault(k)
    assert t["status"] == "resolved" and moment(t["confirmsBy"]) == now + timedelta(minutes=WATCH), t
    # the watch ends: the door locked — confirmed, the field taken away, the fault still resolved
    out = desk.tick(st, now + timedelta(minutes=WATCH + 1),
                    client=TimelineVilla(**{"lock.door": ("locked", now - timedelta(minutes=1))}))
    assert {"action": "faults_changed"} in out["actions"]               # the repair runs: the field goes now
    run(v.tickets.repair())
    t = the_fault(k)
    assert t["status"] == "resolved" and "confirmsBy" not in t, t


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
    t["resolvedAt"] = t["updates"][-1]["at"] = (now - timedelta(minutes=WATCH + 1)).isoformat(timespec="seconds")
    desk.tick(st, now + timedelta(minutes=WATCH + 1), client=TimelineVilla(**{"lock.door": ("unlocked", now - timedelta(hours=1))}))
    run(v.tickets.repair())
    t = the_fault(k)
    assert t["status"] == "open" and "confirmsBy" not in t, t


def test_a_watch_that_cannot_tell_leaves_the_fault_resolved_without_the_field(tmp_path):
    v, k, st = villa(tmp_path=tmp_path)
    now = datetime.now(timezone.utc)
    iid = door(st, now)
    run(v.tickets.repair())
    desk.reply(st, iid, "done", "fm", now, name="JM")
    run(v.tickets.repair())
    out = desk.tick(st, now + timedelta(minutes=WATCH + 1), client=TimelineVilla(**{"lock.door": ("unavailable", now)}))
    assert any(s.get("mark") == "unchecked" for s in out["send"]), out["send"]     # "VESTA cannot check this one"
    run(v.tickets.repair())
    t = the_fault(k)
    assert t["status"] == "resolved" and "confirmsBy" not in t, t


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
    # read again WATCH minutes after the person's close, not after the agent noticed it
    out = desk.tick(st, moment(closed) + timedelta(minutes=WATCH, seconds=1),
                    client=TimelineVilla(**{"lock.door": ("locked", now)}))
    assert {"action": "faults_changed"} in out["actions"]
    run(v.tickets.repair())
    assert "confirmsBy" not in the_fault(k) and the_fault(k)["status"] == "resolved"


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
