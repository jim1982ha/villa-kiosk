"""The tests' Home Assistant and Kiosk stand-ins have the real ones' methods and parameters (as test_telegram_fake
and test_ai_fake hold the Telegram and AI ones): a method added to one is added to the other."""
from __future__ import annotations

import inspect

from ha_fake import FakeHA, _Session
from kiosk_fake import FakeKiosk
from vesta_agent.kiosk import Kiosk
from vesta_shared.ha_client import McpClient, McpSession


def _methods(cls, names=None) -> dict[str, list[str]]:
    out = {}
    for n, f in inspect.getmembers(cls, inspect.isfunction):
        if n.startswith("_") or (names is not None and n not in names):
            continue
        out[n] = [p for p in inspect.signature(f).parameters if p != "self"]
    return out


def _called_on_the_reader() -> tuple[set[str], set[str]]:
    """What the agent's own code calls on its Home Assistant reader, and on the reader's session (reader.mcp)."""
    import re
    from pathlib import Path
    src = "".join(p.read_text() for p in Path(__file__).parents[1].joinpath("vesta_agent").rglob("*.py"))
    # any use, called or handed on (asyncio.to_thread(reader.tool_content, …) has no parenthesis after the name)
    return set(re.findall(r"reader\.([a-z_]+)\b", src)) - {"mcp"}, set(re.findall(r"reader\.mcp\.([a-z_]+)\b", src))


def test_the_home_assistant_stand_in_has_what_the_agent_calls_on_the_real_client():
    on_reader, on_session = _called_on_the_reader()
    assert on_reader and on_session
    assert _methods(FakeHA, on_reader) == _methods(McpClient, on_reader) and set(_methods(FakeHA, on_reader)) == on_reader
    methods = on_session - {"server_info"}
    assert _methods(_Session, methods) == _methods(McpSession, methods) and set(_methods(_Session, methods)) == methods
    assert hasattr(FakeHA().mcp, "server_info")


def test_the_kiosk_stand_in_has_the_real_kiosks_methods():
    assert _methods(FakeKiosk) == _methods(Kiosk)
    assert FakeKiosk.enabled is True and hasattr(FakeKiosk(), "info")
