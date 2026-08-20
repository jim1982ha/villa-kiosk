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
