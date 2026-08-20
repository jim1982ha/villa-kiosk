"""A device that used markedly more than it usually does on this day of week.

Where `standby_creep` asks about the level a device RESTS at, this asks about
what it actually CONSUMED — the total for the day against what that device
normally does on that weekday.

⚠️ PER DAY OF WEEK IS MANDATORY, NOT AN IMPROVEMENT. Household consumption is
weekly-periodic: the villa is used differently at weekends, cleaners come on a
fixed day, the pool is serviced on another. A flat baseline flags every Saturday
of every week forever — which is not a subtle degradation in quality, it is a
detector that fires on the calendar and is switched off within a month. Alert
fatigue is the primary product risk, and this is the single most reliable way to
manufacture it.

The cost is history: comparing a Saturday to other Saturdays needs several
Saturdays, so this module reads EIGHT weeks where `standby_creep` reads two,
and refuses to run on less than six. That is a real constraint, stated as
`min_days` rather than worked around — a baseline built from three Saturdays is
not a baseline, and a module that pretends otherwise is worse than one that
waits. The first live run proved it: on four-sample baselines it produced
TWELVE findings from eighteen meters, topping out at 715,700%.

⚠️ NOT A WATTAGE ANYWHERE. The threshold is robust sigmas above that device's
own same-weekday distribution, so a 3 kW heat pump and a 40 W router are judged
identically.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from ..base import (Finding, ModuleContext, dedup_key, label_for,
                    resolve_threshold)
from ..registry import register
from ..materiality import has_stable_baseline, is_material
from ..robust import median, robust_sigma
from ..series import daily_totals, weekday_of

#: ⚠️ EIGHT WEEKS, NOT FOUR. Four weeks gives four samples of each weekday, and
#: a median of four is fragile: one unusual Friday moves it enough to make the
#: next ordinary Friday look anomalous. The first live run produced TWELVE
#: findings from eighteen meters on four-sample baselines. The recorder on the
#: reference deployment holds 122 days, so asking for eight weeks costs nothing
#: and roughly doubles the evidence behind every comparison.
WINDOW_DAYS = 56

#: ⚠️ DIMENSIONLESS. How far above its own same-weekday median a day must sit.
#: Robust sigmas, so the spread comes from the device's own history rather than
#: from an assumption about how much equipment varies.
DEFAULT_SIGMA = 4.0

#: And a floor on the relative size, because sigma alone is treacherous on very
#: consistent equipment: a device that uses exactly the same amount every
#: Tuesday has near-zero spread, and then any difference at all is "many
#: sigmas". Both tests must pass.
DEFAULT_RISE_FRACTION = 0.30

#: Samples of the same weekday needed before a comparison is attempted. Four,
#: because three has no meaningful spread and the median is whichever value
#: happens to sit in the middle.
MIN_SAMEDAY_SAMPLES = 4

#: How many recent days to examine. One week, so a weekly report covers exactly
#: the period it is about.
RECENT_DAYS = 7


WEEKDAY_NAME = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                "Saturday", "Sunday")


class LevelAnomaly:
    """Consumption well above this device's own normal for that weekday."""

    name: str = "level_anomaly"
    requires: Sequence[str] = ("statistics", "energy_devices")
    audiences: Sequence[str] = ("owner", "facility")
    #: Six weeks minimum, eight read — see the module docstring on why this is
    #: far higher than standby_creep's and is not negotiable down.
    min_days: int = 42

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

        ids = [str(i) for i in candidates if isinstance(i, str)]
        series = await context.stats(ids, WINDOW_DAYS)
        zone = context.zone

        self.rejected = []
        findings: List[Finding] = []
        for index, statistic_id in enumerate(ids):
            rows = series.get(statistic_id)
            if not isinstance(rows, list):
                continue
            found = self._assess(statistic_id, index, rows, context, zone)
            if found is not None:
                findings.append(found)

        findings.sort(key=lambda f: (f.delta or 0.0), reverse=True)
        return findings

    def _assess(self, statistic_id: str, index: int,
                rows: List[Dict[str, Any]], context: ModuleContext,
                zone: Any) -> Optional[Finding]:
        totals = daily_totals(rows, zone)
        if len(totals) < MIN_SAMEDAY_SAMPLES * 2:
            return None

        days = sorted(totals)
        recent = days[-RECENT_DAYS:]
        history = days[:-RECENT_DAYS]
        if not history:
            return None

        # ⚠️ THE BASELINE IS BUILT PER WEEKDAY. Pooling every day would compare
        # a Saturday against a week of weekdays and flag the weekend, every
        # weekend, forever.
        by_weekday: Dict[int, List[float]] = {}
        for day in history:
            weekday = weekday_of(day)
            if weekday is not None:
                by_weekday.setdefault(weekday, []).append(totals[day])

        worst: Optional[Finding] = None
        for day in recent:
            weekday = weekday_of(day)
            if weekday is None:
                continue
            samples = by_weekday.get(weekday, [])
            if len(samples) < MIN_SAMEDAY_SAMPLES:
                # Not enough of this weekday yet. Silently skipped per day
                # rather than reported: "not enough Tuesdays" is not a finding
                # about the equipment.
                continue

            # ⚠️ IS THERE A NORMAL TO DEPART FROM? A device used on some
            # Fridays and not others has a Friday median near zero and a spread
            # the size of its own range; every Friday it runs is then thousands
            # of percent "above normal" — arithmetically true and meaningless.
            # This is what produced 715,700% on the first live run.
            if not has_stable_baseline(samples):
                continue

            centre = median(samples)
            spread = robust_sigma(samples)
            observed = totals[day]
            if centre is None or centre <= 0:
                continue

            rise = (observed - centre) / centre
            sigma_threshold = resolve_threshold(
                context.settings, "sigma", None, DEFAULT_SIGMA)
            rise_threshold = resolve_threshold(
                context.settings, "rise_fraction", None, DEFAULT_RISE_FRACTION)

            if rise < rise_threshold:
                continue

            # ⚠️ IS IT MATERIAL? The rule `standby_creep` learned the hard way
            # and this module did not inherit, because it was applied at a call
            # site rather than to everything it applies to. Shared now.
            if not is_material(observed - centre, list(totals.values())):
                continue
            # ⚠️ MAD OF ZERO IS LEGITIMATE — a device that uses exactly the
            # same amount every Tuesday. Any difference is then "infinite
            # sigmas", so the relative test alone decides, which is the
            # conservative choice.
            if spread is not None and spread > 0:
                if (observed - centre) < sigma_threshold * spread:
                    continue

            if worst is None or rise > (worst.delta or 0.0):
                worst = Finding(
                    ref=f"l{index}",
                    kind="ANOMALY",
                    severity="warning" if rise >= rise_threshold * 2 else "notice",
                    label=label_for(statistic_id, context.labels),
                    detail=(f"used about {round(rise * 100)}% more on "
                            f"{WEEKDAY_NAME[weekday]} than it normally does on a "
                            f"{WEEKDAY_NAME[weekday]} ({len(samples)} compared)"),
                    metric="energy",
                    unit="kWh",
                    observed=round(observed, 4),
                    baseline=round(centre, 4),
                    delta=round(rise, 4),
                    window_days=len(totals),
                    confidence=round(min(1.0, 0.5 + 0.1 * len(samples)), 3),
                    completeness=round(min(1.0, len(totals) / float(WINDOW_DAYS)), 3),
                    dedup_key=dedup_key(self.name, statistic_id),
                )
        return worst


register(LevelAnomaly())
