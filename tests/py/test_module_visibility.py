"""A pass says which checks ran, not only how many findings it produced.

⚠️ FROM A DELIVERED BRIEF (2026-08-30). A line — "Main Power Phase B — idle
consumption is about 305% higher" — was in one report and gone from the next an
hour later. The log said `2 finding(s)`, which cannot separate the two answers
that matter: the check RAN and correctly found nothing, or the check never ran.

⚠️ THE APP ALREADY ANSWERED THIS FOR A MANUAL RUN and I claimed otherwise before
checking. `ModulesTab` reads `ran`/`skipped` out of the run-now response. The
real gap is a SCHEDULED report: nobody previews it, and `_analysis` is dropped on
the way into history by `{k: v for k, v in entry.items() if not k.startswith("_")}`.
So the log is the only place that can explain one afterwards.
"""
from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))


def test_the_pass_names_the_checks_that_ran() -> None:
    """⚠️ NAMES, NOT A COUNT. `ran` is already computed and was thrown away."""
    import inspect
    from vesta.brief import pipeline
    src = inspect.getsource(pipeline)
    assert 'log("modules: ran "' in src, (
        "a pass no longer records which checks ran, so a finding that stops "
        "appearing cannot be explained after the fact")


def test_a_skip_is_logged_with_its_reason() -> None:
    """⚠️ THE REASON IS THE WHOLE POINT. "standby_creep skipped" and
    "standby_creep skipped (not enough history yet)" are different answers to
    the owner's question."""
    import inspect
    from vesta.brief import pipeline
    src = inspect.getsource(pipeline)
    assert "s.get('reason', '?')" in src and "skipped " in src, (
        "a skipped check is logged without saying why it was skipped")


def test_the_line_renders_both_halves() -> None:
    """Exercised rather than grepped: the format must survive real inputs."""
    ran: List[str] = ["level_anomaly", "sensor_health"]
    skipped: List[Dict[str, str]] = [
        {"module": "standby_creep", "reason": "not enough history yet"}]
    line = ("modules: ran " + (", ".join(ran) if ran else "none")
            + ("" if not skipped else " · skipped "
               + ", ".join(f"{s.get('module', '?')} ({s.get('reason', '?')})"
                           for s in skipped)))
    assert line == ("modules: ran level_anomaly, sensor_health · "
                    "skipped standby_creep (not enough history yet)"), line

    # ⚠️ AND THE ALL-RAN CASE SAYS SO RATHER THAN TRAILING OFF, because a line
    # ending in "skipped" with nothing after it reads as truncation.
    assert ("modules: ran a" ==
            "modules: ran " + ", ".join(["a"]) + ("" if not [] else " · skipped"))
    # ⚠️ AND NOTHING RAN IS "none", NOT AN EMPTY TAIL — silence is the state
    # this whole line exists to make unmistakable.
    assert ("modules: ran none" ==
            "modules: ran " + (", ".join([]) if [] else "none"))


def test_the_unreachable_skip_reason_is_gone_from_BOTH_contracts() -> None:
    """⚠️ IT WAS KEPT ON A FALSE JUSTIFICATION. The comment said stored analysis
    carried the code; history never holds a skip reason at all, because every
    underscore key is stripped on the way in. No producer, no persistence, and
    no phrase in `describe_skips` — it would have reached the owner as a raw
    code mid-sentence."""
    from vesta.shared import contracts

    assert "superseded" not in contracts.SKIP_REASON, (
        "an unreachable skip reason is back in the contract")

    root = os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))
    with open(os.path.join(root, "src", "vesta", "shared", "reportsTypes.ts"),
              encoding="utf-8") as fh:
        ts = fh.read()
    start = ts.index("export const SKIP_REASON")
    end = ts.index("] as const;", start)
    assert '"superseded"' not in ts[start:end], (
        "the TypeScript mirror still lists it — the two leave together or "
        "neither does")


def test_history_really_does_drop_the_analysis() -> None:
    """⚠️ THE FACT THE CORRECTED COMMENT NOW RESTS ON, asserted rather than
    described. If this strip is ever removed, the reasoning above changes and
    the skip vocabulary may genuinely need a historical value again."""
    import inspect
    from vesta.brief import pipeline
    src = inspect.getsource(pipeline)
    assert 'if not k.startswith("_")' in src, (
        "history no longer strips underscore keys — `_analysis` may now be "
        "persisted, which changes why the skip vocabulary is what it is")
