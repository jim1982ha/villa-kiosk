"""One switch, one meaning: a check switched off is off for the agent too.

⚠️ 2026-08-29, owner: "How come the agent can continue using a check if we are
switching it off? Isn't the agent directly reading from the check?" It is —
that was the whole mechanism. `registry.gate` reads the operator's toggle inside
the BRIEFING's loop; `agent/tools/analysis.py` calls the module class directly,
so the toggle was a line on the briefing's shopping list rather than a property
of the check. True of the code, invisible from a tablet whose control reads
"switch it off", and the failure mode is the worst kind: a concern arriving from
a check the owner believed was off, with the screen that promised otherwise
still open.

⚠️ THE `enabled` ARM ONLY. The gate's other arms — audience, minimum history,
the supersede rule, the consecutive-failure counter — are questions about
composing a BRIEF, and an investigation is not a brief. Carrying the whole gate
across would refuse a named, on-demand question with "not part of the owner
brief", which is nonsense. What crosses is the one arm that is a person's
decision.

⚠️ AND IT DEFAULTS TO ON, IN EVERY FAILURE DIRECTION. Absent config, a
malformed slice and an unreadable file all mean "on", matching `registry.gate`,
which refuses only on an explicit `enabled is False`. A guard that failed closed
would disable analysis on every fresh install — the exact silence this
subsystem keeps being caught by.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any, Dict, List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.adapters import store  # noqa: E402
from vesta.supervise.agent.tools import analysis as analysis_mod  # noqa: E402


def _tool() -> Any:
    """One real tool, built the way the registry builds it.

    ⚠️ THE SESSION IS PRESENT ON PURPOSE. The refusal under test must come from
    the SWITCH, and `run` refuses a missing session a few lines further down —
    a test with no session would pass while measuring the wrong refusal.
    """
    for cls in vars(analysis_mod).values():
        if (isinstance(cls, type)
                and issubclass(cls, analysis_mod.AnalysisTool)
                and cls is not analysis_mod.AnalysisTool
                and getattr(cls, "check", "")):
            return cls(session_source=object(), discovery_source=None)
    raise AssertionError("no AnalysisTool subclass found — this test is blind")


def _write(tmp_path: Any, modules: Any) -> None:
    # ⚠️ THE BARE DOCUMENT, NOT `{"config": ...}`. That envelope exists on the
    # HTTP boundary only — `config_view` merges TOP-LEVEL keys straight from the
    # file, so a wrapped fixture yields pure defaults and the test would pass
    # while measuring nothing. Written the way `outbox` reads it.
    path = os.path.join(str(tmp_path), "reports-config.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"modules": modules}, handle)
    store.REPORTS_CONFIG_FILE = path


def _run(tool: Any) -> List[Dict[str, Any]]:
    return asyncio.run(tool.run({}))


def _reason(rows: List[Dict[str, Any]]) -> str:
    return " ".join(str(r.get("detail") or r.get("message") or r) for r in rows)


def test_a_check_switched_OFF_is_not_run_by_the_agent(tmp_path: Any) -> None:
    original = store.REPORTS_CONFIG_FILE
    try:
        tool = _tool()
        _write(tmp_path, {tool.check: {"enabled": False}})
        rows = _run(tool)
        assert not tool._switched_on(), "the guard does not see the operator's off"
        assert "switched off" in _reason(rows).lower(), (
            f"the agent ran a check the owner switched off: {rows}")
    finally:
        store.REPORTS_CONFIG_FILE = original


def test_it_defaults_to_ON_in_every_direction(tmp_path: Any) -> None:
    """⚠️ FOUR WAYS TO HAVE NO ANSWER, AND ALL FOUR MEAN ON."""
    original = store.REPORTS_CONFIG_FILE
    try:
        tool = _tool()

        _write(tmp_path, {})                                   # configured nothing
        assert tool._switched_on(), "an empty modules map read as off"

        _write(tmp_path, {tool.check: {}})                     # slice with no flag
        assert tool._switched_on(), "a slice without `enabled` read as off"

        _write(tmp_path, {tool.check: "yes"})                  # wrong shape
        assert tool._switched_on(), "a malformed slice read as off"

        store.REPORTS_CONFIG_FILE = os.path.join(str(tmp_path), "absent.json")
        assert tool._switched_on(), "a missing config file read as off"

        # ⚠️ THESE TWO REACH BRANCHES THE FOUR ABOVE DO NOT, AND MUTATION IS HOW
        # I FOUND THAT OUT. Every case above leaves `modules` a dict and never
        # raises, so flipping either fallback to False left this file GREEN —
        # the property was asserted while the code implementing it was never
        # executed. The test was the vacuous half, not the guard.
        _write(tmp_path, "not-a-map")                          # `modules` itself wrong
        assert tool._switched_on(), "a non-dict modules value read as off"

        def _boom(*_a: Any, **_k: Any) -> Any:
            raise OSError("unreadable")
        original_read = store.read_json
        store.read_json = _boom                                # type: ignore[assignment]
        try:
            assert tool._switched_on(), "an unreadable config read as off"
        finally:
            store.read_json = original_read                    # type: ignore[assignment]

        _write(tmp_path, {tool.check: {"enabled": True}})      # and explicitly on
        assert tool._switched_on()
    finally:
        store.REPORTS_CONFIG_FILE = original


def test_only_the_operators_arm_crosses_over(tmp_path: Any) -> None:
    """⚠️ THE BRIEF'S OTHER GATE ARMS MUST NOT REACH THE TOOL. An investigation
    asks a named question on demand; refusing it because the check is "not part
    of the owner brief", or because there is less history than a WEEKLY brief
    wants, would be the briefing's rules governing something that is not a
    briefing."""
    import inspect
    import re
    src = inspect.getsource(analysis_mod)
    assert "_switched_on" in src, "the guard has been removed"

    # ⚠️ CODE, NOT PROSE. The first version of this asserted `"registry.gate"
    # not in src` and failed on the guard's OWN COMMENT, which names the gate to
    # explain why it is not called — /dry-audit step 7 ("a pattern matching
    # PROSE in a comment") committed inside the test written to prevent it.
    code = "\n".join(line for line in src.split("\n")
                     if not line.lstrip().startswith("#"))
    assert not re.search(r"\bregistry\s*\.\s*gate\s*\(", code), (
        "the tool now calls the briefing's gate, which applies a brief's rules "
        "to an investigation")
    assert not re.search(r"^\s*(from|import)\s+vesta\.brief", code, re.M), (
        "the tool imports `brief`, coupling the exportable half to the "
        "deletable one — see test_layering")
