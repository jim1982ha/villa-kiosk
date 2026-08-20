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

from . import aggregate as aggregate_mod, collect, discovery, ledger, verify as verify_mod, schedule as schedule_mod, stats as stats_mod, store
from .analysis import ModuleContext, describe_skips, registered, run_all
from .analysis.series import hourly_by_day, parse_day
from .contracts import severity_rank
from .analysis import modules as _modules  # noqa: F401  (importing registers them)
from .hass import HassClient, HassUnavailable
from .deliver import deliver
from .hass import fetch_timezone
from .log import log, swallow, warn
from .narrate import DeterministicNarrator, ReportContext
from .schedule import period_key, period_start


def _rejected_candidates() -> List[Dict[str, Any]]:
    """What each module measured and then declined to report.

    ⚠️ A THRESHOLD THAT SUPPRESSES EVERYTHING AND A HEALTHY PROPERTY PRODUCE
    THE SAME EMPTY REPORT. Tuning one without seeing the other is guesswork,
    and this subsystem's whole risk is being either too loud or too quiet.
    Diagnostic only: it is attached to a PREVIEW, never to a delivered report,
    and never persisted to history.
    """
    out: List[Dict[str, Any]] = []
    for module in registered():
        for item in getattr(module, "rejected", []) or []:
            out.append({"module": module.name, **item})
    return out


def _statistics_fetcher(session: ClientSession, now_local: datetime,
                        tally: Dict[str, Any]) -> Any:
    """The ONLY way a module gets data.

    ⚠️ MODULES DO NOT GET THE SESSION. A module that can open its own
    websocket can also make its own unbudgeted queries, and the scheduler could
    then no longer bound a pass — one badly written module would stall the
    proxy's event loop, and the kiosk's own API alongside it. Modules ask; the
    pipeline fetches, chunked and with `change` rather than `sum`.

    Hourly, because the idle floor a module looks for is a property of the
    hours within a day — daily buckets average it away entirely.
    """
    async def fetch(ids: Sequence[str], days: int) -> Dict[str, List[Dict[str, Any]]]:
        if not ids:
            return {}
        start = stats_mod.start_of_day(now_local, days)
        try:
            async with HassClient(session) as hass:
                series = await stats_mod.statistics_during_period(
                    hass, list(ids), start, period="hour", types=("change",))
        except HassUnavailable as err:
            warn(f"statistics unavailable for this pass: {err}")
            tally["error"] = str(err)
            series = {}
        # ⚠️ RECORDED, NOT ASSUMED. "The module found nothing" and "the module
        # received nothing" produce an identical report, and telling them apart
        # by reading the code is guesswork. A live preview that returns no
        # findings is uninterpretable without these three numbers.
        tally["requested"] = tally.get("requested", 0) + len(ids)
        tally["returned"] = tally.get("returned", 0) + len(series)
        tally["rows"] = tally.get("rows", 0) + sum(len(v) for v in series.values())
        tally["days_asked"] = days
        tally["empty_ids"] = sorted(i for i in ids if not series.get(i))[:5]
        # ⚠️ THE RAW SHAPE, verbatim. The `start` field's type is the whole
        # reason Phase 3's first live run found nothing, and a tally of counts
        # could not have shown it — 11,859 rows arrived and every one was
        # unusable. Recording one real row makes the next reading confirm the
        # diagnosis instead of assuming the fix is why anything changed.
        for rows in series.values():
            if rows:
                tally["sample_row"] = rows[0]
                break
        return series
    return fetch


#: How far back to look when measuring what the recorder actually holds.
#: Generous, because the answer gates whether a module may run at all and a
#: short probe would under-report a well-established property.
HISTORY_PROBE_DAYS = 120

#: How many statistics to probe. One could be a meter added yesterday, which
#: would report the whole property as having no history; three is enough that
#: the oldest is representative and still one small query.
HISTORY_PROBE_IDS = 3


async def measure_history(fetch: Any, ids: Sequence[str]) -> int:
    """How many days of statistics the recorder actually holds.

    ⚠️ THIS WAS A PLACEHOLDER AND THE PLACEHOLDER WAS A LIE. The gate read
    `min_history_days` — the operator's PREFERENCE — and passed it off as the
    measured depth. That is harmless while every module wants 14 days and the
    default is 14, and it silently breaks the moment one wants more:
    `level_anomaly` needs 28 for a per-weekday baseline, so it would have been
    skipped forever with "needs 28 days of history, has 14" — a sentence that
    was not about the recorder at all. A skip reason that states a number
    nobody measured is worse than no skip reason.

    Takes the LONGEST span among a few statistics, because the shortest would
    be whichever meter was added most recently.
    """
    if not ids:
        return 0
    series = await fetch(list(ids)[:HISTORY_PROBE_IDS], HISTORY_PROBE_DAYS)
    longest = 0
    for rows in series.values():
        if isinstance(rows, list) and rows:
            days = sorted(hourly_by_day(rows))
            if days:
                span = _span_days(days[0], days[-1])
                longest = max(longest, span)
    return longest


def _span_days(first: str, last: str) -> int:
    """How many days the window COVERS — inclusive, hence the +1.

    The `+1` and the 0-on-failure are this caller's, not the parser's; see
    `series.parse_day`, which owns the day-key format for everyone.
    """
    a = parse_day(first)
    b = parse_day(last)
    if a is None or b is None:
        return 0
    return (b - a).days + 1


async def analyse(
    session: ClientSession,
    found: Dict[str, Any],
    audience: str,
    cadence: str,
    now_local: datetime,
    settings: Dict[str, Any],
    min_history_days: int,
    failures: Dict[str, int],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]], Dict[str, int],
           List[str], Dict[str, Any]]:
    """Run every registered module against this pass's data.

    Never raises — `run_all` bounds and wraps each module individually, so a
    module that throws produces a skip line rather than an empty report.
    """
    tally: Dict[str, Any] = {}
    if not found.get("reachable", False):
        # Nothing to analyse, and saying "no checks ran" is honest. Inventing a
        # skip per module would imply each was considered and declined.
        return [], [], failures, [], tally

    context = ModuleContext(
        audience=audience, cadence=cadence, now_local=now_local,
        capabilities=list(found.get("capabilities") or []),
        inventory=found.get("inventory") or {},
        settings=settings, min_history_days=min_history_days,
        stats=_statistics_fetcher(session, now_local, tally),
        labels={},
    )
    # History depth is not yet measured per statistic; the recorder's presence
    # is the proxy for it, and each module applies its own `min_days` to the
    # data it actually receives. Stated here rather than passed as a lie.
    # ⚠️ MEASURED, not assumed — see `measure_history`.
    energy = (found.get("inventory") or {}).get("energy") or {}
    device_ids = [str(i) for i in (energy.get("devices") or []) if isinstance(i, str)]
    history_days = await measure_history(context.stats, device_ids)
    tally["history_days"] = history_days

    produced, skipped, counts, ran = await run_all(context, failures, history_days)
    return ([f.as_dict() for f in produced], describe_skips(skipped), counts,
            ran, tally)


async def run_report(
    session: ClientSession,
    audience: str,
    cadence: str,
    targets: Sequence[str],
    now_local: datetime,
    found: Optional[Dict[str, Any]] = None,
    entry_id: Optional[str] = None,
    settings: Optional[Dict[str, Any]] = None,
    min_history_days: int = 14,
    module_failures: Optional[Dict[str, int]] = None,
    preview: bool = False,
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
    settings = settings or {}
    module_failures = module_failures or {}

    # ── collect ─────────────────────────────────────────────────────────────
    if found is None:
        found = await discovery.discover(session, generated_at)

    # ── analyse ─────────────────────────────────────────────────────────────
    findings, skipped, failures, ran, data_tally = await analyse(
        session, found, audience, cadence, now_local, settings,
        min_history_days, module_failures)

    # ── synthesise ──────────────────────────────────────────────────────────
    # ⚠️ SCOPED TO THE PERIOD, NOT THE WHOLE BUFFER. The ring holds up to
    # MAX_EVENTS across months; a weekly report assembled from all of it would
    # restate every finding the owner has already read, and its savings total
    # would grow forever.
    since = period_start(cadence, now_local).isoformat(timespec="seconds")
    try:
        aggregated = aggregate_mod.aggregate(collect.events_since(since))
    except Exception as err:  # noqa: BLE001 - a report must still go out
        swallow("aggregation failed; reporting without it", err)
        aggregated = {}

    # ── reconcile ───────────────────────────────────────────────────────────
    # ⚠️ THE SAME TASK ARRIVES BY TWO ROUTES. A blueprint fires its event AND
    # calls `todo.add_item` in one action, so a job raised inside the window is
    # in both places. Reading the list is still worth it for what the buffer
    # CANNOT know: a task raised before the collector existed is still open.
    #
    # Its own failure is non-fatal by design — a report that cannot reach the
    # todo list is thinner, not absent.
    carried: List[Dict[str, str]] = []
    verified: List[Any] = []
    try:
        async with HassClient(session) as hass:
            lists = await ledger.todo_lists(hass)
            todo = await ledger.todo_tasks(hass, lists)
            done = await ledger.todo_tasks(hass, lists, status="completed")
        carried = ledger.reconcile(todo, aggregated.get("tasks") or [])

        # ── verify ──────────────────────────────────────────────────────────
        # ⚠️ THE PRIOR WINDOW IS THE REST OF THE RING, NOT ANOTHER PERIOD. A
        # problem reported two months ago and fixed last week is still a
        # verification; bounding this to "the previous period" would only find
        # repairs that happened to land in one cadence.
        #
        # ⚠️ AND THE COLLECTOR MUST HAVE BEEN UP FOR THE WHOLE WINDOW. "It has
        # not recurred" is a claim about the villa only if something was
        # listening; otherwise it is a claim about the listener. See verify.py.
        # ⚠️ BOTH SIDES NORMALISED TO UTC, AND SKIPPING THAT IS 2.528.0 AGAIN.
        # `Item.when` is a MIXED-OFFSET field — a blueprint's own local
        # `now().isoformat()` where it supplied a timestamp, the collector's UTC
        # stamp where it did not — and `since` is the villa's LOCAL midnight.
        # Compared as raw strings, an event four hours into the window reads as
        # prior, and `verify` would then claim a critical alert "has not
        # recurred" in the very period it recurred in. The legacy events on the
        # reference deployment take exactly the fallback path that triggers it.
        cutoff = collect.as_utc_iso(since)
        everything = aggregate_mod.normalise_all(collect.events_since(""))
        prior: List[Any] = []
        inside: List[Any] = []
        for item in everything:
            moment = collect.as_utc_iso(item.when) if item.when else ""
            (prior if moment and moment < cutoff else inside).append(item)
        coverage = collect.coverage(since)
        verified = verify_mod.verify(
            prior, inside, done, ledger.read(),
            listening_throughout=bool(coverage.get("complete")))
    except Exception as err:  # noqa: BLE001 - a report must still go out
        swallow("could not read the caretaker list", err)

    # ── narrate ─────────────────────────────────────────────────────────────
    context = ReportContext(
        audience=audience, cadence=cadence, period=period,
        generated_at=generated_at, discovery=found,
        findings=findings + [f.as_dict() for f in verified],
        skipped=skipped, ran=ran,
        aggregated=aggregated, collector=collect.state(),
        carried_tasks=carried,
    )
    narrator = DeterministicNarrator()
    try:
        title, body = narrator.render(context)
    except Exception as err:  # noqa: BLE001 - a narrator must never stop a report
        swallow("narration failed; delivering a minimal report", err)
        title = f"{cadence.title()} report — {period}"
        body = "The report could not be composed. See the add-on log."

    # ── deliver ─────────────────────────────────────────────────────────────
    # ⚠️ A PREVIEW COMPOSES EVERYTHING AND SENDS NOTHING. An operator deciding
    # whether to switch reports on needs to read one first, and "enable it and
    # see what arrives" is a poor way to find out that a module is noisy — the
    # finding out happens on someone's phone.
    deliveries = ([] if preview
                  else await deliver(session, targets, title, body))

    # ── record ──────────────────────────────────────────────────────────────
    # The report's own severity is the loudest thing in it — a finding or a
    # preflight item. Preflight alone would rank a stale config above a
    # freezer that is failing.
    severity = "info"
    for item in list(found.get("preflight") or []) + findings:
        if isinstance(item, dict):
            candidate = str(item.get("severity", "info"))
            if severity_rank(candidate) > severity_rank(severity):
                severity = candidate

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
    entry["moduleFailures"] = failures
    # ⚠️ UNDERSCORE-PREFIXED KEYS ARE NOT PERSISTED — `append_history` strips
    # them. The prose and the full findings are what a caller wants to READ,
    # and the history ring is capped by ENTRY COUNT, so an entry whose size
    # depends on how much a narrator wrote would make that cap meaningless.
    entry["_title"] = title
    entry["_body"] = body
    entry["_findings"] = findings
    entry["_preview"] = preview
    # ⚠️ The instrument for "found nothing" vs "saw nothing".
    entry["_analysis"] = {"ran": ran, "skipped": skipped, "data": data_tally,
                          "rejected": _rejected_candidates(),
                          "collector": collect.state(),
                          # ⚠️ The synthesis layer's own instrument. Without it,
                          # an empty section cannot be told from an aggregation
                          # that raised and was swallowed two lines above.
                          "aggregated": aggregate_mod.summary(aggregated),
                          "period_since": since}
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
        entries.append({k: v for k, v in entry.items() if not k.startswith("_")})
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
            modules_cfg = config.get("modules")
            record = await run_report(
                session, audience_of(entry), str(entry.get("cadence")),
                targets, now_local, found, entry_id=str(entry["key"]),
                settings=modules_cfg if isinstance(modules_cfg, dict) else {},
                min_history_days=int(config.get("min_history_days") or 14),
                module_failures=(state.get("moduleFailures")
                                 if isinstance(state.get("moduleFailures"), dict)
                                 else {}))
            # ⚠️ Persisted so "three consecutive failures" survives a restart.
            # Counted in memory only, a module that fails on every boot would
            # never reach three and would be retried forever.
            state = {**state, "moduleFailures": record.get("moduleFailures", {})}
            append_history(record)
            delivered += 1

            # ⚠️ RECORDED AFTER THE ATTEMPT, NOT AFTER SUCCESS. A target that
            # refuses must not cause the whole report to be re-sent to every
            # OTHER target on the next tick — the ones that succeeded would get
            # it twice. Per-target status is in the history entry; a genuine
            # resend is an operator action, not an automatic retry.
            sent_keys = list(sent_keys) + [str(entry["key"])]
            state = {**state, "sent": schedule_mod.prune_keys(sent_keys)}
            store.write_json(store.REPORTS_STATE_FILE, state)

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
