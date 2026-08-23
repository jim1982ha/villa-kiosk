"""The evidence rule, enforced rather than requested. TEST-020, TASK-042."""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from agent import render                                      # noqa: E402

EV: List[Dict[str, Any]] = [
    {"tool": "read_salient", "args_digest": "a1",
     "at": "2026-08-23T00:00:00Z",
     "summary": "power 340 against a median of 210, 14 starts in an hour"},
]


def test_a_SOURCED_figure_survives() -> None:
    out = render.enforce("The pump drew 340 W against a median of 210 W.", EV)
    assert out.clean and "340 W" in out.body and "210 W" in out.body


def test_an_UNSOURCED_figure_is_stripped_and_COUNTED() -> None:
    """⚠️ COUNTED, ALWAYS. A silent enforcement would be the fifth instrument
    here reporting zero for the case it exists to measure."""
    out = render.enforce("The pump drew 980 W overnight.", EV)
    assert render.STRIPPED in out.body
    assert out.stripped == 1 and out.removed == ["980 W"]


def test_the_SENTENCE_survives_the_strip() -> None:
    """⚠️ The finding is worth keeping even when the number is not. Deleting
    the line would lose "the pump is short-cycling" along with "14 times"."""
    out = render.enforce("The pump is short-cycling: 99 times in an hour.", EV)
    assert "short-cycling" in out.body


def test_a_PLAUSIBLE_ROUNDING_is_caught() -> None:
    """⚠️ THE DRIFT THIS EXISTS FOR. A model that read 340 and wrote "roughly
    400 W" has not cited anything, and the sentence looks identical to one that
    did."""
    out = render.enforce("The pump drew roughly 400 W.", EV)
    assert out.stripped == 1


def test_a_thousands_separator_still_matches() -> None:
    ev = [{"summary": "consumption 1240 kWh", "args_digest": "x"}]
    assert render.enforce("It used 1,240 kWh.", ev).clean


def test_prose_numbers_are_NOT_figures() -> None:
    """⚠️ A year, a date and a small count are not claims about measurement,
    and stripping them would mangle "since 2 August" into nonsense."""
    out = render.enforce("Since 2 August, one of 4 pumps has been noisy.", EV)
    assert out.clean, out.removed


def test_a_large_bare_number_IS_a_figure() -> None:
    out = render.enforce("It reported 8500 overnight.", EV)
    assert out.stripped == 1


def test_NO_evidence_means_every_figure_goes() -> None:
    """⚠️ Harsh and correct: a concern with no evidence rows has nothing behind
    any of its numbers, and softening it here makes the rule advisory."""
    out = render.enforce("The pump drew 340 W.", [])
    assert out.stripped == 1


def test_the_strip_count_travels_with_the_concern() -> None:
    """So "how often does the agent invent numbers" is answered from the
    record rather than estimated."""
    out = render.enforce_concern(
        {"body": "It drew 980 W.", "evidence": EV, "title": "t"})
    assert out["figures_stripped"] == 1
    assert render.STRIPPED in out["body"]
    assert out["title"] == "t", "the rest of the concern was disturbed"


# ── readings vs derived figures (TASK-113's contract check) ─────────────────
# ⚠️ EXERCISED BEFORE THE ha_mcp PLUMBING, AND IT FAILED IN BOTH DIRECTIONS.
# The plan says to check this first because it is a contract question rather
# than an integration one: once history questions are answerable, a COUNT OF
# TRANSITIONS becomes the common answer shape, and it is arithmetic OVER the
# evidence rather than a value IN it.

def test_a_DERIVED_count_is_not_stripped() -> None:
    """⚠️ IT WAS. A count is correct arithmetic over the state rows and the
    figure appears in none of them, so the citation rule removed it and the
    reader saw "[unsourced figure removed]" — VESTA refusing to state a number
    it had worked out correctly.

    ⚠️ THE COUNT MUST EXCEED `BARE_MIN`. Written first with "7 times", this
    test passed with the exemption REMOVED — 7 is below the bare-number floor,
    so it survived for a reason that has nothing to do with the rule under
    test. Mutation is the only thing that catches a test passing for the wrong
    reason, and it caught this one.
    """
    evidence = [{"summary": "on at 09:14; off at 09:40; on at 18:02"}]
    assert "23 times" in render.enforce("It came on 23 times.", evidence).body
    assert "36 hours" in render.enforce("It ran for 36 hours.", evidence).body


def test_a_READING_still_has_to_be_cited() -> None:
    """The rule that matters is untouched: a measurement the villa never took
    may not appear. Relaxing counts must not relax this."""
    out = render.enforce("Standby draw is 340 W.", [{"summary": "nothing"}])
    assert "340" not in out.body and out.removed


def test_a_FRAGMENT_of_a_reading_is_not_a_citation() -> None:
    """⚠️ THE HOLE THAT MADE THE GUARD DECORATIVE. The check was
    `value in haystack` — a raw substring — so "40 W" was accepted as cited by
    an evidence row reading "340 W", and a fabricated count of 14 was accepted
    because a row said "on at 09:14". A guard satisfiable by coincidence is not
    a guard."""
    evidence = [{"cited": "power reading 340 W at 09:14"}]
    assert "40 W" not in render.enforce("Draw is 40 W.", evidence).body
    # And the genuine reading still passes.
    assert "340 W" in render.enforce("Draw is 340 W.", evidence).body
