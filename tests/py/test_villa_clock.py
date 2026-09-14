"""Times a person reads are the VILLA's times, never UTC.

An alert reached the owner reading "a brief connectivity glitch on 2026-09-12
at 12:20 UTC". The arithmetic was right — the property is east of Greenwich, so
that instant is mid-evening on its own wall clock — and the sentence was still
wrong for its reader, who was standing in the villa at the time and had to
convert it by hand to find out whether it mattered.

Two halves failed together, and either alone would have been enough:

  THE STAMPS WERE UTC. Home Assistant hands history and traces back in UTC, and
  the tool results carried them through to the model verbatim.

  THE MODEL WAS NEVER TOLD THE OFFSET. Not in the system blocks, not in the
  instructions, and deliberately not in the Villa Document — which forbids any
  interpolated instant because one would change the prefix on every call and
  silently destroy the cache. So the model repeated what it was given, which is
  the correct behaviour for a model given only that.

⚠️ A ZONE THAT IS NOT THE REFERENCE DEPLOYMENT'S, deliberately — same rule
`test_schedule` follows. A test that passes only on the property it was written
against has pinned the property, not the rule. Tokyo is +09:00 all year, so the
expected strings here are arithmetic rather than a table of DST dates.
"""

from __future__ import annotations

import re
from datetime import timezone
from typing import Any, Dict, List
from zoneinfo import ZoneInfo

from vesta.shared import wallclock
from vesta.supervise.agent import clock, playbooks
from vesta.supervise.agent.tools import ha as ha_tools

ELSEWHERE = ZoneInfo("Asia/Tokyo")          # +09:00, no DST
#: The shape of the instant that produced the reported defect: an evening event
#: whose UTC rendering lands in the middle of the previous working day.
EVENING_UTC = "2026-09-12T12:20:27+00:00"
EVENING_LOCAL = "2026-09-12T21:20:27+09:00"


class _Refs:
    def resolve(self, ref: str) -> str:
        return "sensor.example_reading"

    def label(self, ref: str) -> str:
        return "Example reading"


def _run(coro: Any) -> Any:
    import asyncio
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


# ── rendering ──────────────────────────────────────────────────────────────

def test_an_instant_is_rendered_in_the_villas_own_clock() -> None:
    assert wallclock.for_reader(EVENING_UTC, ELSEWHERE) == EVENING_LOCAL


def test_the_offset_is_always_shown() -> None:
    """A bare "21:20" that escapes into a record is ambiguous forever; the
    rendered form must still be parseable back to the same instant."""
    from vesta.shared import instants
    rendered = wallclock.for_reader(EVENING_UTC, ELSEWHERE)
    assert instants.as_utc(rendered) == instants.as_utc(EVENING_UTC)


def test_the_word_UTC_never_reaches_a_reader_on_a_villa_that_is_not_at_UTC() -> None:
    assert "UTC" not in wallclock.for_reader(EVENING_UTC, ELSEWHERE)
    assert "Z" not in wallclock.for_reader(EVENING_UTC, ELSEWHERE)


def test_an_unreadable_stamp_is_empty_rather_than_an_exception() -> None:
    """A briefing must not fail to be delivered over a timestamp."""
    for junk in ("", "not a time", None, {}, []):
        assert wallclock.for_reader(junk, ELSEWHERE) == ""


def test_an_evening_belongs_to_the_villas_day_not_the_next_one() -> None:
    """⚠️ THIS IS WHY `str(at)[:10]` IS NOT GOOD ENOUGH. Slicing the UTC stamp
    files everything after local afternoon under TOMORROW, so an evening's
    readings were ranked against the wrong day's neighbours — in the scoring
    that decides what the model is shown at all."""
    assert wallclock.day_for_reader(EVENING_UTC, ELSEWHERE) == "2026-09-12"
    assert str(EVENING_UTC)[:10] == "2026-09-12"
    # ...and the case where the naive slice is actually WRONG:
    late = "2026-09-12T16:40:00+00:00"          # 01:40 the next day in Tokyo
    assert wallclock.day_for_reader(late, ELSEWHERE) == "2026-09-13"
    assert str(late)[:10] == "2026-09-12", "the naive slice disagrees — that was the bug"


# ── which zone ─────────────────────────────────────────────────────────────

def test_an_explicit_setting_wins() -> None:
    clock.reset_for_test()
    try:
        assert clock.villa_zone({"timezone": "Asia/Tokyo"}) == ELSEWHERE
    finally:
        clock.reset_for_test()


def test_an_unknown_zone_degrades_rather_than_raising() -> None:
    """A report at the wrong hour is a nuisance; a tier that will not start is
    an outage. Same ruling `schedule.resolve_timezone` already made."""
    clock.reset_for_test()
    try:
        assert clock.villa_zone({"timezone": "Mars/Olympus"}) == timezone.utc
    finally:
        clock.reset_for_test()


def test_the_resolved_zone_is_cached_for_the_process() -> None:
    """⚠️ NOT A MICRO-OPTIMISATION. Without it a file read sits inside the loop
    that renders every point of a history series."""
    clock.reset_for_test()
    try:
        first = clock.villa_zone({"timezone": "Asia/Tokyo"})
        second = clock.villa_zone({"timezone": "Europe/Lisbon"})
        assert first is second, "a second call must not re-resolve"
    finally:
        clock.reset_for_test()


# ── what the model is told ─────────────────────────────────────────────────

def test_the_model_is_TOLD_the_villas_clock() -> None:
    """The half that made the other half invisible. A model handed UTC and told
    nothing repeats UTC, and is right to."""
    clock.reset_for_test()
    try:
        clock.villa_zone({"timezone": "Asia/Tokyo"})
        built = playbooks.system_blocks("owner", instructions="I", document="D")
        first = built[0]["text"]
        assert "Asia/Tokyo" in first
        assert "never convert" in first.lower() or "never" in first.lower()
    finally:
        clock.reset_for_test()


def test_the_clock_block_carries_no_instant() -> None:
    """⚠️ THE CACHE. A date or a time in a system block changes the prefix on
    every call, so the cache never hits and the failure is SILENT — the same
    ruling `snapshot.profile` makes in the same words. The ZONE is stable for
    the life of an install; the TIME is not."""
    clock.reset_for_test()
    try:
        clock.villa_zone({"timezone": "Asia/Tokyo"})
        first = playbooks.system_blocks("owner", instructions="I")[0]["text"]
        assert not re.search(r"\d{4}-\d{2}-\d{2}", first)
        assert not re.search(r"\b\d{1,2}:\d{2}\b", first)
    finally:
        clock.reset_for_test()


# ── the tool boundary ──────────────────────────────────────────────────────

def test_the_SALIENCE_DAY_BUCKETS_ask_the_owner_of_that_rule() -> None:
    """⚠️ PINNING THE CALLER, NOT THE HELPER. `day_for_reader` being correct
    proves nothing about the one place whose day buckets were wrong: the
    scorer sliced `str(at)[:10]` itself, so every evening reading was compared
    against the wrong day's neighbours in the ranking that decides what the
    model is shown at all. A test of the helper alone stays green straight
    through that, which is this repository's most repeated defect.
    """
    from vesta.supervise.agent import sources

    clock.reset_for_test()
    seen: List[Any] = []
    real = wallclock.day_for_reader

    def spy(value: Any, zone: Any) -> str:
        seen.append(value)
        return real(value, zone)

    sources.wallclock.day_for_reader = spy           # type: ignore[attr-defined]
    try:
        clock.villa_zone({"timezone": "Asia/Tokyo"})
        rows = [{"id": "sensor.example_reading", "at": EVENING_UTC, "s": "21"},
                {"id": "sensor.example_reading", "at": "2026-09-13T01:00:00+00:00",
                 "s": "23"}]
        sources.build_scorer(rows)()
        assert EVENING_UTC in seen, (
            "the scorer must resolve its day through the one owner, not by "
            "slicing a UTC stamp")
    finally:
        sources.wallclock.day_for_reader = real      # type: ignore[attr-defined]
        clock.reset_for_test()


def test_read_history_hands_the_model_villa_time() -> None:
    clock.reset_for_test()
    try:
        clock.villa_zone({"timezone": "Asia/Tokyo"})
        tool = ha_tools.ReadHistory(
            source=lambda e, h: [{"at": EVENING_UTC, "state": "off"}],
            refs=_Refs())
        blocks = _run(tool.call({"ref": "d1"}))
        assert blocks[0]["json"]["points"][0]["at"] == EVENING_LOCAL
    finally:
        clock.reset_for_test()


def test_read_automation_trace_hands_the_model_villa_time() -> None:
    clock.reset_for_test()
    try:
        clock.villa_zone({"timezone": "Asia/Tokyo"})
        tool = ha_tools.ReadAutomationTrace(
            source=lambda e, n: [{"at": EVENING_UTC, "outcome": "ok", "error": ""}],
            refs=_Refs())
        blocks = _run(tool.call({"ref": "a1"}))
        assert blocks[0]["json"]["runs"][0]["at"] == EVENING_LOCAL
    finally:
        clock.reset_for_test()


def test_the_renderer_can_never_DELETE_a_reading() -> None:
    """⚠️ CAUGHT IN REVIEW, AFTER THE FIRST VERSION SHIPPED IT. Rewriting the
    series with `if isinstance(r, Mapping)` dropped every other row shape, so
    `total_points` read 0 against a source yielding 1,000 plain values — the
    model would have been told a complete series was empty. A renderer that can
    silently shorten its input is worse than the defect it was fixing."""
    clock.reset_for_test()
    try:
        clock.villa_zone({"timezone": "Asia/Tokyo"})
        rows: List[Any] = list(range(1000))
        tool = ha_tools.ReadHistory(source=lambda e, h: rows, refs=_Refs())
        blocks = _run(tool.call({"ref": "d1"}))
        assert blocks[0]["json"]["total_points"] == 1000
    finally:
        clock.reset_for_test()


def test_a_row_with_no_stamp_keeps_its_other_fields() -> None:
    clock.reset_for_test()
    try:
        clock.villa_zone({"timezone": "Asia/Tokyo"})
        tool = ha_tools.ReadHistory(
            source=lambda e, h: [{"at": "", "state": "on"}], refs=_Refs())
        point: Dict[str, Any] = _run(tool.call({"ref": "d1"}))[0]["json"]["points"][0]
        assert point["state"] == "on"
        assert point["at"] == ""
    finally:
        clock.reset_for_test()
