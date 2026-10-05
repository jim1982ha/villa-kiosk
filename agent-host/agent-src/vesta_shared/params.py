"""Villa parameters read from Home Assistant helpers by naming convention.

Convention: <asset>_<parameter> as the object id of an input_number,
input_text, input_select or input_boolean helper, for example
input_number.pool_volume_m3 or input_text.pool_pump_model.

A missing parameter raises MissingParameter. The skills catch it and answer
"cannot compute, helper X is missing" rather than inventing a value. The
only defaults allowed are behavioural (how many days to confirm a drift),
never physical (a volume, a flow, a power).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


class MissingParameter(Exception):
    def __init__(self, name: str, hint: str = ""):
        self.name = name
        self.hint = hint
        super().__init__(f"missing villa parameter '{name}'" + (f": {hint}" if hint else ""))


# Behavioural defaults. These shape how the rules confirm a finding; they
# carry no physical meaning and can be overridden per villa with a helper of
# the same name (input_number.vesta_<name>).
BEHAVIOUR_DEFAULTS: dict[str, float] = {
    "baseline_days": 30,          # window for the rolling median
    "confirm_days": 2,            # consecutive days before a finding is raised
    "drift_pct": 8,               # relative change of running power that counts
    "energy_drop_pct": 60,        # daily kWh collapse versus baseline
    "energy_rise_pct": 60,        # daily kWh jump versus baseline
    "schedule_dev_pct": 25,       # run hours versus expected schedule
    "sag_pct": 5,                 # within-run power sag over one run
    "min_run_hours_for_baseline": 1.0,
    "min_days_for_baseline": 7,
    "battery_warn_pct": 20,
    "battery_crit_pct": 10,
    "silence_hours": 24,          # a sensor that has not reported for this long
    "mute_days": 30,
    "alert_fatigue_per_month": 20,
    "reask_minutes": 15,
    "escalate_minutes": 45,
    "heartbeat_minutes": 10,
    "villa_silent_minutes": 30,
    "agent_deadman_hours": 36,
    "unavailable_minutes": 10,
    "on_threshold_fraction": 0.2,  # fraction of running power that counts as "on"
}


@dataclass
class VillaParams:
    """Wraps the helper list and current states from Home Assistant."""

    helpers: list[dict] = field(default_factory=list)
    states: dict[str, str] = field(default_factory=dict)

    # -- lookup ---------------------------------------------------------
    def _find(self, object_id: str) -> tuple[dict | None, str | None]:
        for h in self.helpers:
            eid = h.get("entity_id", "")
            if eid.split(".", 1)[-1] == object_id:
                return h, self.states.get(eid)
        # a state may exist without a helper record (YAML defined)
        for eid, st in self.states.items():
            if eid.split(".", 1)[-1] == object_id:
                return {"entity_id": eid}, st
        return None, None

    def has(self, object_id: str) -> bool:
        h, _ = self._find(object_id)
        return h is not None

    def number(self, object_id: str, hint: str = "") -> float:
        h, st = self._find(object_id)
        if h is None or st in (None, "", "unknown", "unavailable"):
            raise MissingParameter(object_id, hint or "create the helper in Home Assistant")
        try:
            return float(st)
        except ValueError:
            raise MissingParameter(object_id, f"value '{st}' is not a number")

    def text(self, object_id: str, hint: str = "") -> str:
        h, st = self._find(object_id)
        if h is None or st in (None, "", "unknown", "unavailable"):
            raise MissingParameter(object_id, hint or "create the helper in Home Assistant")
        return str(st)

    def json(self, object_id: str, hint: str = "") -> Any:
        raw = self.text(object_id, hint)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            raise MissingParameter(object_id, "value is not valid JSON")

    def boolean(self, object_id: str, default: bool | None = None) -> bool:
        h, st = self._find(object_id)
        if h is None or st is None:
            if default is None:
                raise MissingParameter(object_id)
            return default
        return str(st).lower() in ("on", "true", "1", "yes")

    def optional_number(self, object_id: str) -> float | None:
        try:
            return self.number(object_id)
        except MissingParameter:
            return None

    def behaviour(self, name: str) -> float:
        """Behavioural setting: villa helper vesta_<name> if present, else default."""
        v = self.optional_number(f"vesta_{name}")
        if v is not None:
            return v
        if name not in BEHAVIOUR_DEFAULTS:
            raise KeyError(name)
        return BEHAVIOUR_DEFAULTS[name]

    def asset_number(self, asset: str, parameter: str, hint: str = "") -> float:
        return self.number(f"{asset}_{parameter}", hint)

    def asset_optional_number(self, asset: str, parameter: str) -> float | None:
        return self.optional_number(f"{asset}_{parameter}")

    def schedule(self, object_id: str) -> dict | None:
        h, _ = self._find(object_id)
        if h and h.get("helper_type") == "schedule":
            return h
        return None

    def schedules(self) -> list[dict]:
        return [h for h in self.helpers if h.get("helper_type") == "schedule"]

    def persons(self) -> list[dict]:
        return [h for h in self.helpers if h.get("helper_type") == "person"]

    def tariff(self) -> tuple[float, str]:
        """Tariff per kWh and its currency, from input_number.electricity_tariff_kwh."""
        val = self.number("electricity_tariff_kwh", "tariff helper missing")
        h, _ = self._find("electricity_tariff_kwh")
        unit = (h or {}).get("unit_of_measurement", "") or ""
        currency = unit.split("/")[0] if "/" in unit else self.text_or("villa_currency", "IDR")
        return val, currency

    def behaviour_text_default(self, name: str, default):
        """Behavioural default with a villa override vesta_<name>; used for counts and windows."""
        v = self.optional_number(f"vesta_{name}")
        return v if v is not None else default

    def text_or(self, object_id: str, default: str) -> str:
        try:
            return self.text(object_id)
        except MissingParameter:
            return default

    @classmethod
    def from_fixture(cls, path: str) -> "VillaParams":
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return cls(helpers=d.get("helpers", []), states=d.get("states", {}))
