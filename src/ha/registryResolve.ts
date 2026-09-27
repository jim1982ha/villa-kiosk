// src/ha/registryResolve.ts
// What Home Assistant's registries say about each entity: whether it is kept
// out of the kiosk's auto-built lists, which device it belongs to, and — by
// HA's own inheritance (entity → its device → area → floor) — its area name
// and floor number.
//
// ⚠️ ≈60 LINES INLINE IN THE STATE PROVIDER (round 10, 2.496.160), deriving
// an entity's area twice (once for the name, once for the floor) and setting
// five pieces of state, with no test; tests/oracles/storeys.mjs reached only
// resolveEntityFloor. Pure now: tests/oracles/registry_resolve.mjs.

import { resolveEntityFloor } from "@/config/EntityMap";
import type {
  HassAreaRegistryEntry, HassDeviceRegistryEntry, HassEntityRegistryEntry, HassFloorRegistryEntry,
} from "@/types/ha.types";

export interface EntityRegistryFacts {
  /** Kept out of every auto-built list, as HA's own dashboards do: hidden by
   *  the user, or filed by HA under entity_category config/diagnostic. */
  suppressed: Set<string>;
  /** Hidden by the user in HA (Settings › Entities › Visible). */
  hiddenInHa: Set<string>;
  /** entity_id → device_id, straight off the entity row — needs no other
   *  registry, so it survives a profile that cannot read devices. */
  deviceIds: Record<string, string>;
}

export function entityRegistryFacts(rows: readonly HassEntityRegistryEntry[]): EntityRegistryFacts {
  const deviceIds: Record<string, string> = {};
  for (const r of rows) if (r.device_id) deviceIds[r.entity_id] = r.device_id;
  return {
    suppressed: new Set(rows
      .filter((r) => r.hidden_by != null || r.entity_category === "config" || r.entity_category === "diagnostic")
      .map((r) => r.entity_id)),
    hiddenInHa: new Set(rows.filter((r) => r.hidden_by != null).map((r) => r.entity_id)),
    deviceIds,
  };
}

/**
 * Each entity's area NAME and floor NUMBER, by HA's inheritance: its own
 * area_id, else its device's; the area's floor (named, see
 * EntityMap.resolveEntityFloor for why the name beats HA's optional `level`).
 * Entities with neither are left out, not guessed.
 */
export function entityPlaces(
  rows: readonly HassEntityRegistryEntry[],
  devices: readonly HassDeviceRegistryEntry[],
  areas: readonly HassAreaRegistryEntry[],
  floors: readonly HassFloorRegistryEntry[],
): { areaNames: Record<string, string>; floorNumbers: Record<string, number> } {
  const deviceArea = new Map(devices.map((d) => [d.id, d.area_id]));
  const areaById = new Map(areas.map((a) => [a.area_id, a]));
  const floorById = new Map(floors.map((f) => [f.floor_id, f]));
  const areaNames: Record<string, string> = {};
  const floorNumbers: Record<string, number> = {};
  for (const r of rows) {
    const areaId = r.area_id ?? (r.device_id ? deviceArea.get(r.device_id) : null);
    const area = areaId ? areaById.get(areaId) : undefined;
    if (!area) continue;
    if (area.name) areaNames[r.entity_id] = area.name;
    const floor = area.floor_id ? floorById.get(area.floor_id) : undefined;
    if (floor) {
      const n = resolveEntityFloor(floor.name, floor.level, null);
      if (n != null) floorNumbers[r.entity_id] = n;
    }
  }
  return { areaNames, floorNumbers };
}

/** The three registries a refresh asks for — `null` for one whose request
 *  FAILED (as opposed to answering with nothing). */
export interface RegistryAnswers {
  devices: readonly HassDeviceRegistryEntry[] | null;
  areas: readonly HassAreaRegistryEntry[] | null;
  floors: readonly HassFloorRegistryEntry[] | null;
}

/**
 * The area names and floor numbers to hold AFTER a refresh: a derived map is
 * replaced only when every registry it derives from answered; otherwise the
 * previous one is kept. Area names need devices + areas; floor numbers need
 * floors as well.
 *
 * ⚠️ THE GUARD USED TO BE `devices.length === 0 && areas.length === 0`
 * (2.496.194). Each fetch was "best effort" (`.catch(() => [])`), so one
 * transient failure of the AREA registry alone — devices fine — passed the
 * guard and re-derived every place from an empty area map: every room name
 * and floor number in the villa blank until the next registry event
 * happened to succeed. The pure resolver (entityPlaces) was under test; the
 * wiring that fed it was not.
 */
export function placesAfterRefresh(
  prev: { areaNames: Record<string, string>; floorNumbers: Record<string, number> },
  rows: readonly HassEntityRegistryEntry[],
  got: RegistryAnswers,
): { areaNames: Record<string, string>; floorNumbers: Record<string, number> } {
  if (got.devices === null || got.areas === null) return prev;
  const next = entityPlaces(rows, got.devices, got.areas, got.floors ?? []);
  return { areaNames: next.areaNames, floorNumbers: got.floors === null ? prev.floorNumbers : next.floorNumbers };
}
