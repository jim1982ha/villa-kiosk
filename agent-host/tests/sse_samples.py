"""Streams as HA MCP sends them (text/event-stream), with the JSON each one carries last: ONE set of samples run
against both readers — the host's self-test (vesta_host/selftest.py) and the agent's client
(vesta_shared/ha_client.py). The host must not import the agent's code, so the readers stay two; the samples keep
them reading the same way (architecture review 7: the self-test still split lines on Unicode separators, which the
agent's reader had stopped doing — a tool description holding U+2028 would have read "no tools listed").
"""
import json

_TOOLS = {"jsonrpc": "2.0", "id": 2, "result": {"tools": [
    {"name": "ha_get_state", "description": "Read one entity. Returns its state and attributes."}]}}
_MULTI = {"jsonrpc": "2.0", "id": 3, "result": {"text": "line one\nline two"}}

SAMPLES = [
    ("event: message\ndata: " + json.dumps(_TOOLS, ensure_ascii=False) + "\n\n", _TOOLS),           # U+2028 / U+2029 inside
    ("event: message\r\ndata: " + json.dumps(_TOOLS, ensure_ascii=False) + "\r\n\r\n", _TOOLS),     # CR LF lines
    ("data: " + json.dumps(_MULTI).replace(', "id"', '\ndata: , "id"', 1) + "\n\n", _MULTI),   # one event, two data lines
    (": ping\n\nevent: message\ndata: {\"jsonrpc\": \"2.0\", \"id\": 1, \"result\": {}}\n\n"
     "data: " + json.dumps(_TOOLS) + "\n\n", _TOOLS),                                                 # the last event counts
]
