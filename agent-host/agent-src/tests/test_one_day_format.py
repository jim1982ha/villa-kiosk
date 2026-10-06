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
        "offline": [{"item": "Pool pump", "since": "2026-10-06T08:15", "critical": False}], "ai_cost_usd": None}}}, {})
    assert "missing since Tue 6 Oct, 16:15" in html
