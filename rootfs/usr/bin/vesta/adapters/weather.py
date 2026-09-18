"""Outdoor conditions and the short forecast, read from the property's own
Home Assistant weather entity.

⚠️ A PLAYBOOK WAS SHIPPED FOR THIS AND THE DATA PATH NEVER WAS. `playbooks/
climate/weather-risk.md` instructs the model to state "what is forecast, when,
and with what confidence" — and until this module, nothing in
`rootfs/usr/bin/vesta/` mentioned weather at all. No source, no tool, nothing in
the villa document. The model's only route to an answer was to guess that the
generic Home Assistant search tools might turn something up.

⚠️ AND THE SYMPTOM WAS A FLAT DENIAL, NOT A REFUSAL. Reported from the villa
2026-09-18: asked for outdoor pressure and wind, VESTA answered that the
property has no such sensor — twenty-two minutes after answering the same
question correctly, having found the entity by search on that occasion. The
property has a weather entity carrying pressure, wind bearing, wind speed,
humidity and temperature, and supporting forecasts. Saying "there is no sensor"
about a property that has one is worse than saying nothing: it closes the
question.

⚠️ DERIVED, NEVER ASSUMED. The entity is found by DOMAIN at runtime; no entity
id, station name or attribute set belonging to any property appears here. A
villa with no weather entity gets "not configured", a villa with three gets
three. First hard rule.

⚠️ ONE LISTING CALL, NOT ONE PER ENTITY. `GET /api/states` is a single request
that returns everything, and filtering it beats `states/<id>` per candidate —
the fan-out `sources.state_reader` warns about is 1,270 REQUESTS, which is a
different thing from one large response.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Sequence

from vesta.adapters.hass import HassClient, rest_get

#: The Home Assistant domain that, by definition, carries outdoor conditions.
_DOMAIN = "weather."

#: Attributes a weather entity may publish. ⚠️ AN ALLOW-LIST, SO A VILLA-NAMED
#: custom attribute cannot ride into the transcript, and so a missing one is
#: ABSENT rather than reported as a zero.
_FIELDS: Sequence[str] = (
    "temperature", "apparent_temperature", "humidity", "pressure",
    "wind_speed", "wind_bearing", "wind_gust_speed", "cloud_coverage",
    "visibility", "dew_point", "uv_index",
)

#: The unit attribute paired with each reading, where HA publishes one.
_UNITS: Mapping[str, str] = {
    "temperature": "temperature_unit",
    "apparent_temperature": "temperature_unit",
    "dew_point": "temperature_unit",
    "pressure": "pressure_unit",
    "wind_speed": "wind_speed_unit",
    "wind_gust_speed": "wind_speed_unit",
    "visibility": "visibility_unit",
}

#: How many forecast steps are worth sending. "The next few hours" is the
#: question people actually ask; a week of rows is prefix nobody reads.
MAX_FORECAST_STEPS = 8

#: Home Assistant's fixed condition vocabulary.
#:
#: ⚠️ AN ALLOW-LIST, BECAUSE A FORECAST STEP IS THE ONE THING HERE WRITTEN BY
#: SOMEBODY ELSE'S CODE. The first cut passed provider rows through whole and
#: `test_refs`' leak sweep caught an entity id riding in a `condition` — the
#: same lesson `read_ledger` and `read_schedule` already paid for: content
#: from outside is kept BY SHAPE, never by trust.
_CONDITIONS: Sequence[str] = (
    "clear-night", "cloudy", "exceptional", "fog", "hail", "lightning",
    "lightning-rainy", "partlycloudy", "pouring", "rainy", "snowy",
    "snowy-rainy", "sunny", "windy", "windy-variant",
)

#: A timestamp, loosely — enough that free text cannot pass as one.
_WHEN = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")

#: Forecast fields that must be numbers, and are dropped when they are not.
_NUMERIC: Sequence[str] = (
    "temperature", "templow", "precipitation", "precipitation_probability",
    "wind_speed", "wind_bearing",
)


def readings_of(attributes: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """The published readings of one weather entity, as value/unit rows.

    ⚠️ ABSENT IS ABSENT. An attribute Home Assistant does not publish is left
    OUT, never reported as 0 — "the wind is calm" and "this station has no
    anemometer" are different answers and the villa must not conflate them.
    """
    out: List[Dict[str, Any]] = []
    for name in _FIELDS:
        if name not in attributes:
            continue
        value = attributes.get(name)
        if value is None or isinstance(value, bool):
            continue
        unit_key = _UNITS.get(name, "")
        out.append({
            "measure": name,
            "value": value,
            "unit": str(attributes.get(unit_key) or "") if unit_key else "",
        })
    return out


def supports_forecast(attributes: Mapping[str, Any]) -> bool:
    """Whether this entity can be asked for a forecast at all.

    HA advertises it in `supported_features` as a bitmask: 1 = daily,
    2 = hourly, 4 = twice-daily. Anything non-zero means a forecast exists.

    ⚠️ ASKED BEFORE CALLING, so a station that only measures is never sent a
    service call that would fail — and so the tool can tell the reader "this
    property measures but does not forecast", which is a real distinction and
    the one the reported answer got wrong in the other direction.
    """
    try:
        return int(attributes.get("supported_features") or 0) > 0
    except (TypeError, ValueError):
        return False


async def entities(session: Any) -> List[Dict[str, Any]]:
    """Every weather entity this property has, with its current attributes."""
    rows = await rest_get(session, "states")
    out: List[Dict[str, Any]] = []
    for row in rows if isinstance(rows, Sequence) else []:
        if not isinstance(row, Mapping):
            continue
        entity_id = str(row.get("entity_id") or "")
        if not entity_id.startswith(_DOMAIN):
            continue
        attrs = row.get("attributes")
        attrs = attrs if isinstance(attrs, Mapping) else {}
        out.append({
            "entity_id": entity_id,
            "state": str(row.get("state") or ""),
            "label": str(attrs.get("friendly_name") or ""),
            "readings": readings_of(attrs),
            "forecast_capable": supports_forecast(attrs),
        })
    return out


def trim_forecast(steps: Any, limit: int = MAX_FORECAST_STEPS) -> List[Dict[str, Any]]:
    """The first few forecast steps, kept BY SHAPE.

    ⚠️ NOTHING FROM A PROVIDER TRAVELS AS-IS. A timestamp must look like one, a
    condition must be one of Home Assistant's own words, and every other field
    must be a number — so a step cannot carry an entity id, a URL or a sentence
    into the transcript whatever the integration put in it. `test_refs` feeds
    this an id and expects nothing back.
    """
    out: List[Dict[str, Any]] = []
    for step in (steps if isinstance(steps, Sequence) else [])[:limit]:
        if not isinstance(step, Mapping):
            continue
        row: Dict[str, Any] = {}
        when = str(step.get("datetime") or "")
        if _WHEN.match(when):
            row["datetime"] = when[:16]
        condition = str(step.get("condition") or "")
        if condition in _CONDITIONS:
            row["condition"] = condition
        for key in _NUMERIC:
            value = step.get(key)
            if isinstance(value, bool) or value is None:
                continue
            try:
                row[key] = float(value)
            except (TypeError, ValueError):
                continue
        if row:
            out.append(row)
    return out


async def forecast(session: Any, entity_id: str,
                   kind: str = "hourly") -> List[Dict[str, Any]]:
    """The next few forecast steps for one entity, or [] if it has none.

    ⚠️ WEBSOCKET, BECAUSE THE ANSWER COMES BACK IN THE SERVICE RESPONSE.
    `weather.get_forecasts` is a service that RETURNS data, which REST's
    service endpoint does not surface; `return_response` on the websocket call
    is the supported way to read it.

    ⚠️ NEVER RAISES INTO A CHAT TURN. A property whose forecast provider is
    down must produce an answer about the conditions it CAN measure, not an
    error — the caller reports the readings either way.
    """
    try:
        async with HassClient(session) as hass:
            result = await hass.command(
                "call_service", domain="weather", service="get_forecasts",
                service_data={"type": kind},
                target={"entity_id": [entity_id]},
                return_response=True)
    except Exception:  # noqa: BLE001 - degrade, never fail a conversation
        return []
    response = result.get("response") if isinstance(result, Mapping) else None
    entry = response.get(entity_id) if isinstance(response, Mapping) else None
    steps = entry.get("forecast") if isinstance(entry, Mapping) else None
    return trim_forecast(steps)
