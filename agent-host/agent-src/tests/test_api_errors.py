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
