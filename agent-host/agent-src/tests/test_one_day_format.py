"""One day format and one "which day" rule for every skill (vesta_shared.timeutil; architecture review, 2026-10-07)."""
from __future__ import annotations

import glob
import os
import re
import sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from helpers import STARTER_SKILLS
from vesta_shared.timeutil import day_label, day_time_label, villa_day


def test_a_day_is_written_one_way_never_with_a_leading_zero():
    d = date(2026, 10, 5)
    assert (day_label(d), day_label(d, weekday=True), day_label(d, long=True, year=True)) == \
        ("5 Oct", "Mon 5 Oct", "Monday 5 October 2026")
    assert day_time_label(datetime(2026, 10, 5, 9, 30), weekday=True) == "Mon 5 Oct, 09:30"


def test_no_skill_script_writes_a_day_by_hand():
    # seven "%a %d %b" ("Mon 05 Oct") were found by the review: a day goes through timeutil
    for f in glob.glob(os.path.join(STARTER_SKILLS, "*", "scripts", "*.py")):
        for m in re.finditer(r"strftime\([\"']([^\"']*)[\"']\)", open(f).read()):
            assert "%d" not in m.group(1), f"{os.path.relpath(f, STARTER_SKILLS)}: strftime({m.group(1)!r})"


def test_no_skill_reaches_into_another_skills_folder():
    # roi-energy imported preventive-maintenance's scripts by path: a villa without that skill lost its energy pages
    for f in glob.glob(os.path.join(STARTER_SKILLS, "*", "scripts", "*.py")):
        src = open(f).read()
        assert not re.search(r"sys\.path\.insert\([^)]*\"\.\.\"", src), os.path.relpath(f, STARTER_SKILLS)


def test_the_day_a_script_works_on():
    z = ZoneInfo("Asia/Makassar")
    assert villa_day(z, "2026-10-03") == date(2026, 10, 3)
    today = datetime.now(z).date()
    assert villa_day(z) == today and villa_day(z, last_finished=True) == today - timedelta(days=1)


def test_a_home_assistant_time_on_the_report_is_the_villas():
    # the offline row's "since" is Home Assistant's last_changed: UTC with its zone cut off
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    html = compose.page({"zone": "Asia/Makassar", "order": ["monitoring"], "sections": {"monitoring": {
        "offline": [{"item": "Pool pump", "since": "2026-10-06T08:15+00:00", "critical": False}], "ai_cost_usd": None}}}, {})
    assert "missing since Tue 6 Oct, 16:15" in html


def test_a_devices_state_is_read_one_way_by_the_reports_and_the_night_check():
    # architecture review, 2026-10-07: the weekly report counted "unknown" sensors as offline and read a 3.0 V
    # battery as "3 %, replace"; the night check knew better
    from vesta_shared.device_state import battery_charge, is_offline
    assert is_offline("unavailable") and not is_offline("unknown") and not is_offline("12")
    assert battery_charge(42, "%") == 42 and battery_charge(2.4, "V", 3.0) == 80.0
    assert battery_charge(3.0, "V") is None                       # no nominal: not guessed


def test_the_report_draws_a_volt_battery_against_its_nominal_and_skips_one_it_cannot_tell():
    import types
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import facts
    from vesta_shared.params import VillaParams
    params = VillaParams(helpers=[{"entity_id": "input_number.station_battery_nominal_v", "helper_type": "input_number",
                                   "id": "station_battery_nominal_v"}],
                         states={"input_number.station_battery_nominal_v": "3.0"})
    from vesta_shared.knowledge_pack import KnowledgePack
    c = types.SimpleNamespace(
        need=lambda *p: {"replace_below_pct": 20, "watch_below_pct": 35, "show": 8}[p[-1]],
        # a real pack (the one device lookup every section asks: knowledge_pack.device_of), with no devices kept
        pack=KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None, families={"battery": [
            {"entity_id": "sensor.station_battery", "name": "Station", "unit": "V", "asset": "station"},
            {"entity_id": "sensor.other_battery", "name": "Other", "unit": "V", "asset": "other"},
            {"entity_id": "sensor.door_battery", "name": "Door", "unit": "%", "asset": "door"}]},
            assets={}, areas=[], people=[], channels={}, unknown_area=[], unclassified=[], retention={}),
        states=lambda: {"sensor.station_battery": {"state": "2.97"}, "sensor.other_battery": {"state": "3.1"},
                        "sensor.door_battery": {"state": "55"}},
        params=lambda: params)
    rows = {r["name"]: r for r in facts.s_batteries(c)["rows"]}
    assert rows["Station"]["pct"] == 99 and rows["Station"]["volts"] == 2.97 and rows["Station"]["level"] == "ok"
    assert "Other" not in rows and rows["Door"]["pct"] == 55


def test_a_home_assistant_or_store_time_is_the_villas_once_converted():
    from vesta_shared.timeutil import villa_date, villa_time
    z = "Asia/Makassar"                                                    # UTC+8
    assert villa_time("2026-10-05T23:30:00+00:00", z).isoformat().startswith("2026-10-06T07:30")
    assert villa_time("2026-10-05T23:30", z).hour == 7                    # its zone cut off: UTC
    assert villa_date("2026-10-05T23:30:00+00:00", z).isoformat() == "2026-10-06"    # Monday morning, not Sunday
    assert villa_date("2026-10-05", z).isoformat() == "2026-10-05"        # a villa date stays as it is
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import facts
    assert facts._local("2026-10-06T08:15:02.1+00:00", z) == "2026-10-06T16:15"
    assert facts._fill("since {since}", {"since": facts._local("2026-10-06T08:15:02+00:00", z)}).endswith("16:15")


def test_every_point_of_a_reports_chart_says_its_day_and_value():
    # owner, 2026-10-07: "a tooltip when hovering the trend to see the detailed values" — SVG and CSS, no script
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    svg = compose.line([("2026-09-21", 100), ("2026-09-22", 59.4), ("2026-09-23", None), ("2026-09-24", 61)], "W")
    assert svg.count('class="pt"') == 3 and "<title>Mon 21 Sep · 100 W</title>" not in svg
    assert "<title>21 Sep · 100 W</title>" in svg and "<script" not in svg
    bars = compose.bars([{"label": "W1", "value": 30}, {"label": "W2", "value": None}])
    assert bars.count('class="pt"') == 1 and "<title>W1 · 30</title>" in bars
    pairs = compose.pairs([{"day": "Mon", "kwh": 12.5, "prev_kwh": 10}])
    assert "<title>Mon · 12 kWh · before 10</title>" in pairs
