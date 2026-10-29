"""What a device is, from the villa's system (owner, 2026-10-29: "a wall switch that has a few gangs: one gang controls
the light, the other one controls the fan"): a device's light, fan and climate parts decide its kind before its name,
and a fan measured with a light on one power reading is checked by its own on/off, its power read only while the light
is off; the light counts in the energy figures only. Synthetic villa; ids invented."""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone

from helpers import STARTER_SKILLS
from vesta_shared import daily
from vesta_shared.knowledge_pack import build_pack, guessed_kind, kind_from_parts
from vesta_shared.past import History


def _power(eid, dev, name):
    return {"entity_id": eid, "name": name, "device_id": dev, "device_class": "power", "unit_of_measurement": "W",
            "state_class": "measurement"}


SWITCH = "example_bath_switch"
REGISTRY = {"entities": [
    # a two-gang wall switch: one power reading, a light gang, a fan gang
    _power(f"sensor.{SWITCH}_power", "d1", "Example bath switch power"),
    {"entity_id": f"light.example_bath_switch_top", "name": "Top", "device_id": "d1"},
    {"entity_id": f"fan.example_bath_switch_bottom", "name": "Bottom", "device_id": "d1"},
    # a light with its own power reading, named nothing that says light
    _power("sensor.example_strip_power", "d2", "Example strip power"),
    {"entity_id": "light.example_strip", "name": "Strip", "device_id": "d2"},
    # a two-channel power module: two readings on one device, so which part each measures is not known
    _power("sensor.example_module_ch1_power", "d3", "Example module ch1 power"),
    _power("sensor.example_module_ch2_power", "d3", "Example module ch2 power"),
    {"entity_id": "light.example_module_a", "name": "A", "device_id": "d3"},
    {"entity_id": "fan.example_module_b", "name": "B", "device_id": "d3"},
]}


def _pack():
    return build_pack(REGISTRY, [])


def test_a_devices_parts_decide_its_kind_before_its_name():
    a = _pack().assets
    assert a[SWITCH]["parts"] == {"light": ["light.example_bath_switch_top"], "motor": ["fan.example_bath_switch_bottom"]}
    assert a[SWITCH]["kind"] == "motor" and kind_from_parts(a[SWITCH])
    assert a["example_strip"]["kind"] == "lighting" and kind_from_parts(a["example_strip"])
    # two readings on the module: no parts read, its kind from its name as before
    assert a["example_module_ch1"]["parts"] == {} and not kind_from_parts(a["example_module_ch1"])


def test_a_vmc_is_a_fan_by_its_name_too():
    assert guessed_kind({"slug": "example_light_and_vmc", "name": "Example light and VMC"}) == "motor"


def test_only_a_motor_measured_with_a_light_is_a_shared_meter():
    a = _pack().assets
    assert daily.shared_meter(a[SWITCH]) == (["fan.example_bath_switch_bottom"], ["light.example_bath_switch_top"])
    assert daily.shared_meter(a["example_strip"]) is None
    # its running power is not read from its power by the reports and the energy figures (the light is in it)
    assert not daily.measured_motor(a[SWITCH])
    assert daily.measured_motor({"kind": "motor", "parts": {"motor": ["fan.x"]}})


T0 = datetime(2026, 10, 27, 0, 0, tzinfo=timezone.utc)


def _hour(h, mean, mx):
    return {"start": int((T0 + timedelta(hours=h)).timestamp() * 1000), "mean": mean, "max": mx, "min": mean}


def test_the_fans_day_is_its_own_on_off_and_its_power_while_the_light_is_off():
    # the fan on 02:00-06:00; the light on 04:00-05:00 too: 6 W alone, 46 W with the light
    rows = [_hour(h, 0.5, 1) for h in range(0, 2)] + [_hour(2, 6, 7), _hour(3, 6, 7), _hour(4, 46, 47), _hour(5, 6, 7)]
    fan = [(T0 + timedelta(hours=2), T0 + timedelta(hours=6))]
    light = [(T0 + timedelta(hours=4), T0 + timedelta(hours=5))]
    f = daily.shared_day_features(rows, "UTC", fan, light)[date(2026, 10, 27)]
    assert f["run_hours"] == 4.0 and f["full_hours"] == 4
    assert f["running_power"] == 6.0 and f["peak_w"] == 7      # the light's hour left out of the fan's power
    assert f["hours_with_data"] == 6                            # ...and never counted as the meter offline
    # a raw reading while the light is on is not the fan's: its run ends where the light came on
    raw = [{"state": "6", "last_changed": (T0 + timedelta(hours=2, minutes=m)).isoformat()} for m in range(0, 240, 10)]
    mine = daily.motor_alone(raw, fan, light)
    at = {r["last_changed"]: r["state"] for r in mine}
    assert at[(T0 + timedelta(hours=4, minutes=30)).isoformat()] == "0"
    assert at[(T0 + timedelta(hours=3)).isoformat()] == "6"


def test_on_spans_read_the_state_carried_in_and_each_change():
    changes = [(T0, "on"), (T0 + timedelta(hours=1), "off"), (T0 + timedelta(hours=3), "on")]
    assert daily.on_spans(changes, T0 + timedelta(hours=4)) == [(T0, T0 + timedelta(hours=1)),
                                                               (T0 + timedelta(hours=3), T0 + timedelta(hours=4))]


class _Store:
    def open_finding(self, *a):
        return None

    def put_feature(self, *a):
        pass


class _Cli:
    def __init__(self, rows, whole=True):
        self.rows, self.whole, self.asked = rows, whole, []

    def history_read(self, ids, start, end, now=None):
        self.asked.append(list(ids))
        ids = list(ids)
        return History({e: self.rows.get(e, []) for e in ids}, start, end,
                       None if self.whole else {ids[0]: start + timedelta(hours=1)})


def _night(monkeypatch, cli):
    """nightly.asset_findings on the switch, the day's rules caught: the day's figures they judged."""
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import nightly
    from vesta_shared.params import VillaParams
    from vesta_shared.skill_settings import load
    params = VillaParams(defaults=load(os.path.join(STARTER_SKILLS, "preventive-maintenance"), "settings.yaml")["behaviour"])
    judged = {}
    monkeypatch.setattr(nightly.R, "power_rules", lambda asset, eid, series, today, *a: judged.update(series) or [])
    asset = _pack().assets[SWITCH]
    p = asset["entities"]["power"]
    hours = {p: [_hour(2, 6, 7), _hour(3, 6, 7), _hour(4, 46, 47), _hour(5, 6, 7)]}
    end = T0 + timedelta(days=1)
    notes: list = []
    nightly.asset_findings(cli, _Store(), params, asset, date(2026, 10, 27), end, hours, {}, end, "UTC", timezone.utc,
                           notes, skip_raw=True, write_features=False)
    return judged.get(date(2026, 10, 27)), notes


def test_the_night_check_judges_the_fan_by_its_own_on_off(monkeypatch):
    rows = {"fan.example_bath_switch_bottom": [{"state": "on", "last_changed": (T0 + timedelta(hours=2)).isoformat()},
                                               {"state": "off", "last_changed": (T0 + timedelta(hours=6)).isoformat()}],
            "light.example_bath_switch_top": [{"state": "off", "last_changed": T0.isoformat()},
                                              {"state": "on", "last_changed": (T0 + timedelta(hours=4)).isoformat()},
                                              {"state": "off", "last_changed": (T0 + timedelta(hours=5)).isoformat()}]}
    cli = _Cli(rows)
    day, notes = _night(monkeypatch, cli)
    assert cli.asked == [["fan.example_bath_switch_bottom", "light.example_bath_switch_top"]]
    assert day["run_hours"] == 4.0 and day["running_power"] == 6.0 and notes == []


def test_a_parts_history_not_read_whole_waits_for_the_next_night(monkeypatch):
    day, notes = _night(monkeypatch, _Cli({}, whole=False))
    assert day is None and "could not be read" in notes[0]


def test_the_page_says_what_the_device_is_made_of():
    from vesta_agent.ui import kinds
    a = _pack().assets
    assert kinds.parts_words(a[SWITCH]) == "light + fan" and kinds.parts_words(a["example_module_ch1"]) == ""


def test_the_reports_and_the_energy_figures_read_a_motors_power_only_where_it_is_its_own():
    # every reader of a motor's running power or run hours asks daily.measured_motor, never the kind alone: a wall
    # switch's fan and light would chart the light as the fan
    import re
    from pathlib import Path
    root = Path(STARTER_SKILLS)
    for script in ("reports/scripts/facts.py", "reports/scripts/playbook.py", "roi-energy/scripts/energy_period.py"):
        src = (root / script).read_text()
        assert "daily.measured_motor(" in src, script
        assert not re.search(r"""kind["']?\)?(?:, *["']appliance["']\))? *[!=]= *["']motor["']""", src), script


def test_investigate_reads_a_fan_measured_with_a_light_as_the_night_check_does(monkeypatch):
    # architecture review, 2026-10-30: /investigate counted the light's hours as the fan's
    from zoneinfo import ZoneInfo
    from vesta_shared.ha_client import HABase
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "investigate", "scripts"))
    import investigate
    p = f"sensor.{SWITCH}_power"
    power = [(T0 + timedelta(hours=h, minutes=m), 46.0 if h == 4 else 6.0 if 2 <= h < 6 else 0.4)
             for h in range(0, 8) for m in range(0, 60, 5)]
    parts = {"fan.example_bath_switch_bottom": [(T0, "off"), (T0 + timedelta(hours=2), "on"), (T0 + timedelta(hours=6), "off")],
             "light.example_bath_switch_top": [(T0, "off"), (T0 + timedelta(hours=4), "on"), (T0 + timedelta(hours=5), "off")]}

    class Client(HABase):
        def states(self, ids):
            return {i: {"state": "6", "attributes": {"friendly_name": "Bath switch power", "unit_of_measurement": "W"}}
                    for i in ids}

        def history(self, ids, start, end):
            out = {}
            for i in ids:
                rows = [(t, str(v)) for t, v in power] if i == p else parts.get(i, [])
                kept = [r for r in rows if r[0] < start][-1:] + [r for r in rows if start <= r[0] < end]
                out[i] = [{"state": s, "last_changed": max(t, start).isoformat()} for t, s in kept]
            return out

        def logbook(self, start, end):
            return []

        def tool(self, name, args):
            return {}
    pack = _pack()
    got = investigate.timeline(Client(), [p], T0, T0 + timedelta(hours=8), 0, ZoneInfo("UTC"), now=T0 + timedelta(hours=9),
                               pack=pack)
    lines = str(got)
    assert "counted only while it ran alone" in lines, lines
    # its readings while the light was on read 0: the fan's own runs, never the light's 46 W
    mine = investigate.alone_points([(t, str(v)) for t, v in power], [(T0 + timedelta(hours=2), T0 + timedelta(hours=6))],
                                    [(T0 + timedelta(hours=4), T0 + timedelta(hours=5))])
    assert max(float(s) for t, s in mine if T0 + timedelta(hours=4) <= t < T0 + timedelta(hours=5)) == 0
