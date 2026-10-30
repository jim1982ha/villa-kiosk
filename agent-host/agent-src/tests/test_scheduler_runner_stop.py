"""The schedule read from the skills, Claude's own web search switched by the
settings, and a clean stop on SIGTERM (the host gives 20 s)."""
from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

import yaml

from helpers import PYTHONPATH, ROOT, copy_skill, settings
from vesta_agent import runner
from vesta_agent.scheduler import Scheduler
from vesta_agent.skills import Skills
from vesta_agent.state import State


def at(h, m, day=1, weekday_fix=None):
    return datetime(2026, 10, day, h, m, tzinfo=timezone.utc)      # 1 Oct 2026 is a Thursday


def test_a_slot_is_due_inside_its_window():
    from vesta_shared.when import Spec

    def due(spec, now):
        return Spec.parse(spec).due(now, timedelta(minutes=30))
    assert due("07:00", at(7, 10)) == at(7, 0)
    assert due("07:00", at(6, 59)) is None
    assert due("07:00", at(7, 31)) is None                        # outside the 30-min window
    assert due("1 08:00", at(8, 5, day=1)) == at(8, 0, day=1)
    assert due("1 08:00", at(8, 5, day=2)) is None
    assert due("Mon 08:00", at(8, 5, day=5)) == at(8, 0, day=5)   # 5 Oct 2026 is a Monday
    assert due("Mon 08:00", at(8, 5, day=6)) is None


def test_a_job_just_before_midnight_still_runs_after_it(tmp_path, monkeypatch):
    """A 23:45 job the agent was stopped for runs at 00:05 the next day: its 30-minute window still holds it
    (architecture review, round 9: the slot was looked for on the new day's date and the job was lost)."""
    s = settings(str(tmp_path))
    limits = tmp_path / "limits.yaml"
    limits.write_text("pack.rebuild_at: '23:45'\n")
    monkeypatch.setenv("VESTA_LIMITS", str(limits))
    packs = []

    async def nothing(*a):
        return None

    async def rebuild():
        packs.append(1)
    sch = Scheduler(s, Skills(s.skills_dir), State(s.state_path), nothing, nothing, rebuild)

    async def go():
        await sch.tick(at(0, 5, day=2))
        await sch.idle()
        assert packs == [1]
        await sch.tick(at(0, 10, day=2))                               # the same slot: once
        await sch.idle()
        assert packs == [1]
    asyncio.run(go())


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
    from helpers import run_kit, run_terms
    opts, _ = runner.build_options(S(), "p", run_kit(allowed, {"type": "sdk"}), run_terms(who="t"), State(":memory:"), None)
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


def test_two_jobs_of_a_skill_at_the_same_time_both_run_and_housekeeping_never_holds_the_tick(tmp_path):
    # architecture review, 2026-10-07: the slot was claimed as skill:i:when and started as skill:when — the second
    # job at the same time was refused as "still running" and lost; the engine's housekeeping ran inside the tick
    from helpers import make_skill
    s = settings(str(tmp_path))
    make_skill(s.skills_dir, "twins", {"description": "t", "scripts": {"a.py": {}}, "schedule": [
        {"when": "07:00", "run": "a.py"}, {"when": "07:00", "run": "a.py"}]}, {"a.py": "print('{}')\n"})
    ran, slow = [], asyncio.Event()

    async def run_code(skill, command, timeout):
        ran.append(command)
        await asyncio.sleep(0.05)

    async def nothing(*a):
        pass

    async def housekeeping():
        await slow.wait()                                   # HA MCP not answering

    sch = Scheduler(s, Skills(s.skills_dir), State(s.state_path), run_code, nothing, nothing, housekeeping)

    async def go():
        await asyncio.wait_for(sch.tick(at(7, 1)), 1)     # returns at once though housekeeping waits
        await asyncio.sleep(0.2)
        slow.set()
        await sch.idle()
    asyncio.run(go())
    assert ran == ["a.py", "a.py"]


def test_a_run_cut_by_a_stop_shows_cut_on_the_overview(tmp_path):
    # architecture review scan 4 (2026-10-19): "Scheduled jobs run" said "run at 07:00" of a run a stop had cut
    from helpers import make_skill
    from vesta_agent import status
    s = settings(str(tmp_path))
    make_skill(s.skills_dir, "rep", {"description": "t", "schedule": [{"when": "07:00", "name": "rep-daily", "prompt": "x", "to": "fm"}]})
    st = State(s.state_path)
    hold = asyncio.Event()

    async def run_model(skill, job):
        await hold.wait()

    async def nothing(*a):
        pass

    sch = Scheduler(s, Skills(s.skills_dir), st, nothing, run_model, nothing)

    def rows():
        return [(r["job"], r["outcome"], r["words"]) for r in status.report(st, s.store_path, 24, now=at(7, 2))["scheduled_jobs"]]

    async def go():
        await sch.tick(at(7, 1))
        await asyncio.sleep(0)
        assert rows() == [("rep:rep-daily@07:00", "running", "running")]              # claimed, still running
        for t in sch._running.values():
            t.cancel()
        await asyncio.gather(*sch._running.values(), return_exceptions=True)
    asyncio.run(go())
    assert rows() == [("rep:rep-daily@07:00", "cut", "stopped by a restart")]


def test_the_villas_device_list_refresh_says_done_like_every_job(tmp_path):
    # owner, 2026-10-20: Scheduled jobs run read "knowledge pack · run" beside "nightly.py · done" — a word nobody knew,
    # and no end recorded. Its name is the villa's device list, and its run ends like every scheduled job's.
    from vesta_agent import status
    from vesta_agent.scheduler import job_label
    s = settings(str(tmp_path))
    state = State(s.state_path)

    async def nothing(*a):
        return None
    sch = Scheduler(s, Skills(s.skills_dir), state, nothing, nothing, nothing)

    async def go():
        await sch.tick(at(1, 35))
        await sch.idle()
    asyncio.run(go())
    rows = {r["job"]: r for r in status.jobs_run(state, at(0, 0) - timedelta(days=1),
                                                  lambda j: job_label(j, Skills(s.skills_dir)))}
    assert rows["engine:pack"]["words"] == "done" and rows["engine:pack"]["label"] == "Villa's device list (refreshed)"


def test_a_job_time_moved_on_the_limits_tab_after_it_ran_does_not_run_it_again_that_day(tmp_path):
    """review J, 0.12.341: the morning report ran at 07:00; moved to 07:15 at 07:20, it ran a second time at 07:21 —
    "already ran today" was filed under the old time. It runs once that day, and at its new time the next."""
    from aiohttp.test_utils import TestClient, TestServer
    from vesta_agent.ui.server import UI
    s = settings(str(tmp_path))
    copy_skill("reports", s.skills_dir)
    model = []

    async def run_code(skill, command, timeout):
        pass

    async def run_model(skill, job):
        model.append(job["when"])

    async def nothing():
        pass

    sch = Scheduler(s, Skills(s.skills_dir), State(s.state_path), run_code, run_model, nothing)

    async def go():
        await sch.tick(at(7, 1))
        await sch.idle()
        async with TestClient(TestServer(UI(s, "standalone").app())) as c:
            r = await c.put("/api/limits", json={"id": {"src": "skill", "skill": "reports", "file": "skill.yaml",
                                                         "path": ["schedule", 0, "when"]}, "value": "07:15"},
                            headers={"X-Vesta-UI": "1"})
            assert r.status == 200, await r.text()
        await sch.tick(at(7, 21))
        await sch.idle()
        await sch.tick(at(7, 16, day=2))
        await sch.idle()
    asyncio.run(go())
    assert model == ["07:00", "07:15"]


def test_the_frequent_checks_run_at_the_rhythm_set_on_the_limits_tab(tmp_path, monkeypatch):
    # owner, 2026-10-24: "every 5 minutes" could not be changed — it is jobs.every_minutes, read at every tick
    p = tmp_path / "limits.yaml"
    p.write_text("jobs.every_minutes: 10\n")
    monkeypatch.setenv("VESTA_LIMITS", str(p))
    s = settings(str(tmp_path))
    copy_skill("alert-desk", s.skills_dir)
    ran = []

    async def run_code(skill, command, timeout):
        ran.append(command)

    async def nothing(*a):
        pass

    sch = Scheduler(s, Skills(s.skills_dir), State(s.state_path), run_code, nothing, nothing)

    async def go():
        for m in (0, 5, 10):
            await sch.tick(at(9, m))
            await sch.idle()
    asyncio.run(go())
    assert ran == ["desk.py tick", "desk.py tick"]                      # at 09:00 and 09:10, never at 09:05
    from vesta_agent.scheduler import every
    assert every() == timedelta(minutes=10)


def test_deleting_a_job_never_takes_another_jobs_day_and_a_moved_entry_never_runs_twice(tmp_path):
    # review K, 0.12.345: "ran today" went by the entry's place: the daily job deleted at 07:30, the weekly one, now
    # first in the list, read the daily's day and did not run at 08:00
    s = settings(str(tmp_path))
    folder = os.path.join(s.skills_dir, "jobs")
    os.makedirs(os.path.join(folder, "scripts"))
    for n in ("daily.py", "weekly.py", "early.py"):
        open(os.path.join(folder, "scripts", n), "w").write("print('{}')\n")
    open(os.path.join(folder, "SKILL.md"), "w").write("---\nname: jobs\ndescription: two jobs\n---\nJobs.\n")

    def write(entries):
        with open(os.path.join(folder, "skill.yaml"), "w") as f:
            yaml.safe_dump({"schedule": [{"when": w, "run": r} for w, r in entries]}, f)
    write([("07:00", "daily.py"), ("Mon 08:00", "weekly.py")])
    code = []

    async def run_code(skill, command, timeout):
        code.append(command)

    async def nothing(*a):
        pass
    sch = Scheduler(s, Skills(s.skills_dir), State(s.state_path), run_code, nothing, nothing)

    async def go():
        await sch.tick(at(7, 1, day=5))                                # Monday 07:01: the daily job
        await sch.idle()
        write([("Mon 08:00", "weekly.py")])                            # the daily job deleted: the weekly is entry 0
        await sch.tick(at(8, 1, day=5))
        await sch.idle()
        write([("06:45", "early.py"), ("Mon 08:00", "weekly.py")])     # one inserted above: the weekly is entry 1
        await sch.tick(at(8, 5, day=5))
        await sch.idle()
    asyncio.run(go())
    assert code == ["daily.py", "weekly.py"]
