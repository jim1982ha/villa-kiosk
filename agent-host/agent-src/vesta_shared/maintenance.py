"""The villa's maintenance mode: the VESTA Kiosk's switch (Advanced Settings › System), read by the agent (owner,
2026-10-29: "Put it on the tablet, for the Owner only … a small 'Maintenance' mark in the top bar, so nobody forgets it").

While it is on the alert desk takes up only urgent (P1) alerts; any other new one is recorded in the audit and not
taken up (no number, no chase, no fault). ⚠️ THE KIOSK'S SWITCH, NOT A VILLA HELPER: the desk read a helper of the
villa's system before (params "maintenance_mode") that no screen showed — nobody could see or reach it. The Kiosk now
hands it over in its answer to every heartbeat (agent-contract.json `heartbeat.answer.maintenance`), as it hands the
devices asleep by design (vesta_shared.asleep); the agent writes what it was last told beside its knowledge pack
(vesta_shared.kiosk_told), kept while the Kiosk does not answer, and the desk reads it from there. Never told (no Kiosk, an older Kiosk): off.
"""
from __future__ import annotations

from . import kiosk_told


def on(pack_path: str | None = None) -> bool:
    """Whether the Kiosk last said maintenance mode is on (vesta_shared.kiosk_told); off when it never said or the file
    cannot be read."""
    return kiosk_told.get("maintenance", pack_path) is True


def takes_up(severity: str | None, pack_path: str | None = None) -> bool:
    """Whether a NEW problem of `severity` is taken up now (a number, a message, a fault): always for an urgent one
    (P1), any other only while maintenance mode is off. THE ONE GATE, asked by every door that opens a problem: the
    alert desk's intake and Problems.record (the night check and the 5-minute recheck). A problem already open carries
    on as before; one not taken up is audited and opens nothing, so one still standing when the mode ends is found new
    by the next check and taken up then, and one gone meanwhile is never sent afterwards (the Kiosk's promise,
    MaintenanceMode.tsx).

    ⚠️ EVERY DOOR, NOT ONE (architecture review round 7, card 1): only the desk asked; the recheck's device-offline
    findings and the night check opened faults and sent the facility manager P2 lines during maintenance."""
    return severity == "P1" or not on(pack_path)

