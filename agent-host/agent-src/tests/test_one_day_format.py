"""One day format and one "which day" rule for every skill (vesta_shared.timeutil; architecture review, 2026-10-07)."""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from helpers import STARTER_SKILLS
from vesta_shared.timeutil import day_label, day_time_label, villa_day


def test_a_day_is_written_one_way_the_agreements():
    # owner, 2026-11-05: "one date format everywhere", the app's "04/11/2026 08:56", never "4 Nov, 08:56": a message's
    # title said one and its lines the other
    d = date(2026, 10, 5)
    assert (day_label(d), day_label(d, weekday=True), day_label(d, short=True)) == ("05/10/2026", "Mon 05/10/2026", "Mon")
    assert day_time_label(datetime(2026, 10, 5, 9, 30), weekday=True) == "Mon 05/10/2026 09:30"
    assert day_time_label(datetime(2026, 10, 5, 9, 30)) == "05/10/2026 09:30"
    from vesta_shared.timeutil import MOMENT, moment_label
    assert day_label(d) == d.strftime(MOMENT["date"])                                   # the agreement's, not a copy
    assert day_time_label(datetime(2026, 10, 5, 9, 30, tzinfo=ZoneInfo("UTC"))) == \
        moment_label(datetime(2026, 10, 5, 9, 30, tzinfo=ZoneInfo("UTC")), "UTC")


def test_the_day_a_script_works_on():
    z = ZoneInfo("Asia/Makassar")
    assert villa_day(z, "2026-10-03") == date(2026, 10, 3)
    today = datetime.now(z).date()
    assert villa_day(z) == today and villa_day(z, last_finished=True) == today - timedelta(days=1)


def test_a_devices_state_is_read_one_way_by_the_reports_and_the_night_check():
    # architecture review, 2026-10-07: the weekly report counted "unknown" sensors as offline and read a 3.0 V
    # battery as "3 %, replace"; the night check knew better
    from vesta_shared.device_state import battery_charge, is_offline
    assert is_offline("unavailable") and not is_offline("unknown") and not is_offline("12")
    assert battery_charge(42, "%") == 42 and battery_charge(2.4, "V", 3.0) == 80.0
    assert battery_charge(3.0, "V") is None                       # no nominal: not guessed


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
    assert said == "V: 123 kWh from 05/10/2026 to 11/10/2026. Largest: Pool pump 35%. Not metered: 13%."
