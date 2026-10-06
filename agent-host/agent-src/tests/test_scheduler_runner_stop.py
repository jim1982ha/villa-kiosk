"""The schedule read from the skills, Claude's own web search switched by the
settings, and a clean stop on SIGTERM (the host gives 20 s)."""
from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone

import yaml

from helpers import PYTHONPATH, ROOT, copy_skill, settings
from vesta_agent import runner
from vesta_agent.scheduler import Scheduler, slot_for
from vesta_agent.skills import Skills
from vesta_agent.state import State


def at(h, m, day=1, weekday_fix=None):
    return datetime(2026, 10, day, h, m, tzinfo=timezone.utc)      # 1 Oct 2026 is a Thursday


def test_slot_for():
    assert slot_for("07:00", at(7, 10)) == at(7, 0)
    assert slot_for("07:00", at(6, 59)) is None
    assert slot_for("07:00", at(7, 31)) is None                   # outside the 30-min window
    assert slot_for("1 08:00", at(8, 5, day=1)) == at(8, 0, day=1)
    assert slot_for("1 08:00", at(8, 5, day=2)) is None
    assert slot_for("Mon 08:00", at(8, 5, day=5)) == at(8, 0, day=5)   # 5 Oct 2026 is a Monday
    assert slot_for("Mon 08:00", at(8, 5, day=6)) is None


def test_the_schedule_comes_from_the_skills_and_runs_once_per_slot(tmp_path):
    s = settings(str(tmp_path))
    copy_skill("preventive-maintenance", s.skills_dir)
    copy_skill("reports", s.skills_dir)
    copy_skill("alert-desk", s.skills_dir)
    code, model, packs = [], [], []

    async def run_code(skill, command, timeout):
        code.append((skill.name, command))

    async def run_model(skill, job):
        model.append(f"{skill.name}:{job['when']}")

    async def rebuild():
        packs.append(1)

    sch = Scheduler(s, Skills(s.skills_dir), State(s.state_path), run_code, run_model, rebuild)

    async def go():
        await sch.tick(at(1, 35))
        await sch.idle()
        assert packs == [1]                                              # the engine's own 01:30 job
        await sch.tick(at(2, 1))
        await sch.idle()
        assert ("preventive-maintenance", "nightly.py --out nightly.json") in code
        assert ("alert-desk", "desk.py tick") in code
        n = len(code)
        await sch.tick(at(2, 2))                                         # same slot: not again
        await sch.idle()
        assert [c for c in code[n:] if c[0] == "preventive-maintenance"] == []
        await sch.tick(at(7, 3))
        await sch.idle()
        assert model == ["reports:07:00"]
        import shutil
        shutil.rmtree(os.path.join(s.skills_dir, "reports"))            # a deleted skill's schedule stops
        await sch.tick(at(7, 4, day=2))
        await sch.idle()
        assert model == ["reports:07:00"]
    asyncio.run(go())


def _options(allowed):
    class S:
        work_dir = "/tmp"
        claude_dir = "/tmp/claude"
        anthropic_api_key = "k"
        model = "sonnet"
        effort = "medium"
    opts, _ = runner.build_options(S(), "p", {"type": "sdk"}, allowed, State(":memory:"), "t", None, 1.0)
    return opts


def test_web_search_is_claudes_own_tool_and_only_when_allowed():
    on = _options({"mcp__vesta__read_skill", runner.WEB_SEARCH})
    assert on.tools == ["WebSearch"] and "WebSearch" not in on.disallowed_tools
    for other in ("Bash", "Read", "Write", "WebFetch", "Task"):
        assert other in on.disallowed_tools
    off = _options({"mcp__vesta__read_skill"})
    assert off.tools == [] and "WebSearch" in off.disallowed_tools


def _env(tmp, **extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith("VESTA_") and k != "ANTHROPIC_API_KEY"}
    env.update({"PYTHONPATH": PYTHONPATH, "VESTA_SKILLS_DIR": os.path.join(tmp, "skills"),
                "VESTA_AGENT_CONFIG_DIR": os.path.join(tmp, "agent"), "VESTA_DATA_DIR": os.path.join(tmp, "data"),
                "VESTA_TELEGRAM_ENABLED": "false", "TZ": "UTC"})
    env.update(extra)
    return env


def _stop_time(env, ready: str, limit: float = 20):
    """Start the agent, wait until it prints `ready` (at most `limit` s), SIGTERM it, and time the stop.

    It waited a fixed 3 or 6 s instead (2026-10-05: 9 s of the suite's 45); the agent says when it is up."""
    import threading
    p = subprocess.Popen([sys.executable, "-u", "-m", "vesta_agent"], cwd=ROOT, env={**env, "PYTHONUNBUFFERED": "1"},
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    lines, up = [], threading.Event()

    def read():
        for line in p.stdout:
            lines.append(line)
            if ready in line:
                up.set()
    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    up.wait(limit)
    t0 = time.monotonic()
    p.send_signal(signal.SIGTERM)
    p.wait(timeout=30)
    took = time.monotonic() - t0
    reader.join(5)
    return p.returncode, took, "".join(lines)


def test_sigterm_while_waiting_for_settings(tmp_path):
    code, took, out = _stop_time(_env(str(tmp_path)), "is waiting")
    assert "is waiting" in out and code == 0 and took < 5, out


def test_sigterm_while_running_stops_within_the_grace(tmp_path):
    env = _env(str(tmp_path), ANTHROPIC_API_KEY="sk-ant-TEST-000000000000",
               VESTA_HA_MCP_URL="http://127.0.0.1:9/mcp", VESTA_HA_URL="http://127.0.0.1:9",
               VESTA_HA_TOKEN="ha-TEST-000000000000")
    code, took, out = _stop_time(env, "Home Assistant events")     # its loops are running
    assert "Stopped" in out and code == 0 and took < 20, out
    assert "ha-TEST-000000000000" not in out and "sk-ant-TEST" not in out


def test_a_long_job_never_holds_the_alert_chase(tmp_path):
    # round 3 (0.12.38): the tick awaited each job, so the 02:00 nightly check (30 min allowed) stopped the
    # alert chase — every_5_min did not run until it finished
    s = settings(str(tmp_path))
    copy_skill("preventive-maintenance", s.skills_dir)
    copy_skill("alert-desk", s.skills_dir)
    chase, nightly_done = [], asyncio.Event()

    async def run_code(skill, command, timeout):
        if skill.name == "preventive-maintenance":
            await nightly_done.wait()                    # the nightly check takes its time
        else:
            chase.append(command)

    async def nothing(*a):
        return None

    sch = Scheduler(s, Skills(s.skills_dir), State(s.state_path), run_code, nothing, nothing)

    async def go():
        await asyncio.wait_for(sch.tick(at(2, 1)), 1)     # the tick returns at once, the check still running
        await asyncio.sleep(0)
        n = len(chase)
        await asyncio.wait_for(sch.tick(at(2, 7)), 1)     # five minutes on: the chase runs again
        await asyncio.sleep(0)
        assert len(chase) == n + 1
        started = await sch.tick(at(2, 13))
        assert "preventive-maintenance:02:00" not in started          # still running: never twice
        nightly_done.set()
        await sch.idle()
    asyncio.run(go())
