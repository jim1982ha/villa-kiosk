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


class _Pack:
    """A knowledge pack whose asset "x" carries a schedule: on 08:00-10:00 and 18:00-19:00 each day."""
    def row(self, eid):
        return {"entity_id": eid, "asset": "x"}

    def asset(self, slug):
        return {"schedule": "schedule.x_hours"} if slug == "x" else None

    def is_asleep(self, eid):
        return False


def _schedule():
    out, d = [], S
    while d < E:
        out += [(d.replace(hour=8), "on"), (d.replace(hour=10), "off"), (d.replace(hour=18), "on"), (d.replace(hour=19), "off")]
        d += timedelta(days=1)
    return [(datetime(2026, 10, 16, 23, tzinfo=Z), "off")] + out


class _WithSchedule(_Client):
    def history(self, ids, start, end):
        if ids[0] != "schedule.x_hours":
            return super().history(ids, start, end)
        rows = _schedule()
        before = [r for r in rows if r[0] < start][-1:]
        return {ids[0]: [{"state": v, "last_changed": max(t, start).isoformat()}
                         for t, v in before + [r for r in rows if start <= r[0] < end]]}


def test_starts_outside_its_schedule_are_compared_with_its_own_days_before():
    # owner, 2026-10-20: "not hardcoded and specific to a device, device class or family" — the schedule is the one the
    # knowledge pack attached to the device's asset; "unusual" is its own days before
    def outside(trouble, pack):
        return [ln for ln in inv.timeline(_WithSchedule(pump(trouble)), ["sensor.x"], FROM, E, 3, Z, now=E,
                                          pack=pack)["lines"] if "outside the hours of its schedule" in ln]
    (bad,) = outside(True, _Pack())
    assert "⟵" in bad and "more often than usual" in bad, bad
    (good,) = outside(False, _Pack())
    assert "⟵" not in good, good
    assert outside(True, None) == []                        # no schedule known: nothing said about one


def scattered(trouble):
    """The afternoon of 20 October as the readings show it: a burst of starts under 3 minutes apart (13:15-13:59), then
    starts 3 to 9 minutes apart all afternoon — each "ordinary" alone."""
    rnd, rows, t = random.Random(4), [], S
    nxt = S + timedelta(minutes=60)
    burst = (datetime(2026, 10, 20, 13, 15, tzinfo=Z), datetime(2026, 10, 20, 13, 59, tzinfo=Z))
    while t < E:
        if t >= nxt:
            rows += [(t, 1050.0), (t + timedelta(seconds=2), 820.0)]
            t += timedelta(seconds=rnd.randint(20, 35))
            if trouble and burst[0] <= t < burst[1]:
                gap = rnd.uniform(1, 2.5)
            elif trouble and t >= burst[1]:
                gap = rnd.uniform(3.2, 9)
            else:
                gap = rnd.uniform(60, 180)
            nxt = t + timedelta(minutes=gap)
            if trouble and t < burst[0] < nxt:
                nxt = burst[0]                               # the burst starts on time
        rows.append((t, rnd.choice([0.0, 1.1, 1.6])))
        t += timedelta(seconds=15)
    return rows


def test_starts_after_a_burst_are_said_hour_by_hour_never_as_its_normal():
    # owner, 2026-10-20: the answer said the House Pump "went idle" after its 13:28 burst — its later starts, each over
    # 3 minutes apart, were hidden as "like its normal"
    said = lines(scattered, True)
    (hours,) = [ln for ln in said if "starts in each hour" in ln]
    later = [int(h.split()[1]) for h in hours.split(": ", 1)[1].split(" · ") if h[:2] in ("15", "16", "17")]
    assert later and all(n > 0 for n in later), hours
    assert not [ln for ln in said if "like its normal" in ln], said


def test_an_id_no_device_has_is_said_so_never_as_nothing_recorded():
    # villa, 2026-10-20 21:57: the AI read the history of an id it made up, and "nothing recorded" read as a quiet pump
    class _Unknown(HABase):
        def states(self, ids):
            return {}

        def history(self, ids, start, end):
            return {}
    said = inv.timeline(_Unknown(), ["switch.made_up"], FROM, E, 3, Z, now=E)["lines"]
    assert any("no device of the villa's system has this id" in ln for ln in said), said
    assert not any("nothing recorded" in ln for ln in said), said
    quiet = inv.timeline(_Client([]), ["sensor.x"], FROM, E, 3, Z, now=E)["lines"]   # a real device that said nothing
    assert any("nothing recorded" in ln for ln in quiet), quiet


def test_a_start_surge_is_not_a_change_of_level_and_a_real_one_still_is():
    # villa, 2026-10-21 00:13: each start's 2-s surge (3,050 W) stayed the run's "level", and the settled 750 W after it
    # read as "level changes from about 3,050 to 750"
    t0 = datetime(2026, 10, 20, 13, 49, tzinfo=Z)
    surge = [(t0, "3050")] + [(t0 + timedelta(seconds=2 + 10 * i), str(750 + i % 3)) for i in range(40)]
    assert inv.level_jumps(surge, FROM, E, 10) == []
    real = [(t0 + timedelta(seconds=10 * i), "750" if i < 30 else "1500") for i in range(60)]
    got = inv.level_jumps(real, FROM, E, 10)
    assert [(round(j["from"]), round(j["to"])) for j in got] == [(750, 1500)], got


def test_a_burst_says_its_runs_against_the_usual_run():
    # villa, 2026-10-21 00:13: "⟵ runs of about 25 s each" was read as "runs shorter than normal" (usual: 33 s)
    def burst(run_s):
        ps, t = [], datetime(2026, 10, 20, 13, 28, tzinfo=Z)
        for _ in range(8):
            ps.append({"kind": inv.kinds.RUNNING, "start": t, "end": t + timedelta(seconds=run_s), "seconds": run_s,
                       "mean": 800.0, "min": 750.0, "max": 900.0})
            t += timedelta(seconds=run_s)
            ps.append({"kind": inv.kinds.IDLE, "start": t, "end": t + timedelta(seconds=60), "seconds": 60})
            t += timedelta(seconds=60)
        shown, _ = inv.worth_a_line(ps, {"run_median_s": 33, "run_longest_s": 40, "level_median": 800}, 300)
        return [p["why"] for p in shown if "runs of about" in (p.get("why") or "")]
    assert ["as long as its usual run of" in w for w in burst(30)] == [True], burst(30)
    assert ["shorter than its usual run of" in w for w in burst(8)] == [True], burst(8)


class _WithDays(_Client):
    """Its daily averages from the long-term figures: `means` from 7 October on (villa shape, numbers invented)."""
    def __init__(self, rows, means):
        super().__init__(rows)
        self.means = means

    def statistics(self, ids, start, end, period="hour", types=("mean",)):
        day0 = datetime(2026, 10, 7, tzinfo=Z)
        return {ids[0]: [{"start": int((day0 + timedelta(days=i)).timestamp() * 1000), "mean": m}
                         for i, m in enumerate(self.means) if start <= day0 + timedelta(days=i) < end]}


def test_a_change_that_began_before_its_days_before_is_said_from_the_daily_figures():
    # villa, 2026-10-21 00:13: the pump changed on 16 October; asked about the 20th, its 3 days before were already like
    # it and 101 starts read "close to its normal pattern"
    changed = [9, 28, 3, 2.5, 4.5, 8.4, 6, 5, 9, 70, 81, 125, 103, 113]          # 7 to 20 October
    said = inv.timeline(_WithDays(pump(False), changed), ["sensor.x"], FROM, E, 3, Z, now=E)["lines"]
    day = [ln for ln in said if "day by day" in ln]
    assert day and "⟵ since 16 Oct" in day[0] and "already like this" in day[0], said
    steady = [9, 8, 3, 2.5, 4.5, 8.4, 6, 5, 9, 7, 8, 6, 9, 7]
    said = inv.timeline(_WithDays(pump(False), steady), ["sensor.x"], FROM, E, 3, Z, now=E)["lines"]
    day = [ln for ln in said if "day by day" in ln]
    assert day and "⟵" not in day[0], said


def test_a_rest_drawing_far_above_its_usual_rest_is_flagged_and_its_ordinary_wander_is_not():
    # villa, 2026-10-21: a pump resting at 37 instead of 0.87 from 19:00 on went unsaid (only a rest at 0 was judged)
    def rest(mean):
        t = datetime(2026, 10, 20, 19, 0, tzinfo=Z)
        ps = [{"kind": inv.kinds.IDLE, "start": t, "end": t + timedelta(minutes=40), "seconds": 2400,
               "mean": mean, "min": mean - 1, "max": mean + 1}]
        shown, _ = inv.worth_a_line(ps, {"run_median_s": 33, "run_longest_s": 40, "level_median": 899,
                                         "rest_median": 0.87}, 300)
        return shown[0].get("why")
    assert rest(37) == "it read about 37 at rest instead of its usual 0.87"
    assert rest(1.9) is None
