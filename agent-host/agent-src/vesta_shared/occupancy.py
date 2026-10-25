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

The helper is the alert desk's (its rules.yaml `siren.villa_empty`, the villa's own first: on = empty) — one setting.
Each night's state is kept in the skills' store (`FEATURE`): the villa's own history keeps about ten days, a baseline
needs thirty.
"""
from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta
from typing import NamedTuple

from .limits import limit
from .stats import med

OCCUPIED, EMPTY = "occupied", "empty"
#: How a day's state is kept in the skills' store (Store.put_feature): family, name; value 1 occupied, 0 empty.
FEATURE = ("villa", "occupied")


def min_days() -> int:
    """How many earlier days in the same state a normal needs before it is judged on them alone."""
    return limit("occupancy.min_days", 5, unit="days", group="detect", lo=2, hi=30,
                 says="Days in the same state (occupied, or empty) a usual level needs before a day is compared with "
                      "them alone.",
                 reached="With fewer, a day is compared with every earlier day, and only a use occupancy cannot "
                         "explain is said (less while occupied, more while empty).", told="")


def entity(skill_dir: str) -> str | None:
    """The villa's "empty" helper, as the alert desk sets it (a sibling skill of `skill_dir`'s); None when no desk or
    no helper is set."""
    from .skill_settings import load
    desk = os.path.join(os.path.dirname(os.path.abspath(skill_dir)), "alert-desk")
    eid = ((load(desk, "rules.yaml").get("siren") or {}).get("villa_empty") if os.path.isdir(desk) else None)
    return str(eid) if eid and "." in str(eid) else None


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
    read from the helper's history (and kept, `keep`). None when no helper is set — every comparison as before."""
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
