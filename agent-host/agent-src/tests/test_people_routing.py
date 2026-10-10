"""People is the one list of where the agent posts (owner, 2026-10-10).

"each messages it has to sent shall be by design sent to either the Owner profiles or the Facility Manager profiles,
based on what People configuration is set": a message for a role goes to every chat listed with it — a person's
private chat or a group — and every copy updates together. The Chats card (one chat per role) is gone; an older
file's `chats:` is still read, and the page moves it into People at its next save."""
from __future__ import annotations

import asyncio
import re

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
    assert all(t.startswith("For: JM_FM, Fabien_FM\n") and body(t) == "Pool pump offline." for _, t, _ in v.tg.sent)
    v.tg.sent.clear()
    run(v.outcome.carry_out({"send": [{"to": "owner", "text": "Siren off."}, {"to": "fm", "text": "Siren off."}]}))
    assert sorted(c for c, _, _ in v.tg.sent) == sorted([JM, FABIEN, GROUP])     # for both roles: once per chat


def test_an_approval_for_the_owner_reaches_every_owner_chat_and_one_press_settles_them_all(tmp_path):
    v = make_agent(tmp_path, {"people": PEOPLE, "act_enabled": True, "allowed_services": {"light.turn_on": "owner"}})
    answer, msg = v.actions.request("light", "turn_on", "light.pool", {}, None, None)
    assert msg and msg.chats == [FABIEN, JM, GROUP]
    assert run(v.outcome.ask(msg)) == 3
    aid = msg.approval_id
    in_group = next(n for n, (c, _t, _k) in enumerate(v.tg.sent, start=1001) if c == GROUP)
    press = {"id": "cb1", "data": button_data.make(button_data.APPROVAL, aid, "n"), "chat_id": GROUP, "user_id": FABIEN,
             "message": {"message_id": in_group, "chat": {"id": GROUP}, "text": msg.text}, "bot": BOT}
    # in the group, listed for both roles, everyone is its Facility manager (owner, 2026-10-10): the owner's approval
    # is not theirs to give there
    run(v.on_ha_event("telegram_callback", press))
    assert v.tg.edits == [] and v.tg.toasts[-1][1] == "Only the owner can approve this."
    # in his own private chat Fabien is the Owner he is listed as
    in_private = next(n for n, (c, _t, _k) in enumerate(v.tg.sent, start=1001) if c == FABIEN)
    press = {**press, "id": "cb2", "chat_id": FABIEN, "message": {"message_id": in_private, "chat": {"id": FABIEN}, "text": msg.text}}
    run(v.on_ha_event("telegram_callback", press))
    # every copy, in every chat, says who refused and when — its buttons gone (one mechanism: incident_thread.py)
    assert sorted(c for c, _, _ in v.tg.edits) == sorted([FABIEN, JM, GROUP])
    assert all(re.search(r"\n-------\nRefused by Fabien_O on \d\d/\d\d/\d{4} \d\d:\d\d\. Nothing was done\.$", t)
               for _, _, t in v.tg.edits)


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
    assert n.heading(JM, to="owner").startswith("For: Fabien_O, JM_O\n")
    assert n.heading(GROUP, to="fm").startswith("For: JM_FM, Fabien_FM\n")
    alone = Notices(State(s.state_path), lambda: Policy({"people": [PEOPLE[4]]}), "UTC")
    assert alone.heading(GROUP, to="owner").startswith("For: the Owner\n")          # a group alone: its role, capitalised


def test_a_chat_listed_for_both_roles_is_headed_for_both(tmp_path):
    # architecture review 18: the one copy kept for a group of both roles was headed for the owner's people only
    v = make_agent(tmp_path, {"people": [{"telegram_id": JM, "name": "JM_O", "role": "owner"},
                                         {"telegram_id": FABIEN, "name": "Fabien_FM", "role": "fm"},
                                         {"telegram_id": GROUP, "name": "Group_O", "role": "owner"},
                                         {"telegram_id": GROUP, "name": "Group_FM", "role": "fm"}]})
    run(v.outcome.carry_out({"send": [{"to": "owner", "text": "Door unlocked."}, {"to": "fm", "text": "Door unlocked."}]}))
    heads = {c: t.split("\n")[0] for c, t, _ in v.tg.sent}
    assert heads == {JM: "For: JM_O", GROUP: "For: JM_O, Fabien_FM", FABIEN: "For: Fabien_FM"}


def test_the_agents_own_approvals_and_warnings_carry_the_heading_but_not_in_the_askers_chat(tmp_path):
    # architecture review 18: approvals and "the siren cannot be requested" went without the heading
    v = make_agent(tmp_path, {"people": PEOPLE, "act_enabled": True,
                              "allowed_services": {"light.turn_on": "owner", "cover.open_cover": "any"}})
    _, msg = v.actions.request("light", "turn_on", "light.pool", {}, None, None)
    run(v.outcome.ask(msg))
    assert all(t.startswith("For: Fabien_O, JM_O\n") for _, t, _ in v.tg.sent)
    v.tg.sent.clear()
    _, msg = v.actions.request("cover", "open_cover", "cover.pool", {}, v.policy().person(JM), JM)
    run(v.outcome.ask(msg))
    (chat, text, _), = v.tg.sent
    assert chat == JM and not text.startswith("For:")              # asked here: part of the answer to the asker


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
