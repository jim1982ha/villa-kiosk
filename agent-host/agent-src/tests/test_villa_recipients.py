"""Who gets the messages is the villa's (owner, 2026-11-03): one place, set in the VESTA Kiosk, read by every VESTA
blueprint and by the agent (vesta_shared.villa_recipients). The agent sends a role's messages to the Telegram chats
of the villa's list of the role; the People list keeps who may approve, who is a member and each chat's language."""
from __future__ import annotations

import asyncio

from ha_fake import FakeHA
from helpers import make_agent
from vesta_agent.policy import Policy
from vesta_shared import villa_recipients

BOT = 900
JM, FABIEN, GROUP, OTHER_GROUP = 111, 222, -100333, -100444
PEOPLE = [{"telegram_id": JM, "name": "Jm", "role": "owner", "language": "fr"},
          {"telegram_id": FABIEN, "name": "Fabien", "role": "fm"},
          {"telegram_id": GROUP, "name": "Group", "role": "fm"}]


def _villa(owner: str, fm: str, entries: dict | None = None) -> FakeHA:
    """The villa: its two lists, and the registry rows of its notify entities (a Telegram chat's, a phone's)."""
    rows = {"notify.tg_jm": {"platform": "telegram_bot", "unique_id": f"{BOT}_{JM}"},
            "notify.tg_other": {"platform": "telegram_bot", "unique_id": f"{BOT}_{OTHER_GROUP}"},
            "notify.phone": {"platform": "mobile_app", "unique_id": "555_777"}}
    rows.update(entries or {})
    return FakeHA(states={"input_text.vesta_owner_targets": {"state": owner},
                          "input_text.vesta_fm_targets": {"state": fm}}, entries=rows)


def test_the_villa_lists_are_read_as_telegram_chats_by_role():
    got = villa_recipients.read(_villa("notify.tg_jm, notify.phone, notify.gone", " notify.tg_other ,notify.tg_other"))
    # a phone app is the villa's to reach, an entity since deleted is no one, a chat named twice is one
    assert got == {"owner": [JM], "fm": [OTHER_GROUP]}
    assert villa_recipients.read(_villa("", "notify.phone")) == {"owner": [], "fm": []}
    # the lists not there (an older villa) or the villa unreachable: nothing read, what was kept stays
    assert villa_recipients.read(FakeHA()) is None

    class _Down(FakeHA):
        def states(self, entity_ids=None):
            raise OSError("unreachable")
    assert villa_recipients.read(_Down()) is None


def test_a_role_goes_to_the_villa_list_and_back_to_people_when_it_names_no_chat():
    pol = Policy({"people": PEOPLE}, {"owner": [], "fm": [OTHER_GROUP]})
    assert pol.chats_for("fm") == [OTHER_GROUP]                   # the villa's list
    assert pol.chats_for("owner") == [JM]                         # names none: People's, an alert always goes somewhere
    assert Policy({"people": PEOPLE}).chats_for("fm") == [FABIEN, GROUP]
    assert pol.delivered_roles(OTHER_GROUP) == {"fm"} and pol.delivered_roles(GROUP) == set()
    # where is the villa's, who may is People's: the villa's chat is sent to, in English, and approves nothing
    assert pol.language_of(OTHER_GROUP, "fm") == "en" and pol.chats_for("fm", "en") == [OTHER_GROUP]
    assert not pol.may_approve_in(OTHER_GROUP, "fm") and pol.roles_in(OTHER_GROUP) == set()
    people_only = Policy({"people": PEOPLE})
    for chat in (JM, FABIEN, GROUP, OTHER_GROUP):
        assert [pol.may_approve_in(chat, r) for r in (None, "fm", "owner")] == \
               [people_only.may_approve_in(chat, r) for r in (None, "fm", "owner")]
        assert pol.roles_in(chat) == people_only.roles_in(chat) and pol.group_role(chat) == people_only.group_role(chat)


def test_the_agent_reads_the_villa_lists_and_its_next_message_follows_them(tmp_path):
    v = make_agent(tmp_path, {"people": PEOPLE}, reader=_villa("notify.tg_jm", "notify.tg_other"))
    asyncio.run(v.housekeeping())                                 # the agent's own minute: it reads them
    assert villa_recipients.get(v.s.pack_path) == {"owner": [JM], "fm": [OTHER_GROUP]}
    asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "text": "Pool pump offline."}]}))
    assert [c for c, _, _ in v.tg.sent] == [OTHER_GROUP]
    # a reminder or a step's notice sent there says whom it is for by the same lists
    assert v.notices.roles_for(OTHER_GROUP) == {"fm"} and v.notices.roles_for(GROUP) == set()
    # emptied in the Kiosk: People's chats again; the villa unreachable later: what was kept stays
    v.reader = _villa("notify.tg_jm", "")
    v.read_recipients()
    v.tg.sent.clear()
    asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "text": "Pool pump offline."}]}))
    assert [c for c, _, _ in v.tg.sent] == [FABIEN, GROUP]
    v.reader = FakeHA()
    v.read_recipients()
    assert villa_recipients.get(v.s.pack_path) == {"owner": [JM], "fm": []}


def test_a_kept_file_that_cannot_be_read_is_no_list(tmp_path):
    pack = str(tmp_path / "pack.json")
    assert villa_recipients.get(pack) == {}
    (tmp_path / villa_recipients.FILE).write_text("{not json")
    assert villa_recipients.get(pack) == {}
    (tmp_path / villa_recipients.FILE).write_text('{"owner": [1, "2", true], "fm": "x"}')
    assert villa_recipients.get(pack) == {"owner": [1]}
    assert villa_recipients.save(pack, {"owner": [1], "fm": []}) is True
    assert villa_recipients.save(pack, {"owner": [1], "fm": []}) is False
