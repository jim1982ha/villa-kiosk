"""A step repeated in a row is ONE Status line with its count (owner, 2026-11-06, #125-P1: four cameras saw one person
within a minute, the villa's rule sent four "opened" events, and Telegram and the tablet's card listed "Still-there
alert sent 06/11/2026 18:35 (to: Owner & FM)" three times, its bottom line "Still there: 6 times since …" after five
alerts). Through the real path: the villa's messages and events as the engine receives them, the alert desk's
`desk.py` as the engine runs it, every chat's copy, the tablet's card and the fault's story in the Kiosk fake — and an
alert an older engine recorded a line per repeat, read as one line once the engine starts. Synthetic villa; ids
invented."""
from __future__ import annotations

import asyncio
import re

import pytest

from helpers import make_agent, status
from ha_fake import FakeHA, tool
from kiosk_fake import FakeKiosk
from telegram_fake import BOT
from vesta_agent import notice
from vesta_agent.roster import Roster
from test_kiosk_messages import GROUP, FM_CHAT, OWNER, alert, tick
from test_one_message_per_incident import shown

STILL = "Still-there alert sent"


@pytest.fixture
def kiosk():
    return FakeKiosk()


@pytest.fixture
def agent(tmp_path, kiosk):
    # the villa's group holds both roles: the villa's rule posts there, every step to the facility manager listed there too
    v = make_agent(tmp_path, {}, roster=Roster.of(owner=[(OWNER, "Owner"), (GROUP, "Villa group")],
                                                  fm=[(FM_CHAT, "Wayan"), (GROUP, "Villa group")]),
                   skills=["alert-desk"], reader=FakeHA(tools=[tool("ha_get_state")]), kiosk=kiosk)
    v.bot_username = BOT["username"]
    return v


def scenario(v, *steps):
    async def go():
        for step in steps:
            await step(v)
        await v.messages.settle()
    asyncio.run(go())


async def four_cameras(v):
    """The villa's rule alerting, then alerting again three times within its cooldown (one camera each), the Kiosk's
    fault brought up to date after each (the repair, as the engine's 5-minute pass may run between them)."""
    for n in range(4):
        await alert(v, context=f"RUN-{n + 1}", mid=500 + n)
        await v.tickets.repair()


def latest(v, chat):
    """The text the chat's copy of the alert shows now (one message per incident per chat)."""
    (text,) = shown(v, chat)
    return text


def lines(text):
    """A copy's "Status:" lines, its history and its bottom line."""
    return [ln for ln in text.split("\nStatus:\n", 1)[1].split("\n") if ln.strip()]


def fault_lines(kiosk):
    """The fault's story in the Cockpit: its Telegram lines (kind "noted")."""
    (t,) = [t for t in kiosk.doc["data"]["tickets"] if t.get("alertNumber") == 1]
    return [u["note"] for u in t["updates"] if u.get("kind") == "noted"]


def test_the_villas_rule_alerting_again_in_a_row_is_one_line_with_its_count(agent, kiosk):
    scenario(agent, four_cameras)
    (_new, still) = agent.state.incident_history(1)
    assert still["stage"] == "still" and still["times"] == 3, still
    # while it is the latest step, its bottom line says it, counted once: four alerts, four times — in every chat
    for chat in (GROUP, FM_CHAT):
        copy = latest(agent, chat)
        assert not [ln for ln in lines(copy) if ln.startswith("- ") and STILL in ln], copy
        assert STILL in status(copy) and "Still there: 4 times since " in status(copy), status(copy)
    card = kiosk.messages["incident:1"]["status"]
    assert len([ln for ln in card if STILL in ln]) == 1, card
    # the fault's story, brought up to date after each: its line replaced, counted, never one more per repeat
    assert [n for n in fault_lines(kiosk) if STILL in n] == ["Still-there alert sent, 3 times (to: FM)"]
    # then the reminder: the still-there one line above it, its latest moment and its count, on the tablet too
    scenario(agent, lambda v: tick(v, 20), lambda v: v.tickets.repair())
    card = kiosk.messages["incident:1"]["status"]
    (said,) = [ln for ln in card if STILL in ln]
    assert re.fullmatch(r"- Still-there alert sent (?:\d\d/\d\d(?:/\d{4})? )?\d\d:\d\d, 3 times \(to: FM\)", said), card
    assert "Reminder sent" in card[-1], card
    # …and on Telegram, the reminder's copy: the same line
    assert [ln for ln in lines(latest(agent, FM_CHAT)) if STILL in ln] == [said]
    # the fault's story in the Cockpit: one line, counted
    noted = fault_lines(kiosk)
    assert [n for n in noted if STILL in n] == ["Still-there alert sent, 3 times (to: FM)"], noted


def test_a_repeat_says_the_same_count_in_every_language(agent):
    from vesta_shared import status_words
    assert status_words.repeats(3) == ", 3 times" and status_words.repeats(1) == "" and status_words.repeats(None) == ""
    for lang in status_words.LANGS:
        assert "3" in status_words.repeats(3, lang), lang
    assert status_words.step("still", "06/11/2026 18:35", "", "FM", "fr", 3) == \
        "Alerte « toujours là » envoyée le 06/11/2026 18:35, 3 fois (à: FM)"


@pytest.mark.parametrize("reminded", [True, False], ids=["a-reminder-after", "the-repeat-last"])
def test_an_alert_an_older_engine_recorded_once_per_repeat_reads_one_line_after_the_start(agent, kiosk, monkeypatch,
                                                                                         reminded):
    # what an engine before 0.6.447 wrote: a step per repeat, each copy listing them
    with monkeypatch.context() as m:
        m.setattr(notice, "_same_step", lambda last, line: False)
        scenario(agent, four_cameras, *([lambda v: tick(v, 20)] if reminded else []), lambda v: v.tickets.repair())
    assert [h["stage"] for h in agent.state.incident_history(1)] == ["new", "still", "still", "still"] + (
        ["reminder"] if reminded else [])
    assert len([u for u in fault_lines(kiosk) if STILL in u]) == 3
    copies = {chat: latest(agent, chat) for chat in (GROUP, FM_CHAT)}
    assert max(len([ln for ln in lines(c) if ln.startswith("- ") and STILL in ln]) for c in copies.values()) >= 2, copies
    # the engine starts (its real start): the history folded, every copy and the tablet's card drawn again, their
    # bottom lines kept
    from vesta_agent.app import Vesta
    agent.state.db.close()
    again = Vesta(agent.s, telegram=agent.tg, reader=agent.reader, kiosk=agent.kiosk)

    async def start(v):
        await v.start()
        await v.messages.settle()
    asyncio.run(start(again))
    agent = again
    assert [(h["stage"], h.get("times")) for h in agent.state.incident_history(1)] == \
        [("new", None), ("still", 3)] + ([("reminder", None)] if reminded else [])
    for chat, before in copies.items():
        now = latest(agent, chat)
        assert status(now) == status(before), "its bottom line stays"
        # each step said once: the repeat one line, counted — or its bottom line alone while it is the latest
        said = [ln for ln in lines(now) if STILL in ln]
        assert len(said) == 1 and (said[0].endswith(", 3 times (to: FM)") if reminded else said[0] == lines(now)[-1]), now
        assert sum("Reminder sent" in ln for ln in lines(now)) == (1 if reminded else 0), now
    card = kiosk.messages["incident:1"]["status"]
    assert len([ln for ln in card if STILL in ln]) == 1, card
    # the fault's story: its three lines one, counted
    scenario(agent, lambda v: v.tickets.repair())
    noted = fault_lines(kiosk)
    assert [n for n in noted if STILL in n] == ["Still-there alert sent, 3 times (to: FM)"], noted


def test_a_copy_left_behind_by_the_repeats_keeps_the_steps_it_showed(agent, kiosk, monkeypatch):
    # an older engine's copy drawn at the first repeat that the next ones never redrew (a chat they did not concern):
    # it showed the alert above its bottom line; folded, it still does — never a step more or less
    from vesta_agent import layout
    with monkeypatch.context() as m:
        m.setattr(notice, "_same_step", lambda last, line: False)
        scenario(agent, four_cameras, lambda v: tick(v, 20))
    rec = agent.state.incident_message(1, FM_CHAT)
    head = agent.notices.heading(FM_CHAT, 1, before=4)          # as it stood at the first repeat: the alert only above
    agent.state.set_incident_message(1, FM_CHAT, {**rec, "parts": {**rec["parts"], "head": head},
                                                  "text": layout.render({**rec["parts"], "head": head})})
    shown_then = [ln for ln in lines(agent.state.incident_message(1, FM_CHAT)["text"]) if ln.startswith("- ")]
    assert len(shown_then) == 1 and shown_then[0].startswith("- Alert sent "), shown_then
    from vesta_agent.app import Vesta
    agent.state.db.close()
    again = Vesta(agent.s, telegram=agent.tg, reader=agent.reader, kiosk=agent.kiosk)

    async def start(v):
        await v.start()
        await v.messages.settle()
    asyncio.run(start(again))
    now = again.state.incident_message(1, FM_CHAT)["text"]
    assert [ln for ln in lines(now) if ln.startswith("- ")] == shown_then, now
