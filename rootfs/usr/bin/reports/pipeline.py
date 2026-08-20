"""One report, end to end: collect -> analyse -> narrate -> deliver -> record.

⚠️ THIS RUNS WITH NO BROWSER OPEN. That single property is what separates this
subsystem from a button someone presses, and every design decision below
follows from it: nothing may raise into the proxy, nothing may block the event
loop for long, and every outcome must be written down, because there is nobody
watching when it happens.

⚠️ DEGRADE, NEVER FAIL, AND RECORD THE DEGRADATION. A pass that cannot reach
Home Assistant still produces a report — one that says it could not measure
anything. That is deliberate: silence is indistinguishable from "nothing was
wrong", and an owner who stops receiving the weekly summary has no way to tell
a healthy quiet week from a subsystem that died three weeks ago.

The analysis step is empty until Phase 3. It is a named step here rather than
being added later, so the seam it plugs into exists before there is anything to
plug in — and so a Phase 2 report already carries the "no checks are configured
yet" sentence rather than implying all is well.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from aiohttp import ClientSession

from . import discovery, schedule as schedule_mod, store
from .deliver import deliver
from .hass import fetch_timezone
from .log import log, swallow, warn
from .narrate import DeterministicNarrator, ReportContext
from .schedule import period_key


async def run_report(
    session: ClientSession,
    audience: str,
    cadence: str,
    targets: Sequence[str],
    now_local: datetime,
    found: Optional[Dict[str, Any]] = None,
    entry_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Produce and deliver one report. Returns the history entry.

    `found` lets a caller that has already run discovery this pass hand it in —
    discovery is the expensive part and two schedules firing in the same minute
    should not pay for it twice.

    ⚠️ `entry_id` MUST BE THE SCHEDULER'S IDEMPOTENCY KEY for a scheduled
    report, because that key is the only thing that actually guarantees
    uniqueness — one send per schedule per period. The id was built from
    cadence/period/audience for one release, which made two schedules of the
    same cadence on the same day produce IDENTICAL history entries: the QA run
    on real hardware ended with two rows both reading
    `daily:<date>:owner`, distinguishable only by their timestamp. A history
    whose rows cannot be told apart is not much of an audit.

    A manual send has no such guarantee — it can be repeated within a period on
    purpose — so it gets the clock, and says `manual` so the record shows which
    reports a person asked for rather than the schedule.
    """
    generated_at = now_local.isoformat(timespec="seconds")
    period = period_key(cadence, now_local)

    # ── collect ─────────────────────────────────────────────────────────────
    if found is None:
        found = await discovery.discover(session, generated_at)

    # ── analyse ─────────────────────────────────────────────────────────────
    # Empty until Phase 3. `skipped` stays empty too — a module that does not
    # exist has not been "skipped", and inventing an entry for it would be a
    # counter reporting on something that never ran.
    findings: List[Dict[str, Any]] = []
    skipped: List[Dict[str, str]] = []

    # ── narrate ─────────────────────────────────────────────────────────────
    context = ReportContext(
        audience=audience, cadence=cadence, period=period,
        generated_at=generated_at, discovery=found,
        findings=findings, skipped=skipped,
    )
    narrator = DeterministicNarrator()
    try:
        title, body = narrator.render(context)
    except Exception as err:  # noqa: BLE001 - a narrator must never stop a report
        swallow("narration failed; delivering a minimal report", err)
        title = f"{cadence.title()} report — {period}"
        body = "The report could not be composed. See the add-on log."

    # ── deliver ─────────────────────────────────────────────────────────────
    deliveries = await deliver(session, targets, title, body)

    # ── record ──────────────────────────────────────────────────────────────
    severity = "info"
    for item in found.get("preflight") or []:
        if isinstance(item, dict) and item.get("severity") == "critical":
            severity = "critical"
            break

    entry: Dict[str, Any] = {
        "id": entry_id or f"manual:{period}:{now_local.strftime('%H%M%S')}",
        "at": generated_at,
        "audience": audience,
        "cadence": cadence,
        "narration": narrator.name,
        "findingCount": len(findings),
        "severity": severity,
        "deliveries": deliveries,
    }
    log(f"report {entry['id']}: {len(findings)} finding(s), "
        f"{sum(1 for d in deliveries if d.get('status') == 'sent')}/"
        f"{len(deliveries)} delivered")
    return entry


def append_history(entry: Dict[str, Any]) -> None:
    """Add one entry to the bounded ring.

    ⚠️ Written HERE and not through the HTTP handler, which is safe only
    because this store has exactly one writer: the scheduler, in this process.
    That is not true of the Facility Manager store, which several devices write
    concurrently — writing THAT from outside its handler would bypass the lock
    the store factory creates, which is the defect the proxy's own docstring
    records having shipped once. The distinction is the number of writers, not
    the convenience.
    """
    try:
        raw = store.read_json(store.REPORTS_HISTORY_FILE, store.EMPTY_HISTORY)
        document = store.history_view(raw)
        entries = list(document.get("entries") or [])
        entries.append(entry)
        document["entries"] = store.trim_history(entries)
        store.write_json(store.REPORTS_HISTORY_FILE, document)
    except Exception as err:  # noqa: BLE001 - a failed record must not stop delivery
        swallow("could not append to reports history", err)


def targets_for(config: Dict[str, Any], schedule: Dict[str, Any]) -> List[str]:
    """Where one schedule's report goes.

    A schedule may name its own targets; otherwise it uses the global list.
    Empty means nowhere, which `deliver` reports as a configuration state
    rather than an error.
    """
    own = schedule.get("targets")
    if isinstance(own, list) and own:
        return [str(t) for t in own if isinstance(t, str) and t]
    shared = config.get("notify_targets")
    if isinstance(shared, list):
        return [str(t) for t in shared if isinstance(t, str) and t]
    return []


def audience_of(schedule: Dict[str, Any]) -> str:
    audience = schedule.get("audience")
    return audience if audience in ("owner", "facility") else "owner"


def warn_if_broadcast(targets: Sequence[str]) -> None:
    """⚠️ `notify.notify` fans out to EVERY device in the house.

    A fine service and a terrible default: a villa that switches reports on and
    gets the weekly summary on the TV, three phones and a tablet switches them
    off again. Discovery flags it; this says so in the log at the moment it is
    actually used, which is where someone debugging an unwanted broadcast will
    be looking.
    """
    for target in targets:
        if target in ("notify.notify", "notify"):
            warn("delivering via notify.notify — this fans out to EVERY "
                 "notification device configured in Home Assistant")


async def resolve_zone(session: ClientSession, config: Dict[str, Any],
                       state: Dict[str, Any]) -> Tuple[Any, Optional[str]]:
    """The villa's wall clock, and the name to cache if it was just learned.

    ⚠️ THE ORDER IS THE WHOLE FIX. An operator's explicit setting wins; then a
    name cached from a previous pass; then Home Assistant is asked and the
    answer cached. UTC is the last resort and says so loudly, because on a
    UTC+8 property a silent fall back to UTC moves every report eight hours —
    which is not a nuisance, it is a report that never fires at all when the
    schedule is set for the current hour.

    Returns `(zone, learned)` where `learned` is non-None only when the caller
    should persist it. Written this way so the fetch has ONE caller and the
    cache has one writer.
    """
    explicit = str(config.get("timezone") or "")
    if explicit:
        return schedule_mod.resolve_timezone(explicit), None

    cached = state.get("timezone")
    if isinstance(cached, str) and cached:
        return schedule_mod.resolve_timezone(cached), None

    name = await fetch_timezone(session)
    if name:
        log(f"villa timezone is {name} (from Home Assistant)")
        return schedule_mod.resolve_timezone(name), name

    warn("scheduling in UTC — Home Assistant's timezone could not be read and "
         "none is configured; reports may fire at the wrong local hour")
    return schedule_mod.resolve_timezone(""), None


# ── the tick ─────────────────────────────────────────────────────────────────

async def tick(session: ClientSession, now_utc: datetime) -> int:
    """One scheduler pass. Returns how many reports were delivered.

    ⚠️ NEVER RAISES. This is called from a background task in the proxy's own
    event loop; an exception here kills the task silently and reports simply
    stop, with nothing on screen and nothing in the log to say so. Every branch
    ends in a return.

    ⚠️ DISCOVERY RUNS AT MOST ONCE PER TICK, and only when something is due.
    It opens a websocket and walks the recorder's whole statistics table — far
    too expensive to do every 60 seconds on a Pi for the 1439 minutes a day
    when nothing is scheduled.
    """
    try:
        raw = store.read_json(store.REPORTS_CONFIG_FILE, store.EMPTY_CONFIG)
        config = store.config_view(raw)
        if not config.get("enabled"):
            return 0

        schedules = config.get("schedules") or []
        if not isinstance(schedules, list) or not schedules:
            return 0

        state = store.read_json(store.REPORTS_STATE_FILE, store.EMPTY_STATE)
        sent_keys = state.get("sent") if isinstance(state.get("sent"), list) else []

        zone, learned = await resolve_zone(session, config, state)
        if learned:
            state = {**state, "timezone": learned}
            store.write_json(store.REPORTS_STATE_FILE, state)
        now_local = now_utc.astimezone(zone)

        ready = schedule_mod.due(schedules, sent_keys, now_local)
        if not ready:
            return 0

        # One discovery for every schedule firing in this tick.
        found = await discovery.discover(
            session, now_local.isoformat(timespec="seconds"))

        delivered = 0
        for entry in ready:
            targets = targets_for(config, entry)
            warn_if_broadcast(targets)
            record = await run_report(
                session, audience_of(entry), str(entry.get("cadence")),
                targets, now_local, found, entry_id=str(entry["key"]))
            append_history(record)
            delivered += 1

            # ⚠️ RECORDED AFTER THE ATTEMPT, NOT AFTER SUCCESS. A target that
            # refuses must not cause the whole report to be re-sent to every
            # OTHER target on the next tick — the ones that succeeded would get
            # it twice. Per-target status is in the history entry; a genuine
            # resend is an operator action, not an automatic retry.
            sent_keys = list(sent_keys) + [str(entry["key"])]
            store.write_json(store.REPORTS_STATE_FILE,
                             {**state, "sent": schedule_mod.prune_keys(sent_keys)})

        return delivered
    except Exception as err:  # noqa: BLE001 - the loop must survive anything
        swallow("scheduler tick failed", err)
        return 0


async def run_forever(session: ClientSession, interval_s: float = 60.0) -> None:
    """The background loop. Started once, from the proxy's on_startup.

    A 60-second tick means a schedule fires within a minute of its hour, which
    is as precise as a daily summary needs and cheap enough to ignore: when
    nothing is due, a tick is one small file read.
    """
    log("scheduler started")
    while True:
        try:
            await asyncio.sleep(interval_s)
            await tick(session, datetime.now(timezone.utc))
        except asyncio.CancelledError:
            # Normal shutdown. Re-raised so aiohttp's cleanup completes rather
            # than waiting out its timeout on a task that refuses to die.
            log("scheduler stopped")
            raise
        except Exception as err:  # noqa: BLE001
            swallow("scheduler loop error", err)
