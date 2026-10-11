#!/usr/bin/env python3
"""investigate: the facts of an investigation, read from Home Assistant and made short enough to reason about.

The model asks the questions; this script does the reading and the counting, so the answer rests on every recorded
value — not on the few rows a model could read itself — and costs little. It never acts on the villa (its Home
Assistant client is read-only) and knows no device of any villa: everything comes from the question and Home Assistant.

  investigate.py find      --what "water heater" [--where "kitchen"]
        The devices a word or a place means — and, for each, what sits next to it: the other parts of the same
        physical device, and the powered devices in the same room (often on the same circuit or in the same cabinet).

  investigate.py timeline  --entities sensor.a,binary_sensor.b [--entities sensor.c] --start 2026-10-09T02:00
                           --end 2026-10-09T15:00 [--baseline-days 3] [--out timeline.json]
        What each entity did in that period, as periods (running / idle / no power at all / offline) with their
        times, durations and levels — compared with the same entity's normal behaviour over the days before.
        --out also saves the reading with each device's chart, for the investigation page (reports' compose.py).

  investigate.py around    --start 2026-10-09T02:00 --end 2026-10-09T15:00 [--entities sensor.a,...]
        Everything else Home Assistant recorded then: automations that ran, devices that dropped off or came back,
        notifications sent, people and doors, and the VESTA Agent's own alerts and faults.

Times given and printed are the villa's (--zone, set by the agent). Output: JSON, each part with a "lines" list the
model can quote, and the raw figures under it.
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from vesta_shared import script  # noqa: E402  (client, store, zone: one set-up for every skill script)

OFFLINE = {"unavailable"}                 # the device does not answer
NO_VALUE = {"unknown", ""}                # it answers, without a value
MAX_LINES = 120                           # per part: enough for a night, short enough to reason about
NOISE_PER_HOUR = 30                       # an entity changing more often than this is background, not an event
DAY_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")    # a date without a time
ENTITY_ID = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")    # sensor.a, binary_sensor.b: what find gives, never a word


# ------------------------------------------------------------------ small helpers
def parse_time(text: str, zone: ZoneInfo) -> datetime:
    """A time as the model writes it ("2026-10-09T03:00", "2026-10-09"), in the villa's time unless it says otherwise."""
    t = datetime.fromisoformat(text)
    return t if t.tzinfo else t.replace(tzinfo=zone)


def at(t: datetime, zone: ZoneInfo, day: bool = False) -> str:
    """A moment as the answer writes it: "09/10 03:09:46" (with the day when the period spans several)."""
    t = t.astimezone(zone)
    return f"{t:%d/%m %H:%M:%S}" if day else f"{t:%H:%M:%S}"


def lasting(seconds: float) -> str:
    """A duration in words a person reads: "47 min", "1 h 46 min", "8 s"."""
    s = int(round(seconds))
    if s < 90:
        return f"{s} s"
    m = s // 60
    if m < 60:
        return f"{m} min"
    h, m = divmod(m, 60)
    return f"{h} h {m} min" if m else f"{h} h"


def number(state) -> float | None:
    try:
        v = float(state)
    except (TypeError, ValueError):
        return None
    return v if v == v else None


def rows_of(client, eid: str, start: datetime, end: datetime) -> list[tuple[datetime, str]]:
    """(time, state) of every recorded change of `eid` in [start, end), oldest first, the state before `start`
    included as the first row (Home Assistant gives it)."""
    out = []
    for r in client.history([eid], start, end).get(eid) or []:
        try:
            out.append((datetime.fromisoformat(r.get("last_changed") or r.get("last_updated")), str(r.get("state"))))
        except (TypeError, ValueError):
            continue
    return sorted(out)


# ------------------------------------------------------------------ find
def find(client, what: str, where: str | None) -> dict:
    """The entities `what` (and `where`) mean, with their neighbours. Universal: Home Assistant's own search, devices
    and areas — no list of devices anywhere."""
    args = {"query": what, "exact_match": False, "limit": 20,
            "result_fields": ["entity_id", "friendly_name", "state", "area"]}
    if where:
        args["area_filter"] = where
    found = (client.tool("ha_search", args) or {}).get("entities") or []
    ids = [e["entity_id"] for e in found if e.get("entity_id", "").split(".")[0] not in ("automation", "script", "update")]
    if not ids:
        return {"lines": [f"Nothing in Home Assistant matches \"{what}\"" + (f" in {where}" if where else "") + "."],
                "entities": []}
    reg = {e["entity_id"]: e for e in (client.tool("ha_get_entity", {"entity_id": ids}) or {}).get("entity_entries") or []}
    states = client.states(ids)
    lines, out = [], []
    for eid in ids:
        e, st = reg.get(eid, {}), states.get(eid) or {}
        attrs = st.get("attributes") or {}
        item = {"entity_id": eid, "name": attrs.get("friendly_name") or e.get("original_name") or eid,
                "area": e.get("area"), "state": st.get("state"), "unit": attrs.get("unit_of_measurement"),
                "device_class": e.get("device_class") or e.get("original_device_class") or attrs.get("device_class"),
                "device_id": e.get("device_id"), "platform": e.get("platform"),
                "same_box": _same_box(client, e, ids), "same_room": []}
        out.append(item)
    _same_room(client, out)
    for it in out:
        unit = f" {it['unit']}" if it["unit"] else ""
        lines.append(f"{it['name']} ({it['entity_id']}) — {it['area'] or 'no room'} — now {it['state']}{unit}")
        if it["same_box"]:
            lines.append("  same physical device: " + ", ".join(f"{n} ({x})" for x, n in it["same_box"][:12]))
        if it["same_room"]:
            lines.append("  powered devices in the same room: " + ", ".join(f"{n} ({x})" for x, n in it["same_room"][:12]))
    return {"lines": lines, "entities": out}


def _same_box(client, e: dict, exclude: list[str]) -> list[tuple[str, str]]:
    """The other entities of the same physical device: its own device, and devices that share its unique id's prefix
    (one box an integration splits into several devices: a meter's channels and its relay)."""
    prefix = re.split(r"[-_:]", str(e.get("unique_id") or ""))[0]
    out = []
    try:
        dev = client.tool("ha_get_device", {"device_id": e["device_id"]}) if e.get("device_id") else {}
        out += [(x["entity_id"], x.get("name") or x["entity_id"]) for x in (dev.get("entities") or [])]
        if len(prefix) >= 8:                            # a serial or a MAC, never a word
            res = client.tool("ha_search", {"query": prefix, "exact_match": True, "limit": 40,
                                            "result_fields": ["entity_id", "friendly_name"]}) or {}
            out += [(x["entity_id"], x.get("friendly_name") or x["entity_id"]) for x in res.get("entities") or []]
    except Exception:  # noqa: BLE001 — a neighbour list is a help, never a reason to fail
        pass
    seen, keep = set(exclude), []
    for eid, name in out:
        if eid not in seen and eid.split(".")[0] in ("sensor", "binary_sensor", "switch", "lock", "valve", "cover",
                                                     "climate", "fan", "light", "water_heater", "pump", "number"):
            seen.add(eid)
            keep.append((eid, name))
    return keep


def _same_room(client, items: list[dict]) -> None:
    """For each room of the found entities, its switches and power sensors: what may share a circuit or a cabinet."""
    for room in {it["area"] for it in items if it["area"]}:
        try:
            res = client.tool("ha_search", {"area_filter": room, "limit": 60,
                                            "result_fields": ["entity_id", "friendly_name"]}) or {}
        except Exception:  # noqa: BLE001
            continue
        near = [(x["entity_id"], x.get("friendly_name") or x["entity_id"]) for x in res.get("entities") or []
                if x["entity_id"].startswith("switch.") or x["entity_id"].endswith("_power")]
        for it in items:
            if it["area"] == room:
                mine = {it["entity_id"], *(x for x, _ in it["same_box"])}
                it["same_room"] = [(x, n) for x, n in near if x not in mine]


# ------------------------------------------------------------------ timeline
def periods(rows: list[tuple[datetime, str]], end: datetime, on_above: float | None) -> list[dict]:
    """The rows as periods of one condition each: "running" (above on_above), "idle", "no power" (exactly 0 where the
    device usually reads a little at rest), "offline", "no value", or the state itself for a non-numeric entity."""
    def kind(state: str) -> str:
        if state in OFFLINE:
            return "offline"
        if state in NO_VALUE:
            return "no value"
        v = number(state)
        if v is None or on_above is None:
            return state
        if v > on_above:
            return "running"
        return "no power" if v == 0 else "idle"

    out: list[dict] = []
    for i, (t, s) in enumerate(rows):
        k, v = kind(s), number(s)
        nxt = rows[i + 1][0] if i + 1 < len(rows) else end
        if out and out[-1]["kind"] == k:
            p = out[-1]
        else:
            p = {"kind": k, "start": t, "values": [], "weights": []}
            out.append(p)
        p["end"] = nxt
        if v is not None:
            p["values"].append(v)
            p["weights"].append(max((nxt - t).total_seconds(), 0.001))
    for p in out:
        vals = p.pop("values")
        w = p.pop("weights")
        p["seconds"] = (p["end"] - p["start"]).total_seconds()
        if vals:
            p["mean"] = sum(v * x for v, x in zip(vals, w)) / sum(w)
            p["min"], p["max"] = min(vals), max(vals)
    return out


def level_jumps(rows: list[tuple[datetime, str]], start: datetime, end: datetime, on_above: float) -> list[dict]:
    """Inside the running periods, the moments the level changes for good (by a third or more for 2 minutes):
    a motor that starts drawing double, a heater that loses half its power."""
    out, base, since = [], None, None
    for t, s in rows:
        v = number(s)
        if v is None or v <= on_above or not (start <= t < end):
            base, since = None, None
            continue
        if base is None:
            base, since = v, t
            continue
        if abs(v - base) >= base / 3:
            if since is None or (t - since).total_seconds() >= 120:
                out.append({"at": t, "from": base, "to": v})
                base, since = v, t
        else:
            since = t
    return out


def normal(rows: list[tuple[datetime, str]], end: datetime, on_above: float | None) -> dict:
    """The entity's own normal over the baseline days: how often and how long it runs, at what level."""
    ps = periods(rows, end, on_above)
    days = max((end - rows[0][0]).total_seconds() / 86400, 0.5) if rows else 1
    runs = [p for p in ps if p["kind"] == "running"]
    out = {"days": round(days, 1), "runs_per_day": round(len(runs) / days, 1)}
    if runs:
        secs = sorted(p["seconds"] for p in runs)
        out |= {"run_median_s": statistics.median(secs), "run_longest_s": secs[-1],
                "level_median": round(statistics.median(p["mean"] for p in runs if "mean" in p), 1)}
    rest = [p["mean"] for p in ps if p["kind"] == "idle" and "mean" in p]
    if rest:
        out["rest_median"] = round(statistics.median(rest), 2)
    off = [p for p in ps if p["kind"] in ("offline", "no power")]
    out["offline_or_no_power_s"] = sum(p["seconds"] for p in off)
    return out


def threshold(values: list[float]) -> float | None:
    """Above this a numeric entity counts as running: 10 % of its high readings (its 95th percentile), at least a
    little above zero. None for an entity that hardly moves (a temperature): read as levels, not runs."""
    vals = sorted(v for v in values if v is not None)
    if len(vals) < 5:
        return None
    hi = vals[int(len(vals) * 0.95) - 1]
    lo = vals[int(len(vals) * 0.05)]
    if hi <= 0 or (hi - lo) < hi * 0.5:
        return None
    return max(hi * 0.10, 2.0)


CHART_POINTS = 400                        # a chart's points: each the highest reading of its slice (a surge stays seen)


def chart_series(rows: list[tuple[datetime, str]], start: datetime, end: datetime) -> list[list]:
    """The readings as at most CHART_POINTS [time, value] points over [start, end): each slice's HIGHEST reading, the
    last value carried through a slice with none; None where the device gave no number (offline)."""
    if not rows or end <= start:
        return []
    step = (end - start) / CHART_POINTS
    out, i, last = [], 0, None
    while i < len(rows) and rows[i][0] < start:
        last = number(rows[i][1]); i += 1
    for k in range(CHART_POINTS):
        a, b = start + k * step, start + (k + 1) * step
        vals = [last] if last is not None else []
        while i < len(rows) and rows[i][0] < b:
            last = number(rows[i][1]); i += 1
            vals.append(last)
        nums = [v for v in vals if v is not None]
        out.append([a.isoformat(), max(nums) if nums else None])
    return out


def timeline(client, ids: list[str], start: datetime, end: datetime, baseline_days: float, zone: ZoneInfo,
             series: bool = False) -> dict:
    """`series`: each numeric device's readings for a chart too (--out: the investigation page, reports' compose.py)."""
    span_days = (end - start).total_seconds() > 86400
    parts = []
    names = client.states(ids) if series else {}
    for eid in ids:
        rows = rows_of(client, eid, start, end)
        if not rows:
            parts.append({"entity_id": eid, "lines": [f"{eid}: nothing recorded in this period."]})
            continue
        base_rows = rows_of(client, eid, start - timedelta(days=baseline_days), start) if baseline_days > 0 else []
        on = threshold([number(s) for _, s in base_rows + rows])
        ps = periods(rows, end, on)
        ref = normal(base_rows, start, on) if base_rows else {}
        lines = [f"{eid}: {len(rows)} readings" + (f"; counted as running above {on:g}" if on else "")]
        if ref:
            r = ref
            lines.append("  normal (the %g days before): %s runs a day%s%s%s" % (
                r["days"], r["runs_per_day"],
                f", usually {lasting(r['run_median_s'])}" if "run_median_s" in r else "",
                f", longest {lasting(r['run_longest_s'])}" if "run_longest_s" in r else "",
                f", at about {r['level_median']:g}" if "level_median" in r else "")
                + (f"; at rest {r['rest_median']:g}" if "rest_median" in r else ""))
        notable = _notable(ps, ref, on)
        shown = _cycles(notable)
        for p in shown[:MAX_LINES]:
            lvl = f" at {p['mean']:.4g} (from {p['min']:.4g} to {p['max']:.4g})" if "mean" in p and on else \
                (f" reading {p['mean']:.4g}" if "mean" in p else "")
            flag = f"  ⟵ {p['why']}" if p.get("why") else ""
            lines.append(f"  {at(p['start'], zone, span_days)} → {at(p['end'], zone, span_days)}  {p['kind']} "
                         f"for {lasting(p['seconds'])}{lvl}{flag}")
        if len(shown) > MAX_LINES:
            lines.append(f"  … {len(shown) - MAX_LINES} more periods (narrow the period to see them)")
        hidden = len(ps) - len(notable)
        if hidden > 0:
            lines.append(f"  ({hidden} short ordinary periods not listed: like its normal)")
        if on:
            for j in level_jumps(rows, start, end, on)[:20]:
                lines.append(f"  {at(j['at'], zone, span_days)} level changes from about {j['from']:.0f} to {j['to']:.0f}")
        totals: dict[str, float] = {}
        for p in ps:
            totals[p["kind"]] = totals.get(p["kind"], 0) + p["seconds"]
        lines.append("  in total: " + ", ".join(f"{k} {lasting(v)}" for k, v in sorted(totals.items(), key=lambda x: -x[1])))
        part = {"entity_id": eid, "running_above": on, "normal": ref, "lines": lines,
                "periods": [{**p, "start": p["start"].isoformat(), "end": p["end"].isoformat()} for p in shown[:MAX_LINES]]}
        if series and any(number(v) is not None for _, v in rows):
            attrs = (names.get(eid) or {}).get("attributes") or {}
            part.update(name=attrs.get("friendly_name") or eid, unit=attrs.get("unit_of_measurement") or "",
                        series=chart_series(rows, start, end))
        parts.append(part)
    return {"lines": [l for p in parts for l in p["lines"]], "entities": parts}


def _cycles(ps: list[dict]) -> list[dict]:
    """Six or more short running / idle periods in a row (each under 3 minutes) said as ONE line: "stops and restarts
    8 times" — what a person needs to know, not sixteen lines."""
    out, i = [], 0
    while i < len(ps):
        j = i
        while j < len(ps) and ps[j]["kind"] in ("running", "idle") and ps[j]["seconds"] < 180:
            j += 1
        group = ps[i:j]
        runs = [p for p in group if p["kind"] == "running"]
        if len(runs) >= 3 and len(group) >= 6:
            levels = [p["mean"] for p in runs if "mean" in p]
            out.append({"kind": f"stops and restarts {len(runs)} times", "start": group[0]["start"],
                        "end": group[-1]["end"], "seconds": (group[-1]["end"] - group[0]["start"]).total_seconds(),
                        **({"mean": sum(levels) / len(levels), "min": min(p["min"] for p in runs),
                            "max": max(p["max"] for p in runs)} if levels else {}),
                        "why": "short-cycling: runs of " + lasting(statistics.median(p["seconds"] for p in runs))})
            i = j
        else:
            out.append(ps[i])
            i += 1
    return out


def _notable(ps: list[dict], ref: dict, on: float | None) -> list[dict]:
    """The periods worth a line: every period but the many short ordinary ones, each unusual one with why."""
    longest = ref.get("run_longest_s")
    level = ref.get("level_median")
    rest = ref.get("rest_median")
    out = []
    for p in ps:
        why = []
        if p["kind"] == "running":
            if longest and p["seconds"] > max(longest * 2, longest + 300):
                why.append(f"longer than any run of its normal ({lasting(longest)})")
            if level and "mean" in p and p["mean"] > level * 1.5:
                why.append(f"draws {p['mean'] / level:.1f}× its normal level")
            if level and "mean" in p and p["mean"] < level * 0.6:
                why.append(f"draws only {p['mean'] / level:.0%} of its normal level")
        elif p["kind"] == "no power" and rest and rest > 0:
            why.append(f"exactly 0 where it reads {rest:g} at rest: its supply was off")
        elif p["kind"] in ("offline", "no value") and p["seconds"] >= 60:
            why.append("did not answer" if p["kind"] == "offline" else "answered without a value")
        elif on is None and len(ps) <= MAX_LINES:
            pass
        if why:
            p["why"] = "; ".join(why)
        ordinary = not why and p["kind"] in ("running", "idle") and p["seconds"] < 3600 and len(ps) > 40
        if not ordinary:
            out.append(p)
    return out


# ------------------------------------------------------------------ around
def around(client, store, start: datetime, end: datetime, focus: list[str], zone: ZoneInfo) -> dict:
    span_days = (end - start).total_seconds() > 86400
    hours = max((end - start).total_seconds() / 3600, 1)
    rows = client.logbook(start, end)
    count: dict[str, int] = {}
    for r in rows:
        count[r.get("entity_id") or ""] = count.get(r.get("entity_id") or "", 0) + 1
    autos, offline, back, sent, events = {}, [], [], [], []
    went_ids = {r.get("entity_id") for r in rows if str(r.get("state")) in OFFLINE}
    for r in rows:
        eid, state, when = r.get("entity_id") or "", str(r.get("state") or ""), r.get("when")
        try:
            t = datetime.fromisoformat(when)
        except (TypeError, ValueError):
            continue
        dom = eid.split(".")[0]
        name = r.get("name") or eid
        if dom == "automation":
            a = autos.setdefault(eid, {"name": name, "times": [], "why": r.get("message") or ""})
            a["times"].append(t)
        elif state in OFFLINE:
            offline.append((t, name, eid))
        elif dom == "notify" or dom == "event" and "notif" in eid:
            sent.append((t, name))
        elif eid in went_ids:
            continue                                     # said under "answered again"
        elif eid in focus or (count.get(eid, 0) / hours <= NOISE_PER_HOUR and dom in (
                "lock", "binary_sensor", "switch", "cover", "valve", "person", "alarm_control_panel", "input_boolean",
                "input_select", "climate", "water_heater")):
            events.append((t, name, state, eid))
    # a device that came back: its first state that is not "unavailable" after it went
    went = {eid for _, _, eid in offline}
    for r in rows:
        eid = r.get("entity_id") or ""
        if eid in went and str(r.get("state")) not in OFFLINE:
            try:
                back.append((datetime.fromisoformat(r["when"]), r.get("name") or eid, eid))
            except (KeyError, ValueError):
                pass
    lines = []
    if offline:
        lines.append("Devices that stopped answering:")
        lines += [f"  {at(t, zone, span_days)}  {n} ({e})" for t, n, e in _first_per(offline)[:40]]
    if back:
        lines.append("…and answered again:")
        lines += [f"  {at(t, zone, span_days)}  {n} ({e})" for t, n, e in _first_per(back)[:40]]
    if autos:
        lines.append("Automations that ran:")
        for eid, a in sorted(autos.items(), key=lambda x: x[1]["times"][0]):
            ts = a["times"]
            lines.append(f"  {a['name']} ({eid}): {len(ts)}× from {at(ts[0], zone, span_days)} to {at(ts[-1], zone, span_days)}"
                         + (f" — {a['why']}" if a["why"] else ""))
    if sent:
        lines.append("Notifications sent:")
        lines += [f"  {at(t, zone, span_days)}  {n}" for t, n in sent[:40]]
    if events:
        lines.append("Other changes (doors, locks, switches, people, focus devices):")
        lines += [f"  {at(t, zone, span_days)}  {n}: {s}" for t, n, s, _ in events[:MAX_LINES]]
        if len(events) > MAX_LINES:
            lines.append(f"  … {len(events) - MAX_LINES} more")
    lines += _vesta(store, start, end, zone, span_days)
    if not lines:
        lines.append("Nothing else was recorded in this period.")
    noisy = sorted(((n, e) for e, n in count.items() if n / hours > NOISE_PER_HOUR and e not in focus), reverse=True)[:8]
    if noisy:
        lines.append("Left out as background (change constantly): " + ", ".join(e for _, e in noisy))
    return {"lines": lines}


def _first_per(items):
    seen, out = set(), []
    for it in sorted(items):
        if it[-1] not in seen:
            seen.add(it[-1])
            out.append(it)
    return out


def _vesta(store, start: datetime, end: datetime, zone: ZoneInfo, span_days: bool) -> list[str]:
    """The VESTA Agent's own alerts and night-check findings of the period: what was already known, and when."""
    if store is None:
        return []
    out = []
    try:
        for i in store.incidents(open_only=False):
            t = datetime.fromisoformat(i["opened_at"])
            if start <= t < end:
                msg = json.loads(i.get("payload") or "{}").get("message") or i["rule_id"]
                closed = f", closed {at(datetime.fromisoformat(i['closed_at']), zone, True)}" if i.get("closed_at") else ", still open"
                out.append(f"  {at(t, zone, span_days)}  alert #{i['id']} {i['severity']}: {msg.splitlines()[0][:120]}{closed}")
        for f in store.findings(None):
            d = f.get("reopened_day") or f.get("opened_day") or ""
            if start.astimezone(zone).date().isoformat() <= d <= end.astimezone(zone).date().isoformat():
                out.append(f"  {d}  night check {f['severity']}: {str(f['summary'])[:120]} ({f['status']})")
    except Exception:  # noqa: BLE001 — the agent's records are a help, never a reason to fail
        return []
    return (["VESTA Agent alerts and findings:"] + out) if out else []


# ------------------------------------------------------------------ main
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["find", "timeline", "around"])
    script.arguments(ap)                                    # --store --zone (the agent adds them)
    ap.add_argument("--what"); ap.add_argument("--where")
    ap.add_argument("--entities", action="append")       # may be given several times: each one is a short text
    ap.add_argument("--start"); ap.add_argument("--end")
    ap.add_argument("--baseline-days", default="3")
    ap.add_argument("--out", help="timeline: also save the reading, with each device's chart, for the investigation page")
    a = ap.parse_args(argv)
    ctx = script.Context(a)
    zone = ctx.Z                                           # the villa's time zone
    try:
        if a.cmd == "find":
            if not a.what:
                raise SystemExit("find needs --what: a device, a word or a room.")
            res = find(ctx.client, a.what, a.where)
        else:
            if not (a.start and a.end):
                raise SystemExit(f"{a.cmd} needs --start and --end (the villa's time, e.g. 2026-10-09T02:00).")
            start, end = parse_time(a.start, zone), parse_time(a.end, zone)
            if DAY_ONLY.match(a.end.strip()):
                end += timedelta(days=1)                   # "--end 2026-10-09" is the whole of the 9th, as a person means it
            if end <= start:
                raise SystemExit("--end must be after --start.")
            ids = [x.strip() for part in (a.entities or []) for x in part.split(",") if x.strip()]
            wrong = [x for x in ids if not ENTITY_ID.match(x)]
            if wrong:
                raise SystemExit(f"--entities takes the ids find gives (like sensor.a), separated by "
                                 f"commas: {', '.join(repr(x) for x in wrong[:3])} is not one. Run find first.")
            if a.cmd == "timeline":
                if not ids:
                    raise SystemExit("timeline needs --entities: ids from find, separated by commas.")
                res = timeline(ctx.client, ids[:12], start, end, float(a.baseline_days), zone, series=bool(a.out))
                if a.out:
                    # the whole reading, charts included, for the investigation page; the AI gets the lines only
                    with open(a.out, "w", encoding="utf-8") as f:
                        json.dump({"start": start.isoformat(), "end": end.isoformat(), "zone": str(zone), **res}, f,
                                  ensure_ascii=False, default=str)
                    res = {"lines": res["lines"], "saved": a.out}
            else:
                res = around(ctx.client, ctx.store, start, end, ids, zone)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 — said plainly to the model, which says it to the person
        print(json.dumps({"error": f"{type(e).__name__}: {str(e)[:300]}"}))
        return 1
    print(json.dumps(res, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
