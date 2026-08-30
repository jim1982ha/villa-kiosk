"""The per-pass census: one line saying what a whole run did. TASK-095.

⚠️ THIS FILE PINS AN INSTRUMENT, AND `feedback_instruments-never-skip` IS WHY
IT IS AS LONG AS IT IS. Five shapes of instrument have lied in this project, and
four counters once read `0` for the exact case they existed to measure. A census
that silently reports the wrong pass, sums two passes together, or vanishes when
a pass raises is worse than none, because it is believed.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.adapters import log as log_mod  # noqa: E402


def _lines(capsys: Any) -> str:
    return capsys.readouterr().out


# ── the mechanism ───────────────────────────────────────────────────────────
def test_a_pass_prints_its_census_before_the_end_line(capsys: Any) -> None:
    with log_mod.pass_scope("manual"):
        log_mod.tally("investigated", 2)
        log_mod.note("doc_coverage", "complete")
    out = _lines(capsys)
    assert "census: " in out, out
    assert "investigated=2" in out and "doc_coverage=complete" in out, out
    # ⚠️ BEFORE the end line, so a reader scanning for the pass boundary finds
    # the summary above it rather than after the thing it summarises.
    assert out.index("census:") < out.index("pass ends"), out


def test_a_quiet_pass_prints_NO_census_line(capsys: Any) -> None:
    """⚠️ THE ONE PLACE SILENCE IS RIGHT. `stage()` must speak even when a tier
    did nothing, because "no line" and "nothing to do" are otherwise
    indistinguishable — but a census with no facts in it has nothing to say
    and printing `census:` alone would be noise on every idle pass."""
    with log_mod.pass_scope("chase"):
        pass
    assert "census:" not in _lines(capsys)


def test_two_passes_do_NOT_share_a_census(capsys: Any) -> None:
    """⚠️ THE DEFECT THIS WAS WRITTEN AGAINST. `ContextVar`'s default is ONE
    shared dict; contributing to it would accumulate across every pass in the
    process and report the sum as a single run's figures — a cost line that
    grows all day and is wrong from the second pass onward."""
    with log_mod.pass_scope("manual"):
        log_mod.tally("investigated", 2)
    with log_mod.pass_scope("manual"):
        log_mod.tally("investigated", 1)
    first, second = [l for l in _lines(capsys).splitlines() if "census:" in l]
    assert "investigated=2" in first, first
    assert "investigated=1" in second, second


def test_a_pass_that_RAISES_still_reports_what_it_managed(capsys: Any) -> None:
    """⚠️ THE CASE A CENSUS IS MOST WORTH HAVING. A pass that died halfway is
    exactly when "what had it done by then" is the question, and a version that
    printed after the `try` would lose it."""
    with pytest.raises(RuntimeError):
        with log_mod.pass_scope("manual"):
            log_mod.tally("investigated", 1)
            raise RuntimeError("mid-pass")
    out = _lines(capsys)
    assert "investigated=1" in out, out
    assert "pass ends" in out, out


def test_contributions_OUTSIDE_a_pass_are_silent(capsys: Any) -> None:
    """A tool called from the chat path or a button press is not a pass."""
    log_mod.tally("investigated", 5)
    log_mod.note("usd", 1.0)
    assert "census:" not in _lines(capsys)


def test_a_counter_or_a_note_NEVER_raises() -> None:
    """⚠️ THE MODULE'S WHOLE CONTRACT: logging cannot take down the thing it
    describes. A census contributor sits on the hot path of every tool call."""
    with log_mod.pass_scope("manual"):
        log_mod.tally("x", "not-a-number")  # type: ignore[arg-type]
        log_mod.note("y", object())
        assert isinstance(log_mod.census(), dict)


def test_the_census_a_reader_gets_is_a_COPY() -> None:
    with log_mod.pass_scope("manual"):
        log_mod.tally("investigated", 1)
        book = log_mod.census()
        book["investigated"] = 99
        assert log_mod.census()["investigated"] == 1


# ── the line itself ─────────────────────────────────────────────────────────
def test_known_keys_print_in_TIER_ORDER_and_the_rest_still_print() -> None:
    """⚠️ AN UNLISTED KEY MUST NOT BE INVISIBLE. Ordering by a hand-kept list is
    how a counter added later reads as zero for the case it was added for —
    so anything not in `CENSUS_ORDER` prints after it, sorted, rather than being
    dropped."""
    book: Dict[str, Any] = {"zzz_new": 1, "usd": 0.5, "escalated": 3}
    line = log_mod._census_line(book)
    assert line.index("escalated=") < line.index("usd="), line
    assert line.index("usd=") < line.index("zzz_new="), line


def test_a_MONEY_value_keeps_its_decimals() -> None:
    """⚠️ A PASS ON THIS VILLA COSTS ABOUT A CENT. Formatting spend as an
    integer would report every single run as costing nothing, which is the
    counter reading zero for the case it exists to measure."""
    assert "usd=0.0130" in log_mod._census_line({"usd": 0.013})


def test_an_empty_book_yields_NO_line() -> None:
    assert log_mod._census_line({}) == ""


# ── the contributors are actually wired ─────────────────────────────────────
def test_usage_RECORD_feeds_the_cost_counters(tmp_path: Any) -> None:
    """⚠️ `feedback_pin-the-caller`. Every test above builds the census by hand
    and stays green if nothing ever contributes to it. `usage.record` is the one
    place every model call passes through, whatever tier made it — so the cost
    half of the census needs no plumbing and cannot miss a caller, and this is
    the assertion that says so."""
    from vesta.adapters import usage as usage_mod

    with log_mod.pass_scope("manual"):
        usage_mod.record(source="triage", model="claude-haiku-4-5",
                         counts={"input_tokens": 1000, "output_tokens": 50,
                                 "cache_read_input_tokens": 200},
                         path=str(tmp_path / "u.json"))
        book = log_mod.census()

    assert book["tokens_in"] == 1200, book
    assert book["tokens_out"] == 50, book
    assert book["usd"] > 0, book


def test_the_snapshot_DELTA_records_what_the_model_was_given() -> None:
    """The document tier had only `N chars, N lines`, which proved the agent
    blind once and could never say WHICH input was empty."""
    from vesta.supervise.observe import snapshot

    with log_mod.pass_scope("manual"):
        snapshot.delta(salient=(), concerns=({"title": "a"}, {"title": "b"}),
                       coverage={"complete": False}, offline_total=3)
        book = log_mod.census()

    assert book["doc_salient"] == 0, book
    assert book["doc_concerns"] == 2, book
    assert book["doc_offline"] == 3, book
    assert book["doc_coverage"] == "partial", book
