"""Hours in a night-check finding are the shared duration words (vesta_shared.timeutil.lasting), never decimals
(architecture review round 11, card 4: "2.3h against 4.0h scheduled" on the card that said "offline for 2h 30min")."""
from __future__ import annotations

import os
import re
import sys
from datetime import date, timedelta

from helpers import STARTER_SKILLS

AS_OF = date(2026, 10, 26)


def _rules():
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import rules as R
    from vesta_shared.params import VillaParams
    from vesta_shared.skill_settings import load
    return R, VillaParams(defaults=load(os.path.join(STARTER_SKILLS, "preventive-maintenance"), "settings.yaml")["behaviour"])


def test_a_pump_that_ran_short_says_its_hours_as_durations():
    R, params = _rules()
    day = lambda h: {"run_hours": h, "full_hours": h, "hours_with_data": 24, "running_power": 700.0}  # noqa: E731
    series = {AS_OF - timedelta(days=i): day(4.0) for i in range(1, 20)}
    series[AS_OF] = {**day(2.3), "gap_hours": 1.5}
    expected = {R.weekday_name(AS_OF - timedelta(days=i)): 4.0 for i in range(7)}
    got = [f for f in R.power_rules({"slug": "pump", "name": "Example pump", "entities": {}}, "sensor.example_pump_power",
                                    series, AS_OF, params, expected, None) if f.rule_id == "PM-RUNHOURS"]
    on = R.day_label(AS_OF, weekday=True)                                # dates are locale-shaped: never pinned
    assert [f.summary for f in got] == [f"Example pump ran shorter than expected on {on}: 2h 18min against 4h "
                                        "scheduled, and 1h 30min without any data."], [f.summary for f in got]


def test_no_skill_script_writes_hours_as_a_decimal():
    # a rate ("2.3h/day") is not a duration; any other "{x:.1f}h" is
    hand = re.compile(r":\.\d+f\}\s?h(?![/a-z])")
    found = []
    for root, _, files in os.walk(STARTER_SKILLS):
        for name in files:
            if name.endswith(".py"):
                with open(os.path.join(root, name), encoding="utf-8") as f:
                    found += [f"{name}:{i}" for i, line in enumerate(f, 1) if hand.search(line)]
    assert found == [], found


def test_a_read_over_the_last_hours_says_them_as_durations():
    from vesta_agent.status import _period
    assert _period({"start_time": "6h"}) == "last 6h" and _period({"hours_back": 1.5}) == "last 1h 30min"
    assert _period({"hours_back": "soon"}) == "last soonh"                      # not a number: as it was given
