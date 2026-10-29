"""Talking to VESTA on the tablet (ticket 21 of "One inbox", owner 2026-10-28), through the Kiosk fake: a question typed
on a tablet is collected from the Kiosk's inbox, enters where a Telegram message does (the gate, then converse) in its
profile's own conversation, and VESTA's answer lands as a turn of that conversation — never on Telegram. A guest gets
answers only. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import base64

import pytest

from ai_fake import FakeAI
from helpers import make_agent
from ha_fake import FakeHA, tool
from kiosk_fake import FakeKiosk
from vesta_agent import tablet, tool_access
from vesta_agent.policy import TABLET_BASE

OWNER, FM = 111, 222


def policy(**extra):
    return {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner", "language": "en"},
                       {"telegram_id": FM, "name": "Wayan", "role": "fm", "language": "en"}],
            "ha_read_tools": ["ha_get_state", "ha_get_camera_image"], **extra}


@pytest.fixture
def kiosk():
    return FakeKiosk()


@pytest.fixture
def agent(tmp_path, kiosk):
    return make_agent(tmp_path, policy(), skills=["investigate"],
                      reader=FakeHA(tools=[tool("ha_get_state"), tool("ha_get_camera_image")]), kiosk=kiosk)


def collect(v) -> float:
    """One read of the Kiosk's inbox, and every question it brought answered."""
    async def go():
        pause = await v.tablet.collect(v.on_tablet)
        await v.tablet.idle()
        await v.chat_jobs.idle()
        return pause
    return asyncio.run(go())


def test_a_tablet_question_reaches_the_conversation_and_its_answer_lands_as_a_turn(agent, kiosk, monkeypatch):
    ai = FakeAI("The pool pump is on.").install(monkeypatch)
    kiosk.person_asks("owner", "Is the pool pump on?")
    collect(agent)
    assert len(ai.runs) == 1
    run = ai.runs[0]
    # entered at the conversation's entry, as the owner, told where it was written and how that place shows the answer
    assert '"""Is the pool pump on?"""' in run["prompt"] and "role owner" in run["prompt"]
    assert "wall tablet" in run["prompt"] and "apart from every Telegram chat" in run["prompt"]
    assert run["folder"].endswith(f"chats/{tablet.chat_of('owner')}")       # its own conversation, its own folder
    assert [t["text"] for t in kiosk.conversation("owner")] == ["The pool pump is on."]
    assert agent.tg.sent == []                                             # nothing reached Telegram
    # "VESTA is answering" while it worked, withdrawn once it was done (owner, 2026-10-29: a running indicator)
    typing = [t for t in kiosk.turns_pushed if t["key"] == "typing:owner"]
    assert typing[0].get("typing") is True and typing[-1].get("gone") is True, typing
    # collected once: the next read, and a restart (the last one collected is kept), never answer it again
    collect(agent)
    agent.tablet = tablet.Tablet(kiosk, agent.state)
    collect(agent)
    assert len(ai.runs) == 1 and agent.state.tablet_after() == 1


def test_each_profile_is_its_own_conversation_apart_from_telegram(agent, kiosk, monkeypatch):
    FakeAI(lambda run: "Answered.").install(monkeypatch)
    kiosk.person_asks("owner", "first")
    kiosk.person_asks("guest", "second")
    collect(agent)
    owner, guest = tablet.chat_of("owner"), tablet.chat_of("guest")
    assert owner != guest and min(owner, guest) >= TABLET_BASE      # no Telegram chat has such an id
    assert len(kiosk.conversation("owner")) == 1 and len(kiosk.conversation("guest")) == 1
    assert tablet.chat_of("boss") is None and tablet.profile_of(OWNER) is None


def test_a_guests_turn_offers_no_tool_that_acts_and_no_camera(agent, kiosk, monkeypatch):
    ai = FakeAI("ok").install(monkeypatch)
    kiosk.person_asks("guest", "Turn the pool lights on")
    kiosk.person_asks("owner", "Turn the pool lights on")
    collect(agent)
    by_role = {("guest" if "role guest" in r["prompt"] else "owner"): r["tools"] for r in ai.runs}
    assert not by_role["guest"] & tool_access.ACTS                          # no action, no approval, no fault, no report
    assert "ha_get_camera_image" not in by_role["guest"] and "ha_get_state" in by_role["guest"]   # answers, from readings
    assert {"ha_call_service", "ha_get_camera_image"} <= by_role["owner"]  # the owner's rights unchanged


def test_new_conversation_and_a_command_go_through_the_gate_as_on_telegram(agent, kiosk, monkeypatch):
    ai = FakeAI("ok").install(monkeypatch)
    chat = tablet.chat_of("owner")
    agent.state.set_session(chat, "old-session")
    kiosk.person_asks("owner", "/new")
    collect(agent)
    assert agent.state.session(chat)[0] is None and kiosk.conversation("owner")[-1]["text"] == "New conversation."
    kiosk.person_asks("owner", "/investigate")
    collect(agent)
    assert kiosk.conversation("owner")[-1]["text"].startswith("Write your question after /investigate")
    assert ai.runs == []                                                    # neither reached the AI
    kiosk.person_asks("owner", "/whoami")
    collect(agent)
    # no Telegram id to tell at the tablet: who is signed in there (it went unanswered until review R)
    assert kiosk.conversation("owner")[-1]["text"] == "You are Owner at the tablet; VESTA answers you as owner."


@pytest.mark.parametrize("typed, told", [
    ("/help", "VESTA has no /help command. Write your question in your own words."),
    ("/status now", "VESTA has no /status command. Write your question in your own words."),
    ("/ask", "Write your question after /ask."),
])
def test_what_telegram_leaves_unanswered_is_answered_on_the_tablet(agent, kiosk, monkeypatch, typed, told):
    """Architecture review R (2026-10-29): Telegram leaves a command that is not VESTA's to the villa's automations or
    another bot reading the same chat; only VESTA reads the tablet, where silence was the dots for the time a question is
    kept, then "No answer came"."""
    ai = FakeAI("ok").install(monkeypatch)
    kiosk.person_asks("owner", typed)
    collect(agent)
    assert [t["text"] for t in kiosk.conversation("owner") if t.get("text")][-1] == told
    assert ai.runs == []


def test_vesta_cannot_answer_right_now_on_the_tablet_as_on_telegram(agent, kiosk, monkeypatch):
    FakeAI("", problem="offline").install(monkeypatch)
    kiosk.person_asks("ops", "Any fault today?")   # the facility manager's profile
    collect(agent)
    assert kiosk.conversation("ops")[-1]["text"].startswith("I cannot answer right now")


def test_an_answers_pictures_and_page_go_with_it(agent, kiosk, tmp_path):
    chat = tablet.chat_of("owner")
    jpeg = base64.b64encode(b"\xff\xd8\xff camera").decode()
    page = tmp_path / "investigation.html"
    page.write_bytes(b"<!doctype html><p>Readings</p>")

    async def go():
        await agent.delivery.reply(chat, "The gate is closed.", photos=[(jpeg, "image/jpeg")])
        await agent.delivery.send(chat, "The investigation", document=str(page))
    asyncio.run(go())
    shown = kiosk.conversation("owner")
    assert shown[0]["text"] == "The gate is closed." and shown[0]["photos"] == [jpeg]     # one turn, words and picture
    assert shown[1]["page"] and kiosk.documents == [page.read_bytes()]                    # the page uploaded first
    assert agent.tg.sent == []


def test_being_prepared_is_replaced_by_the_result(tmp_path, kiosk):
    # with Telegram off: the tablet is the second place precisely for when Telegram is not there
    agent = make_agent(tmp_path, policy(), kiosk=kiosk, telegram_on=False)
    chat = tablet.chat_of("owner")
    replied = asyncio.Event()

    async def work(origin):
        await replied.wait()
        await agent.delivery.send(chat, "The weekly report", origin=origin)

    async def go():
        agent.chat_jobs.turn(chat)
        assert agent.chat_jobs.start(chat, "fm-weekly", work)
        mid = await agent.delivery.send(chat, "The weekly report is being prepared.")
        await agent.chat_jobs.replied(chat, mid)
        replied.set()
        await agent.chat_jobs.idle()
    asyncio.run(go())
    assert [t["text"] for t in kiosk.conversation("owner")] == ["The weekly report"]      # the waiting line withdrawn
    assert any(t.get("gone") for t in kiosk.turns_pushed)                                 # withdrawn, never removed


def test_an_older_kiosk_keeps_no_questions(agent, kiosk, monkeypatch):
    ai = FakeAI("ok").install(monkeypatch)
    kiosk.keeps_turns = False
    kiosk.person_asks("owner", "hello")
    assert collect(agent) == tablet.NO_INBOX_S and ai.runs == []


def test_the_owner_at_the_tablet_is_the_owner_for_an_action_that_runs_at_once(tmp_path, monkeypatch):
    # architecture review 2026-10-29 #1: the People module answers for the tablet — an action the rules let run at once
    # when a person asks ran from the owner's Telegram chat and became an approval request from the tablet
    from test_call_service_shape import StrictSession, Writer
    from vesta_agent.actions import Actions
    from vesta_agent.policy import Policy
    from vesta_agent.state import State
    monkeypatch.delenv("VESTA_HA_READ_ONLY", raising=False)
    session = StrictSession()
    pol = Policy({"act_enabled": True, "people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner"}],
                  "chats": {"owner": OWNER}, "allowed_services": {"light.turn_on": "direct"}})
    actions = Actions(lambda: pol, State(str(tmp_path / "s.db")),
                      lambda: Writer("http://unused", "UTC", write=True, session=session))
    owner, guest = tablet.chat_of("owner"), tablet.chat_of("guest")
    answer, msg = actions.request("light", "turn_on", "light.example_pool", {}, tablet.person_of("owner"), owner)
    assert msg is None and "without approval" in answer and len(session.calls) == 1        # done at once, as on Telegram
    _, msg = actions.request("light", "turn_on", "light.example_pool", {}, tablet.person_of("guest"), guest)
    assert msg is not None and len(session.calls) == 1                                     # a guest is nobody registered
    assert pol.person(owner).role == "owner" and pol.person(guest) is None
    # ...and a tablet is never sent a role's messages: it is in no role's chats, and no listed chat
    assert owner not in pol.chats_for("owner") and not pol.knows_chat(owner)


def test_the_tablet_answer_says_what_became_of_a_request_approved_on_telegram(tmp_path, monkeypatch):
    # owner, 2026-10-29: approved on Telegram, the light on, and the tablet still said "It will switch on once you press
    # Approve" — "a single message to merge both status is enough"
    from telegram_fake import BOT
    kiosk = FakeKiosk()
    v = make_agent(tmp_path, {**policy(), "act_enabled": True, "allowed_services": {"light.turn_on": "owner"},
                              "chats": {"owner": OWNER}}, kiosk=kiosk)

    class Writer:
        def call_service(self, *a):
            pass

        def states(self, ids):
            return {i: {"state": "on"} for i in ids}
    v.actions.writer_factory = Writer

    async def act(run):
        await run["call"]("ha_call_service", {"domain": "light", "service": "turn_on", "entity_id": "light.example_gym"})
    FakeAI("I've asked to turn on the gym light. It will switch on once you press Approve.", act=act).install(monkeypatch)
    kiosk.person_asks("owner", "turn on the gym light")
    collect(v)
    (answer,) = kiosk.conversation("owner")
    assert "once you press Approve" in answer["text"] and "Approved" not in answer["text"]
    # the request went to the owner's Telegram chat (the tablet shows no buttons yet): pressed there
    mid, (chat, _text, keyboard) = next((n, s) for n, s in enumerate(v.tg.sent, start=1001) if s[2])
    data = keyboard["inline_keyboard"][0][0]["callback_data"]

    async def press():
        await v.on_ha_event("telegram_callback", {"id": "cb", "data": data, "chat_id": chat, "user_id": OWNER,
                                                  "from_first": "JM", "message": {"message_id": mid, "chat": {"id": chat}},
                                                  "bot": BOT})
        await v.approvals.idle()
    asyncio.run(press())
    (told,) = kiosk.conversation("owner")                                  # ONE message, rewritten in place
    assert told["key"] == answer["key"] and "once you press Approve" in told["text"]
    import re
    assert re.fullmatch(r"I've asked to turn on the gym light\. It will switch on once you press Approve\.\nStatus:\n"
                        r"Approved on \d\d/\d\d/\d{4} \d\d:\d\d \(Owner\)\. Turned on Example gym\.", told["text"]), told["text"]
    assert v.state.approval_answer(next(iter(v.state.approvals_decided_since("2000")))["id"]) is None   # settled: forgotten


def test_the_tablet_answer_says_when_nobody_answered_the_request(tmp_path, monkeypatch):
    from datetime import datetime, timedelta, timezone
    kiosk = FakeKiosk()
    v = make_agent(tmp_path, {**policy(), "act_enabled": True, "allowed_services": {"light.turn_on": "owner"},
                              "chats": {"owner": OWNER}}, kiosk=kiosk)

    async def act(run):
        await run["call"]("ha_call_service", {"domain": "light", "service": "turn_on", "entity_id": "light.example_gym"})
    FakeAI("I've asked for approval.", act=act).install(monkeypatch)
    kiosk.person_asks("ops", "turn on the gym light")                     # the facility manager, at the tablet
    collect(v)
    assert asyncio.run(v.approvals.expire(datetime.now(timezone.utc) + timedelta(days=1))) == 1
    (told,) = kiosk.conversation("ops")
    assert told["text"].startswith("I've asked for approval.\nStatus:\nExpired on ") and "nothing was done" in told["text"]


def test_a_request_either_may_approve_asked_at_the_tablet_reaches_both_roles(tmp_path):
    # owner, 2026-10-29: "approval required by either FM or Owner, I don't see any notification on the FM Telegram chat"
    from vesta_agent.policy import Policy
    from vesta_agent.routing import Routing
    pol = Policy({"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner"},
                             {"telegram_id": FM, "name": "Wayan", "role": "fm"}]})
    r, tab = Routing(pol), tablet.chat_of("owner")
    assert r.approver_chats("any", tab) == [OWNER, FM]                    # both roles' chats, the owner's first
    assert r.approver_chats("owner", tab) == [OWNER]                      # only the owner may: the owner's alone
    assert r.approver_chats("any", FM) == [FM]                            # asked in a chat: shown there, as before


def _approval_villa(tmp_path, monkeypatch, role="any"):
    kiosk = FakeKiosk()
    v = make_agent(tmp_path, {**policy(), "act_enabled": True, "allowed_services": {"light.turn_on": role},
                              "chats": {"owner": OWNER, "fm": FM}}, kiosk=kiosk)
    done = []

    class Writer:
        def call_service(self, *a):
            done.append(a)

        def states(self, ids):
            return {i: {"state": "on"} for i in ids}
    v.actions.writer_factory = Writer

    async def act(run):
        await run["call"]("ha_call_service", {"domain": "light", "service": "turn_on", "entity_id": "light.example_gym"})
    FakeAI("I've asked for approval.", act=act).install(monkeypatch)
    kiosk.person_asks("owner", "turn on the gym light")
    collect(v)
    asyncio.run(v.messages.settle())
    (aid,) = [a["id"] for a in v.state.approvals_in("pending")]
    record = next(m for m in kiosk.messages.values() if any(b["kind"] == "a" for b in m.get("buttons") or []))
    return v, kiosk, aid, record, done


def test_approve_pressed_on_the_tablet_runs_the_same_as_on_telegram(tmp_path, monkeypatch):
    # ticket 22 of "One inbox": a tablet press enters the one table of button kinds, the same handler as Telegram's
    v, kiosk, aid, record, done = _approval_villa(tmp_path, monkeypatch)
    assert [b["label"] for b in record["buttons"]] == ["Approve", "Refuse"]          # the card on the tablet carries them
    yes = next(b for b in record["buttons"] if b["label"] == "Approve")
    press = kiosk.person_presses("owner", record["key"], yes["kind"], yes["id"])
    collect(v)
    asyncio.run(v.approvals.idle())
    assert v.state.approval(aid)["status"] == "done" and len(done) == 1             # carried out
    assert kiosk.answer("owner", press["seq"])                                       # its short answer, for the tablet
    assert any("Approved on" in line for m in kiosk.messages.values() for line in m.get("status") or [])  # every copy says so
    assert all(e[1] for e in v.tg.edits if e[0] in (OWNER, FM))                      # …Telegram's copies too


def test_a_guests_press_acts_on_nothing(tmp_path, monkeypatch):
    v, kiosk, aid, record, done = _approval_villa(tmp_path, monkeypatch)
    yes = next(b for b in record["buttons"] if b["label"] == "Approve")
    press = kiosk.person_presses("guest", record["key"], yes["kind"], yes["id"])     # (the add-on refuses it first)
    collect(v)
    assert v.state.approval(aid)["status"] == "pending" and done == []
    assert kiosk.answer("guest", press["seq"])                                       # told why, under the button


def test_with_no_telegram_chat_a_request_waits_on_the_tablet_and_is_approved_there(tmp_path, monkeypatch):
    # owner, 2026-10-29: "if no Telegram is available but Kiosk is opened with a Owner (or FM) profile: shall the
    # notification (approval) appear as notification in this UI?" — yes, with its buttons
    kiosk = FakeKiosk()
    v = make_agent(tmp_path, {"people": [], "act_enabled": True, "allowed_services": {"light.turn_on": "owner"}},
                   kiosk=kiosk, telegram_on=False)
    done = []

    class Writer:
        def call_service(self, *a):
            done.append(a)

        def states(self, ids):
            return {i: {"state": "on"} for i in ids}
    v.actions.writer_factory = Writer

    async def act(run):
        await run["call"]("ha_call_service", {"domain": "light", "service": "turn_on", "entity_id": "light.example_gym"})
    FakeAI("I've asked for approval.", act=act).install(monkeypatch)
    kiosk.person_asks("owner", "turn on the gym light")
    collect(v)
    asyncio.run(v.messages.settle())
    (aid,) = [a["id"] for a in v.state.approvals_in("pending")]                 # waiting, never "undelivered"
    card = next(m for m in kiosk.messages.values() if m.get("title") == "Approval request")
    assert [b["label"] for b in card["buttons"]] == ["Approve", "Refuse"] and card["to"] == "Owner"
    yes = card["buttons"][0]
    kiosk.person_presses("owner", card["key"], yes["kind"], yes["id"])
    collect(v)
    asyncio.run(v.approvals.idle())
    asyncio.run(v.messages.settle())
    assert v.state.approval(aid)["status"] == "done" and len(done) == 1
    settled = kiosk.messages[card["key"]]
    assert "buttons" not in settled and any("Approved on" in line for line in settled["status"])   # settled on the tablet
    assert "Approved on" in kiosk.conversation("owner")[-1]["text"]                                    # and the answer says so
