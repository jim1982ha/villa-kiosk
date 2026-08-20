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

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

from ..base import Finding, ModuleContext, dedup_key, resolve_threshold
from ..registry import register
from ..robust import median, percentile, relative_change, robust_sigma

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


def _day_key(start: Any, zone: Any) -> str:
    """The LOCAL calendar day a statistics row belongs to.

    ⚠️ HOME ASSISTANT SENDS `start` AS EPOCH MILLISECONDS, not an ISO string,
    and this cost Phase 3 its first live run. The original code did
    `str(start)[:10]`, which is correct for `"2026-07-01T00:00:00"` and
    catastrophic for `1755648000000`: the first ten characters of a
    millisecond timestamp change every hour, so EVERY HOUR became its own day,
    every bucket held one row, the "at least half a day of readings" guard
    dropped all of them, and every meter returned no floors at all.

    The failure was silent and total — 18 meters, 11,859 rows, zero findings at
    every threshold down to 3%. And every unit test passed, because the
    fixtures were written from the same wrong assumption as the code. That is
    the real lesson: a fixture invented by the author of the code under test
    proves only that they are consistent with each other.

    Both forms are accepted, because HA changed this and may again, and a
    module that only understands the current wire format breaks on upgrade.

    LOCAL, not UTC: "a day" means the villa's day. On a UTC+8 property, UTC
    bucketing would split every local day across two buckets and put the small
    hours — exactly when a device is idle — in the wrong one.
    """
    if isinstance(start, bool) or start is None:
        return ""
    if isinstance(start, (int, float)):
        seconds = float(start)
        # Epoch seconds are ~1.7e9 today; milliseconds ~1.7e12. Anything past
        # 1e11 is milliseconds by a margin of three decades either way.
        if seconds > 1e11:
            seconds /= 1000.0
        try:
            moment = datetime.fromtimestamp(seconds, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return ""
        if zone is not None:
            moment = moment.astimezone(zone)
        return moment.strftime("%Y-%m-%d")
    text = str(start)
    return text[:10] if len(text) >= 10 else ""


def _daily_idle_floors(rows: List[Dict[str, Any]],
                       zone: Any = None) -> List[float]:
    """One idle floor per day, from that day's hourly `change` values.

    Rows are hourly. A day with too few readings to have a floor is DROPPED
    rather than filled — a floor computed from three hours is not a floor, and
    inventing one is how a gap in the recorder becomes a finding about a pump.
    """
    by_day: Dict[str, List[float]] = {}
    for row in rows:
        change = row.get("change")
        start = row.get("start")
        if not isinstance(change, (int, float)) or isinstance(change, bool):
            continue
        if change < 0:
            # A negative change means the meter reset (total_increasing allows
            # it). The hour is unusable; the day may still be fine.
            continue
        day = _day_key(start, zone)
        if not day:
            continue
        by_day.setdefault(day, []).append(float(change))

    floors: List[float] = []
    for day in sorted(by_day):
        hours = by_day[day]
        if len(hours) < 12:      # half a day of readings, at minimum
            continue
        floor = percentile(hours, IDLE_PERCENTILE)
        if floor is not None:
            floors.append(floor)
    return floors


def _label_for(statistic_id: str, labels: Dict[str, str]) -> str:
    """What to call this device in the report.

    Falls back to a humanised form of the id rather than printing the id
    itself — `sensor.pool_pump_energy` in prose reads as a database row, and
    the entity id is exactly what must not travel in Phase 6.
    """
    known = labels.get(statistic_id)
    if known:
        return known
    tail = statistic_id.split(".", 1)[-1]
    for suffix in ("_energy", "_power", "_consumption"):
        if tail.endswith(suffix):
            tail = tail[: -len(suffix)]
            break
    return tail.replace("_", " ").strip().title() or statistic_id


class StandbyCreep:
    """Idle draw that has risen against the device's own baseline."""

    # Annotated as Sequence, not left to inference: the Protocol declares
    # mutable attributes, so a bare tuple literal infers as `tuple[str, str]`
    # and fails the structural match invariantly. mypy --strict catches it;
    # nothing at runtime would.
    name: str = "standby_creep"
    requires: Sequence[str] = ("statistics", "energy_devices")
    audiences: Sequence[str] = ("owner", "facility")
    min_days: int = 14

    #: Filled per run when diagnostics are wanted; read by the preview.
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
        zone = getattr(context.now_local, "tzinfo", None)
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

        label = _label_for(statistic_id, context.labels)
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
            "label": _label_for(statistic_id, context.labels),
            "reason": reason,
            "rise": round(rise, 4),
            "observed": round(recent, 6),
            "baseline": round(baseline, 6),
            "active_level": round(active, 6) if active is not None else None,
            "rise_of_active": (round((recent - baseline) / active, 4)
                               if active else None),
        })


register(StandbyCreep())
