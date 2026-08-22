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
import re
from typing import Any, Dict, List, Mapping, Optional, Sequence

from .hass import HassClient, HassUnavailable
from .log import warn

FM_DATA_FILE = "/data/fm-data.json"

# The collections the SPA maintains. Named explicitly rather than iterating
# whatever keys the file happens to have, so a future collection is invisible
# here until someone decides what a report should say about it.
COLLECTIONS = ("schedules", "completions", "costs", "tickets", "savedDocuments")

#: The status a fault reaches when it is done. `FmTicketStatus` in `fmTypes.ts`
#: is exactly "open" | "in_progress" | "resolved".
TICKET_RESOLVED = "resolved"


def ticket_is_resolved(ticket: Mapping[str, Any]) -> bool:
    """Is this fault finished? ⚠️ THE STATUS DECIDES, NEVER `resolvedAt`.

    ⚠️ THREE IMPLEMENTATIONS OF THIS ONE QUESTION EXISTED, AND TWO OF THEM WERE
    BOTH IN THIS PACKAGE (D12, 2026-08-22). `fmEngine.ticketStats` — which the
    Facility Report's "Faults and response" section prints — switches on
    `status`; `standing.build` also switches on `status`; and `summarise` below
    used `not resolvedAt`. So the same store answered "how many faults are
    open" two ways, and the Facility Report and the briefing could disagree
    about a villa in the same minute. That is the divergence class the whole
    consistency programme exists to close, surviving inside the add-on itself.

    ⚠️ `status` WINS BECAUSE IT IS THE FIELD THE UI WRITES. A fault is moved
    between states by a person pressing a control, and `resolvedAt` is a
    timestamp stamped alongside — so a row can carry one without the other and
    real stores do: a fault marked resolved before the timestamp field existed
    has a status and no stamp, and `resolvedAt` would call it open forever.
    The reverse (a stamp on a row still marked open) is data debris, and
    reading the status is what makes the tablet and the brief agree about it
    rather than each guessing.

    ⚠️ `resolvedAt` IS STILL THE RIGHT FIELD FOR *WHEN*, and `resolved_tickets_
    for` keeps using it — "which faults were closed in this window" is a
    question about a time, and a resolved row with no stamp cannot answer it.
    That is a different question from "is it open", which is the confusion
    this function ends.
    """
    return str(ticket.get("status") or "") == TICKET_RESOLVED


def ticket_is_open(ticket: Mapping[str, Any]) -> bool:
    """Not resolved — which INCLUDES `in_progress`.

    ⚠️ IN PROGRESS IS OPEN, and the Facility Report shows it separately without
    disagreeing: `ticketStats` returns `open` and `inProgress` as two counts
    whose SUM is this predicate. A brief that said "2 open" beside a report
    saying "1 open, 1 in progress" is consistent; one that dropped the
    in-progress fault entirely would not be.
    """
    return not ticket_is_resolved(ticket)


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
    # ⚠️ THROUGH THE SHARED PREDICATE — see `ticket_is_resolved`. This used to
    # read `resolvedAt` and disagreed with both other implementations.
    open_tickets = [t for t in tickets if ticket_is_open(t)]
    resolved = [t for t in tickets if ticket_is_resolved(t)]
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


# ── the caretaker list ───────────────────────────────────────────────────────
#
# ⚠️ TWO TASK SYSTEMS EXIST AND NEITHER KNOWS ABOUT THE OTHER. Nine blueprints
# call `todo.add_item` beside their event; the kiosk's Facility Manager keeps
# tickets in `fm-data.json`; and `src/fm/` has no `todo` integration at all
# (verified: zero references). This module reads both and writes neither.
#
# ⚠️ AND READING THE LIST IS NOT THE SAME AS READING THE EVENTS. The collector
# only knows what fired while it was listening; the todo list is STANDING STATE.
# On the reference deployment the list held a PM-01 task whose event predates
# the buffer entirely — a genuinely open job the report could not otherwise
# know about.

#: A blueprint stamps every task it raises with its catalog rule id:
#:
#:     item: "[{{ rule_id }}] {{ matched_entities | join(', ') }} - {{ task_text }}"
#:
#: ⚠️ THE MARKER IS THE BLUEPRINT'S OWN CONVENTION, NOT A LIST NAME. Which todo
#: entity the caretaker list IS varies per property — on the reference
#: deployment the blueprints write to `todo.shopping_list`, HA's default — so
#: keying on a name would work on exactly one villa. Keying on the prefix is the
#: same rule as `_categories_from_blueprints`: identify by what the blueprint
#: writes, never by what an operator named something.
#:
#: The bound keeps a genuine shopping item reading "[urgent] milk" from being
#: claimed as a maintenance task on a technicality, and anything unclaimed is
#: never read further — see `todo_tasks`.
TASK_PREFIX = re.compile(r"^\[([^\]]{1,24})\]\s*(.+)$", re.DOTALL)

#: An entity id, for removal. ⚠️ THE LIST ITEMS CARRY THEM — measured on the
#: reference deployment, e.g. "[PM-04] sensor.house_pump_power_factor,
#: sensor.pool_pump_power_factor, ... - Check the pump for a failing capacitor".
#: Entity ids routinely name rooms and people, `PAYLOAD_ALLOWED_FIELDS` has no
#: field they could occupy, and this text is destined for prose a person reads.
ENTITY_ID = re.compile(r"\b[a-z_]+\.[a-z0-9_]+\b")


async def todo_lists(hass: HassClient) -> List[str]:
    """Every `todo` entity, so the caretaker list need not be configured.

    Reading them ALL and filtering by `TASK_PREFIX` is what makes this portable:
    the add-on cannot know which list a property's blueprints were pointed at
    without reading their automation configs, which are villa-specific.
    """
    try:
        result: Any = await hass.command("get_states")
    except HassUnavailable as err:
        warn(f"could not list todo entities ({err}); skipping caretaker tasks")
        return []
    if not isinstance(result, list):
        return []
    return sorted(
        str(row.get("entity_id"))
        for row in result
        if isinstance(row, dict) and str(row.get("entity_id", "")).startswith("todo.")
    )


def clean_summary(summary: str) -> str:
    """A task line with its entity ids removed, ready to be read by a person.

    ⚠️ REMOVED, NOT MASKED. There is no placeholder left behind: a report that
    prints "[redacted] has drifted" invites the reader to ask what was redacted,
    and Phase 6 would send the sentence either way.

    ⚠️ AND A SENTENCE CAN LOSE ITS SUBJECT. The blueprints write THREE shapes,
    measured on the reference deployment:

        "[PM-04] sensor.a, sensor.b - Check the pump for a failing capacitor"
        "[PM-01] sensor.a has drifted -99.9% from baseline. Check the pump for"
        "[DQ-02] Critical automation(s) found OFF: automation.a. Re-enable, or"

    Stripping the first is clean; stripping the second leaves "has drifted
    -99.9% from baseline." — a dangling verb. Dropping that clause would be
    tidier and would throw away the MEASUREMENT, which is the most useful thing
    on the line, so a generic subject is restored instead. It invents nothing:
    the thing that drifted genuinely was a monitored device, and which one is
    exactly what must not travel.

    ⚠️ THE THIRD WAS MISSED, AND THIS DOCSTRING SAID "TWO SHAPES" WHILE THE
    OWNER LOOKED AT THE THIRD ON THEIR TABLET (2026-08-22). Where the ids sit
    MID-SENTENCE after a colon, removing them leaves the separator stranded
    against the full stop — the Tasks tab read "Critical automation(s) found
    OFF: . Re-enable, or document as a deliberate, intentional decision.", an
    instruction to re-enable nothing in particular. None of the three cleanups
    below touched it: two only fix commas, and the third only fixes the START
    of the line. A count of shapes in a comment is a claim that rots the day a
    tenth blueprint writes an eleventh sentence, so the cleanup is now shaped
    by what the removal can STRAND rather than by an inventory of senders.
    """
    without = ENTITY_ID.sub("", summary)
    # Collapse the punctuation the removal leaves behind — ", , -" and friends.
    without = re.sub(r"\s*,\s*(?=,|-|$)", "", without)
    without = re.sub(r"^\s*[-,.]\s*", "", without)
    # ⚠️ A SEPARATOR THAT NOW INTRODUCES NOTHING. `:` and `-` join a clause to
    # the thing it is about; with that thing gone they must go too, or the
    # sentence reads as a missing word rather than a withheld one. Bounded to a
    # separator directly against terminal punctuation or the end of the line,
    # so "drawing 761.7 W outside its window - confirm whether..." keeps its
    # dash: there the dash still introduces something.
    without = re.sub(r"\s*[:\-]\s*(?=[.;,]|$)", "", without)
    text = re.sub(r"\s{2,}", " ", without).strip(" ,-:")
    if text[:1].islower():
        return f"A monitored device {text}"
    return text


async def todo_tasks(hass: HassClient,
                     entity_ids: Optional[Sequence[str]] = None,
                     status: str = "needs_action") -> List[Dict[str, str]]:
    """Caretaker tasks a blueprint raised, from every todo list.

    ⚠️ READ ONLY, AND ONLY THE ITEMS THIS SYSTEM WROTE. An unclaimed item is not
    parsed, not counted and not carried anywhere — the caretaker list on the
    reference deployment is also the household's shopping list, and a report
    that enumerated it would be reading somebody's groceries.

    `status` selects which half: `needs_action` is outstanding work, and
    `completed` is what Phase 7 joins against to claim something was actually
    done. Both are read the same way and neither is ever written.
    """
    lists = list(entity_ids) if entity_ids is not None else await todo_lists(hass)
    out: List[Dict[str, str]] = []
    for entity_id in lists:
        try:
            result: Any = await hass.command(
                "todo/item/list", entity_id=entity_id)
        except HassUnavailable as err:
            warn(f"could not read {entity_id} ({err})")
            continue
        items = result.get("items") if isinstance(result, dict) else result
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            if str(item.get("status") or "needs_action") != status:
                continue
            match = TASK_PREFIX.match(str(item.get("summary") or "").strip())
            if not match:
                continue
            text = clean_summary(match.group(2))
            if text:
                # ⚠️ `uid` AND `entity_id` RIDE ALONG SO NOTHING PARSES THIS
                # TWICE. Acknowledging a task from the kiosk needs the item's
                # id and the list it is on, and the ONLY safe way to get them is
                # from the same pass that already decided this item is one of
                # ours — `TASK_PREFIX` is what separates a caretaker task from
                # somebody's groceries, and the reference deployment keeps both
                # on one list. A second reader would be a second chance to get
                # that filter wrong.
                out.append({"rule_id": match.group(1).strip(), "text": text,
                            "uid": str(item.get("uid") or ""),
                            "entity_id": entity_id})
    return out


def reconcile(todo: Sequence[Dict[str, str]],
              reported: Sequence[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Caretaker tasks NOT already stated from this period's own events.

    ⚠️ THE SAME TASK REACHES THE REPORT BY TWO ROUTES. A blueprint fires its
    event AND calls `todo.add_item` in the same action, so a task raised inside
    the reporting window is in both the collector's buffer and the todo list.
    Printing both was the duplication Phase B exists to remove.

    ⚠️ MATCHED ON `rule_id`, WHICH IS THE ONLY RELIABLE JOIN. The item's text
    format varies by blueprint — some write "[PM-04] entities - task", others
    "[PM-01] entity has drifted -99.9%. task" — so a text comparison would
    match on some rules and not others, which is worse than not matching at
    all. The bracketed rule id is written identically by every one of the nine.

    ⚠️ A BLANK `rule_id` NEVER MATCHES ANYTHING. It defaults to `""` in every
    blueprint, so treating blank-equals-blank as a match would collapse every
    untagged task into one.
    """
    seen = {
        str(row.get("rule_id") or "").strip()
        for row in reported
        if isinstance(row, dict) and str(row.get("rule_id") or "").strip()
    }
    return [task for task in todo
            if task.get("rule_id") and task["rule_id"] not in seen]
