"""A role's report in each of its readers' languages (owner, 2026-10-23: "I received the daily report in German,
whereas I set my default language to French"): the facility manager's report was written in the first facility
manager's language and that one text went to every facility manager. Synthetic people and data only."""
from __future__ import annotations

import asyncio

import pytest

from ai_fake import FakeAI
from helpers import make_agent
from vesta_agent import runner
from vesta_agent.routing import JOB, Origin

OWNER, FM_DE, FM_FR, GROUP = 111, 222, 333, -100777


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def agent(tmp_path):
    return make_agent(tmp_path, {"people": [
        {"telegram_id": GROUP, "name": "Group", "role": "owner", "language": "id"},
        {"telegram_id": FM_DE, "name": "Anna", "role": "fm", "language": "de"},
        {"telegram_id": FM_FR, "name": "Luc", "role": "fm", "language": "fr"},
        {"telegram_id": OWNER, "name": "Olga", "role": "owner", "language": "id"}],
        "settings": {"skill_ai": {"reports": {"brain": "performance", "limit_usd": 2}}}}, skills=["reports"])


def send_tool(agent, origin=None):
    return next(t for t in agent.toolbox().tool_objects(None, origin) if t.name == "send_message")


def texts(agent):
    return {c: t for c, t, *_ in agent.tg.sent}


def test_the_jobs_prompt_names_every_language_of_the_role(agent, monkeypatch):
    runs = FakeAI(lambda r: runner.RunResult("", None, False, 0.1, [], None)).install(monkeypatch).runs
    sk, daily = agent.jobs.find("fm-daily")
    run(agent.jobs.run(sk, daily))
    (prompt,) = [r["prompt"] for r in runs if r["who"].startswith("job:")]
    assert "written in German and French (one version per language" in prompt
    assert agent.jobs._language_of("owner") == "Indonesian"
    assert "read German and French: text is then one version per language" in send_tool(agent).description


def test_one_text_for_a_role_read_in_two_languages_is_refused_and_nothing_is_sent(agent):
    out = run(send_tool(agent).handler({"to": "fm", "text": "Noch offen: 2"}))
    assert out.get("is_error") and "read German, French" in out["content"][0]["text"]
    assert agent.tg.sent == []
    out = run(send_tool(agent).handler({"to": "fm", "text": {"German": "Noch offen: 2"}}))
    assert out.get("is_error") and "missing: French" in out["content"][0]["text"] and agent.tg.sent == []


def test_each_reader_gets_the_version_in_their_own_language(agent):
    out = run(send_tool(agent).handler({"to": "fm", "title": "Daily report",
                                        "text": {"German": "Noch offen: 2", "fr": "Encore ouvert : 2"}}))
    assert not out.get("is_error")
    got = texts(agent)
    assert "Noch offen: 2" in got[FM_DE] and "Encore ouvert" not in got[FM_DE]
    assert "Encore ouvert : 2" in got[FM_FR] and "Noch offen" not in got[FM_FR]
    assert set(got) == {FM_DE, FM_FR}


def test_each_language_gets_its_own_page(agent):
    for name in ("fm_weekly.html", "fm_weekly_French.html"):
        with open(f"{agent.s.out_dir}/{name}", "w") as f:
            f.write(f"<html>{name}</html>")
    out = run(send_tool(agent).handler({"to": "fm", "text": {"German": "Woche", "French": "Semaine"},
                                        "attachment": {"German": "fm_weekly.html"}}))
    assert out.get("is_error") and "one page per language" in out["content"][0]["text"]
    out = run(send_tool(agent).handler({"to": "fm", "text": {"German": "Woche", "French": "Semaine"},
                                        "attachment": {"German": "fm_weekly.html", "French": "fm_weekly_French.html"}}))
    assert not out.get("is_error")
    docs = {c: str(d) for c, d in agent.tg.documents}
    assert docs[FM_DE].endswith("fm_weekly.html") and docs[FM_FR].endswith("fm_weekly_French.html")


def test_a_role_read_in_one_language_and_a_person_asking_take_one_text(agent):
    assert not run(send_tool(agent).handler({"to": "owner", "text": "Bulanan"})).get("is_error")
    assert set(texts(agent)) == {GROUP, OWNER}
    agent.tg.sent.clear()
    # asked for in a chat: the asker's chat only, in the asker's language — French here is the SECOND version (review
    # H2: with French first, "the first version" passed for "the asker's")
    here = send_tool(agent, Origin(FM_FR, JOB))
    assert not run(here.handler({"to": "here", "text": {"German": "Woche", "French": "Semaine"}})).get("is_error")
    assert [(c, "Semaine" in t, "Woche" in t) for c, t, *_ in agent.tg.sent] == [(FM_FR, True, False)]


# ---------------------------------------------------------------- review H2: a job asked for in a chat
def job_prompt(agent, monkeypatch, name, origin=None):
    runs = FakeAI(lambda r: runner.RunResult("", None, False, 0.1, [], None)).install(monkeypatch).runs
    sk, job = agent.jobs.find(name)
    run(agent.jobs.run(sk, job, origin))
    (prompt,) = [r["prompt"] for r in runs if r["who"].startswith("job:")]
    return prompt


def test_a_job_asked_for_in_a_chat_is_written_in_the_askers_language_only(agent, monkeypatch):
    """Luc (fr) asks for the daily digest; the facility managers read German and French. Told "German and French",
    the job wrote German first and Luc's chat kept it (review H2)."""
    prompt = job_prompt(agent, monkeypatch, "fm-daily", Origin(FM_FR, JOB))
    assert "written in French (" in prompt and "German" not in prompt
    # a group asking: its row's language, whoever wrote there
    assert "written in Indonesian (" in job_prompt(agent, monkeypatch, "fm-daily", Origin(GROUP, JOB, role="owner"))
    # on schedule, still every reader's language
    assert "written in German and French (" in job_prompt(agent, monkeypatch, "fm-daily")


def test_an_asker_who_reads_the_second_language_gets_their_version_through_the_job(agent, monkeypatch):
    async def act(call):
        await call["call"]("send_message", {"to": "here", "title": "Daily digest",
                                            "text": {"German": "Noch offen: 2", "French": "Encore ouvert : 2"}})
    FakeAI(lambda r: runner.RunResult("Sent.", None, False, 0.1, [], None), act=act).install(monkeypatch)
    sk, daily = agent.jobs.find("fm-daily")
    run(agent.jobs.run(sk, daily, Origin(FM_FR, JOB)))
    assert [(c, "Encore ouvert : 2" in t, "Noch offen" in t) for c, t, *_ in agent.tg.sent] == [(FM_FR, True, False)]


# ---------------------------------------------------------------- review H1: the page sent when the limit stops a job
def test_stopped_at_its_limit_each_language_gets_the_page_of_its_own_notes(agent, monkeypatch, tmp_path):
    import json
    import shutil

    import test_reports as tr
    vt = tmp_path / "villa"
    vt.mkdir()
    tr._facts(vt, tr._villa(vt))

    async def act(call):
        # the AI followed "Several languages" (facts, the German notes, the French ones), then the limit stopped it
        shutil.copy(vt / "facts.json", f"{call['folder']}/facts.json")
        json.dump({"headline": "Die Gartenpumpe läuft schwächer."}, open(f"{call['folder']}/notes.json", "w"))
        json.dump({"headline": "La pompe du jardin faiblit."}, open(f"{call['folder']}/notes_French.json", "w"))
    FakeAI(lambda r: runner.RunResult("", None, True, 2.0, [], None), act=act).install(monkeypatch)
    sk, weekly = agent.jobs.find("fm-weekly")
    run(agent.jobs.run(sk, weekly))
    got = texts(agent)
    assert set(got) == {FM_DE, FM_FR}
    assert "Gartenpumpe" in got[FM_DE] and "pompe du jardin" not in got[FM_DE]
    assert "pompe du jardin" in got[FM_FR] and "Gartenpumpe" not in got[FM_FR]
    assert all("stopped at its 2 USD limit" in t for t in got.values())
    pages = {c: open(d, encoding="utf-8").read() for c, d in agent.tg.documents}
    assert "Gartenpumpe" in pages[FM_DE] and "pompe du jardin" not in pages[FM_DE]
    assert "pompe du jardin" in pages[FM_FR] and "Gartenpumpe" not in pages[FM_FR]


def test_stopped_at_its_limit_with_one_language_the_step_runs_once_as_before(tmp_path, monkeypatch):
    agent = make_agent(tmp_path, {"people": [{"telegram_id": FM_DE, "name": "Anna", "role": "fm", "language": "de"},
                                             {"telegram_id": OWNER, "name": "Olga", "role": "owner", "language": "en"}],
                                  "settings": {"skill_ai": {"reports": {"brain": "performance", "limit_usd": 2}}}},
                       skills=["reports"])
    from vesta_agent import job_steps
    calls = []
    real = job_steps.run

    async def spy(*a, **k):
        calls.append((a[6], k.get("language")))
        return await real(*a, **k)
    monkeypatch.setattr(job_steps, "run", spy)
    FakeAI(lambda r: runner.RunResult("", None, True, 2.0, [], None)).install(monkeypatch)
    sk, weekly = agent.jobs.find("fm-weekly")
    run(agent.jobs.run(sk, weekly))
    assert [(v["suffix"], lang) for v, lang in calls] == [("", None)]


def test_made_without_the_ai_the_one_english_text_reaches_every_reader(agent, monkeypatch):
    """The without_ai text is the code's, in English for everyone ("readings and translation are missing"): one text,
    to every chat of the role, whatever they read."""
    from helpers import known_devices
    known_devices(agent)
    FakeAI(problem="credit").install(monkeypatch)
    sk, daily = agent.jobs.find("fm-daily")
    run(agent.jobs.run(sk, daily))
    got = texts(agent)
    assert {FM_DE, FM_FR} <= set(got) and got[FM_DE] == got[FM_FR]
    assert got[FM_FR].endswith("readings and translation are missing.)")


# ---------------------------------------------------------------- review H5: one Language
def test_a_language_is_one_value_code_and_name(tmp_path):
    from vesta_agent.policy import Language, problems
    assert Language.parse("FRENCH") == Language.parse(" fr ") == Language("fr") and Language("fr").name == "French"
    assert Language.parse("Portuguese") is None and Language.parse("pt") is None
    assert Language.of("pt") == Language("en") and Language.of(None) == Language("en")
    assert Language.name_of("de") == "German" and Language.name_of("pt") == "pt"
    rows = lambda lang: {"people": [{"telegram_id": 1, "name": "Rui", "role": "fm", "language": lang}]}  # noqa: E731
    assert any("Rui: language must be one of en, fr" in p for p in problems(rows("pt")))
    assert not any("language" in p for p in problems(rows("fr")))
    assert any("Rui: language" in p for p in problems(rows(["fr"])))          # never a crash


def test_a_language_outside_the_list_is_named_and_read_as_english(tmp_path):
    agent = make_agent(tmp_path, {"people": [
        {"telegram_id": OWNER, "name": "Olga", "role": "owner", "language": "en"},
        {"telegram_id": FM_DE, "name": "Anna", "role": "fm", "language": "de"},
        {"telegram_id": FM_FR, "name": "Rui", "role": "fm", "language": "pt"}],
        "settings": {"skill_ai": {"reports": {"brain": "performance", "limit_usd": 2}}}}, skills=["reports"])
    assert any("Rui: language must be one of" in p for p in agent.policy().problems)
    assert agent.jobs._language_of("fm") == "German and English"
    out = run(send_tool(agent).handler({"to": "fm", "text": {"Deutsch": "x", "GERMAN": "Noch offen: 2",
                                                             "en": "Still open: 2"}}))
    assert not out.get("is_error")
    got = texts(agent)
    assert "Noch offen: 2" in got[FM_DE] and "Still open: 2" in got[FM_FR]
