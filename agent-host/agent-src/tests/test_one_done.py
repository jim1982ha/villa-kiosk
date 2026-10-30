"""One Done, one record and one wording, wherever it is pressed (architecture review, 2026-10-30 evening): the reports'
outcome column read "Done", "Done (Closed in the Cockpit)" or "Done (Done in the Cockpit)" for the same press, a Telegram
Done on a Need help alert was later told as "Closed in the Cockpit … but still there", and a press on the tablet's notice
was noted "on Telegram". Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import importlib.util
import os
from datetime import datetime, timezone
from types import SimpleNamespace

from helpers import STARTER_SKILLS, make_agent
from kiosk_fake import FakeKiosk
from vesta_shared.problems import Problems
from vesta_shared.store import Store

spec = importlib.util.spec_from_file_location("desk_done", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

PEOPLE = {"people": [{"telegram_id": 111, "name": "Jim", "role": "owner"}, {"telegram_id": 222, "name": "JM", "role": "fm"}]}


def run(c):
    return asyncio.run(c)


def alert(st, uid=None, k=None, key="automation.example_door|lock.example_door", at=None):
    iid = st.new_incident(key, "automation.example_door", "lock.example_door", "P2", {"message": "Door unlocked"},
                          **({"at": at} if at else {}))
    st.update_incident(iid, state="asked", asked_at=datetime.now(timezone.utc).isoformat(), assignee="fm")
    tid, _ = Problems(st).open_task("incident", iid, "automation.example_door", "lock.example_door", "Door unlocked")
    if uid:
        st.set_task_uid(tid, uid)
        k.held(uid, title="Door unlocked")
    return iid, tid


def test_a_done_names_where_it_was_pressed_and_the_report_says_it_once(tmp_path):
    from test_reports import _ctx
    facts, c, st = _ctx(tmp_path)
    c.cfg["incident_words"] = {"done": "Done"}
    c.ha_alerts = lambda: []
    now = datetime.now(timezone.utc)
    on_telegram, tid = alert(st, key="k1", at="2026-09-30T08:00:00+00:00")
    desk.reply(st, on_telegram, "done", "owner", now, name="Jim")
    on_tablet, _ = alert(st, key="k2", at="2026-09-30T08:00:00+00:00")
    desk.reply(st, on_tablet, "done", "owner", now, name="Jim", place="tablet")
    in_cockpit, cockpit_task = alert(st, key="k3", at="2026-09-30T08:00:00+00:00")
    Problems(st).closed_in_kiosk(cockpit_task, who="JM")
    assert [st.incident(i)["reply"] for i in (on_telegram, on_tablet, in_cockpit)] == [
        "Done on Telegram (Jim)", "Done on the tablet (Jim)", "Done in the Cockpit (JM)"]
    assert st.task(tid)["close_note"] == "Done on Telegram (Jim)."
    assert sorted(r["outcome"] for r in facts._alert_rows(c)) == [
        "Done in the Cockpit (JM)", "Done on Telegram (Jim)", "Done on the tablet (Jim)"]


def test_a_press_on_the_tablets_notice_is_handed_to_the_desk_as_the_tablets(tmp_path):
    from vesta_agent.alert_buttons import AlertButtons
    from vesta_agent.incident_thread import IncidentThread
    from vesta_agent import layout
    from test_telegram_messages import GROUP, _delivery
    d, _ = _delivery(tmp_path)
    thread = IncidentThread(d.state, "UTC", edit=d.edit, delete=d.delete)
    run(thread.post(5, GROUP, 70, layout.parts(body="Incident #5 · leak"), buttons=True))
    handed = []

    async def run_job(skill, command, timeout, values, origin):
        handed.append(values)

    skill = SimpleNamespace(name="desk", on_reply="desk.py reply")
    b = AlertButtons(state=d.state, skills=SimpleNamespace(get=lambda name: skill), store_path=str(tmp_path / "s.sqlite"),
                     thread=thread, run_job=run_job)
    d.state.set_alert_skill(5, GROUP, "desk")

    async def toast(text):
        return None
    person = SimpleNamespace(telegram_id=1, name="Marie", role="fm")
    run(b.press(4503601096569778, ["5", "done"], person, toast, anywhere=True))
    assert [v["place"] for v in handed] == ["tablet"]
    with open(os.path.join(STARTER_SKILLS, "alert-desk", "skill.yaml"), encoding="utf-8") as f:
        assert "--place {place}" in f.read()                         # the shipped skill hands it on


def test_still_there_after_a_telegram_done_says_telegram_never_the_cockpit(tmp_path):
    k = FakeKiosk()
    v = make_agent(tmp_path, PEOPLE, kiosk=k)
    st = Store(v.s.store_path)
    fid, _ = st.raise_finding("PM-RUNHOURS", "sensor.example_pump_power", "power",
                              datetime.now(timezone.utc).date().isoformat(), "P3", "Pump ran shorter than expected", {})
    tid, _ = Problems(st).open_task("finding", fid, "PM-RUNHOURS", "sensor.example_pump_power", "Pump ran shorter than expected")
    st.set_task_uid(tid, "t-pump")
    k.held("t-pump", title="Pump ran shorter than expected")
    k.person_helps("t-pump", by="JM")
    run(v.tickets.repair())
    now = datetime.now(timezone.utc)
    (iid,) = desk.tick(st, now)["helped"]
    desk.reply(st, iid, "done", "owner", now, name="Jim")
    assert Problems.done_where(st.task(tid)) == "Done on Telegram"
    Problems(st).closed_in_kiosk(tid)                               # a later close in the Cockpit keeps no note
    assert Problems.done_where(st.task(tid)) == "Done in the Cockpit"
    spec_r = importlib.util.spec_from_file_location(
        "recheck_done", os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "recheck.py"))
    recheck = importlib.util.module_from_spec(spec_r)
    spec_r.loader.exec_module(recheck)
    st.close_task(tid, "done", "Done on Telegram (Jim).", "Jim")
    st.reopen_task(tid, "Pump ran shorter than expected", note=recheck.STILL_THERE)
    import yaml
    with open(os.path.join(STARTER_SKILLS, "preventive-maintenance", "settings.yaml"), encoding="utf-8") as f:
        settings = yaml.safe_load(f)
    (msg,) = recheck.still_there_untold(st, "UTC", settings)
    assert msg["text"].startswith("Done on Telegram on ") and "Cockpit" not in msg["text"]


def test_a_cockpit_done_recorded_as_work_done_is_the_persons_done_and_never_doubled(tmp_path):
    # the Kiosk records an issue card's Done as work done (resolved by the person, a completion with their name):
    # the agent takes it as that person's Done in the Cockpit, and adds no completion of its own
    k = FakeKiosk()
    v = make_agent(tmp_path, PEOPLE, kiosk=k)
    st = Store(v.s.store_path)
    iid, tid = alert(st, "t-door", k)
    k.person_does("t-door", who="JM")
    run(v.tickets.repair())
    run(v.tickets.repair())
    assert st.task(tid)["status"] == "closed_in_kiosk" and st.incident(iid)["closed_at"]
    assert st.incident(iid)["reply"] == "Done in the Cockpit (JM)"
    assert [c["ticketId"] for c in k.doc["data"].get("completions") or []] == ["t-door"]


def test_a_second_need_help_on_a_finding_whose_alert_is_open_goes_to_that_alert(tmp_path):
    # the link owns "one alert per finding" (vesta_shared.help_link): a later press is the open alert's, escalated
    # again as a Telegram Need help is, never a second alert
    import json
    k = FakeKiosk()
    v = make_agent(tmp_path, PEOPLE, kiosk=k)
    st = Store(v.s.store_path)
    fid, _ = st.raise_finding("PM-RUNHOURS", "sensor.example_pump_power", "power",
                              datetime.now(timezone.utc).date().isoformat(), "P3", "Pump ran shorter than expected", {})
    tid, _ = Problems(st).open_task("finding", fid, "PM-RUNHOURS", "sensor.example_pump_power", "Pump ran shorter than expected")
    st.set_task_uid(tid, "t-pump")
    k.held("t-pump", title="Pump ran shorter than expected")
    k.person_helps("t-pump", by="JM")
    run(v.tickets.repair())
    (iid,) = desk.tick(st, datetime.now(timezone.utc))["helped"]
    k.person_helps("t-pump", by="Jim", at="2099-01-02T00:00:00.000Z")
    run(v.tickets.repair())
    assert json.loads(st.incident(iid)["payload"]).get("kiosk_help")       # mailed to the open alert
    assert desk.tick(st, datetime.now(timezone.utc))["helped"] == []
