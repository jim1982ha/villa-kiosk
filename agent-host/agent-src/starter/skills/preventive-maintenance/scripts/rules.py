"""Rules per family of measurement.

Each rule returns Finding objects or nothing. A Finding has a rule id, an
entity, a severity (P2 task now, P3 task in the digest, INFO report only), a
one-line summary written for the facility manager, and the numbers behind it.

Rule ids are stable: they end up in the store as [PM-xxx] and in the
monthly report. Never rename one without a migration note.

Thresholds come from VillaParams (helpers), with behavioural defaults only.
Physical parameters (a pump's rated power, a tank's volume) are read from
<asset>_<parameter> helpers and a missing one turns the rule off for that
asset with an explicit "cannot compute" line, never a guess.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import date, timedelta
import re
from typing import Any

from vesta_shared.params import VillaParams
from vesta_shared.result import COUNTER_RESET, PARAM_MISSING  # the ids other skills read: written once
from vesta_shared.stats import med, pct_change, step_index
from vesta_shared import occupancy  # like with like: a day's use against days in the same state
from vesta_shared import battery  # a battery's charge, its projection and its rule ids: one owner
from vesta_shared.device_state import is_offline
from vesta_shared.timeutil import day_label, lasting, weekday_name
from vesta_shared.limits import limit  # every limit, set on the Limits tab

# thresholds written in code until now, set on the Limits tab (vesta_shared.limits)
CONTINUOUS_FULL_HOURS = limit("night.continuous_full_hours", 1, unit="hours", group="detect", lo=0, hi=24,
                              says="A pump whose usual run lasts at least this many full hours is read as running continuously.",
                              reached="Below it, the pump is read as cycling on and off.", told="")
DRIFT_MIN_DAYS = limit("night.drift_min_days", 3, unit="days", group="detect", lo=1, hi=30,
                       says="Days of changed running power needed to call it a gradual drift rather than a new level.",
                       reached="With fewer days, the change is called new, starting on its first day.", told="person")
SCHEDULE_MIN_HOURS = limit("night.schedule_min_hours", 1, unit="hours", group="detect", lo=0, hi=24,
                           says="Shortest planned running time a day must have for the night check to compare it with what ran.",
                           reached="Days planned for less are not checked against their schedule.", told="")
EXPECTED_RAN_HOURS = limit("night.expected_ran_hours", 0.1, unit="hours", group="detect", lo=0, hi=24,
                           says="A pump that was planned to run but ran less than this is reported as not having run.",
                           reached="Below it: 'scheduled but did not run'.", told="person")

P2, P3, INFO = "P2", "P3", "INFO"

# the skill's own thresholds (settings.yaml `behaviour:`, a villa's villa.settings.yaml on top) — the defaults the
# night check's parameters fall back to, here for a caller holding no Context (the tests)
from vesta_shared.skill_settings import behaviour as _behaviour, load as _load_settings  # noqa: E402
import os as _os  # noqa: E402
DEFAULTS = _behaviour(_load_settings(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "settings.yaml"))


@dataclass
class Finding:
    rule_id: str
    entity_id: str
    asset: str
    family: str
    severity: str
    summary: str
    detail: dict[str, Any] = field(default_factory=dict)
    check: str = ""      # what the FM should do
    day: str = ""

    def as_dict(self):
        return asdict(self)


def _held(changes: list[float | None], low_pct: float, high_pct: float) -> int:
    """-1 when EVERY recent day is at least `low_pct` below its normal, +1 when every one is at least `high_pct`
    above, else 0.

    ⚠️ EVERY DAY, NOT THEIR MIDDLE (2026-10-13): "over the last 2 days" was the median of two days — their average —
    so a house pump's one long run (0.68 kWh) and a day it barely ran (0.04) read "+117%, 0.36 kWh/day": the confirm
    days are there so one odd day is never a finding."""
    if not changes or any(c is None for c in changes):
        return 0
    if all(c <= -low_pct for c in changes):
        return -1
    if all(c >= high_pct for c in changes):
        return 1
    return 0


def _profile(series: list[dict], params: VillaParams) -> str:
    """Classify how an asset runs from its last 30 days of power features.
    continuous: runs in long steady blocks (pool filtration, circulation)
    cycling:    short bursts, never a full hour (pressure pump)
    intermittent: runs on fewer than half the days (jacuzzi, jets)"""
    days = [f for f in series if f.get("hours_with_data", 0) > 0]
    if not days:
        return "unknown"
    ran = [f for f in days if (f.get("run_hours") or 0) > params.behaviour("ran_min_hours")]
    if len(ran) < max(params.behaviour("intermittent_min_days"), len(days) * params.behaviour("intermittent_share")):
        return "intermittent"
    full = med([f.get("full_hours") or 0 for f in ran])
    if full is not None and full >= CONTINUOUS_FULL_HOURS:
        return "continuous"
    return "cycling"


# ---------------------------------------------------------------- power family
def power_rules(asset: dict, entity_id: str, series: dict[date, dict], today: date, params: VillaParams,
                expected_hours_by_weekday: dict | None, energy_series: dict[date, dict] | None,
                prior: dict[str, dict] | None = None, occupied: dict[date, str] | None = None) -> list[Finding]:
    """prior: {rule_id: detail} of findings still open for this asset. While a
    finding is open its baseline is frozen, so the anomaly cannot become the
    new normal and close itself after a few days."""
    prior = prior or {}
    out: list[Finding] = []
    baseline_days = int(params.behaviour("baseline_days"))
    confirm = int(params.behaviour("confirm_days"))
    drift_pct = params.asset_optional_number(asset["slug"], "drift_pct") or params.behaviour("drift_pct")
    min_days = int(params.behaviour("min_days_for_baseline"))
    days = sorted(d for d in series if today - timedelta(days=baseline_days) < d <= today)
    feats = [series[d] for d in days]
    profile = _profile(feats, params)
    recent_days = days[-confirm:] if len(days) >= confirm else []
    base_days = days[:-confirm] if len(days) > confirm else []
    slug = asset["slug"]

    # 1. running-power step or drift (continuous assets only)
    if profile == "continuous":
        base_vals = [series[d]["running_power"] for d in base_days if series[d].get("running_power")]
        rec_vals = [series[d]["running_power"] for d in recent_days if series[d].get("running_power")]
        if len(base_vals) >= min_days and len(rec_vals) == confirm:
            base = med(base_vals)
            # ⚠️ WHICH NORMAL IT IS COMPARED WITH, SAID AS IT IS (owner, 2026-10-17: never a fixed word for a setting):
            # "its 30-day normal" was written whatever baseline_days said, and also while an open finding compares
            # with the normal frozen when it opened
            normal = f"its {baseline_days}-day normal"
            if "PM-POWER-CHANGE" in prior and prior["PM-POWER-CHANGE"].get("baseline_w"):
                base = prior["PM-POWER-CHANGE"]["baseline_w"]
                normal = "its normal before this was found"
            rec = med(rec_vals)
            change = pct_change(rec, base)
            if change is not None and _held([pct_change(v, base) for v in rec_vals], drift_pct, drift_pct):
                all_vals = [series[d]["running_power"] for d in days if series[d].get("running_power")]
                idx, step_pct = step_index(all_vals)
                if idx is not None:
                    kind, when = "step", [d for d in days if series[d].get("running_power")][idx]
                    how = "sudden change on " + day_label(when)
                else:
                    kind, when = ("drift", recent_days[0]) if len(rec_vals) >= DRIFT_MIN_DAYS else ("new", recent_days[0])
                    how = "gradual drift" if kind == "drift" else "started on " + day_label(when)
                direction = "lower" if change < 0 else "higher"
                summary = (f"{asset['name']} draws {abs(change):.0f}% {direction} than {normal} "
                           f"({rec:.0f} W vs {base:.0f} W) at the same running hours, {how}.")
                check = ("Lower draw at equal hours means less water moved: check water level and air in the pump, "
                         "empty the basket, check the valves, photograph the filter gauge before any backwash."
                         if change < 0 else
                         "Higher draw means the pump works harder: check for a blocked outlet, a bearing noise, or a voltage change.")
                out.append(Finding("PM-POWER-CHANGE", entity_id, slug, "power", P3, summary,
                                   {"kind": kind, "baseline_w": round(base, 1), "recent_w": round(rec, 1), "change_pct": round(change, 1),
                                    "since": when.isoformat(), "profile": profile, "drift_threshold_pct": drift_pct}, check))

    # 2. run hours versus the expected schedule (continuous and cycling assets)
    if expected_hours_by_weekday and profile in ("continuous",):
        dev_pct = params.behaviour("schedule_dev_pct")
        for d in days[-1:]:  # the day being closed tonight
            exp = expected_hours_by_weekday.get(weekday_name(d), 0)
            f = series[d]
            if exp and exp >= SCHEDULE_MIN_HOURS and f.get("hours_with_data", 0) >= params.behaviour("full_day_hours"):
                change = pct_change(f["run_hours"], exp)
                if change is not None and abs(change) >= dev_pct:
                    what = "ran shorter" if change < 0 else "ran longer"
                    summary = (f"{asset['name']} {what} than expected on {day_label(d, weekday=True)}: "
                               f"{f['run_hours']:.1f}h against {exp:.1f}h scheduled"
                               + (f", and {f['gap_hours']}h without any data" if f.get("gap_hours") else "") + ".")
                    check = ("Check the timer or switch, the power supply of the pump, and whether someone stopped it by hand."
                             if change < 0 else "Check the timer: it may have lost its programme and be running continuously.")
                    out.append(Finding("PM-RUNHOURS", entity_id, slug, "power", P3, summary,
                                       {"day": d.isoformat(), "run_hours": f["run_hours"], "expected_hours": exp,
                                        "change_pct": round(change, 1), "gap_hours": f.get("gap_hours", 0)}, check))

    # 3. energy collapse or jump, for scheduled assets and motors (cycling pumps live here) — what the asset IS, never
    # whether the villa lists it critical (that list says who hears it offline, owner 2026-10-18)
    if energy_series and (expected_hours_by_weekday or asset.get("kind") == "motor" or asset.get("critical")):
        e_days = sorted(d for d in energy_series if today - timedelta(days=baseline_days) < d <= today and energy_series[d].get("kwh") is not None)
        if len(e_days) > confirm + min_days:
            rec_days, base_days = e_days[-confirm:], e_days[:-confirm]
            rec = [energy_series[d]["kwh"] for d in rec_days]
            base = [energy_series[d]["kwh"] for d in base_days]
            # like with like (vesta_shared.occupancy): each recent day against earlier days in its own state, occupied
            # or empty; without the villa's state, every earlier day, as before
            n = occupancy.normal({d: energy_series[d]["kwh"] for d in e_days}, rec_days, base_days, occupied, min_days)
            base_med, normal_of = n.value, n.of
            # a fault's normal is kept while it is open (the problem never becomes its own normal) — the normal of the
            # same state only: guests arriving or leaving give it a new one
            kept = prior.get("PM-ENERGY-CHANGE") or {}
            if kept.get("baseline_kwh") and kept.get("occupancy") == n.state:
                base_med = kept["baseline_kwh"]
                normal_of = {d: base_med for d in rec_days}
            if len(base) >= min_days and base_med and base_med > params.behaviour("energy_baseline_min_kwh"):
                change = pct_change(med(rec), base_med)
                drop = params.behaviour("energy_drop_pct") if n.drop else float("inf")
                rise = params.behaviour("energy_rise_pct") if n.rise else float("inf")
                if change is not None and _held([pct_change(energy_series[d]["kwh"], normal_of[d]) for d in rec_days],
                                                drop, rise):
                    kind = "COLLAPSE" if change < 0 else "JUMP"
                    summary = (f"{asset['name']} used {med(rec):.2f} kWh/day over the last {confirm} days against a normal "
                               f"{base_med:.2f} kWh/day{f' when the villa is {n.state}' if n.state else ''} "
                               f"({change:+.0f}%).")
                    check = ("A pressure pump that stops drawing power either has no demand (villa empty, tank full) or has lost its supply. "
                             "Confirm which: open a tap and listen for the pump." if change < 0 else
                             "A pump that suddenly uses much more may be cycling on a leak or a stuck float. Check for running water and the tank level.")
                    out.append(Finding("PM-ENERGY-CHANGE", asset["entities"].get("energy", entity_id), slug, "energy", P3, summary,
                                       {"kind": kind, "recent_kwh": round(med(rec), 3), "baseline_kwh": round(base_med, 3), "change_pct": round(change, 1),
                                        "profile": profile, "occupancy": n.state}, check))
            resets = [d for d in e_days[-confirm:] if energy_series[d].get("counter_reset")]
            if resets:
                out.append(Finding(COUNTER_RESET, asset["entities"].get("energy", entity_id), slug, "energy", INFO,
                                   f"{asset['name']} energy counter went backwards on {', '.join(day_label(d) for d in resets)}: "
                                   "the meter restarted, the day's kWh is unreliable.", {"days": [d.isoformat() for d in resets]},
                                   "Nothing to do on site; noted for the reports."))

    # 4. within-run sag (from raw history, attached by the caller as series[today]['runs'])
    runs = series.get(today, {}).get("runs") or []
    sag_pct = params.behaviour("sag_pct")
    sagging = [r for r in runs if r.get("sag_pct") is not None and r["sag_pct"] >= sag_pct]
    if profile == "continuous" and sagging:
        r = sagging[0]
        out.append(Finding("PM-RUN-SAG", entity_id, slug, "power", INFO,
                           f"{asset['name']} lost {r['sag_pct']:.0f}% of its draw during one run today "
                           f"({r['first_quarter_w']:.0f} W to {r['last_quarter_w']:.0f} W over {r['minutes']}min): a sign of air or a filling basket.",
                           {"run": r}, "Watch the next days; if it repeats, check the water level and the skimmer basket."))

    # 5. expected today but silent (intermittent assets, report only)
    if expected_hours_by_weekday and profile == "intermittent":
        d = days[-1] if days else today
        exp = expected_hours_by_weekday.get(weekday_name(d), 0)
        if exp and series.get(d, {}).get("run_hours", 0) < EXPECTED_RAN_HOURS:
            out.append(Finding("PM-EXPECTED-SILENT", entity_id, slug, "power", INFO,
                               f"{asset['name']} was scheduled {exp:.1f}h on {day_label(d, weekday=True)} and did not run.",
                               {"day": d.isoformat(), "expected_hours": exp}, "Report only: usage driven assets are not chased."))
    return out


# -------------------------------------------------------------- battery family
def battery_rules(asset: dict, entity_id: str, unit: str | None, level: float | None, series: list[tuple[str, float]],
                  params: VillaParams, today: date, held: frozenset[str] = frozenset()) -> list[Finding]:
    """`held`: the battery rules already open for this entity — one stays found up to its level plus
    `battery_clear_margin_points`, so a battery hovering on its line is one fault, not one a reading (owner, 2026-10-20)."""
    out: list[Finding] = []
    slug = asset["slug"]
    margin = params.behaviour("battery_clear_margin_points")
    warn, crit = params.behaviour("battery_warn_pct"), params.behaviour("battery_crit_pct")
    low_at = margin if battery.LOW in held else 0                       # the margin of a fault already open
    crit_at, warn_at = crit + (margin if battery.CRIT in held else 0), warn + low_at
    # ⚠️ THE ONE JUDGE OF A BATTERY (owner, 2026-10-19): the weekly page shows these findings, it no longer judges
    if unit == "%" and level is not None:
        if level <= crit_at:
            out.append(Finding(battery.CRIT, entity_id, slug, "battery", P2 if asset.get("critical") else P3,
                               f"{asset['name']} battery at {level:.0f}%: replace now.", {"level": level}, "Replace the battery."))
        elif level <= warn_at:
            out.append(Finding(battery.LOW, entity_id, slug, "battery", P3,
                               f"{asset['name']} battery at {level:.0f}%: replace within the week.", {"level": level}, "Replace the battery."))
        # days to empty from the last days (settings.yaml battery_trend_*), to its crit level (vesta_shared.battery)
        pts = [(i, v) for i, (_, v) in enumerate(series[-int(params.behaviour("battery_trend_days")):])]
        if len(pts) >= params.behaviour("battery_trend_min_points"):
            p = battery.projection(pts, crit, level)
            if p is not None and p["per_day"] < -params.behaviour("battery_trend_drop_per_day"):
                slope, days_left = p["per_day"], p["days_left"]
                if days_left < params.behaviour("battery_trend_warn_days"):
                    out.append(Finding(battery.TREND, entity_id, slug, "battery", INFO,
                                       f"{asset['name']} battery is falling {abs(slope):.1f} points a day, about {days_left:.0f} days left.",
                                       {"slope_per_day": round(slope, 2), "days_left": round(days_left)}, "Plan the replacement."))
    elif unit == "V":
        nominal = params.asset_optional_number(slug, "battery_nominal_v")
        if nominal is None:
            out.append(Finding(PARAM_MISSING, entity_id, slug, "battery", INFO,
                               f"{asset['name']} reports a battery voltage ({level} V) but no nominal voltage is set: "
                               f"create input_number.{slug}_battery_nominal_v to get a percentage.", {"reading_v": level, "name": asset["name"]}, ""))
        elif level is not None and battery.charge(level, "V", nominal) < params.behaviour("battery_low_fraction_of_nominal") * 100 + low_at:
            out.append(Finding(battery.LOW, entity_id, slug, "battery", P3,
                               f"{asset['name']} battery at {level:.2f} V, below {params.behaviour('battery_low_fraction_of_nominal'):.0%} of its {nominal:.2f} V nominal.",
                               {"level_v": level, "nominal_v": nominal}, "Replace the battery."))
    return out


# --------------------------------------------------------- availability family
def availability_rules(asset: dict, entity_id: str, state: str | None, last_changed_hours: float | None,
                       params: VillaParams, entities: list[str] | None = None, now=None) -> list[Finding]:
    """`entities`: every device's entity the finding stands for (an integration down: one per device) — recheck.py
    closes it once they are all back. `now`: the night's moment — the finding keeps when the device went offline
    (since_of), so the Kiosk's card words the duration when it is shown."""
    out = []
    slug = asset["slug"]
    if is_offline(state) and last_changed_hours is not None:
        if last_changed_hours * 60 >= params.behaviour("unavailable_minutes"):
            sev = P2 if asset.get("critical") else P3
            out.append(Finding("PM-UNAVAILABLE", entity_id, slug, "availability", sev,
                               f"{asset['name']} has been offline for {lasting(last_changed_hours * 3600)}.",
                               {"hours": round(last_changed_hours, 1), "critical": asset.get("critical", False),
                                "entities": list(entities or [entity_id]), **since_of(last_changed_hours, now)},
                               "Check power and radio range; for a battery device, change the battery and press its reset."))
    return out


def silence_rules(asset: dict, entity_id: str, last_changed_hours: float | None, params: VillaParams,
                  now=None) -> list[Finding]:
    if last_changed_hours is not None and last_changed_hours >= params.behaviour("silence_hours"):
        return [Finding("PM-SILENT", entity_id, asset["slug"], "level", P3,
                        f"{asset['name']} has not reported for {lasting(last_changed_hours * 3600)} although it is online.",
                        {"hours": round(last_changed_hours, 1), **since_of(last_changed_hours, now)},
                        "Check the sensor: battery, range, or a frozen device.")]
    return []


def since_of(hours: float, now) -> dict:
    """When a duration in a finding's words counts from, and those words: {"since": ISO moment, "since_words": "1 d 9 h"}
    — the Kiosk's card words it again each time it is shown (architecture review, 2026-10-15: "offline for 129 h",
    written at 02:00, was a day old by evening). Empty without the night's moment."""
    if now is None:
        return {}
    return {"since": (now - timedelta(hours=hours)).isoformat(), "since_words": lasting(hours * 3600)}


# ---------------------------------------------------------------- level family
def level_rules(asset: dict, entity_id: str, device_class: str | None, series: dict[date, dict], today: date,
                params: VillaParams) -> list[Finding]:
    out = []
    slug = asset["slug"]
    f = series.get(today)
    if not f or f.get("max") is None:
        return out
    max_c = params.asset_optional_number(slug, "max_c") if device_class == "temperature" else None
    if max_c is not None and f["max"] > max_c:
        out.append(Finding("PM-LEVEL-HIGH", entity_id, slug, "level", P3,
                           f"{asset['name']} reached {f['max']:.1f} °C today, above the {max_c:.0f} °C limit.",
                           {"max": f["max"], "limit": max_c}, "Check ventilation and cooling."))
    max_pct = params.asset_optional_number(slug, "max_humidity_pct") if device_class == "humidity" else None
    if max_pct is not None and f["max"] > max_pct:
        out.append(Finding("PM-LEVEL-HIGH", entity_id, slug, "level", P3,
                           f"{asset['name']} humidity reached {f['max']:.0f}%, above the {max_pct:.0f}% limit.",
                           {"max": f["max"], "limit": max_pct}, "Check the extractor fan and any water ingress."))
    return out


# ------------------------------------------------------------- forensics family
def flap_rules(asset: dict, entity_id: str, flips_by_day: dict[date, int], today: date, params: VillaParams,
               restarted: bool | None = None) -> list[Finding]:
    """A device that dropped and reconnected `reconnect_events` times within `reconnect_days` — the same window
    nightly.py reads the logbook for (architecture review 4, 2026-10-13: "3 days" was typed in both, and in the text).
    `restarted`: whether the device restarted in that window, read from its own uptime (None: it does not say).

    ⚠️ NOT "WI-FI OR POWER" WHEN THE DEVICE SAYS (2026-10-13): a relay whose uptime showed no restart for 11 days was
    told to check its power supply — a power cut restarts a device; drops without a restart are its network."""
    window = int(params.behaviour("reconnect_days"))
    n = sum(v for d, v in flips_by_day.items() if today - timedelta(days=window) < d <= today)
    if n < params.behaviour("reconnect_events"):
        return []
    if restarted is False:
        cause = "a Wi-Fi problem on its side: it never restarted, so its power held"
        check = "Check the access point it uses and its signal; move it or add a repeater."
    else:
        cause = "a Wi-Fi or power problem on its side" + (" (it restarted in that time)" if restarted else "")
        check = "Check the access point it uses, its power supply, and move it or add a repeater."
    return [Finding("PM-RECONNECT-LOOP", entity_id, asset["slug"], "network", P3,
                    f"{asset['name']} dropped and reconnected {n} times in {window} days: {cause}.",
                    {"flips_3d": n, "days": window, "restarted": restarted}, check)]


# -------------------------------------------------------- configuration family
HIDDEN_IN_RULE = "PM-HIDDEN-IN-RULE"
#: A rule's words about itself, never what it watches: an id mentioned in its description or a step's note is prose.
_PROSE_KEYS = frozenset({"alias", "description", "note", "notes", "name"})


def ids_named(config, ids) -> set[str]:
    """The ids of `ids` a rule's configuration names WHOLE — in an input, a target, a template — and never inside a
    longer id ("lock.door" is not named by "lock.door_inverted") nor in its prose (_PROSE_KEYS)."""
    texts: list[str] = []

    def walk(v, key=None):
        if key in _PROSE_KEYS:
            return
        if isinstance(v, dict):
            for k, x in v.items():
                walk(x, k)
        elif isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, str):
            texts.append(v)
    walk(config)
    text = "\n".join(texts)
    return {i for i in ids if re.search(r"(?<![\w])" + re.escape(i) + r"(?![\w])", text)}


def hidden_in_rule_rules(rules: list[dict], hidden, name_of) -> list[Finding]:
    """PM-HIDDEN-IN-RULE: one finding per villa rule (automation or script) that names a device hidden in the villa's
    system. A hidden device is left out of every VESTA check (the pack), but a rule naming it still alerts on it — the
    owner had a false "offline" alert from a rule still watching a lock he had replaced by its corrected copy (owner,
    2026-10-20). `rules`: [{"entity_id", "kind", "config"}]; `name_of(entity_id)`: a device's name."""
    out = []
    for r in rules:
        named = sorted(ids_named(r.get("config") or {}, hidden))
        if not named:
            continue
        rule = str((r.get("config") or {}).get("alias") or name_of(r["entity_id"]))
        n = len(named)
        names = ", ".join(name_of(e) for e in named)
        # "automation" or "script", never "rule" in what a person reads (owner, 2026-10-22)
        kind = "script" if str(r.get("kind") or "") == "script" else "automation"
        out.append(Finding(HIDDEN_IN_RULE, r["entity_id"], r["entity_id"], "configuration", P3,
                           f"The {kind} {rule} watches {n} device{'s' if n > 1 else ''} hidden in the villa's system: {names}.",
                           {"name": rule, "kind": r.get("kind"), "hidden": named, "count": n},
                           f"Point the {kind} at the device you see instead (a hidden device is left out of every check), "
                           f"or take the hidden one out of the {kind}."))
    return out
