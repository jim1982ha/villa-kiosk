"""The concern lifecycle, and the two halves that describe it.

⚠️ THE BACKEND IMPLEMENTED ALL FIVE STATES AND THE UI RENDERED NONE OF THEM.
`agent/concerns.py` has the transitions, the dismissal counter and the
suppression rule that counter drives; the wall showed `open` and `acted`
identically and hid the other three, so a reader could not tell whether anything
had been DONE about a concern, and the settled ones had no surface at all.

The HLD §6.2 is explicit about the cost: "The current system cannot tell whether
a fix worked, cannot measure whether a rule is noisy, and cannot compute median
time to clear... Giving a finding a lifecycle produces verification, fatigue
measurement and the eval corpus as by-products of the same field." Every one of
those is read off the state, so a state nobody renders produces none of them.

⚠️ AND THE SET IS DECLARED IN PYTHON AND EXPLAINED IN TYPESCRIPT, joined by a
string — the shape this repository has paid for at three levels already. A state
the SPA has no copy for renders as nothing at all.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.supervise.agent import contracts

COPY = os.path.join(REPO_ROOT, "src", "components", "agent",
                    "ConcernLifecycle.tsx")


def _copy_states() -> Set[str]:
    with open(COPY, encoding="utf-8") as handle:
        block = handle.read()
    block = block[block.index("STATE_COPY"):]
    block = block[:block.index("\n};")]
    return set(re.findall(r"^  ([a-z]+): \{", block, re.M))


def _backend_states() -> Set[str]:
    return {str(s) for s in contracts.CONCERN_STATE}


def test_the_anchors_still_find_something() -> None:
    """⚠️ THE VACUOUS-PASS GUARD — an empty set compares equal to an empty set
    and reports health forever."""
    assert len(_backend_states()) >= 5
    assert len(_copy_states()) >= 5


def test_every_state_the_backend_can_write_HAS_words_for_a_reader() -> None:
    """A state with no entry renders as nothing — not as a fallback label, and
    not as an error. Silent, on the one field the lifecycle is read from."""
    missing = sorted(_backend_states() - _copy_states())
    assert not missing, (
        f"the store can write these states and the UI has no copy for them, so "
        f"they render as an empty chip: {missing}")


def test_the_UI_invents_no_state_the_backend_cannot_write() -> None:
    extra = sorted(_copy_states() - _backend_states())
    assert not extra, (
        f"the UI explains states that can never arrive: {extra}")


def test_the_SUPPRESSION_THRESHOLD_matches_the_rule_it_describes() -> None:
    """⚠️ THE UI RESTATES THE BACKEND'S NUMBER AND MUST NOT RE-DECIDE IT. Three
    dismissals on one subject stop it being raised — the HLD calls the dismissed
    branch "the highest-value signal in the system" — and a screen promising a
    different number than the code enforces is worse than one that says nothing,
    because a reader would count wrong."""
    from vesta.supervise.agent import concerns as concerns_mod
    with open(COPY, encoding="utf-8") as handle:
        ui = handle.read()
    m = re.search(r"SUPPRESS_AFTER = (\d+)", ui)
    assert m, "the UI no longer states the threshold it explains"
    # ⚠️ THE CONSTANT, NOT A REGEX OVER THE COMPARISON. A first version searched
    # `concerns.py` for a numeric literal beside `>=` and failed on the real
    # code, which compares against the NAMED `DISMISSALS_TO_SUPPRESS` — the
    # better-written half. Reading the value the backend actually uses is both
    # simpler and immune to how the comparison is spelt.
    assert int(m.group(1)) == concerns_mod.DISMISSALS_TO_SUPPRESS, (
        f"the UI tells a reader {m.group(1)} dismissals silence a subject and "
        f"the rule is {concerns_mod.DISMISSALS_TO_SUPPRESS} — a screen "
        f"promising a different number than the code enforces is worse than "
        f"one that says nothing, because a reader would count wrong")
