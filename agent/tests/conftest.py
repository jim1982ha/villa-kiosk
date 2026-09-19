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
