"""A restart must not reset the triage cadence.

⚠️ MEASURED FROM A REAL BILL. `run_forever` is `while True: pass(); sleep()` —
the pass runs BEFORE the first sleep, and nothing recorded when the last one
ran, so every process start fired a full pass. On 2026-08-25, a day of add-on
updates, that turned a 360-minute cadence into TEN passes in twelve hours; four
escalated into eleven frontier-model investigations. The exported ledger for
that window is $4.21, of which $4.11 is investigations — an annualised rate
about five times what the cadence promises.
"""

from __future__ import annotations

import inspect
import os
import sys
from typing import Any

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from agent import scheduler  # noqa: E402


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(scheduler, "PASS_FILE", str(tmp_path / "clock.json"))


def test_a_restart_waits_out_the_rest_of_the_period() -> None:
    assert scheduler.due_in(360, now=1_000.0, last=1_000.0) == 360 * 60
    assert scheduler.due_in(360, now=1_000 + 300 * 60, last=1_000.0) == 60 * 60


def test_a_period_that_has_already_elapsed_runs_immediately() -> None:
    assert scheduler.due_in(360, now=1_000 + 400 * 60, last=1_000.0) == 0.0


def test_a_villa_that_has_NEVER_run_a_pass_goes_now() -> None:
    """⚠️ A FRESH INSTALL MUST NOT WAIT SIX HOURS TO PROVE IT WORKS. `last <= 0`
    is "never", which is a different answer from "just now" and the only reason
    an epoch of 0 is safe to store."""
    assert scheduler.due_in(360, now=1_000.0, last=0.0) == 0.0


def test_a_BACKWARDS_clock_cannot_silence_supervision() -> None:
    """⚠️ THE CASE THAT ACTUALLY HAPPENS: an NTP correction after a power cut,
    which is exactly when a villa restarts. Without the upper clamp a `last` in
    the future computes a wait of days and nothing supervises until somebody
    notices — the failure this whole subsystem exists to prevent."""
    assert scheduler.due_in(360, now=1_000.0, last=99_999_999.0) == 360 * 60


def test_the_clock_survives_a_process_restart() -> None:
    scheduler._record_pass(5_000.0)
    assert scheduler._last_pass_at() == 5_000.0
    assert scheduler.due_in(360, now=5_000.0) == 360 * 60


def test_a_missing_or_corrupt_clock_reads_as_NEVER_not_as_now() -> None:
    """Degrading to "just ran" would silence a villa whose file was lost."""
    assert scheduler._last_pass_at() == 0.0
    with open(scheduler.PASS_FILE, "w", encoding="utf-8") as h:
        h.write("{not json")
    assert scheduler._last_pass_at() == 0.0


def test_the_LOOP_consults_the_clock_and_records_every_pass() -> None:
    """⚠️ PIN THE CALLER. `due_in` correct and uncalled is this repository's
    thirteen-times defect, and the arithmetic above would still pass."""
    src = inspect.getsource(scheduler.run_forever)
    assert "due_in(minutes)" in src, "the loop does not consult the clock"
    assert "_record_pass(" in src, "a pass is not recorded, so the next restart "\
                                   "sees no clock and fires immediately again"
    assert src.index("_record_pass(") < src.index("await _pass("), (
        "the pass must be recorded BEFORE it runs — a crash mid-pass would "
        "otherwise leave no record and every restart would retry it")
