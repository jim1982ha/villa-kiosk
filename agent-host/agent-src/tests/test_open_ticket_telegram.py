"""Open Ticket on Telegram (owner, 2026-11-05: "Done · Not a problem · Open Ticket · Need help", on the tablet AND on
Telegram, and Telegram must offer Open Ticket too). Its press does what the Kiosk's Open Ticket on the alert's card does:
its fault becomes ONE ticket in progress, by the person who pressed (never the agent's stamp), read back as the Kiosk's
take-on — the chase stops and every chat's Status says it — and the buttons that still apply stay (Done, Need help).
A Kiosk that cannot be reached: answered plainly, nothing half done. Through the real path: Telegram's callback, the
alert desk's `desk.py reply` as the engine runs it, the engine's action, the Kiosk's record. Synthetic villa; ids
invented."""
from __future__ import annotations

import asyncio

import pytest

from helpers import make_agent, status
from ha_fake import FakeHA, tool
from kiosk_fake import FakeKiosk
from telegram_fake import BOT
from vesta_agent.roster import Roster
from vesta_shared.store import Incident, Store
from test_one_message_per_incident import FM, FM_CHAT, GROUP, OWNER, ha_alert, tick

ORDER = ["Done", "Not a problem", "Open Ticket", "Need help"]


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def agent(tmp_path):
    v = make_agent(tmp_path, {}, roster=Roster.of(owner=[(OWNER, "Owner"), (GROUP, "Owner chat")],
                                                  fm=[(FM, "Wayan"), (FM_CHAT, "Facility manager chat")]),
                   skills=["alert-desk"], reader=FakeHA(tools=[tool("ha_get_state")]), kiosk=FakeKiosk())
    v.bot_username = BOT["username"]
    return v


def last_keyboard(v, chat):
    """The buttons the chat's copy shows now: its latest send or edit there."""
    kb = None
    for c, _t, k in v.tg.sent:
        if c == chat:
            kb = k
    for (c, _m, _t), k in zip(v.tg.edits, v.tg.edit_keyboards):
        if c == chat:
            kb = k
    return [b["text"] for b in (kb or {}).get("inline_keyboard", [[]])[0]] if kb else []


def press(v, option, chat=FM_CHAT, user=FM):
    data = next(b["callback_data"] for _c, _t, k in reversed(v.tg.sent) if k for b in k["inline_keyboard"][0]
                if b["callback_data"].endswith(":" + option))
    mid = 1000 + len(v.tg.sent)
    run(v.on_ha_event("telegram_callback", {"id": f"cb-{option}", "data": data, "chat_id": chat, "user_id": user,
                                            "message": {"message_id": mid, "chat": {"id": chat}}, "bot": BOT}))


def fault(v):
    (tid,) = [t for t in v.kiosk._kept()]
    return v.kiosk.ticket(tid)


def test_telegram_offers_the_tablets_four_buttons_in_its_order(agent):
    ha_alert(agent)
    tick(agent, 20)                                              # the reminder, with the buttons, in the FM's chat
    assert last_keyboard(agent, FM_CHAT) == ORDER


def test_open_ticket_takes_the_alert_on_as_the_kiosks_own_does(agent):
    ha_alert(agent)
    tick(agent, 20)
    assert fault(agent)["status"] == "open"
    press(agent, "open_ticket")
    t = fault(agent)
    (step,) = [u for u in t["updates"] if u.get("status") == "in_progress" and not u.get("kind")]
    # the agreement's take-on, by the person who pressed: the Kiosk shows "Ticket in progress", "Opened by Wayan"
    assert t["status"] == "in_progress" and step["status"] == "in_progress" and "kind" not in step
    assert step["by"] == "Wayan" and step["who"] == "Wayan"
    st = Store(agent.s.store_path)
    (inc,) = st.incidents(open_only=True)
    assert inc["state"] == Incident.TAKEN and not inc["closed_at"]
    # every chat says the take-on (the Kiosk's own step words), its buttons those that still apply
    for chat in (FM_CHAT, GROUP):
        texts = [t for c, _m, t in agent.tg.edits if c == chat]
        # where it was pressed (architecture review 28: it was told "Ticket opened in the Cockpit")
        assert texts and "Ticket opened on Telegram" in status(texts[-1]) and "(Wayan)" in status(texts[-1]), texts[-1:]
        assert "Cockpit" not in status(texts[-1]), texts[-1]
        # said once, by the take-on: no line of the press beside it, now or under a later step
        assert "Open Ticket" not in texts[-1].split("Status:")[1], texts[-1]
    assert not [h for h in agent.state.incident_history(1) if h.get("label") == "Open Ticket"]
    assert last_keyboard(agent, FM_CHAT) == ["Done", "Need help"]
    # no longer chased: no reminder, no escalation
    before = len(agent.tg.sent)
    tick(agent, 70)
    assert not [s for s in agent.tg.sent[before:] if "Reminder" in status(s[1]) or "Escalation" in status(s[1])]


def test_a_stale_open_ticket_after_the_take_on_says_what_is_offered(agent):
    ha_alert(agent)
    tick(agent, 20)
    press(agent, "open_ticket")
    press(agent, "not_a_problem")                                # an older copy's button
    assert agent.tg.toasts[-1][1] == "This button is no longer offered: press Done or Need help."
    assert Store(agent.s.store_path).incidents(open_only=True)


def test_the_kiosk_unreachable_is_said_and_nothing_changes(agent):
    ha_alert(agent)
    tick(agent, 20)
    agent.kiosk.unreachable = True
    press(agent, "open_ticket")
    agent.kiosk.unreachable = False
    assert fault(agent)["status"] == "open"
    (inc,) = Store(agent.s.store_path).incidents(open_only=True)
    assert inc["state"] != Incident.TAKEN
    texts = [t for c, _m, t in agent.tg.edits if c == FM_CHAT]
    assert status(texts[-1]) == "The VESTA Kiosk cannot be reached: open the ticket on the tablet."
    assert last_keyboard(agent, FM_CHAT) == ORDER                # the buttons back, as before the press


def test_a_buttons_until_and_takes_are_read_and_checked():
    from vesta_agent.skills import SkillError, _buttons
    (b,) = _buttons([{"option": "open_ticket", "label": "Open Ticket", "takes": True, "until": "taken"}])
    assert b["takes"] and b["tells"] and b["until"] == "taken"
    with pytest.raises(SkillError):
        _buttons([{"option": "x", "label": "X", "until": "closed"}])


def test_need_help_after_the_take_on_brings_back_no_button_that_no_longer_applies(agent):
    ha_alert(agent)
    tick(agent, 20)
    press(agent, "open_ticket")
    press(agent, "need_help")                                    # escalated: still a ticket someone took on
    assert agent.tg.toasts[-1][1] == "Need help: noted."
    # the owner is asked to act, with the buttons that still apply (the press's own chat settled by its answer)
    asked = [k for c, _t, k in agent.tg.sent if c in (OWNER, GROUP) and k][-1]
    assert [b["text"] for b in asked["inline_keyboard"][0]] == ["Done", "Need help"]


