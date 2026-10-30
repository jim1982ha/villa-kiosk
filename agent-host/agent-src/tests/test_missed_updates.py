"""What people sent on Telegram while the agent was restarting, taken up when it is back (architecture review, round 9:
a Done pressed on an alert during an update's 20 seconds was lost, and a question typed then got no answer and no
word). Read from the bot's event entity's history; once each, whichever way it came. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from ha_fake import FakeHA
from helpers import make_agent

NOW = datetime.now(timezone.utc)
BOT_EVENTS = "event.example_bot_update_event"
CHAT, OWNER, CARD = -100200300, 111, 501
TYPES = ["telegram_attachment", "telegram_callback", "telegram_command", "telegram_text", "telegram_sent"]


def row(minutes_ago: float, data: dict) -> dict:
    """One row of the bot's event entity's history, as ha-mcp gives it: the update's moment as its state, its data as
    its attributes beside the entity's own."""
    at = (NOW - timedelta(minutes=minutes_ago)).isoformat()
    return {"state": at, "last_changed": at, "attributes": {**data, "friendly_name": "Example bot Update event"}}


def press(qid: str, minutes_ago: float, button: str = "i:7:done") -> dict:
    return row(minutes_ago, {"event_type": "telegram_callback", "id": qid, "data": button, "chat_id": CHAT,
                             "user_id": OWNER, "from_first": "Owner",
                             "message": {"message_id": CARD, "chat": {"id": CHAT},
                                         "reply_markup": {"inline_keyboard": [[
                                             {"text": "Done", "callback_data": "i:7:done"},
                                             {"text": "Need help", "callback_data": "i:7:need_help"}]]}}})


def text(mid: int, minutes_ago: float, words: str = "is the gate closed?") -> dict:
    return row(minutes_ago, {"event_type": "telegram_text", "id": mid, "chat_id": OWNER, "user_id": OWNER,
                             "from_first": "Owner", "text": words})


def agent(tmp_path, rows, monkeypatch, ready: bool = True):
    ha = FakeHA(states={BOT_EVENTS: {"state": "x", "attributes": {"event_types": TYPES}},
                        "event.example_doorbell": {"state": "x", "attributes": {"event_types": ["ring"]}}},
                history={BOT_EVENTS: rows})
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner"}]}, reader=ha)
    v.state.remember_message(CHAT, CARD)
    if ready:
        v.state.updates_recorded()               # an earlier start of this engine recorded the updates it took in live
    handled = []

    async def callback(q):
        handled.append(("press", q["id"]))

    async def message(et, m, about=None):
        handled.append(("text", m["id"]))
    monkeypatch.setattr(v, "handle_callback", callback)
    monkeypatch.setattr(v, "handle_message", message)
    return v, handled


def catch_up(v, last_heard: datetime | None) -> int:
    async def go():
        connected = asyncio.Event()
        connected.set()
        return await v.catch_up(connected, last_heard.isoformat() if last_heard else None)
    return asyncio.run(go())


def test_a_press_and_a_question_sent_during_a_restart_are_each_taken_up_once(tmp_path, monkeypatch):
    v, handled = agent(tmp_path, [press("q-old", 30), press("q-1", 2), text(41, 1)], monkeypatch)
    assert catch_up(v, NOW - timedelta(minutes=3)) == 2
    assert handled == [("press", "q-1"), ("text", 41)]                    # in time order; the one before the stop not
    catch_up(v, NOW - timedelta(minutes=3))                               # the next start reads the same rows
    assert handled == [("press", "q-1"), ("text", 41)]


def test_one_delivered_live_too_is_taken_up_once(tmp_path, monkeypatch):
    # the last beat comes up to a minute before the stop: an update inside that minute came live AND is in the history
    v, handled = agent(tmp_path, [press("q-1", 1), text(41, 1)], monkeypatch)
    live = {**press("q-1", 1)["attributes"]}
    live.pop("friendly_name")
    asyncio.run(v.on_ha_event("telegram_callback", live))
    asyncio.run(v.on_ha_event("telegram_text", {"id": 41, "chat_id": OWNER, "user_id": OWNER, "text": "x"}))
    catch_up(v, NOW - timedelta(minutes=2))
    assert handled == [("press", "q-1"), ("text", 41)]


def test_a_press_older_than_the_limit_gets_one_line_instead(tmp_path, monkeypatch):
    from vesta_agent import missed_at_start
    monkeypatch.setattr(missed_at_start, "catch_up_minutes", lambda: 10)
    v, handled = agent(tmp_path, [press("q-late", 20), text(42, 20)], monkeypatch)
    catch_up(v, NOW - timedelta(minutes=25))
    assert handled == []
    said = [t for _, t, _ in v.tg.sent]
    assert said == ["VESTA was restarting when you pressed Done on #7; press it again.",
                    "VESTA was restarting when you sent this; send it again if you still need an answer."]
    catch_up(v, NOW - timedelta(minutes=25))                              # never said twice
    assert len(v.tg.sent) == 2


def test_the_first_start_of_this_engine_reads_no_telegram_history(tmp_path, monkeypatch):
    # the engine before it recorded nothing it took in live: what it answered before its stop would be answered again
    v, handled = agent(tmp_path, [press("q-1", 1)], monkeypatch, ready=False)
    catch_up(v, NOW - timedelta(minutes=2))
    assert handled == []
    catch_up(v, NOW - timedelta(minutes=2))                               # from the next start on, it does
    assert handled == [("press", "q-1")]


def test_the_bot_is_found_by_what_it_carries_never_by_its_name(tmp_path, monkeypatch):
    from vesta_agent.missed_at_start import bot_entities
    v, _ = agent(tmp_path, [], monkeypatch)
    assert bot_entities(v.reader) == [BOT_EVENTS]
