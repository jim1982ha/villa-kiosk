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

    async def settle(_iid, _note, **_kw):
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
    # an older Kiosk's step, its former words: said in the profile's words now (architecture review round 8)
    assert said == [(iid, "Ticket opened in the Cockpit on 15/10/2026 00:40 (Facility Manager).")]
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
    assert st.incident(iid)["closed_at"] and [a["action"] for a in acts] == ["faults_changed"]


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


def test_the_closed_message_tells_every_step_the_villa_saw_on_15_october(tmp_path):
    # the run on the villa, 2026-10-15: alert 00:08, reminder 00:24, escalation 00:54, "Open Ticket" 01:09, cleared
    # 01:28 — the closed message listed only the alert and the reminder: each replaced status was dropped
    from helpers import make_agent
    from vesta_shared import result as R
    owner, fm = 101, 202
    v = make_agent(tmp_path, {"people": [{"telegram_id": owner, "name": "Jim", "role": "owner"},
                                         {"telegram_id": fm, "name": "Wayan", "role": "fm"}]})
    st = Store(v.s.store_path)
    iid = st.new_incident("k", "watchdog", "lock.example_door", "P2", {"message": "Door unavailable"})
    send = lambda to, status, stage: asyncio.run(v.outcome.carry_out(
        {"send": [R.message(to, "Door unavailable", status=status, incident=iid, buttons=True, stage=stage)]}, "alert-desk"))
    send("fm", "New alert", "new")
    send("fm", "Reminder: no answer after 15 min", "reminder")
    send("owner", "No answer from the facility manager after 45 min", "escalated")
    asyncio.run(v._alert_taken(iid, "Ticket opened in the Cockpit by Wayan on 15/10/2026 01:09."))
    taken = v.thread.shown(iid)[owner]["text"]
    assert "- Escalation sent " in taken and taken.endswith("Ticket opened in the Cockpit by Wayan on 15/10/2026 01:09.")
    st.update_incident(iid, closed_at=st.now(), state=Incident.RESOLVED)
    asyncio.run(v.thread.close(iid, "Cleared on {time}: back to normal."))
    # every step each chat was sent, none dropped — and only those (owner, 2026-10-18, #55 "each chat its own steps",
    # reversing part of 2026-10-11 "one incident, one picture"): the owner's chat its escalation, the FM's its alert and
    # reminder; the ticket taken on and the clear, sent to nobody in particular, in both
    for chat, steps in ((owner, ["Escalation", "Ticket"]), (fm, ["Alert", "Reminder", "Ticket"])):
        text = v.thread.shown(iid)[chat]["text"]
        lines = text.split("Status:\n", 1)[1].split("\n")
        assert [l.split(" ")[1] for l in lines[:-1]] == steps, (chat, lines)
        assert "- Ticket opened in the Cockpit by Wayan on 15/10/2026 01:09" in lines and "Cleared on " in lines[-1]
        assert text.split("\n")[0].endswith("(closed)")


def test_an_alert_taken_on_in_the_kiosk_waits_for_no_answer(tmp_path):
    # owner, 2026-10-15: someone has it — its messages carry no Done / Need help (incidents.Incidents, the one reader
    # since architecture review scan 1, 2026-10-19)
    from vesta_agent.incidents import Incidents
    from vesta_shared.store import Incident, Store
    path = str(tmp_path / "s.sqlite")
    st = Store(path)
    iid = st.new_incident("k", "automation.x", "lock.front_door", "P2", {"message": "m"})
    inc = Incidents(path)
    assert inc.awaiting_answer(iid) and not inc.closed(iid) and inc.severity(iid) == "P2"
    st.update_incident(iid, state=Incident.TAKEN)
    assert not inc.awaiting_answer(iid)
    assert not inc.awaiting_answer("x") and inc.runs(999) is None


def test_a_reminder_never_overwrites_an_alert_taken_on_meanwhile(tmp_path):
    # architecture review scan 2, 2026-10-19: the desk's tick read "asked", a person's "Open Ticket" landed (TAKEN), and
    # the tick wrote "reasked" over it — chased again, a reminder sent. A state moves only from where it was read.
    import importlib.util
    from datetime import datetime, timedelta, timezone
    from vesta_shared.store import Incident, Store
    spec = importlib.util.spec_from_file_location("desk_race", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
    desk = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(desk)
    st = Store(str(tmp_path / "s.sqlite"))
    t0 = datetime(2026, 10, 19, 1, 0, tzinfo=timezone.utc)
    iid = st.new_incident("k", "automation.x", "lock.front_door", "P2", {"message": "m"})
    st.update_incident(iid, state=Incident.ASKED, asked_at=t0.isoformat())
    read = st.incidents

    def incidents_then_taken(open_only=True):
        rows = read(open_only)                                   # the tick has read "asked"…
        Store(str(tmp_path / "s.sqlite")).update_incident(iid, state=Incident.TAKEN)   # …then the Cockpit's Open Ticket
        return rows
    st.incidents = incidents_then_taken
    out = desk.tick(st, t0 + timedelta(minutes=20))
    assert st.incident(iid)["state"] == Incident.TAKEN and out["reasked"] == [] and not out["send"], out
