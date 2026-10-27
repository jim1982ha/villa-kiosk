"""What a person does in the Cockpit — closes an alert's fault, takes it on, reopens it — is said on each chat's copy of
the card in that chat's language (architecture review O, 2026-10-27: "Ticket opened in the Cockpit on … (…)." and
"Closed in the Cockpit on …" came in English on a card whose Status read French). The Cockpit's words are fixed words
of the engine's, written in every language the People list offers (status_words), English as before. Synthetic villa;
ids and names invented."""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone

from helpers import make_agent
from ha_fake import FakeHA, tool
from kiosk_fake import FakeKiosk
from telegram_fake import BOT
from vesta_agent.ha_events import CONTEXT_KEY
from vesta_shared import kiosk_words, message_format as mf, status_words
from vesta_shared.store import Store

GROUP, FM_DE, FM_FR = -100123, 222, 333
RULE = "automation.critical_condition_phase"
T = r"\d\d/\d\d/\d{4} \d\d:\d\d"


def run(coro):
    return asyncio.run(coro)


def test_every_cockpit_phrase_is_written_in_every_language():
    # a missing translation fails here, before it reaches a chat as English
    for lang in status_words.LANGS[1:]:
        assert set(status_words.WORDS[lang]["cockpit"]) == set(mf.COCKPIT), lang
        assert all(v.strip() for v in status_words.WORDS[lang]["cockpit"].values()), lang


def test_the_cockpit_lines_read_as_before_in_english_and_in_each_language():
    at = "2026-10-11T07:05:00Z"
    closed, taken = kiosk_words.closed("JM", at, "UTC"), kiosk_words.taken("FM", at, "UTC")
    reopened = kiosk_words.reopened("Owner", at, "UTC", "Pump weak")
    assert str(closed) == "Closed in the Cockpit on 11/10/2026 07:05 (JM)"
    assert str(kiosk_words.closed("JM", at, "UTC", end=True)) == "Closed in the Cockpit on 11/10/2026 07:05 (JM)."
    assert str(taken) == "Ticket opened in the Cockpit on 11/10/2026 07:05 (FM)."
    assert str(reopened) == "Reopened in the Cockpit on 11/10/2026 07:05 (Owner): Pump weak. Please look again."
    assert closed.langs["fr"] == "Clôturé dans le Cockpit le 11/10/2026 07:05 (JM)"
    assert taken.langs["de"] == "Ticket im Cockpit eröffnet am 11/10/2026 07:05 (FM)."
    assert reopened.langs["zh"] == "11/10/2026 07:05 已在 Cockpit 中重新打开 (Owner)：Pump weak。请再次检查。"
    assert set(closed.langs) == set(status_words.LANGS[1:])


def test_a_line_kept_in_the_store_keeps_its_languages_and_an_older_one_reads_as_written():
    w = kiosk_words.closed("JM", "2026-10-11T07:05:00Z", "UTC")
    back = kiosk_words.read(kiosk_words.stored(w))
    assert str(back) == str(w) and back.langs == w.langs
    old = kiosk_words.read("Closed in the Kiosk on 01/10/2026 09:00 (JM)")      # a note kept before 0.12.364
    assert str(old) == "Closed in the Kiosk on 01/10/2026 09:00 (JM)" and old.langs == {}
    assert kiosk_words.stored("Closed in the Cockpit") == "Closed in the Cockpit"   # no languages: its text, as before


def villa(tmp_path):
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [
        {"telegram_id": GROUP, "name": "Owner group", "role": "owner", "language": "en"},
        {"telegram_id": FM_DE, "name": "Anna", "role": "fm", "language": "de"},
        {"telegram_id": FM_FR, "name": "Luc", "role": "fm", "language": "fr"}]},
        skills=["alert-desk"], reader=FakeHA(tools=[tool("ha_get_state")]), kiosk=k)
    v.bot_username = BOT["username"]
    ctx = "RUN-500"
    run(v.on_ha_event("telegram_sent", {"chat_id": GROUP, "message_id": 500, "bot": BOT, CONTEXT_KEY: ctx}))
    run(v.on_ha_event("vesta_critical_event", {
        "blueprint": "critical_condition", "rule_id": RULE, "incident_id": f"{RULE}-1", "phase": "opened",
        "severity": "critical", "label": "Phase C high", "entities": ["sensor.phase_c"], "summary": "⚡ Phase C high",
        "timestamp": datetime.now(timezone.utc).isoformat(), CONTEXT_KEY: ctx}))
    run(v.tickets.repair())                                  # the alert's fault in the Cockpit
    (task,) = [t for t in Store(v.s.store_path).tasks(None) if str(t.get("source")).startswith("incident:")]
    return v, k, task["todo_uid"]


def status(v, chat) -> list[str]:
    text = v.thread.shown(1)[chat]["text"]
    label = status_words.label(v.notices.lang(chat))
    head, sep, lines = text.partition(f"\n{label}:\n")
    assert sep, text
    return lines.split("\n")


def test_a_fault_taken_on_in_the_cockpit_is_said_in_each_chats_language(tmp_path):
    v, k, uid = villa(tmp_path)
    k.person_moves(uid, by="Luc", at="2026-10-15T00:40:00.000Z")
    run(v.tickets.repair())
    assert status(v, FM_FR)[-1].endswith(" Ticket ouvert dans le Cockpit le 15/10/2026 00:40 (Luc)."), status(v, FM_FR)
    assert status(v, FM_DE)[-1].endswith(" Ticket im Cockpit eröffnet am 15/10/2026 00:40 (Luc)."), status(v, FM_DE)
    assert status(v, GROUP)[-1].endswith(" Ticket opened in the Cockpit on 15/10/2026 00:40 (Luc)."), status(v, GROUP)
    # ...and kept in its story in every language: a later step's card lists it in the chat's words
    assert any(ln == "- Ticket ouvert dans le Cockpit le 15/10/2026 00:40 (Luc)" for ln in v.notices.history_lines(1, FM_FR))


def test_a_fault_closed_in_the_cockpit_is_said_in_each_chats_language_and_its_check_after_too(tmp_path):
    v, k, uid = villa(tmp_path)
    k.person_closes(uid, by="Luc", at="2026-10-15T00:40:00.000Z", cockpit=True)
    run(v.tickets.repair())
    assert status(v, FM_FR)[-1] == "✅ Clôturé dans le Cockpit le 15/10/2026 00:40 (Luc).", status(v, FM_FR)
    assert status(v, FM_DE)[-1] == "✅ Im Cockpit geschlossen am 15/10/2026 00:40 (Luc).", status(v, FM_DE)
    assert status(v, GROUP)[-1] == "✅ Closed in the Cockpit on 15/10/2026 00:40 (Luc).", status(v, GROUP)
    # the desk's read-again after it names the close in each language (alert_watch CHECK, kept by kiosk_words.stored)
    import importlib.util
    import os
    from helpers import STARTER_SKILLS
    spec = importlib.util.spec_from_file_location("desk_cockpit", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
    desk = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(desk)
    from vesta_shared import alert_watch
    from vesta_shared.store import notes_of
    who = desk.relabel(notes_of(Store(v.s.store_path).incident(1))[alert_watch.CHECK])
    assert str(who) == "Closed in the Cockpit on 15/10/2026 00:40 (Luc)" and who.lang("fr").startswith("Clôturé dans le Cockpit")


def test_a_fault_reopened_in_the_cockpit_is_asked_again_in_each_chats_language(tmp_path):
    v, k, uid = villa(tmp_path)
    now = datetime.now(timezone.utc)
    stamp = lambda m: (now + timedelta(minutes=m)).strftime("%Y-%m-%dT%H:%M:00.000Z")
    k.person_closes(uid, by="Luc", at=stamp(1), cockpit=True)
    run(v.tickets.repair())
    k.person_reopens(uid, by="Anna", at=stamp(3))
    run(v.tickets.repair())
    run(v.run_code_job(v.skills.get("alert-desk"), f"desk.py tick --now {(now + timedelta(minutes=4)).isoformat()}", 60))
    assert re.search(rf"Rouvert dans le Cockpit le {T} \(Anna\)\. Merci de vérifier à nouveau\.", status(v, FM_FR)[-1]), status(v, FM_FR)
    assert re.search(rf"Im Cockpit wieder geöffnet am {T} \(Anna\)\. Bitte noch einmal prüfen\.", status(v, FM_DE)[-1]), status(v, FM_DE)
