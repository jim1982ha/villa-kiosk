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

from agent import fallback                                    # noqa: E402

CONCERNS: List[Dict[str, Any]] = [
    {"severity": "notice", "title": "Standby load creeping", "body": "Slowly."},
    {"severity": "critical", "title": "Pool pump stopped", "body": "At 03:14."},
    {"severity": "warning", "title": "Gate did not close"},
]
SALIENT: List[Dict[str, Any]] = [
    {"label": "pool pump power", "reason": "3.1 sigma above its median"},
]


def test_every_rung_names_itself_in_the_text_a_person_reads() -> None:
    for brief in (fallback.from_concerns(CONCERNS),
                  fallback.from_salient(SALIENT),
                  fallback.nothing()):
        assert "This is a fallback" in brief.text, brief.rung
        assert brief.complete is False, "a fallback claimed to be a full brief"


def test_rung_1_orders_by_SEVERITY_because_the_prose_is_missing() -> None:
    """⚠️ With no writing to carry the weight, the ordering IS the report."""
    text = fallback.from_concerns(CONCERNS).text
    assert text.index("Pool pump stopped") < text.index("Gate did not close")
    assert text.index("Gate did not close") < text.index("Standby load")


def test_rung_1_says_the_REASONING_layer_was_missing() -> None:
    assert "reasoning layer" in fallback.from_concerns(CONCERNS).text


def test_rung_2_refuses_to_call_unjudged_numbers_findings() -> None:
    """⚠️ Nothing has judged these — that is the layer that is missing — so
    presenting them as findings would be the fallback inventing the thing it
    stands in for."""
    text = fallback.from_salient(SALIENT).text
    assert "unjudged" in text
    assert "triage layer was unreachable" in text


def test_rung_2_with_nothing_measured_does_NOT_say_all_is_well() -> None:
    """The rule this whole phase keeps rediscovering, at the bottom rung."""
    text = fallback.from_salient([]).text
    assert "rather than as 'all is well'" in text


def test_rung_4_is_still_a_DELIVERY() -> None:
    """⚠️ Silence reads as a working system with nothing to say, which is the
    one reading that must never be available when the truth is that nothing
    ran."""
    brief = fallback.nothing(detail="no provider configured")
    assert "could not be assessed" in brief.text
    assert "no provider configured" in brief.text
    assert "Reflexes, the journal and the kiosk" in brief.text


def test_the_ladder_DESCENDS_and_never_merges() -> None:
    """⚠️ A caller with both gets the higher rung. Merging would produce a
    document that is neither, and the reader could not tell how much of it to
    trust."""
    assert fallback.compose(concerns=CONCERNS, salient=SALIENT).rung == "concerns"
    assert fallback.compose(salient=SALIENT).rung == "salient"
    assert fallback.compose().rung == "nothing"


def test_compose_NEVER_raises_even_on_rubbish() -> None:
    """It is the last thing between a villa and silence."""
    out = fallback.compose(concerns=[{"severity": object()}])  # type: ignore[list-item]
    assert out.text and "fallback" in out.text


def test_the_output_is_INERT() -> None:
    """⚠️ A delivered brief may contain nothing a notify platform parses as
    markup — the defect that cost a day of deliveries when a friendly name
    carried an underscore."""
    out = fallback.from_concerns(
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
    tree = ast.parse(inspect.getsource(fallback))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            imported.add(node.module or "")
        elif isinstance(node, ast.Import):
            imported.update(a.name for a in node.names)
    assert not any("deterministic" in m for m in imported), imported
    assert not any(m.startswith("reports.narrate.deterministic")
                   for m in imported)
    assert len(inspect.getsource(fallback).splitlines()) < 200
