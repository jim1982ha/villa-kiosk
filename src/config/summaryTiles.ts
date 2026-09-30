// src/config/summaryTiles.ts
// The bottom bar's tiles — which ones a profile gets, what each says, its
// tone, what a tap opens — as a plain module the Node oracles can call
// (2.496.232). It lived inside SummaryBar.tsx, where four oracles could only
// match its source text; the bar now only draws what this returns.

import type { ComponentType } from "react";
import { Snowflake, Zap, CloudSun } from "lucide-react";
import type { Threshold } from "./ThresholdConfig";
import { locksGroup, lightsGroup } from "./summaryGroups";
import { villaSummary, fmtClimateTemp } from "./villaSummary";
import { formatUnitValue, formatSensorParts } from "@/utils/entityValue";
import type { WeatherStation } from "./weatherStation";
import { onOffSummary } from "@/utils/entityState";
import type { HassEntity } from "@/types/ha.types";
import type { Category, EntityMapping } from "@/types/scene.types";

type IconType = ComponentType<{ size?: number | string }>;

export type TileKind = "locks" | "weather" | "lights" | "climate" | "energy";

/** One rendered tile. Clicking it opens a SummaryGroupPanel listing (and
 *  controlling) the `entityIds` it represents. `value`/`tone` are the at-a-
 *  glance summary; `title`/`icon` head the modal; `canControl` gates the
 *  modal's inline controls for the active profile. */
export interface SummaryTile {
  id: string;
  /** What a tap opens: the Weather window, the Energy window, or (every
   *  other kind) the group list of `entityIds`. Was three string compares
   *  on hidden ids ("__weather", "__energy") in the bar. */
  kind: TileKind;
  icon: IconType;
  label: string;
  value: string;
  tone: "on" | "off" | "warn" | "neutral";
  category: Category;
  entityIds: string[];
  title: string;
  canControl: boolean;
}

/** Build the ordered tile list from the live entity snapshot. Pure (no side
 *  effects) so it's cheap to recompute on every state push via useMemo. */
export function deriveTiles(
  entities: Record<string, HassEntity>,
  entityMap: Record<string, EntityMapping>,
  resolvedRooms: Record<string, string>,
  can: (c: Category) => boolean,
  thresholds: Record<string, Threshold>,
  /** HA's device registry (entity_id → device_id) — how the weather station's
   *  sensors are grouped into one station. */
  /** The villa's weather station, found ONCE by the caller (it is O(entities
   *  × devices) and used to be searched twice per render). */
  station: WeatherStation | null,
  /** The villa's own devices. ⚠️ THREADED THROUGH RATHER THAN RECOMPUTED: the
   *  tile counts and the list a tap opens must come from one set, or the tile
   *  says "3 On" and the panel shows four rows. Only `.has` is called. */
  allowed?: { has(entityId: string): boolean },
  /** Home Assistant's temperature unit ("°C", "°F"), when known. */
  tempUnit?: string,
): SummaryTile[] {
  const tiles: SummaryTile[] = [];
  // The FACTS are villaSummary's — shared with the readiness report, so the
  // tile and the report can no longer disagree about the same door. This
  // function only chooses the words, the tone and what a tap opens.
  const facts = villaSummary({
    entities, devices: allowed ?? { has: () => true }, resolvedRooms, thresholds,
  });

  // ── Door locks ───────────────────────────────────────────────────────
  // `lock.*` entities only — see locksGroup's own docstring for why this
  // isn't extended to switches that merely LOOK like a door/gate relay by
  // name (tried once, matched every "outdoor" light switch in the villa via
  // an unanchored "door" substring — reverted). Shared with the Facility
  // Readiness tab's "View doors" shortcut (see summaryGroups.ts) so both
  // open the identical group, not two independently-derived lists.
  const locksG = locksGroup(facts.locks, entities, entityMap);
  if (locksG && facts.locks) {
    const f = facts.locks;
    const locks = f.ids.map((id) => entities[id]).filter((e): e is HassEntity => !!e);
    const unlockedN = f.unlocked.length;
    const allLocked = f.locked.length === f.ids.length;
    const single = f.ids.length === 1;
    tiles.push({
      id: "__locks", kind: "locks",
      icon: locksG.icon,
      // Short + generic on purpose, even for a single lock: the tile's real
      // constraint is horizontal space in the bar, and "Outdoor Entrance
      // Lock" (the lock's own HA friendly_name) was one of the widest tiles
      // in it. "Door Lock" also reads sensibly once a second lock exists (the
      // tile already becomes the even-more-generic "Locks" at that point —
      // see the `single` branch below). The MODAL this tile opens still uses
      // the real per-device name (title, further down) — it has the room.
      label: single ? "Door Lock" : "Locks",
      // Reads as a STATE, not as a score. "2/2 locked" makes you do the
      // arithmetic before you know whether anything is wrong, and the one
      // number that matters — how many are open — is the one it never prints.
      // "Locked" needs no reading at all, and "1 Unlocked" names the problem
      // and its size in fewer characters than the fraction used — which is the
      // point: the bar's real constraint is horizontal space, so the all-good
      // case says the same word the single-lock tile says and no more.
      // Same shape as the single-lock branch above and the light tile's "2 On".
      value: single
        ? (locks[0].state === "locked" ? "Locked" : locks[0].state === "unlocked" ? "Unlocked" : locks[0].state)
        : allLocked ? "Locked"
          : unlockedN > 0 ? `${unlockedN} Unlocked`
            // Not all locked, yet none actually UNLOCKED: every remainder is
            // unavailable or jammed. Counting those as unlocked would be a
            // plain lie about a door, on the tile whose whole job is to be
            // trusted at a glance — so they are reported as what they are.
            : `${f.unknown.length} Unknown`,
      tone: allLocked ? "neutral" : "warn",
      category: "access_control",
      entityIds: locksG.entityIds,
      title: locksG.title,
      canControl: can("access_control"),
    });
  }

  // ── Weather (the villa's own station) ────────────────────────────────
  // Replaced the Pool tile, which counted pool switches the map already
  // shows. What the station IS is config/weatherStation.ts's — found by what
  // only a weather station reports, never by a name — and the tile opens the
  // Weather modal rather than a group list. Read-only: nothing to control.
  if (station?.roles.temperature) {
    const t = entities[station.roles.temperature];
    const p = t ? formatSensorParts(t) : { value: "", unit: "" };
    tiles.push({
      id: "__weather", kind: "weather", icon: CloudSun, label: "Weather",
      value: p.value ? `${p.value}${p.unit}` : "—",
      tone: "neutral", category: "comfort",
      entityIds: station.entityIds, title: "Weather", canControl: false,
    });
  }

  // ── All lights ───────────────────────────────────────────────────────
  // Shared with the Facility Readiness tab's "View lights" shortcut (see
  // summaryGroups.ts) so both open the identical full list of lights, not
  // just the ones a readiness check happens to flag as still lit.
  const lightsG = lightsGroup(facts.lights);
  if (lightsG && facts.lights) {
    const n = facts.lights.on.length;
    tiles.push({
      id: "__lights", kind: "lights", icon: lightsG.icon, label: "Lights",
      value: onOffSummary(n, facts.lights.ids.length),
      tone: n > 0 ? "on" : "off", category: "light",
      entityIds: lightsG.entityIds, title: lightsG.title, canControl: can("light"),
    });
  }

  // ── Climate ("AC") ───────────────────────────────────────────────────
  // ⚠️ SCOPED TO THE VILLA'S DEVICES since 2.496.63, as the readiness report
  // already was — a dismissed or foreign AC unit is not this villa's. The
  // temperature is the mean CURRENT reading of running units, never a
  // setpoint (see villaSummary.climateFacts for why).
  if (facts.climate) {
    const f = facts.climate;
    const active = f.active;
    const avg = f.avgCurrentTemp;
    tiles.push({
      id: "__climate", kind: "climate", icon: Snowflake, label: "AC",
      // Average CURRENT temperature is the more useful glance value while
      // anything is running and actually reporting one; otherwise defer to
      // the shared phrasing so "All Off" here matches "All Off" on the Lights
      // tile beside it (and "3 On" with no reading reads the same way too).
      // In Home Assistant's own unit (its unit_system) — the readings are in
      // it; this said "°C" on every install, a °F one included.
      value: active.length && avg !== null
        ? fmtClimateTemp(avg, tempUnit)
        : onOffSummary(active.length, f.ids.length),
      tone: active.length ? "on" : "off", category: "comfort",
      entityIds: f.ids, title: "Climate", canControl: can("comfort"),
    });
  }

  // ── Energy → total instantaneous power across power sensors (read-only) ─
  // ⚠️ BY CLASS, NOT BY A REGEX OVER THE UNIT. The old predicate was
  // `/(^|_)w$|watt/i` — an entity-id-shaped pattern applied to a unit string,
  // so it matched "W" and could not match "kW" — OR'd with a device_class test
  // that DID admit kilowatts. `SensorClasses` has mapped "kw" → "power" all
  // along, three files away; this now asks it.
  // Every power sensor, not only the villa's devices — a plug's or a pump's
  // power sensor is a FOLDED member, not a device (see villaSummary's header).
  // Only for a profile that may see the energy category — the tile opens the
  // Energy window, and the guest profile excludes energy (2.496.210).
  if (facts.power && can("energy")) {
    const totalW = facts.power.totalW;
    tiles.push({
      id: "__energy", kind: "energy", icon: Zap, label: "Energy",
      // ⚠️ ASKED, NOT RESTATED. This was a third copy of the ≥1000 → kW rule,
      // alongside the badge's and (by omission) the panel's. `formatUnitValue`
      // also drops a trailing zero, so 3000 W now reads "3 kW" rather than
      // "3.0 kW" — the same spelling the badge has always used.
      value: formatUnitValue(totalW, "W"),
      // A HARDCODED `totalW > 3000` used to live here, and it was exactly the
      // per-site tuning constant CLAUDE.md's first hard rule forbids: 3 kW is
      // an idle afternoon in a villa with a pool pump and an alarming spike in
      // a small apartment. It was right for the machine it was written on and
      // wrong everywhere else — a tile permanently red on one install and
      // never lit on another.
      //
      // The tile now inherits the alert state of its own members, the way the
      // Locks tile already does: it warns if any contributing power sensor is
      // over the threshold configured FOR THAT SENSOR (config.alertThresholds,
      // which ships empty — see ThresholdConfig). With none configured it stays
      // informational, which is the honest default: the app has no basis for
      // calling any wattage high in a villa it has never seen.
      tone: facts.power.alert ? "warn" : "neutral",
      category: "energy",
      entityIds: facts.power.ids, title: "Energy", canControl: false,
    });
  }

  return tiles;
}
