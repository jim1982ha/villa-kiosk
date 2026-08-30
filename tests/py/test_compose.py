"""The degradation ladder, rung by rung. TEST-001, TASK-047.

⚠️ THE ASSERTION EVERY TEST HERE SHARES IS THAT THE RUNG IS VISIBLE. A brief
arriving in plainer words than usual is one the reader should trust
differently, and a system that degrades without saying so has swapped a visible
fault for an invisible one.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import compose

CONCERNS: List[Dict[str, Any]] = [
    {"severity": "notice", "title": "Standby load creeping", "body": "Slowly."},
    {"severity": "critical", "title": "Pool pump stopped", "body": "At 03:14."},
    {"severity": "warning", "title": "Gate did not close"},
]
SALIENT: List[Dict[str, Any]] = [
    {"label": "pool pump power", "reason": "3.1 sigma above its median"},
]


def test_every_rung_names_itself_in_the_text_a_person_reads() -> None:
    for brief in (compose.from_concerns(CONCERNS),
                  compose.from_salient(SALIENT),
                  compose.nothing()):
        assert "This is a fallback" in brief.text, brief.rung
        assert brief.complete is False, "a fallback claimed to be a full brief"


def test_rung_1_orders_by_SEVERITY_because_the_prose_is_missing() -> None:
    """⚠️ With no writing to carry the weight, the ordering IS the report."""
    text = compose.from_concerns(CONCERNS).text
    assert text.index("Pool pump stopped") < text.index("Gate did not close")
    assert text.index("Gate did not close") < text.index("Standby load")


def test_rung_1_says_the_REASONING_layer_was_missing() -> None:
    assert "reasoning layer" in compose.from_concerns(CONCERNS).text


def test_rung_2_refuses_to_call_unjudged_numbers_findings() -> None:
    """⚠️ Nothing has judged these — that is the layer that is missing — so
    presenting them as findings would be the fallback inventing the thing it
    stands in for."""
    text = compose.from_salient(SALIENT).text
    assert "unjudged" in text
    assert "triage layer was unreachable" in text


def test_rung_2_with_nothing_measured_does_NOT_say_all_is_well() -> None:
    """The rule this whole phase keeps rediscovering, at the bottom rung."""
    text = compose.from_salient([]).text
    assert "rather than as 'all is well'" in text


def test_rung_4_is_still_a_DELIVERY() -> None:
    """⚠️ Silence reads as a working system with nothing to say, which is the
    one reading that must never be available when the truth is that nothing
    ran."""
    brief = compose.nothing(detail="no provider configured")
    assert "could not be assessed" in brief.text
    assert "no provider configured" in brief.text
    assert "Reflexes, the journal and the kiosk" in brief.text


def test_the_ladder_DESCENDS_and_never_merges() -> None:
    """⚠️ A caller with both gets the higher rung. Merging would produce a
    document that is neither, and the reader could not tell how much of it to
    trust."""
    assert compose.ladder(concerns=CONCERNS, salient=SALIENT).rung == "concerns"
    assert compose.ladder(salient=SALIENT).rung == "salient"
    assert compose.ladder().rung == "nothing"


def test_compose_NEVER_raises_even_on_rubbish() -> None:
    """It is the last thing between a villa and silence."""
    out = compose.ladder(concerns=[{"severity": object()}])  # type: ignore[list-item]
    assert out.text and "fallback" in out.text


def test_the_output_is_INERT() -> None:
    """⚠️ A delivered brief may contain nothing a notify platform parses as
    markup — the defect that cost a day of deliveries when a friendly name
    carried an underscore."""
    out = compose.from_concerns(
        [{"severity": "warning", "title": "pump_A is *down*", "body": "[urgent]"}])
    # ⚠️ THE WHOLE OUTPUT, INCLUDING THIS RENDERER'S OWN MARKERS. The first
    # version wrote severities as `[WARNING]` — markup the delivery layer would
    # then have to undo — and the test caught its own renderer, which is the
    # rule working: the renderer emits none, which is what makes the
    # whole-message inert pass at delivery safe rather than lossy.
    for markup in ("*", "[", "]", "<", ">", "~", "`"):
        assert markup not in out.text, f"{markup!r} survived"
    assert "pump A is down" in out.text


def test_it_does_not_reimplement_the_deterministic_renderer() -> None:
    """⚠️ 2,058 lines of zone ordering and money ceilings, and copying any of it
    would produce a second renderer to keep in step with the first. Honest
    beats polished."""
    import ast
    import inspect

    # ⚠️ AST, NOT A GREP. The first version searched the source text for
    # "money" and matched this module's own docstring explaining that it does
    # not do money ceilings — the FOURTH test in this session to match the
    # prose describing the thing it checks. What is checkable is what it
    # IMPORTS and how big it is.
    tree = ast.parse(inspect.getsource(compose))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            imported.add(node.module or "")
        elif isinstance(node, ast.Import):
            imported.update(a.name for a in node.names)
    assert not any("deterministic" in m for m in imported), imported
    # ⚠️ THE BOUND MOVED WITH TASK-073 AND THE PROPERTY CHANGED WITH IT. While
    # deterministic.py existed, smallness proved this was not a second renderer
    # beside it. Now this IS the renderer — `brief()` joined `compose()` — and
    # what the bound guards is the design sentence above: plain lists, severity
    # order, no zones, no charts, no money ceilings. If this file cannot say
    # that in ~450 lines, it has started growing the document it replaced.
    assert len(inspect.getsource(compose).splitlines()) < 450


# ── the ladder is DESCENDED, not merely renderable (TASK-111) ────────────────
# ⚠️ EVERY TEST BELOW GOES THROUGH `run_report`, NOT THROUGH `compose`. The
# defect TASK-111 fixes is that this module had no caller from v2.641.0 to
# v2.698.0 while every rung above was green — a suite that only exercises the
# helper stays green through exactly that, which is `feedback_pin-the-caller`
# and is the reason REQ-042 read as met while RISK-015 had no control at all.


class _FakeSession:
    """Enough of a session for `run_report`. Delivery has no targets here."""

    def post(self, *a: Any, **kw: Any) -> Any:
        raise AssertionError("a fallback brief must not reach the network here")


def _run_with_a_broken_renderer(**context_extras: Any) -> Dict[str, Any]:
    """One report whose BRIEF COMPOSER raises. Returns the history entry.

    ⚠️ REWIRED FOR TASK-073: the failure this simulates is the registered
    composer (`agent/compose.brief` in production) falling over, which lands
    exactly where the old renderer's exception did — after collect, analyse
    and the concerns join, with a fully populated context in hand — and must
    descend the same ladder.
    """
    import asyncio
    from datetime import datetime, timezone

    from vesta.brief import pipeline

    def explode(**kw: Any) -> Any:
        raise RuntimeError("the composer fell over")

    source = context_extras.get("concerns")
    pipeline.set_brief_composer(explode)
    pipeline.set_ladder_composer(compose.ladder)
    pipeline.set_concerns_source((lambda: source) if source else None)
    try:
        return asyncio.run(pipeline.run_report(
            _FakeSession(), "owner", "daily", [],   # type: ignore[arg-type]
            datetime(2026, 8, 24, 7, 0, tzinfo=timezone.utc),
            found={"reachable": True, "preflight": []},
            entry_id="ladder:2026-08-24"))
    finally:
        pipeline.set_brief_composer(None)
        pipeline.set_ladder_composer(None)
        pipeline.set_concerns_source(None)


def test_a_brief_whose_renderer_FAILS_still_says_which_rung_wrote_it() -> None:
    """⚠️ THE WHOLE OF TASK-111 IN ONE ASSERTION. What this replaced was
    "The report could not be composed. See the add-on log." — one sentence in
    place of everything the period had gathered, which is RISK-015 exactly: a
    component fails and the villa looks quiet."""
    entry = _run_with_a_broken_renderer()
    assert "This is a fallback" in entry["_body"], entry["_body"]


def test_rung_1_is_reached_when_the_agent_HAS_concerns() -> None:
    """The concerns were joined into the context before the renderer died, and
    they are what the reader most needs — so they are what arrives."""
    body = _run_with_a_broken_renderer(concerns=[
        {"title": "Pool pump stopped", "severity": "critical",
         "subject_key": "pump"}])["_body"]
    assert "reasoning layer" in body
    assert "Pool pump stopped" in body


def test_rung_4_is_reached_when_there_is_nothing_to_say() -> None:
    """⚠️ AND IT IS STILL DELIVERED. Silence reads as a working system with
    nothing to say; this reads as what it is."""
    body = _run_with_a_broken_renderer()["_body"]
    assert "could not be assessed" in body
    assert "Reflexes, the journal and the kiosk" in body


def test_rung_2_carries_the_FLOOR_S_observations_and_no_entity_ids() -> None:
    """⚠️ THROUGH `_degrade`, THE PIPELINE'S OWN FUNCTION, NOT THROUGH
    `compose`. Rung 2 needs findings in the context, and forcing an analysis
    module to produce one from outside would mean building a module — so the
    chain is pinned in two links instead: `run_report` calls `_degrade` (the
    tests above), and `_degrade` reaches rung 2 with what the floor saw (this
    one). Neither link alone is the claim.

    ⚠️ AND NO ENTITY ID TRAVELS, though `from_salient` would happily print one.
    The label is what a person reads; the id stays in the villa.
    """
    from vesta.brief import pipeline

    class _Context:
        concerns: List[Dict[str, Any]] = []
        findings = [{"label": "Pool pump power", "detail": "3.1 sigma high",
                     "entity_id": "sensor.pool_pump_power"}]
        standing = [{"title": "Gate sensor", "detail": "unavailable for 3 days",
                     "kind": "unavailable"}]

    pipeline.set_ladder_composer(compose.ladder)
    try:
        body, rung = pipeline._degrade(_Context(), "T",  # type: ignore[arg-type]
                                       RuntimeError("x"))
    finally:
        pipeline.set_ladder_composer(None)
    assert rung == "salient"
    assert "triage layer was unreachable" in body and "unjudged" in body
    assert "Pool pump power" in body and "Gate sensor" in body
    assert "sensor.pool_pump_power" not in body


def test_the_history_does_NOT_claim_the_deterministic_renderer_wrote_it() -> None:
    """⚠️ THE FIELD'S OWN DOCSTRING IS "what actually wrote this one". A brief
    the renderer RAISED on, recorded as `deterministic`, is that instrument
    describing the single case it exists to make visible as a normal one."""
    from vesta.shared.contracts import NARRATION_FALLBACK, NARRATION_RECORD

    entry = _run_with_a_broken_renderer()
    assert entry["narration"] == NARRATION_FALLBACK
    assert NARRATION_FALLBACK in NARRATION_RECORD, (
        "the record vocabulary must admit what the pipeline stores, or the SPA "
        "parses it back to 'deterministic' and the lie returns one layer out")


def test_a_fallback_body_carries_NO_duplicate_title() -> None:
    """The pipeline delivers a title and a body as two strings — a notification
    subject and its text — so a header baked into the body arrives twice."""
    entry = _run_with_a_broken_renderer()
    assert not entry["_body"].startswith(entry["_title"])


def test_the_proxy_REGISTERS_the_ladder_at_boot() -> None:
    """⚠️ `feedback_pin-the-caller`, and this exact hook is why the file exists.
    A ladder registered by nobody is the state TASK-111 found: present, tested,
    and unreachable."""
    root = os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))
    src = open(os.path.join(root, "rootfs", "usr", "bin",
                            "supervisor-proxy.py"), encoding="utf-8").read()
    code = "\n".join(l for l in src.splitlines()
                     if not l.strip().startswith("#"))
    assert "set_ladder_composer(" in code, (
        "nothing registers the degradation ladder, so a report whose renderer "
        "fails goes out as one sentence apologising")


def test_an_UNREGISTERED_ladder_still_delivers_something() -> None:
    """An embedder without the agent package is a supported state, and it must
    degrade to the old minimal body rather than to an exception on the one path
    that has no further compose."""
    from vesta.brief import pipeline

    class _Context:
        concerns: List[Dict[str, Any]] = []
        findings: List[Dict[str, Any]] = []
        standing: List[Dict[str, Any]] = []

    pipeline.set_ladder_composer(None)
    body, rung = pipeline._degrade(_Context(), "T", RuntimeError("x"))  # type: ignore[arg-type]
    assert rung == "" and body

