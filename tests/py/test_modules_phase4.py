"""`level_anomaly` and `sensor_health`, and the history measurement they need.

Phase 4's gate is zero false positives over 30 days, so the negatives here
outnumber the positives on purpose. Every fixture uses Home Assistant's real
wire format — epoch milliseconds — because writing them the convenient way is
what hid a total failure through all of Phase 3.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Sequence

from reports.analysis import ModuleContext
from reports.analysis.base import Finding
from reports.analysis.modules.level_anomaly import WEEKDAY_NAME, LevelAnomaly
from reports.analysis.modules.sensor_health import SensorHealth

NOW = datetime(2026, 8, 20, 7, 0, tzinfo=timezone.utc)
#: 2026-06-01 is a Monday, so weekday arithmetic in these fixtures is readable.
START = datetime(2026, 6, 1, tzinfo=timezone.utc)


def _ms(day_index: int, hour: int) -> int:
    moment = START + timedelta(days=day_index, hours=hour)
    return int(moment.timestamp() * 1000)


def _day(day_index: int, per_hour: float, hours: int = 24) -> List[Dict[str, Any]]:
    return [{"start": _ms(day_index, h), "change": per_hour} for h in range(hours)]


def _flat(days: int, per_hour: float) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for index in range(days):
        rows += _day(index, per_hour)
    return rows


def _context(ids: Sequence[str], series: Dict[str, Any], **kw: Any) -> ModuleContext:
    async def fetch(want: Sequence[str], days: int) -> Dict[str, Any]:
        return series

    base: Dict[str, Any] = {
        "audience": "owner", "cadence": "weekly", "now_local": NOW,
        "capabilities": ["statistics", "energy_devices"],
        "inventory": {"energy": {"devices": list(ids)}},
        "settings": {}, "min_history_days": 14, "stats": fetch, "labels": {},
    }
    base.update(kw)
    return ModuleContext(**base)


def _run(module: Any, series: Dict[str, Any], **kw: Any) -> List[Finding]:
    return asyncio.run(module.run(_context(list(series), series, **kw)))


# ── level_anomaly ────────────────────────────────────────────────────────────

def test_a_steady_device_produces_nothing() -> None:
    assert _run(LevelAnomaly(), {"sensor.a_energy": _flat(56, 0.5)}) == []


def test_the_weekend_is_not_an_anomaly() -> None:
    """⚠️ THE REASON PER-WEEKDAY IS MANDATORY, as a test.

    A villa used heavily at weekends and lightly midweek. Against a POOLED
    baseline every Saturday is several sigmas high and the module fires every
    week forever — a detector that goes off on the calendar, which is the
    fastest possible route to being switched off. Against a per-weekday
    baseline it is silent, because Saturday is compared to other Saturdays.
    """
    rows: List[Dict[str, Any]] = []
    for index in range(56):
        weekday = (START + timedelta(days=index)).weekday()
        rows += _day(index, 2.0 if weekday >= 5 else 0.4)
    assert _run(LevelAnomaly(), {"sensor.a_energy": rows}) == [], (
        "weekend usage must not be reported as an anomaly")


def test_a_genuine_spike_on_one_weekday_is_found() -> None:
    """The same villa, but one recent Wednesday is several times its normal.

    Eight weeks, because a four-sample baseline is what produced twelve
    findings on the first live run.
    """
    rows: List[Dict[str, Any]] = []
    spike_day = 51                       # inside the final week
    for index in range(56):
        weekday = (START + timedelta(days=index)).weekday()
        base = 2.0 if weekday >= 5 else 0.4
        if index == spike_day:
            base = 2.0
        rows += _day(index, base)
    expected = WEEKDAY_NAME[(START + timedelta(days=spike_day)).weekday()]
    findings = _run(LevelAnomaly(), {"sensor.a_energy": rows})
    assert len(findings) == 1, findings
    assert expected in findings[0].detail
    assert findings[0].kind == "ANOMALY"


def test_too_few_samples_of_that_weekday_is_silent() -> None:
    """Two Tuesdays are not a baseline, and "not enough Tuesdays" is not a
    finding about the equipment."""
    rows: List[Dict[str, Any]] = []
    for index in range(10):
        rows += _day(index, 5.0 if index == 9 else 0.4)
    assert _run(LevelAnomaly(), {"sensor.a_energy": rows}) == []


def test_a_device_that_used_LESS_is_not_reported() -> None:
    rows: List[Dict[str, Any]] = []
    for index in range(56):
        rows += _day(index, 0.1 if index >= 49 else 1.0)
    assert _run(LevelAnomaly(), {"sensor.a_energy": rows}) == []


def test_a_perfectly_constant_device_needs_a_real_rise() -> None:
    """⚠️ MAD of zero again. A device using exactly the same amount every
    Tuesday has no spread, so any difference is "infinite sigmas" — the
    relative test alone must decide, or the quietest equipment becomes the
    noisiest finding."""
    rows: List[Dict[str, Any]] = []
    for index in range(56):
        rows += _day(index, 1.0 * (1.05 if index == 52 else 1.0))
    assert _run(LevelAnomaly(), {"sensor.a_energy": rows}) == [], (
        "a 5% difference on a zero-spread device is not an anomaly")


def test_level_anomaly_demands_real_history() -> None:
    """Stated as a property, because the cost of a per-weekday baseline IS the
    history it needs and working around it would defeat the point. Raised from
    four weeks to six after four-sample baselines produced twelve findings from
    eighteen meters on the first live run."""
    assert LevelAnomaly().min_days >= 42


# ── sensor_health ────────────────────────────────────────────────────────────

def test_healthy_meters_produce_nothing() -> None:
    series = {"sensor.a_energy": _flat(28, 0.5), "sensor.b_energy": _flat(28, 0.7)}
    assert _run(SensorHealth(), series) == []


def test_a_silent_meter_is_reported_as_data_quality() -> None:
    """⚠️ NOT an ANOMALY. A measurement fault is not an equipment fault, and
    reporting the second as the first sends someone to check a freezer that is
    fine."""
    healthy = _flat(28, 0.5)
    stopped: List[Dict[str, Any]] = []
    for index in range(20):          # stops eight days early
        stopped += _day(index, 0.5)
    findings = _run(SensorHealth(),
                    {"sensor.a_energy": healthy, "sensor.b_energy": stopped})
    assert len(findings) == 1
    assert findings[0].kind == "DATA_QUALITY"
    assert "reported nothing" in findings[0].detail


def test_a_brief_gap_is_not_a_fault() -> None:
    """Below the bar, a recorder restart would report every meter in the house
    as broken."""
    healthy = _flat(28, 0.5)
    blipped: List[Dict[str, Any]] = []
    for index in range(27):          # one day behind
        blipped += _day(index, 0.5)
    assert _run(SensorHealth(),
                {"sensor.a_energy": healthy, "sensor.b_energy": blipped}) == []


def test_a_whole_recorder_outage_reports_nothing() -> None:
    """⚠️ THE REFERENCE IS THE OTHER METERS, NOT THE CLOCK. If Home Assistant
    has been down for a week, every meter is equally behind — the recorder is
    late, not the equipment. Comparing to the clock would report the entire
    property as broken, every pass, until someone noticed."""
    series = {f"sensor.{name}_energy": _flat(20, 0.5) for name in "abc"}
    assert _run(SensorHealth(), series) == []


def test_a_step_change_between_two_constants_is_not_stuckness() -> None:
    """⚠️ This test previously asserted the OPPOSITE, and was wrong.

    Constant at one level, then constant at another, is a meter that CHANGED
    VALUE — so it is plainly not frozen. It is a load change, which is a
    different module's question. The original fixture was written to satisfy
    the naive "every recent day is identical" rule and stopped describing
    stuckness the moment that rule was corrected to require prior variation.
    """
    rows: List[Dict[str, Any]] = []
    for index in range(28):
        rows += _day(index, 0.5 if index < 21 else 0.25)
    assert _run(SensorHealth(), {"sensor.a_energy": rows}) == []


def test_a_meter_reading_zero_is_not_called_stuck() -> None:
    """A holiday home's pool pump in winter reads zero for weeks and is
    perfectly healthy."""
    assert _run(SensorHealth(), {"sensor.a_energy": _flat(28, 0.0)}) == []


def test_silence_outranks_stuckness() -> None:
    """A meter that went silent should be reported as silent, not as frozen —
    it is the more actionable of the two."""
    healthy = _flat(28, 0.5)
    dead: List[Dict[str, Any]] = []
    for index in range(15):
        dead += _day(index, 0.5)
    findings = _run(SensorHealth(),
                    {"sensor.a_energy": healthy, "sensor.b_energy": dead})
    assert len(findings) == 1
    assert "reported nothing" in findings[0].detail


# ── history measurement ──────────────────────────────────────────────────────

def test_history_is_measured_not_assumed() -> None:
    """⚠️ THE GATE READ THE OPERATOR'S PREFERENCE AND CALLED IT THE RECORDER'S
    DEPTH. Harmless while every module wanted 14 days and the default was 14;
    it breaks silently the moment one wants more — `level_anomaly` needs 28 and
    would have been skipped forever with "has 14", a number nobody measured.
    """
    from reports.pipeline import measure_history

    series = {"sensor.a_energy": _flat(40, 0.5)}

    async def fetch(ids: Sequence[str], days: int) -> Dict[str, Any]:
        return series

    assert asyncio.run(measure_history(fetch, ["sensor.a_energy"])) == 40


def test_history_takes_the_longest_of_several_meters() -> None:
    """The shortest would be whichever meter was added most recently, which
    would report an established property as having no history."""
    from reports.pipeline import measure_history

    series = {"sensor.new_energy": _flat(3, 0.5),
              "sensor.old_energy": _flat(45, 0.5)}

    async def fetch(ids: Sequence[str], days: int) -> Dict[str, Any]:
        return series

    got = asyncio.run(measure_history(fetch, ["sensor.new_energy", "sensor.old_energy"]))
    assert got == 45


def test_no_statistics_is_no_history() -> None:
    from reports.pipeline import measure_history

    async def fetch(ids: Sequence[str], days: int) -> Dict[str, Any]:
        return {}

    assert asyncio.run(measure_history(fetch, [])) == 0
    assert asyncio.run(measure_history(fetch, ["sensor.a"])) == 0


def test_a_device_that_was_ALWAYS_constant_is_not_called_stuck() -> None:
    """⚠️ THE FALSE POSITIVE THE FIRST VERSION SHIPPED WITH.

    "Every day is exactly the same" flags any genuinely constant load — a
    template sensor, a fixed appliance, anything that simply does the same
    thing daily. Phase 4's gate is ZERO false positives, so the claim has to be
    about a CHANGE: this meter varied before and does not now.
    """
    assert _run(SensorHealth(), {"sensor.a_energy": _flat(28, 0.5)}) == []


def test_a_meter_that_stopped_varying_IS_called_stuck() -> None:
    """The other half — suppressing the case above must not suppress a real
    frozen meter."""
    rows: List[Dict[str, Any]] = []
    for index in range(28):
        per_hour = 0.25 if index >= 21 else (0.4 + 0.05 * (index % 4))
        rows += _day(index, per_hour)
    findings = _run(SensorHealth(), {"sensor.a_energy": rows})
    assert len(findings) == 1
    assert "varied from day to day" in findings[0].detail
