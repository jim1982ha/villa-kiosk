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
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from vesta_shared import script, skill_settings  # noqa: E402  (client, store, zone: one set-up for every skill script)
from vesta_shared.critical import run_when  # noqa: E402  (a rule's "When this rule runs": one reading)
from vesta_shared import daily  # noqa: E402  (the villa's one "running")
from vesta_shared.params import VillaParams  # noqa: E402
from vesta_shared import periods as kinds  # noqa: E402  (the period kinds and their words, read by the report page too)
from vesta_shared.timeutil import clock, lasting  # noqa: E402  (the one clock, the one duration wording)
from vesta_shared import past  # noqa: E402  (a read of the past with how far it got; the one "could not be read whole")
from vesta_shared import retention  # noqa: E402  (where the villa's detail ends, and the figures that take over)
from vesta_shared.store import Notes, notes_of  # noqa: E402  (an alert's notes: one reader)

from vesta_shared.asleep import without_sleep  # noqa: E402  (unavailable by design: one list, vesta_shared.asleep)
from vesta_shared.device_state import ASLEEP_NOW, NO_VALUE, OFFLINE, RestartDrops  # noqa: E402  (the one "does this device answer")
from vesta_shared.limits import limit  # noqa: E402  (every limit, set on the VESTA Agent page's Limits tab)
# ⚠️ WHAT A CONTROL CAN PROVE (architecture review 32 follow-up, 2026-10-11): an on/off control that stayed OFF the whole
# period — and the days before — while another device ran is not what turned that device on. An account blamed a
# switch that had never once been on. Any control, any device: nothing here names one.
CONTROL_DOMAINS = ("switch", "light", "fan", "input_boolean", "valve", "siren", "humidifier")
OFF_STATES, ON_STATES = {"off", "closed"}, {"on", "open"}
MAX_LINES = limit("investigate.max_lines", 120, unit="lines", group="ai", lo=10, hi=2000,  # enough for a night
                  says="Lines of one device's periods, and of the other changes around an incident, handed to the AI.",
                  reached="The rest is counted in an \"… N more\" line.", told="ai")
FIND_MATCHES = limit("investigate.find_matches", 20, unit="devices", group="read", lo=1, hi=200,
                     says="Devices an investigation may find for the words the person used.",
                     reached="A further matching device is never offered.", told="")
SAME_DEVICE_SEARCH = limit("investigate.same_device_search", 40, unit="devices", group="read", lo=1, hi=500,
                           says="Devices searched by serial number when looking for the other parts of the same box.",
                           reached="Further parts of the same box are not found.", told="")
SAME_ROOM_SEARCH = limit("investigate.same_room_search", 60, unit="devices", group="read", lo=1, hi=500,
                         says="Devices of the same room read when looking for what could share a supply.",
                         reached="The room's further devices are not looked at.", told="")
NEIGHBOURS_SHOWN = limit("investigate.neighbours_shown", 12, unit="devices", group="ai", lo=1, hi=200,
                         says="Neighbours named per line (same box, same room) when an investigation finds a device.",
                         reached="The further neighbours are not named.", told="")
TIMELINE_DEVICES = limit("investigate.timeline_devices", 12, unit="devices", group="read", lo=1, hi=100,
                         says="Devices read in one timeline of an investigation.",
                         reached="The further devices named are not read.", told="")
LEVEL_CHANGES_SHOWN = limit("investigate.level_changes_shown", 20, unit="lines", group="ai", lo=1, hi=500,
                            says="Level changes of one device listed in its timeline.",
                            reached="The further level changes are not listed.", told="")
AROUND_LISTED = limit("investigate.around_listed", 40, unit="devices", group="ai", lo=1, hi=1000,
                      says="Devices that stopped answering, answered again, and notifications sent, listed around an "
                           "incident (each list).",
                      reached="The further ones are not listed.", told="")
NOISY_NAMED = limit("investigate.noisy_named", 8, unit="devices", group="ai", lo=1, hi=200,
                    says="Constantly changing devices named as left out of the context around an incident.",
                    reached="The further ones are left out without being named.", told="")
TRACES_READ = limit("investigate.traces_read", 10, unit="runs", group="read", lo=1, hi=100,
                    says="Recent runs of an automation read to see what it actually did.",
                    reached="Older runs are not read (the villa's system keeps only its last few anyway).", told="")
RECORD_LINE_CHARS = limit("investigate.record_line_chars", 120, unit="characters", group="text", lo=20, hi=2000,
                          says="Length of each VESTA alert or night-check finding quoted in an investigation.",
                          reached="The line is cut.", told="")
WRONG_IDS_NAMED = limit("investigate.wrong_ids_named", 3, unit="names", group="text", lo=1, hi=50,
                        says="Wrongly written device names quoted back when the AI asks for a timeline.",
                        reached="The further wrong names are not quoted.", told="")
ERROR_CHARS = limit("investigate.error_chars", 300, unit="characters", group="text", lo=50, hi=5000,
                    says="Length of the error an investigation step hands back when it fails.",
                    reached="The error text is cut.", told="")
BASELINE_DAYS = limit("investigate.baseline_days", 3, unit="days", group="read", lo=0, hi=30,
                      says="Days before the period read as a device's normal, when the AI names no other number.",
                      reached="Older days are not part of the normal.", told="ai")
# ⚠️ THE THRESHOLDS ARE THE SKILL'S, NOT THE SCRIPT'S (architecture review 32; the 0.12.80 rule): settings.yaml, with a
# villa's own villa.settings.yaml on top. A missing one is named, never guessed (`th`).
SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS = skill_settings.load(SKILL, "settings.yaml")
BEHAVIOUR = skill_settings.behaviour(SETTINGS)
#: What the investigation says when the villa's system re-ran every rule itself (settings.yaml `words`): one line for
#: a reload or a start, never a "ran … check whether it did" line per rule.
WORDS: dict = SETTINGS.get("words") or {}
SYSTEM_WORDS = {"reloaded": "rules_reloaded", "started": "system_started"}


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
    """A moment as the lines the AI reads write it: "03:09:46" — WITH its seconds (a 71-second drop, a run of 8 s:
    the AI reasons on them) — and its day when the period spans several ("9 Oct, 03:09:46"). The one clock
    (timeutil.clock): the page says the same moment "03:09", and the AI's own rows the same way."""
    return clock(t, zone, days=day, seconds=True)


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
def find(client, what: str, where: str | None, pack=None) -> dict:
    """The entities `what` (and `where`) mean, with their neighbours. Universal: Home Assistant's own search, devices
    and areas — no list of devices anywhere."""
    args = {"query": what, "exact_match": False, "limit": FIND_MATCHES,
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
                "same_box": _same_box(client, e, ids, asked, pack), "same_room": []}
        out.append(item)
    _same_room(client, out)
    for it in out:
        unit = f" {it['unit']}" if it["unit"] else ""
        lines.append(f"{it['name']} ({it['entity_id']}) — {it['area'] or 'no room'} — now {it['state']}{unit}")
        if it["same_box"]:
            lines.append("  same physical device: " + ", ".join(f"{n} ({x})" for x, n in it["same_box"][:NEIGHBOURS_SHOWN]))
        if it["same_room"]:
            lines.append("  powered devices in the same room: " + ", ".join(f"{n} ({x})" for x, n in it["same_room"][:NEIGHBOURS_SHOWN]))
    return {"lines": lines, "entities": out}


def _same_box(client, e: dict, exclude: list[str], asked: dict | None = None, pack=None) -> list[tuple[str, str]]:
    """The other entities of the same physical device: its own device, the parts the villa's system lists under it
    (the knowledge pack's `via`: KnowledgePack.entities_of_device — the rule every check uses, owner 2026-10-18), and
    devices that share its unique id's prefix (one box an integration splits into devices with no `via` between them).
    `asked`: the answers already read in this find, by (tool, key) — each device and each prefix is asked once.

    ⚠️ "SAME DEVICE" HAD ITS OWN MEANING HERE (architecture review scan 1, 2026-10-19): the night's checks knew a meter
    and its phases were one device since 0.12.249; the investigation still guessed from the serial number alone."""
    asked = {} if asked is None else asked
    prefix = re.split(r"[-_:]", str(e.get("unique_id") or ""))[0]

    def once(tool: str, key: str, args: dict):
        if (tool, key) not in asked:
            asked[(tool, key)] = client.tool(tool, args) or {}
        return asked[(tool, key)]
    out = []
    if pack is not None and e.get("device_id"):
        out += [(x, pack.name_of(x, x) or x) for x in sorted(pack.entities_of_device(e["device_id"]))]
    try:
        dev = once("ha_get_device", e["device_id"], {"device_id": e["device_id"]}) if e.get("device_id") else {}
        out += [(x["entity_id"], x.get("name") or x["entity_id"]) for x in (dev.get("entities") or [])]
        if len(prefix) >= 8:                            # a serial or a MAC, never a word
            res = once("ha_search", prefix, {"query": prefix, "exact_match": True, "limit": SAME_DEVICE_SEARCH,
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
            res = client.tool("ha_search", {"area_filter": room, "limit": SAME_ROOM_SEARCH,
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
def periods(rows: list[tuple[datetime, str]], end: datetime, on_above: float | None,
            zero_is_rest: bool = False) -> list[dict]:
    """The rows as periods of one condition each: "running" (above on_above), "idle", "no power" (exactly 0 where the
    device usually reads a little at rest — never for one whose rest reads 0 too, `zero_is_rest`), "offline", "no
    value", or the state itself for a non-numeric entity."""
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
        return kinds.NO_POWER if v == 0 and not zero_is_rest else kinds.IDLE

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
        # ⚠️ A LEVEL IS ONE THAT HELD (villa, 2026-10-21 00:13): a start's surge (3,050 W for 2 s) stayed the "level" of
        # the run, so the settled 750 W after it read as "level changes from about 3,050 to 750". `since` is when the
        # level began: one that did not hold the gap is replaced by what follows, never reported as a change
        if abs(v - base) >= base * th("level_change_ratio"):
            if (t - since).total_seconds() >= th("level_change_gap_s"):
                out.append({"at": t, "from": base, "to": v})
            base, since = v, t
    return out


def rests_at_zero(rows: list[tuple[datetime, str]], on_above: float | None) -> bool:
    """Whether the device's rest reads exactly 0 often on the days before (settings `zero_rest_share`).

    ⚠️ ITS 0 IS REST, NOT "NO POWER" (owner, 2026-10-20: "I never want to see wrong responses"). The House Pump idles
    between 0 and 1.7 W: every 0 was a "no power" period, 140 lines of them, one flagged "it read 0 instead of its usual
    1.21 at rest" — and its real trouble, starting every few minutes, sank under them."""
    if on_above is None:
        return False
    rest = [v for _, s in rows if (v := number(s)) is not None and v <= on_above]
    return bool(rest) and sum(1 for v in rest if v == 0) / len(rest) >= th("zero_rest_share")


def by_hour(times: list[datetime], before: list[datetime], start: datetime, end: datetime, baseline_days: float,
            zone: ZoneInfo) -> str | None:
    """How many of `times` fell in each hour of the period, each beside the most that hour had on one of the days
    before ("13:00 17 (1)"): None for a period over a day, or one of a single hour.

    ⚠️ WHERE IN THE PERIOD, NOT ONLY HOW MANY (owner, 2026-10-20). The House Pump's burst of 13:28 was listed, and its
    starts at 15:00, 15:20 … 17:50 — each over 3 minutes apart, so each "ordinary" — were hidden under "like its
    normal": the answer said it "went idle" after the burst. Every hour is said, an empty one too."""
    span = (end - start).total_seconds()
    if span > 86400 or span <= 3600:
        return None
    first = start.astimezone(zone).replace(minute=0, second=0, microsecond=0)
    slots, t = [], first
    while t < end:
        a, b = max(t, start), min(t + timedelta(hours=1), end)
        n = sum(1 for x in times if a <= x < b)
        usual = max((sum(1 for x in before if a - timedelta(days=k) <= x < b - timedelta(days=k))
                     for k in range(1, int(baseline_days) + 1)), default=None)
        slots.append(f"{t.strftime('%H:%M')} {n}" + (f" ({usual})" if usual is not None else ""))
        t += timedelta(hours=1)
    return " · ".join(slots)


def starts_line(ps: list[dict], base: list[dict], start: datetime, end: datetime, baseline_days: float) -> dict | None:
    """How many times it started in [start, end), against the same hours of each day before (a period of a day or
    less) or its daily rate (a longer one); flagged when far more often (settings `starts_ratio`, `starts_min`).

    ⚠️ HOW OFTEN, NOT ONLY HOW LONG (owner, 2026-10-20). Each of the House Pump's runs that afternoon was of its usual
    length and level, so no run was unusual — it was starting every few minutes instead of a few times a day, and
    nothing said so."""
    n = sum(1 for p in ps if p["kind"] == kinds.RUNNING and start <= p["start"] < end)
    span = (end - start).total_seconds()
    if not base or span <= 0:
        return {"starts": n, "line": f"  started {n} times in {lasting(span)}"}
    if span <= 86400:
        days = int(baseline_days)
        before = [sum(1 for p in base if p["kind"] == kinds.RUNNING
                      and start - timedelta(days=k) <= p["start"] < end - timedelta(days=k)) for k in range(1, days + 1)]
        usual, said = max(before), f"the same hours of the {days} days before: " + ", ".join(map(str, reversed(before)))
    else:
        b0, b1 = base[0]["start"], base[-1]["end"]
        rate = sum(1 for p in base if p["kind"] == kinds.RUNNING) / max((b1 - b0).total_seconds(), 1)
        usual = round(rate * span)
        said = f"about {usual} in as long before"
    line = f"  started {n} times in {lasting(span)} ({said})"
    if n >= th("starts_min") and n >= th("starts_ratio") * max(usual, 1):
        line += f"  ⟵ about {n / max(usual, 1):.0f}× more often than usual"
    return {"starts": n, "usual": usual, "line": line}


def days_line(client, eid: str, start: datetime, end: datetime, baseline_days: float, zone: ZoneInfo) -> str | None:
    """Its daily average over the `days_context` days to `end`, from the villa's long-term figures; flagged ⟵ when the
    days from its days before on are far from the days before them (settings `days_change_ratio`).

    ⚠️ THE DAYS BEFORE CAN ALREADY BE THE TROUBLE (villa, 2026-10-21 00:13): the House Pump changed on 16 October
    (2-28 W a day on average, then 70-125 W); asked about the 20th, its three days before were already like it and 101
    starts read "close to its normal pattern"."""
    try:
        rows = (client.statistics([eid], (end - timedelta(days=th("days_context"))).astimezone(zone)
                                  .replace(hour=0, minute=0, second=0, microsecond=0), end, "day", ("mean",))
                or {}).get(eid) or []
    except Exception:  # noqa: BLE001 — a device the villa keeps no figures of: no line, never a failure
        return None
    days = [(datetime.fromtimestamp(r["start"] / 1000, tz=zone), float(r["mean"])) for r in rows
            if isinstance(r.get("mean"), (int, float))]
    split = start - timedelta(days=baseline_days)
    earlier = [v for d, v in days if d + timedelta(days=1) <= split]
    recent = [(d, v) for d, v in days if d + timedelta(days=1) > split]
    if len(earlier) < th("days_context_min") or not recent:
        return None
    line = "  day by day, its average (long-term figures): " + " · ".join(f"{d:%d %b} {v:.3g}" for d, v in days)
    usual, ratio = statistics.median(earlier), th("days_change_ratio")
    now = statistics.median(v for _, v in recent)
    if usual > 0 and (now >= usual * ratio or now <= usual / ratio):
        far = (lambda v: v >= usual * ratio) if now >= usual * ratio else (lambda v: v <= usual / ratio)
        since = recent[-1][0]
        for d, v in reversed(days):
            if not far(v):
                break
            since = d
        line += (f"  ⟵ since {since:%d %b} about {now / usual:.2g}× its average of the days before ({usual:.3g}): "
                 f"the days before used as \"usual\" above were already like this")
    return line


# ⚠️ EVERY KIND OF DEVICE, AGAINST ITS OWN PAST (owner, 2026-10-20: "the skill shall universally handle all type of
# dataset returned by Home Assistant"). A device that RUNS (a pump, a heater) was the only kind compared with its days
# before; a LEVEL (a temperature), a STATE (a door) and a COUNTER (energy) got one line per reading — 70 to 106 lines,
# a room 6 °C warmer or a door opened 50 times said nowhere. Each kind now gets its few lines against the same hours of
# the days before, flagged ⟵ when far off; its moments are listed only when they add something.
def shape(rows: list[tuple[datetime, str]], on_above: float | None) -> str:
    """runs · counter (a total that only grows: energy) · level (a measure: temperature) · state (on/off, open, a mode)."""
    if on_above is not None:
        return "runs"
    vals = [number(s) for _, s in rows if s not in OFFLINE | NO_VALUE]
    if not vals or any(v is None for v in vals):
        return "state"
    steps = [b - a for a, b in zip(vals, vals[1:]) if b != a]
    return "counter" if len(steps) >= 3 and sum(1 for d in steps if d > 0) >= 0.9 * len(steps) and vals[-1] > vals[0] \
        else "level"


def _windows(start: datetime, end: datetime, baseline_days: float) -> list[tuple[datetime, datetime]]:
    """The same hours on each day before, newest first (a period of a day or less): [(start, end), …]."""
    if (end - start).total_seconds() > 86400:
        return []
    return [(start - timedelta(days=k), end - timedelta(days=k)) for k in range(1, int(baseline_days) + 1)]


def _in(rows, a, b):
    return [(t, number(s)) for t, s in rows if a <= t < b and number(s) is not None]


def level_line(rows, base_rows, start, end, baseline_days, zone, span_days) -> str:
    """Lowest, highest and average of the period; the same hours before: their lowest and highest; when it left them."""
    now = _in(rows, start, end) or _in(rows[:1], rows[0][0], end)
    if not now:
        return "  no reading in this period"
    vs = [v for _, v in now]
    line = f"  between {min(vs):.4g} and {max(vs):.4g} (average {sum(vs) / len(vs):.4g})"
    before = [b for a, z in _windows(start, end, baseline_days) if (b := [v for _, v in _in(base_rows, a, z)])]
    if not before:
        return line
    lo, hi = min(min(b) for b in before), max(max(b) for b in before)
    margin = max((hi - lo) * th("level_band_margin"), abs(hi) * 0.01)
    line += f"; the same hours of the {len(before)} days before: {lo:.4g} to {hi:.4g}"
    up = next((t for t, v in now if v > hi + margin), None)
    down = next((t for t, v in now if v < lo - margin), None)
    if up:
        line += f"  ⟵ above its usual highest from {at(up, zone, span_days)}, up to {max(vs):.4g}"
    if down:
        line += f"  ⟵ below its usual lowest from {at(down, zone, span_days)}, down to {min(vs):.4g}"
    return line


def counter_line(rows, base_rows, start, end, baseline_days) -> str:
    """How much the total rose in the period (a reset to 0 not counted as a fall), against the same hours before."""
    def rise(rs):
        vs = [v for _, v in rs]
        return sum(b - a for a, b in zip(vs, vs[1:]) if b > a)
    got = rise(_in(rows, start, end))
    line = f"  rose by {got:.4g} in {lasting((end - start).total_seconds())}"
    before = [rise(_in(base_rows, a, z)) for a, z in _windows(start, end, baseline_days)]
    if not before:
        return line
    usual = max(before)
    line += " (the same hours of the %d days before: %s)" % (len(before), ", ".join(f"{b:.4g}" for b in reversed(before)))
    if usual > 0 and got >= th("rise_ratio") * usual:
        line += f"  ⟵ about {got / usual:.0f}× faster than usual"
    elif usual > 0 and got * th("rise_ratio") <= min(before):
        line += "  ⟵ far slower than usual"
    return line


def state_lines(ps: list[dict], base: list[dict], start, end, baseline_days, zone) -> list[str]:
    """Per state: how many times it went to it and for how long in all, against the same hours before."""
    out = []
    names = [k for k in dict.fromkeys(p["kind"] for p in ps) if k not in (kinds.OFFLINE, kinds.NO_VALUE)]
    for k in names[:int(th("state_lane_max"))]:
        mine = [p for p in ps if p["kind"] == k and start <= p["start"] < end]
        line = f"  {k}: {len(mine)} times, {lasting(sum(p['seconds'] for p in ps if p['kind'] == k))} in all"
        before = [sum(1 for p in base if p["kind"] == k and a <= p["start"] < z)
                  for a, z in _windows(start, end, baseline_days)]
        if before:
            usual = max(before)
            line += " (the same hours of the %d days before: %s times)" % (len(before), ", ".join(map(str, reversed(before))))
            if len(mine) >= th("starts_min") and len(mine) >= th("starts_ratio") * max(usual, 1):
                line += f"  ⟵ about {len(mine) / max(usual, 1):.0f}× more often than usual"
        out.append(line)
        if "⟵" in line and (hours := by_hour([p["start"] for p in mine], [p["start"] for p in base if p["kind"] == k],
                                             start, end, baseline_days, zone)):
            out.append(f"    {k} in each hour (in brackets the most on one of the days before): {hours}")
    return out


def schedule_of(pack, eid: str) -> str | None:
    """The schedule of the asset `eid` belongs to, as the knowledge pack attached it (the nightly check's own link:
    one per asset, a villa's `vesta_asset_aliases` correcting the grouping) — None when it has none, or no pack."""
    row = pack.row(eid) if pack is not None else None
    asset = pack.asset(row["asset"]) if row and row.get("asset") else None
    return (asset or {}).get("schedule")


def schedule_line(ps: list[dict], base: list[dict], sched: list[tuple[datetime, str]], name: str, start: datetime,
                  end: datetime, baseline_days: float) -> str:
    """How many of its starts fell outside the hours its schedule expects it, against the same hours before — by the
    same rule as how often it started (`starts_ratio`, `starts_min`).

    ⚠️ ANY DEVICE THAT RUNS AND HAS A SCHEDULE (owner, 2026-10-20: "make sure everything you are doing is not hardcoded
    and specific to a device, device class or family"): the schedule is whatever the knowledge pack attached to the
    device's asset, and "unusual" is the device's own days before — no device, kind or number named here."""
    windows, opened = [], None
    for t, s in sched:
        if s == "on" and opened is None:
            opened = t
        elif s != "on" and opened is not None:
            windows.append((opened, t))
            opened = None
    if opened is not None:
        windows.append((opened, end))

    def outside(a, b):
        return sum(1 for p in (ps if a >= start else base) if p["kind"] == kinds.RUNNING and a <= p["start"] < b
                   and not any(x <= p["start"] < y for x, y in windows))
    n = outside(start, end)
    line = f"  outside the hours of its schedule ({name}): started {n} times"
    before = [outside(a, z) for a, z in _windows(start, end, baseline_days)]
    if before:
        usual = max(before)
        line += " (the same hours of the %d days before: %s)" % (len(before), ", ".join(map(str, reversed(before))))
        if n >= th("starts_min") and n >= th("starts_ratio") * max(usual, 1):
            line += f"  ⟵ about {n / max(usual, 1):.0f}× more often than usual"
    return line


def normal(rows: list[tuple[datetime, str]], end: datetime, on_above: float | None, zero_is_rest: bool = False) -> dict:
    """The entity's own normal over the baseline days: how often and how long it runs, at what level."""
    ps = periods(rows, end, on_above, zero_is_rest)
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


def threshold(rows: list[tuple[datetime, str]], params=None) -> float | None:
    """Above this a numeric entity counts as running: the villa's ONE rule (vesta_shared.daily.threshold_from_readings,
    the night check's, the energy figures' and the weekly page's) over its readings bucketed per hour. `params`: the
    villa's settings (script.Context.params; this skill's settings.yaml alone when not given). None for an entity that
    hardly moves (a temperature): read as levels, not runs (flat_spread).

    ⚠️ ONE "RUNNING" (owner, 2026-10-19): it was a share (running_fraction 0.10) of the top 0.1 % of the readings, at
    least running_min 2 W: a second rule beside the villa's. An hour's MAXIMUM keeps a device that runs a few seconds an
    hour (a meter reporting its idle every few seconds, 2026-10-11: its 95th percentile was its rest, its runs were
    never counted) seen running, as its top readings did."""
    vals = sorted(v for _, s in rows if (v := number(s)) is not None)
    if len(vals) < 5:
        return None
    hi, lo = vals[-1], vals[int(len(vals) * 0.05)]
    if hi <= 0 or (hi - lo) < hi * th("flat_spread"):
        return None
    return daily.threshold_from_readings([(t, number(s)) for t, s in rows], params or VillaParams(defaults=BEHAVIOUR))


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
             series: bool = False, now: datetime | None = None, params=None, pack=None) -> dict:
    """`series`: each numeric device's readings for a chart too (--out: the investigation page, page.py). `now`: the
    time it is (the clock when not given) — no reading goes past it. `params`: the villa's settings (the one
    "running": threshold)."""
    span_days = (end - start).total_seconds() > 86400
    parts = []
    names = client.states(ids)
    # ⚠️ OLDER THAN THE DETAIL KEPT IS NOT "NOTHING RECORDED" (owner, 2026-10-20): before kept_from the villa's system
    # holds no change any more, only its long-term figures of measured values — read for that part, and said
    kept = client.kept_from(now)
    older = None
    if kept is not None and start < kept:
        try:
            older = retention.older_figures(client, ids, start, min(end, kept))
        except Exception:  # noqa: BLE001 — said below as "no figures", never left out
            older = (retention.figure_period(start, min(end, kept)), {})
    for eid in ids:
        # where the history could not be read further (vesta_shared.ha_client: its cap) — never stretched past it
        rows, reach, cut = read(client, eid, start, end, now)
        asleep = pack is not None and pack.is_asleep(eid)
        if asleep:
            # unavailable by design (vesta_shared.asleep): its "unavailable" between reports is sleep, never a period
            rows = without_sleep(rows)
        before = _older_lines(eid, older, kept, start, zone, span_days, client.detailed_days) if older else []
        # the older part drawn from the figures too (each one's highest, as the readings' slices are): the page's chart
        # covers the whole period, that part marked as figures (page.py)
        figs = [(datetime.fromtimestamp(r["start"] / 1000, tz=timezone.utc), str(r.get("max", r.get("mean"))))
                for r in (older[1].get(eid) or [])] if older else []
        attrs0 = (names.get(eid) or {}).get("attributes") or {}
        if not rows and eid not in names and not figs:
            # ⚠️ AN ID NO DEVICE HAS IS NOT A QUIET DEVICE (villa, 2026-10-20 21:57): the AI asked for an id it made up and
            # read "nothing recorded" as the pump doing nothing
            parts.append({"entity_id": eid, "lines": [f"{eid}: no device of the villa's system has this id: nothing can "
                                                      "be said about it. Find the device's ids first (search)."],
                          "nothing": True, "label": spoken(eid)})
            continue
        if not rows:
            part = {"entity_id": eid, "lines": [f"{eid}: nothing recorded in this period." if not older
                                                else f"{eid}: no change of it is kept for this period."] + before,
                    "nothing": not figs, "label": attrs0.get("friendly_name") or spoken(eid)}
            if series and figs:
                part.update(name=attrs0.get("friendly_name") or eid, unit=attrs0.get("unit_of_measurement") or "",
                            series=chart_series(figs, start, end, min(end, kept)), figures_until=kept.isoformat())
            parts.append(part)
            continue
        base_rows, base_reach, _ = read(client, eid, start - timedelta(days=baseline_days), start, now) \
            if baseline_days > 0 else ([], start, None)
        if asleep:
            base_rows = without_sleep(base_rows)
            before = before + ["  unavailable by design (it sleeps between its reports): its \"unavailable\" moments are "
                               "left out, each state holds until its next report"]
        on = threshold(base_rows + rows, params)
        zero_rest = rests_at_zero(base_rows or rows, on)
        ps = periods(rows, reach, on, zero_rest)
        base_ps = periods(base_rows, base_reach, on, zero_rest) if base_rows else []
        ref = normal(base_rows, base_reach, on, zero_rest) if base_rows else {}
        lines = [f"{eid}: {len(rows)} readings" + (f"; counted as running above {on:g}" if on else "")] + before
        if cut:
            lines.append(f"  ⚠️ {past.unread('its history', at(cut, zone, span_days))} "
                         "(too many readings) — say so, and narrow the period to read the rest")
        kind_of = shape(rows, on)
        if ref and kind_of == "runs":
            r = ref
            lines.append("  normal (the %g days before): %s runs a day%s%s%s" % (
                r["days"], r["runs_per_day"],
                f", usually {lasting(r['run_median_s'])}" if "run_median_s" in r else "",
                f", longest {lasting(r['run_longest_s'])}" if "run_longest_s" in r else "",
                f", at about {r['level_median']:g}" if "level_median" in r else "")
                + (f"; at rest {r['rest_median']:g}" if "rest_median" in r else ""))
        starts = starts_line(ps, base_ps, start, reach, baseline_days) if on else None
        if starts:
            lines.append(starts["line"])
            hours = by_hour([p["start"] for p in ps if p["kind"] == kinds.RUNNING],
                            [p["start"] for p in base_ps if p["kind"] == kinds.RUNNING], start, reach, baseline_days, zone)
            if hours:
                lines.append(f"  starts in each hour (in brackets the most on one of the days before): {hours}")
        sched = schedule_of(pack, eid) if on else None
        if sched:
            srows, _, _ = read(client, sched, start - timedelta(days=baseline_days), end, now)
            sname = ((client.states([sched]).get(sched) or {}).get("attributes") or {}).get("friendly_name") or sched
            lines.append(schedule_line(ps, base_ps, srows, sname, start, reach, baseline_days))
        if kind_of in ("runs", "level") and (dl := days_line(client, eid, start, end, baseline_days, zone)):
            lines.append(dl)
        if kind_of == "level":
            lines.append(level_line(rows, base_rows, start, reach, baseline_days, zone, span_days))
        elif kind_of == "counter":
            lines.append(counter_line(rows, base_rows, start, reach, baseline_days))
        elif kind_of == "state":
            lines += state_lines(ps, base_ps, start, reach, baseline_days, zone)
        shown, hidden = worth_a_line(ps, ref, on)
        if kind_of in ("level", "counter") or (kind_of == "state" and len(ps) > th("ordinary_hide_over")):
            # its summary above says it; the moments it stopped reporting stay listed
            hidden += sum(1 for p in shown if p["kind"] not in (kinds.OFFLINE, kinds.NO_VALUE))
            shown = [p for p in shown if p["kind"] in (kinds.OFFLINE, kinds.NO_VALUE)]
        for p in shown[:MAX_LINES]:
            lvl = f" at {p['mean']:.4g} (from {p['min']:.4g} to {p['max']:.4g})" if "mean" in p and on else \
                (f" reading {p['mean']:.4g}" if "mean" in p else "")
            flag = f"  ⟵ {p['why']}" if p.get("why") else ""
            lines.append(f"  {at(p['start'], zone, span_days)} → {at(p['end'], zone, span_days)}  {p['kind']} "
                         f"for {lasting(p['seconds'])}{lvl}{flag}")
        if len(shown) > MAX_LINES:
            lines.append(f"  … {len(shown) - MAX_LINES} more periods (narrow the period to see them)")
        if hidden > 0:
            lines.append((f"  ({hidden} periods not listed one by one: the counts above include them)"
                          if starts and "⟵" in starts["line"] else
                          f"  ({hidden} short ordinary periods not listed: like its normal)") if kind_of == "runs" else
                         f"  ({hidden} changes not listed: the lines above sum them up)")
        if on:
            for j in level_jumps(rows, start, end, on)[:LEVEL_CHANGES_SHOWN]:
                lines.append(f"  {at(j['at'], zone, span_days)} level changes from about {j['from']:.0f} to {j['to']:.0f}")
        totals: dict[str, float] = {}
        for p in ps:
            totals[p["kind"]] = totals.get(p["kind"], 0) + p["seconds"]
        if kind_of == "runs":                         # a state's lines above already say its time in each
            lines.append("  in total: " + ", ".join(f"{k} {lasting(v)}" for k, v in sorted(totals.items(), key=lambda x: -x[1])))
        attrs = (names.get(eid) or {}).get("attributes") or {}
        part = {"entity_id": eid, "running_above": on, "normal": ref, "lines": lines,
                "periods": [_saved(p) for p in shown[:MAX_LINES]], **({"cut": cut.isoformat()} if cut else {}),
                "label": attrs.get("friendly_name") or eid, "runs": sum(1 for p in ps if p["kind"] == kinds.RUNNING),
                **({"starts": starts} if starts else {})}
        if eid.split(".")[0] in CONTROL_DOMAINS:
            seen = {str(v) for _, v in base_rows + rows if str(v) not in OFFLINE | NO_VALUE}
            part["control"] = "off" if seen and seen <= OFF_STATES else "on" if seen and seen <= ON_STATES else None
        if series and any(number(v) is not None for _, v in rows):
            part.update(name=attrs.get("friendly_name") or eid, unit=attrs.get("unit_of_measurement") or "",
                        series=chart_series(figs + rows, start, end, reach),
                        **({"figures_until": kept.isoformat()} if figs else {}),
                        # ⚠️ THE CHART THAT FITS THE DEVICE (owner, 2026-10-12: "would you use other metric?"): a device
                        # that RUNS gets its minutes running per hour against its usual — its days before drawn as
                        # lines were spikes nobody could read; one read as LEVELS (a temperature) keeps them, dashed
                        **({"per_hour": running_per_hour(ps, start, end, base_ps, baseline_days)}
                           if on else {"normal_series": same_hours_before(base_rows, start, end, baseline_days)}))
        elif series:
            part["states"] = state_series(rows, start, end)        # a lane under the charts (page.py)
        parts.append(part)
    _controls(parts, baseline_days)
    return {"lines": [l for p in parts for l in p["lines"]], "entities": parts, "baseline_days": baseline_days,
            # what the page needs of this skill's settings to join the readings (page.py)
            "settings": {"coincide_s": th("coincide_s")}}


def _older_lines(eid: str, older, kept: datetime, start: datetime, zone: ZoneInfo, span_days: bool,
                 days: float) -> list[str]:
    """The part of the period before the villa's detail: said, and its long-term figures when the villa keeps some."""
    period, figures = older
    lines = [f"  ⚠️ {retention.not_kept('Its history', at(kept, zone, True), days)}."]
    rows = figures.get(eid) or []
    if not rows:
        return lines + ["    No long-term figures are kept of this device: that part cannot be known — say so."]
    lines.append(f"    Its long-term figures from {at(start, zone, True)} (one a {period}; from figures, not from each "
                 "change — say so):")
    for r in rows[:MAX_LINES]:
        t = datetime.fromtimestamp(r["start"] / 1000, tz=timezone.utc)
        vals = ", ".join(f"{k} {r[k]:.4g}" for k in ("mean", "min", "max", "change") if isinstance(r.get(k), (int, float)))
        lines.append(f"    {at(t, zone, True)}  {vals}")
    if len(rows) > MAX_LINES:
        lines.append(f"    … {len(rows) - MAX_LINES} more figures (narrow the period to see them)")
    return lines


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
                        "why": "runs of about " + lasting(statistics.median(p["seconds"] for p in runs)) + " each",
                        "run_s": statistics.median(p["seconds"] for p in runs)})
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
        elif p["kind"] == kinds.IDLE and rest is not None and level and "mean" in p \
                and p["seconds"] >= th("level_change_gap_s") and p["mean"] - rest >= (level - rest) * th("rest_high_share"):
            # ⚠️ A REST THAT DRAWS IS NEWS (villa, 2026-10-21): a pump resting at 37 instead of 0.87 from 19:00 on, its
            # circuit live between runs, went unsaid: only a rest at 0 was judged. Measured against the gap between its
            # rest and its run, so a rest wandering between 0 and 2 is never one
            why.append(f"it read about {p['mean']:.3g} at rest instead of its usual {rest:g}")
            alerts.append((th("level_change_gap_s"), f"it reads more than {rest + (level - rest) * th('rest_high_share'):.3g} "
                                                     f"at rest for {lasting(th('level_change_gap_s'))}"))
        elif p["kind"] == kinds.OFFLINE and p["seconds"] >= th("offline_min_s"):
            # ⚠️ NO VALUE IS NOT SILENCE (architecture review, 2026-10-21): a wind chill on a still afternoon, a sensor
            # that answers with nothing to give, was "it stops reporting" here while every other check knew better
            # (vesta_shared.device_state: "unknown" is not offline). Its band still shows it; it is no unusual moment.
            why.append("it " + kinds.did(p["kind"]))
            alerts.append((th("offline_min_s"), f"it stops reporting for {lasting(th('offline_min_s'))}"))
        # ⚠️ A BURST SAYS ITS RUNS AGAINST THE USUAL RUN (villa, 2026-10-21 00:13): "⟵ runs of about 25 s each" alone
        # was read as "runs shorter than normal" for a pump whose usual run is 33 s
        if "run_s" in p and ref.get("run_median_s"):
            usual = ref["run_median_s"]
            how = ("shorter than" if p["run_s"] < usual * th("burst_run_short_ratio") else
                   "longer than" if p["run_s"] > usual / th("burst_run_short_ratio") else "as long as")
            p["why"] += (f" ({how} its usual run of {lasting(usual)}: it is the stopping and restarting in a row that "
                         "is marked)" if how == "as long as" else f" ({how} its usual run of {lasting(usual)})")
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
           now: datetime | None = None, pack=None) -> dict:
    span_days = (end - start).total_seconds() > 86400
    hours = max((end - start).total_seconds() / 3600, 1)
    book = client.logbook_read(start, end, now=now)
    # a device unavailable by design (vesta_shared.asleep): its "unavailable" rows are sleep, not a device that went
    rows = [r for r in book.rows
            if not (pack is not None and pack.standing(r.get("entity_id"), r.get("state")) == ASLEEP_NOW)]
    gone = book.older_than_kept
    count: dict[str, int] = {}
    for r in rows:
        count[r.get("entity_id") or ""] = count.get(r.get("entity_id") or "", 0) + 1
    autos, offline, back, sent, events, system = {}, [], [], [], [], {}
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
            # ⚠️ A RUN, NOT A ROW (architecture review round 2, 2026-10-19): "turned on/off" rows were runs, and a reload
            # of the rules at 16:59 made 23 "Automation “X” ran … check whether it did" lines. One reading of "a rule
            # ran" (vesta_shared.past.automation_run); a run the villa's system started itself is said once, below
            run = past.automation_run(r)
            if run is None:
                continue
            if run.is_system:
                system.setdefault(past.system_run(run.started_by), []).append(t)
                continue
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
                  for t, n, e in _first_per(offline)[:AROUND_LISTED]]
    if back:
        lines.append("…and answered again:")
        lines += [f"  {at(t, zone, span_days)}  {n} ({e})" for t, n, e in _first_per(back)[:AROUND_LISTED]]
    reran = []
    for kind, ts in system.items():
        # one line for all the rules a reload or a start re-ran, its words the skill's (settings.yaml words); the
        # moments to the minute (every rule fires within the same seconds)
        minutes = sorted({t.replace(second=0, microsecond=0) for t in ts})
        said = WORDS.get(SYSTEM_WORDS[kind]) or f"(investigate's settings.yaml has no words.{SYSTEM_WORDS[kind]})"
        lines.append(f"{said} ({', '.join(at(t, zone, span_days)[:-3] for t in minutes)}; {len(ts)} rule run(s))")
        reran.append({"kind": kind, "at": min(ts).isoformat(), "times": [t.isoformat() for t in minutes],
                      "runs": len(ts), "text": said})
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
        lines += [f"  {at(t, zone, span_days)}  {n}" for t, n in sent[:AROUND_LISTED]]
    if events:
        lines.append("Other changes (doors, locks, switches, people, focus devices):")
        lines += [f"  {at(t, zone, span_days)}  {n}: {s}" for t, n, s, _ in events[:MAX_LINES]]
        if len(events) > MAX_LINES:
            lines.append(f"  … {len(events) - MAX_LINES} more")
    lines += _vesta(store, start, end, zone, span_days)
    if gone is not None:
        lines.append(f"⚠️ {retention.not_kept('The logbook', at(gone, zone, True), client.detailed_days)} — what "
                     "happened earlier cannot be listed: say so, never \"nothing happened\".")
    if not lines:
        lines.append("Nothing else was recorded in this period.")
    # where the logbook could not be read further (vesta_shared.past) — never taken for "nothing else"
    if not book.whole:
        lines.append(f"⚠️ {past.unread('the logbook', at(book.reach, zone, span_days))} "
                     "(too many entries) — say so, and narrow the period to read the rest")
    noisy = sorted(((n, e) for e, n in count.items() if n / hours > th("noise_per_hour") and e not in focus), reverse=True)[:NOISY_NAMED]
    if noisy:
        lines.append("Left out as background (change constantly): " + ", ".join(e for _, e in noisy))
    # the same, as data — the investigation page builds its facts from it (page.py --around)
    data = {"offline": [{"at": t.isoformat(), "name": n, "id": e} for t, n, e in _first_per(offline)[:AROUND_LISTED]],
            "back": [{"at": t.isoformat(), "name": n, "id": e} for t, n, e in _first_per(back)[:AROUND_LISTED]],
            "automations": ran, "system_runs": reran,
            "notifications": [{"at": t.isoformat(), "name": n} for t, n in sent[:AROUND_LISTED]],
            "settings": {"coincide_s": th("coincide_s")}}
    return {"lines": lines, "data": data}


# What an action does, by its kind (`domain.service`, or the kind of step): only these change nothing on the villa.
#: ⚠️ WHAT AN AUTOMATION CAN DO, READ — NEVER INFERRED FROM ITS RUNNING THEN (review 32 follow-up): an account named a
#: watchdog that "ran during the event" as a possible cause; all it could do was notify and record a date.
HARMLESS = {"notify": "notifies", "persistent_notification": "notifies", "telegram_bot": "sends a message", "tts": "speaks a message",
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
    scope = _scope(cfg if isinstance(cfg, dict) else {})
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
                               "; its runs of this period are no longer kept") + scope,
                    "can": "unproven", "changes": []}
    calls, targets = set(), set()
    _actions((cfg or {}).get("actions") or (cfg or {}).get("action") or [], calls, targets)
    changes = _changes(calls)
    out = {"text": _say_actions(calls) + scope, "can": "changes" if changes else "nothing", "changes": changes,
           "does": _harmless(calls)}
    if changes:
        # what it can act ON, by name: "it can switch the jacuzzi's relay" says at once whether it could touch the device
        out["targets"] = [{"id": e, "name": _name(client, e)} for e in sorted(targets)]
        if targets:
            out["text"] += "; on: " + ", ".join(f"{t['name']} ({t['id']})" for t in out["targets"])
    return out



def _scope(cfg: dict) -> str:
    """"; it alerts only while the villa is empty" — a rule's "When this rule runs" choice (vesta_shared.critical.run_when),
    in this skill's words; "" for a rule that always runs."""
    when = run_when(cfg)
    if when == "always":
        return ""
    said = WORDS.get(f"runs_when_{when}") or f"(investigate's settings.yaml has no words.runs_when_{when})"
    return f"; {said}"

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
        listed = client.tool("ha_get_automation_traces", {"automation_id": eid, "limit": TRACES_READ}) or {}
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
                msg = notes_of(i).get(Notes.MESSAGE) or i["rule_id"]
                closed = f", closed {at(datetime.fromisoformat(i['closed_at']), zone, True)}" if i.get("closed_at") else ", still open"
                out.append(f"  {at(t, zone, span_days)}  alert #{i['id']} {i['severity']}: {msg.splitlines()[0][:RECORD_LINE_CHARS]}{closed}")
        for f in store.findings(None):
            d = f.get("reopened_day") or f.get("opened_day") or ""
            if start.astimezone(zone).date().isoformat() <= d <= end.astimezone(zone).date().isoformat():
                out.append(f"  {d}  night check {f['severity']}: {str(f['summary'])[:RECORD_LINE_CHARS]} ({f['status']})")
    except Exception:  # noqa: BLE001 — the agent's records are a help, never a reason to fail
        return []
    return (["VESTA Agent alerts and findings:"] + out) if out else []


# ------------------------------------------------------------------ main
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["find", "timeline", "around"])
    script.arguments(ap, pack=True)                         # --pack --store --zone (the agent adds them)
    ap.add_argument("--what"); ap.add_argument("--where")
    ap.add_argument("--entities", action="append")       # may be given several times: each one is a short text
    ap.add_argument("--start"); ap.add_argument("--end")
    ap.add_argument("--baseline-days", default=str(BASELINE_DAYS))
    ap.add_argument("--out", help="timeline / around: also save the reading as data (charts, events), for the investigation page")
    a = ap.parse_args(argv)
    ctx = script.Context(a, skill=SKILL)                    # its settings.yaml: the one "running"'s share among them
    zone = ctx.Z                                           # the villa's time zone
    try:
        if a.cmd == "find":
            if not a.what:
                raise SystemExit("find needs --what: a device, a word or a room.")
            res = find(ctx.client, a.what, a.where, ctx.pack)
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
                                 f"commas: {', '.join(repr(x) for x in wrong[:WRONG_IDS_NAMED])} is not one. Run find first.")
            if a.cmd == "timeline":
                if not ids:
                    raise SystemExit("timeline needs --entities: ids from find, separated by commas.")
                res = timeline(ctx.client, ids[:TIMELINE_DEVICES], start, end, float(a.baseline_days), zone, series=bool(a.out),
                               now=ctx.now, params=ctx.params, pack=ctx.pack)
                if a.out:
                    # the whole reading, charts included, for the investigation page; the AI gets the lines only
                    with open(a.out, "w", encoding="utf-8") as f:
                        json.dump({"start": start.isoformat(), "end": end.isoformat(), "zone": str(zone), **res}, f,
                                  ensure_ascii=False, default=str)
                    res = {"lines": res["lines"], "saved": a.out}
            else:
                res = around(ctx.client, ctx.store, start, end, ids, zone, now=ctx.now, pack=ctx.pack)
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
        print(json.dumps({"error": f"{type(e).__name__}: {str(e)[:ERROR_CHARS]}"}))
        return 1
    # a setting the villa's own file still sets although this skill retired it: said, never silently ignored
    told = skill_settings.retired(SKILL, "settings.yaml")
    if told:
        res["settings_not_used"] = told
        print("\n".join(told), file=sys.stderr)
    print(json.dumps(res, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
