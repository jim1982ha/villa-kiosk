"""Scoring a KIND of finding, never a device. REQ-038.

⚠️ THE SCREEN PROMISED THIS BEFORE THE CODE DID. The thumb buttons on the Reason
tab have read "the villa raises this kind more readily" since they shipped,
while a verdict only ever counted toward silencing ONE device. These tests pin
the half that was missing, and the one that matters most is at the foot of the
file: that pressing a thumb actually REACHES it. A vocabulary with no caller
would be the ninth instance of this repository's most repeated defect, and
`concerns.verify` — fixed three releases ago — is the eighth.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from agent import flagtypes                                   # noqa: E402


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(flagtypes, "FLAG_TYPES_FILE", str(tmp_path / "ft.json"))


class _Row:
    """A stand-in salience row: a score, an entity and nothing else needed."""

    def __init__(self, entity_id: str, score: Any, reason: str = "because") -> None:
        self.entity_id = entity_id
        self.score = score
        self.reason = reason


# ── the key is about the measurement, not the device ────────────────────────
def test_TWO_DIFFERENT_DEVICES_MEASURING_THE_SAME_THING_SHARE_A_KIND() -> None:
    """⚠️ THE OWNER'S EXPLICIT INSTRUCTION — "make sure the device itself is
    irrelevant for this scoring". This is that sentence, executable: an NVR and
    a camera both reporting a data rate above their own baseline are ONE kind,
    so judging either teaches the villa about both."""
    nvr = flagtypes.key_for(
        flagtypes.measurement_of(device_class="data_rate"), flagtypes.ABOVE)
    camera = flagtypes.key_for(
        flagtypes.measurement_of(device_class="data_rate"), flagtypes.ABOVE)
    assert nvr == camera == "data rate:above"


def test_the_DIRECTION_is_part_of_the_kind() -> None:
    """⚠️ IT MAY NEVER BE COLLAPSED. "Temperature above baseline" in a plant
    room and "temperature below baseline" in the same room are opposite
    findings; merging them would let a demerit for a summer nuisance hide a
    frozen pipe."""
    hot = flagtypes.key_for("temperature", flagtypes.ABOVE)
    cold = flagtypes.key_for("temperature", flagtypes.BELOW)
    assert hot != cold


def test_device_class_BEATS_unit_which_beats_domain() -> None:
    """⚠️ THE ORDER IS THE CORRECTNESS ARGUMENT. A unit is ambiguous — `%` is a
    battery, a humidity and a valve position — and grouping those three would
    let one demerit silence the other two."""
    assert flagtypes.measurement_of(device_class="battery", unit="%",
                                    domain="sensor") == "battery"
    assert flagtypes.measurement_of(unit="kWh", domain="sensor") == "energy"
    assert flagtypes.measurement_of(domain="lock") == "lock"


def test_an_unclassifiable_reading_still_GROUPS_rather_than_vanishing() -> None:
    """⚠️ NAMED, NOT BLANK. A kind nobody could classify must still appear in
    the list an owner can tune; a silent bucket would be this project's "0 that
    means not measured" in a new place."""
    assert flagtypes.measurement_of() == flagtypes.UNCLASSIFIED
    assert flagtypes.label_of("reading:changed").startswith("Reading")


def test_a_device_that_STOPPED_REPORTING_is_not_filed_as_below_baseline() -> None:
    """⚠️ `offline` WINS OVER THE NUMBERS. A dead sensor's last value is not an
    observation, and filing it under "below baseline" would put it in the same
    kind as a cold room — which an owner may well have demerited."""
    assert flagtypes.direction_of(1.0, 9.0, offline=True) == flagtypes.OFFLINE
    assert flagtypes.direction_of(1.0, 9.0) == flagtypes.BELOW


def test_a_reading_with_no_baseline_cannot_claim_a_direction() -> None:
    assert flagtypes.direction_of(5.0, None) == flagtypes.CHANGED
    assert flagtypes.direction_of(None, 5.0) == flagtypes.CHANGED


def test_the_label_is_derived_from_the_key_not_stored_beside_it() -> None:
    """So an imported file cannot rename a kind into something it is not."""
    assert flagtypes.label_of("energy:above") == "Energy above baseline"
    assert flagtypes.label_of("battery:below") == "Battery below baseline"
    assert flagtypes.label_of("lock:offline") == "Lock stopped reporting"


# ── the arithmetic ──────────────────────────────────────────────────────────
def test_the_STORED_NUMBER_IS_THE_MULTIPLIER_with_nothing_derived() -> None:
    """⚠️ THE OWNER'S DESIGN, IN ONE ASSERTION. "1.1 is promoted by 10%, 0.8 is
    demoted by 20%." There is no second function turning a score into an
    effect — the value on screen is the value that multiplies — which is why
    the settings row needs no sentence explaining its own number."""
    flagtypes.record("energy:above", useful=True)
    assert flagtypes.factor_of("energy:above") == 1.1
    rows = [_Row("sensor.a", 10.0)]
    out = flagtypes.apply_weights(rows, lambda r: "energy:above")
    assert out[0].score == pytest.approx(11.0)


def test_ONE_PRESS_IS_A_TENTH_in_both_directions() -> None:
    """⚠️ THE STEP IS THE SERVER'S, AND IT IS SMALL ON PURPOSE. The first cut
    doubled the ranking on the first press, which makes a control feel unsafe
    to try."""
    flagtypes.record("energy:above", useful=True)
    flagtypes.record("energy:above", useful=True)
    assert flagtypes.factor_of("energy:above") == 1.2
    flagtypes.record("energy:above", useful=False)
    assert flagtypes.factor_of("energy:above") == 1.1


def test_TEN_PRESSES_DO_NOT_DRIFT_off_the_tenths() -> None:
    """⚠️ `1.1 + 0.1` IS `1.2000000000000002` IN BINARY FLOATING POINT. Without
    rounding at the write, ten presses produce a number no screen can print and
    no export can round-trip — and the drift is invisible until an owner's list
    stops matching what they pressed."""
    for _ in range(10):
        flagtypes.record("energy:above", useful=True)
    factor = flagtypes.factor_of("energy:above")
    assert factor == 2.0, factor
    assert str(factor) == "2.0"


def test_the_dial_NEVER_REACHES_ZERO() -> None:
    """⚠️ THE FLOOR IS THE "re-rank, never mute" RULE AS A NUMBER. At 0.0 a
    kind's novelty is annihilated whatever it reads, which is the hard gate the
    owner declined; at 0.1 an extreme reading still outranks an ordinary one of
    a kind nobody demerited."""
    for _ in range(200):
        flagtypes.record("energy:above", useful=False)
    assert flagtypes.factor_of("energy:above") == flagtypes.MIN_FACTOR
    assert flagtypes.MIN_FACTOR > 0


def test_the_factor_is_BOUNDED_in_both_directions() -> None:
    """A run of irritated thumbs must not become the hard gate the owner
    declined.

    ⚠️ THE ASSERTION IS ON THE STORED ROW, NOT ON `factor_of`. That reader
    clamps too, so a test written through it passes with the write-side clamp
    deleted — the value on disk would then be unbounded and travel out through
    an export. Found by mutation, which is the only thing that could find it.
    """
    for _ in range(50):
        flagtypes.record("energy:above", useful=False)
    assert flagtypes.read()["energy:above"]["factor"] == flagtypes.MIN_FACTOR
    for _ in range(200):
        flagtypes.record("energy:above", useful=True)
    assert flagtypes.read()["energy:above"]["factor"] == flagtypes.MAX_FACTOR


def test_an_UNJUDGED_kind_weighs_nothing() -> None:
    assert flagtypes.factor_of("never:above") == flagtypes.NEUTRAL


def test_the_COUNTS_survive_beside_the_weight() -> None:
    """⚠️ A WEIGHT OF 0 IS REACHED TWO WAYS — never judged, and judged once each
    way — and those are opposite facts about how settled an opinion is."""
    flagtypes.record("energy:above", useful=True)
    flagtypes.record("energy:above", useful=False)
    row = flagtypes.read()["energy:above"]
    assert (row["factor"], row["up"], row["down"]) == (1.0, 1, 1)


# ── what it does to a check ─────────────────────────────────────────────────
def test_a_DEMERITED_kind_sinks_and_a_PROMOTED_one_rises() -> None:
    for _ in range(2):
        flagtypes.record("energy:above", useful=False)
    rows = [_Row("sensor.a", 10.0), _Row("sensor.b", 3.0)]
    out = flagtypes.apply_weights(
        rows, lambda r: "energy:above" if r.entity_id == "sensor.a" else "")
    assert out[0].score == pytest.approx(8.0), "a demerited kind did not sink"
    assert out[1].score == 3.0, "an unjudged kind was moved"


def test_nothing_is_ever_REFUSED_for_its_kind_alone() -> None:
    """⚠️ THE OWNER CHOSE RE-RANKING OVER A HARD GATE, and the difference is
    that an extreme reading of an unpopular kind still reaches the check. Every
    row that went in comes out."""
    for _ in range(20):
        flagtypes.record("energy:above", useful=False)
    rows = [_Row("sensor.a", 100.0), _Row("sensor.b", 1.0)]
    out = flagtypes.apply_weights(rows, lambda r: "energy:above")
    assert len(out) == 2
    assert all(r.score > 0 for r in out)


def test_an_UNSCORABLE_entity_is_left_exactly_alone(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ ITS SCORE IS `None`, MEANING "cannot say". Multiplying that would turn
    "I could not assess this" into a number, which is the one thing
    `build_scorer` refuses to do.

    ⚠️ AND IT MUST BE SKIPPED BY THE GUARD, NOT RESCUED BY THE `except`.
    Deleting the guard leaves `None * factor` raising once per unscorable
    entity on every document build — the result is identical and the cost is
    an exception and a logged line per device. So this watches `swallow`,
    which is the only thing that can tell the two apart.
    """
    calls = []
    monkeypatch.setattr(flagtypes, "swallow",
                        lambda *a, **k: calls.append(a))
    flagtypes.record("energy:above", useful=False)
    row = _Row("sensor.a", None)
    out = flagtypes.apply_weights([row], lambda r: "energy:above")
    assert out[0].score is None
    assert not calls, "an unscorable row reached the arithmetic and threw"


def test_the_REASON_travels_untouched_beside_a_changed_score() -> None:
    """⚠️ `salience.py`'s FOUNDING RULE. A re-ranked list whose reasons no
    longer match its order is unarguable."""
    flagtypes.record("energy:above", useful=True)
    row = _Row("sensor.a", 2.0, reason="1.9 kW against a median of 340 W")
    out = flagtypes.apply_weights([row], lambda r: "energy:above")
    assert out[0].reason == "1.9 kW against a median of 340 W"


def test_a_BROKEN_resolver_costs_the_tuning_and_never_the_check() -> None:
    """This sits on the document path every check reads."""
    flagtypes.record("energy:above", useful=False)

    def _boom(_row: Any) -> str:
        raise RuntimeError("no measures file")

    out = flagtypes.apply_weights([_Row("sensor.a", 5.0)], _boom)
    assert len(out) == 1 and out[0].score == 5.0


def test_an_EMPTY_store_leaves_the_ranking_byte_identical() -> None:
    rows = [_Row("sensor.a", 5.0), _Row("sensor.b", 1.0)]
    out = flagtypes.apply_weights(rows, lambda r: "energy:above")
    assert [r.score for r in out] == [5.0, 1.0]


# ── what the settings screen edits ──────────────────────────────────────────
def test_the_listing_puts_what_you_SILENCED_first() -> None:
    """The question an owner opens this list to ask."""
    flagtypes.record("energy:above", useful=True)
    for _ in range(3):
        flagtypes.record("data rate:above", useful=False)
    assert [r["key"] for r in flagtypes.listing()][0] == "data rate:above"


def test_a_PRESS_of_plus_or_minus_moves_it_by_the_step() -> None:
    """⚠️ THE BUTTON SENDS A DIRECTION, NEVER A NUMBER, so the step is stated
    once. A client computing `factor + 0.1` would be a second implementation of
    the arithmetic — of the one value that does not survive binary floating
    point unrounded."""
    flagtypes.record("energy:above", useful=True)
    assert flagtypes.nudge("energy:above", 1)[0]
    assert flagtypes.factor_of("energy:above") == 1.2
    assert flagtypes.nudge("energy:above", -1)[0]
    assert flagtypes.factor_of("energy:above") == 1.1


def test_setting_a_factor_by_hand_is_CLAMPED_like_a_press() -> None:
    flagtypes.record("energy:above", useful=True)
    assert flagtypes.set_factor("energy:above", 9999)[0]
    assert flagtypes.factor_of("energy:above") == flagtypes.MAX_FACTOR
    assert flagtypes.set_factor("energy:above", "nonsense")[0]
    assert flagtypes.factor_of("energy:above") == flagtypes.NEUTRAL


def test_tuning_a_kind_that_does_not_exist_is_REFUSED() -> None:
    for call in (lambda: flagtypes.nudge("nope:above", 1),
                 lambda: flagtypes.set_factor("nope:above", 1.2)):
        ok, reason = call()
        assert not ok and "nope:above" in reason


def test_FORGETTING_a_kind_is_not_the_same_as_returning_it_to_1() -> None:
    """⚠️ 1.0 MEANS JUDGED AND NEUTRAL; FORGOTTEN MEANS NEVER JUDGED. The counts
    are the difference, and the settings copy states it."""
    flagtypes.record("energy:above", useful=True)
    flagtypes.set_factor("energy:above", flagtypes.NEUTRAL)
    assert flagtypes.read()["energy:above"]["up"] == 1
    assert flagtypes.forget("energy:above")[0]
    assert "energy:above" not in flagtypes.read()


def test_clearing_forgets_everything() -> None:
    flagtypes.record("energy:above", useful=True)
    flagtypes.record("battery:below", useful=False)
    assert flagtypes.clear()[0]
    assert flagtypes.read() == {}


# ── import is validated, not trusted ────────────────────────────────────────
def test_an_import_REBUILDS_each_row_rather_than_storing_what_it_was_given() -> None:
    """⚠️ THIS FILE MAY HAVE BEEN EDITED BY HAND or carried from another
    property. A weight past the limit, an unknown direction and a label
    disagreeing with its key would otherwise become the store's own state."""
    ok, _ = flagtypes.replace({"types": {
        "energy:above": {"factor": 999, "label": "Something else entirely"},
        "battery:sideways": {"factor": "nonsense"},
    }})
    assert ok
    rows = flagtypes.read()
    assert rows["energy:above"]["factor"] == flagtypes.MAX_FACTOR
    assert rows["battery:changed"]["factor"] == flagtypes.NEUTRAL
    assert rows["energy:above"]["label"] == "Energy above baseline"
    assert "battery:changed" in rows, "an unknown direction was not normalised"


def test_an_import_REPLACES_rather_than_merging() -> None:
    flagtypes.record("energy:above", useful=True)
    flagtypes.replace({"types": {"battery:below": {"factor": 0.5}}})
    assert "energy:above" not in flagtypes.read()


def test_an_unusable_import_is_REFUSED_and_changes_nothing() -> None:
    flagtypes.record("energy:above", useful=True)
    for junk in (None, [], "nonsense", {"types": {}}, {"types": {"": {}}}):
        ok, reason = flagtypes.replace(junk)
        assert not ok and reason
    assert "energy:above" in flagtypes.read(), "a refused import still wrote"


def test_an_exported_list_can_be_imported_again_unchanged() -> None:
    """⚠️ THE EXPORT IS THE STORE'S OWN SHAPE, so the round trip is the same
    contract in both directions rather than two that must be kept in step."""
    flagtypes.record("energy:above", useful=True)
    flagtypes.record("data rate:above", useful=False)
    before = flagtypes.read()
    assert flagtypes.replace({"types": before})[0]
    after = flagtypes.read()
    assert {k: v["factor"] for k, v in after.items()} == \
           {k: v["factor"] for k, v in before.items()}


# ── the assertions that would catch a vocabulary nothing calls ──────────────
def test_a_THUMB_actually_teaches_the_kind() -> None:
    """⚠️ THE ONE THAT MATTERS. Everything above tests a vocabulary; this tests
    that the button is wired to it. `concerns.verify` had unit tests and no
    caller for its whole existence, and the pin built after that defect is what
    caught it — this is the same pin, applied on the day the code was written
    rather than years later.

    Source-level because the handler needs an aiohttp request and a session;
    comments are stripped first, since the block above the call spells the
    function name out twice.
    """
    import re
    root = os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))
    with open(os.path.join(root, "rootfs", "usr", "bin",
                           "supervisor-proxy.py"), encoding="utf-8") as handle:
        src = handle.read()
    body = src.split("async def agent_feedback_handler")[1].split(
        "\nasync def ")[0]
    code = re.sub(r"#[^\n]*", "", body)
    assert "agent_flagtypes.record(" in code, (
        "pressing a thumb records a verdict and teaches nothing — the button's "
        "own tooltip promises otherwise")
    assert "agent_concerns.acknowledge(" in code, (
        "a thumb no longer acknowledges, so the eye button that was removed "
        "was the only way to say it")


def test_the_kind_is_STAMPED_when_the_concern_is_raised() -> None:
    """⚠️ IT CANNOT BE WORKED OUT LATER. A stored concern keeps a HASH of its
    device, so a thumb pressed a week afterwards has nothing to derive a kind
    from — if this stamp goes, every future concern is untunable and the
    settings list silently stops growing."""
    import inspect
    import re
    from agent.tools import concern as concern_mod

    code = re.sub(r"#[^\n]*", "", inspect.getsource(concern_mod.RaiseConcern.run))
    assert "flag_type=" in code, "the kind is not stamped at raise time"


def test_the_weights_reach_the_document_every_check_reads() -> None:
    """⚠️ APPLIED BEFORE THE RANKING AND AFTER THE SCORING. Weighting after the
    cut would reorder a list whose contents were already decided, which is a
    much weaker promise than the one the settings screen makes."""
    import inspect
    import re
    from agent import sources

    code = re.sub(r"#[^\n]*", "", inspect.getsource(sources.build_document))
    assert "scored = flagtypes_mod.apply_weights" in code, (
        "taught preferences reach no check — or their result is computed and "
        "thrown away, which a bare `apply_weights in code` cannot tell apart")
    assert code.index("apply_weights") < code.index("salience_mod.rank"), (
        "the weights are applied after the ranking, so they only reorder what "
        "the cut already chose")
