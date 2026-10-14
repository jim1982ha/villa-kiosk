"""A fault's card is worked out from its task (architecture review, 2026-10-14): Problems.card says what it must show,
tickets.repair makes the Kiosk say it.

The villa's case: Fabien pressed Done on Telegram while the Kiosk restarted; the resolve never landed, and the repair
later closed the fault as the agent's own clearing — "Closed: the problem is over.", no name, no repair in Recent work.
And Home Assistant re-wording an open alert reached Telegram, never the card. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio

from kiosk_fake import FakeKiosk
from vesta_agent.tickets import Tickets
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

    async def settle(_iid, _note):
        return 0
    return k, Tickets(kiosk=k, state=_State(), store_path=path, settle_alert=settle), Store(path)


def an_alert_with_its_fault(k, t, st, message="Entrance door unlocked"):
    iid = st.new_incident("k", "door_unlocked", "lock.example_door", "P2", {"message": message})
    tid, _ = Problems(st).open_task("incident", iid, "door_unlocked", "lock.example_door", message)
    uid = run(t.create(message, "lock.example_door", None, tid))
    return iid, tid, uid


def test_a_done_the_kiosk_did_not_receive_is_redone_as_the_persons_done(tmp_path):
    k, t, st = villa(tmp_path)
    iid, tid, uid = an_alert_with_its_fault(k, t, st)
    # Fabien presses Done; the store moves, the resolve action is lost (the Kiosk restarting)
    Problems(st).close_incident(iid, Incident.DONE, st.now(), "Done by Fabien on Telegram.", who="Fabien")
    run(t.repair())
    card = k.ticket(uid)
    last = card["updates"][-1]
    assert card["status"] == "resolved" and last.get("who") == "Fabien" and last.get("note") == "Done by Fabien on Telegram."
    assert "kind" not in last and uid not in k.cleared                          # a repair, not the agent's clearing
    assert [c["who"] for c in k.doc["data"]["completions"]] == ["Fabien"]      # in Recent work


def test_a_clearing_the_kiosk_did_not_receive_is_redone_as_a_clearing_with_its_note(tmp_path):
    k, t, st = villa(tmp_path)
    iid, tid, uid = an_alert_with_its_fault(k, t, st)
    Problems(st).close_incident(iid, Incident.RESOLVED, st.now(), "Cleared in Home Assistant.")
    run(t.repair())
    last = k.ticket(uid)["updates"][-1]
    assert last["kind"] == "cleared" and last["note"] == "Cleared in Home Assistant." and uid in k.cleared


def test_an_open_alert_re_worded_by_home_assistant_is_re_worded_on_its_card(tmp_path):
    import json
    k, t, st = villa(tmp_path)
    iid, tid, uid = an_alert_with_its_fault(k, t, st, "Pool pump power low")
    run(t.repair())
    assert k.titles[uid] == "Pool pump power low"                              # nothing to change: no step written
    p = json.loads(st.incident(iid)["payload"])
    st.update_incident(iid, payload=json.dumps({**p, "message": "Pool pump power very low"}))   # the desk's RESTATED
    run(t.repair())
    assert k.titles[uid] == "Pool pump power very low" and k.ticket(uid)["updates"][-1]["kind"] == "retitled"


def test_the_card_says_what_the_task_says():
    import os
    import tempfile
    st = Store(os.path.join(tempfile.mkdtemp(), "s.sqlite"))
    pb = Problems(st)
    iid = st.new_incident("k", "r", "lock.example_door", "P2", {"message": "Door unlocked"})
    tid, _ = pb.open_task("incident", iid, "r", "lock.example_door", "Door unlocked")
    assert pb.card(st.task(tid)) == {"open": True, "title": "Door unlocked", "number": iid,
                                     "note": "Closed: the problem is over.", "who": None}
    pb.close_incident(iid, Incident.DONE, st.now(), "Done by Wayan on Telegram.", who="Wayan")
    want = pb.card(st.task(tid))
    assert (want["open"], want["note"], want["who"]) == (False, "Done by Wayan on Telegram.", "Wayan")
