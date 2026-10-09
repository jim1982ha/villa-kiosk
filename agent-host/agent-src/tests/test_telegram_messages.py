"""What a chat sees of the agent's messages (architecture review 15, 2026-10-10): one layout for the real Telegram and
the tests' fake, every part of a long message remembered, a partly sent message never sent again whole, an edit that
keeps its note, one answer per press."""
from __future__ import annotations

import asyncio

from helpers import settings
from telegram_fake import FakeTelegram
from vesta_agent.delivery import NO_PICTURE, Delivery
from vesta_agent.state import State
from vesta_agent.telegram import CAPTION, layout
from vesta_shared.messaging import TELEGRAM_LIMIT, split_message, tg_len

GROUP = -100500
PHOTO = ("SlBFRw==", "image/jpeg")


def _delivery(tmp_path):
    s = settings(str(tmp_path))
    tg = FakeTelegram()
    from types import SimpleNamespace
    return Delivery(tg, State(s.state_path), lambda: SimpleNamespace(chats={}, people={})), tg


def test_a_long_list_arrives_after_its_introduction_cut_between_lines():
    # the AI's "Here is the list:" and 200 lines with no blank line between them: the list went out first, then the
    # introduction, and a line was cut in two
    lines = [f"- device {i:04d} " + "x" * 20 for i in range(200)]
    text = "Here is the list:\n\n" + "\n".join(lines)
    parts = split_message(text)
    assert parts[0].startswith("Here is the list:") and len(parts) == 2
    assert all(tg_len(p) <= TELEGRAM_LIMIT for p in parts)
    assert [ln for p in parts for ln in p.split("\n") if ln.startswith("- ")] == lines      # no line cut in two
    assert all(p in text for p in parts)                                         # nothing added, nothing changed


def test_telegrams_own_count_is_used():
    # an emoji is two of Telegram's units: 3,000 of them are 6,000 units, more than one message
    assert tg_len("🙂") == 2 and len(split_message("🙂" * 3000)) == 2


def test_the_buttons_go_on_the_last_part_and_stay_with_a_file():
    # the file's form never carried the buttons: an alert with a file attached lost Done / Not found / Need help
    kb = {"inline_keyboard": [[{"text": "Done", "callback_data": "a:1:done"}]]}
    (only,) = layout("Incident #1 · leak", kb, "document")
    assert only.media == "document" and only.keyboard == kb
    parts = layout("x" * 2500, kb, "photo")
    assert parts[0].media == "photo" and tg_len(parts[0].text) <= CAPTION and parts[0].keyboard is None
    assert parts[-1].keyboard == kb and "".join(p.text for p in parts) == "x" * 2500


def test_a_reply_to_any_part_of_a_long_answer_is_a_reply_to_the_agent(tmp_path):
    # only the last part was remembered: in a group, a reply to the first part read as people talking to each other
    d, tg = _delivery(tmp_path)
    asyncio.run(d.send(GROUP, "Intro\n\n" + "\n".join("- line " + "y" * 60 for _ in range(100))))
    assert len(tg.sent) == 2
    first_id = 1001
    assert d.state.is_own_message(GROUP, first_id) and d.state.is_own_message(GROUP, first_id + 1)


def test_a_reply_partly_sent_is_never_sent_again_whole(tmp_path):
    # the picture and its caption arrived, the rest was refused: the whole text went again with "the picture could not
    # be sent" — read twice, and wrong
    d, tg = _delivery(tmp_path)
    tg.refuse.add("second part")
    asyncio.run(d.reply(GROUP, "Here is the lounge. " + "z" * 1500, photos=[PHOTO]))
    assert len(tg.sent) == 1 and tg.photos == [(GROUP, PHOTO)]
    assert not any(NO_PICTURE.strip() in t for _, t, _ in tg.sent)
    assert d.state.is_own_message(GROUP, 1001)


def test_an_edit_keeps_its_note_and_shows_as_a_send_does(tmp_path):
    # edits went to Telegram directly: cut at 4,096 characters (the "Done — Marie" at the end lost) and never cleaned
    from vesta_agent.incident_thread import IncidentThread
    d, tg = _delivery(tmp_path)
    thread = IncidentThread(d.state, "UTC", edit=d.edit, delete=d.delete)
    long_alert = "Incident #9 · **leak**\n" + "\n".join("detail " + "w" * 80 for _ in range(60))
    asyncio.run(thread.post(9, GROUP, 77, long_alert, buttons=True))
    asyncio.run(thread.close(9, "Done — Marie, {time}"))
    (_, _, text), = tg.edits
    assert "Done — Marie" in text and tg_len(text) <= TELEGRAM_LIMIT and "**" not in text


def test_a_double_tap_on_done_answers_once(tmp_path):
    # approvals and Continue were taken once, the alert buttons were not: the skill's answer ran twice, and "Already
    # closed" replaced "Closed: done" in the chat
    from types import SimpleNamespace
    from vesta_agent.alert_buttons import AlertButtons
    from vesta_agent.incident_thread import IncidentThread
    d, tg = _delivery(tmp_path)
    thread = IncidentThread(d.state, "UTC", edit=d.edit, delete=d.delete)
    asyncio.run(thread.post(5, GROUP, 70, "Incident #5 · leak", buttons=True))
    ran, toasts = [], []
    skill = SimpleNamespace(name="desk", on_reply="desk.py reply")

    async def run_job(*a):
        ran.append(a)
        await asyncio.sleep(0.05)

    class Skills:
        def get(self, name):
            return skill
    b = AlertButtons(state=d.state, skills=Skills(), store_path=str(tmp_path / "s.sqlite"), thread=thread, run_job=run_job)
    d.state.set_alert_skill(5, GROUP, "desk")
    person = SimpleNamespace(telegram_id=1, name="Marie", role="fm")

    async def toast(text):
        toasts.append(text)

    async def twice():
        await asyncio.gather(b.press({}, GROUP, ["5", "done"], person, toast), b.press({}, GROUP, ["5", "done"], person, toast))
    asyncio.run(twice())
    assert len(ran) == 1 and "Already answered." in toasts
    asyncio.run(b.press({}, GROUP, ["5", "not_found"], person, toast))              # later, on a settled incident
    assert len(ran) == 1
