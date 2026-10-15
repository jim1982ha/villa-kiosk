"""Architecture review 6: what a run was is written, read and pruned in one module (vesta_shared.agent_records)."""
from __future__ import annotations

from helpers import run_kit, run_terms
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
    res = asyncio.run(runner.run(s, "sys", "p", run_kit(), run_terms(who="Owner@1"), st, resume="old", asked="all ok?"))
    assert res.text == "All quiet."
    rows = [r for r in status.costs(st)["runs"]]
    assert len(rows) == 1 and rows[0]["asked"] == "all ok?" and rows[0]["cost"] == 0.01


def test_a_records_detail_is_read_one_way():
    assert agent_records.detail({"detail": '{"a": 1}'}) == {"a": 1}
    assert agent_records.detail({"detail": "not json"}) == {} and agent_records.detail({"detail": "[1]"}) == {}
    assert agent_records.job_of(agent_records.for_job("fm-daily")) == "fm-daily"
    assert agent_records.person_of(agent_records.for_person("Ann", -5)) == ("Ann", "-5")


def test_a_run_cut_by_a_stop_is_on_the_costs_tab_with_its_tokens_so_far(monkeypatch, tmp_path):
    # owner, 2026-10-15: two /investigate cut by the agent's updates were missing from the Costs tab, though billed
    from claude_agent_sdk import ToolUseBlock
    first = AssistantMessage(content=[ToolUseBlock(id="t1", name="mcp__vesta__run_skill_script", input={"script": "investigate.py"})],
                             model="m", usage={"input_tokens": 1200, "output_tokens": 80, "cache_read_input_tokens": 30000},
                             message_id="m1")
    second = AssistantMessage(content=[ToolUseBlock(id="t2", name="mcp__vesta__ha_get_logs", input={"hours_back": 6})],
                              model="m", usage={"input_tokens": 900, "output_tokens": 50}, message_id="m2")

    class Fake:
        def __init__(self, options):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def query(self, prompt):
            pass

        async def receive_response(self):
            yield first
            yield second
            await asyncio.Event().wait()                  # still working when the agent stops
    monkeypatch.setattr(runner, "ClaudeSDKClient", Fake)
    s = settings(str(tmp_path))
    st = State(s.state_path)

    async def cut():
        task = asyncio.create_task(runner.run(s, "sys", "p", run_kit(), run_terms(who="Owner@1"), st, asked="/investigate x"))
        await asyncio.sleep(0.05)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    asyncio.run(cut())
    (row,) = status.costs(st)["runs"]
    assert row["interrupted"] and row["asked"] == "/investigate x" and row["cost"] == 0.0
    assert (row["tokens_in"], row["tokens_out"], row["cache_read"]) == (2100, 130, 30000)
    assert [x["tool"] for x in row["steps"]] == ["run_skill_script", "ha_get_logs"]
    from helpers import page_js
    assert 'r.interrupted ? alertButton("Stopped by a restart"' in page_js()                    # the (!) a failed run has


def test_a_script_stopped_with_the_agent_is_not_a_failure_and_a_cut_run_is_no_reply(tmp_path):
    # owner, 2026-10-15: "2 failures" on the Overview were the two investigations' scripts ended by the agent's updates
    from types import SimpleNamespace
    from vesta_agent import script_run
    s = settings(str(tmp_path))
    st = State(s.state_path)
    sk = SimpleNamespace(name="investigate")
    script_run._answer(s, st, sk, "investigate.py", ["find"], script_run.STOPPED_BY_SIGTERM, "", "", 3.0, "ai")
    script_run._answer(s, st, sk, "investigate.py", ["find"], 1, "", "boom", 3.0, "ai")      # a real failure
    st.log(agent_records.RUN_CUT, {"who": "Owner@1", "cost_usd": None, "tokens": {"input_tokens": 10}})
    figures = dict(status.figures({k: n for k, n in _counts(st).items()}, 0.0))
    assert figures["failures"] == 1 and figures["replies written"] == 0
    assert [r["interrupted"] for r in status.costs(st)["runs"]] == [True]


def _counts(st):
    out = {}
    for c in st.calls_since("2000-01-01"):
        out[c["kind"]] = out.get(c["kind"], 0) + 1
    return out
