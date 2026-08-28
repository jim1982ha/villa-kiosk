"""Every MATERIAL state change, on disk, bounded, surviving a restart.

⚠️ THIS EXISTS BECAUSE THE CURRENT SYSTEM CAN ONLY SEE WHAT A RULE WAS WATCHING.
`collect.py` subscribes to `vesta_*` events, which are emitted by blueprints, so
the historical record contains exactly the things somebody already thought to
write a rule for. Anything no rule watched never happened as far as the report is
concerned — and "we had no rule for that" is precisely the blind spot the
agent-first redesign removes. The journal is the other half: it records the
villa, not the ruleset's opinion of the villa.

⚠️ IT JUDGES NOTHING. There is no threshold here, no severity, no notion of a
finding. `is_material` answers "did anything actually change", which is a
question about DATA. "Is this worth a person's attention" is a different question
asked two tiers up, with the whole villa in view. Putting any part of that
decision here would rebuild the thing being replaced, one predicate at a time.

⚠️ NOTHING CONSUMES THIS YET, AND IT MUST BE READABLE BY HAND. Until salience
(TASK-011) and the Villa Document (TASK-012) land, the only way to know this is
working is to open the file, so entries stay flat, short-keyed and obvious.


WHAT "MATERIAL" MEANS, AND WHY THE LINE IS DRAWN THERE
-----------------------------------------------------
A Home Assistant `state_changed` event fires far more often than anything
changes. A climate entity re-publishes its whole attribute block every time the
room warms by a tenth of a degree; a media player updates a position counter
every second. Journalling all of it costs disk and hides the signal.

Three rules, in order:

1.  **A state VALUE change is always material.** `off` -> `on`, `23.4` -> `23.6`,
    anything. This is the entity's own primary reading and it is what almost
    every question is asked about.

2.  **Availability transitions are always material, in both directions.** They
    are the single highest-value fault signal the villa produces, and the one
    the current pipeline handles worst. Covered by rule 1 in practice, and
    stated separately because it must never be optimised away by a future
    "ignore tiny changes" refinement.

3.  **An attribute change is material only on a short allow-list**, and the
    allow-list has a principle rather than a taste: an attribute is admitted
    when it is COMMANDED or DISCRETE, and refused when it MIRRORS A MEASUREMENT
    THAT ALREADY HAS ITS OWN ENTITY. `climate.x`'s `temperature` is a setpoint —
    somebody chose it, and nothing else in Home Assistant records that choice.
    Its `current_temperature` is the room temperature, which the villa already
    publishes as `sensor.*` with its own state, its own history and its own
    statistics; journalling it here duplicates that entity at a fraction of its
    fidelity and multiplies the volume for nothing.

⚠️ ATTRIBUTE NAMES ARE HOME ASSISTANT VOCABULARY, NOT VILLA DATA. `hvac_action`
and `battery_level` mean the same thing at every property, so this list is not
the hard rule's kind of hardcoding — it does not name an entity, a room, a
device count or a threshold, and it works unchanged on install #2. A list of
entity ids here WOULD be a violation; this is not one.
"""

from __future__ import annotations

from typing import Any, Dict, Final, List, Mapping, Optional, Sequence, Tuple

from vesta.adapters import store
from vesta.adapters.log import log

# ── where it lives ──────────────────────────────────────────────────────────
#: ⚠️ Its OWN directory, not `/data` alongside the reports stores. Everything
#: this tier writes is agent-era state with a different lifecycle from the
#: pipeline being dismantled, and PH-5 deletes several of that pipeline's files
#: outright. Keeping the two apart means the cleanup is a directory, not a
#: filename audit.
VESTA_DIR: Final[str] = f"{store.DATA_DIR}/vesta"
JOURNAL_FILE: Final[str] = f"{VESTA_DIR}/journal.json"

#: ⚠️ A BOUND IN ENTRIES, AND THE ARITHMETIC IS THE JUSTIFICATION. Measured, not
#: estimated: a typical row with a long real entity id serialises to 102 bytes,
#: so 20,000 is ~2.0 MB — small beside the assets this add-on already ships,
#: and large enough to hold a busy villa's material
#: ⚠️ RAISED 20,000 -> 105,000 ON 2026-08-25, AND THE NUMBER IS A MEASUREMENT.
#: The heartbeat measured this property at 7,322 rows/day, so 20,000 held 2.84
#: DAYS — and salience builds every baseline from whatever is in this ring, so a
#: three-day memory absorbs slow drift instead of reporting it: a pump degrading
#: a few percent a week simply becomes its own new normal. 105,000 is ~14 days,
#: which is longer than the drift timescales that matter (weeks) and is the
#: largest step defensible without measuring the write cost first.
#:
#: ⚠️ THE COST IS PAID 96 TIMES A DAY AND NO SETTING REDUCES IT. `append` is a
#: whole-file read-modify-write on the OBSERVATION cadence
#: (`observe_cycle_minutes`, 15) — NOT the triage cadence an operator can see in
#: the app, which is a different clock entirely. The binding constraint is
#: TRANSIENT MEMORY during the parse (~5-10x file size resident, so ~75-125 MB
#: at this bound), not CPU: 11 MB parses in ~150 ms, about 30 s/day in total.
#: 28 days (~205,000, ~21 MB, 150-250 MB transient) is the spec's intent and is
#: the next step IF the heartbeat shows this one holding.
#: changes for days rather than hours. `collect.py` bounds its own ring at 2,000
#: because it only ever sees `vesta_*` events; this one sees the whole villa, so
#: the same number would be a few hours of history and the agent would be asked
#: to reason about a period it cannot see. RISK NAMED IN THE TASK: an unbounded
#: journal fills the disk on a property nobody visits, so the bound is asserted
#: in the tests rather than trusted.
JOURNAL_MAX_ENTRIES: Final[int] = 105_000

#: Attribute names admitted by rule 3. Commanded or discrete; never a mirror of
#: a measurement that has its own entity. Keep it SHORT — every addition is
#: volume on every write, and the burden of proof is on the addition.
MATERIAL_ATTRIBUTES: Final[Tuple[str, ...]] = (
    "hvac_action",      # what the unit is DOING, as opposed to what it was told
    "hvac_mode",        # commanded
    "preset_mode",      # commanded
    "fan_mode",         # commanded
    "temperature",      # the SETPOINT — no other entity records this choice
    "battery_level",    # moves slowly, and predicts a failure nothing else does
    "current_position", # covers: where it actually got to, vs where it was sent
)

#: The two states that mean "this entity is not answering". Named because rule 2
#: is about them and a future refinement must not be able to filter them out.
UNAVAILABLE_STATES: Final[Tuple[str, ...]] = ("unavailable", "unknown")

_EMPTY: Final[Dict[str, Any]] = {"entries": [], "online_since": "", "last_seen": ""}


# ── the predicate ───────────────────────────────────────────────────────────
def _attrs_of(state: Any) -> Mapping[str, Any]:
    if isinstance(state, dict):
        attrs = state.get("attributes")
        if isinstance(attrs, dict):
            return attrs
    return {}


def _value_of(state: Any) -> Optional[str]:
    """The primary reading, or None when there is no state object at all.

    ⚠️ None AND "" ARE DIFFERENT and both occur. `None` means Home Assistant sent
    no `old_state` — the entity was just created, so there is nothing to compare
    against and the change is material by definition. `""` is a state that is
    genuinely the empty string, which is a value like any other.
    """
    if not isinstance(state, dict):
        return None
    value = state.get("state")
    return None if value is None else str(value)


def material_attributes(old: Any, new: Any) -> List[str]:
    """Which allow-listed attributes actually differ. Empty when none do."""
    before, after = _attrs_of(old), _attrs_of(new)
    return [name for name in MATERIAL_ATTRIBUTES
            if before.get(name) != after.get(name)]


def is_material(event: Any) -> bool:
    """Did anything worth recording actually change?

    ⚠️ THE DEFAULT IS "NOT MATERIAL" ONLY FOR A RECOGNISED NO-OP. An event this
    function does not understand — a shape Home Assistant changes, a payload
    from a future integration — is recorded, not dropped. Journalling something
    uninteresting costs a row; silently dropping something real costs the
    agent's ability to answer a question, and the failure is invisible because
    the missing row looks exactly like a quiet villa.
    """
    if not isinstance(event, dict):
        return False
    data = event.get("data")
    if not isinstance(data, dict):
        return False
    if not str(data.get("entity_id") or ""):
        return False

    old, new = data.get("old_state"), data.get("new_state")
    if new is None:
        # The entity was REMOVED. That is a fact about the villa worth keeping.
        return True

    old_value, new_value = _value_of(old), _value_of(new)
    if old_value is None:
        return True                       # first sighting: nothing to compare
    if old_value != new_value:
        return True                       # rules 1 and 2
    return bool(material_attributes(old, new))   # rule 3


# ── one event -> one row ────────────────────────────────────────────────────
def entry_of(event: Any) -> Optional[Dict[str, Any]]:
    """A journal row, or None when the event is not material.

    Short keys on purpose: this is a ring holding tens of thousands of rows and
    the key names are repeated in every one of them. Measured: spelling this
    one key `entity_id` rather than `id` costs 7 bytes of a 102-byte row, ~7%
    of the whole file for one field name.
    """
    if not is_material(event):
        return None
    data = event["data"]
    new = data.get("new_state")
    old = data.get("old_state")

    row: Dict[str, Any] = {
        # ⚠️ THE EVENT'S OWN STAMP FIRST, same rule as `aggregate.normalise`.
        # `time_fired` is when the change happened; a write-time clock would be
        # later by however long the queue was, and much later after an outage.
        "at": str(event.get("time_fired") or event.get("fired")
                  or data.get("last_changed") or ""),
        "id": str(data.get("entity_id") or ""),
        "s": _value_of(new) if new is not None else None,
        "p": _value_of(old),
    }
    changed = material_attributes(old, new)
    if changed:
        attrs = _attrs_of(new)
        row["a"] = {name: attrs.get(name) for name in changed}
    return row


# ── the store ───────────────────────────────────────────────────────────────
def read() -> Dict[str, Any]:
    """The whole journal, degrading to an empty one. Never raises."""
    raw = store.read_json(JOURNAL_FILE, dict(_EMPTY))
    if not isinstance(raw, dict):
        return dict(_EMPTY)
    entries = raw.get("entries")
    return {
        "entries": entries if isinstance(entries, list) else [],
        "online_since": str(raw.get("online_since") or ""),
        "last_seen": str(raw.get("last_seen") or ""),
    }


def append(events: Sequence[Any], *, now_iso: str = "") -> int:
    """Journal every material event. Returns how many rows were written.

    ⚠️ READ-MODIFY-WRITE, AND THAT IS ADEQUATE HERE RATHER THAN LAZY. There is
    exactly one writer — the collector's forever-task — so there is no second
    process to race with, and `store.write_json` is atomic, so a crash mid-write
    leaves the previous journal whole rather than a truncated one. If a second
    writer is ever added this becomes wrong, which is why the assumption is
    written down instead of left to be inferred.

    ⚠️ SWALLOWS. Per the package rule: a journal that cannot be written must not
    take down the process that was trying to write it.
    """
    rows = [row for row in (entry_of(e) for e in events) if row is not None]
    if not rows:
        return 0
    try:
        current = read()
        entries = list(current["entries"]) + rows
        # ⚠️ TRIM THE OLDEST, KEEP THE NEWEST. A ring that dropped new rows when
        # full would go quiet exactly when the villa got busy, which is the one
        # time the history matters.
        if len(entries) > JOURNAL_MAX_ENTRIES:
            entries = _trim(entries)
        store.write_json(JOURNAL_FILE, {
            "entries": entries,
            # ⚠️ SET ONCE AND PRESERVED. `online_since` is the start of the
            # window this journal can honestly speak for, so re-stamping it on
            # every write would make coverage claim the villa had only just
            # started being watched — and a restart would erase the evidence of
            # everything before it. Same semantics as `collect.online_since`.
            "online_since": current["online_since"] or now_iso,
            "last_seen": now_iso or current["last_seen"],
        })
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        log(f"journal write failed, {len(rows)} row(s) lost: {err}")
        return 0
    return len(rows)


def _trim(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The newest rows, PLUS the last sighting of every entity they omit.

    ⚠️ A PLAIN RING SILENTLY SHRANK THE AGENT'S ADDRESSABLE WORLD, and it was
    found from a transcript rather than from a test. `agent/sources.build_refs`
    mints one handle per entity IN THIS JOURNAL — deliberately, because "a
    device the villa has never reported is a device no tool can say anything
    about". That reasoning is sound while the journal covers its window and
    FALSE the moment the ring is full: what survives is then not "everything
    observed" but "whatever changed most recently", which is a different set.

    And the bias runs the wrong way. A steadily-running pump emits few state
    changes; a chatty signal-strength sensor emits thousands. So the ring evicts
    the equipment somebody would ask about FIRST, and the agent answered
    accordingly: "no pool pump circuit shows up in what I can address" — of a
    circuit drawing 863.7 W, which the villa had been metering all along. That
    sentence was TRUE about the journal and false about the villa.

    So the trim keeps a per-entity FLOOR: the newest `JOURNAL_MAX_ENTRIES` rows,
    and for every entity absent from that window, its most recent row. The
    addressable set becomes "every entity ever observed" — bounded by the number
    of entities, which is a property of the property — while HISTORY stays
    bounded by the ring, which is the thing that was actually at risk of filling
    a disk.

    ⚠️ RE-SORTED, because a floor row is older than the window it is added to
    and `since()` compares timestamps on the assumption that entries are
    chronological. Merging without sorting would make an entity's history end
    before it began.

    ⚠️ AND THE RESULT CAN EXCEED THE BOUND, deliberately and by at most one row
    per entity. The alternative — evicting floors to stay exactly at the number
    — is the original defect with extra steps. The bound is a disk-size
    guardrail, not an invariant somebody reads.
    """
    window = entries[-JOURNAL_MAX_ENTRIES:]
    seen = {str(row.get("id") or "") for row in window}
    floors: Dict[str, Dict[str, Any]] = {}
    for row in entries[:-JOURNAL_MAX_ENTRIES]:
        entity_id = str(row.get("id") or "")
        if entity_id and entity_id not in seen:
            # Later rows overwrite earlier ones, so this keeps the LAST sighting.
            floors[entity_id] = row
    if not floors:
        return window
    merged = list(floors.values()) + window
    merged.sort(key=lambda r: str(r.get("at") or ""))
    return merged


def coverage(since_iso: str, *, as_utc: Any = None) -> Dict[str, Any]:
    """Was this journal listening for the whole of the caller's window?

    ⚠️ THE SAME QUESTION `collect.coverage` ANSWERS, AND DELIBERATELY THE SAME
    SHAPE. A period with no entries and a period with no listener produce an
    identical empty journal and mean opposite things — the agent must be able
    to tell "nothing happened" from "I was not watching", or its first honest
    sentence about a quiet villa is a lie.

    `as_utc` is injected rather than imported so this module does not depend on
    `collect` — that module is being rewritten in PH-5 and shrinks to ~250
    lines. Callers pass `collect.as_utc_iso`; the fallback compares raw, which
    is correct whenever both sides are already UTC and is documented as the
    degraded answer rather than presented as the real one.
    """
    current = read()
    online_since = current["online_since"]
    normalise = as_utc if callable(as_utc) else (lambda value: value)
    try:
        # ⚠️ AN EMPTY WINDOW MEANS "THE WHOLE JOURNAL", AND THE JOURNAL IS
        # COMPLETE OVER ITS OWN EXTENT. It used to fall into the comparison
        # below, where `online_since <= ""` is False for every non-empty stamp
        # — so `coverage("")`, which TOOL-005's own schema documents as "omit
        # for the whole journal" and `read_villa` passes, answered INCOMPLETE
        # permanently. The
        # Villa Document then printed "part of this window was not observed"
        # above every delta a listening villa ever produced, which is this
        # subsystem's own worst failure — an instrument lying about the thing it
        # exists to measure — in the line that exists to prevent it.
        complete = (bool(online_since) if not str(since_iso or "").strip()
                    else bool(online_since) and online_since <= normalise(since_iso))
    except Exception:  # noqa: BLE001 - a malformed window is not fatal
        complete = False
    return {
        "complete": complete,
        "online_since": online_since,
        "last_seen": current["last_seen"],
        "entries": len(current["entries"]),
        "bound": JOURNAL_MAX_ENTRIES,
        # ⚠️ SAYS WHEN THE RING IS THE REASON HISTORY STOPS, rather than letting
        # a full journal look like a villa with no past. Once this is true the
        # oldest entry is a floor imposed by us, not by the villa.
        "at_bound": len(current["entries"]) >= JOURNAL_MAX_ENTRIES,
    }


def last_states() -> Dict[str, str]:
    """Each entity's most recently journalled STATE — the restart baseline.

    ⚠️ THIS EXISTS BECAUSE THE BASELINE WAS PROCESS MEMORY WHILE THE RECORD WAS
    ON DISK, AND NOTHING JOINED THEM. `cycle._LAST` starts empty, so the first
    cycle after every restart saw `previous = {}`, called every entity new and
    journalled the whole villa — 1,256 rows in one cycle at the reference
    property, against ~105 for an ordinary one. That is ~12 cycles, i.e. THREE
    HOURS of history, evicted per restart to re-record states the journal
    already held. Eleven restarts in one afternoon of dev releases cost more
    than a day of the window, and the ring reported itself full.

    `diff_states`' own docstring called the sweep "correct and not noise" — true
    on a COLD start, where the journal really has no record of any of them, and
    false on every restart after it. The distinction is exactly this function's
    return value being empty or not, so the cold-start sweep is preserved by
    construction rather than by a flag.

    ⚠️ STATE ONLY, AND THE CALLER MUST TREAT ATTRIBUTES AS UNKNOWN. A row
    carries `a` only when a material attribute CHANGED, so the newest row's `a`
    is a delta and never the entity's current attribute set. Reconstructing one
    from it would seed a baseline that is wrong in a way nothing can detect —
    and comparing a partial dict against a full one re-journals every climate
    unit and every cover on every restart, which is this defect again at a
    tenth of the size.

    ⚠️ AN ENTITY WHOSE LAST ROW IS A REMOVAL IS OMITTED. Its `s` is None, it is
    already recorded as gone, and seeding it would make the next cycle emit a
    second removal event for an entity that left the villa weeks ago.
    """
    out: Dict[str, str] = {}
    for row in read()["entries"]:
        if not isinstance(row, dict):
            continue
        entity_id = str(row.get("id") or "")
        if not entity_id:
            continue
        value = row.get("s")
        # Entries are chronological, so a later row overwrites an earlier one
        # and the last write per id wins. A removal DELETES rather than skips:
        # the entity was present earlier in the window and is gone now.
        if value is None:
            out.pop(entity_id, None)
        else:
            out[entity_id] = str(value)
    return out


def since(iso: str) -> List[Dict[str, Any]]:
    """Rows at or after `iso`, oldest first.

    String comparison, which is only chronological when both sides carry the
    same offset — see `collect.as_utc_iso`'s note. Callers holding a local
    window must normalise it first.
    """
    if not iso:
        return list(read()["entries"])
    return [row for row in read()["entries"]
            if isinstance(row, dict) and str(row.get("at") or "") >= iso]
