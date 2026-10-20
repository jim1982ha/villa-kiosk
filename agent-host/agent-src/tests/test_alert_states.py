"""Which states an open alert is about: ONE reading (vesta_shared.store.alerted_states) for the alert desk and the
night check (2026-10-20). A numeric rule sends its blueprint's default bad_states ["unavailable"] in every event: an
open OVERLOAD alert on the main meter must not count as already following the meter going offline."""
from __future__ import annotations

import os
import sys

from helpers import STARTER_SKILLS
from vesta_shared.store import Store, alerted_states

SKILL = os.path.join(STARTER_SKILLS, "preventive-maintenance")
DESK = os.path.join(STARTER_SKILLS, "alert-desk")

# the villa's shapes: critical_condition---phase_overload (numeric) and ---entrance_unlocked (state), as their
# vesta_critical_event payloads carry them; ids made up
OVERLOAD = {"blueprint": "critical_condition", "mode": "numeric", "bad_states": ["unavailable"],
            "entities": ["sensor.meter_phase_a_power"], "label": "Phase overload"}
WATCHED = {"blueprint": "critical_watchdog", "bad_states": ["unavailable"], "entities": ["lock.front_door"]}
STATE = {"blueprint": "critical_condition", "mode": "state", "bad_states": ["unlocked", "unavailable"],
         "entities": ["lock.back_door"]}


class _Pack:
    def physical_device_of(self, e):
        return {"sensor.meter_phase_a_power": "dev_meter", "lock.front_door": "dev_front", "lock.back_door": "dev_back"}.get(e)


def _store(tmp_path, *payloads) -> Store:
    s = Store(str(tmp_path / "s.db"))
    for i, p in enumerate(payloads):
        s.new_incident(f"k{i}", f"automation.r{i}", p["entities"][0], "P1", p)
    return s


def test_a_numeric_rule_is_not_about_its_states_a_state_rule_or_one_with_no_mode_is():
    row = lambda p: {"entity_id": p["entities"][0], "payload": __import__("json").dumps(p)}
    assert alerted_states(row(OVERLOAD)) is None
    assert alerted_states(row(WATCHED)) == (["lock.front_door"], {"unavailable"})
    assert alerted_states(row(STATE)) == (["lock.back_door"], {"unlocked", "unavailable"})


def test_the_night_check_opens_the_meters_offline_fault_while_its_overload_alert_is_open(tmp_path):
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import nightly
    got = nightly.alerted_offline(_store(tmp_path, OVERLOAD, WATCHED, STATE), _Pack())
    assert "dev_meter" not in got                          # the overload alert does not follow the meter going offline
    assert set(got) == {"dev_front", "dev_back"}           # an alert about states that include "unavailable" does


def test_the_desk_reads_the_same_rule():
    sys.path.insert(0, os.path.join(DESK, "scripts"))
    import desk
    assert desk.rule_states.__code__.co_names.count("alerted_states") == 1
