"""Two pairs of controls that were each one concept, and one dead combination.

⚠️ THE MERGE IS A CORRECTNESS CHANGE, NOT TIDYING, WHICH IS WHY IT HAS TESTS.
`shadow` and `investigate_mode` are independent booleans, so "stay silent" +
"ask before investigating" was reachable — and in it, triage escalates,
`reason.follow_up` returns early recording each escalation as AWAITING, no
Concern is produced, and the shadow diff compares an empty column against the
rules. The reference villa ran its entire shadow period there and read the
result as a verdict on the agent. It was a verdict on the settings.

This pins that the combination is now unreachable BY CONSTRUCTION, the same way
`agent/review.py` makes an unapproved playbook unreachable with a directory
rather than a flag.
"""

from __future__ import annotations

import os
import re

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PANEL = os.path.join(REPO_ROOT, "src", "components", "settings",
                     "AgentTuningPanel.tsx")


def _panel() -> str:
    with open(PANEL, encoding="utf-8") as handle:
        return handle.read()


def _writes(src: str) -> list:
    """Every `{ shadow: …, investigateMode: … }` the mode control can emit."""
    return re.findall(
        r"\{\s*shadow:\s*(true|false),\s*investigateMode:\s*\"(\w+)\"\s*\}", src)


def _depth_block(src: str) -> str:
    """Just the depth control's `onChange`.

    ⚠️ ANCHORED, BECAUSE THE WHOLE-FILE VERSION MATCHED THE `EMPTY` DEFAULTS
    OBJECT — which lists maxTurns, maxToolCalls and maxOutputTokens on one line
    and so looked both like a fourth preset and like the ceiling having been
    folded in. Two false failures from one unanchored regex; the code was right
    both times.
    """
    i = src.index('label="How thorough each investigation is"')
    return src[i:src.index("      />", i)]


def test_the_mode_control_emits_exactly_THREE_combinations() -> None:
    combos = _writes(_panel())
    assert len(combos) == 3, f"expected three modes, found {combos}"
    assert len(set(combos)) == 3, f"two modes write the same thing: {combos}"


def test_the_DEAD_combination_cannot_be_written() -> None:
    """⚠️ shadow ON + approve: everything queues, nothing is investigated,
    nothing is recorded, and the diff that the cutover is read from compares an
    empty column. No control may produce it."""
    assert ("true", "approve") not in _writes(_panel()), (
        "the UI can still put the villa in the combination that records "
        "nothing while appearing to be observing")


def test_every_reachable_mode_is_one_a_person_would_want() -> None:
    combos = set(_writes(_panel()))
    assert combos == {("true", "auto"),      # observe: runs all, delivers none
                      ("false", "approve"),  # ask first
                      ("false", "auto")}     # live


def test_the_two_merged_toggles_are_GONE_not_merely_hidden() -> None:
    """A leftover checkbox writing one half of the pair reopens the dead cell."""
    src = _panel()
    assert "checked={draft.shadow}" not in src
    assert 'checked={draft.investigateMode === "auto"}' not in src


# ── the depth pair ──────────────────────────────────────────────────────────

def test_depth_writes_both_bounds_together_and_never_one_alone() -> None:
    """They only mean anything as a pair — nobody wants twelve rounds and four
    readings. Each option sets both."""
    src = _panel()
    pairs = re.findall(r"\{\s*maxTurns:\s*(\d+),\s*maxToolCalls:\s*(\d+)\s*\}",
                       _depth_block(src))
    assert len(pairs) == 3, f"expected three depth presets, found {pairs}"
    # ⚠️ NO ORDERING ASSERTION. These come from a ternary chain, so SOURCE
    # order is brief/thorough/normal and says nothing about display order — an
    # earlier draft asserted monotonicity here and failed on correct code.
    pairs = [(int(t), int(c)) for t, c in pairs]
    assert all(c > t for t, c in pairs), (
        "readings must exceed rounds — a round with no reading is a round "
        "that cannot learn anything")
    assert all(c >= t * 2 for t, c in pairs), (
        "each round needs room for more than two readings or the depth "
        "preset starves the very thing it is buying")
    assert len({t for t, _ in pairs}) == 3, "two presets are the same depth"


def test_max_output_tokens_did_NOT_join_the_depth_merge() -> None:
    """⚠️ IT IS A CEILING THAT COSTS NOTHING UNUSED, while the other two are
    each a billable round trip. Folding it in would file a free setting among
    paid ones and invite it to be turned DOWN — the setting that was silently
    killing 7 of every 8 supervision passes (v2.713.0)."""
    src = _panel()
    assert "maxOutputTokens" in src, "the ceiling lost its control entirely"
    assert "maxOutputTokens" not in _depth_block(src), (
        "the ceiling was folded into the depth presets")
    assert 'label="Room to think and answer' in src, (
        "the ceiling lost its own labelled control")
