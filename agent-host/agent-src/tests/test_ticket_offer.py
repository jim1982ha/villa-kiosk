"""A fault the AI thinks of in a chat is OFFERED, never created on its own (owner, 2026-10-11: asked what happened to the
pump, the agent answered "Ticket created for the facility manager" — "I never asked for it"). The button under the
answer creates it, once; a scheduled job, with nobody to press, still creates it at once."""
from __future__ import annotations

import asyncio

from helpers import make_agent
from kiosk_fake import FakeKiosk
from telegram_fake import BOT
from vesta_agent.app import OFFER_BUTTON

JM = 111
PEOPLE = [{"telegram_id": JM, "name": "JM", "role": "owner"}]


def run(coro):
    return asyncio.run(coro)


def _asked(tmp_path, monkeypatch, *tickets):
    """JM asks a question; the AI calls create_ticket once per entry of `tickets`. (agent, Kiosk, tool answers)."""
    from ai_fake import FakeAI
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": PEOPLE}, kiosk=k)
    said = []

    async def act(call):
        for t in tickets:
            said.append(await call["call"]("create_ticket", t))
    FakeAI("The pump ran for three hours. The relay's own log would tell what started it.", act=act).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "what happened to the pump on the 9th?"))
    return v, k, said


def _press(v):
    """JM presses the button under the agent's last message (the stand-in numbers messages from 1001)."""
    mid = v.tg.next_id
    _, text, kb = v.tg.sent[-1]
    data = kb["inline_keyboard"][-1][0]["callback_data"]
    run(v.on_ha_event("telegram_callback", {"id": "cb", "data": data, "chat_id": JM, "user_id": JM, "bot": BOT,
                                            "message": {"message_id": mid, "chat": {"id": JM}, "text": text}}))


def test_a_fault_in_a_chat_is_a_button_and_only_a_press_creates_it_once(tmp_path, monkeypatch):
    v, k, said = _asked(tmp_path, monkeypatch, {"title": "Check the relay's own event log", "note": "9 Oct, 03:09"})
    assert k.tickets == []                                                  # nothing created by the answer
    assert "NOT created" in said[0]["content"][0]["text"]                   # and the AI is told so
    (_, text, kb), = v.tg.sent
    assert text.startswith("The pump ran") and kb["inline_keyboard"][-1][0]["text"] == OFFER_BUTTON
    _press(v)
    assert k.tickets == [("Check the relay's own event log", None)] and k.notes == ["9 Oct, 03:09"]
    (_, mid, edited), = v.tg.edits
    assert edited.startswith("The pump ran") and "Fault created for the facility manager by JM" in edited
    _press(v)                                                               # a second press, or a double tap
    assert len(k.tickets) == 1


def test_one_fault_per_answer(tmp_path, monkeypatch):
    v, k, said = _asked(tmp_path, monkeypatch, {"title": "One"}, {"title": "Two"})
    assert said[1].get("is_error") and "already offered" in said[1]["content"][0]["text"]
    (_, _, kb), = v.tg.sent
    assert [r[0]["text"] for r in kb["inline_keyboard"]] == [OFFER_BUTTON]


def test_a_press_the_kiosk_refuses_leaves_the_button_working(tmp_path, monkeypatch):
    v, k, _ = _asked(tmp_path, monkeypatch, {"title": "Check the float switch"})
    real = k.add_ticket

    async def down(*a, **kw):
        raise OSError("Kiosk restarting")
    k.add_ticket = down
    _press(v)
    assert k.tickets == [] and v.tg.edits == []
    k.add_ticket = real
    _press(v)
    assert k.tickets == [("Check the float switch", None)]


def test_an_answer_with_no_fault_has_no_button(tmp_path, monkeypatch):
    v, k, _ = _asked(tmp_path, monkeypatch)
    (_, _, kb), = v.tg.sent
    assert not kb and k.tickets == []


def test_a_scheduled_job_still_creates_its_fault_at_once(tmp_path):
    # nobody to press: an AI job of the night records its fault directly, as before
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": PEOPLE}, kiosk=k)
    tool = next(t for t in v.toolbox().tool_objects(None, None) if t.name == "create_ticket")
    run(tool.handler({"title": "Pool pump ran 3.0 h against 8.0 h"}))
    assert k.tickets == [("Pool pump ran 3.0 h against 8.0 h", None)]
