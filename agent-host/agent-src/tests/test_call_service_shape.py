"""An approved action, as ha-mcp itself would receive it.

⚠️ THE FIRST APPROVED ACTION ON THE VILLA FAILED: the executor sent `entity_id`
as a list and ha-mcp 8.5.0 takes one string ("Input should be a valid string").
Every earlier test used a fake writer that accepted any shape. Here the call goes
through the real path (Actions.execute -> McpClient.call_service) and is checked
against ha-mcp's own input schema for ha_call_service, saved from the server the
image ships (fixtures/ha_mcp_ha_call_service.schema.json). The container test
fails when the server in the image stops matching that file."""
from __future__ import annotations

import json
import os

import jsonschema
import pytest

from vesta_agent.actions import Actions
from vesta_agent.policy import Decision
from vesta_agent.state import State
from vesta_shared.ha_client import McpClient

SCHEMA = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "ha_mcp_ha_call_service.schema.json")))


class StrictSession:
    """ha-mcp's tools/call as far as its arguments go: refused unless they match its schema."""

    def __init__(self):
        self.calls: list[dict] = []

    def call_raw(self, name, args):
        assert name == "ha_call_service"
        try:
            jsonschema.validate(args, SCHEMA)
        except jsonschema.ValidationError as e:
            return {"isError": True, "content": [{"type": "text", "text": f"Invalid arguments: {e.message}"}]}
        self.calls.append(args)
        return {"content": [{"type": "text", "text": json.dumps({"success": True})}]}


class Writer(McpClient):
    def states(self, entity_ids=None):
        return {e: {"state": "on"} for e in entity_ids or []}


@pytest.fixture
def run(tmp_path, monkeypatch):
    monkeypatch.delenv("VESTA_HA_READ_ONLY", raising=False)
    session = StrictSession()
    actions = Actions(lambda: None, State(str(tmp_path / "state.db")),
                      lambda: Writer("http://unused", "UTC", write=True, session=session))

    def go(entity_ids, data=None):
        return actions.execute(Decision(True, "test", "any", "light", "turn_on", entity_ids, data or {})), session.calls
    return go


def test_one_device_is_one_string_and_ha_mcp_waits_for_it(run):
    result, calls = run(["light.example_pool"])
    assert result["ok"], result
    assert calls == [{"domain": "light", "service": "turn_on", "wait": True, "entity_id": "light.example_pool"}]


def test_several_devices_go_as_home_assistants_own_list_in_data(run):
    result, calls = run(["light.example_a", "light.example_b"], {"brightness_pct": 40})
    assert result["ok"], result
    (args,) = calls
    assert "entity_id" not in args                                  # never "light.a,light.b"
    assert args["data"] == {"brightness_pct": 40, "entity_id": ["light.example_a", "light.example_b"]}


def test_a_refused_call_says_so_and_confirms_nothing(run, caplog):
    import vesta_shared.ha_client as hc
    orig = hc.McpClient.call_service
    hc.McpClient.call_service = lambda self, d, s, data: self.tool("ha_call_service", {"domain": d, "service": s,
                                                                                         "entity_id": ["x.y"]})
    try:
        result, calls = run(["light.example_pool"])
    finally:
        hc.McpClient.call_service = orig
    assert not result["ok"] and calls == []
    assert any("valid" in r.message and "light.turn_on" in r.message for r in caplog.records)   # the reason, in the app's log


# ---------------------------------------------------------------------- the `direct` rule
from vesta_agent.policy import Person, Policy  # noqa: E402

JM = Person(111, "Registered", "fm", "en")


@pytest.fixture
def villa(tmp_path, monkeypatch):
    monkeypatch.delenv("VESTA_HA_READ_ONLY", raising=False)
    session = StrictSession()
    pol = Policy({"act_enabled": True, "people": [{"telegram_id": 111, "name": "Registered", "role": "fm"}],
                  "chats": {"fm": 111, "owner": -100},
                  "owner_only_entities": ["light.example_gate_lamp"],
                  "allowed_services": {"light.turn_on": "direct", "cover.open_cover": "any"}})
    # a light group that holds the owner-only lamp (what _wrap_check looks behind)
    actions = Actions(lambda: pol, State(str(tmp_path / "state.db")),
                      lambda: Writer("http://unused", "UTC", write=True, session=session),
                      related=lambda ids: {"light.example_gate_lamp"} if "light.example_group" in ids else set())
    return actions, session


def test_direct_runs_at_once_when_a_registered_person_asks(villa):
    actions, session = villa
    answer, msg = actions.request("light", "turn_on", "light.example_pool", {}, JM, 111)
    assert msg is None and "without approval" in answer and "Result: Turned on " in answer      # as an approved one says it
    assert session.calls == [{"domain": "light", "service": "turn_on", "wait": True, "entity_id": "light.example_pool"}]


def test_direct_still_asks_for_a_job_or_an_alert_and_for_an_owner_only_device(villa):
    actions, session = villa
    _, msg = actions.request("light", "turn_on", "light.example_pool", {}, None, 111)       # no person: a job
    assert msg is not None
    stranger = Person(999, "Stranger", "fm", "en")                                          # not in policy.yaml
    _, msg = actions.request("light", "turn_on", "light.example_pool", {}, stranger, 111)
    assert msg is not None
    _, msg = actions.request("light", "turn_on", "light.example_gate_lamp", {}, JM, 111)    # owner-only
    assert msg is not None and "approval by the owner (" in msg.status
    _, msg = actions.request("light", "turn_on", "light.example_group", {}, JM, 111)        # owner-only inside
    assert msg is not None and "approval by the owner (" in msg.status
    _, msg = actions.request("cover", "open_cover", "cover.example_shutter", {}, JM, 111)    # rule `any`
    assert msg is not None
    assert session.calls == []                                                              # nothing ran


def test_a_lock_still_unlocking_is_read_again_not_reported_unconfirmed(tmp_path, monkeypatch):
    # architecture review 5: one read only for one device — a lock still "unlocking" read as "Not confirmed"
    monkeypatch.delenv("VESTA_HA_READ_ONLY", raising=False)
    import vesta_agent.actions as A
    monkeypatch.setattr(A.time, "sleep", lambda s: None)
    seen = iter(["unlocking", "unlocking", "unlocked"])

    class Slow(McpClient):
        def states(self, entity_ids=None):
            return {e: {"state": next(seen)} for e in entity_ids or []}
    actions = Actions(lambda: None, State(str(tmp_path / "state.db")),
                      lambda: Slow("http://unused", "UTC", write=True, session=StrictSession()))
    result = actions.execute(Decision(True, "test", "any", "lock", "unlock", ["lock.example_door"], {}))
    assert result["ok"] and "unlocked" in result["text"], result

    reads = []

    class Wrong(McpClient):
        def states(self, entity_ids=None):
            reads.append(1)
            return {e: {"state": "jammed"} for e in entity_ids or []}
    actions = Actions(lambda: None, State(str(tmp_path / "state2.db")),
                      lambda: Wrong("http://unused", "UTC", write=True, session=StrictSession()))
    result = actions.execute(Decision(True, "test", "any", "lock", "unlock", ["lock.example_door"], {}))
    assert not result["ok"] and len(reads) == 1                       # a final wrong state: said at once


def test_a_group_whose_members_cannot_be_read_asks_the_owner(villa, tmp_path, monkeypatch):
    # architecture review 17, 2026-10-10: a slow Home Assistant made a group look as if it held nothing, and a "direct"
    # rule switched an owner-only light on with no approval — what cannot be checked is the owner's to approve
    _, session = villa
    pol = Policy({"act_enabled": True, "people": [{"telegram_id": 111, "name": "Registered", "role": "fm"}],
                  "chats": {"fm": 111, "owner": -100}, "allowed_services": {"light.turn_on": "direct"}})
    blind = Actions(lambda: pol, State(str(tmp_path / "blind.db")),
                    lambda: Writer("http://unused", "UTC", write=True, session=session), related=lambda ids: None)
    answer, msg = blind.request("light", "turn_on", "light.example_group", {}, JM, 111)
    assert msg is not None and "approval by the owner (" in msg.status and session.calls == []


def test_what_an_action_touches_is_unknown_without_the_pack_or_for_an_id_it_never_saw(tmp_path):
    # architecture review 5 (2026-10-13): with no pack (its build failed at start) or a device added since 01:30, the
    # same-device check found nothing — a "direct" rule could switch the plug behind an owner-only siren, no Approve
    from vesta_agent.actions import related_entities
    from vesta_shared.knowledge_pack import build_pack

    class Reader:
        def states(self, ids):
            return {i: {"attributes": {}} for i in ids}
    pack = build_pack({"entities": [{"entity_id": "siren.example_siren", "device_id": "d1"},
                                    {"entity_id": "switch.example_siren_power", "device_id": "d1"}]}, [])
    assert related_entities(pack, Reader(), ["switch.example_siren_power"]) == {"siren.example_siren",
                                                                                 "switch.example_siren_power"}
    assert related_entities(None, Reader(), ["switch.example_siren_power"]) is None          # no pack: ask the owner
    assert related_entities(pack, Reader(), ["switch.example_new_plug"]) is None             # not in it yet: ask


def test_a_direct_rule_asks_the_owner_while_the_pack_is_missing(tmp_path):
    # the real wiring (app.Vesta → Actions → _wrap_check), not a stand-in `related`
    from helpers import known_devices, make_agent
    v = make_agent(tmp_path, {"act_enabled": True, "people": [{"telegram_id": 111, "name": "JM", "role": "fm"},
                                                             {"telegram_id": 222, "name": "Owner", "role": "owner"}],
                              "owner_only_entities": ["siren.example_siren"],
                              "allowed_services": {"switch.turn_off": "direct"}})
    _, msg = v.actions.request("switch", "turn_off", "switch.example_siren_power", {}, v.policy().person(111), 111)
    assert msg is not None and msg.to == "owner" and msg.chats == [222]                      # asked, never done
    known_devices(v, "switch.example_lamp")
    answer, msg = v.actions.request("switch", "turn_off", "switch.example_lamp", {}, v.policy().person(111), 111)
    assert msg is None and "without approval" in answer                                       # known: direct as before


def test_an_owner_only_device_the_pack_cannot_classify_is_still_found_behind_its_plug(tmp_path):
    # 2026-10-13: an entity in no family kept no device in the pack — a siren whose id does not say "siren" was invisible
    from vesta_agent.actions import related_entities
    from vesta_shared.knowledge_pack import build_pack

    class Reader:
        def states(self, ids):
            return {i: {"attributes": {}} for i in ids}
    pack = build_pack({"entities": [{"entity_id": "siren.example_outdoor_alarm", "device_id": "d1"},
                                    {"entity_id": "switch.example_alarm_power", "device_id": "d1"}]}, [])
    assert "siren.example_outdoor_alarm" in pack.unclassified                              # in no family
    assert related_entities(pack, Reader(), ["switch.example_alarm_power"]) == {"siren.example_outdoor_alarm",
                                                                                 "switch.example_alarm_power"}


def test_a_refusal_by_the_villas_rules_is_in_the_log(villa, caplog):
    # owner, 2026-10-18: "turn off the TV" — the TV was refused, then its screen switch asked; the log showed only the
    # second, so the refusal looked like a request never made
    actions, session = villa
    with caplog.at_level("INFO", logger="vesta.actions"):
        answer, msg = actions.request("media_player", "turn_off", "media_player.example_tv", {}, JM, 111)
    assert msg is None and answer.startswith("Refused by the agent's rules") and session.calls == []
    line = [r.getMessage() for r in caplog.records if r.getMessage().startswith("Refused ")]
    assert line == ["Refused media_player.turn_off on media_player.example_tv, asked by Registered: "
                    "media_player.turn_off is not in the allowed services of this villa."], line


def test_where_an_action_stands_is_one_answer_for_both_paths():
    # architecture review scan 3, 2026-10-19 (actions.outcome): a light that reads "off" after "Turn on" did not turn
    # on — never "on its way"; a curtain reading "closed" just after "Open" is on its way; a lock reading "unlocking"
    from vesta_agent.actions import outcome
    from vesta_agent.policy import Decision
    d = lambda domain, service: Decision(True, "", domain=domain, service=service, entity_ids=[f"{domain}.x"], data={})
    assert outcome(d("light", "turn_on"), {"ok": False, "unconfirmed": [("Lamp", "off")]}) == "failed"
    assert outcome(d("cover", "open_cover"), {"ok": False, "unconfirmed": [("Curtain", "closed")]}) == "moving"
    assert outcome(d("lock", "lock"), {"ok": False, "unconfirmed": [("Door", "locking")]}) == "moving"
    assert outcome(d("lock", "lock"), {"ok": False, "unconfirmed": [("Door", "jammed")]}) == "failed"
    assert outcome(d("light", "turn_on"), {"ok": True}) == "done"
    assert outcome(d("light", "turn_on"), {"ok": False, "failed": True}) == "failed"
