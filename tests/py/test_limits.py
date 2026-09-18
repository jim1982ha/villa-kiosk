"""The management message: what stopped an answer being complete.

⚠️ OWNER'S INSTRUCTION, 2026-09-18 — "the objective is for the end-user to
always be able to estimate the quality and exhaustivity of the response". Until
2.981.0 the only limitation a reader could SEE was a decline. A truncated
search or an exhausted tool budget produced an answer that looked exactly like a
complete one, and `truncate`'s note — "the whole value" of that function, in its
own words — was addressed to the model alone.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import limits  # noqa: E402
from vesta.supervise.agent.tools.base import truncate  # noqa: E402


def test_nothing_to_report_sends_nothing():
    """⚠️ THE COMMON CASE, AND IT MUST STAY SILENT. A bubble after every answer
    saying "nothing was limited" trains the reader to ignore the one that
    matters — which is the opposite of what it is for."""
    assert limits.summary([]) == ""
    assert limits.summary(None) == ""
    with limits.scope() as run:
        assert limits.summary(run.collected()) == ""


def test_a_truncated_tool_result_reaches_the_reader():
    """The path that had no reader-facing signal at all."""
    with limits.scope() as run:
        truncate("x" * 5_000, limit=100)
        notes = run.collected()
    assert [n["kind"] for n in notes] == ["truncated"]
    message = limits.summary(notes)
    assert "too long to read in full" in message
    assert "4,900 characters not read" in message


def test_a_result_that_fits_reports_nothing():
    with limits.scope() as run:
        truncate("short", limit=100)
        assert run.collected() == []


def test_repeats_are_one_fact_not_eight():
    """⚠️ One broad search cut eight times is ONE thing the reader needs to
    know; eight identical sentences bury the one that differs."""
    with limits.scope() as run:
        for _ in range(8):
            truncate("x" * 5_000, limit=100)
        assert len(run.collected()) == 1


def test_different_limitations_are_all_reported():
    with limits.scope() as run:
        limits.note("truncated", "1,200 characters not read")
        limits.note("turns", "8 of 8 used")
        limits.note("tool_failed", "the weather service")
        notes = run.collected()
    message = limits.summary(notes)
    assert len(notes) == 3
    assert message.count("—") == 3, "one line per limitation"
    assert "ran out of steps" in message
    assert "could not reach the weather service" in message


def test_the_message_is_headed_so_it_reads_as_a_note_not_an_answer():
    """It arrives as its own bubble after the answer; without a heading it
    reads as the villa continuing to talk."""
    message = limits.summary([{"kind": "turns", "detail": ""}])
    assert message.startswith("⚠️ About this answer")


def test_outside_a_run_noting_is_a_no_op():
    """⚠️ A NO-OP, NOT AN ERROR. `truncate` is called from the document
    preview, the MCP server and a dozen tests where there is no run at all;
    raising there would take those paths down for a diagnostic."""
    limits.note("truncated", "nobody is collecting")   # must not raise
    assert limits.summary([]) == ""


def test_a_nested_scope_does_not_bleed_into_its_parent():
    """Two runs in one process must not attribute each other's limitations."""
    with limits.scope() as outer:
        limits.note("turns", "outer")
        with limits.scope() as inner:
            limits.note("truncated", "inner")
            assert [n["detail"] for n in inner.collected()] == ["inner"]
        assert [n["detail"] for n in outer.collected()] == ["outer"]


@pytest.mark.parametrize("kind", ["truncated", "turns", "tool_failed", "declined"])
def test_every_kind_produces_a_sentence(kind):
    """⚠️ A KIND WITH NO PHRASING WOULD PRINT ITS OWN NAME at the reader, which
    is how "tool_failed" reaches somebody's phone."""
    message = limits.summary([{"kind": kind, "detail": "something"}])
    assert message and kind not in message
