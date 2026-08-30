"""A flag that WAS investigated must not be reported as ignored.

⚠️ FOUND IN A DELIVERED BRIEF (2026-08-30). It read:

    What VESTA looked at:
    - Pool Pump — noticed, not investigated
    - Massage Jet Pump — noticed, not investigated
    - House Pump — noticed, not investigated

while `audit.json` recorded Pool Pump and Massage Jet Pump as `escalated` —
investigations that ran, at 01:28:50Z and 01:29:04Z, and concluded nothing was
wrong. Only House Pump was genuinely untouched (`deferred`, past the cap of 2).

⚠️ AND THE TABLET DISAGREED WITH THE MESSAGE. `RecentChecks` reads the audit
verdict and says "Investigated at …: no alert needed"; the brief read the
record's `outcome`, which `stamp_outcome` only ever set after `raise_concern`
succeeded. So "no concern" was being rendered as "nobody looked" — two surfaces
describing one event differently, which is the failure this subsystem exists to
prevent.
"""
from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import compose  # noqa: E402
from vesta.supervise.agent import reason  # noqa: E402


def _brief(rows: List[Dict[str, Any]]) -> str:
    return compose.brief(record=rows).text


def test_an_investigated_flag_says_so() -> None:
    """⚠️ THE REPORTED LINE. A flag carrying an outcome was looked at."""
    text = _brief([{"source": "triage", "title": "Pool Pump", "domain": "",
                    "outcome": reason.INVESTIGATED_NOTHING}])
    assert "Pool Pump — investigated, nothing to report" in text, text
    assert "noticed, not investigated" not in text, (
        "a flag that was investigated is still reported as ignored")


def test_an_untouched_flag_still_says_so() -> None:
    """⚠️ THE OTHER HALF MUST SURVIVE. House Pump was genuinely deferred past
    the cap, and collapsing the two states would replace one wrong sentence
    with a different wrong sentence."""
    text = _brief([{"source": "triage", "title": "House Pump", "domain": ""}])
    assert "House Pump — noticed, not investigated" in text, text


def test_the_two_states_are_never_merged_into_one_line() -> None:
    """⚠️ THE QUALIFIER IS PART OF THE GROUPING KEY. One subject looked at and
    another skipped are different facts and must not be counted together."""
    text = _brief([
        {"source": "triage", "title": "Pool Pump", "domain": "",
         "outcome": reason.INVESTIGATED_NOTHING},
        {"source": "triage", "title": "House Pump", "domain": ""},
    ])
    assert "Pool Pump — investigated, nothing to report" in text
    assert "House Pump — noticed, not investigated" in text
    assert text.startswith("2 thing(s) happened"), text.splitlines()[0]


def test_a_concern_still_wins_over_the_flag() -> None:
    """⚠️ A CONCERN'S OWN WORDS BEAT THIS SENTENCE. The merge absorbs the flag
    by `subject_key`; stamping must not turn a conclusion into a shrug."""
    text = _brief([
        {"source": "triage", "subject_key": "k1", "title": "Pool Pump",
         "domain": "", "outcome": reason.INVESTIGATED_NOTHING},
        {"source": "agent", "subject_key": "k1", "title": "Pool Pump is losing prime",
         "domain": "water"},
    ])
    assert "losing prime" in text
    assert "nothing to report" not in text, (
        "the flag's placeholder outlived the concern that replaced it")


def test_the_stamp_is_wired_to_the_end_of_an_investigation() -> None:
    """⚠️ PIN THE CALLER. `stamp_outcome` had exactly one call site — after
    `raise_concern` — and a unit test of the helper stays green through that
    omission, which is how this shipped."""
    import inspect
    src = inspect.getsource(reason)
    assert "_mark_looked_at(item)" in src, (
        "an investigation no longer records that it happened")
    assert "stamp_outcome" in inspect.getsource(reason._mark_looked_at)
