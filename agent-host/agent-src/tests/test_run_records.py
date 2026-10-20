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
    figures = dict(status.figures(st.calls_since("2000-01-01"), 0.0))
    assert figures["failures"] == 1 and figures["replies written"] == 0 and figures["reports made"] == 0
    assert [r["interrupted"] for r in status.costs(st)["runs"]] == [True]


def _counts(st):
    out = {}
    for c in st.calls_since("2000-01-01"):
        out[c["kind"]] = out.get(c["kind"], 0) + 1
    return out


# ---------------------------------------------------------------- one run's cost, not the conversation's (0.6.260)
def _sdk(monkeypatch, rounds):
    """A fake SDK client answering each run with the next list of messages."""
    answers = iter(rounds)

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


def _answer(session, total, blocks=None):
    """A run's messages as the SDK sends them: `total` is ResultMessage.total_cost_usd — on a resumed conversation the
    CLI's running total (it restores the conversation's "cost-state" from its transcript, restart or not)."""
    return [AssistantMessage(content=blocks or [TextBlock(text="Done.")], model="m"),
            ResultMessage(subtype="success", duration_ms=10, duration_api_ms=5, is_error=False, num_turns=1,
                          session_id=session, total_cost_usd=total, result="Done.",
                          usage={"input_tokens": 900, "output_tokens": 20, "cache_read_input_tokens": 40000})]


def test_each_turn_of_a_resumed_conversation_records_its_own_cost_even_across_a_restart(monkeypatch, tmp_path):
    # owner's screenshot, 2026-10-19: one chat's Haiku replies of ~48k tokens at 0.44, 0.50 … 0.56 USD — climbing,
    # because each was the conversation's running total; a 48k Haiku reply costs at most about 0.06 USD
    _sdk(monkeypatch, [_answer("s1", 0.30), _answer("s1", 0.34), _answer("s1", 0.37)])
    s = settings(str(tmp_path))
    st = State(s.state_path)
    asyncio.run(runner.run(s, "sys", "p", run_kit(), run_terms(who="Owner@1"), st, asked="one"))
    two = asyncio.run(runner.run(s, "sys", "p", run_kit(), run_terms(who="Owner@1"), st, resume="s1", asked="two"))
    assert two.cost_usd == 0.04
    st = State(s.state_path)                       # the agent restarted: the conversation goes on, its total too
    # … continued by someone else in the chat (a Continue another person pressed): the conversation is what counts
    asyncio.run(runner.run(s, "sys", "p", run_kit(), run_terms(who="Ann@1"), st, resume="s1", asked="three"))
    c = status.costs(st)
    assert [(r["asked"], r["cost"]) for r in c["runs"]] == [("three", 0.03), ("two", 0.04), ("one", 0.3)]
    assert c["period"] == 0.37                      # the Costs tab adds up the runs: the conversation's real total


def test_an_older_conversation_resumed_once_does_not_count_its_history_again(monkeypatch, tmp_path):
    # a run recorded before 0.6.260 kept the CLI's running total as its cost, and no session: it is the base
    s = settings(str(tmp_path))
    st = State(s.state_path)
    st.log(agent_records.RUN, {"who": "Owner@1", "cost_usd": 0.50, "tokens": {"input_tokens": 9, "output_tokens": 9}})
    st.log(agent_records.RUN, {"who": "Other@2", "cost_usd": 0.90, "tokens": {"input_tokens": 9, "output_tokens": 9}})
    _sdk(monkeypatch, [_answer("old", 0.56), _answer("fresh", 0.20)])
    asyncio.run(runner.run(s, "sys", "p", run_kit(), run_terms(who="Owner@1"), st, resume="old", asked="again"))
    # the CLI found no cost to restore: its total is below what the conversation had cost — all of it is this run's
    asyncio.run(runner.run(s, "sys", "p", run_kit(), run_terms(who="Owner@1"), st, resume="old", asked="anew"))
    got = {r["asked"]: r["cost"] for r in status.costs(st)["runs"] if r["asked"]}
    assert got == {"again": 0.06, "anew": 0.2}


def test_a_run_without_a_resume_and_the_rules_of_the_base():
    rows = [{"who": "A@1", "session": "s2", "session_total_usd": 0.4}, {"who": "A@1", "session": "s1", "session_total_usd": 0.2}]
    assert agent_records.session_before(rows, "s1", "A@1") == 0.2
    assert agent_records.session_before(rows, None, "A@1") == 0.0
    assert agent_records.session_before(rows, "s9", "A@1") == 0.0      # the chat's runs carry other sessions: none known
    assert agent_records.turn_cost(0.5, 0.2) == 0.3 and agent_records.turn_cost(0.1, 0.2) == 0.1


def test_a_run_records_the_skills_it_used_in_order_once_each(monkeypatch, tmp_path):
    from claude_agent_sdk import ToolUseBlock
    blocks = [ToolUseBlock(id="1", name="mcp__vesta__read_skill", input={"skill": "reports"}),
              ToolUseBlock(id="2", name="mcp__vesta__run_skill_script", input={"skill": "investigate", "script": "investigate.py"}),
              ToolUseBlock(id="3", name="mcp__vesta__read_skill", input={"skill": "reports"}),
              ToolUseBlock(id="4", name="mcp__vesta__ha_get_state", input={"entity_id": "x"})]
    _sdk(monkeypatch, [_answer("s1", 0.1, blocks), _answer("s2", 0.1, blocks)])
    s = settings(str(tmp_path))
    st = State(s.state_path)
    asyncio.run(runner.run(s, "sys", "p", run_kit(), run_terms(who="Owner@1"), st, asked="chat"))
    from vesta_agent.turn import Terms
    job = Terms(frozenset(), "auto", 1.0, agent_records.for_job("fm-weekly"), "maintenance")   # the job's own skill first
    asyncio.run(runner.run(s, "sys", "p", run_kit(), job, st))
    got = {r["job"]: r["skills"] for r in status.costs(st)["runs"]}
    assert got == {"Chat replies": ["reports", "investigate"], "fm-weekly": ["maintenance", "reports", "investigate"]}
