"""Who is who is the villa's (owner, 2026-11-03: "Yes, Kiosk only"): one place, set in the VESTA Kiosk, read by every
VESTA blueprint and by the agent (vesta_shared.villa_recipients). Each Telegram chat in a role's list gets the role's
messages AND its rights, named as the villa names its notify entity; the agent keeps only each chat's language."""
from __future__ import annotations

import asyncio
import json

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
    """The villa: its two lists, the registry rows of its notify entities (a Telegram chat's, a phone's) and their
    states — a name only there: the registry's name is null on a real villa."""
    rows = {"notify.tg_jm": {"platform": "telegram_bot", "unique_id": f"{BOT}_{JM}", "name": None},
            "notify.tg_other": {"platform": "telegram_bot", "unique_id": f"{BOT}_{OTHER_GROUP}", "name": None},
            "notify.tg_fabien": {"platform": "telegram_bot", "unique_id": f"{BOT}_{FABIEN}", "name": None},
            "notify.phone": {"platform": "mobile_app", "unique_id": "555_777"}}
    rows.update(entries or {})
    return FakeHA(states={"input_text.vesta_owner_targets": {"state": owner},
                          "input_text.vesta_fm_targets": {"state": fm},
                          "notify.tg_jm": {"state": "unknown", "attributes": {"friendly_name": "Jm private"}},
                          "notify.tg_other": {"state": "unknown", "attributes": {"friendly_name": "Managers group"}},
                          "notify.tg_fabien": {"state": "unknown", "attributes": {}}}, entries=rows)


def test_the_villa_lists_are_read_as_named_telegram_chats_by_role():
    got = villa_recipients.read(_villa("notify.tg_jm, notify.phone, notify.gone",
                                       " notify.tg_other ,notify.tg_other, notify.tg_fabien"))
    # a phone app is the villa's to reach, an entity since deleted is no one, a chat named twice is one; a name is the
    # entity's friendly_name, else its id's object part
    assert got == {"owner": [{"chat": JM, "name": "Jm private"}],
                   "fm": [{"chat": OTHER_GROUP, "name": "Managers group"}, {"chat": FABIEN, "name": "tg_fabien"}]}
    assert villa_recipients.read(_villa("", "notify.phone")) == {"owner": [], "fm": []}
    # the lists not there (an older villa) or the villa unreachable: nothing read, what was kept stays
    assert villa_recipients.read(FakeHA()) is None

    class _Down(FakeHA):
        def states(self, entity_ids=None):
            raise OSError("unreachable")
    assert villa_recipients.read(_Down()) is None


def test_a_chat_in_a_kiosk_list_gets_its_roles_messages_and_rights_by_the_entitys_name():
    from vesta_agent.routing import Routing
    lists = {"owner": [{"chat": JM, "name": "Jm private"}], "fm": [{"chat": OTHER_GROUP, "name": "Managers group"}]}
    pol = Policy({"languages": {OTHER_GROUP: "de"}}, lists)
    assert pol.chats_for("owner") == [JM] and pol.chats_for("fm") == [OTHER_GROUP]
    assert pol.person(JM).name == "Jm private" and pol.person(JM).role == "owner"
    assert pol.may_approve_in(JM, "owner") and pol.may_approve_in(OTHER_GROUP, "any")
    assert not pol.may_approve_in(OTHER_GROUP, "owner")
    assert pol.member(555, OTHER_GROUP, "Wayan").role == "fm"                  # a group's member: its role
    assert pol.language_of(OTHER_GROUP, "fm") == "de" and pol.language_of(JM, "owner") == "en"
    assert pol.chats_for("fm", "de") == [OTHER_GROUP] and pol.chats_for("fm", "en") == []
    assert Routing(pol).approver_chats("owner", None) == [JM]
    assert Routing(pol).approver_chats("any", OTHER_GROUP) == [OTHER_GROUP]


def test_a_chat_only_in_an_older_people_list_has_no_rights_and_gets_nothing():
    # ⚠️ ONE LIST (owner, 2026-11-03): People's rows are an older shape, read for their languages only
    pol = Policy({"people": PEOPLE}, {"owner": [{"chat": JM, "name": "Jm"}]})
    assert pol.language_of(JM, "owner") == "fr"                            # its language kept
    for chat in (FABIEN, GROUP):
        assert pol.person(chat) is None and pol.roles_in(chat) == set() and not pol.knows_chat(chat)
        assert not pol.may_approve_in(chat, "any") and pol.member(chat, chat) is None
    assert pol.chats_for("fm") == [] and pol.member(555, GROUP, "Wayan") is None
    from vesta_agent.routing import Routing
    assert Routing(pol).approver_chats("any", FABIEN) == [JM]               # an unknown chat: the owner's


def test_never_read_nobody_is_listed_and_a_request_is_refused_with_its_reason(tmp_path):
    v = make_agent(tmp_path, {"act_enabled": True, "allowed_services": {"light.turn_on": "any"}})
    pol = v.policy()
    assert pol.entries == [] and pol.chats_for("owner") == pol.chats_for("fm") == []
    answer, msg = v.actions.request("light", "turn_on", "light.pool", {}, None, None)
    assert msg is None and answer.startswith("Refused: no chat where the owner can approve it in the VESTA Kiosk")
    done = asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "text": "Pool pump offline."}]}))
    assert done["unrouted"] == 1 and v.tg.sent == []


def test_the_agent_reads_the_villa_lists_and_its_next_message_follows_them(tmp_path, monkeypatch):
    import vesta_agent.app as app_module
    v = make_agent(tmp_path, {"languages": {OTHER_GROUP: "fr"}}, reader=_villa("notify.tg_jm", "notify.tg_other"))
    # the agent's own minute reads them at once, on a machine up for 10 seconds too (CI: its clock starts at boot)
    monkeypatch.setattr(app_module.time, "monotonic", lambda: 10.0)
    asyncio.run(v.housekeeping())
    assert villa_recipients.get(v.s.pack_path) == {"owner": [{"chat": JM, "name": "Jm private"}],
                                                   "fm": [{"chat": OTHER_GROUP, "name": "Managers group"}]}
    asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "text": "Pool pump offline."}]}))
    assert [c for c, _, _ in v.tg.sent] == [OTHER_GROUP]
    assert v.policy().person(JM).name == "Jm private" and v.policy().language_of(OTHER_GROUP, "fm") == "fr"
    # a reminder or a step's notice sent there says whom it is for by the same lists
    assert v.notices.roles_for(OTHER_GROUP) == {"fm"} and v.notices.roles_for(GROUP) == set()
    # emptied in the Kiosk: nobody of the role; the villa unreachable later: what was kept stays
    v.reader = _villa("notify.tg_jm", "")
    v.read_recipients()
    v.tg.sent.clear()
    done = asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "text": "Pool pump offline."}]}))
    assert v.tg.sent == [] and done["unrouted"] == 1 and v.policy().person(JM) is not None
    v.reader = FakeHA()
    v.read_recipients()
    assert villa_recipients.get(v.s.pack_path) == {"owner": [{"chat": JM, "name": "Jm private"}], "fm": []}


def test_a_kept_file_that_cannot_be_read_is_no_list(tmp_path, monkeypatch):
    pack = str(tmp_path / "pack.json")
    seven = {"owner": [{"chat": 7, "name": "Seven"}], "fm": []}
    # a skill reads them beside VESTA_PACK, as the Kiosk's settings
    villa_recipients.save(pack, seven)
    monkeypatch.setenv("VESTA_PACK", pack)
    assert villa_recipients.get() == seven
    (tmp_path / villa_recipients.FILE).unlink()
    assert villa_recipients.get(pack) == {}
    (tmp_path / villa_recipients.FILE).write_text("{not json")
    assert villa_recipients.get(pack) == {}
    (tmp_path / villa_recipients.FILE).write_text('{"owner": [1, "2", true, {"chat": 3}], "fm": "x"}')
    assert villa_recipients.get(pack) == {"owner": [{"chat": 1, "name": "Owner chat"}, {"chat": 3, "name": "Owner chat"}]}
    assert villa_recipients.save(pack, seven) is True
    assert villa_recipients.save(pack, seven) is False


def test_an_older_file_of_chat_ids_is_still_read_and_rewritten_with_names(tmp_path):
    # formats outlive their writer: 0.12.436 to 0.12.438 kept {role: [chat ids]}
    v = make_agent(tmp_path, {}, reader=_villa("notify.tg_jm", "notify.tg_other"))
    with open(villa_recipients.path(v.s.pack_path), "w") as f:
        json.dump({"owner": [JM], "fm": [OTHER_GROUP]}, f)
    pol = v.policy()
    assert pol.chats_for("owner") == [JM] and pol.person(JM).name == "Owner chat"
    assert pol.may_approve_in(OTHER_GROUP, "any")
    v.read_recipients()                                     # the next reading writes the names
    with open(villa_recipients.path(v.s.pack_path)) as f:
        assert json.load(f)["owner"] == [{"chat": JM, "name": "Jm private"}]


def _chats(v) -> dict:
    """The chats kept, by role."""
    return {r: [e["chat"] for e in rows] for r, rows in villa_recipients.get(v.s.pack_path).items()}


def test_on_a_machine_just_started_both_reads_run_at_the_first_housekeeping(tmp_path, monkeypatch):
    # ⚠️ ONE CLOCK FOR "EVERY N SECONDS" (architecture review round 16): the Kiosk's faults started at 0.0 against a clock
    # that starts at the machine's boot — up for 10 seconds (a power cut), the first read waited 5 minutes
    import vesta_agent.app as app_module
    from kiosk_fake import FakeKiosk
    clock = [10.0]
    monkeypatch.setattr(app_module.time, "monotonic", lambda: clock[0])
    v = make_agent(tmp_path, {"people": PEOPLE}, reader=_villa("notify.tg_jm", "notify.tg_other"), kiosk=FakeKiosk())
    faults = []

    async def repair():
        faults.append(clock[0])
        return {}
    v.tickets.repair = repair
    asyncio.run(v.housekeeping())
    assert faults == [10.0] and _chats(v) == {"owner": [JM], "fm": [OTHER_GROUP]}
    # then every 5 minutes, not at every pass
    v.reader = _villa("notify.tg_jm", "")
    clock[0] = 10.0 + 299
    asyncio.run(v.housekeeping())
    assert faults == [10.0] and _chats(v)["fm"] == [OTHER_GROUP]
    clock[0] = 10.0 + 300
    asyncio.run(v.housekeeping())
    assert faults == [10.0, 310.0] and _chats(v)["fm"] == []


def test_the_knowledge_packs_people_are_the_kiosks_lists_with_each_chats_language(tmp_path, monkeypatch):
    # the skills read the pack (villa-concierge: who is talking): its people table is the agent's entries, never a
    # file of its own (owner, 2026-11-03)
    import subprocess
    import vesta_agent.app as app_module
    v = make_agent(tmp_path, {"languages": {OTHER_GROUP: "id"}})
    villa_recipients.save(v.s.pack_path, {"owner": [{"chat": JM, "name": "Jm private"}],
                                          "fm": [{"chat": OTHER_GROUP, "name": "Managers group"}]})
    seen = {}

    def fake_run(cmd, **kw):
        seen["people"] = json.load(open(cmd[cmd.index("--people") + 1]))["people"]
        return subprocess.CompletedProcess(cmd, 0, "{}", "")
    monkeypatch.setattr(app_module.subprocess, "run", fake_run)
    v._build_pack()
    assert seen["people"] == [{"name": "Jm private", "role": "owner", "language": "en", "chat": JM},
                              {"name": "Managers group", "role": "fm", "language": "id", "chat": OTHER_GROUP}]
