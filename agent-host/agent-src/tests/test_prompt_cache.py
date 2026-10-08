"""The instructions every AI run starts with must not change from minute to minute: they are the cached prefix.

2026-10-09: they ended with the villa's time to the minute, so each message of a chat re-sent the whole conversation
at full price instead of reading it from the prompt cache (about a tenth of the price). The time now heads each
message (runner.with_time)."""
from __future__ import annotations

import inspect
from datetime import datetime
from zoneinfo import ZoneInfo

from helpers import make_agent
from vesta_agent import app as app_module
from vesta_agent import runner


def test_the_instructions_are_the_same_at_any_minute(tmp_path, monkeypatch):
    agent = make_agent(tmp_path, {})
    tz = ZoneInfo(agent.s.timezone)
    monkeypatch.setattr(app_module, "_now_local", lambda _tz: datetime(2026, 10, 9, 8, 1, tzinfo=tz))
    first = agent.system_prompt()
    monkeypatch.setattr(app_module, "_now_local", lambda _tz: datetime(2026, 10, 10, 21, 47, tzinfo=tz))
    assert agent.system_prompt() == first
    assert "08:01" not in first and "head each message" in first


def test_each_message_carries_the_villa_time():
    s = type("S", (), {"timezone": "Asia/Makassar"})()
    now = datetime(2026, 10, 9, 14, 32, tzinfo=ZoneInfo("Asia/Makassar"))
    assert runner.with_time(s, "Is the pool OK?", now) == "[Villa time: Friday 09 October 2026, 14:32]\nIs the pool OK?"
    # every run sends its message through it: chats, Continue and AI jobs all call runner.run
    assert "client.query(with_time(settings, prompt))" in inspect.getsource(runner.run)
