"""The agreement with the VESTA Kiosk (its /agent/v1 interface), as data.

A COPY of the Kiosk's rootfs/usr/share/vesta/agent-contract.json, kept at
/opt/vesta/host/agent-contract.json. tests/test_kiosk_contract.py fails the
moment the two differ (CI reads the Kiosk's file from its dev2 branch), so the
self-test, the stub and the test stand-in for the Kiosk all speak the version
and message rules the Kiosk actually enforces — they used to type them from
memory (`contract != "1"`, `if not title or not buttons`).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

FILE = Path(__file__).resolve().parent.parent / "agent-contract.json"
TABLE: dict = json.loads(FILE.read_text())
VERSION: int = int(TABLE["version"])
_MSG: dict = TABLE["message"]
_LIM: dict = _MSG["limits"]
_BUTTON_ID = re.compile(_MSG["buttonIdPattern"])
_ENTITY = re.compile(_MSG["entityPattern"])


def message_problem(msg: object) -> str | None:
    """Why the Kiosk would refuse this message (HTTP 400), or None. The same
    rules as its proxy's _agent_validate_message, from the same file."""
    if not isinstance(msg, dict):
        return "body must be a JSON object"
    if msg.get("kind", "message") not in _MSG["kinds"]:
        return f"kind must be one of {', '.join(_MSG['kinds'])}"
    title = msg.get("title")
    if not isinstance(title, str) or not title.strip() or len(title) > _LIM["title"]:
        return f"title must be a non-empty string of at most {_LIM['title']} characters"
    body = msg.get("body", "")
    if not isinstance(body, str) or len(body) > _LIM["body"]:
        return f"body must be a string of at most {_LIM['body']} characters"
    if msg.get("severity", "info") not in _MSG["severities"]:
        return f"severity must be one of {', '.join(_MSG['severities'])}"
    entities = msg.get("entities", [])
    if not isinstance(entities, list) or len(entities) > _LIM["entities"] or not all(
            isinstance(e, str) and _ENTITY.fullmatch(e) for e in entities):
        return f"entities must be a list of at most {_LIM['entities']} entity ids"
    buttons = msg.get("buttons", [])
    if not isinstance(buttons, list) or len(buttons) > _LIM["buttons"]:
        return f"buttons must be a list of at most {_LIM['buttons']}"
    seen: set[str] = set()
    for b in buttons:
        if not isinstance(b, dict) or not isinstance(b.get("id"), str) or not _BUTTON_ID.fullmatch(b["id"]) \
                or b["id"] in seen or not isinstance(b.get("label"), str) or not b["label"].strip() \
                or len(b["label"]) > _LIM["buttonLabel"]:
            return "each button needs a unique id and a label"
        seen.add(b["id"])
    return None
