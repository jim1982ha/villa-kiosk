"""Outdoor conditions, read from the property's own weather entity.

⚠️ THE DEFECT, REPORTED FROM THE VILLA 2026-09-18. Asked for outdoor pressure
and wind direction, VESTA answered that the property has no such sensor — and
twenty-two minutes earlier it had answered the same question correctly with
real figures, having found the entity by blind search on that occasion. The
property has a weather entity publishing pressure, wind bearing, wind speed,
humidity and temperature, and supporting forecasts.

⚠️ THE CAUSE WAS AN ABSENT PATH, NOT A BAD ANSWER. Nothing under
`rootfs/usr/bin/vesta/` mentioned weather at all: no source, no tool, nothing in
the villa document — while `playbooks/climate/weather-risk.md` shipped
instructing the model to state "what is forecast, when, and with what
confidence". A playbook with no data path, which is this repo's most repeated
defect shape.

⚠️ AND NOTHING HERE MAY KNOW THIS PROPERTY. The entity is found by DOMAIN at
runtime, so every fixture below is invented.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

from vesta.adapters import weather  # noqa: E402


def test_published_readings_carry_their_units():
    rows = weather.readings_of({
        "temperature": 30, "temperature_unit": "°C",
        "pressure": 1011.5, "pressure_unit": "hPa",
        "wind_speed": 19.4, "wind_speed_unit": "km/h",
        "wind_bearing": 139.6, "humidity": 58,
    })
    by_measure = {r["measure"]: r for r in rows}
    assert by_measure["pressure"]["value"] == 1011.5
    assert by_measure["pressure"]["unit"] == "hPa"
    assert by_measure["wind_speed"]["unit"] == "km/h"
    # A bearing has no unit attribute in HA, and inventing one would be a lie.
    assert by_measure["wind_bearing"]["unit"] == ""


def test_an_attribute_the_station_does_not_publish_is_absent_not_zero():
    """⚠️ "CALM" AND "NO ANEMOMETER" ARE DIFFERENT ANSWERS. Reporting a missing
    reading as 0 is the `Number(null) === 0` defect in another costume."""
    rows = weather.readings_of({"temperature": 21, "temperature_unit": "°C"})
    assert [r["measure"] for r in rows] == ["temperature"]


@pytest.mark.parametrize("features,expected", [
    (0, False), (None, False), ("", False), ("not a number", False),
    (1, True), (2, True), (3, True),
])
def test_forecast_capability_is_read_not_assumed(features, expected):
    """A station that only measures must be describable as exactly that —
    which is the honest version of the answer the villa got wrong."""
    assert weather.supports_forecast({"supported_features": features}) is expected


def test_a_forecast_step_keeps_only_what_it_can_vouch_for():
    kept = weather.trim_forecast([{
        "datetime": "2026-09-18T14:00:00+08:00",
        "condition": "rainy",
        "temperature": 29.5,
        "precipitation_probability": 40,
    }])
    assert kept == [{
        "datetime": "2026-09-18T14:00",
        "condition": "rainy",
        "temperature": 29.5,
        "precipitation_probability": 40.0,
    }]


@pytest.mark.parametrize("step", [
    # ⚠️ EACH OF THESE IS A REAL LEAK ROUTE. A forecast step is written by the
    # weather integration — the one payload here nobody in this repo authored —
    # and the sweep in `test_refs` caught an entity id riding in `condition`
    # when the first cut passed provider rows through whole.
    {"condition": "sensor.example_pool_pump_power"},
    {"condition": "<a href='http://example.invalid'>click</a>"},
    {"datetime": "see the forecast at http://example.invalid"},
    {"temperature": "sensor.example_thermostat"},
    {"wind_bearing": "north-ish"},
])
def test_a_provider_row_cannot_carry_free_text_through(step):
    """Kept BY SHAPE: a timestamp must look like one, a condition must be one
    of Home Assistant's own words, everything else must be a number."""
    assert weather.trim_forecast([step]) == []


def test_the_forecast_is_capped():
    steps = [{"condition": "sunny", "temperature": i} for i in range(50)]
    assert len(weather.trim_forecast(steps)) == weather.MAX_FORECAST_STEPS


@pytest.mark.parametrize("junk", [None, "not a list", [None, 7], [{}], []])
def test_a_malformed_forecast_degrades_to_nothing(junk):
    """It arrives over a websocket from whatever integration is installed; a
    shape change must produce no forecast, never an exception in a chat turn."""
    assert weather.trim_forecast(junk) == []


def test_the_module_names_no_entity_of_any_property():
    from conftest import code_of
    src = code_of(weather)
    for domain in ("sensor" ".", "switch" ".", "light" ".", "binary_sensor" "."):
        assert domain not in src, f"{domain} literal in shipped code"
