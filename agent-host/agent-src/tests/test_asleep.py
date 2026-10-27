"""Devices unavailable by design (owner 2026-10-21): a battery device asleep between its reports. One list — the VESTA
Kiosk's, handed over in its heartbeat answer and kept beside the knowledge pack — one predicate (KnowledgePack.is_asleep, a listed entity standing for
its whole physical device), read by every check that judges "unavailable" (vesta_shared.asleep)."""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

from helpers import STARTER_SKILLS
from test_offline import NOW, STATES, _pack
from vesta_agent.app import Vesta
from vesta_agent.policy import FIELDS
from vesta_agent.tools import with_asleep
from vesta_shared import asleep
from vesta_shared.ha_client import HABase
from vesta_shared.knowledge_pack import KnowledgePack
from vesta_shared.offline import devices_offline


def _kept(tmp_path, ids):
    """The Kiosk's list as the agent keeps it, beside a pack at tmp_path; the pack's path."""
    pack = str(tmp_path / "pack.json")
    asleep.save(pack, ids)
    return pack


def test_the_kiosk_hands_the_list_over_and_the_agent_keeps_it_beside_its_pack(tmp_path):
    pack = str(tmp_path / "pack.json")
    assert asleep.listed(pack) == frozenset()                                        # never told: none
    assert asleep.told({"every": 60}) is None                                        # a Kiosk older than the list
    assert asleep.told({"unavailableByDesign": ["Binary_Sensor.Door", 3]}) == ["binary_sensor.door"]

    class _App:
        kiosk_answered = Vesta.kiosk_answered

        class s:
            pack_path = pack
    _App().kiosk_answered({"unavailableByDesign": ["binary_sensor.door"]})
    assert asleep.listed(pack) == {"binary_sensor.door"}
    _App().kiosk_answered({"every": 60})                                             # said nothing: kept as it was
    assert asleep.listed(pack) == {"binary_sensor.door"}
    _App().kiosk_answered({"unavailableByDesign": []})                               # emptied in the Kiosk
    assert asleep.listed(pack) == frozenset()
    # the agent's own list of 0.12.308 is gone: the Rules page no longer edits one
    assert "asleep_entities" not in FIELDS


def test_the_rules_page_drops_the_retired_own_list_on_its_next_save():
    from vesta_agent.ui import policy_doc
    out = policy_doc.apply_form("asleep_entities: [binary_sensor.door]\n", policy_doc.to_form(""))
    assert "asleep_entities" not in out


def _loaded(tmp_path, ids):
    """The pack as every reader gets it (KnowledgePack.load), the Kiosk's list `ids` kept beside it."""
    path = _kept(tmp_path, ids)
    with open(path, "w", encoding="utf-8") as f:
        f.write(_pack().to_json())
    return KnowledgePack.load(path)


def test_a_device_listed_is_never_offline_and_its_other_entities_sleep_with_it(tmp_path):
    names = [g.name for g in devices_offline(_loaded(tmp_path, ["switch.spa_relay"]), STATES, NOW,
                                             ["power", "switch", "battery"])]
    # the relay's plug (its power sensors are on the same device) is asleep; the lone battery still counts
    assert names == ["Lone Battery"]
    assert "Spa Plug" in [g.name for g in devices_offline(_loaded(tmp_path, []), STATES, NOW,
                                                          ["power", "switch", "battery"])]


def test_where_a_device_stands_is_one_answer():
    pack = _pack()
    pack.asleep_are(["binary_sensor.door"])
    assert pack.standing("binary_sensor.door", "unavailable") == "asleep"
    assert pack.standing("binary_sensor.door", "on") == "answers"            # awake: what it says
    assert pack.standing("sensor.tank", "unavailable") == "offline"
    assert pack.standing("sensor.tank", "unknown") == "no value"             # answers, with nothing to give
    assert pack.standing("sensor.tank", "") == "no value"
    assert pack.standing("sensor.gone", None) == "absent"


def test_the_last_real_state_stands_in_for_unavailable():
    class Cli(HABase):
        def history(self, ids, start, end):
            return {"binary_sensor.door": [{"state": "on", "last_changed": "2026-10-09T10:00:00+00:00"},
                                           {"state": "off", "last_changed": "2026-10-09T10:01:00+00:00"},
                                           {"state": "unavailable", "last_changed": "2026-10-09T10:04:00+00:00"}]}
    pack = _pack()
    pack.asleep_are(["binary_sensor.door"])
    got = asleep.awake_states(Cli(), pack, {"binary_sensor.door": {"state": "unavailable"},
                                            "sensor.tank": {"state": "unavailable"}}, NOW)
    assert got["binary_sensor.door"] == {"state": "off", "last_changed": "2026-10-09T10:01:00+00:00", "asleep": True}
    assert got["sensor.tank"] == {"state": "unavailable"}                       # not listed: as it reads


def test_the_ai_reads_a_sleeping_device_marked_so():
    text = json.dumps({"data": {"entity_id": "binary_sensor.door", "state": "unavailable"}})
    got = json.loads(with_asleep(text, {"binary_sensor.door"}.__contains__))
    assert "Unavailable by design" in got["data"]["unavailable_by_design"]
    other = json.dumps({"entity_id": "lock.x", "state": "unavailable"})
    assert with_asleep(other, {"binary_sensor.door"}.__contains__) == other


def test_an_open_offline_fault_of_a_device_listed_since_closes(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import recheck
    from vesta_shared.store import Store
    store = Store(str(tmp_path / "s.sqlite"))
    fid, _ = store.raise_finding("PM-UNAVAILABLE", "binary_sensor.door", "availability", "2026-10-09", "P3",
                                 "Door has been offline for 2h.", {"entities": ["binary_sensor.door"]})
    pack = _pack()
    pack.asleep_are(["binary_sensor.door"])

    class Cli:
        def states(self, ids):
            return {"binary_sensor.door": {"state": "unavailable", "last_changed": NOW.isoformat()}}

        def not_found(self, ids):
            return set()
    res = recheck.back_online(store, lambda: Cli(), NOW, 5, "UTC", pack)
    assert res["closed"] == [fid]


def test_the_alert_desk_judges_a_sleeping_door_by_its_last_report_never_by_unavailable(monkeypatch):
    # a door alert ("open"), the door asleep: the rule's claim rendered on "unavailable" says false — never "it is over"
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "alert-desk", "scripts"))
    import desk
    pack = _pack()
    pack.asleep_are(["binary_sensor.door"])
    monkeypatch.setitem(desk._PACK, "pack", pack)

    def cli(last):
        class Cli(HABase):
            def states(self, ids):
                return {"binary_sensor.door": {"state": "unavailable", "attributes": {"friendly_name": "Door"}}}

            def history(self, ids, start, end):
                return {"binary_sensor.door": [{"state": last, "last_changed": "2026-10-09T10:01:00+00:00"},
                                               {"state": "unavailable", "last_changed": "2026-10-09T10:04:00+00:00"}]}

            def template(self, text):
                return "false"
        return Cli()
    inc = {"entity_id": "binary_sensor.door", "payload": json.dumps(
        {"claim": "{{ is_state('binary_sensor.door', 'on') }}", "entities": ["binary_sensor.door"], "state": "on"})}
    assert desk.still_there(inc, cli("on")) == (True, ["Door still reads on"])
    assert desk.still_there(inc, cli("off")) == (False, [])


def test_the_retired_own_list_is_no_misspelt_section():
    # owner, 2026-10-21: "Unknown section 'asleep_entities': a misspelt name is ignored" in red on the Rules page
    from vesta_agent.ui.changes import rules_problems
    assert not [p for p in rules_problems("asleep_entities: [binary_sensor.door]\n") if "asleep_entities" in p]
    assert [p for p in rules_problems("aslep_entities: []\n") if "aslep_entities" in p]          # a real slip still is


def _night_of_a_sleeping_door(tmp, listed):
    """The night check (nightly.py, as the engine runs it) over one door sensor whose battery reads "unavailable" now,
    asleep; its last real charge, 6 %, an hour before. `listed`: the Kiosk lists the door as asleep."""
    import subprocess
    import sys
    from helpers import PYTHONPATH
    fx = tmp / "fx"
    fx.mkdir(parents=True, exist_ok=True)
    (fx / "states.json").write_text(json.dumps({"states": {"sensor.door_battery": {
        "state": "unavailable", "attributes": {"friendly_name": "Door Battery", "unit_of_measurement": "%"},
        "last_changed": "2026-10-03T23:00:00+00:00"}}}))
    (fx / "history_raw_door.json").write_text(json.dumps({"entities": [{"entity_id": "sensor.door_battery", "states": [
        {"state": "6", "last_changed": "2026-10-03T22:00:00+00:00"},
        {"state": "unavailable", "last_changed": "2026-10-03T23:00:00+00:00"}]}]}))
    pack = KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None, families={"battery": [
        {"entity_id": "sensor.door_battery", "name": "Door Battery", "device_id": "door", "asset": "door",
         "family": "battery", "platform": "tuya_local", "unit": "%"}]},
        assets={}, areas=[], people=[], channels={}, unknown_area=[], unclassified=[], retention={},
        devices={"door": {"name": "Laundry Door"}},
        entity_devices={"binary_sensor.door": "door", "sensor.door_battery": "door"})
    path = str(tmp / "pack.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(pack.to_json())
    asleep.save(path, ["binary_sensor.door"] if listed else [])
    r = subprocess.run([sys.executable, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "nightly.py"),
                        "--pack", path, "--store", str(tmp / "s.sqlite"), "--fixture-dir", str(fx), "--skip-raw",
                        "--as-of", "2026-10-03", "--out", str(tmp / "res.json")],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH})
    assert r.returncode == 0, r.stderr
    from vesta_shared.store import Store
    return {f["rule_id"] for f in Store(str(tmp / "s.sqlite")).findings("open")}


def test_a_sleeping_door_sensor_s_battery_is_judged_on_its_last_real_charge(tmp_path):
    # architecture review, 2026-10-21: asleep at 02:00 every night, its battery read "unavailable" and was never judged
    assert "PM-BATTERY-CRIT" in _night_of_a_sleeping_door(tmp_path / "a", listed=True)
    # not listed: "unavailable" is what it reads (an offline device, not a charge)
    assert "PM-BATTERY-CRIT" not in _night_of_a_sleeping_door(tmp_path / "b", listed=False)


def test_an_open_offline_fault_of_a_device_hidden_since_closes_saying_so(tmp_path, monkeypatch):
    # architecture review, 2026-10-21: hidden, it stayed until 02:00, then closed "Cleared" while still off
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import recheck
    from vesta_shared.store import Store
    store = Store(str(tmp_path / "s.sqlite"))
    fid, _ = store.raise_finding("PM-UNAVAILABLE", "switch.old_plug", "availability", "2026-10-09", "P3",
                                 "Old Plug has been offline for 2h.", {"entities": ["switch.old_plug"]})
    keep, _ = store.raise_finding("PM-UNAVAILABLE", "switch.spa_relay", "availability", "2026-10-09", "P3",
                                  "Spa Relay has been offline for 2h.", {"entities": ["switch.spa_relay"]})
    pack = _pack(hidden=["switch.old_plug"])

    class Cli:
        def states(self, ids):
            return {e: {"state": "unavailable", "last_changed": NOW.isoformat()} for e in ids}

        def not_found(self, ids):
            return set()
    res = recheck.back_online(store, lambda: Cli(), NOW, 5, "UTC", pack)
    assert res["closed"] == [fid]                                     # the one watched and still off stays open
    assert recheck.HIDDEN_NOTE.startswith("Closed: this device is hidden")
    assert [f["id"] for f in store.findings("open")] == [keep]


def test_the_weekly_report_reads_a_sleeping_device_s_last_real_charge(monkeypatch):
    # its battery table: a door sensor asleep when the report is made still has its line
    import importlib.util
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "reports", "scripts"))
    from types import SimpleNamespace
    spec = importlib.util.spec_from_file_location("facts", os.path.join(STARTER_SKILLS, "reports", "scripts", "facts.py"))
    facts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(facts)
    pack = _pack()
    pack.asleep_are(["sensor.lone_battery"])

    class Cli(HABase):
        def states(self, ids):
            return {"sensor.lone_battery": {"state": "unavailable", "last_changed": NOW.isoformat()}}

        def history(self, ids, start, end):
            return {"sensor.lone_battery": [{"state": "41", "last_changed": "2026-10-09T09:00:00+00:00"},
                                            {"state": "unavailable", "last_changed": NOW.isoformat()}]}
    c = SimpleNamespace(_states=None, cfg={}, pack=pack, cli=Cli(), now=NOW)
    assert facts.Ctx.states(c)["sensor.lone_battery"]["state"] == "41"


def test_an_investigation_never_calls_a_sensor_with_no_value_silent(monkeypatch):
    # a wind chill with nothing to give for 6 hours on a still afternoon: shown, never "it stops reporting"
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "investigate", "scripts"))
    import investigate
    t = datetime(2026, 10, 9, 13, tzinfo=timezone.utc)
    p = {"kind": "no value", "start": t, "end": t + timedelta(hours=6), "seconds": 6 * 3600.0}
    (got,) = investigate._notable([p], {}, None)
    assert "why" not in got and "alert" not in got
    (got,) = investigate._notable([{**p, "kind": "offline"}], {}, None)
    assert "stopped reporting" in got["why"]


# --- one rule over a past window: its last report holds (asleep.held_window, architecture review 2026-10-22) ---------
DOOR_NOW = datetime(2026, 10, 9, 15, 0, tzinfo=timezone.utc)


def _door_villa(**kw):
    """A door contact asleep between its reports: opened at 13:00, asleep a minute later, nothing since."""
    from villa_timeline import TimelineVilla

    class Villa(TimelineVilla):
        def tool(self, name, args):
            if name == "ha_search":
                return {"entities": [{"entity_id": "binary_sensor.door"}]}
            if name == "ha_get_entity":
                return {"entity_entries": [{"entity_id": "binary_sensor.door", "area": "Hall"}]}
            return {}
    return Villa(now=DOOR_NOW, names={"binary_sensor.door": "Door"},
                 **{"binary_sensor.door": [(DOOR_NOW - timedelta(hours=2), "on"),
                                           (DOOR_NOW - timedelta(hours=2) + timedelta(minutes=1), "unavailable")]}, **kw)


def _investigate(monkeypatch):
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "investigate", "scripts"))
    import investigate
    pack = _pack()
    pack.asleep_are(["binary_sensor.door"])
    return investigate, pack


def test_an_investigation_of_an_hour_a_door_slept_through_reads_its_last_report(monkeypatch):
    # it said "binary_sensor.door: nothing recorded in this period": the hour opened "unavailable", and that row dropped
    investigate, pack = _investigate(monkeypatch)
    lines = investigate.timeline(_door_villa(), ["binary_sensor.door"], DOOR_NOW - timedelta(hours=1), DOOR_NOW, 0,
                                 timezone.utc, now=DOOR_NOW, pack=pack)["lines"]
    said = "\n".join(lines)
    assert "nothing recorded" not in said and said.startswith("binary_sensor.door: 1 readings"), said
    assert "on" in said.split("\n", 1)[1], said


def test_find_says_what_a_sleeping_door_last_reported_never_unavailable(monkeypatch):
    investigate, pack = _investigate(monkeypatch)
    (line,) = investigate.find(_door_villa(), "door", None, pack, now=DOOR_NOW)["lines"]
    assert line == "Door (binary_sensor.door), Hall, now on (its last report: it sleeps between its reports)", line
    (line,) = investigate.find(_door_villa(), "door", None, None, now=DOOR_NOW)["lines"]         # not listed: what it reads
    assert line.endswith("now unavailable"), line


def test_the_held_window_is_the_one_rule_and_no_reader_drops_sleep_rows_itself():
    # the deletion test: the alert desk and the investigation each filtered "unavailable" rows by hand (without_sleep,
    # an inline filter in out_since); both read asleep.held_window now, and the hand-made filters are gone
    import inspect
    from vesta_shared import device_state
    assert not hasattr(asleep, "without_sleep")
    src = inspect.getsource(device_state.out_since)
    assert "held_window(" in src and '.get("asleep")' not in src
    inv = open(os.path.join(STARTER_SKILLS, "investigate", "scripts", "investigate.py"), encoding="utf-8").read()
    assert "without_sleep" not in inv and inv.count("asleep.held_window(") == 1


# --- nothing real within the days read: said, never "unavailable" again (architecture review 2026-10-22) -------------
def _quiet_battery(detailed_days=None, charge="6"):
    """A door sensor's battery asleep: its last real charge 9 days ago, "unavailable" since."""
    from villa_timeline import TimelineVilla
    v = TimelineVilla(now=DOOR_NOW, **{"sensor.lone_battery": [(DOOR_NOW - timedelta(days=9), charge),
                                                               (DOOR_NOW - timedelta(days=9, minutes=-1), "unavailable")]})
    v.detailed_days = detailed_days
    return v


def test_a_device_asleep_with_no_report_in_the_days_read_stays_asleep_and_says_so():
    pack = _pack()
    pack.asleep_are(["sensor.lone_battery"])
    row = asleep.read_states(_quiet_battery(detailed_days=10), pack, DOOR_NOW, ["sensor.lone_battery"])["sensor.lone_battery"]
    assert row["asleep"] is True and row["state"] == "unavailable"                  # never its 9-day-old state now
    assert row["last_known"]["state"] == "6" and asleep.last_value(row) == "6"     # read within the history kept
    assert asleep.unheard(row, DOOR_NOW) == "no report for 9d (it sleeps between its reports)"
    assert pack.standing("sensor.lone_battery", row["state"]) == "asleep"         # never counted offline
    # the history kept ends before it: no known charge, and still said
    row = asleep.read_states(_quiet_battery(), pack, DOOR_NOW, ["sensor.lone_battery"])["sensor.lone_battery"]
    assert row["asleep"] is True and row["last_known"] is None and asleep.last_value(row) is None
    assert asleep.unheard(row, DOOR_NOW) == "no report for more than 7d (it sleeps between its reports)"


def test_the_weekly_report_and_the_night_check_say_a_battery_with_no_report_in_days(monkeypatch, tmp_path):
    import importlib.util
    from types import SimpleNamespace
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "reports", "scripts"))
    spec = importlib.util.spec_from_file_location("facts", os.path.join(STARTER_SKILLS, "reports", "scripts", "facts.py"))
    facts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(facts)
    from vesta_shared.params import VillaParams
    pack = _pack()
    pack.asleep_are(["sensor.lone_battery"])

    def page(cli):
        c = SimpleNamespace(_states=None, cfg={}, pack=pack, cli=cli, now=DOOR_NOW,
                            store=SimpleNamespace(cache_get=lambda k: None, findings=lambda status=None: []),
                            need=lambda *p: 8, tasks=lambda: [], params=lambda: VillaParams())
        c.states = lambda: facts.Ctx.states(c)
        return facts.s_batteries(c)
    (row,) = page(_quiet_battery(detailed_days=10))["rows"]
    assert row["pct"] == 6 and row["unheard"] == "no report for 9d (it sleeps between its reports)"
    got = page(_quiet_battery())
    assert got["rows"][0]["pct"] is None and got["rows"][0]["unheard"].startswith("no report for more than 7d")
    assert got["status"] == "Watch"
    # the night check: judged on its last known charge, and a note says it
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import nightly
    states = asleep.read_states(_quiet_battery(detailed_days=10), pack, DOOR_NOW, ["sensor.lone_battery"])
    from vesta_shared.skill_settings import load
    params = VillaParams(defaults=load(os.path.join(STARTER_SKILLS, "preventive-maintenance"), "settings.yaml")["behaviour"])
    found = nightly.battery_findings(pack, states, params, DOOR_NOW.date(), rows=[{**r, "unit": "%"} for r in pack.entities("battery")])
    assert [f.rule_id for f in found] == ["PM-BATTERY-CRIT"]
    assert nightly.unheard_notes(pack, states, DOOR_NOW) == [
        "Lone Battery: no report for 9d (it sleeps between its reports)."]


def test_a_read_stopped_short_cannot_tell_what_a_sleeping_device_last_said():
    # read through history_read (vesta_shared.past): a reading cut before now may have missed its last report
    v = _quiet_battery(detailed_days=10)
    v.timeline["sensor.lone_battery"] += [(DOOR_NOW - timedelta(days=2), "40"), (DOOR_NOW - timedelta(days=1), "39")]
    assert asleep.last_real(v, ["sensor.lone_battery"], DOOR_NOW)["sensor.lone_battery"]["state"] == "39"
    v.cut = {"sensor.lone_battery": DOOR_NOW - timedelta(days=1, hours=12)}
    assert asleep.last_real(v, ["sensor.lone_battery"], DOOR_NOW) == {}


def test_the_alert_desk_says_a_door_with_no_report_in_days_never_that_it_does_not_answer(monkeypatch):
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "alert-desk", "scripts"))
    import desk
    from villa_timeline import TimelineVilla
    pack = _pack()
    pack.asleep_are(["binary_sensor.door"])
    monkeypatch.setitem(desk._PACK, "pack", pack)
    v = TimelineVilla(now=DOOR_NOW, names={"binary_sensor.door": "Door"},
                      **{"binary_sensor.door": [(DOOR_NOW - timedelta(days=9), "on"),
                                                (DOOR_NOW - timedelta(days=9, minutes=-1), "unavailable")]})
    inc = {"entity_id": "binary_sensor.door", "payload": json.dumps({"entities": ["binary_sensor.door"], "state": "on"})}
    assert desk.still_there(inc, v, DOOR_NOW) == (
        None, ["Door: no report for more than 7d (it sleeps between its reports)"])
