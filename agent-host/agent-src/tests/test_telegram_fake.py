"""The test Telegram and the real one have the same interface: a method added to one is added to the other."""
from __future__ import annotations

import inspect

from telegram_fake import FakeTelegram
from vesta_agent.telegram import Telegram

INTERNAL = {"api"}           # the HTTP call itself: the agent goes through the methods, never through it


def _interface(cls) -> dict[str, list[str]]:
    return {n: list(inspect.signature(f).parameters)
            for n, f in inspect.getmembers(cls, inspect.iscoroutinefunction)
            if not n.startswith("_") and n not in INTERNAL}


def test_the_fake_has_exactly_the_real_telegrams_methods_and_parameters():
    assert _interface(FakeTelegram) == _interface(Telegram)


def test_the_agent_calls_nothing_the_interface_does_not_have():
    import re
    from pathlib import Path
    src = "".join(p.read_text() for p in Path(__file__).parents[1].joinpath("vesta_agent").rglob("*.py"))
    called = set(re.findall(r"\btg\.([a-z_]+)\(", src))
    assert called and called <= set(_interface(Telegram)), called - set(_interface(Telegram))
