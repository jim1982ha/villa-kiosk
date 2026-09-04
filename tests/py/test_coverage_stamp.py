"""The observation cycle must stamp its writes, or coverage lies forever.

⚠️ THIS SHIPPED AS A FALSE ALARM ON THE OWNER'S PHONE. On 2026-08-25 at 19:03
the agent escalated "Coverage incomplete", investigated it, raised a concern and
delivered it: "Observation coverage gap this period — extent unknown". The villa
had been observing perfectly. `run_forever` called `run_once(session)` with no
`now_iso`, so `append` wrote `online_since: "" or ""` on every cycle since the
loop was written, and `coverage` computes `complete = bool(online_since)`.

The journal had therefore NEVER reported complete coverage on any villa, and the
Villa Document printed "part of this window was not observed" above every delta.
`coverage`'s own docstring records fixing that exact sentence once before, for a
different cause, calling it "an instrument lying about the thing it exists to
measure". This is the second cause.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import re
import sys
from typing import Any

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.supervise.agent import sources
from vesta.supervise.observe import cycle
from vesta.supervise.observe import journal


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(journal, "JOURNAL_FILE",
                        str(tmp_path / "vesta" / "journal.json"))
    cycle._LAST.clear()


def test_a_stamped_append_makes_coverage_COMPLETE() -> None:
    """The property that was false for the life of the subsystem."""
    journal.append([{"event_type": "state_changed", "time_fired": "t",
                     "data": {"entity_id": "light.a", "old_state": None,
                              "new_state": {"state": "on", "attributes": {}}}}],
                   now_iso="2026-08-25T10:00:00+00:00")
    cov = journal.coverage("")
    assert cov["online_since"] == "2026-08-25T10:00:00+00:00"
    assert cov["complete"] is True


def test_an_UNSTAMPED_append_is_what_produced_the_false_alarm() -> None:
    """⚠️ PINNED AS THE DEFECT, not merely fixed. An empty stamp leaves
    `online_since` empty, and `complete` is `bool(online_since)`."""
    journal.append([{"event_type": "state_changed", "time_fired": "t",
                     "data": {"entity_id": "light.a", "old_state": None,
                              "new_state": {"state": "on", "attributes": {}}}}],
                   now_iso="")
    cov = journal.coverage("")
    assert cov["online_since"] == ""
    assert cov["complete"] is False, (
        "if this ever passes, an unstamped journal has started claiming "
        "coverage it cannot demonstrate — the opposite failure")


def test_the_LOOP_passes_a_stamp_and_it_is_UTC() -> None:
    """⚠️ PIN THE CALLER. `run_once` has always accepted `now_iso`; nothing
    passed one. And the format is load-bearing: `sources._since_iso` builds the
    window as `%Y-%m-%dT%H:%M:%S+00:00` and calls `journal.coverage` with no
    normaliser, so the two are compared as RAW STRINGS. A local-offset stamp
    would swap a permanent false alarm for an intermittent one."""
    src = inspect.getsource(cycle.run_forever)
    assert "run_once(session, now_iso=now_iso)" in src, (
        "the loop still calls run_once without a stamp")
    assert '"%Y-%m-%dT%H:%M:%S+00:00"' in src, "the stamp is not explicit UTC"
    assert "time.gmtime()" in src, "the stamp is not built from UTC"
    # ⚠️ THE FORMAT LIVES IN `_since_iso` SINCE 2026-09-04 — the one derivation
    # `_coverage` and `_recent_firings` both call — so that is where it is
    # read; a pin on `_coverage` would pass on a copy that had quietly changed.
    doc = inspect.getsource(sources._since_iso)
    assert '"%Y-%m-%dT%H:%M:%S+00:00"' in doc, (
        "the reader's window format moved; the writer must follow it")


def test_end_to_end_a_running_cycle_reports_complete(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """The whole point, through the real entry point."""
    from test_observe_cycle import _FakeHass, _state
    fake = _FakeHass([_state("light.a", "on")])
    monkeypatch.setattr(cycle, "HassClient", lambda _s: fake)
    loop = asyncio.new_event_loop()
    loop.run_until_complete(
        cycle.run_once(None, now_iso="2026-08-25T10:00:00+00:00"))
    assert journal.coverage("")["complete"] is True


# ── a tool that cannot answer is not published ─────────────────────────────

def test_an_unwired_tool_is_withheld_rather_than_left_to_refuse() -> None:
    """⚠️ THE SECOND HALF OF THE SAME PHONE MESSAGE. `read_logs` is built with
    no source, so it refused, and the agent told the owner "log access is also
    down" — a fault on the property, which it was not. Publishing a schema that
    can never answer also spends prefix tokens in the tier where schemas are
    already 84% of the bill."""
    src = inspect.getsource(sources)
    assert 'getattr(tool, "_source", None) is None' in src, (
        "source-less tools are published again")
    assert "_warn_unwired" in src, (
        "the gap is silent now — it must be loud to the OPERATOR instead")


def test_the_operator_warning_fires_once_not_per_run() -> None:
    sources._UNWIRED_SEEN.clear()
    seen = []
    import vesta.adapters.log as log_mod
    orig = log_mod.warn
    try:
        sources.warn = lambda m: seen.append(m)   # type: ignore[attr-defined]
        sources._warn_unwired("ReadLogs")
        sources._warn_unwired("ReadLogs")
    finally:
        sources.warn = orig                        # type: ignore[attr-defined]
    assert len(seen) == 1, "an eight-times-an-hour warning trains a reader to skip it"
    assert "NOT published" in seen[0]


def test_read_logs_still_refuses_when_constructed_without_a_source() -> None:
    """The tool's own guard stays — withholding it is belt AND braces, and a
    test that only checked the registry would pass with the guard deleted."""
    from vesta.supervise.agent.tools import logs as log_tools
    out = asyncio.new_event_loop().run_until_complete(
        log_tools.ReadLogs().run({}))
    assert "not connected to the villa's logs" in str(out)
