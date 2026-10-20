// src/config/presence.ts
// Is the villa seen as empty or occupied — and why. Read from the ONE on/off sensor the owner picks in Settings ›
// Villa ("Villa empty" sensor: on = empty), never from an entity this app names: which sensor answers it is the
// villa's own (the hard rule — nothing villa-specific ships). No sensor picked: no answer, and nothing is shown.
//
// Owner, 2026-10-18: "the goal would be for the user to always be able to see when the villa is seen as occupied
// or not". The tile under the floors draws presenceOf; its panel draws presenceWhy.

import type { HassEntity } from "@/types/ha.types";
import type { StateSince } from "@/ha/historySource";
import { UNKNOWN_STATES, type StatusKey } from "@/utils/stateColors";

export type PresenceState = "occupied" | "empty" | "unknown";

export interface Presence {
  state: PresenceState;
  /** The tile's word, and the panel's heading. */
  label: string;
  /** Its colour, as Map colours & keys says it: someone there = active, empty = off/idle, unknown = unavailable. */
  tone: StatusKey;
  /** When the villa became empty, as the sensor itself states it (its `empty_since` attribute, epoch ms) — only
   *  while it says empty; null otherwise (the history's start of the run answers: presenceSince). */
  stated: number | null;
}

/**
 * When something's current state began, as a line can say it: a moment (or "before" the oldest moment kept),
 * "loading" while the history is read — never the `last_changed` a restart rewrites (historySource.stateSince) —
 * or null when nothing can say.
 */
export type Since = Pick<StateSince, "at" | "before"> | "loading" | null;

/** The sensor's own `empty_since`, while it says empty: the moment it last BECAME empty, which survives restarts and
 *  reaches past what the villa keeps (owner, 2026-10-20). Absent, null or not a time: null. */
function statedEmptySince(e: HassEntity): number | null {
  const v = e.attributes?.empty_since;
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** The villa's "since": the sensor's own statement when it has one, else the history's start of the current run. */
export function presenceSince(p: Presence, history: Since): Since {
  return p.stated !== null ? { at: p.stated, before: false } : history;
}

/** The answer of the picked sensor — on = empty, off = occupied, anything else (unavailable, unknown, a state an
 *  on/off sensor never has) cannot be told. null when no sensor is picked. */
export function presenceOf(sensorId: string, entities: Readonly<Record<string, HassEntity>>): Presence | null {
  if (!sensorId) return null;
  const e = entities[sensorId];
  if (e && (e.state === "on" || e.state === "off")) {
    return e.state === "on"
      ? { state: "empty", label: "Empty", tone: "idle", stated: statedEmptySince(e) }
      : { state: "occupied", label: "Occupied", tone: "active", stated: null };
  }
  // the state's NAME and the map's colour for it, not the pair of states nobody can read (that is UNKNOWN_STATES)
  const unknown: PresenceState = "unknown";
  return { state: unknown, label: "Presence unknown", tone: "unavailable", stated: null };
}

/** One state of the picked sensor in the villa's words — "Empty" (on), "Occupied" (off), "Presence unknown" — and its
 *  colour, the same as presenceOf's: what the presence window's band says over time (owner, 2026-10-20: the band under
 *  "Latest movement" said "Clear" — a motion sensor's word — while the villa was Occupied). */
export function presenceStateWords(state: string): { label: string; tone: StatusKey } {
  if (state === "on") return { label: "Empty", tone: "idle" };
  if (state === "off") return { label: "Occupied", tone: "active" };
  return { label: "Presence unknown", tone: "unavailable" };
}

export interface PresencePerson { entityId: string; name: string; home: boolean; place: string; since: Since }
export interface PresenceActivity { entityId: string; name: string; moving: boolean; at: Since }
export interface PresenceSetting { entityId: string; name: string; value: string; unit: string }

export interface PresenceWhy {
  /** The people the sensor watches — those it lists in its own "people" attribute, home or away and since when;
   *  null when it lists none (the window then says so, rather than showing everyone the villa's system knows). */
  people: PresencePerson[] | null;
  /** Of the sensors it watches (its "sensors" attribute), the one that changed last: moving now, or quiet since;
   *  null when it lists none, or none of them reports. */
  lastActivity: PresenceActivity | null;
  /** It lists the sensors it watches. */
  listsSensors: boolean;
  /** The numbers that decide it: the villa's number settings named after the sensor ("<its name>_…", one prefix per
   *  feature — the owner's rule for every helper), so the panel finds them without naming any. */
  settings: PresenceSetting[];
}

const nameOf = (e: HassEntity) => String(e.attributes?.friendly_name ?? e.entity_id);
/** An attribute that lists entity ids, as the sensor states it; null when it states none. */
const listed = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);

/** The ids whose "since" the window shows: the people and the sensors the sensor lists. */
export function presenceWatched(sensorId: string, entities: Readonly<Record<string, HassEntity>>): string[] {
  const attrs = entities[sensorId]?.attributes ?? {};
  return [...(listed(attrs.people) ?? []), ...(listed(attrs.sensors) ?? [])];
}

/**
 * ⚠️ ONLY WHAT THE SENSOR WATCHES (owner, 2026-10-18: "only show the people that are defined in the villa_empty
 * sensor", and the latest movement from its own sensors): the window listed every person of the villa's system — two
 * service accounts among them — and the parking camera's motion, which the sensor does not read. The sensor states
 * its own lists ("people", "sensors" attributes); the window reads those, and names nothing itself.
 */
export function presenceWhy(sensorId: string, entities: Readonly<Record<string, HassEntity>>,
  sinceOf: (id: string) => Since): PresenceWhy {
  const all = Object.values(entities);
  const attrs = entities[sensorId]?.attributes ?? {};
  const peopleIds = listed(attrs.people), sensorIds = listed(attrs.sensors);
  const people = peopleIds && peopleIds.map((id) => entities[id]).filter((e): e is HassEntity => !!e)
    .map((e) => ({
      entityId: e.entity_id, name: nameOf(e), home: e.state === "home",
      place: e.state === "home" ? "Home" : e.state === "not_home" ? "Away" : UNKNOWN_STATES.has(e.state) || !e.state ? "Unknown" : e.state,
      since: sinceOf(e.entity_id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const watched = (sensorIds ?? []).map((id) => entities[id])
    .filter((e): e is HassEntity => !!e && (e.state === "on" || e.state === "off"));
  const moving = watched.filter((e) => e.state === "on");
  // the latest by when its state really began; while that is read, by what the villa's system says
  const began = (e: HassEntity) => { const s = sinceOf(e.entity_id); return s && s !== "loading" ? s.at : Date.parse(e.last_changed ?? ""); };
  const latest = (moving.length ? moving : watched).sort((a, b) => began(b) - began(a))[0];
  const prefix = sensorId.includes(".") ? `input_number.${sensorId.split(".")[1]}_` : null;
  const settings = prefix ? all.filter((e) => e.entity_id.startsWith(prefix))
    .map((e) => ({ entityId: e.entity_id, name: nameOf(e), value: e.state, unit: String(e.attributes?.unit_of_measurement ?? "") }))
    .sort((a, b) => a.name.localeCompare(b.name)) : [];
  return {
    people,
    lastActivity: latest ? { entityId: latest.entity_id, name: nameOf(latest), moving: latest.state === "on", at: sinceOf(latest.entity_id) } : null,
    listsSensors: sensorIds !== null,
    settings,
  };
}

/** "since" in words, always with its day: "19 Oct, 18:40" (dateText.dayTime). ⚠️ THE TIME ALONE WAS NOT ENOUGH (owner,
 *  2026-10-19, the presence window's People: "Home · since 18:40" — which day?): a time today was written without its
 *  date, so a reader could not tell today from yesterday. One form, every "since" of the window, the tile and the Recap.
 *  Older than the villa keeps: "before 10 Oct" (its day). While the history is read: "…", never a guess. */
export function sinceText(s: Since, dayTime: (t: number) => string, day: (t: number) => string): string {
  if (s === "loading") return SINCE_LOADING;
  if (!s || !Number.isFinite(s.at)) return "";
  return s.before ? `before ${day(s.at)}` : dayTime(s.at);
}

/** What a "since" says while the history is read. */
export const SINCE_LOADING = "…";

/** The Recap's line: "Villa occupied since 19 Oct, 09:12", "Villa presence unknown". */
export function recapPresenceText(p: Presence, when: string): string {
  if (p.state === "unknown") return "Villa presence unknown";
  return `Villa ${p.state}${when ? ` since ${when}` : ""}`;
}
