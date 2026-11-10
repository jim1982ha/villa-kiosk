"""The reports composer, as the model calls it (synthetic: no villa data)."""
from __future__ import annotations

import os
import subprocess
import sys

from helpers import PYTHONPATH, STARTER_SKILLS
from vesta_shared.ha_client import HABase  # noqa: E402

COMPOSE = os.path.join(STARTER_SKILLS, "reports", "scripts", "compose.py")
# ⚠️ THE SCRIPTS' FOLDER, FOR EVERY TEST OF THIS FILE (2026-10-19): facts.py imports its sibling playbook.py, and only
# some tests put the folder on the path — run alone or in another order, ten tests failed on "No module named
# 'playbook'", and a mutation run on this file could not tell a caught mutant from that.
sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))


def test_a_step_without_its_input_stops_and_says_what_to_run(tmp_path):
    # 2026-09-30: called without the week's figures, the page died in Jinja ("type Undefined doesn't
    # define __round__") and the model told the owner "a template error".
    for script, cmd, need in ((FACTS, "fm-weekly", "--energy"), (FACTS, "owner-monthly", "--energy"),
                              (COMPOSE, "fm-weekly", "--facts"), (COMPOSE, "owner-monthly", "--facts"),
                              (COMPOSE, "owner-weekly", "--energy")):
        r = subprocess.run([sys.executable, script, cmd, "--pack", str(tmp_path / "none.json"), "--out", "x.html"],
                           capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH})
        assert r.returncode == 1, (cmd, r.stderr)
        assert f"{cmd} needs {need}" in r.stderr and "Traceback" not in r.stderr


# ---------------------------------------------------------------- the weekly and monthly pages (facts → page)
import json  # noqa: E402
import shutil  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402

FACTS = os.path.join(STARTER_SKILLS, "reports", "scripts", "facts.py")
START = datetime(2026, 9, 7, tzinfo=timezone.utc)                     # an invented villa, UTC, 28 days of data


def _villa(tmp):
    """A small invented villa: a main meter, one pump, two batteries, a lock; statistics as HA serves them."""
    fx = tmp / "fx"
    fx.mkdir()
    day = [{"start": int((START + timedelta(days=d)).timestamp() * 1000), "change": 40.0 + d % 3, "sum": 0}
           for d in range(28)]
    pump_day = [{"start": r["start"], "change": 6.0, "sum": 0} for r in day]
    hour = [{"start": int((START + timedelta(hours=h)).timestamp() * 1000), "mean": w, "min": w, "max": w}
            for h in range(24 * 28) for w in [(850.0 if h < 24 * 25 else 740.0) if 8 <= h % 24 < 16 else 2.0]]
    (fx / "stats_day_energy.json").write_text(json.dumps({"period_type": "day", "entities": [
        {"entity_id": "sensor.example_main_energy", "statistics": day},
        {"entity_id": "sensor.example_pump_energy", "statistics": pump_day}]}))
    (fx / "stats_hour_power.json").write_text(json.dumps({"period_type": "hour", "entities": [
        {"entity_id": "sensor.example_pump_power", "statistics": hour}]}))
    now = "2026-10-04T10:00:00+00:00"
    (fx / "states.json").write_text(json.dumps({"states": {
        "sensor.example_battery_a": {"state": "12", "attributes": {}, "last_changed": now},
        "sensor.example_battery_b": {"state": "80", "attributes": {}, "last_changed": now},
        "lock.example_door": {"state": "unavailable", "attributes": {}, "last_changed": now},
        "sensor.example_pump_power": {"state": "740", "attributes": {}, "last_changed": now}}}))
    fam = lambda eid, fam_, name, asset=None: {"entity_id": eid, "name": name, "area": "Garden", "family": fam_, "asset": asset}  # noqa: E731
    pack = {"villa": "Example Villa", "time_zone": "UTC", "generated_at": now, "ha_version": None, "areas": [],
            "people": [], "channels": {}, "unknown_area": [], "unclassified": [],
            "retention": {"raw_history_days": 10, "statistics": "permanent"},
            "families": {"power": [fam("sensor.example_pump_power", "power", "Pump power", "pump")],
                         "energy": [fam("sensor.example_main_energy", "energy", "Main meter"),
                                    fam("sensor.example_pump_energy", "energy", "Pump energy", "pump")],
                         "battery": [fam("sensor.example_battery_a", "battery", "Battery A"),
                                     fam("sensor.example_battery_b", "battery", "Battery B")],
                         "security": [fam("lock.example_door", "security", "Front door lock", "door")]},
            "assets": {"pump": {"slug": "pump", "name": "Garden pump", "kind": "motor",
                                "entities": {"power": "sensor.example_pump_power", "energy": "sensor.example_pump_energy"}}},
            "critical": ["lock.example_door"]}               # the villa's one list (its "critical devices offline" rule)
    (tmp / "pack.json").write_text(json.dumps(pack))
    energy = {"start": "2026-09-28", "end": "2026-10-04", "total_kwh": 287.0, "total_prev_kwh": 290.0,
              "total_vs_prev_pct": -1.0, "total_cost": 487900, "currency": "IDR", "tariff": 1700.0,
              "main_meter": "sensor.example_main_energy", "unmetered_kwh": 245.0, "unmetered_pct": 85.4,
              "loads": [{"name": "Garden pump", "kwh": 42.0, "share_pct": 14.6, "vs_prev_pct": 0.0}]}
    (tmp / "week.json").write_text(json.dumps(energy))
    return fx


def _run(script, *args, cwd=None):
    return subprocess.run([sys.executable, script, *args], capture_output=True, text=True,
                          env={**os.environ, "PYTHONPATH": PYTHONPATH}, cwd=cwd)


def _facts(tmp, fx):
    r = _run(FACTS, "fm-weekly", "--pack", str(tmp / "pack.json"), "--store", str(tmp / "s.sqlite"),
             "--energy", str(tmp / "week.json"), "--fixture-dir", str(fx), "--now", "2026-10-05T07:00:00+00:00",
             "--out", str(tmp / "facts.json"))
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout), json.load(open(tmp / "facts.json"))


def _night_found(tmp):
    """What the night check left open in the villa's store: the pump's running power down (850 W → 740 W), battery A
    to replace."""
    from vesta_shared.store import Store
    st = Store(str(tmp / "s.sqlite"))
    st.raise_finding("PM-POWER-CHANGE", "sensor.example_pump_power", "power", "2026-10-03", "P3",
                     "Garden pump draws 13% lower than its 30-day normal (740 W vs 850 W).", {"change_pct": -12.9})
    st.raise_finding("PM-BATTERY-CRIT", "sensor.example_battery_a", "battery", "2026-10-04", "P3",
                     "Battery A battery at 12%: replace now.", {"level": 12})


def test_the_weekly_facts_come_from_home_assistant_and_reports_yaml(tmp_path):
    fx = _villa(tmp_path)
    # ⚠️ THE NIGHT CHECK OWNS EACH NUMBER ASKED TWICE (owner, 2026-10-19): with nothing found at night, the same 850 W →
    # 740 W and the same 12 % battery are drawn, never judged by the page — "Watch" and "replace" are the night's
    printed, facts = _facts(tmp_path, fx)
    assert facts["sections"]["equipment"]["cards"][0]["status"] == "OK"
    assert facts["sections"]["batteries"]["rows"][0]["level"] == "ok"
    _night_found(tmp_path)
    printed, facts = _facts(tmp_path, fx)
    s = facts["sections"]
    assert facts["order"][:3] == ["header", "headline", "kpis"] and not facts["problems"]
    assert s["header"]["title"] == "Example Villa, week 40"
    assert [r["kwh"] for r in s["energy_days"]["rows"]][:2] == [40.0, 41.0]          # HA's daily statistics
    card = s["equipment"]["cards"][0]
    assert card["title"] == "Garden pump" and card["status"] == "Watch"                # the night's PM-POWER-CHANGE
    assert s["batteries"]["rows"][0] == {"name": "Battery A", "pct": 12, "level": "replace", "volts": None,
                                         "night": "Battery A battery at 12%: replace now."}
    assert s["kpis"]["offline_critical"] == 1                               # the lock: on the villa's critical list
    assert {w["id"] for w in printed["to_write"]} >= {"headline", "card-pump.reading"}


def test_readings_carry_the_ais_own_numbers_marked_and_a_checked_slot_is_still_checked(tmp_path):
    # agent-host/docs/adr/0001: a reading may hold numbers the AI found itself, and is marked as VESTA's;
    # a slot reports.yaml marks `checked: true` still refuses a number that is not one of its figures
    fx = _villa(tmp_path)
    _, facts = _facts(tmp_path, fx)
    facts["to_write"].append({"id": "kpis", "kind": "checked", "instruction": "x", "figures": facts["sections"]["kpis"]})
    (tmp_path / "facts.json").write_text(json.dumps(facts))
    (tmp_path / "notes.json").write_text(json.dumps({
        "headline": "The garden pump moves less water since 2 Oct: 900 W down to 740 W at the same hours.",
        "kpis": "999 kWh used.",
        "card-pump.why": "not asked for"}))
    r = _run(COMPOSE, "fm-weekly", "--facts", str(tmp_path / "facts.json"), "--notes", str(tmp_path / "notes.json"),
             "--out", str(tmp_path / "page.html"))
    res = json.loads(r.stdout)
    assert res["notes_used"] == ["headline"]                                           # 900 is its own: accepted
    refused = {x["id"]: x["why"] for x in res["notes_refused"]}
    assert "999 is not one of this section's figures" in refused["kpis"]
    assert "does not ask" in refused["card-pump.why"]
    page = (tmp_path / "page.html").read_text()
    assert "VESTA's reading</span> The garden pump moves less water" in page
    assert "<svg" in page and "http://" not in page.replace("http://www.w3.org/2000/svg", "") and "https://" not in page and "<script" not in page


def test_a_report_stopped_at_its_limit_is_still_sent_and_says_what_is_missing(tmp_path):
    fx = _villa(tmp_path)
    _facts(tmp_path, fx)
    since = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    r = _run(COMPOSE, "fm-weekly", "--facts", str(tmp_path / "facts.json"), "--notes", str(tmp_path / "none.json"),
             "--out", str(tmp_path / "page.html"), "--finish", "here", "--since", since, "--limit", "2")
    (item,) = json.loads(r.stdout)["send"]
    assert item["to"] == "here" and item["attachment"] == "page.html" and "stopped at its 2 USD limit" in item["text"]
    assert "Not written: this report reached its 2 USD limit." in (tmp_path / "page.html").read_text()
    # the limit came before the figures: last period's facts are never sent as this one's
    later = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    r = _run(COMPOSE, "fm-weekly", "--facts", str(tmp_path / "facts.json"), "--out", str(tmp_path / "page2.html"),
             "--finish", "fm", "--since", later, "--limit", "2")
    (item,) = json.loads(r.stdout)["send"]
    assert "attachment" not in item and "before its figures were ready" in item["text"]


def test_the_playbook_turns_the_villas_data_into_one_list_of_what_needs_doing(tmp_path):
    fx = _villa(tmp_path)
    _, facts = _facts(tmp_path, fx)
    # ⚠️ THE PUMP'S DROP IS THE NIGHT CHECK'S (owner, 2026-10-19): no clue of the page's own finds the 850 W → 740 W —
    # with nothing found at night, the list has no pump line; with the night's PM-POWER-CHANGE open, it has exactly one
    assert not [r for r in facts["sections"]["todo"]["rows"] if r["kind"].startswith("pumps/")
                or r["kind"] == "PM-POWER-CHANGE"]
    _night_found(tmp_path)
    _, facts = _facts(tmp_path, fx)
    rows = facts["sections"]["todo"]["rows"]
    (step,) = [r for r in rows if "sensor.example_pump_power" in r["entity_ids"]]
    assert step["kind"] == "PM-POWER-CHANGE" and step["title"].startswith("Garden pump draws 13% lower")
    lock = next(r for r in rows if r["kind"] == "locks_and_doors/a safety device offline")
    assert lock["title"] == "Front door lock offline since 04/10/2026 10:00"
    # no record of the agent listening that week: only the rules whose every run is an alert can say so
    assert facts["sections"]["quiet"]["did_not_happen"] == ["no door left unlocked and no supply left open"]
    assert {w["id"] for w in facts["to_write"]} >= {f"{step['id']}.reading", f"{step['id']}.ask", "quiet"}


def test_what_did_not_happen_is_said_only_for_what_was_watched(tmp_path):
    # villa, 2026-10-01: "no equipment missed its schedule" for a week the agent never listened to
    import sqlite3
    facts, c, _ = _ctx(tmp_path)
    c.cli = _Book([], [])
    assert facts.s_quiet(c)["did_not_happen"] == ["no door left unlocked and no supply left open"]
    db = sqlite3.connect(tmp_path / "state.sqlite")
    db.execute("create table calls(id integer primary key, at text, kind text, detail text)")
    db.execute("insert into calls(at, kind, detail) values ('2026-09-20T00:00:00+00:00', 'run', '{}')")
    db.commit(); db.close()
    c.state_path = str(tmp_path / "state.sqlite")                       # the agent listened all week
    assert "no equipment missed its schedule" in facts.s_quiet(c)["did_not_happen"]


def _ctx(tmp_path, ha=None, now=datetime(2026, 10, 5, 7, tzinfo=timezone.utc)):
    import importlib.util
    spec = importlib.util.spec_from_file_location("facts", FACTS)
    facts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(facts)
    from fixture_client import FixtureClient
    from vesta_shared.knowledge_pack import KnowledgePack
    from vesta_shared.store import Store
    fx = _villa(tmp_path) if not (tmp_path / "fx").exists() else tmp_path / "fx"
    store = Store(str(tmp_path / "s.sqlite"))
    c = facts.Ctx("fm-weekly", KnowledgePack.load(str(tmp_path / "pack.json")), store, ha or FixtureClient(str(fx)),
                  json.load(open(tmp_path / "week.json")), facts.load_cfg(), "UTC", now, None)
    return facts, c, store


def test_one_device_is_one_line_and_many_of_a_kind_are_one_line(tmp_path):
    # villa, 2026-10-01: the same offline device was shown three times (a clue, a task, the monitoring
    # table) and 14 "has not reported" tasks filled the page — the mock-ups say each thing once
    facts, c, store = _ctx(tmp_path)
    store.raise_finding("PM-UNAVAILABLE", "lock.example_door", "availability", "2026-10-04", "P2",
                        "Front door lock has been offline for 3h.", {"hours": 3})
    c.pack.families["level"] = [{"entity_id": f"sensor.example_rain_{k}", "name": f"Rain {k}", "family": "level"}
                                for k in range(4)]                 # a line names its device as the pack does
    for k in range(4):
        store.raise_finding("PM-SILENT", f"sensor.example_rain_{k}", "level", "2026-10-03", "P3",
                            f"Rain {k} has not reported for 2.0 days although it is online.", {"hours": 48})
    rows = facts.todo(c)
    lock = [r for r in rows if "Front door lock" in r["title"]]
    assert len(lock) == 1 and lock[0]["severity"] == "P2" and lock[0]["task_ids"]             # the clue, with the task's id
    silent = [r for r in rows if r["kind"] == "PM-SILENT"]
    assert len(silent) == 1 and silent[0]["title"] == "4 sensors have not reported"
    assert silent[0]["members"] == ["Rain 0", "Rain 1", "Rain 2", "Rain 3"]


class _Book(HABase):
    """Home Assistant's logbook for two VESTA rules: a condition rule (each run is an alert) and a schedule
    rule (it runs every day to check, and alerts rarely: the villa, 2026-10-01)."""
    def __init__(self, condition_runs, schedule_runs):
        self.runs = {"automation.example_door": condition_runs, "automation.example_pump": schedule_runs}

    def all_entity_ids(self):
        return [*self.runs, "automation.example_lights"]

    def tool(self, name, args):
        assert name == "ha_config_get_automation"
        bp, alias = {"automation.example_door": ("critical_condition", "critical_condition---entrance_unlocked"),
                     "automation.example_pump": ("critical_schedule", "critical_schedule---garden_pump")}.get(
            args["identifier"], ("motion_light", "Lights"))
        return {"config": {"alias": alias, "use_blueprint": {"path": f"vesta/{bp}.yaml"}}}

    def states(self, entity_ids):
        return {e: {"state": "on"} for e in entity_ids}

    def logbook(self, start, end, entity_id=None):
        self.reads = getattr(self, "reads", 0) + 1
        rows = [{"when": w, "entity_id": entity_id, "message": "triggered by lock.example_door"} for w in self.runs.get(entity_id, [])]
        # the villa's system re-checking its rules when they are reloaded or it starts: runs, never alerts
        # (each as the logbook writes it: a reload as an event, a start in words — week 42 counted both)
        rechecks = [{"when": "2026-09-30T13:00:00+00:00", "entity_id": entity_id, "message": f"triggered by {src}",
                     "source": src} for src in ("event 'automation_reloaded'", "Home Assistant starting")]
        return rows + rechecks + [{"when": "2026-09-30T12:00:00+00:00", "entity_id": entity_id, "message": "turned off"}]


def test_an_alert_is_a_run_only_for_a_rule_that_alerts_on_every_run(tmp_path):
    # villa, 2026-10-01: 71 runs of the schedule rules (a daily check) showed as 71 "critical alerts"; week 42: 400
    # re-checks after the rules were reloaded showed as "403 critical alerts" (each _Book rule has two of them)
    daily = [f"2026-09-{d:02d}T07:30:00+00:00" for d in range(28, 31)]
    book = _Book(["2026-09-30T07:41:00+00:00"], daily)
    facts, c, store = _ctx(tmp_path, book)
    assert set(c.vesta_rules()) == {"automation.example_door", "automation.example_pump"}
    rows = facts._alert_rows(c)
    assert [(r["what"], r["source"]) for r in rows] == [("Entrance unlocked", "home_assistant")]
    # the same alert, followed by the agent: shown once, as the agent's
    store.new_incident("k", "automation.example_door", "lock.example_door", "P2",
                       {"message": "Entrance left unlocked"}, at="2026-09-30T07:41:00+00:00")
    facts, c, store = _ctx(tmp_path, book)                         # the next report's run reads the store again
    assert [r["source"] for r in facts._alert_rows(c)] == ["agent"]


def test_the_villas_own_playbook_and_cards_are_added_to_the_shipped_ones(tmp_path):
    fx = _villa(tmp_path)
    skill = tmp_path / "skills" / "reports"
    shutil.copytree(os.path.join(STARTER_SKILLS, "reports"), skill)
    (skill / "villa.reports.yaml").write_text(json.dumps({
        "playbook": {"pumps": [{"name": "garden pump dry run", "means": "it slides before it stops"}]},
        "cards": [{"kind": "energy_daily", "entity": "sensor.example_pump_energy", "title": "Garden pump energy"}],
        "thresholds": {"battery": {"replace_below_pct": 15, "show": 1}, "pump": {"watch_drop_pct": 5}}}))
    r = _run(str(skill / "scripts" / "facts.py"), "fm-weekly", "--pack", str(tmp_path / "pack.json"),
             "--store", str(tmp_path / "s.sqlite"), "--energy", str(tmp_path / "week.json"), "--fixture-dir", str(fx),
             "--out", str(tmp_path / "facts.json"))
    printed, facts = json.loads(r.stdout), json.load(open(tmp_path / "facts.json"))
    assert [k["name"] for k in printed["knowledge"]] == ["garden pump dry run"]              # knowledge, not a clue
    assert "Garden pump energy" in [c["title"] for c in facts["sections"]["equipment"]["cards"]]
    assert len(facts["sections"]["batteries"]["rows"]) == 1                                   # the villa's threshold
    # ⚠️ A RETIRED THRESHOLD IS NAMED, NEVER SILENTLY IGNORED (owner, 2026-10-19): the night check judges a battery and
    # a pump's power now; the villa's own file still setting the page's old thresholds is told in the report's problems
    assert facts["sections"]["batteries"]["rows"][0]["level"] == "ok"                         # 12 %: the night found nothing
    told = [p for p in facts["problems"] if "no longer used" in p]
    assert len(told) == 2 and all(p.startswith("villa.reports.yaml sets thresholds.") for p in told), facts["problems"]
    assert any("battery.replace_below_pct" in p for p in told) and any("pump.watch_drop_pct" in p for p in told)


def _hours(fx, name, series):
    """Hourly statistics as HA serves them: {entity_id: (start, hours, moving)}; a moving sensor's value
    changes every hour, a still one never does."""
    ents = []
    for eid, (start, n, moving) in series.items():
        t0 = int(datetime.fromisoformat(start).timestamp() * 1000)
        rows = [{"start": t0 + h * 3600_000, "mean": 20.0 + (h % 5 if moving else 0),
                 "min": 20.0 + (h % 5 if moving else 0), "max": 20.5 + (h % 5) if moving else 20.0} for h in range(n)]
        ents.append({"entity_id": eid, "statistics": rows})
    (fx / f"stats_hour_{name}.json").write_text(json.dumps({"period_type": "hour", "entities": ents}))


def test_a_sensor_that_reports_the_same_value_is_not_silent(tmp_path):
    # villa, 2026-10-01: a rain gauge at 0 and curtains nobody moved were 14 "has not reported" tasks:
    # silence was read from the last CHANGE; a sensor that reports an unchanged value is not silent
    nightly = os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "nightly.py")
    fx = tmp_path / "fx"
    fx.mkdir()
    old, now = "2026-09-28T07:00:00+00:00", "2026-10-01T06:50:00+00:00"
    (fx / "states.json").write_text(json.dumps({"states": {
        "sensor.example_rain": {"state": "0.0", "attributes": {}, "last_changed": old, "last_reported": now},
        "sensor.example_level": {"state": "41", "attributes": {}, "last_changed": old, "last_reported": old}}}))
    # the tank level moved every hour until it stopped; the rain gauge never moves (no rain)
    _hours(fx, "a", {"sensor.example_level": ("2026-09-18T00:00:00+00:00", 10 * 24, True),
                     "sensor.example_rain": ("2026-09-18T00:00:00+00:00", 13 * 24, False)})
    row = lambda eid, name: {"entity_id": eid, "name": name, "area": "Garden", "family": "level", "asset": eid.split(".")[1]}  # noqa: E731
    pack = {"villa": "Example Villa", "time_zone": "UTC", "generated_at": now, "ha_version": None, "areas": [], "people": [],
            "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
            "families": {"level": [row("sensor.example_rain", "Rain gauge"), row("sensor.example_level", "Tank level")]},
            "assets": {}}
    (tmp_path / "pack.json").write_text(json.dumps(pack))
    r = _run(nightly, "--pack", str(tmp_path / "pack.json"), "--store", str(tmp_path / "s.sqlite"), "--fixture-dir", str(fx),
             "--as-of", "2026-10-01", "--skip-raw", "--out", str(tmp_path / "res.json"))
    assert r.returncode == 0, r.stderr
    from vesta_shared.store import Store
    silent = [f["entity_id"] for f in Store(str(tmp_path / "s.sqlite")).findings("open") if f["rule_id"] == "PM-SILENT"]
    assert silent == ["sensor.example_level"]


def test_a_finding_the_night_no_longer_sees_closes_its_task_and_its_ticket(tmp_path):
    # villa, 2026-10-01: the finding closed, its task and its Kiosk ticket stayed open for ever
    nightly = os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "nightly.py")
    fx = tmp_path / "fx"
    fx.mkdir()
    row = {"entity_id": "sensor.example_level", "name": "Tank level", "area": "Garden", "family": "level", "asset": "tank"}
    (tmp_path / "pack.json").write_text(json.dumps({"villa": "Example Villa", "time_zone": "UTC", "generated_at": "x",
        "ha_version": None, "areas": [], "people": [], "channels": {}, "unknown_area": [], "unclassified": [],
        "retention": {"raw_history_days": 10}, "families": {"level": [row]}, "assets": {}}))

    _hours(fx, "a", {"sensor.example_level": ("2026-09-13T00:00:00+00:00", 14 * 24, True)})   # reports all the time

    def night(day, reported):
        (fx / "states.json").write_text(json.dumps({"states": {"sensor.example_level": {
            "state": "41", "attributes": {}, "last_changed": "2026-09-20T07:00:00+00:00", "last_reported": reported}}}))
        r = _run(nightly, "--pack", str(tmp_path / "pack.json"), "--store", str(tmp_path / "s.sqlite"),
                 "--fixture-dir", str(fx), "--as-of", day, "--skip-raw")
        assert r.returncode == 0, r.stderr
        return json.loads(r.stdout)
    first = night("2026-10-01", "2026-09-27T07:00:00+00:00")                       # silent four days: a task
    (made,) = first["tasks_to_create"]
    assert first["faults_changed"] is True
    from vesta_shared.store import Store as _S
    # recorded as seen, with the skill's settle time after a person's close (settings.yaml still_there_after_close)
    (seen,) = [f for f in _S(str(tmp_path / "s.sqlite")).findings("open")]
    assert seen["seen_at"] and float(seen["settle_minutes"]) == 10.0
    second = night("2026-10-02", "2026-10-02T01:55:00+00:00")                      # reporting again
    assert second["faults_changed"] is True
    from vesta_shared.store import Store
    task = Store(str(tmp_path / "s.sqlite")).task(made)
    assert (task["status"], task["close_note"]) == ("cleared", "Cleared: the nightly check no longer sees it.")



def test_a_report_made_without_the_ai_says_so_and_never_uses_old_readings(tmp_path):
    # owner, 2026-10-07: the credit ran out and the weekly never came. The page is still made from its figures; an
    # old notes.json (last week's readings) is never used, and the page and its message say why the AI is missing.
    fx = _villa(tmp_path)
    _facts(tmp_path, fx)
    (tmp_path / "notes.json").write_text(json.dumps({"headline": "An old reading from last week."}))
    why = "The Anthropic account has run out of credit."
    r = _run(COMPOSE, "fm-weekly", "--facts", str(tmp_path / "facts.json"), "--notes", str(tmp_path / "notes.json"),
             "--out", str(tmp_path / "page.html"), "--finish", "fm", "--no-ai", why)
    (item,) = json.loads(r.stdout)["send"]
    assert item["to"] == "fm" and item["attachment"] == "page.html"
    assert f"(Made without the AI: {why} Every figure is complete" in item["text"]
    page = (tmp_path / "page.html").read_text()
    assert f"<b>Made without the AI.</b> {why}" in page and "<svg" in page
    assert "An old reading from last week" not in page and "Not written" not in page
    # the daily digest is a chat text: sent as written, its last message saying the same
    r = _run(COMPOSE, "fm-daily", "--pack", str(tmp_path / "pack.json"), "--store", str(tmp_path / "s.sqlite"),
             "--as-of", "2026-10-05", "--finish", "here", "--no-ai", why)
    sent = json.loads(r.stdout)["send"]
    assert {s["to"] for s in sent} == {"here"} and sent[-1]["text"].endswith("VESTA's readings and translation are missing.)")


def test_the_named_main_meter_is_the_one_read_even_with_a_shorter_twin(tmp_path):
    # architecture review 5: one counter was kept per asset, the shortest id — the named main meter then had no
    # figures and the total raised a KeyError instead of making a report
    fx = _villa(tmp_path)
    pack = json.load(open(tmp_path / "pack.json"))
    pack["families"]["energy"] = [
        {"entity_id": "sensor.example_main", "family": "energy", "name": "Main", "area": "Garden", "asset": "main"},
        {"entity_id": "sensor.example_main_energy", "family": "energy", "name": "Main meter", "area": "Garden", "asset": "main"}]
    (tmp_path / "pack.json").write_text(json.dumps(pack))
    (fx / "helpers.json").write_text(json.dumps({"helpers": [{"entity_id": "input_text.villa_main_meter", "id": "villa_main_meter"}],
                                                "states": {"input_text.villa_main_meter": "sensor.example_main_energy"}}))
    r = _run(os.path.join(STARTER_SKILLS, "roi-energy", "scripts", "energy_period.py"), "--pack", str(tmp_path / "pack.json"),
             "--period", "custom", "--start", "2026-09-28", "--end", "2026-10-04", "--fixture-dir", str(fx), "--zone", "UTC", "--out", str(tmp_path / "e.json"))
    assert r.returncode == 0, r.stderr
    out = json.load(open(tmp_path / "e.json"))
    assert out["main_meter"] == "sensor.example_main_energy" and out["total_kwh"] and "note" not in out


def test_html_like_text_the_ai_writes_shows_as_text_and_breaks_nothing():
    # owner, 2026-10-09 (after 0.12.109's changelog turned blue from an unclosed "<a class=…>"): a report must not
    # do that. Whatever the AI writes — an unclosed tag, a script — is shown as the characters it wrote, and the
    # rest of the page, its links included, is untouched.
    import sys as _s
    _s.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    facts = {"zone": "UTC", "order": ["headline", "todo"], "to_write": [{"id": "headline", "kind": "reading"}],
             "sections": {"headline": {"colour": "amber", "text": "Amber"},
                          "todo": {"rows": [{"id": "t1", "title": "Pool pump", "severity": "P2", "why": "Less water"}]}}}
    page = compose.page(facts, {"headline": 'It showed as raw code ("<a class=…>"). <script>alert(1)</script>',
                                "t1.check": "empty the baskets: https://www.example.org/pump/."})
    assert "&lt;a class=…&gt;" in page and "&lt;script&gt;alert(1)&lt;/script&gt;" in page
    assert "<a class=…>" not in page and "<script>" not in page
    # the link further down is still exactly one link, closed where it should be
    assert ('<a class="src" href="https://www.example.org/pump/" target="_blank" rel="noopener noreferrer">'
            'https://www.example.org/pump/</a>.') in page
    assert page.count("<a ") == page.count("</a>")


def test_the_monitoring_table_lists_devices_not_their_sensors(monkeypatch):
    # owner, 2026-10-09: "make sure this table only reports devices (and not entities related to a device)" — it listed
    # a phone's Wi-Fi traffic as two rows "RX" and "TX", and one pump plug's sensors as rows of their own
    import sys as _s
    from zoneinfo import ZoneInfo
    _s.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import facts
    import playbook
    from vesta_shared.knowledge_pack import KnowledgePack
    row = lambda eid, name, dev, fam: {"entity_id": eid, "name": name, "device_id": dev, "asset": eid.split(".")[1],
                                       "family": fam}
    pack = KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None, families={
        "power": [row("sensor.spa_pump_power", "Spa Pump Power", "plug", "power"),
                  row("sensor.jet_pump_power", "Jet Pump Power", "plug", "power")],
        "switch": [row("switch.spa_relay", "Spa Relay", "plug", "switch")],
        "network": [row("sensor.rx", "RX", "phone", "network"), row("sensor.tx", "TX", "phone", "network"),
                    row("sensor.ap_rx", "AP RX", "ap", "network")],
        "battery": [row("sensor.lone_battery", "Lone Battery", None, "battery")]},
        assets={}, areas=[], people=[], channels={}, unknown_area=[], unclassified=[], retention={},
        devices={"plug": {"name": "Spa Plug", "manufacturer": "Shelly", "model": "Plus 1PM"},
                 "phone": {"name": "", "manufacturer": "", "model": ""},
                 "ap": {"name": "", "manufacturer": "Ubiquiti", "model": "U6 Lite"}},
        critical=["switch.spa_relay"])                # the villa's one list (its "critical devices offline" rule)
    c = facts.Ctx.__new__(facts.Ctx)
    c.pack, c.Z = pack, ZoneInfo("UTC")
    c.now = datetime(2026, 10, 9, 12, tzinfo=ZoneInfo("UTC"))
    c.cfg = {}
    monkeypatch.setattr(facts, "watched_kinds", lambda: ["power", "switch", "network", "battery"])
    off = lambda at: {"state": "unavailable", "last_changed": at}
    c._states = {"sensor.spa_pump_power": off("2026-10-09T09:05:00+00:00"), "sensor.jet_pump_power": off("2026-10-09T09:01:00+00:00"),
                 "switch.spa_relay": off("2026-10-09T09:03:00+00:00"), "sensor.rx": off("2026-10-09T08:00:00+00:00"),
                 "sensor.tx": off("2026-10-09T08:00:00+00:00"), "sensor.ap_rx": off("2026-10-09T07:00:00+00:00"),
                 "sensor.lone_battery": off("2026-10-09T06:00:00+00:00")}
    got = {o["name"]: o for o in c.offline()}
    # the plug is ONE row under its own name, since its first sensor went, critical because its relay is on the list
    assert set(got) == {"Spa Plug", "Unnamed Ubiquiti U6 Lite", "Lone Battery"}, sorted(got)
    assert got["Spa Plug"]["since"] == "2026-10-09T09:01" and got["Spa Plug"]["critical"] is True
    assert "RX" not in got and "TX" not in got                        # a nameless Wi-Fi client is not a villa device
    assert got["Lone Battery"]["since"] == "2026-10-09T06:00"         # a sensor with no device keeps its own row
    # every section names a device the same way (knowledge_pack.device_of): the to-do list groups a clue and a task
    # about one plug under its device, and the batteries are named as the device they power
    assert playbook._device(c, "sensor.spa_pump_power", "x") == playbook._device(c, "switch.spa_relay", "x") == "device:plug"
    c.need = lambda *p: {"show": 8}[p[-1]]
    c.store = None                                                    # no night record: every battery shows its charge
    pack.families["battery"].append(row("sensor.plug_battery", "Plug Battery", "plug", "battery"))
    pack.families["battery"].append(row("sensor.porch_battery", "Porch Battery", None, "battery"))
    c._states["sensor.plug_battery"] = {"state": "15"}
    c._states["sensor.porch_battery"] = {"state": "50"}
    c.params = lambda: None
    pack.__dict__.pop("_by_entity", None)
    names = {r["name"] for r in facts.s_batteries(c)["rows"]}
    assert names == {"Spa Plug", "Porch Battery"}, names
    # a pack built before devices were kept groups nothing and hides nothing
    pack.devices = {}
    c._states["sensor.plug_battery"] = off("2026-10-09T09:00:00+00:00")   # the plug answering would make it not offline
    assert {o["name"] for o in c.offline()} >= {"Spa Pump Power", "RX", "Lone Battery"}


def test_an_equipment_card_is_watched_when_the_to_do_list_names_its_device():
    # architecture review 13 (a regression of 0.12.115): the to-do list names devices by device_of, the cards
    # compared them with the asset slug — no card was set to "Watch" by it
    import sys as _s
    _s.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import facts
    from vesta_shared.knowledge_pack import KnowledgePack
    from datetime import date
    # two pumps on one relay, as the villa's system lists them: the relay, and a device per channel under it
    pack = KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None,
                         families={"power": [{"entity_id": "sensor.pool_power", "name": "Pool Power", "device_id": "pool_ch",
                                              "asset": "pool", "family": "power"},
                                             {"entity_id": "sensor.house_power", "name": "House Power", "device_id": "house_ch",
                                              "asset": "house", "family": "power"}]},
                         assets={"pool": {"slug": "pool", "name": "Pool pump", "kind": "motor",
                                          "entities": {"power": "sensor.pool_power"}},
                                 "house": {"slug": "house", "name": "House pump", "kind": "motor",
                                           "entities": {"power": "sensor.house_power"}}},
                         areas=[], people=[], channels={}, unknown_area=[], unclassified=[], retention={},
                         devices={"relay": {"name": "House & Pool Relay", "manufacturer": "Maker", "model": "Pro EM", "via": ""},
                                  "pool_ch": {"name": "Pool Pump", "manufacturer": "Maker", "model": "Pro EM", "via": "relay"},
                                  "house_ch": {"name": "House Pump", "manufacturer": "Maker", "model": "Pro EM", "via": "relay"}})
    c = facts.Ctx.__new__(facts.Ctx)
    c.pack, c.cfg = pack, {}
    c.need = lambda *p: {"card_days": 14}[p[-1]]
    d1, d2 = date(2026, 10, 1), date(2026, 10, 2)
    c.running_days = lambda eid, asset, days: ([(d1, 700.0, 8.0), (d2, 700.0, 8.0)] if eid == "sensor.pool_power"   # steady
                                               else [(d1, None, 0.5), (d2, None, 1.1)])                             # bursts
    c._todo = [{"device": "device:relay", "entity_ids": ["sensor.pool_power"]}]
    house, pool = facts.s_equipment(c)["cards"]
    assert pool["status"] == "Watch" and pool["title"] == "Pool Pump"    # named as its channel, like the villa's system
    # ⚠️ the house pump shares the relay: the pool pump's item never marks it (villa, 2026-10-19: both cards "Watch")
    assert house["status"] == "OK" and house["title"] == "House Pump"
    # a pump in bursts: its running time, never a power the hourly figures cannot give
    assert house["unit"] == "h" and [v for _, v in house["series"]] == [0.5, 1.1] and pool["unit"] == "W"
    c._todo = []
    assert facts.s_equipment(c)["cards"][1]["status"] != "Watch"


def test_a_volt_battery_is_read_by_its_charge_not_its_reading():
    # architecture review 13 (live defect): a 3.0 V cell was read as "3 %" by the "battery falling" clue
    import sys as _s
    _s.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import facts
    import playbook
    from datetime import date
    from zoneinfo import ZoneInfo
    from vesta_shared.params import VillaParams
    from vesta_shared.knowledge_pack import KnowledgePack
    pack = KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None,
                         families={"battery": [{"entity_id": "sensor.station_battery", "name": "Station", "unit": "V",
                                                "asset": "station", "family": "battery"}]},
                         assets={}, areas=[], people=[], channels={}, unknown_area=[], unclassified=[], retention={})
    # 2026-10-19: the clue is gone (a falling battery is the night check's PM-BATTERY-TREND); the batteries section
    # still reads a volt cell by its charge
    c = facts.Ctx.__new__(facts.Ctx)
    c.pack, c.Z, c.end = pack, ZoneInfo("UTC"), date(2026, 10, 4)
    c.now = datetime(2026, 10, 4, tzinfo=timezone.utc)
    c.need = lambda *p: 8
    c.store = None
    c._states = {"sensor.station_battery": {"state": "1.0"}}
    params = VillaParams(helpers=[{"entity_id": "input_number.station_battery_nominal_v", "helper_type": "input_number",
                                   "id": "station_battery_nominal_v"}], states={"input_number.station_battery_nominal_v": "3.0"})
    c.params = lambda: params
    (row,) = facts.s_batteries(c)["rows"]
    assert row["pct"] == 33 and row["volts"] == 1.0                              # 1.0 V of 3.0 is 33 %, not "1 %"
    assert playbook.battery_pct(c, {"unit": "V", "asset": "station"}, 1.0) == 33.3
    c.params = lambda: VillaParams()
    assert facts.s_batteries(c)["rows"] == []                                    # no nominal: never a guess


def test_a_batterys_projection_is_one_rule():
    # vesta_shared.battery.projection: the night check's "days left", to the floor it passes (its battery_crit_pct)
    from vesta_shared import battery
    p = battery.projection([(i, 60 - 2 * i) for i in range(7)], 10)                # 60 % down 2 points a day, now 48 %
    assert round(p["per_day"], 6) == -2 and round(p["days_left"], 6) == 19      # (48 − 10) ÷ 2
    assert round(battery.projection([(i, 60 - 2 * i) for i in range(7)], 10, level=30)["days_left"], 6) == 10
    assert battery.projection([(i, 50 + i) for i in range(5)], 10)["days_left"] is None    # rising: no end in sight
    assert battery.projection([(0, 50), (1, 49)], 10) is None                   # two points: no slope
    # the night check's PM-BATTERY-TREND projects to ITS crit setting (settings.yaml battery_crit_pct, 10 %)
    import sys as _s
    from datetime import date
    _s.path.insert(0, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import rules
    from vesta_shared.params import VillaParams
    series = [(f"2026-10-{d:02d}", 40.0 - 2 * d) for d in range(1, 15)]           # 38 % down to 12 %... 2 points a day
    found = rules.battery_rules({"slug": "door", "name": "Door"}, "sensor.door_battery", "%", 30.0, series,
                                VillaParams(defaults=rules.DEFAULTS), date(2026, 10, 14))
    (trend,) = [f for f in found if f.rule_id == battery.TREND]
    assert trend.detail == {"slope_per_day": -2.0, "days_left": 10}             # (30 − 10) ÷ 2
    assert trend.summary == "Door battery is falling 2.0 points a day, about 10 days left."


def _problems_villa(tmp_path):
    """A villa's store on the morning of 5 October: a finding new last night, one closed again, one from last week,
    an alert being chased, and an alert only noted for the morning list."""
    from vesta_shared.store import Incident, Store
    from vesta_shared.knowledge_pack import KnowledgePack
    store = Store(str(tmp_path / "s.sqlite"))
    store.raise_finding("PM-SILENT", "sensor.pool_power", "power", "2026-10-04", "P3", "Pool Power silent", {})
    store.raise_finding("PM-SILENT", "sensor.spa_power", "power", "2026-10-04", "P3", "Spa Power silent", {})
    store.close_finding("PM-SILENT", "sensor.spa_power", "2026-10-04")
    store.raise_finding("PM-BATTERY", "sensor.door_battery", "battery", "2026-09-28", "P3", "Door battery low", {})
    store.new_incident("k1", "VESTA-LEAK", "binary_sensor.leak", "P2", {"message": "Leak in the kitchen"},
                       at="2026-10-04T10:00:00+00:00")
    noted = store.new_incident("k2", "VESTA-HUMID", "sensor.humid", "P4", {"message": "Humid cellar"},
                               at="2026-10-04T11:00:00+00:00")
    store.update_incident(noted, state=Incident.DIGEST)
    pack = KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None, families={}, assets={}, areas=[],
                         people=[], channels={}, unknown_area=[], unclassified=[], retention={})
    return pack, store


def test_the_morning_digest_says_what_is_new_and_still_open_as_problems_answer_it(tmp_path):
    # architecture review 13: the digest read its own "new" (a finding closed again was still "new") and listed a
    # noted alert twice, under "Also noted" and "Still open"
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    from datetime import date
    pack, store = _problems_villa(tmp_path)
    text = compose.fm_daily(pack, store, date(2026, 10, 5))
    new, rest = text.split("Also noted")
    assert "Pool Power silent" in new and "Spa Power silent" not in text          # closed again: not news
    assert text.count("Humid cellar") == 1                                         # noted once, not open twice
    still = rest.split("\nStill open:\n")[1]
    # owner, 2026-10-13: one block per section, an item per line
    assert still.split("\n") == ["- #1-P2 · Leak in the kitchen", "- P3 Door battery low"]
    # owner, 2026-10-11: the one shape — title, "To:" for the agent to fill, labels; no "Still open: N. An alert: press…"
    assert text.startswith("V, daily report on 05/10/2026.\nTo:\n\nNew since yesterday:\n- ") and "press Done" not in text


def test_the_owners_weekly_line_says_the_pages_own_figures(tmp_path):
    # architecture review, 2026-10-19: the count of alerts was the page's (owner: "maintain consistency in
    # calculations") but the critical ones, the alerts still open and the problems open were still counted here, by
    # other rules — the Monday message and its attached page disagreed. Every number is now the page's kpis
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    pack, store = _problems_villa(tmp_path)          # a store whose own counts (1 alert, 2 open, 2 problems) differ
    week = {"start": "2026-09-28", "end": "2026-10-04", "total_kwh": None}
    kpis = {"alerts": 7, "p1": 3, "alerts_open": 4, "open_tasks": 5}
    text = compose.owner_weekly(pack, store, week, kpis=kpis)
    assert "- 7 alert(s), 3 critical, 4 still open; 5 maintenance problem(s) open." in text
    assert "- The facility manager has the details in their weekly page." in text
    assert compose.OWNER_FIGURES == tuple(kpis)
    quiet = compose.owner_weekly(pack, store, week, kpis={"alerts": 2, "p1": 0, "alerts_open": 0, "open_tasks": 0})
    assert "- 2 alert(s), 0 critical, 0 still open; 0 maintenance problem(s) open." in quiet and "- All quiet." in quiet
    # a facts.json from an older facts.py (no p1): the figure is named missing, never counted here
    older = compose.owner_weekly(pack, store, week, kpis={"alerts": 7, "alerts_open": 4, "open_tasks": 5})
    assert "- 7 alert(s), n/a critical, 4 still open; 5 maintenance problem(s) open." in older


def test_the_weekly_page_counts_its_alerts_as_the_monday_lines_do(tmp_path):
    # architecture review, 2026-11-10: the page's tile read "7 critical alerts, 1 still open" beside Monday lines
    # saying "7 alert(s), 2 critical": the 7 are every alert of the week, the critical ones are a part of them
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import re

    import compose
    kpis = {"open_tasks": 5, "new": 2, "carried": 3, "alerts": 7, "alerts_open": 1, "p1": 2, "kwh": 300,
            "vs_prev_pct": 4, "offline": 0, "offline_critical": 0}
    said = lambda k: " ".join(re.sub(r"<[^>]+>", " ", compose.page(
        {"zone": "UTC", "order": ["kpis"], "sections": {"kpis": k}}, {})).split())
    assert "7 alerts 2 critical, 1 still open" in said(kpis) and "critical alert" not in said(kpis)
    assert "0 alerts none this week" in said({**kpis, "alerts": 0, "alerts_open": 0, "p1": 0})


def test_the_owners_monday_lines_carry_the_weekly_page_they_point_to(tmp_path, monkeypatch, capsys):
    # owner, 2026-10-12: "Details in the FM weekly page." reached the owner group with no page — only the facility
    # manager was sent it. The lines now go with that page, on schedule and without the AI.
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import json as _json
    import yaml
    import compose
    pack, store = _problems_villa(tmp_path)
    week = {"start": "2026-09-28", "end": "2026-10-04", "total_kwh": None}
    kpis = {"alerts": 1, "p1": 0, "alerts_open": 1, "open_tasks": 2}
    assert "- Details in the attached page." in compose.owner_weekly(pack, store, week, page=True, kpis=kpis)
    assert "attached" not in compose.owner_weekly(pack, store, week, kpis=kpis)     # no page sent: no page promised
    (tmp_path / "week.json").write_text(_json.dumps(week))
    (tmp_path / "facts.json").write_text(_json.dumps({"sections": {"kpis": kpis}}))
    (tmp_path / "fm_weekly.html").write_text("<html></html>")
    monkeypatch.setattr(compose.script, "Context", lambda a: type("C", (), {"pack": pack, "store": store,
                                                                            "day": staticmethod(lambda d: None)})())
    base = ["owner-weekly", "--pack", "p", "--energy", str(tmp_path / "week.json"), "--page", str(tmp_path / "fm_weekly.html")]
    assert compose.main(base) == 1                                          # the page's figures are the lines': required
    assert "needs --facts" in capsys.readouterr().err
    base += ["--facts", str(tmp_path / "facts.json")]
    assert compose.main(base) == 0
    out = _json.loads(capsys.readouterr().out)
    assert out["attachment"] == "fm_weekly.html" and "attached page" in out["message"]["text"]
    assert "- 1 alert(s), 0 critical, 1 still open; 2 maintenance problem(s) open." in out["message"]["text"]
    assert compose.main(base + ["--finish", "owner", "--no-ai", "no credit."]) == 0
    sent = _json.loads(capsys.readouterr().out)["send"][0]
    assert sent["attachment"] == "fm_weekly.html" and "attached page" in sent["text"]
    # the job's own steps name the page the fm-weekly step wrote
    job = next(j for j in yaml.safe_load(open(os.path.join(STARTER_SKILLS, "reports", "skill.yaml")))["schedule"]
               if j["name"] == "fm-weekly")
    steps = [x["run"] if isinstance(x, dict) else x for x in job["without_ai"]]
    assert "--out fm_weekly.html" in steps[2] and "--page fm_weekly.html" in steps[3]
    assert "--page" in job["prompt"] and "attachment=" in job["prompt"]


def test_every_field_the_page_prints_is_one_facts_gives(tmp_path):
    # architecture review 13: facts.json → about forty template fields, checked by nobody — a renamed field printed
    # a blank. A field the page only TESTS may be absent (an optional "error"); one it PRINTS may not.
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    from jinja2 import Undefined
    from jinja2.exceptions import UndefinedError

    class Printed(Undefined):
        def __str__(self):
            raise UndefinedError(self._undefined_message)
        __html__ = __str__

    fx = _villa(tmp_path)
    _, facts = _facts(tmp_path, fx)
    was = compose.TPL.undefined
    compose.TPL.undefined = Printed
    try:
        compose.page(facts, {})
    finally:
        compose.TPL.undefined = was


def test_an_alert_that_came_back_counts_each_run_in_the_week(tmp_path):
    # architecture review 24: 145 drops of an access point, reopened "Back again", were one alert opened on the 1st —
    # the week counted 0 for it and said "no critical device lost"
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    facts, c, store = _ctx(tmp_path)
    start = c.s_dt.astimezone(timezone.utc)
    iid = store.new_incident("k", "automation.ap", "sensor.ap", "P1", {"message": "AP down"},
                             at=(start - timedelta(days=2)).isoformat())                 # first opened before the week
    for k in (1, 2, 3):
        store.update_incident(iid, closed_at=(start + timedelta(hours=k)).isoformat(), state="done")
        store.reopen_incident(iid, (start + timedelta(hours=k, minutes=30)).isoformat())
    assert len([i for i in c.incidents() if i["id"] == iid]) == 3                         # each run of it in the week
    kpis = facts.s_kpis(c)
    assert (kpis["alerts"], kpis["p1"], kpis["alerts_open"]) == (3, 3, 1)                   # the page's own figures…
    end = (c.e_dt - timedelta(days=1)).date().isoformat()
    text = compose.owner_weekly(c.pack, store, {"start": c.s_dt.date().isoformat(), "end": end, "total_kwh": None},
                                kpis=kpis)
    assert "3 alert(s), 3 critical, 1 still open" in text                                 # …are the Monday lines'


def test_an_alerts_lasted_column_is_said_as_both_apps_say_a_duration(tmp_path):
    # architecture review round 2, 2026-10-16: the weekly page's "Lasted" had a rule of its own — "119s", "119min",
    # "2.5h" — beside the Kiosk's and the agent's "1min", "2h 29min". The agreement's cases, through the page's rows
    contract = os.path.join(os.path.dirname(__file__), "..", "..", "rootfs", "opt", "vesta", "host", "agent-contract.json")
    cases = [c for c in json.load(open(contract))["duration"]["cases"] if c["seconds"] < 4 * 86400]
    sys.path.insert(0, os.path.dirname(FACTS))                     # facts.py imports its sibling playbook.py
    facts, c, store = _ctx(tmp_path)
    opened = datetime(2026, 10, 1, 7, tzinfo=timezone.utc)
    for n, case in enumerate(cases):
        iid = store.new_incident(f"k{n}", "r", "lock.example_door", "P2", {"message": f"Case {n}"},
                                 at=(opened + timedelta(minutes=n)).isoformat())
        store.update_incident(iid, state="resolved",
                              closed_at=(opened + timedelta(minutes=n, seconds=case["seconds"])).isoformat())
    facts, c, store = _ctx(tmp_path)
    said = {r["what"]: r["lasted"] for r in facts._alert_rows(c)}
    assert [said[f"Case {n}"] for n in range(len(cases))] == [case["words"] for case in cases]


def test_the_report_shows_a_battery_at_the_level_the_night_judged():
    """Architecture review, 2026-10-22: a coin cell read 1 % between two readings near 50 %; the night judged its best
    reading (battery.RESTED), the weekly page printed "1 %". A battery changed since reads higher now, and that stands."""
    import sys as _s
    _s.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import facts
    from datetime import date
    from types import SimpleNamespace
    from zoneinfo import ZoneInfo
    from vesta_shared import battery
    from vesta_shared.knowledge_pack import KnowledgePack
    from vesta_shared.params import VillaParams
    pack = KnowledgePack(villa="V", time_zone="UTC", generated_at="x", ha_version=None,
                         families={"battery": [{"entity_id": e, "name": n, "unit": "%", "asset": a, "family": "battery"}
                                               for e, n, a in (("sensor.motion_battery", "Motion", "motion"),
                                                               ("sensor.lock_battery", "Lock", "lock"),
                                                               ("sensor.other_battery", "Other", "other"))]},
                         assets={}, areas=[], people=[], channels={}, unknown_area=[], unclassified=[], retention={})
    night = "2026-10-03T02:00:00+00:00"
    kept = {battery.RESTED: {"sensor.motion_battery": {"level": 52.0, "at": night},
                             "sensor.lock_battery": {"level": 30.0, "at": night}}}
    c = facts.Ctx.__new__(facts.Ctx)
    c.pack, c.Z, c.end = pack, ZoneInfo("UTC"), date(2026, 10, 4)
    c.now = datetime(2026, 10, 4, tzinfo=timezone.utc)
    c.need = lambda *p: 8
    c.store = SimpleNamespace(cache_get=kept.get, findings=lambda status=None: [])
    c.tasks = lambda: []
    c._states = {"sensor.motion_battery": {"state": "1"}, "sensor.lock_battery": {"state": "100"},
                 "sensor.other_battery": {"state": "7"}}
    c.params = lambda: VillaParams()
    pct = {r["name"]: r["pct"] for r in facts.s_batteries(c)["rows"]}
    assert pct == {"Motion": 52, "Lock": 100, "Other": 7}     # judged level; changed since: now; never judged: now


def _battery_night(tmp, as_of: str, reading: str, hourly_max: list[tuple[str, float]]):
    """The night check (nightly.py, as the engine runs it) for --as-of `as_of` over one door's battery reading
    `reading` now, with these hourly maxima in its statistics; one store across nights (tmp/s.sqlite)."""
    from vesta_shared.knowledge_pack import KnowledgePack
    fx = tmp / f"fx-{as_of}"
    fx.mkdir(parents=True, exist_ok=True)
    (fx / "states.json").write_text(json.dumps({"states": {"sensor.door_battery": {
        "state": reading, "attributes": {"friendly_name": "Door Battery", "unit_of_measurement": "%"},
        "last_changed": f"{as_of}T20:00:00+00:00"}}}))
    (fx / "stats_hour_door.json").write_text(json.dumps({"period_type": "hour", "entities": [
        {"entity_id": "sensor.door_battery", "statistics": [
            {"start": int(datetime.fromisoformat(t).timestamp() * 1000), "max": v} for t, v in hourly_max]}]}))
    pack = KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None, families={"battery": [
        {"entity_id": "sensor.door_battery", "name": "Door Battery", "device_id": "door", "asset": "door",
         "family": "battery", "platform": "zigbee", "unit": "%"}]},
        assets={}, areas=[], people=[], channels={}, unknown_area=[], unclassified=[], retention={},
        devices={"door": {"name": "Guest Door"}}, entity_devices={"sensor.door_battery": "door"})
    path = str(tmp / "pack.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(pack.to_json())
    r = subprocess.run([sys.executable, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "nightly.py"),
                        "--pack", path, "--store", str(tmp / "s.sqlite"), "--fixture-dir", str(fx), "--skip-raw",
                        "--as-of", as_of, "--out", str(tmp / "res.json")],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH})
    assert r.returncode == 0, r.stderr
    return pack


def _recheck_battery(tmp, now: datetime, reading: float, hourly_max: float) -> dict:
    """The 5-minute recheck (recheck.py, as the engine runs it) over the door's battery reading `reading` at `now`,
    its hourly best `hourly_max` over the hours before: its printed outcome."""
    fx = tmp / f"fx-recheck-{now:%H%M}"
    fx.mkdir()
    (fx / "states.json").write_text(json.dumps({"states": {"sensor.door_battery": {
        "state": str(reading), "attributes": {"unit_of_measurement": "%"}, "last_changed": now.isoformat()}}}))
    (fx / "stats_hour_door.json").write_text(json.dumps({"period_type": "hour", "entities": [
        {"entity_id": "sensor.door_battery", "statistics": [
            {"start": int((now - timedelta(hours=h)).timestamp() * 1000), "max": hourly_max} for h in range(1, 20)]}]}))
    r = subprocess.run([sys.executable, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "recheck.py"),
                        "--pack", str(tmp / "pack.json"), "--store", str(tmp / "s.sqlite"),
                        "--fixture-dir", str(fx), "--now", now.isoformat()],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_a_judged_level_stands_only_while_it_is_the_last_nights():
    from datetime import datetime as dt
    from vesta_shared import battery

    class St(dict):
        cache_get = dict.get

        def cache_put(self, k, v):
            self[k] = v
    night = dt(2026, 10, 3, 2, tzinfo=timezone.utc)
    s = St()
    battery.keep_judged(s, {"sensor.a": 50.0, "sensor.b": None}, night)
    assert battery.rested(s, "sensor.a", 1.0, night + timedelta(hours=20)) == 50.0
    assert battery.rested(s, "sensor.a", 1.0, night + timedelta(hours=battery.JUDGED_HOURS + 1)) == 1.0   # a night missed
    assert battery.rested(s, "sensor.b", 7.0, night + timedelta(hours=1)) == 7.0          # judged with no reading
    assert battery.rested(s, "sensor.a", None, night) is None


def test_one_battery_through_its_steps_reads_the_same_on_its_fault_its_cockpit_task_and_the_weekly_page(tmp_path):
    """Architecture review N card 7 (2026-10-27): a battery's level and step were worked out in four places (the
    night's level, its step hand-over, the recheck's own battery branches, the page). ONE verdict now
    (vesta_shared.battery.judge, battery.level): 18 % at night, then 9 %, 16 %, 26 % at the 5-minute recheck — at each
    step the open fault, its Cockpit task and the weekly page say the same level and step; a step is handed over,
    never "cleared"; above its line by the margin, it clears."""
    import facts
    from zoneinfo import ZoneInfo
    from vesta_shared import battery
    from vesta_shared.params import VillaParams
    from vesta_shared.store import Store
    pack = _battery_night(tmp_path, "2026-10-20", "18", [])

    def page(now, reading):
        st = Store(str(tmp_path / "s.sqlite"))
        c = facts.Ctx.__new__(facts.Ctx)
        c.pack, c.Z, c.end, c.now, c.store = pack, ZoneInfo("UTC"), now.date(), now, st
        c.need = lambda *p: 8
        c.tasks = lambda: facts.Ctx.tasks(c)
        c._states = {"sensor.door_battery": {"state": str(reading)}}
        c.params = lambda: VillaParams()
        (row,) = facts.s_batteries(c)["rows"]
        return row

    def stands():
        st = Store(str(tmp_path / "s.sqlite"))
        opened = st.findings("open")
        tasks = [t for t in st.tasks(None) if t["status"] == "open"]
        return opened, tasks

    (f,), (t,) = stands()
    assert f["rule_id"] == battery.LOW and "at 18%" in f["summary"] and "at 18%" in t["summary"]
    steps = [(9, battery.CRIT, "replace now"), (16, battery.LOW, "within the week")]
    for k, (pct, rule, words) in enumerate(steps):
        now = datetime(2026, 10, 21, 9 + k, tzinfo=timezone.utc)
        was = f
        out = _recheck_battery(tmp_path, now, pct, float(pct))
        assert out["faults_changed"] and out["actions"], out
        (f,), (t,) = stands()
        assert f["rule_id"] == rule and f"at {pct}%" in f["summary"] and words in f["summary"], f["summary"]
        assert f"at {pct}%" in t["summary"], t["summary"]                    # the Cockpit's task, the same words
        old = next(x for x in Store(str(tmp_path / "s.sqlite")).tasks(None) if x["source"] == f"finding:{was['id']}")
        assert old["status"] != "open" and old["close_note"].startswith("Now: ") and "Cleared" not in old["close_note"]
        row = page(now + timedelta(minutes=2), pct)
        assert row["pct"] == pct and f"at {pct}%" in row["night"], row
    now = datetime(2026, 10, 21, 12, tzinfo=timezone.utc)
    out = _recheck_battery(tmp_path, now, 26, 26.0)                           # above the 20 % line by its margin
    opened, tasks = stands()
    assert opened == [] and tasks == [] and out["faults_changed"]
    row = page(now + timedelta(minutes=2), 26)
    assert row["pct"] == 26 and not row.get("night"), row
