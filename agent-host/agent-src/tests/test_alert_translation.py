"""An alert card's own words — written in English by the villa's automations — reach each chat in that chat's language,
translated by the AI once per sentence pattern (owner, 2026-10-23). The card goes out in English at once; the
translation comes after and edits that chat's copy; the next card with the same pattern arrives translated, with no AI
call. Any failure leaves the English. Two facility manager chats, one reading French and one German, and the owner's
group in English. Synthetic villa; ids and names invented."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone

import pytest

from ai_fake import FakeAI
from ha_fake import FakeHA, tool
from helpers import make_agent
from telegram_fake import BOT
from vesta_agent import translation
from vesta_shared import agent_records
from vesta_agent.ha_events import CONTEXT_KEY
from vesta_agent.state import State
from vesta_agent.phrases import acceptable, fits, wordy
from vesta_agent.translation import answer, fill, mask

GROUP, FM_DE, FM_FR = -100123, 222, 333
#: the Chat answers row of Rules › AI brains and limits: what a translation runs with (owner, 2026-10-23)
CHAT_ANSWERS = {"profile": "economy", "reply_limit_usd": 0.3}
LANGS = {"French": "fr", "German": "de"}
STATES = {"lock.test_lock": {"entity_id": "lock.test_lock", "state": "unavailable",
                             "attributes": {"friendly_name": "Test lock"}},
          "lock.front_gate": {"entity_id": "lock.front_gate", "state": "unavailable",
                              "attributes": {"friendly_name": "Front Gate Lock"}}}


def villa(tmp_path, group_language="en", settings=CHAT_ANSWERS):
    pol = {"people": [
        {"telegram_id": GROUP, "name": "Owner group", "role": "owner", "language": group_language},
        {"telegram_id": FM_DE, "name": "Anna", "role": "fm", "language": "de"},
        {"telegram_id": FM_FR, "name": "Luc", "role": "fm", "language": "fr"}]}
    if settings is not None:
        pol["settings"] = dict(settings)
    # the villa's system names its devices as the alert arrives (app.Vesta._alert_names)
    v = make_agent(tmp_path, pol, skills=["alert-desk"], reader=FakeHA(tools=[tool("ha_get_state")], states=STATES))
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
    # one tiny run per language: the skeleton only — no name, number or time reached the AI — no tool, the Chat
    # answers' brain and limit (owner, 2026-10-23: inside that setting, never a job), recorded as their translation
    assert sorted(LANGS[re.search(r"into (\w+)\.", r["prompt"]).group(1)] for r in ai.runs) == ["de", "fr"]
    for r in ai.runs:
        assert "Test lock" not in r["prompt"] and "18:30" not in r["prompt"] and '"unavailable"' not in r["prompt"]
        assert "{1} has been {2} for over {3} s." in r["prompt"] and "Since {1} {2}" in r["prompt"]
        assert r["allowed"] == set() and r["profile"] == "economy" and r["limit_usd"] == 0.3
        assert r["skill"] == "alert-desk" and r["who"] == agent_records.TRANSLATION
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


# ------------------------------------------------------------------ (d) the Chat answers' terms, always set
@pytest.mark.parametrize("case", ["nothing set", "the chats' own pair, an older alert desk pair beside it"])
def test_it_runs_with_the_chat_answers_brain_and_limit_and_never_a_skill_pair(tmp_path, monkeypatch, caplog, case):
    # owner, 2026-10-23: "fully integrated … 'inside' the `Chat answers` setting". 0.12.334–335 ran it with the alert
    # desk's settings.skill_ai pair and not at all until "Add them" set it: a villa with nothing set now gets it (the
    # chats' defaults), and a pair "Add them" wrote then is never read — no error, no word in the log
    settings = (None if case == "nothing set" else
                {"profile": "performance", "reply_limit_usd": 0.4,
                 "skill_ai": {"alert-desk": {"brain": "economy", "limit_usd": 0.05}}})
    v = villa(tmp_path, settings=settings)
    ai = FakeAI(translator).install(monkeypatch)
    caplog.set_level(logging.INFO)

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        await v.translations.idle()
    run(go())
    want = ("auto", 1.0) if case == "nothing set" else ("performance", 0.4)       # policy.DEFAULT_BEHAVIOUR, else set
    assert sorted(lang_of(r) for r in ai.runs) == ["de", "fr"]
    assert all((r["profile"], r["limit_usd"], r["who"], r["allowed"]) == (*want, agent_records.TRANSLATION, set())
               for r in ai.runs), ai.runs
    assert '(fr) Test lock has been "unavailable" for over 10 s.' in card(v, 1, FM_FR)
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING and "skill_ai" in r.getMessage()]
    assert not [r for r in caplog.records if "not set" in r.getMessage() or "stay in English" in r.getMessage()]


def test_the_chats_terms_have_one_owner_for_a_reply_and_a_translation():
    # one reading of the Chat answers row (turn.chat_brain): a reply and a translation can never disagree on it
    from types import SimpleNamespace
    from vesta_agent.policy import Policy
    from vesta_agent.turn import chat_terms, translation_terms
    s = SimpleNamespace(profile="performance", reply_limit_usd=0.7)
    reply = chat_terms(s, Policy({}), [], None, 1)
    tr = translation_terms(s, "alert-desk")
    assert (tr.profile, tr.limit_usd) == (reply.profile, reply.limit_usd) == ("performance", 0.7)
    assert tr.tools == frozenset() and tr.who == agent_records.TRANSLATION and tr.skill == "alert-desk"


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


def test_a_chat_whose_language_changed_reads_the_alerts_words_in_its_new_one_when_it_closes(tmp_path, monkeypatch):
    # owner, 2026-10-24: the group switched from Indonesian to Chinese; #80's close drew its Status in Chinese over the
    # alert's words still in the old drawing — shown in English — and the new language was never asked for
    import yaml
    v = villa(tmp_path)
    ai = FakeAI(translator).install(monkeypatch)

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        await v.translations.idle()
        english = card(v, 1, GROUP)
        with open(v.s.policy_path) as f:
            pol = yaml.safe_load(f)
        pol["people"][0]["language"] = "fr"
        with open(v.s.policy_path, "w") as f:
            yaml.safe_dump(pol, f)
        await v.on_ha_event("vesta_critical_event", {
            "blueprint": "critical_condition", "rule_id": "automation.watch_1", "incident_id": "automation.watch_1-1",
            "phase": "resolved", "severity": "critical", "label": "Test lock unavailable", "entities": ["lock.test_lock"],
            "summary": "", "timestamp": datetime.now(timezone.utc).isoformat(), CONTEXT_KEY: "RUN-1b"})
        await v.translations.idle()
        return english
    english = run(go())
    assert "(fr)" not in english
    closed = card(v, 1, GROUP)
    assert "Statut:" in closed and "Résolu" in closed, closed
    assert '(fr) Test lock has been "unavailable" for over 10 s.' in closed, closed


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
        {s: "{1} est {2} depuis plus de {3} min.", "Held {1} min": "x"}  # read; phrases.Phrases.take judges each line
    assert answer('["a"]', [s, "Held {1} min"]) is None and answer("no list\nat all", [s]) is None
    assert acceptable("{1} est {2} depuis plus de {3} min.", s) and not acceptable("x", "Held {1} min")
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


def test_the_skills_page_says_it_uses_the_chat_answers_brain_never_an_ai_job(tmp_path):
    # owner, 2026-10-23: "I shall not see a dedicated Job for this"
    from vesta_agent.places import where
    from vesta_agent.skills import Skills, translators, when_it_runs
    v = villa(tmp_path, settings=None)
    sk = Skills(v.s.skills_dir).get("alert-desk")
    assert [x.name for x in translators({"alert-desk": sk})] == ["alert-desk"]
    assert sk.jobs_default is None and set(sk.translate) == {"instructions"}
    row = next(r for r in when_it_runs(sk) if "non-english" in r["when"])
    assert row == {"when": "an alert card in non-english", "job": None, "script": None, "kind": None,
                   "note": f"its text put in the chat's language by the AI, with the Chat answers brain and limit ({where('ai')}; what it keeps in {where('translations')})"}
    assert not [r for r in when_it_runs(sk) if r["kind"] == "ai"]


def test_an_alert_desk_edited_on_0_12_334_still_runs_and_translates(tmp_path):
    # an edited copy is kept by updates: its translate name and description, and the jobs_default it gave its
    # translation alone, must never switch the alert desk off — read and ignored
    import yaml
    from vesta_agent.skills import Skills
    v = villa(tmp_path)
    path = f"{v.s.skills_dir}/alert-desk/skill.yaml"
    raw = yaml.safe_load(open(path, encoding="utf-8"))
    raw["jobs_default"] = {"brain": "economy", "limit_usd": 0.05}
    raw["translate"] = {"name": "alert-translation", "description": "the alert's own words",
                        "instructions": raw["translate"]["instructions"]}
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(raw, f, allow_unicode=True)
    sk = Skills(v.s.skills_dir).all()["alert-desk"]
    assert sk.translate == {"instructions": raw["translate"]["instructions"]} and sk.jobs_default is None
    assert sk.on_event and sk.every_5_min                              # the desk itself still runs


# ------------------------------------------------------------------ (g) what is kept, asked again, forgotten (phrases.py)
SKEL = "{1} has been {2} for over {3} s."


def lines_of(r) -> list[str]:
    return json.loads(r["prompt"].rsplit("\n", 1)[1])


def lang_of(r) -> str:
    return LANGS[re.search(r"into (\w+)\.", r["prompt"]).group(1)]


def clocked(v):
    """The phrase store's clock, moved by the test (never a sleep): [now]."""
    at = [datetime.now(timezone.utc)]
    v.translations.phrases.now = lambda: at[0]
    return at


@pytest.mark.parametrize("how", ["the English given back", "a slot dropped", "an error"])
def test_a_failed_line_rests_then_is_asked_again_and_a_success_clears_it(tmp_path, monkeypatch, caplog, how):
    # review, 2026-10-23: an echo was kept for good (the French chat read English on every later card, never asked
    # again); a dropped slot was asked again for every card, reminder and redraw — a paid run per language each time
    v = villa(tmp_path)
    at = clocked(v)
    good = [False]

    def answer_(r):
        if good[0]:
            return translator(r)
        if how == "an error":
            raise RuntimeError("the SDK broke")
        return json.dumps(lines_of(r) if how == "the English given back"
                          else [x.replace("{1}", "") for x in lines_of(r)])
    ai = FakeAI(answer_).install(monkeypatch)
    caplog.set_level(logging.INFO, logger="vesta.translation")

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        await v.translations.idle()
        first = len(ai.runs)
        at[0] += timedelta(hours=23)                                  # within the rest: not asked, English
        await alert(v, 2, "lock.front_gate", "Front Gate Lock", 25, "24/10/2026 07:15")
        await v.translations.idle()
        rested = len(ai.runs)
        good[0] = True
        at[0] += timedelta(hours=2)                                   # past alerts.translate_retry_hours (24)
        await alert(v, 3, "lock.test_lock", "Test lock", 30, "25/10/2026 09:00")
        await v.translations.idle()
        return first, rested
    first, rested = run(go())
    assert first == 2 and rested == 2, ai.runs                        # one run per language, then none in the rest
    fp = v.translations.fingerprint(v.skills.get("alert-desk"))
    assert v.state.translation("fr", SKEL, fp) == f"(fr) {SKEL}"
    assert 'Front Gate Lock has been "unavailable" for over 25 s.' in card(v, 2, FM_FR)            # English, delivered
    assert '(fr) Test lock has been "unavailable" for over 30 s.' in card(v, 3, FM_FR)            # asked again: kept
    assert v.state.untranslated("fr", SKEL, fp) is None and v.state.untranslated("de", SKEL, fp) is None   # cleared
    said = [r.getMessage() for r in caplog.records if "stay in English for" in r.getMessage()]
    assert sorted(m.split(" for ")[1] for m in said) == ["de", "fr"], said       # once per language, not per card
    assert all(SKEL in m for m in said)


def test_one_line_that_failed_stays_english_and_the_others_are_shown_translated(tmp_path, monkeypatch):
    v = villa(tmp_path)
    ai = FakeAI(lambda r: json.dumps([f"({lang_of(r)}) {x}" if x == SKEL else x for x in lines_of(r)])).install(monkeypatch)

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        await v.translations.idle()
        await alert(v, 2, "lock.front_gate", "Front Gate Lock", 25, "24/10/2026 07:15")
        await v.translations.idle()
    run(go())
    assert len(ai.runs) == 2                                          # the echoed lines rest: no more runs
    for i, name, secs, at in ((1, "Test lock", 10, "23/10/2026 18:30"), (2, "Front Gate Lock", 25, "24/10/2026 07:15")):
        assert f'(fr) {name} has been "unavailable" for over {secs} s.\nSince {at}' in card(v, i, FM_FR), card(v, i, FM_FR)


def test_new_translate_instructions_start_afresh_and_the_older_translations_go(tmp_path, monkeypatch):
    v = villa(tmp_path)
    ai = FakeAI(translator).install(monkeypatch)

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        await v.translations.idle()
        path = f"{v.s.skills_dir}/alert-desk/skill.yaml"
        text = open(path, encoding="utf-8").read()
        assert "You translate the lines" in text
        with open(path, "w", encoding="utf-8") as f:
            f.write(text.replace("You translate the lines", "You translate, formally, the lines"))
        await alert(v, 2, "lock.front_gate", "Front Gate Lock", 25, "24/10/2026 07:15")
        await v.translations.idle()
    run(go())
    assert len(ai.runs) == 4                                          # asked again under the new instructions
    assert "formally" in ai.runs[-1]["system_prompt"]
    assert v.state.translations_kept() == {"fr": 3, "de": 3}          # the card's 3 lines: the earlier ones deleted
    assert '(fr) Front Gate Lock has been "unavailable" for over 25 s.' in card(v, 2, FM_FR)


def test_forget_the_translations_on_the_page_one_language_then_all(tmp_path, monkeypatch):
    from aiohttp.test_utils import TestClient, TestServer
    from vesta_agent.ui.server import UI
    v = villa(tmp_path)
    ai = FakeAI(translator).install(monkeypatch)
    hdr = {"X-Vesta-UI": "1"}

    async def page(steps):
        async with TestClient(TestServer(UI(v.s, "standalone").app())) as c:
            out = []
            for body in steps:
                if body == "jobs":
                    # the Knowledge tab's (owner, 2026-10-30: not kept in policy.yaml), never on a job's line
                    out.append((await (await c.get("/api/knowledge", headers=hdr)).json())["translations"])
                else:
                    r = await c.post("/api/translations/forget", json=body, headers=hdr)
                    out.append((r.status, await r.json()))
            return out

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        await v.translations.idle()
        shown, bad, fr = await page(["jobs", {"lang": "pt-xx"}, {"lang": "fr"}])
        await alert(v, 2, "lock.front_gate", "Front Gate Lock", 25, "24/10/2026 07:15")
        await v.translations.idle()
        asked = sorted(lang_of(r) for r in ai.runs[2:])
        every, after = await page([{"lang": None}, "jobs"])
        return shown, bad, fr, asked, every, after
    shown, bad, fr, asked, every, after = run(go())
    assert shown == {"fr": 3, "de": 3}                                # the card's 3 lines kept, per language
    assert bad[0] == 400
    assert fr == (200, {"forgot": 3, "kept": {"de": 3}})
    assert asked == ["fr"]                                            # only the forgotten language asked again
    assert every[0] == 200 and every[1]["forgot"] == 6 and every[1]["kept"] == {}
    assert after == {} and v.state.translations_kept() == {}


def test_the_page_offers_forget_in_its_own_dialog():
    from helpers import body_of, page_js
    js = body_of(page_js(), "translationsCard")
    assert 'api("POST", "api/translations/forget", { lang: null })' in js and "await ask(" in js and "confirm(" not in js
    # owner, 2026-10-23: "Forget Translations", every language but English, no language menu
    assert '"Forget Translations"' in js and "dropdown(" not in js


def test_the_chat_answers_row_says_it_also_translates_the_alert_cards_and_forget_is_the_knowledge_tabs():
    # owner, 2026-10-23: the Chat answers row shows what its brain also does, never under a skill's row (there is no
    # job row for it any more); owner, 2026-10-30: "Forget Translations" is not kept in policy.yaml, so it left the
    # Rules tab for Knowledge › Translations (the tab's sub-tabs: places.ORDER)
    from helpers import body_of, page_js
    from vesta_agent.places import ORDER, PLACES
    js = body_of(page_js(), "rulesForms")
    # owner, 2026-10-23: its line says only "replies in the chats"
    chat = js[js.index('h("b", {}, "Chat answers")'):js.index("sel(PROFILES, f.settings.profile")]
    assert 'h("div", { class: "muted" }, "replies in the chats")]' in chat and "forget" not in chat.lower()
    assert "api/translations" not in js and "doc.translations" not in js and '"Forget Translations"' not in js
    assert PLACES["translations"][1] == "Knowledge" and "translations" in ORDER["knowledge"]
    assert 'translations: () => translationsCard(v)' in body_of(page_js(), "knowledge")


def test_the_costs_tab_counts_a_translation_with_the_chat_replies_on_its_own_row(tmp_path):
    # owner, 2026-10-23: no dedicated job — its runs are the chat answers', still told apart; 0.12.334–335's runs,
    # recorded as the job "alert-translation", are read the same (never a job no skill declares)
    from vesta_agent import status
    from helpers import page_js
    st = State(str(tmp_path / "s.db"))
    now = datetime.now(timezone.utc)
    for d in ({"who": agent_records.TRANSLATION, "cost_usd": 0.01}, {"who": "job:alert-translation", "cost_usd": 0.02},
              {"who": "Ann@1", "cost_usd": 0.2}, {"who": "job:fm-daily", "cost_usd": 0.3}):
        st.db.execute("insert into calls(at, kind, detail) values (?, 'run', ?)",
                      ((now - timedelta(hours=1)).isoformat(), json.dumps(d)))
    st.db.commit()
    c = status.costs(st, 7, now=now, skill_of={"fm-daily": "reports"}.get)
    by_job = {g["name"]: (g["runs"], g["cost"]) for g in c["by_job"]}
    assert by_job == {"Chat replies › alert translation": (2, 0.03), "Chat replies": (1, 0.2),
                      "reports › fm-daily": (1, 0.3)}
    tr = [r for r in c["runs"] if r["job"] == "Chat replies › alert translation"]
    assert len(tr) == 2 and all(r["kind"] == "translation" and r["person"] is None for r in tr)
    # neither a reply written nor a report made
    figures = dict(map(tuple, c["activity"]))
    assert figures["Replies written"] == 1 and figures["Reports made"] == 1
    # the page names it by its row's words, never "Reply to someone"
    assert 'r.kind === "chat" ? `Reply to ${r.person || "someone"}` : r.job' in page_js()


# ------------------------------------------------------------------ (h) the alert's own names (review, 2026-10-23)
def literal(run_: dict) -> str:
    """A real model translates every word it is given: this stand-in does it for "lock" and "Gate"."""
    lang = lang_of(run_)
    w = {"fr": {"lock": "serrure", "Gate": "Portail"}, "de": {"lock": "Schloss", "Gate": "Tor"}}[lang]
    out = []
    for x in lines_of(run_):
        for a, b in w.items():
            x = re.sub(rf"\b{a}\b", b, x)
        out.append(f"({lang}) {x}")
    return json.dumps(out, ensure_ascii=False)


@pytest.mark.parametrize("case", ["no pack yet", "a name written with other capitals"])
def test_a_devices_name_never_reaches_the_ai_and_two_devices_share_one_translation(tmp_path, monkeypatch, case):
    v = villa(tmp_path)
    if case == "no pack yet":
        os.remove(v.s.pack_path)                                      # before the first nightly build
        n1, n2 = "Test lock", "Front Gate Lock"
    else:
        n1, n2 = "Test Lock", "Front gate lock"                       # the automation's own capitals
    ai = FakeAI(literal).install(monkeypatch)

    async def go():
        await alert(v, 1, "lock.test_lock", n1, 10, "23/10/2026 18:30")
        await v.translations.idle()
        await alert(v, 2, "lock.front_gate", n2, 25, "24/10/2026 07:15")
        await v.translations.idle()
    run(go())
    assert sorted(lang_of(r) for r in ai.runs) == ["de", "fr"]        # one run per language for both devices
    for r in ai.runs:
        assert lines_of(r)[0] == SKEL and "lock" not in json.dumps(lines_of(r)).lower()
    assert f'(fr) {n1} has been "unavailable" for over 10 s.' in card(v, 1, FM_FR)
    assert f'(fr) {n2} has been "unavailable" for over 25 s.' in card(v, 2, FM_FR)       # the name as written


def test_a_one_word_name_is_matched_as_written_and_never_takes_an_everyday_word():
    names = ["Pool", "Front Gate Lock"]
    assert mask("Pool: front gate lock is open", names) == ("{1}: {2} is open", ["Pool", "front gate lock"])
    assert mask("Water the pool before 18:00", names) == ("Water the pool before {1}", ["18:00"])
    assert mask("Front Gate Lock open", names)[0] == "{1} open"       # the name's spaces as the text writes them


def test_the_alerts_names_come_from_the_villa_and_a_failed_read_never_stops_the_alert(tmp_path, monkeypatch):
    from vesta_agent import app as app_mod
    v = villa(tmp_path)
    os.remove(v.s.pack_path)
    FakeAI(translator).install(monkeypatch)

    async def go(v):
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        await v.translations.idle()
    run(go(v))
    assert v.translations.names(1) == ["Test lock"]                   # read from the villa's system as it arrived
    # the villa's system not answering: the alert goes on, with the names the pack has
    v2 = villa(tmp_path / "b")
    monkeypatch.setattr(app_mod, "alert_names", lambda reader, ents: (_ for _ in ()).throw(TimeoutError()))
    run(go(v2))
    assert v2.thread.shown(1)[FM_FR] and v2.translations.names(1)[0] == "Test lock"


def run(coro):
    return asyncio.run(coro)


def test_the_reader_reads_the_answer_as_the_ai_writes_it():
    # owner, 2026-10-24: "Master Bedroom Aqara is unlocked for 10min" stayed English on a French chat beside its
    # translated title — the answer was "not the list of lines asked for", read only from the first "[" to the last "]"
    one, two = ["{1} is unlocked for {2}min"], ["{1} is unlocked for {2}min", "Since {1}"]
    fr = "{1} est déverrouillé depuis {2} min"
    assert answer(f'```json\n["{fr}"]\n```', one) == {one[0]: fr}                          # in a code block
    assert answer(f'Voici [la] traduction :\n["{fr}", "Depuis {{1}}"]', two) == \
        {two[0]: fr, two[1]: "Depuis {1}"}                                                   # words and brackets around
    assert answer(json.dumps({two[0]: fr, two[1]: "Depuis {1}"}, ensure_ascii=False), two)[two[1]] == "Depuis {1}"
    assert answer(json.dumps(fr, ensure_ascii=False), one) == {one[0]: fr}                   # one line: a JSON string
    assert answer(f'"{fr}"', one) == {one[0]: fr}                                            # ... a JSON string
    # review L (2026-10-25): never a bare line — chatter around it was printed on the card
    assert answer(f"  {fr}  ", one) is None and answer(f"Voici la traduction : « {fr} »", one) is None
    assert answer("Here is the French translation:", one) is None and answer("", one) is None
    assert answer(f'["{fr}"]', two) is None                                                 # as many lines, or nothing
    assert not acceptable(answer('"Je ne sais pas"', one)[one[0]], one[0])   # read, then judged: no slot, not kept


def test_an_answer_that_cannot_be_read_is_asked_once_more_and_then_kept(tmp_path, monkeypatch):
    v = villa(tmp_path)
    tries: dict[str, int] = {}

    def answer_(r):
        lang = re.search(r"from English into (\w+)\.", r["prompt"]).group(1)
        tries[lang] = tries.get(lang, 0) + 1
        return "Bien sûr, voici les lignes traduites." if tries[lang] == 1 else translator(r)
    ai = FakeAI(answer_).install(monkeypatch)

    async def go():
        await alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30")
        await v.translations.idle()
    run(go())
    assert len(ai.runs) == 4, ai.runs                                    # two languages, asked twice each
    assert sum(r["prompt"].startswith("Your previous answer could not be read.") for r in ai.runs) == 2
    fp = v.translations.fingerprint(v.skills.get("alert-desk"))
    assert v.state.translation("fr", SKEL, fp) == f"(fr) {SKEL}" and v.state.untranslated("fr", SKEL, fp) is None
    assert '(fr) Test lock has been "unavailable" for over 10 s.' in card(v, 1, FM_FR)


def test_an_unreadable_answer_rests_with_its_reader_and_an_older_readers_is_asked_again_at_once(tmp_path, monkeypatch,
                                                                                                caplog):
    from vesta_agent.phrases import READER
    v = villa(tmp_path)
    clocked(v)
    FakeAI(lambda r: "Sorry.\nNo.").install(monkeypatch)
    caplog.set_level(logging.INFO, logger="vesta.translation")
    run(alert(v, 1, "lock.test_lock", "Test lock", 10, "23/10/2026 18:30"))
    run(v.translations.idle())
    fp = v.translations.fingerprint(v.skills.get("alert-desk"))
    rec = v.state.untranslated("fr", SKEL, fp)
    assert rec["kind"] == "unreadable" and rec["reader"] == READER and "Sorry." in rec["why"], rec   # what it said
    assert v.translations.phrases.resting("fr", SKEL, fp)                                  # this reader's: rests
    at = rec["at"]
    v.state.note_untranslated("fr", SKEL, fp, at, "not the list of lines asked for")   # 0.12.344–346 wrote this
    assert not v.translations.phrases.resting("fr", SKEL, fp)                              # an older reader's: ask
    v.state.note_untranslated("fr", SKEL, fp, at, "unreadable", kind="unreadable", reader=READER - 1)
    assert not v.translations.phrases.resting("fr", SKEL, fp)
    v.state.note_untranslated("fr", SKEL, fp, at, "the English given back")
    assert v.translations.phrases.resting("fr", SKEL, fp)                                  # any other failure rests
