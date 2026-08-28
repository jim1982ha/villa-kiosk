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

from . import collect, ledger
from .hass import HassClient, HassUnavailable, statistic_ids_of
from .log import log
from .stats import list_statistic_ids
from vesta.shared.text import name_of

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
# ⚠️ `CAP_BLUEPRINTS` WAS DELETED HERE (2026-08-28). It meant "this property has
# its own automation layer", and it decided whether the built-in analysis
# modules stood aside — a real question while `maintenance_*` and `roi_*`
# existed, because a statistic cannot see occupancy or tariffs and the
# blueprint could.
#
# THE CUTOVER RETIRED THOSE BLUEPRINTS AND 2.755.0 REPLACED THE RULE: the ONLY
# thing that decides now is `context.supervision_enabled` — supervision on, the
# assistant supersedes and every check runs; supervision off, an automation
# takes the job back. `registry.gate` reads that and nothing else.
#
# So this capability had one consumer left in the whole system: a sentence on
# the "What is watched" tab claiming the automations "win". It was inverted, and
# it could never be anything else — the flag is derived from
# `blueprint_categories`, a PERSISTED CUMULATIVE list that still records
# `maintenance` and `roi` on a villa where both were retired weeks ago. Same
# class of lie as the `online_since` flag that `connected` was added to replace:
# a value that can only ever say yes.

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
        # ⚠️ `name_of`, not a hand-written pair of apostrophes. The audit that
        # converged the renderer's five sites walked their call sites and so
        # could not see this one; it was found by grepping for the SHAPE of the
        # problem — an apostrophe-wrapped interpolation — which is
        # `feedback_audit-applicable-set` in one line. A statistic id is a name
        # in prose exactly as a rule name is. Pinned by `test_inert`.
        "detail": f"The Energy dashboard's {label} statistic {name_of(sid)} "
                  f"has no recorded history.",
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
    """Every destination this deployment offers, described well enough to
    choose between.

    ⚠️ NOT "every notify service", which is what this line said until v2.552.0
    and what the function did until v2.546.0. It returns notify services, any
    other domain's service that speaks the same payload, AND notify entities.

    ⚠️ THREE TRAPS, ALL LIVE ON REAL DEPLOYMENTS.

    `notify.notify` fans out to EVERY configured device at once. It is a
    perfectly good service and a terrible default: a villa that switches on
    reports and gets the weekly summary on the TV, three phones and a tablet
    will switch them off again. Flagged `broadcast` so the UI can warn.

    `notify.send_message` is the newer entity-based platform and takes an
    `entity_id`, not a bare message. Calling it the old way fails at delivery
    time — long after the operator chose it — so it is flagged `needs_target`
    and Phase 2 must not treat it as a plain target. Since v2.549.0 the
    destinations it stands for are listed individually as entity targets, so it
    is hidden from the picker rather than offered and refused.

    ⚠️ THE THIRD, FOUND ON THE REFERENCE VILLA: THE `notify` DOMAIN IS NOT
    THE ONLY PLACE A MESSAGE CAN BE SENT. That property runs the modern
    `telegram_bot` integration, which registers `telegram_bot.send_message` and
    NO `notify.telegram_*` service at all — so a picker built from the `notify`
    domain showed six mobile apps and a television, and the owner asked where
    Telegram had gone. It had never been there and could not be: `deliver.py`
    also hard-coded the domain, so even a hand-typed target would 404.

    ⚠️ THE FIX IS A CAPABILITY TEST, NOT A SECOND DOMAIN NAME. Any service in
    any domain that takes a REQUIRED `message` and accepts a `title` speaks the
    intersection `deliver.py` already sends — that is the whole contract, and it
    is checked against the service's own published schema rather than against a
    list of integrations this file would then have to maintain. `telegram_bot.
    send_message` matches it; so does anything else that ever ships with the
    same shape. No platform name appears here, which is the same rule
    `deliver.py`'s header states for the same reason.
    """
    try:
        result: Any = await hass.command("get_services")
    except HassUnavailable:
        return []
    if not isinstance(result, dict):
        return []

    notify_domain = result.get("notify")
    notify_services: Set[str] = (set(notify_domain)
                                 if isinstance(notify_domain, dict) else set())

    targets: List[Dict[str, Any]] = []
    for domain_name, services in result.items():
        if not isinstance(services, dict):
            continue
        for service, meta in services.items():
            info: Dict[str, Any] = meta if isinstance(meta, dict) else {}
            raw_fields = info.get("fields")
            fields: Dict[str, Any] = raw_fields if isinstance(raw_fields, dict) else {}
            if domain_name != "notify":
                if not _speaks_message(fields):
                    continue
                if _redundant(domain_name, fields, notify_services):
                    continue
            targets.append({
                "service": f"{domain_name}.{service}",
                "name": str(info.get("name") or service),
                # ⚠️ DOMAIN-QUALIFIED. `notify.notify` is the fan-out; a service
                # merely NAMED `notify` in another domain is not.
                "broadcast": domain_name == "notify" and service == "notify",
                "needs_target": (domain_name == "notify"
                                 and ("entity_id" in fields
                                      or service == "send_message")),
                "plain_mode": _plain_mode(fields),
            })
    targets += await _notify_entities(hass)
    targets.sort(key=lambda row: str(row["service"]))
    return targets


#: How an entity-addressed destination is written in the config, so it cannot
#: be confused with a SERVICE of the same shape. ⚠️ THIS PREFIX IS LOAD-BEARING:
#: `notify.mobile_app_x` is a service and `notify.living_room_bot_group` is an
#: ENTITY, and the two are indistinguishable as strings. Calling one the other
#: way fails at delivery time, long after the operator chose it.
ENTITY_TARGET_PREFIX = "entity:"


async def _notify_entities(hass: HassClient) -> List[Dict[str, Any]]:
    """Notify ENTITIES, which are how the modern platform addresses one chat.

    ⚠️ THE SERVICE LIST CANNOT REACH THESE, AND THEY ARE OFTEN THE ONES THE
    OPERATOR WANTS. Home Assistant's newer notify platform registers ONE
    `notify.send_message` service for the whole system and an ENTITY per
    destination — so a Telegram bot with two allowed chats appears as two notify
    entities and zero notify services. Offering `notify.send_message` bare is
    worse than offering nothing: it is a valid pick that fails at delivery time
    because it carries no `entity_id`.

    Found on the reference villa, twice over. The first pass added
    `telegram_bot.send_message`, which reaches every allowed chat at once and
    cannot select one; the owner then asked for the Telegram GROUP specifically,
    which is exactly what an entity target addresses.

    ⚠️ THE FRIENDLY NAME IS THE WHOLE POINT of listing these — an operator picks
    "TheLysHouse", not `notify.living_room_vesta_thelyshouse_thelyshouse`.
    """
    try:
        result: Any = await hass.command("get_states")
    except HassUnavailable:
        return []
    if not isinstance(result, list):
        return []
    out: List[Dict[str, Any]] = []
    for state in result:
        if not isinstance(state, dict):
            continue
        entity_id = str(state.get("entity_id") or "")
        if not entity_id.startswith("notify."):
            continue
        attributes = state.get("attributes")
        friendly = ""
        if isinstance(attributes, dict):
            friendly = str(attributes.get("friendly_name") or "")
        out.append({
            "service": f"{ENTITY_TARGET_PREFIX}{entity_id}",
            "name": friendly or entity_id,
            # An entity addresses exactly one destination, which is the reason
            # to prefer it — it can never be the fan-out.
            "broadcast": False,
            "needs_target": False,
            # ⚠️ EVERY BUILDER OF A TARGET RECORD MUST SET EVERY FIELD, AND
            # THIS ONE DID NOT — v2.559.0 added `plain_mode` to the SERVICE loop
            # and left this builder untouched, so entity targets carried no such
            # key and `deliver` read "" for all of them. Verbatim the `reachY`
            # failure CLAUDE.md records in the badge tier: a second builder of
            # the same shape, copying nine fields and not the tenth.
            #
            # ⚠️ AND IT IS "" HERE ON PURPOSE, not by omission. An entity target
            # is delivered through `notify.send_message`, whose schema on a live
            # deployment is `message` + `title` and NOTHING ELSE — there is no
            # `parse_mode` to set, so a platform that parses markup cannot be
            # told not to. That is why the identifiers were taken OUT of the
            # prose rather than defended against: see `readable_label`'s callers.
            "plain_mode": "",
        })
    return out


def _redundant(domain: str, fields: Dict[str, Any],
               notify_services: Set[str]) -> bool:
    """Does this non-notify service reach somewhere already offered?

    ⚠️ THE ANY-DOMAIN SCAN WAS TOO GENEROUS AND THE LIST SHOWED IT. Reported as
    "it feels like redundant options, right?" — and it was, twice over on the
    reference villa:

      `persistent_notification.create`  the same place as `notify.persistent_notification`
      `telegram_bot.send_message`       every allowed chat, when the chats are
                                        already listed one by one as entities

    Both are DUPLICATE ROUTES, and offering a second name for one destination is
    worse than offering nothing: it invites a choice with no meaning and, in the
    telegram case, one that quietly fans out where the operator picked a group.

    Two rules, both read off data already fetched — no extra round trip, no
    integration named:

      A `notify.<domain>` EXISTS. Home Assistant's own convention is that an
        integration reachable by notification registers itself there; if it did,
        its own domain service is the same destination by another name.

      THE SERVICE TAKES `entity_id`. Then it is an ENTITY-ADDRESSING service and
        the entities are the specific targets — which `_notify_entities` lists
        individually. This is exactly the rule already applied to
        `notify.send_message` as `needs_target`, generalised to every domain
        rather than special-cased for one.

    ⚠️ CONSERVATIVE BY DESIGN: it only ever hides a service whose destinations
    are ALREADY REACHABLE another way, so nothing becomes unreachable. A
    property whose integration registers neither a notify service nor notify
    entities keeps its domain service, because there it is the only route.
    """
    if domain in notify_services:
        return True
    return "entity_id" in fields


def _plain_mode(fields: Dict[str, Any]) -> str:
    """The option that tells this service NOT to parse the message, or "".

    ⚠️ SENDING PLAIN TEXT IS NOT THE SAME AS IT ARRIVING PLAIN, and the
    reference villa proved it. `deliver.py` sends `title` + `message` with no
    markup — its header says so at length — but the villa's telegram_bot entry
    has `parse_mode: markdown` as its DEFAULT, so Telegram parsed our plain text
    as Markdown on the way in and ate every underscore as an italic marker. The
    owner's delivered brief read `criticalschedule---poolpump`,
    `levelanomaly`, `sensorhealth`, `entityid`, while the same brief in the
    console read `critical_schedule---pool_pump`. Silent, lossy, and invisible
    from this end: the add-on's log says delivered, and it was.

    ⚠️ STILL NO PLATFORM NAME. The service DECLARES its `parse_mode` options in
    the schema this function is handed, so the question asked is "does this
    service offer a way to switch parsing off", exactly as `_speaks_message`
    asks "does it take a message". A service that offers none returns "" and is
    called precisely as before.

    ⚠️ AND IT IS NOT AN ESCAPING PROBLEM. Escaping would mean knowing which
    dialect each platform speaks — markdown, markdownv2 and html differ in what
    they escape and how — which is the platform table this file exists to avoid.
    Telling the service not to parse is one field and no dialect knowledge.
    """
    field = fields.get("parse_mode")
    if not isinstance(field, dict):
        return ""
    selector = field.get("selector")
    options: Any = []
    if isinstance(selector, dict) and isinstance(selector.get("select"), dict):
        options = selector["select"].get("options") or []
    if not isinstance(options, list):
        return ""
    for option in options:
        name = option if isinstance(option, str) else ""
        if isinstance(option, dict):
            name = str(option.get("value") or "")
        # "plain_text", "plain", "none", "text" — whichever this service calls
        # its no-parsing option. Matched on the CONCEPT, not on a known list.
        if name and ("plain" in name.lower() or name.lower() in ("none", "text")):
            return name
    return ""


def _speaks_message(fields: Dict[str, Any]) -> bool:
    """Does this service take the payload `deliver.py` sends?

    ⚠️ REQUIRED `message` IS THE DISCRIMINATOR, and `title` alone is not enough
    — plenty of services take a title. Requiring `message` to be REQUIRED is
    what keeps `telegram_bot.send_photo`, `edit_caption` and the other twenty
    telegram actions out of a list the operator picks a destination from.
    """
    message = fields.get("message")
    if not isinstance(message, dict) or not message.get("required"):
        return False
    return "title" in fields


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
    currency: Optional[str] = None

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
                              f"{name_of(duplicate)} — they are told apart by "
                              f"service id.",
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
            # ⚠️ RECORDED HERE, ADJUDICATED IN `links`. Both URLs are captured
            # because "which one may be sent" is a policy question, and keeping
            # the policy in one module beats a discovery step that silently
            # drops a field a future caller needs. `links._base` is the only
            # reader and it refuses everything but an https EXTERNAL url — an
            # internal one is a LAN address and must never reach a notify
            # platform. See that module's rule 1.
            if isinstance(config, dict):
                # ⚠️ HOME ASSISTANT'S OWN KEY NAMES, CARRIED THROUGH UNCHANGED.
                # This renamed them to `external`/`internal` while `links` read
                # `external_url`/`internal_url` — so every link was silently
                # withheld and the owner asked where they had gone. Exactly the
                # shape `test_store_envelope` exists for: two files, a string
                # literal in each, and nothing between them. Renaming a field on
                # the way past buys nothing and costs a whole feature.
                inventory["urls"] = {
                    "external_url": str(config.get("external_url") or ""),
                    "internal_url": str(config.get("internal_url") or ""),
                }
            timezone = config.get("time_zone") if isinstance(config, dict) else None
            # ⚠️ ASKED FOR, NOT GUESSED — AND THE DISTINCTION IS THE WHOLE
            # POINT. The renderer printed every amount bare, on the reasoning
            # that "guessing a symbol from a locale the add-on cannot see is how
            # a report claims dollars about a figure computed in rupiah". That
            # is right about GUESSING and it stopped one question short: Home
            # Assistant carries the operator's own `currency` setting and this
            # very command already returned it, beside the `version` and
            # `time_zone` two lines up, and it was thrown away. So a brief said
            # "Avoidable cost identified: 2,146" and the owner asked what 2,146
            # stood for — a fair question with no answer in the message.
            # Absent or blank still prints bare, which is the old behaviour.
            currency = config.get("currency") if isinstance(config, dict) else None
    except HassUnavailable as err:
        log(f"discovery could not reach Home Assistant: {err}")
        return {
            "reachable": False, "error": str(err),
            "capabilities": sorted(capabilities),
            "capabilities_missing": [c for c in ALL_CAPABILITIES if c not in capabilities],
            "capability_meaning": CAPABILITY_MEANING,
            "capability_absent": CAPABILITY_ABSENT,
            "inventory": inventory,
            "currency": currency or "",
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
        "currency": currency or "",
        "capabilities": sorted(capabilities),
        "capabilities_missing": absent,
        "capability_meaning": CAPABILITY_MEANING,
        "capability_absent": CAPABILITY_ABSENT,
        "inventory": inventory,
        "preflight": preflight,
        "at": now_iso,
    }
