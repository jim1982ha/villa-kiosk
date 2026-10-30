"""Need help on every Cockpit card (owner, 2026-10-30: "I expect to consistently see always Done / Need Help / Open
Ticket … for all of them"). A Need help pressed in the Kiosk reaches the same desk as Telegram's: an alert's card
escalates its alert; a fault with no alert (a night-check finding, a person's ticket) gets an alert of its own, already
escalated to the owner, standing for it — its Done on Telegram closes the fault, the fault's Done in the Cockpit closes
it. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
from datetime import datetime, timezone

from helpers import STARTER_SKILLS, make_agent
from kiosk_fake import FakeKiosk
from vesta_shared.problems import Problems
from vesta_shared.store import Store

spec = importlib.util.spec_from_file_location("desk_help", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

OWNER, FM = 111, 222
PEOPLE = {"people": [{"telegram_id": OWNER, "name": "Jim", "role": "owner"}, {"telegram_id": FM, "name": "JM", "role": "fm"}]}


def run(c):
    return asyncio.run(c)


def villa(tmp_path):
    k = FakeKiosk()
    v = make_agent(tmp_path, PEOPLE, kiosk=k)
    return k, v, Store(v.s.store_path)


def test_need_help_on_an_alerts_card_in_the_cockpit_escalates_it_once_as_telegrams_does(tmp_path):
    k, v, st = villa(tmp_path)
    iid = st.new_incident("automation.door|lock.door", "automation.door", "lock.door", "P2", {"message": "Door unlocked"})
    st.update_incident(iid, state="asked", asked_at=datetime.now(timezone.utc).isoformat(), assignee="fm")
    tid, _ = Problems(st).open_task("incident", iid, "automation.door", "lock.door", "Door unlocked")
    st.set_task_uid(tid, "t-door")
    k.held("t-door")
    k.person_helps("t-door", by="JM")
    run(v.tickets.repair())
    run(v.tickets.repair())                                         # the same press, read again: told once
    out = desk.tick(st, datetime.now(timezone.utc))
    assert out["escalated"] == [iid] and st.incident(iid)["state"] == "escalated"
    (owner,) = [s for s in out["send"] if s["to"] == "owner"]
    assert owner["status"].startswith("Need help in the Cockpit on ") and "(JM): Owner is asked to act." in owner["status"]
    assert owner["keyboard"] and owner["stage"] == "escalated"
    run(v.tickets.repair())                                         # read again after the desk told it: told once
    assert desk.tick(st, datetime.now(timezone.utc))["escalated"] == []


def finding_task(st, k, uid="t-pump"):
    fid, _ = st.raise_finding("PM-RUNHOURS", "sensor.pump_power", "power", datetime.now(timezone.utc).date().isoformat(),
                           "P3", "Pump ran shorter than expected", {})
    tid, _ = Problems(st).open_task("finding", fid, "PM-RUNHOURS", "sensor.pump_power", "Pump ran shorter than expected")
    st.set_task_uid(tid, uid)
    k.held(uid, title="Pump ran shorter than expected")
    return tid


def test_need_help_on_a_finding_opens_one_alert_already_escalated_whose_telegram_done_closes_the_finding(tmp_path):
    k, v, st = villa(tmp_path)
    tid = finding_task(st, k)
    k.person_helps("t-pump", by="JM")
    run(v.tickets.repair())
    run(v.tickets.repair())
    now = datetime.now(timezone.utc)
    out = desk.tick(st, now)
    (iid,) = out["helped"]
    assert desk.tick(st, now)["helped"] == []                       # one alert per press
    inc = st.incident(iid)
    assert inc["state"] == "escalated" and json.loads(inc["payload"])["help_of"] == f"task:{tid}"
    (owner,) = [s for s in out["send"] if s["to"] == "owner"]
    assert owner["keyboard"] and owner["text"] == "Pump ran shorter than expected"
    assert "(JM): Owner is asked to act." in owner["status"]
    run(v.tickets.repair())
    assert k.numbers.get("t-pump") == iid                           # the card carries the alert's number, its story
    desk.reply(st, iid, "done", "owner", now, name="Jim")
    assert st.task(tid)["status"] == "done"                         # Telegram's Done closed the finding's fault too


def test_done_in_the_cockpit_on_a_finding_whose_owner_was_asked_closes_the_alert_standing_for_it(tmp_path):
    k, v, st = villa(tmp_path)
    finding_task(st, k)
    k.person_helps("t-pump", by="JM")
    run(v.tickets.repair())
    (iid,) = desk.tick(st, datetime.now(timezone.utc))["helped"]
    k.person_closes("t-pump", by="JM", cockpit=True)
    run(v.tickets.repair())
    assert st.incident(iid)["closed_at"] is not None


def test_need_help_on_a_persons_ticket_reaches_the_owner_and_its_telegram_done_resolves_the_ticket(tmp_path):
    k, v, st = villa(tmp_path)
    k.held("tk-1", title="Gate motor noisy")
    k.ticket("tk-1")["entityId"] = "cover.example_gate"
    k.person_helps("tk-1", by="JM")
    run(v.tickets.repair())
    now = datetime.now(timezone.utc)
    (iid,) = desk.tick(st, now)["helped"]
    assert json.loads(st.incident(iid)["payload"])["help_of"] == "kiosk:tk-1" and st.incident(iid)["entity_id"] == "cover.example_gate"
    desk.reply(st, iid, "done", "owner", now, name="Jim")
    run(v.tickets.repair())
    assert k.ticket("tk-1")["status"] == "resolved"


def test_a_persons_ticket_done_in_the_cockpit_closes_its_need_help_alert(tmp_path):
    k, v, st = villa(tmp_path)
    k.held("tk-2", title="Gate motor noisy")
    k.person_helps("tk-2", by="JM")
    run(v.tickets.repair())
    (iid,) = desk.tick(st, datetime.now(timezone.utc))["helped"]
    k.person_closes("tk-2", by="JM", cockpit=True)
    run(v.tickets.repair())
    assert st.incident(iid)["closed_at"] is not None
