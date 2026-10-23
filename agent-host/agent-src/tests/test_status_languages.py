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

GROUP, FM_DE, FM_FR = -100123, 222, 333
RULE = "automation.critical_condition_phase"
SUMMARY = "⚡ Phase C high\nPhase C 4580 W\nAbove 4000 W, Held 15 min"
T = r"\d\d/\d\d/\d{4} \d\d:\d\d"


def run(coro):
    return asyncio.run(coro)


def villa(tmp_path, group_language="en"):
    v = make_agent(tmp_path, {"people": [
        {"telegram_id": GROUP, "name": "Owner group", "role": "owner", "language": group_language},
        {"telegram_id": FM_DE, "name": "Anna", "role": "fm", "language": "de"},
        {"telegram_id": FM_FR, "name": "Luc", "role": "fm", "language": "fr"}]},
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
    head, sep, lines = text.partition(f"\n\n{label}:\n")
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
    assert re.fullmatch(rf"- Alarm gesendet am {T} \(an: FM\)", status(de, "Status")[0]), de
    assert re.fullmatch(rf"⚠️ ⚙️ Erinnerung gesendet am {T}, Keine Antwort nach 15 Min\. \(an: FM\)",
                        status(de, "Status")[-1]), de
    assert re.fullmatch(rf"- Alerte envoyée le {T} \(à: FM\)", status(fr, "Statut")[0]), fr
    # the desk's own words ("No answer after 15 min") in the chat's language, from the skill's words.yaml
    assert re.fullmatch(rf"⚠️ ⚙️ Rappel envoyé le {T}, Pas de réponse après 15 min \(à: FM\)",
                        status(fr, "Statut")[-1]), fr
    for text in (de, fr):
        # the card's first line, "To:" and the villa's own words stay as they are
        assert text.startswith(f"#1-P2 (existing)\nTo: FM\n{SUMMARY}\nWhat to do: "), text
        assert "Reminder sent" not in text and "(to: " not in text
    # Telegram still draws the Status lines in italics in every language (message_format.parts finds the label)
    from vesta_shared.message_format import parts
    assert [k for k, *_ in parts(fr)][-2:] == ["label", "note"], parts(fr)


def test_a_new_alert_says_so_in_each_language(agent):
    rule(agent, "opened", 500)
    assert status(card(agent, FM_FR), "Statut")[-1] == "⚠️ Nouvelle alerte", card(agent, FM_FR)
    assert status(card(agent, FM_DE), "Status")[-1] == "⚠️ Neuer Alarm", card(agent, FM_DE)


def test_the_villas_own_message_taken_over_in_a_french_chat_reads_french(agent):
    # the villa's rule posts in the facility manager's chat, and alerts again inside its cooldown: only its own message
    # (taken over: Outcome.adopt_ha) says the step there
    rule(agent, "opened", 600, chat=FM_FR)
    rule(agent, "opened", 601, chat=FM_FR)
    fr = card(agent, FM_FR)
    assert re.fullmatch(rf"⚠️ ⚙️ Alerte « toujours là » envoyée le {T}, Toujours là: \d+ fois depuis .+ \(à: FM\)",
                        status(fr, "Statut")[-1]), fr


def test_a_lowered_priority_is_told_in_each_language(agent):
    # a settle note alone (no message of the desk's): each copy shows its own language, and the copy another chat gets
    # of it later too (IncidentThread.sync)
    rule(agent, "opened", 500)
    rule(agent, "opened", 501, priority="P3")
    assert re.fullmatch(rf"⚠️ ⚙️ Abaissée à P3 le {T}: gardée pour le prochain résumé quotidien\. Aucune réponse "
                        r"nécessaire\.", status(card(agent, FM_FR), "Statut")[-1]), card(agent, FM_FR)
    assert status(card(agent, GROUP), "Status")[-1].startswith("⚠️ ⚙️ Lowered to P3 on "), card(agent, GROUP)


def test_a_press_reaches_a_chat_its_answer_does_not_concern_in_that_chats_language(tmp_path):
    # the owner's group (Indonesian) is not one of the facility manager's: only the press itself (AlertButtons) says it
    v = villa(tmp_path, "id")
    rule(v, "opened", 700)
    press(v, FM_DE)
    assert re.fullmatch(rf"✅ Selesai pada {T} \(Anna\)\.", status(card(v, GROUP), "Status")[-1]), card(v, GROUP)


def test_the_desks_end_carries_every_language(tmp_path):
    # the desk's end, said on every copy (its settle note) and to the chased (its message), in each language
    import importlib.util
    import os
    from vesta_shared.store import Store
    spec = importlib.util.spec_from_file_location("desk", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
    desk = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(desk)
    store, t0 = Store(str(tmp_path / "store.sqlite")), datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
    ev = {"blueprint": "critical_condition", "rule_id": RULE, "incident_id": f"{RULE}-1", "phase": "opened",
          "severity": "critical", "label": "Phase C high", "entities": ["sensor.phase_c"], "summary": SUMMARY,
          "timestamp": t0.isoformat()}
    desk.intake(store, ev, t0, occupancy_reader=lambda: "occupied")
    res = desk.intake(store, {**ev, "phase": "resolved"}, t0 + timedelta(minutes=20))
    assert res["settle"][0]["note"] == "Cleared on {time}." and res["settle"][0]["note_in"]["fr"] == "Résolu le {time}."
    assert res["send"][0]["status_in"]["ko"] == "{time} 해제됨."
    assert desk.ended(desk.say("no_longer_reported")).langs["de"] == "Behoben am {time}: es wird nicht mehr gemeldet."


def test_an_english_chat_reads_english_as_before(agent):
    rule(agent, "opened", 500)
    tick(agent, 20)
    tick(agent, 50)                                    # the escalation: to the owner, in the group
    group = card(agent, GROUP)
    assert re.fullmatch(rf"⚠️ ⚙️ Escalation sent {T}, No answer from FM after 45 min \(to: Owner\)",
                        status(group, "Status")[-1]), group


def test_a_press_is_told_in_each_chats_language(agent):
    rule(agent, "opened", 500)
    tick(agent, 20)
    press(agent, FM_FR)
    assert re.fullmatch(rf"✅ Terminé le {T} \(Luc\)\.", status(card(agent, FM_FR), "Statut")[-1]), card(agent, FM_FR)
    assert re.fullmatch(rf"✅ Erledigt am {T} \(Luc\)\.", status(card(agent, FM_DE), "Status")[-1]), card(agent, FM_DE)
    assert re.fullmatch(rf"✅ Done on {T} \(Luc\)\.", status(card(agent, GROUP), "Status")[-1]), card(agent, GROUP)


def test_a_need_help_press_is_listed_in_each_chats_language(agent):
    # the press is a history line (note_press, its labels kept): a later step's card lists it in the chat's words
    rule(agent, "opened", 500)
    press(agent, FM_DE, "need_help")
    lines = agent.notices.history_lines(1, FM_FR)
    assert any(re.fullmatch(rf"- 🆘 Besoin d'aide le {T} \(Anna\)", ln) for ln in lines), lines
    assert any(re.fullmatch(rf"- 🆘 Need help on {T} \(Anna\)", ln) for ln in agent.notices.history_lines(1, GROUP))


def test_a_clearing_says_its_end_in_each_language(agent):
    rule(agent, "opened", 500)
    tick(agent, 20)
    rule(agent, "resolved", 501)
    assert re.fullmatch(rf"✅ Résolu le {T}\.", status(card(agent, FM_FR), "Statut")[-1]), card(agent, FM_FR)
    assert re.fullmatch(rf"✅ Behoben am {T}\.", status(card(agent, FM_DE), "Status")[-1]), card(agent, FM_DE)


def test_a_copy_recorded_before_keeps_its_english_lines(agent):
    # a copy stored by an earlier release: its heading as text, its lines English, no step kept with its status
    rule(agent, "opened", 500)
    tick(agent, 20)
    rec = agent.thread.shown(1)[FM_FR]
    old = "#1-P2 (existing)\nTo: FM\n- Alert sent 23/10/2026 09:48 (to: FM)"
    said = "Reminder sent 23/10/2026 10:04, No answer after 15 min (to: FM)"
    agent.state.set_incident_message(1, FM_FR, {**rec, "parts": {"head": old, "lead": "", "body": SUMMARY,
                                                                  "status": said, "mark": None}})
    tick(agent, 50)                                    # a step to the owner: the facility manager's copy only retitled
    fr = card(agent, FM_FR)
    assert fr.split("\n")[1] == "To: Owner & FM", fr
    assert status(fr, "Status") == ["- Alert sent 23/10/2026 09:48 (to: FM)", f"⚠️ ⚙️ {said}"], fr


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


def test_the_fixed_words_in_a_language():
    sw = status_words
    assert sw.times(6, 7, "fr") == ", 6e fois en 7 jours" and sw.times(6, 7, "de") == ", 6. Mal in 7 Tagen"
    assert sw.times(6, 7, "en") == ", 6th time in 7 days" and sw.times(1, 7, "fr") == ""
    assert sw.step("new", "23/10/2026 09:48", sw.times(6, 7, "fr"), "FM", "fr") == \
        "Alerte envoyée le 23/10/2026 09:48, 6e fois en 7 jours (à: FM)"
    assert sw.who({"owner", "fm"}, "fr") == "Propriétaire & FM" and sw.who({"owner", "fm"}) == "Owner & FM"
    assert sw.duration(90 * 60, "de") == "1 Std. 30 Min." and sw.duration(15 * 60, "zh") == "15分钟"
    assert sw.closing("elle n'est plus signalée", "fr") == "Résolu le {time}: elle n'est plus signalée."
    assert sw.stage_words("existing", lang="id") == "Masih terbuka" and sw.stage_words("closed", lang="fr") == "Résolu."
    assert sw.pick("No answer", {"fr": "Pas de réponse"}, "ko") == "No answer"
