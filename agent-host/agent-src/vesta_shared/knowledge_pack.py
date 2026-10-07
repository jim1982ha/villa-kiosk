"""Knowledge pack: what the villa is, generated, never hand-written.

Input: the Home Assistant registry (or a states dump with areas), the helpers,
and optionally the BOM rows. Output: a JSON document the skills read.

The central idea (plan v2.1, sections 5.5 and 5.6): the skills carry rules
per FAMILY OF MEASUREMENT, and the pack tells them which entities belong to
which family. Adding a clamp on a bedroom AC or a pulse water meter changes
the pack, not a SKILL.md.

Families
  power        W, device_class power, state_class measurement
  energy       kWh, device_class energy, total_increasing
  runtime      switch/fan/light with a power sibling or an expected_runtime schedule
  battery      device_class battery (%) or a battery voltage sensor
  level        temperature, humidity, pressure, water level, flow, rain
  water        m3 / L, device_class water (ready, activates when a sensor appears)
  generation   energy or power whose asset name says solar, pv, inverter, battery_soc
  security     lock, moisture, smoke, opening, motion, occupancy, siren, camera
  network      device_tracker, connectivity, access points, NVR
  system       todo lists, helpers, agent internals (not monitored)

An "asset" is the physical thing behind several entities: sensor.example_pump_power,
sensor.example_pump_energy and counter.example_pump_runtime_hours all point to the
asset "example_pump". The asset slug is what the parameter helpers use
(input_number.example_pump_rated_power_w).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from typing import Any

SUFFIXES = [
    "_power_factor", "_apparent_power", "_reactive_power", "_energy_returned", "_energy_consumed",
    "_cycling_count_1h", "_runtime_hours", "_expected_runtime", "_last_confirmed_run", "_power_baseline",
    "_battery_voltage", "_battery_type", "_battery_level", "_battery_state", "_battery",
    "_power", "_energy", "_current", "_voltage", "_frequency", "_temperature", "_humidity",
    "_moisture", "_smoke", "_opening", "_occupancy", "_motion", "_rx", "_tx", "_rain_rate",
]

GENERATION_WORDS = ("solar", "_pv", "pv_", "inverter", "battery_soc", "state_of_charge", "grid_export", "export")
# ⚠️ BY INTEGRATION, NEVER BY ONE VILLA'S NAMES (architecture review, 2026-10-07): a prefix list here named one
# villa's phones and one person by name — against the repository's first rule, and
# useless anywhere else. A person's phone or tablet is whatever Home Assistant's mobile app integration created;
# network gear is whatever a router or access-point integration created.
PERSONAL_PLATFORMS = ("mobile_app",)
NETWORK_PLATFORMS = ("unifi", "fritz", "tplink_omada", "netgear", "asuswrt", "openwrt", "luci", "ubus", "mikrotik",
                     "keenetic_ndms2", "nmap_tracker")


def asset_slug(entity_id: str) -> str:
    obj = entity_id.split(".", 1)[1]
    for s in SUFFIXES:
        if obj.endswith(s):
            return obj[: -len(s)]
    return obj


MOTOR_WORDS = ("pump", "compressor", "fan", "hvac", "aircon", "air_con", "_ac_", "ac_", "motor", "jet", "blower", "chiller")
LIGHT_WORDS = ("light", "led", "lamp", "vmc", "lighting", "spot")
METER_WORDS = ("main_power", "phase_", "_mean", "total", "grid", "meter", "consumption")


def asset_kind(a, overrides: dict[str, str] | None = None) -> str:
    """motor: pumps, fans, compressors (physics rules apply). lighting: light circuits (ROI only).
    meter: the main meter, its phases, template aggregates (ROI only). appliance: anything else."""
    if overrides and a.slug in overrides:
        return str(overrides[a.slug])
    text = f"{a.slug} {a.name}".lower()
    if any(w in text for w in METER_WORDS):
        return "meter"
    if a.schedule or a.counter or a.baseline_helper:
        return "motor"
    if any(w in text for w in MOTOR_WORDS):
        return "motor"
    if any(w in text for w in LIGHT_WORDS):
        return "lighting"
    return "appliance"


def family_of(e: dict) -> str | None:
    """Decide the family from unit, device_class, state_class and domain."""
    eid = e["entity_id"]
    domain, obj = eid.split(".", 1)
    unit = (e.get("unit_of_measurement") or "").strip()
    dc = e.get("device_class") or ""
    sc = e.get("state_class") or ""
    lname = (e.get("name") or obj).lower()

    platform = e.get("platform") or ""
    if platform in PERSONAL_PLATFORMS:
        return None  # a person's phone or tablet is not a villa asset
    if platform in NETWORK_PLATFORMS:
        return "network"
    if domain in ("todo", "input_number", "input_text", "input_boolean", "input_select",
                  "input_datetime", "counter", "schedule", "person", "zone", "automation", "script",
                  "button", "update", "image", "number", "select", "text"):
        return "system"
    if domain == "device_tracker" or dc == "connectivity":
        return "network"
    if any(w in obj or w in lname for w in GENERATION_WORDS) and (dc in ("power", "energy") or unit in ("W", "kWh", "%")):
        return "generation"
    if dc == "water" or unit in ("m³", "m3", "L", "gal") or dc == "volume_flow_rate" or unit in ("m³/h", "L/min"):
        return "water"
    if dc == "power" and unit == "W":
        return "power"
    if dc == "energy" and unit == "kWh" and sc in ("total_increasing", "total"):
        return "energy"
    if dc == "battery" and unit == "%":
        return "battery"
    if obj.endswith("_battery") and dc == "voltage":
        return "battery"
    if dc in ("temperature", "humidity", "pressure", "precipitation_intensity", "precipitation", "illuminance",
              "atmospheric_pressure", "wind_speed") or unit in ("°C", "%", "hPa", "mm/h", "lx"):
        return "level"
    if domain == "lock" or dc in ("moisture", "smoke", "gas", "carbon_monoxide", "opening", "door", "window",
                                  "motion", "occupancy", "vibration", "tamper", "sound", "camera") or "siren" in obj:
        return "security"
    if domain == "camera":
        return "security"
    if domain in ("switch", "fan", "light", "climate", "cover", "valve"):
        return "runtime"
    if domain in ("sensor", "binary_sensor") and dc in ("apparent_power", "power_factor", "current", "voltage",
                                                          "frequency", "reactive_power", "data_rate", "data_size"):
        return "electrical_aux"
    return None


@dataclass
class Asset:
    slug: str
    name: str
    area: str | None
    entities: dict[str, str] = field(default_factory=dict)   # family/role -> entity_id
    schedule: str | None = None                                # schedule.<slug>_expected_runtime
    baseline_helper: str | None = None
    counter: str | None = None
    parameters: dict[str, Any] = field(default_factory=dict)  # from helpers <slug>_<param>
    bom: dict | None = None
    critical: bool = False
    kind: str = "appliance"   # motor | lighting | meter | appliance: decides which maintenance rules apply


@dataclass
class KnowledgePack:
    villa: str
    time_zone: str
    generated_at: str
    ha_version: str | None
    families: dict[str, list[dict]]
    assets: dict[str, dict]
    areas: list[str]
    people: list[dict]
    channels: dict[str, str]
    unknown_area: list[str]
    unclassified: list[str]
    retention: dict
    # Each area's other names in Home Assistant ("Cuisine" for Kitchen): a person may say either.
    area_aliases: dict[str, list[str]] = field(default_factory=dict)

    def entities(self, family: str) -> list[dict]:
        return self.families.get(family, [])

    def asset(self, slug: str) -> dict | None:
        return self.assets.get(slug)

    def rows(self) -> list[dict]:
        """Every entity row of every family (id, name, area, device…): the one walk over the pack that the
        engine and the VESTA Agent page each wrote by hand (0.6.42)."""
        return [r for rows in self.families.values() for r in rows if isinstance(r, dict) and r.get("entity_id")]

    def row(self, entity_id: str) -> dict | None:
        """An entity's row (the first one that names it, else the first one).

        ⚠️ ONE LOOKUP BY ENTITY (architecture review 5, 2026-10-07): the engine, facts.py and compose.py each walked
        every family by hand to find an entity's name or device — six walks, three rules about which row counts."""
        idx = self.__dict__.get("_by_entity")
        if idx is None:
            idx = {}
            for r in self.rows():
                cur = idx.get(r["entity_id"])
                if cur is None or (not cur.get("name") and r.get("name")):
                    idx[r["entity_id"]] = r
            self.__dict__["_by_entity"] = idx
        return idx.get(entity_id)

    def name_of(self, entity_id: str, default: str | None = None) -> str | None:
        """An entity's name as the pack has it; `default` when the pack does not name it."""
        return (self.row(entity_id) or {}).get("name") or default

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=1, ensure_ascii=False)

    @classmethod
    def load(cls, path: str) -> "KnowledgePack":
        d = json.load(open(path, encoding="utf-8"))
        return cls(**d)

    @classmethod
    def read(cls, path: str) -> "KnowledgePack | None":
        """The pack, or None when it is not built yet or cannot be read (the callers show what they can)."""
        try:
            return cls.load(path)
        except (OSError, ValueError, TypeError):
            return None


def _norm_entities(registry: dict, states: dict | None) -> list[dict]:
    """Registry rows can come from the WebSocket registry (original_device_class,
    unit inside 'options' or 'capabilities') or from a states dump. Normalise."""
    rows = []
    for e in registry.get("entities", []):
        eid = e["entity_id"]
        st = (states or {}).get(eid, {})
        attrs = st.get("attributes", {}) if st else {}
        rows.append({
            "entity_id": eid,
            "name": e.get("name") or e.get("original_name") or attrs.get("friendly_name") or eid,
            "area": e.get("area") or e.get("area_id"),
            "unit_of_measurement": e.get("unit_of_measurement") or attrs.get("unit_of_measurement"),
            "device_class": e.get("device_class") or e.get("original_device_class") or attrs.get("device_class"),
            "state_class": e.get("state_class") or (e.get("capabilities") or {}).get("state_class") or attrs.get("state_class"),
            "platform": e.get("platform"),
            "device_id": e.get("device_id"),
            "state": e.get("state", st.get("state") if st else None),
            "disabled": bool(e.get("disabled_by")),
        })
    return rows


def build_pack(registry: dict, helpers: list[dict], states: dict | None = None,
               bom_rows: list[dict] | None = None, people: list[dict] | None = None,
               channels: dict | None = None, generated_at: str = "", villa: str | None = None) -> KnowledgePack:
    cfg = registry.get("config", {})
    ents = [e for e in _norm_entities(registry, states) if not e["disabled"]]
    area_names = {a.get("area_id"): a.get("name") for a in registry.get("areas", [])}
    families: dict[str, list[dict]] = {}
    unclassified: list[str] = []
    assets: dict[str, Asset] = {}
    helper_by_obj = {h.get("entity_id", "").split(".", 1)[-1]: h for h in helpers}
    schedules = {h["entity_id"]: h for h in helpers if h.get("helper_type") == "schedule"}
    bom_by_slug = {}
    for r in bom_rows or []:
        for key in (r.get("asset"), r.get("slug"), r.get("ha_entity")):
            if key:
                bom_by_slug[str(key).lower()] = r

    for e in ents:
        fam = family_of(e)
        if fam is None:
            unclassified.append(e["entity_id"])
            continue
        area = area_names.get(e["area"], e["area"]) if e["area"] else None
        row = {"entity_id": e["entity_id"], "name": e["name"], "area": area, "unit": e["unit_of_measurement"],
               "device_class": e["device_class"], "family": fam, "asset": asset_slug(e["entity_id"]),
               "platform": e.get("platform"), "device_id": e.get("device_id")}
        families.setdefault(fam, []).append(row)
        if fam in ("system", "network", "electrical_aux"):
            continue
        slug = row["asset"]
        a = assets.get(slug) or Asset(slug=slug, name=re.sub(r"\s+(power|energy)$", "", e["name"], flags=re.I), area=area)
        role = fam if fam not in a.entities else f"{fam}_{len(a.entities)}"
        if fam == "security" and e["entity_id"].startswith("lock."):
            role = "lock"
        a.entities[role] = e["entity_id"]
        a.area = a.area or area
        assets[slug] = a

    # merge assets whose slug is a longer spelling of another one
    # (sensor.garden_spa_blower_pump_energy belongs to blower_pump, an invented example),
    # plus explicit aliases from input_text.vesta_asset_aliases = {"long": "short"}
    kind_overrides: dict[str, str] = {}
    kh = helper_by_obj.get("vesta_asset_kinds")
    if kh and isinstance(kh.get("state"), str):
        try:
            kind_overrides = json.loads(kh["state"])
        except json.JSONDecodeError:
            kind_overrides = {}
    aliases: dict[str, str] = {}
    ah = helper_by_obj.get("vesta_asset_aliases")
    if ah and isinstance(ah.get("state"), str):
        try:
            aliases = json.loads(ah["state"])
        except json.JSONDecodeError:
            aliases = {}
    for long_slug in list(assets):
        target = aliases.get(long_slug) or next((s for s in assets if s != long_slug and long_slug.endswith("_" + s)), None)
        if target and target in assets:
            src, dst = assets.pop(long_slug), assets[target]
            for role, eid in src.entities.items():
                dst.entities[role if role not in dst.entities else f"{role}_{len(dst.entities)}"] = eid
            dst.area = dst.area or src.area
            for fam_rows in families.values():
                for r in fam_rows:
                    if r["asset"] == long_slug:
                        r["asset"] = target

    # attach helpers, schedules, counters and parameters to assets
    for slug, a in assets.items():
        sch = f"schedule.{slug}_expected_runtime"
        if sch in schedules:
            a.schedule = sch
        if f"{slug}_power_baseline" in helper_by_obj:
            a.baseline_helper = f"input_number.{slug}_power_baseline"
        if f"{slug}_runtime_hours" in helper_by_obj:
            a.counter = f"counter.{slug}_runtime_hours"
        prefix = slug + "_"
        for obj, h in helper_by_obj.items():
            if obj.startswith(prefix) and h.get("helper_type") in ("input_number", "input_text", "input_select") \
                    and not obj.endswith(("_power_baseline", "_expected_runtime", "_last_confirmed_run", "_runtime_hours")):
                a.parameters[obj[len(prefix):]] = h.get("entity_id")
        a.bom = bom_by_slug.get(slug) or bom_by_slug.get(a.name.lower())
        # kind: what the asset physically is, from its helpers first (a schedule, a runtime counter or a power
        # baseline mark a motor), then its name. input_text.vesta_asset_kinds = {"slug": "motor"} overrides.
        a.kind = asset_kind(a, kind_overrides)
        # critical: locks and security devices, motors, scheduled assets. Lighting circuits and meters are ROI
        # material, never maintenance findings (the villa's light circuits carry power meters too).
        a.critical = (any(k in a.entities for k in ("lock", "security"))
                      or a.kind == "motor"
                      or a.schedule is not None)

    # people: from HA persons plus an optional table (roles, chats, language)
    ppl = []
    for h in helpers:
        if h.get("helper_type") == "person":
            ppl.append({"entity_id": h.get("entity_id"), "name": h.get("name"), "role": None, "language": None, "chat": None})
    for p in people or []:
        match = next((x for x in ppl if x["name"] and p.get("name") and x["name"].lower() == p["name"].lower()), None)
        if match:
            match.update({k: v for k, v in p.items() if v is not None})
        else:
            ppl.append(dict({"entity_id": None, "name": None, "role": None, "language": None, "chat": None}, **p))

    unknown_area = sorted({r["entity_id"] for fam in ("power", "energy", "runtime", "battery", "level", "water", "security")
                           for r in families.get(fam, []) if not r["area"]})
    retention = {"raw_history_days": 10, "logbook_days": 10, "statistics": "permanent",
                 "agent_feature_store_months": 24, "photos_days": 30}
    return KnowledgePack(
        villa=villa or cfg.get("location_name") or "villa",
        time_zone=cfg.get("time_zone") or "UTC",
        generated_at=generated_at,
        ha_version=cfg.get("version"),
        families=families,
        assets={s: asdict(a) for s, a in assets.items()},
        areas=sorted({v for v in area_names.values() if v} or {r["area"] for f in families.values() for r in f if r["area"]}),
        people=ppl,
        channels=channels or {},
        unknown_area=unknown_area,
        unclassified=unclassified,
        retention=retention,
        area_aliases={a.get("name"): [x for x in (a.get("aliases") or []) if x]
                      for a in registry.get("areas", []) if a.get("name") and a.get("aliases")},
    )


def pack_diff_summary(new: list[dict], gone: list[dict]) -> str:
    lines = []
    for e in new:
        where = e.get("area") or "room unknown"
        lines.append(f"New device seen: {e.get('name', e['entity_id'])} ({e.get('family')}, {where}).")
    for e in gone:
        lines.append(f"Device no longer in Home Assistant: {e['entity_id']}. Archive its history? (reply archive / keep)")
    return "\n".join(lines)
