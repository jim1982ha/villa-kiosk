"""Devices that run only when people are in — a house pump drawing water, a jacuzzi pump — learned from their own runs
and the villa's "empty" sensor, hour by hour, with no setting: the night check learns it, the alert desk holds a "has not
run" alert such a device raises while nobody was there to use it, and the night check does not call its silent empty day
short.

⚠️ AN EMPTY VILLA DRAWS NO WATER (owner, 2026-11-12, #167-P2: "is it expected to see this alert when the villa is not
occupied? … the VESTA Agent shall be clever enough to handle such cases, without human configuration"): the house pump's
"no confirmed run in over 1d" came every morning the villa was empty. A device's run is an hour whose highest reading
reached its running power (daily.running_threshold): a few seconds each time a tap opens count, as the night check's
"running" does. Each finished day the night check counts, for each device, the hours someone was in and the hours the
villa was empty, and in how many of each it ran (`FAMILY`, kept as the skills' features). It FOLLOWS PEOPLE when it ran
in enough hours with someone in, the villa was empty long enough to tell, and it ran far less often while empty
(`learn`): a fridge, a timer-driven pool pump or a pump that must turn while empty run as often either way and are never
held. `need_h`: the hours with someone in after which it would have run by now, almost surely (its own rate with
someone in) — a held alert becomes an alert once people have been in that long since its last run (`hold`).

⚠️ OPTIONAL, ALWAYS (as vesta_shared.occupancy): no "empty" sensor picked, its history unread, a device not learned yet:
nothing is held, everything as before.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

from .occupancy import EMPTY, OCCUPIED, SAYS

#: The night's verdicts, kept for the alert desk (Store.cache_put): {"at": when learned, "devices": {power entity: learned}}
KEY = "pm-follows-people"
#: How each finished day's counts are kept (Store.put_feature): family, and the four names
FAMILY = "people"
IN_H, IN_RUN_H, EMPTY_H, EMPTY_RUN_H = "in_h", "in_run_h", "empty_h", "empty_run_h"
NAMES = (IN_H, IN_RUN_H, EMPTY_H, EMPTY_RUN_H)
HOUR = timedelta(hours=1)


class Rules(NamedTuple):
    """What `learn` needs to say a device follows people (the night check's settings: people_*)."""
    min_run_hours: float      # hours it ran with someone in, before anything is said
    min_empty_hours: float    # hours the villa was empty, before anything is said
    empty_ratio: float        # its rate while empty, at most this share of its rate with someone in
    sure: float               # how sure "it would have run by now" must be (need_h)
    max_hold_hours: float     # need_h never above this


def _at(row: dict) -> datetime | None:
    try:
        t = datetime.fromisoformat(str(row.get("last_changed") or row.get("last_updated")).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def spans(rows: list[dict], first: datetime, last: datetime) -> list[tuple[datetime, datetime, str | None]]:
    """The sensor's history `rows` (oldest first, the state at the window's start first) as (from, to, OCCUPIED |
    EMPTY | None) spans covering [first, last]; None where it read anything else, and before its first reading."""
    marks = sorted((t, SAYS.get(str(r.get("state")))) for r in rows or [] if (t := _at(r)) is not None)
    out, prev = [], (first, None)
    for t, st in marks:
        if t > prev[0]:
            out.append((prev[0], min(t, last), prev[1]))
        prev = (max(t, first), st)
        if t >= last:
            break
    if prev[0] < last:
        out.append((prev[0], last, prev[1]))
    return [s for s in out if s[1] > s[0]]


def hours_held(rows: list[dict], first: datetime, last: datetime) -> dict[datetime, str]:
    """Each whole hour of [first, last) (UTC hour starts): OCCUPIED when someone was in at any moment of it, EMPTY when
    the villa read empty all of it; an hour it read nothing known in, or only partly empty, is left out."""
    sp = spans(rows, first, last)
    out: dict[datetime, str] = {}
    h = first.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    h = h if h >= first else h + HOUR
    while h + HOUR <= last:
        inside = [st for a, b, st in sp if a < h + HOUR and b > h]
        if OCCUPIED in inside:
            out[h] = OCCUPIED
        elif inside and all(st == EMPTY for st in inside) and \
                sum((min(b, h + HOUR) - max(a, h)).total_seconds() for a, b, st in sp if a < h + HOUR and b > h) >= 3599:
            out[h] = EMPTY
        h += HOUR
    return out


def occupied_hours(rows: list[dict], since: datetime, now: datetime) -> float:
    """Hours someone was in (the sensor reading not empty) between `since` and `now`, from its history `rows`."""
    return sum((b - a).total_seconds() for a, b, st in spans(rows, since, now) if st == OCCUPIED) / 3600


def _start(row: dict) -> datetime:
    return datetime.fromtimestamp(row["start"] / 1000, timezone.utc)


def ran_hours(stat_rows: list[dict], thr: float) -> set[datetime]:
    """The hours (UTC starts) its highest reading reached `thr`: it ran in them, however briefly."""
    return {_start(r) for r in stat_rows or [] if r.get("max") is not None and r["max"] >= thr}


def last_ran(stat_rows: list[dict], thr: float) -> datetime | None:
    """The end of the latest hour it ran in (ran_hours), or None."""
    ran = ran_hours(stat_rows, thr)
    return max(ran) + HOUR if ran else None


def day_counts(held: dict[datetime, str], ran: set[datetime], first: datetime, last: datetime) -> dict[str, float]:
    """The four counts (NAMES) of the hours of [first, last) whose villa state is known."""
    hours = [h for h in held if first <= h < last]
    inside = [h for h in hours if held[h] == OCCUPIED]
    empty = [h for h in hours if held[h] == EMPTY]
    return {IN_H: len(inside), IN_RUN_H: sum(h in ran for h in inside),
            EMPTY_H: len(empty), EMPTY_RUN_H: sum(h in ran for h in empty)}


def learn(totals: dict[str, float], rules: Rules) -> dict:
    """What its counts (NAMES, summed over the days learned from) say: {follows, need_h, the counts, why}."""
    t = {k: float(totals.get(k) or 0) for k in NAMES}
    out = {**t, "follows": False, "need_h": None}
    if t[IN_RUN_H] < rules.min_run_hours or t[EMPTY_H] < rules.min_empty_hours or not t[IN_H]:
        return {**out, "why": "not enough hours yet"}
    rate_in, rate_empty = t[IN_RUN_H] / t[IN_H], t[EMPTY_RUN_H] / t[EMPTY_H]
    if rate_empty > rules.empty_ratio * rate_in:
        return {**out, "why": "it runs while the villa is empty too"}
    need = rules.max_hold_hours if rate_in >= 1 else math.log(1 - rules.sure) / math.log(1 - rate_in)
    return {**out, "follows": True, "need_h": round(min(max(need, 1.0), rules.max_hold_hours), 1),
            "why": "it runs only when people are in"}


def record(store, at: str, devices: dict[str, dict]) -> None:
    """The night's verdicts, learned at `at`, kept for the alert desk (KEY)."""
    store.cache_put(KEY, {"at": at, "devices": devices})


def recorded(store) -> dict:
    """The last night's verdicts ({"at": None, "devices": {}} before the first)."""
    got = store.cache_get(KEY) if store is not None else None
    return got if isinstance(got, dict) and isinstance(got.get("devices"), dict) else {"at": None, "devices": {}}


class Hold(NamedTuple):
    """A "has not run" alert held: since when people's hours are counted (its last run, or the start of the hours read
    when it did not run in them: `ran`), the whole hours people have been in since, the hours after which it becomes an
    alert."""
    since: datetime
    ran: bool
    inside_h: int
    need_h: float


def hold(store, client, sensor: str | None, entity_id: str, now: datetime) -> Hold | None:
    """Whether a "has not run" alert of `entity_id` (its power reading) is held now: it follows people (the last night's
    verdict) and people have been in for less than its need_h since its last run (its hourly maxima at its running power,
    read through `client`; the villa's `sensor` history since). None — an alert as before — when it does not follow
    people, nothing was learned, or anything cannot be read."""
    v = recorded(store)["devices"].get(entity_id)
    if not sensor or client is None or not v or not v.get("follows") or not v.get("need_h") or not v.get("thr"):
        return None
    look = now - timedelta(days=float(v.get("look_days") or 30))
    try:
        last = last_ran((client.statistics([entity_id], look, now, "hour", ("mean", "max")) or {}).get(entity_id) or [],
                        float(v["thr"]))
        since = last or look
        rows = (client.history([sensor], since, now) or {}).get(sensor) or []
    except Exception:  # noqa: BLE001 — unread: an alert as before
        return None
    if not rows:
        return None
    inside = occupied_hours(rows, since, now)
    return Hold(since, last is not None, int(inside), float(v["need_h"])) if inside < float(v["need_h"]) else None
