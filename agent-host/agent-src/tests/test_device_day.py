"""A device's day: one "running" and one step for every page (architecture review 13, 2026-10-09).

The night check, the energy figures and the filtration optimiser each computed when a pump runs, and only the night
check's copy had the baseline cap and the floor; the weekly page found a power step its own way, noise included."""
import os

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


def _h(pairs):
    return [{"start": T0 + h * 3_600_000, "mean": m, "max": x, "min": 0.0} for h, (m, x) in enumerate(pairs)]


def test_a_pump_that_runs_in_bursts_counts_the_minutes_it_ran():
    # owner, 2026-10-19: a 3 kW pressure pump, a few minutes of bursts in most hours — the night check read 0 h
    # (no hourly MEAN reaches a fraction of 3 kW) and the weekly page 18 h; 3.0 kWh at 3 kW is about 1 h
    rows = _h([(300.0, 3000.0)] * 10 + [(0.5, 2.0)] * 14)
    thr, days = daily.power_days({}, rows, "UTC", _params())
    (day,) = days.values()
    assert thr == 600 and day["run_hours"] == 1.0                       # 10 hours of 300 W ÷ 3000 W peaks
    assert day["running_power"] is None                                 # no steady hour: no running power to give


def test_the_typical_peak_is_where_the_energy_went():
    idle = [(0.1, 10.0)] * 16                                            # a pool pump's idle noise: 10 W peaks
    assert daily.typical_peak(_h(idle + [(750.0, 800.0)] * 8)) == 800    # not the idle median of every hour
    spikes = [(40.0, 7000.0)] * 4                                        # four start-ups of a 1 kW jacuzzi pump
    assert daily.typical_peak(_h(idle + spikes + [(950.0, 1000.0)] * 14)) == 1000
    glitch = [(34.0, 546.0)]                                             # one bad reading of a 34 W pump
    assert daily.typical_peak(_h(glitch + [(33.5, 34.0)] * 300)) == 34
    assert daily.typical_peak(_h([(0.0, 2.0)] * 3)) == 2                 # drew nothing: the plain median
    assert daily.typical_peak(_h([(0.0, 0.0)])) is None


def _pack(devices, rows):
    from vesta_shared.knowledge_pack import KnowledgePack
    return KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None,
                         families={"power": rows}, assets={}, areas=[], people=[], channels={}, unknown_area=[],
                         unclassified=[], retention={}, devices=devices)


def test_a_part_shares_its_device_and_a_bridge_does_not():
    # villa, 2026-10-19: every Zigbee sensor hangs under its bridge as a meter's phase hangs under the meter
    p = _pack({"meter": {"name": "Main Meter", "manufacturer": "Maker", "model": "3EM", "via": ""},
               "phase_a": {"name": "Main Phase A", "manufacturer": "Maker", "model": "3EM", "via": "meter"},
               "bridge": {"name": "Zigbee Bridge", "manufacturer": "Koenkk", "model": "Bridge", "via": ""},
               "sensor": {"name": "Laundry Door", "manufacturer": "Aqara", "model": "Door sensor", "via": "bridge"}},
              [{"entity_id": "sensor.phase_a_power", "name": "Power", "device_id": "phase_a", "family": "power"},
               {"entity_id": "sensor.door_battery", "name": "Battery", "device_id": "sensor", "family": "power"}])
    assert p.physical_device_of("sensor.phase_a_power") == "meter"           # one meter: its phase is part of it
    assert p.physical_device_of("sensor.door_battery") == "sensor"           # its own device, not the bridge's
    assert p.device_name("sensor.door_battery", None) == "Laundry Door"
    # a whole device's fault is the meter's; a reading is its channel's
    assert p.device_name("sensor.phase_a_power", None) == "Main Meter"
    assert p.reading_name("sensor.phase_a_power", None) == "Main Phase A"
    assert p.reading_key("sensor.phase_a_power") != p.reading_key("sensor.door_battery")


class _Pack:
    """A knowledge pack's lookups the readers use: an entity's row, an asset by slug."""
    def __init__(self, assets: dict, rows: dict):
        self.assets, self._rows = assets, rows

    def row(self, entity_id):
        return self._rows.get(entity_id)

    def asset(self, slug):
        return self.assets.get(slug)


def test_every_reader_judges_a_pump_with_its_own_baseline_from_the_same_readings():
    # architecture review O, 2026-10-27: /investigate (and a chat's answer through it) judged a pump without its own
    # baseline cap — another run count than the night check's, the weekly page's and the energy figures' for one day
    import sys
    from datetime import datetime, timedelta, timezone
    sys.path.insert(0, os.path.join(SKILLS, "investigate", "scripts"))
    import investigate
    pump = {"kind": "motor", "baseline_helper": "input_number.pump_baseline_w",
            "entities": {"power": "sensor.pump_power", "current": "sensor.pump_current"}}
    pack = _Pack({"pump": pump}, {"sensor.pump_power": {"asset": "pump"}, "sensor.pump_current": {"asset": "pump"}})
    params = _params(baseline_w=500)
    t0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
    readings = [(t0 + timedelta(hours=h, minutes=m), v) for h in range(6) for m, v in ((0, 2.0), (20, 1000.0), (40, 2.0))]
    rows = daily.hour_rows_of(readings)
    capped = 0.2 * 500
    night = daily.running_threshold(pump, rows, params)                                     # nightly.asset_findings
    # the pages read the recorder's hourly figures of the same six hours (each hour's maximum 1000 W)
    pages = daily.power_days(pack.asset(pack.row("sensor.pump_power")["asset"]), _hours([1000] * 6), "UTC", params)[0]  # facts, energy, filtration
    asked = investigate.threshold([(t, str(v)) for t, v in readings], params, pack, "sensor.pump_power")  # /investigate, a chat
    assert night == pages == asked == daily.threshold_from_readings(readings, params, pack, "sensor.pump_power") == capped
    # another reading of the same pump (its current) is not judged by its power's baseline
    assert daily.threshold_from_readings(readings, params, pack, "sensor.pump_current") == 200
    assert daily.power_asset(pack, "sensor.unknown") is None and daily.power_asset(None, "sensor.pump_power") is None
