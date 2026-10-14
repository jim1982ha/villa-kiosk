"""An alert someone took on in the VESTA Kiosk is no longer chased (owner, 2026-10-15: "should Telegram stop chasing the
facility manager? yes"). "Open Ticket" on its card and Telegram still reminded the facility manager, then escalated to
the owner — of a job someone had taken. Now: no reminder, no escalation, every copy says "Ticket opened in the Cockpit
by …" without its buttons; the alert stays open and ends as before. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import importlib.util
import os
from datetime import datetime, timedelta, timezone

from helpers import STARTER_SKILLS
from kiosk_fake import FakeKiosk
from vesta_agent.tickets import Tickets
from vesta_shared.problems import Problems
from vesta_shared.store import Incident, Store

spec = importlib.util.spec_from_file_location("desk_taken", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)


def run(c):
    return asyncio.run(c)


class _State:
    def log(self, *_a, **_k):
        pass


def villa(tmp_path):
    k, said = FakeKiosk(), []

    async def restate(iid, note):
        said.append((iid, note))
        return 1

    async def settle(_iid, _note):
        return 0
    path = str(tmp_path / "agent.db")
    t = Tickets(kiosk=k, state=_State(), store_path=path, settle_alert=settle, timezone="UTC", restate_alert=restate)
    st = Store(path)
    asked = datetime.now(timezone.utc) - timedelta(minutes=5)
    iid = st.new_incident("k", "watchdog", "lock.example_door", "P2", {"message": "Door unavailable"}, asked.isoformat())
    st.update_incident(iid, state=Incident.ASKED, asked_at=asked.isoformat(), assignee="fm")
    tid, _ = Problems(st).open_task("incident", iid, "watchdog", "lock.example_door", "Door unavailable")
    uid = run(t.create("Door unavailable", "lock.example_door", None, tid))
    return k, t, st, iid, uid, said, asked


def test_open_ticket_in_the_kiosk_stops_the_chase_and_says_so_once(tmp_path):
    k, t, st, iid, uid, said, asked = villa(tmp_path)
    k.person_moves(uid, by="Facility manager", at="2026-10-15T00:40:00.000Z")       # "Open Ticket" on its card
    run(t.repair())
    run(t.repair())
    assert st.incident(iid)["state"] == Incident.TAKEN and not st.incident(iid)["closed_at"]
    assert said == [(iid, "Ticket opened in the Cockpit by Facility manager on 15/10/2026 00:40.")]
    out = desk.tick(st, asked + timedelta(minutes=60))                                # past the reminder AND the escalation
    assert not [m for m in out["send"] if m.get("stage") in ("reminder", "escalated")], out["send"]


def test_an_alert_nobody_took_is_still_chased(tmp_path):
    k, t, st, iid, uid, said, asked = villa(tmp_path)
    run(t.repair())
    assert said == [] and st.incident(iid)["state"] == Incident.ASKED
    out = desk.tick(st, asked + timedelta(minutes=20))
    assert [m.get("stage") for m in out["send"]] == ["reminder"]


def test_a_taken_alert_still_closes_when_home_assistant_clears_it(tmp_path):
    k, t, st, iid, uid, said, asked = villa(tmp_path)
    k.person_moves(uid, by="Owner", at="2026-10-15T00:40:00.000Z")
    run(t.repair())
    acts = Problems(st).close_incident(iid, Incident.RESOLVED, st.now(), "Cleared in Home Assistant.")
    assert st.incident(iid)["closed_at"] and [a["action"] for a in acts] == ["ticket.resolve"]


def test_every_copy_says_it_and_loses_its_buttons_without_being_settled(tmp_path):
    from helpers import settings
    from vesta_agent import layout
    from vesta_agent.incident_thread import IncidentThread
    from vesta_agent.state import State
    edits = []

    async def edit(chat, mid, text, keyboard=None):
        edits.append((chat, mid, text, keyboard))
        return True
    th = IncidentThread(State(settings(str(tmp_path)).state_path), "UTC", edit=edit)
    kb = {"inline_keyboard": [[{"text": "Done", "callback_data": "i:7:done"}]]}
    parts = layout.parts(head="#7-P2 (new)\nTo: Facility Manager", body="Door unavailable", status="New alert")
    run(th.post(7, 111, 501, parts, buttons=True, keyboard=kb))
    assert run(th.restate(7, "Ticket opened in the Cockpit by Owner on 15/10/2026 00:40.")) == 1
    (chat, mid, text, keyboard), = edits
    assert keyboard is None and text.endswith("Ticket opened in the Cockpit by Owner on 15/10/2026 00:40.")
    rec = th.shown(7)[111]
    assert rec["buttons"] is False and rec["settled"] is False                      # still open: its close still shows
