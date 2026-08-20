"""Turn a period's collected blueprint events into the report's sections.

This is the SYNTHESISE layer: blueprints detect, the collector remembers, and
this decides what is worth saying once. It never re-derives a measurement — the
blueprint that fired the event had occupancy, schedules and a tariff in hand,
and this module has a JSON payload. Where the two could disagree, the blueprint
wins by construction because its number is the only one here.

⚠️ THE SCHEMA WAS READ FROM THE BLUEPRINT SOURCES, NOT FROM THEIR PROSE. All 30
blueprint files were parsed for their emit sites: 28 of them across four
categories. Building this against the descriptions would have repeated 2.511.0,
where the fixtures and the code agreed with each other and both disagreed with
Home Assistant, and 11,859 rows produced nothing.

⚠️ THE UNIVERSAL CORE IS TWO FIELDS: `rule_id` and `report_bucket`. Everything
else is per-category, and `normalise` is the ONE place that difference is
resolved. A consumer that reaches into `data` for a category-specific key is
a consumer that breaks on the next property.

  roi          blueprint entities basis timestamp  + kwh cost_local watts
                                                     wasted_minutes runtime_hours
  maintenance  blueprint entities task_text timestamp  + per-mode measurements
  audit        blueprint finding timestamp           + entities task_text
  critical     blueprint entities label severity phase timestamp  + detail reason

⚠️ `report_bucket` IS NOT A ROOM. It is a free-text reporting-group label, and
the blueprints' own examples are "Living room AC", "Lights - monitored rooms"
and "Gym lights" — a room, a category and a device. Rolling up "by room" is not
expressible from the payload; this rolls up by BUCKET, and attaches an area only
where an entity resolves to one.
"""

from __future__ import annotations

import collections
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .analysis.base import Finding, dedup_key

#: The event name a category is carried on. `vesta_<category>_event`.
CATEGORY_OF_EVENT = {
    "vesta_roi_event": "roi",
    "vesta_maintenance_event": "maintenance",
    "vesta_audit_event": "audit",
    "vesta_critical_event": "critical",
}

#: ⚠️ THREE VALUES, NOT TWO. The plan said "measured vs assumed"; the blueprints
#: emit `measured`, `estimated` and `trend`. A figure whose basis is `trend` is
#: a drift flag with no money attached at all, and calling it "assumed" would
#: put it in the savings total.
BASIS_MEASURED = "measured"
BASIS_ESTIMATED = "estimated"
BASIS_TREND = "trend"

#: Severity when the payload does not carry one. ⚠️ ONLY `critical` EMITS
#: `severity`; the other three categories have no such field, so it is a
#: property of the CATEGORY there rather than of the event.
DEFAULT_SEVERITY = {
    "roi": "info",
    "maintenance": "notice",
    "audit": "info",
    "critical": "critical",
}

#: What kind of claim each category makes, in the report's own vocabulary.
KIND_OF_CATEGORY = {
    "roi": "OBSERVATION",
    "maintenance": "ANOMALY",
    "audit": "DATA_QUALITY",
    "critical": "ANOMALY",
}

#: ⚠️ THE HOUSE SCHEMA, WRITTEN DOWN. Until 2026-08-21 this convention existed
#: only as 24 blueprint files that happened to agree, which is how the six
#: `critical_*` files drifted out of it without anyone noticing: they were
#: internally consistent and nothing compared them to anything.
#:
#: Every VESTA blueprint SHOULD emit these. `rule_id` is excluded deliberately —
#: it is optional traceability with a documented `""` default, so its absence is
#: an operator's choice rather than a defect.
HOUSE_SCHEMA_FIELDS = ("blueprint", "report_bucket", "entities", "timestamp")

#: Fields whose presence means a blueprint predates the convention. Kept
#: separate from "missing" because a legacy SPELLING is a stronger signal than
#: an absence — `entity_id` says "this file was written to the old rule",
#: whereas a missing `timestamp` might just be an author's omission.
LEGACY_SPELLINGS = {"entity_id": "entities"}


@dataclass
class Item:
    """One normalised event. The ONLY shape the rest of this module sees.

    ⚠️ EXPLICIT FIELDS, NOT `__slots__` + `setattr`. The first cut built this
    dynamically from a name tuple, which type-checks as `Any` everywhere and
    hid seven real attribute errors from `mypy --strict` — in the module whose
    entire job is to reconcile four payloads that do not agree.
    """

    category: str
    blueprint: str
    rule_id: str
    bucket: str
    label: str
    severity: str
    entities: List[str]
    detail: str
    when: str
    basis: str
    task_text: str
    data: Dict[str, Any]
    #: raised/cleared, critical only. ⚠️ None is NOT "cleared".
    phase: Optional[str] = None
    kwh: Optional[float] = None
    cost: Optional[float] = None
    minutes: Optional[float] = None

    def key(self) -> Tuple[str, str]:
        """What makes two events "the same finding" for deduplication.

        ⚠️ `rule_id` DEFAULTS TO `""` IN THE BLUEPRINTS — it is an optional
        traceability field an operator may never fill in, so it cannot be the
        whole key. Falling back to the blueprint name keeps two different rules
        on one bucket apart in the common case, and collapses them only where
        the operator declined to distinguish them.
        """
        return (self.rule_id or self.blueprint or self.category,
                self.bucket or "")


def _as_list(value: Any) -> List[str]:
    """Entity references, however this blueprint spelled them.

    ⚠️ A TEMPLATE THAT RENDERED TO A STRING IS NOT A LIST. Home Assistant
    native-types a whole-value template, so `"{{ ents }}"` usually arrives as a
    real list — but a single-entity input arrives as a bare string, and
    iterating that yields one character per call.
    """
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value if v]
    return []


def _as_float(value: Any) -> Optional[float]:
    """A number the blueprint computed, or None. Never a guess."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def normalise(event: Dict[str, Any]) -> Optional[Item]:
    """One buffered event -> one `Item`, or None if it is not ours.

    ⚠️ THE CATEGORY COMES FROM THE EVENT TYPE, NEVER FROM `data["blueprint"]`.
    The type is what the collector subscribed to and is therefore always
    present and always trustworthy; `blueprint` is a field a blueprint author
    fills in, and the six `critical_*` files did not carry it at all until
    2026-08-21.

    ⚠️ THE `entity_id`/`entities` FALLBACK IS PERMANENT, not a migration step.
    The ring buffer holds up to `MAX_EVENTS` historical events in whatever shape
    they were fired, so correcting the blueprints only cleans data from that
    point forward. Reading a months-old event must keep working.
    """
    etype = str(event.get("type") or "")
    category = CATEGORY_OF_EVENT.get(etype)
    if category is None:
        return None
    data = event.get("data")
    if not isinstance(data, dict):
        data = {}

    bucket = str(data.get("report_bucket") or "").strip()
    entities = _as_list(data.get("entities"))
    if not entities:
        entities = _as_list(data.get("entity_id"))

    return Item(
        category=category,
        blueprint=str(data.get("blueprint") or "").strip(),
        rule_id=str(data.get("rule_id") or "").strip(),
        bucket=bucket,
        # `label` exists only on critical; elsewhere the bucket IS the label.
        label=str(data.get("label") or bucket or "").strip(),
        severity=str(data.get("severity") or DEFAULT_SEVERITY[category]),
        # raised/cleared, critical only. None everywhere else — and that is not
        # the same as "cleared", so it must stay None rather than defaulting.
        phase=(str(data["phase"]) if data.get("phase") else None),
        entities=entities,
        detail=str(data.get("detail") or data.get("finding") or "").strip(),
        # ⚠️ THE BLUEPRINT'S OWN TIME FIRST. `fired` is Home Assistant's stamp
        # and `at` is when the collector wrote it; both are later than the
        # condition they describe, and `at` can be much later after an outage.
        when=str(data.get("timestamp") or event.get("fired")
                 or event.get("at") or ""),
        kwh=_as_float(data.get("kwh")),
        cost=_as_float(data.get("cost_local")),
        minutes=_as_float(data.get("wasted_minutes")),
        basis=str(data.get("basis") or ""),
        task_text=str(data.get("task_text") or "").strip(),
        data=data,
    )


def normalise_all(events: Sequence[Dict[str, Any]]) -> List[Item]:
    out: List[Item] = []
    for event in events:
        if isinstance(event, dict):
            item = normalise(event)
            if item is not None:
                out.append(item)
    return out


def schema_drift(events: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Which blueprints are emitting a payload that predates the convention.

    ⚠️ NORMALISING QUIETLY IS THE BUG THIS PREVENTS. `normalise` tolerates the
    old shape on purpose — the add-on updates through Home Assistant while
    blueprints are updated by hand, so a property running last month's
    blueprints against this month's add-on is permanent and universal, not a
    fault. But tolerating it SILENTLY means a blueprint can drift out of the
    convention and never be mentioned again, which is how the six `critical_*`
    files diverged in the first place: internally consistent, compared to
    nothing.

    So the tolerance stays and the drift is REPORTED, into the monitoring-health
    section. The report names the blueprint and the field; a human decides
    whether to update it.

    Keyed by blueprint where one is named. ⚠️ A payload with no `blueprint`
    field cannot name itself — that is the drift — so it is keyed by its
    CATEGORY, which is always knowable from the event type.
    """
    # Parallel maps rather than one dict of mixed value types: the mixed form
    # needed four `type: ignore` comments to satisfy --strict, and a silenced
    # type error in the module that reconciles four disagreeing payloads is the
    # last place to start trusting annotations less.
    categories: Dict[str, str] = {}
    missing_by: Dict[str, set[str]] = {}
    legacy_by: Dict[str, set[str]] = {}
    counts: Dict[str, int] = {}

    for event in events:
        if not isinstance(event, dict):
            continue
        category = CATEGORY_OF_EVENT.get(str(event.get("type") or ""))
        if category is None:
            continue
        data = event.get("data")
        if not isinstance(data, dict):
            continue

        missing = [f for f in HOUSE_SCHEMA_FIELDS if not data.get(f)]
        legacy = [old for old in LEGACY_SPELLINGS if data.get(old)]
        # `audit` carries `finding` rather than `entities`, by design rather
        # than by drift — 3 of its 5 emit sites name no entity at all, because
        # a structural coverage gap is the absence of hardware.
        if category == "audit" and "entities" in missing:
            missing.remove("entities")
        if not missing and not legacy:
            continue

        key = str(data.get("blueprint") or "").strip() or f"({category})"
        categories.setdefault(key, category)
        counts[key] = counts.get(key, 0) + 1
        missing_by.setdefault(key, set()).update(missing)
        legacy_by.setdefault(key, set()).update(
            f"{old} (use {LEGACY_SPELLINGS[old]})" for old in legacy)

    return {
        "blueprints": [
            {"blueprint": key,
             "category": categories[key],
             "events": counts[key],
             "missing": sorted(missing_by.get(key, set())),
             "legacy": sorted(legacy_by.get(key, set()))}
            for key in sorted(counts)
        ],
        "count": len(counts),
    }


class Group:
    """Every occurrence of one rule on one bucket, in one period."""

    items: List[Item]
    category: str
    rule_id: str
    blueprint: str
    bucket: str
    label: str
    severity: str

    def __init__(self, first: Item) -> None:
        self.items = []
        self.category = first.category
        self.rule_id = first.rule_id
        self.blueprint = first.blueprint
        self.bucket = first.bucket
        self.label = first.label
        self.severity = first.severity

    def add(self, item: Item) -> None:
        self.items.append(item)
        if _severity_rank(item.severity) > _severity_rank(self.severity):
            self.severity = item.severity
        if not self.label:
            self.label = item.label

    # ── what the group is worth ──────────────────────────────────────────────

    @property
    def occurrences(self) -> int:
        """⚠️ RAISED EVENTS ONLY. A critical incident emits on both the trip and
        the all-clear, so counting every event would report every incident
        twice — and would report a RESOLVED one as two problems."""
        return sum(1 for i in self.items if i.phase != "cleared")

    @property
    def total_cost(self) -> Optional[float]:
        """Summed `cost_local`, or None if no member carried one.

        ⚠️ None IS NOT ZERO. `roi_baseline_deviation` is a trend flag with no
        money at all, and a missing cost ranked as 0.0 would sort it below a
        genuinely free finding and read as "this cost nothing".
        """
        costs = [i.cost for i in self.items if i.cost is not None]
        return sum(costs) if costs else None

    @property
    def total_kwh(self) -> Optional[float]:
        values = [i.kwh for i in self.items if i.kwh is not None]
        return sum(values) if values else None

    @property
    def total_minutes(self) -> Optional[float]:
        values = [i.minutes for i in self.items if i.minutes is not None]
        return sum(values) if values else None

    @property
    def basis(self) -> str:
        """The WEAKEST basis among the members, because a total is only as
        well-founded as its shakiest term. Reporting a sum as `measured`
        because most of it was measured is the kind of quiet over-claim this
        subsystem exists to avoid."""
        seen = {i.basis for i in self.items if i.basis}
        for weakest in (BASIS_TREND, BASIS_ESTIMATED, BASIS_MEASURED):
            if weakest in seen:
                return weakest
        return ""

    @property
    def entities(self) -> List[str]:
        out: List[str] = []
        for item in self.items:
            for ent in item.entities:
                if ent not in out:
                    out.append(ent)
        return out

    @property
    def open_incident(self) -> bool:
        """A critical incident that was raised and never cleared.

        ⚠️ COUNTED, NOT PAIRED BY TIME. The blueprints emit `raised` and
        `cleared` with no incident id, so the only honest join is "did as many
        clears arrive as raises". An unpaired raise is still open.
        """
        raised = sum(1 for i in self.items if i.phase == "raised")
        cleared = sum(1 for i in self.items if i.phase == "cleared")
        return raised > cleared

    @property
    def duration_minutes(self) -> Optional[float]:
        """How long the incidents in this group lasted, where both ends exist."""
        raises = sorted(i.when for i in self.items if i.phase == "raised" and i.when)
        clears = sorted(i.when for i in self.items if i.phase == "cleared" and i.when)
        total = 0.0
        paired = 0
        for start, end in zip(raises, clears):
            span = _minutes_between(start, end)
            if span is not None and span >= 0:
                total += span
                paired += 1
        return total if paired else None


_SEVERITY_ORDER = ("info", "notice", "warning", "critical")


def _severity_rank(severity: str) -> int:
    try:
        return _SEVERITY_ORDER.index(severity)
    except ValueError:
        return 0


def _minutes_between(start_iso: str, end_iso: str) -> Optional[float]:
    from datetime import datetime
    try:
        a = datetime.fromisoformat(start_iso)
        b = datetime.fromisoformat(end_iso)
    except ValueError:
        return None
    if (a.tzinfo is None) != (b.tzinfo is None):
        return None
    return (b - a).total_seconds() / 60.0


def group(items: Sequence[Item]) -> List[Group]:
    """Dedup: one line per rule per bucket, ordered by first appearance."""
    groups: "collections.OrderedDict[Tuple[str, str], Group]" = collections.OrderedDict()
    for item in items:
        key = item.key()
        if key not in groups:
            groups[key] = Group(item)
        groups[key].add(item)
    return list(groups.values())


def rank(groups: Sequence[Group]) -> List[Group]:
    """Most expensive first; costless findings keep their order, at the end.

    ⚠️ A GROUP WITH NO COST IS NOT CHEAP, IT IS UNPRICED. Sorting it as 0.0
    would interleave trend flags among genuinely small savings and imply the
    report had priced them.
    """
    priced = [g for g in groups if g.total_cost is not None]
    unpriced = [g for g in groups if g.total_cost is None]
    priced.sort(key=lambda g: g.total_cost or 0.0, reverse=True)
    return priced + unpriced


def by_bucket(groups: Sequence[Group]) -> "collections.OrderedDict[str, List[Group]]":
    """Roll up by `report_bucket` — see the module docstring on why not by room."""
    out: "collections.OrderedDict[str, List[Group]]" = collections.OrderedDict()
    for g in groups:
        out.setdefault(g.bucket or "", []).append(g)
    return out


def by_category(groups: Sequence[Group]) -> Dict[str, List[Group]]:
    out: Dict[str, List[Group]] = {}
    for g in groups:
        out.setdefault(g.category, []).append(g)
    return out


def savings_total(groups: Sequence[Group]) -> Dict[str, Any]:
    """The one number the headline states, and what it is made of.

    ⚠️ EVERY TERM CARRIES ITS BASIS, AND THE MIX IS REPORTED. The tariff is a
    PER-INSTANCE blueprint input defaulting to a workbook assumption, so this
    total sums figures computed under assumptions that may differ between
    rules. Stating `measured`/`estimated` counts is what keeps the number
    honest; presenting it bare would imply a precision nothing here has.

    ⚠️ `trend` IS EXCLUDED FROM THE TOTAL. A drift flag has no money attached
    and a percentage is not currency.
    """
    total = 0.0
    counted = 0
    mix: Dict[str, int] = {}
    for g in groups:
        cost = g.total_cost
        basis = g.basis
        if cost is None or basis == BASIS_TREND:
            continue
        total += cost
        counted += 1
        mix[basis or "unknown"] = mix.get(basis or "unknown", 0) + 1
    return {"total": round(total, 2), "groups": counted, "basis_mix": mix}


def open_tasks(groups: Sequence[Group]) -> List[Dict[str, str]]:
    """Caretaker task text the blueprints raised, deduplicated.

    ⚠️ READ-ONLY, AND NOT THE `todo` LIST. Nine blueprints call `todo.add_item`
    alongside their event; this reports what they SAID, and never writes to
    either store. Reconciling against the live `todo` entity is Phase B, and a
    report generator that mutates the record it reports on is one nobody can
    trust.
    """
    seen: List[Dict[str, str]] = []
    texts = set()
    for g in groups:
        for item in g.items:
            if item.task_text and item.task_text not in texts:
                texts.add(item.task_text)
                seen.append({"bucket": g.bucket, "text": item.task_text,
                             "rule_id": g.rule_id})
    return seen


def to_findings(groups: Sequence[Group]) -> List[Finding]:
    """Groups -> the `Finding` shape the renderer and Phase 6 already speak.

    ⚠️ NO ENTITY ID CROSSES THIS BOUNDARY. `ref` is an opaque handle and
    `dedup_key` hashes its subject; the entities stay in the villa. That is
    what makes these safe to hand to `PAYLOAD_ALLOWED_FIELDS` unchanged.
    """
    out: List[Finding] = []
    for index, g in enumerate(groups):
        detail = _detail_for(g)
        out.append(Finding(
            ref=f"g{index}",
            kind=KIND_OF_CATEGORY.get(g.category, "OBSERVATION"),
            severity=g.severity,
            label=g.label or g.bucket or g.blueprint or g.category,
            detail=detail,
            metric="energy" if g.total_kwh is not None else "",
            unit="kWh" if g.total_kwh is not None else "",
            observed=g.total_kwh,
            dedup_key=dedup_key(g.blueprint or g.category,
                                f"{g.rule_id}|{g.bucket}"),
        ))
    return out


def _detail_for(g: Group) -> str:
    """One sentence, built only from what the blueprint actually supplied."""
    parts: List[str] = []
    n = g.occurrences
    if n > 1:
        parts.append(f"{n} times")
    if g.total_minutes:
        parts.append(f"{round(g.total_minutes)} minutes in total")
    if g.total_kwh is not None:
        parts.append(f"{round(g.total_kwh, 2)} kWh")
    if g.basis:
        parts.append(f"{g.basis}")
    if g.open_incident:
        parts.append("still open")
    elif g.duration_minutes:
        parts.append(f"lasted {round(g.duration_minutes)} minutes")
    if not parts:
        return g.items[0].detail if g.items else ""
    detail = ", ".join(parts)
    first = g.items[0].detail if g.items else ""
    return f"{detail} — {first}" if first else detail


def aggregate(events: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """The whole synthesis, in the order the report needs it."""
    items = normalise_all(events)
    groups = rank(group(items))
    return {
        "groups": groups,
        "findings": to_findings(groups),
        "savings": savings_total(groups),
        "by_bucket": by_bucket(groups),
        "by_category": by_category(groups),
        "tasks": open_tasks(groups),
        "open_incidents": [g for g in groups if g.open_incident],
        "events_seen": len(items),
        "events_dropped": len(events) - len(items),
        # ⚠️ FOR THE MONITORING-HEALTH SECTION, NOT FOR THE READER'S SAVINGS.
        # A blueprint that has drifted out of the convention still produces
        # usable findings; this says which one to update, and never suppresses
        # its events.
        "schema_drift": schema_drift(events),
    }
