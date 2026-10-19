"""A device's day: one "running" and one step for every page (architecture review 13, 2026-10-09).

The night check, the energy figures and the filtration optimiser each computed when a pump runs, and only the night
check's copy had the baseline cap and the floor; the weekly page found a power step its own way, noise included."""
import os
import re

from vesta_shared import daily
from vesta_shared.params import VillaParams

HERE = os.path.dirname(__file__)
T0 = 1_759_276_800_000                      # 2026-10-01 00:00 UTC, in ms as Home Assistant gives it
SKILLS = os.path.join(HERE, "..", "starter", "skills")


def _params(baseline_w=None):
    helpers, states = [], {}
    if baseline_w is not None:
        helpers = [{"entity_id": "input_number.pump_baseline_w", "helper_type": "input_number", "id": "pump_baseline_w"}]
        states = {"input_number.pump_baseline_w": str(baseline_w)}
    return VillaParams(helpers=helpers, states=states, defaults={"on_threshold_fraction": 0.2, "on_threshold_floor_w": 1.0})


def _hours(maxes):
    return [{"start": T0 + h * 3_600_000, "mean": m * 0.9, "min": m * 0.8, "max": m} for h, m in enumerate(maxes)]


def test_running_is_a_fraction_of_the_typical_peak_capped_by_the_baseline():
    rows = _hours([1000] * 6)
    assert daily.running_threshold({}, rows, _params()) == 200                       # 0.2 × the typical 1000 W
    pump = {"baseline_helper": "input_number.pump_baseline_w"}
    assert daily.running_threshold(pump, rows, _params(baseline_w=500)) == 100       # capped: 0.2 × the 500 W baseline
    assert daily.running_threshold({}, [], _params()) == 1.0                         # nothing to judge from: the floor
    thr, days = daily.power_days(pump, rows, "UTC", _params(baseline_w=500))
    assert thr == 100 and days                                                       # every reader gets the cap


def test_a_device_that_never_peaked_asks_for_no_floor():
    # roi-energy has no floor setting: its run hours are 0 whatever the threshold, so none is asked for
    no_floor = VillaParams(defaults={"on_threshold_fraction": 0.2})
    thr, days = daily.power_days({}, [{"start": T0, "mean": 3.0}], "UTC", no_floor)
    assert thr == 0.0 and all(d["run_hours"] == 0 for d in days.values())


def test_no_script_keeps_its_own_running_threshold():
    for skill, script in (("preventive-maintenance", "nightly.py"), ("roi-energy", "energy_period.py"),
                          ("roi-energy", "filtration_optimiser.py")):
        src = open(os.path.join(SKILLS, skill, "scripts", script)).read()
        assert not re.search(r"behaviour\(\s*\"on_threshold_fraction\"", src), script   # asked of vesta_shared.daily


def test_the_weekly_page_finds_a_step_the_way_the_night_check_does():
    import sys
    sys.path.insert(0, os.path.join(SKILLS, "reports", "scripts"))
    import facts
    import playbook
    assert playbook._best_split([100, 100, 100, 100, 100, 60, 60, 60, 60, 60], 3) == (5, -40.0)   # a real step
    assert playbook._best_split([100, 80, 100, 80, 100, 80, 100, 80, 100, 80], 3) is None        # noise: no step


def _h(pairs):
    return [{"start": T0 + h * 3_600_000, "mean": m, "max": x, "min": 0.0} for h, (m, x) in enumerate(pairs)]


def test_a_pump_that_runs_in_bursts_counts_the_minutes_it_ran():
    # owner, 2026-10-19: a 3 kW pressure pump, a few minutes of bursts in most hours — the night check read 0 h
    # (no hourly MEAN reaches a fraction of 3 kW) and the weekly page 18 h; 3.0 kWh at 3 kW is about 1 h
    rows = _h([(300.0, 3000.0)] * 10 + [(0.5, 2.0)] * 14)
    thr, days = daily.power_days({}, rows, "UTC", _params())
    (day,) = days.values()
    assert thr == 600 and day["run_hours"] == 1.0                       # 10 hours of 300 W ÷ 3000 W peaks
    assert day["draw_w"] == 3000 and day["running_power"] is None       # no steady hour: what it drew while running


def test_the_typical_peak_is_where_the_energy_went():
    idle = [(0.1, 10.0)] * 16                                            # a pool pump's idle noise: 10 W peaks
    assert daily.typical_peak(_h(idle + [(750.0, 800.0)] * 8)) == 800    # not the idle median of every hour
    spikes = [(40.0, 7000.0)] * 4                                        # four start-ups of a 1 kW jacuzzi pump
    assert daily.typical_peak(_h(idle + spikes + [(950.0, 1000.0)] * 14)) == 1000
    glitch = [(34.0, 546.0)]                                             # one bad reading of a 34 W pump
    assert daily.typical_peak(_h(glitch + [(33.5, 34.0)] * 300)) == 34
    assert daily.typical_peak(_h([(0.0, 2.0)] * 3)) == 2                 # drew nothing: the plain median
    assert daily.typical_peak(_h([(0.0, 0.0)])) is None


def test_a_series_keeps_one_measure_of_power():
    steady = {"run_hours": 8, "running_power": 800.0, "draw_w": 830.0}
    burst = {"run_hours": 1, "running_power": None, "draw_w": 3000.0}
    off = {"run_hours": 0, "running_power": None, "draw_w": None}
    assert daily.running_series({1: steady, 2: off, 3: steady}) == [(1, 800.0, 8), (2, None, 0), (3, 800.0, 8)]
    # a day with no steady hour: every day says what it drew, never a step from one measure to the other
    assert [p for _, p, _ in daily.running_series({1: steady, 2: burst})] == [830.0, 3000.0]


def test_the_weekly_page_counts_running_by_the_one_rule(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("facts", os.path.join(SKILLS, "reports", "scripts", "facts.py"))
    facts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(facts)

    class Pack:
        time_zone = "UTC"

    class Cli:
        def statistics(self, ids, s, e, period, types):
            assert {"mean", "max"} <= set(types)
            return {ids[0]: [{**r, "start": int(s.timestamp() * 1000) + i * 3_600_000}
                             for i, r in enumerate(_h([(300.0, 3000.0)] * 10 + [(50.0, 100.0)] * 4 + [(0.5, 2.0)] * 10))]}
    from datetime import datetime, timezone
    c = facts.Ctx("fm-weekly", Pack(), None, Cli(), {"start": "2026-10-01", "end": "2026-10-01"}, {"thresholds": {}},
                  "UTC", datetime(2026, 10, 2, 7, tzinfo=timezone.utc), None, params=_params)
    ((_, power, hours),) = c.running_days("sensor.example_pump_power", {}, 1)
    assert hours == 1.0 and power == 3000           # a 100 W hour is not this pump running; "mean above 15 W" read 14 h
