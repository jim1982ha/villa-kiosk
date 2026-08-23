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
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple

from aiohttp import ClientSession

from . import (aggregate as aggregate_mod, collect, devices as devices_mod,
               discovery, ledger, links as links_mod, model as model_mod,
               noise as noise_mod,
               schedule as schedule_mod, standing as standing_mod,
               stats as stats_mod, store, trend as trend_mod,
               verify as verify_mod)
from .analysis import ModuleContext, describe_skips, registered, run_all
from .analysis.series import hourly_by_day, parse_day
from .contracts import PAYLOAD_ALLOWED_FIELDS, severity_rank
from .analysis import modules as _modules  # noqa: F401  (importing registers them)
from .hass import HassClient, HassUnavailable
from .deliver import deliver
from .hass import fetch_timezone
from .log import log, swallow, warn
from .narrate import DeterministicNarrator, ReportContext
from .narrate import payload as payload_mod, providers as providers_mod
from .narrate import style as style_mod
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


def _blueprint_subjects(aggregated: Dict[str, Any]) -> Set[str]:
    """Every piece of equipment the automation layer reported on this period.

    Hashed — see `analysis.base.subject_key`. Tolerant of both shapes the
    aggregation arrives in, because a stored history entry hands back plain
    dicts where a live pass hands back `Group` objects, and a reader that works
    for one and raises on the other is this renderer's oldest trap.
    """
    subjects: Set[str] = set()
    for group in aggregated.get("groups") or []:
        keys = getattr(group, "subject_keys", None)
        if keys:
            subjects |= set(keys)
    return subjects


def _without_blueprint_subjects(
        findings: List[Dict[str, Any]],
        subjects: Set[str]) -> Tuple[List[Dict[str, Any]], int]:
    """Drop built-in findings about equipment a blueprint already reported.

    ⚠️ THIS IS WHAT MAKES BOTH LAYERS SAFE TO RUN AT ONCE, and it is per DEVICE,
    not per property. The old arrangement switched a whole check off because a
    covering blueprint existed anywhere; a property could therefore have a rule
    watching four pumps, a fifth pump watched by nobody, and no way to hear
    about the fifth. Now the check runs, and yields on exactly the four.

    ⚠️ THE BLUEPRINT WINS, ALWAYS, and not because it fired first: it sees
    occupancy, schedules and tariffs that a statistical module cannot, which is
    the same reason the stand-down was introduced. Preferring the richer witness
    is the whole content of this function.

    ⚠️ A FINDING WITH NO SUBJECT IS NEVER DROPPED. `subject_key` defaults to ""
    and a bare `in` test on an empty string would match nothing — but a future
    finding that forgets to set one must not silently become undroppable OR
    silently dropped, so the empty case is stated rather than left to fall
    through the comparison.
    """
    if not subjects:
        return findings, 0
    kept: List[Dict[str, Any]] = []
    dropped = 0
    for finding in findings:
        key = str(finding.get("subject_key") or "")
        if key and key in subjects:
            dropped += 1
            continue
        kept.append(finding)
    return kept, dropped


def _entity_labels(states: Any) -> Dict[str, str]:
    """entity_id -> what a person calls it, for every entity the villa has.

    ⚠️ THE OWNER'S LABEL FIRST, THE FRIENDLY NAME SECOND, and that ordering is
    the whole value: an entity_id is often the one name in which the point is
    invisible. `automation.outdoor_unified_doorbell_call_and_unlock` displays as
    `critical_doorbell---parking_gate` — the id is a stale slug from before it
    was renamed, so a brief naming the id would answer "which critical
    automation?" with the string containing no evidence that it is one.

    ⚠️ THE WHOLE STATE DUMP IS ALREADY IN HAND. `_standing_rows` fetches it on
    the connection this shares, so this costs a dict comprehension, not a call.
    """
    if not isinstance(states, list):
        return {}
    config = devices_mod.read_config()
    entity_map = config.get("entityMap") or {}
    if not isinstance(entity_map, dict):
        entity_map = {}
    entities = {str(e.get("entity_id") or ""): e for e in states
                if isinstance(e, dict) and e.get("entity_id")}
    return {entity_id: devices_mod.label_for(entity_id, entity_map, entities)
            for entity_id in entities}


def _entity_units(states: Any) -> Dict[str, str]:
    """entity_id -> `unit_of_measurement`, for every entity that declares one.

    ⚠️ FROM THE SAME STATE DUMP `_entity_labels` READS. A blueprint reports the
    NUMBER it measured and the report has to say what it is a number OF; only
    the sensor knows. Costs a dict comprehension over data already in hand.
    """
    if not isinstance(states, list):
        return {}
    out: Dict[str, str] = {}
    for entity in states:
        if not isinstance(entity, dict):
            continue
        attributes = entity.get("attributes")
        unit = (attributes or {}).get("unit_of_measurement") \
            if isinstance(attributes, dict) else None
        if unit and entity.get("entity_id"):
            out[str(entity["entity_id"])] = str(unit)
    return out


def _standing_rows(states: Any) -> List[Dict[str, Any]]:
    """Live HA states -> the same list the kiosk's Cockpit is showing.

    ⚠️ THE SUBJECT IS DROPPED HERE, AT THE CROSSING. `standing.Item.subject`
    carries an entity id — it is what P3 will deduplicate against the blueprint
    layer on, and it is server-side only. Filtering it later would work and is
    the weaker guarantee; this subsystem's rule is that "the data is not there"
    beats "the filter is careful", which is the same reason `dedup_key` hashes
    its subject and `Finding` has no entity field at all.

    ⚠️ THE MESH NAMES COME FROM THE GLB, not from a browser. See `model.py`:
    publishing the kiosk's derived list would make a briefing depend on somebody
    having opened the tablet, which fails precisely on the villa nobody visits.
    """
    if not isinstance(states, list):
        return []
    entities = {str(e.get("entity_id") or ""): e for e in states
                if isinstance(e, dict) and e.get("entity_id")}
    config = devices_mod.read_config()
    items = standing_mod.build(
        entities, config, ledger.read(), model_mod.mesh_entity_ids())
    return [{"kind": i.kind, "title": i.title, "detail": i.detail, "room": i.room}
            for i in items]


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
        # ⚠️ FROM THE COLLECTOR, NOT FROM DISCOVERY. Discovery answers "does
        # this property HAVE a detection layer"; only the event buffer knows
        # which parts of it have ever spoken, and that is the difference
        # between "covered" and "covered on paper" — see `registry.gate`.
        silent_blueprints=list(collect.state().get("silent_blueprints") or []),
        heard_nothing_for_days=collect.listening_days(),
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


def _withheld_fields(context: ReportContext,
                     outbound: Dict[str, Any]) -> List[str]:
    """Field names present on the findings that did NOT travel. Names only.

    ⚠️ THE MORE CONVINCING HALF OF THE INSPECTOR. A list of PERMITTED names
    tells a reader what the allow-list says; a list of names it actually
    dropped on this property's own data tells them what the allow-list DID.
    Seeing `detail` and `entity_id` named as withheld is the difference between
    reading a policy and watching it apply.

    ⚠️ NAMES, NEVER VALUES — printing the values would mean leaking them into a
    panel whose entire purpose is to show they are not leaked.

    ⚠️ AND IT MEANS "THE POLICY DROPPED IT", NOT "IT WAS EMPTY". The first cut
    compared source keys against EMITTED keys, so any allow-listed field that
    happened to be blank on this property's findings was reported as withheld.
    A live QA run printed `withheld: area, baseline, dedup_key, delta,
    horizon_days, window_days` — and five of those six ARE permitted; they were
    simply empty on blueprint-derived findings. Only `detail` and `dedup_key`
    were actually being kept back.

    That is a FALSE PRIVACY CLAIM in the one panel whose entire job is to be
    believed, and it errs in the direction that flatters us — telling an owner
    we protect more than we do. Comparing against the ALLOW-LIST answers the
    question that was asked: which of this property's fields may never travel.
    """
    source: Set[str] = set()
    for finding in context.findings or []:
        if isinstance(finding, dict):
            source |= set(finding)
    aggregated = context.aggregated or {}
    for item in aggregated.get("findings") or []:
        as_dict = getattr(item, "as_dict", None)
        if callable(as_dict):
            source |= set(as_dict())

    del outbound  # ⚠️ deliberately unread — see the docstring.
    return sorted(source - set(PAYLOAD_ALLOWED_FIELDS))


def _ingress_entry() -> str:
    """This add-on's own ingress path, as the Supervisor reports it.

    ⚠️ FROM THE ENVIRONMENT, NOT GUESSED FROM THE SLUG. The entry contains a
    per-installation token segment, so it cannot be derived — and a guessed path
    would produce a link that 404s, which is worse than no link because the
    reader concludes the kiosk is broken. Absent means no link, per `links`'
    fail-closed rule.
    """
    return os.environ.get("VK_INGRESS_ENTRY", "")


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
    narration: Optional[Dict[str, Any]] = None,
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
        # ⚠️ THE SAME ROOM MAP THE KIOSK RENDERS FROM (`resolvedRooms` in
        # the shared device-config store), so the brief and the tablet
        # cannot place one device in two rooms. Absent on an unconfigured
        # install, which `by_room` handles rather than failing over.
        rooms = devices_mod.read_config().get("resolvedRooms")
        aggregated = aggregate_mod.aggregate(
            collect.events_since(since),
            rooms if isinstance(rooms, dict) else None)
    except Exception as err:  # noqa: BLE001 - a report must still go out
        swallow("aggregation failed; reporting without it", err)
        aggregated = {}

    # ── deduplicate ─────────────────────────────────────────────────────────
    # ⚠️ THE BUILT-IN CHECKS AND THE BLUEPRINTS NOW BOTH RUN, so the report is
    # what keeps them from saying the same thing twice — by SUBJECT, per device.
    # Until 2.572.0 the arrangement was cruder: any covering blueprint being
    # INSTALLED switched a whole check off, which is why a property that had
    # imported the pack and built no automations detected nothing at all, and
    # why a rule watching four of five pumps left the fifth unreported by anyone.
    #
    # ⚠️ COUNTED, NOT SILENT. `suppressed` is the number of findings this
    # property's own automations already covered; a zero here on a villa with a
    # busy blueprint layer means the join is not matching, and a count nobody
    # records is the four-instruments-reading-zero problem again.
    findings, suppressed = _without_blueprint_subjects(
        findings, _blueprint_subjects(aggregated))
    if suppressed:
        log(f"{suppressed} finding(s) already covered by the automation layer")

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
    standing: List[Dict[str, Any]] = []
    labels: Dict[str, str] = {}
    units: Dict[str, str] = {}
    try:
        async with HassClient(session) as hass:
            lists = await ledger.todo_lists(hass)
            todo = await ledger.todo_tasks(hass, lists)
            done = await ledger.todo_tasks(hass, lists, status="completed")
            # ── standing state ──────────────────────────────────────────────
            # ⚠️ LIVE STATE, ON THE CONNECTION THAT IS ALREADY OPEN. The brief
            # could not previously see a single thing the kiosk calls "needs
            # attention" — no entity states, and `ledger.read()` reached
            # `verify` and never the renderer. An owner compared the two screens
            # and found a brief that mentioned none of the four devices the
            # Cockpit was listing. See `standing.py`.
            #
            # ⚠️ NON-FATAL, LIKE THE TODO READ ABOVE AND FOR THE SAME REASON: a
            # brief that cannot reach Home Assistant is thinner, never absent.
            # It shares this `try` deliberately — a failure here must not cost
            # the caretaker reconciliation either, and both are the same kind
            # of "the villa was unreachable" outcome.
            states = await hass.command("get_states")
            standing = _standing_rows(states)
            labels = _entity_labels(states)
            units = _entity_units(states)
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

    # ── noise ───────────────────────────────────────────────────────────────
    # ⚠️ ITS OWN WINDOW, NOT THE REPORT'S. The catalog's rule is "N fires a
    # MONTH", and a daily brief must not answer it from one day's events — that
    # would under-count by 30x and quietly report every noisy rule as fine. So
    # this reaches back `noise_window_days` regardless of cadence, which is also
    # why it is computed here rather than from `inside`.
    #
    # ⚠️ AND IT ASKS WHETHER THE BUFFER REACHES THAT FAR. `collect.MAX_EVENTS`
    # bounds the ring, so on a busy property the oldest retained event can be
    # newer than the window start — at which point every count is a FLOOR and
    # comparing a floor against a threshold reports "not noisy" for the rules
    # that are noisiest. `covered=False` makes the brief say it cannot tell.
    noise_summary: Dict[str, Any] = {}
    try:
        settings_now = settings or {}
        window_days = int(settings_now.get("noise_window_days")
                          or noise_mod.DEFAULT_WINDOW_DAYS)
        threshold = int(settings_now.get("noise_threshold_fires")
                        or noise_mod.DEFAULT_THRESHOLD)
        start = collect.as_utc_iso(
            (now_local - timedelta(days=window_days)).isoformat())
        buffered = aggregate_mod.normalise_all(collect.events_since(""))
        stamps = [collect.as_utc_iso(i.when) for i in buffered if i.when]
        in_window = [i for i in buffered
                     if i.when and collect.as_utc_iso(i.when) >= start]
        # The ring reaches back far enough iff its OLDEST event predates the
        # window — or it is not full, in which case nothing has been evicted.
        covered = (len(buffered) < collect.MAX_EVENTS
                   or bool(stamps) and min(stamps) <= start)
        noise_summary = noise_mod.summarise(
            in_window, done, threshold, window_days, covered)
    except Exception as err:  # noqa: BLE001 - never costs the report
        swallow("could not assess alert noise", err)

    # ── narrate ─────────────────────────────────────────────────────────────
    context = ReportContext(
        audience=audience, cadence=cadence, period=period,
        generated_at=generated_at, discovery=found,
        findings=findings + [f.as_dict() for f in verified],
        skipped=skipped, ran=ran,
        aggregated=aggregated, collector=collect.state(),
        carried_tasks=carried, standing=standing, labels=labels, units=units,
        noise=noise_summary,
        history=_history_series(cadence),
        currency=str(found.get("currency") or ""),
    )
    narrator = DeterministicNarrator()
    try:
        title, body = narrator.render(context)
    except Exception as err:  # noqa: BLE001 - a narrator must never stop a report
        swallow("narration failed; delivering a minimal report", err)
        title = f"{cadence.title()} report — {period}"
        body = "The report could not be composed. See the add-on log."

    # ── narrate again, optionally, through a provider ───────────────────────
    # ⚠️ AN OVERLAY, NOT A BRANCH, AND THAT IS THE WHOLE DESIGN OF PHASE 6. The
    # deterministic body already exists on the line above and is already good
    # enough to deliver; a provider can only REPLACE it. So "degrade to the
    # built-in renderer on any failure" is not a code path that has to be
    # written correctly and tested against every failure mode — it is what
    # happens when this block does nothing, which is what it does on absence, a
    # missing key, an open breaker, a spent budget, a timeout, an unusable
    # answer and an exception alike. There is no arm of this that can end with
    # no report.
    #
    # ⚠️ WHICH IS ALSO WHY THE DETERMINISTIC RENDER IS NOT SKIPPED when a
    # provider is configured. Composing it is local, fast and free. The
    # alternative — render only if the provider declines — makes the offline
    # villa's report depend on control flow that runs only when a third party
    # is unreachable, i.e. it puts the case that matters most on the path with
    # the least coverage. See CLAUDE.md's second hard rule.
    narration_mode = narrator.name
    narration_why = ""
    provider = providers_mod.shared(narration or {})
    if provider is not None:
        prose, narration_why = await provider.narrate(
            session, payload_mod.from_context(context))
        # ⚠️ A SLOT, NOT THE BODY. The provider now writes the LEAD SENTENCE and
        # the renderer keeps everything else — zones, charts, columns, figures.
        # So the re-render below cannot lose structure however poor the answer
        # is, and the worst case costs one sentence rather than the brief.
        #
        # ⚠️ REJECTED IF IT IS NOT ONE SENTENCE. A model asked for a line
        # sometimes returns a paragraph, and pasting a paragraph where a lead
        # belongs would push the dateline out of the notification preview — the
        # exact thing the slot exists to protect. Cheap to check, and the
        # fallback is the deterministic sentence that was already there.
        lead = usable_lead(prose)
        # ⚠️ "DID IT ANSWER" IS THE FLATTENED TEXT, NOT THE OBJECT. `"   \n  "`
        # is truthy and pure markup flattens to nothing — the same trap the
        # narration layer already records — so a bare `bool(prose)` here would
        # blame the provider's PHRASING for what was actually an empty answer.
        answered = bool(str(prose or "").strip())
        if lead:
            context.slots = {"lead": lead}
            title, body = narrator.render(context)
            narration_mode = provider.name
        elif answered:
            # ⚠️ REACHABLE SINCE 2.608.0. This arm read `elif lead:` under an
            # `if lead:`, so it could never run and the reason it exists to
            # record was unreachable: a provider that answered with a PARAGRAPH
            # was reported with whatever `narration_why` the adapter happened to
            # leave behind, which is the one cause this branch can name exactly.
            narration_why = "the answer was not a single short sentence"
            log(f"not narrated by a provider: {narration_why}")
        else:
            # ⚠️ A REASON, RECORDED. "This week's brief reads differently" is
            # otherwise unanswerable — and the five causes call for different
            # actions (configure a key, wait, raise a limit, or nothing).
            log(f"not narrated by a provider: {narration_why}")

    # ── make it inert ───────────────────────────────────────────────────────
    # ⚠️ AFTER BOTH NARRATORS AND BEFORE EVERYTHING ELSE, so the deterministic
    # body, a provider's prose and the history entry are the same string that
    # was sent. A platform configured with `parse_mode: markdown` reads an
    # underscore in a device name as an unclosed italic and rejects the whole
    # message with an HTTP 500 — see `style.inert`, which this exists to call at
    # the one point every path has already converged on.
    title, body = style_mod.inert(title), style_mod.inert(body)

    # ⚠️ APPENDED AFTER `inert`, NOT EXEMPTED FROM IT. An ingress path contains
    # `hassio_ingress`, and `inert` strips underscores from the whole message —
    # so a link written into the body arrives dead. Teaching `inert` to skip
    # URLs would turn "remove every markup-active character" into "…unless the
    # surrounding text looks like a URL", with the villa's own device names
    # inside that text. Instead: sanitise everything the villa can influence,
    # then add a line this add-on generated from Home Assistant's own config.
    # See `links.py`, which refuses to produce anything unless it is safe.
    link = links_mod.footer((found.get("inventory") or {}).get("urls"),
                            _ingress_entry())
    if link:
        body = f"{body}\n\n{link}"

    # ── deliver ─────────────────────────────────────────────────────────────
    # ⚠️ A PREVIEW COMPOSES EVERYTHING AND SENDS NOTHING. An operator deciding
    # whether to switch reports on needs to read one first, and "enable it and
    # see what arrives" is a poor way to find out that a module is noisy — the
    # finding out happens on someone's phone.
    deliveries = ([] if preview
                  else await deliver(session, targets, title, body,
                                     (found.get("inventory") or {})
                                     .get("notify_targets") or []))

    # ── record ──────────────────────────────────────────────────────────────
    # The report's own severity is the loudest thing in it — a finding or a
    # preflight item. Preflight alone would rank a stale config above a
    # freezer that is failing.
    # ⚠️ THE BLUEPRINT LAYER COUNTS, AND IT DID NOT. This walked preflight and
    # MODULE findings only — the two things that produce almost nothing on a
    # property whose own automations do the detecting. A live QA run recorded
    # `findings=0 severity=notice` for a brief that opened "1 critical alert
    # from this period is still unresolved" and listed twelve groups: the
    # history said a quiet week about the week it described. Since the whole
    # subsystem was rebuilt around the blueprint layer being the primary
    # detector, omitting it made the audit trail wrong in the common case.
    grouped = [g for g in (aggregated.get("groups") or [])]
    severity = "info"
    for candidate in ([str(i.get("severity", "info")) for i in
                       list(found.get("preflight") or []) + findings
                       if isinstance(i, dict)]
                      + [str(getattr(g, "severity", "info")) for g in grouped]):
        if severity_rank(candidate) > severity_rank(severity):
            severity = candidate

    entry: Dict[str, Any] = {
        "id": entry_id or f"manual:{period}:{now_local.strftime('%H%M%S')}",
        "at": generated_at,
        "audience": audience,
        "cadence": cadence,
        # ⚠️ WHAT ACTUALLY WROTE THIS ONE, not what was configured. `contracts`
        # already says why the field exists: "the summaries changed tone last
        # Tuesday" is otherwise unanswerable. A provider that was configured and
        # then declined must record `deterministic`, or the history claims prose
        # nobody wrote — and since declining is the COMMON case here (no key, no
        # WAN, budget spent), a field set from the config would be wrong more
        # often than right.
        "narration": narration_mode,
        # What the brief actually reports: this add-on's own checks, the
        # verifications, and the blueprint layer's grouped findings.
        "findingCount": len(findings) + len(grouped),
        # ⚠️ THE FINDINGS THEMSELVES, WHICH `store.py` HAS CLAIMED WERE HERE
        # SINCE IT WAS WRITTEN — "a report entry is metadata plus findings, not
        # the rendered prose, so entries are small". Only the COUNT was ever
        # stored, and the consequence surfaced two subsystems away: the shadow
        # diff's rules column reads this key, so `TASK-051`'s document reported
        # "the rules found 0" on a villa whose brief listed eight of them. The
        # row that DECIDES the cutover was structurally always empty.
        #
        # ⚠️ THREE FIELDS, NOT THE WHOLE FINDING. `subject_key` is what the diff
        # joins on, the title is what a person reads, and the severity is what
        # sorts them; `detail`, baselines and observed values are prose and
        # numbers a stored ring does not need, and including them is how the
        # 200-entry bound stops being small. This keeps the claim in store.py
        # true without making it expensive.
        "findings": ([{"subject_key": str(f.get("subject_key") or ""),
                       "title": str(f.get("label") or ""),
                       "severity": str(f.get("severity") or "")}
                      for f in findings if isinstance(f, dict)]
                     # ⚠️ `label`, NOT `title` — a Group has no `title` and
                     # `getattr(g, "title", "")` returned "" for every one of
                     # them, so `shadow._subjects` fell back to its key and the
                     # cutover page listed ten SHA-256 prefixes. A reader cannot
                     # decide anything from `29d2dd0f3a69762c`. Both sides of
                     # this expression now read the field the dataclass has.
                     + [{"subject_key": key,
                         "title": str(getattr(g, "label", "") or ""),
                         "severity": str(getattr(g, "severity", "") or "")}
                        for g in grouped
                        for key in sorted(getattr(g, "subject_keys", set)()
                                          if callable(getattr(g, "subject_keys", None))
                                          else getattr(g, "subject_keys", []) or [])]),
        # ⚠️ STORED SO THE NEXT REPORT CAN COMPARE. Without it "74 IDR" is a
        # number the reader cannot judge — the owner's own diagnosis of the
        # brief — and no wording fixes that, because the comparison was never
        # computed. `findingCount` was already here and gave findings a trend
        # for free; money needed this one field.
        # ⚠️ THE RAW TOTAL, NOT THE ROUNDED ONE. The headline rounds so a reader
        # can add the column up (v2.586.0); a stored series must not, or seven
        # periods of rounding drift accumulate into the baseline the next brief
        # is judged against.
        "avoidableCost": float(
            (aggregated.get("savings") or {}).get("total") or 0.0),
        "currency": str(found.get("currency") or ""),
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
    if preview:
        # ⚠️ THE PAYLOAD IS SHOWN, NOT DESCRIBED, AND IT IS THE REAL ONE.
        # "Only numbers leave the villa" is a promise, and a promise about
        # privacy that the operator has to take on trust is worth very little —
        # particularly on a redistributable add-on whose reader cannot audit
        # the source. So a preview carries the ACTUAL output of
        # `payload.from_context`: the same function, on the same context, that
        # a real narration would transmit. Not a mirror of it, not a mock-up
        # from a second list kept by hand in the SPA — that would be a privacy
        # claim verified against the wrong thing, which is worse than no claim.
        #
        # ⚠️ ON A PREVIEW ONLY, and for two independent reasons. It is never
        # persisted (underscore keys are stripped by `append_history`), and a
        # preview is the moment an operator is deciding whether to switch
        # narration on — which is the moment this is worth reading.
        #
        # ⚠️ COMPUTED WHETHER OR NOT A PROVIDER IS CONFIGURED. The question is
        # "what WOULD leave", asked before the answer can matter. Gating it on
        # the feature being enabled would make it unavailable exactly when it
        # is being decided.
        try:
            outbound = payload_mod.from_context(context)
            entry["_payload"] = {
                "body": outbound,
                # ⚠️ THE AUDIT VERDICT TRAVELS WITH IT. `audit()` is what the
                # narrator asks immediately before sending, so showing its
                # result here is showing the same gate, not a second opinion
                # about it. Empty is the pass.
                "problems": payload_mod.audit(outbound),
                # ⚠️ FIELD NAMES, NEVER VALUES. What is WITHHELD is the more
                # convincing half — a reader who sees `detail` and `entity_id`
                # named as dropped has learned something an allow-list of
                # permitted names cannot tell them. Printing the values would
                # be leaking them into a panel to prove they are not leaked.
                "withheld": _withheld_fields(context, outbound),
            }
        except Exception as err:  # noqa: BLE001 - a preview must still render
            swallow("could not build the narration payload for preview", err)

    # ⚠️ The instrument for "found nothing" vs "saw nothing".
    entry["_analysis"] = {"ran": ran, "skipped": skipped, "data": data_tally,
                          "rejected": _rejected_candidates(),
                          "collector": collect.state(),
                          # ⚠️ The synthesis layer's own instrument. Without it,
                          # an empty section cannot be told from an aggregation
                          # that raised and was swallowed two lines above.
                          "aggregated": aggregate_mod.summary(aggregated),
                          "period_since": since,
                          # ⚠️ THE INSTRUMENT FOR "WHY IS THIS NOT NARRATED".
                          # Empty means it was, or that nothing was configured;
                          # `mode` separates those two without a second field.
                          "narration": {"mode": narration_mode,
                                        "declined": narration_why}}
    log(f"report {entry['id']}: {len(findings)} finding(s), "
        f"{sum(1 for d in deliveries if d.get('status') == 'sent')}/"
        f"{len(deliveries)} delivered")
    return entry


#: A notification preview is about two lines. Past this the dateline is pushed
#: out of it, which is what the lead slot exists to protect.
MAX_LEAD_CHARS = 200


def usable_lead(prose: Optional[str]) -> str:
    """A provider's answer if it is one short sentence, else "".

    ⚠️ EXTRACTED SO IT CAN BE TESTED AS BEHAVIOUR. It was three inline
    conditions, and the test asserted the SHAPE of the source ("does it bound
    the length?") — which stayed true when a mutation changed the bound to
    100000. A guard that can only be checked by reading it is a guard nothing
    checks.

    ⚠️ A MODEL ASKED FOR A LINE SOMETIMES RETURNS A PARAGRAPH, or a preamble, or
    the sentence wrapped in quotes. None of those belong where the lead goes,
    and the fallback is the deterministic sentence that is already correct — so
    this refuses rather than repairs.
    """
    raw = str(prose or "")
    if not raw.strip() or "\n" in raw.strip():
        return ""
    lead = " ".join(raw.split())
    return lead if len(lead) <= MAX_LEAD_CHARS else ""


def _history_series(cadence: str) -> Dict[str, List[float]]:
    """Past values this report may compare itself against.

    ⚠️ READ BEFORE THIS REPORT IS APPENDED, which is what makes "previous"
    true — `append_history` runs after delivery. Non-fatal like every other
    read here: no history means no trend line, and a brief without one is
    exactly what every brief was until now.
    """
    try:
        document = store.history_view(
            store.read_json(store.REPORTS_HISTORY_FILE, store.EMPTY_HISTORY))
        entries = list(document.get("entries") or [])
        return {
            field: trend_mod.series_from_history(entries, field, cadence)
            for field in ("avoidableCost", "findingCount")
        }
    except Exception as err:  # noqa: BLE001 - a trend is never worth a report
        swallow("could not read history for trends", err)
        return {}


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


def targets_for(config: Dict[str, Any], schedule: Dict[str, Any],
                agent_config: Optional[Mapping[str, Any]] = None) -> List[str]:
    """Where one schedule's report goes.

    ⚠️ THE PROFILE ANSWERS FIRST, AND THAT ORDERING IS THE WHOLE FEATURE. A
    schedule names a profile (owner / facility manager / guest) and the people
    table says where that profile is reached; the recipient picker that used to
    sit on the schedule row is gone, because choosing a person twice in two
    screens is what the owner reported as redundant. If the schedule's own list
    still won, an install that configured People would go on delivering to the
    stale list it can no longer see — "I set it up and nothing changed", which
    is the failure this whole change exists to remove.

    ⚠️ AND THE TWO LEGACY FALLBACKS SURVIVE UNDERNEATH, IN ORDER. A config
    written before this — a schedule carrying its own `targets`, or a property
    still on the shared `notify_targets` list — keeps delivering exactly where
    it was delivering until somebody configures a person for its profile.
    Nothing is rewritten on read.

    ⚠️ ABSENT MEANS INHERIT; EMPTY MEANS NOWHERE. This is the same distinction
    the whole config layer turns on — `store.py`'s docstring is about it — and
    it was NOT implemented here: `if isinstance(own, list) and own:` treats an
    empty own-list as absent and falls through to the shared list, while the
    docstring above it said "empty means nowhere". A claim nothing verified,
    true of `deliver`'s handling and not of this function.

    Latent until v2.546.0, because nothing could express the difference — the
    dialog had no per-schedule destinations at all. Now that a schedule can be
    given its own list, "I set this one's destinations, then removed them all"
    is a thing an operator can do, and it must not silently resume delivering
    to everyone on the shared list. `deliver` reports the empty result as a
    configuration state rather than an error, which is what makes it visible.

    ⚠️ THE EMPTY LIST NO LONGER OUTRANKS A CONFIGURED PROFILE, because the
    control that could express "this one goes nowhere" no longer exists. It
    still separates the two fallbacks below it, which is where an operator's
    stored `[]` came from and the only place it can still be read.
    """
    from_profile = _profile_targets(schedule, agent_config)
    if from_profile:
        return from_profile
    own = schedule.get("targets")
    if isinstance(own, list):
        return [str(t) for t in own if isinstance(t, str) and t]
    shared = config.get("notify_targets")
    if isinstance(shared, list):
        return [str(t) for t in shared if isinstance(t, str) and t]
    return []


def _profile_targets(schedule: Mapping[str, Any],
                     agent_config: Optional[Mapping[str, Any]]) -> List[str]:
    """The people table's answer for this schedule's profile, or `[]`.

    Separate from `targets_for` so the degrade-on-anything is stated once: a
    people table that cannot be read must leave a briefing going where it was
    already going, never send it nowhere.
    """
    try:
        from reports import people as people_mod
        return people_mod.targets_for_role(agent_config,
                                           str(schedule.get("role") or ""))
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not resolve a schedule's profile targets", err)
        return []


def audience_of(schedule: Dict[str, Any],
                agent_config: Optional[Mapping[str, Any]] = None) -> str:
    """Whose voice this briefing is written in.

    ⚠️ DERIVED FROM THE SCHEDULE'S PROFILE, NOT CHOSEN SEPARATELY. A schedule
    used to carry its own `audience` beside its own delivery target, so one
    person was configured twice — reported as redundant, correctly: saying a
    brief is for the Facility Manager already determines both whose voice it is
    written in and where it goes. `AUDIENCE_OF_ROLE` is the one table.

    ⚠️ IT WAS DERIVED FROM THE TARGET IN 2.651.0 AND THAT WAS THE INVERSE. It
    answered correctly for a destination somebody had claimed and answered
    nothing at all for one nobody had, which put "cannot say" on the path every
    hand-written config takes. A profile is stated on the schedule itself, so
    the question always has an answer.

    ⚠️ AN EXPLICIT `audience` STILL WINS, for existing schedules. Dropping it
    would silently rewrite what every configured briefing sounds like on
    upgrade, and the two voices are opposites — one requires the entity id, the
    other forbids it. A stored choice is a decision somebody made. The dialog
    drops the stored key when the operator changes the profile, so a deliberate
    edit is not outvoted by a value from a previous release.

    ⚠️ AND THE FALLBACK IS THE OWNER VOICE, WHICH IS THE ONE THAT WITHHOLDS
    IDENTIFIERS. It degrades toward saying LESS about the villa rather than
    more.
    """
    audience = schedule.get("audience")
    if audience in ("owner", "facility"):
        return str(audience)
    try:
        from reports import people as people_mod
        role = str(schedule.get("role") or "").strip().lower()
        return people_mod.AUDIENCE_OF_ROLE.get(role, "owner")
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not derive a briefing audience", err)
    return "owner"


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
        # ⚠️ READ ONCE PER TICK, NOT PER SCHEDULE. Every schedule firing in this
        # minute resolves its audience against the same table, and re-reading a
        # JSON file per row would make the answer able to change mid-tick.
        from reports import people as people_mod
        agent_cfg = people_mod.read_config()
        for entry in ready:
            targets = targets_for(config, entry, agent_cfg)
            warn_if_broadcast(targets)
            modules_cfg = config.get("modules")
            record = await run_report(
                session, audience_of(entry, agent_cfg),
                str(entry.get("cadence")),
                targets, now_local, found, entry_id=str(entry["key"]),
                settings=modules_cfg if isinstance(modules_cfg, dict) else {},
                min_history_days=int(config.get("min_history_days") or 14),
                module_failures=(state.get("moduleFailures")
                                 if isinstance(state.get("moduleFailures"), dict)
                                 else {}),
                narration=(config.get("narration")
                           if isinstance(config.get("narration"), dict) else {}))
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
