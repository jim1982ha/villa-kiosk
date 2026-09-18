"""The property's metering, derived from Home Assistant's own Energy dashboard.

⚠️ THE DEFECT THIS PINS, REPORTED FROM THE VILLA 2026-09-18. Asked in the chat
how much the house was drawing, the agent answered "je n'ai pas accès à un
capteur global en temps réel", then burned its turn budget searching entity by
entity and told the owner the search tool had run out of tokens. The property
has had a whole-house meter the entire time — it is the GRID SOURCE of the
Energy dashboard the owner configured themselves.

⚠️ AND THE FIX MUST NOT KNOW ONE THING ABOUT THIS VILLA. No entity id, meter
name or phase count may appear in shipped source (the first hard rule), so every
fixture here is invented and the code is exercised through the SHAPE of an
energy-prefs payload, never through a name it recognises.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

from vesta.adapters import energy  # noqa: E402


def _prefs(**over):
    """A three-phase property with one sub-circuit and a pump — the ordinary
    shape, with nothing villa-specific in it."""
    base = {
        "energy_sources": [
            {"type": "grid", "stat_energy_from": "sensor.example_meter_energy"},
        ],
        "device_consumption": [
            {"stat_consumption": "sensor.example_p1_e", "stat_rate": "sensor.example_p1_w"},
            {"stat_consumption": "sensor.example_p2_e", "stat_rate": "sensor.example_p2_w"},
            {"stat_consumption": "sensor.example_lamp_e", "stat_rate": "sensor.example_lamp_w",
             "included_in_stat": "sensor.example_p1_e"},
            {"stat_consumption": "sensor.example_pump_e"},
        ],
    }
    base.update(over)
    return base


def test_the_grid_source_is_the_whole_property_meter():
    assert energy.parse(_prefs()).grid_energy == ["sensor.example_meter_energy"]


def test_solar_and_battery_are_not_what_the_house_is_drawing():
    """⚠️ A BIGGER NUMBER THAT LOOKS RIGHT IS THE WORST OUTCOME HERE. Export and
    battery discharge are real sources and answer a different question; folding
    them into "what is the house using" would be confidently wrong."""
    layout = energy.parse(_prefs(energy_sources=[
        {"type": "grid", "stat_energy_from": "sensor.example_meter_energy"},
        {"type": "solar", "stat_energy_from": "sensor.example_pv_energy"},
        {"type": "battery", "stat_energy_from": "sensor.example_batt_energy"},
    ]))
    assert layout.grid_energy == ["sensor.example_meter_energy"]


def test_a_sub_circuit_is_never_a_top_level_meter():
    """`included_in_stat` is HA's own "this is already inside that" marker, and
    it is the entire reason a naive sum of power sensors is wrong."""
    layout = energy.parse(_prefs())
    assert layout.meters == ["sensor.example_p1_w", "sensor.example_p2_w"]
    assert layout.circuits == [("sensor.example_lamp_w", "sensor.example_p1_e")]


def test_an_entry_with_no_instantaneous_statistic_is_not_a_meter():
    """A device declared by ENERGY alone has no "right now", and inventing one
    for it is how a total comes to include a number nobody measured."""
    layout = energy.parse(_prefs())
    assert "sensor.example_pump_e" not in layout.meters
    assert all(c[0] != "sensor.example_pump_e" for c in layout.circuits)


def test_the_total_sums_only_the_top_level_meters():
    layout = energy.parse(_prefs())
    assert energy.total_of([10.0, 5.5]) == 15.5
    # The sub-circuit's own draw is inside p1 already; adding it double-counts.
    assert len(layout.meters) == 2


def test_a_meter_that_is_not_reporting_refuses_the_total():
    """⚠️ NOT A SMALLER TOTAL. A partial sum looks exactly like a real one, and
    the villa saying "1.2 kW" with a third of its metering offline is the
    confident-wrong answer the evidence rule exists to stop."""
    assert energy.total_of([10.0, None]) is None
    assert energy.total_of([]) is None


def test_an_unconfigured_dashboard_says_so_rather_than_zero():
    """⚠️ "NOT DECLARED" IS NOT "USES NOTHING" — the `log_reader` rule. A villa
    whose owner never opened the Energy dashboard must hear that, and hear what
    would fix it."""
    assert energy.parse({}).configured is False
    assert energy.parse(None).configured is False
    assert energy.parse(_prefs()).configured is True


@pytest.mark.parametrize("junk", [
    {"energy_sources": "not a list", "device_consumption": None},
    {"energy_sources": [None, 7], "device_consumption": ["x"]},
    {"energy_sources": [{"type": "grid"}]},            # no stat at all
])
def test_a_malformed_payload_degrades_to_not_configured(junk):
    """It comes off a websocket and is written by whatever HA version is
    installed; a shape change must make the agent say "I cannot tell", never
    raise inside a chat turn."""
    assert energy.parse(junk).configured is False


def test_the_module_names_no_entity_of_any_property():
    """⚠️ THE HARD RULE, CHECKED IN THE FILE ITSELF. Everything this module
    knows arrives at runtime; an entity id in shipped CODE here would mean
    somebody had started assuming a meter name.

    ⚠️ `code_of`, NOT `inspect.getsource` — comments and docstrings stripped.
    A pin that reads prose passes or fails on how a sentence is worded, which
    `test_pins_read_code_not_prose` exists to stop; this file was caught by it
    on the way in."""
    from conftest import code_of
    src = code_of(energy)
    for domain in ("sensor" ".", "switch" ".", "light" ".", "binary_sensor" "."):
        assert domain not in src, f"{domain} literal in shipped code"
