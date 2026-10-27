#!/usr/bin/env python3
"""Every 5 minutes: every open finding of the night check is read again, each by the rule that found it (READS: the
night's own reading, never a copy) — one still found stays, one no longer found closes now; a device gone offline gets
its fault now; any fault about a device deleted from Home Assistant closes. The 02:00 night check stays where NEW
findings are found.

  python recheck.py --store vesta_store.sqlite [--pack pack.json] [--fixture-dir DIR] [--now 2026-10-10T14:00:00+00:00]

⚠️ ONE CADENCE FOR EVERY FAULT (owner, 2026-10-20: "simplify: remove the split, check every 5 min for all the reported
issues — keep it as simple as possible, no useless exceptions"; "I am worried how I will judge what is a daily-check
fault versus what is not"). The day recheck at 08:00/12:00/16:00/20:00 and its list of rules are gone: every card says
"Next check: within 5 min". A rule about a state (a battery, a quiet sensor, a reconnect loop, a rule naming a hidden
device) is read as it stands now. A rule judged on a FINISHED day (a pump's draw, use and run hours, a room's highest
temperature) is read over the last finished day — never "today so far", which would close a pump fault before the pump
has run today — so its verdict can only change once a new day has finished: it is kept per finding and per day
(store cache), and worked out again only when the last finished day changes.

⚠️ FOUND AT ONCE, NOT AT 02:00 (owner, 2026-10-18 — architecture review, offline devices #1): Timmerflotte_5969 dropped
at 21:46 and stood "Unavailable" in the Cockpit for 4 h 14 min before the night check opened its fault. Here the
night's own reading of what is offline (nightly.offline_findings) runs every 5 minutes: a device offline
`unavailable_minutes` with no open finding gets one — its Kiosk fault, and for a critical device the facility
manager's message, as the night check sends it. It closes nothing it did not see: that stays back_online's.

⚠️ NOT THE NEXT NIGHT (villa, 2026-10-10): "shelly integration (3 devices) has been offline for 9 h" stayed an open
fault in the Cockpit all day while every Shelly device had been back since noon — the night check closes a finding
only when it runs again, at 02:00. An offline finding is a state anyone can read again: here its devices are read
every 5 minutes, and once all are back online (`back_online_minutes`), it closes as the night check would close it
(vesta_shared.problems: its task and its Kiosk fault with it).

⚠️ AN ALERT TAKES IT OVER AT ONCE (architecture review N, 2026-10-27): a device offline at 5 minutes got its fault here,
the villa's own alert took it up at 10, and both stood in the Cockpit until the night check handed the fault over at
02:00. back_online hands it over now, by the night's own rule (nightly.handed_to_alerts), and its message says so.

⚠️ A DEVICE DELETED FROM HOME ASSISTANT (owner, 2026-10-14): its fault stayed open until 02:00, then closed "Cleared:
the nightly check no longer sees it" — as if it had come back. Any open finding whose every entity Home Assistant
answers "not found" for (its own 404, never a failed read) closes here, saying so. Nothing is read when nothing is open.

⚠️ A FAULT A PERSON REOPENED IS TOLD BY THIS SKILL (architecture review round 2, 2026-10-19): the engine marks a
person's "Reopen fault" on the task (store.untold_reopenings) and this script tells it, to the role and under the
title of settings.yaml `reopened_in_kiosk` — the engine used to send it itself, to a role and under a title of its own.

⚠️ A CLOSE WHILE IT IS STILL THERE (owner, architecture review 2026-10-19: one rule with the alert desk's): a pump's
fault closed in the Cockpit while it was still unavailable stayed closed, nothing said — this script skipped every
device with an open finding. Now a device still offline is recorded as SEEN at each reading (Problems.seen); a reading
settings.yaml `still_there_after_close.minutes` or more after a person's close opens the fault again ("Still there after
the close."), said on the night check's message that told it, else told once to its `tell` under its `title`
(still_there_untold — a night check's reopening too; owner, 2026-10-27: no separate message for a fault a message told).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, time, timedelta, timezone
from typing import Callable, NamedTuple
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from vesta_shared import kiosk_words, result, script  # noqa: E402
from vesta_shared.device_state import OFFLINE, out_for  # noqa: E402  ("is it back": one answer)
from vesta_shared.problems import Problems  # noqa: E402
from vesta_shared.timeutil import day_time_label  # noqa: E402
import nightly as N  # noqa: E402  (what is offline: the night's one reading of it)
from vesta_shared.problems import STILL_THERE  # noqa: E402
from vesta_shared import battery  # noqa: E402  (the battery rules' ids: one owner)
from vesta_shared.device_state import has_value, is_offline  # noqa: E402
from vesta_shared.asleep import read_states  # noqa: E402  (a sleeping device reads its last real state)
from vesta_shared.limits import limit  # noqa: E402
from vesta_shared.offline import device_answers  # noqa: E402  (a device that answers is not offline)
from vesta_shared.past import Logbook  # noqa: E402
import rules as R  # noqa: E402



GONE_NOTE = "Closed: this device no longer exists in the villa's system."
HIDDEN_NOTE = "Closed: this device is hidden in the villa's system, and hidden devices are not watched."
ANSWERS_NOTE = "Closed: the device answers; only some of its sensors are waiting for their next report."
ASLEEP_NOTE = ("Closed: this device sleeps between its reports "
               "(VESTA Kiosk › Advanced Settings › Asleep between reports).")
ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")     # only a real entity id can be "not found"


def back_online(store, client, now: datetime, minutes: float, zone: str, pack=None) -> dict:
    """{closed: [finding ids], gone: [the ones whose devices no longer exist], handed: {finding id: its note, for the
    offline faults an alert now follows (nightly.handed_to_alerts)}, actions: [the Kiosk faults to resolve]}.
    `client()`: Home Assistant, asked for only when a finding is open."""
    rows = store.findings(status="open")
    if not rows or client() is None:
        return {"closed": [], "gone": [], "handed": {}, "actions": []}
    # an alert that now follows an offline device takes its fault over at once, as the night check does at 02:00
    handed_over = N.handed_to_alerts(store, pack, N.alerted_offline(store, pack)) if pack is not None else {}
    ents = {f["id"]: json.loads(f.get("detail") or "{}").get("entities") or [f["entity_id"]] for f in rows}
    ids = sorted({e for es in ents.values() for e in es if ENTITY_ID.match(str(e))})
    states = client().states(ids)
    # only what has no state is asked about: "not found" is Home Assistant's answer, a missing row is not
    gone = client().not_found([e for e in ids if e not in states]) if len(states) < len(ids) else set()
    day = now.astimezone(ZoneInfo(zone)).date().isoformat()
    closed, deleted, moved, handed = [], [], [], {}
    for f in rows:
        es = ents[f["id"]]
        if es and all(e in gone for e in es):
            moved += Problems(store).close_finding(f, day, GONE_NOTE)
            closed.append(f["id"]); deleted.append(f["id"])
        elif f["rule_id"] == OFFLINE_RULE and pack is not None and es and not any(pack.is_watched(e) for e in es):
            # ⚠️ HIDDEN SINCE IT WAS FOUND (architecture review, 2026-10-21): the night check no longer saw it and closed
            # it at 02:00 as "Cleared" — said of a device still off. It is closed now, saying why.
            moved += Problems(store).close_finding(f, day, HIDDEN_NOTE)
            closed.append(f["id"])
        elif f["rule_id"] == OFFLINE_RULE and pack is not None and es and all(pack.is_asleep(e) for e in es):
            # listed as unavailable by design since it was found (vesta_shared.asleep): never a fault
            moved += Problems(store).close_finding(f, day, ASLEEP_NOTE)
            closed.append(f["id"])
        elif f["rule_id"] == OFFLINE_RULE and out_for(client(), [e for e in es if e not in gone], states, OFFLINE, now,
                                                      minutes, unknown_tells=True):
            moved += Problems(store).close_finding(f, day, "Cleared: back online.")
            closed.append(f["id"])
        elif f["rule_id"] == OFFLINE_RULE and pack is not None and es and device_answers(pack, es, client().states):
            # ⚠️ ITS DEVICE ANSWERS (villa, 2026-10-25): a camera's event sensors read "unavailable" until its next
            # event while its stream and Wi-Fi report; opened under the older reading, it closes now, saying why
            moved += Problems(store).close_finding(f, day, ANSWERS_NOTE)
            closed.append(f["id"])
        elif (f["rule_id"], f["entity_id"]) in handed_over:
            # still off, and the villa's own alert follows it now: one problem, the alert's — handed over, never cleared
            note = handed_over[(f["rule_id"], f["entity_id"])]
            moved += Problems(store).close_finding(f, day, note)
            handed[f["id"]] = note
    if closed or handed:
        store.audit("preventive-maintenance", "back_online", {"findings": closed, "gone": deleted, "handed": list(handed)})
    return {"closed": closed, "gone": deleted, "handed": handed, "actions": result.moved(moved)}


def gone_offline(store, pack, client, now: datetime, params, zone: str, settle_minutes: float | None = None) -> dict:
    """{actions: [faults_changed when a task moved], send: [the facility manager's message for a critical device],
    found: [finding ids]}. A device with no open finding gets one; one whose finding is open is recorded as seen still
    offline at `now` (Problems.seen, with the skill's `settle_minutes`): its words stay the night check's to restate,
    but a person's close of its fault that long ago or more no longer holds."""
    none = {"actions": [], "send": [], "found": []}
    if pack is None or client() is None:
        return none
    ids = sorted({r["entity_id"] for fam in N.WATCHED_FAMILIES for r in pack.entities(fam)})
    at = now.astimezone(ZoneInfo(zone))
    found, moved = [], []
    for f in N.offline_findings(pack, client().states(ids), at, params, set(N.alerted_offline(store, pack)),
                                history=client().history):
        row = store.open_finding(f.rule_id, f.entity_id)
        if row:
            moved += Problems(store).seen(row["id"], now.isoformat(), settle_minutes)
        else:
            found.append(f)
    if not found:
        return {**none, "actions": result.moved(moved)}
    day = at.date().isoformat()
    rec = Problems(store).record(found, day, state_rules=N.STATE_RULES, event_rules=N.EVENT_RULES,
                                 worsened_step=params.behaviour("worsened_step_pct"), at=now.isoformat(),
                                 settle_minutes=settle_minutes)
    actions = result.moved(moved + rec["task_ids"])
    send = N.told_now({"villa": pack.villa, "as_of": day, "new_findings": rec["new"], "again": rec["again"]},
                      title=f"{pack.villa or 'The villa'}, devices offline on {day_time_label(at)}.", store=store, at=now)
    store.audit("preventive-maintenance", "gone_offline", {"findings": [d["id"] for d in rec["new"] + rec["again"]]})
    return {"actions": actions, "send": send, "found": [d["id"] for d in rec["new"] + rec["again"]]}


OFFLINE_RULE = "PM-UNAVAILABLE"     # read by back_online (a device back for `back_online_minutes`), not in READS
#: How long after midnight a finished day's statistics are taken as complete before its day rules are read over it:
#: the villa's system writes an hour's figures a few minutes after the hour.
DAY_SETTLE_MINUTES = limit("recheck.day_settle_minutes", 15, unit="minutes", group="read", lo=0, hi=180,
                           says="Minutes after midnight before a finished day's figures are read again for its faults.",
                           reached="Until then a fault judged on a finished day keeps the verdict of the day before.",
                           told="")
#: The logbook rows kept between two readings of the reconnect loops (store cache): one villa-wide read of
#: `reconnect_days` takes about 9 s for ~15,000 rows (villa, 2026-10-20) — every 5 minutes that would be 288 such reads
#: a day. The rows a count needs are kept (the restarts, and every row of an entity that went offline), and each tick
#: reads only the minutes since the last one: the same count as a whole read (test_recheck_all).
LOOPBOOK = "pm-loopbook"


def _battery_rows(pack, f: dict) -> list[dict]:
    """The battery row of finding `f` (its own entity), [] when the pack no longer lists it."""
    return [r for r in pack.entities("battery") if r["entity_id"] == f["entity_id"]]


def _silence_rows(pack, f: dict) -> list[dict]:
    """The level rows of finding `f`'s device — the night judges a device's silence over all of them (one finding per
    device, kept under the first one quiet)."""
    rows = pack.entities("level")
    mine = next((r for r in rows if r["entity_id"] == f["entity_id"]), None)
    if mine is None:
        return []
    key = pack.device_key(mine["entity_id"], mine)
    return [r for r in rows if pack.device_key(r["entity_id"], r) == key]


def _asset_of(pack, f: dict) -> list[dict]:
    """The asset whose power or energy entity finding `f` is about, as a one-row list ([] when the pack no longer has it)."""
    for slug, a in pack.assets.items():
        if f["entity_id"] in (a.get("entities") or {}).values():
            return [{**a, "slug": a.get("slug") or slug}]
    return []


def _level_rows(pack, f: dict) -> list[dict]:
    return [r for r in pack.entities("level") if r["entity_id"] == f["entity_id"]]


class Tick:
    """One 5-minute reading: what every rule's reading needs, read at most once per tick (the states, the last finished
    day, the logbook of the reconnect loops, the villa's rules naming a hidden device)."""

    def __init__(self, store, pack, client, now: datetime, params, zone: str):
        self.store, self.pack, self.client, self.now, self.params = store, pack, client, now, params
        self.zone, self.Z = zone, ZoneInfo(zone)
        self.at = now.astimezone(self.Z)
        settled = (self.at - timedelta(minutes=DAY_SETTLE_MINUTES)).date()
        self.day = settled - timedelta(days=1)                                  # the last finished day, settled
        self.day_end = datetime.combine(self.day + timedelta(days=1), time(0, 0), tzinfo=self.Z)
        self.states: dict = {}
        self._loops = self._hidden = None

    # the reconnect loops: the days ending now, from the logbook kept between ticks
    def loops(self) -> list:
        if self._loops is None:
            book = loopbook(self.store, self.client(), self.now, int(self.params.behaviour("reconnect_days")))
            self._loops = N.reconnect_findings(self.client(), self.pack, self.states, self.now, self.now.date(),
                                               self.params, self.zone, self.Z, self.now, book=book)[0]
        return self._loops

    def hidden(self) -> list:
        if self._hidden is None:
            self._hidden = N.hidden_in_rule_findings(self.client(), self.pack, self.states, self.store)[0]
        return self._hidden

    def battery(self, rows) -> list:
        ids = [r["entity_id"] for r in rows]
        stats = self.client().statistics(ids, self.day_end - timedelta(days=N.BATTERY_READ_DAYS), self.day_end, "day",
                                         ("mean",))
        best = N.battery_best(self.client(), ids, self.now, self.params)
        return N.battery_findings(self.pack, self.states, self.params, self.day, stats, rows=rows,
                                  store=self.store, best=best, at=self.now)

    def asset_day(self, rows) -> list:
        asset = rows[0]
        p_eid, e_eid = asset["entities"].get("power"), asset["entities"].get("energy")
        days = int(self.params.behaviour("baseline_days")) + int(self.params.behaviour("confirm_days")) + N.WINDOW_MARGIN_DAYS
        start = self.day_end - timedelta(days=days)
        c = self.client()
        hour = c.statistics([p_eid], start, self.day_end, "hour", ("mean", "min", "max")) if p_eid else {}
        day = c.statistics([e_eid], start, self.day_end, "day", ("change", "sum")) if e_eid else {}
        occupied = N.occupancy.days(c, self.store, os.path.dirname(N.HERE), start.date(), self.day, self.Z, keep=False)
        return N.asset_findings(c, self.store, self.params, asset, self.day, self.day_end, hour, day, self.now,
                                self.zone, self.Z, [], write_features=False, occupied=occupied)[0]

    def level_day(self, rows) -> list:
        ids = [r["entity_id"] for r in rows]
        stats = self.client().statistics(ids, self.day_end - timedelta(days=N.LEVEL_READ_DAYS), self.day_end, "hour",
                                         ("mean", "min", "max"))
        return N.level_findings(self.pack, self.params, rows, stats, self.day, self.zone)


class Reading(NamedTuple):
    """How one open finding of a rule is read again: `rows` (finding → its pack rows, [] when the pack no longer lists
    it), `entities` (finding, rows → the entities whose state must have been read), `found` (tick, rows → what the
    rule's own reading finds now), `per_day` (judged on a finished day: kept per finding and day, worked out again only
    when the last finished day changes)."""
    rows: Callable
    entities: Callable
    found: Callable
    per_day: bool = False


_own = lambda pack, f, rows: [r["entity_id"] for r in rows]                 # noqa: E731
_battery = Reading(_battery_rows, _own, lambda t, rows: t.battery(rows))
_none = lambda pack, f, rows: []                                            # noqa: E731
_asset = Reading(_asset_of, _none, lambda t, rows: t.asset_day(rows), per_day=True)
#: Every rule of the night check (nightly.STATE_RULES | EVENT_RULES) but the offline one, and how it is read again
#: (owner, 2026-10-20: one cadence, no exception). A rule the night finds with no reading here stops the tick and
#: Overview says which (Unreadable) — a fault never promises a check that does not run.
READS: dict[str, Reading] = {
    battery.CRIT: _battery, battery.LOW: _battery, battery.TREND: _battery, result.PARAM_MISSING: _battery,
    "PM-SILENT": Reading(_silence_rows, lambda pack, f, rows: [r["entity_id"] for r in rows]
                         + sorted(pack.entities_of_device(pack.device_id_of(f["entity_id"]))),
                         lambda t, rows: N.silent_findings(t.client(), t.pack, t.states, t.at, t.params, t.Z, rows=rows)),
    "PM-RECONNECT-LOOP": Reading(lambda pack, f: [{"entity_id": f["entity_id"]}], lambda pack, f, rows: [f["entity_id"]],
                                 lambda t, rows: t.loops()),
    R.HIDDEN_IN_RULE: Reading(lambda pack, f: [{"entity_id": f["entity_id"]}], _none,
                              lambda t, rows: t.hidden()),
    "PM-POWER-CHANGE": _asset, "PM-ENERGY-CHANGE": _asset, "PM-RUNHOURS": _asset, "PM-RUN-SAG": _asset,
    "PM-EXPECTED-SILENT": _asset, result.COUNTER_RESET: _asset,
    "PM-LEVEL-HIGH": Reading(_level_rows, _none, lambda t, rows: t.level_day(rows), per_day=True),
}


class Unreadable(Exception):
    """Rules of the night check with no reading here (READS)."""


def unreadable() -> list[str]:
    """The night check's rules this recheck cannot read again, sorted — none, or the tick stops."""
    return sorted((N.STATE_RULES | N.EVENT_RULES) - set(READS) - {OFFLINE_RULE})


def loopbook(store, client, now: datetime, days: int):
    """The logbook of the `days` ending `now` for the reconnect loops, kept between ticks (LOOPBOOK): the rows since
    the last tick read and added, the ones older than the window dropped; only the rows a count needs are kept — the
    villa system's restarts and every row of an entity that went offline (a count reads no other). A read cut short
    is kept as far as it reached, and the next tick reads on from there."""
    start = now - timedelta(days=days)
    kept = store.cache_get(LOOPBOOK) or {}
    since = kept.get("end")
    since_at = datetime.fromisoformat(since) if since else None
    if since_at is None or since_at <= start or since_at > now:
        book = client.logbook_read(start, now, now=now)
        rows = book.rows
    else:
        book = client.logbook_read(since_at, now, now=now)
        rows = list(kept.get("rows") or []) + list(book.rows)
    rows = [r for r in rows if _at(r) is not None and _at(r) >= start]
    went = {r.get("entity_id") for r in rows if is_offline(r.get("state"))}
    rows = [r for r in rows if r.get("domain") == "homeassistant" or r.get("entity_id") in went]
    store.cache_put(LOOPBOOK, {"end": book.reach.isoformat(), "rows": rows})
    return Logbook(rows, start, now, None if book.whole else book.reach)


def _at(row: dict) -> datetime | None:
    try:
        return datetime.fromisoformat(str(row.get("when")))
    except ValueError:
        return None


def recheck_open(store, pack, client, now: datetime, params, zone: str, settle_minutes: float | None = None) -> dict:
    """Every open finding (the offline ones are back_online's) read again now, each by its rule's reading (READS): one
    still found is recorded as seen — a person's close that long ago or more no longer holds (Problems.wants_open) —,
    one no longer found closes, saying so with the time (nightly.cleared_note). Nothing else is touched: no new finding
    (the night opens those). Returns {actions, closed, seen}; Home Assistant is asked for nothing when nothing is open.

    ⚠️ NOT READ IS NOT GONE: a state the read did not bring back, a battery with no value now, or a reading that failed
    closes nothing — its close would say the problem is over when nothing was seen."""
    none = {"actions": [], "closed": [], "seen": [], "send": []}
    if unreadable():
        raise Unreadable(", ".join(unreadable()))
    open_ = [f for f in store.findings(status="open") if f["rule_id"] != OFFLINE_RULE]
    if not open_ or pack is None or client() is None:
        return none
    t = Tick(store, pack, client, now, params, zone)
    plan = []
    for f in open_:
        rule = READS[f["rule_id"]]
        rows = rule.rows(pack, f)
        if rows:
            plan.append((f, rule, rows, rule.entities(pack, f, rows)))
    ids = sorted({e for *_, es in plan for e in es})
    # a device asleep between its reports reads its last real state (vesta_shared.asleep): its battery fault is judged
    # on its charge, never left open on "unavailable"
    t.states = read_states(client(), pack, now, ids) if ids else {}
    read, seen, steps, handed, restated = [], [], [], {}, []
    for f, rule, rows, es in plan:
        st = t.states.get(f["entity_id"]) or {}
        if es and (not st or (f["rule_id"] in (battery.CRIT, battery.LOW) and not has_value(st.get("state")))):
            continue
        key = f"pm-dayread:{int(f['id'])}:{t.day.isoformat()}"
        was = store.cache_get(key) if rule.per_day else None
        if was is None:
            try:
                found = rule.found(t, rows)
            except Exception as e:  # noqa: BLE001 — a read that failed closes nothing; the next tick reads it again
                print(f"preventive-maintenance: {f['rule_id']} of {f['entity_id']} could not be read again "
                      f"({type(e).__name__})", file=sys.stderr)
                continue
            was = {"seen": any(x.rule_id == f["rule_id"] and x.entity_id == f["entity_id"] for x in found)}
            # a battery now at its other step: handed to that step's fault, opened now (nightly.battery_moved)
            moved = N.battery_moved([f], found)
            if moved:
                steps += [x for x in found if x.entity_id == f["entity_id"] and x.rule_id in battery.REPLACE]
                handed[int(f["id"])] = next(iter(moved.values()))
            elif f["rule_id"] in battery.REPLACE:
                # the same step at another whole level: its words say the level judged now (battery_restated)
                restated += [(int(f["id"]), x) for x in found
                             if x.rule_id == f["rule_id"] and x.entity_id == f["entity_id"] and battery_restated(f, x)]
            if rule.per_day:
                store.cache_put(key, was)
        read.append(f["id"])
        if was["seen"]:
            seen.append(f["id"])
    if not read:
        return none
    day = t.at.date().isoformat()
    rec = Problems(store).record_rechecked(read, seen, day, now.isoformat(), note=N.cleared_note(now, zone),
                                           settle_minutes=settle_minutes, handed=handed)
    if rec["closed"] or rec["handed"]:
        store.audit("preventive-maintenance", "recheck", {"read": read, "closed": rec["closed"], "handed": rec["handed"]})
    send, task_ids = [], rec["task_ids"]
    if restated:
        # raised again as the night raises it (Problems.record → store.raise_finding): its summary is the one title
        # every reader shows; its open task is named moved so the Kiosk's fault is retitled now (tickets.repair)
        Problems(store).record([x for _, x in restated], day, state_rules=N.STATE_RULES, event_rules=N.EVENT_RULES,
                               worsened_step=params.behaviour("worsened_step_pct"), at=now.isoformat(),
                               settle_minutes=settle_minutes)
        task_ids += [t["id"] for fid, _ in restated
                     if (t := store.last_task(f"finding:{fid}")) and t["status"] == "open"]
    if steps:
        new = Problems(store).record(steps, day, state_rules=N.STATE_RULES, event_rules=N.EVENT_RULES,
                                     worsened_step=params.behaviour("worsened_step_pct"), at=now.isoformat(),
                                     settle_minutes=settle_minutes)
        task_ids += new["task_ids"]
        send = N.told_now({"villa": pack.villa, "as_of": day, "new_findings": new["new"], "again": new["again"]},
                          title=f"{pack.villa or 'The villa'}, batteries on {day_time_label(t.at)}.", store=store, at=now)
    return {"actions": result.moved(task_ids), "closed": rec["closed"], "seen": rec["seen"], "send": send}


def battery_restated(row: dict, finding) -> bool:
    """Whether an open battery fault (`row`, as stored) read again at the same step (`finding`) is at another WHOLE
    percent: its words say the level as a whole number, and only a change they would show re-raises it.
    ⚠️ ONE LEVEL, ONE TITLE (review, 2026-10-23): the recheck kept the level it judged (battery.keep_judged) but only
    marked a battery still at its step as seen; its title changed only at night or on a step change, so the weekly page
    showed 15 % beside "battery at 18%", and the Kiosk's fault kept 18 %."""
    try:
        was = json.loads(row.get("detail") or "{}").get("level")
        now = finding.detail.get("level")
        return was is not None and now is not None and f"{float(was):.0f}" != f"{float(now):.0f}"
    except (TypeError, ValueError, AttributeError):
        return False


def reopened_untold(store, zone: str, settings: dict, edits: list | None = None) -> list[dict]:
    """The messages for the faults a person reopened in the Cockpit that nobody has been told of yet, each told once:
    to settings.yaml `reopened_in_kiosk.tell`, under its `title`, the body the one wording of a reopening
    (kiosk_words.reopened: who, when the Kiosk recorded it, what). Without the two settings nothing is sent and the
    tasks stay untold — named on stderr, never guessed. `edits` gets the rewrites of the messages that told them
    (nightly.told_again): a reopening said there is sent nothing more (owner, 2026-10-27: "I don't want a separate
    message"); one never told on a message is the only word of it, and is sent."""
    words = settings.get("reopened_in_kiosk") or {}
    to, title = str(words.get("tell") or ""), str(words.get("title") or "")
    rows = store.untold_reopenings()
    if not rows:
        return []
    if not (to and title):
        print("preventive-maintenance settings.yaml: reopened_in_kiosk needs `tell` (a role) and `title`: "
              f"{len(rows)} reopened fault(s) not told", file=sys.stderr)
        return []
    # said on its message only when its rewrite goes out with this run (`edits`): never marked and left unsaid
    out, (marked, said) = [], (N.told_again(store, rows, "reopened", zone, settings) if edits is not None else ([], set()))
    if edits is not None:
        edits += marked
    for t in rows:
        if int(t["id"]) not in said:
            out.append(result.message(to, kiosk_words.reopened(t.get("reopened_by") or "", t.get("reopened_at"), zone,
                                                               t.get("summary") or ""), title=title))
        store.reopening_told(t["id"])
    return out


def still_there_untold(store, zone: str, settings: dict, edits: list | None = None) -> list[dict]:
    """The messages for the night check's faults opened again because their problem was read still there after a
    person closed them (Problems.STILL_THERE) that nobody has been told of yet, each told once: to settings.yaml
    `still_there_after_close.tell`, under its `title`, its `words` ({when} the close, {what} the fault). Without them
    nothing is sent and the tasks stay untold — named on stderr, never guessed. `edits`: as reopened_untold's."""
    words = settings.get("still_there_after_close") or {}
    to, title, body = (str(words.get(k) or "") for k in ("tell", "title", "words"))
    rows = store.untold_findings_reopened(STILL_THERE)
    if not rows:
        return []
    if not (to and title and body):
        print("preventive-maintenance settings.yaml: still_there_after_close needs `tell` (a role), `title` and `words`: "
              f"{len(rows)} reopened fault(s) not told", file=sys.stderr)
        return []
    # said on its message only when its rewrite goes out with this run (`edits`): never marked and left unsaid
    out, (marked, said) = [], (N.told_again(store, rows, "still", zone, settings) if edits is not None else ([], set()))
    if edits is not None:
        edits += marked
    for t in rows:
        if int(t["id"]) not in said:
            what = Problems(store).current_title(t)
            out.append(result.message(to, body.replace("{when}", kiosk_words.when(t.get("done_at"), zone))
                                      .replace("{what}", what.rstrip(".")), title=title))
        store.reopening_told(t["id"])
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    script.arguments(ap, pack=True)
    a = ap.parse_args(argv)
    ctx = script.Context(a, skill=os.path.dirname(HERE))
    now = datetime.fromisoformat(a.now) if getattr(a, "now", None) else datetime.now(timezone.utc)
    settle = N.still_there_minutes(ctx.settings)
    res = back_online(ctx.store, lambda: ctx.live_client, now, ctx.params.behaviour("back_online_minutes"), ctx.zone,
                      ctx.pack)
    try:
        again = recheck_open(ctx.store, ctx.pack, lambda: ctx.live_client, now, ctx.params, ctx.zone, settle)
    except Unreadable as e:
        # the last stderr line is what Overview › Scheduled jobs run says of a stopped run
        print(f"preventive-maintenance cannot read these checks again: {e}", file=sys.stderr)
        return 1
    found = gone_offline(ctx.store, ctx.pack, lambda: ctx.live_client, now, ctx.params, ctx.zone, settle)
    closed = res["closed"] + again["closed"]
    # a close sends nothing new: a P2 told earlier says it on its own message (told_cleared, owner 2026-10-20) — and an
    # offline fault an alert took over says so there; a reopening is told anew AND marked on that message
    edits = N.told_cleared(ctx.store, closed, now, ctx.zone, ctx.settings, handed=res["handed"])
    told = again["send"] + reopened_untold(ctx.store, ctx.zone, ctx.settings, edits) + still_there_untold(
        ctx.store, ctx.zone, ctx.settings, edits)
    print(json.dumps({"actions": result.moved(res["actions"] + again["actions"] + found["actions"]),
                      "send": found["send"] + told, "edits": N.one_edit_per_message(edits),
                      result.FAULTS_CHANGED: bool(closed or res["handed"] or again["actions"] or found["actions"])},
                     default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
