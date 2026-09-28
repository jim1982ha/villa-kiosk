"""Runs a child process under the host's restart policy (SPEC 10).

⚠️ THE POLICY LIVES HERE, NOT IN s6. s6-supervise restarts a dead longrun
after one second, forever, and has no notion of "five crashes in ten minutes".
So the s6 services never exit on their own: each runs this loop, which
restarts its child after 5 s doubling to 5 min and — for the agent — gives up
after 5 crashes within 10 min while the container keeps running (heartbeats
stop, so the VESTA Kiosk shows the agent offline).

⚠️ EVERY OUTPUT LINE IS REDACTED before it reaches the log (SPEC 12): the
child's stdout and stderr are read here, never inherited.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable

from .log import log
from .redact import Redactor

BACKOFF_START = 5
BACKOFF_MAX = 300
CRASH_LIMIT = 5
CRASH_WINDOW = 600
#: A run this long resets the backoff: the next crash is a new problem, not
#: the same one repeating.
STABLE_AFTER = 600


def run_once(cmd: list[str], cwd: Path | str, env: dict[str, str], prefix: str,
             grace: int, stop: threading.Event, redactor: Redactor) -> int | None:
    """One run. Returns the exit code, or None if it ended because of `stop`."""
    # Own session, so a stop reaches the child's whole process group, not only
    # the shell that launched it.
    proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, start_new_session=True,
                            text=True, errors="replace", bufsize=1)

    def pump() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            print(redactor(f"[{prefix}] {line.rstrip()}"), flush=True)

    reader = threading.Thread(target=pump, daemon=True)
    reader.start()
    while proc.poll() is None and not stop.wait(0.2):
        pass
    stopped = proc.poll() is None
    if stopped:
        log("info", f"stopping {prefix} (grace {grace} s)")
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            log("warning", f"{prefix} still running after {grace} s — killing it")
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
    reader.join(timeout=2)
    if stopped or stop.is_set():
        log("info", f"{prefix} stopped cleanly" if proc.returncode in
            (0, -signal.SIGTERM, 128 + signal.SIGTERM) else
            f"{prefix} stopped (exit {proc.returncode})")
        return None
    return proc.returncode


class CrashLog:
    """Crash times, persisted in /data/host for diagnosis. Reset at each host
    start: restarting the app is a person's deliberate retry."""

    def __init__(self, path: Path | None) -> None:
        self.path, self.times = path, []
        self._save()

    def add(self, now: float, code: int) -> int:
        self.times = [t for t in self.times if now - t < CRASH_WINDOW] + [now]
        self._save(last_exit=code)
        return len(self.times)

    def _save(self, **extra: object) -> None:
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({
            "crashes_in_window": len(self.times), "window_seconds": CRASH_WINDOW,
            "limit": CRASH_LIMIT, "times": [time.strftime("%Y-%m-%dT%H:%M:%S%z",
                                                          time.localtime(t)) for t in self.times],
            **extra}, indent=2))


def keep_running(start: Callable[[], int | None], name: str, stop: threading.Event,
                 crash_log: CrashLog | None = None) -> None:
    """Restart `start` after each unexpected exit until `stop` — or, with a
    crash log, until CRASH_LIMIT crashes within CRASH_WINDOW."""
    delay = BACKOFF_START
    while not stop.is_set():
        began = time.monotonic()
        code = start()
        if code is None or stop.is_set():
            return
        if time.monotonic() - began >= STABLE_AFTER:
            delay = BACKOFF_START
        if crash_log is not None:
            n = crash_log.add(time.time(), code)
            if n >= CRASH_LIMIT:
                log("error", f"{name} crashed {n} times within {CRASH_WINDOW // 60} min — "
                             "not restarting it. The app keeps running; restart the app to try again.")
                stop.wait()
                return
            log("warning", f"{name} exited with code {code} (crash {n} of {CRASH_LIMIT} "
                           f"allowed in {CRASH_WINDOW // 60} min) — restarting in {delay} s")
        else:
            log("warning", f"{name} exited with code {code} — restarting in {delay} s")
        if stop.wait(delay):
            return
        delay = min(delay * 2, BACKOFF_MAX)
