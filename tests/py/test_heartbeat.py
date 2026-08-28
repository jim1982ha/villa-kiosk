"""The hourly observation heartbeat — an instrument for a days-long question.

⚠️ EVERY TEST HERE GUARDS A WAY THIS COULD LIE. `feedback_instruments-never-skip`
lists four counters in this project that read `0` for the exact case they were
built to measure, and this one is read DAYS after the fact by someone who cannot
re-run it — so a field that quietly means "not measured" while looking like a
real number is unrecoverable rather than merely wrong.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.supervise.observe import cycle
from vesta.supervise.observe import heartbeat
from vesta.supervise.observe import journal
from vesta.adapters import store


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(journal, "JOURNAL_FILE",
                        str(tmp_path / "vesta" / "journal.json"))
    monkeypatch.setattr(store, "OPTIONS_FILE", str(tmp_path / "options.json"))
    heartbeat._STATE.clear()


def _options(**values: Any) -> None:
    store.write_json(store.OPTIONS_FILE, dict(values))


def _fill(rows: List[Dict[str, Any]]) -> None:
    journal.append([{"event_type": "state_changed", "time_fired": r["at"],
                     "data": {"entity_id": r["id"], "old_state": None,
                              "new_state": {"state": r.get("s", "on"),
                                            "attributes": {}}}}
                    for r in rows], now_iso=rows[-1]["at"])


# ── the switch ──────────────────────────────────────────────────────────────

def test_it_is_OFF_unless_the_operator_turns_it_on() -> None:
    """⚠️ A diagnostic for a question currently open is not a permanent cost on
    every install. Absent options file, absent key and an explicit false must
    all mean off — the first is a fresh install and would otherwise ship every
    property an hourly line nobody asked for."""
    assert heartbeat.enabled() is False              # no options file at all
    _options(session_days=30)
    assert heartbeat.enabled() is False              # file, but no key
    _options(heartbeat_log=False)
    assert heartbeat.enabled() is False
    _options(heartbeat_log=True)
    assert heartbeat.enabled() is True


def test_the_switch_is_re_read_rather_than_captured_at_start() -> None:
    """⚠️ A RESTART IS THE EVENT THIS INSTRUMENT MEASURES, so requiring one to
    enable it would perturb the very measurement. Reading the option per call
    is what makes 'toggle it and wait an hour' true."""
    _options(heartbeat_log=False)
    assert heartbeat.maybe_log({}, now=0.0) is False
    _options(heartbeat_log=True)
    assert heartbeat.maybe_log({}, now=heartbeat.INTERVAL_SECONDS + 1) is True


def test_turning_it_on_emits_PROMPTLY_rather_than_at_a_stale_deadline() -> None:
    """The disabled path keeps the timer at 'now', so the first hour is counted
    from the moment it was switched on — not from a clock that ran while off."""
    _options(heartbeat_log=False)
    for tick in range(0, 10_000, 1_000):
        heartbeat.maybe_log({}, now=float(tick))
    _options(heartbeat_log=True)
    assert heartbeat.maybe_log({}, now=10_000.0) is False, "not an hour yet"
    assert heartbeat.maybe_log(
        {}, now=10_000.0 + heartbeat.INTERVAL_SECONDS) is True


def test_it_fires_at_most_once_an_hour() -> None:
    _options(heartbeat_log=True)
    assert heartbeat.maybe_log({}, now=0.0) is True
    assert heartbeat.maybe_log({}, now=60.0) is False
    assert heartbeat.maybe_log({}, now=heartbeat.INTERVAL_SECONDS - 1) is False
    # The boundary FIRES: "at most once an hour" means once a full hour has
    # elapsed, not strictly more than one. Pinned because the cycle wakes on a
    # 15-minute cadence, so the sample landing exactly on the hour is the
    # ordinary case here rather than a corner one.
    assert heartbeat.maybe_log({}, now=heartbeat.INTERVAL_SECONDS) is True


# ── the arithmetic ──────────────────────────────────────────────────────────

def test_the_RATE_comes_from_the_ring_not_from_the_cadence() -> None:
    """⚠️ A rate derived from 'cadence x mean rows' restates the cycle counters
    and would agree with them however wrong both were. Entries-over-span is the
    villa's own answer, and it is the number that decides whether the 20,000
    bound is two days here or two weeks."""
    _fill([{"id": "light.a", "at": "2026-08-20T00:00:00+00:00"},
           {"id": "light.b", "at": "2026-08-22T00:00:00+00:00"}])
    snap = heartbeat.snapshot({"cycles": 99, "rows": 99_999})
    assert snap["span_days"] == pytest.approx(2.0)
    assert snap["rows_per_day"] == pytest.approx(1.0)   # 2 rows over 2 days


def test_an_unmeasurable_span_reads_as_UNKNOWN_never_as_zero() -> None:
    """⚠️ THE FIELD THAT WOULD LIE BEST. A single-row journal has no span; a
    zero there reads as 'the villa changes nothing', which is the opposite of
    'I have not got two samples yet' and is exactly the confusion that makes a
    counter worse than no counter."""
    _fill([{"id": "light.a", "at": "2026-08-20T00:00:00+00:00"}])
    snap = heartbeat.snapshot({})
    assert snap["span_days"] is None and snap["rows_per_day"] is None
    assert "span ?" in heartbeat.report(snap)[0]
    assert "rate ?" in heartbeat.report(snap)[0]


def test_a_MALFORMED_stamp_does_not_manufacture_a_span() -> None:
    _fill([{"id": "light.a", "at": "not-a-date"},
           {"id": "light.b", "at": "also-not-a-date"}])
    assert heartbeat.snapshot({})["span_days"] is None


def test_the_TALKERS_are_ranked_and_their_share_is_stated() -> None:
    """⚠️ THE FIELD THAT SEPARATES TWO DIFFERENT FIXES. 'Raise the bound' and
    'stop journalling that sensor' present with the identical symptom, and only
    the distribution tells them apart."""
    _fill([{"id": "sensor.loud", "at": f"2026-08-2{d}T00:00:00+00:00"}
           for d in range(1, 6)]
          + [{"id": "light.quiet", "at": "2026-08-26T00:00:00+00:00"}])
    snap = heartbeat.snapshot({})
    assert snap["talkers"][0] == ("sensor.loud", 5)
    assert snap["talker_share"] == pytest.approx(1.0)
    assert snap["entities"] == 2


def test_a_FULL_ring_says_so_in_words_not_only_in_numbers() -> None:
    """A reader scanning two days of pasted lines should not have to compare
    two figures to notice the record started evicting."""
    _fill([{"id": "light.a", "at": "2026-08-20T00:00:00+00:00"}])
    snap = dict(heartbeat.snapshot({}))
    snap["entries"] = snap["bound"] = 20_000
    snap["at_bound"] = True
    assert "FULL, evicting oldest" in heartbeat.report(snap)[0]


def test_a_ring_with_room_reports_when_it_will_fill() -> None:
    _fill([{"id": "light.a", "at": "2026-08-20T00:00:00+00:00"},
           {"id": "light.b", "at": "2026-08-21T00:00:00+00:00"}])
    snap = dict(heartbeat.snapshot({}))
    snap["entries"], snap["rows_per_day"], snap["at_bound"] = 100, 50.0, False
    line = heartbeat.report(snap)[0]
    assert "fills in" in line


# ── the counters it divides ─────────────────────────────────────────────────

def test_the_cycle_counts_its_own_passes_and_seeds(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ PIN THE CALLER. `snapshot` computing a correct mean from counters
    nothing increments is this repository's thirteen-times defect — the module
    would be right, tested, and fed zeros forever."""
    from test_observe_cycle import _FakeHass, _run, _state    # noqa: E402

    cycle._STATS.update({"cycles": 0, "rows": 0, "restarts": 0, "seeded": 0,
                         "started": None})
    cycle._LAST.clear()
    fake = _FakeHass([_state("light.a", "on"), _state("light.b", "off")])
    monkeypatch.setattr(cycle, "HassClient", lambda _s: fake)
    _run(cycle.run_once(None, now_iso="2026-08-22T10:00:00+00:00"))
    fake.states = [_state("light.a", "off"), _state("light.b", "off")]
    _run(cycle.run_once(None, now_iso="2026-08-22T10:15:00+00:00"))

    assert cycle._STATS["cycles"] == 2
    assert cycle._STATS["rows"] == 3          # 2 baseline + 1 change
    assert cycle._STATS["restarts"] == 1      # the cold start seeded once
    assert cycle._STATS["started"] is not None
    snap = heartbeat.snapshot(cycle._STATS)
    assert snap["mean_rows"] == pytest.approx(1.5)
    assert snap["uptime_hours"] is not None


def test_the_CYCLE_actually_calls_the_heartbeat() -> None:
    """The other half of pinning the caller: a heartbeat nothing invokes."""
    import inspect
    src = inspect.getsource(cycle.run_forever)
    assert "heartbeat_mod.maybe_log(_STATS)" in src, (
        "the cycle does not emit the heartbeat, so it can never fire")
    assert "swallow(" in src, (
        "a diagnostic must not be able to take down the tier it describes")


def test_zero_cycles_reports_UNKNOWN_rather_than_a_mean_of_zero() -> None:
    snap = heartbeat.snapshot({"cycles": 0, "rows": 0})
    assert snap["mean_rows"] is None and snap["uptime_hours"] is None
    assert "mean ?" in heartbeat.report(snap)[0]


def test_the_line_is_SELF_CONTAINED_because_it_is_read_days_later() -> None:
    """It is pasted back out of context, so each line must carry its own units
    and identity rather than relying on a neighbour."""
    _fill([{"id": "light.a", "at": "2026-08-20T00:00:00+00:00"},
           {"id": "light.b", "at": "2026-08-22T00:00:00+00:00"}])
    lines = heartbeat.report(heartbeat.snapshot(
        {"cycles": 8, "rows": 800, "restarts": 1, "seeded": 12,
         "started": None}))
    assert len(lines) == 2
    assert all(line.startswith("heartbeat ") for line in lines)
    for field in ("ring", "span", "rate", "entities", "cycles", "mean",
                  "restarts", "seeded"):
        assert field in lines[0], field
    assert "talkers" in lines[1] and "of the ring" in lines[1]


def test_the_report_does_not_recompute_what_snapshot_already_decided() -> None:
    """⚠️ ONE COMPUTATION, TWO CONSUMERS — the same rule `agent/prefix.py` is
    pinned on. Two renderings that each do their own arithmetic are two numbers
    that drift."""
    import inspect
    src = inspect.getsource(heartbeat.report)
    assert "journal.read" not in src and "_span_days" not in src


# ── coverage, so "is it fixed" has an answer a person can read ─────────────

def test_the_heartbeat_reports_coverage_AND_the_stamp_behind_it() -> None:
    """⚠️ THE VERDICT ALONE CANNOT SEPARATE TWO DIFFERENT ANSWERS. `complete` is
    computed as `bool(online_since)`, so a bare INCOMPLETE means either "the
    stamp is missing" — the v2.744.0 defect, which reached an owner's phone as a
    warning about a gap that never happened — or "the window genuinely starts
    before we were listening", which is real and needs no fix."""
    _fill([{"id": "light.a", "at": "2026-08-20T00:00:00+00:00"},
           {"id": "light.b", "at": "2026-08-22T00:00:00+00:00"}])
    line = heartbeat.report(heartbeat.snapshot({}))[0]
    assert "coverage complete" in line
    assert "listening-since 2026-08-22T00:00:00+00:00" in line


def test_an_UNSTAMPED_journal_says_INCOMPLETE_and_shows_why() -> None:
    journal.append([{"event_type": "state_changed", "time_fired": "t",
                     "data": {"entity_id": "light.a", "old_state": None,
                              "new_state": {"state": "on", "attributes": {}}}}],
                   now_iso="")
    line = heartbeat.report(heartbeat.snapshot({}))[0]
    assert "coverage INCOMPLETE" in line
    assert "listening-since ?" in line, (
        "an empty stamp must print as ? — it IS the defect, and a blank there "
        "reads as a formatting slip rather than a finding")
