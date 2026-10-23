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
    # asked for in a chat: the asker's chat only, and a versions text is reduced to its first version
    here = send_tool(agent, Origin(FM_FR, JOB))
    assert not run(here.handler({"to": "here", "text": {"French": "Semaine", "German": "Woche"}})).get("is_error")
    assert [(c, "Semaine" in t) for c, t, *_ in agent.tg.sent] == [(FM_FR, True)]
