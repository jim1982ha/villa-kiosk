"""Every history read of the AI is answered with the facts of its whole period (owner, 2026-10-20: "I never want to see
wrong responses"): the investigate skill's `reads_history` command over the period and devices the villa's system
read, in place of its readings. A chat answer read the House Pump's 100 newest readings — 15 minutes at rest — as its
whole afternoon. When the facts cannot be worked out, the AI is told to say so; the readings are never the fallback."""
from __future__ import annotations

import asyncio
import json

from ai_fake import FakeAI
from ha_fake import FakeHA, tool as ha_tool
from helpers import make_agent
from vesta_agent import script_run
from vesta_agent.script_run import ScriptAnswer

JM = 111
PEOPLE = [{"telegram_id": JM, "name": "JM", "role": "owner"}]
RAW = json.dumps({"data": {"source": "history", "period": {"start": "2026-10-20T06:00:00+00:00",
                                                            "end": "2026-10-20T10:21:00+00:00"},
                           "entities": [{"entity_id": "sensor.pump_power",
                                         "states": [{"state": "1.1"}, {"state": "0.0"}, {"state": "1.2"}]}]}})


def _villa(tmp_path, monkeypatch, answer: ScriptAnswer, args=None):
    ha = FakeHA(tools=[ha_tool("ha_get_history", entity_ids="string", source="string")],
                answers={"ha_get_history": RAW})
    v = make_agent(tmp_path, {"people": PEOPLE, "ha_read_tools": ["ha_get_history"]}, skills=("investigate",), reader=ha)
    asyncio.run(v.refresh_server_tools())
    ran, got = [], {}

    def run_command(settings, state, skill, command, values=None, *, by=None, timeout=None):
        ran.append((skill.name, command, values, by))
        return answer
    monkeypatch.setattr(script_run, "run_command", run_command)

    async def reads(run_):
        got["text"] = (await run_["call"]("ha_get_history", args or {"entity_ids": "sensor.pump_power"}))["content"][0]["text"]
    FakeAI("ok", act=reads).install(monkeypatch)
    asyncio.run(v.converse(JM, v.policy().person(JM), "why does the pump keep starting?"))
    return ran, got["text"]


def test_a_history_read_gets_the_skills_lines_over_the_whole_period_never_the_readings(tmp_path, monkeypatch):
    facts = {"lines": ["sensor.pump_power: 1046 readings", "  started 54 times in 4 h 21 min  ⟵ about 11× more often"]}
    ran, text = _villa(tmp_path, monkeypatch, ScriptAnswer(0, json.dumps(facts), "", 1.0))
    (skill, command, values, by), = ran
    assert skill == "investigate" and command.startswith("investigate.py timeline") and by == script_run.AI
    assert values == {"entities": "sensor.pump_power", "start": "2026-10-20T06:00:00+00:00",
                      "end": "2026-10-20T10:21:00+00:00"}               # the villa's system's own period and devices
    assert "started 54 times" in text and "EVERY recorded change" in text
    assert '"states"' not in text                                       # not one raw reading


def test_facts_that_cannot_be_worked_out_are_said_never_replaced_by_the_readings(tmp_path, monkeypatch):
    _, text = _villa(tmp_path / "x", monkeypatch, ScriptAnswer(1, "", "boom", 1.0))
    assert "could not be worked out" in text and "never answer from a part" in text and '"states"' not in text


def test_long_term_figures_are_already_the_whole_period(tmp_path, monkeypatch):
    ran, _ = _villa(tmp_path / "s", monkeypatch, ScriptAnswer(0, "{}", "", 1.0),
                    args={"entity_ids": "sensor.pump_power", "source": "statistics"})
    assert ran == []
