"""A device that used markedly LESS than it normally does on this weekday.

⚠️ THE TREND LAYER WAS ONE-SIDED AND NOBODY HAD NOTICED (2026-08-30).
`level_anomaly` computes `rise = (observed - centre) / centre` and skips
anything below its threshold, so a negative rise — a device that ran SHORT — can
never be reported. Every check that watched a LEVEL watched for more: this one
and `standby_creep`, which measures a rise off an idle floor. (`sensor_health`
does watch for absence, but of READINGS — the instrument going quiet, not the
equipment doing less, which is a different question with a different fix.)

⚠️ THE CASE THAT FOUND IT. A pool pump stopped 40 minutes into a 90-minute
window. The reflex automation caught that one, correctly, because it was a clean
stop inside a declared window. What no layer catches is the SLOW version: a pump
that stops ten minutes early every day never trips a fifteen-minute grace and
loses over an hour of filtration a week, invisibly. The reflex sees the cliff;
this sees the slope. That is the whole reason it is a separate tier.

⚠️ IT IS NOT A RUNTIME CHECK, AND CANNOT BE. A module is handed daily totals —
`ModuleContext` deliberately carries no session, no schedule entity and no
intra-day resolution, because a module that could open its own queries would
stop the scheduler being able to bound a pass. So "ran 50 of 90 minutes" is not
expressible here; "used 43% less energy than it normally does on a Wednesday"
is, and it is the same fault seen through the meter the villa already has.

⚠️ A SEPARATE MODULE RATHER THAN A SECOND BRANCH IN `level_anomaly`, for three
reasons. Its false positives come from somewhere completely different — an
empty villa depresses everything at once, where a rise does not — so it needs
its own threshold and deserves its own switch. The registry gates and skips per
module, so an owner can turn this off without losing "used more". And a change
inside a shipping module risks the findings that already work; a new file
cannot.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from ..base import (Finding, ModuleContext, dedup_key, subject_key, label_for,
                    resolve_threshold)
from ..materiality import has_stable_baseline, is_material
from ..robust import median, robust_sigma
from ..series import daily_totals, weekday_of

#: Same window as `level_anomaly`, and for the same reason: eight weeks gives
#: eight samples of each weekday, where four makes one unusual Friday move the
#: median enough to indict the next ordinary one.
WINDOW_DAYS = 56

#: ⚠️ STRICTER THAN THE RISE THRESHOLD (0.30), DELIBERATELY. A drop has a large
#: innocent explanation that a rise does not — the property was empty, or used
#: less — and that explanation moves many devices at once. Requiring a device to
#: have used less than three-fifths of its own normal keeps this to genuine
#: shortfalls rather than a quiet week.
DEFAULT_DROP_FRACTION = 0.40

#: Robust sigmas below the same-weekday median. Both this and the fraction must
#: pass, for the reason `level_anomaly` records: on very consistent equipment
#: the spread is near zero and any difference is "many sigmas".
DEFAULT_SIGMA = 4.0

#: Samples of the same weekday needed before a comparison is attempted.
MIN_SAMEDAY_SAMPLES = 4

#: ⚠️ THE SMALLEST WEEK THIS WEEKDAY HAS EVER HAD, AS A FRACTION OF ITS MEDIAN
#: — the guard `has_stable_baseline` cannot supply here, added because the test
#: caught this module reporting an intermittent sauna (2026-08-30).
#:
#: A shortfall check needs something a RISE check does not: to say a machine
#: "ran short", it has to normally RUN. `has_stable_baseline` was doing that job
#: in the docstring only. Its spread is MAD-based, and MAD collapses on exactly
#: the population that matters here — a sauna used on four Mondays out of seven
#: has a median sitting ON the running level and three zeros that barely move
#: the MAD, so it reads as *stable* and the first unused Monday is reported as
#: "100% less than normal". True, and meaningless: nobody used the sauna.
#:
#: A minimum is the right statistic precisely because it is not robust. One
#: unused week is all it takes to prove this weekday is discretionary, and one
#: is what the median is designed to shrug off.
MIN_SAMPLE_OF_MEDIAN = 0.50

#: How many recent days to examine.
RECENT_DAYS = 7

WEEKDAY_NAME = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                "Saturday", "Sunday")


class LevelShortfall:
    """Consumption well below this device's own normal for that weekday."""

    name: str = "level_shortfall"
    title: str = "Ran short for the day of week"
    description: str = (
        "Finds equipment that used markedly less than it normally does on that "
        "same weekday — a pump or a filter that is stopping early, or not "
        "running its full cycle, before anyone notices the water.")
    requires: Sequence[str] = ("statistics", "energy_devices")
    audiences: Sequence[str] = ("owner", "facility")
    min_days: int = 42
    #: ⚠️ THE RETIRED RULE WHOSE JOB THIS IS, BY STEM. `roi_runtime_cap` watched
    #: for a device failing to complete its expected runtime and was retired at
    #: the cutover with nothing named to replace it — the gap this fills.
    superseded_by: Sequence[str] = ("roi_runtime_cap",)

    rejected: List[Dict[str, Any]]

    async def run(self, context: ModuleContext) -> List[Finding]:
        energy = context.inventory.get("energy") or {}
        candidates = energy.get("devices")
        if not isinstance(candidates, list) or not candidates:
            return []

        ids = [str(i) for i in candidates if isinstance(i, str)]
        series = await context.stats(ids, WINDOW_DAYS)
        zone = getattr(context, "zone", None)

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
                continue

            # The general "is there a normal here at all" test, shared with
            # `level_anomaly`. ⚠️ IT IS NOT THE ONE THAT KEEPS THE SAUNA QUIET,
            # although this comment claimed exactly that until a test disproved
            # it: its spread is MAD-based and MAD collapses on an on/off
            # population, so a device used most weeks reads as perfectly stable.
            # MIN_SAMPLE_OF_MEDIAN below is what actually does that job.
            if not has_stable_baseline(samples):
                continue

            centre = median(samples)
            spread = robust_sigma(samples)
            observed = totals[day]
            if centre is None or centre <= 0:
                continue

            # ⚠️ HAS IT EVER SKIPPED THIS WEEKDAY? Then it is discretionary and
            # a quiet week is not a fault. See MIN_SAMPLE_OF_MEDIAN — this is
            # the guard the stable-baseline test only appears to give us.
            if min(samples) < MIN_SAMPLE_OF_MEDIAN * centre:
                continue

            drop = (centre - observed) / centre
            sigma_threshold = resolve_threshold(
                context.settings, "sigma", None, DEFAULT_SIGMA)
            drop_threshold = resolve_threshold(
                context.settings, "drop_fraction", None, DEFAULT_DROP_FRACTION)

            if drop < drop_threshold:
                continue

            # ⚠️ MATERIAL AGAINST WHAT THIS DEVICE DOES WHEN IT WORKS — and
            # `materiality`'s rule is DIMENSIONLESS on purpose, so this is not
            # a kWh floor and must never become one: a threshold with a unit on
            # it is tuned against one property's meters and wrong on the next.
            # ⚠️ SO IT BINDS IN A NARROWER CASE THAN IT LOOKS, and the case is
            # real: `drop_threshold` has already demanded 40% of the WEEKDAY
            # median, so this can only refuse when that weekday is a small part
            # of the device's own working level — equipment that runs hard on
            # some days and barely on others, where a 60% fall on a quiet
            # Monday is noise beside what it does on a Saturday.
            if not is_material(centre - observed, list(totals.values())):
                continue

            if spread is not None and (centre - observed) < sigma_threshold * spread:
                continue

            name = WEEKDAY_NAME[weekday] if 0 <= weekday < 7 else "that day"
            finding = Finding(
                ref=f"s{index}",
                # ⚠️ `ANOMALY`, NOT A NEW KIND. `FINDING_KIND` defines it as
                # "a departure from this equipment's own baseline", which is
                # exactly what a shortfall is — and that enum is a
                # cross-artefact contract mirrored in TypeScript, so widening
                # it for something the vocabulary already covers is the kind of
                # unreachable value this project removed one release ago.
                # WHICH check produced a finding already travels in
                # `dedup_key`, so nothing downstream loses the distinction.
                kind="ANOMALY",
                severity="warning" if drop >= drop_threshold * 1.5 else "notice",
                label=label_for(statistic_id, context.labels),
                detail=(f"used about {round(drop * 100)}% less on "
                        f"{name} than it normally does on a "
                        f"{name} ({len(samples)} compared)"),
                metric="energy",
                unit="kWh",
                observed=round(observed, 4),
                baseline=round(centre, 4),
                delta=round(drop, 4),
                window_days=len(totals),
                confidence=round(min(1.0, 0.5 + 0.1 * len(samples)), 3),
                completeness=round(min(1.0, len(totals) / float(WINDOW_DAYS)), 3),
                dedup_key=dedup_key(self.name, statistic_id),
                subject_key=subject_key(statistic_id),
            )
            # ⚠️ THE WORST DAY IN THE WINDOW, NOT EVERY DAY. A pump that has
            # been stopping early all week is one finding about one pump, not
            # seven — the same choice `level_anomaly` makes, and the reason a
            # reader can act on this page at all.
            if worst is None or (finding.delta or 0.0) > (worst.delta or 0.0):
                worst = finding
        return worst
