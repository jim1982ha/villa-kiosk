"""What a person presses on a fault's card in the VESTA Kiosk reaches VESTA as that press, once, in the order it was
made (architecture review round 14, card 3: the card was read as the latest of each kind, and what was new guessed from
times). Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from kiosk_fake import FakeKiosk
from vesta_agent.kiosk import fault_of
from vesta_agent.tickets import PRESSES, Tickets
from vesta_shared.problems import Problems
from vesta_shared.store import Incident, Store


def run(c):
    return asyncio.run(c)


class _State:
    def log(self, *_a, **_k):
        pass


def villa(tmp_path):
    k = FakeKiosk()
    path = str(tmp_path / "agent.db")
    t = Tickets(kiosk=k, state=_State(), store_path=path, timezone="UTC")
    st = Store(path)
    asked = datetime.now(timezone.utc) - timedelta(minutes=5)
    iid = st.new_incident("k", "watchdog", "lock.example_door", "P2", {"message": "Door unavailable"}, asked.isoformat())
    st.update_incident(iid, state=Incident.ASKED, asked_at=asked.isoformat(), assignee="fm")
    tid, _ = Problems(st).open_task("incident", iid, "watchdog", "lock.example_door", "Door unavailable")
    uid = run(t.create("Door unavailable", "lock.example_door", None, tid))
    return k, t, st, iid, tid, uid


def test_a_close_and_a_reopening_between_two_reads_are_both_taken_in(tmp_path):
    k, t, st, iid, tid, uid = villa(tmp_path)
    now = datetime.now(timezone.utc)
    k.person_closes(uid, by="Facility manager", at=(now + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"))
    k.person_reopens(uid, by="Owner", at=(now + timedelta(minutes=2)).isoformat().replace("+00:00", "Z"))
    # the close closed its alert (handed to the desk, which tells it), then the reopening opened the task again and
    # told the desk
    assert run(t.repair())["handed"] == 1
    assert st.task(tid)["status"] == "open" and st.task(tid)["reopened_by"] == "Owner"
    assert st.incident(iid)["state"] == Incident.ASKED and st.incident(iid)["closed_at"] is None
    assert run(t.repair())["handed"] == 0, "each press is taken in once"


def test_a_press_already_taken_in_is_never_taken_in_again(tmp_path):
    k, t, st, iid, tid, uid = villa(tmp_path)
    k.person_closes(uid, by="Facility manager", at=(datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat())
    assert run(t.repair())["handed"] == 1 and st.task(tid)["status"] != "open"
    mark = st.cache_get(PRESSES)[uid]
    assert run(t.repair())["handed"] == 0 and run(t.repair())["handed"] == 0
    assert st.cache_get(PRESSES)[uid] == mark


def test_two_presses_of_one_moment_are_two_presses():
    at = "2026-10-01T08:00:00.000Z"
    t = {"id": "va-1", "title": "x", "status": "resolved", "updates": [
        {"at": at, "status": "open", "by": "Owner", "kind": "help"},
        {"at": at, "status": "resolved", "by": "Owner", "kind": "cleared"}]}
    assert [g["kind"] for g in fault_of(t)["gestures"]] == ["help", "close"]
