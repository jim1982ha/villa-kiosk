"""A fault's card tells what happened on Telegram (owner, 2026-10-14: "how would the fault description update…?"):
its whole short story as Telegram's "Status:" tells it (ticket 19 of "One inbox", owner 2026-10-28) — the alert sent,
reminders, an escalation, a button pressed, a closing note — a "noted" step each, worded by the ONE writer of
Telegram's lines (notice.Notices.story), written by tickets.repair within minutes, once, and only to a Kiosk that
shows them (/agent/v1/info step_kinds). Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from helpers import settings
from kiosk_fake import FakeKiosk
from vesta_agent.layout import head_text
from vesta_agent.notice import Notices, note_press
from vesta_agent.policy import Policy
from vesta_agent.state import State
from vesta_agent.tickets import Tickets
from vesta_shared.problems import Problems
from vesta_shared.store import Store

FM, OWNER = 111, 222
PEOPLE = [{"telegram_id": FM, "name": "Wayan", "role": "fm"}, {"telegram_id": OWNER, "name": "Fabien", "role": "owner"}]


def run(c):
    return asyncio.run(c)


def villa(tmp_path, kiosk=None):
    s = settings(str(tmp_path))
    state = State(s.state_path)
    notices = Notices(state, lambda: Policy({"people": PEOPLE}), "UTC")
    k = kiosk or FakeKiosk()

    async def settle(_iid, _note, **_kw):
        return 0
    t = Tickets(kiosk=k, state=state, store_path=s.store_path, settle_alert=settle, story=notices.story)
    st = Store(s.store_path)
    iid = st.new_incident("k", "pump_schedule", "switch.example_pump", "P2", {"message": "House pump did not run"})
    tid, _ = Problems(st).open_task("incident", iid, "pump_schedule", "switch.example_pump", "House pump did not run")
    uid = run(t.create("House pump did not run", "switch.example_pump", None, tid))
    return k, t, state, notices, iid, uid


def told(notices, state, iid, minutes_after):
    at = datetime.now(timezone.utc) + timedelta(minutes=minutes_after)
    notices.record(iid, "new", [(FM, "fm")], at=at - timedelta(minutes=60))
    notices.record(iid, "reminder", [(FM, "fm")], at=at)
    notices.record(iid, "escalated", [(OWNER, "owner")], at=at + timedelta(minutes=30))
    note_press(state, iid, "Need help", "Wayan", "help", "need_help")
    note_press(state, iid, "Done", "Wayan", None, "done")            # Done: the fault's close says it, not a line


STORY = ["Alert sent (to: Facility Manager)", "Reminder sent (to: Facility Manager)", "Escalation sent (to: Owner)",
         "🆘 Need help on Telegram (Wayan)"]


def test_the_story_is_every_line_telegram_shows_the_first_alert_too(tmp_path):
    k, t, state, notices, iid, uid = villa(tmp_path)
    told(notices, state, iid, 1)
    assert [x["note"] for x in notices.story(iid)] == STORY
    # one line per line of Telegram's "Status:", in its order (each its own moment: the Kiosk says when)
    assert len(notices.story(iid)) == len(notices.history_lines(iid))
    # Telegram's "Status:" tells the press as the card does — once, never also as an "Update sent" (review 2026-10-15)
    head = head_text(notices.heading(FM, iid))
    assert "- 🆘 Need help on " in head and "Update sent" not in head


def test_the_repair_writes_them_on_the_card_once_without_changing_its_status(tmp_path):
    k, t, state, notices, iid, uid = villa(tmp_path)
    told(notices, state, iid, 1)
    run(t.repair())
    run(t.repair())
    steps = [u for u in k.ticket(uid)["updates"] if u.get("kind") == "noted"]
    # the alert that started it too, though it was sent before the fault was made: the story of the fault's run
    assert [u["note"] for u in steps] == STORY
    assert {u["status"] for u in steps} == {"open"} and k.ticket(uid)["status"] == "open"


def test_a_kiosk_that_does_not_show_them_gets_none(tmp_path):
    old = FakeKiosk()
    old.info = {"contract": 1}                                          # a Kiosk before 2.496.356: no step_kinds
    k, t, state, notices, iid, uid = villa(tmp_path, old)
    told(notices, state, iid, 1)
    before = list(k.ticket(uid)["updates"])
    run(t.repair())
    assert not [u for u in k.ticket(uid)["updates"] if u.get("kind") == "noted"]
    # nor without its kind (the Kiosk's gate, Kiosk._gated): it would read as the fault changing status
    assert k.ticket(uid)["updates"] == before and k.ticket(uid)["status"] == "open"


def test_a_kiosk_updated_since_the_agent_started_gets_them_at_the_next_repair(tmp_path):
    # the repair reads /agent/v1/info again while the one held lists no step kinds (Kiosk.refresh): the gate then lets
    # the lines through — never a restart of the agent
    from kiosk_fake import STEP_KINDS, TICKET_FIELDS
    k = FakeKiosk()
    k.info = {"contract": 1}                                            # what it said when the agent started
    real = k._req

    async def updated(method, path, body=None):
        if path == "/agent/v1/info":                                    # updated since: it lists them now
            return 200, {"contract": 1, "step_kinds": list(STEP_KINDS), "ticket_fields": list(TICKET_FIELDS)}
        return await real(method, path, body)
    k._req = updated
    k, t, state, notices, iid, uid = villa(tmp_path, k)
    told(notices, state, iid, 1)
    run(t.repair())
    assert [u for u in k.ticket(uid)["updates"] if u.get("kind") == "noted"]


def test_a_reworded_line_is_never_written_on_the_card_again(tmp_path):
    # architecture review, 2026-10-15: lines were matched by their words — a stage reworded, or a role renamed in
    # People, re-wrote every past reminder, and each was added again to every open card
    k, t, state, notices, iid, uid = villa(tmp_path)
    told(notices, state, iid, 1)
    run(t.repair())
    from vesta_shared.message_format import STEPS
    saved = STEPS["reminder"]
    try:
        STEPS["reminder"] = saved._replace(sent="Reminder posted")     # tomorrow's rewording
        run(t.repair())
    finally:
        STEPS["reminder"] = saved
    notes = [u["note"] for u in k.ticket(uid)["updates"] if u.get("kind") == "noted"]
    assert notes.count("Reminder sent (to: Facility Manager)") == 1 and "Reminder posted to Facility Manager" not in notes


def test_a_closing_note_a_note_and_a_long_story_say_what_telegram_says(tmp_path):
    from vesta_agent.notice import note_step
    k, t, state, notices, iid, uid = villa(tmp_path)
    told(notices, state, iid, 1)
    note_step(state, iid, "cleared", "Cleared in the villa's system on 28/10/2026 10:00.")
    notices.record(iid, "closed", [(FM, "fm")])
    assert [x["note"] for x in notices.story(iid)][-2:] == [
        "Cleared in the villa's system on 28/10/2026 10:00", "Closing note sent (to: Facility Manager)"]
    # a ticket taken on in the Cockpit is the Kiosk's own step already ("in progress since … by …"): never told twice
    note_step(state, iid, "taken", "Ticket opened in the Cockpit on 28/10/2026 10:05 (JM)")
    assert "Ticket opened" in notices.history_lines(iid)[-1]
    assert not [x for x in notices.story(iid) if "Ticket opened" in x["note"]]
    # past the 20 lines kept, the counted line has no moment of its own: Telegram's alone (the card keeps every line
    # it was given, so it loses none)
    for i in range(30):
        notices.record(iid, "reminder", [(FM, "fm")], at=datetime.now(timezone.utc) + timedelta(minutes=100 + i))
    assert any("earlier" in x for x in notices.history_lines(iid))
    told_there = [x for x in notices.history_lines(iid) if "earlier notices" not in x and "Ticket opened" not in x]
    assert all(x.get("at") for x in notices.story(iid)) and len(notices.story(iid)) == len(told_there)


def test_a_reopened_fault_tells_only_its_new_run(tmp_path):
    k, t, state, notices, iid, uid = villa(tmp_path)
    now = datetime.now(timezone.utc)
    # its first run: alerted before the fault was made, chased after it
    notices.record(iid, "new", [(FM, "fm")], at=now - timedelta(minutes=120))
    notices.record(iid, "reminder", [(FM, "fm")], at=now + timedelta(minutes=5))
    from vesta_shared.store import Store
    from helpers import settings
    st = Store(settings(str(tmp_path)).store_path)
    task = st.tasks(None)[0]
    st.reopen_task(task["id"], task["summary"], at=(now + timedelta(minutes=10)).isoformat())
    notices.record(iid, "back", [(FM, "fm")], at=now + timedelta(minutes=11))
    run(t.repair())
    notes = [u["note"] for u in k.ticket(uid)["updates"] if u.get("kind") == "noted"]
    # the first run's lines belong to the fault as it was then
    assert notes == ["Back: alert sent (to: Facility Manager)"], notes


def test_a_fault_made_in_a_later_run_starts_at_that_runs_return(tmp_path):
    k, t, state, notices, iid, uid = villa(tmp_path)
    now = datetime.now(timezone.utc)
    notices.record(iid, "new", [(FM, "fm")], at=now - timedelta(minutes=120))
    notices.record(iid, "reminder", [(FM, "fm")], at=now - timedelta(minutes=100))
    notices.record(iid, "back", [(FM, "fm")], at=now - timedelta(minutes=30))         # the run the fault is made in
    run(t.repair())
    notes = [u["note"] for u in k.ticket(uid)["updates"] if u.get("kind") == "noted"]
    assert notes == ["Back: alert sent (to: Facility Manager)"], notes
