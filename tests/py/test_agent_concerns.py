"""The concern lifecycle: dedup, supersedes, verification. TEST-022, TEST-023.

⚠️ THE VERIFICATION TESTS ARE THE POINT. "It did not recur" and "I was not
listening" are the same empty observation and opposite facts, and this codebase
has now claimed health from silence in four separate places.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import concerns
from vesta.supervise.agent.contracts import subject_key


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(concerns, "CONCERNS_FILE", str(tmp_path / "c.json"))


def _c(**over: Any) -> concerns.Concern:
    base: Dict[str, Any] = {
        "subject_key": subject_key("pool pump"),
        "title": "The pool pump is short-cycling",
        "body": "It started 14 times in an hour against a usual 3.",
        "severity": "warning", "audience": "owner", "confidence": 0.8,
        "evidence": [{"tool": "read_salient", "args_digest": "abc",
                      "at": "2026-08-23T00:00:00Z", "summary": "14 starts"}],
    }
    base.update(over)
    return concerns.Concern(**base)


# ── raising ─────────────────────────────────────────────────────────────────
def test_a_concern_is_stored_with_an_id_and_timestamps() -> None:
    stored, reason = concerns.raise_concern(_c())
    assert stored is not None, reason
    assert stored.id and stored.opened_at and stored.updated_at
    assert len(concerns.read()) == 1


def test_a_concern_that_fails_its_contract_is_REFUSED() -> None:
    stored, reason = concerns.raise_concern(_c(severity="catastrophic"))
    assert stored is None and "catastrophic" in reason


# ── deduplication ───────────────────────────────────────────────────────────
def test_a_SECOND_concern_about_an_open_subject_is_refused() -> None:
    """TEST-022. ⚠️ REFUSED WITH A READABLE REASON, not silently merged and not
    silently duplicated. Merging hides a second, different fault on the same
    equipment; duplicating is the alert fatigue that kills systems like this."""
    first, _ = concerns.raise_concern(_c())
    assert first is not None
    second, reason = concerns.raise_concern(_c(title="pump noisy again"))
    assert second is None
    assert first.id in reason
    assert "supersede" in reason


def test_a_concern_that_SUPERSEDES_is_accepted_and_links() -> None:
    first, _ = concerns.raise_concern(_c())
    assert first is not None
    second, reason = concerns.raise_concern(
        _c(title="still short-cycling, now worse", supersedes=[first.id]))
    assert second is not None, reason
    rows = {r["id"]: r for r in concerns.read()}
    assert rows[first.id]["state"] == "closed"
    assert f"superseded by {second.id}" in rows[first.id]["outcome"]
    assert second.supersedes == [first.id]


def test_a_SETTLED_subject_may_open_a_fresh_concern() -> None:
    """⚠️ RECURRENCE IS A FINDING, NOT A DUPLICATE. A pump fault closed in
    March and returning in December deserves its own lifecycle; treating it as
    a duplicate is how a system stops reporting a problem it once solved."""
    first, _ = concerns.raise_concern(_c())
    assert first is not None
    ok, why = concerns.transition(first.id, "closed", outcome="serviced")
    assert ok, why
    again, reason = concerns.raise_concern(_c(title="it is back"))
    assert again is not None, reason


def test_a_DIFFERENT_subject_is_never_a_duplicate() -> None:
    concerns.raise_concern(_c())
    other, reason = concerns.raise_concern(
        _c(subject_key=subject_key("gate motor"), title="Gate did not close"))
    assert other is not None, reason


# ── lifecycle ───────────────────────────────────────────────────────────────
def test_every_transition_stamps_a_TIME() -> None:
    """⚠️ THE TIMESTAMP IS THE POINT. HA's todo list carries a status and NO
    completion time, which is exactly why the workbook records
    median-time-to-clear as NOT COMPUTABLE."""
    stored, _ = concerns.raise_concern(_c())
    assert stored is not None
    before = concerns.read()[0]["updated_at"]
    ok, _ = concerns.transition(stored.id, "acted", outcome="FM attended")
    assert ok
    row = concerns.read()[0]
    assert row["state"] == "acted" and row["outcome"] == "FM attended"
    assert row["updated_at"] >= before


def test_an_unknown_state_is_refused() -> None:
    stored, _ = concerns.raise_concern(_c())
    assert stored is not None
    ok, reason = concerns.transition(stored.id, "probably_fine")
    assert not ok and "probably_fine" in reason


def test_dismissed_is_NOT_closed() -> None:
    """⚠️ Closed means dealt with; dismissed means a person said it did not
    matter. Collapsing them loses the only signal alert-fatigue has."""
    assert "dismissed" in concerns.SETTLED and "closed" in concerns.SETTLED
    stored, _ = concerns.raise_concern(_c())
    assert stored is not None
    concerns.transition(stored.id, "dismissed", outcome="gym is closed")
    counts = concerns.summary()["by_state"]
    assert counts.get("dismissed") == 1 and "closed" not in counts


# ── verification ────────────────────────────────────────────────────────────
def test_incomplete_coverage_produces_CANNOT_VERIFY() -> None:
    """TEST-023. ⚠️ THE ONE THAT MATTERS. An absence during partial coverage is
    not evidence of anything, and calling it `verified` is the fourth instance
    of claiming health from silence in this codebase."""
    stored, _ = concerns.raise_concern(_c())
    assert stored is not None
    out = concerns.verify(stored.id, recurred=False, coverage_complete=False)
    assert out.verdict == "cannot_verify"
    assert "not listening" in out.reason
    assert concerns.read()[0]["state"] == "open", "it was closed on no evidence"


def test_complete_coverage_and_no_recurrence_VERIFIES() -> None:
    stored, _ = concerns.raise_concern(_c())
    assert stored is not None
    out = concerns.verify(stored.id, recurred=True and False,
                          coverage_complete=True)
    assert out.verdict == "verified"
    assert concerns.read()[0]["state"] == "verified"


def test_a_RECURRENCE_is_judged_even_when_coverage_was_partial() -> None:
    """⚠️ COVERAGE GATES THE ABSENCE, NOT THE OBSERVATION. A recurrence SEEN
    during partial coverage is still a real recurrence; only the silence is
    worthless. Checking coverage first would discard a fact that was observed.

    ⚠️ THE VERDICT IS THE SUBJECT OF THIS TEST; THE STATE IT WRITES IS NOT.
    This asserted `state == "open"` until 2026-08-28, incidentally pinning a
    transition that had never run — `verify` had no caller for its whole
    existence. Giving it one showed the re-open to be wrong (see `verify`), and
    the coverage-ordering rule this test is actually about is unchanged.
    """
    stored, _ = concerns.raise_concern(_c())
    assert stored is not None
    out = concerns.verify(stored.id, recurred=True, coverage_complete=False)
    assert out.verdict == "recurred", "partial coverage discarded an observation"
    assert concerns.read()[0]["state"] == "closed"


def test_a_RECURRENCE_NAMES_the_concern_it_came_back_as() -> None:
    """⚠️ "The fix did not hold" is a verdict; "it came back as c9" is a thread
    a reader can follow. The outcome is the only record joining the two."""
    stored, _ = concerns.raise_concern(_c())
    assert stored is not None
    concerns.verify(stored.id, recurred=True, coverage_complete=True,
                    recurred_as="c9")
    assert "c9" in concerns.read()[0]["outcome"]


# ── the store ───────────────────────────────────────────────────────────────
def test_the_summary_counts_only_LIVE_concerns_by_severity() -> None:
    a, _ = concerns.raise_concern(_c())
    b, _ = concerns.raise_concern(_c(subject_key=subject_key("gate"),
                                     severity="critical"))
    assert a and b
    concerns.transition(a.id, "closed")
    out = concerns.summary()
    assert out["open"] == 1
    assert out["by_severity"] == {"critical": 1}, out["by_severity"]


def test_a_broken_store_degrades_to_no_concerns() -> None:
    concerns.CONCERNS_FILE = "/nope/does/not/exist/c.json"
    assert concerns.read() == []
    assert concerns.summary()["total"] == 0


# ── the feedback loop · TASK-062 ────────────────────────────────────────────
def _dismiss(n: int) -> None:
    """Open and dismiss the same subject `n` times."""
    for i in range(n):
        stored, reason = concerns.raise_concern(_c(title=f"gym lights {i}"))
        assert stored is not None, reason
        # ⚠️ THE `dismiss` ACT'S TRANSITION, NOT A RATING (2026-08-28). What
        # counts toward silencing a subject is a DELIBERATE dismissal — which
        # makes this signal stronger than it was, when it could be produced as a
        # by-product of somebody rating the alert's quality.
        concerns.transition(stored.id, "dismissed",
                            outcome="dismissed by owner: gym is closed")


def test_marking_a_concern_USEFUL_does_NOT_settle_it() -> None:
    """⚠️ THE THUMB UP USED TO MAKE THE CARD DISAPPEAR, reported by the owner
    on 2026-08-27 and pinned here in the direction it should always have had.

    It wrote `state = "verified"`, and `verified` is in SETTLED — so paying the
    supervisor a compliment retired a concern nobody had acted on and nobody
    had acknowledged. One state had two writers meaning different things: the
    verification path means "the condition did not recur", a claim about the
    VILLA; this means "you were right to tell me", a claim about the
    SUPERVISOR. Only the first is a lifecycle event.
    """
    stored, _ = concerns.raise_concern(_c())
    assert stored is not None
    ok, why = concerns.feedback(stored.id, useful=True)
    assert ok, why
    row = concerns.read()[0]
    assert row["state"] == "open", (
        "a thumb up settled the concern, so the wall empties when somebody "
        "agrees with it")
    assert row["state"] not in concerns.SETTLED
    assert row["useful"] is True, "the verdict was not recorded at all"
    assert row["useful_at"], "no time was stamped on the verdict"


def test_a_USEFUL_verdict_keeps_its_note_out_of_outcome() -> None:
    """⚠️ `outcome` MEANS "WHY IT LEFT OPEN", and this concern has not left. A
    note written there would read, on every later render, as the reason a
    still-open concern was closed."""
    stored, _ = concerns.raise_concern(_c())
    assert stored is not None
    concerns.feedback(stored.id, useful=True, reason="good catch")
    row = concerns.read()[0]
    assert row["useful_note"] == "good catch"
    assert not row["outcome"]


def test_DISMISSED_is_not_CLOSED() -> None:
    """⚠️ Closed means dealt with; dismissed means somebody said it did not
    matter. Collapsing them loses the only signal alert fatigue has.

    ⚠️ IT IS REACHED BY THE `dismiss` ACT NOW, NOT BY A RATING (2026-08-28,
    owner's ruling). "-1 Less like this" tunes how often this KIND is raised and
    leaves the alert exactly where it was; throwing an alert away is its own
    control, and its label is the only one that says "completely"."""
    stored, _ = concerns.raise_concern(_c())
    assert stored is not None
    concerns.transition(stored.id, "dismissed",
                        outcome="dismissed by owner: the gym is closed")
    row = concerns.read()[0]
    assert row["state"] == "dismissed"
    assert "dismissed by" in row["outcome"]


def test_A_RATING_LEAVES_THE_ALERT_EXACTLY_WHERE_IT_WAS() -> None:
    """⚠️ NEITHER DIRECTION IS A LIFECYCLE EVENT, and the down one used to be
    (2026-08-28). Rating the SUPERVISOR's judgement disposed of the VILLA's
    problem — the same defect the up side was fixed for on 2026-08-27, when a
    thumb up wrote `verified` and the card vanished, one day before the mirror
    image of it was noticed."""
    for verdict in (True, False):
        # ⚠️ A DISTINCT SUBJECT EACH TIME — `raise_concern` refuses a second
        # concern on a subject that is already open, which is the dedupe rule
        # working and would otherwise silently make this a one-case test.
        stored, _ = concerns.raise_concern(
            _c(subject_key=subject_key(f"rating {verdict}"),
               title=f"t{verdict}"))
        assert stored is not None
        concerns.feedback(stored.id, useful=verdict, reason="a note")
        row = [r for r in concerns.read() if r["id"] == stored.id][0]
        assert row["state"] == "open", \
            f"a {'+1' if verdict else '-1'} moved the alert out of open"
        assert row["useful"] is verdict and row["useful_at"], \
            "the verdict was not recorded"
        assert not str(row.get("outcome") or ""), \
            "a rating wrote an outcome, which means 'why it left open'"


def test_the_REASON_is_kept_verbatim() -> None:
    """⚠️ THE MORE VALUABLE HALF. "the gym is closed for renovation" is a fact
    about the villa that should stop the whole FAMILY of gym concerns — PH-7
    turns it into a memory. A count alone discards what a person typed."""
    stored, _ = concerns.raise_concern(_c())
    assert stored is not None
    # ⚠️ ON THE DISMISSAL, WHICH IS WHERE IT NOW LANDS. A rating keeps its note
    # in `useful_note`; `outcome` means "why it left open" and a rating does not
    # take it out of open at all.
    concerns.transition(stored.id, "dismissed",
                        outcome="dismissed by owner: closed for renovation")
    assert "closed for renovation" in concerns.read()[0]["outcome"]
    stored2, _ = concerns.raise_concern(_c(title="another"))
    assert stored2 is not None
    concerns.feedback(stored2.id, useful=False, reason="closed for renovation")
    kept = [r for r in concerns.read() if r["id"] == stored2.id][0]
    assert kept["useful_note"] == "closed for renovation", \
        "a rating discarded the words somebody took the trouble to type"


def test_THREE_dismissals_suppress_the_subject() -> None:
    """⚠️ BY A COUNTER, NEVER BY AGENT JUDGEMENT. "Stop telling me about the
    gym lights" must work reliably rather than probabilistically — that is the
    difference between a feedback loop and a suggestion."""
    _dismiss(2)
    assert concerns.suppressed_subjects() == []
    _dismiss(1)
    assert concerns.suppressed_subjects() == [subject_key("pool pump")]


def test_the_count_comes_from_the_STORE_not_a_side_tally() -> None:
    """⚠️ A counter kept beside the concerns disagrees with them the first time
    one is edited or expires. The lifecycle IS the record."""
    _dismiss(3)
    assert concerns.dismissals_of(subject_key("pool pump")) == 3
    assert concerns.dismissals_of(subject_key("gate")) == 0


def test_suppression_and_the_GATE_have_different_owners() -> None:
    """⚠️ This decides WHICH subjects; `policy.is_suppressed` decides what that
    means for a run. Counting inside policy would make the authority boundary
    depend on a feedback tally; gating here would give the store a veto."""
    import inspect

    from vesta.supervise.agent import policy as policy_mod
    assert "dismiss" not in inspect.getsource(policy_mod.is_suppressed).lower()
    assert "suppressed_subjects" in inspect.getsource(policy_mod.is_suppressed)


def test_a_dismissal_of_ANOTHER_subject_does_not_count() -> None:
    _dismiss(2)
    other, _ = concerns.raise_concern(
        _c(subject_key=subject_key("gate"), title="gate"))
    assert other is not None
    concerns.transition(other.id, "dismissed", outcome="dismissed by owner")
    assert concerns.suppressed_subjects() == []
