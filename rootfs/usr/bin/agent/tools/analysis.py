"""The three statistical checks, as tools the agent calls when it wants them.

TASK-070, PH-5. Their objective in one line: **keep the statistics, drop the
gating ceremony.**

⚠️ THIS FILE CONTAINS NO STATISTICS AND MUST NEVER CONTAIN ANY. It calls
`reports.analysis.modules` — the same classes, unchanged — and its whole job is
to assemble the `ModuleContext` those classes already take and to turn the
`Finding`s they already return into tool output. The task's own risk line is
the reason: *"changing statistics while moving them makes a regression
unattributable. Move first, tune never."* So `robust.py`, `materiality.py`,
`series.py` and the three modules are untouched, and the same fixtures prove
the same numbers (`test_analysis.py` still runs them directly).

⚠️ WHAT IS ACTUALLY DROPPED IS THE CEREMONY AROUND THEM. Through the briefing
pipeline a module is REGISTERED, then GATED (audience, capabilities, history
depth, supervision), then run under a timeout, then its findings ranked,
grouped, bucketed and rendered. Reached as a tool it is simply run, because the
model asking for it has already decided it is relevant — which is the judgement
the gate was approximating. The gate is not deleted here; it is bypassed by a
caller that does not need it, and TASK-072 removes it once nothing needs it.

⚠️ A CHECK THAT CANNOT RUN SAYS SO, RATHER THAN RETURNING NOTHING. "No devices
are metered on this property" and "every metered device is behaving" are
opposite answers that both render as an empty list, and this subsystem has paid
for that confusion at every layer. `unavailable` carries the reason.

⚠️ IT NEEDS HOME ASSISTANT AND SAYS SO WHEN IT HAS NONE. The modules read
long-run statistics, which only HA holds; with no session the tool refuses
rather than reporting a healthy villa it never looked at.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Mapping, Optional, Sequence

from agent.tools.base import BaseTool, data, fail

#: The modules this file exposes, by name. ⚠️ A LIST, NOT A SCAN OF THE
#: REGISTRY: the registry is what PH-5 removes, so depending on it here would
#: put this file on the thing it is meant to outlive.
CHECKS: Dict[str, str] = {
    "standby_creep": "equipment drawing more when idle than it used to",
    "level_anomaly": "a reading that has moved away from its own normal range",
    "sensor_health": "sensors that have gone quiet, stuck or unavailable",
}

#: How far back a check may be asked to look. The modules define their own
#: windows (standby_creep uses 7 against 21 days); this only bounds what an
#: operator or a model can ask for.
DEFAULT_HISTORY_DAYS: int = 28
MAX_HISTORY_DAYS: int = 90


def _module(name: str) -> Any:
    """The module class for a check name, or None."""
    from vesta.shared.analysis.modules import (level_anomaly, sensor_health,
                                          standby_creep)
    return {
        "standby_creep": standby_creep.StandbyCreep,
        "level_anomaly": level_anomaly.LevelAnomaly,
        "sensor_health": sensor_health.SensorHealth,
    }.get(name)


def _finding_row(finding: Any) -> Dict[str, Any]:
    """One `Finding` as plain scalars, with the villa's own names left behind.

    ⚠️ FIELD NAMES ARE THE DATACLASS'S — `observed`, not `value`; `detail`,
    not `headline`. Written from `analysis/base.Finding` rather than from
    memory: a `getattr` default silently produces a well-formed row of empty
    strings, which is `feedback_guessed-field-shapes` exactly — the name looks
    right, the type is wrong, and a good fallback hides it for the life of the
    feature.

    ⚠️ NO ENTITY ID AND NO HASH REACHES THE MODEL FROM HERE. `ref`,
    `dedup_key` and `subject_key` are deliberately not copied: the model gets
    the human LABEL the module already resolved plus the numbers behind it.
    `redact.audit` would refuse an id anyway; not producing the field is the
    version that cannot be forgotten.
    """
    def num(value: Any) -> Optional[float]:
        return float(value) if isinstance(value, (int, float)) else None

    return {
        "subject": str(getattr(finding, "label", "") or ""),
        "severity": str(getattr(finding, "severity", "") or ""),
        "kind": str(getattr(finding, "kind", "") or ""),
        "detail": str(getattr(finding, "detail", "") or ""),
        "area": str(getattr(finding, "area", "") or ""),
        "metric": str(getattr(finding, "metric", "") or ""),
        "unit": str(getattr(finding, "unit", "") or ""),
        "observed": num(getattr(finding, "observed", None)),
        "baseline": num(getattr(finding, "baseline", None)),
        "delta": num(getattr(finding, "delta", None)),
        "window_days": getattr(finding, "window_days", None),
        # ⚠️ CONFIDENCE AND COMPLETENESS TRAVEL. A rise measured over a window
        # that was half empty is a different claim from the same rise measured
        # over a full one, and dropping them would hand the model a number it
        # could only over-trust.
        "confidence": num(getattr(finding, "confidence", None)),
        "completeness": num(getattr(finding, "completeness", None)),
    }


class AnalysisTool(BaseTool):
    """One statistical check, run on demand. Subclassed once per check.

    ⚠️ THREE SUBCLASSES, NOT ONE CLASS WITH THREE INSTANCES, AND A TEST DECIDED
    THAT. `ALL_TOOLS` holds CLASSES and every consumer constructs them with
    `cls()` — `build_registry`'s fallback, the MCP server's catalogue, and
    `test_agent_contracts`, which walks this package and requires every
    `BaseTool` subclass to reach that tuple. A parameterised class cannot be
    built by `cls()` and would have had to be exempted, i.e. excluded from the
    one contract that keeps the two tool surfaces identical (ARCH-012).

    ⚠️ ONE IMPLEMENTATION STILL. The subclasses declare a name and inherit
    everything; `__init_subclass__` writes the description and the schema from
    `CHECKS`, so a fourth check is one three-line class.
    """

    mode = "READ"
    #: Which module this subclass runs. Empty on the base, which is why the
    #: base is not itself a usable tool.
    check: str = ""

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        if not cls.check:                                     # pragma: no cover
            return
        cls.name = cls.check
        cls.description = (
            f"Run the “{cls.check}” check over this property's own recorded "
            f"history: {CHECKS.get(cls.check, '')}. Compares each device "
            "against its OWN past rather than any fixed threshold, so it "
            "means the same thing on any property. Returns the devices that "
            "stand out, with the numbers behind each.")
        cls.inputSchema = {
            "type": "object",
            "properties": {
                "history_days": {
                    "type": "integer", "minimum": 1,
                    "maximum": MAX_HISTORY_DAYS,
                    "description": (
                        "How much history the check may read. Default "
                        f"{DEFAULT_HISTORY_DAYS}.")},
            },
        }

    def __init__(self, *, session_source: Any = None,
                 discovery_source: Any = None) -> None:
        # ⚠️ BOTH DEFAULT TO None SO `cls()` WORKS — see the class docstring.
        # An unsourced instance refuses in words; it does not report a healthy
        # villa it never looked at.
        self._session_source = session_source
        self._discovery_source = discovery_source

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        module_cls = _module(self.check)
        if module_cls is None:                                # pragma: no cover
            return [fail("not_found", f"no check named {self.check}")]

        session = (self._session_source() if callable(self._session_source)
                   else self._session_source)
        if session is None:
            return [fail("unavailable",
                         "this check reads long-run statistics from Home "
                         "Assistant and there is no connection to it")]

        try:
            days = int(args.get("history_days") or DEFAULT_HISTORY_DAYS)
        except (TypeError, ValueError):
            days = DEFAULT_HISTORY_DAYS
        days = max(1, min(MAX_HISTORY_DAYS, days))

        try:
            found = await self._discover(session)
            if not found.get("reachable", False):
                return [fail("unavailable",
                             "Home Assistant could not be reached, so this "
                             "check did not run")]
            context = self._context(session, found, days)
            findings = await module_cls().run(context)
        except Exception as err:  # noqa: BLE001 - a tool error is DATA
            # ⚠️ REPORTED AS A TOOL ERROR, NEVER RAISED. `registry.invoke` turns
            # this into a result the model routes around; an exception here
            # would decline a whole investigation over one check.
            return [fail("internal", f"the check could not complete: {err}")]

        rows = [_finding_row(f) for f in findings]
        if not rows:
            return [data({
                "check": self.name, "history_days": days, "findings": [],
                # ⚠️ THE TWO EMPTINESSES, TOLD APART. Everything the check
                # could examine behaved — as opposed to there being nothing to
                # examine, which the branch below reports as unavailable.
                "verdict": "nothing stood out"})]
        return [data({"check": self.name, "history_days": days,
                      "findings": rows,
                      "verdict": f"{len(rows)} device(s) stand out"})]

    async def _discover(self, session: Any) -> Dict[str, Any]:
        if callable(self._discovery_source):
            found = self._discovery_source()
            if hasattr(found, "__await__"):
                found = await found
            return dict(found or {})
        from vesta.adapters import discovery
        return dict(await discovery.discover(session))

    def _context(self, session: Any, found: Mapping[str, Any],
                 days: int) -> Any:
        """The context the module already expects.

        ⚠️ `supervision_enabled=True`, AND IT IS NOT A LIE — it is the one
        honest value here. That flag exists so the briefing's gate can stand a
        check down when the villa's automations are doing the job instead; a
        check reached through an AGENT TOOL has been asked for by the agent,
        which is supervision, running. The gate is not consulted on this path
        at all (see the module docstring); the field is set so that anything
        reading it downstream sees the truth about who is asking.
        """
        from vesta.shared.analysis.base import ModuleContext
        from reports.pipeline import _statistics_fetcher
        return ModuleContext(
            audience="owner", cadence="on demand",
            now_local=datetime.now(),
            capabilities=list(found.get("capabilities") or []),
            inventory=dict(found.get("inventory") or {}),
            settings={}, min_history_days=days,
            stats=_statistics_fetcher(session, datetime.now(), {}),
            labels={}, supervision_enabled=True)


class StandbyCreep(AnalysisTool):
    check = "standby_creep"


class LevelAnomaly(AnalysisTool):
    check = "level_anomaly"


class SensorHealth(AnalysisTool):
    check = "sensor_health"


#: ⚠️ THE EXPORT TUPLE `agent/tools/__init__` FOLDS INTO `ALL_TOOLS`. Every
#: other module here has one and the contract test requires it.
ANALYSIS_TOOLS = (StandbyCreep, LevelAnomaly, SensorHealth)


def analysis_tools(session_source: Any = None,
                   discovery_source: Any = None) -> List[BaseTool]:
    """The three checks, wired to this villa. One construction site."""
    return [cls(session_source=session_source,
                discovery_source=discovery_source)
            for cls in ANALYSIS_TOOLS]


#: Their names, for the tier lists in `registry`. Derived from the classes so a
#: fourth check joins every list by being written once.
ANALYSIS_TOOL_NAMES: Sequence[str] = tuple(c.check for c in ANALYSIS_TOOLS)
