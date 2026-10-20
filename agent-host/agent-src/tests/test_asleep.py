"""Devices unavailable by design (Rules › Protected devices, owner 2026-10-21): a battery device asleep between its
reports. One list (policy.yaml's asleep_entities), one predicate (KnowledgePack.is_asleep, a listed entity standing for
its whole physical device), read by every check that judges "unavailable" (vesta_shared.asleep)."""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

from helpers import STARTER_SKILLS
from test_offline import NOW, STATES, _pack
from vesta_agent.policy import FIELDS, Policy
from vesta_agent.tools import with_asleep
from vesta_shared import asleep
from vesta_shared.offline import devices_offline


def _policy(tmp_path, ids):
    p = tmp_path / "policy.yaml"
    p.write_text("asleep_entities: [" + ", ".join(ids) + "]\n")
    return str(p)


def test_the_list_is_read_from_the_policy_and_named_on_the_page(tmp_path):
    assert Policy.load(_policy(tmp_path, ["binary_sensor.door"])).asleep == {"binary_sensor.door"}
    assert asleep.listed(_policy(tmp_path, ["Binary_Sensor.Door"])) == {"binary_sensor.door"}
    assert asleep.listed(str(tmp_path / "none.yaml")) == frozenset()
    assert FIELDS["asleep_entities"][0] == "Unavailable by design"


def test_a_device_listed_is_never_offline_and_its_other_entities_sleep_with_it(tmp_path, monkeypatch):
    monkeypatch.setenv("VESTA_POLICY", _policy(tmp_path, ["switch.spa_relay"]))
    names = [g.name for g in devices_offline(_pack(), STATES, NOW, ["power", "switch", "battery"])]
    # the relay's plug (its power sensors are on the same device) is asleep; the lone battery still counts
    assert names == ["Lone Battery"]
    monkeypatch.setenv("VESTA_POLICY", "")
    assert "Spa Plug" in [g.name for g in devices_offline(_pack(), STATES, NOW, ["power", "switch", "battery"])]


def test_the_last_real_state_stands_in_for_unavailable():
    class Cli:
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
    t = datetime(2026, 10, 9, tzinfo=timezone.utc)
    assert asleep.without_sleep([(t, "on"), (t + timedelta(minutes=3), "unavailable"), (t + timedelta(hours=1), "off")]) \
        == [(t, "on"), (t + timedelta(hours=1), "off")]


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
                                 "Door has been offline for 2 h.", {"entities": ["binary_sensor.door"]})
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
        class Cli:
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
