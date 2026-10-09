"""A setting: read one way, missing one way, never one villa's value in the code (architecture review 13)."""
import os
import sys

import pytest

from vesta_shared.params import MissingParameter, VillaParams

HERE = os.path.dirname(__file__)
SKILLS = os.path.join(HERE, "..", "starter", "skills")


def _helper(oid, value, unit=None, kind="input_number"):
    h = {"entity_id": f"{kind}.{oid}", "helper_type": kind, "id": oid}
    if unit:
        h["unit_of_measurement"] = unit
    return h, {f"{kind}.{oid}": value}


def _params(*pairs):
    helpers, states = [], {}
    for h, s in pairs:
        helpers.append(h)
        states.update(s)
    return VillaParams(helpers=helpers, states=states)


def test_a_tariff_says_its_currency_or_asks_for_it():
    assert _params(_helper("electricity_tariff_kwh", "0.2", "EUR/kWh")).tariff() == (0.2, "EUR")
    assert _params(_helper("electricity_tariff_kwh", "0.2", "kWh"),
                   _helper("villa_currency", "CHF", kind="input_text")).tariff() == (0.2, "CHF")
    with pytest.raises(MissingParameter) as e:                    # no currency anywhere: asked for, never a guess
        _params(_helper("electricity_tariff_kwh", "0.2")).tariff()
    assert e.value.name == "villa_currency"


def test_the_filtration_pump_is_the_villas_to_say():
    sys.path.insert(0, os.path.join(SKILLS, "roi-energy", "scripts"))
    import filtration_optimiser as fo
    pack = type("P", (), {"assets": {"house_pump": {}, "pool_pump": {}, "pool_light": {}}})()
    assert fo.filtration_pump(pack, _params(_helper("pool_volume_m3", "60")))[0] == "pool_pump"   # set up
    assert fo.filtration_pump(pack, _params()) == (None, ["house_pump", "pool_pump"])          # two, none set up
    one = type("P", (), {"assets": {"spa_pump": {}}})()
    assert fo.filtration_pump(one, _params())[0] == "spa_pump"                    # the only one: its gaps named


def test_the_weekly_report_reads_its_settings_through_the_script_context():
    sys.path.insert(0, os.path.join(SKILLS, "reports", "scripts"))
    import facts
    given = _params(_helper("station_battery_nominal_v", "3.0"))
    c = facts.Ctx.__new__(facts.Ctx)
    c._params, c._params_of, c.store, c.cli = None, (lambda: given), None, None
    assert c.params() is given
    src = open(os.path.join(SKILLS, "reports", "scripts", "facts.py")).read()
    assert "params=lambda: s.params" in src                                         # main hands it the Context's
