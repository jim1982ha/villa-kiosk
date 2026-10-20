"""Devices "unavailable by design": the VESTA Kiosk's list (Advanced Settings), read by the agent (owner, 2026-10-21).

A battery device that sleeps between its reports (a Wi-Fi door contact that wakes only to send open or closed, then
goes "unavailable" minutes later) is not lost when it says "unavailable": it is asleep. Its "unavailable" is never a
fault, never a drop, never an unusual moment, and what it reads is its LAST REAL state.

⚠️ ONE LIST, ONE READING, EVERY CHECK (owner, 2026-10-21: "handle them in a consistent and centralised way"). ⚠️ THE
KIOSK'S LIST, NOT THE AGENT'S (owner, the same night: "the KIOSK will be always here and the agent might not always be
configured … a list at a unique place, and all of the consumers can see it"): 0.12.308 kept it in policy.yaml; the
Kiosk keeps it now, and hands it over in its answer to every heartbeat (agent-contract.json `unavailableByDesign`).
The agent writes what it was last told beside its knowledge pack (`save`, FILE) — kept while the Kiosk does not
answer — and every check reads that (`listed`). An entity listed stands for its whole physical device (KnowledgePack.is_asleep: a sensor's battery or signal entity sleeps with it). Every reading of
"offline" asks the pack: vesta_shared.offline.devices_offline (the night check's offline faults, the reports, the chat
status), the reconnect count and the hidden-device check (preventive-maintenance), the 5-minute recheck that closes
an offline fault, the investigation (its timeline and its "stopped reporting"), the alert desk's "is it still there"
and the AI's own reads (vesta_agent.tools.with_asleep).
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta

from .device_state import has_value, is_offline
from .limits import limit

LAST_REAL_DAYS = limit("asleep.last_real_days", 7, unit="days", group="read", lo=1, hi=60,
                       says="Days of history read back for the last real state of a device unavailable by design.",
                       reached="Older than this, it is said to have no real state recorded.", told="")


#: the Kiosk's list as the agent was last told it, beside the knowledge pack (VESTA_PACK's folder)
FILE = "unavailable_by_design.json"


def path_beside(pack_path: str | None) -> str | None:
    """Where the list is kept: beside the knowledge pack at `pack_path` (else VESTA_PACK — the skills' environment)."""
    pack_path = pack_path if pack_path is not None else os.environ.get("VESTA_PACK", "")
    return os.path.join(os.path.dirname(pack_path), FILE) if pack_path else None


def listed(pack_path: str | None = None) -> frozenset[str]:
    """The entities the Kiosk lists as unavailable by design, as last told; none when it never said (no Kiosk, an
    older Kiosk) or the file cannot be read — then every "unavailable" counts, as before."""
    path = path_beside(pack_path)
    try:
        with open(path or "", encoding="utf-8") as f:
            ids = (json.load(f) or {}).get("ids") or []
    except (OSError, ValueError, AttributeError):
        return frozenset()
    return frozenset(str(e).strip().lower() for e in ids if isinstance(e, str) and "." in e)


def told(answer: dict) -> list[str] | None:
    """The list in the Kiosk's heartbeat answer (agent-contract.json `unavailableByDesign`); None when the answer has
    none (a Kiosk older than the list): what was kept stays."""
    ids = (answer or {}).get("unavailableByDesign")
    if not isinstance(ids, list):
        return None
    return sorted({str(e).strip().lower() for e in ids if isinstance(e, str) and "." in e})


def save(pack_path: str, ids: list[str]) -> bool:
    """Keep `ids` as the list (beside the pack at `pack_path`); True when it changed."""
    path = path_beside(pack_path)
    if path is None or sorted(listed(pack_path)) == sorted(ids) and os.path.exists(path):
        return False
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"ids": sorted(ids)}, f)
    os.replace(tmp, path)
    return True


def without_sleep(rows: list[tuple[datetime, str]]) -> list[tuple[datetime, str]]:
    """A history's (time, state) rows without its "unavailable" ones: the last real state holds until the next."""
    return [(t, s) for t, s in rows if not is_offline(s)]


def last_real(client, entity_ids, now: datetime) -> dict[str, dict]:
    """{entity_id: {"state", "last_changed"}}: the last state each had that was a real value, within LAST_REAL_DAYS;
    an entity with none in that time is left out."""
    ids = list(entity_ids)
    if not ids:
        return {}
    got = client.history(ids, now - timedelta(days=LAST_REAL_DAYS), now) or {}
    out = {}
    for eid in ids:
        real = [r for r in got.get(eid) or [] if has_value(r.get("state"))]
        if real:
            r = max(real, key=lambda r: str(r.get("last_changed") or ""))
            out[eid] = {"state": r.get("state"), "last_changed": r.get("last_changed")}
    return out


def awake_states(client, pack, states: dict, now: datetime) -> dict:
    """`states` ({entity_id: state record}) with every device unavailable by design that reads "unavailable" now given
    its last real state instead, marked `"asleep": True` (its time: when it last reported it)."""
    sleeping = [e for e, st in states.items() if pack is not None and pack.is_asleep(e)
                and is_offline((st or {}).get("state"))]
    if not sleeping:
        return states
    out = dict(states)
    for eid, real in last_real(client, sleeping, now).items():
        out[eid] = {**(states.get(eid) or {}), **real, "asleep": True}
    return out
