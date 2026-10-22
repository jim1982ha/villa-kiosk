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
    # a time on the page is the villa's: "listening since" is a UTC instant
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    html = compose.page({"zone": "Asia/Makassar", "order": ["monitoring"], "sections": {"monitoring": {
        "listening_since": "2026-10-06T08:15+00:00", "ai_cost_usd": None}}}, {})
    assert "Listening since Tue 6 Oct, 16:15" in html
    # ⚠️ never the villa's devices (owner, 2026-10-19): an offline sensor given to it is not drawn
    html = compose.page({"zone": "Asia/Makassar", "order": ["monitoring"], "sections": {"monitoring": {
        "offline": [{"item": "Pool pump", "since": "2026-10-06T08:15+00:00", "critical": False}],
        "listening_since": None, "ai_cost_usd": None}}}, {})
    assert "Pool pump" not in html and "Offline" not in html and "The whole period" in html


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
    import playbook
    from vesta_shared.params import VillaParams
    params = VillaParams(helpers=[{"entity_id": "input_number.station_battery_nominal_v", "helper_type": "input_number",
                                   "id": "station_battery_nominal_v"}],
                         states={"input_number.station_battery_nominal_v": "3.0"})
    from vesta_shared.knowledge_pack import KnowledgePack
    # ⚠️ THE LEVEL IS THE NIGHT CHECK'S (owner, 2026-10-19): a battery the night found falling is "watch" at 99 %, one
    # it said to replace is "replace" whatever its charge — the page draws the charge and judges nothing itself
    night = types.SimpleNamespace(findings=lambda status: [
        {"rule_id": "PM-BATTERY-TREND", "entity_id": "sensor.station_battery",
         "summary": "Station battery is falling 2.0 points a day, about 9 days left."}])
    c = types.SimpleNamespace(
        need=lambda *p: {"show": 8}[p[-1]],
        store=night,
        tasks=lambda: [{"rule_id": "PM-BATTERY-LOW", "entity_id": "sensor.door_battery",
                        "title": "Door battery at 55%: replace within the week."}],
        # a real pack (the one device lookup every section asks: knowledge_pack.device_of), with no devices kept
        pack=KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None, families={"battery": [
            {"entity_id": "sensor.station_battery", "name": "Station", "unit": "V", "asset": "station"},
            {"entity_id": "sensor.other_battery", "name": "Other", "unit": "V", "asset": "other"},
            {"entity_id": "sensor.door_battery", "name": "Door", "unit": "%", "asset": "door"}]},
            assets={}, areas=[], people=[], channels={}, unknown_area=[], unclassified=[], retention={}),
        states=lambda: {"sensor.station_battery": {"state": "2.97"}, "sensor.other_battery": {"state": "3.1"},
                        "sensor.door_battery": {"state": "55"}},
        params=lambda: params, now=None)
    rows = {r["name"]: r for r in facts.s_batteries(c)["rows"]}
    assert rows["Station"]["pct"] == 99 and rows["Station"]["volts"] == 2.97 and rows["Station"]["level"] == "watch"
    assert rows["Station"]["night"].startswith("Station battery is falling")             # the finding's own sentence
    assert "Other" not in rows and rows["Door"]["pct"] == 55 and rows["Door"]["level"] == "replace"
    c.store, c.tasks = types.SimpleNamespace(findings=lambda status: []), lambda: []
    assert {r["level"] for r in facts.s_batteries(c)["rows"]} == {"ok"}                  # nothing found: nothing judged


def test_a_home_assistant_or_store_time_is_the_villas_once_converted():
    from vesta_shared.timeutil import villa_date, villa_time
    z = "Asia/Makassar"                                                    # UTC+8
    assert villa_time("2026-10-05T23:30:00+00:00", z).isoformat().startswith("2026-10-06T07:30")
    assert villa_time("2026-10-05T23:30", z).hour == 7                    # its zone cut off: UTC
    assert villa_date("2026-10-05T23:30:00+00:00", z).isoformat() == "2026-10-06"    # Monday morning, not Sunday
    assert villa_date("2026-10-05", z).isoformat() == "2026-10-05"        # a villa date stays as it is
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import facts
    import playbook
    assert facts._local("2026-10-06T08:15:02.1+00:00", z) == "2026-10-06T16:15"
    assert playbook._fill("since {since}", {"since": facts._local("2026-10-06T08:15:02+00:00", z)}).endswith("16:15")


def test_every_point_of_a_reports_chart_says_its_day_and_value():
    # owner, 2026-10-07: "a tooltip when hovering the trend to see the detailed values" — SVG and CSS, no script
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    svg = compose.line([("2026-09-21", 100), ("2026-09-22", 59.4), ("2026-09-23", None), ("2026-09-24", 61)], "W")
    assert svg.count('class="pt"') == 3 and 'aria-label="Mon 21 Sep · 100 W"' not in svg
    assert 'aria-label="21 Sep · 100 W"' in svg and "<script" not in svg
    bars = compose.bars([{"label": "W1", "value": 30}, {"label": "W2", "value": None}])
    assert bars.count('class="pt"') == 1 and 'aria-label="W1 · 30"' in bars
    pairs = compose.pairs([{"day": "Mon", "kwh": 12.5, "prev_kwh": 10}])
    assert 'aria-label="Mon · 12.5 kWh · before 10"' in pairs      # one number rule (page.number): 12.5 is said whole


def test_the_alerts_are_folded_with_their_count_in_every_report():
    # owner, 2026-10-19: "Alerts that fired" collapsed by default, in every report with it (the monthly's "What happened")
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    rows = [{"when_h": "Mon 12 Oct, 22:28", "what": "Leak", "lasted": "1 min", "outcome": "Cleared", "times": 2},
            {"when_h": "Tue 13 Oct, 10:00", "what": "Door", "lasted": "", "outcome": "Cleared", "times": 1}]
    for sid, title in (("alerts", "Alerts that fired"), ("happened", "What happened")):
        html = compose.page({"zone": "UTC", "order": [sid], "sections": {sid: {"rows": rows}}}, {})
        assert f'<details class="fold">\n  <summary><h2>{title} (3)</h2></summary>' in html, sid
        assert "<details class=\"fold\" open" not in html


def test_a_moment_on_an_investigation_is_one_clock():
    # architecture review round 3, 2026-10-19: four clocks on one investigation (see test_investigate's one-clock test)
    from vesta_shared.timeutil import clock
    z = ZoneInfo("Asia/Makassar")
    t = datetime(2026, 10, 8, 19, 9, 46, tzinfo=ZoneInfo("UTC"))                   # 03:09:46 on 9 Oct at the villa
    assert clock(t, z, days=False) == "03:09" and clock(t, z, days=True) == "9 Oct, 03:09"
    assert clock(t, z, days=False, seconds=True) == "03:09:46" and clock(t, "Asia/Makassar", days=True, seconds=True) \
        == "9 Oct, 03:09:46"


def test_a_stored_day_or_moment_is_read_into_words_once():
    # the playbook's _fill.show and the composer's day()/when() each sniffed facts.json's ISO strings their own way
    from vesta_shared.timeutil import month_label, said
    assert said("2026-10-05") == "5 Oct" and said("2026-10-05", weekday=True) == "Mon 5 Oct"
    assert said("2026-10-06T16:15") == "6 Oct, 16:15" and said("2026-10-06T16:15", weekday=True, day=True) == "Tue 6 Oct"
    assert said("2026-10-06T08:15+00:00", "Asia/Makassar", weekday=True) == "Tue 6 Oct, 16:15"   # an aware time: the villa's
    assert said("2026-10-06T08:15+00:00", weekday=True) == "Tue 6 Oct, 08:15"                    # no zone given: as it is
    assert said("not a day") == "not a day" and said(12) == 12 and said(None) is None and said("2026-13-45") == "2026-13-45"
    assert month_label(date(2026, 10, 5)) == "October 2026" and day_label(date(2026, 10, 5), short=True) == "Mon"
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import playbook
    assert playbook._fill("since {a}, on {b}: {c}", {"a": "2026-10-06T16:15", "b": "2026-10-05", "c": 3}) == \
        "since 6 Oct, 16:15, on 5 Oct: 3"


def test_a_figure_is_written_by_one_rule_on_every_page_and_headline():
    # the composer wrote 12.34 as "12.3" and a 0.15 tariff as "0.2"; the charts "12" and "0.15"; the energy headline "12"
    from vesta_shared.page import number
    assert (number(None), number(12), number(12.34), number(0.15), number(1234.5), number(1.5), number(999.4, whole=True)) == \
        ("—", "12", "12.3", "0.15", "1,234", "1.5", "999")
    assert number(12.34, "kWh") == "12.3 kWh" and number(35.4, "%", whole=True) == "35%" and number(-0.001) == "0"
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    html = compose.page({"zone": "UTC", "order": ["hero"], "sections": {"hero": {"kwh": 12.34, "tariff": 0.15, "cost": 2, "colour": "good", "text": "Green: x",
                        "currency": "USD", "vs_prev_pct": 2}}}, {})
    assert "(12.3 kWh at 0.15 USD/kWh)" in html
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "roi-energy", "scripts"))
    import energy_period
    said = energy_period.headline({"villa": "V", "total_kwh": 123.4, "start": "2026-10-05", "end": "2026-10-11",
                                   "total_cost": None, "total_vs_prev_pct": None, "period": "week", "unmetered_pct": 12.6,
                                   "loads": [{"family": "energy", "name": "Pool pump", "share_pct": 35.4}]})
    assert said == "V: 123 kWh from 5 Oct to 11 Oct. Largest: Pool pump 35%. Not metered: 13%."
