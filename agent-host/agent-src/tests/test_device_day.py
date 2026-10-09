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
