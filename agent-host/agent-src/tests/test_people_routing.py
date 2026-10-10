"""People is the one list of where the agent posts (owner, 2026-10-10).

"each messages it has to sent shall be by design sent to either the Owner profiles or the Facility Manager profiles,
based on what People configuration is set": a message for a role goes to every chat listed with it — a person's
private chat or a group — and every copy updates together. The Chats card (one chat per role) is gone; an older
file's `chats:` is still read, and the page moves it into People at its next save."""
from __future__ import annotations

import asyncio
import re

import pytest

import yaml

from helpers import body, make_agent, settings
from telegram_fake import BOT
from vesta_agent import button_data, status, tool_access
from vesta_agent.delivery import Delivery
from vesta_agent.notice import Notices
from vesta_agent.policy import Policy
from vesta_agent.state import State
from vesta_agent.ui import policy_doc

JM, FABIEN, GROUP = 111, 222, -100333
# the owner's own example: two people each in both roles, and the group in both roles too
PEOPLE = [{"telegram_id": JM, "name": "JM_FM", "role": "fm"}, {"telegram_id": FABIEN, "name": "Fabien_O", "role": "owner"},
          {"telegram_id": FABIEN, "name": "Fabien_FM", "role": "fm"}, {"telegram_id": JM, "name": "JM_O", "role": "owner"},
          {"telegram_id": GROUP, "name": "Group_O", "role": "owner"}, {"telegram_id": GROUP, "name": "Group_FM", "role": "fm"}]


def run(c):
    return asyncio.run(c)


def test_a_message_for_a_role_reaches_every_chat_of_it_once_under_its_heading(tmp_path):
    v = make_agent(tmp_path, {"people": PEOPLE})
    done = run(v.outcome.carry_out({"send": [{"to": "fm", "text": "Pool pump offline."}]}))
    assert done["sent"] == 3 and [c for c, _, _ in v.tg.sent] == [JM, FABIEN, GROUP]
    # who it is for: the PEOPLE of the role, never the group they read it in
    # a private chat names its own person, a group every person of the role (owner, 2026-10-10)
    heads = {c: t.split("\n")[0] for c, t, _ in v.tg.sent}
    assert heads == {JM: "For: JM_FM", FABIEN: "For: Fabien_FM", GROUP: "For: JM_FM, Fabien_FM"}
    assert all(body(t) == "Pool pump offline." for _, t, _ in v.tg.sent)
    v.tg.sent.clear()
    run(v.outcome.carry_out({"send": [{"to": "owner", "text": "Siren off."}, {"to": "fm", "text": "Siren off."}]}))
    assert sorted(c for c, _, _ in v.tg.sent) == sorted([JM, FABIEN, GROUP])     # for both roles: once per chat


def test_an_approval_for_the_owner_reaches_every_chat_where_the_owner_can_press_and_one_press_settles_them_all(tmp_path):
    v = make_agent(tmp_path, {"people": PEOPLE, "act_enabled": True, "allowed_services": {"light.turn_on": "owner"}})
    answer, msg = v.actions.request("light", "turn_on", "light.pool", {}, None, None)
    # architecture review 21: never the group listed for both roles — everyone there acts as its Facility manager
    # (owner, 2026-10-10), so its buttons only answered "Only the owner can approve this."
    assert msg and msg.chats == [FABIEN, JM]
    assert run(v.outcome.ask(msg)) == 2
    aid = msg.approval_id
    in_private = next(n for n, (c, _t, _k) in enumerate(v.tg.sent, start=1001) if c == FABIEN)
    press = {"id": "cb2", "data": button_data.make(button_data.APPROVAL, aid, "n"), "chat_id": FABIEN, "user_id": FABIEN,
             "message": {"message_id": in_private, "chat": {"id": FABIEN}, "text": msg.text}, "bot": BOT}
    run(v.on_ha_event("telegram_callback", press))            # in his own private chat Fabien is the Owner he is listed as
    # every copy, in every chat, says who refused and when — its buttons gone (one mechanism: incident_thread.py)
    assert sorted(c for c, _, _ in v.tg.edits) == sorted([FABIEN, JM])
    assert all(re.search(r"\n-------\nRefused by Fabien_O on \d\d/\d\d/\d{4} \d\d:\d\d\. Nothing was done\.$", t)
               for _, _, t in v.tg.edits)


def test_a_group_listed_for_both_roles_cannot_press_an_owners_request(tmp_path):
    # the rule where the buttons go and the rule who may press them are one answer (Policy.may_approve_in)
    pol = Policy({"people": PEOPLE})
    assert not pol.may_approve_in(GROUP, "owner") and pol.may_approve_in(GROUP, "any")
    assert pol.may_approve_in(JM, "owner") and pol.may_approve_in(FABIEN, "owner")
    rows = [{"telegram_id": GROUP, "name": "Group_O", "role": "owner"}, {"telegram_id": GROUP, "name": "Group_FM", "role": "fm"}]
    from vesta_agent.routing import Routing
    assert Routing(Policy({"people": rows})).approver_chats("owner", None) == []
    v = make_agent(tmp_path, {"people": rows, "act_enabled": True, "allowed_services": {"light.turn_on": "owner"}})
    answer, msg = v.actions.request("light", "turn_on", "light.pool", {}, None, None)
    assert msg is None and answer.startswith("Refused: no chat in People where the owner can approve it")


def test_an_older_files_chats_still_route_and_the_page_moves_them_into_people(tmp_path):
    old = {"people": [{"telegram_id": JM, "name": "JM", "role": "owner"}], "chats": {"owner": GROUP, "fm": 444}}
    p = Policy(old)
    assert p.chats_for("owner") == [JM, GROUP] and p.chats_for("fm") == [444] and not p.problems
    assert p.person(444) is None                    # a chat of the old card is where to post, never a person
    text = yaml.safe_dump(old)
    form = policy_doc.to_form(text)
    # architecture review 18: a row of People with a positive id IS a person — the old card's private chat of nobody
    # listed (444) stays in `chats:`, still posted to, never registered; the group becomes a row
    assert [(r["telegram_id"], r["role"]) for r in form["people"]] == [(JM, "owner"), (GROUP, "owner")]
    saved = yaml.safe_load(policy_doc.apply_form(text, form))
    assert saved["chats"] == {"fm": 444} and Policy(saved).person(444) is None
    assert sorted(Policy(saved).destinations) == sorted(p.destinations)
    # a chat of someone already listed (their other role) becomes their row; nothing is left behind
    mine = yaml.safe_dump({"people": [{"telegram_id": JM, "name": "JM", "role": "owner"}], "chats": {"fm": JM}})
    saved = yaml.safe_load(policy_doc.apply_form(mine, policy_doc.to_form(mine)))
    assert "chats" not in saved and Policy(saved).chats_for("fm") == [JM]


def test_a_chat_telegram_refuses_is_named_on_the_overview_until_a_message_arrives(tmp_path):
    from telegram_fake import FakeTelegram
    s = settings(str(tmp_path))
    st, tg, pol = State(s.state_path), FakeTelegram(), Policy({"people": PEOPLE})
    d = Delivery(tg, st, lambda: pol)
    tg.refuse.add("send")                                   # not the chat: the network, a refused message
    assert run(d.send(FABIEN, "x")) is None and status.unreachable(st, pol) == []
    tg.refuse = {"blocked"}                                 # Telegram refuses the CHAT: Fabien never sent /start
    assert run(d.send(FABIEN, "x")) is None
    (line,) = status.unreachable(st, pol)
    assert line.startswith("Fabien_O / Fabien_FM: Telegram refused the last message") and "/start" in line
    tg.refuse.clear()
    assert run(d.send(FABIEN, "x")) and status.unreachable(st, pol) == []


def test_only_telegrams_refusal_of_a_chat_counts_as_unreachable():
    # architecture review 18: a network blip at 01:30 left "send /start" on the Overview all day
    from vesta_agent.telegram import _failed
    assert _failed("sendMessage", {"error_code": 403, "description": "Forbidden: bot was blocked by the user"}).refused
    assert _failed("sendMessage", {"error_code": 400, "description": "Bad Request: chat not found"}).refused
    assert not _failed("sendMessage", {"error_code": 400, "description": "Bad Request: can't parse entities"}).refused
    assert not _failed("sendMessage", {"error_code": 429, "description": "Too Many Requests"}).refused


def test_in_a_private_chat_the_persons_own_role_decides_in_a_group_the_least(tmp_path):
    pol = Policy({"people": PEOPLE, "tool_access": {"fm": {"cameras": False}}})
    tools = [{"name": "ha_get_camera_image", "annotations": {"readOnlyHint": True}}]
    pol_tools = {**pol.raw, "ha_read_tools": ["ha_get_camera_image"]}
    pol = Policy(pol_tools)
    owner = pol.person(JM).role
    assert owner == "owner"
    # JM, owner and facility manager, in his own chat: the owner's tools (before, it was "the fm chat" and cut them)
    assert "ha_get_camera_image" in tool_access.allowed_for(pol, tools, owner, JM)
    # the group the facility managers read: never more than the facility manager may use
    assert "ha_get_camera_image" not in tool_access.allowed_for(pol, tools, owner, GROUP)


def test_the_for_line_names_the_role_the_message_is_for(tmp_path):
    s = settings(str(tmp_path))
    n = Notices(State(s.state_path), lambda: Policy({"people": PEOPLE}), "UTC")
    assert n.heading(JM, to="owner") == "For: JM_O"                   # his own chat: him, never Fabien
    assert n.heading(GROUP, to="fm") == "For: JM_FM, Fabien_FM"
    alone = Notices(State(s.state_path), lambda: Policy({"people": [PEOPLE[4]]}), "UTC")
    assert alone.heading(GROUP, to="owner") == "For: the Owner"          # a group alone: its role, capitalised


def test_a_chat_listed_for_both_roles_is_headed_for_both(tmp_path):
    # architecture review 18: the one copy kept for a group of both roles was headed for the owner's people only
    v = make_agent(tmp_path, {"people": [{"telegram_id": JM, "name": "JM_O", "role": "owner"},
                                         {"telegram_id": FABIEN, "name": "Fabien_FM", "role": "fm"},
                                         {"telegram_id": GROUP, "name": "Group_O", "role": "owner"},
                                         {"telegram_id": GROUP, "name": "Group_FM", "role": "fm"}]})
    run(v.outcome.carry_out({"send": [{"to": "owner", "text": "Door unlocked."}, {"to": "fm", "text": "Door unlocked."}]}))
    heads = {c: t.split("\n")[0] for c, t, _ in v.tg.sent}
    assert heads == {JM: "For: JM_O", GROUP: "For: JM_O, Fabien_FM", FABIEN: "For: Fabien_FM"}


def test_the_agents_own_approvals_and_warnings_carry_the_heading_in_every_chat(tmp_path):
    # architecture review 18: approvals and "the siren cannot be requested" went without the heading
    v = make_agent(tmp_path, {"people": PEOPLE, "act_enabled": True,
                              "allowed_services": {"light.turn_on": "owner", "cover.open_cover": "any"}})
    _, msg = v.actions.request("light", "turn_on", "light.pool", {}, None, None)
    run(v.outcome.ask(msg))
    assert {c: t.split("\n")[0] for c, t, _ in v.tg.sent} == {FABIEN: "For: Fabien_O", JM: "For: JM_O"}
    v.tg.sent.clear()
    _, msg = v.actions.request("cover", "open_cover", "cover.pool", {}, v.policy().person(JM), JM)
    run(v.outcome.ask(msg))
    (chat, text, _), = v.tg.sent
    # asked here, and still in the agent's layout (owner, 2026-10-10): heading, the action, then where it stands
    assert chat == JM and text.startswith("For: ") and re.search(
        r"\n-------\nWaiting for approval by the owner or the facility manager \(asked on \d\d/\d\d/\d{4} \d\d:\d\d, "
        r"expires in 15 min\)\.$", text)


def test_an_unreadable_rules_file_keeps_the_last_good_rules_and_the_siren_that_sounds_stops(tmp_path):
    from vesta_agent.siren import Siren
    from datetime import datetime, timedelta, timezone
    v = make_agent(tmp_path, {"people": PEOPLE, "siren_entity": "switch.siren_a"})
    assert v.policy().chats_for("owner")
    T0 = datetime(2026, 10, 10, 22, 0, tzinfo=timezone.utc)
    v.siren.executed("switch", "turn_on", ["switch.siren_a"], now=T0)
    import os
    import time
    with open(v.s.policy_path, "w") as f:
        f.write('people: [{"telegram_id": 1, name: "unclosed}]\n')            # one quote left open, by hand
    os.utime(v.s.policy_path, (time.time() + 5, time.time() + 5))
    assert v.policy().chats_for("owner") == [FABIEN, JM, GROUP]         # the last good rules, never empty ones
    calls = []
    v.actions.system = lambda d, s, e, data=None, siren=None: calls.append((d, s, e, siren)) or True
    assert run(v.siren.tick(T0 + timedelta(minutes=5)))
    assert calls == [("switch", "turn_off", "switch.siren_a", "switch.siren_a")]
    # another siren chosen while one sounds: the stop is still for the one turned on, and the rules allow it
    from vesta_agent.policy import Policy as P
    other = P({"siren_entity": "switch.siren_b"})
    assert other.check_service("switch", "turn_off", "switch.siren_a", system=True, siren="switch.siren_a").allowed
    assert not other.check_service("switch", "turn_off", "switch.pump", system=True, siren="switch.siren_a").allowed


def test_a_newer_snapshot_of_an_incident_replaces_the_older_one(tmp_path):
    # architecture review 18: "Incident #N · Snapshot" was never kept with its incident, so every one piled up
    from ha_fake import FakeHA
    v = make_agent(tmp_path, {"people": [{"telegram_id": JM, "name": "JM_O", "role": "owner"}]},
                   reader=FakeHA(images={"camera.door": "SlBFRw=="}))
    res = {"send": [{"to": "owner", "text": "Door forced."}], "actions": [{"action": "snapshot.get", "entity_id": "camera.door",
                                                                           "incident_id": 9}]}
    run(v.outcome.carry_out(res))
    first = v.tg.next_id                                                # the snapshot: the last message sent
    # under the heading every message of the agent's carries (owner, 2026-10-10: "all formatted the same way")
    assert v.tg.sent[-1][1].startswith("For: JM_O")
    assert v.tg.sent[-1][1].endswith("-------\nCamera snapshot")
    run(v.outcome.carry_out(res))
    assert (JM, first) in v.tg.deleted


def test_a_member_of_a_listed_group_acts_with_its_role_without_a_people_row(tmp_path):
    # owner, 2026-10-10: "any person from a Telegram group shall be able to inherit from the group role"
    RITA = 555
    pol = Policy({"people": [{"telegram_id": JM, "name": "JM_O", "role": "owner"},
                             {"telegram_id": GROUP, "name": "Group_O", "role": "owner", "language": "fr"}]})
    rita = pol.member(RITA, GROUP, "Rita")
    assert (rita.name, rita.role, rita.language) == ("Rita", "owner", "fr")
    assert pol.member(RITA, RITA) is None and pol.member(RITA, -999) is None      # her own chat, an unlisted group
    assert pol.member(1087968824, GROUP) is None                                  # an anonymous admin stays nobody
    assert pol.member(JM, GROUP).name == "JM_O"                                   # a listed person keeps their entry
    assert pol.chats_for("owner") == [JM, GROUP]                                  # and she gets no private copies
    v = make_agent(tmp_path, {**pol.raw, "act_enabled": True, "allowed_services": {"light.turn_on": "owner"}})
    _, msg = v.actions.request("light", "turn_on", "light.pool", {}, None, None)
    run(v.outcome.ask(msg))
    in_group = next(n for n, (c, _t, _k) in enumerate(v.tg.sent, start=1001) if c == GROUP)
    press = {"id": "cb1", "data": button_data.make(button_data.APPROVAL, msg.approval_id, "n"), "chat_id": GROUP,
             "user_id": RITA, "from_first": "Rita",
             "message": {"message_id": in_group, "chat": {"id": GROUP}, "text": msg.text}, "bot": BOT}
    run(v.on_ha_event("telegram_callback", press))
    assert v.tg.edits and all("Refused by Rita on " in t for _, _, t in v.tg.edits)


def test_in_a_listed_group_everyone_acts_with_the_groups_role_whatever_their_own():
    # the owner's People of 2026-10-10: the group as Owner, JM and Fabien as Facility manager — in the group JM was
    # refused the siren's approval while any unlisted member could give it
    pol = Policy({"people": [{"telegram_id": GROUP, "name": "Group Chat", "role": "owner"},
                             {"telegram_id": FABIEN, "name": "Fabien", "role": "fm"},
                             {"telegram_id": JM, "name": "JM", "role": "fm"}]})
    assert pol.member(JM, GROUP).role == "owner" and pol.member(555, GROUP).role == "owner"     # everyone in the group
    assert pol.member(JM, JM).role == "fm" and pol.person(JM).role == "fm"                     # in private: their own
    both = Policy({"people": [{"telegram_id": GROUP, "name": "G_O", "role": "owner"}, {"telegram_id": GROUP, "name": "G_FM", "role": "fm"},
                              {"telegram_id": JM, "name": "JM_O", "role": "owner"}]})
    # "irrespective of their own individual role" (owner, 2026-10-10): a group of both roles is the narrower, for all
    assert both.member(JM, GROUP).role == "fm" and both.member(555, GROUP).role == "fm" and both.member(JM, JM).role == "owner"


def test_a_request_answered_at_once_leaves_one_message_in_the_askers_chat(tmp_path, monkeypatch):
    # owner, 2026-10-10: approved at 18:12, the AI's "Approval request sent." still came at 18:13 under it
    from ai_fake import FakeAI
    v = make_agent(tmp_path, {"people": [{"telegram_id": JM, "name": "JM", "role": "owner"},
                                         {"telegram_id": GROUP, "name": "Group", "role": "fm"}],
                              "act_enabled": True, "allowed_services": {"cover.close_cover": "any"}})

    async def asks(call):
        await call["call"]("ha_call_service", {"domain": "cover", "service": "close_cover", "entity_id": "cover.bedroom"})
    FakeAI("Request sent. Awaiting approval.", act=asks).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "close the bedroom curtain"))
    (req_n, (_, req, kb)), = [(n, s) for n, s in enumerate(v.tg.sent, start=1001) if s[2]]
    assert len(v.tg.sent) == 1                                              # the request, and nothing under it
    press = {"id": "cb", "data": kb["inline_keyboard"][0][1]["callback_data"], "chat_id": JM, "user_id": JM,
             "message": {"message_id": req_n, "chat": {"id": JM}, "text": req}, "bot": BOT}
    run(v.on_ha_event("telegram_callback", press))
    (_, mid, settled), = v.tg.edits
    assert len(v.tg.sent) == 1 and mid == req_n and re.search(r"\n-------\nRefused by JM on .*Nothing was done\.$", settled)


def test_the_siren_that_cannot_be_requested_says_so_in_the_agents_layout(tmp_path):
    from vesta_shared import result as R
    v = make_agent(tmp_path, {"people": PEOPLE, "siren_entity": "switch.siren"})          # acting is off: refused
    run(v.outcome.carry_out({"siren_gate": R.siren(True, "Intrusion suspected.", ("owner", "fm"))}, "alert-desk"))
    texts = [t for _, t, _ in v.tg.sent]
    assert texts and all(t.startswith("For: ") and "\n-------\nIntrusion suspected.\n-------\nThe siren cannot be requested: "
                         in t for t in texts)


def test_an_approved_request_says_what_happened_and_who_approved_it_never_the_retry_words(tmp_path):
    # owner, 2026-10-10: "For: JM / Opened Bedroom3 Curtain. / Approved by JM on …" — and only the asker's chat
    from vesta_agent.actions import Decision, done_words
    names = {"cover.bedroom3": "Bedroom3 Curtain"}.get
    d = Decision(True, "", "any", "cover", "open_cover", ["cover.bedroom3"], {})
    assert done_words(d, names, {"ok": True}) == "Opened Bedroom3 Curtain."
    assert done_words(d, names, {"ok": False, "unconfirmed": [("Bedroom3 Curtain", "closed")]}) == \
        "Bedroom3 Curtain did not open: it reads closed."                     # never claims what did not happen
    assert "retry" not in done_words(d, names, {"ok": False, "failed": True})
    from vesta_agent import layout
    req = layout.parts(head="For: JM", body="Open Bedroom3 Curtain (final state: open)?", status="Waiting for approval by the owner")
    assert layout.render(layout.changed(req, status="Approved by JM on 10/10/2026 17:13.", body="Opened Bedroom3 Curtain.")) == \
        "For: JM\n-------\nOpened Bedroom3 Curtain.\n-------\nApproved by JM on 10/10/2026 17:13."


def test_a_request_shown_in_the_askers_chat_is_not_announced_again(tmp_path, monkeypatch):
    # owner, 2026-10-10: "Approval request sent … Waiting for approval." under the request "is redundant"
    from ai_fake import FakeAI
    v = make_agent(tmp_path, {"people": [{"telegram_id": JM, "name": "JM", "role": "owner"},
                                         {"telegram_id": GROUP, "name": "Group", "role": "fm"}],
                              "act_enabled": True, "allowed_services": {"cover.open_cover": "any"}})
    told = []

    async def asks(call):
        told.append(await call["call"]("ha_call_service", {"domain": "cover", "service": "open_cover", "entity_id": "cover.b"}))
    # the AI writes its echo anyway, as it did on the villa ("Approval request sent.")
    FakeAI("Approval request sent.", act=asks).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "open the bedroom curtain"))
    assert "will NOT be shown" in told[0]["content"][0]["text"]
    assert [bool(kb) for _, _, kb in v.tg.sent] == [True]      # the request alone: the engine drops the echo


def test_a_curtain_still_moving_is_said_to_be_and_the_request_says_opened_once_it_is(tmp_path, monkeypatch):
    # owner, 2026-10-10: "Bedroom3 Curtain did not open: it reads closed … but the curtain is actually well opened" —
    # it read "closed" until it had finished moving, 40 s later
    from vesta_agent import approvals as appr_mod
    monkeypatch.setattr(appr_mod, "FOLLOW_EVERY_S", 0)
    v = make_agent(tmp_path, {"people": [{"telegram_id": JM, "name": "JM", "role": "owner"},
                                         {"telegram_id": GROUP, "name": "Group", "role": "fm"}],
                              "act_enabled": True, "allowed_services": {"cover.open_cover": "any"}})
    reads = iter(["closed"] * 7 + ["open"])                 # the read-back right after, then the agent's later looks

    class Writer:
        def call_service(self, *a):
            pass

        def states(self, ids):
            s = next(reads, "open")
            return {i: {"state": s} for i in ids}
    v.actions.writer_factory = Writer
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().person(JM), JM)
    run(v.outcome.ask(msg))
    req_n = v.tg.next_id
    press = {"id": "cb", "data": msg.keyboard["inline_keyboard"][0][0]["callback_data"], "chat_id": JM, "user_id": JM,
             "message": {"message_id": req_n, "chat": {"id": JM}, "text": msg.text}, "bot": BOT}

    async def go():
        await v.on_ha_event("telegram_callback", press)
        await v.approvals.idle()
    run(go())
    first, last = v.tg.edits[0][2], v.tg.edits[-1][2]
    assert "\n-------\nOpening " in first and "\n-------\nApproved by JM on " in first     # on its way, right away
    assert "\n-------\nOpened " in last and "did not" not in last and last.split("\n-------\n")[-1].startswith("Approved by JM")


def test_the_ai_is_told_what_is_waiting_and_what_was_decided_never_left_to_its_memory(tmp_path):
    # owner, 2026-10-10: asked again, the AI said "already sent 22 min ago, press the button" for a request approved at
    # 17:37 — it remembered asking and never learnt the answer
    from datetime import datetime, timedelta, timezone
    v = make_agent(tmp_path, {"people": [{"telegram_id": JM, "name": "JM", "role": "owner"},
                                         {"telegram_id": GROUP, "name": "Group", "role": "fm"}],
                              "act_enabled": True, "allowed_services": {"cover.open_cover": "any"}})
    t0 = datetime(2026, 10, 10, 9, 36, tzinfo=timezone.utc)
    aid = v.state.new_approval({"plain": "Open Bedroom3 Curtain (final state: open)?"}, "h", "any", JM, JM, 15, now=t0)
    assert "- nothing is waiting" not in v.approvals.now(now=t0 + timedelta(minutes=1))
    assert "- waiting: Open Bedroom3 Curtain" in v.approvals.now(now=t0 + timedelta(minutes=1))
    v.state.claim_approval(aid, "approved", JM, now=t0 + timedelta(minutes=1), name="JM")
    later = v.approvals.now(now=t0 + timedelta(minutes=22))
    assert "- nothing is waiting for approval" in later and " — approved, its result not recorded yet (by JM on " in later
    assert "never from memory" in later
    assert "Requests for approval" in v.before_answer()                 # in front of every message, acting on


def _curtain_villa(tmp_path, reads, ttl=15):
    v = make_agent(tmp_path, {"people": [{"telegram_id": JM, "name": "JM", "role": "owner"},
                                         {"telegram_id": GROUP, "name": "Group", "role": "fm"}],
                              "act_enabled": True, "approval_ttl_minutes": ttl,
                              "allowed_services": {"cover.open_cover": "any"}})
    reads = iter(reads)

    class Writer:
        def call_service(self, *a):
            pass

        def states(self, ids):
            s = next(reads, "open")
            return {i: {"state": s} for i in ids}
    v.actions.writer_factory = Writer
    return v


def test_a_moving_curtain_is_recorded_moving_then_done_and_the_ai_reads_the_same(tmp_path, monkeypatch):
    # architecture review 19: recorded "failed" at the first reading while the message said "Opened" — the AI said failed
    from vesta_agent import approvals as appr_mod
    monkeypatch.setattr(appr_mod, "FOLLOW_EVERY_S", 0)
    v = _curtain_villa(tmp_path, ["closed"] * 3 + ["open"])
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().person(JM), JM)
    run(v.approvals.ask(msg))
    out = v.actions.decide(msg.approval_id, JM, True, chat=JM)
    assert v.state.approval(msg.approval_id)["status"] == "moving" and out["toast"] == "Approved: on its way."
    assert " — approved; the device was still on its way (by JM on " in v.approvals.now()
    run(v.approvals._follow(msg.approval_id, out["follow"]))
    assert v.state.approval(msg.approval_id)["status"] == "done" and " — approved, and done (by JM on " in v.approvals.now()


def test_a_follow_cut_by_a_restart_is_taken_up_again(tmp_path, monkeypatch):
    from vesta_agent import approvals as appr_mod
    monkeypatch.setattr(appr_mod, "FOLLOW_EVERY_S", 0)
    v = _curtain_villa(tmp_path, ["closed", "open"])
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().person(JM), JM)
    run(v.approvals.ask(msg))
    v.actions.decide(msg.approval_id, JM, True, chat=JM)          # recorded "moving"; the agent stops here

    async def restart():
        await v.approvals.resume()
        await v.approvals.idle()
    run(restart())
    assert v.state.approval(msg.approval_id)["status"] == "done"
    assert v.tg.edits and "\n-------\nOpened " in v.tg.edits[-1][2]


def test_an_expired_request_says_so_and_a_long_wait_is_still_seen_by_the_ai(tmp_path):
    from datetime import datetime, timedelta, timezone
    v = _curtain_villa(tmp_path, [], ttl=300)                       # a villa that lets a request wait 5 hours
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().person(JM), JM)
    run(v.approvals.ask(msg))
    in3h = datetime.now(timezone.utc) + timedelta(hours=3)
    assert "- waiting: Open " in v.approvals.now(now=in3h)          # three hours on: still waiting, and the AI knows
    assert run(v.approvals.expire(now=in3h)) == 0
    assert run(v.approvals.expire(now=in3h + timedelta(hours=3))) == 1
    (_, _, text), = v.tg.edits
    assert re.search(r"\n-------\nExpired on \d\d/\d\d/\d{4} \d\d:\d\d: nothing was done\.$", text)
    assert v.state.approval(msg.approval_id)["status"] == "expired"


def test_the_pictures_still_come_when_the_request_is_the_answer(tmp_path, monkeypatch):
    # architecture review 19: "open the gate and show me the entrance camera" — the request came, the picture never
    from ai_fake import FakeAI
    v = _curtain_villa(tmp_path, [])

    async def asks(call):
        await call["call"]("ha_call_service", {"domain": "cover", "service": "open_cover", "entity_id": "cover.b"})
    FakeAI("Approval request sent.", act=asks).install(monkeypatch)
    from vesta_agent.turn import Turns
    real = Turns.chat

    async def with_photo(self, *a, **k):
        res = await real(self, *a, **k)
        res.photos.append(("SlBFRw==", "image/jpeg"))
        return res
    monkeypatch.setattr(Turns, "chat", with_photo)
    run(v.converse(JM, v.policy().person(JM), "open the curtain and show me the camera"))
    # the request, then the picture alone — no "Approval request sent." with it
    assert [(bool(k), t) for _, t, k in v.tg.sent][1:] == [(False, "")] and v.tg.sent[0][2] and len(v.tg.photos) == 1


@pytest.mark.parametrize("chat,who,known_as,acts", [
    (JM, JM, "owner", "owner"),      # a listed person, in their own chat: their row (the owner's when both)
    (GROUP, JM, "fm", "fm"),         # in a listed group: the group's role, whatever their own (fm when listed for both)
    (GROUP, 555, "fm", "fm"),        # an unlisted member of a listed group: the group's role
    (-999, JM, "owner", None),       # an unlisted group: still known, but nobody acts there (dropped, never left)
    (555, 555, None, None),          # an unlisted person in their own chat: nobody
])
def test_who_acts_with_which_role_is_one_answer_everywhere(chat, who, known_as, acts):
    # architecture review 19: "who is this, in this chat" was answered in four places (intake, a press, the direct rule,
    # the approver chats) — each now asks policy.member / knows_chat
    from vesta_agent import intake
    from vesta_agent.routing import Routing
    pol = Policy({"people": PEOPLE})
    m = pol.member(who, chat)
    assert (m.role if m else None) == known_as
    got = intake.gate("telegram_text", {"chat_id": chat, "user_id": who, "text": "@bot hi"}, pol, "bot", lambda *a: False)
    assert (got.person.role if got.action == "converse" else None) == acts
    assert pol.knows_chat(chat) is bool(acts)
    assert Routing(pol).approver_chats("any", chat) == ([chat] if acts else [FABIEN, JM])
    # where an owner's request goes is where someone acting there may approve it (architecture review 21)
    assert pol.may_approve_in(chat, "owner") is (acts == "owner")


def _press(v, msg, yn="y", chat=JM, who=JM):
    """Approve / Refuse pressed in Telegram, through the agent's real path (handle_callback → Approvals.press)."""
    mid = next(n for n, (c, _t, k) in enumerate(v.tg.sent, start=1001) if c == chat and k)
    data = msg.keyboard["inline_keyboard"][0][0 if yn == "y" else 1]["callback_data"]

    async def go():
        await v.on_ha_event("telegram_callback", {"id": "cb", "data": data, "chat_id": chat, "user_id": who,
                                                  "message": {"message_id": mid, "chat": {"id": chat}}, "bot": BOT})
        await v.approvals.idle()
    run(go())


def test_approve_pressed_as_the_owner_does_it_ends_in_one_verdict_everywhere(tmp_path, monkeypatch):
    # architecture review 20: no test pressed Approve — the hand-over of the body and the follow-up went untested
    from vesta_agent import approvals as appr_mod
    monkeypatch.setattr(appr_mod, "FOLLOW_EVERY_S", 0)
    v = _curtain_villa(tmp_path, ["closed", "closed", "open"])
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().person(JM), JM)
    run(v.approvals.ask(msg))
    _press(v, msg)
    assert v.tg.toasts[-1][1] == "Approved: on its way."
    texts = [t for _, _, t in v.tg.edits]
    assert "\n-------\nOpening " in texts[0]                                   # right away: on its way, who, when
    body, status = texts[-1].split("\n-------\n")[1:]
    assert body.startswith("Opened ") and status.startswith("Approved by JM on ")
    assert v.state.approval(msg.approval_id)["status"] == "done" and " — approved, and done (by JM on " in v.approvals.now()


def test_a_decision_on_a_request_asked_hours_ago_is_told_to_the_ai(tmp_path):
    # architecture review 20: asked at 09:00, approved at 11:30 — in neither "waiting" nor "decided lately"
    from datetime import datetime, timedelta, timezone
    v = _curtain_villa(tmp_path, ["open"], ttl=300)
    t0 = datetime.now(timezone.utc) - timedelta(hours=3)
    aid = v.state.new_approval({"plain": "Open Bedroom3 Curtain?"}, "h", "any", JM, JM, 300, now=t0)
    v.state.claim_approval(aid, "refused", JM, name="JM")
    assert "- Open Bedroom3 Curtain? — refused (by JM on " in v.approvals.now()


def test_expiry_never_overrides_a_press_that_came_first(tmp_path):
    from datetime import datetime, timedelta, timezone
    v = _curtain_villa(tmp_path, ["open"])
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().person(JM), JM)
    run(v.approvals.ask(msg))
    listed = v.state.approvals_in("pending")                                    # the expiry read it as still waiting…
    v.state.claim_approval(msg.approval_id, "approved", JM, name="JM")          # …and a press claimed it just then
    v.state.approvals_in = lambda status: listed if status == "pending" else []
    assert run(v.approvals.expire(now=datetime.now(timezone.utc) + timedelta(hours=1))) == 0
    assert v.tg.edits == [] and v.state.approval(msg.approval_id)["status"] == "approved"


def test_a_press_the_rules_now_refuse_is_told_as_such_never_failed(tmp_path):
    v = _curtain_villa(tmp_path, [])
    _, msg = v.actions.request("cover", "open_cover", "cover.bedroom3", {}, v.policy().person(JM), JM)
    run(v.approvals.ask(msg))
    import yaml
    raw = yaml.safe_load(open(v.s.policy_path))
    raw["allowed_services"] = {}                                                 # the rules changed meanwhile
    import os
    import time
    open(v.s.policy_path, "w").write(yaml.safe_dump(raw))
    os.utime(v.s.policy_path, (time.time() + 5, time.time() + 5))
    _press(v, msg)
    assert v.state.approval(msg.approval_id)["status"] == "blocked"
    assert "rules no longer allowed it: nothing was tried (by JM on " in v.approvals.now()


def test_a_long_incidents_snapshot_is_one_message_and_nothing_hangs():
    # architecture review 20: a caption is 1,024 characters; a head and a status past the limit must never hang render
    from vesta_agent import layout
    head = "For: JM, P1 Incident: Follow Up #9\n" + "\n".join(f"Notice {i:02d} on 10/10/2026 10:00, to JM, Fabien" for i in range(20))
    text = layout.render(layout.parts(head=head, body="Camera snapshot"), 1000)
    assert len(text) <= 1000 and "Camera snapshot" in text and "earlier notice" in text and text.startswith("For: JM, P1")
    assert "Notice 19 " in text and "Notice 00 " not in text                    # the newest kept, the oldest dropped
    huge = layout.render(layout.parts(head="For: X\n" + "y" * 9000, body="z", status="s" * 9000), 4096)
    assert len(huge) <= 4096 + 10


def test_a_photo_with_a_long_heading_is_posted_as_one_message_and_recorded_as_sent():
    from vesta_agent import layout
    from vesta_agent.posting import Poster
    sent = []

    async def send(chat, text, **k):
        sent.append((text, k.get("photo")))
        return 1

    class Notices:
        def heading(self, chat, incident, roles):
            return "For: JM, P1 Incident: Follow Up #9\n" + "\n".join(f"Reminded on 10/10/2026 1{i % 10}:00, to JM" for i in range(30))
    run(Poster(send=send, notices=Notices()).post(JM, "Camera snapshot", incident=9, photo=("SlBFRw==", "image/jpeg")))
    (text, photo), = sent
    assert photo and len(text) <= 1000 and text.endswith("-------\nCamera snapshot")       # one caption: one message
