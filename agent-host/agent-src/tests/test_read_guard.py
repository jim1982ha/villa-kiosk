"""What a read of the villa's system may ask (vesta_shared/read_guard.py): one table of refused and allowed calls, run
through BOTH doors — the AI's own reads (tools.Toolbox) and every skill script's client (ha_client.McpClient).

Architecture review, 2026-10-17: the two doors kept their own lists; the AI's calls never met READ_ACTIONS, and the
"6 hours of the whole villa's logbook" was written twice.
"""
from __future__ import annotations

import asyncio

import pytest

from ha_fake import FakeHA, tool
from vesta_shared.ha_client import HAError, McpClient
from vesta_shared.read_guard import LOGBOOK_SLICE, LOGBOOK_VILLA_HOURS, refused

LOGS = dict(source="string", hours_back="number", entity_id="string", end_time="string", slug="string")
#: (tool, arguments, a word of why it is refused — None: allowed)
CASES = [
    ("ha_get_logs", {"source": "logbook", "hours_back": 168}, "6 hours at a time"),
    ("ha_get_logs", {"hours_back": 7}, "6 hours at a time"),                     # the logbook is the default source
    ("ha_get_logs", {"source": "logbook", "hours_back": LOGBOOK_VILLA_HOURS}, None),
    ("ha_get_logs", {"source": "logbook", "hours_back": 168, "entity_id": "sensor.a"}, None),   # one device
    ("ha_get_logs", {"source": "system"}, None),
    ("ha_get_logs", {"source": "supervisor"}, "must be one of"),                 # another app's log
    ("ha_get_logs", {"source": "system", "slug": "core_ssh"}, "Argument not allowed"),
    ("ha_manage_energy_prefs", {"mode": "get"}, None),
    ("ha_manage_energy_prefs", {"mode": "set"}, "only its get mode"),
    ("ha_manage_energy_prefs", {}, "only its get mode"),
    ("ha_manage_blueprints", {"action": "get"}, None),
    ("ha_manage_blueprints", {"action": "import"}, "only its get action"),
]


def test_the_one_table():
    for name, args, word in CASES:
        why = refused(name, args)
        assert (why is None) if word is None else (word in (why or "")), (name, args, why)
    # the arguments a tool declares: anything else is refused (the AI's calls)
    assert "Argument not allowed for ha_get_state: x" in refused("ha_get_state", {"x": 1}, known={"entity_id"})
    assert refused("ha_get_state", {"entity_id": "a"}, known={"entity_id"}) is None
    # the refusal names no skill script: the engine knows none (skills before code)
    assert "investigate" not in refused("ha_get_logs", {"hours_back": 168}) and "script" not in \
        refused("ha_get_logs", {"hours_back": 168})
    # a script's client reads the whole villa's logbook by slices the guard lets through
    assert LOGBOOK_SLICE.total_seconds() / 3600 == LOGBOOK_VILLA_HOURS


class Session:
    def __init__(self):
        self.calls = []

    def call_raw(self, name, args):
        self.calls.append((name, args))
        return {"content": [{"type": "text", "text": "{}"}]}

    def ensure(self):
        pass


@pytest.mark.parametrize("name,args,word", CASES)
def test_a_skill_scripts_client(name, args, word):
    s = Session()
    c = McpClient(url="http://x", zone="UTC", session=s)
    if word is None:
        c.tool(name, args)
        assert s.calls == [(name, args)]
    else:
        with pytest.raises(HAError, match=word):
            c.tool(name, args)
        assert s.calls == []


def test_the_ais_own_reads(tmp_path):
    from helpers import make_agent
    from vesta_agent.routing import CONVERSATION, Origin
    names = sorted({n for n, _, _ in CASES})
    ha = FakeHA(tools=[tool(n, **(LOGS if n == "ha_get_logs" else {"mode": "string", "action": "string"}))
                       for n in names])
    v = make_agent(tmp_path, {"people": [{"telegram_id": 111, "name": "Owner", "role": "owner"}], "chats": {"owner": -1},
                              "ha_read_tools": names}, reader=ha)
    asyncio.run(v.refresh_server_tools())
    tools = {t.name: t for t in v.toolbox().tool_objects(None, Origin(-1, CONVERSATION))}
    assert set(names) <= set(tools), sorted(tools)
    for name, args, word in CASES:
        before = len(ha.calls)
        out = asyncio.run(tools[name].handler(dict(args)))
        if word is None:
            assert not out.get("is_error") and len(ha.calls) == before + 1, (name, args, out)
        else:
            assert out.get("is_error") and word in out["content"][0]["text"] and len(ha.calls) == before, (name, args)
    # an argument the tool does not declare: refused at the AI's door (a script's client sends only its own)
    before = len(ha.calls)
    out = asyncio.run(tools["ha_get_logs"].handler({"source": "system", "bogus": 1}))
    assert out.get("is_error") and "Argument not allowed for ha_get_logs: bogus" in out["content"][0]["text"]
    assert len(ha.calls) == before
