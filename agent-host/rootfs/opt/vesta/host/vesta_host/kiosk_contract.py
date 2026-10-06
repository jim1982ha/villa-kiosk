"""The agreement with the VESTA Kiosk (its /agent/v1 interface), as data.

A COPY of the Kiosk's rootfs/usr/share/vesta/agent-contract.json, kept at
/opt/vesta/host/agent-contract.json. tests/test_kiosk_contract.py fails the
moment the two differ (CI reads the Kiosk's file from its dev2 branch), so the
self-test and the test stand-in for the Kiosk speak the version the Kiosk
actually enforces — they used to type it from memory (`contract != "1"`).
"""
from __future__ import annotations

import json
from pathlib import Path

FILE = Path(__file__).resolve().parent.parent / "agent-contract.json"
TABLE: dict = json.loads(FILE.read_text())
VERSION: int = int(TABLE["version"])
