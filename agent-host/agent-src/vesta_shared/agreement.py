"""The agreement with the VESTA Kiosk (agent-contract.json), read where it lies — never typed again here.

The host ships the Kiosk's file at /opt/vesta/host/agent-contract.json (vesta_host.kiosk_contract reads the same one);
a checkout keeps it at agent-host/rootfs/opt/vesta/host/, where the tests read it. One loader, read once: a reader
asks for a section (`section("ticketUpdate")`) and gets the agreement's own lists — `notStatusChanges`,
`clearedNotes`, `clearedNotePrefixes` — so a change the Kiosk makes to how a fault's close is read is a copy of the
file, never an edit of this engine (architecture review round 2, 2026-10-19: kiosk.fault_of kept its own rule and
read 6 of the agreement's 16 histories the other way).
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

log = logging.getLogger("vesta.agreement")

#: Where the file lies: the host's copy in the image, else the checkout's (the tests, a developer's machine).
FILES = (Path("/opt/vesta/host/agent-contract.json"),
         Path(__file__).resolve().parents[2] / "rootfs" / "opt" / "vesta" / "host" / "agent-contract.json")


@lru_cache(maxsize=1)
def table() -> dict:
    """The whole agreement; {} when no copy can be read (said once in the log — a reader then falls back to what the
    steps say by themselves, as before the agreement's lists)."""
    for path in FILES:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(data, dict):
            return data
    log.warning("The agreement with the Kiosk (agent-contract.json) could not be read at %s",
                " or ".join(str(p) for p in FILES))
    return {}


def section(name: str) -> dict:
    """One section of the agreement ("ticketUpdate", "ticket", …); {} when absent."""
    part = table().get(name)
    return part if isinstance(part, dict) else {}
