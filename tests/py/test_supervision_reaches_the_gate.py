"""The master switch must reach the gate from EVERY caller, not just the clock.

⚠️ 2026-08-29, reported from the tablet: "it doesn't make sense to see this
screen while the VESTA agent supervision is on". The Modules tab was printing
`Last preview: Roi baseline deviation` on checks that were live, which reads as
"not used" — and it was telling the truth about a preview that had run with
supervision OFF.

`run_report(..., supervision_enabled: bool = False)` is threaded to
`registry.gate`, where `covered_by and not supervision_enabled` stands a check
down as `superseded`. The scheduled path (`pipeline.tick`) passed it. The
owner-only "run now / preview" endpoint in `supervisor-proxy.py` did not, and a
default of False is a VALID value, so nothing raised, nothing typed wrong and
nothing went red: every preview and every MANUAL send silently dropped every
module carrying `superseded_by`, while the scheduled brief kept them. The
endpoint's own comment called itself "a faithful rehearsal of the scheduled path
rather than a different one".

⚠️ `registry.run_all` already carried a warning about this exact shape one level
further in — a field not copied arrives at the gate as its default, silently.
The warning existed and the CALLER was never checked. That is
`feedback_pin-the-caller`, and this file is the caller's half.

⚠️ DERIVED FROM THE TREE, NEVER LISTED. A test naming today's two call sites is
`grep -l` wearing a test's clothes: the third one is written by somebody who
copies the second, and copying is how this defect was made.
"""
from __future__ import annotations

import os
import re
from typing import Dict, List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

#: Where a caller could live. Anything that composes a brief is in scope.
_ROOTS = (
    os.path.join(REPO_ROOT, "rootfs", "usr", "bin"),
)


def _python_sources() -> Dict[str, str]:
    out: Dict[str, str] = {}
    for root in _ROOTS:
        for dirpath, _dirs, files in os.walk(root):
            if "__pycache__" in dirpath:
                continue
            for name in files:
                if not name.endswith(".py"):
                    continue
                path = os.path.join(dirpath, name)
                with open(path, encoding="utf-8") as handle:
                    out[os.path.relpath(path, REPO_ROOT)] = handle.read()
    return out


def _call_sites(source: str, func: str) -> List[str]:
    """Every `func(` CALL in `source`, returned as its full argument text.

    ⚠️ THE DEFINITION IS NOT A CALL. `async def run_report(` carries the
    parameter with its default and would satisfy any naive substring test —
    which would make this file pass on a tree where no caller passes anything.
    """
    calls: List[str] = []
    for match in re.finditer(rf"(?<!def )\b{re.escape(func)}\s*\(", source):
        start = match.end() - 1
        depth = 0
        for i in range(start, len(source)):
            if source[i] == "(":
                depth += 1
            elif source[i] == ")":
                depth -= 1
                if depth == 0:
                    calls.append(source[start:i + 1])
                    break
    return calls


def test_every_caller_of_run_report_passes_the_master_switch() -> None:
    sources = _python_sources()

    # ⚠️ VACUOUS-PASS GUARD, BOTH HALVES. If the walk finds no files, or the
    # function is renamed, this compares two empty sets and reports health for
    # ever — the failure four counters in this project have already had.
    assert len(sources) >= 20, f"only {len(sources)} python sources found"

    found: List[str] = []
    offenders: List[str] = []
    for path, source in sources.items():
        for call in _call_sites(source, "run_report"):
            found.append(path)
            if "supervision_enabled" not in call:
                offenders.append(path)

    assert len(found) >= 2, (
        f"only {len(found)} call site(s) of run_report found — the anchor has "
        "moved and this test is measuring nothing")
    assert not offenders, (
        "these callers of run_report do not pass supervision_enabled, so the "
        f"gate sees its default of False and stands down every covered check: {offenders}")


def test_the_gate_no_longer_reads_the_switch_at_all() -> None:
    """⚠️ THE PREMISE OF THIS FILE REVERSED FOUR DAYS AFTER IT WAS WRITTEN,
    AND THE CALLER PIN ABOVE OUTLIVED IT. This file was born pinning "the
    switch must REACH the gate" — the preview endpoint had omitted it and
    silently ran a different pipeline from the scheduler. On 2026-08-29 the
    owner's reasoning removed the gate arm the flag fed: the briefing never
    reads the automations, so standing a check down left off-mode with no
    analysis from either side.

    The caller pin above still earns its keep — `supervision_enabled` is still
    real context (the diagnostics banner reads it) and a caller that omits it
    still diverges from the scheduler on whatever reads it next. THIS test
    pins the other half: the gate treats both positions identically, so the
    preview-vs-scheduled divergence this file was born from is now impossible
    at the gate rather than merely guarded against.
    """
    import sys
    sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
    from vesta.brief.registry import gate
    from vesta.shared.analysis.modules.level_anomaly import LevelAnomaly

    module = LevelAnomaly()
    assert getattr(module, "superseded_by", ()), (
        "the record of what this check replaced has been dropped — that half "
        "was meant to survive")

    class _Ctx:
        capabilities = frozenset(module.requires)
        settings: dict = {}
        min_history_days = 0
        audience = next(iter(module.audiences))
        supervision_enabled = True

    ok_on, reason_on, _ = gate(module, _Ctx(), {}, 3650)
    _Ctx.supervision_enabled = False
    ok_off, reason_off, _ = gate(module, _Ctx(), {}, 3650)

    assert ok_on and ok_off, (
        f"a covered check refused (on={reason_on!r}, off={reason_off!r}) — "
        "the stand-down arm is back")
