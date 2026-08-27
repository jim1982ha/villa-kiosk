"""The caller TASK-046 specified and nobody wrote. TEST-023, REQ-037.

⚠️ THE FUNCTION UNDER TEST IS NOT `verify` — THAT ONE ALWAYS HAD TESTS. It had
tests and no caller, which is this repository's most repeated defect and the
reason `test_reachability` exists: a unit test proves a function computes the
right answer and says nothing about whether anything ever asks it. `verify` sat
in the EXEMPT map marked BLOCKED for its whole existence while the Reason tab's
"Fixed and confirmed" count — the one number on that screen that says something
actually worked — could only ever be zero.

⚠️ SO EVERY TEST HERE DRIVES THE SWEEP, NEVER `verify` DIRECTLY. A test that
called `verify` would pass today, would have passed throughout the years it was
unreachable, and would pass again if the sweep were deleted tomorrow. See
`feedback_pin-the-caller`, and `test_the_sweep_is_reached_from_the_villa_s_own
_clock` at the foot of this file, which is the assertion that would have caught
the original defect.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List, Mapping

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from agent import concerns                                    # noqa: E402

HOUR = 3600.0
WEEK = concerns.VERIFY_AFTER_HOURS * HOUR

#: A moment to hang every fixture off, so nothing here reads the wall clock.
#: ⚠️ 2026-06-01T00:00:00Z. A sweep whose fixtures are built from `time.time()`
#: is a sweep whose verdicts change with the hour it is run in.
NOW = 1780272000.0


def _iso(at: float) -> str:
    import time
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(at))


def _row(**over: Any) -> Dict[str, Any]:
    """One stored concern. Closed a fortnight ago unless told otherwise."""
    base: Dict[str, Any] = {
        "id": "c1", "subject_key": "abc123", "title": "The pool pump cycles",
        "body": "14 starts in an hour against a usual 3.",
        "severity": "warning", "audience": "owner", "confidence": 0.8,
        "state": "closed", "opened_at": _iso(NOW - 21 * 24 * HOUR),
        "updated_at": _iso(NOW - 14 * 24 * HOUR),
        "evidence": [], "supersedes": [], "outcome": "dealt with",
        "delivered_at": _iso(NOW - 21 * 24 * HOUR), "informational": False,
    }
    base.update(over)
    return base


def _store(rows: List[Dict[str, Any]], monkeypatch: pytest.MonkeyPatch,
           tmp_path: Any) -> None:
    from reports import store
    path = str(tmp_path / "c.json")
    monkeypatch.setattr(concerns, "CONCERNS_FILE", path)
    store.write_json(path, {"concerns": rows})


def _listening(_since: str) -> Mapping[str, Any]:
    """Coverage that says the collector was up throughout."""
    return {"complete": True}


def _deaf(_since: str) -> Mapping[str, Any]:
    return {"complete": False}


def _sweep(rows: List[Dict[str, Any]], monkeypatch: pytest.MonkeyPatch,
           tmp_path: Any, coverage: Any = _listening
           ) -> "concerns.VerificationSweep":
    _store(rows, monkeypatch, tmp_path)
    return concerns.verification_sweep(coverage_of=coverage, now=NOW)


def _field_of(field: str, concern_id: str) -> str:
    for row in concerns.read():
        if str(row.get("id")) == concern_id:
            return str(row.get(field))
    raise AssertionError(f"no concern {concern_id}")


def _state_of(concern_id: str = "c1") -> str:
    return _field_of("state", concern_id)


def _outcome_of(concern_id: str = "c1") -> str:
    return _field_of("outcome", concern_id)


# ── the three verdicts ──────────────────────────────────────────────────────
def test_a_fix_that_held_is_VERIFIED_and_the_state_says_so(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """The whole point: a count on the Reason tab that can be non-zero."""
    out = _sweep([_row()], monkeypatch, tmp_path)
    assert (out.considered, out.verified) == (1, 1)
    assert _state_of() == "verified"


def test_a_condition_that_CAME_BACK_is_RECORDED_not_resurrected(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ RECURRENCE IS READ FROM THE STORE. The later concern about the same
    subject IS the evidence; nothing re-asks the villa.

    ⚠️ AND IT MUST NOT RE-OPEN THE OLD ONE. The successor is open on the wall
    already, and `raise_concern` refuses a second open concern about one
    subject — so re-opening would create, from a background sweep, exactly the
    state the store's write path forbids: two cards for one problem, the older
    of them three weeks stale and carrying a delivery receipt from a fortnight
    ago.
    """
    later = _row(id="c2", state="open", opened_at=_iso(NOW - 3 * 24 * HOUR),
                 updated_at=_iso(NOW - 3 * 24 * HOUR))
    out = _sweep([_row(), later], monkeypatch, tmp_path)
    assert (out.recurred, out.verified) == (1, 0)
    assert _state_of() == "closed", "a recurrence must not put a card back"
    assert _outcome_of() == "the fix did not hold — it came back as c2"


def test_only_ONE_card_stands_for_a_subject_that_came_back(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """The rule above, stated as the thing a reader would notice."""
    later = _row(id="c2", state="open", opened_at=_iso(NOW - 3 * 24 * HOUR),
                 updated_at=_iso(NOW - 3 * 24 * HOUR))
    _sweep([_row(), later], monkeypatch, tmp_path)
    live = [r for r in concerns.read()
            if str(r.get("state")) not in concerns.SETTLED]
    assert len(live) == 1, f"{len(live)} open cards for one subject: {live}"


def test_the_EARLIEST_successor_is_the_one_named(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ THE FIX UNDER JUDGEMENT IS THE ONE THE FIRST RETURN DISPROVED. Naming
    the most recent would credit this concern's fix with holding through
    failures it did not survive."""
    second = _row(id="c2", state="closed", opened_at=_iso(NOW - 10 * 24 * HOUR),
                  updated_at=_iso(NOW - 9 * 24 * HOUR))
    third = _row(id="c3", state="open", opened_at=_iso(NOW - 3 * 24 * HOUR),
                 updated_at=_iso(NOW - 3 * 24 * HOUR))
    _sweep([_row(), second, third], monkeypatch, tmp_path)
    assert "c2" in _outcome_of("c1") and "c3" not in _outcome_of("c1")


def test_a_window_we_were_NOT_LISTENING_through_is_CANNOT_VERIFY(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ THIS MODULE'S FOUNDING SENTENCE. "It did not recur" and "I was not
    listening" are the same empty observation and opposite facts."""
    out = _sweep([_row()], monkeypatch, tmp_path, coverage=_deaf)
    assert (out.cannot_verify, out.verified) == (1, 0)
    assert _state_of() == "closed", "an unverifiable concern must not move"


def test_a_coverage_source_that_THROWS_is_cannot_verify_never_verified(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """A dependency that fell over must not certify a fix by default."""
    def _broken(_since: str) -> Mapping[str, Any]:
        raise RuntimeError("the collector buffer is unreadable")

    out = _sweep([_row()], monkeypatch, tmp_path, coverage=_broken)
    assert (out.cannot_verify, out.verified) == (1, 0)
    assert _state_of() == "closed"


# ── who is a candidate at all ───────────────────────────────────────────────
def test_a_concern_closed_YESTERDAY_is_left_alone(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ THE WATCH WINDOW IS THE CLAIM. Certifying a fix the morning after it
    was applied says nothing about whether it held."""
    out = _sweep([_row(updated_at=_iso(NOW - 24 * HOUR))], monkeypatch, tmp_path)
    assert out.considered == 0
    assert _state_of() == "closed"


def test_the_boundary_is_the_window_itself_not_a_day_either_side(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ BOTH SIDES, because a comparison that is wrong by one direction
    passes every test written from the other."""
    just_under = _sweep([_row(updated_at=_iso(NOW - WEEK + 60))],
                        monkeypatch, tmp_path)
    assert just_under.considered == 0, "younger than the window must wait"
    just_over = _sweep([_row(updated_at=_iso(NOW - WEEK - 60))],
                       monkeypatch, tmp_path)
    assert just_over.considered == 1, "older than the window must be judged"


@pytest.mark.parametrize("state", ["open", "acted", "dismissed", "verified"])
def test_only_a_CLOSED_concern_is_ever_verified(
        state: str, monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ EVERY EXCLUSION IS A DIFFERENT CLAIM, and `dismissed` is the one that
    matters most: a person said it did not matter, and re-opening it is exactly
    the alert fatigue this system exists to remove."""
    out = _sweep([_row(state=state)], monkeypatch, tmp_path)
    assert out.considered == 0, f"{state} must not be a verification candidate"
    assert _state_of() == state


def test_an_INFORMATIONAL_concern_is_never_counted_as_a_fix(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """Nothing was asked of anybody, so no action's success is in question. A
    "Fixed and confirmed" count inflated by FYIs claims work nobody did."""
    out = _sweep([_row(informational=True)], monkeypatch, tmp_path)
    assert out.considered == 0
    assert _state_of() == "closed"


def test_a_SUPERSEDED_concern_is_not_a_fixed_one(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ IT WAS NEVER RESOLVED, IT WAS RE-DESCRIBED. Counting these would put
    the villa's worst-behaved subjects at the top of the one count that is
    supposed to mean something improved."""
    successor = _row(id="c2", state="open", supersedes=["c1"],
                     opened_at=_iso(NOW - 13 * 24 * HOUR),
                     updated_at=_iso(NOW - 13 * 24 * HOUR))
    out = _sweep([_row(outcome="superseded by c2"), successor],
                 monkeypatch, tmp_path)
    assert out.considered == 0
    assert _state_of() == "closed"


def test_supersession_is_read_from_the_LINK_not_from_the_outcome_prose(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ THE RULE MUST NOT DEPEND ON A SENTENCE A FUTURE EDIT MAY REPHRASE.
    Same structure as above with the prose changed; the verdict must not move."""
    successor = _row(id="c2", state="open", supersedes=["c1"],
                     opened_at=_iso(NOW - 13 * 24 * HOUR),
                     updated_at=_iso(NOW - 13 * 24 * HOUR))
    out = _sweep([_row(outcome="replaced, see the newer one"), successor],
                 monkeypatch, tmp_path)
    assert out.considered == 0, "the link decides, not the wording"


# ── the recurrence rule itself ──────────────────────────────────────────────
def test_recurrence_is_DIRECTIONAL_one_pair_two_opposite_verdicts(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ THE SUBJECT'S WHOLE HISTORY MATCHES ON THE KEY; only what came back
    AFTER a fix says that fix did not hold.

    ⚠️ ONE PAIR OF ROWS, JUDGED BOTH WAYS, which is what makes this test able
    to fail. An aggregate count over the pass cannot distinguish a direction
    bug — swapping `>` for `<` gives two recurrences here and two verifieds if
    the pair is chosen carelessly, and both look plausible. The older concern
    genuinely DID recur (the same subject came back as c1 twenty-one days
    later) and the newer one genuinely did not, so the two verdicts must be
    opposite and a reversed comparison swaps them.
    """
    earlier = _row(id="c0", state="closed",
                   opened_at=_iso(NOW - 60 * 24 * HOUR),
                   updated_at=_iso(NOW - 59 * 24 * HOUR))
    out = _sweep([earlier, _row()], monkeypatch, tmp_path)
    assert (out.considered, out.verified, out.recurred) == (2, 1, 1)
    assert _outcome_of("c0") == "the fix did not hold — it came back as c1", (
        "the subject came back after c0 closed")
    assert _state_of("c1") == "verified", "nothing came back after c1 closed"


def test_a_DIFFERENT_subject_reopening_is_not_this_concern_s_recurrence(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    other = _row(id="c2", subject_key="zzz999", state="open",
                 opened_at=_iso(NOW - 3 * 24 * HOUR))
    out = _sweep([_row(), other], monkeypatch, tmp_path)
    assert (out.recurred, out.verified) == (0, 1)


def test_a_concern_with_NO_SUBJECT_KEY_can_never_recur(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ ABSENT MEANS UNKNOWN, AND UNKNOWN IS NOT A MATCH. Two keyless rows
    would otherwise certify each other as recurrences, and a whole class of
    topic-only findings would go round in circles."""
    keyless = _row(subject_key="")
    other = _row(id="c2", subject_key="", state="open",
                 opened_at=_iso(NOW - 3 * 24 * HOUR))
    out = _sweep([keyless, other], monkeypatch, tmp_path)
    assert out.recurred == 0


def test_a_concern_does_not_count_as_its_OWN_recurrence(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """Its own `opened_at` is before its own `updated_at`, so this passes for
    the wrong reason unless the id is also excluded — hence a row whose stamps
    would match it."""
    weird = _row(opened_at=_iso(NOW - 2 * 24 * HOUR))
    out = _sweep([weird], monkeypatch, tmp_path)
    assert out.recurred == 0, "a concern cannot be the evidence against itself"


# ── coverage is asked the right question ────────────────────────────────────
def test_coverage_is_asked_about_the_WATCH_WINDOW_not_about_the_last_week(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ THE WINDOW STARTS WHEN THE CONCERN CLOSED. For a concern the sweep is
    late to, "were you listening for the last seven days" and "were you
    listening since this closed" are different questions with different
    answers, and only the second is what the verdict claims."""
    asked: List[str] = []

    def _record(since: str) -> Mapping[str, Any]:
        asked.append(since)
        return {"complete": True}

    settled = _iso(NOW - 30 * 24 * HOUR)
    _sweep([_row(updated_at=settled)], monkeypatch, tmp_path, coverage=_record)
    assert asked == [settled], (
        f"coverage was asked about {asked}, not the moment it was closed")


# ── the instrument ──────────────────────────────────────────────────────────
def test_a_pass_with_NOTHING_TO_JUDGE_says_nothing(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ SILENCE MEANS "NOTHING WAS DUE", AND THAT IS THE ONLY THING IT MAY
    MEAN. This test asserted the opposite until the design was corrected: it
    pinned that a pass which GAVE UP also stayed silent, which is what made the
    sweep unobservable on a live villa — the one villa where you cannot simply
    run it again with a fixture. Now every verdict is written once, so a quiet
    pass is a pass with no candidates."""
    out = _sweep([_row(updated_at=_iso(NOW - 24 * HOUR))], monkeypatch, tmp_path)
    assert (out.considered, out.changed()) == (0, False)


def test_a_pass_that_DID_something_reports_it(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    out = _sweep([_row()], monkeypatch, tmp_path)
    assert out.changed() and "verified 1" in out.line()


def test_an_empty_store_is_not_an_error(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    out = _sweep([], monkeypatch, tmp_path)
    assert (out.considered, out.verified, out.changed()) == (0, 0, False)


# ── the assertion that would have caught the original defect ────────────────
def test_the_sweep_is_reached_from_the_villa_s_own_clock() -> None:
    """⚠️ THE ONE THAT MATTERS. `verify` had unit tests for years and no
    caller; every one of them passed throughout. This asserts the WIRING —
    that `scheduler.dispatch`, the function with both the six-hourly clock and
    the owner's "Check the villa now" behind it, actually runs the sweep.

    Source-level rather than behavioural because `dispatch` needs a live Home
    Assistant session, and a test that mocked one deeply enough to run it would
    be asserting its own scaffolding. ⚠️ COMMENTS ARE STRIPPED FIRST: four pins
    in this repo have matched the comment recording their own fix rather than
    the code, and the block above this call site names the function twice.
    """
    import inspect
    import re
    from agent import scheduler

    src = inspect.getsource(scheduler.dispatch)
    code = re.sub(r"#[^\n]*", "", src)
    assert "verification_sweep" in code, (
        "nothing on the villa's clock calls the verification sweep — which is "
        "exactly the state `verify` was in for its whole existence")


def test_the_sweep_runs_BEFORE_delivery_so_a_recurrence_can_be_carried() -> None:
    """A concern the sweep returns to `open` must be visible to the delivery
    sweep in the SAME pass, or it waits six hours for the next clock."""
    import inspect
    import re
    from agent import scheduler

    code = re.sub(r"#[^\n]*", "", inspect.getsource(scheduler.dispatch))
    assert code.index("verification_sweep") < code.index("outbox_mod.sweep"), (
        "verification must run before the delivery sweep, not after it")


# ── what the owner sees on the Reason tab ───────────────────────────────────
#
# ⚠️ THE COMPUTATION IS PINNED ABOVE; THIS PINS THE RENDER. A count can be
# correct in the store and absent from every screen, which is precisely the
# state "Fixed and confirmed" was in for the whole life of this feature — the
# backend had five lifecycle states and the wall showed two. There is no JS
# test runner in this repo, so a source read is the cheapest thing that
# notices; `test_cockpit_rows.py` established the idiom for the same reason.

_LIFECYCLE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "src", "components", "agent", "ConcernLifecycle.tsx")


def _tsx() -> str:
    """The component's source with its comment blocks removed.

    ⚠️ STRIPPED AS BLOCKS. Four pins in this repo have matched the comment
    recording their own fix rather than the code, and every claim below is
    spelled out in the comments beside it.
    """
    import re
    with open(_LIFECYCLE, encoding="utf-8") as handle:
        src = handle.read()
    return re.sub(r"\{/\*[\s\S]*?\*/\}", "", re.sub(r"/\*[\s\S]*?\*/", "", src))


def test_the_reason_tab_can_say_a_fix_FAILED_not_only_that_one_worked() -> None:
    """⚠️ A SCREEN THAT CAN REPORT SUCCESS AND NOT FAILURE REPORTS A 100%
    SUCCESS RATE BY CONSTRUCTION. Both verdicts come out of the same sweep, in
    the same pass, from the same evidence.

    ⚠️ ANCHORED ON THE `<dt>/<dd>` PAIR, NOT ON THE WORDS. The first cut of
    this asserted `"Came back" in code` and SURVIVED deleting the whole row,
    because the phrase also appears in the InfoHint prose explaining it — a pin
    matching the text that describes a feature rather than the feature.
    `feedback_mutation-testing` calls it "anchor on the DECLARATION, not the
    token", and it is why that rule exists.

    ⚠️ THE ANCHOR HAS MOVED TWICE IN ONE DAY AND BOTH TIMES THE PIN CAUGHT IT
    — first when the counts became download buttons, then when the owner moved
    the press from the NUMBER onto the LABEL. That is it working: it was
    anchored on the exact declaration each time rather than on a loose word.
    It now holds the two things that must be true whatever wraps them — the
    label is on screen, and the number is rendered in its own `<dd>` — because
    those survive any further re-arrangement of the control around them.
    """
    code = _tsx()
    assert "Came back" in code, "the failed-fix count has no surface"
    assert "<dd>{cameBack}</dd>" in code, "the label renders no number beside it"


def test_the_settled_counts_ADD_UP_to_what_was_settled() -> None:
    """⚠️ "Came back" IS A SLICE OF `closed`, NOT A SIXTH STATE. Rendered as a
    breakdown, three numbers that double-count give a reader more concerns than
    the villa ever had."""
    assert 'by("closed") - cameBack' in _tsx(), (
        "the Closed count still includes the ones that came back, so the "
        "breakdown sums to more than the settled set")


def test_the_screen_and_the_store_agree_on_what_a_FAILED_FIX_LOOKS_LIKE() -> None:
    """⚠️ PYTHON ONE SIDE, A STRING LITERAL THE OTHER, NOTHING BETWEEN THEM —
    the shape of the wire-key defect this repo paid a release for in 2.545.0.
    The browser recognises a failed fix by the prefix Python writes, so the two
    must be checked against each other rather than trusted to stay in step."""
    import inspect
    written = inspect.getsource(concerns.verify)
    assert '"the fix did not hold"' in written.replace("'", '"') or (
        'the fix did not hold' in written), "the store's wording moved"
    assert 'startsWith("the fix did not hold")' in _tsx(), (
        "the screen looks for a different prefix than the store writes")


# ── a question that cannot be answered is asked ONCE ────────────────────────
def test_an_UNVERIFIABLE_concern_is_not_asked_about_again(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ COVERAGE OF A PAST WINDOW IS IMMUTABLE. `online_since` is written at
    the first successful subscribe and never cleared, so the answer for a fixed
    window can never improve — re-asking is cost with no possible new
    information, four times a day, forever.

    ⚠️ THE SECOND SWEEP RUNS A FORTNIGHT LATER, AND THAT IS THE WHOLE TEST.
    Run at the same instant it passes for the wrong reason: recording the
    verdict stamps `updated_at`, so the concern falls back inside the watch
    window and the WINDOW check skips it — which masked a deleted filter
    completely. Moving the clock past the window again leaves the outcome
    filter as the only thing that can stop it.
    """
    _store([_row()], monkeypatch, tmp_path)
    first = concerns.verification_sweep(coverage_of=_deaf, now=NOW)
    assert first.cannot_verify == 1
    later = NOW + 14 * 24 * HOUR
    second = concerns.verification_sweep(coverage_of=_deaf, now=later)
    assert second.considered == 0, "the same unanswerable question was re-asked"


def test_giving_up_records_WHY_and_leaves_the_state_alone(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ `verify`'s CONTRACT IS THAT AN UNVERIFIABLE CONCERN DOES NOT MOVE
    STATE, and that is right and separately pinned. The attempt is recorded
    beside the state, the way an acknowledgement is."""
    _sweep([_row()], monkeypatch, tmp_path, coverage=_deaf)
    assert _state_of() == "closed"
    assert _outcome_of().startswith(concerns.UNVERIFIABLE)
    assert "not listening" in _outcome_of(), "it does not say why it gave up"


def test_giving_up_is_NOT_counted_as_a_failed_fix(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ THE TWO OUTCOMES SHARE A FIELD AND MUST NOT SHARE A PREFIX. The
    Reason tab reads "the fix did not hold" to count what came back; if giving
    up wrote something that also matched, every villa with a restarted
    collector would report failed fixes it never had."""
    _sweep([_row()], monkeypatch, tmp_path, coverage=_deaf)
    assert not _outcome_of().startswith("the fix did not hold")


def test_the_sweep_SAYS_SO_when_it_gives_up(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """⚠️ AN EARLIER CUT SUPPRESSED THIS LINE — correctly, for a sweep that
    repeated itself, which is what made the whole subsystem unobservable on a
    live villa. Now that each verdict is written once, silence means nothing
    was judged."""
    out = _sweep([_row()], monkeypatch, tmp_path, coverage=_deaf)
    assert out.changed(), "a pass that gave up reported nothing"
    assert "could not verify 1" in out.line()
