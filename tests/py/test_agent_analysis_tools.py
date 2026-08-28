"""TASK-070's acceptance criterion: identical results on the same fixtures.

The task's own risk line is the reason this file exists — *"changing statistics
while moving them makes a regression unattributable. Move first, tune never."*
So the question here is not "does the tool work" but "does the tool return the
SAME numbers the module returns", asked over the fixture that `test_analysis`
uses for the case the module exists for (21 steady days then 7 at nearly
double).

⚠️ THE COMPARISON IS AGAINST A LIVE MODULE RUN, NOT AGAINST A TRANSCRIBED
EXPECTATION. A hard-coded 0.9 here would agree with itself forever while the
module moved underneath it; running both sides over one fixture is what makes
"identical" checkable rather than asserted.

⚠️ AND THE TOOL IS FED THROUGH ITS PUBLIC SURFACE — `tool.call(args)`, the same
entry `registry.invoke` uses, so the result includes whatever the tool layer
does on the way out. Calling `run()` directly would skip exactly the half that
is new.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any, Dict, List, Sequence

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.supervise.agent.tools import analysis as analysis_tools
from vesta.shared.analysis.base import ModuleContext               # noqa: E402
from vesta.shared.analysis.modules.standby_creep import StandbyCreep  # noqa: E402

STAT_ID = "sensor.x_energy"


def _hours(day: str, idle: float, active: float,
           idle_hours: int = 8) -> List[Dict[str, Any]]:
    rows = [{"start": f"{day}T{h:02d}:00:00", "change": idle}
            for h in range(idle_hours)]
    rows += [{"start": f"{day}T{h:02d}:00:00", "change": active}
             for h in range(idle_hours, 24)]
    return rows


def _series(idle_by_day: Sequence[float]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for index, idle in enumerate(idle_by_day):
        rows += _hours(f"2026-07-{index + 1:02d}", idle, 1.0)
    return rows


#: The fixture `test_analysis.test_a_clear_creep_is_found` uses.
CREEP = _series([0.10] * 21 + [0.19] * 7)
STEADY = _series([0.10] * 28)


def _module_findings(series: List[Dict[str, Any]]) -> List[Any]:
    async def fetch(ids: Sequence[str], days: int) -> Dict[str, Any]:
        return {STAT_ID: series}

    context = ModuleContext(
        audience="owner", cadence="weekly",
        now_local=__import__("datetime").datetime(2026, 7, 29, 8, 0),
        capabilities=["statistics", "energy_devices"],
        inventory={"energy": {"devices": [STAT_ID]}},
        settings={}, min_history_days=14, stats=fetch, labels={},
        supervision_enabled=True)
    return asyncio.run(StandbyCreep().run(context))


def _tool_payload(series: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Run the TOOL over the same fixture, through `call`."""
    tool = analysis_tools.StandbyCreep(
        session_source=lambda: object(),
        discovery_source=lambda: {
            "reachable": True,
            "capabilities": ["statistics", "energy_devices"],
            "inventory": {"energy": {"devices": [STAT_ID]}}})

    # ⚠️ THE STATS FETCHER IS THE ONE THING SUBSTITUTED, because the real one
    # opens a websocket to Home Assistant. Everything between it and the
    # answer — the module, the context assembly, the row mapping — is the
    # shipped path.
    async def fetch(ids: Sequence[str], days: int) -> Dict[str, Any]:
        return {STAT_ID: series}

    real_context = tool._context
    def context(session: Any, found: Any, days: int) -> ModuleContext:
        built = real_context(session, found, days)
        built.stats = fetch
        return built
    tool._context = context                                   # type: ignore[method-assign]

    blocks = asyncio.run(tool.call({}))
    assert blocks, "the tool returned no content block"
    payload = blocks[0].get("json") if isinstance(blocks[0], dict) else None
    if payload is None:                                        # pragma: no cover
        payload = json.loads(blocks[0].get("text") or "{}")
    return payload


def test_the_tool_returns_the_modules_own_numbers() -> None:
    findings = _module_findings(CREEP)
    assert len(findings) == 1, "the fixture no longer produces the known creep"
    module_finding = findings[0]

    payload = _tool_payload(CREEP)
    rows = payload.get("findings") or []
    assert len(rows) == 1, f"the tool disagreed on how many findings: {payload}"
    row = rows[0]

    # The numbers, exactly — not rounded, not re-derived.
    assert row["observed"] == module_finding.observed
    assert row["baseline"] == module_finding.baseline
    assert row["delta"] == module_finding.delta
    assert row["severity"] == module_finding.severity
    assert row["kind"] == module_finding.kind
    assert row["subject"] == module_finding.label
    assert row["detail"] == module_finding.detail


def test_a_steady_device_is_reported_as_nothing_stood_out() -> None:
    """⚠️ AND IT IS NOT AN EMPTY LIST WITH NO WORDS. "Nothing stood out" and
    "this check could not run" are opposite answers, and every layer of this
    subsystem has at some point rendered them identically."""
    assert _module_findings(STEADY) == []
    payload = _tool_payload(STEADY)
    assert payload["findings"] == []
    assert payload["verdict"] == "nothing stood out"


def test_no_statistic_id_or_hash_reaches_the_model() -> None:
    """The row carries the resolved label and the numbers — never the id it was
    computed from, never `ref`, `dedup_key` or `subject_key`."""
    payload = _tool_payload(CREEP)
    blob = json.dumps(payload)
    assert STAT_ID not in blob, "the statistic id reached the tool's output"
    for field in ("ref", "dedup_key", "subject_key"):
        assert f'"{field}"' not in blob, f"{field} reached the tool's output"


def test_a_check_with_no_session_refuses_in_words() -> None:
    """⚠️ NOT AN EMPTY RESULT. A check that silently returns nothing because it
    was never wired reports a healthy villa it did not look at — the failure
    this subsystem has met at every layer."""
    tool = analysis_tools.StandbyCreep()
    blocks = asyncio.run(tool.call({}))
    text = json.dumps(blocks)
    assert "unavailable" in text, blocks
    assert "Home Assistant" in text, blocks


def test_every_check_in_CHECKS_has_a_module_and_a_class() -> None:
    """A name in the catalogue with no module behind it publishes a tool that
    can only ever answer `not_found`."""
    assert set(analysis_tools.CHECKS) == {
        c.check for c in analysis_tools.ANALYSIS_TOOLS}
    for name in analysis_tools.CHECKS:
        assert analysis_tools._module(name) is not None, name
