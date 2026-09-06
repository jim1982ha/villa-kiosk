"""Ranking the villa must not re-read the journal once per device.

⚠️ IT DID, AND THE ONLY PIN WAS A SOURCE-TEXT PIN. `build_document` handed
`apply_weights` a lambda that looked free — `lambda s: flag_type_of(entity_id)`
— and `flag_type_of` called `build_scorer()` with no rows, which reads the
ENTIRE journal (a ring bounded at JOURNAL_MAX_ENTRIES = 105,000) and re-scores
every entity, to read three fields off one of them. Once per scorable entity.

⚠️ INVISIBLE FOR THREE REASONS, ALL OF THEM REASONABLE ON THEIR OWN.
`apply_weights` early-returns when the weights store is empty — and an empty
default is CORRECT under the first hard rule — so the cost appears only after an
owner presses their first Rating. `test_flag_types.py` pinned the composition by
asserting a LITERAL appears in the source, which cannot see a cost. And
`test_agent_sources.py` guards byte-stability with `build_document(rows=[])`, an
empty journal and an empty weights store, so it exercises neither path.

There was a correctness leak on the same line: `build_document` threads `now`
into its scorer, `flag_type_of` did not, so a kind's direction was computed
against a differently-timed scoring of the same journal than the list being
re-ranked — which the function's own docstring forbade in as many words.
"""

import time

import pytest

from vesta.supervise.agent import flagtypes as flagtypes_mod
from vesta.supervise.agent import sources as sources_mod
from vesta.supervise.observe import journal as journal_mod


def _journal_of(n_entities: int):
    """Journal entries for `n_entities` devices, real enough to be SCORED.

    ⚠️ THE SHAPE IS `{id, s, at}` — not `entity_id`/`state`. I wrote this from
    the field names I expected and it produced no scorable row, which would have
    made the cost assertion pass while measuring an empty list.
    """
    entries = []
    for i in range(n_entities):
        eid = "sensor.probe_%02d" % i
        for day in range(1, 25):
            entries.append({"id": eid, "at": "2026-08-%02dT12:00:00" % day,
                            "s": str(100 + day + i)})
        # A last reading well off the baseline, so the numeric lens has
        # something to say and `score` is not None.
        entries.append({"id": eid, "at": "2026-08-25T12:00:00", "s": "9000"})
    return {"entries": entries, "online_since": "2026-08-01T00:00:00",
            "last_seen": "2026-08-25T12:00:00"}


def _count_reads(monkeypatch, n_entities: int, tmp_path) -> int:
    doc = _journal_of(n_entities)
    calls = {"n": 0}

    def read():
        calls["n"] += 1
        return doc

    monkeypatch.setattr(journal_mod, "read", read)
    monkeypatch.setattr(sources_mod, "MEASURES_FILE", str(tmp_path / "m.json"))
    _weighted(monkeypatch)
    sources_mod.build_document()
    return calls["n"]


@pytest.fixture()
def counted_journal(monkeypatch):
    doc = _journal_of(2)
    calls = {"n": 0}

    def read():
        calls["n"] += 1
        return doc

    monkeypatch.setattr(journal_mod, "read", read)
    return calls


def _weighted(monkeypatch, key="sensor:above"):
    """A non-empty weights store, so `apply_weights` does not early-return."""
    monkeypatch.setattr(flagtypes_mod, "read", lambda: {key: {"factor": 0.5}})


def test_journal_reads_do_not_SCALE_with_the_number_of_devices(monkeypatch, tmp_path):
    """⚠️ THE ASSERTION THE OLD SHAPE COULD NOT PASS, and the one that cannot be
    faked by a small fixture.

    `build_document` legitimately reads the journal a fixed number of times. The
    defect was not the constant — it was that the count grew by ONE PER SCORABLE
    DEVICE, through a lambda that looks free. So the invariant is O(1) in the
    device count, not a magic number: a villa with 40 devices must cost the same
    reads as a villa with 2.
    """
    few = _count_reads(monkeypatch, 2, tmp_path)
    many = _count_reads(monkeypatch, 40, tmp_path)
    assert few == many, (
        "the journal was read %d times for 2 devices and %d times for 40 — the "
        "cost grows per device, which is the per-entity re-scoring returning"
        % (few, many))


def test_the_weights_still_reach_the_ranking(counted_journal, monkeypatch, tmp_path):
    """The cost fix must not quietly stop the owner's Ratings applying.

    ⚠️ NO `pytest.skip` HERE. A fixture that produced no scorable row would make
    this pass while measuring nothing, which is the failure mode the cost pin
    above already suffered once — so an empty list is a FAILURE.
    """
    monkeypatch.setattr(sources_mod, "MEASURES_FILE", str(tmp_path / "m.json"))
    rows = list(sources_mod.build_scorer()())
    scorable = [r for r in rows if r.score is not None]
    assert scorable, (
        "the fixture produced no scorable row, so this test would assert "
        "nothing about weighting")

    key = sources_mod.flag_type_of_row(scorable[0], {})
    assert key, "a scored row must resolve to a kind"

    # ⚠️ CAPTURE THE SCORES FIRST — `apply_weights` MUTATES `item.score` IN
    # PLACE (its own docstring says so), so `list(scorable)` is the same objects
    # and a "before" read afterwards is the "after". I got this wrong on the
    # first write and the test failed for that reason rather than a real one.
    before = {r.entity_id: r.score for r in scorable}
    monkeypatch.setattr(flagtypes_mod, "read", lambda: {key: {"factor": 0.5}})
    weighted = flagtypes_mod.apply_weights(
        list(scorable), lambda s: sources_mod.flag_type_of_row(s, {}))
    assert any(w.score != before[w.entity_id] for w in weighted), (
        "a demerit of 0.5 changed no score, so taught preferences reach nothing")
    assert all(w.score == before[w.entity_id] * 0.5 for w in weighted), (
        "the stored number IS the multiplier — see factor_of's docstring")


def test_the_direction_comes_from_the_ROW_not_a_second_scoring(tmp_path, monkeypatch):
    """⚠️ THE DOCSTRING'S OWN PROMISE, NOW TRUE BY CONSTRUCTION.

    A row carries `observed` and `baseline`; the kind must be derived from THOSE
    and not from whatever a fresh, differently-timed scoring would say.
    """
    monkeypatch.setattr(sources_mod, "MEASURES_FILE", str(tmp_path / "m.json"))

    class Row:
        entity_id = "sensor.probe_one"
        observed = 900.0
        baseline = 100.0
        novel_state = None

    above = sources_mod.flag_type_of_row(Row(), {})
    Row.observed, Row.baseline = 100.0, 900.0
    below = sources_mod.flag_type_of_row(Row(), {})
    assert above and below and above != below, (
        "the direction is not read off the row: %r vs %r" % (above, below))


def test_an_offline_row_reads_as_offline(tmp_path, monkeypatch):
    monkeypatch.setattr(sources_mod, "MEASURES_FILE", str(tmp_path / "m.json"))

    class Row:
        entity_id = "sensor.probe_one"
        observed = None
        baseline = None
        novel_state = "unavailable"

    assert sources_mod.flag_type_of_row(Row(), {}), "an offline row has a kind"


def test_a_row_with_no_entity_id_has_no_kind(tmp_path, monkeypatch):
    class Row:
        entity_id = ""
    assert sources_mod.flag_type_of_row(Row(), {}) == ""


# ── The pass outcome is fields, not a sentence to re-parse ─────────────────

def test_a_colon_in_a_subject_cannot_be_read_as_a_count() -> None:
    """⚠️ THE HAZARD THE OLD WIRE FORMAT COULD NOT SURVIVE.

    `run_once` recovered the count from `head.split()[1]` and the subjects from
    everything after the first `": "`. Nothing stopped a NEW guard in
    `_run_once` returning a sentence beginning "escalated " and having a count
    and a Subject list attributed to it — and a Subject containing a colon split
    the list in the wrong place.
    """
    from vesta.supervise.agent import scheduler as sched

    outcome = sched.PassOutcome(
        reason="escalated 2 (investigated 1): pump: north, gate",
        escalated=2, subjects=("pump: north", "gate"))
    assert outcome.escalated == 2
    assert outcome.subject_line == "pump: north, gate"
    # And the sentence a reader sees is untouched by any of that.
    assert outcome.reason.startswith("escalated 2 ")


def test_every_guard_returns_the_record_so_none_can_be_misread() -> None:
    """A guard that returned a bare string would be parsed as a sentence again."""
    import inspect
    import re

    from conftest import strip_prose
    from vesta.supervise.agent import scheduler as sched

    body = strip_prose(inspect.getsource(sched._run_once))
    bare = re.findall(r'^\s+return (?!PassOutcome)(\S.*)$', body, re.M)
    assert not bare, (
        "these return points do not carry the record, so their reason would be "
        "re-parsed by whatever reads it: %r" % bare)


def test_the_count_and_the_subjects_are_not_recovered_from_the_sentence() -> None:
    """Pins the direction this was fixed in."""
    import inspect

    from conftest import strip_prose
    from vesta.supervise.agent import scheduler as sched

    body = strip_prose(inspect.getsource(sched.run_once))
    assert 'partition(": ")' not in body, (
        "run_once is parsing its own sentence again")
    assert "head.split()" not in body, (
        "run_once is recovering the count from a word position again")
    assert "outcome.escalated" in body and "outcome.subject_line" in body, (
        "the audit row is no longer fed from the record's fields")
