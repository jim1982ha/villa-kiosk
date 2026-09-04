"""The villa's own rules, read as DATA: which VESTA automations exist, how each
is configured, and what it would take to judge whether that configuration can
work. The adapter half of `analysis/modules/rule_calibration`.

⚠️ WHY THIS EXISTS (2026-09-04). Every alert the owner received over three days
came from a `critical_*` rule, and every root cause was the RULE — a grace
window narrower than the pump's own start jitter, a clear threshold equal to
the trip threshold, an incident that ended by timeout in silence. Three layers
watch the villa and nothing watched the watchers: the only rule-health check
was "is a critical automation switched off". The statistical modules could not
take the job because `ModuleContext` deliberately carries no session and no
automation view — a module that can open its own websocket can make its own
unbudgeted queries. So the pipeline fetches, through this adapter, and the
module reads. That is the existing contract, not an exception to it.

⚠️ KEYED ON THE BLUEPRINT, NEVER ON THE INSTANCE NAME. An automation is named by
whoever filled the form; the blueprint it was built from is the same file on
every property. `use_blueprint.path` is read from each automation's config and
only `CRITICAL_STEMS` are surveyed — the two blueprints whose INPUT NAMES this
adapter knows. Those names are the pack's contract (`threshold`, `clear_margin`,
`confirm_for`, `duration_offline`, …) and are read here and nowhere else.

⚠️ THE ALIAS PREFIX IS A PRE-FILTER, NOT THE JOIN. `collect._to_record` already
groups on "the automation's name starts with the blueprint's stem", and this
uses the same convention to avoid one REST call per automation on a villa with
hundreds; the config's `use_blueprint.path` is what actually decides.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from vesta.adapters import record as record_mod
from vesta.adapters import stats as stats_mod
from vesta.adapters.log import swallow, warn
from vesta.shared.instants import WEEKDAYS

#: The blueprints whose inputs the calibration module can read. Stems, because
#: that is the one part of a VESTA rule that is the same on every property.
CRITICAL_STEMS: Tuple[str, ...] = ("critical_condition", "critical_schedule")

def stem_of(path: Any) -> str:
    """`critical_condition.yaml` / `vesta/critical_condition.yaml` -> the stem."""
    name = str(path or "").replace("\\", "/").rsplit("/", 1)[-1]
    return name[:-5] if name.endswith(".yaml") else name


async def schedule_blocks(hass: Any, entity_id: str) -> List[Dict[str, str]]:
    """`[{day, from, to}]` for one schedule helper, or `[]`.

    ⚠️ JOINED THROUGH THE ENTITY REGISTRY'S `unique_id`, NOT THE NAME. A
    schedule helper's `schedule/list` item is keyed by its storage id and the
    entity id is a slug of whatever the helper was called when it was made;
    renaming the helper changes neither, so the registry's unique_id is the one
    join that survives a rename. Shared by the agent's `read_schedule` reader
    and the calibration survey — one join, two callers.
    """
    entry = await hass.command("config/entity_registry/get", entity_id=entity_id)
    items = await hass.command("schedule/list")
    unique = str(entry.get("unique_id") or "") if isinstance(entry, Mapping) else ""
    for item in (items if isinstance(items, list) else []):
        if not isinstance(item, Mapping) or str(item.get("id") or "") != unique:
            continue
        out: List[Dict[str, str]] = []
        for day in WEEKDAYS:
            for block in (item.get(day) or []):
                if isinstance(block, Mapping):
                    out.append({"day": day, "from": str(block.get("from") or ""),
                                "to": str(block.get("to") or "")})
        return out
    return []


async def fetch_history(session: Any, entity_id: str,
                        start_iso: str) -> List[Dict[str, Any]]:
    """`[{at, state}]` for one entity since `start_iso`, oldest first.

    ⚠️ `minimal_response` AND `no_attributes`, because every reader of this
    downsamples or thresholds anyway. A power sensor changes hundreds of times
    a day; the full history row carries an attribute map per change, and every
    byte fetched here is a byte the caller then throws away.
    """
    from vesta.adapters.hass import rest_get
    rows = await rest_get(
        session, f"history/period/{start_iso}?filter_entity_id={entity_id}"
        "&minimal_response&no_attributes")
    series = rows[0] if isinstance(rows, list) and rows else []
    return [{"at": str(r.get("last_changed") or r.get("last_updated") or ""),
             "state": r.get("state")}
            for r in (series if isinstance(series, list) else [])
            if isinstance(r, Mapping)]


def _is_vesta_critical(state: Mapping[str, Any]) -> bool:
    attrs = state.get("attributes")
    name = str(attrs.get("friendly_name") or "") if isinstance(attrs, Mapping) else ""
    return any(name.startswith(stem) for stem in CRITICAL_STEMS)


async def survey(session: Any, now_local: datetime, *,
                 band_days: int, start_days: int) -> Dict[str, Any]:
    """Every surveyable VESTA rule with what the calibration checks need.

    Returns `{"instances": [...], "firings": {...}}`. Each instance carries
    `entity_id`, `alias`, `stem`, `enabled`, `label`, `inputs`, and — where the
    stem calls for it — `hourly` (per watched entity, `band_days` of hourly
    mean/min/max statistics) or `blocks` + `history` (the schedule helper's
    week and `start_days` of the power sensor's raw history). `firings` is the
    record's own tally, so a check can ask how incidents ended.

    ⚠️ ONE INSTANCE THAT FAILS TO SURVEY IS SKIPPED, NEVER THE PASS. A renamed
    entity in one rule's watched list must not cost the brief every other rule.
    """
    from vesta.adapters.hass import HassClient, rest_get
    instances: List[Dict[str, Any]] = []
    async with HassClient(session) as hass:
        states = await hass.command("get_states")
        candidates = [s for s in (states if isinstance(states, list) else [])
                      if isinstance(s, Mapping)
                      and str(s.get("entity_id") or "").startswith("automation.")
                      and _is_vesta_critical(s)]
        for state in candidates:
            attrs = state.get("attributes") or {}
            item_id = str(attrs.get("id") or "") if isinstance(attrs, Mapping) else ""
            if not item_id:
                continue
            try:
                config = await rest_get(session, f"config/automation/config/{item_id}")
            except Exception as err:  # noqa: BLE001 - one rule, not the pass
                warn(f"could not read automation config {item_id}: {err}")
                continue
            if not isinstance(config, Mapping):
                continue
            blueprint = config.get("use_blueprint")
            if not isinstance(blueprint, Mapping):
                continue
            stem = stem_of(blueprint.get("path"))
            if stem not in CRITICAL_STEMS:
                continue
            inputs = blueprint.get("input")
            inputs = dict(inputs) if isinstance(inputs, Mapping) else {}
            alias = str(config.get("alias") or attrs.get("friendly_name") or "")
            instance: Dict[str, Any] = {
                "entity_id": str(state.get("entity_id") or ""),
                "alias": alias, "stem": stem,
                "enabled": str(state.get("state") or "") == "on",
                "label": str(inputs.get("alert_label") or alias),
                "inputs": inputs,
            }
            try:
                await _enrich(hass, session, instance, now_local,
                              band_days=band_days, start_days=start_days)
            except Exception as err:  # noqa: BLE001 - one rule, not the pass
                swallow(f"could not survey {alias}", err)
            instances.append(instance)
    try:
        firings = record_mod.tally_automations(record_mod.read())
    except Exception as err:  # noqa: BLE001
        swallow("could not tally the record for the calibration survey", err)
        firings = {}
    return {"instances": instances, "firings": firings}


async def _enrich(hass: Any, session: Any, instance: Dict[str, Any],
                  now_local: datetime, *, band_days: int, start_days: int) -> None:
    """Attach the data each stem's checks need."""
    inputs = instance["inputs"]
    if instance["stem"] == "critical_condition":
        if str(inputs.get("alert_mode") or "state") != "numeric":
            return
        watched = [str(w) for w in (inputs.get("watched_entities") or [])
                   if isinstance(w, str)]
        if not watched:
            return
        start = stats_mod.start_of_day(now_local, band_days)
        instance["hourly"] = await stats_mod.statistics_during_period(
            hass, watched, start, period="hour", types=("mean", "min", "max"))
    elif instance["stem"] == "critical_schedule":
        helper = str(inputs.get("expected_schedule") or "")
        sensor = str(inputs.get("power_sensor") or "")
        if not helper or not sensor:
            return
        instance["blocks"] = await schedule_blocks(hass, helper)
        since = (now_local - timedelta(days=start_days)).isoformat(timespec="seconds")
        instance["history"] = await fetch_history(session, sensor, since)


def fetcher(session: Any, now_local: datetime, tally: Dict[str, Any]) -> Any:
    """The injected `context.automations` — the same shape as
    `stats.statistics_fetcher`, for the same reason: modules ask, the adapter
    fetches, and a failure is recorded in the tally rather than raised."""
    from vesta.adapters.hass import HassUnavailable

    async def fetch(*, band_days: int, start_days: int) -> Dict[str, Any]:
        try:
            view = await survey(session, now_local, band_days=band_days,
                                start_days=start_days)
        except HassUnavailable as err:
            warn(f"automation survey unavailable for this pass: {err}")
            tally["automations_error"] = str(err)
            return {"instances": [], "firings": {}}
        tally["automations_surveyed"] = len(view.get("instances") or [])
        return view

    return fetch


def critical_automation_ids(states: Sequence[Mapping[str, Any]]) -> List[str]:
    """Entity ids of the automations `survey` would consider, from a
    `get_states` result — what `discovery` records as the capability."""
    return sorted(str(s.get("entity_id") or "") for s in states
                  if isinstance(s, Mapping)
                  and str(s.get("entity_id") or "").startswith("automation.")
                  and _is_vesta_critical(s))
