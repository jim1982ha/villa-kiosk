"""Equipment that has quietly started drawing more when it is doing nothing.

The question this asks is narrow on purpose: **has this device's IDLE draw
risen against its own recent history?** Not "is it using a lot" — that is a
judgement about a property nobody here has made — but "is it different from
itself", which is answerable from the villa's own recorder and means the same
thing on every install.

It is the right first module because standby creep is the failure that hides.
A pump whose seal is going, a fridge whose door no longer seals, a heater whose
thermostat has stuck — none announce themselves. They draw a little more, every
hour, for months, and the only symptom is a bill nobody connects to a cause.

⚠️ THE IDLE FLOOR IS THE WHOLE IDEA. Comparing daily TOTALS finds nothing: a
device used more days runs up a bigger total and that is not a fault. What
matters is the level it sits at when it should be doing nothing at all — the
low percentile of its hourly consumption. That number should be flat for years,
so a change in it is a change in the equipment rather than in how it was used.

⚠️ NOT A LITERAL WATTAGE ANYWHERE. The threshold is a RATIO against the
device's own baseline, and the noise floor is learned from that device's own
day-to-day variation. A property with a 3 kW heat pump and a property with a
40 W router get the same code and the same correctness.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from ..base import (Finding, ModuleContext, dedup_key, label_for,
                    resolve_threshold)
from ..registry import register
from ..robust import median, percentile, relative_change, robust_sigma
from ..series import complete_days, hourly_by_day

#: Which hours count as "idle". The 20th percentile of a day's hourly readings:
#: low enough to exclude normal operation, high enough not to be the single
#: hour the meter under-reported.
IDLE_PERCENTILE = 0.20

#: The comparison. Recent days against the ones before them — the device is its
#: own control, which is what makes this portable.
RECENT_DAYS = 7
BASELINE_DAYS = 21

#: ⚠️ DIMENSIONLESS. A 40% rise in a device's own idle floor is a real change
#: whatever the device is. There is no wattage here and there must never be.
DEFAULT_RISE_FRACTION = 0.40

#: How many robust sigmas above the baseline's own variation before the rise is
#: distinguishable from noise. Both tests must pass: a device that is merely
#: erratic clears the ratio and fails this, and a device whose idle floor is
#: rock steady clears this on a change too small to care about and fails the
#: ratio.
DEFAULT_SIGMA = 3.0

#: A rise measured on a device whose baseline idle floor is essentially zero is
#: not measurable — see `relative_change`. Expressed as a fraction of the
#: device's own MEDIAN consumption, so it is still not a wattage.
MIN_FLOOR_OF_MEDIAN = 0.01

#: Which hours represent the device WORKING. The 80th percentile of its hourly
#: consumption — the level it reaches under load, as opposed to the 20th, which
#: is where it rests.
ACTIVE_PERCENTILE = 0.80

#: ⚠️ THE MATERIALITY TEST, AND THE REASON IT EXISTS. A pure ratio is scale-free
#: and therefore blind to whether a change MATTERS: on the reference deployment
#: the first real finding was a house pump whose idle floor rose from 0.0009 to
#: 0.009 kWh/h — a true, confident, well-measured 869%, and a rise of eight
#: watts. Reporting that is precisely the alert fatigue this module is meant to
#: avoid, and it appeared on the first working run.
#:
#: `MIN_FLOOR_OF_MEDIAN` was supposed to prevent it and structurally could not:
#: it compares the idle floor against the median of OTHER IDLE FLOORS, so the
#: ratio is always about 1 and the guard never fires. Wrong denominator.
#:
#: The right one is the device's own WORKING level. A rise worth a person's
#: attention is a material fraction of what the equipment draws when it runs —
#: which stays dimensionless, and so stays correct for a 3 kW heat pump and a
#: 40 W router alike.
MIN_RISE_OF_ACTIVE = 0.05


def _daily_idle_floors(rows: List[Dict[str, Any]],
                       zone: Any = None) -> List[float]:
    """One idle floor per day, oldest first.

    Days with too few readings are DROPPED rather than filled — see
    `series.complete_days`.
    """
    buckets = hourly_by_day(rows, zone)
    floors: List[float] = []
    for day in complete_days(buckets):
        floor = percentile(buckets[day], IDLE_PERCENTILE)
        if floor is not None:
            floors.append(floor)
    return floors


class StandbyCreep:
    """Idle draw that has risen against the device's own baseline."""

    # Annotated as Sequence, not left to inference: the Protocol declares
    # mutable attributes, so a bare tuple literal infers as `tuple[str, str]`
    # and fails the structural match invariantly. mypy --strict catches it;
    # nothing at runtime would.
    name: str = "standby_creep"
    title: str = "Equipment drawing more at rest"
    description: str = (
        "Watches what each metered device uses when it is idle. A rising floor "
        "is often a failing part or something left switched on.")
    requires: Sequence[str] = ("statistics", "energy_devices")
    audiences: Sequence[str] = ("owner", "facility")
    min_days: int = 14

    #: Filled per run when diagnostics are wanted; read by the preview.
    #: ⚠️ A deployed blueprint does this job with more context. See the gate in
    #: `registry.gate` — this module runs only where no automation layer is
    #: reporting, which is every install except the one it was written against.
    superseded_by_blueprints: bool = True

    rejected: List[Dict[str, Any]]

    async def run(self, context: ModuleContext) -> List[Finding]:
        energy = context.inventory.get("energy") or {}
        candidates = energy.get("devices")
        if not isinstance(candidates, list) or not candidates:
            return []

        # ⚠️ ROLLED-UP METERS ARE INCLUDED HERE ON PURPOSE, unlike a total.
        # `included_in_stat` matters when SUMMING, because a child's draw is
        # already inside its parent. This module never sums — it asks each
        # meter about itself — and a child meter is exactly where a failing
        # appliance shows up first. Excluding them would blind the module to
        # every individually metered device on the property.
        ids = [str(i) for i in candidates if isinstance(i, str)]
        window = RECENT_DAYS + BASELINE_DAYS
        series = await context.stats(ids, window)

        findings: List[Finding] = []
        self.rejected = []
        for index, statistic_id in enumerate(ids):
            rows = series.get(statistic_id)
            if not isinstance(rows, list):
                continue
            finding = self._assess(statistic_id, index, rows, context,
                                   self.rejected)
            if finding is not None:
                findings.append(finding)

        # Loudest first — a report is read from the top and a reader who stops
        # halfway should have seen the worst of it.
        findings.sort(key=lambda f: (f.delta or 0.0), reverse=True)
        return findings

    def _assess(self, statistic_id: str, index: int,
                rows: List[Dict[str, Any]],
                context: ModuleContext,
                rejected: Optional[List[Dict[str, Any]]] = None) -> Optional[Finding]:
        zone = context.zone
        floors = _daily_idle_floors(rows, zone)
        expected_days = RECENT_DAYS + BASELINE_DAYS
        if len(floors) < self.min_days:
            return None

        recent = floors[-RECENT_DAYS:]
        baseline = floors[:-RECENT_DAYS]
        if len(recent) < 3 or len(baseline) < 7:
            return None

        recent_floor = median(recent)
        baseline_floor = median(baseline)
        if recent_floor is None or baseline_floor is None:
            return None

        # A baseline of essentially nothing cannot support a ratio. Expressed
        # against the device's own median so this stays dimensionless.
        overall = median([f for f in floors])
        if overall is None or baseline_floor < overall * MIN_FLOOR_OF_MEDIAN:
            return None

        rise = relative_change(baseline_floor, recent_floor)
        if rise is None or rise <= 0:
            return None

        # ⚠️ LEARNED FROM THE DEVICE'S OWN VARIATION. A device whose idle floor
        # wanders by 30% week to week should not be reported for wandering 40%.
        spread = robust_sigma(baseline)
        settings = context.settings
        rise_threshold = resolve_threshold(
            settings, "rise_fraction", None, DEFAULT_RISE_FRACTION)
        sigma_threshold = resolve_threshold(
            settings, "sigma", None, DEFAULT_SIGMA)

        # ⚠️ THE WORKING LEVEL IS COMPUTED BEFORE EITHER TEST, so the
        # rejection log can never have a hole in the column a threshold would
        # be tuned from. It was computed lazily at first, which meant a
        # candidate rejected on the RATIO recorded `active_level: null` — the
        # one number needed to judge whether the ratio threshold was too deaf
        # for that device. An instrument that goes blank in the interesting
        # case is the failure mode this project has a memory file about.
        all_hours = [float(r["change"]) for r in rows
                     if isinstance(r.get("change"), (int, float))
                     and not isinstance(r.get("change"), bool)
                     and float(r["change"]) >= 0]
        active_level = percentile(all_hours, ACTIVE_PERCENTILE)
        materiality = resolve_threshold(
            settings, "min_rise_of_active", None, MIN_RISE_OF_ACTIVE)
        absolute_rise = recent_floor - baseline_floor

        if rise < rise_threshold:
            self._note(rejected, statistic_id, context, "below_rise_threshold",
                       rise, recent_floor, baseline_floor, active_level)
            return None

        # ⚠️ IS THE CHANGE MATERIAL? A ratio alone cannot say. Compare the
        # ABSOLUTE rise against what this device draws when it is working — the
        # denominator that makes "8 W on a pump that runs at 800 W" register as
        # the noise it is, without any wattage appearing in the code.
        if active_level is not None and active_level > 0:
            if absolute_rise < materiality * active_level:
                self._note(rejected, statistic_id, context, "immaterial",
                           rise, recent_floor, baseline_floor, active_level)
                return None

        # ⚠️ MAD OF ZERO IS LEGITIMATE and must not become a divide-by-nothing.
        # A perfectly steady device has zero spread; the ratio test alone
        # carries the decision there, which is the conservative choice.
        if spread is not None and spread > 0:
            if (recent_floor - baseline_floor) < sigma_threshold * spread:
                return None

        completeness = min(1.0, len(floors) / float(expected_days))
        _ = absolute_rise
        # Confidence follows completeness rather than being asserted: a
        # conclusion drawn from 14 of 28 days should not present itself with
        # the same authority as one drawn from all 28.
        confidence = round(0.5 + 0.5 * completeness, 3)

        label = label_for(statistic_id, context.labels)
        percent = round(rise * 100)
        severity = "warning" if rise >= rise_threshold * 2 else "notice"

        return Finding(
            ref=f"d{index}",
            kind="ANOMALY",
            severity=severity,
            label=label,
            detail=(f"idle consumption is about {percent}% higher over the last "
                    f"{len(recent)} days than in the {len(baseline)} days before "
                    f"— the level it sits at when nothing should be running has "
                    f"risen"),
            metric="energy",
            unit="kWh/h",
            observed=round(recent_floor, 4),
            baseline=round(baseline_floor, 4),
            delta=round(rise, 4),
            window_days=len(floors),
            confidence=confidence,
            completeness=round(completeness, 3),
            dedup_key=dedup_key(self.name, statistic_id),
        )

    def _note(self, rejected: Optional[List[Dict[str, Any]]], statistic_id: str,
              context: ModuleContext, reason: str, rise: float,
              recent: float, baseline: float,
              active: Optional[float]) -> None:
        """Record a candidate that was measured and then rejected.

        ⚠️ WITHOUT THIS, TUNING IS GUESSWORK. A threshold that suppresses
        everything and a property with nothing wrong produce the same empty
        report, and the only way to tell them apart is to see what was
        considered and why it was dropped. Diagnostic only — it reaches the
        preview, never the delivered report.
        """
        if rejected is None:
            return
        rejected.append({
            "label": label_for(statistic_id, context.labels),
            "reason": reason,
            "rise": round(rise, 4),
            "observed": round(recent, 6),
            "baseline": round(baseline, 6),
            "active_level": round(active, 6) if active is not None else None,
            "rise_of_active": (round((recent - baseline) / active, 4)
                               if active else None),
        })


register(StandbyCreep())
