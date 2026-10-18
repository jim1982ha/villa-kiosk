// src/config/presence.ts
// Is the villa seen as empty or occupied — and why. Read from the ONE on/off sensor the owner picks in Settings ›
// Villa ("Villa empty" sensor: on = empty), never from an entity this app names: which sensor answers it is the
// villa's own (the hard rule — nothing villa-specific ships). No sensor picked: no answer, and nothing is shown.
//
// Owner, 2026-10-18: "the goal would be for the user to always be able to see when the villa is seen as occupied
// or not". The tile under the floors draws presenceOf; its panel draws presenceWhy.

import type { HassEntity } from "@/types/ha.types";
import { UNKNOWN_STATES, type StatusKey } from "@/utils/stateColors";

export type PresenceState = "occupied" | "empty" | "unknown";

export interface Presence {
  state: PresenceState;
  /** The tile's word, and the panel's heading. */
  label: string;
  /** Its colour, as Map colours & keys says it: someone there = active, empty = off/idle, unknown = unavailable. */
  tone: StatusKey;
  /** When it last changed (ISO), for "Empty since 14:20"; null when the villa's system does not say. */
  since: string | null;
}

/** The answer of the picked sensor — on = empty, off = occupied, anything else (unavailable, unknown, a state an
 *  on/off sensor never has) cannot be told. null when no sensor is picked. */
export function presenceOf(sensorId: string, entities: Readonly<Record<string, HassEntity>>): Presence | null {
  if (!sensorId) return null;
  const e = entities[sensorId];
  const since = e?.last_changed ?? null;
  if (e && (e.state === "on" || e.state === "off")) {
    return e.state === "on"
      ? { state: "empty", label: "Empty", tone: "idle", since }
      : { state: "occupied", label: "Occupied", tone: "active", since };
  }
  // the state's NAME and the map's colour for it, not the pair of states nobody can read (that is UNKNOWN_STATES)
  const unknown: PresenceState = "unknown";
  return { state: unknown, label: "Presence unknown", tone: "unavailable", since: e ? since : null };
}

export interface PresencePerson { entityId: string; name: string; home: boolean; place: string; since: string | null }
export interface PresenceActivity { entityId: string; name: string; moving: boolean; at: string | null }
export interface PresenceSetting { entityId: string; name: string; value: string; unit: string }

export interface PresenceWhy {
  /** Every person of the villa's system: home or away, and since when. */
  people: PresencePerson[];
  /** The motion/occupancy sensor that changed last: moving now, or quiet since. */
  lastActivity: PresenceActivity | null;
  /** The numbers that decide it: the villa's number settings named after the sensor ("<its name>_…", one prefix per
   *  feature — the owner's rule for every helper), so the panel finds them without naming any. */
  settings: PresenceSetting[];
}

const MOTION_CLASSES = new Set(["motion", "occupancy", "presence"]);
const nameOf = (e: HassEntity) => String(e.attributes?.friendly_name ?? e.entity_id);

export function presenceWhy(sensorId: string, entities: Readonly<Record<string, HassEntity>>): PresenceWhy {
  const all = Object.values(entities);
  const people = all.filter((e) => e.entity_id.startsWith("person."))
    .map((e) => ({
      entityId: e.entity_id, name: nameOf(e), home: e.state === "home",
      place: e.state === "home" ? "Home" : e.state === "not_home" ? "Away" : UNKNOWN_STATES.has(e.state) || !e.state ? "Unknown" : e.state,
      since: e.last_changed ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const motion = all.filter((e) => e.entity_id.startsWith("binary_sensor.") && e.entity_id !== sensorId
    && MOTION_CLASSES.has(String(e.attributes?.device_class ?? "")) && (e.state === "on" || e.state === "off"));
  const moving = motion.filter((e) => e.state === "on");
  const latest = (moving.length ? moving : motion)
    .sort((a, b) => Date.parse(b.last_changed ?? "") - Date.parse(a.last_changed ?? ""))[0];
  const prefix = sensorId.includes(".") ? `input_number.${sensorId.split(".")[1]}_` : null;
  const settings = prefix ? all.filter((e) => e.entity_id.startsWith(prefix))
    .map((e) => ({ entityId: e.entity_id, name: nameOf(e), value: e.state, unit: String(e.attributes?.unit_of_measurement ?? "") }))
    .sort((a, b) => a.name.localeCompare(b.name)) : [];
  return {
    people,
    lastActivity: latest ? { entityId: latest.entity_id, name: nameOf(latest), moving: latest.state === "on", at: latest.last_changed ?? null } : null,
    settings,
  };
}

/** "since" in words: a time today ("14:20"), else the day and time ("Sat 17 Oct, 21:00") — dateText's own forms. */
export function sinceText(at: string | null, clockTime: (t: string) => string, dayTime: (t: string) => string,
  now: Date = new Date()): string {
  if (!at || Number.isNaN(Date.parse(at))) return "";
  return new Date(at).toDateString() === now.toDateString() ? clockTime(at) : dayTime(at);
}

/** The Recap's line: "Villa occupied since 09:12", "Villa empty since Sat 17 Oct, 21:00", "Villa presence unknown". */
export function recapPresenceText(p: Presence, when: string): string {
  if (p.state === "unknown") return "Villa presence unknown";
  return `Villa ${p.state}${when ? ` since ${when}` : ""}`;
}
