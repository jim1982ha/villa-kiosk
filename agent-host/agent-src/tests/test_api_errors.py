"""When Anthropic fails, a person reads why in plain words — never the raw error (owner, 2026-10-06).

The SDK reports a failure as an AssistantMessage whose `error` is set and whose TEXT is the raw
"API Error: …" prose, as a ResultMessage with is_error and api_error_status, or as an exception.
Each common case is driven through the real runner (a fake SDK client) and the real agent."""
from __future__ import annotations

import asyncio

import pytest
import yaml
from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock

from helpers import make_agent, settings
from ai_fake import FakeAI
from telegram_fake import FakeTelegram
from vesta_agent import api_errors, runner
from vesta_agent.app import Vesta
from vesta_agent.kiosk import Kiosk
from vesta_agent.state import State

RAW = 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}'


def fake_client(messages, raise_at_end: Exception | None = None):
    class Fake:
        def __init__(self, options):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def query(self, prompt):
            pass

        async def receive_response(self):
            for m in messages:
                yield m
            if raise_at_end:
                raise raise_at_end
    return Fake


def failed_result(status=None, result=""):
    return ResultMessage(subtype="success", duration_ms=10, duration_api_ms=5, is_error=True, num_turns=1,
                         session_id="s1", total_cost_usd=0.0, result=result, api_error_status=status)


@pytest.mark.parametrize("kind,status,text,exc,want", [
    ("billing_error", 400, RAW, None, "credit"),
    (None, 400, RAW, None, "credit"),                                  # the prose alone says it
    ("authentication_failed", 401, "invalid x-api-key", None, "key"),
    ("rate_limit", 429, "", None, "rate_limit"),
    ("server_error", 529, "Overloaded", None, "busy"),
    (None, 500, "", None, "busy"),
    (None, None, "API Error: Connection error.", None, "offline"),
    (None, None, "", "CLIConnectionError", "offline"),
    ("invalid_request", 400, "prompt is too long: 210000 tokens > 200000 maximum", None, "too_long"),
    ("unknown", None, "something new", None, "unknown"),
])
def test_each_common_failure_has_its_reason(kind, status, text, exc, want):
    assert api_errors.classify(kind, status, text, exc) == want
    assert api_errors.FOR_PERSON[want] and "{" not in api_errors.FOR_PERSON[want]


def run_with(monkeypatch, tmp_path, messages, raise_at_end=None, resume=None):
    s = settings(str(tmp_path))
    st = State(s.state_path)
    monkeypatch.setattr(runner, "ClaudeSDKClient", fake_client(messages, raise_at_end))
    return asyncio.run(runner.run(s, "sys", "prompt", None, set(), st, who="x", resume=resume))


def test_the_raw_api_error_text_is_never_the_answer(monkeypatch, tmp_path):
    msgs = [AssistantMessage(content=[TextBlock(text=RAW)], model="m", error="billing_error"), failed_result(400, RAW)]
    res = run_with(monkeypatch, tmp_path, msgs)
    assert res.text == "" and res.problem == "credit"


def test_an_exception_from_the_sdk_is_classified(monkeypatch, tmp_path):
    class ResultError(Exception):
        api_error_status, result = 529, "API Error: Overloaded"
    res = run_with(monkeypatch, tmp_path, [], raise_at_end=ResultError("exit 1"))
    assert res.problem == "busy"


def test_a_failed_resume_is_not_retried_when_a_new_conversation_fails_the_same(monkeypatch, tmp_path):
    calls = []
    real = runner.run

    async def counting(*a, **k):
        calls.append(k.get("resume", a[7] if len(a) > 7 else None))
        return await real(*a, **k)
    msgs = [AssistantMessage(content=[TextBlock(text=RAW)], model="m", error="billing_error"), failed_result(400, RAW)]
    monkeypatch.setattr(runner, "run", counting)
    s = settings(str(tmp_path))
    monkeypatch.setattr(runner, "ClaudeSDKClient", fake_client(msgs))
    asyncio.run(runner.run(s, "sys", "p", None, set(), State(s.state_path), who="x", resume="old-session"))
    assert len(calls) == 1


OWNER_CHAT, FM = -100777, 222


@pytest.fixture
def agent(tmp_path):
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "FM", "role": "fm"}],
                              "chats": {"owner": OWNER_CHAT, "fm": FM}})
    v.server_tools = [{"name": "ha_get_state", "annotations": {"readOnlyHint": True}}]   # as HA MCP lists it
    return v


def test_a_person_reads_the_reason_and_the_owner_is_told_once(agent, monkeypatch):
    FakeAI("", problem="credit", cost_usd=0.0).install(monkeypatch)
    person = agent.policy().person(FM)
    for _ in range(2):
        asyncio.run(agent.converse(FM, person, "is the pool OK?"))
    to_fm = [t for c, t, _ in agent.tg.sent if c == FM]
    to_owner = [t for c, t, _ in agent.tg.sent if c == OWNER_CHAT]
    assert to_fm == [api_errors.FOR_PERSON["credit"]] * 2
    assert to_owner == [api_errors.NEEDS_THE_OWNER["credit"]]          # once, not at every reply
    assert not any("API Error" in t or "{" in t for _, t, _ in agent.tg.sent)


def test_a_report_that_cannot_run_says_so_instead_of_logging_done(agent, monkeypatch):
    from vesta_agent.skills import ai_jobs
    from helpers import copy_skill
    copy_skill("reports", agent.s.skills_dir)
    with open(agent.s.policy_path) as f:
        pol = yaml.safe_load(f)
    pol["settings"] = {"jobs": {"fm-daily": {"profile": "economy", "limit_usd": 1}}}
    pol["ha_read_tools"] = ["ha_get_state"]
    with open(agent.s.policy_path, "w") as f:
        yaml.safe_dump(pol, f)

    FakeAI("", problem="offline", cost_usd=None).install(monkeypatch)
    sk = agent.skills.get("reports")
    job = next(j for s_, j in ai_jobs(agent.skills.all()) if j["name"] == "fm-daily")
    asyncio.run(agent.run_model_job(sk, job))
    assert any("fm-daily report could not be prepared" in t and "could not be reached" in t for _, t, _ in agent.tg.sent)


def test_a_run_retried_after_a_lost_session_keeps_what_was_asked(monkeypatch, tmp_path):
    # architecture review, 2026-10-07: the retry in a new conversation dropped `asked`: on the Costs tab, the run
    # that answered showed nothing asked
    lost = [AssistantMessage(content=[TextBlock(text="No conversation found")], model="m", error="unknown"),
            failed_result(None, "No conversation found with session ID: old")]
    answered = [AssistantMessage(content=[TextBlock(text="The pool is fine.")], model="m"),
                ResultMessage(subtype="success", duration_ms=10, duration_api_ms=5, is_error=False, num_turns=1,
                              session_id="s2", total_cost_usd=0.01, result="The pool is fine.")]
    rounds = iter([lost, answered])

    class Fake:
        def __init__(self, options):
            self.msgs = next(rounds)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def query(self, prompt):
            pass

        async def receive_response(self):
            for m in self.msgs:
                yield m
    monkeypatch.setattr(runner, "ClaudeSDKClient", Fake)
    s = settings(str(tmp_path))
    st = State(s.state_path)
    res = asyncio.run(runner.run(s, "sys", "p", None, set(), st, who="x", resume="old", asked="is the pool ok?"))
    assert res.text == "The pool is fine."
    import json as _j
    runs = [_j.loads(c["detail"]) for c in st.calls_since("1970") if c["kind"] == "run"]
    assert runs[-1]["asked"] == "is the pool ok?"


# ⚠️ A REPORT EVEN WITHOUT THE AI (owner, 2026-10-07: the Anthropic credit ran out and the weekly never came): a
# job's without_ai steps still make it from its figures, saying why, and the Costs tab shows it.
_WEEK = ("import argparse, json, os, sys\nap = argparse.ArgumentParser(); ap.add_argument('--out'); a = ap.parse_known_args()[0]\n"
         "if os.path.exists('fail.flag'): sys.exit('no statistics today')\n"
         "json.dump({'kwh': 287}, open(a.out, 'w')); print('{}')\n")
_PAGE = ("import argparse, json\nap = argparse.ArgumentParser()\n"
         "for f in ('--week', '--finish', '--no-ai'): ap.add_argument(f)\na = ap.parse_known_args()[0]\n"
         "kwh = json.load(open(a.week))['kwh']\n"
         "print(json.dumps({'send': [{'to': a.finish, 'text': f'{kwh} kWh this week. (Made without the AI: {a.no_ai})'}]}))\n")


def _report_without_ai(agent, monkeypatch, *, fail=False, stale=False, run_job=True):
    from helpers import make_skill
    from vesta_agent.skills import ai_jobs
    make_skill(agent.s.skills_dir, "figures", {"tools": []}, {"week.py": _WEEK})
    make_skill(agent.s.skills_dir, "rep", {"tools": [], "schedule": [{
        "when": "Mon 08:00", "name": "rep-weekly", "to": "fm", "prompt": "make it", "on_request": True,
        "button": "Weekly report",
        "without_ai": [{"skill": "figures", "run": "week.py --out week.json"},
                       "page.py --week week.json --finish {to} --no-ai {why}"]}]}, {"page.py": _PAGE})
    with open(agent.s.policy_path) as f:
        pol = yaml.safe_load(f)
    pol["settings"] = {"jobs": {"rep-weekly": {"profile": "economy", "limit_usd": 1}}}
    with open(agent.s.policy_path, "w") as f:
        yaml.safe_dump(pol, f)
    import os
    if fail:
        open(os.path.join(agent.s.out_dir, "fail.flag"), "w").close()
    if stale:
        open(os.path.join(agent.s.out_dir, "week.json"), "w").write('{"kwh": 999}')    # last week's file
    FakeAI("", problem="credit", cost_usd=0.0).install(monkeypatch)
    if not run_job:
        return
    job = next(j for s_, j in ai_jobs(agent.skills.all()) if j["name"] == "rep-weekly")
    asyncio.run(agent.run_model_job(agent.skills.get("rep"), job))
    return [t for c, t, _ in agent.tg.sent if c == FM]


def test_a_report_the_ai_cannot_make_is_made_from_its_figures_and_says_why(agent, monkeypatch):
    from vesta_agent import status
    to_fm = _report_without_ai(agent, monkeypatch)
    assert to_fm == ["287 kWh this week. (Made without the AI: The Anthropic account has run out of credit.)"]
    assert [t for c, t, _ in agent.tg.sent if c == OWNER_CHAT] == [api_errors.NEEDS_THE_OWNER["credit"]]
    (row,) = [r for r in status.costs(agent.state)["runs"] if r.get("without_ai")]
    assert row["work"] == "rep-weekly" and row["cost"] == 0 and row["without_ai"] == {
        "why": "The Anthropic account has run out of credit.", "sent": 1, "failed": None}
    c = status.costs(agent.state)
    assert c["runs_count"] == len([r for r in c["runs"] if not r.get("without_ai")])   # not an AI run
    assert all(g["name"] != "rep-weekly" for g in c["by_work"])        # nor in what the AI cost


def test_a_step_that_fails_stops_the_report_and_an_old_file_never_stands_in(agent, monkeypatch):
    to_fm = _report_without_ai(agent, monkeypatch, fail=True, stale=True)
    assert to_fm == [api_errors.for_job("rep-weekly", "credit")]      # not "999 kWh": last week's figures
    from vesta_agent import status
    (row,) = [r for r in status.costs(agent.state)["runs"] if r.get("without_ai")]
    assert row["without_ai"]["sent"] == 0 and row["without_ai"]["failed"] == "week.py"


def test_a_report_asked_for_while_the_ai_is_down_is_a_button_that_needs_no_ai(agent, monkeypatch):
    # villa, 2026-10-07 12:42: "Generate the weekly report" met "out of credit" — only the AI could have understood
    # the words and started the job. The answer offers each report that can be made without it; a press makes it.
    _report_without_ai(agent, monkeypatch, run_job=False)
    person = agent.policy().person(FM)

    async def go():
        await agent.converse(FM, person, "a report please")
        (chat, text, kb), = [m for m in agent.tg.sent if m[0] == FM]
        assert text.startswith(api_errors.FOR_PERSON["credit"]) and "without the AI" in text
        assert kb == {"inline_keyboard": [[{"text": "Weekly report", "callback_data": "w:credit:rep-weekly"}]]}
        await agent.on_ha_event("telegram_callback", {"id": "cb1", "data": "w:credit:rep-weekly", "chat_id": FM,
                                                      "user_id": FM, "message": {"message_id": agent.tg.next_id,
                                                                                 "chat": {"id": FM}, "text": "No credit."}})
        for _ in range(500):                                         # until the report is there (no fixed sleep)
            if len([m for m in agent.tg.sent if m[0] == FM]) > 1:
                break
            await asyncio.sleep(0.01)
    asyncio.run(go())
    said = "Making the Weekly report without the AI, from its figures and charts: it will be sent here."
    assert agent.tg.toasts == [("cb1", said)]
    assert agent.tg.edits == [(FM, agent.tg.next_id - 1, f"No credit.\n\n{said}")]   # its buttons gone, it says so
    assert [t for c, t, _ in agent.tg.sent if c == FM][1] == \
        "287 kWh this week. (Made without the AI: The Anthropic account has run out of credit.)"


def test_no_report_button_for_a_person_who_may_not_start_one(agent, monkeypatch):
    _report_without_ai(agent, monkeypatch, run_job=False)
    with open(agent.s.policy_path) as f:
        pol = yaml.safe_load(f)
    pol.setdefault("agent_tools", {})["start_job"] = False
    with open(agent.s.policy_path, "w") as f:
        yaml.safe_dump(pol, f)
    asyncio.run(agent.converse(FM, agent.policy().person(FM), "generate the weekly report"))
    assert [kb for c, _, kb in agent.tg.sent if c == FM] == [None]


def test_a_report_named_in_the_message_starts_without_asking(agent, monkeypatch):
    # owner, 2026-10-07: "since I asked for a weekly report in the message, I am not expecting this response"
    _report_without_ai(agent, monkeypatch, run_job=False)

    async def go():
        await agent.converse(FM, agent.policy().person(FM), "Generate the Weekly Report for last week now")
        for _ in range(500):
            if any("287 kWh" in t for c, t, _ in agent.tg.sent):
                break
            await asyncio.sleep(0.01)
    asyncio.run(go())
    first = [m for m in agent.tg.sent if m[0] == FM][0]
    assert first[2] is None and first[1].endswith("Making the Weekly report without the AI, from its figures and "
                                                  "charts: it will be sent here.")
    assert any(t.startswith("287 kWh this week.") for c, t, _ in agent.tg.sent if c == FM)


def test_a_report_made_from_a_button_never_takes_the_next_answer_for_its_waiting_message(agent, monkeypatch):
    # villa, 2026-10-07 14:17: a tapped Daily digest was sent; the next answer (its buttons) vanished at once — the
    # job, started without a reply, took that answer for its "being prepared" message and deleted it
    _report_without_ai(agent, monkeypatch, run_job=False)
    person = agent.policy().person(FM)

    async def go():
        await agent.converse(FM, person, "a report please")
        pressed = agent.tg.next_id
        await agent.on_ha_event("telegram_callback", {"id": "cb1", "data": "w:credit:rep-weekly", "chat_id": FM,
                                                      "user_id": FM, "message": {"message_id": pressed,
                                                                                 "chat": {"id": FM}, "text": "x"}})
        for _ in range(500):
            if any("287 kWh" in t for c, t, _ in agent.tg.sent):
                break
            await asyncio.sleep(0.01)
        while (FM, "rep-weekly") in agent._running_jobs:            # the job's end, after its result
            await asyncio.sleep(0.01)
        await agent.converse(FM, person, "a report please")
        return pressed
    pressed = asyncio.run(go())
    assert agent.tg.deleted == [(FM, pressed)]                      # the pressed message, replaced by the report


def test_no_report_button_for_a_question_about_something_else(agent, monkeypatch):
    # owner, 2026-10-07: "what do you see in the living camera now?" got the report buttons
    _report_without_ai(agent, monkeypatch, run_job=False)
    asyncio.run(agent.converse(FM, agent.policy().person(FM), "what do you see in the living camera now?"))
    (text, kb), = [(t, kb) for c, t, kb in agent.tg.sent if c == FM]
    assert kb is None and text == api_errors.FOR_PERSON["credit"]
