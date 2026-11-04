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
from vesta_agent.roster import Roster

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
    assert str(closed) == "Done in the Cockpit on 11/10/2026 07:05 (JM)"
    assert str(kiosk_words.closed("JM", at, "UTC", end=True)) == "Done in the Cockpit on 11/10/2026 07:05 (JM)."
    assert str(taken) == "Ticket opened in the Cockpit on 11/10/2026 07:05 (FM)."
    assert str(reopened) == "Reopened in the Cockpit on 11/10/2026 07:05 (Owner): Pump weak. Please look again."
    assert closed.langs["fr"] == "Terminé dans le Cockpit le 11/10/2026 07:05 (JM)"
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
    v = make_agent(tmp_path, {}, roster=Roster.of(owner=[(GROUP, "Owner group")], fm=[(FM_DE, "Anna"), (FM_FR, "Luc")], languages={FM_DE: "de", FM_FR: "fr"}),
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
    assert status(v, FM_FR)[-1] == "✅ Terminé dans le Cockpit le 15/10/2026 00:40 (Luc).", status(v, FM_FR)
    assert status(v, FM_DE)[-1] == "✅ Im Cockpit erledigt am 15/10/2026 00:40 (Luc).", status(v, FM_DE)
    assert status(v, GROUP)[-1] == "✅ Done in the Cockpit on 15/10/2026 00:40 (Luc).", status(v, GROUP)
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
    assert str(who) == "Done in the Cockpit on 15/10/2026 00:40 (Luc)" and who.lang("fr").startswith("Terminé dans le Cockpit")


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


def test_not_a_problem_in_the_cockpit_is_said_as_such_never_as_a_done(tmp_path):
    # owner, 2026-11-04 (#117): "Not a problem while it lasts" pressed on the Cockpit's card, and Telegram, the tablet's
    # card and its notice all said "✅ Done in the Cockpit on … (Owner)."
    v, k, uid = villa(tmp_path)
    k.person_closes(uid, by="Luc", at="2026-10-15T00:40:00.000Z", lasting=True)
    run(v.tickets.repair())
    assert status(v, GROUP)[-1] == "✅ Not a problem in the Cockpit on 15/10/2026 00:40 (Luc).", status(v, GROUP)
    assert status(v, FM_FR)[-1] == "✅ Pas un problème dans le Cockpit le 15/10/2026 00:40 (Luc).", status(v, FM_FR)
    lines = [ln for m in k.messages.values() for ln in m.get("status") or []]        # the tablet's cards of the alert
    assert lines[-1] == "✅ Pas un problème dans le Cockpit le 15/10/2026 00:40 (Luc).", lines   # in the FM's language
    assert not any("Done" in ln or "Terminé" in ln for ln in lines), lines


def test_not_a_problem_pressed_on_telegram_closes_it_as_the_cockpit_does(tmp_path):
    # owner, 2026-11-04: "Not a problem" beside Done and Need help, on Telegram as on the Cockpit's card
    v, k, uid = villa(tmp_path)
    labels = [b["label"] for b in next(m for m in k.messages.values() if m.get("buttons"))["buttons"]]
    assert labels == ["Done", "Need help", "Not a problem"], labels          # the tablet's notice, as Telegram's
    run(v.on_ha_event("telegram_callback", {"id": "cb", "data": "i:1:not_a_problem", "chat_id": FM_FR, "user_id": FM_FR,
                                            "message": {"message_id": v.thread.shown(1)[FM_FR]["mid"], "chat": {"id": FM_FR}},
                                            "bot": BOT}))
    assert re.fullmatch(rf"✅ Pas un problème le {T} \(Luc\)\. .+", status(v, FM_FR)[-1]), status(v, FM_FR)
    assert re.fullmatch(rf"✅ Not a problem on {T} \(Luc\)\.", status(v, GROUP)[-1]), status(v, GROUP)
    from vesta_shared.problems import NOT_A_PROBLEM
    (task,) = [t for t in Store(v.s.store_path).tasks(None) if str(t.get("source")).startswith("incident:")]
    assert task["status"] == NOT_A_PROBLEM and task["close_note"].startswith("Not a problem on Telegram (Luc)")
    run(v.tickets.repair())
    last = k.ticket(uid)["updates"][-1]                     # its fault in the Cockpit: closed with nothing done, lasting
    assert (last["status"], last.get("kind"), last.get("lasting"), last.get("who")) == \
        ("resolved", "cleared", True, "Luc"), last
    assert not any(c.get("ticketId") == uid for c in k.doc["data"].get("completions") or [])   # never a repair
