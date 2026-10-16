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
        --out also saves the reading with each device's chart, for the investigation page (page.py).

  investigate.py around    --start 2026-10-09T02:00 --end 2026-10-09T15:00 [--entities sensor.a,...] [--out around.json]
        Everything else Home Assistant recorded then: automations that ran, devices that dropped off or came back,
        notifications sent, people and doors, and the VESTA Agent's own alerts and faults.
        --out also saves them as data (who dropped off and came back, each automation and what it is able to do).

Times given and printed are the villa's (--zone, set by the agent). Output: JSON, each part with a "lines" list the
model can quote, and the raw figures under it.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from vesta_shared import script, skill_settings  # noqa: E402  (client, store, zone: one set-up for every skill script)
from vesta_shared import periods as kinds  # noqa: E402  (the period kinds and their words, read by the report page too)
from vesta_shared.timeutil import lasting  # noqa: E402  (the one duration wording)
from vesta_shared import past  # noqa: E402  (a read of the past with how far it got; the one "could not be read whole")

from vesta_shared.device_state import NO_VALUE, OFFLINE, RestartDrops  # noqa: E402  (the one "does this device answer")
# ⚠️ WHAT A CONTROL CAN PROVE (architecture review 32 follow-up, 2026-10-11): an on/off control that stayed OFF the whole
# period — and the days before — while another device ran is not what turned that device on. An account blamed a
# switch that had never once been on. Any control, any device: nothing here names one.
CONTROL_DOMAINS = ("switch", "light", "fan", "input_boolean", "valve", "siren", "humidifier")
OFF_STATES, ON_STATES = {"off", "closed"}, {"on", "open"}
MAX_LINES = 120                           # per part: enough for a night, short enough to reason about
# ⚠️ THE THRESHOLDS ARE THE SKILL'S, NOT THE SCRIPT'S (architecture review 32; the 0.12.80 rule): settings.yaml, with a
# villa's own villa.settings.yaml on top. A missing one is named, never guessed (`th`).
BEHAVIOUR = skill_settings.behaviour(skill_settings.load(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."), "settings.yaml"))


def th(name: str) -> float:
    if name not in BEHAVIOUR:
        raise KeyError(f"investigate's settings.yaml has no behaviour.{name}")
    return BEHAVIOUR[name]
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


def number(state) -> float | None:
    try:
        v = float(state)
    except (TypeError, ValueError):
        return None
    return v if v == v else None


def read(client, eid: str, start: datetime, end: datetime,
         now: datetime | None) -> tuple[list[tuple[datetime, str]], datetime, datetime | None]:
    """(time, state) of every recorded change of `eid` in [start, end), oldest first, the state before `start`
    included as the first row (Home Assistant gives it); how far the reading reached (`end`, now, or where it stopped);
    where it stopped short (None: read whole).

    ⚠️ NEVER PAST THE REACH (vesta_shared.past): a period, a chart and a normal end where the reading stopped."""
    got = client.history_read([eid], start, end, now)
    return got.changes(eid), got.reach(eid), (None if got.whole(eid) else got.reach(eid))


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
        return {"lines": [f"Nothing in the villa's records matches \"{what}\"" + (f" in {where}" if where else "") + "."],
                "entities": []}
    reg = {e["entity_id"]: e for e in (client.tool("ha_get_entity", {"entity_id": ids}) or {}).get("entity_entries") or []}
    states = client.states(ids)
    # ⚠️ ONE LOOKUP PER DEVICE, NOT PER ENTITY (villa, 2026-10-15: find took 50 s): twenty entities of two sensors asked
    # Home Assistant for the same device and the same serial twenty times each
    asked: dict[tuple[str, str], object] = {}
    lines, out = [], []
    for eid in ids:
        e, st = reg.get(eid, {}), states.get(eid) or {}
        attrs = st.get("attributes") or {}
        item = {"entity_id": eid, "name": attrs.get("friendly_name") or e.get("original_name") or eid,
                "area": e.get("area"), "state": st.get("state"), "unit": attrs.get("unit_of_measurement"),
                "device_class": e.get("device_class") or e.get("original_device_class") or attrs.get("device_class"),
                "device_id": e.get("device_id"), "platform": e.get("platform"),
                "same_box": _same_box(client, e, ids, asked), "same_room": []}
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


def _same_box(client, e: dict, exclude: list[str], asked: dict | None = None) -> list[tuple[str, str]]:
    """The other entities of the same physical device: its own device, and devices that share its unique id's prefix
    (one box an integration splits into several devices: a meter's channels and its relay). `asked`: the answers
    already read in this find, by (tool, key) — each device and each prefix is asked once."""
    asked = {} if asked is None else asked
    prefix = re.split(r"[-_:]", str(e.get("unique_id") or ""))[0]

    def once(tool: str, key: str, args: dict):
        if (tool, key) not in asked:
            asked[(tool, key)] = client.tool(tool, args) or {}
        return asked[(tool, key)]
    out = []
    try:
        dev = once("ha_get_device", e["device_id"], {"device_id": e["device_id"]}) if e.get("device_id") else {}
        out += [(x["entity_id"], x.get("name") or x["entity_id"]) for x in (dev.get("entities") or [])]
        if len(prefix) >= 8:                            # a serial or a MAC, never a word
            res = once("ha_search", prefix, {"query": prefix, "exact_match": True, "limit": 40,
                                             "result_fields": ["entity_id", "friendly_name"]})
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
            return kinds.OFFLINE
        if state in NO_VALUE:
            return kinds.NO_VALUE
        v = number(state)
        if v is None or on_above is None:
            return state
        if v > on_above:
            return kinds.RUNNING
        return kinds.NO_POWER if v == 0 else kinds.IDLE

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
        if abs(v - base) >= base * th("level_change_ratio"):
            if since is None or (t - since).total_seconds() >= th("level_change_gap_s"):
                out.append({"at": t, "from": base, "to": v})
                base, since = v, t
        else:
            since = t
    return out


def normal(rows: list[tuple[datetime, str]], end: datetime, on_above: float | None) -> dict:
    """The entity's own normal over the baseline days: how often and how long it runs, at what level."""
    ps = periods(rows, end, on_above)
    days = max((end - rows[0][0]).total_seconds() / 86400, 0.5) if rows else 1
    runs = [p for p in ps if p["kind"] == kinds.RUNNING]
    out = {"days": round(days, 1), "runs_per_day": round(len(runs) / days, 1)}
    if runs:
        secs = sorted(p["seconds"] for p in runs)
        out |= {"run_median_s": statistics.median(secs), "run_longest_s": secs[-1],
                "level_median": round(statistics.median(p["mean"] for p in runs if "mean" in p), 1)}
    rest = [p["mean"] for p in ps if p["kind"] == kinds.IDLE and "mean" in p]
    if rest:
        out["rest_median"] = round(statistics.median(rest), 2)
    off = [p for p in ps if p["kind"] in (kinds.OFFLINE, kinds.NO_POWER)]
    out["offline_or_no_power_s"] = sum(p["seconds"] for p in off)
    return out


def threshold(values: list[float]) -> float | None:
    """Above this a numeric entity counts as running: a share (running_fraction) of its HIGH readings — the top
    `high_quantile` of them, so a single spike does not set it — at least a little above zero. None for an entity that
    hardly moves (a temperature): read as levels, not runs.

    ⚠️ HIGH IS ITS TOP READINGS, NOT ITS 95th PERCENTILE (2026-10-11): a meter reporting its idle every few seconds and
    running a few seconds an hour has 99 % of its readings at rest — its 95th percentile WAS its rest, its runs were
    never counted ("normal: 0 runs a day"), and an investigation could say neither "longer than any normal run" nor
    "its supply was off"."""
    vals = sorted(v for v in values if v is not None)
    if len(vals) < 5:
        return None
    hi = vals[min(len(vals) - 1, int(len(vals) * th("high_quantile")))]
    lo = vals[int(len(vals) * 0.05)]
    if hi <= 0 or (hi - lo) < hi * th("flat_spread"):
        return None
    return max(hi * th("running_fraction"), th("running_min"))


CHART_POINTS = 400                        # a chart's points: each the highest reading of its slice (a surge stays seen)


def running_per_hour(ps: list[dict], start: datetime, end: datetime, base: list[dict], baseline_days: float) -> dict:
    """Minutes running in each hour of the period (each day, past 2 days), and its usual: the same hour's average over
    the days before. {"bins": [{"at", "minutes", "usual"}], "unit": "hour" | "day"}."""
    step = timedelta(hours=1) if end - start <= timedelta(days=2) else timedelta(days=1)
    edges, t = [], start
    while t < end:
        edges.append(t)
        t += step

    def ran(periods_: list[dict], a: datetime, b: datetime) -> float:
        return sum(max(0.0, (min(p["end"], b) - max(p["start"], a)).total_seconds())
                   for p in periods_ if p["kind"] == kinds.RUNNING) / 60
    days = int(baseline_days)
    bins = []
    for a in edges:
        b = min(a + step, end)
        usual = None
        if step == timedelta(hours=1) and days > 0:
            usual = round(sum(ran(base, a - timedelta(days=k), b - timedelta(days=k)) for k in range(1, days + 1)) / days, 1)
        bins.append({"at": a.isoformat(), "minutes": round(ran(ps, a, b), 1), "usual": usual})
    return {"bins": bins, "unit": "hour" if step == timedelta(hours=1) else "day"}


def spoken(eid: str) -> str:
    """A name for an entity Home Assistant gives none (no state, no history): its id said as words, never the id."""
    words = eid.split(".", 1)[-1].replace("_", " ").strip()
    return words[:1].upper() + words[1:] if words else eid


def same_hours_before(base_rows: list[tuple[datetime, str]], start: datetime, end: datetime,
                      baseline_days: float) -> list[dict]:
    """The device's normal drawn behind its chart: the SAME HOURS on each of the days before, from the readings already
    read for its normal (no other reading). Only for a period of a day or less — a longer one has no "same hours"."""
    if not base_rows or end - start > timedelta(days=1):
        return []
    out = []
    for k in range(1, int(baseline_days) + 1):
        shifted = [(t + timedelta(days=k), s) for t, s in base_rows if t < end - timedelta(days=k)]
        if shifted and shifted[0][0] <= end:
            pts = chart_series(shifted, start, end)
            if any(v is not None for _, v in pts):
                out.append({"days_before": k, "series": pts})
    return out


def state_series(rows: list[tuple[datetime, str]], start: datetime, end: datetime) -> list[dict]:
    """A device without numbers as its changes over [start, end): each {at, state, as} — `as` on / off / offline /
    other (value: one that reports a value, not a state), by the same vocabularies the timeline judges with."""
    # ⚠️ A VALUE IS NOT A STATE (owner, 2026-10-12: a relay's "Uptime" filled its whole lane): an entity with more
    # different states than `state_lane_max` reports a value (a time, a text) — its lane shows only when it stopped
    # reporting, never each value as "another state"
    distinct = {s for _, s in rows if s not in OFFLINE | NO_VALUE}
    value = len(distinct) > th("state_lane_max")
    out = []
    for t, s in rows:
        t = max(t, start)
        if t >= end:
            break
        tag = "offline" if s in OFFLINE | NO_VALUE else "value" if value else "on" if s in ON_STATES else \
            "off" if s in OFF_STATES else "other"
        if out and (out[-1]["state"] == s or out[-1]["as"] == tag == "value"):
            continue
        if out and out[-1]["at"] == t.isoformat():
            out.pop()                                          # two states at the same instant: the last one holds
        out.append({"at": t.isoformat(), "state": s, "as": tag})
    return out[-CHART_POINTS:]


def chart_series(rows: list[tuple[datetime, str]], start: datetime, end: datetime,
                 reach: datetime | None = None) -> list[list]:
    """The readings as at most CHART_POINTS [time, value] points over [start, end): each slice's HIGHEST reading, the
    last value carried through a slice with none; None where the device gave no number (offline) — and past `reach`,
    where the reading stopped: nothing is known there, nothing is drawn."""
    if not rows or end <= start:
        return []
    reach = end if reach is None else reach
    step = (end - start) / CHART_POINTS
    out, i, last = [], 0, None
    while i < len(rows) and rows[i][0] < start:
        last = number(rows[i][1]); i += 1
    for k in range(CHART_POINTS):
        a, b = start + k * step, start + (k + 1) * step
        if a >= reach:
            out.append([a.isoformat(), None])
            continue
        vals = [last] if last is not None else []
        while i < len(rows) and rows[i][0] < b:
            last = number(rows[i][1]); i += 1
            vals.append(last)
        nums = [v for v in vals if v is not None]
        out.append([a.isoformat(), max(nums) if nums else None])
    return out


def timeline(client, ids: list[str], start: datetime, end: datetime, baseline_days: float, zone: ZoneInfo,
             series: bool = False, now: datetime | None = None) -> dict:
    """`series`: each numeric device's readings for a chart too (--out: the investigation page, page.py). `now`: the
    time it is (the clock when not given) — no reading goes past it."""
    span_days = (end - start).total_seconds() > 86400
    parts = []
    names = client.states(ids)
    for eid in ids:
        # where the history could not be read further (vesta_shared.ha_client: its cap) — never stretched past it
        rows, reach, cut = read(client, eid, start, end, now)
        if not rows:
            parts.append({"entity_id": eid, "lines": [f"{eid}: nothing recorded in this period."], "nothing": True,
                          "label": ((names.get(eid) or {}).get("attributes") or {}).get("friendly_name") or spoken(eid)})
            continue
        base_rows, base_reach, _ = read(client, eid, start - timedelta(days=baseline_days), start, now) \
            if baseline_days > 0 else ([], start, None)
        on = threshold([number(s) for _, s in base_rows + rows])
        ps = periods(rows, reach, on)
        ref = normal(base_rows, base_reach, on) if base_rows else {}
        lines = [f"{eid}: {len(rows)} readings" + (f"; counted as running above {on:g}" if on else "")]
        if cut:
            lines.append(f"  ⚠️ {past.unread('its history', at(cut, zone, span_days))} "
                         "(too many readings) — say so, and narrow the period to read the rest")
        if ref:
            r = ref
            lines.append("  normal (the %g days before): %s runs a day%s%s%s" % (
                r["days"], r["runs_per_day"],
                f", usually {lasting(r['run_median_s'])}" if "run_median_s" in r else "",
                f", longest {lasting(r['run_longest_s'])}" if "run_longest_s" in r else "",
                f", at about {r['level_median']:g}" if "level_median" in r else "")
                + (f"; at rest {r['rest_median']:g}" if "rest_median" in r else ""))
        shown, hidden = worth_a_line(ps, ref, on)
        for p in shown[:MAX_LINES]:
            lvl = f" at {p['mean']:.4g} (from {p['min']:.4g} to {p['max']:.4g})" if "mean" in p and on else \
                (f" reading {p['mean']:.4g}" if "mean" in p else "")
            flag = f"  ⟵ {p['why']}" if p.get("why") else ""
            lines.append(f"  {at(p['start'], zone, span_days)} → {at(p['end'], zone, span_days)}  {p['kind']} "
                         f"for {lasting(p['seconds'])}{lvl}{flag}")
        if len(shown) > MAX_LINES:
            lines.append(f"  … {len(shown) - MAX_LINES} more periods (narrow the period to see them)")
        if hidden > 0:
            lines.append(f"  ({hidden} short ordinary periods not listed: like its normal)")
        if on:
            for j in level_jumps(rows, start, end, on)[:20]:
                lines.append(f"  {at(j['at'], zone, span_days)} level changes from about {j['from']:.0f} to {j['to']:.0f}")
        totals: dict[str, float] = {}
        for p in ps:
            totals[p["kind"]] = totals.get(p["kind"], 0) + p["seconds"]
        lines.append("  in total: " + ", ".join(f"{k} {lasting(v)}" for k, v in sorted(totals.items(), key=lambda x: -x[1])))
        attrs = (names.get(eid) or {}).get("attributes") or {}
        part = {"entity_id": eid, "running_above": on, "normal": ref, "lines": lines,
                "periods": [_saved(p) for p in shown[:MAX_LINES]], **({"cut": cut.isoformat()} if cut else {}),
                "label": attrs.get("friendly_name") or eid, "runs": sum(1 for p in ps if p["kind"] == kinds.RUNNING)}
        if eid.split(".")[0] in CONTROL_DOMAINS:
            seen = {str(v) for _, v in base_rows + rows if str(v) not in OFFLINE | NO_VALUE}
            part["control"] = "off" if seen and seen <= OFF_STATES else "on" if seen and seen <= ON_STATES else None
        if series and any(number(v) is not None for _, v in rows):
            part.update(name=attrs.get("friendly_name") or eid, unit=attrs.get("unit_of_measurement") or "",
                        series=chart_series(rows, start, end, reach),
                        # ⚠️ THE CHART THAT FITS THE DEVICE (owner, 2026-10-12: "would you use other metric?"): a device
                        # that RUNS gets its minutes running per hour against its usual — its days before drawn as
                        # lines were spikes nobody could read; one read as LEVELS (a temperature) keeps them, dashed
                        **({"per_hour": running_per_hour(ps, start, end, periods(base_rows, base_reach, on), baseline_days)}
                           if on else {"normal_series": same_hours_before(base_rows, start, end, baseline_days)}))
        elif series:
            part["states"] = state_series(rows, start, end)        # a lane under the charts (page.py)
        parts.append(part)
    _controls(parts, baseline_days)
    return {"lines": [l for p in parts for l in p["lines"]], "entities": parts, "baseline_days": baseline_days,
            # what the page needs of this skill's settings to join the readings (page.py)
            "settings": {"coincide_s": th("coincide_s")}}


def _saved(p: dict) -> dict:
    out = {**p, "start": p["start"].isoformat(), "end": p["end"].isoformat()}
    if p.get("alert"):
        out["alert"] = {**p["alert"], "at": p["alert"]["at"].isoformat()}
    return out


def _controls(parts: list[dict], baseline_days: float) -> None:
    """Under each on/off control read with the devices it might drive: what its states prove about them. Only a control
    that never left one state proves anything — one that changed may or may not drive them, and says nothing here."""
    ran = [p for p in parts if p.get("runs") and not p.get("control")]
    if not ran:
        return
    who = ", ".join(f"{p['label']} ({p['runs']} run{'s' if p['runs'] > 1 else ''})" for p in ran)
    before = f" and the {baseline_days:g} days before" if baseline_days > 0 else ""
    for c in parts:
        if c.get("control") == "off":
            c["lines"].append(f"  ⟵ stayed off for the whole period{before}, while {who} ran: it is NOT what turned "
                              f"{'it' if len(ran) == 1 else 'them'} on")
        elif c.get("control") == "on":
            c["lines"].append(f"  stayed on for the whole period{before}: it may supply {who}, but its state does not "
                              "explain their starts and stops")


def worth_a_line(ps: list[dict], ref: dict, on: float | None) -> tuple[list[dict], int]:
    """(the periods worth a line, how many ordinary ones were left out). ⚠️ STOP-START FIRST (2026-10-11): judged first,
    the short runs of a stop-start burst were "ordinary" and dropped before they could be grouped — the pump's 8 restarts
    of 9 October vanished from the page once a short run's level stopped being flagged."""
    grouped = _cycles(ps)
    notable = _notable(grouped, ref, on)
    return notable, len(grouped) - len(notable)


def _cycles(ps: list[dict]) -> list[dict]:
    """Six or more short running / idle periods in a row (each under 3 minutes) said as ONE line: "stops and restarts
    8 times" — what a person needs to know, not sixteen lines."""
    out, i = [], 0
    while i < len(ps):
        j = i
        while j < len(ps) and ps[j]["kind"] in (kinds.RUNNING, kinds.IDLE) and ps[j]["seconds"] < th("cycle_short_s"):
            j += 1
        group = ps[i:j]
        runs = [p for p in group if p["kind"] == kinds.RUNNING]
        if len(runs) >= th("cycle_min_runs") and len(group) >= th("cycle_min_periods"):
            levels = [p["mean"] for p in runs if "mean" in p]
            nth = runs[int(th("cycle_min_runs")) - 1]           # the run that makes it cycling: an alert there
            out.append({"alert": {"rule": f"it starts {th('cycle_min_runs'):g} times in a row, each run shorter than "
                                          f"{lasting(th('cycle_short_s'))}", "at": nth["start"]},
                        "kind": kinds.restarts(len(runs)), "start": group[0]["start"],
                        "end": group[-1]["end"], "seconds": (group[-1]["end"] - group[0]["start"]).total_seconds(),
                        **({"mean": sum(levels) / len(levels), "min": min(p["min"] for p in runs),
                            "max": max(p["max"] for p in runs)} if levels else {}),
                        "why": "runs of about " + lasting(statistics.median(p["seconds"] for p in runs)) + " each"})
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
        why, alerts = [], []
        if p["kind"] == kinds.RUNNING:
            limit = max(longest * th("longer_ratio"), longest + th("longer_extra_s")) if longest else None
            if limit and p["seconds"] > limit:
                why.append(f"longer than its longest usual run ({lasting(longest)})")
                alerts.append((limit, f"it runs for more than {lasting(limit)} without stopping"))
            # a level is judged only over as long as an alert on it would need (a start-up surge of 8 s is not one)
            lasts = p["seconds"] >= th("level_change_gap_s")
            if lasts and level and "mean" in p and p["mean"] > level * th("level_high_ratio"):
                why.append(f"about {p['mean'] / level:.1f}× its usual running level")
                alerts.append((th("level_change_gap_s"), f"it stays above {th('level_high_ratio'):g}× its usual running "
                                                         f"level for {lasting(th('level_change_gap_s'))}"))
            if lasts and level and "mean" in p and p["mean"] < level * th("level_low_ratio"):
                why.append(f"only {p['mean'] / level:.0%} of its usual running level")
                alerts.append((th("level_change_gap_s"), f"it stays below {th('level_low_ratio'):.0%} of its usual "
                                                         f"running level for {lasting(th('level_change_gap_s'))}"))
        elif p["kind"] == kinds.NO_POWER and rest and rest > 0 and p["seconds"] >= th("offline_min_s"):
            why.append(f"it read 0 instead of its usual {rest:g} at rest")
            alerts.append((th("offline_min_s"), f"it reads 0 for {lasting(th('offline_min_s'))}"))
        elif p["kind"] in (kinds.OFFLINE, kinds.NO_VALUE) and p["seconds"] >= th("offline_min_s"):
            why.append("it " + kinds.did(p["kind"]))
            alerts.append((th("offline_min_s"), f"it stops reporting for {lasting(th('offline_min_s'))}"))
        if why:
            p["why"] = "; ".join(why)
        # ⚠️ WHAT WOULD HAVE WARNED, BY THE RULE THAT FLAGGED IT (the facts-first page, 2026-10-11): the earliest moment
        # an alert on the same limit would have fired — only while the period still lasted, never after it
        fired = [(s, rule) for s, rule in alerts if s < p["seconds"]]
        if fired:
            s, rule = min(fired)
            p["alert"] = {"rule": rule, "at": p["start"] + timedelta(seconds=s)}
        ordinary = not why and p["kind"] in (kinds.RUNNING, kinds.IDLE) and p["seconds"] < th("ordinary_max_s") \
            and len(ps) > th("ordinary_hide_over")
        if not ordinary:
            out.append(p)
    return out


# ------------------------------------------------------------------ around
def around(client, store, start: datetime, end: datetime, focus: list[str], zone: ZoneInfo,
           now: datetime | None = None) -> dict:
    span_days = (end - start).total_seconds() > 86400
    hours = max((end - start).total_seconds() / 3600, 1)
    book = client.logbook_read(start, end, now=now)
    rows = book.rows
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
        elif eid in focus or (count.get(eid, 0) / hours <= th("noise_per_hour") and dom in (
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
    # ⚠️ A RESTART IS SAID ONCE, NOT AS EVERY DEVICE (2026-10-13): a period holding a Home Assistant restart listed
    # nearly every device as "stopped answering" and never said Home Assistant had restarted. A device that went and
    # answered again within `restart_settle_minutes` of it was the restart's; one that did not come back stays listed.
    # the one answer to "was it the restart's" (vesta_shared.device_state.RestartDrops, the nightly check's too)
    drops = RestartDrops(rows, th("restart_settle_minutes"))
    restart_only = {e for t, _, e in offline if drops.theirs(e, t)}
    offline = [o for o in offline if not drops.theirs(o[2], o[0])]
    back = [b for b in back if not drops.theirs(b[2], b[0])]
    lines = []
    if drops.restarts:
        lines.append("The villa's system restarted: " + ", ".join(at(t, zone, span_days) for t in drops.restarts)
                     + f" ({len(restart_only)} device(s) dropped and answered again with it, not listed below)")
    if offline:
        lines.append("Devices that stopped answering:")
        # one the restart took down and that never answered again is said so — the nightly check, too, takes such a
        # drop for the restart's, never a reconnect of the device's own
        lines += [f"  {at(t, zone, span_days)}  {n} ({e})" + ("  — with the restart, not back since"
                                                                 if drops.kept_down(e, t) else "")
                  for t, n, e in _first_per(offline)[:40]]
    if back:
        lines.append("…and answered again:")
        lines += [f"  {at(t, zone, span_days)}  {n} ({e})" for t, n, e in _first_per(back)[:40]]
    ran = []
    if autos:
        lines.append("Automations that ran (and what each one is able to do):")
        for eid, a in sorted(autos.items(), key=lambda x: x[1]["times"][0]):
            ts = a["times"]
            able = automation_able(client, eid, start, end)
            lines.append(f"  {a['name']} ({eid}): {len(ts)}× from {at(ts[0], zone, span_days)} to {at(ts[-1], zone, span_days)}"
                         + (f" — {a['why']}" if a["why"] else ""))
            lines.append(f"    able to: {able['text']}")
            ran.append({"id": eid, "name": a["name"], "times": [t.isoformat() for t in ts], **able})
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
    # where the logbook could not be read further (vesta_shared.past) — never taken for "nothing else"
    if not book.whole:
        lines.append(f"⚠️ {past.unread('the logbook', at(book.reach, zone, span_days))} "
                     "(too many entries) — say so, and narrow the period to read the rest")
    noisy = sorted(((n, e) for e, n in count.items() if n / hours > th("noise_per_hour") and e not in focus), reverse=True)[:8]
    if noisy:
        lines.append("Left out as background (change constantly): " + ", ".join(e for _, e in noisy))
    # the same, as data — the investigation page builds its facts from it (page.py --around)
    data = {"offline": [{"at": t.isoformat(), "name": n, "id": e} for t, n, e in _first_per(offline)[:40]],
            "back": [{"at": t.isoformat(), "name": n, "id": e} for t, n, e in _first_per(back)[:40]],
            "automations": ran, "notifications": [{"at": t.isoformat(), "name": n} for t, n in sent[:40]],
            "settings": {"coincide_s": th("coincide_s")}}
    return {"lines": lines, "data": data}


# What an action does, by its kind (`domain.service`, or the kind of step): only these change nothing on the villa.
#: ⚠️ WHAT AN AUTOMATION CAN DO, READ — NEVER INFERRED FROM ITS RUNNING THEN (review 32 follow-up): an account named a
#: watchdog that "ran during the event" as a possible cause; all it could do was notify and record a date.
HARMLESS = {"notify": "notifies", "persistent_notification": "notifies", "tts": "speaks a message",
            "logbook": "writes the logbook", "system_log": "writes the log", "input_datetime": "records a value",
            "input_text": "records a value", "input_number": "records a value", "counter": "records a value",
            "input_select": "records a value", "event": "fires an event", "delay": None, "wait": None, "stop": None}


def _actions(node, out: set, targets: set | None = None) -> None:
    """Every action an automation's config can take, at any depth (choose, if/then/else, repeat, parallel, sequence) —
    and, in `targets`, the entities its actions that change things name (a template's: not readable, left out)."""
    if isinstance(node, list):
        for x in node:
            _actions(x, out, targets)
        return
    if not isinstance(node, dict):
        return
    for key in ("action", "service"):
        v = node.get(key)
        if isinstance(v, str) and "." in v:
            out.add(v)
            if targets is not None and v.split(".")[0] not in HARMLESS:
                for where in (node, node.get("target"), node.get("data")):
                    named = (where or {}).get("entity_id") if isinstance(where, dict) else None
                    for e in ([named] if isinstance(named, str) else named if isinstance(named, list) else []):
                        if isinstance(e, str) and ENTITY_ID.match(e):
                            targets.add(e)
    if isinstance(node.get("event"), str):
        out.add("event.fire")
    if "scene" in node and isinstance(node.get("scene"), str):
        out.add("scene.turn_on")
    if node.get("device_id") and node.get("type") and node.get("domain"):
        out.add(f"{node['domain']}.{node['type']}")                     # a device action: acts on the device itself
    for k, v in node.items():
        if k not in ("action", "service", "event") and isinstance(v, (list, dict)):
            _actions(v, out, targets)


def _say_actions(calls: set) -> str:
    changes = _changes(calls)
    harmless = _harmless(calls)
    if not calls:
        return "nothing — it has no action"
    if not changes:
        return " and ".join(harmless) + " only: it switches nothing, so it cannot have turned a device on or off"
    scripts = [c for c in changes if c.startswith("script.")]
    return ("CAN change things: " + ", ".join(changes) + (f" (and {', '.join(harmless)})" if harmless else "")
            + ("; a script it runs may do more — read it" if scripts else ""))


def automation_can(client, eid: str, start: datetime, end: datetime) -> str:
    """What an automation is able to do, in words (see `automation_able`)."""
    return automation_able(client, eid, start, end)["text"]


def automation_able(client, eid: str, start: datetime, end: datetime) -> dict:
    """What an automation is able to do, read from its own config — or, built from a blueprint whose text cannot be read
    here, said to be unproven, with what its runs kept by Home Assistant actually did in the period.
    {"text", "can": "nothing" (it switches nothing) | "changes" (the actions in "changes") | "unproven"}: the page sorts
    by "can", never by the words."""
    try:
        body = client.tool("ha_config_get_automation", {"identifier": eid}) or {}
    except Exception as e:  # noqa: BLE001 — said, never guessed
        return {"text": f"its configuration could not be read ({type(e).__name__}): not proven either way",
                "can": "unproven", "changes": []}
    cfg = body.get("config") if isinstance(body.get("config"), dict) else body
    if isinstance(cfg, dict) and cfg.get("use_blueprint"):
        # ⚠️ A BLUEPRINT IS READ, ITS INPUTS FILLED (owner, 2026-10-12: five automations said "could not be read"): the
        # blueprint's own actions, each {"__input__": name} replaced by this automation's input or the default
        made = _from_blueprint(client, cfg["use_blueprint"] or {})
        if made is not None:
            cfg = {"actions": made}
        else:
            path = (cfg["use_blueprint"] or {}).get("path") or "a blueprint"
            did = _traced(client, eid, start, end)
            return {"text": f"built from the blueprint {path}, whose actions cannot be read here — not proven either way"
                            + (f"; its recorded runs in this period did: {did}" if did else
                               "; its runs of this period are no longer kept"),
                    "can": "unproven", "changes": []}
    calls, targets = set(), set()
    _actions((cfg or {}).get("actions") or (cfg or {}).get("action") or [], calls, targets)
    changes = _changes(calls)
    out = {"text": _say_actions(calls), "can": "changes" if changes else "nothing", "changes": changes,
           "does": _harmless(calls)}
    if changes:
        # what it can act ON, by name: "it can switch the jacuzzi's relay" says at once whether it could touch the device
        out["targets"] = [{"id": e, "name": _name(client, e)} for e in sorted(targets)]
        if targets:
            out["text"] += "; on: " + ", ".join(f"{t['name']} ({t['id']})" for t in out["targets"])
    return out


def _from_blueprint(client, use: dict):
    """A blueprint automation's actions with its inputs filled in — None when the blueprint cannot be read."""
    try:
        got = client.tool("ha_manage_blueprints", {"action": "get", "path": use.get("path"), "domain": "automation"}) or {}
    except Exception:  # noqa: BLE001 — unreadable: said "not proven", never guessed
        return None
    got = got.get("data") if isinstance(got.get("data"), dict) else got
    bp = got.get("config") if isinstance(got.get("config"), dict) else None
    if not bp:
        return None
    given = dict(use.get("input") or {})
    defaults = {k: (v or {}).get("default") for k, v in ((bp.get("blueprint") or {}).get("input") or {}).items()
                if isinstance(v, dict)}

    def fill(node):
        if isinstance(node, dict):
            if set(node) == {"__input__"}:
                return given.get(node["__input__"], defaults.get(node["__input__"]))
            return {k: fill(v) for k, v in node.items()}
        if isinstance(node, list):
            return [fill(v) for v in node]
        return node
    return fill(bp.get("actions") or bp.get("action") or [])


def _name(client, eid: str) -> str:
    try:
        return ((client.states([eid]).get(eid) or {}).get("attributes") or {}).get("friendly_name") or eid
    except Exception:  # noqa: BLE001 — a name is a help
        return eid


def _changes(calls: set) -> list[str]:
    return sorted(c for c in calls if c.split(".")[0] not in HARMLESS)


def _harmless(calls: set) -> list[str]:
    return sorted({HARMLESS[c.split(".")[0]] for c in calls if HARMLESS.get(c.split(".")[0])})


def _traced(client, eid: str, start: datetime, end: datetime) -> str:
    """What the runs Home Assistant still keeps (its last few) did inside the period, in the same words."""
    try:
        listed = client.tool("ha_get_automation_traces", {"automation_id": eid, "limit": 10}) or {}
    except Exception:  # noqa: BLE001
        return ""
    calls: set = set()
    for t in listed.get("traces") or []:
        try:
            began = datetime.fromisoformat(str((t.get("timestamp") or {}).get("start")))
        except (TypeError, ValueError):
            continue
        if not (start <= began < end):
            continue
        try:
            detail = client.tool("ha_get_automation_traces", {"automation_id": eid, "run_id": t.get("run_id")}) or {}
        except Exception:  # noqa: BLE001
            continue
        for step in detail.get("action_trace") or []:
            params = ((step or {}).get("result") or {}).get("params") or {}
            if params.get("domain") and params.get("service"):
                calls.add(f"{params['domain']}.{params['service']}")
    return _say_actions(calls) if calls else ""


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
    ap.add_argument("--out", help="timeline / around: also save the reading as data (charts, events), for the investigation page")
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
            # ⚠️ A PERIOD THAT ENDS LATER ENDS NOW (villa, 2026-10-15: "--end" today was midnight tonight, and a sensor
            # offline 6 d 6 h at 23:05 read "6 d 7 h": its last period ran to a moment that had not come)
            end = past.until(end, ctx.now)
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
                res = timeline(ctx.client, ids[:12], start, end, float(a.baseline_days), zone, series=bool(a.out),
                               now=ctx.now)
                if a.out:
                    # the whole reading, charts included, for the investigation page; the AI gets the lines only
                    with open(a.out, "w", encoding="utf-8") as f:
                        json.dump({"start": start.isoformat(), "end": end.isoformat(), "zone": str(zone), **res}, f,
                                  ensure_ascii=False, default=str)
                    res = {"lines": res["lines"], "saved": a.out}
            else:
                res = around(ctx.client, ctx.store, start, end, ids, zone, now=ctx.now)
                if a.out:
                    with open(a.out, "w", encoding="utf-8") as f:
                        json.dump({"start": start.isoformat(), "end": end.isoformat(), "zone": str(zone), **res["data"]},
                                  f, ensure_ascii=False, default=str)
                    res = {"lines": res["lines"], "saved": a.out}
                else:
                    res = {"lines": res["lines"]}
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 — said plainly to the model, which says it to the person
        print(json.dumps({"error": f"{type(e).__name__}: {str(e)[:300]}"}))
        return 1
    print(json.dumps(res, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
