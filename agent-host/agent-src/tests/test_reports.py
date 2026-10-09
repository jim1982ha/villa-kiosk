"""The reports composer, as the model calls it (synthetic: no villa data)."""
from __future__ import annotations

import os
import subprocess
import sys

from helpers import PYTHONPATH, ROOT, STARTER_SKILLS

COMPOSE = os.path.join(STARTER_SKILLS, "reports", "scripts", "compose.py")


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
    hour = [{"start": int((START + timedelta(hours=h)).timestamp() * 1000), "mean": (850.0 if h < 24 * 25 else 740.0)
             if 8 <= h % 24 < 16 else 2.0} for h in range(24 * 28)]
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
                                "entities": {"power": "sensor.example_pump_power", "energy": "sensor.example_pump_energy"}}}}
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


def test_the_weekly_facts_come_from_home_assistant_and_reports_yaml(tmp_path):
    fx = _villa(tmp_path)
    printed, facts = _facts(tmp_path, fx)
    s = facts["sections"]
    assert facts["order"][:3] == ["header", "headline", "kpis"] and not facts["problems"]
    assert s["header"]["title"] == "Example Villa, week 40"
    assert [r["kwh"] for r in s["energy_days"]["rows"]][:2] == [40.0, 41.0]          # HA's daily statistics
    card = s["equipment"]["cards"][0]
    assert card["title"] == "Garden pump" and card["status"] == "Watch"                # 850 W → 740 W: a drop
    assert s["batteries"]["rows"][0] == {"name": "Battery A", "pct": 12, "level": "replace", "volts": None}
    assert s["kpis"]["offline_critical"] == 1                                          # the lock: a security device
    assert {w["id"] for w in printed["to_write"]} >= {"headline", "card-pump.reading"}


def test_a_threshold_missing_from_reports_yaml_is_named_never_guessed(tmp_path, monkeypatch):
    fx = _villa(tmp_path)
    skill = tmp_path / "skills" / "reports"
    shutil.copytree(os.path.join(STARTER_SKILLS, "reports"), skill)
    import yaml
    cfg = yaml.safe_load((skill / "reports.yaml").read_text())
    del cfg["thresholds"]["battery"]["replace_below_pct"]
    (skill / "reports.yaml").write_text(yaml.safe_dump(cfg))
    r = _run(str(skill / "scripts" / "facts.py"), "fm-weekly", "--pack", str(tmp_path / "pack.json"),
             "--store", str(tmp_path / "s.sqlite"), "--energy", str(tmp_path / "week.json"), "--fixture-dir", str(fx),
             "--out", str(tmp_path / "facts.json"))
    facts = json.load(open(tmp_path / "facts.json"))
    assert facts["sections"]["batteries"] == {"error": "reports.yaml: parameter missing: thresholds.battery.replace_below_pct"}
    assert facts["sections"]["energy_days"]["rows"]                                    # the rest still computed


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
    rows = facts["sections"]["todo"]["rows"]
    step = next(r for r in rows if r["kind"] == "pumps/running power stepped down")
    assert step["title"] == "Garden pump: running power down 13% since 2 Oct"                     # reports.yaml's title
    assert step["figures"]["after_w"] == 740 and step["figures"]["hours_before"] == step["figures"]["hours_after"] == 8
    assert step["ask"] == "was anything done in the pump room on 2 Oct or the day before?"
    lock = next(r for r in rows if r["kind"] == "locks_and_doors/a safety device offline")
    assert lock["title"] == "Front door lock offline since 4 Oct, 10:00"
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


def test_a_kind_without_a_group_line_stays_one_line_per_device(tmp_path):
    # four pumps that each lost power are four problems: no group line in reports.yaml, no grouping
    facts, c, _ = _ctx(tmp_path)
    c._clues = ([{"id": f"clue-{k}", "group": "pumps", "entry": "running power stepped down", "subject": f"Pump {k}",
                  "figures": {"step_date": "2026-10-02", "subject": f"Pump {k}", "entity_id": f"sensor.example_p{k}"},
                  "horizon": "Now", "severity": None, "title": f"Pump {k}: running power down", "group_title": None,
                  "playbook": {"means": "m"}} for k in range(4)], [])
    rows = [r for r in facts.todo(c) if r["kind"] == "pumps/running power stepped down"]
    assert [r["title"] for r in rows] == [f"Pump {k}: running power down" for k in range(4)]


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
                        "Front door lock has been offline for 3 h.", {"hours": 3})
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


def test_a_group_that_started_in_the_same_minute_says_one_cause(tmp_path):
    facts, c, _ = _ctx(tmp_path)
    c.cfg["thresholds"]["todo"]["group_from"] = 1
    c._clues = ([{"id": f"clue-{k}", "group": "monitoring", "entry": "a device of the monitoring offline",
                  "subject": f"Meter {k}", "figures": {"since": f"2026-10-01T09:2{8 + k % 2}", "subject": f"Meter {k}"},
                  "horizon": "Soon", "severity": None, "title": f"Meter {k} offline", "group_title": "{n} monitoring devices offline",
                  "playbook": {"means": "m", "check": "c"}} for k in range(4)], [])
    (row,) = [r for r in facts.todo(c) if r["kind"] == "monitoring/a device of the monitoring offline"]
    assert row["title"] == "4 monitoring devices offline"
    assert "All since 1 Oct, 09:28: one cause is likely" in row["why"]


class _Book:
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
        return rows + [{"when": "2026-09-30T12:00:00+00:00", "entity_id": entity_id, "message": "turned off"}]


def test_an_alert_is_a_run_only_for_a_rule_that_alerts_on_every_run(tmp_path):
    # villa, 2026-10-01: 71 runs of the schedule rules (a daily check) showed as 71 "critical alerts"
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


def test_a_report_run_reads_home_assistant_once_per_thing(tmp_path):
    # architecture review 5: the weekly page read the rules' logbooks 4 times and a pump's hourly power up to 3 times
    book = _Book(["2026-09-30T07:41:00+00:00"], [])
    facts, c, store = _ctx(tmp_path, book)
    for _ in range(4):
        c.ha_alerts()
    assert book.reads == 1                                            # one VESTA rule alerts on every run: one read

    class Counting:
        def __init__(self):
            self.calls = []

        def statistics(self, ids, s, e, period, types):
            self.calls.append((tuple(ids), s))
            return {}
    cli = Counting()
    c.cli = cli
    c.hourly_means("sensor.example_pump_power", 7)
    c.hourly_means("sensor.example_pump_power", 30)                  # a longer window: read again, once
    c.hourly_means("sensor.example_pump_power", 7)
    c.hourly_means("sensor.example_pump_power", 30)
    assert len(cli.calls) == 2


def test_the_same_alert_repeated_is_one_row_with_its_count(tmp_path):
    facts, c, _ = _ctx(tmp_path, _Book(["2026-09-28T07:41:00+00:00", "2026-09-29T07:41:00+00:00"], []))
    (row,) = facts.s_alerts(c)["rows"]
    assert row["times"] == 2 and row["what"] == "Entrance unlocked"


def test_the_order_of_the_page_is_reports_yaml_s(tmp_path):
    fx = _villa(tmp_path)
    _, facts = _facts(tmp_path, fx)
    facts["order"] = ["circuits", "header"]                                            # as if reordered in reports.yaml
    (tmp_path / "facts.json").write_text(json.dumps(facts))
    _run(COMPOSE, "fm-weekly", "--facts", str(tmp_path / "facts.json"), "--out", str(tmp_path / "page.html"))
    page = (tmp_path / "page.html").read_text()
    assert page.index("Circuit") < page.index("<h1>") and "Batteries" not in page


def test_the_villas_own_playbook_and_cards_are_added_to_the_shipped_ones(tmp_path):
    fx = _villa(tmp_path)
    skill = tmp_path / "skills" / "reports"
    shutil.copytree(os.path.join(STARTER_SKILLS, "reports"), skill)
    (skill / "villa.reports.yaml").write_text(json.dumps({
        "playbook": {"pumps": [{"name": "garden pump dry run", "means": "it slides before it stops"}]},
        "cards": [{"kind": "energy_daily", "entity": "sensor.example_pump_energy", "title": "Garden pump energy"}],
        "thresholds": {"battery": {"replace_below_pct": 15}}}))
    r = _run(str(skill / "scripts" / "facts.py"), "fm-weekly", "--pack", str(tmp_path / "pack.json"),
             "--store", str(tmp_path / "s.sqlite"), "--energy", str(tmp_path / "week.json"), "--fixture-dir", str(fx),
             "--out", str(tmp_path / "facts.json"))
    printed, facts = json.loads(r.stdout), json.load(open(tmp_path / "facts.json"))
    assert [k["name"] for k in printed["knowledge"]] == ["garden pump dry run"]              # knowledge, not a clue
    assert "Garden pump energy" in [c["title"] for c in facts["sections"]["equipment"]["cards"]]
    assert facts["sections"]["batteries"]["replace_below_pct"] == 15                          # the villa's threshold
    assert facts["sections"]["batteries"]["rows"][0]["level"] == "replace"                    # 12 % < 15 %


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
    (made,) = [a for a in first["actions"] if a["action"] == "ticket"]
    second = night("2026-10-02", "2026-10-02T01:55:00+00:00")                      # reporting again
    assert [a for a in second["actions"] if a["action"] == "ticket.resolve"] == [
        {"action": "ticket.resolve", "task_id": made["task_id"], "note": "Cleared: the nightly check no longer sees it."}]
    from vesta_shared.store import Store
    assert Store(str(tmp_path / "s.sqlite")).task(made["task_id"])["status"] == "cleared"



def test_every_state_the_alert_desk_gives_has_its_words(tmp_path):
    # architecture review, 2026-10-01: 6 of the desk's states reached the page raw ("asked", "reasked")
    import re
    import yaml
    desk = open(os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"), encoding="utf-8").read()
    owner = open(os.path.join(ROOT, "vesta_shared", "problems.py"), encoding="utf-8").read()
    states = set(re.findall(r'state="([a-z_]+)"', desk + owner)) | {"new"}         # "new": the store's default
    words = yaml.safe_load(open(os.path.join(STARTER_SKILLS, "reports", "reports.yaml"), encoding="utf-8"))["incident_words"]
    assert states and states <= set(words), states - set(words)


def test_an_alert_state_without_words_is_named_not_shown_raw(tmp_path):
    facts, c, store = _ctx(tmp_path)
    c.cfg["incident_words"] = {"done": "Done"}
    iid = store.new_incident("k", "automation.example_door", "lock.example_door", "P2", {"message": "Door open"},
                             at="2026-09-30T08:00:00+00:00")
    store.update_incident(iid, state="reasked")
    c.ha_alerts = lambda: []
    (row,) = facts._alert_rows(c)
    assert c.problems == ["reports.yaml: incident_words has no words for the state 'reasked'"]


def test_a_logbook_run_close_to_an_incident_of_its_rule_is_that_incident():
    import importlib.util
    spec = importlib.util.spec_from_file_location("facts", FACTS)
    facts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(facts)
    t = datetime(2026, 9, 30, 8, 0, tzinfo=timezone.utc)
    known = [("automation.door", t)]
    assert facts.followed_by_agent("automation.door", t + timedelta(minutes=10), known, 900)
    assert not facts.followed_by_agent("automation.door", t + timedelta(minutes=20), known, 900)
    assert not facts.followed_by_agent("automation.gate", t, known, 900)


def test_the_one_list_is_built_from_plain_inputs():
    # architecture review, 2026-10-01: the merge and grouping rules, tested with lists — no villa, store or HA
    import importlib.util
    spec = importlib.util.spec_from_file_location("facts", FACTS)
    facts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(facts)
    clue = {"id": "clue-1", "group": "pumps", "entry": "running power stepped down", "subject": "Pump",
            "figures": {"entity_id": "sensor.pump_power", "step_date": "2026-09-20"}, "horizon": "Now", "severity": None,
            "title": "Pump: power down", "group_title": None, "playbook": {"means": "less water", "check": "the basket"}}
    pump_task = {"id": "finding-1", "kind": "PM-POWER-CHANGE", "entity_id": "sensor.pump_power", "severity": "P3",
                 "title": "Pump draws less", "since": "2026-09-21", "figures": {}, "check": ""}
    silent = [{"id": f"finding-{k}", "kind": "PM-SILENT", "entity_id": f"sensor.s{k}", "severity": "P3",
               "title": f"S{k} silent", "since": "2026-10-01T09:28", "figures": {}} for k in range(2, 5)]
    rows = facts.one_list([clue], [pump_task, *silent], lambda eid, fb: {"sensor.pump_power": "pump"}.get(eid, eid or fb),
                          lambda eid: {"sensor.s2": "S2", "sensor.s3": "S3", "sensor.s4": "S4"}.get(eid),
                          {"P1": "Now", "P2": "Now", "P3": "Soon", "P4": "Plan"}, 3, 10,
                          {"PM-SILENT": "{n} sensors silent", "same_time": "All since {since}: one cause."})
    assert [r["title"] for r in rows] == ["Pump: power down", "3 sensors silent"]      # clue + task merged; 3 grouped
    assert rows[0]["severity"] == "P2" and rows[0]["task_ids"] == ["finding-1"]       # Now → P2; the task kept with it
    assert rows[1]["members"] == ["S2", "S3", "S4"] and "All since 1 Oct, 09:28: one cause." in rows[1]["why"]


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


def test_a_proposal_says_how_to_answer_and_its_long_names_wrap(tmp_path):
    # owner, 2026-10-07: "Accept / Later / Ignore": boxes that looked like buttons on a page that cannot press
    # anything, and an entity id that ran out of its card
    import sys as _s
    _s.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    facts = {"zone": "UTC", "order": ["fixed_suggest"], "sections": {"fixed_suggest": {"fixed": [], "proposals": [
        {"id": 4, "title": "Create the missing setting for Weather station", "detail": "No nominal voltage", "benefit": "Enables one rule"}]}}}
    page = compose.page(facts, {})
    assert 'class="btn"' not in page
    assert "To answer, write in the chat: <b>accept 4</b>, <b>later 4</b> or <b>ignore 4</b>." in page
    assert "No nominal voltage. Enables one rule." in page
    assert ".wrap{overflow-wrap:anywhere}" in page and ".asset > .st{justify-self:start}" in page


def test_a_missing_setting_proposal_names_the_device_not_its_id():
    import sys as _s
    _s.path.insert(0, os.path.join(STARTER_SKILLS, "roi-energy", "scripts"))
    import proposals
    found = [{"rule_id": "PM-PARAM-MISSING", "entity_id": "sensor.example_battery", "summary": "x",
              "detail": json.dumps({"reading_v": 3.1, "name": "Weather station"})}]
    (p,) = [x for x in proposals.build({}, None, found) if x["kind"] == "configuration"]
    assert p["title"] == "Create the missing setting for Weather station"


def test_a_missing_nominal_voltage_finding_carries_the_devices_name():
    # the proposal names the device (above): the night check must hand that name on
    import sys as _s
    from datetime import date
    _s.path.insert(0, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import rules
    from vesta_shared.params import VillaParams
    (f,) = rules.battery_rules({"slug": "station", "name": "Weather station"}, "sensor.example_battery", "V", 3.1, [],
                               VillaParams(defaults=rules.DEFAULTS), date(2026, 10, 7))
    assert f.rule_id == "PM-PARAM-MISSING" and f.detail["name"] == "Weather station"


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


def test_the_pack_finds_an_entity_once_and_prefers_the_row_that_names_it():
    from vesta_shared.knowledge_pack import KnowledgePack
    pack = KnowledgePack("V", "UTC", "", None, {"power": [{"entity_id": "sensor.x", "asset": "pump"}],
                                                "energy": [{"entity_id": "sensor.x", "name": "Pump", "asset": "pump"}]},
                         {}, [], [], {}, [], [], {})
    assert pack.name_of("sensor.x") == "Pump" and pack.row("sensor.x")["asset"] == "pump"
    assert pack.name_of("sensor.unknown") is None and pack.name_of("sensor.unknown", "fallback") == "fallback"
    assert "_by_entity" not in pack.to_json()


def test_a_page_step_with_a_missing_part_is_refused_not_silently_unsent(tmp_path):
    # architecture review 5: --finish without --out printed no "send": the job's step sent nothing, and said nothing
    fx = _villa(tmp_path)
    _facts(tmp_path, fx)
    f = str(tmp_path / "facts.json")
    for args, why in [(["--finish", "fm", "--no-ai", "x."], "needs --out"),
                      (["--no-ai", "x.", "--out", "p.html"], "give --finish too"),
                      (["--finish", "fm", "--out", str(tmp_path / "p.html")], "give --limit")]:
        r = _run(COMPOSE, "fm-weekly", "--facts", f, *args)
        assert r.returncode == 1 and why in r.stderr, (args, r.stderr)
    r = _run(COMPOSE, "fm-daily", "--pack", str(tmp_path / "pack.json"), "--store", str(tmp_path / "s.sqlite"),
             "--finish", "fm")
    assert r.returncode == 1 and "on_limit step of a page" in r.stderr


def test_a_source_the_report_cites_is_a_link_that_cannot_break_the_page():
    # owner, 2026-10-09: "I expect to see a clickable link instead of a raw text" — the web_search sources in the
    # readings and the checks were escaped whole, so a cited page could not be opened from the phone
    import sys as _s
    _s.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    out = str(compose.linked("Note its firmware. https://github.com/home-assistant/core/issues/183069. Then ask."))
    assert ('<a class="src" href="https://github.com/home-assistant/core/issues/183069" target="_blank" '
            'rel="noopener noreferrer">https://github.com/home-assistant/core/issues/183069</a>. Then ask.') in out
    assert out.startswith("Note its firmware. ")
    # what surrounds it stays escaped, and a quote ends the address: nothing written can leave the link
    evil = str(compose.linked('<b>x</b> https://a.example/p?q=1&r=2"onclick="x'))
    assert "<b>" not in evil and 'href="https://a.example/p?q=1&amp;r=2"' in evil and 'onclick="x' not in evil
    assert str(compose.linked("")) == "" and not compose.linked("")
    # both kinds of sentence on the page go through it: the readings and the checks
    facts = {"zone": "UTC", "order": ["headline"], "to_write": [{"id": "headline", "kind": "reading"}],
             "sections": {"headline": {"colour": "amber", "text": "Amber"}}}
    page = compose.page(facts, {"headline": "See https://example.org/guide."})
    assert '<a class="src" href="https://example.org/guide"' in page and "a.src{" in page
    # a check and its question, as the AI wrote them, on the "Do this week" list (villa, 15:56: the link was
    # escaped a second time there and the page showed "<a class=...>" as text)
    facts = {"zone": "UTC", "order": ["todo"], "to_write": [],
             "sections": {"todo": {"rows": [{"id": "t1", "title": "Pool pump", "severity": "P2", "why": "Less water"}]}}}
    page = compose.page(facts, {"t1.check": "empty the baskets: https://www.example.org/pump-not-working/.",
                                "t1.ask": "Was a valve moved"})
    assert ('Empty the baskets: <a class="src" href="https://www.example.org/pump-not-working/" target="_blank" '
            'rel="noopener noreferrer">https://www.example.org/pump-not-working/</a>. Was a valve moved?') in page
    assert "&lt;a class" not in page


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


def test_the_monitoring_table_lists_devices_not_their_sensors():
    # owner, 2026-10-09: "make sure this table only reports devices (and not entities related to a device)" — it listed
    # a phone's Wi-Fi traffic as two rows "RX" and "TX", and one pump plug's sensors as rows of their own
    import sys as _s
    from zoneinfo import ZoneInfo
    _s.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import facts
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
                 "ap": {"name": "", "manufacturer": "Ubiquiti", "model": "U6 Lite"}})
    c = facts.Ctx.__new__(facts.Ctx)
    c.pack, c.Z = pack, ZoneInfo("UTC")
    c.cfg = {"offline_families": ["power", "switch", "network", "battery"], "critical_families": ["switch"]}
    off = lambda at: {"state": "unavailable", "last_changed": at}
    c._states = {"sensor.spa_pump_power": off("2026-10-09T09:05:00+00:00"), "sensor.jet_pump_power": off("2026-10-09T09:01:00+00:00"),
                 "switch.spa_relay": off("2026-10-09T09:03:00+00:00"), "sensor.rx": off("2026-10-09T08:00:00+00:00"),
                 "sensor.tx": off("2026-10-09T08:00:00+00:00"), "sensor.ap_rx": off("2026-10-09T07:00:00+00:00"),
                 "sensor.lone_battery": off("2026-10-09T06:00:00+00:00")}
    got = {o["name"]: o for o in c.offline()}
    # the plug is ONE row under its own name, since its first sensor went, critical because its relay is
    assert set(got) == {"Spa Plug", "Unnamed Ubiquiti U6 Lite", "Lone Battery"}, sorted(got)
    assert got["Spa Plug"]["since"] == "2026-10-09T09:01" and got["Spa Plug"]["critical"] is True
    assert "RX" not in got and "TX" not in got                        # a nameless Wi-Fi client is not a villa device
    assert got["Lone Battery"]["since"] == "2026-10-09T06:00"         # a sensor with no device keeps its own row
    # a pack built before devices were kept groups nothing and hides nothing
    pack.devices = {}
    assert {o["name"] for o in c.offline()} >= {"Spa Pump Power", "RX", "Lone Battery"}


def test_a_pack_built_before_devices_were_kept_is_rebuilt_at_start(tmp_path):
    # a format change carries its migration: an older pack has no devices, and the monitoring table would list
    # sensors instead of devices until the 01:30 rebuild
    import inspect
    import json as _j
    from vesta_agent.app import Vesta, pack_needs_build
    from vesta_shared.knowledge_pack import KnowledgePack
    base = dict(villa="V", time_zone="UTC", generated_at="", ha_version=None, families={}, assets={}, areas=[], people=[],
                channels={}, unknown_area=[], unclassified=[], retention={})
    old = tmp_path / "old.json"
    old.write_text(_j.dumps(base))
    new = tmp_path / "new.json"
    new.write_text(KnowledgePack(**base, devices={"d1": {"name": "Pump", "manufacturer": "", "model": ""}}).to_json())
    assert pack_needs_build(str(tmp_path / "none.json")) and pack_needs_build(str(old))
    assert not pack_needs_build(str(new))
    assert "if pack_needs_build(self.s.pack_path):" in inspect.getsource(Vesta.start)
