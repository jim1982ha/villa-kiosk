"""A read of the villa's past says how far it got, and no reader goes past it (architecture review round 2, 2026-10-16).

history() and logbook() returned plain lists and left `history_cut` / `logbook_cut` on the client, reset at every
call: a pump's runs for the closing day, the weekly page's alert count, a report's "state at noon" and the alert desk's
"back for 10 minutes" stretched the last row read to the period's end. history_read / logbook_read carry the reach
with the rows (vesta_shared.past); the old calls keep their plain lists and attributes for skills edited on the villa.
Synthetic villa; ids invented."""
from __future__ import annotations

import importlib.util
import os
import sys
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from helpers import STARTER_SKILLS
from test_ha_reads import CappedLogbook, Recorder
from villa_timeline import TimelineVilla
from vesta_shared import past
from vesta_shared.device_state import OFFLINE, out_for
from vesta_shared.ha_client import McpClient

NOW = datetime(2026, 10, 9, 15, 0, tzinfo=timezone.utc)


def _load(skill: str, name: str):
    spec = importlib.util.spec_from_file_location(f"past_{name}", os.path.join(STARTER_SKILLS, skill, "scripts", f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    if os.path.dirname(spec.origin) not in sys.path:
        sys.path.insert(0, os.path.dirname(spec.origin))           # its siblings (playbook beside facts)
    spec.loader.exec_module(mod)
    return mod


def test_the_one_sentence_for_a_read_stopped_short():
    assert past.unread("its history", "04:00") == "its history could not be read whole: nothing is known after 04:00"


def test_a_history_read_carries_where_it_stopped_and_the_old_call_still_answers_as_before(monkeypatch):
    from vesta_shared import ha_client
    monkeypatch.setattr(ha_client, "HISTORY_MAX_CALLS", 8)
    start, end = NOW - timedelta(days=3), NOW
    rows = [(start + timedelta(seconds=5 * i), f"{i % 7}.0") for i in range(3 * 86400 // 5)]
    client = McpClient("http://unused", "UTC", session=Recorder(rows))
    got = client.history_read(["sensor.meter"], start, end, now=NOW)
    reach = got.reach("sensor.meter")
    assert not got.whole("sensor.meter") and start < reach < end
    assert all(t <= reach for t, _ in got.changes("sensor.meter"))
    # the old call: the same plain list, the same attribute an edited skill reads
    old = client.history(["sensor.meter"], start, end)
    assert old == got.rows and isinstance(old["sensor.meter"], list) and client.history_cut == {"sensor.meter": reach}
    # a later read on the same client leaves the first one's reach as it was (it was reset at every call)
    client.history(["sensor.meter"], start, start + timedelta(minutes=10))
    assert client.history_cut == {} and got.reach("sensor.meter") == reach


def test_a_logbook_read_carries_where_it_stopped_and_the_old_call_still_answers_as_before():
    start = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc) - timedelta(days=3)     # CappedLogbook's three days
    c = McpClient("http://unused", "UTC", session=CappedLogbook(200 * 5 + 1, cap=5, every=0.1))   # past its 200 pages
    book = c.logbook_read(start, start + timedelta(days=3), now=NOW)
    assert not book.whole and book.reach == max(datetime.fromisoformat(r["when"]) for r in book.rows)
    old = c.logbook(start, start + timedelta(days=3))
    assert old == book.rows and c.logbook_cut == book.reach
    whole = McpClient("http://unused", "UTC", session=CappedLogbook(100, every=60)).logbook_read(
        start, start + timedelta(days=3), now=NOW)
    assert whole.whole and whole.reach == start + timedelta(days=3) and len(whole.rows) == 100


def test_a_period_that_would_end_later_ends_now():
    rec = Recorder([(NOW - timedelta(hours=2), "off"), (NOW - timedelta(hours=1), "on")])
    got = McpClient("http://unused", "UTC", session=rec).history_read(["switch.x"], NOW - timedelta(hours=3),
                                                                       NOW + timedelta(hours=9), now=NOW)
    assert got.end == NOW and got.whole("switch.x") and max(b for _, b in rec.windows) <= NOW
    assert got.periods("switch.x")[-1] == (NOW - timedelta(hours=1), NOW, "on")      # not to 00:00 tonight
    later = McpClient("http://unused", "UTC", session=CappedLogbook(10)).logbook_read(NOW + timedelta(hours=1),
                                                                                      NOW + timedelta(hours=2), now=NOW)
    assert later.rows == [] and later.whole


def test_the_state_at_a_moment_and_the_periods_stop_at_the_reach():
    t0 = NOW - timedelta(hours=10)
    villa = TimelineVilla(**{"lock.door": [(t0 - timedelta(hours=1), "locked"), (t0 + timedelta(hours=2), "unlocked"),
                                           (t0 + timedelta(hours=6), "locked")]},
                          cut={"lock.door": t0 + timedelta(hours=4)})
    got = villa.history_read(["lock.door"], t0, NOW, now=NOW)
    assert got.reach("lock.door") == t0 + timedelta(hours=4) and not got.whole("lock.door")
    assert got.state_at("lock.door", t0 + timedelta(hours=1)) == "locked"
    assert got.state_at("lock.door", t0 + timedelta(hours=3)) == "unlocked"
    assert got.state_at("lock.door", t0 + timedelta(hours=5)) is None             # past the reach: not known
    assert got.state_at("lock.door", t0 - timedelta(minutes=1)) is None           # before the period
    assert got.periods("lock.door") == [(t0, t0 + timedelta(hours=2), "locked"),
                                        (t0 + timedelta(hours=2), t0 + timedelta(hours=4), "unlocked")]
    whole = TimelineVilla(**{"lock.door": [(t0 - timedelta(hours=1), "locked"), (t0 + timedelta(hours=6), "unlocked")]})
    assert whole.history_read(["lock.door"], t0, NOW, now=NOW).periods("lock.door") == [
        (t0, t0 + timedelta(hours=6), "locked"), (t0 + timedelta(hours=6), NOW, "unlocked")]


def test_back_for_ten_minutes_is_never_told_from_a_read_stopped_short():
    # it dropped at 14:56 and reported again at 14:59: a reading stopped at 14:54 saw only good values
    timeline = [(NOW - timedelta(minutes=30), "20.1"), (NOW - timedelta(minutes=4), "unavailable"),
                (NOW - timedelta(minutes=1), "20.3")]
    states = {"sensor.meter": {"state": "20.3", "last_changed": (NOW - timedelta(minutes=1)).isoformat()}}
    cut = TimelineVilla(now=NOW, cut={"sensor.meter": NOW - timedelta(minutes=6)}, **{"sensor.meter": timeline})
    assert out_for(cut, ["sensor.meter"], states, OFFLINE, NOW, 10) is False
    steady = [(NOW - timedelta(minutes=30), "20.1"), (NOW - timedelta(minutes=1), "20.3")]
    assert out_for(TimelineVilla(now=NOW, **{"sensor.meter": steady}), ["sensor.meter"], states, OFFLINE, NOW, 10) is True
    shy = TimelineVilla(now=NOW, cut={"sensor.meter": NOW - timedelta(minutes=6)}, **{"sensor.meter": steady})
    assert out_for(shy, ["sensor.meter"], states, OFFLINE, NOW, 10) is False      # its last minutes were never read


def test_a_day_past_the_reach_is_never_counted_empty_or_occupied():
    playbook = _load("reports", "playbook")
    d1 = date(2026, 10, 5)
    Z = timezone.utc
    mode = [(datetime(2026, 10, 1, tzinfo=Z), "home"), (datetime(2026, 10, 6, 6, tzinfo=Z), "away")]

    def ctx(cut):
        villa = TimelineVilla(**{"switch.x": mode}, cut=cut)
        # the villa's total per day (facts.Ctx.daily_total: the Energy settings' rule, round 2 2026-10-16)
        return SimpleNamespace(energy={"main_meter": "sensor.meter"}, start=d1, end=d1 + timedelta(days=3), Z=Z,
                               e_dt=datetime(2026, 10, 9, tzinfo=Z), now=NOW, cli=villa, problems=[],
                               total_from=lambda: {"grid_in": ["sensor.meter"], "grid_out": [], "solar": []},
                               daily_total=lambda s, e: {d1: 10.0, d1 + timedelta(days=1): 5.0,
                                                          d1 + timedelta(days=2): 5.0, d1 + timedelta(days=3): 5.0})
    when = {"mode_entity": "switch.x", "empty": ["away"], "days": 4}
    c = ctx({"switch.x": datetime(2026, 10, 6, 13, tzinfo=Z)})
    (clue,) = playbook.clue_use_while_empty(c, when)
    assert (clue["empty_days"], clue["kwh_per_empty_day"], clue["kwh_per_other_day"]) == (1, 5.0, 10.0)
    assert c.problems == ["Electricity while the villa is empty: its mode could not be read whole: nothing is known "
                          "after 6 Oct, 13:00 — the days after that are not counted."]
    c = ctx(None)
    (clue,) = playbook.clue_use_while_empty(c, when)
    assert clue["empty_days"] == 3 and c.problems == []


def test_a_rule_whose_runs_were_read_short_says_its_count_is_not_the_weeks(tmp_path):
    from test_reports import _Book, _ctx

    class Short(_Book):
        def logbook(self, start, end, entity_id=None):
            self.logbook_cut = datetime(2026, 9, 29, 8, 0, tzinfo=timezone.utc)
            return [r for r in super().logbook(start, end, entity_id) if r["when"] < "2026-09-29T08"]
    book = Short(["2026-09-28T07:41:00+00:00", "2026-09-30T07:41:00+00:00"], [])
    facts, c, _ = _ctx(tmp_path, book)
    assert [r["when"] for r in c.ha_alerts()] == ["2026-09-28T07:41:00+00:00"]
    assert c.problems == ["Entrance unlocked: its runs could not be read whole: nothing is known after Tue 29 Sep, 08:00 "
                          "— its alerts after that are not counted."]
    facts, c, _ = _ctx(tmp_path, _Book(["2026-09-28T07:41:00+00:00"], []))
    c.ha_alerts()
    assert c.problems == []


def test_a_run_still_going_where_the_reading_stopped_is_not_a_run():
    features = _load("preventive-maintenance", "features")
    t0 = NOW - timedelta(hours=10)
    rows = [{"state": "0", "last_changed": t0.isoformat()}]
    rows += [{"state": str(800 - k), "last_changed": (t0 + timedelta(minutes=k)).isoformat()} for k in range(1, 61)]
    rows += [{"state": "0", "last_changed": (t0 + timedelta(minutes=61)).isoformat()}]
    rows += [{"state": "900", "last_changed": (t0 + timedelta(minutes=100 + k)).isoformat()} for k in range(40)]
    runs = features.runs_from_history(rows, 100, "UTC")
    assert [r["minutes"] for r in runs] == [59, 39]
    assert [r["minutes"] for r in features.ended_runs(runs, rows, 100, "UTC")] == [59]     # the second had no end read
    ended = rows + [{"state": "0", "last_changed": (t0 + timedelta(minutes=150)).isoformat()}]
    assert features.ended_runs(features.runs_from_history(ended, 100, "UTC"), ended, 100, "UTC") == \
        features.runs_from_history(ended, 100, "UTC")


def test_an_investigation_draws_and_says_nothing_past_the_reach():
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "investigate", "scripts"))
    import investigate
    from test_investigate import T, Z, _Around

    class Short(_Around):
        def history(self, ids, start, end):
            got = super().history(ids, start, end)
            self.history_cut = {ids[0]: T(9, 4)} if start >= T(9, 2) and ids[0] == "sensor.heater_power" else {}
            return {e: [r for r in rs if datetime.fromisoformat(r["last_changed"]) < T(9, 4)] if e in self.history_cut
                    else rs for e, rs in got.items()}

        def logbook(self, start, end):
            self.logbook_cut = T(9, 6, 30)
            return [r for r in super().logbook(start, end) if datetime.fromisoformat(r["when"]) <= T(9, 6, 30)]
    res = investigate.timeline(Short(), ["sensor.heater_power"], T(9, 2), T(9, 15), 3, Z, series=True, now=T(9, 16))
    (part,) = res["entities"]
    points = dict((datetime.fromisoformat(a), v) for a, v in part["series"])
    assert all(v is None for t, v in points.items() if t >= T(9, 4))                  # no line drawn past 04:00
    assert any(v is not None for t, v in points.items() if t < T(9, 4))
    assert max(p["end"] for p in part["periods"]) == T(9, 4).isoformat()
    lines = investigate.around(Short(), None, T(9, 2), T(9, 15), [], Z, now=T(9, 16))["lines"]
    assert "⚠️ the logbook could not be read whole: nothing is known after 06:30:00 (too many entries) — say so, " \
           "and narrow the period to read the rest" in lines


def test_the_investigation_page_says_the_reach_and_ends_a_lane_there():
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "investigate", "scripts"))
    import investigation_facts
    from test_investigate import T
    lanes = investigation_facts._lanes({"end": T(9, 15).isoformat(), "entities": [
        {"label": "Back Door", "cut": T(9, 4).isoformat(),
         "states": [{"at": T(9, 2).isoformat(), "state": "off", "as": "off"},
                    {"at": T(9, 3).isoformat(), "state": "on", "as": "on"}]}]}, [], [], [])
    assert [(b["start"], b["end"], b["state"]) for b in lanes[0]["bands"]] == [(T(9, 2), T(9, 3), "off"),
                                                                              (T(9, 3), T(9, 4), "on")]
    f = investigation_facts.facts({"start": T(9, 2).isoformat(), "end": T(9, 15).isoformat(), "zone": "UTC",
                                   "entities": [{"entity_id": "binary_sensor.back_door", "label": "Back Door",
                                                 "cut": T(9, 4).isoformat(), "lines": [], "periods": []}]},
                                  {"start": T(9, 2).isoformat(), "end": T(9, 15).isoformat(), "zone": "UTC"})
    (cannot,) = [g for g in f["findings"] if g["title"] == "What the records cannot tell"]
    assert "Back Door: its records could not be read whole: nothing is known after 04:00." in cannot["groups"][0]["items"]


def test_an_automations_run_is_read_off_a_logbook_row_one_way():
    # architecture review round 2, 2026-10-19: the weekly page kept "triggered" rows only, the investigation counted
    # every row; now both read vesta_shared.past.automation_run — a run, what started it, whether the system did
    at = "2026-10-17T16:59:00+00:00"
    assert past.automation_run({"when": at, "message": "turned off"}) is None
    assert past.automation_run({"when": at, "message": "turned on"}) is None
    assert past.automation_run({"when": "not a time", "message": "triggered by time"}) is None
    run = past.automation_run({"when": at, "message": "triggered by state of lock.example"})
    assert run == (datetime.fromisoformat(at), "state of lock.example", False)
    assert past.automation_run({"when": at, "message": "triggered", "source": "time"}).started_by == "time"
    reload = past.automation_run({"when": at, "message": "triggered by event 'automation_reloaded'",
                                  "source": "event 'automation_reloaded'"})
    assert reload.is_system and past.system_run(reload.started_by) == "reloaded"
    assert past.automation_run({"when": at, "message": "triggered by Home Assistant starting"}).is_system
    assert past.system_run("event 'homeassistant_started'") == "started"
    assert past.system_run("Home Assistant starting") == "started" and past.system_run("time") is None
