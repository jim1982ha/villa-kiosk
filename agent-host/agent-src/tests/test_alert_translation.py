"""An alert card's own words — written in English by the villa's automations — reach each chat in that chat's language,
translated by the AI once per sentence pattern (owner, 2026-10-23). The card goes out in English at once; the
translation comes after and edits that chat's copy; the next card with the same pattern arrives translated, with no AI
call. Any failure leaves the English. Two facility manager chats, one reading French and one German, and the owner's
group in English. Synthetic villa; ids and names invented."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone

import pytest

from ai_fake import FakeAI
from ha_fake import FakeHA, tool
from helpers import make_agent
from telegram_fake import BOT
from vesta_agent import translation
from vesta_agent.ha_events import CONTEXT_KEY
from vesta_agent.state import State
from vesta_agent.translation import answer, fill, fits, mask, wordy

GROUP, FM_DE, FM_FR = -100123, 222, 333
AGREED = {"alert-desk": {"brain": "economy", "limit_usd": 0.05}}
LANGS = {"French": "fr", "German": "de"}


def villa(tmp_path, group_language="en", agreed=True):
    pol = {"people": [
        {"telegram_id": GROUP, "name": "Owner group", "role": "owner", "language": group_language},
        {"telegram_id": FM_DE, "name": "Anna", "role": "fm", "language": "de"},
        {"telegram_id": FM_FR, "name": "Luc", "role": "fm", "language": "fr"}]}
    if agreed:
        pol["settings"] = {"skill_ai": AGREED}
    v = make_agent(tmp_path, pol, skills=["alert-desk"], reader=FakeHA(tools=[tool("ha_get_state")]))
    v.bot_username = BOT["username"]
    # the villa's devices as the night's build names them: a name in an alert is a value, never words to translate
    from vesta_shared.knowledge_pack import build_pack
    reg = {"areas": [{"area_id": "entry", "name": "Entrance"}],
           "entities": [{"entity_id": "lock.test_lock", "name": "Test lock", "area_id": "entry"},
                        {"entity_id": "lock.front_gate", "name": "Front Gate Lock", "area_id": "entry"}]}
    with open(v.s.pack_path, "w", encoding="utf-8") as f:
        f.write(build_pack(reg, []).to_json())
    return v


def translator(run: dict) -> str:
    """The stand-in AI: each line of the run's JSON list "translated" as "(fr) …", its slots kept."""
    lang = LANGS[re.search(r"from English into (\w+)\.", run["prompt"]).group(1)]
    lines = json.loads(run["prompt"].rsplit("\n", 1)[1])
    return json.dumps([f"({lang}) {x}" for x in lines], ensure_ascii=False)


async def alert(v, n: int, entity: str, name: str, secs: int, at: str, chat: int = GROUP, mid: int = 500):
    """The villa's rule: its own (English) message in `chat`, then its event — one run, one context."""
    ctx = f"RUN-{n}"
    summary = f'{name} has been "unavailable" for over {secs} s.\nSince {at}'
    await v.on_ha_event("telegram_sent", {"chat_id": chat, "message_id": mid + n, "bot": BOT, CONTEXT_KEY: ctx})
    await v.on_ha_event("vesta_critical_event", {
        "blueprint": "critical_condition", "rule_id": f"automation.watch_{n}", "incident_id": f"automation.watch_{n}-1",
        "phase": "opened", "severity": "critical", "label": f"{name} unavailable", "entities": [entity],
        "summary": summary, "timestamp": datetime.now(timezone.utc).isoformat(), CONTEXT_KEY: ctx})


def card(v, iid, chat) -> str:
    return v.thread.shown(iid)[chat]["text"]


def edits_to(v, chat) -> list[str]:
    return [t for c, _m, t in v.tg.edits if c == chat]


def sent_to(v, chat) -> list[str]:
    return [t for c, t, _k in v.tg.sent if c == chat]


# ------------------------------------------------------------------ (a) first time: English at once, then edited
def test_the_first_alert_goes_english_at_once_then_each_chat_reads_its_language(tmp_path, monkeypatch):
    v = villa(tmp_path)
    ai = FakeAI(translator).install(monkeypatch)

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        at_once = {c: card(v, 1, c) for c in (GROUP, FM_DE, FM_FR)}
        await v.translations.idle()
        return at_once
    at_once = run(go())
    english = 'Test lock has been "unavailable" for over 10 s.\nSince 23/10/2026 18:30'
    # every chat got the alert at once, in English (nothing waited on the AI)
    assert all(english in t for t in at_once.values()), at_once
    assert all(any(english in t for t in sent_to(v, c)) for c in (FM_DE, FM_FR)), v.tg.sent
    # then the French and German copies were edited: their words translated, the values as written
    assert '(fr) Test lock has been "unavailable" for over 10 s.\n(fr) Since 23/10/2026 18:30' in card(v, 1, FM_FR)
    assert '(de) Test lock has been "unavailable" for over 10 s.' in card(v, 1, FM_DE)
    assert any("(fr) Since 23/10/2026 18:30" in t for t in edits_to(v, FM_FR))
    # the English chat untouched; the Status lines still the chat's own (status_words), the heading as before
    assert english in card(v, 1, GROUP) and "(fr)" not in card(v, 1, GROUP) and "(de)" not in card(v, 1, GROUP)
    assert card(v, 1, FM_FR).startswith("#1-P2 (") and "Statut:" in card(v, 1, FM_FR)
    # the buttons stayed on the edited copies
    assert v.thread.shown(1)[FM_FR]["buttons"] and v.thread.shown(1)[FM_FR].get("kb")
    # one tiny run per language: the skeleton only — no name, number or time reached the AI — no tool, the skill's pair
    assert sorted(LANGS[re.search(r"into (\w+)\.", r["prompt"]).group(1)] for r in ai.runs) == ["de", "fr"]
    for r in ai.runs:
        assert "Test lock" not in r["prompt"] and "18:30" not in r["prompt"] and '"unavailable"' not in r["prompt"]
        assert "{1} has been {2} for over {3} s." in r["prompt"] and "Since {1} {2}" in r["prompt"]
        assert r["allowed"] == set() and r["profile"] == "economy" and r["limit_usd"] == 0.05
        assert r["skill"] == "alert-desk" and r["who"].endswith("alert-translation")
        assert "alert card" in r["system_prompt"]                     # the skill's own words (skills before code)


# ------------------------------------------------------------------ (b) the same pattern again: translated at once
def test_the_same_alert_again_with_other_values_arrives_translated_with_no_ai_call(tmp_path, monkeypatch):
    v = villa(tmp_path)
    ai = FakeAI(translator).install(monkeypatch)

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        await v.translations.idle()
        runs, edits = len(ai.runs), len(v.tg.edits)
        await alert(v, 2, "lock.front_gate", "Front Gate Lock", 25, "24/10/2026 07:15")
        await v.translations.idle()
        return runs, edits
    runs, edits = run(go())
    assert len(ai.runs) == runs == 2                                   # no AI call the second time
    fr = [t for t in sent_to(v, FM_FR) if "Front Gate Lock" in t]
    assert fr and '(fr) Front Gate Lock has been "unavailable" for over 25 s.\n(fr) Since 24/10/2026 07:15' in fr[0]
    assert any('(de) Front Gate Lock has been "unavailable" for over 25 s.' in t for t in sent_to(v, FM_DE))
    # sent translated: an edit of #2's copies there (a heading brought up to date) never brings the English
    mids = {v.thread.shown(2)[c]["mid"] for c in (FM_DE, FM_FR)}
    assert all("(fr) Front" in t or "(de) Front" in t for _c, m, t in v.tg.edits[edits:] if m in mids)


# ------------------------------------------------------------------ (c) any failure: English, delivered, no exception
@pytest.mark.parametrize("how", ["no credit", "error", "timeout", "a slot missing", "not a list"])
def test_a_failed_translation_leaves_the_english_and_the_alert_delivered(tmp_path, monkeypatch, how):
    v = villa(tmp_path)

    def dropped(run):
        lines = json.loads(run["prompt"].rsplit("\n", 1)[1])
        return json.dumps([x.replace("{1}", "") for x in lines])
    ai = {"no credit": FakeAI("", problem="credit"),
          "error": FakeAI(lambda r: (_ for _ in ()).throw(RuntimeError("the SDK broke"))),
          "timeout": FakeAI(translator, delay_s=30),
          "a slot missing": FakeAI(dropped),
          "not a list": FakeAI("Voici la traduction : bonjour")}[how].install(monkeypatch)
    if how == "timeout":
        monkeypatch.setattr(translation, "translate_seconds", lambda: 0.05)

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        await v.translations.idle()
    run(go())
    english = 'Test lock has been "unavailable" for over 10 s.'
    assert ai.runs, "the AI was asked"
    for chat in (GROUP, FM_DE, FM_FR):
        assert english in card(v, 1, chat) and "(fr)" not in card(v, 1, chat), card(v, 1, chat)
    assert v.thread.shown(1)[FM_FR]["buttons"]                        # the chase is untouched
    assert v.state.translation("fr", "{1} has been {2} for over {3} s.") is None       # nothing wrong kept


def test_an_edit_telegram_refuses_leaves_the_english_on_the_card(tmp_path, monkeypatch):
    v = villa(tmp_path)
    FakeAI(translator).install(monkeypatch)

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        v.tg.refuse.add("edit")
        await v.translations.idle()
    run(go())
    assert not any("(fr)" in t for t in sent_to(v, FM_FR) + edits_to(v, FM_FR))
    assert v.thread.shown(1)[FM_FR].get("owed")                       # tried again by housekeeping, as any edit


# ------------------------------------------------------------------ (d) not agreed: not run, said once
def test_with_no_agreed_cost_nothing_is_translated_and_the_log_says_so_once(tmp_path, monkeypatch, caplog):
    v = villa(tmp_path, agreed=False)
    ai = FakeAI(translator).install(monkeypatch)
    caplog.set_level(logging.INFO, logger="vesta.translation")

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        await alert(v, 2, "lock.front_gate", "Front Gate Lock", 25, "24/10/2026 07:15")
        await v.translations.idle()
    run(go())
    assert ai.runs == []
    assert 'Test lock has been "unavailable" for over 10 s.' in card(v, 1, FM_FR)
    said = [r for r in caplog.records if "stay in English" in r.getMessage()]
    assert len(said) == 1 and "alert-desk" in said[0].getMessage(), [r.getMessage() for r in caplog.records]
    assert "Home Assistant" not in said[0].getMessage()


# ------------------------------------------------------------------ (e) redraws keep the translation
def test_a_reminder_and_a_press_keep_each_chats_translation(tmp_path, monkeypatch):
    v = villa(tmp_path, group_language="fr")
    ai = FakeAI(translator).install(monkeypatch)

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        await v.translations.idle()
        runs = len(ai.runs)
        at = (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat()
        await v.run_code_job(v.skills.get("alert-desk"), f"desk.py tick --now {at}", 60)    # the reminder to the FMs
        await v.translations.idle()
        reminded = {c: card(v, 1, c) for c in (GROUP, FM_DE, FM_FR)}
        await v.on_ha_event("telegram_callback", {
            "id": "cb", "data": "i:1:done", "chat_id": FM_DE, "user_id": FM_DE, "bot": BOT,
            "message": {"message_id": v.thread.shown(1)[FM_DE]["mid"], "chat": {"id": FM_DE}}})
        await v.translations.idle()
        return runs, reminded
    runs, reminded = run(go())
    assert len(ai.runs) == runs                                       # every redraw from what is kept
    assert "Rappel envoyé" in reminded[FM_FR] and "Erinnerung gesendet" in reminded[FM_DE]
    for chat, lang in ((FM_FR, "fr"), (FM_DE, "de"), (GROUP, "fr")):
        for text in (reminded[chat], card(v, 1, chat)):
            assert f'({lang}) Test lock has been "unavailable" for over 10 s.' in text, text
            assert 'Test lock has been "unavailable" for over 10 s.\nSince' not in text      # never the English back
    # no copy was ever re-sent or edited back to the English after it was translated
    for chat in (FM_FR, FM_DE):
        shown = [t for t in sent_to(v, chat) + edits_to(v, chat)]
        first = next(i for i, t in enumerate(shown) if "(fr)" in t or "(de)" in t)
        assert all("(fr)" in t or "(de)" in t for t in shown[first:] if "Test lock" in t), shown


def test_a_copy_handed_to_another_chat_never_shows_the_first_chats_language():
    # IncidentThread.sync hands a copy's parts to every other chat: the French words are the French chat's only
    from vesta_agent import layout
    p = layout.parts(body="Door open", status="", head=layout.head("#1-P2", "FM", (), "existing", "de"))
    assert "Porte ouverte" not in layout.render({**p, "tr": {"lang": "fr", "body": "Porte ouverte"}})
    assert "Porte ouverte" in layout.render({**p, "head": layout.head("#1-P2", "FM", (), "existing", "fr"),
                                             "tr": {"lang": "fr", "body": "Porte ouverte"}})
    # a new body is no longer the words translated
    moved = layout.changed({**p, "tr": {"lang": "de", "body": "Tür offen"}}, body="Door closed")
    assert "tr" not in moved and "Tür offen" not in layout.render(moved)


# ------------------------------------------------------------------ the villa's own message, taken over
def test_the_villas_own_message_taken_over_in_a_french_chat_is_translated_too(tmp_path, monkeypatch):
    v = villa(tmp_path)
    FakeAI(translator).install(monkeypatch)

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30", chat=FM_FR)
        taken = card(v, 1, FM_FR)
        await v.translations.idle()
        return taken
    taken = run(go())
    assert 'Test lock has been "unavailable" for over 10 s.' in taken             # taken over in English at once
    assert v.thread.shown(1)[FM_FR]["mid"] == 501                                 # the villa's own message
    assert '(fr) Test lock has been "unavailable" for over 10 s.' in card(v, 1, FM_FR)
    assert any("(fr) Test lock" in t for c, m, t in v.tg.edits if c == FM_FR and m == 501)


# ------------------------------------------------------------------ (f) the skeleton
@pytest.mark.parametrize("line, names, skeleton, values", [
    ('Test lock has been "unavailable" for over 10 s.', ["Test lock"],
     "{1} has been {2} for over {3} s.", ["Test lock", '"unavailable"', "10"]),
    ('Main Power Device Power has been "unavailable" for over 10 min.', ["Main Power Device Power", "Main Power Device"],
     "{1} has been {2} for over {3} min.", ["Main Power Device Power", '"unavailable"', "10"]),
    ("What to do: Power and network of the device named, until it is back.", [],
     "What to do: Power and network of the device named, until it is back.", []),
    ("Laundry Room Aqara is unlocked", ["Laundry Room", "Laundry Room Aqara"], "{1} is unlocked", ["Laundry Room Aqara"]),
    ("Held 10 min", [], "Held {1} min", ["10"]),
    ("Held 1 h 30 min", [], "Held {1} h {2} min", ["1", "30"]),
    ("1 d 1 h", [], "{1} d {2} h", ["1", "1"]),
    ("Living Room AC, Kitchen Light: on with everyone away for 1 h (~1310 W, about 1.31 kWh). [ROI-03]",
     ["Living Room AC", "Kitchen Light", "Living Room", "Kitchen"],
     "{1}, {2}: on with everyone away for {3} h ({4}, about {5}). {6}",
     ["Living Room AC", "Kitchen Light", "1", "~1310 W", "1.31 kWh", "[ROI-03]"]),
    ("since Fri 23 Oct, 05:09", [], "since {1}, {2}", ["Fri 23 Oct", "05:09"]),
    ("Energy +2367 % at 15:19:31 on 2026-10-23, 1,310 W, 3.55", [],
     "Energy {1} at {2} on {3}, {4}, {5}", ["+2367 %", "15:19:31", "2026-10-23", "1,310 W", "3.55"]),
    ("#78 [PM-01] seen 2nd time", [], "{1} {2} seen {3} time", ["#78", "[PM-01]", "2nd"]),
])
def test_every_variable_part_is_a_slot(line, names, skeleton, values):
    assert mask(line, names) == (skeleton, values)
    assert fill(skeleton, values) == line


def test_two_alerts_of_one_pattern_share_one_skeleton():
    a = mask('Main Power Device Power has been "unavailable" for over 10 min.', ["Main Power Device Power"])[0]
    b = mask('Pool Pump has been "unavailable" for over 20 min.', ["Pool Pump"])[0]
    assert a == b


def test_a_translation_must_keep_every_slot_once():
    s = "{1} has been {2} for over {3} min."
    assert fits("{1} est {2} depuis plus de {3} min.", s)
    assert not fits("{1} est {2} depuis plus de min.", s)            # one dropped
    assert not fits("{1} {1} est {2} depuis {3} min.", s)            # one twice
    assert not fits("{1} est {2} depuis {3} min. {4}", s)            # one invented
    assert not fits("{1} est {2}\ndepuis {3} min.", s) and not fits("", s) and not fits(None, s)
    assert answer('Sure: ["{1} est {2} depuis plus de {3} min.", "x"]', [s, "Held {1} min"]) == \
        {s: "{1} est {2} depuis plus de {3} min."}                    # the line that fits is kept, the other is not
    assert answer('["a"]', [s, "Held {1} min"]) == {} and answer("no list", [s]) == {}
    assert not wordy("⚡ {1}") and wordy("Held {1} min")


def test_translations_are_kept_whatever_their_age_and_the_oldest_go_when_full(tmp_path, monkeypatch):
    from vesta_agent import state as st_mod
    s = State(str(tmp_path / "s.sqlite"))
    monkeypatch.setattr(st_mod, "phrases_kept", lambda: 3)
    for i in range(5):
        s.keep_translation("fr", f"Held {{1}} min {i}", f"Maintenu {{1}} min {i}")
    assert [s.translation("fr", f"Held {{1}} min {i}") for i in range(5)] == \
        [None, None, "Maintenu {1} min 2", "Maintenu {1} min 3", "Maintenu {1} min 4"]
    assert s.translation("de", "Held {1} min 4") is None             # per language
    soon = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    s.prune(runs_before="1970", records_before=soon)
    assert s.translation("fr", "Held {1} min 4") == "Maintenu {1} min 4"                 # not a record: kept


def test_the_page_offers_the_translation_like_an_ai_job(tmp_path):
    from vesta_agent.skills import Skills, translators, when_it_runs
    v = villa(tmp_path, agreed=False)
    sk = Skills(v.s.skills_dir).get("alert-desk")
    assert [x.name for x in translators({"alert-desk": sk})] == ["alert-desk"]
    assert sk.jobs_default == {"brain": "economy", "limit_usd": 0.05}
    assert any(r["job"] == "alert-translation" and r["kind"] == "ai" for r in when_it_runs(sk))


def run(coro):
    return asyncio.run(coro)
