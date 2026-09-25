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
import { OFF_STATES } from "@/utils/entityState";
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

const ofDomain = (entities: Record<string, HassEntity>, d: string, allowed?: Allowed) =>
  Object.values(entities).filter((e) => e.entity_id.startsWith(`${d}.`) && (!allowed || allowed.has(e.entity_id)));
const idsOf = (es: readonly HassEntity[]) => es.map((e) => e.entity_id);
const isOn = (e: HassEntity) => !OFF_STATES.has(e.state);

export function lockFacts(entities: Record<string, HassEntity>, allowed?: Allowed): LockFacts | null {
  const locks = ofDomain(entities, "lock", allowed);
  if (!locks.length) return null;
  return {
    ids: idsOf(locks),
    locked: idsOf(locks.filter((l) => l.state === "locked")),
    unlocked: idsOf(locks.filter((l) => l.state === "unlocked")),
    unknown: idsOf(locks.filter((l) => l.state !== "locked" && l.state !== "unlocked")),
  };
}

export function lightFacts(entities: Record<string, HassEntity>, allowed?: Allowed): OnOffFacts | null {
  const lights = ofDomain(entities, "light", allowed);
  return lights.length ? { ids: idsOf(lights), on: idsOf(lights.filter(isOn)) } : null;
}

export function climateFacts(entities: Record<string, HassEntity>, allowed?: Allowed): ClimateFacts | null {
  const units = ofDomain(entities, "climate", allowed);
  if (!units.length) return null;
  const active = units.filter((e) => e.state !== "off" && !OFF_STATES.has(e.state));
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

export function powerFacts(
  entities: Record<string, HassEntity>, thresholds: Record<string, Threshold>,
): PowerFacts | null {
  // By CLASS, not a regex over the unit — "kW" is power too (SensorClasses).
  const sensors = ofDomain(entities, "sensor").filter(
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
  return {
    locks: lockFacts(entities, devices),
    lights: lightFacts(entities, devices),
    climate: climateFacts(entities, devices),
    power: powerFacts(entities, input.thresholds),
  };
}
