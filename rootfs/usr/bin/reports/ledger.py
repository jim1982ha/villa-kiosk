"""The Facility Manager record, read only.

This is what turns a metric into a story: not "the pool pump drew 18% more
this month" but "the pool pump drew 18% more this month, and the ticket raised
about it on the 3rd was closed on the 9th at a cost of X". Phase 7 builds on
that; Phase 1 only needs to read the file and describe what is in it.

⚠️ THREE RULES, ALL LOAD-BEARING.

1. READ ONLY. Reports never write `fm-data.json`. Writing it would mean writing
   a store from outside its HTTP handler and therefore outside the
   `asyncio.Lock` that `_json_store_handlers` creates for it — the exact defect
   the proxy's own docstring records having shipped once, against the villa's
   maintenance and cost records, with several devices writing concurrently.

2. EVIDENCE BYTES ARE NEVER OPENED. `photoIds` are counted, never resolved.
   A photograph of a villa's interior is the single most sensitive thing this
   add-on stores, and Phase 6 sends narration payloads to a third-party model.
   The guarantee is worth more as "this module cannot read them" than as "this
   module is careful with them" — there is no code path here that touches the
   evidence directory at all.

3. FREE TEXT DOES NOT TRAVEL. Ticket and cost descriptions are written by
   people about people's homes. They are summarised as counts and totals here;
   `PAYLOAD_ALLOWED_FIELDS` has no field they could occupy.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from .log import warn

FM_DATA_FILE = "/data/fm-data.json"

# The collections the SPA maintains. Named explicitly rather than iterating
# whatever keys the file happens to have, so a future collection is invisible
# here until someone decides what a report should say about it.
COLLECTIONS = ("schedules", "completions", "costs", "tickets", "savedDocuments")


def read(path: str = FM_DATA_FILE) -> Dict[str, Any]:
    """Parse the FM store, degrading to empty.

    Mirrors `_read_json_store`'s contract rather than importing it — the
    reports package never imports the proxy. An absent file is the normal state
    of a fresh install, not an error.
    """
    try:
        with open(path, encoding="utf-8") as handle:
            data: Any = json.load(handle)
    except FileNotFoundError:
        return {}
    except (json.JSONDecodeError, OSError) as err:
        warn(f"facility manager store unreadable, treating as empty: {err}")
        return {}
    return data if isinstance(data, dict) else {}


def _rows(data: Dict[str, Any], key: str) -> List[Dict[str, Any]]:
    value = data.get(key)
    if not isinstance(value, list):
        return []
    return [row for row in value if isinstance(row, dict)]


def summarise(data: Dict[str, Any]) -> Dict[str, Any]:
    """Counts and coverage — never content.

    Everything here is a number or a boolean. That is not an accident of what
    Phase 1 happens to need; it is the shape this module is allowed to have.
    """
    tickets = _rows(data, "tickets")
    open_tickets = [t for t in tickets if not t.get("resolvedAt")]
    resolved = [t for t in tickets if t.get("resolvedAt")]
    return {
        "present": any(_rows(data, name) for name in COLLECTIONS),
        "counts": {name: len(_rows(data, name)) for name in COLLECTIONS},
        "tickets_open": len(open_tickets),
        "tickets_resolved": len(resolved),
        # The join Phase 7 needs: a resolved ticket that names the equipment it
        # was about is what lets "fixed on this date" be attached to a metric.
        "tickets_resolved_with_entity": sum(
            1 for t in resolved if isinstance(t.get("entityId"), str) and t["entityId"]),
        # Counted, never opened. See rule 2.
        "evidence_photos": sum(
            len(row.get("photoIds", []))
            for name in COLLECTIONS for row in _rows(data, name)
            if isinstance(row.get("photoIds"), list)),
    }


def resolved_tickets_for(data: Dict[str, Any], entity_id: str) -> List[Dict[str, Any]]:
    """Resolved tickets naming one device, newest first.

    Returns the raw rows because Phase 7 needs `resolvedAt` and `costId` to
    build a verification finding. ⚠️ The caller is responsible for taking only
    what `PAYLOAD_ALLOWED_FIELDS` permits before anything is narrated — these
    rows carry operator free text, and this function is the boundary where that
    becomes the caller's problem rather than an accident.
    """
    matches = [
        row for row in _rows(data, "tickets")
        if row.get("entityId") == entity_id and row.get("resolvedAt")
    ]
    matches.sort(key=lambda row: str(row.get("resolvedAt", "")), reverse=True)
    return matches


def cost_total(data: Dict[str, Any], since_iso: Optional[str] = None) -> float:
    """Sum of cost entries, optionally from a date.

    ⚠️ NO CURRENCY IS ASSUMED OR RETURNED. The kiosk does not know the villa's
    currency and must not invent one — a number labelled with the wrong symbol
    is worse than an unlabelled number. Formatting is the SPA's job, where the
    operator's own locale is available.
    """
    total = 0.0
    for row in _rows(data, "costs"):
        amount = row.get("amount")
        if not isinstance(amount, (int, float)) or isinstance(amount, bool):
            continue
        if since_iso and str(row.get("date", "")) < since_iso:
            continue
        total += float(amount)
    return total
