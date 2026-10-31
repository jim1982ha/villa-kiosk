"""Whether the villa was occupied, day by day, and the normal a day's use is compared with — the ONE rule for every
skill that says a use is above or below its usual level.

⚠️ LIKE WITH LIKE (owner, 2026-10-25: "the villa is now occupied, so it's expected values, right? … propose Skills that
are clever enough to adjust and properly report legit / relevant Faults"): the house pump's "2.73 kWh/day against a
normal 0.14" compared days with guests against a quiet month. A day is compared with earlier days in the SAME state —
occupied with occupied, empty with empty. Too few of them yet (the first guests of the season), it is compared with every
earlier day, but only in the direction occupancy cannot explain: occupied and using LESS than usual, empty and using
MORE (a leak in an empty villa).

⚠️ OPTIONAL, ALWAYS (owner, 2026-10-25: "the skill shall perfectly work with or without this information, when it's not
there (or not updated anymore)"): no helper set, the helper missing, or a day it did not report for most of — that day's
state is unknown, and a comparison over an unknown day is exactly what it was before this existed.

The sensor is THE KIOSK'S PICK (Settings › Villa, the one its presence tile follows; on = empty), handed over in its
answer to every heartbeat (agent-contract.json `heartbeat.answer.villaEmptySensor`) and kept beside the knowledge pack,
as the devices asleep by design are (vesta_shared.asleep): `sensor()` is the one reader — the alert desk's siren
(`now`), the night check's and the energy report's like with like (`days`), the reports' "electricity while empty" and
the concierge's status. ⚠️ ONE PICK, NOT TWO (architecture review round 7, card 2): the agent named its own sensor in
the alert desk's rules.yaml and the reports' reports.yaml — one villa's entity id shipped to every install, while the
Kiosk's tile followed whatever the owner picked. Never told (no Kiosk, an older Kiosk, before its first answer) or no
pick: the villa's state cannot be told — never empty, the siren is not offered, every comparison as before.
Each night's state is kept in the skills' store (`FEATURE`): the villa's own history keeps about ten days, a baseline
needs thirty.
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, time, timedelta
from typing import NamedTuple

from .asleep import path_beside
from .limits import limit
from .stats import med

OCCUPIED, EMPTY, UNKNOWN = "occupied", "empty", "unknown"
#: the Kiosk's pick as the agent was last told it, beside the knowledge pack (VESTA_PACK's folder)
FILE = "villa_empty_sensor.json"
#: How a day's state is kept in the skills' store (Store.put_feature): family, name; value 1 occupied, 0 empty.
FEATURE = ("villa", "occupied")


def min_days() -> int:
    """How many earlier days in the same state a normal needs before it is judged on them alone."""
    return limit("occupancy.min_days", 5, unit="days", group="detect", lo=2, hi=30,
                 says="Days in the same state (occupied, or empty) a usual level needs before a day is compared with "
                      "them alone.",
                 reached="With fewer, a day is compared with every earlier day, and only a use occupancy cannot "
                         "explain is said (less while occupied, more while empty).", told="")


def _path(pack_path: str | None) -> str | None:
    beside = path_beside(pack_path)
    return os.path.join(os.path.dirname(beside), FILE) if beside else None


def _entity_id(v) -> str:
    v = str(v or "").strip().lower()
    return v if "." in v and " " not in v else ""


def sensor(pack_path: str | None = None) -> str | None:
    """The villa's "empty" sensor (on = empty) as the Kiosk last named it; None when it never did, picked none, or the
    file cannot be read."""
    try:
        with open(_path(pack_path) or "", encoding="utf-8") as f:
            return _entity_id((json.load(f) or {}).get("entity_id")) or None
    except (OSError, ValueError, AttributeError):
        return None


def told(answer: dict) -> str | None:
    """The pick in the Kiosk's heartbeat answer: its entity id, "" for no pick (or not an entity id); None when the
    answer has none (an older Kiosk, or one that cannot read its settings): what was kept stays."""
    v = (answer or {}).get("villaEmptySensor")
    return _entity_id(v) if isinstance(v, str) else None


def save(pack_path: str, entity_id: str) -> bool:
    """Keep `entity_id` ("" for no pick) as the villa's "empty" sensor, beside the pack at `pack_path`; True when it
    changed."""
    path = _path(pack_path)
    if path is None or (os.path.exists(path) and (sensor(pack_path) or "") == entity_id):
        return False
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"entity_id": entity_id}, f)
    os.replace(tmp, path)
    return True


def state_of(state) -> str:
    """What one reading of the sensor says: on EMPTY, off OCCUPIED, anything else (unavailable, unknown) UNKNOWN."""
    return {"on": EMPTY, "off": OCCUPIED}.get(str(state or "").strip().lower(), UNKNOWN)


def now(client, pack_path: str | None = None) -> str:
    """The villa empty or not now (EMPTY / OCCUPIED / UNKNOWN), read from the sensor through `client` (a script's
    client, or the engine's reader: .states(ids)). `pack_path`: the engine's knowledge pack (a script's is VESTA_PACK).
    No sensor, or it cannot be read: UNKNOWN, never empty."""
    eid = sensor(pack_path)
    if not eid or client is None:
        return UNKNOWN
    try:
        return state_of((client.states([eid]).get(eid) or {}).get("state"))
    except Exception:  # noqa: BLE001 — unread is "cannot tell"
        return UNKNOWN


def entity(skill_dir: str | None = None) -> str | None:
    """The villa's "empty" sensor (sensor()). `skill_dir`: what a skill edited before 0.12.415 still passes (the sensor
    was then named in the alert desk's rules.yaml); it is ignored."""
    return sensor()


def day_states(rows: list[dict], first: date, last: date, zone) -> dict[date, str]:
    """Each day of [first, last] the helper held one state for most of (on: EMPTY, off: OCCUPIED), from its history
    `rows` (oldest first, the state at the window's start first). A day it read anything else for half the day or more
    (unavailable, unknown, no reading) is left out: unknown."""
    marks = []
    for r in rows or []:
        try:
            at = datetime.fromisoformat(str(r.get("last_changed") or r.get("last_updated")).replace("Z", "+00:00"))
        except ValueError:
            continue
        marks.append((at.astimezone(zone), {"on": EMPTY, "off": OCCUPIED}.get(str(r.get("state")))))
    marks.sort(key=lambda m: m[0])
    out: dict[date, str] = {}
    d = first
    while d <= last:
        start = datetime.combine(d, time(0, 0), tzinfo=zone)
        end = start + timedelta(days=1)
        held = {OCCUPIED: 0.0, EMPTY: 0.0}
        for i, (at, st) in enumerate(marks):
            nxt = marks[i + 1][0] if i + 1 < len(marks) else end
            a, b = max(at, start), min(nxt, end)
            if st and b > a:
                held[st] += (b - a).total_seconds()
        best = max(held, key=held.get)
        if held[best] > 12 * 3600:
            out[d] = best
        d += timedelta(days=1)
    return out


def days(cli, store, skill_dir: str, first: date, last: date, zone, keep: bool = True) -> dict[date, str] | None:
    """The villa's state on each day of [first, last] that is known: kept in `store` from earlier nights, the rest
    read from the sensor's history (and kept, `keep`). None when the Kiosk names no sensor — every comparison as before.
    (`skill_dir`: ignored, kept for the skills' calls.)"""
    eid = entity(skill_dir)
    if not eid:
        return None
    family, name = FEATURE
    known = {date.fromisoformat(d): (OCCUPIED if v else EMPTY)
             for d, v in (store.features_of(eid, family, name, first.isoformat()) if store else {}).items()
             if v is not None and first <= date.fromisoformat(d) <= last}
    missing = [d for i in range((last - first).days + 1) if (d := first + timedelta(days=i)) not in known]
    if missing and cli is not None:
        try:
            rows = (cli.history([eid], datetime.combine(missing[0], time(0, 0), tzinfo=zone),
                                datetime.combine(last + timedelta(days=1), time(0, 0), tzinfo=zone)) or {}).get(eid, [])
        except Exception:  # noqa: BLE001 — unread, the days stay unknown: compared as before
            rows = []
        for d, st in day_states(rows, missing[0], last, zone).items():
            if d in known:
                continue
            known[d] = st
            if keep and store:
                store.put_feature(d.isoformat(), eid, family, name, 1.0 if st == OCCUPIED else 0.0)
    return known


class Normal(NamedTuple):
    """The normal the judged days are compared with: `of` each judged day's normal (None: no normal at all), `value`
    their middle, `state` OCCUPIED / EMPTY when every judged day shares it and its own days set the normal (the words
    "when the villa is occupied"), `rise` / `drop` whether a use above / below it may be said."""
    of: dict
    value: float | None
    state: str | None
    rise: bool
    drop: bool


def normal(values: dict, judged: list, before: list, states: dict | None, need: int | None = None) -> Normal:
    """The normal of `judged` days, from the `before` days' `values`, like with like by `states` (days → OCCUPIED /
    EMPTY; None or a judged day unknown: every earlier day, both directions — as before occupancy existed). `need`: the
    same-state days a normal needs (min_days)."""
    need = min_days() if need is None else need
    every = med([values[d] for d in before if values.get(d) is not None])
    if not states or any(states.get(d) is None for d in judged):
        return Normal({d: every for d in judged}, every, None, True, True)
    norms, rise, drop, own = {}, True, True, True
    for s in {states[d] for d in judged}:
        same = [values[d] for d in before if states.get(d) == s and values.get(d) is not None]
        if len(same) >= need:
            norms[s] = med(same)
        else:
            norms[s], own = every, False
            rise, drop = (False, drop) if s == OCCUPIED else (rise, False)
    of = {d: norms[states[d]] for d in judged}
    one = {states[d] for d in judged}
    return Normal(of, med(list(of.values())), next(iter(one)) if len(one) == 1 and own else None, rise, drop)
