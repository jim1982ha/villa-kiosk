"""The villa's electricity from its own Energy settings (architecture review round 2, 2026-10-16): the Kiosk's rule
(dev2 src/config/energyModel.ts) ported to vesta_shared.energy_setup and held to the Kiosk oracle's own cases
(tests/oracles/energy_model.mjs, same shape and kWh); the read-only gate lets the settings be READ only; roi-energy
and the weekly page's days follow them. Invented ids throughout."""
from __future__ import annotations

import json
import sys
import os
from datetime import datetime, timedelta, timezone

import pytest

from helpers import STARTER_SKILLS
from vesta_shared import energy_setup as E
from vesta_shared.ha_client import HAError, McpClient

# ---------------------------------------------------------------- the Kiosk oracle's cases, replayed

LIGHTS = [f"sensor.light_{i}_energy" for i in range(10)]
PUMPS = [f"sensor.pump_{i}_energy" for i in range(5)]
PREFS = {
    "energy_sources": [{"type": "grid", "stat_energy_from": "sensor.grid_in", "stat_energy_to": "sensor.grid_out"}],
    "device_consumption": [
        *({"stat_consumption": i, "included_in_stat": "sensor.phase_a_energy"} for i in LIGHTS),
        {"stat_consumption": "sensor.phase_a_energy", "stat_rate": "sensor.phase_a_power"},
        {"stat_consumption": "sensor.phase_b_energy", "stat_rate": "sensor.phase_b_power"},
        {"stat_consumption": "sensor.phase_c_energy", "stat_rate": "sensor.phase_c_power"},
        *({"stat_consumption": i} for i in PUMPS)]}
FRI = {"sensor.grid_in": 75.46, "sensor.grid_out": 0,
       "sensor.phase_a_energy": 15.01, "sensor.phase_b_energy": 20.77, "sensor.phase_c_energy": 39.68,
       **dict(zip(PUMPS, [5.38, 1.16, 1.09, 0.48, 0.14])),
       **dict(zip(LIGHTS, [1.15, 0.92, 0.76, 0.71, 0.67, 0.28, 0.16, 0.09, 0, 0]))}


def _setup():
    return E.setup(PREFS, lambda i: i.replace("sensor.", "").removesuffix("_energy"))


def test_the_hierarchy_is_read_from_the_settings_as_the_kiosk_reads_it():
    s = _setup()
    assert s.grid_in == ["sensor.grid_in"] and s.grid_out == ["sensor.grid_out"] and s.solar == []
    phase_a = next(r for r in s.roots if r.id == "sensor.phase_a_energy")
    assert len(phase_a.children) == 10                                  # the lights sit INSIDE phase A
    assert all(any(r.id == p for r in s.roots) for p in PUMPS)          # no upstream device: top level
    named = E.setup({"energy_sources": [], "device_consumption": [{"stat_consumption": "sensor.x", "name": "Heat pump"}]},
                    lambda _: "X")
    assert named.devices[0].name == "Heat pump"                        # the settings' name wins over the entity's
    loop = E.setup({"energy_sources": [], "device_consumption": [{"stat_consumption": "a", "included_in_stat": "b"},
                                                                 {"stat_consumption": "b", "included_in_stat": "a"}]})
    assert len(loop.roots) == 2                                         # a loop loses no device


def test_a_day_is_split_as_the_kiosk_splits_it_nested_devices_counted_once():
    sp = E.split(_setup(), FRI.get)
    assert abs(sp.used - 75.46) < 1e-9                                  # the grid import: nothing returned, no solar
    assert sp.untracked == 0                                            # the phases account for it all
    assert abs(sp.overlap - 8.25) < 1e-6                                # pumps beside the phases: an overlap, not < 0
    a = next(r for r in sp.roots if r.node.id == "sensor.phase_a_energy")
    assert abs(a.untracked - (15.01 - 4.74)) < 1e-6                     # what phase A's lights leave of it
    assert sp.roots[0].node.id == "sensor.phase_c_energy"               # top level, largest first
    rank = E.ranking(sp)
    assert len(rank) == 18 and rank[0].node.id == "sensor.phase_c_energy"


def test_used_is_grid_in_plus_solar_less_what_went_back_never_below_zero():
    s = E.setup({"energy_sources": [{"type": "grid", "stat_energy_from": "g", "stat_energy_to": "r"},
                                    {"type": "solar", "stat_energy_from": "pv"}], "device_consumption": []})
    assert E.split(s, {"g": 10, "r": 4, "pv": 6}.get).used == 12
    assert E.split(s, {"g": 0, "r": 9, "pv": 1}.get).used == 0
    assert not E.usable({"energy_sources": [], "device_consumption": [{"stat_consumption": "x"}]})
    assert E.usable({"energy_sources": [{"type": "solar", "stat_energy_from": "pv"}]}) and not E.usable(None)


# ---------------------------------------------------------------- the read-only gate


class _Session:
    def __init__(self):
        self.calls = []

    def call_raw(self, name, args):
        self.calls.append((name, args))
        return {"content": [{"type": "text", "text": json.dumps(
            {"success": True, "mode": "get", "config": PREFS, "config_hash": "x"})}]}


def test_the_energy_settings_are_read_with_mode_get_and_every_writing_mode_is_refused():
    sess = _Session()
    c = McpClient("unused", "UTC", session=sess)
    assert c.energy_prefs() == PREFS
    for args in ({"mode": "set", "config": {}}, {"mode": "add_device", "stat_consumption": "sensor.x"},
                 {"mode": "remove_device", "stat_consumption": "sensor.x"}, {"mode": "add_source", "source": {}},
                 {"mode": None}, {"action": "get"}):
        with pytest.raises(HAError, match="only its get mode is allowed"):
            c.tool("ha_manage_energy_prefs", args)
    # a writing client (the executor's) is held to the same: the settings are never the agent's to change
    w = McpClient("unused", "UTC", write=True, session=sess)
    with pytest.raises(HAError):
        w.tool("ha_manage_energy_prefs", {"mode": "set", "config": {}})
    assert sess.calls == [("ha_manage_energy_prefs", {"mode": "get"})]


# ---------------------------------------------------------------- roi-energy and the weekly page, end to end

START = datetime(2026, 9, 7, tzinfo=timezone.utc)
DAYS = 28
DAILY = {  # an invented villa, kWh a day: two phases at the top, a circuit inside A with an oven inside it, a pump in B
    "sensor.example_main_energy": 30.0, "sensor.example_main_energy_returned": 2.0,
    "sensor.example_main_phase_a_energy": 12.0, "sensor.example_main_phase_b_energy": 16.0,
    "sensor.example_kitchen_circuit_energy": 6.0, "sensor.example_oven_energy": 4.0,
    "sensor.example_pool_pump_energy": 5.0}
SETTINGS = {
    "energy_sources": [{"type": "grid", "stat_energy_from": "sensor.example_main_energy",
                        "stat_energy_to": "sensor.example_main_energy_returned"}],
    "device_consumption": [
        {"stat_consumption": "sensor.example_main_phase_a_energy"},
        {"stat_consumption": "sensor.example_main_phase_b_energy"},
        {"stat_consumption": "sensor.example_kitchen_circuit_energy", "name": "Kitchen circuit",
         "included_in_stat": "sensor.example_main_phase_a_energy"},
        {"stat_consumption": "sensor.example_oven_energy", "name": "Oven",
         "included_in_stat": "sensor.example_kitchen_circuit_energy"},
        {"stat_consumption": "sensor.example_pool_pump_energy", "name": "Pool pump",
         "included_in_stat": "sensor.example_main_phase_b_energy"}]}


def _villa(tmp, settings=SETTINGS):
    fx = tmp / "fx"
    fx.mkdir()
    ms = lambda d: int((START + timedelta(days=d)).timestamp() * 1000)  # noqa: E731
    (fx / "stats_day_energy.json").write_text(json.dumps({"period_type": "day", "entities": [
        {"entity_id": eid, "statistics": [{"start": ms(d), "change": v, "sum": 0} for d in range(DAYS)]}
        for eid, v in DAILY.items()]}))
    if settings is not None:
        (fx / "energy_prefs.json").write_text(json.dumps(settings))
    row = lambda eid, asset, name: {"entity_id": eid, "name": name, "area": "Garden", "family": "energy", "asset": asset}  # noqa: E731
    now = "2026-10-04T10:00:00+00:00"
    pack = {"villa": "Example Villa", "time_zone": "UTC", "generated_at": now, "ha_version": None, "areas": [],
            "people": [], "channels": {}, "unknown_area": [], "unclassified": [],
            "retention": {"raw_history_days": 10, "statistics": "permanent"},
            "families": {"energy": [row(eid, eid.split(".")[1].removesuffix("_energy"), eid) for eid in DAILY]},
            "assets": {}}
    (tmp / "pack.json").write_text(json.dumps(pack))
    return fx


def _period(tmp, fx):
    from test_reports import _run
    r = _run(os.path.join(STARTER_SKILLS, "roi-energy", "scripts", "energy_period.py"), "--pack", str(tmp / "pack.json"),
             "--period", "custom", "--start", "2026-09-28", "--end", "2026-10-04", "--fixture-dir", str(fx),
             "--zone", "UTC", "--out", str(tmp / "week.json"))
    assert r.returncode == 0, r.stderr
    return json.load(open(tmp / "week.json"))


def test_the_week_follows_the_energy_settings_and_counts_a_nested_device_once(tmp_path):
    out = _period(tmp_path, _villa(tmp_path))
    assert out["basis"] == "settings"
    assert out["total_kwh"] == 196.0                     # (30 in − 2 back) × 7: the Kiosk's "used"
    assert out["unmetered_kwh"] == 0.0 and out["overlap_kwh"] == 0.0    # the phases account for it all
    assert out["metered_kwh"] == 196.0                   # the top level only: the oven is not subtracted twice
    by = {l["name"]: l for l in out["loads"]}
    assert by["Oven"]["inside"] == "Kitchen circuit" and by["Kitchen circuit"]["untracked_kwh"] == 14.0
    assert [l["kwh"] for l in out["loads"]] == [112.0, 84.0, 42.0, 35.0, 28.0]   # every device, largest first
    assert "Not metered: 0%" in out["headline"] and "note" not in out
    assert out["total_from"] == {"grid_in": ["sensor.example_main_energy"],
                                 "grid_out": ["sensor.example_main_energy_returned"], "solar": []}


def test_the_weekly_pages_days_are_the_same_total_as_the_week(tmp_path):
    fx = _villa(tmp_path)
    _period(tmp_path, fx)
    from test_reports import FACTS, _run
    r = _run(FACTS, "fm-weekly", "--pack", str(tmp_path / "pack.json"), "--store", str(tmp_path / "s.sqlite"),
             "--energy", str(tmp_path / "week.json"), "--fixture-dir", str(fx), "--now", "2026-10-05T07:00:00+00:00",
             "--out", str(tmp_path / "facts.json"))
    assert r.returncode == 0, r.stderr
    s = json.load(open(tmp_path / "facts.json"))["sections"]
    assert [d["kwh"] for d in s["energy_days"]["rows"]] == [28.0] * 7          # grid in less what went back
    assert sum(d["kwh"] for d in s["energy_days"]["rows"]) == 196.0
    oven = next(x for x in s["circuits"]["rows"] if x["name"] == "Oven")
    assert oven["basis"] == "measured, inside Kitchen circuit"


def test_with_no_settings_the_old_guess_stays_and_its_note_names_no_setting(tmp_path):
    fx = _villa(tmp_path, settings=None)
    out = _period(tmp_path, fx)
    assert out["basis"] == "names" and out["main_meter"] == "sensor.example_main_energy"
    assert out["total_kwh"] == 210.0 and "Energy settings name no grid meter" in out["total_basis"]
    pack = json.load(open(tmp_path / "pack.json"))
    pack["families"]["energy"] = [r for r in pack["families"]["energy"] if "main_energy" not in r["entity_id"]]
    (tmp_path / "pack.json").write_text(json.dumps(pack))
    (tmp_path / "week.json").unlink()
    out = _period(tmp_path, fx)
    assert out["total_kwh"] is None
    said = out["note"] + " " + out["headline"]
    assert out["note"] == ("No total: the villa's Energy settings name no grid meter, and no meter is recognisably the "
                           "main one. Adding the grid meter to the villa system's Energy settings gives the total.")
    assert "input_" not in said and "Home Assistant" not in said and " HA" not in said


def test_a_finished_week_is_worked_out_again_when_the_pack_or_the_code_changes(tmp_path):
    # villa, 2026-10-19: week 42 was kept under the period alone, and the report made after an update read the
    # figures made before it ("Main Power Device" three times, a name the update had fixed)
    from test_reports import _run
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "roi-energy", "scripts"))
    import energy_period
    fx = _villa(tmp_path)

    def week():
        r = _run(os.path.join(STARTER_SKILLS, "roi-energy", "scripts", "energy_period.py"), "--pack", str(tmp_path / "pack.json"),
                 "--period", "custom", "--start", "2026-09-28", "--end", "2026-10-04", "--fixture-dir", str(fx),
                 "--zone", "UTC", "--store", str(tmp_path / "s.sqlite"), "--out", str(tmp_path / "week.json"))
        assert r.returncode == 0, r.stderr
        return json.load(open(tmp_path / "week.json"))
    assert week()["from_cache"] is False and week()["from_cache"] is True          # the same week, kept
    pack = json.load(open(tmp_path / "pack.json"))
    pack["generated_at"] = "2026-10-05T01:30:00+00:00"                            # the night rebuilt the pack
    (tmp_path / "pack.json").write_text(json.dumps(pack))
    assert week()["from_cache"] is False
    # the code: the tag follows the script and the shared rules it computes with
    from vesta_shared.knowledge_pack import KnowledgePack
    p = KnowledgePack.load(str(tmp_path / "pack.json"))
    tag = energy_period.calc_tag(p)
    p.generated_at = "other"
    assert energy_period.calc_tag(p) != tag
