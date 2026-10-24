"""The villa's own messages — a doorbell, a camera — sent in English by its automations, then drawn again by the agent in
each chat's language (owner, 2026-10-24: "the villa keeps sending English instantly, and the Agent then rewrites the
message in the group's language. If the Agent is down, the English one stays"). Synthetic villa; ids and names
invented."""
from __future__ import annotations

import asyncio

from ai_fake import FakeAI
from telegram_fake import BOT
from test_alert_translation import FM_FR, GROUP, run, translator, villa
from vesta_agent.ha_events import CONTEXT_KEY
from vesta_agent.villa_messages import keyboard, shape

RING = ("<b>🔔 Visitor at Parking Doorbell</b>\nTo: Owner &amp; FM\n<blockquote>Someone is at the door.</blockquote>\n\n"
        "Status:\n<blockquote><i>⚠️ New alert</i></blockquote>")
OPENED = ("<b>🔔 Visitor at Parking Doorbell</b>\nTo: Owner &amp; FM\n<blockquote>Someone is at the door.</blockquote>"
          "\n\nStatus:\n<blockquote><i>✅ Opened at 09:03:27 at the gate</i></blockquote>")
GATE = [[["🔓 Unlock Gate", "/unlock_gate"]]]


async def settle(v):
    while v._villa_tasks:
        await asyncio.gather(*list(v._villa_tasks), return_exceptions=True)
    await v.translations.idle()


async def ring(v, chat=FM_FR, mid=700, ctx="RING-1"):
    await v.on_ha_event("telegram_sent", {"chat_id": chat, "message_id": mid, "bot": BOT, CONTEXT_KEY: ctx})
    await v.on_ha_event("vesta_message", {"message": RING, "buttons": GATE, CONTEXT_KEY: ctx})


def test_the_villas_doorbell_is_drawn_again_in_the_chats_language_and_keeps_its_button(tmp_path, monkeypatch):
    v = villa(tmp_path)
    ai = FakeAI(translator).install(monkeypatch)

    async def go():
        await ring(v)
        await settle(v)
    run(go())
    (chat, mid, text), = v.tg.edits
    assert (chat, mid) == (FM_FR, 700)
    assert text.startswith("(fr) 🔔 Visitor at Parking Doorbell\nTo: Owner & FM\n"), text
    assert "(fr) Someone is at the door." in text and "Statut:" in text and "(fr) ⚠️ New alert" in text
    # its Unlock button kept: an edit without it would have removed it
    assert v.tg.edit_keyboards == [{"inline_keyboard": [[{"text": "🔓 Unlock Gate", "callback_data": "/unlock_gate"}]]}]
    assert len(ai.runs) == 1 and "Someone is at the door." in ai.runs[0]["prompt"]


def test_an_english_chat_is_left_as_the_villa_wrote_it_and_nothing_is_asked(tmp_path, monkeypatch):
    v = villa(tmp_path)
    ai = FakeAI(translator).install(monkeypatch)

    async def go():
        await ring(v, chat=GROUP)
        await settle(v)
    run(go())
    assert v.tg.edits == [] and ai.runs == []


def test_the_gate_opened_before_the_translation_came_is_never_drawn_over(tmp_path, monkeypatch):
    # the latest words win: "Opened at 09:03:27" written by the villa's rewrite, then its own translation
    v = villa(tmp_path)
    FakeAI(translator).install(monkeypatch)

    async def go():
        await ring(v)
        await v.on_ha_event("vesta_message", {"message": OPENED, "messages": [{"chat_id": FM_FR, "message_id": 700}],
                                              CONTEXT_KEY: "RING-1b"})
        await settle(v)
    run(go())
    last = [t for c, m, t in v.tg.edits if (c, m) == (FM_FR, 700)][-1]
    assert "(fr) ✅ Opened at 09:03:27 at the gate" in last and "New alert" not in last
    assert not [t for c, m, t in v.tg.edits if "New alert" in t]
    assert v.tg.edit_keyboards[-1] is None                    # opened: its button gone, as the villa's rewrite left it


def test_a_failed_translation_leaves_the_villas_english(tmp_path, monkeypatch):
    v = villa(tmp_path)

    def broken(run_):
        raise RuntimeError("no credit")
    FakeAI(broken).install(monkeypatch)

    async def go():
        await ring(v)
        await settle(v)
    run(go())
    assert v.tg.edits == []


def test_a_message_the_agent_already_owns_is_left_to_its_incident(tmp_path, monkeypatch):
    v = villa(tmp_path)
    FakeAI(translator).install(monkeypatch)
    v.state.remember_message(FM_FR, 700)

    async def go():
        await ring(v)
        await settle(v)
    run(go())
    assert v.tg.edits == []


def test_the_villas_layout_is_read_whatever_its_tags():
    assert shape(RING) == ("🔔 Visitor at Parking Doorbell", "Owner & FM", ["Someone is at the door."], ["⚠️ New alert"])
    assert shape("Just a line") == ("", "", [], [])
    assert keyboard([["A", "/a"], ["B", "/b"]]) == {"inline_keyboard": [[{"text": "A", "callback_data": "/a"},
                                                                         {"text": "B", "callback_data": "/b"}]]}
    assert keyboard([]) is None


def test_a_message_an_incident_takes_over_while_its_translation_runs_is_left_to_the_incident(tmp_path, monkeypatch):
    # a VESTA rule's own message: its incident takes it over (Outcome.adopt_ha) while this translation is on its way
    v = villa(tmp_path)
    FakeAI(translator).install(monkeypatch)
    asked = v.translations.then

    def then(want, fn):
        v.state.remember_message(FM_FR, 700)
        asked(want, fn)
    monkeypatch.setattr(v.translations, "then", then)

    async def go():
        await ring(v)
        await settle(v)
    run(go())
    assert v.tg.edits == []


def test_a_villa_message_already_translated_once_asks_the_ai_nothing_again(tmp_path, monkeypatch):
    # owner, 2026-10-24: "using the AI only the first time, when it is not already in the agent's cache": the second
    # ring, its gate opened at another time, is drawn from the kept translations, with no AI run
    v = villa(tmp_path)
    ai = FakeAI(translator).install(monkeypatch)
    opened_later = OPENED.replace("09:03:27", "17:42:05")

    async def go():
        await ring(v)
        await v.on_ha_event("vesta_message", {"message": OPENED, "messages": [{"chat_id": FM_FR, "message_id": 700}],
                                              CONTEXT_KEY: "RING-1b"})
        await settle(v)
        first = len(ai.runs)
        await ring(v, mid=701, ctx="RING-2")
        await v.on_ha_event("vesta_message", {"message": opened_later,
                                              "messages": [{"chat_id": FM_FR, "message_id": 701}], CONTEXT_KEY: "RING-2b"})
        await settle(v)
        return first
    first = run(go())
    assert first >= 1 and len(ai.runs) == first, ai.runs
    last = [t for c, m, t in v.tg.edits if (c, m) == (FM_FR, 701)][-1]
    assert "(fr) ✅ Opened at 17:42:05 at the gate" in last
