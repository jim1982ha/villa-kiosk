"""The reports composer, as the model calls it (synthetic: no villa data)."""
from __future__ import annotations

import os
import subprocess
import sys

from helpers import ROOT, STARTER_SKILLS

COMPOSE = os.path.join(STARTER_SKILLS, "reports", "scripts", "compose.py")


def test_a_step_without_its_input_stops_and_says_what_to_run(tmp_path):
    # 2026-09-30: called without the week's figures, the page died in Jinja ("type Undefined doesn't
    # define __round__") and the model told the owner "a template error".
    for script, cmd, need in ((FACTS, "fm-weekly", "--energy"), (FACTS, "owner-monthly", "--energy"),
                              (COMPOSE, "fm-weekly", "--facts"), (COMPOSE, "owner-monthly", "--facts"),
                              (COMPOSE, "owner-weekly", "--energy")):
        r = subprocess.run([sys.executable, script, cmd, "--pack", str(tmp_path / "none.json"), "--out", "x.html"],
                           capture_output=True, text=True, env={**os.environ, "PYTHONPATH": ROOT})
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
                          env={**os.environ, "PYTHONPATH": ROOT}, cwd=cwd)


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
    assert s["batteries"]["rows"][0] == {"name": "Battery A", "pct": 12, "level": "replace"}
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
    assert "<svg" in page and "http://" not in page and "https://" not in page and "<script" not in page


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


def test_the_playbook_turns_the_villas_data_into_clues(tmp_path):
    fx = _villa(tmp_path)
    _, facts = _facts(tmp_path, fx)
    clues = facts["sections"]["noticed"]["rows"]
    step = next(c for c in clues if c["entry"] == "running power stepped down")
    assert step["subject"] == "Garden pump"
    assert step["figures"]["step_date"] == "2026-10-02" and step["figures"]["after_w"] == 740      # the drop, dated
    assert step["figures"]["hours_before"] == step["figures"]["hours_after"] == 8                  # same running time
    assert step["playbook"]["ask"] == "was anything done in the pump room on 2 Oct or the day before?"
    offline = [c["subject"] for c in clues if c["entry"] == "a safety device offline"]
    assert offline == ["Front door lock"]
    assert facts["sections"]["quiet"]["did_not_happen"][0] == "no leak or electrical trip"
    assert {w["id"] for w in facts["to_write"]} >= {f"{step['id']}.reading", f"{step['id']}.ask", "quiet"}


def test_the_order_of_the_page_is_reports_yaml_s(tmp_path):
    fx = _villa(tmp_path)
    _, facts = _facts(tmp_path, fx)
    facts["order"] = ["circuits", "header"]                                            # as if reordered in reports.yaml
    (tmp_path / "facts.json").write_text(json.dumps(facts))
    _run(COMPOSE, "fm-weekly", "--facts", str(tmp_path / "facts.json"), "--out", str(tmp_path / "page.html"))
    page = (tmp_path / "page.html").read_text()
    assert page.index("Circuit") < page.index("<h1>") and "Batteries" not in page


def test_alerts_the_agent_did_not_follow_come_from_home_assistants_own_record(tmp_path):
    # owner, 2026-10-01: a report shows what happened in the villa, not only what the agent saw
    import importlib.util
    spec = importlib.util.spec_from_file_location("facts", FACTS)
    facts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(facts)
    from vesta_shared.knowledge_pack import KnowledgePack
    from vesta_shared.store import Store
    _villa(tmp_path)
    when = "2026-09-30T21:53:00+00:00"

    class HA:
        def all_entity_ids(self):
            return ["automation.example_watchdog", "automation.example_lights"]

        def tool(self, name, args):
            assert name == "ha_config_get_automation"
            bp = "critical_watchdog.yaml" if args["identifier"] == "automation.example_watchdog" else "motion_light.yaml"
            return {"config": {"alias": "Meter unreachable", "use_blueprint": {"path": f"vesta/{bp}"}}}

        def logbook(self, start, end, entity_id=None):
            return [{"when": when, "entity_id": entity_id, "message": "triggered"}] if entity_id == "automation.example_watchdog" else []

    store = Store(str(tmp_path / "s.sqlite"))
    c = facts.Ctx("fm-weekly", KnowledgePack.load(str(tmp_path / "pack.json")), store, HA(),
                  json.load(open(tmp_path / "week.json")), facts.load_cfg(), "UTC",
                  datetime(2026, 10, 5, 7, tzinfo=timezone.utc), None)
    assert c.vesta_rules() == {"automation.example_watchdog": "Meter unreachable"}   # by the alert desk's blueprints
    rows = facts._alert_rows(c)
    assert [(r["what"], r["source"]) for r in rows] == [("Meter unreachable", "home_assistant")]
    # the same alert, followed by the agent: shown once, as the agent's
    store.new_incident("k", "automation.example_watchdog", "sensor.example_meter", "P2",
                       {"message": "Meter unreachable"}, at=when)
    rows = facts._alert_rows(c)
    assert [r["source"] for r in rows] == ["agent"]


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
