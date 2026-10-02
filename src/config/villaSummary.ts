// src/config/villaSummary.ts
// The facts behind "the villa at a glance": per domain, which devices are in
// which state. The summary bar's tiles and the Facility readiness report both
// read these, so they can no longer disagree about the same door.
//
// ⚠️ THEY DID DISAGREE. An unavailable or jammed lock read "1 Unknown" on the
// summary tile — whose own comment calls counting it as unlocked "a plain lie
// about a door" — and "1 not locked" in the owner's readiness report, which
// used `state !== "locked"`. Both are true of the lock; only one is the fact.
// The tile rules also lived inside SummaryBar.tsx, where no test can import
// them (a 1000x kW error sat there for releases — 28a3144a).
//
// ⚠️ SCOPE IS A PER-DOMAIN RULE, AND "THE VILLA'S DEVICES" IS NOT ALWAYS IT.
// Locks, lights and AC count only the villa's own devices (villaDevices): a
// helper, a neighbouring integration or a dismissed entity is not one of this
// villa's doors. POWER SENSORS count every entity, on
// purpose — the villa device set is FOLDED (a multi-entity device appears once,
// under its primary), so a plug's or a pump's power sensor is usually a member,
// not a device, and scoping by it would silently drop real draw from the
// Energy total.

import type { HassEntity } from "@/types/ha.types";
// POWER, by name: "N on" counts a device switched on (deviceActivity owns both
// meanings of "on"; a lights/AC tile counts this one).
import { isSwitchedOn } from "@/utils/deviceActivity";
import { isUnavailable } from "@/utils/stateColors";
import { effectiveSensorClass, toBaseUnit } from "./SensorClasses";
import { levelForValue, type Threshold } from "./ThresholdConfig";

/** Only `.has` is called — villaDevices(...) satisfies it, and so does a Set. */
export type Allowed = { has(entityId: string): boolean };

export interface LockFacts {
  ids: string[];
  locked: string[];
  unlocked: string[];
  /** Neither locked nor unlocked: unavailable, jammed, unknown, locking… —
   *  never counted as unlocked, because that is a claim about a door. */
  unknown: string[];
}
export interface OnOffFacts { ids: string[]; on: string[] }
export interface ClimateFacts {
  ids: string[];
  /** Running (not off, not unavailable). */
  active: string[];
  /** Not responding at all. */
  unreachable: string[];
  /** Mean CURRENT temperature of the running units — never a setpoint: two
   *  units aimed at 26° and 18° do not average to a 22° that means anything. */
  avgCurrentTemp: number | null;
}
export interface PowerFacts {
  ids: string[];
  /** Total draw, normalised to watts BEFORE summing (a 3.2 kW mains meter
   *  once contributed 3.2). A member whose unit cannot be scaled adds 0. */
  totalW: number;
  /** Any member over the threshold configured FOR IT (none ship). */
  alert: boolean;
}
export interface VillaSummary {
  locks: LockFacts | null;
  lights: OnOffFacts | null;
  climate: ClimateFacts | null;
  power: PowerFacts | null;
}

/** Every entity, by domain — ONE pass over the store. The four fact
 *  functions each scanned every entity for their own domain (2.496.197). */
export type DomainIndex = ReadonlyMap<string, readonly HassEntity[]>;
export function domainIndex(entities: Record<string, HassEntity>): DomainIndex {
  const out = new Map<string, HassEntity[]>();
  for (const e of Object.values(entities)) {
    const d = e.entity_id.slice(0, e.entity_id.indexOf("."));
    const list = out.get(d);
    if (list) list.push(e); else out.set(d, [e]);
  }
  return out;
}
const ofDomain = (entities: Record<string, HassEntity>, d: string, allowed?: Allowed, index?: DomainIndex) => {
  const all = index ? (index.get(d) ?? []) : Object.values(entities).filter((e) => e.entity_id.startsWith(`${d}.`));
  return allowed ? all.filter((e) => allowed.has(e.entity_id)) : [...all];
};
const idsOf = (es: readonly HassEntity[]) => es.map((e) => e.entity_id);

export function lockFacts(entities: Record<string, HassEntity>, allowed?: Allowed, index?: DomainIndex): LockFacts | null {
  const locks = ofDomain(entities, "lock", allowed, index);
  if (!locks.length) return null;
  return {
    ids: idsOf(locks),
    locked: idsOf(locks.filter((l) => l.state === "locked")),
    unlocked: idsOf(locks.filter((l) => l.state === "unlocked")),
    unknown: idsOf(locks.filter((l) => l.state !== "locked" && l.state !== "unlocked")),
  };
}

export function lightFacts(entities: Record<string, HassEntity>, allowed?: Allowed, index?: DomainIndex): OnOffFacts | null {
  const lights = ofDomain(entities, "light", allowed, index);
  return lights.length ? { ids: idsOf(lights), on: idsOf(lights.filter((e) => isSwitchedOn(e, e.entity_id))) } : null;
}

export function climateFacts(entities: Record<string, HassEntity>, allowed?: Allowed, index?: DomainIndex): ClimateFacts | null {
  const units = ofDomain(entities, "climate", allowed, index);
  if (!units.length) return null;
  const active = units.filter((e) => isSwitchedOn(e, e.entity_id));
  const temps = active
    .map((e) => e.attributes.current_temperature)
    .filter((t): t is number => typeof t === "number");
  return {
    ids: idsOf(units),
    active: idsOf(active),
    unreachable: idsOf(units.filter((e) => isUnavailable(e))),
    avgCurrentTemp: temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null,
  };
}

/** The AC tile's temperature: in Home Assistant's own unit when it is known
 *  ("24°C", "75°F"), a bare degree otherwise — never an assumed Celsius. */
export function fmtClimateTemp(avg: number, unit?: string): string {
  return unit ? `${avg}${unit}` : `${avg}°`;
}

export function powerFacts(
  entities: Record<string, HassEntity>, thresholds: Record<string, Threshold>, index?: DomainIndex,
): PowerFacts | null {
  // By CLASS, not a regex over the unit — "kW" is power too (SensorClasses).
  const sensors = ofDomain(entities, "sensor", undefined, index).filter(
    (e) => effectiveSensorClass(e.attributes.device_class as string | undefined,
                                e.attributes.unit_of_measurement as string | undefined) === "power");
  if (!sensors.length) return null;
  return {
    ids: idsOf(sensors),
    totalW: sensors.reduce(
      (sum, e) => sum + (toBaseUnit(e.state, e.attributes.unit_of_measurement as string | undefined) ?? 0), 0),
    alert: sensors.some((e) => {
      const v = Number(e.state);
      return Number.isFinite(v) && levelForValue(v, thresholds[e.entity_id]) !== "normal";
    }),
  };
}

export function villaSummary(input: {
  entities: Record<string, HassEntity>;
  /** The villa's own devices — scopes locks, lights and AC (see header). */
  devices: Allowed;
  resolvedRooms: Record<string, string>;
  thresholds: Record<string, Threshold>;
}): VillaSummary {
  const { entities, devices } = input;
  const index = domainIndex(entities);
  return {
    locks: lockFacts(entities, devices, index),
    lights: lightFacts(entities, devices, index),
    climate: climateFacts(entities, devices, index),
    power: powerFacts(entities, input.thresholds, index),
  };
}
