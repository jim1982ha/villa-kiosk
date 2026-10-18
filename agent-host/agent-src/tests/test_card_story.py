"""A fault's card tells what happened on Telegram (owner, 2026-10-14: "how would the fault description update…?"):
a reminder or an escalation sent, a button pressed — a "noted" step each, from the SAME history Telegram's "Status:" is
written from (notice.Notices.story), written by tickets.repair within minutes, once, and only to a Kiosk that shows
them (/agent/v1/info step_kinds). Synthetic villa; ids invented."""
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

    async def settle(_iid, _note):
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


def test_the_story_is_the_reminders_the_escalation_and_the_presses_not_the_first_alert(tmp_path):
    k, t, state, notices, iid, uid = villa(tmp_path)
    told(notices, state, iid, 1)
    assert [x["note"] for x in notices.story(iid)] == [
        "Reminder sent (to: Facility Manager)", "Escalation sent (to: Owner)", "🆘 Need help (Wayan)"]
    # Telegram's "Status:" tells the press as the card does — once, never also as an "Update sent" (review 2026-10-15)
    head = head_text(notices.heading(FM, iid))
    assert "- 🆘 Need help on " in head and "Update sent" not in head


def test_the_repair_writes_them_on_the_card_once_without_changing_its_status(tmp_path):
    k, t, state, notices, iid, uid = villa(tmp_path)
    told(notices, state, iid, 1)
    run(t.repair())
    run(t.repair())
    steps = [u for u in k.ticket(uid)["updates"] if u.get("kind") == "noted"]
    assert [u["note"] for u in steps] == ["Reminder sent (to: Facility Manager)", "Escalation sent (to: Owner)",
                                          "🆘 Need help (Wayan)"]
    assert {u["status"] for u in steps} == {"open"} and k.ticket(uid)["status"] == "open"


def test_a_kiosk_that_does_not_show_them_gets_none(tmp_path):
    old = FakeKiosk()
    old.info = {"contract": 1}                                          # a Kiosk before 2.496.356: no step_kinds
    k, t, state, notices, iid, uid = villa(tmp_path, old)
    told(notices, state, iid, 1)
    run(t.repair())
    assert not [u for u in k.ticket(uid)["updates"] if u.get("kind") == "noted"]


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
