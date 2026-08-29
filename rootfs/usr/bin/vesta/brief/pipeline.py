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
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple

from aiohttp import ClientSession

# ⚠️ `aggregate`, `noise` and `verify` LEFT THIS LINE WITH THEIR PRODUCERS
# (TASK-071/074, 2026-08-27). They parsed, counted and cross-checked the
# `vesta_*` blueprint events; the last emitter stopped on the same day and a
# parser with no producer is the machinery this phase exists to remove.
from . import standing as standing_mod, trend as trend_mod
from vesta.adapters import stats as stats_mod
from vesta.adapters import collect
from vesta.adapters import devices as devices_mod
from vesta.adapters import discovery
from vesta.adapters import ledger
from vesta.adapters import links as links_mod
from vesta.adapters import model as model_mod
from vesta.adapters import schedule as schedule_mod
from vesta.adapters import store
from vesta.shared.analysis.base import ModuleContext
from .registry import describe_skips, registered, run_all
from vesta.shared.analysis.series import hourly_by_day, parse_day
from vesta.shared.contracts import (NARRATION_FALLBACK, PAYLOAD_ALLOWED_FIELDS,
                        severity_rank)
from vesta.shared.style import severity_line
# ⚠️ THE REGISTRY REGISTERS ITS OWN MODULES since TASK-115 — importing it is
# what populates it. This line used to import `modules` for the side effect.
from . import registry as _registry  # noqa: F401  (importing registers)
from vesta.adapters.hass import HassClient, HassUnavailable
from vesta.adapters.deliver import deliver
from vesta.adapters.hass import fetch_timezone
from vesta.adapters.log import log, swallow, warn
from .narrate import ReportContext
from .narrate import payload as payload_mod, providers as providers_mod
from vesta.shared import style as style_mod
from vesta.adapters.schedule import period_key, period_start


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


#: Where a briefing gets the agent's findings from. ⚠️ A HOOK, NOT AN IMPORT.
#: `reports/` may not import `agent/` — the deterministic layer must not depend
#: on the interpretive one, which is ARCH-003 and is pinned by
#: `test_reports_never_imports_agent`. The first version of this reached into
#: `agent.sources` directly and that test caught it, naming the fix: pass a
#: callback in from the proxy, the same way `Collector.on_event` is wired.
#:
#: ⚠️ THE ROWS ARRIVE READY TO PRINT — title, severity, subject_key, age_days —
#: because computing the age here would mean parsing a timestamp format this
#: package does not own, which is a second pinned rule (`series.parse_day`).
#: Whoever supplies the concerns already knows how old they are.
#:
#: ⚠️ THIS BINDING WAS DELETED BY 2.755.0's SWEEP AND RESTORED 2026-08-27. The
#: `global` writer below kept pyflakes quiet, so only mypy --strict saw it —
#: and every run since had the proxy call the setter at boot, so the NameError
#: waited for the one documented state ("agent off, source unset") that the
#: reader's own docstring promises is not an error. Same class as the `_log`
#: defect test_pyflakes.py pins, one tool further down the ladder.
_CONCERNS_SOURCE: Optional[Any] = None


def set_concerns_source(source: Optional[Any]) -> None:
    """Register where briefings read the agent's findings. Called once, at boot.

    ⚠️ UNSET MEANS NO CONCERNS IN BRIEFINGS, NOT AN ERROR. A deployment running
    reports with the agent switched off is a supported state and the commonest
    one on a fresh install.
    """
    global _CONCERNS_SOURCE
    _CONCERNS_SOURCE = source


#: The degradation ladder, registered the same way and for the same reason.
#: ⚠️ A HOOK, NOT AN IMPORT — `agent/compose.py` is the other side of ARCH-003's
#: one-way street, so the proxy hands it in. Unregistered means the minimal body
#: below, which is what an embedder without the agent package gets.
_FALLBACK_COMPOSER: Optional[Any] = None


#: The NORMAL brief's author, registered the same way (TASK-073). The 2,058-line
#: deterministic renderer was deleted with the blueprint-event taxonomy it
#: formatted; `agent/compose.brief` writes the plain replacement, and it
#: arrives by hook because `reports/` may not import `agent/` (ARCH-003).
_BRIEF_COMPOSER: Optional[Any] = None


def set_brief_composer(composer: Optional[Any]) -> None:
    """Register the brief's author. Called once, at boot.

    ⚠️ UNREGISTERED MEANS THE LADDER WRITES EVERY BRIEF — the same body an
    embedder without the agent package gets — and each one SAYS it is a
    fallback, which is the honest description of a deployment missing its
    writer."""
    global _BRIEF_COMPOSER
    _BRIEF_COMPOSER = composer


def set_fallback_composer(composer: Optional[Any]) -> None:
    """Register the degradation ladder. Called once, at boot.

    ⚠️ THE LADDER EXISTED FROM v2.641.0 TO v2.698.0 WITH NOBODY ON IT (TASK-111).
    `compose.ladder` renders a rung and states which rung it is; REQ-042's
    acceptance was "each rung asserted separately", which is true and is not the
    same as any rung ever being USED. RISK-015 is "a component fails silently
    and the villa looks quiet", and this ladder is its control — so the control
    was asserted and not installed.
    """
    global _FALLBACK_COMPOSER
    _FALLBACK_COMPOSER = composer


def _salient_rows(context: ReportContext) -> List[Dict[str, str]]:
    """What the observation floor saw, as rung 2 wants it: a label and a reason.

    ⚠️ NO ENTITY IDS, THOUGH `from_salient` WOULD ACCEPT ONE. A briefing prints
    what a person calls a device and leaves the id in the villa — the same rule
    `_standing_rows` obeys by dropping `Item.subject` at the crossing rather
    than filtering it later.
    """
    rows: List[Dict[str, str]] = []
    for source, label_key, reason_key in ((context.findings, "label", "detail"),
                                          (context.standing, "title", "detail")):
        for row in source:
            if not isinstance(row, Mapping):
                continue
            label = str(row.get(label_key) or "").strip()
            if label:
                rows.append({"label": label,
                             "reason": str(row.get(reason_key) or "").strip()})
    return rows


def _coverage_note(since: str) -> str:
    """One sentence when the listener missed part of the period, else "".

    ⚠️ THE DISTINCTION TASK-074 KEEPS EXACTLY: a week with no findings and a
    week with no listener must never render the same. `coverage()` computes it;
    this only words it."""
    try:
        cov = collect.coverage(since)
        if not cov.get("complete"):
            return ("The add-on was not listening for the whole of this "
                    "period, so a quiet section may mean a deaf listener "
                    "rather than a quiet villa.")
    except Exception as err:  # noqa: BLE001 - a note must not cost the brief
        swallow("could not compute the coverage note", err)
    return ""


def _degrade(context: ReportContext, title: str, err: Exception) -> Tuple[str, str]:
    """Descend the ladder because the renderer could not compose. Returns
    (body, rung), and `rung` is "" when no ladder is registered.

    ⚠️ THE CONTEXT IS FULL AND ONLY THE WRITER FAILED, which is exactly what the
    ladder is for: the concerns, the findings and the standing state were all
    gathered before this point, and the one-line body this replaced threw every
    one of them away. A reader got "the report could not be composed" about a
    period in which eight things were wrong.

    ⚠️ IT NEVER RAISES, because it stands between the villa and silence. The
    ladder makes the same promise; this arm covers the case where the hook
    itself is something other than the ladder.
    """
    # ⚠️ Named `ladder` since the 2026-08-30 rename: the module is compose.py
    # (it authors EVERY brief via `brief`), and this hook is its genuine
    # fallback half — the rung-renderer used only when the author raises.
    ladder = _FALLBACK_COMPOSER
    if ladder is None:
        return "The report could not be composed. See the add-on log.", ""
    try:
        # ⚠️ NO TITLE — the caller delivers one separately, and a header baked
        # into the body arrives as a duplicate first line on every phone.
        brief = ladder(concerns=list(context.concerns),
                        salient=_salient_rows(context),
                        detail=str(err), title="")
        return str(brief.text), str(brief.rung)
    except Exception as second:  # noqa: BLE001 - the last thing before silence
        swallow("the degradation ladder itself failed", second)
        return "The report could not be composed. See the add-on log.", ""


def _agent_concerns(seen_subjects: Set[str]) -> List[Dict[str, Any]]:
    """Open Concerns for this briefing, minus devices this brief already names.

    ⚠️ THE BRIEFING AND THE KIOSK MUST NEVER DESCRIBE THE SAME VILLA
    DIFFERENTLY, and until this existed they did: the agent investigated, filed
    a Concern, and it rendered on the wall and nowhere else.

    ⚠️ IT USED TO DROP A CONCERN A BLUEPRINT HAD ALSO REPORTED, preferring the
    blueprint. Removed in 2.755.0 with the rest of that machinery: supervision
    ON means the agent supersedes, so hiding its Concern behind an automation's
    line is exactly backwards.

    ⚠️ AND IT NEVER RAISES. A briefing that failed because the agent's store was
    unreadable would be the interpretive layer taking down the deterministic
    one — the dependency ARCH-003 exists to forbid.
    """
    if _CONCERNS_SOURCE is None:
        return []
    try:
        rows = _CONCERNS_SOURCE()
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the agent's concerns for this report", err)
        return []

    out: List[Dict[str, Any]] = []
    for row in rows if isinstance(rows, (list, tuple)) else []:
        if not isinstance(row, Mapping):
            continue
        key = str(row.get("subject_key") or "")
        if key and key in seen_subjects:
            continue
        out.append(dict(row))
    return out


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


# ⚠️ `_statistics_fetcher` MOVED to `vesta.adapters.stats.statistics_fetcher`
# (TASK-115 step 8). It was this module's private and the agent's analysis
# tools reached it anyway — the one supervise → brief edge in the lattice,
# carried as ALLOWED_DEBT until this extraction paid it. The adapter owns the
# statistics call the fetcher wraps, so both halves import it downward now.
_statistics_fetcher = stats_mod.statistics_fetcher


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
    supervision_enabled: bool = False,
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
        # ⚠️ SO THE GATE CAN TELL "RETIRED" FROM "INSTALLED AND QUIET".
        # ⚠️ FROM THE CONFIG VIEW, NOT A LITERAL — and the three fields above
        # become dead inputs when it is True. Without this line the flag would
        # be defined, defaulted, documented and never reach the gate: the
        # thirteen-times defect this repository names `feedback_pin-the-caller`.
        supervision_enabled=bool(supervision_enabled),
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
    # (The aggregated half of this scan left with TASK-071 — module findings
    # above are the only field source now.)

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
    #: ⚠️ ITS OWN PARAMETER, NOT READ OFF `settings` — `settings` here is the
    #: `modules` SLICE of the config (see the call site), so a top-level key
    #: looked up there is always None and the flag would never reach the gate.
    #: Threaded exactly like `min_history_days` above, which is the same shape
    #: of top-level value and already had to be passed separately.
    supervision_enabled: bool = False,
    module_failures: Optional[Dict[str, int]] = None,
    preview: bool = False,
    narration: Optional[Dict[str, Any]] = None,
    #: ⚠️ WHO CAUSED THIS BRIEF. Defaults to the schedule so the clock's rows
    #: are byte-identical; the owner-only "run now" handler passes "owner".
    #: The narration's usage row is filed under it, and that row is the whole
    #: reason the ledger exists — the provider's own console cannot say WHO.
    actor: str = "schedule",
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
        min_history_days, module_failures,
        supervision_enabled=supervision_enabled)

    # ── synthesise ──────────────────────────────────────────────────────────
    # ⚠️ SCOPED TO THE PERIOD, NOT THE WHOLE BUFFER. The ring holds up to
    # MAX_EVENTS across months; a weekly report assembled from all of it would
    # restate every finding the owner has already read, and its savings total
    # would grow forever.
    since = period_start(cadence, now_local).isoformat(timespec="seconds")

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
    # ⚠️ THE PER-DEVICE DEDUPLICATION WAS DELETED IN 2.755.0, and it is worth
    # saying WHY rather than letting its absence read as an oversight. It
    # dropped a built-in finding whose device a blueprint had also reported,
    # preferring the blueprint. Under the one rule that replaced the gate it
    # cannot fire in either direction: with supervision OFF the built-in check
    # never ran, so there is nothing to drop; with supervision ON the agent
    # supersedes the blueprint, which is the opposite of what it did.
    #
    # ⚠️ ACCEPTED CONSEQUENCE: a villa running BOTH layers on one device hears
    # about it twice. That is a true statement about a contradictory
    # configuration — supervision on, and a superseded automation left enabled —
    # and a report should not paper over it.

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
            # (the completed-tasks read fed `verify`, which left with TASK-074)
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
            # the facility manager reconciliation either, and both are the same kind
            # of "the villa was unreachable" outcome.
            states = await hass.command("get_states")
            standing = _standing_rows(states)
            labels = _entity_labels(states)
            units = _entity_units(states)
        # ⚠️ EVERY OPEN TO-DO IS CARRIED, DIRECTLY. This was
        # `ledger.reconcile(todo, [])` — a dedupe against "tasks this period's
        # blueprint events already stated", called with a hard-coded EMPTY
        # second argument since TASK-074, i.e. an identity function wearing its
        # old name. The name was the cost: it kept implying an event route into
        # the brief that the owner's rule (2026-08-29) says must not exist —
        # "automations only generate alerts and are never read by the briefing".
        # `reconcile` and `collect.events_since` are deleted outright, so that
        # rule now holds by ABSENCE: there is no accessor left to wire in.
        carried = list(todo)

        # ⚠️ VERIFY AND NOISE ARE GONE WITH THEIR INPUT (TASK-074). Both were
        # computed OVER THE BLUEPRINT EVENTS: verify proved "reported, acted
        # on, and has not recurred" by re-scanning the ring for the same rule,
        # and noise counted fires-per-rule against a monthly threshold. With
        # the last producer retired the ring gains nothing to scan, so each
        # could only ever return empty — machinery whose one honest output is
        # the default this code now states. What replaces them is not code:
        # recurrence is the agent's question now (the concern lifecycle keys
        # on subject_key precisely so a re-raised subject is the SAME concern),
        # and alert fatigue is what the +1/-1 rating on every concern feeds.
    except Exception as err:  # noqa: BLE001 - a report must still go out
        swallow("could not read the facility manager list", err)

    # ── narrate ─────────────────────────────────────────────────────────────
    context = ReportContext(
        audience=audience, cadence=cadence, period=period,
        generated_at=generated_at, discovery=found,
        findings=findings + [f.as_dict() for f in verified],
        skipped=skipped, ran=ran,
        collector=collect.state(),
        carried_tasks=carried, standing=standing, labels=labels, units=units,
        history=_history_series(cadence),
        currency=str(found.get("currency") or ""),
        # ⚠️ DEDUPED AGAINST THIS BRIEF'S OWN FINDINGS, AND NOTHING ELSE NOW.
        # A device the built-in checks already reported could otherwise appear
        # TWICE in one brief — once as a finding and once as a Concern, in
        # different words, about the same equipment.
        #
        # ⚠️ THE BLUEPRINT HALF OF THIS DEDUPE WENT IN 2.755.0 with the rest of
        # the stand-down machinery: supervision ON means the agent supersedes,
        # so hiding its Concern behind an automation's line is backwards. What
        # is left is agent-against-agent and has nothing to do with blueprints.
        concerns=_agent_concerns(
            {str(f.get("subject_key") or "") for f in findings
             if isinstance(f, Mapping) and f.get("subject_key")}),
    )
    # ── narrate, optionally, through a provider ─────────────────────────────
    # ⚠️ THE LEAD SENTENCE IS STILL THE WHOLE SURFACE (TASK-073 kept the slot
    # contract and deleted the slot machinery). A provider writes ONE sentence
    # or nothing; the body below is composed by fixed code either way, so
    # absence, a missing key, an open breaker, a spent budget, a timeout, an
    # unusable answer and an exception all end in the same delivered brief.
    narration_why = ""
    lead = ""
    provider = providers_mod.shared(narration or {})
    if provider is not None:
        # ⚠️ THE ACTOR TRAVELS — see `providers._anthropic`. Filed as the
        # literal "schedule" until 2.686.0, so an owner pressing "run now" had
        # their narration spend attributed to the villa acting on its own.
        prose, narration_why = await provider.narrate(
            session, payload_mod.from_context(context), actor=actor)
        # ⚠️ REJECTED IF IT IS NOT ONE SENTENCE — a paragraph pasted where a
        # lead belongs pushes the dateline out of the notification preview.
        lead = usable_lead(prose)
        # ⚠️ "DID IT ANSWER" IS THE FLATTENED TEXT, NOT THE OBJECT: `"   \n "`
        # is truthy and pure markup flattens to nothing.
        if not lead:
            if bool(str(prose or "").strip()):
                narration_why = "the answer was not a single short sentence"
            log(f"not narrated by a provider: {narration_why}")

    # ── compose ─────────────────────────────────────────────────────────────
    # ⚠️ THE 2,058-LINE RENDERER IS GONE (TASK-073) AND THE LADDER'S OWN
    # AUTHOR WRITES THE NORMAL BRIEF. `deterministic.py` formatted the
    # blueprint-event taxonomy — zones, money columns, sparklines over data
    # whose producers were all retired at the cutover. What a brief says now
    # is what the agent concluded, what is wrong right now, what the checks
    # measured and what jobs are open; `agent/compose.brief` says exactly
    # that, plainly, through the SAME boot-registered hook the rungs use
    # (reports/ may not import agent/ — ARCH-003, pinned).
    # ⚠️ THE SEVERITY IS COMPUTED BEFORE THE TITLE NOW, AND THAT IS THE WHOLE
    # REASON IT MOVED. It used to be worked out after the brief had already been
    # SENT, purely for the history row; the title carries it since 2026-08-29,
    # so a figure computed after delivery would be a figure the reader never
    # saw. Pure — no I/O — so moving it up changes nothing else.
    severity = "info"
    for candidate in ([str(i.get("severity", "info")) for i in
                       list(found.get("preflight") or []) + findings
                       if isinstance(i, dict)]):
        if severity_rank(candidate) > severity_rank(severity):
            severity = candidate

    # ⚠️ THE SAME HEADER SHAPE AS EVERY ALERT (owner, 2026-08-29). The word is
    # the cadence rather than a severity word — a reader needs to know it is the
    # daily report, and the MARK already says how bad it is. A brief with
    # nothing wrong opens ✅, which is the one case where the mark alone carries
    # the whole message.
    title = severity_line(severity, f"{cadence} report", period)
    #: Which rung produced this brief, "" on the happy path. ⚠️ IT REACHES THE
    #: HISTORY ENTRY, because a record saying `deterministic` about a brief the
    #: composer failed to write is the instrument describing the one case it
    #: exists to catch as normal.
    rung = ""
    body = ""
    compose_brief = _BRIEF_COMPOSER
    if compose_brief is not None:
        try:
            made = compose_brief(
                concerns=context.concerns, standing=context.standing,
                findings=[f for f in context.findings
                          if isinstance(f, Mapping)],
                carried=context.carried_tasks,
                coverage_note=_coverage_note(since), lead=lead)
            body = str(made.text)
        except Exception as err:  # noqa: BLE001 - never stops a report
            swallow("the brief composer raised; descending the ladder", err)
    if not body:
        # ⚠️ DESCEND, DO NOT GO QUIET (TASK-111, REQ-042, RISK-015): the
        # concerns, findings and standing state were all gathered above, and a
        # one-line apology would throw every one of them away.
        body, rung = _degrade(context, title,
                              RuntimeError("no brief composer is registered"))
        if rung:
            log(f"delivered a fallback brief at rung {rung}")
    narration_mode = (NARRATION_FALLBACK if rung
                      else (provider.name if (provider and lead)
                            else "deterministic"))

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
    # ⚠️ TWO VARIANTS OF ONE MESSAGE, BUILT HERE AND NOWHERE ELSE (2026-08-30,
    # owner: the briefing's link arrived raw beside alerts carrying a
    # hyperlink). The html body uses the SAME tools the alert path proved on
    # hardware — `html_escape` on the already-inert text, `html_line` for the
    # anchor — and `deliver` uses it only where a service declares an html
    # parse_mode. Everything else still receives the plain body below,
    # byte-identical to before.
    urls = (found.get("inventory") or {}).get("urls")
    link = links_mod.footer(urls, _ingress_entry())
    html_link = links_mod.html_line("Open", urls, _ingress_entry())
    html_body = (f"{links_mod.html_escape(body)}\n\n{html_link}"
                 if html_link else "")
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
                                     .get("notify_targets") or [],
                                     html_message=html_body))

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
    grouped: List[Dict[str, Any]] = []  # no event groups since TASK-071

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
        # ⚠️ ALWAYS 0.0 SINCE TASK-071: the savings column summed the money
        # fields of blueprint events, and nothing emits one. The FIELD stays so
        # stored history rows keep one shape across the cutover.
        "avoidableCost": 0.0,
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
        from vesta.adapters import people as people_mod
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
        from vesta.adapters import people as people_mod
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
        from vesta.adapters import people as people_mod
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
                # ⚠️ THE MASTER SWITCH, AND NOTHING ELSE (2.755.0). It used to
                # read `agent_owns_analysis`, a second flag that existed only
                # to override a stand-down that no longer exists.
                supervision_enabled=bool(agent_cfg.get("enabled")),
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
