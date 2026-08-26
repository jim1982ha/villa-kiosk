"""One supervision pass must be READABLE END TO END in the add-on log.

⚠️ WRITTEN BEFORE THE FIRST END-TO-END TEST, WHICH IS THE ONLY TIME IT IS WORTH
ANYTHING. The owner's question was "prove with logs that this is handled end to
end", and the honest answer before 2.768.0 was that it could not be. Counted
against HEAD rather than remembered: TWO tiers had no log line at all — the
DOCUMENT (its size reached the audit row and nowhere else) and the ROUTE (which
computed a `Delivery.reason` explaining every suppression and hold, and threw it
away) — and TWO more went silent in exactly the case that matters, the delivery
and escalation sweeps saying nothing when they found nothing to carry.

The add-on log is the instrument every field diagnosis in this project has
actually been made from, and it could not tell a quiet villa from a villa the
agent could not see. That is not a hypothetical failure: TASK-051 lost an entire
observation period to a 480-char document, and the emptiness read as a verdict on
the agent.

⚠️ THE TIER NAMES ARE THE ARCHITECTURE'S OWN, AND THAT IS THE POINT. A capture
can be laid beside the HLD's tier diagram and read box by box. A name that
drifts from the diagram breaks the one property this trace is for.

⚠️ AND A TIER THAT DID NOTHING MUST STILL SPEAK. `feedback_instruments-never-skip`
is this project's most expensive lesson in the small: four counters have read `0`
for exactly the case they existed to measure, and a tier that logs only when it
acts is the same defect with the number left out entirely — "no line" and
"nothing to do" are indistinguishable in a log.
"""

from __future__ import annotations

import ast
import io
import os
import re
import sys
from contextlib import redirect_stdout
from typing import Set

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BIN = os.path.join(ROOT, "rootfs", "usr", "bin")
sys.path.insert(0, BIN)

from reports import log as log_mod  # noqa: E402

#: The tiers a pass passes through, in order. ⚠️ EVERY ONE OF THESE IS A BOX ON
#: THE ARCHITECTURE DIAGRAM. `document` is Tier 1's output, `triage` is Tier 2,
#: `reason` and `concern` are Tier 3, `route`/`outbox`/`task` are Tier 4.
TIERS = ("document", "triage", "reason", "concern", "route", "outbox",
         "escalation", "task")


def _strip_prose(src: str) -> str:
    """Drop `#` comments AND docstrings.

    ⚠️ DOCSTRINGS TOO, WHICH IS THE HALF A `#`-ONLY FILTER MISSES. Python has no
    block comment; a docstring is its equivalent, and this file's own patterns
    are call-shaped (`stage("outbox"`) — exactly the shape a module header
    explaining the trace would contain. Six pins in this repository have already
    passed by matching their own prose, and the fix each time was to strip the
    prose rather than to write a cleverer regex.
    """
    try:
        tree = ast.parse(src)
    except SyntaxError:                      # not ours to parse; fall through
        return src
    spans = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef,
                                 ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", None)
        if not body or not isinstance(body[0], ast.Expr):
            continue
        doc = body[0].value
        if isinstance(doc, ast.Constant) and isinstance(doc.value, str):
            spans.update(range(doc.lineno, (doc.end_lineno or doc.lineno) + 1))
    return "\n".join(
        line for n, line in enumerate(src.splitlines(), start=1)
        if n not in spans and not line.strip().startswith("#"))


def _shipped_source() -> str:
    """Every shipped Python file, with comments and docstrings removed."""
    out = []
    for pkg in ("agent", "reports", "observe"):
        for base, _dirs, files in os.walk(os.path.join(BIN, pkg)):
            for name in files:
                if name.endswith(".py"):
                    with open(os.path.join(base, name), encoding="utf-8") as fh:
                        out.append(fh.read())
    with open(os.path.join(BIN, "supervisor-proxy.py"), encoding="utf-8") as fh:
        out.append(fh.read())
    return "\n".join(_strip_prose(chunk) for chunk in out)


def _staged_tiers(src: str) -> Set[str]:
    return set(re.findall(r'stage\(\s*"([a-z]+)"', src))


def test_every_tier_of_the_pipeline_reports_itself() -> None:
    """⚠️ THE WHOLE DELIVERABLE. A missing tier here is a blind spot in the one
    artefact an owner is asked to read when something did not arrive."""
    staged = _staged_tiers(_shipped_source())
    missing = [t for t in TIERS if t not in staged]
    assert not missing, (
        f"these tiers emit no stage() line: {missing}. A pass through them is "
        "invisible in the add-on log, so 'it did nothing' and 'it never ran' "
        "cannot be told apart")


def test_the_pass_id_is_stamped_on_every_line_inside_a_scope() -> None:
    """⚠️ RUN, NOT GREPPED. What matters is the OUTPUT, and a test that reads
    the source would agree with itself forever while the format moved."""
    buf = io.StringIO()
    with redirect_stdout(buf):
        with log_mod.pass_scope("manual") as ident:
            log_mod.stage("triage", "0 escalation(s) from 2 turn(s)")
            log_mod.warn("something survivable")
    lines = [l for l in buf.getvalue().splitlines() if l.strip()]

    assert len(ident) == 4, "the pass id should be short enough to read"
    assert all(ident in l for l in lines), (
        f"not every line inside the scope carries the pass id {ident!r}: "
        f"{[l for l in lines if ident not in l]} — so two overlapping passes "
        "(the clock and the button) cannot be told apart")
    assert "manual pass begins" in lines[0] and "pass ends" in lines[-1]
    assert re.search(r"ends after \d+\.\d+s", lines[-1]), (
        "the end line carries no duration, so a pass that hung and one that "
        "finished instantly read the same")


def test_a_line_OUTSIDE_a_pass_is_not_stamped() -> None:
    """⚠️ THE CONTEXTVAR MUST NOT LEAK. The collector, the observation cycle
    and the briefing scheduler all log from the same process and none of them
    is a triage pass; stamping their lines with a stale id would attribute one
    subsystem's output to another's pass, which is worse than no id at all."""
    buf = io.StringIO()
    with redirect_stdout(buf):
        with log_mod.pass_scope("scheduled"):
            pass
        log_mod.log("collector subscribed to nothing in particular")
    assert buf.getvalue().splitlines()[-1] == \
        f"{log_mod.TAG} collector subscribed to nothing in particular"


def test_the_scope_closes_even_when_the_pass_RAISES() -> None:
    """⚠️ A PASS THAT STARTS AND NEVER FINISHES IS THE MOST IMPORTANT THING
    THIS TRACE CAN SHOW, so the end line may not be on the happy path only."""
    buf = io.StringIO()
    try:
        with redirect_stdout(buf):
            with log_mod.pass_scope("scheduled"):
                raise RuntimeError("the provider went away")
    except RuntimeError:
        pass
    assert "pass ends" in buf.getvalue().splitlines()[-1]
    assert log_mod.PASS.get() == "", "the id outlived its scope"


def test_the_outbox_reports_even_when_there_is_NOTHING_to_carry() -> None:
    """⚠️ THE TIER MOST LIKELY TO BE SILENT IS THE ONE MOST ASKED ABOUT. On a
    quiet villa — which is the normal case and the case the first end-to-end
    test will hit — nothing is waiting, and before 2.768.0 the sweep returned
    without a word. "Nothing arrived on my phone" then had two indistinguishable
    explanations: there was nothing to send, or the delivery tier never ran."""
    import inspect

    from agent import outbox

    src = inspect.getsource(outbox.sweep)
    code = "\n".join(l for l in src.splitlines()
                     if not l.strip().startswith("#"))
    early, _, _rest = code.partition("cfg = agent_config.view")
    assert 'stage("outbox"' in early, (
        "the empty-pending early return does not report, so a delivery tier "
        "that ran and had nothing to do is silent")


def test_a_thin_document_is_a_WARNING_and_not_just_a_number() -> None:
    """⚠️ THE 480-CHARACTER DOCUMENT THAT COST AN OBSERVATION PERIOD. It was
    well-formed, which is why nobody caught it; a size with no threshold beside
    it is a statistic somebody might notice rather than a fault that arrives."""
    from agent import scheduler

    buf = io.StringIO()
    with redirect_stdout(buf):
        scheduler.describe_document("x" * 480)
    thin = buf.getvalue()
    assert "WARNING" in thin and "480" in thin, (
        "a document too thin to be about a villa does not warn, so triage "
        "running blind reads exactly like a villa with nothing going on")

    buf = io.StringIO()
    with redirect_stdout(buf):
        scheduler.describe_document("x" * (scheduler.THIN_DOCUMENT_CHARS + 1))
    assert "WARNING" not in buf.getvalue(), (
        "a healthy document warns, so the warning means nothing")


def test_the_tier_names_are_not_restated_anywhere_they_could_drift() -> None:
    """⚠️ ONE SPELLING PER TIER. `stage("outbox", ...)` and a hand-written
    `log("outbox: ...")` beside it would put two formats in one trace, and the
    reader cannot tell which lines are the instrumented ones."""
    src = _shipped_source()
    for tier in TIERS:
        stray = re.findall(rf'\blog\(\s*f?"{tier}: ', src)
        assert not stray, (
            f"{tier!r} is logged both through stage() and through a bare log() "
            f"call ({len(stray)} of them), so one tier speaks in two formats")


def test_the_trace_helpers_have_no_import_cost() -> None:
    """⚠️ `reports/log.py` IS IMPORTED BY EVERYTHING, including the proxy at
    boot and every tool module. A trace helper that dragged in the agent
    package would make the cheapest module in the tree the most expensive, and
    would be a circular import waiting for the first tool that logs."""
    with open(os.path.join(BIN, "reports", "log.py"), encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    imported = {
        (node.module or "").split(".")[0]
        for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)
    } | {
        alias.name.split(".")[0]
        for node in ast.walk(tree) if isinstance(node, ast.Import)
        for alias in node.names
    }
    assert not (imported & {"agent", "reports", "observe"}), (
        f"reports/log.py imports {sorted(imported)} — it must stay dependency-"
        "free, or the module every other module logs through gains a cycle")
