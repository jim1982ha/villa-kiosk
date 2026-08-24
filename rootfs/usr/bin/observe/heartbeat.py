"""An hourly line the owner can paste back after a couple of days.

⚠️ IT EXISTS BECAUSE THE ANSWER TO "IS THE RING STILL FILLING" TAKES DAYS TO
COLLECT AND NOBODY IS WATCHING WHILE IT DOES. 2.738.0 fixed the restart sweep
that was evicting three hours of history per restart; whether that is ENOUGH
depends on the villa's own steady change rate, which is a property of the
property and cannot be derived here. The alternative to this file is asking the
owner to catch a log window by hand at the right moment, which is how the
previous round of this went.

⚠️ IT SHIPS ONE RELEASE AFTER THE FIX IT JUDGES, NOT BESIDE IT. That ordering
is `feedback_instrument-before-fix`, and it was violated once already in this
repo (2.454.0 shipped `forceOpaque` and the line that measures it together, so
the line could never separate "the fix worked" from "this was never the cause").
Here the fix is in 2.738.0 and the instrument in 2.739.0, so a `seeded=` field
reading zero restarts means the fix held and not that the field is broken.

⚠️ AND EVERY FIELD SAYS WHEN IT CANNOT MEASURE, rather than printing a zero.
Four counters in this project have read `0` for the exact case they existed to
measure (`feedback_instruments-never-skip`); `?` is reserved for "not known" so
a real zero stays readable as a real zero.

⚠️ OFF BY DEFAULT AND NAMED `heartbeat_log`, NOT "telemetry". The word telemetry
is TAKEN in this add-on — `/telemetry` is a bounded ring of browser diagnostics
with its own retention option (`telemetry_max_events`) and an owner-only read —
and `journal.py` has already paid for a borrowed noun once: it said "recorder"
for VESTA's own ring and sent somebody to change Home Assistant's recorder
retention settings, a working subsystem, on our advice. A second thing called
telemetry in the same add-on log would be the same mistake with a different
word.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Mapping, Optional

from observe import journal
from reports import store
from reports.log import log

#: The add-on option that turns this on. Off by default: it is a diagnostic for
#: a question currently open, not a permanent cost on every install.
OPTION_KEY = "heartbeat_log"

#: How often. An hour is short enough that a two-day window is ~48 samples —
#: enough to see a trend — and long enough that the journal parse it costs is
#: negligible beside the one the cycle already does four times an hour.
#:
#: ⚠️ A FLOOR, NOT A GUARANTEE. `maybe_log` is driven by the observation cycle,
#: so this bounds how often the heartbeat MAY fire and the cadence bounds how
#: often it CAN. At the default 15-minute cadence the two agree to within a
#: cycle; above an hour the cadence wins, which is correct — a line describing
#: cycles cannot report more often than cycles happen.
INTERVAL_SECONDS = 3600.0

#: How many of the loudest entities to name. The ring's depth is decided by its
#: busiest talkers, and "raise the bound" and "stop journalling that sensor" are
#: different fixes with the same symptom — this is the field that separates them.
TOP_TALKERS = 8


def enabled() -> bool:
    """Whether the operator has switched the heartbeat on."""
    return bool(store.addon_option(OPTION_KEY, False))


def _span_days(entries: List[Any]) -> Optional[float]:
    """How many days the journal actually covers, or None when it cannot say.

    ⚠️ `at` IS AN ISO STRING AND MAY CARRY ANY OFFSET, so this parses rather
    than subtracting strings. A malformed or mixed-offset pair returns None —
    "cannot say" — because a wrong span here would misprice the one decision
    this line exists to inform.
    """
    stamps = [str(row.get("at") or "") for row in entries
              if isinstance(row, dict) and row.get("at")]
    if len(stamps) < 2:
        return None
    try:
        from datetime import datetime
        first = datetime.fromisoformat(min(stamps).replace("Z", "+00:00"))
        last = datetime.fromisoformat(max(stamps).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if first.tzinfo is None or last.tzinfo is None:
        return None
    seconds = (last - first).total_seconds()
    return seconds / 86400.0 if seconds > 0 else None


def snapshot(stats: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """Everything the lines print, computed once.

    ⚠️ ONE COMPUTATION, TWO CONSUMERS — the same shape as `agent/prefix.py`, and
    for the same reason: a formatter that recomputes its own arithmetic is two
    numbers that drift, which is the store-envelope defect one level down.
    """
    current = journal.read()
    entries = current["entries"]
    total = len(entries)
    span = _span_days(entries)

    talkers: Dict[str, int] = {}
    for row in entries:
        if isinstance(row, dict):
            entity_id = str(row.get("id") or "")
            if entity_id:
                talkers[entity_id] = talkers.get(entity_id, 0) + 1
    ranked = sorted(talkers.items(), key=lambda kv: (-kv[1], kv[0]))

    st = dict(stats or {})
    cycles = int(st.get("cycles") or 0)
    rows = int(st.get("rows") or 0)
    return {
        "entries": total,
        "bound": journal.JOURNAL_MAX_ENTRIES,
        "at_bound": total >= journal.JOURNAL_MAX_ENTRIES,
        "span_days": span,
        # ⚠️ THE RATE IS MEASURED FROM THE RING, NOT FROM THE CADENCE. A rate
        # derived from "cadence x mean rows" would be a restatement of the
        # cycle counters and would agree with them however wrong both were;
        # entries-over-span is the villa's own answer and is what decides
        # whether 20,000 is two days or two weeks here.
        "rows_per_day": (total / span) if span else None,
        "entities": len(talkers),
        "talkers": ranked[:TOP_TALKERS],
        "talker_share": (sum(n for _, n in ranked[:TOP_TALKERS]) / total
                         if total else None),
        "online_since": current["online_since"],
        "last_seen": current["last_seen"],
        "cycles": cycles,
        "rows": rows,
        "mean_rows": (rows / cycles) if cycles else None,
        "restarts": int(st.get("restarts") or 0),
        "seeded": int(st.get("seeded") or 0),
        "uptime_hours": ((time.monotonic() - float(st["started"])) / 3600.0
                         if st.get("started") else None),
    }


def _num(value: Optional[float], unit: str = "", places: int = 1) -> str:
    """A measurement, or `?` when it is genuinely not known."""
    return "?" if value is None else f"{value:,.{places}f}{unit}"


def report(snap: Mapping[str, Any]) -> List[str]:
    """Two lines: the ring, and what is filling it."""
    total, bound = int(snap["entries"]), int(snap["bound"])
    pct = (100.0 * total / bound) if bound else 0.0
    days_left = None
    rate = snap.get("rows_per_day")
    if rate and not snap["at_bound"]:
        days_left = (bound - total) / float(rate)

    ring = (f"heartbeat ring {total:,}/{bound:,} ({pct:.1f}%"
            + (" FULL, evicting oldest" if snap["at_bound"] else "")
            + f") span {_num(snap.get('span_days'), 'd', 2)}"
            + f" rate {_num(rate, '/day', 0)}"
            + f" entities {snap['entities']:,}"
            + (f" fills in {days_left:.1f}d" if days_left is not None else "")
            + f" | cycles {snap['cycles']:,}"
            + f" mean {_num(snap.get('mean_rows'), '', 1)}/cycle"
            + f" restarts {snap['restarts']}"
            + f" seeded {snap['seeded']:,}"
            + f" up {_num(snap.get('uptime_hours'), 'h', 1)}")

    share = snap.get("talker_share")
    named = " ".join(f"{eid} {n:,}" for eid, n in snap["talkers"]) or "none"
    talk = (f"heartbeat talkers (top {len(snap['talkers'])} = "
            + (f"{100.0 * share:.1f}%" if share is not None else "?")
            + f" of the ring) {named}")
    return [ring, talk]


def maybe_log(stats: Optional[Mapping[str, Any]] = None,
              *, now: Optional[float] = None) -> bool:
    """Emit the heartbeat if it is switched on and an hour has passed.

    ⚠️ THE CLOCK IS `monotonic`, NOT WALL TIME. A villa whose clock steps —
    an NTP correction after a power cut, which is exactly the moment this
    would be worth reading — would otherwise either spam an hour of lines or
    go silent until the clock caught up.

    ⚠️ THE OPTION IS CHECKED HERE AND NOT AT START-UP, so switching it on takes
    effect within the hour rather than at the next restart. A restart is the
    one event this instrument is trying to measure, and requiring one to enable
    it would perturb the measurement.
    """
    stamp = time.monotonic() if now is None else now
    last = _STATE.get("last")
    if not enabled():
        # ⚠️ THE TIMER IS RESET WHEN OFF so that switching it on emits promptly
        # rather than at whatever point the disabled clock happened to reach.
        _STATE["last"] = stamp
        return False
    if last is not None and stamp - float(last) < INTERVAL_SECONDS:
        return False
    _STATE["last"] = stamp
    for line in report(snapshot(stats)):
        log(line)
    return True


#: Module state, deliberately tiny: only the last emission's clock reading.
_STATE: Dict[str, Any] = {}
