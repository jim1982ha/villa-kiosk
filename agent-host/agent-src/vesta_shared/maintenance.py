"""The villa's maintenance mode: the VESTA Kiosk's switch (Advanced Settings › System), read by the agent (owner,
2026-10-29: "Put it on the tablet, for the Owner only … a small 'Maintenance' mark in the top bar, so nobody forgets it").

While it is on the alert desk takes up only urgent (P1) alerts; any other new one is recorded in the audit and not
taken up (no number, no chase, no fault). ⚠️ THE KIOSK'S SWITCH, NOT A VILLA HELPER: the desk read a helper of the
villa's system before (params "maintenance_mode") that no screen showed — nobody could see or reach it. The Kiosk now
hands it over in its answer to every heartbeat (agent-contract.json `heartbeat.answer.maintenance`), as it hands the
devices asleep by design (vesta_shared.asleep); the agent writes what it was last told beside its knowledge pack, kept
while the Kiosk does not answer, and the desk reads it from there. Never told (no Kiosk, an older Kiosk): off.
"""
from __future__ import annotations

import json
import os

from .asleep import path_beside

#: the Kiosk's switch as the agent was last told it, beside the knowledge pack (VESTA_PACK's folder)
FILE = "maintenance_mode.json"


def _path(pack_path: str | None) -> str | None:
    beside = path_beside(pack_path)
    return os.path.join(os.path.dirname(beside), FILE) if beside else None


def on(pack_path: str | None = None) -> bool:
    """Whether the Kiosk last said maintenance mode is on; off when it never said or the file cannot be read."""
    try:
        with open(_path(pack_path) or "", encoding="utf-8") as f:
            return (json.load(f) or {}).get("on") is True
    except (OSError, ValueError, AttributeError):
        return False


def told(answer: dict) -> bool | None:
    """The switch in the Kiosk's heartbeat answer; None when the answer has none (a Kiosk older than the switch): what
    was kept stays."""
    v = (answer or {}).get("maintenance")
    return v if isinstance(v, bool) else None


def save(pack_path: str, value: bool) -> bool:
    """Keep `value` as the switch (beside the pack at `pack_path`); True when it changed."""
    path = _path(pack_path)
    if path is None or (os.path.exists(path) and on(pack_path) == value):
        return False
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"on": value}, f)
    os.replace(tmp, path)
    return True
