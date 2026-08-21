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
    #: WHICH DEVICE this is about, as an opaque hash — see `subject_key`.
    #:
    #: ⚠️ THE HASH IS THE WHOLE DESIGN. The report must be able to tell that a
    #: built-in check and a blueprint are talking about the SAME equipment, so
    #: it can print it once; and a Finding may not carry an entity id, because
    #: entity ids name rooms and people and Phase 6 ships findings to a
    #: third-party model. Hashing both sides satisfies both: the comparison is
    #: exact, and there is nothing to leak. `dedup_key` cannot serve — it is
    #: prefixed by the MODULE, so two layers describing one pump never match.
    subject_key: str = ""

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
            # ⚠️ TRAVELS AS FAR AS THE PIPELINE AND NO FURTHER. It is what the
            # blueprint layer is deduplicated against, and it is a hash — but
            # it is not on `PAYLOAD_ALLOWED_FIELDS`, so `payload.build` (which
            # loops over the ALLOW-LIST, never over the input) leaves it behind,
            # and `_withheld_fields` names it as dropped on the inspector.
            "subject_key": self.subject_key,
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
    #: Installed VESTA blueprints that have never produced an event, by stem.
    #: ⚠️ THE GATE USES THIS TO QUALIFY A STAND-DOWN, NEVER TO REVERSE ONE.
    #: "Installed beats fired" stays the rule — see `collect.blueprint_layer_present`
    #: for why a quiet, well-run villa must not get duplicate findings. What
    #: this adds is honesty about the claim: a check that stood down for a
    #: blueprint which has never reported is covered in theory only, and the
    #: brief now says which.
    silent_blueprints: Sequence[str] = ()
    #: How long the collector has been listening, in days — or None when it
    #: cannot say (never connected, or the buffer has no `online_since`).
    #:
    #: ⚠️ NOT "HOW LONG SINCE THE BLUEPRINT LAST FIRED", AND THE DIFFERENCE IS
    #: THE WHOLE POINT. A listener that came up an hour ago has no standing to
    #: conclude anything about a rule that fires monthly, however long that rule
    #: has actually been quiet. The question the gate asks is "have I been
    #: watching long enough for this silence to mean something", which is a fact
    #: about the LISTENER. None means "cannot say", and the gate then leaves the
    #: stand-down in place — the conservative direction.
    heard_nothing_for_days: Optional[float] = None

    @property
    def zone(self) -> Any:
        """The timezone every day bucket in this pass must be built in.

        ⚠️ ONE ANSWER, NOT THREE. All three modules re-derived this as
        `getattr(context.now_local, "tzinfo", None)`, and a module that forgets
        buckets its days in UTC — which is not a rounding error but a different
        set of days, silently shifting every reading across a boundary. The
        scheduler already cost a release to exactly that mistake (it ran in UTC
        because `"timezone": ""` was commented "ask Home Assistant" and nothing
        asked). A fourth module gets the right zone by READING it, not by
        remembering to derive it.
        """
        return getattr(self.now_local, "tzinfo", None)


class AnalysisModule(Protocol):
    """One question asked of the villa's history."""

    #: The identifier: stable, snake_case, stored in config and history. NEVER
    #: shown to an operator — see `title`.
    name: str
    #: What this check is called on screen, and what it looks for, in the
    #: owner's language.
    #:
    #: ⚠️ THESE EXIST BECAUSE THE CHECKS TAB READ AS DEVELOPER NOTES. It showed
    #: `name.replace("_", " ")` — "level anomaly", "standby creep" — beside
    #: "owner and facility · needs 42 days of history", and the owner said it
    #: "feels like internal comments". It was: an identifier with its
    #: underscores taken out is an identifier, and a capability list is a
    #: precondition, not a purpose. Someone deciding whether to switch a check
    #: OFF needs to know what it would stop telling them.
    #:
    #: ⚠️ AND THEY LIVE ON THE MODULE, NOT IN THE SPA. A table of display names
    #: in TypeScript is a second list that goes stale the day a module is added
    #: or renamed — the exact cross-artefact drift `test_store_envelope` exists
    #: for. The module knows what it does; it says so once, here.
    title: str
    description: str
    #: Capabilities that must ALL be present for this module to mean anything.
    requires: Sequence[str]
    #: Which audiences this module's findings belong to.
    audiences: Sequence[str]
    #: Refuses to run on less history than this, because a baseline built from
    #: three days is not a baseline.
    min_days: int
    #: Blueprint stems whose presence stands this module down, because the
    #: property's own automation layer already asks the same question with more
    #: context. Empty for a module nothing supersedes. See `registry.gate`.
    superseded_by: Sequence[str]

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


def subject_key(subject: str) -> str:
    """WHICH DEVICE, opaquely — the join key between the two detection layers.

    ⚠️ NO PREFIX, AND THAT IS THE POINT. `dedup_key` answers "is this the same
    FINDING as last week" and is prefixed by the module so two checks about one
    pump stay distinct. This answers "is this the same EQUIPMENT as that one",
    and it has to match across a built-in module and a blueprint that have
    nothing else in common — so the module may not appear in it.

    ⚠️ SAME HASH, SAME TRUNCATION as `dedup_key` — and `dedup_key` now CALLS
    this rather than restating it. Both used to spell out
    `sha256(...).hexdigest()[:16]` independently, with only this sentence
    holding them together: two hashes of the same string that disagree because
    one was cut at 16 and the other at 12 is the shape of bug this whole
    subsystem keeps paying for, and prose does not stop it. One expression does.
    Pinned by `test_dedupe`.
    """
    return hashlib.sha256(subject.encode("utf-8")).hexdigest()[:16]


def dedup_key(module: str, subject: str) -> str:
    """A key that is stable for the same condition and carries no identifier.

    ⚠️ THE SUBJECT IS HASHED, and that is not decoration. A dedup key exists to
    tell a NEW problem from one the owner has already been told about three
    weeks running — it only ever needs to be STABLE and UNIQUE, never readable.
    Building it as `module:entity_id` made every Finding carry an entity id in
    plain text, and entity ids routinely name rooms and people
    (`sensor.<firstname>_bedroom_window`).

    `PAYLOAD_ALLOWED_FIELDS` would have filtered it at the Phase 6 boundary, so
    nothing would have leaked — but this subsystem's rule is that a guarantee
    is worth more as "the data is not there" than as "the filter is careful",
    and the cost of being sure is one hash. Caught by a test asserting no
    Finding contains an entity id anywhere.

    The module name stays readable so a stored history is still diagnosable at
    a glance; only the subject is opaque.
    """
    # ⚠️ THROUGH `subject_key`, not a second copy of the same expression — see
    # its docstring for why the two must agree bit for bit.
    return f"{module}:{subject_key(subject)}"


def label_for(statistic_id: str, labels: Dict[str, str]) -> str:
    """What to call this device in the report.

    Falls back to a humanised form of the id rather than printing the id
    itself — `sensor.pool_pump_energy` in prose reads as a database row, and
    the entity id is exactly what must not travel in Phase 6.

    ⚠️ ONE DEFINITION. This lived in `standby_creep` AND in `level_anomaly` as
    byte-identical copies, while `sensor_health` reached across and imported
    the underscore-prefixed one out of `level_anomaly` — a private name
    crossing a module boundary, which is the tell that a helper has no home.
    Three readers, two definitions, no owner. Found by /dry-audit.
    """
    known = labels.get(statistic_id)
    if known:
        return known
    tail = statistic_id.split(".", 1)[-1]
    for suffix in ("_energy", "_power", "_consumption"):
        if tail.endswith(suffix):
            tail = tail[: -len(suffix)]
            break
    return tail.replace("_", " ").strip().title() or statistic_id


def skip(module: str, reason: str, detail: str = "") -> Dict[str, str]:
    """A module that did not run, in the form the report renders."""
    return {"module": module, "reason": reason, "detail": detail}
