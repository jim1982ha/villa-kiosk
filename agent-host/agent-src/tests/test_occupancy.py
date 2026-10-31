"""Like with like (owner, 2026-10-25): a day's use is compared with earlier days in the same state — occupied with
occupied, empty with empty — and the villa's state is optional: without it, every comparison is what it was. Driven
through vesta_shared.occupancy, the night check's energy rule and the energy report's waste proposal. Synthetic villa."""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from helpers import STARTER_SKILLS
from vesta_shared import kiosk_told
from vesta_shared import occupancy as O
from vesta_shared.params import VillaParams
from vesta_shared.skill_settings import load
from vesta_shared.store import Store

sys.path.insert(0, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
import rules as R  # noqa: E402

TODAY = date(2026, 10, 25)
PARAMS = VillaParams(defaults=load(os.path.join(STARTER_SKILLS, "preventive-maintenance"), "settings.yaml")["behaviour"])
ASSET = {"slug": "example_pump", "name": "Example Pump", "kind": "motor", "entities": {"energy": "sensor.example_pump_energy"}}


def days_back(n):
    return [TODAY - timedelta(days=i) for i in range(n - 1, -1, -1)]


def villa(empty_days: int, occupied_days: int, recent: float, recent_state=O.OCCUPIED, quiet=0.14, busy=2.7):
    """A month of a pump's kWh: `empty_days` quiet days, then `occupied_days` busy ones, then two recent days at
    `recent` in `recent_state` — and the villa's state of each day."""
    ds = days_back(empty_days + occupied_days + 2)
    kwh = [quiet] * empty_days + [busy] * occupied_days + [recent, recent]
    states = [O.EMPTY] * empty_days + [O.OCCUPIED] * occupied_days + [recent_state] * 2
    return {d: {"kwh": v} for d, v in zip(ds, kwh)}, dict(zip(ds, states))


def found(series, states, prior=None):
    return [f for f in R.power_rules(ASSET, "sensor.example_pump_energy", {}, TODAY, PARAMS, None, series, prior, states)
            if f.rule_id == "PM-ENERGY-CHANGE"]


def test_guests_in_are_compared_with_days_with_guests_never_with_a_quiet_month():
    # the house pump, 2026-10-25: "2.73 kWh/day … against a normal 0.14 (+1794%)" — two weeks of guests
    series, states = villa(18, 10, 2.73)
    assert found(series, states) == []
    # the same days without the villa's state: compared as before, a fault
    (f,) = found(series, None)
    assert f.detail["kind"] == "JUMP" and f.detail["occupancy"] is None and "when the villa" not in f.summary


def test_a_leak_in_an_empty_villa_is_still_a_fault_said_against_empty_days():
    series, states = villa(20, 6, 2.7, recent_state=O.EMPTY)
    (f,) = found(series, states)
    assert f.detail["kind"] == "JUMP" and f.detail["occupancy"] == O.EMPTY
    assert f.summary.endswith("against a normal 0.14 kWh/day when the villa is empty (+1829%).")


def test_a_pump_that_stops_while_guests_are_in_is_still_a_fault():
    series, states = villa(10, 15, 0.1)
    (f,) = found(series, states)
    assert f.detail["kind"] == "COLLAPSE" and f.detail["occupancy"] == O.OCCUPIED


def test_the_first_guests_of_the_season_are_judged_only_where_occupancy_cannot_explain():
    # two occupied days before: too few for a normal of their own — every earlier day, and only a DROP is said
    series, states = villa(24, 2, 2.7)
    assert found(series, states) == []                                   # more with guests: explained
    series, states = villa(24, 2, 0.01, quiet=0.5, busy=0.5)
    (f,) = found(series, states)
    assert f.detail["kind"] == "COLLAPSE" and f.detail["occupancy"] is None   # less with guests than when empty


def test_an_unknown_day_compares_as_before():
    series, states = villa(18, 10, 2.73)
    states.pop(TODAY)                                                    # the helper did not report most of today
    assert [f.detail["kind"] for f in found(series, states)] == ["JUMP"]


def test_a_kept_normal_is_kept_for_its_own_state_only():
    series, states = villa(18, 10, 2.73)
    # a fault opened while empty keeps its normal while empty; guests arrived: the occupied normal now
    assert found(series, states, {"PM-ENERGY-CHANGE": {"baseline_kwh": 0.14, "occupancy": O.EMPTY}}) == []
    (f,) = found(series, states, {"PM-ENERGY-CHANGE": {"baseline_kwh": 0.5, "occupancy": O.OCCUPIED}})
    assert f.detail["baseline_kwh"] == 0.5                                # same state: its normal kept


def test_a_day_is_the_state_the_helper_held_most_of_it_and_unknown_when_it_said_nothing():
    z = ZoneInfo("Asia/Singapore")
    at = lambda d, h: datetime(2026, 10, d, h, tzinfo=z).isoformat()     # noqa: E731
    rows = [{"state": "on", "last_changed": at(20, 0)}, {"state": "off", "last_changed": at(21, 15)},
            {"state": "unavailable", "last_changed": at(22, 2)}, {"state": "off", "last_changed": at(23, 20)}]
    got = O.day_states(rows, date(2026, 10, 20), date(2026, 10, 23), z)
    assert got == {date(2026, 10, 20): O.EMPTY, date(2026, 10, 21): O.EMPTY}
    rows[1]["last_changed"] = at(21, 10)                                  # empty until 10:00, occupied after
    assert O.day_states(rows, date(2026, 10, 21), date(2026, 10, 21), z) == {date(2026, 10, 21): O.OCCUPIED}


class History:
    def __init__(self, rows):
        self.rows, self.read = rows, 0

    def history(self, ids, start, end):
        self.read += 1
        return {ids[0]: self.rows}


def _picked(tmp_path, monkeypatch, entity_id="binary_sensor.example_empty"):
    """The Kiosk named `entity_id` as the villa's "empty" sensor in its heartbeat answer; kept beside the pack."""
    pack = str(tmp_path / "pack.json")
    monkeypatch.setenv("VESTA_PACK", pack)
    kiosk_told.keep(pack, {"villaEmptySensor": entity_id})
    return entity_id


def test_each_day_is_kept_so_a_month_of_states_outlives_the_villas_ten_days(tmp_path, monkeypatch):
    z = ZoneInfo("UTC")
    skills = tmp_path / "skills"
    (skills / "maint").mkdir(parents=True)
    _picked(tmp_path, monkeypatch)
    store = Store(str(tmp_path / "s.db"))
    cli = History([{"state": "off", "last_changed": datetime(2026, 10, 1, tzinfo=timezone.utc).isoformat()}])
    got = O.days(cli, store, str(skills / "maint"), date(2026, 10, 20), date(2026, 10, 22), z)
    assert got == {date(2026, 10, 20 + i): O.OCCUPIED for i in range(3)} and cli.read == 1
    cli.rows = []                                                         # the villa's history gone: the store says it
    assert O.days(cli, store, str(skills / "maint"), date(2026, 10, 20), date(2026, 10, 22), z) == got
    # no sensor picked in the Kiosk: None — every comparison as before
    _picked(tmp_path, monkeypatch, "")
    assert O.days(cli, store, str(skills / "maint"), date(2026, 10, 20), date(2026, 10, 22), z) is None


def test_the_villas_empty_sensor_is_the_kiosks_pick_kept_while_it_does_not_say(tmp_path, monkeypatch):
    """Architecture review round 7, card 2: the sensor is the Kiosk's pick (heartbeat answer `villaEmptySensor`), never
    one named in the agent's files. An answer without the key keeps the pick; "" is no pick; never told, none."""
    pack = str(tmp_path / "pack.json")
    monkeypatch.setenv("VESTA_PACK", pack)
    assert O.sensor() is None and kiosk_told.told({"ok": True}) == {}              # never told; an older Kiosk
    assert kiosk_told.keep(pack, {"villaEmptySensor": "binary_sensor.example_empty"}) and \
        O.sensor() == "binary_sensor.example_empty"
    kiosk_told.keep(pack, {"maintenance": False})                                  # the key absent: kept
    assert O.sensor() == "binary_sensor.example_empty"
    assert kiosk_told.save(pack, "villaEmptySensor", "binary_sensor.example_empty") is False   # unchanged: not written
    assert kiosk_told.told({"villaEmptySensor": "not an id"}) == {"villaEmptySensor": ""}
    assert kiosk_told.keep(pack, {"villaEmptySensor": "not an id"}) and O.sensor() is None


def test_the_energy_reports_waste_line_says_only_a_rise_occupancy_cannot_explain():
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "roi-energy", "scripts"))
    import proposals as P
    load_ = {"name": "Example Pump", "kwh": 80.0, "baseline_kwh": 10.0, "vs_baseline_pct": 700.0}
    lines = lambda l: [p for p in P.build({"loads": [l]}, None) if p["kind"] == "waste"]  # noqa: E731
    assert len(lines(load_)) == 1                                         # no state known: as before
    assert lines({**load_, "baseline_rise_said": False}) == []           # guests in against quieter days
    (p,) = lines({**load_, "baseline_occupancy": O.EMPTY})
    assert p["detail"].startswith("80.0 kWh over the period against about 10.0 kWh usually when the villa is empty.")


def test_the_night_check_itself_compares_like_with_like_and_without_the_helper_as_before(tmp_path, monkeypatch):
    # the real nightly.py over a fixture villa: a pump at 0.5 kWh/day while empty, 3.0 since guests arrived 8 days ago
    import json
    from test_maintenance_noise import AS_OF, _night, _open, _pump
    _pump(tmp_path, [3.0] * 8)
    _night(tmp_path, "--as-of", AS_OF)
    assert [json.loads(f["detail"])["kind"] for f in _open(tmp_path, "PM-ENERGY-CHANGE")] == ["JUMP"]   # no state: as before
    end = date.fromisoformat(AS_OF)
    at = lambda d: datetime(d.year, d.month, d.day, tzinfo=timezone.utc).isoformat()   # noqa: E731
    eid = _picked(tmp_path, monkeypatch)
    (tmp_path / "fx" / "history_raw_occ.json").write_text(json.dumps({"entities": [{"entity_id": eid,
        "states": [{"state": "on", "last_changed": at(end - timedelta(days=20))},
                   {"state": "off", "last_changed": at(end - timedelta(days=7))}]}]}))
    (tmp_path / "s.sqlite").unlink()
    _night(tmp_path, "--as-of", AS_OF)
    assert _open(tmp_path, "PM-ENERGY-CHANGE") == []                     # guests in, against days with guests


def test_the_energy_report_itself_reads_the_villas_state_and_without_it_as_before(tmp_path, monkeypatch):
    # the real energy_period.py over a fixture villa: empty before the week, guests in during it
    import json
    from test_energy_setup import START, _period, _villa
    fx = _villa(tmp_path)
    out = _period(tmp_path, fx)
    assert all(l["baseline_rise_said"] and l["baseline_occupancy"] is None for l in out["loads"])   # no state: as before
    at = lambda d: (START + timedelta(days=d)).isoformat()   # noqa: E731
    eid = _picked(tmp_path, monkeypatch)
    (fx / "history_raw_occ.json").write_text(json.dumps({"entities": [{"entity_id": eid,
        "states": [{"state": "on", "last_changed": at(-30)}, {"state": "off", "last_changed": "2026-09-28T00:00:00+00:00"}]}]}))
    (tmp_path / "week.json").unlink()
    out = _period(tmp_path, fx)
    # guests in all week, no earlier week with guests: a rise is no waste; a drop would still be said
    assert out["loads"] and all(not l["baseline_rise_said"] and l["baseline_occupancy"] is None for l in out["loads"])
