"""Async tests without a plugin dependency.

⚠️ NO `pytest-asyncio` IN THE IMAGE OR ON A RUNNER. The layer's whole test
surface is async; taking a plugin dependency for it means CI installs one more
thing that can be unavailable the day it matters. `asyncio.run` on a coroutine
test is four lines and needs nothing.
"""
import asyncio
import inspect

import pytest


def pytest_configure(config):
    config.addinivalue_line("markers", "asyncio: run this coroutine test")


@pytest.hookimpl(tryfirst=True)
def pytest_pyfunc_call(pyfuncitem):
    func = pyfuncitem.obj
    if not inspect.iscoroutinefunction(func):
        return None
    kwargs = {name: pyfuncitem.funcargs[name]
              for name in pyfuncitem._fixtureinfo.argnames}
    asyncio.run(func(**kwargs))
    return True


@pytest.fixture(autouse=True)
def _isolate_log_level():
    """Put the log threshold back after every test.

    ⚠️ IT IS MODULE-GLOBAL, SO ONE TEST SILENCED ANOTHER. A test that sets the
    level to `error` and restores it in its own `finally` is still leaking if
    anything between raises — and the whole suite went red on two unrelated
    tests the first time the order changed. A fixture here holds for every test
    in the tree, not for the ones somebody remembered.
    """
    from agent import log

    before = log.current_level()
    yield
    log.configure(before)
