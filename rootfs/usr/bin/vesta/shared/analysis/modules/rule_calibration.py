"""Rules whose settings cannot work — the check that watches the watchers.

⚠️ EVERY ALERT THE OWNER RECEIVED OVER THREE DAYS (2026-09-02 → 04) CAME FROM A
`critical_*` RULE, AND EVERY ROOT CAUSE WAS THE RULE. A pool pump "failed to
start" because its schedule opened at 07:15, the pump reaches load at 07:21 to
07:26, and the grace window was ten minutes. A mains phase "overload" could not
close because its clear threshold equalled its trip threshold and the load was
oscillating across it. An incident ended by timeout in silence because no
branch existed for it. Three layers watch the villa — the reflex rules, the
statistical checks, the agent — and nothing watched the rules themselves; the
only rule-health check in the system asked whether a critical automation was
switched OFF. Each diagnosis above took a person fifteen to twenty calls to
join an automation's config against a week of history. That join is this file.

⚠️ IT EMITS `DATA_QUALITY`, NEVER `ANOMALY`, and the choice is the same one
`sensor_health` makes for a dead meter: a miscalibrated rule is a fault in the
INSTRUMENT, not in the equipment it watches. "Your pump failed to start" and
"your start check cannot tell a slow start from a failure" call for opposite
actions, and reporting the second as the first is how a reader checks the pump,
finds it fine, and discounts the next alert.

⚠️ NOTHING HERE IS A THRESHOLD, AND THE FOUR CHECKS ARE DELIBERATELY BUILT ON
RELATIONSHIPS BETWEEN A RULE'S OWN NUMBERS. A clear level equal to its trip
level is unclosable at every property on earth; incidents that end by timeout
MORE OFTEN THAN by all-clear are a majority, not a percentage anyone tunes; a
grace window inside the spread of the starts it has actually seen is a margin
measured against the device's own jitter. That is what makes this reproducible
on a villa installed this morning: the first two checks need no history at all.

⚠️ `min_days = 0`, AND THE GATE HONOURS IT. `history_days` is measured from the
ENERGY statistics and a rule's configuration is as wrong on the day it is
written as a month later — see `registry.gate`.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from ..base import Finding, ModuleContext, dedup_key, label_for, subject_key
from ..robust import robust_sigma
from ..series import day_key
from vesta.shared.instants import WEEKDAYS, seconds_of

#: How far back the operating-band check reads hourly statistics. Four weeks:
#: enough to hold a monthly rhythm, and the window the energy checks already
#: settled on for a per-device baseline.
BAND_DAYS = 28

#: How far back the start-jitter check reads a scheduled device's raw history.
#: A week is one of every weekday — a schedule helper is a weekly thing.
START_DAYS = 7

#: ⚠️ A VALIDITY FLOOR, NOT A THRESHOLD. Below this many observed starts a
#: spread is not a measurement; two starts six minutes apart say nothing about
#: the third. Dimensionless, identical at every property.
MIN_STARTS = 3


class RuleCalibration:
    """Rules whose settings cannot do what they are for."""

    name: str = "rule_calibration"
    title: str = "Rules that cannot work as set"
    description: str = (
        "Reads each VESTA critical rule's settings against what the villa "
        "actually does: a start check tighter than the device's own start "
        "time, an all-clear that can never be reached, a limit the villa "
        "operates at every day, incidents that keep ending by timeout.")
    requires: Sequence[str] = ("automations",)
    audiences: Sequence[str] = ("owner", "facility")
    min_days: int = 0
    #: Nothing supersedes this: no blueprint judges blueprints.
    superseded_by: Sequence[str] = ()

    async def run(self, context: ModuleContext) -> List[Finding]:
        if not callable(context.automations):
            return []
        view = await context.automations(band_days=BAND_DAYS,
                                         start_days=START_DAYS)
        instances = [i for i in (view.get("instances") or [])
                     if isinstance(i, Mapping)]
        firings = view.get("firings") or {}
        out: List[Finding] = []
        for index, instance in enumerate(instances):
            if not instance.get("enabled", True):
                # A switched-off rule cannot fire, and `audit_config_integrity`
                # already says it is off. Judging its settings would be noise.
                continue
            for check in (_no_hysteresis, _ends_by_timeout, _at_its_limit,
                          _grace_inside_jitter):
                finding = check(instance, firings, context, index)
                if finding is not None:
                    out.append(finding)
        return out


# ── the four checks ─────────────────────────────────────────────────────────
def _finding(instance: Mapping[str, Any], context: ModuleContext, index: int,
             *, check: str, detail: str, observed: Optional[float] = None,
             baseline: Optional[float] = None, unit: str = "",
             window_days: Optional[int] = None,
             completeness: float = 1.0) -> Finding:
    entity_id = str(instance.get("entity_id") or "")
    label = str(instance.get("label") or "") or label_for(entity_id, context.labels)
    return Finding(
        ref=f"r{index}",
        kind="DATA_QUALITY",
        severity="warning",
        label=f"{label}, rule calibration",
        detail=detail,
        metric=check,
        unit=unit,
        observed=observed,
        baseline=baseline,
        window_days=window_days,
        completeness=completeness,
        # ⚠️ THE CHECK IS PART OF THE DEDUP KEY. One rule can carry two
        # different faults, and "the same finding as last week" must be asked
        # per fault or the second one is never new.
        dedup_key=dedup_key(f"rule_calibration.{check}", entity_id),
        subject_key=subject_key(entity_id),
    )


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out else None


def _no_hysteresis(instance: Mapping[str, Any], firings: Mapping[str, Any],
                   context: ModuleContext, index: int) -> Optional[Finding]:
    """A numeric rule whose all-clear is judged at the number it trips at.

    ⚠️ NEEDS NO HISTORY. A value oscillating around its limit trips in one
    confirmation window and then never assembles a whole clear window on the
    other side, so the incident stays open until "Repeat after" closes it in
    silence — the phase-overload defect of 2026-09-02, readable from the
    config alone on the day the rule is written.
    """
    if instance.get("stem") != "critical_condition":
        return None
    inputs = instance.get("inputs") or {}
    if str(inputs.get("alert_mode") or "state") != "numeric":
        return None
    margin = _number(inputs.get("clear_margin")) or 0.0
    if margin > 0:
        return None
    threshold = _number(inputs.get("threshold"))
    shown = f" ({threshold:g})" if threshold is not None else ""
    return _finding(
        instance, context, index, check="no_hysteresis",
        detail=(f"its all-clear is judged at the same number it trips at"
                f"{shown}, so a value oscillating around the limit cannot "
                f"close an incident and the rule ends by timeout instead; "
                f"set a clear margin"),
        observed=0.0, baseline=threshold)


def _ends_by_timeout(instance: Mapping[str, Any], firings: Mapping[str, Any],
                     context: ModuleContext, index: int) -> Optional[Finding]:
    """Incidents that end by timeout more often than by all-clear.

    ⚠️ A MAJORITY, NOT A RATE ANYONE TUNES. A rule whose incidents close by
    timeout more often than they clear is not tracking anything to its end,
    whatever the villa is doing; and the count comes from the record's own
    tally, the same grouping the brief prints "3 times · 2 ended by timeout"
    from. A rule whose blueprint sends no phase tallies by count alone and is
    never judged here — an absent phase is "not said", not "cleared".
    """
    alias = str(instance.get("alias") or "")
    held = firings.get(alias) if isinstance(firings, Mapping) else None
    if not isinstance(held, Mapping):
        return None
    phases = held.get("phases") or {}
    opened = int(phases.get("opened") or 0)
    timeout = int(phases.get("timeout") or 0)
    cleared = int(phases.get("cleared") or 0)
    if opened < 2 or timeout <= cleared:
        return None
    return _finding(
        instance, context, index, check="ends_by_timeout",
        detail=(f"{timeout} of its last {opened} incidents ended by timeout "
                f"rather than by all-clear; a rule that cannot close is one "
                f"that will be muted"),
        observed=float(timeout), baseline=float(opened))


def _at_its_limit(instance: Mapping[str, Any], firings: Mapping[str, Any],
                  context: ModuleContext, index: int) -> Optional[Finding]:
    """A limit the villa crosses on most days it is observed.

    ⚠️ IT SURFACES THE QUESTION RATHER THAN ANSWERING IT. A phase that crosses
    a 4,000 W limit on most days is either a limit set below normal operation
    or a phase running near its breaker, and nothing in this add-on can tell
    which — but nothing asked, either, and the rule's own description on the
    reference villa said "CONFIRM the actual rating on site" for a month.
    Majority of observed days, so a single hot afternoon is not a finding.
    """
    if instance.get("stem") != "critical_condition":
        return None
    inputs = instance.get("inputs") or {}
    if str(inputs.get("alert_mode") or "state") != "numeric":
        return None
    threshold = _number(inputs.get("threshold"))
    hourly = instance.get("hourly")
    if threshold is None or not isinstance(hourly, Mapping):
        return None
    above = str(inputs.get("direction") or "above") == "above"
    worst: Optional[Finding] = None
    for entity_id, rows in hourly.items():
        if not isinstance(rows, list):
            continue
        seen: set[str] = set()
        crossed: set[str] = set()
        for row in rows:
            if not isinstance(row, Mapping):
                continue
            day = day_key(row.get("start"), context.zone)
            extreme = _number(row.get("max") if above else row.get("min"))
            if not day or extreme is None:
                continue
            seen.add(day)
            if (extreme > threshold) if above else (extreme < threshold):
                crossed.add(day)
        if not seen or len(crossed) * 2 <= len(seen):
            continue
        word = "above" if above else "below"
        finding = _finding(
            instance, context, index, check="at_its_limit",
            detail=(f"{label_for(str(entity_id), context.labels)} went "
                    f"{word} this rule's limit of {threshold:g} on "
                    f"{len(crossed)} of the last {len(seen)} days observed; "
                    f"either the limit sits inside normal operation or the "
                    f"equipment is running at it, and the rule cannot tell "
                    f"which — confirm the rating"),
            observed=float(len(crossed)), baseline=float(len(seen)),
            window_days=len(seen),
            completeness=round(min(1.0, len(seen) / float(BAND_DAYS)), 3))
        if worst is None or (finding.observed or 0) > (worst.observed or 0):
            worst = finding
    return worst


def _grace_inside_jitter(instance: Mapping[str, Any], firings: Mapping[str, Any],
                         context: ModuleContext, index: int) -> Optional[Finding]:
    """A start check's grace window inside the device's own start spread.

    ⚠️ THE POOL PUMP OF 2026-09-03, A WEEK EARLY. The rule allowed ten minutes
    from the schedule opening for the pump to draw load; the pump takes six to
    eleven. The false alert was inevitable and nothing could have said so
    before it fired, because nothing joined the schedule helper's week, the
    power sensor's raw history and the rule's grace input. The join: for each
    scheduled start in the window, how long after the block opened did the
    sensor first exceed the rule's own power threshold. The finding fires
    when any observed start exceeded the grace (it already alarmed falsely)
    OR when the grace sits within one robust spread of the slowest start seen
    — a margin against the device's own jitter, never a number of this file's.
    """
    if instance.get("stem") != "critical_schedule":
        return None
    inputs = instance.get("inputs") or {}
    grace = seconds_of(inputs.get("duration_offline"))
    threshold = _number(inputs.get("power_threshold"))
    blocks = instance.get("blocks")
    history = instance.get("history")
    if grace <= 0 or threshold is None or not blocks or not isinstance(history, list):
        return None
    starts = _scheduled_starts(blocks, context.now_local, START_DAYS)
    points = _points(history)
    delays: List[float] = []
    for opened in starts:
        delay = _first_load_after(points, opened, threshold)
        if delay is not None:
            delays.append(delay)
    if len(delays) < MIN_STARTS:
        return None
    slowest = max(delays)
    spread = robust_sigma(delays) or 0.0
    late = sum(1 for d in delays if d > grace)
    if late == 0 and slowest + spread < grace:
        return None
    return _finding(
        instance, context, index, check="grace_inside_jitter",
        detail=(f"it allows {grace / 60:g} min for the device to reach load "
                f"after its schedule opens; over the last {len(delays)} "
                f"scheduled starts it took {min(delays) / 60:.0f}–"
                f"{slowest / 60:.0f} min"
                + (f", {late} of them longer than allowed" if late
                   else ", within a minute of the allowance")
                + " — the check will report a failure the device did not have"),
        observed=round(slowest / 60, 1), baseline=round(grace / 60, 1),
        unit="min", window_days=START_DAYS)


# ── helpers ─────────────────────────────────────────────────────────────────
def _scheduled_starts(blocks: Sequence[Mapping[str, Any]], now_local: datetime,
                      days: int) -> List[datetime]:
    """Every block opening in the last `days` local days, as aware datetimes.

    ⚠️ LOCAL CLOCK, THEN AWARE. A schedule helper's blocks are wall-clock
    times in the villa's zone; the sensor history is UTC. Building each start
    on the villa's own day and letting the datetime carry the zone is what
    lets the two be subtracted.
    """
    by_day: Dict[str, List[str]] = {}
    for block in blocks:
        name = str(block.get("day") or "")
        if name in WEEKDAYS:
            by_day.setdefault(name, []).append(str(block.get("from") or ""))
    out: List[datetime] = []
    for back in range(1, days + 1):
        midnight = (now_local - timedelta(days=back)).replace(
            hour=0, minute=0, second=0, microsecond=0)
        for clock in by_day.get(WEEKDAYS[midnight.weekday()], []):
            parts = clock.split(":")
            try:
                hour, minute = int(parts[0]), int(parts[1])
                second = int(parts[2]) if len(parts) > 2 else 0
            except (ValueError, IndexError):
                continue
            out.append(midnight.replace(hour=hour, minute=minute, second=second))
    return out


def _points(history: Sequence[Any]) -> List[Tuple[datetime, float]]:
    from vesta.shared import instants
    out: List[Tuple[datetime, float]] = []
    for row in history:
        if not isinstance(row, Mapping):
            continue
        at = instants.as_utc(row.get("at"))
        value = _number(row.get("state"))
        if at is not None and value is not None:
            out.append((at, value))
    out.sort(key=lambda p: p[0])
    return out


def _first_load_after(points: Sequence[Tuple[datetime, float]], opened: datetime,
                      threshold: float) -> Optional[float]:
    """Seconds from `opened` to the first reading above `threshold`, or None
    if the sensor never crossed it within a day (a real failure, or a day the
    schedule did not apply — either way not a calibration fact)."""
    limit = opened + timedelta(days=1)
    for at, value in points:
        if at < opened:
            continue
        if at >= limit:
            return None
        if value > threshold:
            return (at - opened).total_seconds()
    return None
