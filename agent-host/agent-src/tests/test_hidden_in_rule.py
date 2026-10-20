"""A villa rule still naming a device hidden in the villa's system: one fault per rule (owner, 2026-10-20).

The owner replaced two locks fitted the wrong way round by corrected copies and hid the real ones; the agent left the
hidden ones out of every check, but the villa's "critical devices offline" rule still watched them and alerted on one.
The night check now says so. Shapes as the villa answers them (a blueprint rule's input list, a script whose
description and notes mention ids in prose); the ids are synthetic.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

from helpers import PYTHONPATH, STARTER_SKILLS

NIGHTLY = os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "nightly.py")
RULE = "PM-HIDDEN-IN-RULE"
RAW, FIXED = "lock.front_door", "lock.front_door_inverted"

WATCHDOG = {"entity_id": "automation.critical_watchdog_devices", "kind": "automation", "config": {
    "id": "1", "alias": "critical_watchdog---devices",
    "description": f"Watches the critical devices. {RAW} was replaced by its corrected copy.",
    "use_blueprint": {"path": "critical_watchdog.yaml", "input": {
        "critical_entities": ["sensor.ap_state", RAW, "switch.pool_pump"],
        "grace_period": {"hours": 0, "minutes": 10, "seconds": 0}}}}}
FIXED_RULE = {"entity_id": "automation.door_unlocked", "kind": "automation", "config": {
    "id": "2", "alias": "critical_condition---door_unlocked",
    "use_blueprint": {"path": "critical_condition.yaml", "input": {"watched_entities": [FIXED]}}}}
SCRIPT = {"entity_id": "script.alert_photo", "kind": "script", "config": {
    "alias": "Alert photo", "description": f"Sends a picture; once read {RAW} directly.",
    "sequence": [{"action": "camera.snapshot", "target": {"entity_id": "{{ cam }}"},
                  "note": f"never {RAW}: it is hidden"}]}}


def _night(tmp, rules, hidden=(RAW,), raw="unavailable"):
    fx = tmp / "fx"
    fx.mkdir(exist_ok=True)
    (fx / "states.json").write_text(json.dumps({"states": {
        RAW: {"state": raw, "attributes": {"friendly_name": "Front Door Raw"}, "last_changed": "2026-10-03T00:00:00+00:00"},
        FIXED: {"state": "locked", "attributes": {"friendly_name": "Front Door"}, "last_changed": "2026-10-03T00:00:00+00:00"}}}))
    (fx / "rules.json").write_text(json.dumps(rules))
    (tmp / "pack.json").write_text(json.dumps({
        "villa": "Example Villa", "time_zone": "UTC", "generated_at": "x", "ha_version": None, "areas": [], "people": [],
        "channels": {}, "unknown_area": [], "unclassified": [], "retention": {"raw_history_days": 10},
        "families": {}, "assets": {}, "hidden": list(hidden)}))
    r = subprocess.run([sys.executable, NIGHTLY, "--pack", str(tmp / "pack.json"), "--store", str(tmp / "s.sqlite"),
                        "--fixture-dir", str(fx), "--skip-raw", "--as-of", "2026-10-03", "--out", str(tmp / "res.json")],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH})
    assert r.returncode == 0, r.stderr
    return json.load(open(tmp / "res.json"))


def _open(tmp):
    from vesta_shared.store import Store
    return [f for f in Store(str(tmp / "s.sqlite")).findings("open") if f["rule_id"] == RULE]


def test_a_rule_watching_a_hidden_device_is_one_fault_naming_it(tmp_path):
    _night(tmp_path, [WATCHDOG, FIXED_RULE, SCRIPT])
    got = _open(tmp_path)
    # the watchdog only: the corrected copy's rule names a LONGER id, the script names it only in its prose
    assert [f["entity_id"] for f in got] == ["automation.critical_watchdog_devices"]
    assert got[0]["summary"] == ("The rule critical_watchdog---devices watches 1 device hidden in the villa's system: "
                                 "Front Door Raw.")
    assert json.loads(got[0]["detail"])["hidden"] == [RAW]
    assert "Home Assistant" not in got[0]["summary"]


def test_a_hidden_device_that_answers_is_no_fault(tmp_path):
    # owner, 2026-10-21: five rules watching live hidden devices (a board temperature, one mains phase, a camera's
    # person detection) were faults — a device is hidden to tidy the screens too; the case is the replaced, silent one
    _night(tmp_path, [WATCHDOG, SCRIPT], raw="unlocked")
    assert _open(tmp_path) == []


def test_the_fault_closes_once_the_rule_is_pointed_at_the_device_you_see(tmp_path):
    _night(tmp_path, [WATCHDOG])
    assert len(_open(tmp_path)) == 1
    fixed = json.loads(json.dumps(WATCHDOG))
    fixed["config"]["use_blueprint"]["input"]["critical_entities"][1] = FIXED
    _night(tmp_path, [fixed])
    assert _open(tmp_path) == []


def test_a_night_that_cannot_read_the_rules_clears_nothing(tmp_path):
    _night(tmp_path, [WATCHDOG])
    res = _night(tmp_path, {"error": "no answer"})            # rules.json not a list: the villa did not answer
    assert len(_open(tmp_path)) == 1
    assert any("could not be read" in n for n in res["notes"])


def test_a_villa_with_nothing_hidden_asks_nothing(tmp_path):
    _night(tmp_path, {"error": "would fail if asked"}, hidden=())
    assert _open(tmp_path) == []


class _Session:
    """ha-mcp as the villa answers: a search in two pages (an automation, then a script), each rule read whole."""

    def __init__(self):
        self.asked = []

    def call_raw(self, name, args):
        self.asked.append((name, args))
        if name == "ha_search":
            body = ({"automations": [{"entity_id": WATCHDOG["entity_id"], "match_in_config": True}], "scripts": [],
                     "config_has_more": True, "config_next_offset": 1} if args["offset"] == 0 else
                    {"automations": [], "scripts": [{"entity_id": SCRIPT["entity_id"]}], "config_has_more": False,
                     "config_next_offset": None})
        elif name == "ha_config_get_automation":
            body = {"success": True, "automation_id": args["identifier"], "config": WATCHDOG["config"], "config_hash": "h"}
        else:
            body = {"success": True, "script_id": "alert_photo", "config": SCRIPT["config"], "config_hash": "h"}
        return {"content": [{"type": "text", "text": json.dumps(body)}]}


def test_the_client_reads_every_page_and_each_rule_once():
    from vesta_shared.ha_client import McpClient
    s = _Session()
    got = McpClient(session=s).rules_mentioning([RAW, RAW])
    assert [(r["entity_id"], r["kind"]) for r in got] == [(WATCHDOG["entity_id"], "automation"), (SCRIPT["entity_id"], "script")]
    assert got[0]["config"] == WATCHDOG["config"]
    assert [n for n, _ in s.asked].count("ha_search") == 2        # one text (asked twice), two pages
    assert ("ha_config_get_script", {"script_id": SCRIPT["entity_id"]}) in s.asked
