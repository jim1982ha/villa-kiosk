"""The wiring: are the tools actually connected to this villa?

⚠️ THE ABSENCE OF THIS FILE IS WHY THE DEFECT SHIPPED. `build_registry()` built
every tool with no arguments while each takes its data source as one, so the
whole tool surface answered about an empty property — and the full suite passed,
because every tool test constructs its subject WITH a source and every loop test
uses fakes. Nothing anywhere asked the one question this file asks: what does
`build_registry()` actually return?
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from agent import sources                                    # noqa: E402
from agent.registry import build_registry                    # noqa: E402

#: A journal as `observe/journal.py` writes one: short keys, oldest first.
ROWS: List[Dict[str, Any]] = [
    {"at": f"2026-08-{day:02d}T09:00:00Z", "id": "sensor.probe_power",
     "s": str(300 + day)} for day in range(1, 22)
] + [
    {"at": "2026-08-22T09:00:00Z", "id": "sensor.probe_power", "s": "980"},
    {"at": "2026-08-22T09:00:00Z", "id": "binary_sensor.probe_door", "s": "on"},
    {"at": "2026-08-22T10:00:00Z", "id": "binary_sensor.probe_door", "s": "off"},
]


def test_a_ref_is_minted_for_every_entity_the_journal_has_seen() -> None:
    """⚠️ FROM WHAT WAS OBSERVED, not from the HA registry: a device the villa
    has never reported is one no tool can say anything about, so a handle for
    it invites a question with no answer."""
    refs = sources.build_refs(ROWS)
    known = set(refs.known())
    assert len(known) == 2
    assert all(refs.resolve(r) for r in known)
    assert set(refs.resolve(r) for r in known) == {
        "sensor.probe_power", "binary_sensor.probe_door"}


def test_the_scorer_returns_one_result_per_entity() -> None:
    scored = sources.build_scorer(ROWS)()
    assert len(scored) == 2, f"expected one per entity, got {len(scored)}"


def test_an_entity_with_too_little_history_comes_back_UNSCORABLE() -> None:
    """⚠️ NOT OMITTED. `read_salient(include_unscorable=True)` exists so "I
    could not assess these and here is why" is sayable; dropping them turns
    that into silence, which is the failure this whole phase keeps hitting."""
    from observe import salience as salience_mod

    thin = [{"at": "2026-08-22T09:00:00Z", "id": "sensor.new_thing", "s": "5"}]
    scored = sources.build_scorer(thin)()
    assert scored, "a brand-new entity vanished instead of being unscorable"
    assert salience_mod.unscorable(scored), "it claims to be scorable on one sample"


def test_a_STEP_CHANGE_scores_above_a_steady_series() -> None:
    """The scorer is wired to real arithmetic, not to a stub that returns
    zeroes — which would pass every other test here."""
    scored = {s.entity_id: s for s in sources.build_scorer(ROWS)()}
    power = scored["sensor.probe_power"]
    assert power.score > 0, f"a jump from ~320 to 980 scored {power.score}"
    assert power.reason, "no reason given, so the figure cannot be checked"


def test_the_profile_source_counts_DEVICES_not_journal_rows() -> None:
    """⚠️ One chatty sensor would otherwise dominate the villa's own
    description of itself: "sensor: 14,000" says nothing about how many
    sensors exist."""
    facts = sources.build_profile_source(ROWS)()
    assert facts["devices_by_class"] == {"binary sensors": 1, "sensors": 1}


def test_a_device_class_is_a_countable_english_plural() -> None:
    """⚠️ `_counted` TAKES THE PLURAL AND DERIVES THE SINGULAR, so a raw domain
    slug breaks in BOTH directions: "43 binary_sensor" reads as a typo, and
    `_singular("binary_sensor")` strips the final "r" it mistakes for a plural
    "s"-less stem. Checked against the renderer rather than asserted in
    isolation, because the contract is between the two."""
    from observe import snapshot

    assert sources._class_name("binary_sensor") == "binary sensors"
    assert sources._class_name("light") == "lights"
    counted = snapshot.profile(devices_by_class={
        sources._class_name("binary_sensor"): 43,
        sources._class_name("light"): 1})
    assert "43 binary sensors" in counted
    assert "1 light." in counted, "a count of one must read as a singular"
    assert "_" not in counted.split("Devices by class:")[1].split("\n")[0]


def test_build_registry_returns_tools_CONNECTED_to_something() -> None:
    """⚠️ THE TEST THAT WAS MISSING. Every tool test builds its subject WITH a
    source and every loop test uses fakes, so nothing ever asked what
    `build_registry()` itself produces. It produced tools wired to nothing, and
    the villa reported it."""
    registry = build_registry()
    assert "read_salient" in registry.names
    tool = registry.get("read_salient")
    assert tool is not None
    assert callable(getattr(tool, "_scorer", None)), (
        "read_salient came back with no scorer — it can only ever return an "
        "empty ranking, which reads as a villa with nothing unusual")
    villa = registry.get("read_villa")
    assert villa is not None
    assert callable(getattr(villa, "_profile_source", None))


def test_every_tool_in_the_registry_either_HAS_a_source_or_REFUSES() -> None:
    """⚠️ THE RULE THAT REPLACES THE SILENT EMPTY. A tool with no source is
    allowed to exist — several have none yet — but it must say so when called,
    never return a result indistinguishable from a quiet villa."""
    registry = build_registry()
    for name in registry.names:
        tool = registry.get(name)
        assert tool is not None
        wired = any(callable(getattr(tool, attr, None))
                    for attr in ("_scorer", "_source", "_profile_source"))
        has_refs = getattr(tool, "_refs", None) is not None
        if wired or has_refs or name in ("read_ledger", "read_concerns",
                                         "read_coverage"):
            continue
        blocks = asyncio.run(tool.call({}))
        assert blocks and ("error" in blocks[0]), (
            f"{name} has no source and returned {blocks!r} rather than "
            f"refusing — indistinguishable from a villa with nothing to report")


def test_a_broken_journal_does_not_take_the_registry_down() -> None:
    """A source that raises must degrade to an empty villa, not to no agent."""
    import observe.journal as journal_mod

    original = journal_mod.read
    journal_mod.read = lambda: (_ for _ in ()).throw(RuntimeError("corrupt"))
    try:
        assert sources.build_refs() is not None
        assert sources.build_scorer()() == []
        assert build_registry().names
    finally:
        journal_mod.read = original


def test_a_QUIET_entity_stays_ADDRESSABLE_after_the_ring_fills(
        tmp_path: Any, monkeypatch: Any) -> None:
    """⚠️ THE PH-2 GATE'S DEFECT, END TO END: journal → refs → "can the agent
    name this device". Reported three times from the villa — "no pool pump
    circuit shows up in what I can address" — of a circuit drawing 863.7 W.

    `build_refs` mints one handle per entity IN THE JOURNAL, which is right
    while the journal covers its window and wrong once the ring is full: what
    survives is then "whatever changed most recently", and a steadily-running
    pump emits far fewer rows than a chatty signal sensor. The equipment worth
    asking about is evicted FIRST.

    This drives the real `journal.append` and the real `build_refs` rather than
    a fixture of either, because the defect lived in the seam between them.
    """
    from observe import journal

    monkeypatch.setattr(journal, "JOURNAL_FILE", str(tmp_path / "j.json"))
    monkeypatch.setattr(journal, "JOURNAL_MAX_ENTRIES", 20)

    def changed(entity: str, value: str, at: str) -> Dict[str, Any]:
        return {"event_type": "state_changed", "time_fired": at, "data": {
            "entity_id": entity,
            "old_state": {"state": "0", "attributes": {}},
            "new_state": {"state": value, "attributes": {}}}}

    quiet = "sensor.quiet_pump_power"
    journal.append([changed(quiet, "863.7", "2026-08-22T09:00:00+00:00")],
                   now_iso="2026-08-22T09:00:00+00:00")
    # A chatty neighbour fills the ring many times over.
    for i in range(120):
        journal.append([changed("sensor.chatty_signal", str(i),
                                f"2026-08-22T1{i // 60}:{i % 60:02d}:00+00:00")],
                       now_iso="2026-08-22T12:00:00+00:00")

    table = sources.build_refs(journal.read()["entries"])
    addressable = {table.resolve(r) for r in table.known()}
    assert quiet in addressable, (
        "the pump was evicted from the journal and is therefore unnameable — "
        "the agent would answer that no such circuit exists, of equipment the "
        "villa is metering right now")


# ── the Villa Document itself ───────────────────────────────────────────────
# ⚠️ THE DEFECT THIS SECTION EXISTS FOR IS THE SAME ONE THE FILE OPENS WITH,
# ONE LEVEL UP AND FOUND FOUR MONTHS LATER. `snapshot.profile()` and
# `snapshot.delta()` take every villa fact as a keyword argument, and BOTH
# callers that build the triage document passed none — so the model read a
# well-formed 480-character description of an empty property on every pass of
# the whole PH-3 shadow period. Every test of `snapshot` constructed its subject
# WITH facts, exactly as every tool test did; nothing asked what the CALLERS
# build.

def test_the_empty_document_is_480_characters_and_that_is_the_bug() -> None:
    """⚠️ THE OWNER'S CAPTURE, REPRODUCED EXACTLY. The triage trace read
    `doc=480c/15L` twice and it was read as a quiet villa. It is the byte-length
    of `profile()` and `delta()` called with no arguments — which is what both
    document call sites did. This test holds the number so the reading can never
    be mistaken for a measurement of the property again."""
    from observe import snapshot

    empty = snapshot.villa_document(profile_text=snapshot.profile(),
                                    delta_text=snapshot.delta())
    assert len(empty) == 480 and empty.count("\n") + 1 == 15, (
        "the empty render moved; whatever `doc=` figure a trace now shows for "
        "an unwired document, it is no longer 480c/15L")


def test_build_document_describes_the_property_not_an_empty_one() -> None:
    """⚠️ THE PIN THAT WOULD HAVE CAUGHT IT. Not "is it long" — that passes on
    any prose — but "does it contain THIS villa's facts": the device counts, the
    ranked entity, and a coverage claim. All three were absent and the document
    was still well-formed."""
    from observe import snapshot

    document = sources.build_document(ROWS)
    assert document != snapshot.villa_document(
        profile_text=snapshot.profile(), delta_text=snapshot.delta())
    assert "Devices by class:" in document, "the property's own shape is absent"
    assert "1 binary sensor, 1 sensor" in document
    assert "Coverage:" in document, (
        "no coverage claim, so an absence of findings below it is unreadable")
    assert "Probe Power" in document, (
        "the ranked excerpt is empty, which is the half of the document that "
        "says what is happening RIGHT NOW")


def test_the_document_carries_NO_raw_entity_id() -> None:
    """⚠️ `snapshot`'s OWN FIRST RULE, AND WIRING SALIENCE IS WHAT PUT IT AT
    RISK. `_label_of` returned `item.entity_id` and was safe only because the
    ranked list was always empty; the moment the document was connected, every
    row would have carried `sensor.<someone>_bedroom_window` off the property.
    The resolver is `reports.devices.label_for` — the one shared name rule."""
    document = sources.build_document(ROWS)
    for entity_id in ("sensor.probe_power", "binary_sensor.probe_door"):
        assert entity_id not in document, (
            f"{entity_id} reached the biggest unattended payload in the system")


def test_a_document_section_degrades_alone_not_the_whole_document(
        monkeypatch: Any) -> None:
    """⚠️ ONE FAILING SOURCE MUST NOT COST THE VILLA ITS OTHER FACTS. The
    behaviour being replaced was that any exception swapped the entire document
    for a sentence about itself — so a concern store that could not be read
    blinded the agent completely, which is the shape of the defect this whole
    file is about."""
    def boom() -> Any:
        raise RuntimeError("the concern store is unreadable")

    monkeypatch.setattr(sources, "_open_concerns", boom)
    with pytest.raises(RuntimeError):
        sources._open_concerns()

    monkeypatch.undo()
    from agent import concerns as concerns_mod
    monkeypatch.setattr(concerns_mod, "read", boom)
    document = sources.build_document(ROWS)
    assert "Devices by class:" in document, (
        "an unreadable concern store took the device counts with it")


def test_an_unscorable_count_of_one_reads_as_english() -> None:
    """⚠️ THE SHAPE-NOT-CONTENT DEFECT THE PH-1 CHECKPOINT FOUND AS "1 climate
    units". No assertion sees it and every reader does, in a document whose
    authority rests on reading as though a person wrote it."""
    from observe import snapshot

    assert "1 entity lacks enough history" in snapshot.delta(unscorable=1)
    assert "2 entities lack enough history" in snapshot.delta(unscorable=2)


def test_the_whole_journal_is_complete_coverage_over_its_own_extent(
        monkeypatch: Any, tmp_path: Any) -> None:
    """⚠️ `coverage("")` MEANT "THE WHOLE JOURNAL" AND ANSWERED "INCOMPLETE"
    FOREVER, because `online_since <= ""` is False for every real stamp. Both
    TOOL-005's schema documents the empty window that way and `read_villa` passes
    it, so the Villa
    Document printed "part of this window was not observed" above every delta a
    LISTENING villa ever produced."""
    from observe import journal

    monkeypatch.setattr(journal, "JOURNAL_FILE", str(tmp_path / "j.json"))
    journal.append([{"event_type": "state_changed",
                     "time_fired": "2026-08-22T09:00:00+00:00",
                     "data": {"entity_id": "sensor.probe_power",
                              "old_state": {"state": "0", "attributes": {}},
                              "new_state": {"state": "9", "attributes": {}}}}],
                   now_iso="2026-08-22T09:00:00+00:00")

    assert journal.coverage("")["complete"] is True
    assert journal.coverage("2026-08-22T10:00:00+00:00")["complete"] is True, \
        "a window opening AFTER we came online is covered"
    assert journal.coverage("2026-08-01T00:00:00+00:00")["complete"] is False, \
        "a window opening BEFORE we came online is not, and must still say so"


def test_a_journal_that_never_came_online_is_never_complete(
        monkeypatch: Any, tmp_path: Any) -> None:
    """⚠️ THE OTHER HALF, AND THE ONE THE FIX COULD HAVE BROKEN. "The whole
    journal" is complete over its own extent only if there IS one; a villa whose
    observation floor never started must not report full coverage of nothing."""
    from observe import journal

    monkeypatch.setattr(journal, "JOURNAL_FILE", str(tmp_path / "empty.json"))
    assert journal.coverage("")["complete"] is False


# ── the CALL SITES, which is where the defect actually lived ────────────────
# ⚠️ EVERY PIN ABOVE TESTS `build_document`, AND NOT ONE OF THEM WOULD HAVE
# CAUGHT THIS BUG. The builder was never wrong — it did not exist, and the two
# callers each assembled the document themselves by passing `snapshot.profile()`
# and `snapshot.delta()` no arguments. A suite that only tests the helper goes
# green while the product ships the empty document, which is precisely how four
# review rounds were spent on an agent that had never seen the villa.

def test_the_SCHEDULER_hands_triage_a_wired_document(monkeypatch: Any) -> None:
    """⚠️ THE PASS ITSELF, not the builder it should use. Asserted on the
    document `run_once` actually receives, so reverting `_pass` to
    `snapshot.profile()` / `snapshot.delta()` turns this red."""
    from agent import scheduler
    from observe import snapshot

    empty = snapshot.villa_document(profile_text=snapshot.profile(),
                                    delta_text=snapshot.delta())
    seen: Dict[str, str] = {}

    async def fake_run_once(session: Any, **kwargs: Any) -> str:
        seen["document"] = str(kwargs.get("document") or "")
        return "nothing to escalate"

    monkeypatch.setattr(scheduler, "run_once", fake_run_once)
    monkeypatch.setattr(sources, "_journal_rows", lambda: list(ROWS))
    asyncio.run(scheduler._pass(None, {}))

    assert seen["document"] != empty, (
        "the scheduler is handing triage the 480-character empty document — "
        "the pass will run, answer, and cost money over a property it cannot "
        "see, and the trace will read `nothing to escalate`")
    assert "Devices by class:" in seen["document"]


def test_the_MANUAL_route_hands_over_the_same_wired_document() -> None:
    """⚠️ ONE BUILDER, ASSERTED FROM THE SOURCE. `_agent_document_text` and
    `scheduler._pass` were byte-identical copies of the broken version, so the
    "run now" button and the clock were wrong the same way. This reads the proxy
    rather than importing it — the module needs aiohttp and a Supervisor token —
    and checks the shape that mattered: it calls the shared builder and does NOT
    assemble a document of its own."""
    import re

    proxy = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")
    with open(proxy, "r", encoding="utf-8") as handle:
        body = handle.read()
    start = body.index("async def _agent_document_text")
    block = body[start:body.index("\n\n\n", start)]
    # ⚠️ COMMENTS STRIPPED FIRST. The sixth time a source-reading check here
    # matched its own explanatory prose was TASK-094's; this block's docstring
    # necessarily quotes the very call it forbids.
    code = "\n".join(re.sub(r"#.*$", "", line) for line in block.splitlines())
    code = re.sub(r'""".*?"""', "", code, flags=re.S)

    assert "sources.build_document" in code, (
        "the manual document route stopped using the shared builder")
    assert "snapshot.profile(" not in code and "snapshot.delta(" not in code, (
        "the manual route assembles its own document again — that is how it "
        "and the scheduler came to be wrong in identical ways")


def test_a_SETTLED_concern_is_not_reported_as_open(monkeypatch: Any) -> None:
    """⚠️ THROUGH `concerns.SETTLED`, NEVER A LOCAL LIST OF STATE NAMES. A
    second copy is how a state added to one module goes on being printed as open
    by the other — and "this is still a live problem" about something the owner
    dismissed is the fastest way to be switched off."""
    from agent import concerns as concerns_mod

    monkeypatch.setattr(concerns_mod, "read", lambda: [
        {"title": "Live thing", "state": "open",
         "opened_at": "2026-08-20T09:00:00Z"},
        {"title": "Dismissed thing", "state": "dismissed",
         "opened_at": "2026-08-20T09:00:00Z"},
        {"title": "Closed thing", "state": "closed",
         "opened_at": "2026-08-20T09:00:00Z"},
    ])
    titles = [row["title"] for row in sources._open_concerns()]
    assert titles == ["Live thing"], titles


def test_an_unparseable_opened_at_says_CANNOT_SAY_not_today() -> None:
    """⚠️ `None`, NOT 0.0. `delta` prints nothing for None and "open 0 days" for
    zero — so a stamp that failed to parse would date every concern to today and
    read as a villa whose problems are all brand new."""
    from observe import snapshot

    assert sources._age_days("not a timestamp") is None
    assert sources._age_days("") is None
    assert sources._age_days("2026-08-20T09:00:00Z") is not None
    printed = snapshot.delta(concerns=[{"title": "T", "state": "open",
                                        "age_days": None}])
    assert "  T\n" in printed and "0 day" not in printed


def test_a_concern_never_says_its_state_twice() -> None:
    """⚠️ FOUND BY THE TEST ABOVE, NOT BY REVIEW, AND LATENT SINCE THE DAY THE
    FIRST HALF SHIPPED. The rule "print a state only when it adds something" was
    applied in one branch and undone in the other, and nothing could see it
    because no caller ever passed a concern — the same emptiness that hid the
    whole defect this file is about. `(closed, closed)`, `(dismissed,
    dismissed)`, and `(open)` on a live concern of unknown age."""
    from observe import snapshot

    def suffix_of(state: str, age: Any) -> str:
        printed = snapshot.delta(concerns=[{"title": "T", "state": state,
                                            "age_days": age}])
        return printed.split("Open concerns:\n  T")[1].split("\n")[0].strip()

    assert suffix_of("closed", None) == "(closed)"
    assert suffix_of("dismissed", None) == "(dismissed)"
    assert suffix_of("open", None) == "", "'(open)' adds nothing to 'open'"
    assert suffix_of("open", 2) == "(open 2 days)"
    assert suffix_of("verified", 3) == "(verified, open 3 days)"
