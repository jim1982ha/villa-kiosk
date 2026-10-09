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


# ⚠️ NO BEHAVIOUR TABLE HERE (architecture review 7, 2026-10-07). The alert desk's and the night check's thresholds
# lived in this shared file (two of them read by nobody); each skill now keeps its own in its settings file's
# `behaviour:` section (vesta_shared.skill_settings), still overridable per villa by a vesta_<name> helper.


@dataclass
class VillaParams:
    """Wraps the helper list and current states from Home Assistant."""

    helpers: list[dict] = field(default_factory=list)
    states: dict[str, str] = field(default_factory=dict)
    # the skill's behaviour defaults (its settings file's `behaviour:`, skill_settings.behaviour)
    defaults: dict[str, float] = field(default_factory=dict)

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
        """Behavioural setting: villa helper vesta_<name> if present, else the skill's default. A value neither gives
        is named, never guessed (MissingParameter)."""
        v = self.optional_number(f"vesta_{name}")
        if v is not None:
            return v
        if name not in self.defaults:
            raise MissingParameter(f"vesta_{name}", "no helper, and no default in the skill's settings file (behaviour:)")
        return self.defaults[name]

    def with_defaults(self, defaults: dict[str, float]) -> "VillaParams":
        """The same villa, with a skill's behaviour defaults."""
        return VillaParams(self.helpers, self.states, dict(defaults))

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
        """Tariff per kWh and its currency, from input_number.electricity_tariff_kwh (its unit, "<currency>/kWh"),
        else input_text.villa_currency. Neither: MissingParameter — never a guessed currency (architecture review 13:
        it was one villa's own, written in the code)."""
        val = self.number("electricity_tariff_kwh", "tariff helper missing")
        h, _ = self._find("electricity_tariff_kwh")
        unit = (h or {}).get("unit_of_measurement", "") or ""
        currency = unit.split("/")[0].strip() if "/" in unit else self.text_or("villa_currency", "")
        if not currency:
            raise MissingParameter("villa_currency", "give the tariff the unit <currency>/kWh, or add input_text.villa_currency")
        return val, currency

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


def live_params(client, store, max_age_minutes: float = 10, now=None, defaults: dict | None = None) -> "VillaParams":
    """The villa's parameters as Home Assistant has them now, kept for `max_age_minutes` in the skill store (a script
    run every five minutes would otherwise read every helper each time). Home Assistant not answering: the last
    copy kept, else the defaults — never a crash, never a guessed value. `client`: Home Assistant's client, or a
    function that makes it (made only when the copy is too old).

    ⚠️ ONE WAY IN FOR EVERY SCRIPT (architecture review, 2026-10-07): the alert desk read them only from a test
    fixture, so in the villa its maintenance mode and the villa's own timings were never read."""
    from datetime import datetime, timedelta, timezone
    now = now or datetime.now(timezone.utc)
    kept = store.cache_get("villa_params") or {}
    try:
        fresh = kept and now - datetime.fromisoformat(kept["at"]) < timedelta(minutes=max_age_minutes)
    except (KeyError, ValueError):
        fresh = False
    if not fresh:
        try:
            helpers, states = (client() if callable(client) else client).helpers()
            kept = {"at": now.isoformat(), "helpers": helpers, "states": states}
            store.cache_put("villa_params", kept)
        except Exception:  # noqa: BLE001 — Home Assistant unreachable: the last copy, or the defaults
            pass
    return VillaParams(helpers=kept.get("helpers") or [], states=kept.get("states") or {}, defaults=dict(defaults or {}))

