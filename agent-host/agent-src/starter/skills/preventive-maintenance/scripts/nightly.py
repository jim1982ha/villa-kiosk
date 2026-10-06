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
now do: create tasks (Kiosk tickets), send the digest lines, ask the owner about
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
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from vesta_shared.ha_client import client_from_args  # noqa: E402
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402
from vesta_shared.messaging import no_code as _no_code  # noqa: E402
from vesta_shared.params import VillaParams, MissingParameter  # noqa: E402
from vesta_shared.store import Store  # noqa: E402
from vesta_shared.timeutil import villa_day  # noqa: E402
from vesta_shared.problems import Problems  # noqa: E402  (a problem's lifecycle: one owner)
from vesta_shared.stats import med  # noqa: E402
from vesta_shared.timeutil import schedule_hours_per_day  # noqa: E402
import features as F  # noqa: E402
import rules as R  # noqa: E402

STATE_RULES = {"PM-POWER-CHANGE", "PM-ENERGY-CHANGE", "PM-UNAVAILABLE",
               "PM-BATTERY-LOW", "PM-BATTERY-CRIT", "PM-SILENT", "PM-RECONNECT-LOOP", "PM-LEVEL-HIGH",
               "PM-PARAM-MISSING"}
EVENT_RULES = {"PM-RUNHOURS", "PM-RUN-SAG", "PM-EXPECTED-SILENT", "PM-COUNTER-RESET", "PM-BATTERY-TREND"}


def on_threshold_for(asset: dict, hour_rows: list[dict], params: VillaParams) -> float:
    """Power above which the asset counts as running. Derived from the data
    (a fraction of the typical hourly maximum) and capped by the baseline
    helper when one exists. Nothing hardcoded per pump."""
    frac = params.behaviour("on_threshold_fraction")
    maxes = [r["max"] for r in hour_rows if r.get("max") and r["max"] > 0]
    data_thr = (med(maxes) or 0) * frac if maxes else 0
    helper_thr = None
    if asset.get("baseline_helper"):
        try:
            helper_thr = params.number(asset["baseline_helper"].split(".", 1)[1]) * frac
        except MissingParameter:
            helper_thr = None
    cands = [t for t in (data_thr, helper_thr) if t]
    return min(cands) if cands else 1.0


def run(args) -> dict:
    cli = client_from_args(args)
    pack = KnowledgePack.load(args.pack)
    zone = pack.time_zone or cli.zone
    Z = ZoneInfo(zone)
    helpers, hstates = cli.helpers()
    params = VillaParams(helpers, hstates)
    store = Store(args.store)
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
            thr = on_threshold_for(asset, rows, params)
            p_series = F.power_daily_features(rows, zone, thr)
            # raw runs for the closing day
            if not args.skip_raw:
                raw = cli.history([p_eid], day_end - timedelta(days=1), day_end).get(p_eid, [])
                if raw:
                    p_series.setdefault(today, {}).update({"runs": F.runs_from_history(raw, thr, zone)})
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
                gap_limit = params.behaviour_text_default("energy_gap_hours", 3)
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
    now_ref = day_end if args.as_of else datetime.now(Z)
    for row in pack.entities("battery"):
        asset = pack.assets.get(row["asset"], {"slug": row["asset"], "name": row["name"], "critical": False})
        st = states.get(row["entity_id"], {})
        try:
            level = float(st.get("state")) if st.get("state") not in (None, "unavailable", "unknown") else None
        except ValueError:
            level = None
        series = [(str(r["start"]), r["mean"]) for r in bat_stats.get(row["entity_id"], []) if r.get("mean") is not None]
        findings += R.battery_rules(asset, row["entity_id"], row.get("unit"), level, series, params, today)

    # one availability finding per physical device (device_id when the registry gives it,
    # otherwise the integration + asset), never one per entity
    unavailable_groups: dict[str, dict] = {}
    quiet_rows: list[tuple[dict, dict, datetime]] = []
    for fam in ("power", "energy", "security", "level", "runtime", "water", "generation"):
        for row in pack.entities(fam):
            st = states.get(row["entity_id"])
            if not st:
                continue
            asset = pack.assets.get(row["asset"], {"slug": row["asset"], "name": row["name"], "critical": False})
            lc = st.get("last_changed")
            hours = None
            if lc:
                try:
                    hours = (now_ref - datetime.fromisoformat(lc).astimezone(Z)).total_seconds() / 3600
                except ValueError:
                    hours = None
            # ⚠️ "unknown" IS NOT OFFLINE (villa, 2026-10-04): it is a sensor with no value to give — a
            # wind chill on a warm day — while its device reports. Lost is "unavailable".
            if st.get("state") == "unavailable":
                key = F.device_key(row, row["entity_id"])
                g = unavailable_groups.setdefault(key, {"asset": asset, "entity_id": row["entity_id"], "hours": hours,
                                                        "state": st.get("state"), "names": [], "critical": asset.get("critical", False),
                                                        "platform": row.get("platform") or "x"})
                g["names"].append(row["name"]); g["critical"] = g["critical"] or asset.get("critical", False)
                if hours is not None and (g["hours"] is None or hours > g["hours"]):
                    g["hours"] = hours
            elif fam == "level" and st.get("state") != "unknown":
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
    long_quiet = [(r, a, t) for r, a, t in quiet_rows if (now_ref - t).total_seconds() / 3600 >= silence_hours]
    if long_quiet:
        # judged on the hours just BEFORE it went quiet (features.reporting_share)
        hist_hours = int(params.behaviour_text_default("silence_history_hours", 72))
        share_min = params.behaviour_text_default("silence_reporting_share", 0.5)
        q_from = min(t for _, _, t in long_quiet) - timedelta(hours=hist_hours)
        q_stats = cli.statistics([r["entity_id"] for r, _, _ in long_quiet], q_from, now_ref, "hour", ("mean", "min", "max"))
        silent_groups: dict[str, dict] = {}
        for row, asset, since in long_quiet:
            share, hours = F.reporting_share(q_stats.get(row["entity_id"], []), int(since.timestamp() * 1000), hist_hours)
            if share is None or hours < 48 or share < share_min:
                continue                  # reports on change only, or too little history to say: not a fault
            key = F.device_key(row, row["entity_id"])
            g = silent_groups.setdefault(key, {"asset": asset, "entity_id": row["entity_id"], "since": since, "names": []})
            g["names"].append(row["name"])
            g["since"] = min(g["since"], since)
        for g in silent_groups.values():
            a = dict(g["asset"])
            a["name"] = F.device_name(g["names"])
            findings += R.silence_rules(a, g["entity_id"], (now_ref - g["since"]).total_seconds() / 3600, params)

    # three or more devices of one integration offline together = the integration is down, one finding
    by_platform: dict[str, list[str]] = {}
    for key, g in unavailable_groups.items():
        by_platform.setdefault(g.get("platform") or key.split(":")[0], []).append(key)
    for plat, keys in by_platform.items():
        if plat not in ("x", "None") and len(keys) >= 3:
            first = unavailable_groups[keys[0]]
            merged = {"asset": {"slug": f"integration_{plat}", "name": f"{plat} integration ({len(keys)} devices)", "critical": True},
                      "entity_id": first["entity_id"], "hours": max((unavailable_groups[k]["hours"] or 0) for k in keys),
                      "state": "unavailable", "names": [unavailable_groups[k]["names"][0] for k in keys], "critical": True}
            for k in keys:
                unavailable_groups.pop(k)
            unavailable_groups[plat] = merged
    for key, g in unavailable_groups.items():
        a = dict(g["asset"]); a["critical"] = g["critical"]
        if len(g["names"]) > 1 and not a["slug"].startswith("integration_"):
            a["name"] = F.device_name(g["names"])
        findings += R.availability_rules(a, g["entity_id"], g["state"], g["hours"], params)

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
        lb = cli.logbook(day_end - timedelta(days=3), day_end)
    except Exception:  # logbook is optional
        lb = []
    flips = F.flips_per_day(lb, zone, int(params.behaviour_text_default("restart_crowd_entities", 20)))
    # ONE finding per DEVICE, named as a person reads it (villa, 2026-10-04: a relay, its firmware
    # entity and its uptime sensor were three lines, two of them raw entity ids)
    rows_by_eid = {r["entity_id"]: r for fam in pack.families for r in pack.entities(fam)}
    by_device: dict[str, dict] = {}
    for eid, per_day in flips.items():
        row = rows_by_eid.get(eid, {})
        slug = row.get("asset") or next((s for s, a in pack.assets.items() if eid in a["entities"].values()), None)
        key = F.device_key({**row, "asset": row.get("asset") or slug}, eid)
        g = by_device.setdefault(key, {"eid": eid, "slug": slug, "name": row.get("name"), "per_day": {}})
        for d, n in per_day.items():
            g["per_day"][d] = max(g["per_day"].get(d, 0), n)      # the device's drops, not the sum of its entities'
        g["name"] = g["name"] or row.get("name")
    for g in by_device.values():
        asset = dict(pack.assets.get(g["slug"], {"slug": g["slug"] or g["eid"]}))
        asset["name"] = asset.get("name") or g["name"] or _plain_name(g["eid"])
        findings += R.flap_rules(asset, g["eid"], g["per_day"], today, params)

    # ---- persist findings, dedup, close, mute ---------------------------------
    new, still_open, closed, muted = [], [], [], []
    fired = set()
    for f in findings:
        f.day = today.isoformat()
        f.detail["check"] = f.check
        if store.is_muted(f.rule_id, f.entity_id, day_end.astimezone(timezone.utc).isoformat()):
            muted.append(f.as_dict()); continue
        fired.add((f.rule_id, f.entity_id))
        key_day = today.isoformat()
        prev_row = store.open_finding(f.rule_id, f.entity_id)
        prev = json.loads(prev_row["detail"] or "{}") if prev_row else {}
        if prev and f.rule_id in STATE_RULES:
            f.detail["last_reported_pct"] = prev.get("last_reported_pct", prev.get("change_pct"))
        fid, is_new = store.raise_finding(f.rule_id, f.entity_id, f.family, key_day, f.severity, f.summary, f.detail)
        d = f.as_dict(); d["id"] = fid
        if f.rule_id in EVENT_RULES:
            store.close_finding(f.rule_id, f.entity_id, key_day)  # events close the same night
            if is_new:                                             # a rerun of the same night: told already
                new.append(d)
        elif is_new:
            new.append(d)
        else:
            still_open.append(d)
            # a finding that worsens by 15 points earns a digest line again
            if F.worsened(f.detail.get("change_pct"), f.detail.get("last_reported_pct")):
                d["worsened"] = True
                f.detail["last_reported_pct"] = f.detail.get("change_pct")
                store.db.execute("UPDATE findings SET detail=? WHERE id=?", (json.dumps(f.detail), fid)); store.db.commit()
    problems = Problems(store)
    resolved_tasks = []
    for o in F.to_close(store.findings(status="open"), fired, STATE_RULES):
        store.close_finding(o["rule_id"], o["entity_id"], today.isoformat())
        closed.append(o)
        # ⚠️ ITS TASK AND ITS KIOSK TICKET CLOSE WITH IT (villa, 2026-10-01): the finding closed, the
        # ticket stayed "Open fault" for ever, and the Kiosk's Cockpit filled with faults long gone
        resolved_tasks += problems.clear_source("finding", o["id"], o["rule_id"], o["entity_id"])

    # ---- tasks for the FM (P2 and P3 new findings) --------------------------------
    tasks = []
    for d in new:
        if d["severity"] in ("P2", "P3"):
            tid, created = problems.open_task("finding", d["id"], d["rule_id"], d["entity_id"], d["summary"], d.get("check") or "")
            if created:
                tasks.append({"task_id": tid, "todo_summary": d["summary"][:250], "check": d.get("check") or "",
                              "severity": d["severity"], "entity_id": d["entity_id"]})
    store.beat("maintenance_nightly", day_end.astimezone(timezone.utc).isoformat())
    store.audit("preventive-maintenance", "nightly", {"as_of": today.isoformat(), "new": len(new), "closed": len(closed)})

    digest = ([f"{d['severity']}: {d['summary']}" for d in new]
              + [f"update: {d['summary']}" for d in still_open if d.get("worsened")]
              + [f"resolved: {c['summary']}" for c in closed])
    result = {"as_of": today.isoformat(), "villa": pack.villa, "features_written": features_written,
              "new_findings": new, "still_open": still_open, "closed": closed, "muted": muted,
              "tasks_to_create": tasks, "tasks_resolved": resolved_tasks, "notes": notes, "digest_lines": digest}
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=1, default=str)
    return result


def _plain_name(entity_id: str) -> str:
    """An entity id as words when nothing names it better (sensor.pool_relay_uptime -> "Pool relay uptime")."""
    return entity_id.split(".", 1)[-1].replace("_", " ").strip().capitalize()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True)
    ap.add_argument("--store", default=os.environ.get("VESTA_STORE", "vesta_store.sqlite"))
    ap.add_argument("--fixture-dir")
    ap.add_argument("--zone")
    ap.add_argument("--as-of")
    ap.add_argument("--out")
    ap.add_argument("--skip-raw", action="store_true")
    args = ap.parse_args(argv)
    res = run(args)
    out = {k: res[k] for k in ("as_of", "features_written", "digest_lines", "tasks_to_create", "notes")}
    # The engine's standard output: each task a Facility ticket in the VESTA Kiosk, and a P2
    # finding sent to the facility manager at once rather than at the 07:00 digest.
    # the ticket's title says what is wrong, its note what to check (two fields, not one sentence)
    out["actions"] = [{"action": "ticket", "summary": t["todo_summary"], "task_id": t["task_id"],
                       "note": f"Check: {t['check']}" if t.get("check") else None,
                       "entity_id": t.get("entity_id")} for t in res["tasks_to_create"]]
    out["actions"] += [{"action": "ticket.resolve", "task_id": tid,
                        "note": "Cleared: the nightly check no longer sees it."} for tid in res["tasks_resolved"]]
    out["send"] = [{"to": "fm", "text": f"{_no_code(d.get('summary', ''))}\nWhat to check: {d.get('check', '')}"}
                   for d in res["new_findings"] if d.get("severity") == "P2"]
    print(json.dumps(out, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
