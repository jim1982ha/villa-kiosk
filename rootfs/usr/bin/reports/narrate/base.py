"""What a narrator is, and what it is given.

⚠️ THE DETERMINISTIC RENDERER IS THE PRODUCT. An LLM narrator (Phase 6) is an
optional enhancement that must degrade silently to this one on any failure,
must never be required for a report to be delivered, and must leave a villa
with no internet fully functional. That is not a nicety — the target is an iPad
in a villa that may have no WAN at all, and a report subsystem that only
produces prose when a third party answers is a feature that works on a
developer's desk and is missing on the wall.

Which is why the fallback is named `deterministic.py` rather than the plan's
`null.py`. A file called "null" reads as a placeholder, and placeholders rot;
this one is what the owner actually reads every week.

`ReportContext` is deliberately a plain dict-carrying dataclass rather than the
narration PAYLOAD. The payload — the privacy-filtered, allow-listed subset that
may leave the villa — is built in Phase 6 from this, by `payload.py`, and the
two must never be the same object: a narrator that can see the whole context is
one edit away from transmitting it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Protocol, Tuple


@dataclass
class ReportContext:
    """Everything known about one report, before any prose exists."""

    audience: str
    cadence: str
    period: str
    generated_at: str
    #: Whole `discover()` result — capabilities, inventory, preflight.
    #: Rules that fire and are never acknowledged — see `reports.noise`. Empty
    #: `rules` with `known: True` means "asked and found none", which is a
    #: different claim from `known: False` ("the buffer does not reach back far
    #: enough to ask"), and the brief must not collapse them.
    noise: Dict[str, Any] = field(default_factory=dict)
    discovery: Dict[str, Any] = field(default_factory=dict)
    #: Analysis output. Empty until Phase 3 introduces modules.
    findings: List[Dict[str, Any]] = field(default_factory=list)
    #: Modules that did not run, and why. Never silently absent.
    skipped: List[Dict[str, str]] = field(default_factory=list)
    #: Modules that DID run. ⚠️ Without this, "no checks are configured" and
    #: "every check ran and found nothing" are the same empty result — and they
    #: mean opposite things to the person reading the report.
    ran: List[str] = field(default_factory=list)
    #: `aggregate.aggregate()` over the period's collected blueprint events —
    #: `groups`, `savings`, `tasks`, `open_incidents`, `schema_drift`, counts.
    #:
    #: ⚠️ EMPTY IS A REAL STATE AND NOT THE SAME AS ABSENT. A property with no
    #: blueprint layer has no aggregation to do, and one whose collector was
    #: offline has aggregation it could not do. `collector` below is what
    #: separates them, and section 8 must not report the second as the first.
    aggregated: Dict[str, Any] = field(default_factory=dict)
    #: `collect.state()` — whether anything was listening, and for how long.
    collector: Dict[str, Any] = field(default_factory=dict)
    #: Open caretaker tasks from the HA `todo` list that this period's own
    #: events did NOT already state — `ledger.reconcile`. Entity ids stripped.
    #:
    #: ⚠️ STANDING STATE, NOT EVENTS. The collector only knows what fired while
    #: it was listening; the todo list holds jobs that are still open however
    #: long ago they were raised.
    carried_tasks: List[Dict[str, str]] = field(default_factory=list)
    #: What is wrong at the MOMENT OF COMPOSING — `standing.build()`, rendered
    #: as dicts so a stored history entry and a live pass have the same shape.
    #:
    #: ⚠️ THE PRESENT TENSE, AND THE ONLY THING HERE THAT IS. Everything above
    #: describes the PERIOD; this is live state, and it is the same list the
    #: kiosk's Cockpit is showing at the same instant. Collapsing the two would
    #: reintroduce the contradiction the whole section exists to remove — a
    #: device that recovered inside the window belongs to the events, one that
    #: broke before it and is still down belongs here.
    #:
    #: ⚠️ NO `subject` FIELD SURVIVES THE CROSSING. `standing.Item.subject`
    #: carries an entity id and is what P3 will deduplicate against the
    #: blueprint layer on; the renderer never needs it, and a field that reaches
    #: a narration payload is a field `PAYLOAD_ALLOWED_FIELDS` has to defend
    #: against. It is dropped where the dicts are built, not filtered later.
    standing: List[Dict[str, Any]] = field(default_factory=list)
    #: entity_id -> what a person calls it, for the ids blueprint events carry.
    #:
    #: ⚠️ RESOLVED, NOT PRINTED RAW. A finding that names a rule family instead
    #: of the thing that is wrong is unactionable even when every word is true —
    #: and an entity_id is often the one name in which the point is invisible.
    #: The automation this was built for reads `critical_doorbell---parking_gate`
    #: to a person and `automation.outdoor_unified_doorbell_call_and_unlock` in
    #: the payload; only the first says "critical".
    labels: Dict[str, str] = field(default_factory=dict)
    #: entity_id -> `unit_of_measurement`, for the numbers a blueprint measured.
    #:
    #: ⚠️ THE UNIT BELONGS TO THE SENSOR, NOT TO THE FIELD NAME. A blueprint
    #: sends `current_value: 1694.7` and only Home Assistant knows that is watts
    #: on a pump and degrees on the meter cabinet. Without this the brief
    #: printed "current value 1694.7" and was asked what it meant.
    units: Dict[str, str] = field(default_factory=dict)
    #: The operator's own currency, from Home Assistant's `get_config`.
    #: Empty prints amounts bare — see `_amount`.
    currency: str = ""


class Narrator(Protocol):
    """Turns a context into (title, body).

    Both plain text. See `deliver.py` on why: the payload sent to a notify
    service is the intersection of what every platform accepts, and a renderer
    that emits markdown produces literal asterisks on the platforms that do not
    parse it.

    A narrator MUST NOT raise. Phase 6's providers wrap network calls and a
    monthly token ceiling; every one of those failure modes has to end in a
    report that still goes out.
    """

    name: str

    def render(self, context: ReportContext) -> Tuple[str, str]:
        ...
