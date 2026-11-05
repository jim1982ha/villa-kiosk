"""A person's close in the Cockpit is told as a Telegram close is (architecture review 23, cards 1 and 2): the alert desk
says it in every chat and on the tablet's card, with the watch its close wrote, under "(watch)"; a return within that
watch keeps the alert's number. The engine told it itself before: "✅ Done in the Cockpit on … (Luc)." under "(closed)",
no watch, and a return 2 minutes later opened a new number. Synthetic villa; ids and names invented."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from test_cockpit_languages import FM_FR, GROUP, RULE, T, run, status, told, villa
from vesta_shared import alert_watch
from vesta_shared.store import Store, notes_of


def _closed_in_the_cockpit(tmp_path, lasting=False):
    v, k, uid = villa(tmp_path)
    now = datetime.now(timezone.utc)
    k.person_closes(uid, by="Luc", at=now.strftime("%Y-%m-%dT%H:%M:00.000Z"), lasting=lasting, cockpit=True)
    assert run(v.tickets.repair())["handed"] == 1               # handed to the desk, started at once in the app
    return v, k, now


def test_a_done_in_the_cockpit_is_told_with_its_watch_in_every_chat_and_on_the_tablet(tmp_path):
    v, k, now = _closed_in_the_cockpit(tmp_path)
    told(v, now + timedelta(minutes=1))
    assert re.fullmatch(rf"✅ Done in the Cockpit on {T} \(Luc\)\. Watch 4h\.", status(v, GROUP)[-1]), status(v, GROUP)
    assert re.fullmatch(rf"✅ Terminé dans le Cockpit le {T} \(Luc\)\. Surveillance 4h\.", status(v, FM_FR)[-1]), \
        status(v, FM_FR)
    for chat in (GROUP, FM_FR):
        assert v.thread.shown(1)[chat]["text"].startswith("#1-P2 (watch)\n"), v.thread.shown(1)[chat]["text"]
    card = k.messages["incident:1"]
    assert (card.get("title") or card.get("head")) == "#1-P2 (watch)", card
    assert re.fullmatch(rf"✅ Done in the Cockpit on {T} \(Luc\)\. Watch 4h\.", card["status"][-1]), card["status"]
    # told once: the desk's next look says nothing more of it
    before = list(v.tg.edits)
    told(v, now + timedelta(minutes=2))
    assert not [e for e in v.tg.edits[len(before):] if "Cockpit" in e[2]], v.tg.edits[len(before):]


def test_a_return_within_the_watch_of_a_cockpit_close_keeps_its_number(tmp_path):
    # closed before the desk's first look: back 2 minutes later, it opened a new number (#2)
    v, k, now = _closed_in_the_cockpit(tmp_path)
    assert alert_watch.until(Store(v.s.store_path).incident(1)) is not None
    run(v.on_ha_event("vesta_critical_event", {
        "blueprint": "critical_condition", "rule_id": RULE, "incident_id": f"{RULE}-2", "phase": "opened",
        "severity": "critical", "label": "Phase C high", "entities": ["sensor.phase_c"], "summary": "⚡ Phase C high",
        "timestamp": (now + timedelta(minutes=2)).isoformat()}))
    assert [i["id"] for i in Store(v.s.store_path).incidents()] == [1]


def test_not_a_problem_on_a_persons_ticket_in_the_cockpit_is_said_as_such_and_never_read_again(tmp_path):
    # architecture review 23, card 2: the person's-ticket close said "Done in the Cockpit" and was read again
    from test_need_help_everywhere import desk, villa as help_villa
    k, v, st = help_villa(tmp_path)
    k.held("tk-2", title="Gate motor noisy")
    k.person_helps("tk-2", by="JM")
    run(v.tickets.repair())
    out = desk.tick(st, datetime.now(timezone.utc))
    run(v.outcome.carry_out(out, "alert-desk"))
    (iid,) = out["helped"]
    k.person_closes("tk-2", by="JM", lasting=True)
    assert run(v.tickets.repair())["handed"] == 1
    assert not alert_watch.awaiting_read(st.incident(iid))        # "Not a problem": never read again
    run(v.outcome.carry_out(desk.tick(st, datetime.now(timezone.utc)), "alert-desk"))
    last = [v.thread.shown(iid)[chat]["text"].split("\n")[-1] for chat, _ in v.state.incident_chats(iid)]
    assert last and all(re.match(rf"✅ Not a problem in the Cockpit on {T} \(JM\)\.", ln) for ln in last), last
    assert "kiosk_closed" not in notes_of(st.incident(iid))         # told once


def test_a_close_and_a_reopening_read_together_keep_the_close_in_every_story(tmp_path):
    # architecture review 24: Done then Reopen in the Cockpit, read in one go (pressed while VESTA restarted): the
    # facility manager's chat and the tablet's card read "Reopened in the Cockpit" under an alert never said closed
    from test_cockpit_languages import status as status_of
    v, k, uid = villa(tmp_path)
    now = datetime.now(timezone.utc)
    k.person_closes(uid, by="Luc", at=now.strftime("%Y-%m-%dT%H:%M:00.000Z"), cockpit=True)
    k.person_reopens(uid, by="JM", at=(now + timedelta(seconds=30)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))
    run(v.tickets.repair())
    told(v, now + timedelta(minutes=1))
    fr = status_of(v, FM_FR)
    assert re.fullmatch(rf"- Terminé dans le Cockpit le {T} \(Luc\)\. Surveillance 4h", fr[-2]), fr
    assert "Rouvert dans le Cockpit" in fr[-1], fr
    card = k.messages["incident:1"]["status"]
    assert re.fullmatch(rf"- Done in the Cockpit on {T} \(Luc\)\. Watch 4h", card[-2]) and "Reopened" in card[-1], card


def test_no_action_needed_in_the_cockpit_is_said_as_such_in_every_chat(tmp_path):
    # architecture review 24: the Kiosk's card said "No action needed on … (Luc)" and every chat "Done in the Cockpit on
    # … (Luc)" for the same press. Nothing done is still read again (its watch is a Done's): only the words change
    v, k, uid = villa(tmp_path)
    now = datetime.now(timezone.utc)
    k.person_closes(uid, by="Luc", at=now.strftime("%Y-%m-%dT%H:%M:00.000Z"), nothing=True)
    run(v.tickets.repair())
    told(v, now + timedelta(minutes=1))
    assert re.fullmatch(rf"✅ No action needed in the Cockpit on {T} \(Luc\)\. Watch 4h\.", status(v, GROUP)[-1]), \
        status(v, GROUP)
    assert re.fullmatch(rf"✅ Aucune action nécessaire dans le Cockpit le {T} \(Luc\)\. Surveillance 4h\.",
                        status(v, FM_FR)[-1]), status(v, FM_FR)
    assert alert_watch.awaiting_read(Store(v.s.store_path).incident(1))          # read again, as after a Done
