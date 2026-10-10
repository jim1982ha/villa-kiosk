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
    assert msg is None and "without approval" in answer and "Done" in answer
    assert session.calls == [{"domain": "light", "service": "turn_on", "wait": True, "entity_id": "light.example_pool"}]


def test_direct_still_asks_for_a_job_or_an_alert_and_for_an_owner_only_device(villa):
    actions, session = villa
    _, msg = actions.request("light", "turn_on", "light.example_pool", {}, None, 111)       # no person: a job
    assert msg is not None
    stranger = Person(999, "Stranger", "fm", "en")                                          # not in policy.yaml
    _, msg = actions.request("light", "turn_on", "light.example_pool", {}, stranger, 111)
    assert msg is not None
    _, msg = actions.request("light", "turn_on", "light.example_gate_lamp", {}, JM, 111)    # owner-only
    assert msg is not None and "approval by the owner (" in msg.text
    _, msg = actions.request("light", "turn_on", "light.example_group", {}, JM, 111)        # owner-only inside
    assert msg is not None and "approval by the owner (" in msg.text
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
    assert msg is not None and "approval by the owner (" in msg.text and session.calls == []
