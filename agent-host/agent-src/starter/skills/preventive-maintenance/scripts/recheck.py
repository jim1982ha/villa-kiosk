#!/usr/bin/env python3
"""Every 5 minutes: a device gone offline gets its fault now; one found offline that is back closes it now; so does
any fault about a device deleted from Home Assistant.

  python recheck.py --store vesta_store.sqlite [--pack pack.json] [--fixture-dir DIR] [--now 2026-10-10T14:00:00+00:00]

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



def rechecked(skill_dir: str = os.path.dirname(HERE)) -> set[str]:
    """The rules whose findings are read again here: the skill's own `rechecks` (skill.yaml) — what the Kiosk's card
    says "Next check: within 5 min" of (architecture review, 2026-10-15: this script kept its own copy of that list)."""
    import yaml
    with open(os.path.join(skill_dir, "skill.yaml"), encoding="utf-8") as f:
        return set((yaml.safe_load(f) or {}).get("rechecks") or [])
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
    a = ap.parse_args(argv)
    ctx = script.Context(a, skill=os.path.dirname(HERE))
    now = datetime.fromisoformat(a.now) if getattr(a, "now", None) else datetime.now(timezone.utc)
    res = back_online(ctx.store, lambda: ctx.live_client, now, ctx.params.behaviour("back_online_minutes"), ctx.zone)
    found = gone_offline(ctx.store, ctx.pack, lambda: ctx.live_client, now, ctx.params, ctx.zone,
                         N.still_there_minutes(ctx.settings))
    told = reopened_untold(ctx.store, ctx.zone, ctx.settings) + still_there_untold(ctx.store, ctx.zone, ctx.settings)
    print(json.dumps({"actions": result.moved(res["actions"] + found["actions"]), "send": found["send"] + told,
                      result.FAULTS_CHANGED: bool(res["closed"] or found["actions"])}, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
