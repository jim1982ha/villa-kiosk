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


def test_raw_readings_run_by_the_same_rule_as_hourly_figures():
    # /investigate reads raw readings: bucketed per hour (max, mean of its readings), then the ONE running_threshold
    from datetime import datetime, timedelta, timezone
    t0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
    readings = []
    for h in range(6):                                   # each hour: idle at 2 W, one 1000 W reading, a reading lost
        readings += [(t0 + timedelta(hours=h, minutes=m), v) for m, v in ((0, 2.0), (20, 1000.0), (40, 2.0), (50, None))]
    rows = daily.hour_rows_of(readings)
    assert len(rows) == 6 and rows[0]["max"] == 1000.0 and round(rows[0]["mean"], 6) == round(1004 / 3, 6)
    assert daily.threshold_from_readings(readings, _params(), None, "sensor.x") == daily.running_threshold(None, rows, _params()) == 200
    import sys
    sys.path.insert(0, os.path.join(SKILLS, "investigate", "scripts"))
    import investigate                                   # the investigation asks the same rule
    assert investigate.threshold([(t, str(v)) for t, v in readings], _params()) == 200


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


def test_a_series_gives_power_only_for_a_device_that_runs_steadily():
    steady = {"run_hours": 8, "running_power": 800.0}
    burst = {"run_hours": 1, "running_power": None}
    off = {"run_hours": 0, "running_power": None}
    assert daily.running_series({1: steady, 2: off, 3: steady}) == [(1, 800.0, 8), (2, None, 0), (3, 800.0, 8)]
    # ⚠️ one day without a steady hour: no power on any day (villa, 2026-10-19: a burst pump's "power" swung from
    # 1,500 W to 6,410 W with its start-up peaks) — its run hours stay
    assert daily.running_series({1: steady, 2: burst}) == [(1, None, 8), (2, None, 1)]


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
    assert hours == 1.0 and power is None           # a 100 W hour is not this pump running; "mean above 15 W" read 14 h


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


def test_a_phone_the_wifi_saw_is_not_the_villas():
    # villa, 2026-10-19: a guest's iPhone and a "wlan0" laptop were "monitoring devices offline"
    p = _pack({"phone": {"name": "iPhone", "manufacturer": "", "model": "", "via": "", "named": False},
               "kept": {"name": "Gate box", "manufacturer": "", "model": "", "via": "", "named": True},
               "plug": {"name": "", "manufacturer": "Maker", "model": "Plug", "via": ""}}, [])
    assert p.device_label("phone") == ""                                    # left out of the villa's devices
    assert p.device_label("kept") == "Gate box"                             # the owner named it: the villa's
    assert p.device_label("plug") == "Unnamed Maker Plug"


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
