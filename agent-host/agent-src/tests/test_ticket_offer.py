"""A fault the AI thinks of in a chat is OFFERED, never created on its own (owner, 2026-10-11: asked what happened to the
pump, the agent answered "Ticket created for the facility manager" — "I never asked for it"). The button under the
answer creates it, once; a scheduled job, with nobody to press, still creates it at once."""
from __future__ import annotations

import asyncio
import os

from helpers import make_agent
from kiosk_fake import FakeKiosk
from telegram_fake import BOT, FakeTelegram
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
    assert all(r.get("is_error") and "/investigate" in r["content"][0]["text"] for r in said)
    sys_prompt = ai.runs[-1]["system_prompt"]
    assert "investigate (/investigate)" in sys_prompt and "Your skills:" in sys_prompt
    assert "investigate (" not in sys_prompt.split("Your skills:")[1].split("\n")[0]     # not among the AI's choices
    said.clear()
    before = len(ai.runs)
    run(v.converse(JM, v.policy().person(JM), "what happened to the pump?", invoked="investigate"))
    assert not said[0].get("is_error") and "wrote /investigate" in ai.runs[before]["prompt"]


def test_a_continue_goes_on_with_the_skill_its_turn_was_called_for(tmp_path, monkeypatch):
    # review 32: kept per chat, a "thanks" between a stopped /investigate and its Continue lost the skill
    from ai_fake import FakeAI
    v = _with_investigate(tmp_path)
    said = []
    runs = []

    async def act(call):
        runs.append(call)
        said.append(await call["call"]("read_skill", {"skill": "investigate"}))
    from vesta_agent import runner
    stop = {"now": True}
    ai = FakeAI(lambda call: runner.RunResult("ok", "sess-1", stop["now"], 0.01, []), act=act).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "the pump", invoked="investigate"))      # stops at its limit
    (cont_data,) = [b["callback_data"] for _, _, kb in v.tg.sent if kb for row in kb["inline_keyboard"] for b in row
                    if b["callback_data"].startswith("c:")]
    stop["now"] = False
    run(v.converse(JM, v.policy().person(JM), "thanks"))                                 # a word in between
    assert said[-1].get("is_error")                                                      # (not an investigation)
    run(v.on_ha_event("telegram_callback", {"id": "cb", "data": cont_data, "chat_id": JM, "user_id": JM, "bot": BOT,
                                            "message": {"message_id": 1001, "chat": {"id": JM}, "text": "x"}}))
    assert not said[-1].get("is_error")                                                  # the Continue: still investigating

def test_a_command_starts_a_fresh_conversation_so_nothing_earlier_is_reused(tmp_path, monkeypatch):
    # owner, 2026-10-11 20:00: "/investigation …" was answered in 19 s from the chat's earlier answer — no reading, no page
    from ai_fake import FakeAI
    from vesta_agent import runner
    v = _with_investigate(tmp_path)
    ai = FakeAI(runner.RunResult("ok", "sess-new", False, 0.01, [])).install(monkeypatch)
    v.state.set_session(JM, "sess-earlier")
    run(v.converse(JM, v.policy().person(JM), "the pump", invoked="investigate"))
    assert ai.runs[0]["resume"] is None                                     # (the page's follow-up, if any, resumes it)
    run(v.converse(JM, v.policy().person(JM), "and why at 03:09?"))          # the follow-up goes on from the investigation
    assert ai.runs[-1]["resume"] == "sess-new"


# ---- every /investigate answer carries its page and the fault buttons (owner, 2026-10-11: "make sure this always
# trigger the full use of the skill — HTML report in the response and buttons to create and cancel a ticket creation")
def _investigating(tmp_path, monkeypatch, *, page_on_run=(1,), offer=False):
    """JM writes /investigate; the AI sends the page on the runs listed in `page_on_run` (1 = its first), saves the
    account, and offers a fault itself only when `offer`. (agent, the AI stand-in)"""
    import json as _json
    from ai_fake import FakeAI
    v = _with_investigate(tmp_path)
    out = v.s.in_folder(f"chats/{JM}").out_dir
    os.makedirs(out, exist_ok=True)
    runs = []

    async def act(call):
        runs.append(call["prompt"])
        if len(runs) == 1:
            await call["call"]("save_file", {"name": "investigation.json", "content": _json.dumps(
                {"title": "Water heater on the night of 9 October", "summary": "It ran 3 h; check the pipes."})})
            if offer:
                await call["call"]("create_ticket", {"title": "Check the float switch"})
        if len(runs) in page_on_run:
            open(os.path.join(out, "investigation.html"), "w").write("<html></html>")
            await call["call"]("send_message", {"to": "here", "text": "It ran 3 h. The page has the rest.",
                                                "attachment": "investigation.html"})
    # told to write nothing after the page, it writes a long message anyway (the villa, 20:20)
    ai = FakeAI("I've completed a thorough investigation. Key finding: …", act=act).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "the heater on the 9th", invoked="investigate"))
    return v, runs


def test_an_investigation_that_sent_its_page_gets_the_buttons_from_its_own_account(tmp_path, monkeypatch):
    v, runs = _investigating(tmp_path, monkeypatch)
    assert len(runs) == 1                                                   # nothing missing: no second turn
    # owner, 2026-10-11 20:20: "it shall be all in 1 message" — the page's message, its buttons under it, nothing else
    (page,) = v.tg.sent
    assert page[1].endswith("It ran 3 h. The page has the rest.") and not any("thorough" in t for _, t, _ in v.tg.sent)
    (_, mid, kb), = v.tg.buttoned
    assert mid == v.tg.next_id and [b["text"] for b in kb["inline_keyboard"][-1]] == [OFFER_BUTTON, NO_OFFER_BUTTON]
    offer = v.state.claim_ticket_offer(kb["inline_keyboard"][-1][0]["callback_data"].split(":")[1], JM)
    assert offer["title"] == "Water heater on the night of 9 October"     # offered by the engine, from the account


def test_an_investigation_that_forgot_its_page_is_sent_back_to_it_once(tmp_path, monkeypatch):
    v, runs = _investigating(tmp_path, monkeypatch, page_on_run=(2,), offer=True)
    assert len(runs) == 2 and "has not sent investigation.html" in runs[1]
    (_, _, kb), = v.tg.buttoned
    assert len(kb["inline_keyboard"]) == 1                                  # the AI's own offer: no second one
    assert v.state.claim_ticket_offer(kb["inline_keyboard"][0][0]["callback_data"].split(":")[1], JM)["title"] == \
        "Check the float switch"


def test_an_investigation_that_never_makes_its_page_says_so(tmp_path, monkeypatch):
    v, runs = _investigating(tmp_path, monkeypatch, page_on_run=())
    assert len(runs) == 2
    assert any("The report page could not be made this time." in t for _, t, _ in v.tg.sent)
    assert any(kb for _, _, kb in v.tg.sent)                                 # the buttons all the same


def test_buttons_telegram_refuses_on_the_page_come_on_their_own(tmp_path, monkeypatch):
    # editMessageReplyMarkup refused: the offer is not lost, it comes as its own short message, named
    real = FakeTelegram.buttons

    async def refused(self, chat_id, message_id, keyboard):
        return False
    monkeypatch.setattr(FakeTelegram, "buttons", refused)
    v, runs = _investigating(tmp_path, monkeypatch)
    assert len(v.tg.sent) == 2 and v.tg.sent[1][2]                         # the page, then the offer with its buttons
    assert "Water heater on the night of 9 October" in v.tg.sent[1][1]
    monkeypatch.setattr(FakeTelegram, "buttons", real)


# ---- the fault created from an investigation keeps its report (owner, 2026-10-11: "make sure the fault ticket has the
# HTML report in attachment in it")
def _press_create_under_the_page(v):
    (_, mid, kb), = v.tg.buttoned
    data = kb["inline_keyboard"][-1][0]["callback_data"]
    run(v.on_ha_event("telegram_callback", {"id": "cb", "data": data, "chat_id": JM, "user_id": JM, "bot": BOT,
                                            "message": {"message_id": mid, "chat": {"id": JM}, "caption": "x"}}))


def test_the_fault_created_from_an_investigation_carries_its_report(tmp_path, monkeypatch):
    v, _ = _investigating(tmp_path, monkeypatch)
    k = v.kiosk
    _press_create_under_the_page(v)
    assert k.tickets == [("Water heater on the night of 9 October", None)]
    assert k.documents == [b"<html></html>"] and k.ticket_documents == [["d1"]]


def test_a_later_investigation_never_swaps_the_report_of_an_earlier_offer(tmp_path, monkeypatch):
    v, _ = _investigating(tmp_path, monkeypatch)
    out = v.s.in_folder(f"chats/{JM}").out_dir
    open(os.path.join(out, "investigation.html"), "w").write("<html>another night</html>")    # the next one's page
    _press_create_under_the_page(v)
    assert v.kiosk.documents == [b"<html></html>"]


def test_a_kiosk_that_holds_no_documents_still_gets_the_fault_and_says_why(tmp_path, monkeypatch):
    v, _ = _investigating(tmp_path, monkeypatch)
    v.kiosk.documents = None                                                 # a Kiosk older than 2.496.326
    _press_create_under_the_page(v)
    assert v.kiosk.tickets and v.kiosk.ticket_documents == [[]]
    assert "could not be attached: this VESTA Kiosk cannot hold it yet" in v.kiosk.notes[0]


def test_the_real_kiosk_client_writes_the_document_ids_into_the_new_fault():
    # the stand-in above keeps them aside: here the record the real client writes to the Kiosk's Facility data
    from vesta_agent.kiosk import Kiosk
    k, data = Kiosk("http://kiosk", "token"), {"tickets": []}

    async def edit(change):
        return change(data)
    k._edit = edit
    run(k.add_ticket("Water heater on the night of 9 October", document_ids=["d1"]))
    (t,) = data["tickets"]
    assert t["documentIds"] == ["d1"] and t["photoIds"] == []
    run(k.add_ticket("Another fault"))
    assert "documentIds" not in data["tickets"][1]                         # none: the field is not written at all


# ---- review 32: the fault offer's own faults
def test_a_press_on_a_page_message_keeps_its_decision_within_the_caption(tmp_path, monkeypatch):
    # the caption of an investigation is ~1,000 characters: rendered at 4,096 and cut at 1,024, the decision was lost
    from vesta_agent.telegram import CAPTION
    v, _ = _investigating(tmp_path, monkeypatch)
    (_, mid, kb), = v.tg.buttoned
    data = kb["inline_keyboard"][-1][0]["callback_data"]
    caption = "Water heater on the night of 9 October\\nTo: JM\\n" + "It ran. " * 120
    run(v.on_ha_event("telegram_callback", {"id": "cb", "data": data, "chat_id": JM, "user_id": JM, "bot": BOT,
                                            "message": {"message_id": mid, "chat": {"id": JM}, "caption": caption}}))
    (_, _, edited), = v.tg.edits
    assert len(edited) <= CAPTION and edited.endswith("Fault created for the facility manager by JM: "
                                                      "Water heater on the night of 9 October")


def test_an_offer_whose_answer_telegram_refused_is_shown_with_the_next_answer(tmp_path, monkeypatch):
    v, k, _ = _asked(tmp_path, monkeypatch, {"title": "Check the float switch"})
    assert not v.state.pending_offers(JM)                                   # delivered: shown
    from ai_fake import FakeAI
    v2 = make_agent(tmp_path / "b", {"people": PEOPLE}, kiosk=FakeKiosk())
    v2.tg.refuse = {"send"}

    async def act(call):
        await call["call"]("create_ticket", {"title": "Check the float switch"})
    FakeAI("answer", act=act).install(monkeypatch)
    run(v2.converse(JM, v2.policy().person(JM), "the pump?"))
    assert [o["title"] for o in v2.state.pending_offers(JM)] == ["Check the float switch"]   # not lost


def test_an_investigation_offers_one_fault_even_across_its_continue(tmp_path, monkeypatch):
    # review 32: the AI offered a fault and hit its limit; on Continue the engine offered a second one
    from ai_fake import FakeAI
    from vesta_agent import runner
    v = _with_investigate(tmp_path)
    out = v.s.in_folder(f"chats/{JM}").out_dir
    os.makedirs(out, exist_ok=True)
    stop = {"now": True}

    async def act(call):
        if stop["now"]:
            await call["call"]("create_ticket", {"title": "Check the float switch"})
        else:
            open(os.path.join(out, "investigation.html"), "w").write("<!doctype html>")
            await call["call"]("send_message", {"to": "here", "text": "Done.", "attachment": "investigation.html"})
    FakeAI(lambda call: runner.RunResult("", "sess-1", stop["now"], 0.01, []), act=act).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "the pump", invoked="investigate"))
    (cont,) = [b["callback_data"] for _, _, kb in v.tg.sent if kb for row in kb["inline_keyboard"] for b in row
               if b["callback_data"].startswith("c:")]
    stop["now"] = False
    run(v.on_ha_event("telegram_callback", {"id": "cb", "data": cont, "chat_id": JM, "user_id": JM, "bot": BOT,
                                            "message": {"message_id": 1001, "chat": {"id": JM}, "text": "x"}}))
    offers = v.state.db.execute("select title from ticket_offers").fetchall()
    assert [o[0] for o in offers] == ["Check the float switch"]


def test_an_earlier_investigations_account_never_titles_a_new_offer(tmp_path, monkeypatch):
    import json as _json
    import time as _time
    from ai_fake import FakeAI
    v = _with_investigate(tmp_path)
    out = v.s.in_folder(f"chats/{JM}").out_dir
    os.makedirs(out, exist_ok=True)
    old = os.path.join(out, "investigation.json")
    open(old, "w").write(_json.dumps({"title": "Last week's gate", "summary": "old"}))
    os.utime(old, (1, _time.time() - 3600))

    async def act(call):                                                     # this time no account is saved
        open(os.path.join(out, "investigation.html"), "w").write("<!doctype html>")
        await call["call"]("send_message", {"to": "here", "text": "Done.", "attachment": "investigation.html"})
    FakeAI("", act=act).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "the pump on the 9th", invoked="investigate"))
    (_, _, kb), = v.tg.buttoned
    offer = v.state.claim_ticket_offer(kb["inline_keyboard"][0][0]["callback_data"].split(":")[1], JM)
    assert offer["title"] == "Check on site: the pump on the 9th"


def test_a_follow_up_stopped_at_its_limit_leaves_a_continue_not_a_wrong_reason(tmp_path, monkeypatch):
    # review 32: merged by hand, the follow-up's stop was lost — no Continue, and "the page could not be made"
    from ai_fake import FakeAI
    from vesta_agent import runner
    v = _with_investigate(tmp_path)
    runs = []
    FakeAI(lambda call: runs.append(1) or runner.RunResult("", "sess-1", len(runs) == 2, 0.01, [])).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "the pump", invoked="investigate"))
    assert len(runs) == 2                                                    # the page missing: one follow-up
    texts = [t for _, t, _ in v.tg.sent]
    assert not any("could not be made" in t for t in texts)
    assert any(b["callback_data"].startswith("c:") for _, _, kb in v.tg.sent if kb for row in kb["inline_keyboard"]
               for b in row)


def test_the_command_alone_shows_the_skills_own_example_and_off_says_so(tmp_path):
    v = _with_investigate(tmp_path)
    run(v.on_ha_event("telegram_command", {"chat_id": JM, "user_id": JM, "command": "/investigate", "args": []}))
    assert v.tg.sent[-1][1] == "Write your question after /investigate, for example: " \
        "/investigate why did the water heater stop last night?."
    import yaml
    raw = yaml.safe_load(open(v.s.policy_path))
    raw["skills_off"] = ["investigate"]                                      # switched off on the Agent page
    with open(v.s.policy_path, "w") as f:
        yaml.safe_dump(raw, f)
    os.utime(v.s.policy_path, (1, os.path.getmtime(v.s.policy_path) + 5))
    run(v.on_ha_event("telegram_command", {"chat_id": JM, "user_id": JM, "command": "/investigate", "args": ["x"]}))
    assert "The investigate skill is switched off on this villa" in v.tg.sent[-1][1]


def test_web_research_is_switched_by_the_persons_own_words(tmp_path, monkeypatch):
    # owner, 2026-10-11: web research "only if the user mention it in the request" — the engine matches the words the
    # skill declares; the AI is told ON or off
    from ai_fake import FakeAI
    v = _with_investigate(tmp_path)
    ai = FakeAI("ok").install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "why did the heater stop?", invoked="investigate"))
    assert "Web research: off" in ai.runs[0]["prompt"] and "Web research: ON" not in ai.runs[0]["prompt"]
    n = len(ai.runs)
    run(v.converse(JM, v.policy().person(JM), "why did the heater stop? you can use internet", invoked="investigate"))
    assert "Web research: ON" in ai.runs[n]["prompt"]
    n = len(ai.runs)
    run(v.converse(JM, v.policy().person(JM), "see the website of the heater", invoked="investigate"))
    assert "Web research: off" in ai.runs[n]["prompt"]                      # a word, never part of one
