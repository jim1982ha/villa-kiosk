"""CI's `mypy --strict rootfs/usr/bin/reports` step, runnable before the push.

⚠️ THE INSTANCE THIS PAYS FOR (2026-08-27): 2.755.0's sweep deleted the
module-level `_CONCERNS_SOURCE: Optional[Any] = None` binding and left the
`global` writer and two readers — a NameError waiting on exactly the state
("agent off, source never set") whose docstring promises it is not an error.
pyflakes cannot see it (`global X` counts as a definition), so it sat from
2.755.0 until the first day the CI suite ran far enough to reach the mypy
step. Locally, NOTHING ran mypy: the ship gate is tsc + build + pytest, so a
strict-mode break was always discovered after the push, on the runner, behind
whatever else was red. This makes the same command a pytest test, so the
gate that runs before every commit includes it.

⚠️ IT RUNS THE COMMAND CI RUNS, NOT A REIMPLEMENTATION — same target, same
flag — so the two cannot drift. Skips loudly when mypy is not installed;
CI installs it always, so the skip only ever narrows the LOCAL gate, and the
reason says so rather than letting silence read as coverage.
"""

from __future__ import annotations

import os
import subprocess
import sys

import pytest

pytest.importorskip(
    "mypy", reason="mypy is not installed here — CI still runs this exact "
    "check; install mypy in the venv to run it before the push")

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TARGET = os.path.join("rootfs", "usr", "bin", "vesta")


def test_reports_package_is_strict_clean() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "mypy", "--strict", TARGET],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, (
        "mypy --strict on reports/ fails — CI's Types step will refuse this "
        "push:\n" + result.stdout)
    # ⚠️ VACUOUS-PASS GUARD: success prints a file count; zero checked files
    # means the target moved and the gate is asserting nothing.
    # ⚠️ " 0 source files", WITH THE SPACE. The bare substring matched inside
    # "40 source files" the day the package grew to that size, and the guard
    # against an empty target started failing a healthy run — the vacuous-pass
    # guard itself passing vacuously, inverted.
    assert "no issues found" in result.stdout and " 0 source files" not in (
        result.stdout), result.stdout
