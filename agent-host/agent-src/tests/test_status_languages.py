"""Each chat's copy of an alert card says its "Status:" section in the chat's own language (owner, 2026-10-23: "make
the Status section of each chat's copy of an alert follow that chat's language"). Two facility manager chats, one
reading German and one French, and the owner's group in English. Synthetic villa; ids and names invented.

What stays as it was: the alert's own text (the villa's words, "What to do: …"), the first line and "To:", every
English card, and a copy recorded before this (its lines stay English)."""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone

import pytest
import yaml

from helpers import STARTER_SKILLS, make_agent
from ha_fake import FakeHA, tool
from telegram_fake import BOT
from vesta_agent.ha_events import CONTEXT_KEY
from vesta_agent.policy import LANGUAGES
from vesta_shared import status_words
from vesta_agent.roster import Roster

GROUP, FM_DE, FM_FR = -100123, 222, 333
RULE = "automation.critical_condition_phase"
SUMMARY = "⚡ Phase C high\nPhase C 4580 W\nAbove 4000 W, Held 15min"
#: A Status moment: its time alone on the alert's day, "08/11 09:20" another (timeutil.status_moment), whole elsewhere
T = r"(?:\d\d/\d\d(?:/\d{4})? )?\d\d:\d\d"


def run(coro):
    return asyncio.run(coro)


def villa(tmp_path, group_language="en"):
    v = make_agent(tmp_path, {}, roster=Roster.of(owner=[(GROUP, "Owner group")], fm=[(FM_DE, "Anna"), (FM_FR, "Luc")], languages={GROUP: group_language, FM_DE: "de", FM_FR: "fr"}),
        skills=["alert-desk"], reader=FakeHA(tools=[tool("ha_get_state")]))
    v.bot_username = BOT["username"]
    return v


@pytest.fixture
def agent(tmp_path):
    return villa(tmp_path)


def rule(v, phase: str, mid: int, chat: int = GROUP, priority: str | None = None):
    """The villa's rule: its own (English) message in `chat`, then its event — one run, one context."""
    ctx = f"RUN-{mid}-{phase}"
    run(v.on_ha_event("telegram_sent", {"chat_id": chat, "message_id": mid, "bot": BOT, CONTEXT_KEY: ctx}))
    run(v.on_ha_event("vesta_critical_event", {
        "blueprint": "critical_condition", "rule_id": RULE, "incident_id": f"{RULE}-1", "phase": phase,
        "severity": "critical", "label": "Phase C high", "entities": ["sensor.phase_c"], "summary": SUMMARY,
        "timestamp": datetime.now(timezone.utc).isoformat(), CONTEXT_KEY: ctx, **({"priority": priority} if priority else {})}))


def tick(v, minutes):
    at = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
    run(v.run_code_job(v.skills.get("alert-desk"), f"desk.py tick --now {at}", 60))


def card(v, chat) -> str:
    return v.thread.shown(1)[chat]["text"]


def status(text: str, label: str) -> list[str]:
    head, sep, lines = text.partition(f"\n{label}:\n")
    assert sep, text
    return lines.split("\n")


def press(v, chat, option="done"):
    run(v.on_ha_event("telegram_callback", {"id": "cb", "data": f"i:1:{option}", "chat_id": chat, "user_id": chat,
                                            "message": {"message_id": v.thread.shown(1)[chat]["mid"],
                                                        "chat": {"id": chat}}, "bot": BOT}))


def test_each_fm_chat_reads_its_status_in_its_own_language_the_alert_text_unchanged(agent):
    rule(agent, "opened", 500)
    tick(agent, 20)                                    # the reminder, to both facility manager chats
    de, fr = card(agent, FM_DE), card(agent, FM_FR)
    assert re.fullmatch(rf"- Alarm gesendet (?:am|um) {T} \(an: FM\)", status(de, "Status")[0]), de
    assert re.fullmatch(rf"⚠️ ⚙️ Erinnerung gesendet (?:am|um) {T}, Keine Antwort nach 15Min\. \(an: FM\)",
                        status(de, "Status")[-1]), de
    assert re.fullmatch(rf"- Alerte envoyée (?:le|à) {T} \(à: FM\)", status(fr, "Statut")[0]), fr
    # the desk's own words ("No answer after 15min") in the chat's language, from the skill's words.yaml
    assert re.fullmatch(rf"⚠️ ⚙️ Rappel envoyé (?:le|à) {T}, Pas de réponse après 15min \(à: FM\)",
                        status(fr, "Statut")[-1]), fr
    for text in (de, fr):
        # the card's first line, "To:" and the villa's own words stay as they are
        assert text.startswith(f"#1-P2 (existing)\nTo: FM\n{SUMMARY}\nWhat to do: "), text
        assert "Reminder sent" not in text and "(to: " not in text
    # Telegram still draws the Status lines in italics in every language (message_format.parts finds the label)
    from vesta_shared.message_format import parts
    assert [k for k, *_ in parts(fr)][-2:] == ["label", "note"], parts(fr)


def test_a_press_is_told_in_each_chats_language(agent):
    rule(agent, "opened", 500)
    tick(agent, 20)
    press(agent, FM_FR)
    assert re.fullmatch(rf"✅ Terminé (?:le|à) {T} \(Luc\)\. Surveillance 4h\.", status(card(agent, FM_FR), "Statut")[-1]), card(agent, FM_FR)
    assert re.fullmatch(rf"✅ Erledigt (?:am|um) {T} \(Luc\)\. 4Std\. Beobachtung\.", status(card(agent, FM_DE), "Status")[-1]), card(agent, FM_DE)
    # the group's last line says the watch too, as every chat's (architecture review 21 card 1)
    assert re.fullmatch(rf"✅ Done (?:on|at) {T} \(Luc\)\. Watch 4h\.", status(card(agent, GROUP), "Status")[-1]), card(agent, GROUP)


def test_a_copy_recorded_before_is_drawn_again_whole_at_the_next_step(agent):
    # a copy stored by an earlier release (its heading as text, its lines English, no step kept with its status) was
    # only retitled at a step to another chat; every copy now takes every change (owner, 2026-11-07, live #146-P2):
    # drawn again whole, every line in its chat's language
    rule(agent, "opened", 500)
    tick(agent, 20)
    rec = agent.thread.shown(1)[FM_FR]
    old = "#1-P2 (existing)\nTo: FM\n- Alert sent 23/10/2026 09:48 (to: FM)"
    said = "Reminder sent 23/10/2026 10:04, No answer after 15min (to: FM)"
    agent.state.set_incident_message(1, FM_FR, {**rec, "parts": {"head": old, "lead": "", "body": SUMMARY,
                                                                  "status": said, "mark": None}})
    tick(agent, 50)                                    # a step to the owner: the facility manager's copy too
    fr = card(agent, FM_FR)
    assert fr.split("\n")[1] == "To: FM", fr                # whom this copy went to (owner, 2026-11-12)
    lines = status(fr, "Statut")
    assert [ln.split(" ")[1] for ln in lines] == ["Alerte", "Rappel", "⚙️"] and "Escalade envoyée" in lines[-1], lines


def test_every_language_of_the_people_list_has_its_words():
    assert set(status_words.LANGS) == set(LANGUAGES)
    with open(f"{STARTER_SKILLS}/alert-desk/words.yaml", encoding="utf-8") as f:
        words = yaml.safe_load(f)
    fields = lambda s: set(re.findall(r"{(\w+)}", s))
    for key, entry in words.items():
        entries = entry.values() if key == "lowered" else [entry]
        for e in entries:
            en = e.get("en")
            for lang in status_words.LANGS[1:]:
                assert e.get(lang), (key, lang)
                assert en is None or fields(e[lang]) == fields(en), (key, lang)
    with open(f"{STARTER_SKILLS}/alert-desk/skill.yaml", encoding="utf-8") as f:
        for b in yaml.safe_load(f)["buttons"]:
            assert set(b["labels"]) == set(status_words.LANGS[1:]), b


