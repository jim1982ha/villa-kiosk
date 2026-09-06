"""Which of this villa's devices a Subject names.

⚠️ THE INTERFACE WAS NOT THE TEST SURFACE, AND THE MODULE HAD SAID SO. From
`triage._unidentified_note`: "`_identify` only ever sees `refs.known()`, so the
second is entirely possible and is invisible to every test of the matcher —
those hand it the labels directly, which is `feedback_pin-the-caller` in its
usual disguise."

That note exists to recover, at runtime and through a log line, a distinction
the old shape made untestable: THE MATCHER FAILED versus THERE WAS NOTHING TO
MATCH AGAINST. The old entry point was private, took `refs: Any` (so `--strict`
checked nothing where a wrong shape silently identifies nothing), returned
`None`, and mutated its arguments in place. This one takes a mapping and returns
a tuple, so the empty case is just `{}`.
"""

from vesta.supervise.agent import naming

#: Deliberately shaped like the reference villa's own labels: a "Power" suffix
#: the model drops, and a compound that names two devices.
LABELS = {
    "pool pump power": "switch.pool",
    "massage jet pump power": "switch.jet",
    "massage jet pump power factor": "switch.jet_pf",
}


def test_nothing_to_match_against_is_distinguishable_from_a_failed_match():
    """⚠️ THE CASE `_unidentified_note` EXISTS TO RECOVER AT RUNTIME. With the
    matcher behind a private mutator taking `Any`, the caller could not tell
    "no labels" from "no match"; here the first is `{}` and needs no log line."""
    assert naming.devices_named("pool pump", {}) == ()
    assert naming.devices_named("pool pump", LABELS) == ("switch.pool",)


def test_the_model_padding_a_name_still_finds_the_device():
    """"the pool pump circuit" for a device labelled "Pool pump"."""
    assert naming.devices_named("the pool pump power circuit", LABELS) \
        == ("switch.pool",)


def test_the_model_SHORTENING_a_name_still_finds_the_device():
    """⚠️ THE DIRECTION THAT DOES THE WORK ON THE REFERENCE VILLA. Its labels
    carry a "Power" suffix the model drops, so the forward pass matches nothing
    and every single-device subject is identified by the reverse one."""
    assert naming.devices_named("pool pump", LABELS) == ("switch.pool",)


def test_a_compound_subject_names_BOTH_devices_in_the_order_it_names_them():
    """⚠️ KEEPING ONLY THE FIRST MEANT THE OTHER'S FLAG WAS NEVER STAMPED, and
    the delivered brief showed the same pump "noticed, not investigated" beside
    "investigated"."""
    got = naming.devices_named("pool pump and massage jet pump", LABELS)
    assert got == ("switch.pool", "switch.jet"), got


def test_the_order_follows_the_SUBJECT_not_the_label_table():
    got = naming.devices_named("massage jet pump and pool pump", LABELS)
    assert got == ("switch.jet", "switch.pool"), got


def test_a_specific_label_beats_the_general_one_inside_it():
    """"Massage Jet Pump" sits inside "Massage Jet Pump Power Factor"; claiming
    both would attach two devices to one mention."""
    got = naming.devices_named("massage jet pump power factor", LABELS)
    assert got == ("switch.jet_pf",), got


def test_a_bare_common_word_names_NOTHING():
    """⚠️ THE SHARE GUARD. "pump" sits inside every pump label on the property,
    and without it a one-word span attaches whichever device sorted first —
    inventing a device the model never named."""
    assert naming.devices_named("pump", LABELS) == ()
    assert naming.devices_named("the pump is noisy", LABELS) == ()


def test_a_topic_subject_names_nothing_and_that_is_correct():
    """"Coverage incomplete" and "the monitoring journal" are real Subjects with
    no device behind them; they keep the topic key."""
    for subject in ("observation coverage is incomplete",
                    "the monitoring journal", ""):
        assert naming.devices_named(subject, LABELS) == (), subject


def test_the_two_directions_keep_OPPOSITE_tie_breaks():
    """⚠️ COLLAPSING THEM RE-OPENS WHICHEVER CASE IS NOT TESTED. A label found
    inside the subject is the model padding, so the LONGEST label is the device
    meant; a subject span found inside a label is the model shortening, so the
    SHORTEST label is the general name of the equipment."""
    # Forward (label inside subject): longest wins.
    forward = {"jet pump": "switch.short", "massage jet pump": "switch.long"}
    assert naming.devices_named("the massage jet pump tripped", forward) \
        == ("switch.long",)
    # Reverse (subject span inside label): shortest wins.
    reverse = {"massage jet pump power": "switch.short",
               "massage jet pump power factor average": "switch.long"}
    assert naming.devices_named("massage jet pump power", reverse) \
        == ("switch.short",)


def test_matching_is_case_and_whitespace_insensitive_at_the_CALLER():
    """`devices_named` compares what it is given; `triage._comparable` is what
    normalises. Passing raw labels must therefore not silently half-work."""
    assert naming.devices_named("POOL PUMP", LABELS) == ()


def test_the_matcher_no_longer_mutates_its_arguments():
    """The old entry point returned None and wrote into the Escalation objects."""
    labels = dict(LABELS)
    naming.devices_named("pool pump and massage jet pump", labels)
    assert labels == LABELS, "the label mapping was modified"
