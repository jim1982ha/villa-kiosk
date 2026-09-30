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
from typing import Any

from vesta_shared.params import VillaParams, MissingParameter
from vesta_shared.stats import med, pct_change, step_index
from vesta_shared.timeutil import schedule_hours_per_day, weekday_name

P2, P3, INFO = "P2", "P3", "INFO"


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


def _profile(series: list[dict]) -> str:
    """Classify how an asset runs from its last 30 days of power features.
    continuous: runs in long steady blocks (pool filtration, circulation)
    cycling:    short bursts, never a full hour (pressure pump)
    intermittent: runs on fewer than half the days (jacuzzi, jets)"""
    days = [f for f in series if f.get("hours_with_data", 0) > 0]
    if not days:
        return "unknown"
    ran = [f for f in days if (f.get("run_hours") or 0) > 0.1]
    if len(ran) < max(3, len(days) * 0.5):
        return "intermittent"
    full = med([f.get("full_hours") or 0 for f in ran])
    if full is not None and full >= 1:
        return "continuous"
    return "cycling"


# ---------------------------------------------------------------- power family
def power_rules(asset: dict, entity_id: str, series: dict[date, dict], today: date, params: VillaParams,
                expected_hours_by_weekday: dict | None, energy_series: dict[date, dict] | None,
                prior: dict[str, dict] | None = None) -> list[Finding]:
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
    profile = _profile(feats)
    recent_days = days[-confirm:] if len(days) >= confirm else []
    base_days = days[:-confirm] if len(days) > confirm else []
    slug = asset["slug"]

    # 1. running-power step or drift (continuous assets only)
    if profile == "continuous":
        base_vals = [series[d]["running_power"] for d in base_days if series[d].get("running_power")]
        rec_vals = [series[d]["running_power"] for d in recent_days if series[d].get("running_power")]
        if len(base_vals) >= min_days and len(rec_vals) == confirm:
            base = med(base_vals)
            if "PM-POWER-CHANGE" in prior and prior["PM-POWER-CHANGE"].get("baseline_w"):
                base = prior["PM-POWER-CHANGE"]["baseline_w"]
            rec = med(rec_vals)
            change = pct_change(rec, base)
            if change is not None and abs(change) >= drift_pct:
                all_vals = [series[d]["running_power"] for d in days if series[d].get("running_power")]
                idx, step_pct = step_index(all_vals)
                if idx is not None:
                    kind, when = "step", [d for d in days if series[d].get("running_power")][idx]
                    how = "sudden change on " + when.strftime("%d %b")
                else:
                    kind, when = ("drift", recent_days[0]) if len(rec_vals) >= 3 else ("new", recent_days[0])
                    how = "gradual drift" if kind == "drift" else "started on " + when.strftime("%d %b")
                direction = "lower" if change < 0 else "higher"
                summary = (f"{asset['name']} draws {abs(change):.0f}% {direction} than its 30-day normal "
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
            if exp and exp >= 1 and f.get("hours_with_data", 0) >= 20:
                change = pct_change(f["run_hours"], exp)
                if change is not None and abs(change) >= dev_pct:
                    what = "ran shorter" if change < 0 else "ran longer"
                    summary = (f"{asset['name']} {what} than expected on {d.strftime('%a %d %b')}: "
                               f"{f['run_hours']:.1f} h against {exp:.1f} h scheduled"
                               + (f", and {f['gap_hours']} h without any data" if f.get("gap_hours") else "") + ".")
                    check = ("Check the timer or switch, the power supply of the pump, and whether someone stopped it by hand."
                             if change < 0 else "Check the timer: it may have lost its programme and be running continuously.")
                    out.append(Finding("PM-RUNHOURS", entity_id, slug, "power", P3, summary,
                                       {"day": d.isoformat(), "run_hours": f["run_hours"], "expected_hours": exp,
                                        "change_pct": round(change, 1), "gap_hours": f.get("gap_hours", 0)}, check))

    # 3. energy collapse or jump, for scheduled or critical assets (cycling pumps live here)
    if energy_series and (expected_hours_by_weekday or asset.get("critical")):
        e_days = sorted(d for d in energy_series if today - timedelta(days=baseline_days) < d <= today and energy_series[d].get("kwh") is not None)
        if len(e_days) > confirm + min_days:
            rec = [energy_series[d]["kwh"] for d in e_days[-confirm:]]
            base = [energy_series[d]["kwh"] for d in e_days[:-confirm]]
            base_med = med(base)
            if "PM-ENERGY-CHANGE" in prior and prior["PM-ENERGY-CHANGE"].get("baseline_kwh"):
                base_med = prior["PM-ENERGY-CHANGE"]["baseline_kwh"]
            if len(base) >= min_days and base_med and base_med > 0.05:
                change = pct_change(med(rec), base_med)
                drop, rise = params.behaviour("energy_drop_pct"), params.behaviour("energy_rise_pct")
                if change is not None and (change <= -drop or change >= rise):
                    kind = "COLLAPSE" if change < 0 else "JUMP"
                    summary = (f"{asset['name']} used {med(rec):.2f} kWh/day over the last {confirm} days against a normal "
                               f"{base_med:.2f} kWh/day ({change:+.0f}%).")
                    check = ("A pressure pump that stops drawing power either has no demand (villa empty, tank full) or has lost its supply. "
                             "Confirm which: open a tap and listen for the pump." if change < 0 else
                             "A pump that suddenly uses much more may be cycling on a leak or a stuck float. Check for running water and the tank level.")
                    out.append(Finding("PM-ENERGY-CHANGE", asset["entities"].get("energy", entity_id), slug, "energy", P3, summary,
                                       {"kind": kind, "recent_kwh": round(med(rec), 3), "baseline_kwh": round(base_med, 3), "change_pct": round(change, 1),
                                        "profile": profile}, check))
            resets = [d for d in e_days[-confirm:] if energy_series[d].get("counter_reset")]
            if resets:
                out.append(Finding("PM-COUNTER-RESET", asset["entities"].get("energy", entity_id), slug, "energy", INFO,
                                   f"{asset['name']} energy counter went backwards on {', '.join(d.strftime('%d %b') for d in resets)}: "
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
                           f"({r['first_quarter_w']:.0f} W to {r['last_quarter_w']:.0f} W over {r['minutes']} min): a sign of air or a filling basket.",
                           {"run": r}, "Watch the next days; if it repeats, check the water level and the skimmer basket."))

    # 5. expected today but silent (intermittent assets, report only)
    if expected_hours_by_weekday and profile == "intermittent":
        d = days[-1] if days else today
        exp = expected_hours_by_weekday.get(weekday_name(d), 0)
        if exp and series.get(d, {}).get("run_hours", 0) < 0.1:
            out.append(Finding("PM-EXPECTED-SILENT", entity_id, slug, "power", INFO,
                               f"{asset['name']} was scheduled {exp:.1f} h on {d.strftime('%a %d %b')} and did not run.",
                               {"day": d.isoformat(), "expected_hours": exp}, "Report only: usage driven assets are not chased."))
    return out


# -------------------------------------------------------------- battery family
def battery_rules(asset: dict, entity_id: str, unit: str | None, level: float | None, series: list[tuple[str, float]],
                  params: VillaParams, today: date) -> list[Finding]:
    out: list[Finding] = []
    slug = asset["slug"]
    warn, crit = params.behaviour("battery_warn_pct"), params.behaviour("battery_crit_pct")
    if unit == "%" and level is not None:
        if level <= crit:
            out.append(Finding("PM-BATTERY-CRIT", entity_id, slug, "battery", P2 if asset.get("critical") else P3,
                               f"{asset['name']} battery at {level:.0f}%: replace now.", {"level": level}, "Replace the battery."))
        elif level <= warn:
            out.append(Finding("PM-BATTERY-LOW", entity_id, slug, "battery", P3,
                               f"{asset['name']} battery at {level:.0f}%: replace within the week.", {"level": level}, "Replace the battery."))
        # days to empty from the last 14 days
        pts = [(i, v) for i, (_, v) in enumerate(series[-14:])]
        if len(pts) >= 7:
            from vesta_shared.stats import slope_per_hour
            slope = slope_per_hour([(float(i), v) for i, v in pts])  # % per day here
            if slope is not None and slope < -0.5 and level is not None:
                days_left = (level - crit) / (-slope)
                if days_left < 14:
                    out.append(Finding("PM-BATTERY-TREND", entity_id, slug, "battery", INFO,
                                       f"{asset['name']} battery is falling {abs(slope):.1f} points a day, about {days_left:.0f} days left.",
                                       {"slope_per_day": round(slope, 2), "days_left": round(days_left)}, "Plan the replacement."))
    elif unit == "V":
        nominal = params.asset_optional_number(slug, "battery_nominal_v")
        if nominal is None:
            out.append(Finding("PM-PARAM-MISSING", entity_id, slug, "battery", INFO,
                               f"{asset['name']} reports a battery voltage ({level} V) but no nominal voltage is set: "
                               f"create input_number.{slug}_battery_nominal_v to get a percentage.", {"reading_v": level}, ""))
        elif level is not None and level < 0.8 * nominal:
            out.append(Finding("PM-BATTERY-LOW", entity_id, slug, "battery", P3,
                               f"{asset['name']} battery at {level:.2f} V, below 80% of its {nominal:.2f} V nominal.",
                               {"level_v": level, "nominal_v": nominal}, "Replace the battery."))
    return out


# --------------------------------------------------------- availability family
def availability_rules(asset: dict, entity_id: str, state: str | None, last_changed_hours: float | None,
                       params: VillaParams) -> list[Finding]:
    out = []
    slug = asset["slug"]
    if state in ("unavailable", "unknown") and last_changed_hours is not None:
        if last_changed_hours * 60 >= params.behaviour("unavailable_minutes"):
            sev = P2 if asset.get("critical") else P3
            out.append(Finding("PM-UNAVAILABLE", entity_id, slug, "availability", sev,
                               f"{asset['name']} has been offline for {last_changed_hours:.0f} h.",
                               {"hours": round(last_changed_hours, 1), "critical": asset.get("critical", False)},
                               "Check power and radio range; for a battery device, change the battery and press its reset."))
    return out


def silence_rules(asset: dict, entity_id: str, last_changed_hours: float | None, params: VillaParams) -> list[Finding]:
    if last_changed_hours is not None and last_changed_hours >= params.behaviour("silence_hours"):
        return [Finding("PM-SILENT", entity_id, asset["slug"], "level", P3,
                        f"{asset['name']} has not reported for {last_changed_hours / 24:.1f} days although it is online.",
                        {"hours": round(last_changed_hours, 1)}, "Check the sensor: battery, range, or a frozen device.")]
    return []


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


# ---------------------------------------------------------------- water family
def water_rules(asset: dict, entity_id: str, daily: dict[date, dict], night_flow_lpm: float | None, today: date,
                params: VillaParams) -> list[Finding]:
    """Ready for the day a water meter or flow sensor is added. Same shape as energy."""
    out = []
    slug = asset["slug"]
    baseline_days = int(params.behaviour("baseline_days")); confirm = int(params.behaviour("confirm_days"))
    days = sorted(d for d in daily if today - timedelta(days=baseline_days) < d <= today and daily[d].get("kwh") is not None)
    if len(days) > confirm + int(params.behaviour("min_days_for_baseline")):
        rec, base = [daily[d]["kwh"] for d in days[-confirm:]], [daily[d]["kwh"] for d in days[:-confirm]]
        change = pct_change(med(rec), med(base))
        if change is not None and change >= params.behaviour("energy_rise_pct"):
            out.append(Finding("PM-WATER-JUMP", entity_id, slug, "water", P3,
                               f"{asset['name']} water use is {change:+.0f}% versus normal ({med(rec):.2f} vs {med(base):.2f} m3/day).",
                               {"recent": med(rec), "baseline": med(base)}, "Check for a running toilet, a hose left open, or a leak."))
    if night_flow_lpm is not None and night_flow_lpm > 0.2:
        out.append(Finding("PM-WATER-NIGHTFLOW", entity_id, slug, "water", P2,
                           f"{asset['name']} shows {night_flow_lpm:.1f} L/min of continuous flow at night: probable leak.",
                           {"night_flow_lpm": night_flow_lpm}, "Close the main valve and see whether the meter stops."))
    return out


# ------------------------------------------------------------- forensics family
def flap_rules(asset: dict, entity_id: str, flips_by_day: dict[date, int], today: date, params: VillaParams) -> list[Finding]:
    n = sum(v for d, v in flips_by_day.items() if today - timedelta(days=3) < d <= today)
    if n >= 10:
        return [Finding("PM-RECONNECT-LOOP", entity_id, asset["slug"], "network", P3,
                        f"{asset['name']} dropped and reconnected {n} times in 3 days: a Wi-Fi or power problem on its side.",
                        {"flips_3d": n}, "Check the access point it uses, its power supply, and move it or add a repeater.")]
    return []
