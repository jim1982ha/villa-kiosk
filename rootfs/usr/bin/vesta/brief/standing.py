"""What is wrong RIGHT NOW — the same four questions the kiosk's Cockpit asks.

⚠️ THE POINT IS AGREEMENT, NOT COVERAGE. This module exists because a person
looking at the tablet and a person reading the briefing must not be told
different things about one villa. The owner, after a brief that mentioned none
of the four devices the Cockpit was listing at the same moment:

    "both supervision systems are like brother and sisters and shall always
     report consistent findings ... User shall never notice any discrepancy
     between what VESTA Kiosk UI is reporting and the alerts he is receiving."

So this is a PORT of `cockpitData.buildAttentionItems`, kind for kind, in its
order, and `tests/py/test_consistency_parity.py` runs the shipped TypeScript
against the same fixtures and fails on any difference.

⚠️ STANDING STATE IS NOT THE PERIOD'S EVENTS, AND THE BRIEF MUST SAY WHICH. The
Cockpit is live; a briefing covers a window. A device that failed and recovered
inside the window belongs to the events and not here; one that failed before the
window and is still down belongs here and not to the events. Both readings are
correct and BOTH look like a contradiction unless each is labelled. That is why
this is its own section with its own tense rather than more findings.

⚠️ IDS ARE THE KIOSK'S IDS. `unavailable:<entity_id>`, `fault:<uuid>`,
`schedule:<id>`, `alarm:<entity_id>` — the same subject keys, so the two sides
are comparable at all, and so P3's deduplication against the blueprint layer has
something stable to key on. They stay SERVER-SIDE: `Item.subject` never enters a
narration payload, which `PAYLOAD_ALLOWED_FIELDS` enforces by construction.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence

from vesta.adapters import devices as devices_mod
from vesta.adapters import ledger

DAY_MS = 86_400_000.0

#: "Due soon" opens when 80% of the interval has elapsed — `fmEngine`'s own
#: constant. Proportional rather than a fixed lead time, because a fixed one is
#: meaningless at both ends of a 3-day-to-90-day range.
DUE_SOON_FRACTION = 0.8

#: Which state counts as a binary_sensor class's own problem state — the
#: `alarmState` column of `src/config/BinarySensorClasses.ts`.
#:
#: ⚠️ A CROSS-ARTEFACT TABLE, AND THEREFORE PINNED RATHER THAN TRUSTED. This is
#: the exact shape that has bitten this subsystem six times (store envelopes,
#: config key case, nginx routes): a literal on each side of a language boundary
#: with nothing between them. The parity test DERIVES the expected mapping from
#: the TypeScript source and fails when a class is added there and not here — a
#: new hazard class silently never alerting is the failure mode.
#:
#: ⚠️ AND AN UNLISTED CLASS ALERTS ON "on", preserving the kiosk's own
#: DEFAULT_INFO. Defaulting to "never alerts" would be the safer-looking choice
#: and is the wrong one: it makes an unrecognised device_class silently
#: invisible on one surface and visible on the other.
ALARM_STATE: Dict[str, str] = {
    "moisture": "on", "smoke": "on", "gas": "on", "carbon_monoxide": "on",
    "safety": "on", "problem": "on", "tamper": "on", "heat": "on",
    "cold": "on", "battery": "on",
    "connectivity": "off",
    "motion": "none", "moving": "none", "occupancy": "none", "presence": "none",
    "sound": "none", "vibration": "none", "light": "none", "door": "none",
    "garage_door": "none", "window": "none", "opening": "none", "lock": "none",
    "plug": "none", "running": "none", "battery_charging": "none",
    "update": "none",
}
DEFAULT_ALARM_STATE = "on"

#: The words a class's alarm is described with. Only the classes whose alarm can
#: actually fire need one; anything else never reaches the label.
ALARM_LABEL: Dict[str, Dict[str, str]] = {
    "moisture": {"on": "Leak detected", "off": "No leak"},
    "smoke": {"on": "Smoke detected", "off": "Clear"},
    "gas": {"on": "Gas detected", "off": "Clear"},
    "carbon_monoxide": {"on": "CO detected", "off": "Clear"},
    "safety": {"on": "Unsafe", "off": "Safe"},
    "problem": {"on": "Problem", "off": "OK"},
    "tamper": {"on": "Tampered", "off": "Clear"},
    "heat": {"on": "Hot", "off": "Normal"},
    "cold": {"on": "Cold", "off": "Normal"},
    "battery": {"on": "Low", "off": "Normal"},
    "connectivity": {"on": "Connected", "off": "Disconnected"},
}
DEFAULT_ALARM_LABEL = {"on": "On", "off": "Off"}


@dataclass
class Item:
    """One thing that is wrong at the moment of composing."""

    #: The stable subject key, matching the kiosk's `AttentionItem.id`.
    #: ⚠️ SERVER-SIDE ONLY — it carries an entity id, which is exactly what
    #: `PAYLOAD_ALLOWED_FIELDS` exists to keep out of a narration payload.
    subject: str
    kind: str          # unavailable | fault | schedule | alarm
    title: str         # what a person calls it
    detail: str        # the short status word
    room: str = ""
    #: The entity this stands for, where there is one. Never narrated.
    entity_id: str = ""


def _now_ms(now: Optional[datetime] = None) -> float:
    return (now or datetime.now(timezone.utc)).timestamp() * 1000.0


def _parse_ms(value: Any) -> Optional[float]:
    """An ISO stamp as epoch ms, or None.

    ⚠️ DELIBERATELY NOT `shared.instants.as_utc`, AND THE DIFFERENCE IS THE
    NAIVE CASE. That module reads a naive stamp as UTC, which is right for its
    callers — the journal, the record and the collector are fed by producers
    that are always tz-aware, so a naive value there can only be stored data
    somebody edited. This one is fed by the FACILITY LEDGER, where `at` is
    "when the work was done" and can come from a date picker as local
    wall-clock; reading that as UTC would move a completion by the villa's whole
    offset and can flip an overdue boundary. Two questions, two answers.
    Converging them needs the ledger's stamp format established first.
    """
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1000.0
    except ValueError:
        return None


#: Below this, say so in words rather than "for 0 minutes".
_UNDER_A_MINUTE_MS = 60_000.0
#: Above this many hours, days read better than hours.
_DAYS_FROM_HOURS = 48


def _for_phrase(elapsed_ms: float) -> str:
    """"for 7 days" / "for 3 hours" / "for 12 minutes" — how long it has been so.

    ⚠️ THIS EXISTS BECAUSE THE SECTION STATED A FACT WITH NO DURATION, AND A
    TELEVISION IS WHAT FOUND IT (owner's brief, 2026-08-30). An LG webOS set
    drops its network connection when it is switched off, so it reports
    `unavailable` about twelve seconds later — and rendered as the bare word, a
    TV somebody turned off at bedtime was indistinguishable from two Zigbee
    sensors that had been dead for a week. All four sat under "needs attention
    right now" and only three of them did.
    ⚠️ THE FIX IS INFORMATION, NOT SUPPRESSION. Nothing is hidden and no grace
    window is applied: deciding a device is "not down enough to mention" is a
    judgement this tier should not make silently, whereas "down for 2 minutes"
    lets the reader make it in one glance. The owner chose this over a settling
    window, and the alternative is recorded here so it is not re-litigated.
    """
    if elapsed_ms < _UNDER_A_MINUTE_MS:
        return "for under a minute"
    minutes = int(elapsed_ms // 60_000)
    if minutes < 60:
        return f"for {minutes} minute{'' if minutes == 1 else 's'}"
    hours = minutes // 60
    if hours < _DAYS_FROM_HOURS:
        return f"for {hours} hour{'' if hours == 1 else 's'}"
    # ⚠️ ALWAYS PLURAL, AND THAT IS FORCED BY THE CUTOVER ABOVE, NOT AN
    # OVERSIGHT. We only reach here at `_DAYS_FROM_HOURS` (48) hours or more, so
    # `days` is never below 2 and a singular branch here could never run.
    # Mutation testing found the version that had one: deleting the singular
    # left every test green, which is the signature of an unreachable branch.
    # This repo's rule is that an unreachable case is worse than an absent one —
    # it reads as "handled" to the next person. If the cutover ever drops below
    # 48 hours, the singular comes back WITH a test that reaches it.
    days = hours // 24
    return f"for {days} days"


def _rows(data: Mapping[str, Any], key: str) -> List[Dict[str, Any]]:
    rows = data.get(key)
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def schedule_state(schedule: Mapping[str, Any],
                   completions: Sequence[Mapping[str, Any]],
                   now_ms: float) -> str:
    """`fmEngine.scheduleStatus().state` — never / overdue / due-soon / ok.

    ⚠️ "NEVER" IS NOT "OVERDUE", and the kiosk is right to separate them: one is
    a gap in the record and the other is a missed obligation. Both demand action
    and they need different words, so the brief keeps the distinction rather
    than flattening it to save a line.
    """
    every_days = schedule.get("everyDays")
    if not isinstance(every_days, (int, float)) or isinstance(every_days, bool):
        return "ok"
    schedule_id = str(schedule.get("id") or "")
    best: Optional[float] = None
    for completion in completions:
        if str(completion.get("scheduleId") or "") != schedule_id:
            continue
        at = _parse_ms(completion.get("at"))
        if at is not None and (best is None or at > best):
            best = at
    if best is None:
        return "never"
    days_until_due = (best + every_days * DAY_MS - now_ms) / DAY_MS
    if days_until_due < 0:
        return "overdue"
    if days_until_due <= every_days * (1 - DUE_SOON_FRACTION):
        return "due-soon"
    return "ok"


def alarm_state_of(device_class: str) -> str:
    return ALARM_STATE.get(device_class, DEFAULT_ALARM_STATE)


def build(entities: Mapping[str, Any],
          device_config: Mapping[str, Any],
          fm_data: Mapping[str, Any],
          mesh_entity_ids: Sequence[str] = (),
          now: Optional[datetime] = None) -> List[Item]:
    """Everything currently wrong, in `buildAttentionItems`' own order.

    ⚠️ THE ORDER IS PART OF THE PORT even though the parity test sorts before
    comparing: a reader who checks the two by eye should not have to.
    """
    entity_map = device_config.get("entityMap") or {}
    device_groups = device_config.get("deviceGroups") or []
    dismissed = device_config.get("dismissedEntityIds") or []
    if not isinstance(entity_map, dict):
        entity_map = {}
    if not isinstance(device_groups, list):
        device_groups = []
    if not isinstance(dismissed, list):
        dismissed = []

    rooms = device_config.get("resolvedRooms")
    room_of: Mapping[str, Any] = rooms if isinstance(rooms, dict) else {}

    now_ms = _now_ms(now)
    items: List[Item] = []

    selectable = devices_mod.selectable_device_ids(
        entity_map, device_groups, mesh_entity_ids, entities, dismissed)
    unavailable = devices_mod.filter_unavailable(selectable, entities)

    for entity_id in unavailable:
        # ⚠️ THE STATE DUMP ALREADY CARRIES `last_changed`, so this is a dict
        # lookup rather than a second call — the same reason `_labels` reads it
        # here instead of asking Home Assistant again. A device whose stamp is
        # missing or unreadable keeps the bare word: an unknown duration must
        # not be rendered as a short one, which would say the opposite of what
        # we know. ⚠️ `last_changed` IS RESET BY AN INTEGRATION RELOAD, so a
        # long-dead device can briefly report a short outage. That is the
        # honest limit of what a single state dump can say; it recovers by
        # itself and never over-states how broken something is.
        raw = entities.get(entity_id)
        since = _parse_ms(raw.get("last_changed")) if isinstance(raw, dict) else None
        detail = ("Unavailable" if since is None
                  else f"Unavailable {_for_phrase(now_ms - since)}")
        items.append(Item(
            subject=f"unavailable:{entity_id}", kind="unavailable",
            title=devices_mod.label_for(entity_id, entity_map, entities),
            detail=detail, room=str(room_of.get(entity_id) or ""),
            entity_id=entity_id))

    for ticket in _rows(fm_data, "tickets"):
        # ⚠️ THE SHARED PREDICATE, not a fourth copy of the same comparison.
        # This one was already correct; routing it through `ledger` is what
        # stops it drifting away from the Facility Report's `ticketStats`.
        if ledger.ticket_is_resolved(ticket):
            continue
        items.append(Item(
            subject=f"fault:{ticket.get('id')}", kind="fault",
            title=str(ticket.get("title") or ""),
            detail=("In progress" if ticket.get("status") == "in_progress"
                    else "Open fault"),
            room=str(ticket.get("room") or ""),
            entity_id=str(ticket.get("entityId") or "")))

    completions = _rows(fm_data, "completions")
    for schedule in _rows(fm_data, "schedules"):
        if not schedule.get("enabled"):
            continue
        state = schedule_state(schedule, completions, now_ms)
        if state not in ("overdue", "never"):
            continue
        items.append(Item(
            subject=f"schedule:{schedule.get('id')}", kind="schedule",
            title=str(schedule.get("title") or ""),
            detail="Never recorded" if state == "never" else "Overdue",
            room=str(schedule.get("room") or ""),
            entity_id=str(schedule.get("entityId") or "")))

    # ⚠️ OVER `selectable`, NEVER A RAW DOMAIN SCAN. A bare Zigbee2MQTT
    # relay-lock or calibration sub-entity is technically a binary_sensor and
    # was never meant to be villa-facing; the kiosk's own comment records that a
    # domain count here is actively misleading rather than merely noisy.
    for entity_id in selectable:
        if not entity_id.startswith("binary_sensor."):
            continue
        entity = entities.get(entity_id)
        if not isinstance(entity, dict):
            continue
        attributes = entity.get("attributes")
        device_class = str((attributes or {}).get("device_class") or "") \
            if isinstance(attributes, dict) else ""
        alarm = alarm_state_of(device_class)
        if alarm == "none" or str(entity.get("state") or "") != alarm:
            continue
        labels = ALARM_LABEL.get(device_class, DEFAULT_ALARM_LABEL)
        items.append(Item(
            subject=f"alarm:{entity_id}", kind="alarm",
            title=devices_mod.label_for(entity_id, entity_map, entities),
            detail=labels.get(alarm, DEFAULT_ALARM_LABEL[alarm]),
            room=str(room_of.get(entity_id) or ""), entity_id=entity_id))

    return items


#: Danger vs. warning, matching `cockpitData.DANGER_KINDS`: something broken or
#: unsafe RIGHT NOW against something that needs doing. A schedule a few days
#: late must not paint the villa the same colour as a leak sensor going off.
#:
#: ⚠️ PINNED AGAINST THE TYPESCRIPT, which now exports the same constant by
#: name. Three severity scales exist in this system — the kiosk's ok/warn/danger,
#: Readiness' pass/warn/fail and the report's critical/warning/notice/info — and
#: until 2.572.0 nothing anywhere asserted a relationship between any two of
#: them, so one condition could read `danger` on the tablet and `notice` in the
#: brief with no code disagreeing.
DANGER_KINDS = frozenset({"unavailable", "alarm"})

#: THE mapping from a standing kind to `contracts.SEVERITY`. One table, read by
#: the renderer's title marker; a second opinion computed at the call site is
#: how the tablet and the notification came to be able to disagree at all.
SEVERITY_OF_KIND: Dict[str, str] = {
    "unavailable": "critical",
    "alarm": "critical",
    "fault": "warning",
    "schedule": "warning",
}
DEFAULT_KIND_SEVERITY = "warning"


def severity_of(kind: str) -> str:
    """⚠️ AN UNKNOWN KIND IS A WARNING, NEVER `info`. A kind this table has not
    heard of is a kind nobody has classified, and silently ranking it as the
    quietest thing in the report is how a new hazard arrives unnoticed."""
    return SEVERITY_OF_KIND.get(kind, DEFAULT_KIND_SEVERITY)


def health(items: Sequence[Item]) -> str:
    if not items:
        return "ok"
    return "danger" if any(i.kind in DANGER_KINDS for i in items) else "warn"
