"""Meters that have stopped reporting, or stopped changing.

⚠️ THIS MODULE EMITS `DATA_QUALITY`, NEVER `ANOMALY`, AND THE DISTINCTION IS
THE WHOLE POINT. A measurement fault is not an equipment fault. "The freezer is
warming" and "the freezer's thermometer went offline" call for completely
different actions, and reporting the second as the first is the fastest way to
lose a reader's trust — they check the freezer, find it fine, and discount the
next report.

⚠️ IT ALSO PROTECTS EVERY OTHER MODULE'S HONESTY. A meter that goes silent
looks, to a consumption analysis, exactly like equipment that has stopped
drawing power — which is a finding, and a wrong one. When this module reports a
dead meter, the reader has the context to discount anything else said about
that device.

Two failures, deliberately separated because they mean different things:

  SILENT   — the meter has reported nothing for days. Usually offline.
  STUCK    — the meter reports, and the value never changes. Worse than silent,
             because everything downstream treats it as good data.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from ..base import (Finding, ModuleContext, dedup_key, label_for,
                    resolve_threshold)
from ..registry import register
from ..series import (daily_totals, hourly_by_day, last_reading_day,
                      parse_day)

WINDOW_DAYS = 28

#: ⚠️ DIMENSIONLESS — a count of days, not a threshold on any measured
#: quantity. Two days of silence is a weekend of nobody noticing; three is a
#: fault. Below three, a recorder restart or a brief outage would report every
#: meter in the house as broken.
DEFAULT_SILENT_DAYS = 3

#: How many consecutive days of an EXACTLY unchanging total before a meter is
#: called stuck. Longer than the silence bar because a genuinely unused device
#: legitimately reads zero for days — a holiday home's pool pump in winter is
#: not a fault.
DEFAULT_STUCK_DAYS = 7


class SensorHealth:
    """Meters that stopped reporting, or stopped changing."""

    name: str = "sensor_health"
    title: str = "Meters that stopped reporting"
    description: str = (
        "Finds meters that have gone silent or frozen on one value. Worth "
        "knowing on its own, and it is what stops a dead meter being read as "
        "a device that suddenly uses nothing.")
    requires: Sequence[str] = ("statistics", "energy_devices")
    audiences: Sequence[str] = ("owner", "facility")
    min_days: int = 14

    #: ⚠️ THE BLUEPRINT THAT COVERS THIS, BY FILE NAME — not a bare `True`.
    #: The gate stands this module down wherever a detection layer is
    #: installed, and used to say "your own automations already cover this"
    #: without being able to name which one or to check it had ever reported.
    #: Naming it makes the claim checkable: see `registry.gate` and
    #: `collect.state()["silent_blueprints"]`. A stem, because that is the one
    #: part of a VESTA rule that is the same on every property — the automation
    #: INSTANCE is named by whoever filled the form.
    superseded_by: Sequence[str] = ("maintenance_silence",)

    rejected: List[Dict[str, Any]]

    async def run(self, context: ModuleContext) -> List[Finding]:
        energy = context.inventory.get("energy") or {}
        candidates = energy.get("devices")
        if not isinstance(candidates, list) or not candidates:
            return []

        ids = [str(i) for i in candidates if isinstance(i, str)]
        series = await context.stats(ids, WINDOW_DAYS)
        zone = context.zone

        # ⚠️ THE REFERENCE IS THE OTHER METERS, NOT THE CLOCK. A pass that runs
        # while Home Assistant has been down for a week would otherwise report
        # every meter in the house as silent — the recorder is behind, not the
        # equipment. Comparing against the newest day ANY meter reported makes
        # the finding relative to what the recorder actually knows.
        newest = ""
        for statistic_id in ids:
            rows = series.get(statistic_id)
            if isinstance(rows, list):
                day = last_reading_day(rows, zone)
                if day is not None and day > newest:
                    newest = day
        if not newest:
            return []

        self.rejected = []
        findings: List[Finding] = []
        for index, statistic_id in enumerate(ids):
            rows = series.get(statistic_id)
            if not isinstance(rows, list):
                continue
            found = self._assess(statistic_id, index, rows, context, zone, newest)
            if found is not None:
                findings.append(found)
        return findings

    def _assess(self, statistic_id: str, index: int,
                rows: List[Dict[str, Any]], context: ModuleContext,
                zone: Any, newest: str) -> Optional[Finding]:
        buckets = hourly_by_day(rows, zone)
        days = sorted(buckets)
        if not days:
            # Never reported at all within the window. Not a fault this module
            # can distinguish from a meter configured moments ago, so silent.
            return None

        silent_days = resolve_threshold(
            context.settings, "silent_days", None, DEFAULT_SILENT_DAYS)
        gap = _days_between(days[-1], newest)
        if gap is not None and gap >= silent_days:
            return Finding(
                ref=f"h{index}",
                kind="DATA_QUALITY",
                severity="warning",
                label=label_for(statistic_id, context.labels),
                detail=(f"has reported nothing for {gap} days, while other "
                        f"meters kept reporting — readings for it are missing "
                        f"rather than zero"),
                metric="availability",
                observed=float(gap),
                window_days=len(days),
                confidence=1.0,
                completeness=round(min(1.0, len(days) / float(WINDOW_DAYS)), 3),
                dedup_key=dedup_key(f"{self.name}:silent", statistic_id),
            )

        # STUCK: it USED TO VARY AND HAS STOPPED.
        #
        # ⚠️ "EVERY DAY IS EXACTLY THE SAME" IS NOT ENOUGH, and the first
        # version of this check used exactly that. It flags any device whose
        # consumption is genuinely constant — a template sensor, a fixed load, a
        # meter on something that simply does the same thing every day — and
        # Phase 4's gate is ZERO false positives. Caught immediately by tests
        # whose "healthy" fixtures were flat, which is the natural way to write
        # a fixture and turned out to be the realistic case too.
        #
        # A CHANGE in behaviour is the real signal: this meter varied before and
        # does not now. That is evidence about the meter rather than about the
        # load, and a device that has always been constant is left alone.
        totals = daily_totals(rows, zone)
        stuck_days = int(resolve_threshold(
            context.settings, "stuck_days", None, DEFAULT_STUCK_DAYS))
        ordered = [totals[day] for day in sorted(totals)]
        recent = ordered[-stuck_days:]
        prior = ordered[:-stuck_days]
        varied_before = len(set(prior)) > 1
        if (len(recent) >= stuck_days and varied_before
                and len(set(recent)) == 1 and recent[0] > 0):
            return Finding(
                ref=f"h{index}",
                kind="DATA_QUALITY",
                severity="notice",
                label=label_for(statistic_id, context.labels),
                detail=(f"varied from day to day until recently and has now "
                        f"reported exactly the same total for {stuck_days} days "
                        f"running — usually a frozen meter rather than a load "
                        f"that suddenly became perfectly steady"),
                metric="availability",
                observed=round(recent[0], 4),
                window_days=len(totals),
                confidence=0.8,
                completeness=round(min(1.0, len(totals) / float(WINDOW_DAYS)), 3),
                dedup_key=dedup_key(f"{self.name}:stuck", statistic_id),
            )
        return None


def _days_between(earlier: str, later: str) -> Optional[int]:
    """The GAP between two days — exclusive, and None when unanswerable.

    Deliberately not `pipeline._span_days`: that one is an inclusive window
    span and answers 0 rather than None. Different questions, one parser —
    see `series.parse_day`.
    """
    a = parse_day(earlier)
    b = parse_day(later)
    if a is None or b is None:
        return None
    return (b - a).days


register(SensorHealth())
