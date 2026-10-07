"""Architecture review 6: what a run was is written, read and pruned in one module (vesta_shared.agent_records)."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock

from helpers import settings
from vesta_agent import runner, status
from vesta_agent.state import State
from vesta_shared import agent_records


def test_the_costs_tabs_rows_are_kept_and_pruned_together(tmp_path):
    # housekeeping kept a job "made without the AI" on the records' limit (90 days) while the AI runs beside it
    # went by the runs' limit: the Costs tab showed one without the other
    st = State(str(tmp_path / "s.db"))
    st.log(agent_records.RUN, {"who": "job:fm-weekly", "cost_usd": 0.3})
    st.log(agent_records.WITHOUT_AI, agent_records.without_ai("fm-weekly", "credit", 1, None))
    st.log("send_failed", {"chat": 1})
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    gone = st.prune(runs_before=future, records_before=past)
    assert [c["kind"] for c in st.calls_since("2000-01-01")] == ["send_failed"]
    assert gone["runs"] == 2


def test_a_resume_that_failed_before_doing_anything_is_one_row_not_two(monkeypatch, tmp_path):
    # the retry in a new conversation recorded the failed resume as a run of its own: two rows for one question
    lost = [AssistantMessage(content=[TextBlock(text="No conversation found")], model="m", error="unknown"),
            ResultMessage(subtype="success", duration_ms=10, duration_api_ms=5, is_error=True, num_turns=1,
                          session_id="s0", total_cost_usd=0.0, result="", usage={"input_tokens": 0, "output_tokens": 0})]
    ok = [AssistantMessage(content=[TextBlock(text="All quiet.")], model="m"),
          ResultMessage(subtype="success", duration_ms=10, duration_api_ms=5, is_error=False, num_turns=1,
                        session_id="s1", total_cost_usd=0.01, result="All quiet.",
                        usage={"input_tokens": 900, "output_tokens": 20})]
    answers = iter([lost, ok])

    class Fake:
        def __init__(self, options):
            self.msgs = next(answers)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def query(self, prompt):
            pass

        async def receive_response(self):
            for m in self.msgs:
                yield m
    monkeypatch.setattr(runner, "ClaudeSDKClient", Fake)
    s = settings(str(tmp_path))
    st = State(s.state_path)
    res = asyncio.run(runner.run(s, "sys", "p", None, set(), st, who="Owner@1", resume="old", asked="all ok?"))
    assert res.text == "All quiet."
    rows = [r for r in status.costs(st)["runs"]]
    assert len(rows) == 1 and rows[0]["asked"] == "all ok?" and rows[0]["cost"] == 0.01


def test_a_records_detail_is_read_one_way():
    assert agent_records.detail({"detail": '{"a": 1}'}) == {"a": 1}
    assert agent_records.detail({"detail": "not json"}) == {} and agent_records.detail({"detail": "[1]"}) == {}
    assert agent_records.job_of(agent_records.for_job("fm-daily")) == "fm-daily"
    assert agent_records.person_of(agent_records.for_person("Ann", -5)) == ("Ann", "-5")
