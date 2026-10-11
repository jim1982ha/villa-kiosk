"""A fault the AI thinks of in a chat is OFFERED, never created on its own (owner, 2026-10-11: asked what happened to the
pump, the agent answered "Ticket created for the facility manager" — "I never asked for it"). The button under the
answer creates it, once; a scheduled job, with nobody to press, still creates it at once."""
from __future__ import annotations

import asyncio

from helpers import make_agent
from kiosk_fake import FakeKiosk
from telegram_fake import BOT
from vesta_agent.app import NO_OFFER_BUTTON, OFFER_BUTTON

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


def _press(v, which=0):
    """JM presses a button under the agent's last message (0: create, 1: don't; the stand-in numbers from 1001)."""
    mid = v.tg.next_id
    _, text, kb = v.tg.sent[-1]
    data = kb["inline_keyboard"][-1][which]["callback_data"]
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


def test_dont_create_it_closes_the_offer_and_says_so(tmp_path, monkeypatch):
    # owner, 2026-10-11: "I want to also see a button NOT to create the fault"
    v, k, _ = _asked(tmp_path, monkeypatch, {"title": "Check the float switch"})
    (_, _, kb), = v.tg.sent
    assert [b["text"] for b in kb["inline_keyboard"][-1]] == [OFFER_BUTTON, NO_OFFER_BUTTON]
    _press(v, 1)
    (_, _, edited), = v.tg.edits
    assert k.tickets == [] and edited.startswith("The pump ran") and "No fault created: declined by JM" in edited
    _press(v, 0)                                                            # Create, pressed after: nothing
    assert k.tickets == []


def test_an_answer_sent_as_a_page_gets_its_offer_on_its_own_and_no_working_words(tmp_path, monkeypatch):
    # the investigate skill: the page goes with send_message and the AI writes nothing after it — the offer still comes,
    # named, and never "Now let me send the page" (the text before its last tool call)
    from ai_fake import FakeAI
    from vesta_agent import runner
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": PEOPLE}, kiosk=k)

    async def act(call):
        await call["call"]("create_ticket", {"title": "Check the float switch"})
        await call["call"]("send_message", {"to": "here", "text": "The pump ran 3 h. The page has the rest."})
    FakeAI(runner.RunResult("", None, False, 0.01, [], earlier="Now let me send the page."), act=act).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "what happened to the pump?"))
    texts = [t for _, t, _ in v.tg.sent]
    assert texts[0].endswith("The pump ran 3 h. The page has the rest.")
    (_, offer, kb), = v.tg.sent[1:]
    assert "Check the float switch" in offer and kb["inline_keyboard"][-1][0]["text"] == OFFER_BUTTON
    assert not any("Now let me" in t for t in texts)


def test_a_run_that_ended_on_a_tool_and_sent_nothing_still_answers(tmp_path, monkeypatch):
    from ai_fake import FakeAI
    from vesta_agent import runner
    v = make_agent(tmp_path, {"people": PEOPLE}, kiosk=FakeKiosk())
    FakeAI(runner.RunResult("", None, False, 0.01, [], earlier="The pump ran 3 h.")).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "what happened to the pump?"))
    assert [t for _, t, _ in v.tg.sent] == ["The pump ran 3 h."]


def _with_investigate(tmp_path):
    from helpers import copy_skill
    v = make_agent(tmp_path, {"people": PEOPLE}, kiosk=FakeKiosk())
    copy_skill("investigate", v.s.skills_dir)
    return v


def test_investigate_is_refused_without_its_command_and_given_with_it(tmp_path, monkeypatch):
    # owner, 2026-10-11: "only triggered when user mentions /investigation in the question (and never if not)"
    from ai_fake import FakeAI
    v = _with_investigate(tmp_path)
    said = []

    async def act(call):
        said.append(await call["call"]("read_skill", {"skill": "investigate"}))
        said.append(await call["call"]("run_skill_script", {"skill": "investigate", "script": "investigate.py",
                                                            "args": ["find", "--what", "pump"]}))
    ai = FakeAI("ok", act=act).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "what happened to the pump?"))
    assert all(r.get("is_error") and "/investigation" in r["content"][0]["text"] for r in said)
    sys_prompt = ai.runs[-1]["system_prompt"]
    assert "investigate (/investigation)" in sys_prompt and "Your skills:" in sys_prompt
    assert "investigate (" not in sys_prompt.split("Your skills:")[1].split("\n")[0]     # not among the AI's choices
    said.clear()
    run(v.converse(JM, v.policy().person(JM), "what happened to the pump?", invoked="investigate"))
    assert not said[0].get("is_error") and "wrote /investigation" in ai.runs[-1]["prompt"]


def test_a_continue_goes_on_with_the_skill_its_turn_was_called_for(tmp_path, monkeypatch):
    from ai_fake import FakeAI
    v = _with_investigate(tmp_path)
    said = []

    async def act(call):
        said.append(await call["call"]("read_skill", {"skill": "investigate"}))
    FakeAI("ok", act=act).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "the pump", invoked="investigate"))
    run(v.converse(JM, v.policy().person(JM), "", resume="s", is_continue=True))
    assert not said[1].get("is_error")
    run(v.converse(JM, v.policy().person(JM), "and the lights?"))                       # a new question: gone again
    assert said[2].get("is_error")
