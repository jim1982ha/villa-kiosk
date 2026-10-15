#!/usr/bin/env python3
"""tools/mutate.py, driven for real on a throwaway file: it says RED or STILL GREEN, refuses a mutation that matches
nothing, and the file is back as it was however the run ends — finished, interrupted (SIGTERM), or killed outright
(SIGKILL: its breadcrumb refuses the next run until --restore).

Run: agent-host/.venv/bin/python agent-host/tests/test_mutate.py   (also one of `release.py gates`)
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent          # agent-host
TOOL = [sys.executable, str(HERE / "tools" / "mutate.py")]
CRUMB = HERE / ".mutate-breadcrumb.json"
FAIL = 0


def ck(name: str, ok: bool, detail: object = "") -> None:
    global FAIL
    print(f"    {'PASS' if ok else 'FAIL'}  {name}{'' if ok else f'  →  {detail}'}")
    FAIL += not ok


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([*TOOL, *args], capture_output=True, text=True)


if CRUMB.exists():
    print(f"❌ {CRUMB} exists: a real mutation run is in progress or was killed — run tools/mutate.py --restore")
    sys.exit(1)
with tempfile.TemporaryDirectory() as t:
    f = Path(t) / "a.py"
    f.write_text("x = 1\n")
    check = [sys.executable, "-c", f"import runpy, sys; sys.exit(runpy.run_path({str(f)!r})['x'] != 1)"]
    r = run(str(f), "x = 1", "x = 2", "--", *check)
    ck("a mutation the check catches: RED, exit 0, the file back", r.returncode == 0 and "RED" in r.stdout
       and f.read_text() == "x = 1\n", (r.returncode, r.stdout, f.read_text()))
    r = run(str(f), "x = 1", "x = 1 ", "--", *check)
    ck("a mutation the check misses: STILL GREEN, exit 1", r.returncode == 1 and "STILL GREEN" in r.stdout, r)
    # retro, 2026-10-15: a RED names what caught it; a pytest run that failed no test (its exit 2 to 5) is no RED
    named = [sys.executable, "-c", "print('FAILED tests/test_x.py::test_door - assert 1 == 2'); raise SystemExit(1)"]
    r = run(str(f), "x = 1", "x = 2", "--", *named)
    ck("a RED names the tests that failed", r.returncode == 0 and "FAILED tests/test_x.py::test_door" in r.stdout, r)
    for code in (2, 5):
        stopped = [sys.executable, "-c", f"raise SystemExit({code})", "pytest"]
        r = run(str(f), "x = 1", "x = 2", "--", *stopped)
        ck(f"  ...a pytest run that ended {code} without failing a test: CHECK BROKEN, exit 3",
           r.returncode == 3 and "CHECK BROKEN" in r.stdout and f.read_text() == "x = 1\n", r)
    r = run(str(f), "x = 1", "x = 2", "--", sys.executable, "-c", "raise SystemExit(2)")
    ck("  ...the same exit from another check is a RED (only pytest's own exits are read)", r.returncode == 0, r)
    r = run(str(f), "x = 9", "x = 2", "--", "true")
    ck("an old text that is not there: refused (exit 2), nothing written", r.returncode == 2 and "0 times" in r.stderr
       and f.read_text() == "x = 1\n", r)
    p = subprocess.Popen([*TOOL, str(f), "x = 1", "x = 2", "--", "sleep", "5"], stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True)
    for _ in range(50):
        if f.read_text() == "x = 2\n":
            break
        time.sleep(0.05)
    ck("  ...while the check runs, the file is the mutant and a breadcrumb names it",
       f.read_text() == "x = 2\n" and CRUMB.exists())
    p.send_signal(signal.SIGTERM)
    p.wait(10)
    ck("interrupted (SIGTERM): the file is back, the breadcrumb gone", f.read_text() == "x = 1\n" and not CRUMB.exists()
       and p.returncode == 130, (p.returncode, f.read_text()))
    p = subprocess.Popen([*TOOL, str(f), "x = 1", "x = 3", "--", "sleep", "5"])
    for _ in range(50):
        if f.read_text() == "x = 3\n":
            break
        time.sleep(0.05)
    os.kill(p.pid, signal.SIGKILL)
    p.wait(10)
    r = run(str(f), "x = 3", "x = 4", "--", "true")
    ck("killed outright (SIGKILL): the next run is refused while the mutant is there",
       r.returncode == 2 and "--restore" in r.stderr and f.read_text() == "x = 3\n", (r, f.read_text()))
    r = run("--restore")
    ck("  ...and --restore puts it back", r.returncode == 0 and f.read_text() == "x = 1\n" and not CRUMB.exists(), r)

print(f"\n{'❌ ' + str(FAIL) + ' failed' if FAIL else '✅ a mutation run always gives the file back'}")
sys.exit(1 if FAIL else 0)
