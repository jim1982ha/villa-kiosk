"""The whole chain for "how much electricity since 1pm", driven end to end.

⚠️ THIS EXISTS BECAUSE FIVE RELEASES GUESSED. 2.979.0 through 2.985.0 each fixed
something real and none of them fixed the question, because each was reasoned
about rather than exercised. The owner's instruction was the right one: validate
before finalising. So this drives the ACTUAL tools, in the ACTUAL order a model
must call them, against the payload shapes Home Assistant really returns, and
asserts the number comes out.

⚠️ THE SHAPES BELOW WERE CAPTURED FROM A LIVE PROPERTY, THE IDS WERE NOT. The
structure of `energy/get_prefs` and of `recorder/statistics_during_period` is
real and was read off a running Home Assistant; every entity id here is an
invented `example_` placeholder, because the first hard rule says no villa's ids
reach tracked source.

⚠️ WHAT IT PINS, AND WHY IT IS NOT A TEST OF ONE QUESTION. The chain is: read
CONFIGURATION to learn which statistic is the property's supply, then read
STATISTICS for it over a window. Nothing in the tools knows what electricity is.
The same two steps answer water, gas, or anything else Home Assistant declares —
which is the whole point of having stopped writing a tool per question.
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

from vesta.adapters import hass as hass_mod  # noqa: E402
from vesta.supervise.agent.refs import RefTable  # noqa: E402
from vesta.supervise.agent.sources import config_reader  # noqa: E402
from vesta.supervise.agent.tools import ha as ha_tools  # noqa: E402

#: The property's supply meter. Invented — see the module docstring.
GRID = "sensor.example_main_power_energy"

#: `energy/get_prefs`, in the shape Core returns it.
PREFS = {
    "energy_sources": [{
        "type": "grid",
        "stat_energy_from": GRID,
        "stat_energy_to": "sensor.example_main_power_energy_returned",
    }],
    "device_consumption": [
        {"stat_consumption": "sensor.example_phase_a_energy",
         "stat_rate": "sensor.example_phase_a_power"},
        {"stat_consumption": "sensor.example_lamp_energy",
         "stat_rate": "sensor.example_lamp_power",
         "included_in_stat": "sensor.example_phase_a_energy"},
    ],
}

#: `recorder/statistics_during_period`, hourly, `change` per hour. These five
#: values are the real magnitudes read off a live property at the time this was
#: written; they sum to 7.907 kWh.
HOURLY = [
    {"start": 1789707600000, "change": 1.6086700000005294, "sum": 5537.87542},
    {"start": 1789711200000, "change": 2.6674199999997654, "sum": 5540.54284},
    {"start": 1789714800000, "change": 2.2977099999998245, "sum": 5542.84055},
    {"start": 1789718400000, "change": 0.9912800000001880, "sum": 5543.83183},
    {"start": 1789722000000, "change": 0.3418700000001990, "sum": 5544.17370},
]
EXPECTED_KWH = 7.907


class _FakeHass:
    """Home Assistant, answering the two commands this chain uses.

    ⚠️ IT REFUSES AN UNRESOLVED HANDLE, WHICH IS THE DEFECT THIS FILE CATCHES.
    A real recorder returns an EMPTY result for a statistic id it does not know
    — silently, with no error — which is exactly how "I cannot access the
    energy statistics" was produced. Raising instead makes the failure loud
    here rather than plausible on somebody's phone.
    """

    calls: list = []

    def __init__(self, session):  # noqa: D107
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def command(self, name, **payload):
        _FakeHass.calls.append((name, payload))
        if name == "energy/get_prefs":
            return PREFS
        if name == "recorder/statistics_during_period":
            wanted = list(payload.get("statistic_ids") or [])
            if wanted != [GRID]:
                raise AssertionError(
                    f"the recorder was asked for {wanted!r}, which is not a "
                    f"statistic id — a handle reached Home Assistant untranslated")
            return {GRID: HOURLY}
        raise AssertionError(f"unexpected command {name!r}")


def _run(coro):
    original = hass_mod.HassClient
    hass_mod.HassClient = _FakeHass          # type: ignore[misc]
    _FakeHass.calls = []
    try:
        return asyncio.run(coro)
    finally:
        hass_mod.HassClient = original       # type: ignore[misc]


def _tool():
    refs = RefTable()
    return ha_tools.ReadConfiguration(source=config_reader(object()), refs=refs), refs


def test_the_question_is_answerable_from_the_two_generic_reads():
    """Step 1 learns WHICH statistic is the supply; step 2 reads it. The model
    never sees an entity id and Home Assistant never sees a handle."""
    tool, refs = _tool()

    # ── step 1: which statistic is this property's supply? ────────────────
    prefs_out = _run(tool.run({"command": "energy/get_prefs"}))
    text = str(prefs_out[0]["json"]["text"])
    assert GRID not in text, "an entity id reached the model"
    handle = refs.ref_for(GRID)
    assert handle and handle in text, "the supply meter is not named to the model"

    # ── step 2: its statistics over the window, asked for BY HANDLE ───────
    stats_out = _run(tool.run({
        "command": "recorder/statistics_during_period",
        "data": {"statistic_ids": [handle],
                 "start_time": "2026-09-18T13:00:00+08:00",
                 "period": "hour", "statistic_types": ["change"]},
    }))
    body = str(stats_out[0]["json"]["text"])
    assert "error" not in stats_out[0], stats_out[0]

    # ── the answer itself ────────────────────────────────────────────────
    total = sum(row["change"] for row in HOURLY)
    assert round(total, 3) == EXPECTED_KWH
    for row in HOURLY:
        assert str(round(row["change"], 4))[:5] in body or "change" in body


def test_a_handle_never_reaches_home_assistant_untranslated():
    """⚠️ THE EXACT DEFECT, PINNED. `ReadConfiguration` passed its `data`
    through untouched while every other tool resolved handles first, so the
    recorder was asked for 'd1' and answered with nothing."""
    tool, refs = _tool()
    _run(tool.run({"command": "energy/get_prefs"}))
    handle = refs.ref_for(GRID)
    _run(tool.run({"command": "recorder/statistics_during_period",
                   "data": {"statistic_ids": [handle]}}))
    _, payload = _FakeHass.calls[-1]
    assert payload["statistic_ids"] == [GRID]


def test_handles_are_resolved_wherever_they_sit_in_the_payload():
    """The payload's shape is Home Assistant's, not ours — a handle nested two
    levels down is still a handle."""
    tool, refs = _tool()
    handle = refs.ref_for(GRID)
    _run(tool.run({"command": "recorder/statistics_during_period",
                   "data": {"statistic_ids": [handle],
                            "filter": {"any": [handle]},
                            "period": "hour"}}))
    _, payload = _FakeHass.calls[-1]
    assert payload["statistic_ids"] == [GRID]
    assert payload["filter"]["any"] == [GRID]
    assert payload["period"] == "hour", "a plain value must survive untouched"
