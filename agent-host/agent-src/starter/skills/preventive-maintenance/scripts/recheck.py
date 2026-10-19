#!/usr/bin/env python3
"""Every 5 minutes: a device gone offline gets its fault now; one found offline that is back closes it now; so does
any fault about a device deleted from Home Assistant. With `day` (at the times of the schedule entries marked
`kiosk: day_check`): the night's open findings of the rules skill.yaml `day_rechecks` names, read again — and only those.

  python recheck.py --store vesta_store.sqlite [--pack pack.json] [--fixture-dir DIR] [--now 2026-10-10T14:00:00+00:00]
  python recheck.py day --store vesta_store.sqlite [--pack pack.json] …

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
the close."), and its `tell` is told once, under its `title` (still_there_untold — a night check's reopening too).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
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
from vesta_shared.device_state import has_value  # noqa: E402



def rechecked(skill_dir: str = os.path.dirname(HERE)) -> set[str]:
    """The rules whose findings are read again here: the skill's own `rechecks` (skill.yaml) — what the Kiosk's card
    says "Next check: within 5 min" of (architecture review, 2026-10-15: this script kept its own copy of that list)."""
    import yaml
    with open(os.path.join(skill_dir, "skill.yaml"), encoding="utf-8") as f:
        return set((yaml.safe_load(f) or {}).get("rechecks") or [])
def day_rechecked(skill_dir: str = os.path.dirname(HERE)) -> set[str]:
    """The rules whose open findings the day recheck reads again (`recheck.py day`, at the times of the schedule entries
    marked `kiosk: day_check`): the skill's own `day_rechecks` (skill.yaml) — what the Kiosk's card says "Next check: at
    12:00" of. Only those this script knows how to read for one finding (DAY_READS) are read; another is named on
    stderr and keeps its nightly check."""
    import yaml
    with open(os.path.join(skill_dir, "skill.yaml"), encoding="utf-8") as f:
        return set((yaml.safe_load(f) or {}).get("day_rechecks") or [])


GONE_NOTE = "Closed: this device no longer exists in the villa's system."
ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")     # only a real entity id can be "not found"


def back_online(store, client, now: datetime, minutes: float, zone: str) -> dict:
    """{closed: [finding ids], gone: [the ones whose devices no longer exist], actions: [the Kiosk faults to resolve]}.
    `client()`: Home Assistant, asked for only when a finding is open."""
    rows = store.findings(status="open")
    if not rows or client() is None:
        return {"closed": [], "gone": [], "actions": []}
    ents = {f["id"]: json.loads(f.get("detail") or "{}").get("entities") or [f["entity_id"]] for f in rows}
    ids = sorted({e for es in ents.values() for e in es if ENTITY_ID.match(str(e))})
    states = client().states(ids)
    # only what has no state is asked about: "not found" is Home Assistant's answer, a missing row is not
    gone = client().not_found([e for e in ids if e not in states]) if len(states) < len(ids) else set()
    day = now.astimezone(ZoneInfo(zone)).date().isoformat()
    closed, deleted, moved, rules = [], [], [], rechecked()
    for f in rows:
        es = ents[f["id"]]
        if es and all(e in gone for e in es):
            moved += Problems(store).close_finding(f, day, GONE_NOTE)
            closed.append(f["id"]); deleted.append(f["id"])
        elif f["rule_id"] in rules and out_for(client(), [e for e in es if e not in gone], states, OFFLINE, now,
                                                      minutes, unknown_tells=True):
            moved += Problems(store).close_finding(f, day, "Cleared: back online.")
            closed.append(f["id"])
    if closed:
        store.audit("preventive-maintenance", "back_online", {"findings": closed, "gone": deleted})
    return {"closed": closed, "gone": deleted, "actions": result.moved(moved)}


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
    for f in N.offline_findings(pack, client().states(ids), at, params, set(N.alerted_offline(store, pack))):
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
                      title=f"{pack.villa or 'The villa'}, devices offline on {day_time_label(at)}.")
    store.audit("preventive-maintenance", "gone_offline", {"findings": [d["id"] for d in rec["new"] + rec["again"]]})
    return {"actions": actions, "send": send, "found": [d["id"] for d in rec["new"] + rec["again"]]}


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


#: How the day recheck reads one open finding again, per rule — {rule: (its rows, the entities whose state is read for
#: them, what the night's own function finds over them)}. A rule absent here is not read in the day: it keeps its nightly
#: check (the Kiosk card says so only when skill.yaml `day_rechecks` leaves it out, test_day_recheck holds them equal).
#: ⚠️ ONLY WHAT A SHORT READ CAN SAY (owner, 2026-10-19): a battery's level and a quiet sensor are read now, as the night
#: reads them. A pump's draw and use (PM-POWER-CHANGE, PM-ENERGY-CHANGE, PM-RUNHOURS) and a temperature's day
#: (PM-LEVEL-HIGH) are judged on a FINISHED day — at 12:00 the day is half there and would close what the next night
#: opens again. An offline device is recheck.py's every 5 minutes (`rechecks`).
#: ⚠️ A RECONNECT LOOP TOO (owner, 2026-10-20: 17 false loops waited for the night to close): the villa-wide logbook of
#: the last `reconnect_days`, the night's own reading (nightly.reconnect_findings), read ONCE per day recheck whatever
#: the number of loops open (_loops).
DAY_READS = {
    "PM-BATTERY-CRIT": (_battery_rows, lambda pack, f, rows: [r["entity_id"] for r in rows],
                        lambda c, pack, states, now, params, Z, rows: N.battery_findings(pack, states, params, now.date(),
                                                                                         rows=rows)),
    "PM-SILENT": (_silence_rows,
                  lambda pack, f, rows: [r["entity_id"] for r in rows]
                  + sorted(pack.entities_of_device(pack.device_id_of(f["entity_id"]))),
                  lambda c, pack, states, now, params, Z, rows: N.silent_findings(c, pack, states, now, params, Z,
                                                                                  rows=rows)),
}
DAY_READS["PM-BATTERY-LOW"] = DAY_READS["PM-BATTERY-CRIT"]

_LOOPS: dict = {}


def _loops(c, pack, states, now, params, Z, rows) -> list:
    """The reconnect loops of the days ending now — read once per day recheck (one logbook read for every loop open)."""
    key = (id(c), now.isoformat())
    if key not in _LOOPS:
        _LOOPS.clear()
        _LOOPS[key] = N.reconnect_findings(c, pack, states, now, now.date(), params, str(Z), Z, now)[0]
    return _LOOPS[key]


DAY_READS["PM-RECONNECT-LOOP"] = (lambda pack, f: [{"entity_id": f["entity_id"]}],
                                  lambda pack, f, rows: [f["entity_id"]], _loops)


def day_recheck(store, pack, client, now: datetime, params, zone: str, settle_minutes: float | None = None,
                rules: set[str] | None = None) -> dict:
    """The night's open findings of `rules` (skill.yaml `day_rechecks`) read again now, each by its own rule over its
    own device (DAY_READS, the night's functions): one still found is recorded as seen — a person's close that long ago
    or more no longer holds (Problems.wants_open) —, one no longer found closes, saying so with the time
    (nightly.cleared_note). Nothing else is touched: no other finding, no new one (the night opens those). Returns
    {actions, closed, seen}; Home Assistant is asked for nothing when no such finding is open.

    ⚠️ NOT THE NEXT NIGHT (owner, 2026-10-19: "instead of waiting 24h to recheck the faults found during the nightly
    check, refresh the open ones every 4 hours during the days"): a battery changed at 09:00 stayed an open fault in the
    Cockpit until 02:00 the next night. A reading that fails, or an entity whose state was not read, closes nothing."""
    none = {"actions": [], "closed": [], "seen": []}
    rules = day_rechecked() if rules is None else rules
    for r in sorted(rules - set(DAY_READS)):
        print(f"preventive-maintenance: {r} cannot be read again in the day: it keeps its nightly check", file=sys.stderr)
    open_ = [f for f in store.findings(status="open") if f["rule_id"] in rules and f["rule_id"] in DAY_READS]
    if not open_ or pack is None or client() is None:
        return none
    Z = ZoneInfo(zone)
    at = now.astimezone(Z)
    plan = []
    for f in open_:
        rows_of, ids_of, _ = DAY_READS[f["rule_id"]]
        rows = rows_of(pack, f)
        if rows:
            plan.append((f, rows, ids_of(pack, f, rows)))
    states = client().states(sorted({e for _, _, ids in plan for e in ids})) if plan else {}
    rechecked, seen = [], []
    for f, rows, _ in plan:
        st = states.get(f["entity_id"]) or {}
        # ⚠️ NOT READ IS NOT GONE: a state the read did not bring back (a timeout), or a battery with no value now,
        # leaves the finding to the night — its close would say the problem is over when nothing was seen
        if not st or (f["rule_id"] in (battery.CRIT, battery.LOW) and not has_value(st.get("state"))):
            continue
        try:
            found = DAY_READS[f["rule_id"]][2](client(), pack, states, at, params, Z, rows)
        except Exception as e:  # noqa: BLE001 — a read that failed closes nothing; the night reads it again
            print(f"preventive-maintenance: {f['rule_id']} of {f['entity_id']} could not be read again "
                  f"({type(e).__name__})", file=sys.stderr)
            continue
        rechecked.append(f["id"])
        if any(x.rule_id == f["rule_id"] and x.entity_id == f["entity_id"] for x in found):
            seen.append(f["id"])
    if not rechecked:
        return none
    rec = Problems(store).record_rechecked(rechecked, seen, at.date().isoformat(), now.isoformat(),
                                           note=N.cleared_note(now, zone), settle_minutes=settle_minutes)
    store.audit("preventive-maintenance", "day_recheck", {"read": rechecked, "closed": rec["closed"]})
    return {"actions": result.moved(rec["task_ids"]), "closed": rec["closed"], "seen": rec["seen"]}


def reopened_untold(store, zone: str, settings: dict) -> list[dict]:
    """The messages for the faults a person reopened in the Cockpit that nobody has been told of yet, each told once:
    to settings.yaml `reopened_in_kiosk.tell`, under its `title`, the body the one wording of a reopening
    (kiosk_words.reopened: who, when the Kiosk recorded it, what). Without the two settings nothing is sent and the
    tasks stay untold — named on stderr, never guessed."""
    words = settings.get("reopened_in_kiosk") or {}
    to, title = str(words.get("tell") or ""), str(words.get("title") or "")
    rows = store.untold_reopenings()
    if not rows:
        return []
    if not (to and title):
        print("preventive-maintenance settings.yaml: reopened_in_kiosk needs `tell` (a role) and `title`: "
              f"{len(rows)} reopened fault(s) not told", file=sys.stderr)
        return []
    out = []
    for t in rows:
        out.append(result.message(to, kiosk_words.reopened(t.get("reopened_by") or "", t.get("reopened_at"), zone,
                                                           t.get("summary") or ""), title=title))
        store.reopening_told(t["id"])
    return out


def still_there_untold(store, zone: str, settings: dict) -> list[dict]:
    """The messages for the night check's faults opened again because their problem was read still there after a
    person closed them (Problems.STILL_THERE) that nobody has been told of yet, each told once: to settings.yaml
    `still_there_after_close.tell`, under its `title`, its `words` ({when} the close, {what} the fault). Without them
    nothing is sent and the tasks stay untold — named on stderr, never guessed."""
    words = settings.get("still_there_after_close") or {}
    to, title, body = (str(words.get(k) or "") for k in ("tell", "title", "words"))
    rows = store.untold_findings_reopened(STILL_THERE)
    if not rows:
        return []
    if not (to and title and body):
        print("preventive-maintenance settings.yaml: still_there_after_close needs `tell` (a role), `title` and `words`: "
              f"{len(rows)} reopened fault(s) not told", file=sys.stderr)
        return []
    out = []
    for t in rows:
        what = Problems(store).current_title(t)
        out.append(result.message(to, body.replace("{when}", kiosk_words.when(t.get("done_at"), zone))
                                  .replace("{what}", what.rstrip(".")), title=title))
        store.reopening_told(t["id"])
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    script.arguments(ap, pack=True)
    ap.add_argument("what", nargs="?", choices=["day"],
                    help="day: the day recheck of the night's open findings (skill.yaml `day_rechecks`), at the times "
                         "of the schedule entries marked `kiosk: day_check` — nothing else")
    a = ap.parse_args(argv)
    ctx = script.Context(a, skill=os.path.dirname(HERE))
    now = datetime.fromisoformat(a.now) if getattr(a, "now", None) else datetime.now(timezone.utc)
    if a.what == "day":
        day = day_recheck(ctx.store, ctx.pack, lambda: ctx.live_client, now, ctx.params, ctx.zone,
                          N.still_there_minutes(ctx.settings))
        # the night's own rule for a close: nobody is messaged (told_now tells what is new or back, never a close);
        # the Kiosk's faults follow through the engine's repair
        print(json.dumps({"actions": day["actions"], "send": [], result.FAULTS_CHANGED: bool(day["actions"])},
                         default=str))
        return 0
    res = back_online(ctx.store, lambda: ctx.live_client, now, ctx.params.behaviour("back_online_minutes"), ctx.zone)
    found = gone_offline(ctx.store, ctx.pack, lambda: ctx.live_client, now, ctx.params, ctx.zone,
                         N.still_there_minutes(ctx.settings))
    told = reopened_untold(ctx.store, ctx.zone, ctx.settings) + still_there_untold(ctx.store, ctx.zone, ctx.settings)
    print(json.dumps({"actions": result.moved(res["actions"] + found["actions"]), "send": found["send"] + told,
                      result.FAULTS_CHANGED: bool(res["closed"] or found["actions"])}, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
