"""What an analysis module is, what it is given, and what it may return.

⚠️ A MODULE IS NEVER SILENTLY ABSENT. Every module either RUNS or produces a
SKIP with a reason, and the reason reaches the report. A section that quietly
does not appear reads as "there was nothing to report", which is a conclusion
nobody drew — and on a thin deployment, most sections would be missing, making
a working feature indistinguishable from a broken one.

⚠️ A LITERAL WATTAGE IN A MODULE IS A DEFECT. This is a redistributable
add-on: a threshold that works for one villa's pool pump is wrong for the next
property's underfloor heating. Thresholds resolve in one order, and every
module must use it — `resolve_threshold` below is the single implementation:

    operator annotation  ->  learned from the equipment's own history  ->  a
    DIMENSIONLESS module default

The middle step is what makes this work anywhere. "40% above this device's own
idle floor" is a claim about the device; "above 12 W" is a claim about a
device the author happened to own.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, Sequence

from ..contracts import FINDING_KIND, SEVERITY


@dataclass
class Finding:
    """One thing worth saying, with everything needed to say it honestly.

    ⚠️ `ref` IS NOT AN ENTITY ID. It is an opaque per-report handle, because
    entity ids routinely carry room and person names and Phase 6 sends findings
    to a third-party model. The `label` is what a human reads; the entity id
    stays behind in the villa. `PAYLOAD_ALLOWED_FIELDS` enforces this at the
    boundary, but the shape here is what makes it natural to obey.
    """

    ref: str
    kind: str
    severity: str
    label: str
    detail: str
    area: str = ""
    metric: str = ""
    unit: str = ""
    observed: Optional[float] = None
    baseline: Optional[float] = None
    delta: Optional[float] = None
    window_days: Optional[int] = None
    #: 0..1. Downgraded when the window was incomplete — see `completeness`.
    confidence: float = 1.0
    #: 0..1. How much of the expected data actually existed.
    completeness: float = 1.0
    horizon_days: Optional[int] = None
    #: Stable across runs for the same underlying condition, so a future phase
    #: can tell a NEW problem from one the owner has already been told about
    #: three weeks running. Alert fatigue is the primary product risk.
    dedup_key: str = ""

    def __post_init__(self) -> None:
        if self.kind not in FINDING_KIND:
            raise ValueError(f"unknown finding kind: {self.kind}")
        if self.severity not in SEVERITY:
            raise ValueError(f"unknown severity: {self.severity}")

    def as_dict(self) -> Dict[str, Any]:
        return {
            "ref": self.ref, "kind": self.kind, "severity": self.severity,
            "label": self.label, "detail": self.detail, "area": self.area,
            "metric": self.metric, "unit": self.unit,
            "observed": self.observed, "baseline": self.baseline,
            "delta": self.delta, "window_days": self.window_days,
            "confidence": round(self.confidence, 3),
            "completeness": round(self.completeness, 3),
            "horizon_days": self.horizon_days, "dedup_key": self.dedup_key,
        }


@dataclass
class ModuleContext:
    """Everything a module is allowed to look at.

    Deliberately a hand-assembled set rather than "the session" — a module that
    can open its own websocket can also make its own unbudgeted queries, and
    the scheduler cannot then bound a pass. Modules read; the pipeline fetches.
    """

    audience: str
    cadence: str
    now_local: Any
    capabilities: Sequence[str]
    inventory: Dict[str, Any]
    #: Operator settings for this module, from `config["modules"][name]`.
    settings: Dict[str, Any] = field(default_factory=dict)
    #: How many days of history the operator considers enough.
    min_history_days: int = 14
    #: Injected by the pipeline: `await stats(ids, days)` -> per-id daily rows.
    stats: Any = None
    #: Injected by the pipeline: labels for statistic ids, from the registry.
    labels: Dict[str, str] = field(default_factory=dict)


class AnalysisModule(Protocol):
    """One question asked of the villa's history."""

    name: str
    #: Capabilities that must ALL be present for this module to mean anything.
    requires: Sequence[str]
    #: Which audiences this module's findings belong to.
    audiences: Sequence[str]
    #: Refuses to run on less history than this, because a baseline built from
    #: three days is not a baseline.
    min_days: int

    async def run(self, context: ModuleContext) -> List[Finding]:
        ...


def resolve_threshold(settings: Dict[str, Any], key: str,
                      learned: Optional[float], default: float) -> float:
    """The one threshold resolution order, used by every module.

    ⚠️ THE ORDER IS THE RULE. An operator's explicit annotation always wins —
    they know their property. Otherwise a value learned from this equipment's
    own distribution, which is what makes a module portable. Only then a
    DIMENSIONLESS default.

    `learned` is passed rather than computed here because only the module knows
    what its threshold means; this function owns the precedence, not the
    statistics.
    """
    annotated = settings.get(key)
    if isinstance(annotated, (int, float)) and not isinstance(annotated, bool):
        return float(annotated)
    if learned is not None and learned == learned:  # not NaN
        return float(learned)
    return float(default)


def dedup_key(module: str, subject: str) -> str:
    """A key that is stable for the same condition and carries no identifier.

    ⚠️ THE SUBJECT IS HASHED, and that is not decoration. A dedup key exists to
    tell a NEW problem from one the owner has already been told about three
    weeks running — it only ever needs to be STABLE and UNIQUE, never readable.
    Building it as `module:entity_id` made every Finding carry an entity id in
    plain text, and entity ids routinely name rooms and people
    (`sensor.emmas_bedroom_window`).

    `PAYLOAD_ALLOWED_FIELDS` would have filtered it at the Phase 6 boundary, so
    nothing would have leaked — but this subsystem's rule is that a guarantee
    is worth more as "the data is not there" than as "the filter is careful",
    and the cost of being sure is one hash. Caught by a test asserting no
    Finding contains an entity id anywhere.

    The module name stays readable so a stored history is still diagnosable at
    a glance; only the subject is opaque.
    """
    digest = hashlib.sha256(subject.encode("utf-8")).hexdigest()[:16]
    return f"{module}:{digest}"


def skip(module: str, reason: str, detail: str = "") -> Dict[str, str]:
    """A module that did not run, in the form the report renders."""
    return {"module": module, "reason": reason, "detail": detail}
