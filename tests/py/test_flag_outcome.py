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


# ── the writer and the stamper must agree on the key ────────────────────────
class _Esc:
    """A `triage.Escalation` as far as the key derivation is concerned."""
    def __init__(self, subject: str, entity_id: str = "") -> None:
        self.subject, self.entity_id = subject, entity_id


def test_the_writer_and_the_stamper_derive_the_same_key() -> None:
    """⚠️ THE DEFECT INSIDE THE FIX, FOUND BY THE OWNER ASKING WHAT CHANGED
    (2026-08-30). `scheduler` writes a flag's row keyed with the topic form
    whitespace-COLLAPSED; my first stamper used `.strip().lower()`. Those agree
    on "Pool Pump" and diverge on any subject with a doubled space or a tab —
    so the stamp silently matched nothing and the fix did nothing, for exactly
    the subjects nobody would think to test.

    ⚠️ THE CASE THAT DISCRIMINATES IS INTERNAL WHITESPACE. A test using only
    tidy names passes against both spellings, which is how this got committed.
    """
    from vesta.supervise.agent import contracts as agent_contracts

    for subject in ("Pool Pump", "Pool  Pump", "Main Power  Phase B",
                    "AP\tCorridor 2F", "  padded  name  "):
        item = _Esc(subject)
        # ⚠️ THE WRITER IS `contracts.flag_rows` NOW (2026-08-30) — the
        # scheduler's inline dict and its `_subject_key_of` alias were deleted
        # with the move, so the agreement is asserted where the keys are BORN:
        # every row a flag writes must carry a key the stamper will derive.
        written = {row["subject_key"]
                   for row in agent_contracts.flag_rows(item)}
        stamped = set(agent_contracts.subject_keys_of(item))
        assert written == stamped, (
            f"the writer and the stamper disagree about {subject!r}, so a "
            "flag can never be marked investigated")


def test_the_topic_form_matches_THE_CONCERN_not_merely_itself() -> None:
    """⚠️ THE PREVIOUS TEST SURVIVED A MUTATION AND THIS IS WHY. Asserting the
    writer and the stamper agree proves only that they share a function — swap
    the spelling inside it and both move together, still agreeing, still wrong.
    What matters is agreement with `concern._subject`, which is what a flag has
    to join: it collapses internal whitespace, so a doubled space MUST key the
    same as a single one. Under `.strip().lower()` it does not."""
    from vesta.supervise.agent import contracts as agent_contracts

    single = agent_contracts.subject_keys_of(_Esc("Pool Pump"))[0]
    doubled = agent_contracts.subject_keys_of(_Esc("Pool  Pump"))[0]
    tabbed = agent_contracts.subject_keys_of(_Esc("Pool\tPump"))[0]
    assert single == doubled == tabbed, (
        "the topic key is not whitespace-collapsed, so it cannot match the "
        "concern raised about the same subject")

    # …and the same string, keyed the way `concern._subject` keys it.
    expected = agent_contracts.subject_key("topic:pool pump")
    assert single == expected, (
        "the flag and the concern would hash one subject to two keys")


def test_an_entity_backed_subject_keys_on_the_id() -> None:
    """⚠️ AND THE ENTITY FORM WINS OVER THE TOPIC FORM, which is what lets a
    flag join the concern it becomes — the concern hashes the id."""
    from vesta.supervise.agent import contracts as agent_contracts
    keyed = agent_contracts.subject_keys_of(
        _Esc("anything at all", "sensor.x"))[0]
    assert keyed == agent_contracts.subject_key("sensor.x")


def test_the_derivation_has_one_home() -> None:
    """⚠️ `grep -L`. Two spellings of one key is what this whole family of bugs
    is; the scheduler must call `contracts.flag_rows` rather than keep an
    inline dict that ages — that inline dict is exactly where `title` was the
    model's phrasing for a release, so the pin now guards the CALLER
    (`feedback_pin-the-caller`: a perfect helper nobody calls changes
    nothing)."""
    import inspect
    from vesta.supervise.agent import contracts as agent_contracts
    from vesta.supervise.agent import scheduler as scheduler_mod
    body = inspect.getsource(scheduler_mod)
    assert "flag_rows(" in body, (
        "the scheduler no longer writes flags through contracts.flag_rows")
    rows_body = inspect.getsource(agent_contracts.flag_rows)
    assert "subject_key(" in rows_body and "subject_keys_of(" in rows_body, (
        "flag_rows re-derives the key instead of using the one owner")
    assert '" ".join' not in body, "a second spelling of the topic form is back"
