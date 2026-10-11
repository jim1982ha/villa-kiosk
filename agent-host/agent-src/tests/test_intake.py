"""Architecture review 6: what the agent does with each Telegram message (intake.gate), the conversation-reset
rule (intake.resume_for), and the one table of button kinds (button_data) — as tables, without the agent."""
from __future__ import annotations

import glob
import os
import re
from datetime import datetime, timezone

import pytest

from helpers import ROOT
from vesta_agent import button_data, intake
from vesta_agent.policy import Policy

OWNER, FM, STRANGER, GROUP, OTHER_GROUP = 11, 22, 99, -100, -200
BOT = "Villa_Test_bot"


# the real rules, never a stand-in of them: the group is a row of People (0.12.128)
def Pol():
    return Policy({"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner"},
                              {"telegram_id": FM, "name": "FM", "role": "fm"},
                              {"telegram_id": GROUP, "name": "Group", "role": "owner"}]})


def ev(chat, user, text="hi", **k):
    return {"chat_id": chat, "user_id": user, "text": text, **k}


@pytest.mark.parametrize("etype,m,action,text", [
    ("telegram_text", ev(OWNER, OWNER, "  is the pool ok? "), "converse", "is the pool ok?"),
    ("telegram_text", ev(GROUP, OWNER, "talking to FM"), "drop", ""),                         # not for the agent
    ("telegram_text", ev(GROUP, OWNER, f"@{BOT} lights?"), "converse", "lights?"),
    ("telegram_text", ev(GROUP, OWNER, "yes", reply_to_message_id=5), "converse", "yes"),     # a reply to it
    ("telegram_text", ev(OTHER_GROUP, OWNER, f"@{BOT} hi"), "drop", ""),                      # an unlisted group
    ("telegram_text", ev(STRANGER, STRANGER), "unregistered", ""),
    ("telegram_command", {"chat_id": OWNER, "user_id": OWNER, "command": "/new"}, "new", ""),
    ("telegram_command", {"chat_id": OTHER_GROUP, "user_id": STRANGER, "command": "/whoami"}, "drop", ""),
    ("telegram_command", {"chat_id": GROUP, "user_id": STRANGER, "command": "/whoami"}, "whoami", ""),
    # a listed person reads a new group's id there, to add it to People (0.12.128)
    ("telegram_command", {"chat_id": OTHER_GROUP, "user_id": OWNER, "command": "/whoami"}, "whoami", ""),
    ("telegram_command", {"chat_id": OWNER, "user_id": OWNER, "command": "/gate"}, "drop", ""),   # HA's own
    ("telegram_command", {"chat_id": OWNER, "user_id": OWNER, "command": "/ask@OtherBot", "args": ["x"]}, "drop", ""),
    ("telegram_command", {"chat_id": OWNER, "user_id": OWNER, "command": f"/ask@{BOT}", "args": ["pool", "ok?"]},
     "converse", "pool ok?"),
    # a photo is a message (owner, 2026-10-10): in a private chat, always read; a file that is no photo, dropped and said
    ("telegram_attachment", {"chat_id": OWNER, "user_id": OWNER, "file_mime_type": "image/jpeg"}, "converse", ""),
    ("telegram_attachment", {"chat_id": OWNER, "user_id": OWNER, "file_mime_type": "application/pdf"}, "drop", ""),
    ("telegram_text", ev(OWNER, OWNER, f"@{BOT}"), "drop", ""),                                 # nothing left to say
])
def test_what_the_agent_does_with_each_message(etype, m, action, text):
    got = intake.gate(etype, m, Pol(), BOT, lambda cid, mid: mid == 5)
    assert (got.action, got.text) == (action, text)


def test_a_voice_message_is_handed_on_to_be_transcribed():
    got = intake.gate("telegram_attachment", {"chat_id": OWNER, "user_id": OWNER, "file_mime_type": "audio/ogg",
                                              "file_id": "f1"}, Pol(), BOT, lambda *a: False)
    assert got.action == "converse" and got.voice_file == "f1" and got.person.role == "owner"


def test_an_unlisted_group_is_recorded_as_ignored():
    assert intake.gate("telegram_text", ev(OTHER_GROUP, OWNER), Pol(), BOT, lambda *a: False).why == \
        "group not listed in People"


NOW = datetime(2026, 10, 7, 12, 0, tzinfo=timezone.utc)      # 20:00 in the zone below


@pytest.mark.parametrize("rule,last,keeps", [
    ("never", "2026-09-01T00:00:00+00:00", True),
    ("after_8h_silence", "2026-10-07T05:00:00+00:00", True),
    ("after_8h_silence", "2026-10-07T03:00:00+00:00", False),
    ("at_4am", "2026-10-06T21:00:00+00:00", True),           # 05:00 villa time today: after the 04:00 cut
    ("at_4am", "2026-10-06T19:00:00+00:00", False),          # 03:00 villa time today: before it
])
def test_when_a_conversation_starts_again(rule, last, keeps):
    got = intake.resume_for("s1", last, rule, "Asia/Singapore", NOW)
    assert got == ("s1" if keeps else None)
    assert intake.resume_for(None, last, rule, "Asia/Singapore", NOW) is None


def test_a_button_is_read_back_as_it_was_written():
    for kind, parts in [(button_data.APPROVAL, ("ab12", "y")), (button_data.CONTINUE, ("c9",)),
                        (button_data.ALERT, (7, "done")), (button_data.REPORT, ("credit", "fm-weekly"))]:
        data = button_data.make(kind, *parts)
        assert len(data.encode()) <= 64 and button_data.read(data) == (kind, [str(p) for p in parts])
    for wrong in ["", "x:1", "a:only-one", "i:7:", "/unlock_gate", "c:"]:
        assert button_data.read(wrong) == (None, [])


def test_every_button_the_agent_sends_is_written_through_the_one_table():
    for path in glob.glob(os.path.join(ROOT, "vesta_agent", "**", "*.py"), recursive=True):
        src = open(path, encoding="utf-8").read()
        assert not re.search(r'"callback_data":\s*f?"', src), f"{path}: a button's data written by hand"


# ---- a skill only its command starts (owner, 2026-10-11: investigate "only triggered when user mentions /investigation
# in the question, and never if not")
CMDS = {"/investigation": "investigate"}


@pytest.mark.parametrize("etype,m,invoked,text", [
    # as Telegram's command, in a private chat and in the group (where it addresses the agent, as /ask does)
    ("telegram_command", ev(OWNER, OWNER, "", command="/investigation", args=["why", "did", "the", "pump", "run?"]),
     "investigate", "why did the pump run?"),
    ("telegram_command", ev(GROUP, OWNER, "", command=f"/investigation@{BOT}", args=["the", "pump"]), "investigate", "the pump"),
    # written anywhere in the text
    ("telegram_text", ev(OWNER, OWNER, "please /investigation the flood on the 9th"), "investigate", "please the flood on the 9th"),
    ("telegram_text", ev(GROUP, OWNER, "the flood /Investigation"), "investigate", "the flood"),
    # never without it — and never from a look-alike
    ("telegram_text", ev(OWNER, OWNER, "what happened to the pump on the 9th?"), None, "what happened to the pump on the 9th?"),
    ("telegram_text", ev(OWNER, OWNER, "see /investigations/9 and the pump"), None, "see /investigations/9 and the pump"),
    ("telegram_text", ev(OWNER, OWNER, "read https://example.com/investigation first"), None,
     "read https://example.com/investigation first"),                                    # a web address is not a command
    ("telegram_command", ev(OWNER, OWNER, "", command="/ask", args=["what", "happened?"]), None, "what happened?"),
])
def test_only_the_command_calls_its_skill(etype, m, invoked, text):
    got = intake.gate(etype, m, Pol(), BOT, lambda c, mid: False, CMDS)
    assert (got.action, got.invoked, got.text) == ("converse", invoked, text)


def test_the_command_alone_still_reaches_the_agent_which_asks_for_the_question():
    got = intake.gate("telegram_command", ev(OWNER, OWNER, "", command="/investigation", args=[]), Pol(), BOT,
                      lambda c, mid: False, CMDS)
    assert (got.action, got.invoked, got.text) == ("converse", "investigate", "")
    # a command no skill declares is still Home Assistant's
    assert intake.gate("telegram_command", ev(OWNER, OWNER, "", command="/lights", args=[]), Pol(), BOT,
                       lambda c, mid: False, CMDS).action == "drop"
