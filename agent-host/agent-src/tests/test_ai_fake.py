"""The tests' AI stand-in takes exactly what the real AI run takes: an argument added to one is added to the other."""
from __future__ import annotations

import inspect

from ai_fake import FakeAI
from vesta_agent import runner


def _params(f) -> list[tuple[str, object]]:
    return [(p.name, p.default) for p in inspect.signature(f).parameters.values() if p.name != "self"]


def test_the_stand_in_takes_exactly_the_real_runs_parameters():
    assert _params(FakeAI.run) == _params(runner.run)
