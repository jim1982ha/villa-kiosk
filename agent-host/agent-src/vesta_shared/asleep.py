"""Devices "unavailable by design": the Rules page's Protected devices › Unavailable by design (owner, 2026-10-21).

A battery device that sleeps between its reports (a Wi-Fi door contact that wakes only to send open or closed, then
goes "unavailable" minutes later) is not lost when it says "unavailable": it is asleep. Its "unavailable" is never a
fault, never a drop, never an unusual moment, and what it reads is its LAST REAL state.

⚠️ ONE LIST, ONE READING, EVERY CHECK (owner, 2026-10-21: "handle them in a consistent and centralised way"). The list
is policy.yaml's `asleep_entities` (vesta_agent.policy reads and checks it); an entity listed stands for its whole
physical device (KnowledgePack.is_asleep: a sensor's battery or signal entity sleeps with it). Every reading of
"offline" asks the pack: vesta_shared.offline.devices_offline (the night check's offline faults, the reports, the chat
status), the reconnect count and the hidden-device check (preventive-maintenance), the 5-minute recheck that closes
an offline fault, the investigation (its timeline and its "stopped reporting"), the alert desk's "is it still there"
and the AI's own reads (vesta_agent.tools.with_asleep).
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta

from .device_state import has_value, is_offline
from .limits import limit

LAST_REAL_DAYS = limit("asleep.last_real_days", 7, unit="days", group="read", lo=1, hi=60,
                       says="Days of history read back for the last real state of a device unavailable by design.",
                       reached="Older than this, it is said to have no real state recorded.", told="")


def listed(path: str | None = None) -> frozenset[str]:
    """The entities the owner listed as unavailable by design (policy.yaml at `path`, else VESTA_POLICY — the skills'
    environment); none when there is no policy or it cannot be read (then every "unavailable" counts, as before)."""
    path = path if path is not None else os.environ.get("VESTA_POLICY", "")
    if not path or not os.path.exists(path):
        return frozenset()
    try:
        from vesta_agent.policy import Policy                     # the one reader of policy.yaml
        return frozenset(Policy.load(path).asleep)
    except Exception:  # noqa: BLE001 — an unreadable policy lists nothing: the checks run as before
        return frozenset()


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
