"""Architecture review 6: the siren stops by itself on every path that turns it on, and after a restart."""
from __future__ import annotations

import asyncio
import types
from datetime import datetime, timedelta, timezone

from vesta_agent.siren import Siren
from vesta_agent.state import State

T0 = datetime(2026, 10, 7, 12, 0, tzinfo=timezone.utc)
POLICY = types.SimpleNamespace(siren_entity="switch.example_siren", siren_auto_off_min=3)


class FakeActions:
    def __init__(self, ok=True):
        self.calls, self.ok = [], ok

    def system(self, domain, service, entity_id, data=None):
        self.calls.append((domain, service, entity_id))
        return self.ok


def _siren(tmp_path, actions=None):
    told = []

    async def tell(text):
        told.append(text)
    return Siren(lambda: POLICY, State(str(tmp_path / "s.db")), actions or FakeActions(), tell), told


def test_a_siren_turned_on_stops_after_its_minutes_and_the_owner_is_told(tmp_path):
    s, told = _siren(tmp_path)
    s.executed("switch", "turn_on", ["switch.example_siren"], now=T0)
    assert not asyncio.run(s.tick(T0 + timedelta(minutes=2)))                 # not yet
    assert asyncio.run(s.tick(T0 + timedelta(minutes=3)))
    assert s.actions.calls == [("switch", "turn_off", "switch.example_siren")] and told == ["Siren switched off."]
    assert not asyncio.run(s.tick(T0 + timedelta(minutes=10)))                # once


def test_a_restart_still_stops_the_siren(tmp_path):
    s, _ = _siren(tmp_path)
    s.executed("switch", "turn_on", ["switch.example_siren"], now=T0)
    after_restart, told = _siren(tmp_path)                                     # a new agent, the same records
    assert asyncio.run(after_restart.tick(T0 + timedelta(minutes=4)))
    assert after_restart.actions.calls and told == ["Siren switched off."]


def test_only_the_configured_siren_turned_on_is_stopped(tmp_path):
    s, _ = _siren(tmp_path)
    for call in [("switch", "turn_on", ["switch.example_pump"]), ("switch", "turn_off", ["switch.example_siren"]),
                 ("light", "turn_on", ["switch.example_siren"])]:
        s.executed(*call, now=T0)
    assert s.state.siren_stop() is None


def test_a_failed_stop_says_so(tmp_path):
    s, told = _siren(tmp_path, FakeActions(ok=False))
    s.executed("switch", "turn_on", ["switch.example_siren"], now=T0)
    asyncio.run(s.tick(T0 + timedelta(minutes=3)))
    assert told == ["The siren could not be switched off: check it now."]


def test_every_execution_reaches_the_siren_whatever_the_path(tmp_path, monkeypatch):
    # the stop was scheduled only after an Approve press: a `direct` turn_on never stopped
    monkeypatch.delenv("VESTA_HA_READ_ONLY", raising=False)
    from vesta_agent.actions import Actions
    from vesta_agent.policy import Decision
    seen = []

    class Writer:
        def call_service(self, domain, service, data):
            pass

        def states(self, ids):
            return {e: {"state": "on"} for e in ids}
    a = Actions(lambda: None, State(str(tmp_path / "a.db")), Writer, executed=lambda *x: seen.append(x))
    a.execute(Decision(True, "test", "any", "switch", "turn_on", ["switch.example_siren"], {}))
    assert seen == [("switch", "turn_on", ["switch.example_siren"])]


def test_the_agent_wires_the_siren_to_its_actions_and_watches_it(tmp_path):
    from helpers import make_agent
    agent = make_agent(tmp_path, {"siren_entity": "switch.example_siren", "people": []})
    agent.actions.on_executed("switch", "turn_on", ["switch.example_siren"])
    assert agent.state.siren_stop() is not None
    import inspect
    assert "self.siren.watch(stop)" in inspect.getsource(type(agent).main)      # and the agent runs its watch


def test_the_stop_is_kept_when_the_rules_cannot_be_read(tmp_path):
    # architecture review 17: the stop was cleared before the rules were read; a reading that failed lost it for good
    s, told = _siren(tmp_path)
    s.executed("switch", "turn_on", ["switch.example_siren"], now=T0)

    def broken():
        raise TypeError("unhashable type: 'list'")
    s.policy = broken
    try:
        asyncio.run(s.tick(T0 + timedelta(minutes=4)))
    except TypeError:
        pass
    assert s.state.siren_stop() is not None                                    # still due
    s.policy = lambda: POLICY
    assert asyncio.run(s.tick(T0 + timedelta(minutes=5))) and s.actions.calls  # switched off at the next tick
