"""The villa's alerts handed over while the agent was not listening, taken in when it starts (owner's end-to-end test,
2026-10-30: the test lock's alert, handed over during an update's restart, opened no incident — an orphan line on the
tablet). Read from each handing rule's runs since the agent last heard the villa; once each, whichever way it came.
Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from ha_fake import FakeHA
from helpers import make_agent
from vesta_agent.ha_events import CONTEXT_KEY

NOW = datetime.now(timezone.utc)
RULE = "automation.example_watchdog"


def handover(incident_id: str, phase: str = "opened") -> dict:
    return {"blueprint": "example_watchdog", "rule_id": RULE, "incident_id": incident_id, "phase": phase,
            "timestamp": f"2026-10-30T00:4{len(phase) % 10}:00+08:00",
            "severity": "critical", "label": "Example device unavailable", "entities": ["lock.example"]}


def run_of(run_id: str, minutes_ago: float, data: dict) -> dict:
    return {"run_id": run_id, "start": (NOW - timedelta(minutes=minutes_ago)).isoformat(),
            "actions": [{"variables": {"context": {"id": f"ctx-{run_id}"}}},
                        {"result": {"event": "vesta_message", "event_data": {"message": "x"}}},
                        {"result": {"event": "vesta_critical_event", "event_data": data}}]}


def agent(tmp_path, runs):
    ha = FakeHA(rules=[{"entity_id": RULE, "kind": "automation", "config": {}}], traces={RULE: runs})
    return make_agent(tmp_path, {"people": [{"telegram_id": 111, "name": "Owner", "role": "owner"}]}, reader=ha)


def taken_in(v) -> list:
    return [c for c in v.state.calls("critical_event")]


def catch_up(v, last_heard: datetime | None) -> int:
    async def go():
        connected = asyncio.Event()
        connected.set()
        return await v.catch_up(connected, last_heard.isoformat() if last_heard else None)
    return asyncio.run(go())


def test_an_alert_handed_over_while_the_agent_was_away_is_taken_in_at_start(tmp_path, monkeypatch):
    v = agent(tmp_path, [run_of("r0", 120, handover("i-old")),         # before the agent stopped: had been taken in
                         run_of("r1", 3, handover("i-missed"))])         # during the restart
    seen = []

    async def critical(event):
        seen.append(event)
    monkeypatch.setattr(v, "on_critical", critical)
    assert catch_up(v, NOW - timedelta(minutes=5)) == 1
    assert [e["incident_id"] for e in seen] == ["i-missed"]
    # as the socket delivers it: its run's context beside its data (the villa's message of that run is the incident's)
    assert seen[0][CONTEXT_KEY] == "ctx-r1"


def test_a_first_start_has_missed_nothing(tmp_path):
    v = agent(tmp_path, [run_of("r1", 3, handover("i-1"))])
    assert catch_up(v, None) == 0 and v.reader.calls == []


def test_a_handover_taken_in_live_is_never_taken_in_twice(tmp_path):
    # the last beat comes up to a minute before the stop: a handover inside that minute came live AND is in the runs
    v = agent(tmp_path, [run_of("r1", 1, handover("i-both"))])
    asyncio.run(v.on_critical(handover("i-both")))
    catch_up(v, NOW - timedelta(minutes=2))
    assert len(taken_in(v)) == 1
    # ...while its later phase is its own handover
    asyncio.run(v.on_critical(handover("i-both", phase="resolved")))
    assert len(taken_in(v)) == 2


def test_the_agent_catches_up_each_time_it_starts_listening_from_its_last_beat():
    # main(): the last beat read BEFORE the socket beats again, the catch-up waiting for the villa to be heard
    import inspect
    from vesta_agent.app import Vesta
    src = inspect.getsource(Vesta.main)
    assert src.index('last_beat("ha_events")') < src.index("HaEvents(")
    assert "self.catch_up(events.connected, last_heard)" in src


def test_a_rules_repeat_of_an_open_alert_is_its_own_handover(tmp_path):
    # "still there": the same incident id and phase, a later moment — never taken for the first one
    v = agent(tmp_path, [])
    asyncio.run(v.on_critical(handover("i-1")))
    asyncio.run(v.on_critical({**handover("i-1"), "timestamp": "2026-10-30T01:00:00+08:00"}))
    assert len(taken_in(v)) == 2


def test_a_handover_is_remembered_as_long_as_the_catch_up_looks_back(tmp_path, monkeypatch):
    # the villa messages kept 1 hour, the catch-up 6: one taken in 3 hours before a stop is still known as taken in
    from vesta_agent import missed_at_start
    from vesta_agent.state import State
    monkeypatch.setattr(State, "ha_sent_keep_h", staticmethod(lambda: 1))
    monkeypatch.setattr(missed_at_start, "catch_up_hours", lambda: 6)
    v = agent(tmp_path, [])
    early = NOW - timedelta(hours=3)
    assert v.state.alert_seen("i-1:opened:t", at=early) is False
    assert v.state.alert_seen("i-2:opened:t", at=NOW) is False      # a later write prunes what is past the window
    assert v.state.alert_seen("i-1:opened:t", at=NOW) is True
