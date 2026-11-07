"""Architecture review 7: every skill script starts from one set-up (vesta_shared.script) — one rule each for the
time zone, the store, the villa's settings and the day."""
from __future__ import annotations

import argparse
import json
from datetime import date

import pytest

from vesta_shared import script


def ctx(argv, **k):
    ap = argparse.ArgumentParser()
    script.arguments(ap, **k)
    return script.Context(ap.parse_args(argv))


@pytest.fixture
def pack(tmp_path):
    p = tmp_path / "pack.json"
    p.write_text(json.dumps({"villa": "x", "time_zone": "Asia/Makassar", "generated_at": "", "ha_version": None,
                             "families": {}, "assets": {}, "areas": [], "people": [], "channels": {},
                             "unknown_area": [], "unclassified": [], "retention": {}}))
    return str(p)


def test_one_rule_for_the_time_zone(pack, monkeypatch):
    monkeypatch.setenv("VILLA_TZ", "Europe/Paris")
    assert ctx(["--pack", pack, "--zone", "UTC"], pack=True).zone == "UTC"                # the engine's --zone first
    assert ctx(["--pack", pack], pack=True).zone == "Asia/Makassar"                       # then the pack's
    assert ctx([]).zone == "Europe/Paris"                                                  # then VILLA_TZ
    monkeypatch.delenv("VILLA_TZ")
    assert ctx([]).zone == "UTC"


def test_the_villas_settings_come_through_live_params_and_the_test_seam(tmp_path):
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "helpers.json").write_text(json.dumps({"helpers": [{"entity_id": "input_boolean.maintenance_mode"}],
                                                "states": {"input_boolean.maintenance_mode": "on"}}))
    c = ctx(["--store", str(tmp_path / "s.sqlite"), "--fixture-dir", str(fx)])
    assert c.params.boolean("maintenance_mode", default=False) is True
    assert c.store.cache_get("villa_params")                                               # kept ten minutes
    no_store = ctx(["--fixture-dir", str(fx)], store=False)
    assert no_store.params.boolean("maintenance_mode", default=False) is True               # read now, kept nowhere


def test_the_day_follows_the_time_given(pack):
    c = ctx(["--pack", pack, "--now", "2026-10-07T20:00:00+00:00"], pack=True)            # 04:00 on the 8th, Makassar
    assert c.day() == date(2026, 10, 8) and c.day(last_finished=True) == date(2026, 10, 7)
    assert c.day("2026-09-01") == date(2026, 9, 1)


