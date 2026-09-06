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

from conftest import strip_prose  # noqa: E402
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


def test_every_caller_of_run_report_resolves_ONE_request() -> None:
    """⚠️ THE SHAPE THAT MADE THE DEFECT POSSIBLE IS GONE (2026-09-06).

    This test used to `os.walk` every `.py` under `rootfs/usr/bin`, extract the
    argument text of every `run_report(` call and grep it for the flag — 143
    lines to check that two callers each remembered a keyword. Its own docstring
    named why: "the third one is written by somebody who copies the second, and
    copying is how this defect was made."

    A caller cannot forget a field it does not pass. `run_report` now takes ONE
    resolved `BriefRequest`, and `from_config` is the only place the config's
    shape is read — so what is left to check is that the callers build one, and
    that building one is correct.
    """
    for name, text in _python_sources().items():
        # ⚠️ PROSE REMOVED FIRST. The first version of this scan flagged
        # `request.py` itself, because its docstring EXPLAINS the `run_report(`
        # calls it replaced — the same trap that has now bitten four separate
        # pins in this suite, which is why `conftest.strip_prose` exists.
        # ⚠️ CALLS, NOT THE DEFINITION. The capture starts AFTER the paren, so
        # a `if "def run_report" in call` guard never sees the keyword — the
        # look-behind is what excludes it.
        for call in re.findall(r"(?<!def )run_report\(([^;]*?)\)\n",
                               strip_prose(text), re.S):
            assert "request=" in call, (
                f"{name} calls run_report without a resolved request, so it is "
                "back to threading the config's shape by hand — which is how "
                "`supervision_enabled` came to be missing for releases")


def test_the_request_resolves_the_switch_and_the_defaults() -> None:
    """⚠️ THE FLAG ITSELF, ASSERTED BY CALLING RATHER THAN BY GREPPING. A
    default of False is a VALID value, which is why nothing raised, nothing
    typed wrong and nothing went red when it was omitted."""
    import sys as _sys

    _sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
    from vesta.brief.request import BriefRequest

    on = BriefRequest.from_config({}, {"enabled": True}, {})
    off = BriefRequest.from_config({}, {"enabled": False}, {})
    assert on.supervision_enabled is True and off.supervision_enabled is False, (
        "the master switch is no longer read from the agent config, so every "
        "brief runs one side of the gate whatever the villa is set to")

    # ⚠️ `settings` IS THE `modules` SLICE, NOT THE CONFIG. Threading the whole
    # document here is the original confusion that forced `min_history_days`
    # and the switch to travel separately in the first place.
    req = BriefRequest.from_config(
        {"modules": {"weather": {}}, "min_history_days": "7",
         "narration": {"mode": "x"}},
        {"enabled": True}, {"moduleFailures": {"weather": 2}})
    assert req.settings == {"weather": {}}, "settings is not the modules slice"
    assert req.min_history_days == 7, "min_history_days is not coerced to int"
    assert req.narration == {"mode": "x"}
    assert req.module_failures == {"weather": 2}

    # ⚠️ NEVER `None`: every consumer treats a missing slice as "nothing
    # configured", and a None reaching them is an AttributeError inside a
    # background sweep.
    empty = BriefRequest.from_config({}, {}, {})
    assert empty.settings == {} and empty.narration == {}
    assert empty.module_failures == {} and empty.min_history_days == 14

def test_the_gate_no_longer_reads_the_switch_at_all() -> None:
    """⚠️ THE PREMISE OF THIS FILE REVERSED FOUR DAYS AFTER IT WAS WRITTEN,
    AND THE CALLER PIN ABOVE OUTLIVED IT. This file was born pinning "the
    switch must REACH the gate" — the preview endpoint had omitted it and
    silently ran a different pipeline from the scheduler. On 2026-08-29 the
    owner's reasoning removed the gate arm the flag fed: the briefing never
    reads the automations, so standing a check down left off-mode with no
    analysis from either side.

    ⚠️ AND THE DEFENCE OFFERED FOR KEEPING THE FIELD WAS FALSE (2.967.0). It
    read "`supervision_enabled` is still real context (the diagnostics banner
    reads it)". The banner reads the proxy's OWN local, `supervision_on`,
    computed where the endpoint is served; `command grep` finds zero readers of
    `context.supervision_enabled` anywhere. So the field was carried four hops
    to a dead end, and the sentence defending it named a reader that was a
    different value with a similar name — which is how a thread like this
    survives a review.

    The field is deleted; the SWITCH is not. `BriefRequest.supervision_enabled`
    still resolves it from `agent-config.json`, and
    `test_the_request_resolves_the_switch_and_the_defaults` above pins that.
    THIS test pins what remains true at the gate: it treats a covered check the
    same either way, so the preview-vs-scheduled divergence this file was born
    from is impossible there rather than merely guarded against.
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

    # ⚠️ THE CONTEXT NO LONGER CARRIES THE SWITCH AT ALL, which is a stronger
    # statement than "the gate ignores it": there is nothing left for a
    # stand-down arm to read. Driving the gate twice over a field the gate has
    # never mentioned was two runs of the same run.
    ok, reason, _ = gate(module, _Ctx(), {}, 3650)
    assert ok, (
        f"a covered check refused ({reason!r}) — the stand-down arm is back")

    import dataclasses

    from vesta.shared.analysis.base import ModuleContext
    assert not any(f.name == "supervision_enabled"
                   for f in dataclasses.fields(ModuleContext)), (
        "the switch is on ModuleContext again. It is welcome back the day "
        "something READS it — until then it is four hops of plumbing to a "
        "dead end, wearing the look of a live gate")
