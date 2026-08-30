"""The trend layer can finally see a device that ran SHORT.

⚠️ EVERY STATISTICAL CHECK THIS ADD-ON SHIPPED WATCHED FOR MORE (2026-08-30).
`level_anomaly` computes `rise = (observed - centre) / centre` and skips
anything under its threshold, so a negative rise is unreachable by construction
— a pump using half its usual energy could not be reported by any module.

⚠️ THE REFLEX SEES THE CLIFF, THIS SEES THE SLOPE. A pool pump stopping 40
minutes into a 90-minute window trips the schedule watchdog. A pump stopping ten
minutes early EVERY day never trips a fifteen-minute grace and loses over an
hour a week. Only the second is this module's business.
"""
from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.shared.analysis.base import ModuleContext  # noqa: E402
from vesta.shared.analysis.modules.level_shortfall import LevelShortfall  # noqa: E402


def _rows(daily: List[float]) -> List[Dict[str, Any]]:
    """Statistics rows as the pipeline delivers them: HOURLY `change` values.

    ⚠️ HOURLY, NOT DAILY — my first fixture emitted one row per day and
    `daily_totals` returned nothing at all, so every assertion passed on an
    empty result. `complete_days` requires MIN_HOURS_PER_DAY readings before a
    day counts, which is exactly the guard that made the empty fixture silent
    rather than loud.
    """
    from datetime import datetime, timedelta
    out: List[Dict[str, Any]] = []
    start = datetime(2026, 6, 1)
    for offset, total in enumerate(daily):
        midnight = start + timedelta(days=offset)
        for hour in range(24):
            out.append({
                "start": (midnight + timedelta(hours=hour)).isoformat() + "+00:00",
                "change": total / 24.0,
            })
    return out


def _context(series: Dict[str, List[Dict[str, Any]]]) -> ModuleContext:
    async def stats(ids: Any, days: int) -> Dict[str, Any]:
        return series

    return ModuleContext(
        audience="owner", cadence="daily", now_local=None,
        capabilities=["statistics", "energy_devices"],
        inventory={"energy": {"devices": list(series)}},
        stats=stats, labels={"sensor.pool_pump_energy": "Pool Pump"})


def _run(series: Dict[str, List[Dict[str, Any]]]) -> List[Any]:
    return asyncio.run(LevelShortfall().run(_context(series)))


#: A pump that used ~5.6 kWh every day for seven weeks, then ~3.0 for a week.
STEADY = [5.6, 5.5, 5.7, 5.6, 5.5, 5.6, 5.7] * 7


def test_a_device_that_ran_short_is_reported() -> None:
    daily = STEADY + [3.0, 3.1, 2.9, 3.0, 3.1, 2.9, 3.0]
    found = _run({"sensor.pool_pump_energy": _rows(daily)})

    assert found, "a device using half its usual energy was not reported"
    detail = found[0].detail
    assert "less on" in detail, detail
    # ⚠️ `ANOMALY`, THE EXISTING KIND — not one of its own. `FINDING_KIND` is a
    # cross-artefact contract mirrored in TypeScript, and it already defines
    # ANOMALY as "a departure from this equipment's own baseline", which is
    # precisely what a shortfall is. WHICH module spoke travels in `dedup_key`,
    # so widening a shared enum would buy a distinction that already exists.
    assert found[0].kind == "ANOMALY"
    assert found[0].dedup_key.startswith("level_shortfall:"), found[0].dedup_key
    assert (found[0].observed or 0) < (found[0].baseline or 0)


def test_a_device_running_NORMALLY_is_silent() -> None:
    """⚠️ THE COMMON CASE IS SILENCE, and a check that reports every week is one
    nobody reads by the second week."""
    assert _run({"sensor.pool_pump_energy": _rows(STEADY + STEADY[:7])}) == []


def test_a_RISE_is_not_this_module_s_business() -> None:
    """⚠️ `level_anomaly` OWNS "MORE". Reporting it here would double every
    finding on the page — the two modules must not overlap."""
    daily = STEADY + [11.0, 11.2, 10.9, 11.1, 11.0, 11.2, 10.9]
    assert _run({"sensor.pool_pump_energy": _rows(daily)}) == []


def test_INTERMITTENT_equipment_is_refused() -> None:
    """⚠️ THE GUARD THAT MATTERS MOST FOR A DROP. A sauna used on some weeks and
    not others has no normal to fall short of; without this every discretionary
    load in the villa reports on every quiet week, which is exactly the alert
    fatigue this tier exists to avoid.

    ⚠️ THE PATTERN MUST VARY BETWEEN WEEKS, NOT JUST WITHIN ONE. My first
    fixture was a 7-day list repeated, which gives every weekday a perfectly
    consistent history — the module compares like weekday with like weekday, so
    a periodic fixture is the MOST stable input there is and the guard it was
    meant to exercise was never reached. Real intermittent equipment is used on
    different days in different weeks, which is what this now says."""
    weeks = [
        [6.0, 0.0, 0.0, 5.5, 0.0, 6.2, 0.0],
        [0.0, 5.8, 0.0, 0.0, 6.1, 0.0, 5.9],
        [5.7, 0.0, 6.0, 0.0, 0.0, 0.0, 6.3],
        [0.0, 0.0, 5.6, 6.0, 0.0, 5.8, 0.0],
        [6.1, 0.0, 0.0, 0.0, 5.9, 0.0, 0.0],
        [0.0, 6.2, 0.0, 5.7, 0.0, 0.0, 6.0],
        [5.5, 0.0, 6.1, 0.0, 6.0, 0.0, 0.0],
    ]
    daily = [v for week in weeks for v in week] + [0.0] * 7
    assert _run({"sensor.sauna_energy": _rows(daily)}) == []


def test_a_drop_on_a_device_s_QUIET_day_is_not_worth_a_morning() -> None:
    """⚠️ MATERIALITY, THE RULE `standby_creep` LEARNED, APPLIED DOWNWARD.

    ⚠️ AND IT IS DIMENSIONLESS, WHICH IS NOT WHAT I FIRST WROTE. My first
    fixture was a doorbell going from 8 Wh to 4 Wh, on the assumption that
    `is_material` carries an absolute floor. It does not, deliberately and at
    length in its own header: a threshold with a unit on it is tuned against one
    property's meters and wrong on the next, so that doorbell IS reported and
    `level_anomaly` would report the same rise. Asserting otherwise would have
    pinned a rule the tree does not have.

    What the guard really does is compare the fall against what this equipment
    does WHEN IT WORKS. Here a machine runs hard at the weekend and barely
    midweek; a 60% fall on a quiet Monday is 30 Wh against a 12 kWh Saturday,
    and nobody should be told about it."""
    weekend_machine = [0.05, 0.05, 0.05, 0.05, 12.0, 12.0, 12.0] * 7
    daily = weekend_machine + [0.02, 0.05, 0.05, 0.05, 12.0, 12.0, 12.0]
    assert _run({"sensor.workshop_energy": _rows(daily)}) == []


def test_it_reports_the_WORST_day_not_every_day() -> None:
    """One pump stopping early all week is one finding, not seven."""
    daily = STEADY + [3.0, 2.0, 3.1, 3.0, 2.9, 3.0, 3.1]
    found = _run({"sensor.pool_pump_energy": _rows(daily)})
    assert len(found) == 1, f"{len(found)} findings for one device"


def test_it_declares_the_retired_rule_it_replaces() -> None:
    """⚠️ NAMED, NOT IMPLIED. `roi_runtime_cap` was retired at the cutover with
    nothing named to take it over; `superseded_by` is how that claim is made
    checkable rather than asserted in prose."""
    assert "roi_runtime_cap" in LevelShortfall().superseded_by


def test_it_is_registered_and_reaches_the_brief() -> None:
    """⚠️ A MODULE THAT EXISTS BUT IS NOT REGISTERED IS INVISIBLE, and fails as
    "it found nothing" — indistinguishable from working."""
    from vesta.brief import registry
    names = [m.name for m in registry.registered()]
    assert "level_shortfall" in names, names


def test_a_SHALLOW_drop_is_below_the_threshold() -> None:
    """⚠️ `DEFAULT_DROP_FRACTION`, PINNED ON ITS OWN.

    Mutation testing found it free: setting it to zero left the suite green,
    because every "should be silent" fixture here is ALSO refused by
    materiality or by the sigma gate, so three guards overlapped and the one
    named in the module docstring was never the one deciding.

    A fifth of a pump's usual day is a big, clearly material, many-sigma fall —
    and it is still the kind of variation a villa produces by living in it. The
    threshold is what says so, and this is the only test it can fail."""
    daily = STEADY + [4.5, 4.4, 4.5, 4.5, 4.4, 4.5, 4.5]
    assert _run({"sensor.pool_pump_energy": _rows(daily)}) == []


def test_the_WORST_day_is_the_one_reported() -> None:
    """⚠️ NOT MERELY *ONE* FINDING — THE RIGHT ONE.

    `_assess` returns a single finding per device whatever it does, so the
    count assertion above stays green even if the loop keeps the LAST day it
    looked at instead of the deepest. Mutation testing caught that: replacing
    the comparison with `if True` changed which day is named and nothing
    noticed. An owner acting on this reads the day."""
    # Tuesday is the deep one; Sunday is last in the window and shallower.
    daily = STEADY + [3.0, 1.2, 3.1, 3.0, 2.9, 3.0, 3.1]
    found = _run({"sensor.pool_pump_energy": _rows(daily)})
    assert len(found) == 1, f"{len(found)} findings for one device"
    assert "Tuesday" in found[0].detail, found[0].detail
    assert (found[0].observed or 0) < 2.0, found[0].observed
