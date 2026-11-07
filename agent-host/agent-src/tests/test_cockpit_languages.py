"""What a person does in the Cockpit — closes an alert's fault, takes it on, reopens it — is said on each chat's copy of
the card in that chat's language (architecture review O, 2026-10-27: "Ticket opened in the Cockpit on … (…)." and
"Closed in the Cockpit on …" came in English on a card whose Status read French). The Cockpit's words are fixed words
of the engine's, written in every language the People list offers (status_words), English as before. Synthetic villa;
ids and names invented."""
from __future__ import annotations

import asyncio
import re

import pytest
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
#: A Status moment: its time alone on the alert's day, "08/11 09:20" another (timeutil.status_moment), whole elsewhere
T = r"(?:\d\d/\d\d(?:/\d{4})? )?\d\d:\d\d"


def run(coro):
    return asyncio.run(coro)


def test_every_cockpit_phrase_is_written_in_every_language():
    # a missing translation fails here, before it reaches a chat as English
    for lang in status_words.LANGS[1:]:
        assert set(status_words.WORDS[lang]["cockpit"]) == set(mf.COCKPIT), lang
        assert all(v.strip() for v in status_words.WORDS[lang]["cockpit"].values()), lang


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


def told(v, now: datetime) -> None:
    """The alert desk's next look (the engine starts it at once after a press it handed over: Scheduler.frequent_now),
    which tells a close in the Cockpit (Notes.KIOSK_CLOSED)."""
    run(v.run_code_job(v.skills.get("alert-desk"), f"desk.py tick --now {now.isoformat()}", 60))


def status(v, chat) -> list[str]:
    text = v.thread.shown(1)[chat]["text"]
    label = status_words.label(v.notices.lang(chat))
    head, sep, lines = text.partition(f"\n{label}:\n")
    assert sep, text
    return lines.split("\n")


def test_not_a_problem_in_the_cockpit_is_said_as_such_never_as_a_done(tmp_path):
    # owner, 2026-11-04 (#117): "Not a problem while it lasts" pressed on the Cockpit's card, and Telegram, the tablet's
    # card and its notice all said "✅ Done in the Cockpit on … (Owner)."
    v, k, uid = villa(tmp_path)
    now = datetime.now(timezone.utc)
    k.person_closes(uid, by="Luc", at=now.strftime("%Y-%m-%dT%H:%M:00.000Z"), lasting=True)
    run(v.tickets.repair())
    told(v, now + timedelta(minutes=1))
    assert re.fullmatch(rf"✅ Not a problem in the Cockpit (?:on|at) {T} \(Luc\)\. Watch 4h\.", status(v, GROUP)[-1]), status(v, GROUP)
    assert re.fullmatch(rf"✅ Pas un problème dans le Cockpit (?:le|à) {T} \(Luc\)\. Surveillance 4h\.", status(v, FM_FR)[-1]), status(v, FM_FR)
    lines = [ln for m in k.messages.values() for ln in m.get("status") or []]        # the tablet's cards of the alert
    # the tablet's card in English, the French beside it (architecture review 22, card 4: it was the FM chat's, drawn last)
    assert re.fullmatch(rf"✅ Not a problem in the Cockpit (?:on|at) {T} \(Luc\)\. Watch 4h\.", lines[-1]), lines
    (card,) = [m for m in k.messages.values() if m.get("languages")]
    (fr,) = card["languages"]["fr"]["status"]
    assert re.fullmatch(rf"Pas un problème dans le Cockpit (?:le|à) {T} \(Luc\)\. Surveillance 4h\.", fr), card
    assert not any("Done" in ln or "Terminé" in ln for ln in lines), lines


def test_not_a_problem_pressed_on_telegram_closes_it_as_the_cockpit_does(tmp_path):
    # owner, 2026-11-04: "Not a problem" beside Done and Need help, on Telegram as on the Cockpit's card
    v, k, uid = villa(tmp_path)
    labels = [b["label"] for b in next(m for m in k.messages.values() if m.get("buttons"))["buttons"]]
    assert labels == ["Done", "Not a problem", "Open Ticket", "Need help"], labels          # the tablet's notice, as Telegram's
    run(v.on_ha_event("telegram_callback", {"id": "cb", "data": "i:1:not_a_problem", "chat_id": FM_FR, "user_id": FM_FR,
                                            "message": {"message_id": v.thread.shown(1)[FM_FR]["mid"], "chat": {"id": FM_FR}},
                                            "bot": BOT}))
    assert re.fullmatch(rf"✅ Pas un problème (?:le|à) {T} \(Luc\)\. .+", status(v, FM_FR)[-1]), status(v, FM_FR)
    # the same last line in every chat, its watch included (architecture review 21 card 1: the group's ended "(Luc).")
    assert re.fullmatch(rf"✅ Not a problem (?:on|at) {T} \(Luc\)\. Watch .+", status(v, GROUP)[-1]), status(v, GROUP)
    # owner, 2026-11-05 (#118): the press said once, by its close — never also a line above it
    assert sum("Pas un problème" in ln for ln in status(v, FM_FR)) == 1, status(v, FM_FR)
    assert sum("Not a problem" in ln for ln in status(v, GROUP)) == 1, status(v, GROUP)
    from vesta_shared.problems import NOT_A_PROBLEM
    (task,) = [t for t in Store(v.s.store_path).tasks(None) if str(t.get("source")).startswith("incident:")]
    assert task["status"] == NOT_A_PROBLEM and task["close_note"].startswith("Not a problem on Telegram (Luc)")
    run(v.tickets.repair())
    last = k.ticket(uid)["updates"][-1]                     # its fault in the Cockpit: closed with nothing done, lasting
    assert (last["status"], last.get("kind"), last.get("lasting"), last.get("who")) == \
        ("resolved", "cleared", True, "Luc"), last
    assert not any(c.get("ticketId") == uid for c in k.doc["data"].get("completions") or [])   # never a repair


@pytest.mark.parametrize("lasting,said,said_fr", [
    (True, "Not a problem in the Cockpit (?:on|at)", "Pas un problème dans le Cockpit (?:le|à)"),
    (False, "Done in the Cockpit (?:on|at)", "Terminé dans le Cockpit (?:le|à)")])
def test_a_close_in_the_cockpit_keeps_its_own_line_once_something_follows_it(tmp_path, lasting, said, said_fr):
    """Architecture review 22, card 6: a close kept a line only when a closing message happened to be sent — "Not a
    problem" in the Cockpit had none, and no close line ever said who closed it. Reopened after it, the card tells the
    close in its own words, in each chat's language, above the reopening."""
    v, k, uid = villa(tmp_path)
    now = datetime.now(timezone.utc)
    stamp = lambda m: (now + timedelta(minutes=m)).strftime("%Y-%m-%dT%H:%M:00.000Z")
    k.person_closes(uid, by="Luc", at=stamp(1), lasting=lasting, cockpit=True)
    run(v.tickets.repair())
    told(v, now + timedelta(minutes=2))
    k.person_reopens(uid, by="Anna", at=stamp(3))
    run(v.tickets.repair())
    run(v.run_code_job(v.skills.get("alert-desk"), f"desk.py tick --now {(now + timedelta(minutes=4)).isoformat()}", 60))
    fr = status(v, FM_FR)                         # the reopening went to the facility managers' chats
    assert any(re.fullmatch(rf"- {said_fr} {T} \(Luc\)\. Surveillance 4h", ln) for ln in fr), fr   # its watch, as told
    assert "Rouvert dans le Cockpit" in fr[-1] and not any("Clôture" in ln for ln in fr), fr
    card = k.messages["incident:1"]["status"]     # the tablet's card, in English (its story: every step)
    assert any(re.fullmatch(rf"- {said} {T} \(Luc\)\. Watch 4h", ln) for ln in card), card
    assert not any("Closing note sent" in ln for ln in card), card
