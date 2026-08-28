"""The source `read_logs` never had. TOOL-007, TASK-022.

⚠️ THE TOOL WAS FINISHED AND THE WIRE WAS MISSING, which is this repository's
most repeated defect in its purest form: `tools/logs.py` implements the filter,
the cap, the paging handle and the explicit-truncation rule, has had unit tests
since it shipped, and could only ever answer "this tool is not connected to the
villa's logs". Since 2.744.0 it was withheld from the model entirely — the right
call, because the refusal had reached an owner's phone as "log access is also
down", a fault on the property that did not exist.

⚠️ SO THE TESTS THAT MATTER HERE ARE THE ONES ABOUT THE JOIN, not about
filtering. `test_refs.py` already proves the tool filters. This file proves
there is something on the other end of it, that what comes back is safe to show
a model, and that the tool is actually PUBLISHED when a villa has a session.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from agent import redact, refs as refs_mod, sources                # noqa: E402
from agent.tools import logs as log_tools                          # noqa: E402


def _run(awaitable: Any) -> Any:
    return asyncio.new_event_loop().run_until_complete(awaitable)


def _stamp(at: float) -> str:
    """A line's timestamp in Home Assistant's format and the villa's clock."""
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(at))


class _FakeSession:
    """Stands in for the aiohttp session, returning a canned log."""

    def __init__(self, text: str) -> None:
        self.text = text


def _reader_over(text: str, monkeypatch: pytest.MonkeyPatch) -> Any:
    """`log_reader` with its one HTTP call replaced by a canned body."""
    async def _fake(_session: Any, _path: str) -> str:
        return text

    import vesta.adapters.hass as hass_mod
    monkeypatch.setattr(hass_mod, "rest_get_text", _fake)
    return sources.log_reader(_FakeSession(text))


# ── the source exists, or says so ───────────────────────────────────────────
def test_no_session_means_NO_READER_never_a_reader_that_returns_nothing() -> None:
    """⚠️ ZERO MATCHING LINES AND "NOBODY CONNECTED ME TO THE LOG" ARE THE SAME
    ANSWER TO A READER AND OPPOSITE FACTS. A reader that returned `[]` would
    make the tool publishable and permanently wrong."""
    assert sources.log_reader(None) is None


def test_a_session_produces_a_reader(monkeypatch: pytest.MonkeyPatch) -> None:
    assert callable(_reader_over("", monkeypatch))


# ── the window ──────────────────────────────────────────────────────────────
def test_lines_older_than_the_window_are_dropped_beside_home_assistant(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ FILTERED HERE, NOT IN THE TOOL. Every line that reaches the tool may
    reach the transcript, and a transcript line is re-sent on every later
    turn — the cost argument this whole tool was designed around."""
    now = time.time()
    text = "\n".join([
        f"{_stamp(now - 90 * 3600)} WARNING (MainThread) [old] ancient news",
        f"{_stamp(now - 2 * 3600)} WARNING (MainThread) [new] recent news",
    ])
    got = _run(_reader_over(text, monkeypatch)(24))
    assert any("recent news" in line for line in got)
    assert not any("ancient news" in line for line in got)


def test_a_WIDER_window_reaches_further_back(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THE PARAMETER MUST DO SOMETHING. A window argument that is accepted
    and ignored is the shape of defect this project has paid for repeatedly:
    the model narrows its question, the answer does not change, and it
    concludes the villa is quiet."""
    now = time.time()
    text = f"{_stamp(now - 90 * 3600)} WARNING (MainThread) [old] ancient news"
    assert not _run(_reader_over(text, monkeypatch)(24))
    assert _run(_reader_over(text, monkeypatch)(168))


def test_a_TRACEBACK_keeps_the_frames_under_its_first_line(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ A CONTINUATION LINE INHERITS THE TIME ABOVE IT. Twenty lines of a
    Python traceback carry no timestamp of their own, and dropping them would
    hand the model an exception's first line and none of the stack under it —
    the half that says what actually failed."""
    now = time.time()
    text = "\n".join([
        f"{_stamp(now - 1 * 3600)} ERROR (MainThread) [x] Unhandled exception",
        "Traceback (most recent call last):",
        '  File "/usr/src/thing.py", line 42, in poll',
        "ConnectionResetError: [Errno 104] Connection reset by peer",
    ])
    got = _run(_reader_over(text, monkeypatch)(24))
    assert len(got) == 4, f"the stack was cut to {len(got)} line(s)"
    assert "Connection reset" in got[-1]


def test_an_OLD_traceback_is_dropped_WITH_its_frames(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """The other direction, which "inherit the line above" gets wrong if it is
    implemented as "keep anything undated"."""
    now = time.time()
    text = "\n".join([
        f"{_stamp(now - 90 * 3600)} ERROR (MainThread) [x] ancient exception",
        "Traceback (most recent call last):",
        "ValueError: this is eleven days old",
    ])
    assert _run(_reader_over(text, monkeypatch)(24)) == []


def test_the_cutoff_is_the_VILLA_S_CLOCK_not_UTC(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ HOME ASSISTANT WRITES ITS LOG IN LOCAL TIME while everything else in
    this package speaks UTC. On the reference property that is an eight-hour
    error: a "last 24 hours" window would return most of two days one way and
    nothing at all the other.

    Asserted by comparing the cutoff this module builds against the same
    instant formatted both ways, on a timezone where they differ.
    """
    monkeypatch.setenv("TZ", "Asia/Manila")          # UTC+8, no DST
    time.tzset()
    try:
        at = 1780272000.0
        local = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(at))
        utc = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(at))
        assert local != utc, "the fixture timezone must actually differ from UTC"
        assert sources._stamp_of(at) == local, (
            "the cutoff was built in UTC, so the window is eight hours out")
    finally:
        monkeypatch.delenv("TZ", raising=False)
        time.tzset()


# ── what comes back is safe to show a model ─────────────────────────────────
LEAKY = ("{stamp} WARNING (MainThread) [homeassistant.components.zha] "
         "device sensor.probe_temperature is unavailable")


def test_an_ENTITY_ID_in_a_log_line_comes_back_as_a_HANDLE() -> None:
    """⚠️ WITHOUT THIS THE WHOLE TOOL IS DEAD ON ARRIVAL. `redact.audit` refuses
    any payload containing an entity id, and a log line is written by Home
    Assistant and its integrations — it is FULL of them. Exactly this cost the
    upstream integration five releases: every result naming a device was
    replaced by "the result could not be shown safely", and the model answered
    from whatever aggregate it still had."""
    table = refs_mod.RefTable()
    line = LEAKY.format(stamp="2026-08-22 03:14:01")
    blocks = _run(log_tools.ReadLogs(source=lambda h: [line],
                                     refs=table).call({}))
    body = blocks[0]["text"]
    assert "sensor.probe_temperature" not in body, "an entity id reached the model"
    assert table.ref_for("sensor.probe_temperature") in body, (
        "the device was not replaced by its handle, so the line says nothing")


def test_the_finished_result_passes_the_REDACTION_AUDIT() -> None:
    """⚠️ THE SECOND OPINION, RUN THE WAY THE REGISTRY RUNS IT. The assertion
    above knows what it is looking for; this one asks the independent detector
    that actually decides whether the result is sent."""
    table = refs_mod.RefTable()
    lines = [LEAKY.format(stamp="2026-08-22 03:14:01"),
             "2026-08-22 03:14:02 ERROR (MainThread) [x] "
             "light.example_patio_string failed to turn on"]
    blocks = _run(log_tools.ReadLogs(source=lambda h: lines,
                                     refs=table).call({}))
    assert redact.audit(redact.scrub(blocks)) == [], (
        "the audit would have replaced this with 'could not be shown safely'")


def test_pseudonymisation_happens_AFTER_the_match_not_before() -> None:
    """⚠️ ORDER, AND IT IS NOT COSMETIC. `_matches` compares against the real
    entity id resolved from `subject_ref`; swapping in handles first would
    leave the filter hunting for an id no longer in the text, and every
    subject-scoped search would return nothing at all — a tool that reports "no
    log lines matched" for a device with plenty."""
    table = refs_mod.RefTable()
    ref = table.ref_for("sensor.probe_temperature")
    lines = [LEAKY.format(stamp="2026-08-22 03:14:01"),
             "2026-08-22 03:14:02 INFO (MainThread) [x] unrelated"]
    payload = _run(log_tools.ReadLogs(source=lambda h: lines,
                                      refs=table).call({"subject_ref": ref}))[1]
    assert payload["json"]["matches"] == 1, (
        "the subject-scoped search found nothing, so the match ran on handles")


# ── the tool is actually published ──────────────────────────────────────────
def test_an_AWAITABLE_source_is_awaited() -> None:
    """The real reader is an HTTP round trip; every earlier stand-in was a
    list. A tool that returned the coroutine object would answer "the log did
    not return lines" on the live villa and pass every test with a list."""
    async def _reader(_hours: int) -> List[str]:
        return ["2026-08-22 03:14:02 ERROR (MainThread) [x] coordinator down"]

    payload = _run(log_tools.ReadLogs(source=_reader).call({}))[1]["json"]
    assert payload["matches"] == 1


def test_a_SYNCHRONOUS_source_still_works() -> None:
    """The fixtures in `test_refs.py` are plain lists and must remain legal."""
    payload = _run(log_tools.ReadLogs(
        source=lambda h: ["2026-08-22 03:14:02 ERROR (x) down"]).call({}))[1]
    assert payload["json"]["matches"] == 1


def _published(session: Any, monkeypatch: pytest.MonkeyPatch) -> List[str]:
    async def _fake(_session: Any, _path: str) -> str:
        return ""
    import vesta.adapters.hass as hass_mod
    monkeypatch.setattr(hass_mod, "rest_get_text", _fake)
    monkeypatch.setattr(sources, "_journal_rows", lambda: [])
    return [t.name for t in sources.build_tools(session)]


def test_read_logs_IS_PUBLISHED_when_the_villa_has_a_session(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ THE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT. `read_logs`
    is named in `registry.REASON_TOOLS` — the investigation tier was always
    meant to have it — and it was absent from every registry ever built."""
    assert "read_logs" in _published(_FakeSession(""), monkeypatch)


def test_read_logs_is_STILL_WITHHELD_when_there_is_no_session(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """The document preview and the MCP server both build tools with no
    session. Publishing a schema that can only refuse spends prefix tokens in
    the tier where schemas are already most of the bill, and its refusal has
    once reached a household as a fault report."""
    sources._UNWIRED_SEEN.clear()
    assert "read_logs" not in _published(None, monkeypatch)


def test_the_source_failing_is_an_ERROR_BLOCK_not_a_quiet_week(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """Home Assistant unreachable must not read as "nothing was logged"."""
    async def _boom(_session: Any, _path: str) -> str:
        from vesta.adapters.hass import HassUnavailable
        raise HassUnavailable("GET error_log -> HTTP 502")

    import vesta.adapters.hass as hass_mod
    monkeypatch.setattr(hass_mod, "rest_get_text", _boom)
    reader = sources.log_reader(_FakeSession(""))
    out = _run(log_tools.ReadLogs(source=reader).call({}))
    assert out[0]["error"]["code"] == "unavailable"
    assert "502" in out[0]["error"]["message"]


def test_the_fetch_is_CAPPED_and_keeps_the_TAIL() -> None:
    """⚠️ `/api/error_log` RETURNS THE WHOLE FILE AND HAS NO RANGE PARAMETER, so
    the only place a bound can be applied is the read — and a log question is
    always about what happened recently, so it is the tail that must survive."""
    import inspect
    import re
    from vesta.adapters import hass as hass_mod

    code = re.sub(r"#[^\n]*", "", inspect.getsource(hass_mod.rest_get_text))
    assert "MAX_LOG_BYTES" in code, "the read is unbounded"
    assert "[-MAX_LOG_BYTES:]" in code, "the head was kept instead of the tail"
