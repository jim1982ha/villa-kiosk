"""What can this deployment actually be asked about?

Three questions, answered once per pass:

  CAPABILITIES — which classes of analysis are possible here at all.
  INVENTORY    — the concrete statistics and targets behind each capability.
  PREFLIGHT    — configuration that is present but broken, stated plainly.

⚠️ WHY CAPABILITIES EXIST AT ALL. This is a redistributable add-on. A property
with one energy meter and a maintenance log must get a short, useful, HONEST
report; a fully instrumented one must activate everything with no code change.
The alternative — modules that assume their data exists — produces a report
full of empty sections on most installs, which is indistinguishable from a
broken feature.

⚠️ AND WHY MISSING CAPABILITIES TRAVEL WITH THE REPORT. `capabilities_missing`
is not diagnostics for the developer; it goes into the narration payload so the
report can say what it could not see. A section quietly omitted reads as "there
was nothing to report", which is a claim nobody checked. Stating "no tariff is
configured, so no cost analysis is included" is the difference between a thin
report and a dishonest one.

⚠️ NOTHING VILLA-SPECIFIC. Every id, name and target here is READ from the live
deployment. There is no seed list, no example entity, no fallback device. A
literal in this file would work perfectly on the machine it was written against
and silently mis-describe every other install.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from aiohttp import ClientSession

from . import ledger
from .hass import HassClient, HassUnavailable, statistic_ids_of
from .log import log
from .stats import list_statistic_ids

# Capability names. Strings rather than an enum for the same reason
# contracts.py uses tuples — they cross into JSON and into the SPA.
CAP_STATISTICS = "statistics"
CAP_ENERGY_GRID = "energy_grid"
CAP_ENERGY_DEVICES = "energy_devices"
CAP_ENERGY_COST = "energy_cost"
CAP_ENERGY_WATER = "energy_water"
CAP_LEDGER = "ledger"
CAP_NOTIFY = "notify"
CAP_AREAS = "areas"

# How many absent statistics are named individually before the rest are summed.
MAX_LISTED_STATISTICS = 10

ALL_CAPABILITIES = (
    CAP_STATISTICS, CAP_ENERGY_GRID, CAP_ENERGY_DEVICES, CAP_ENERGY_COST,
    CAP_ENERGY_WATER, CAP_LEDGER, CAP_NOTIFY, CAP_AREAS,
)

# Why each capability matters, in the operator's terms. Shown in the UI beside
# a missing capability so "energy_cost: absent" is actionable rather than
# cryptic. Deliberately says what becomes possible, not what the field is.
CAPABILITY_MEANING: Dict[str, str] = {
    CAP_STATISTICS: "Long-term history is being recorded, so trends can be compared over weeks.",
    CAP_ENERGY_GRID: "Whole-property consumption is metered.",
    CAP_ENERGY_DEVICES: "Individual devices are metered, so consumption can be attributed.",
    CAP_ENERGY_COST: "A tariff is configured, so consumption can be expressed as money.",
    CAP_ENERGY_WATER: "Water use is metered.",
    CAP_LEDGER: "Maintenance and cost records exist, so findings can cite work done.",
    CAP_NOTIFY: "At least one delivery target exists, so a report can be sent.",
    CAP_AREAS: "Devices are assigned to areas, so findings can name a room.",
}

# ⚠️ THE SAME FACTS IN THE ABSENT VOICE, AND THE TWO TABLES ARE NOT
# INTERCHANGEABLE. `CAPABILITY_MEANING` says what a capability ENABLES, which
# is right beside one the property HAS. Reusing it under a "not covered by this
# report" heading prints "A tariff is configured, so consumption can be
# expressed as money" about a property with no tariff — asserting the exact
# opposite of the truth, in the section whose entire job is honesty about blind
# spots. Caught by rendering a sample report and reading it, which is the only
# thing that catches a sentence that is grammatical, plausible and wrong.
CAPABILITY_ABSENT: Dict[str, str] = {
    CAP_STATISTICS: "No long-term history is being recorded, so nothing can be "
                    "compared over time.",
    CAP_ENERGY_GRID: "Whole-property consumption is not metered.",
    CAP_ENERGY_DEVICES: "Individual devices are not metered, so consumption "
                        "cannot be attributed to equipment.",
    CAP_ENERGY_COST: "No tariff is configured, so consumption cannot be "
                     "expressed as money.",
    CAP_ENERGY_WATER: "Water use is not metered.",
    CAP_LEDGER: "No maintenance or cost records exist, so findings cannot cite "
                "work done.",
    CAP_NOTIFY: "No delivery target is configured.",
    CAP_AREAS: "Devices are not assigned to areas, so findings cannot name a "
               "room.",
}


async def _energy_prefs(hass: HassClient) -> Dict[str, Any]:
    """The Energy dashboard configuration, or an empty one.

    ⚠️ NOTHING ELSE IN THIS CODEBASE READS THIS. `HAEnergyAPI.ts` is 66 lines
    exporting one function and never calls `energy/get_prefs` — so this is
    BUILT, not mirrored, and its shape is taken from the live response rather
    than from an existing reader that could be copied wrong.

    A deployment with the Energy dashboard never opened answers with empty
    lists rather than an error, which is why absence is not treated as failure.
    """
    try:
        result: Any = await hass.command("energy/get_prefs")
    except HassUnavailable:
        return {}
    return result if isinstance(result, dict) else {}


def _grid_sources(prefs: Dict[str, Any]) -> List[Dict[str, Any]]:
    sources = prefs.get("energy_sources")
    if not isinstance(sources, list):
        return []
    return [s for s in sources if isinstance(s, dict) and s.get("type") == "grid"]


def _has_tariff(grid: Sequence[Dict[str, Any]]) -> bool:
    """Whether consumption can be turned into money.

    Any ONE of three routes is enough, and checking only `stat_cost` — the
    obvious one — would report "no tariff" on a deployment using a flat rate,
    which is the commonest configuration of the three.
    """
    for source in grid:
        if source.get("stat_cost"):
            return True
        if source.get("entity_energy_price"):
            return True
        price = source.get("number_energy_price")
        if isinstance(price, (int, float)) and not isinstance(price, bool):
            return True
    return False


def _device_stats(prefs: Dict[str, Any]) -> List[Dict[str, Any]]:
    devices = prefs.get("device_consumption")
    return [d for d in devices if isinstance(d, dict)] if isinstance(devices, list) else []


def missing_statistic_preflight(
    groups: Sequence[Tuple[str, Sequence[str]]],
    known_ids: Set[str],
) -> List[Dict[str, str]]:
    """Preflight entries for Energy dashboard statistics with no history.

    ⚠️ ALL MISSING IS A DIFFERENT FINDING FROM SOME MISSING, and emitting the
    first as N warnings buries that. Found in Phase 1 QA against a real
    deployment: every one of 22 referenced statistics was absent, which is not
    twenty-two meters going quiet — it is ONE fault, a configuration left behind
    when the sensors were renamed. Twenty-two warnings invite the reader to
    check twenty-two meters; one critical tells them where to actually look.

    The threshold is "all of them", not a count, because that is what makes the
    claim true: a partially broken config really is several independent faults
    and deserves to be listed one by one.

    Pure, and separate from `discover()`, so it can be tested without a live
    Home Assistant — the logic that decides how loud a finding is should not
    need a villa to exercise.
    """
    referenced = [(label, sid) for label, ids in groups for sid in sorted(set(ids))]
    gone = [(label, sid) for label, sid in referenced if sid not in known_ids]
    if not gone:
        return []

    if len(gone) == len(referenced):
        return [{
            "severity": "critical",
            "code": "energy_config_stale",
            "detail": f"The Energy dashboard references {len(referenced)} "
                      f"statistics and NONE of them have recorded history. Its "
                      f"configuration is stale — this is what happens when the "
                      f"sensors are renamed and the dashboard is not updated to "
                      f"follow.",
        }]

    # Listed individually, but bounded: a reader who needs more than ten names
    # needs the dashboard, not a longer log line.
    out: List[Dict[str, str]] = [{
        "severity": "warning",
        "code": "statistic_missing",
        "detail": f"The Energy dashboard's {label} statistic '{sid}' has no "
                  f"recorded history.",
    } for label, sid in gone[:MAX_LISTED_STATISTICS]]
    if len(gone) > MAX_LISTED_STATISTICS:
        out.append({
            "severity": "warning",
            "code": "statistic_missing_more",
            "detail": f"{len(gone) - MAX_LISTED_STATISTICS} further referenced "
                      f"statistics also have no recorded history.",
        })
    return out


async def _notify_targets(hass: HassClient) -> List[Dict[str, Any]]:
    """Every notify service, described well enough to choose between.

    ⚠️ TWO TRAPS, BOTH LIVE ON REAL DEPLOYMENTS.

    `notify.notify` fans out to EVERY configured device at once. It is a
    perfectly good service and a terrible default: a villa that switches on
    reports and gets the weekly summary on the TV, three phones and a tablet
    will switch them off again. Flagged `broadcast` so the UI can warn.

    `notify.send_message` is the newer entity-based platform and takes an
    `entity_id`, not a bare message. Calling it the old way fails at delivery
    time — long after the operator chose it — so it is flagged `needs_target`
    and Phase 2 must not treat it as a plain target.
    """
    try:
        result: Any = await hass.command("get_services")
    except HassUnavailable:
        return []
    domain = result.get("notify") if isinstance(result, dict) else None
    if not isinstance(domain, dict):
        return []
    targets: List[Dict[str, Any]] = []
    for service, meta in domain.items():
        info: Dict[str, Any] = meta if isinstance(meta, dict) else {}
        raw_fields = info.get("fields")
        fields: Dict[str, Any] = raw_fields if isinstance(raw_fields, dict) else {}
        targets.append({
            "service": f"notify.{service}",
            "name": str(info.get("name") or service),
            "broadcast": service == "notify",
            "needs_target": "entity_id" in fields or service == "send_message",
        })
    targets.sort(key=lambda row: str(row["service"]))
    return targets


def _duplicate_names(targets: Sequence[Dict[str, Any]]) -> List[str]:
    """Friendly names shared by more than one target.

    Worth surfacing because the operator picks from a list of NAMES: two
    entries reading "Mobile App" are indistinguishable in the UI, and choosing
    the wrong one is only discovered when the report goes to the wrong person.
    """
    seen: Dict[str, int] = {}
    for target in targets:
        name = str(target.get("name", "")).strip().lower()
        if name:
            seen[name] = seen.get(name, 0) + 1
    return sorted(name for name, count in seen.items() if count > 1)


async def _area_count(hass: HassClient) -> int:
    """How many areas exist, so a finding can name a room rather than a device.

    Best effort: a deployment that refuses the registry command reports 0,
    which correctly reads as "cannot name rooms" rather than failing the pass.

    ⚠️ Returns a COUNT, never the names. Area names are room names in someone's
    home and are only needed per-finding, where the allow-list governs them.
    Pulling the whole registry here would put the villa's floor plan into a
    diagnostics payload that has no reason to carry it.
    """
    try:
        result: Any = await hass.command("config/area_registry/list")
    except HassUnavailable:
        return 0
    return len(result) if isinstance(result, list) else 0


async def discover(session: ClientSession, now_iso: Optional[str] = None) -> Dict[str, Any]:
    """Everything the report pipeline needs to know about this deployment.

    Never raises. A total failure to reach Home Assistant returns a result with
    `reachable: false` and no capabilities, which is a real answer and reads
    differently from "reachable, but nothing is instrumented".
    """
    capabilities: Set[str] = set()
    preflight: List[Dict[str, str]] = []
    inventory: Dict[str, Any] = {}

    fm = ledger.read()
    fm_summary = ledger.summarise(fm)
    if fm_summary["present"]:
        capabilities.add(CAP_LEDGER)
    inventory["ledger"] = fm_summary

    try:
        async with HassClient(session) as hass:
            metadata = await list_statistic_ids(hass)
            known_ids: Set[str] = {
                row["statistic_id"] for row in metadata
                if isinstance(row.get("statistic_id"), str)
            }
            if known_ids:
                capabilities.add(CAP_STATISTICS)
            inventory["statistics_total"] = len(known_ids)

            prefs = await _energy_prefs(hass)
            grid = _grid_sources(prefs)
            grid_ids = (statistic_ids_of(grid, "stat_energy_from")
                        + statistic_ids_of(grid, "stat_energy_to"))
            devices = _device_stats(prefs)
            device_ids = statistic_ids_of(devices, "stat_consumption")
            water = prefs.get("device_consumption_water")
            water_ids = (statistic_ids_of([w for w in water if isinstance(w, dict)],
                                          "stat_consumption")
                         if isinstance(water, list) else [])

            if grid_ids:
                capabilities.add(CAP_ENERGY_GRID)
            if device_ids:
                capabilities.add(CAP_ENERGY_DEVICES)
            if water_ids:
                capabilities.add(CAP_ENERGY_WATER)
            if _has_tariff(grid):
                capabilities.add(CAP_ENERGY_COST)

            # ⚠️ A statistic can be REFERENCED by the Energy dashboard and not
            # EXIST in the recorder — a renamed or removed entity leaves the
            # dashboard pointing at an id nothing writes any more. The dashboard
            # keeps rendering (it just shows a gap), so this is invisible until
            # something asks for the numbers. Naming it here is the difference
            # between a report with a silently empty energy section and one that
            # says which meter stopped.
            preflight.extend(missing_statistic_preflight(
                [("grid", grid_ids), ("device", device_ids), ("water", water_ids)],
                known_ids))

            # ⚠️ DOUBLE COUNTING. `included_in_stat` says "this device's usage
            # is already part of that parent meter", so summing every device
            # counts the child twice unless the hierarchy is honoured. Recorded
            # here so no analysis module has to rediscover it. Measured on a
            # real deployment: 17 of 20 device meters rolled into one parent,
            # leaving 3 independent — a naive total would have been inflated by
            # a plausible-looking amount.
            rolled_up = {
                str(d["stat_consumption"]): str(d["included_in_stat"])
                for d in devices
                if isinstance(d.get("stat_consumption"), str)
                and isinstance(d.get("included_in_stat"), str)
            }

            area_count = await _area_count(hass)
            if area_count:
                capabilities.add(CAP_AREAS)
            inventory["area_count"] = area_count

            targets = await _notify_targets(hass)
            if targets:
                capabilities.add(CAP_NOTIFY)
            for duplicate in _duplicate_names(targets):
                preflight.append({
                    "severity": "notice",
                    "code": "notify_name_collision",
                    "detail": f"More than one delivery target is named "
                              f"'{duplicate}' — they are told apart by service id.",
                })

            inventory["energy"] = {
                "grid": grid_ids,
                "devices": device_ids,
                "water": water_ids,
                "rolled_up_into": rolled_up,
                "independent_devices": sorted(set(device_ids) - set(rolled_up)),
            }
            inventory["notify_targets"] = targets
            config: Any = await hass.command("get_config")
            reachable = True
            version = config.get("version") if isinstance(config, dict) else None
            timezone = config.get("time_zone") if isinstance(config, dict) else None
    except HassUnavailable as err:
        log(f"discovery could not reach Home Assistant: {err}")
        return {
            "reachable": False, "error": str(err),
            "capabilities": sorted(capabilities),
            "capabilities_missing": [c for c in ALL_CAPABILITIES if c not in capabilities],
            "capability_meaning": CAPABILITY_MEANING,
            "capability_absent": CAPABILITY_ABSENT,
            "inventory": inventory,
            "preflight": [{
                "severity": "critical", "code": "unreachable",
                "detail": f"Home Assistant could not be reached: {err}",
            }],
            "at": now_iso,
        }

    if CAP_ENERGY_GRID in capabilities and CAP_ENERGY_COST not in capabilities:
        preflight.append({
            "severity": "notice",
            "code": "no_tariff",
            # ⚠️ Names the capability it accounts for. The renderer drops that
            # capability from the blind-spot list, so an owner is told about a
            # missing tariff ONCE — under "needs attention", where it is
            # actionable — rather than twice in slightly different words.
            "capability": CAP_ENERGY_COST,
            "detail": "No tariff is configured on the Energy dashboard, so "
                      "consumption cannot be expressed as money.",
        })
    if CAP_STATISTICS not in capabilities:
        preflight.append({
            "severity": "critical",
            "code": "no_statistics",
            "detail": "The recorder has no long-term statistics, so no trend "
                      "can be measured. Reports will have nothing to compare.",
        })

    absent = [c for c in ALL_CAPABILITIES if c not in capabilities]
    log(f"discovery: {len(capabilities)} capabilities, {len(absent)} missing, "
        f"{len(preflight)} preflight item(s)")
    return {
        "reachable": reachable,
        "version": version,
        "timezone": timezone,
        "capabilities": sorted(capabilities),
        "capabilities_missing": absent,
        "capability_meaning": CAPABILITY_MEANING,
        "capability_absent": CAPABILITY_ABSENT,
        "inventory": inventory,
        "preflight": preflight,
        "at": now_iso,
    }
