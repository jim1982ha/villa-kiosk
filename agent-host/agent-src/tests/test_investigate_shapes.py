"""Every kind of device a history read returns, against its own past (owner, 2026-10-20: "I never want to see wrong
responses" — "the skill shall universally handle all type of dataset"): investigate's timeline, which answers every
history read of the AI (skill.yaml `reads_history`), says a few lines per device and flags ⟵ only what is far from the
same hours of its days before.

The House Pump of that afternoon was read as "alternating between 0 and 1.2 W": its rest touches 0, and each 0 was a
"no power" period (140 of them), while the trouble — starting every few minutes — was said nowhere. A temperature, a
door and an energy counter got one line per reading. The shapes below are the villa's (the pump idles 0-1.7 W and runs
20-40 s at 750-1,100 W); every number is invented."""
from __future__ import annotations

import math
import os
import random
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from helpers import STARTER_SKILLS
from vesta_shared.ha_client import HABase

sys.path.insert(0, os.path.join(STARTER_SKILLS, "investigate", "scripts"))
import investigate as inv  # noqa: E402

Z = ZoneInfo("Asia/Singapore")
S, E = datetime(2026, 10, 17, tzinfo=Z), datetime(2026, 10, 20, 18, 0, tzinfo=Z)
FROM = datetime(2026, 10, 20, 12, 0, tzinfo=Z)          # the period asked about: 12:00-18:00 of the last day
TROUBLE = datetime(2026, 10, 20, 14, 0, tzinfo=Z)


def pump(trouble):
    rnd, rows, t, nxt = random.Random(1), [], S, S + timedelta(minutes=40)
    while t < E:
        if t >= nxt:
            rows += [(t, rnd.uniform(1050, 1100)), (t + timedelta(seconds=2), rnd.uniform(750, 900))]
            t += timedelta(seconds=rnd.randint(20, 40))
            busy = trouble and t >= TROUBLE
            nxt = t + timedelta(minutes=rnd.uniform(2, 5) if busy else rnd.uniform(30, 90))
        rows.append((t, rnd.choice([0.0, 1.0, 1.1, 1.2, 1.7])))
        t += timedelta(seconds=15)
    return rows


def temperature(trouble):
    rnd, rows, t = random.Random(2), [], S
    while t < E:
        v = 27 + 2 * math.sin((t.hour + t.minute / 60 - 9) / 24 * 2 * math.pi) + rnd.uniform(-0.2, 0.2)
        rows.append((t, round(v + (6 if trouble and t >= TROUBLE else 0), 1)))
        t += timedelta(minutes=rnd.uniform(2, 6))
    return rows


def door(trouble):
    rnd, rows, t = random.Random(3), [], S
    while t < E:
        t += timedelta(minutes=rnd.uniform(3, 10) if trouble and t >= FROM else rnd.uniform(120, 400))
        rows += [(t, "on"), (t + timedelta(seconds=rnd.uniform(10, 60)), "off")]
    return [r for r in rows if r[0] < E]


def energy(trouble):
    rows, t, v = [], S, 400.0
    while t < E:
        v += 0.2 if trouble and t >= TROUBLE else 0.02
        rows.append((t, round(v, 3)))
        t += timedelta(minutes=5)
    return rows


class _Client(HABase):
    def __init__(self, rows):
        self.rows = rows

    def states(self, ids):
        return {i: {"state": "x", "attributes": {"friendly_name": i}} for i in ids}

    def history(self, ids, start, end):
        before = [r for r in self.rows if r[0] < start][-1:]
        return {ids[0]: [{"state": str(v), "last_changed": max(t, start).isoformat()}
                         for t, v in before + [r for r in self.rows if start <= r[0] < end]]}


def lines(make, trouble):
    return inv.timeline(_Client(make(trouble)), ["sensor.x"], FROM, E, 3, Z, now=E)["lines"]


@pytest.mark.parametrize("make, says", [
    (pump, "more often than usual"),                        # how often it started, not how long each run
    (temperature, "above its usual highest from 14:0"),     # a level, against the same hours' band
    (door, "more often than usual"),                        # a state, how many times
    (energy, "faster than usual"),                          # a counter, how much it rose
])
def test_each_kind_says_its_trouble_in_a_few_lines_and_a_normal_day_flags_nothing(make, says):
    bad = lines(make, True)
    assert any(says in ln and "⟵" in ln for ln in bad), bad
    assert len(bad) <= 45, bad                              # a summary and its few moments, never a line per reading
    good = lines(make, False)
    assert not [ln for ln in good if "⟵" in ln], good       # its normal day: nothing flagged
    assert len(good) <= 45, good


def test_a_pump_whose_rest_touches_0_never_reads_as_having_no_power():
    said = "\n".join(lines(pump, True))
    assert "no power" not in said and "instead of its usual" not in said, said
