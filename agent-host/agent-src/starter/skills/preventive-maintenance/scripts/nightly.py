#!/usr/bin/env python3
"""Nightly maintenance batch: one batched read, features, rules, findings.

  python nightly.py --pack pack.json --store vesta_store.sqlite [--fixture-dir DIR] [--as-of 2026-09-21] [--out result.json]

Reads (one pass, never a loop during the day):
  hourly statistics  (mean/min/max) for every power and level entity, baseline window
  daily statistics   (change) for every energy and water entity
  raw history 24 h   for continuous power assets (within-run sag)
  current states     for availability, silence and battery levels
  logbook 3 days     for reconnect loops

Writes: the feature store and the findings table in the agent store. It
never writes to Home Assistant. The result JSON lists what the agent should
now do: create tasks (Kiosk tickets), send a P2 at once, ask the owner about
new devices. The agent does those through the action catalogue.

--as-of replays a past night: the batch only sees data up to that day. The
replay test runs every night of the last 30 days this way.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, time, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from vesta_shared import script  # noqa: E402  (client, pack, store, settings, zone: one set-up)
from vesta_shared.messaging import incident_tag, no_code as _no_code  # noqa: E402
from vesta_shared.timeutil import day_label, day_time_label, villa_day  # noqa: E402
from vesta_shared.past import unread  # noqa: E402  (the one "could not be read whole: nothing is known after")
from vesta_shared.message_format import document, split_title  # noqa: E402  (the one shape of a message)
from vesta_shared.device_state import has_value, is_offline  # noqa: E402
from vesta_shared.offline import devices_offline  # noqa: E402  (the one reading of "offline now")
from vesta_shared.problems import Problems, again_title  # noqa: E402  (a problem's lifecycle: one owner)
from vesta_shared import result  # noqa: E402  (what the engine is asked to do: its shape; R is rules.py)
from vesta_shared import daily  # noqa: E402  (a device's day: the one running threshold)
from vesta_shared.timeutil import schedule_hours_per_day  # noqa: E402
import features as F  # noqa: E402
import rules as R  # noqa: E402

STATE_RULES = {"PM-POWER-CHANGE", "PM-ENERGY-CHANGE", "PM-UNAVAILABLE",
               "PM-BATTERY-LOW", "PM-BATTERY-CRIT", "PM-SILENT", "PM-RECONNECT-LOOP", "PM-LEVEL-HIGH",
               result.PARAM_MISSING}
EVENT_RULES = {"PM-RUNHOURS", "PM-RUN-SAG", "PM-EXPECTED-SILENT", result.COUNTER_RESET, "PM-BATTERY-TREND"}


def run(args) -> dict:
    ctx = script.Context.of(args, skill=os.path.dirname(HERE))   # client, pack, store, settings, zone: one set-up
    args = ctx.args
    cli, pack, store, params = ctx.client, ctx.pack, ctx.store, ctx.params
    zone = ctx.zone
    Z = ctx.Z
    # ⚠️ THE DAY JUDGED IS THE LAST FINISHED ONE (villa, 2026-10-04): the batch runs at 02:00 and judged
    # the date it ran on — two hours of data — so a pump's "last 2 days" were yesterday and a 2-hour
    # stub: "Onsen pump used 0.09 kWh/day against a normal 0.48". --as-of names the day to judge.
    today = villa_day(Z, args.as_of, last_finished=True)
    day_end = datetime.combine(today + timedelta(days=1), time(0, 0), tzinfo=Z)
    baseline_days = int(params.behaviour("baseline_days")) + int(params.behaviour("confirm_days")) + 2
    win_start = day_end - timedelta(days=baseline_days)

    findings: list[R.Finding] = []
    notes: list[str] = []
    features_written = 0
    now_ref = day_end if args.as_of else datetime.now(Z)       # no reading of the past goes beyond it

    # ---- power assets -------------------------------------------------------
    power_entities = [r["entity_id"] for r in pack.entities("power")]
    hour_stats = cli.statistics(power_entities, win_start, day_end, "hour", ("mean", "min", "max")) if power_entities else {}
    energy_entities = [r["entity_id"] for r in pack.entities("energy")] + [r["entity_id"] for r in pack.entities("water")]
    day_stats = cli.statistics(energy_entities, win_start, day_end, "day", ("change", "sum")) if energy_entities else {}

    for slug, asset in pack.assets.items():
        p_eid = asset["entities"].get("power")
        e_eid = asset["entities"].get("energy")
        if not p_eid and not e_eid:
            continue
        # physics is for motors. Lighting circuits and meters are read by roi-energy, never chased here.
        if asset.get("kind", "appliance") in ("lighting", "meter"):
            continue
        p_series, e_series = {}, {}
        if p_eid:
            rows = hour_stats.get(p_eid, [])
            thr = daily.running_threshold(asset, rows, params)       # the one "running" (vesta_shared.daily)
            p_series = F.power_daily_features(rows, zone, thr)
            # raw runs for the closing day
            if not args.skip_raw:
                got = cli.history_read([p_eid], day_end - timedelta(days=1), day_end, now=now_ref)
                raw = got.rows.get(p_eid, [])
                if raw:
                    runs = F.runs_from_history(raw, thr, zone)
                    if not got.whole(p_eid):
                        # ⚠️ A RUN GOING WHERE THE READING STOPPED HAS NO KNOWN END (round 2, 2026-10-16): its minutes
                        # and its sag were read as if it had ended there; the runs after it were never read
                        runs = F.ended_runs(runs, raw, thr, zone)
                        notes.append(f"{asset['name']}: "
                                     + unread("its power for the day", day_time_label(got.reach(p_eid).astimezone(Z)))
                                     + " — its runs after that are not counted.")
                    p_series.setdefault(today, {}).update({"runs": runs})
            if today in p_series:
                f = p_series[today]
                for k in ("run_hours", "full_hours", "running_power", "peak_w", "gap_hours"):
                    store.put_feature(today.isoformat(), p_eid, "power", k, f.get(k))
                    features_written += 1
        if e_eid:
            e_series = F.energy_daily_features(day_stats.get(e_eid, []), zone)
            if p_eid:
                # ⚠️ A DAY THE METER WAS OFFLINE IS NOT A DAY OF LOW USE (villa, 2026-10-04): the plug was
                # off Wi-Fi for 10 h and its day's kWh read as an 80 % collapse. Offline is PM-UNAVAILABLE's.
                # A day with NO power row counts as offline only from the plug's first data to the day judged:
                # before its first day the plug's history simply was not there (a newer sensor), and
                # dropping those days starved the baseline (villa replay: a real collapse found 16 days late).
                gap_limit = params.behaviour("energy_gap_hours")
                covered = (min(p_series), today) if p_series else None

                def offline(d):
                    if d in p_series:
                        return (p_series[d].get("gap_hours") or 0) >= gap_limit
                    return covered is not None and covered[0] <= d <= covered[1]
                e_series = {d: v for d, v in e_series.items() if not offline(d)}
            if today in e_series:
                store.put_feature(today.isoformat(), e_eid, "energy", "kwh", e_series[today]["kwh"])
                features_written += 1
        expected = None
        if asset.get("schedule"):
            sch = params.schedule(asset["schedule"].split(".", 1)[1])
            if sch:
                expected = schedule_hours_per_day(sch)
                if not any(expected.values()):
                    notes.append(f"{asset['name']}: schedule {asset['schedule']} has no time blocks, run-hours rule off.")
                    expected = None
        prior = {}
        for eid in (p_eid, e_eid):
            for rid in ("PM-POWER-CHANGE", "PM-ENERGY-CHANGE"):
                o = store.open_finding(rid, eid) if eid else None
                if o:
                    prior[rid] = json.loads(o["detail"] or "{}")
        if p_eid:
            findings += R.power_rules(asset, p_eid, p_series, today, params, expected, e_series or None, prior)
        elif e_eid and expected:
            findings += R.power_rules(asset, e_eid, {}, today, params, expected, e_series, prior)

    # ---- batteries, availability, silence, levels (current states) -----------
    states = cli.states()
    battery_entities = [r["entity_id"] for r in pack.entities("battery")]
    bat_stats = cli.statistics(battery_entities, day_end - timedelta(days=14), day_end, "day", ("mean",)) if battery_entities else {}
    for row in pack.entities("battery"):
        asset = _device_named(pack, pack.assets.get(row["asset"], {"slug": row["asset"], "name": row["name"],
                                                                   "critical": False}), row["entity_id"])
        st = states.get(row["entity_id"], {})
        try:
            level = float(st.get("state")) if has_value(st.get("state")) else None
        except ValueError:
            level = None
        series = [(str(r["start"]), r["mean"]) for r in bat_stats.get(row["entity_id"], []) if r.get("mean") is not None]
        findings += R.battery_rules(asset, row["entity_id"], row.get("unit"), level, series, params, today)

    alerted = alerted_offline(store, pack)
    findings += offline_findings(pack, states, now_ref, params, set(alerted))
    # an offline fault open from before its alert: the alert follows the device now — closed as handed over, never
    # "cleared" while the device is still off (Problems.record_night)
    handed_over = {(o["rule_id"], o["entity_id"]): f"Followed by alert {incident_tag(alerted[dev])}, which says when it is back."
                   for o in store.findings(status="open") if o["rule_id"] == "PM-UNAVAILABLE"
                   for dev in [pack.physical_device_of(o["entity_id"]) or o["entity_id"]] if dev in alerted}
    quiet_rows: list[tuple[dict, dict, datetime]] = []
    for fam in ("level",):                       # silence: a level sensor online and quiet
        for row in pack.entities(fam):
            st = states.get(row["entity_id"])
            if not st:
                continue
            asset = pack.assets.get(row["asset"], {"slug": row["asset"], "name": row["name"], "critical": False})
            lc = st.get("last_changed")
            if not is_offline(st.get("state")) and st.get("state") != "unknown":
                # ⚠️ SILENT MEANS NOT REPORTING, NOT UNCHANGED (villa, 2026-10-01): last_reported moves at
                # each report (HA 2024.3+). But many integrations write only on a CHANGE, and every
                # restart stamps all of them (villa, 2026-10-04) — so quiet alone proves nothing; the
                # sensor's own history decides below whether it normally reports all the time.
                lr = st.get("last_reported") or lc
                try:
                    since = datetime.fromisoformat(lr).astimezone(Z) if lr else None
                except ValueError:
                    since = None
                if since is not None:
                    quiet_rows.append((row, asset, since))
    # silence: one finding per device, and only for a sensor that normally reports all the time
    silence_hours = params.behaviour("silence_hours")
    long_quiet = [(r, a, t) for r, a, t in quiet_rows if (now_ref - t).total_seconds() / 3600 >= silence_hours
                  and not _device_still_talks(pack, states, r["entity_id"], now_ref, silence_hours)]
    if long_quiet:
        # judged on the hours just BEFORE it went quiet (features.reporting_share)
        hist_hours = int(params.behaviour("silence_history_hours"))
        share_min = params.behaviour("silence_reporting_share")
        q_from = min(t for _, _, t in long_quiet) - timedelta(hours=hist_hours)
        q_stats = cli.statistics([r["entity_id"] for r, _, _ in long_quiet], q_from, now_ref, "hour", ("mean", "min", "max"))
        silent_groups: dict[str, dict] = {}
        for row, asset, since in long_quiet:
            share, hours = F.reporting_share(q_stats.get(row["entity_id"], []), int(since.timestamp() * 1000), hist_hours)
            if share is None or hours < params.behaviour("silence_min_history_hours") or share < share_min:
                continue                  # reports on change only, or too little history to say: not a fault
            key = pack.device_key(row["entity_id"], row)
            g = silent_groups.setdefault(key, {"asset": asset, "entity_id": row["entity_id"], "since": since, "names": []})
            g["names"].append(row["name"])
            g["since"] = min(g["since"], since)
        for g in silent_groups.values():
            a = dict(g["asset"])
            a["name"] = F.device_name(g["names"])
            a = _device_named(pack, a, g["entity_id"])
            findings += R.silence_rules(a, g["entity_id"], (now_ref - g["since"]).total_seconds() / 3600, params, now=now_ref)

    level_rows = [r for r in pack.entities("level")
                  if params.has(f"{r['asset']}_max_c") or params.has(f"{r['asset']}_max_humidity_pct")]
    level_entities = [r["entity_id"] for r in level_rows]
    lvl_stats = cli.statistics(level_entities, day_end - timedelta(days=2), day_end, "hour", ("mean", "min", "max")) if level_entities else {}
    for row in level_rows:
        asset = pack.assets.get(row["asset"], {"slug": row["asset"], "name": row["name"]})
        series = F.level_daily_features(lvl_stats.get(row["entity_id"], []), zone)
        findings += R.level_rules(asset, row["entity_id"], row.get("device_class"), series, today, params)

    # ---- forensics: reconnect loops from the logbook -------------------------
    try:
        book = cli.logbook_read(day_end - timedelta(days=int(params.behaviour("reconnect_days"))), day_end, now=now_ref)
        lb = book.rows
    except Exception:  # logbook is optional
        book, lb = None, []
    if book is not None and not book.whole:
        # a count from a read cut short is a floor, said where the night's notes are read
        notes.append(unread("The logbook", day_time_label(book.reach.astimezone(Z))) + " — reconnect counts may be low.")
    flips = F.flips_per_day(lb, zone, params.behaviour("restart_settle_minutes"))
    # ONE finding per DEVICE, named as a person reads it (villa, 2026-10-04: a relay, its firmware
    # entity and its uptime sensor were three lines, two of them raw entity ids)
    rows_by_eid = {r["entity_id"]: r for fam in pack.families for r in pack.entities(fam)}
    by_device: dict[str, dict] = {}
    # ⚠️ A HIDDEN ENTITY IS NOT CHECKED (owner, 2026-10-19: the LG TV, hidden in the villa's system, was a "dropped and
    # reconnected 10 times" fault): the logbook lists every entity, and this was the one check that read past the
    # pack's own rule (knowledge_pack: hidden entities left out of every family, `pack.hidden`)
    hidden = set(pack.hidden)
    for eid, per_day in flips.items():
        if eid in hidden:
            continue
        row = rows_by_eid.get(eid, {})
        slug = row.get("asset") or next((s for s, a in pack.assets.items() if eid in a["entities"].values()), None)
        # ⚠️ ITS DEVICE, CLASSIFIED OR NOT (2026-10-13): a relay's uptime sensor is in no family, had no device, and its
        # drops were a second fault for the same relay
        key = pack.device_key(eid, {**row, "asset": row.get("asset") or slug})
        g = by_device.setdefault(key, {"eid": _standing_entity(pack, eid, rows_by_eid), "slug": slug,
                                       "name": row.get("name"), "per_day": {}})
        for d, n in per_day.items():
            g["per_day"][d] = max(g["per_day"].get(d, 0), n)      # the device's drops, not the sum of its entities'
        g["name"] = g["name"] or row.get("name")
    window_start = day_end - timedelta(days=int(params.behaviour("reconnect_days")))
    for g in by_device.values():
        asset = dict(pack.assets.get(g["slug"], {"slug": g["slug"] or g["eid"]}))
        asset["name"] = asset.get("name") or g["name"] or _plain_name(g["eid"])
        findings += R.flap_rules(_device_named(pack, asset, g["eid"]), g["eid"], g["per_day"], today, params,
                                 restarted=_restarted(pack, states, g["eid"], window_start))

    # ---- persist findings, dedup, close ---------------------------------------
    # the night's ledger is Problems' (vesta_shared/problems.py); what is a state, an event, worse, a task: here
    night = Problems(store).record_night(
        findings, today.isoformat(), state_rules=STATE_RULES,
        event_rules=EVENT_RULES, worsened_step=params.behaviour("worsened_step_pct"),
        resolved_note="Cleared: the nightly check no longer sees it.", handed_over=handed_over,
        settle_minutes=still_there_minutes(ctx.settings))
    new, still_open, closed, tasks = night["new"], night["still_open"], night["closed"], night["task_ids"]
    again = night["again"]
    resolved = night["resolved"]
    store.beat("maintenance_nightly", day_end.astimezone(timezone.utc).isoformat())
    store.audit("preventive-maintenance", "nightly", {"as_of": today.isoformat(), "new": len(new), "closed": len(closed)})

    result = {"as_of": today.isoformat(), "villa": pack.villa, "features_written": features_written,
              "new_findings": new, "still_open": still_open, "closed": closed, "handed_over": night["handed_over"], "again": again,
              "tasks_to_create": tasks, "tasks_resolved": resolved, "notes": notes}
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=1, default=str)
    return result


def still_there_minutes(settings: dict) -> float | None:
    """settings.yaml `still_there_after_close.minutes`: how long after a person's close a reading still bad opens the
    fault again (Problems.wants_open). None — named on stderr, never guessed — when the settings give none: a person's
    close then holds."""
    v = (settings.get("still_there_after_close") or {}).get("minutes")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    print("preventive-maintenance settings.yaml: still_there_after_close needs `minutes`: a fault closed while its "
          "problem is still there stays closed", file=sys.stderr)
    return None


#: The families whose devices are read for being offline (and, for `level`, silent).
WATCHED_FAMILIES = ("power", "energy", "security", "level", "runtime", "water", "generation")


def alerted_offline(store, pack) -> dict[str, int]:
    """The devices (pack.device_id_of, else the entity) an open alert already follows for being offline, each with that
    alert's number: an alert whose bad states hold "unavailable" (the alert desk's incidents).

    ⚠️ ONE PROBLEM, ONE FAULT (architecture review, offline devices #3, 2026-10-18): a lock the villa's own rule alerted
    on at 10 minutes (#, Telegram card, its Kiosk fault) got a second fault "offline for …" from this check, with its
    own message at 02:00 — and, once recheck.py opened faults every 5 minutes, at the same minute."""
    out: dict[str, int] = {}
    for inc in store.incidents(open_only=True):
        p = json.loads(inc.get("payload") or "{}")
        if "unavailable" not in (p.get("bad_states") or []):
            continue
        for e in (p.get("entities") or []) + [inc.get("entity_id")]:
            if e:
                out.setdefault(pack.physical_device_of(e) or e, int(inc["id"]))   # its whole device: a phase is its meter's
    return out


def offline_findings(pack, states: dict, now: datetime, params, alerted: set[str] = frozenset()) -> list:
    """The devices offline now, as PM-UNAVAILABLE findings — for the night check and for recheck.py every 5 minutes,
    from the ONE reading of "offline now" (vesta_shared.offline.devices_offline, the reports' and the concierge's too)
    over this skill's WATCHED_FAMILIES, with its settings: `unavailable_minutes`, `integration_down_devices`. One
    finding per physical device, never one per entity; an integration down: one finding, worded here.

    ⚠️ FOUND AT ONCE, NOT AT 02:00 (owner, 2026-10-18 — architecture review, offline devices #1): Timmerflotte_5969
    dropped at 21:46 and stood "Unavailable" in the Cockpit for 4 h 14 min before the night check opened its fault —
    the recheck read every 5 minutes whether a device was BACK, never whether one had gone."""
    out = []
    for g in devices_offline(pack, states, now, WATCHED_FAMILIES, min_minutes=params.behaviour("unavailable_minutes"),
                             alerted=frozenset(alerted), integration_min=params.behaviour("integration_down_devices")):
        if g.integration:
            a = {"slug": f"integration_{g.integration}", "name": integration_name(g.integration, len(g.entity_ids)),
                 "critical": g.critical}
        else:
            a = dict(pack.assets.get(g.asset) or {"slug": g.asset, "name": g.asset_name, "critical": False})
            a["critical"] = g.critical
            if len(g.names) > 1:
                a["name"] = F.device_name(g.names)
            if g.label:                      # named as the villa's system names the device, never one of its entities
                a["name"] = g.label
        out += R.availability_rules(a, g.entity_id, g.state, g.hours, params, g.entity_ids if g.integration else None,
                                    now=now)
    return out


def integration_name(platform: str, devices: int) -> str:
    """An integration down, as its finding names it: "zigbee integration (3 devices)"."""
    return f"{platform} integration ({devices} devices)"


def told_now(res: dict, title: str | None = None) -> list[dict]:
    """The facility manager's message at 02:00: each P2 found new — or back again, with how often (architecture review
    23: it came back in silence) — with what to do, in the one shape of every alert and report (vesta_shared.
    message_format; review 30: it kept "For: … / -------" and its own "What to check:")."""
    def item(d):
        note = result.fault_note(d.get("check"))
        return f"- {_no_code(again_title(d.get('summary', ''), d.get('again')))}" + (f"\n{note}" if note else "")
    new = [item(d) for d in res["new_findings"] if d.get("severity") == "P2"]
    back = [item(d) for d in res["again"] if d.get("severity") == "P2"]
    if not (new or back):
        return []
    title = title or f"{res.get('villa') or 'The villa'}, night check on {day_label(date.fromisoformat(res['as_of']), numeric=True)}."
    body = split_title(document(title, "", [("New", new), ("Back again", back)]))[1]
    return [result.message("fm", body, title=title)]


def _device_still_talks(pack, states: dict, entity_id: str, now: datetime, hours: float) -> bool:
    """Has another reading of `entity_id`'s device reported within `hours`? Then the device is talking and this reading
    has simply not changed — it is not silent.

    ⚠️ STILL IS NOT SILENT (villa, 2026-10-19): the system monitor's disk use went from 78.6 % to 2.4 % when the disk
    was emptied, and at one decimal of a large disk it then stayed 2.4 % for days; it writes only on a change, so it
    read "has not reported for 1 d 9 h although it is online" while its disk-free reading went on reporting."""
    for e in pack.entities_of_device(pack.device_id_of(entity_id)) - {entity_id}:
        st = states.get(e) or {}
        if is_offline(st.get("state")) or st.get("state") == "unknown":
            continue
        at = st.get("last_reported") or st.get("last_changed")
        try:
            if at and (now - datetime.fromisoformat(at).astimezone(now.tzinfo)).total_seconds() / 3600 < hours:
                return True
        except ValueError:
            continue
    return False


def _device_named(pack, asset: dict, entity_id: str) -> dict:
    """`asset` for a finding about the DEVICE itself (offline, silent, reconnecting, its battery): named as Home
    Assistant names the device (knowledge_pack.device_label), never one of its entities — "Jet & Jaccuzi Relay
    Restart" was its restart button's name, "Motion1 Occupancy" its motion entity's (2026-10-13). A measurement keeps its
    asset's name: one meter can measure two circuits. Unchanged when Home Assistant names no device."""
    label = pack.device_label(pack.physical_device_of(entity_id))   # the meter, not one of its phases
    return {**asset, "name": label} if label else asset


def _standing_entity(pack, entity_id: str, classified) -> str:
    """The ONE entity a device's reconnect finding is kept under, whichever of its entities dropped first: its first
    classified entity (`classified`: the pack's rows), else its first entity, else `entity_id` (no device).
    ⚠️ NEVER THE NIGHT'S FIRST TO DROP (villa, 2026-10-14): the relay's fault was the switch's on 10 Oct and the uptime
    sensor's on the 11th — each change closed one fault and opened another for the same relay, and the one left open
    kept the words of its first night ("10 times", "Wi-Fi or power", an entity id for a name)."""
    ents = sorted(pack.entities_of_device(pack.device_id_of(entity_id)))
    # never a control with no state of its own: on the villa, the relay's first entity was its "Restart" button
    held = [e for e in ents if e.split(".", 1)[0] not in _NO_STATE_DOMAINS] or ents
    return next((e for e in held if e in classified), held[0] if held else entity_id)


#: Entities that hold no state a person would call the device's (a button's state is when it was last pressed).
_NO_STATE_DOMAINS = {"button", "event", "image", "notify", "number", "scene", "select", "text", "update"}


def _restarted(pack, states: dict, entity_id: str, since: datetime) -> bool | None:
    """Did the device of `entity_id` restart after `since`? Read from its own "uptime" entity (Home Assistant's device
    class, whatever the device or integration: its state is when the device last started). None: it has none."""
    for eid in sorted(pack.entities_of_device(pack.device_id_of(entity_id))):
        st = states.get(eid) or {}
        if (st.get("attributes") or {}).get("device_class") != "uptime":
            continue
        try:
            started = datetime.fromisoformat(str(st.get("state")))
        except ValueError:
            continue
        if started.tzinfo:
            return started > since
    return None


def _plain_name(entity_id: str) -> str:
    """An entity id as words when nothing names it better (sensor.pool_relay_uptime -> "Pool relay uptime")."""
    return entity_id.split(".", 1)[-1].replace("_", " ").strip().capitalize()


def main(argv=None):
    ap = argparse.ArgumentParser()
    script.arguments(ap, pack=True, pack_required=True)
    ap.add_argument("--as-of")
    ap.add_argument("--out")
    ap.add_argument("--skip-raw", action="store_true")
    args = ap.parse_args(argv)
    res = run(args)
    out = {k: res[k] for k in ("as_of", "features_written", "tasks_to_create", "notes")}
    # The engine's standard output: the Kiosk's faults brought up to date from the tasks (what each says is the task's:
    # Problems.card), and a P2 finding sent to the facility manager at once rather than at the 07:00 digest
    out[result.FAULTS_CHANGED] = bool(res["new_findings"] or res["still_open"] or res["closed"] or res.get("handed_over")
                                      or res["again"] or res["tasks_to_create"] or res["tasks_resolved"])
    out["actions"] = []
    out["send"] = told_now(res)
    print(json.dumps(out, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
