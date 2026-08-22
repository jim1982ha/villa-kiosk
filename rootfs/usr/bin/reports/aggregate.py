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
and "Gym lights" — a room, a category and a device. So a bucket cannot be read
as a room, and `by_bucket` does not try to.

⚠️ BUT THE ROOM IS NOT THE BUCKET'S TO GIVE, AND THIS PARAGRAPH CONFLATED THE
TWO UNTIL 2026-08-22. It said rolling up "by room" was "not expressible from the
payload", and that an area was attached "only where an entity resolves to one".
The second half was FALSE — no area was attached anywhere, and neither `Item`
nor `Group` had the field — and the workbook's "roll up by room then category"
sat open as a spec-versus-code disagreement on the strength of it.

A room comes from the ENTITIES, not from the bucket, exactly as `standing.build`
already resolves one: via `resolvedRooms` in the shared device-config store,
which is the map the kiosk itself renders from, so the brief and the tablet
cannot disagree about which room a device is in. `Item.room` is that lookup,
`Group.room` is the first of its items that resolved, and both are "" when the
map is absent — the honest answer on an unconfigured install, and why `by_room`
buckets those under "" rather than inventing a name.
"""

from __future__ import annotations

import collections
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple

from .analysis.base import Finding, dedup_key, subject_key
from .contracts import SEVERITY, severity_rank
# ⚠️ THIS RULE LIVES IN `text` NOW, not here — `analysis.registry` needs it too
# and importing `aggregate` from there would reverse an arrow the analysis
# package's docstring promises points downward. Imported, not re-exported: a
# module that silently forwards someone else's symbol is a second name for one
# thing, which is what the move was avoiding.
from .text import readable_label

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

#: ⚠️ THE BLUEPRINTS' SEVERITY VOCABULARY IS NOT THE REPORT'S, AND ASSUMING IT
#: WAS WOULD HAVE BLANKED EVERY REPORT THE FIRST TIME A P1 FIRED.
#:
#: `critical_*` declares `severity` as a select with options ["P1", "P2"] — an
#: escalation tier, not a loudness. `Finding.__post_init__` RAISES on a severity
#: outside `contracts.SEVERITY`, `to_findings` propagates it, and `pipeline`
#: catches aggregation failures and continues with `aggregated = {}`. So one
#: genuine P1 water leak would have silently emptied every section built from
#: blueprint events and produced a report reading "nothing worth reporting".
#: Failing in the direction of silence, on the single most important event the
#: villa can produce.
#:
#: Found by reading the deployed blueprint's INPUTS over MCP. The schema audit
#: that preceded this module read the payload's KEYS and never its VALUES —
#: which is the same assumption 2.511.0 was made of, one field along.
SEVERITY_ALIASES = {
    "p1": "critical",   # pages immediately
    "p2": "warning",    # reported, not escalated
    "p3": "notice",
    # ⚠️ P4 WAS MISSING AND THE CATALOG DEFINES P1..P4. Its Severity & Routing
    # sheet: "P4 — informational or a trend. No action expected on its own.
    # Report appendix." Two rules already carry it (PM-08, PM-16), so the moment
    # somebody adds the `severity` input those blueprints are specified to have,
    # this report would have accused them of sending an "older alert format" —
    # a false accusation against a rule doing exactly what the spec says, in the
    # section an operator reads to find out what is wrong with their rules.
    # Found by asking what would happen IF the catalog's advice were followed.
    "p4": "info",
    "warn": "warning",
    "error": "critical",
    "err": "critical",
}


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
    #: Resolved from `entities` via `resolvedRooms`; "" when unknown. See the
    #: module docstring — this is NOT derived from `bucket`.
    room: str = ""

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


def _readable(detail: Any, finding: Any) -> str:
    """The sentence a blueprint supplied, or its code made readable.

    ⚠️ `finding` IS A MACHINE TOKEN AND IT REACHED THE PAGE. The `audit_*`
    blueprints emit `finding: "critical_automation_off"` and
    `finding: "entity_unavailable"` — identifiers, not prose — and a real report
    printed "Critical automation health: critical_automation_off" to the owner.
    `detail`, where a category supplies one, is a real sentence and is used
    untouched.

    Underscores to spaces is the whole transformation: a lookup table of every
    code every blueprint might emit goes stale the day someone adds a mode,
    which is the same reason `_phrase` works on suffixes rather than names.
    """
    text = str(detail or "").strip()
    if text:
        return text
    code = str(finding or "").strip()
    return code.replace("_", " ") if code else ""


def _severity_of(raw: Any, category: str) -> str:
    """A blueprint's severity, in the report's vocabulary. NEVER raw.

    ⚠️ THREE OUTCOMES, AND THE THIRD IS THE ONE THAT MATTERS. A value already in
    `contracts.SEVERITY` passes through; a known alias is translated (see
    `SEVERITY_ALIASES` for why P1/P2 exist); anything else falls back to the
    category default rather than reaching `Finding`, which RAISES on an unknown
    severity and would take the whole aggregation down with it.

    The fallback is deliberately silent HERE and loud in `schema_drift` — a
    report must still be delivered, and the operator must still be told their
    blueprint is using a vocabulary this add-on does not recognise.
    """
    text = str(raw or "").strip()
    if not text:
        return DEFAULT_SEVERITY[category]
    if text in SEVERITY:
        return text
    return SEVERITY_ALIASES.get(text.lower(), DEFAULT_SEVERITY[category])


def unrecognised_severity(raw: Any) -> bool:
    """Is this a severity no rule here understands? For `schema_drift`."""
    text = str(raw or "").strip()
    if not text:
        return False
    return text not in SEVERITY and text.lower() not in SEVERITY_ALIASES


def _room_of(entities: Sequence[str],
             rooms: Optional[Mapping[str, str]]) -> str:
    """The room of the first entity that has one, or "".

    ⚠️ CASE AND WHITESPACE ARE THE STORE'S, NOT NORMALISED HERE. `roomKey`
    is the kiosk's comparison rule and lives in TypeScript; this is a plain
    lookup on the map the kiosk itself wrote, so the two agree by using the
    same keys rather than by reimplementing the same normalisation twice.
    """
    if not rooms:
        return ""
    for entity_id in entities:
        name = rooms.get(entity_id)
        if isinstance(name, str) and name.strip():
            return name.strip()
    return ""


def normalise(event: Dict[str, Any],
              rooms: Optional[Mapping[str, str]] = None) -> Optional[Item]:
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
        severity=_severity_of(data.get("severity"), category),
        # raised/cleared, critical only. None everywhere else — and that is not
        # the same as "cleared", so it must stay None rather than defaulting.
        phase=(str(data["phase"]) if data.get("phase") else None),
        entities=entities,
        detail=_readable(data.get("detail"), data.get("finding")),
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
        # ⚠️ THE FIRST ENTITY THAT RESOLVES, not a joined list. A group is one
        # rule on one bucket; where its members span rooms the bucket is the
        # thing that names them, and inventing "Kitchen / Hall" would be a
        # room that does not exist. "" means unknown and is not a room either.
        room=_room_of(entities, rooms),
    )


def normalise_all(events: Sequence[Dict[str, Any]],
                  rooms: Optional[Mapping[str, str]] = None) -> List[Item]:
    out: List[Item] = []
    for event in events:
        if isinstance(event, dict):
            item = normalise(event, rooms)
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
    named_by: Dict[str, bool] = {}
    buckets_by: Dict[str, set[str]] = {}

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
        if unrecognised_severity(data.get("severity")):
            legacy.append("severity")
        # `audit` carries `finding` rather than `entities`, by design rather
        # than by drift — 3 of its 5 emit sites name no entity at all, because
        # a structural coverage gap is the absence of hardware.
        if category == "audit" and "entities" in missing:
            missing.remove("entities")
        if not missing and not legacy:
            continue

        named = bool(str(data.get("blueprint") or "").strip())
        key = str(data.get("blueprint") or "").strip() or f"({category})"
        categories.setdefault(key, category)
        named_by[key] = named
        # ⚠️ THE BUCKET IS WHAT IS LEFT TO IDENTIFY IT BY. A payload with no
        # `blueprint` field cannot name itself — that IS the drift — and the
        # report said so as "(critical)", one of thirteen rules and none of
        # them. `report_bucket` is the operator's own words for what the rule
        # is and these events still carry it, so it is the difference between
        # "something in the critical family" and "go and look at this".
        bucket = str(data.get("report_bucket") or "").strip()
        if bucket:
            buckets_by.setdefault(key, set()).add(bucket)
        counts[key] = counts.get(key, 0) + 1
        missing_by.setdefault(key, set()).update(
            readable_label(field) for field in missing)
        # ⚠️ HUMANISED HERE, WHERE THE PHRASE IS BUILT. `readable_label` leaves
        # anything containing a space alone — deliberately, so a label a person
        # wrote is never rewritten — and this composes an identifier INTO a
        # sentence, so by the time the renderer sees "entity_id (use entities)"
        # the guard correctly declines to touch it. The brief carried that
        # underscore to the owner's phone, where a markup-parsing platform read
        # it as emphasis and italicised the rest of the paragraph.
        legacy_by.setdefault(key, set()).update(
            f"{readable_label(old)} (use {readable_label(LEGACY_SPELLINGS[old])})"
            if old in LEGACY_SPELLINGS
            else f"{readable_label(old)} is not a severity this report knows "
                 f"({data.get(old)!r})"
            for old in legacy)

    return {
        "blueprints": [
            {"blueprint": key,
             "category": categories[key],
             "events": counts[key],
             "missing": sorted(missing_by.get(key, set())),
             "legacy": sorted(legacy_by.get(key, set())),
             #: Whether the payload named its own blueprint. False is itself
             #: part of the finding — see `buckets`.
             "named": named_by.get(key, False),
             "buckets": sorted(buckets_by.get(key, set()))}
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
    room: str

    def __init__(self, first: Item) -> None:
        self.items = []
        self.category = first.category
        self.rule_id = first.rule_id
        self.blueprint = first.blueprint
        self.bucket = first.bucket
        self.label = first.label
        self.severity = first.severity
        self.room = first.room

    def add(self, item: Item) -> None:
        self.items.append(item)
        # ⚠️ FIRST RESOLVED WINS, and a later member never overwrites it — a
        # group whose first item had no room but whose second did should still
        # be placed, and one that already has a room must not be moved by a
        # member that happens to sit elsewhere.
        if not self.room and item.room:
            self.room = item.room
        if severity_rank(item.severity) > severity_rank(self.severity):
            self.severity = item.severity
        if not self.label:
            self.label = item.label

    @property
    def subject_keys(self) -> Set[str]:
        """WHICH EQUIPMENT this group is about, opaquely.

        ⚠️ THE JOIN KEY WITH THE BUILT-IN CHECKS, and it is hashed on both
        sides for the same reason `dedup_key` is: `Item.entities` holds real
        entity ids, which name rooms and people, and a `Finding` may not carry
        one. Hashing lets the two layers recognise the same pump without either
        of them holding an identifier.

        ⚠️ A SET, BECAUSE A BLUEPRINT WATCHES SEVERAL THINGS. `maintenance_silence`
        fires with every silent entity in its payload; a group covering four
        devices must suppress a built-in finding about any of the four, not just
        about whichever one happened to be first.
        """
        return {subject_key(e) for item in self.items for e in item.entities if e}

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
        """The equipment this group's events named, in the order first seen.

        ⚠️ THIS EXISTED ALL ALONG AND THE RENDERER NEVER CALLED IT. A brief read
        "Critical automation health: critical automation off" — true,
        legitimate, and impossible to act on, because the event behind it
        carried `entities: ["automation.outdoor_unified_doorbell_call_and_unlock"]`
        and nothing printed it. The owner asked "which one?" and neither the
        notification nor I could answer. Reported 2026-08-21; the data was two
        lines away the whole time, which is why the fix is a call and not a
        feature.

        ⚠️ IDS, NOT NAMES — the caller resolves them through
        `ReportContext.labels`. That automation's DISPLAY name is
        `critical_doorbell---parking_gate` while its entity_id is a stale slug
        from before it was renamed, so the id is the one form in which the word
        "critical" is invisible. Printing ids would have answered "which one?"
        with the name least likely to be recognised — which is exactly what I
        did when answering by hand.
        """
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
    return _fold_unnamed(groups)


def _fold_unnamed(groups: Dict[Tuple[str, str], "Group"]) -> List["Group"]:
    """Fold a category-keyed group into the blueprint-keyed one for its bucket.

    ⚠️ THE SAME RULE APPEARED TWICE IN ONE BRIEF AND THE READER SAW TWO
    INCIDENTS. `Item.key()` falls back `rule_id or blueprint or category`, so a
    rule whose blueprint was updated MID-PERIOD emits both shapes: the newer
    events key on `("critical_presence_guard", bucket)` and the older ones,
    which carry no `blueprint` field, key on `("critical", bucket)`. Two keys,
    one rule, two lines — reported as "why do I see 2 times the same
    automation?" with "Entrance unlocked while vacant" listed twice, once
    resolved after 10 minutes and once after 1.1 hours.

    ⚠️ THE MERGE IS NARROW ON PURPOSE. It folds ONLY a group keyed on the bare
    category — which is precisely the signature of a payload that could not name
    itself — and only when exactly ONE named group shares its bucket. Two rules
    that both name themselves on one bucket stay apart, which is what the
    fallback chain was written to protect; and an unnamed group with two
    candidates is left alone rather than guessed at.
    """
    named: Dict[str, List[Tuple[str, str]]] = {}
    for (owner, bucket) in groups:
        if owner not in CATEGORY_OF_EVENT.values():
            named.setdefault(bucket, []).append((owner, bucket))

    for key in list(groups):
        owner, bucket = key
        if owner not in CATEGORY_OF_EVENT.values():
            continue
        candidates = named.get(bucket) or []
        if len(candidates) != 1:
            continue
        target = groups[candidates[0]]
        for item in groups[key].items:
            target.add(item)
        del groups[key]
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


def by_room(groups: Sequence[Group],
            ) -> "collections.OrderedDict[str, collections.OrderedDict[str, List[Group]]]":
    """Roll up by ROOM, then by CATEGORY within each — the workbook's order.

    Two levels, not one, because "room then category" is a structure and
    flattening it to a sort would leave the caller to re-derive the grouping.

    ⚠️ ROOMS FIRST, UNKNOWN LAST. A property that has mapped nothing resolves
    every room to "", and sorting that to the top would open the report with a
    heap of unplaced devices under a blank heading. It goes last; the renderer
    decides what to call it, because "Other" is a claim this module must not
    make (`chipRoom` refuses the same one on the kiosk side, for the same
    reason: a name for a place that does not exist).

    ⚠️ CATEGORY ORDER IS BY WORST SEVERITY PRESENT, NOT ALPHABETICAL AND NOT A
    NEW TABLE. `critical` leads wherever it appears, because a reader scanning
    rooms must not have to check whether this one happened to sort its
    emergency under "a". Deriving it from `severity_rank` — the ordering this
    package already has — rather than adding a CATEGORY_ORDER constant keeps
    one answer to "what is more serious than what"; a second table is how the
    three severity scales of P4 came to disagree.
    """
    by_name: Dict[str, Dict[str, List[Group]]] = {}
    for g in groups:
        by_name.setdefault(g.room, {}).setdefault(g.category, []).append(g)

    out: "collections.OrderedDict[str, collections.OrderedDict[str, List[Group]]]"
    out = collections.OrderedDict()
    named = sorted((r for r in by_name if r), key=str.casefold)
    for room in named + ([""] if "" in by_name else []):
        cats = by_name[room]
        inner: "collections.OrderedDict[str, List[Group]]" = collections.OrderedDict()
        for category in sorted(
                cats,
                key=lambda c: (-max(severity_rank(g.severity) for g in cats[c]), c)):
            inner[category] = cats[category]
        out[room] = inner
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


def open_tasks(groups: Sequence[Group]) -> List[Dict[str, Any]]:
    """Caretaker task text the blueprints raised, deduplicated.

    ⚠️ READ-ONLY, AND NOT THE `todo` LIST. Nine blueprints call `todo.add_item`
    alongside their event; this reports what they SAID, and never writes to
    either store. Reconciling against the live `todo` entity is Phase B, and a
    report generator that mutates the record it reports on is one nobody can
    trust.
    """
    seen: List[Dict[str, Any]] = []
    texts = set()
    for g in groups:
        for item in g.items:
            if item.task_text and item.task_text not in texts:
                texts.add(item.task_text)
                # ⚠️ AND WHAT IT IS ABOUT. A delivered brief read "Re-enable, or
                # document as a deliberate, intentional decision. (Critical
                # automation health)" — a blueprint's own task text beside its
                # bucket, correct and impossible to act on without knowing WHAT
                # to re-enable. The event named it in `entities` all along.
                seen.append({"bucket": g.bucket, "text": item.task_text,
                             "rule_id": g.rule_id, "entities": list(item.entities)})
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
            label=readable_label(g.label or g.bucket or g.blueprint or g.category),
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


def summary(result: Dict[str, Any]) -> Dict[str, Any]:
    """A JSON-safe précis of an aggregation, for `_analysis`.

    ⚠️ THE BIGGEST PRODUCER OF REPORT CONTENT HAD NO INSTRUMENT. Every other
    stage of this pipeline can be asked what it did — `ran`, `skipped`, `data`,
    `rejected`, `collector` — and the layer that decides what the report SAYS
    could only be inspected by reading the delivered prose and inferring
    backwards. When a section came out empty there was no way to tell "no events
    in the period" from "events that all deduplicated into one group" from
    "aggregation raised and was swallowed".

    ⚠️ COUNTS AND CATEGORY NAMES, NEVER PAYLOADS OR BUCKETS. A `report_bucket`
    is operator free text ("Emma's bedroom lamp") and the entities are entity
    ids; this is a diagnostics surface, not a data export. Same rule as
    `collect.state()`.

    ⚠️ `Group` IS NOT JSON-SERIALISABLE, which is the other reason this exists:
    putting the raw result on `_analysis` would 500 the endpoint.
    """
    groups = result.get("groups") or []
    per_category: Dict[str, int] = {}
    priced = 0
    for group in groups:
        category = getattr(group, "category", "") or "?"
        per_category[category] = per_category.get(category, 0) + 1
        if getattr(group, "total_cost", None) is not None:
            priced += 1
    drift = result.get("schema_drift") or {}
    return {
        "events_seen": result.get("events_seen", 0),
        "events_dropped": result.get("events_dropped", 0),
        "groups": len(groups),
        "groups_by_category": per_category,
        "groups_priced": priced,
        "savings": result.get("savings") or {},
        "tasks": len(result.get("tasks") or []),
        "open_incidents": len(result.get("open_incidents") or []),
        # Blueprint FILE names only — the whole point is naming which file to
        # update, and a blueprint name is not villa-specific the way a bucket is.
        "schema_drift": [
            {"blueprint": e.get("blueprint"), "events": e.get("events"),
             "missing": e.get("missing"), "legacy": e.get("legacy")}
            for e in (drift.get("blueprints") or [])
        ],
    }


def aggregate(events: Sequence[Dict[str, Any]],
              rooms: Optional[Mapping[str, str]] = None) -> Dict[str, Any]:
    """The whole synthesis, in the order the report needs it.

    ⚠️ `rooms` IS OPTIONAL AND ITS ABSENCE IS NOT AN ERROR. Every caller that
    has the device config should pass it; the ones that do not — diagnostics
    dumps, `normalise_all` over the raw buffer — get groups with `room == ""`,
    which `by_room` buckets last rather than failing over.
    """
    items = normalise_all(events, rooms)
    groups = rank(group(items))
    return {
        "groups": groups,
        "findings": to_findings(groups),
        "savings": savings_total(groups),
        "by_bucket": by_bucket(groups),
        "by_category": by_category(groups),
        "by_room": by_room(groups),
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
