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
    run(v.on_ha_event("telegram_callback", press))
    # every copy, in every chat, says who refused and when — its buttons gone (one mechanism: incident_thread.py)
    assert sorted(c for c, _, _ in v.tg.edits) == sorted([FABIEN, JM, GROUP])
    assert all(re.search(r"\n\nRefused by Fabien_O on \d\d/\d\d/\d{4} \d\d:\d\d\. Nothing was done\.$", t)
               for _, _, t in v.tg.edits)


def test_an_older_files_chats_still_route_and_the_page_moves_them_into_people(tmp_path):
    old = {"people": [{"telegram_id": JM, "name": "JM", "role": "owner"}], "chats": {"owner": GROUP, "fm": 444}}
    p = Policy(old)
    assert p.chats_for("owner") == [JM, GROUP] and p.chats_for("fm") == [444] and not p.problems
    assert p.person(444) is None                    # a chat of the old card is where to post, never a person
    text = yaml.safe_dump(old)
    form = policy_doc.to_form(text)
    assert [(r["telegram_id"], r["role"]) for r in form["people"]] == [(JM, "owner"), (GROUP, "owner"), (444, "fm")]
    saved = yaml.safe_load(policy_doc.apply_form(text, form))
    assert "chats" not in saved and Policy(saved).destinations == p.destinations


def test_a_chat_telegram_refuses_is_named_on_the_overview_until_a_message_arrives(tmp_path):
    from telegram_fake import FakeTelegram
    s = settings(str(tmp_path))
    st, tg, pol = State(s.state_path), FakeTelegram(), Policy({"people": PEOPLE})
    d = Delivery(tg, st, lambda: pol)
    tg.refuse.add("send")
    assert run(d.send(FABIEN, "x")) is None
    (line,) = status.unreachable(st, pol)
    assert line.startswith("Fabien_O / Fabien_FM: Telegram refused the last message") and "/start" in line
    tg.refuse.clear()
    assert run(d.send(FABIEN, "x")) and status.unreachable(st, pol) == []


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
    assert alone.heading(GROUP, to="owner").startswith("For: the owner\n")          # a group alone: its role
