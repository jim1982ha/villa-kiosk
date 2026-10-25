// src/config/presence.ts
// Is the villa seen as empty or occupied — and why. Read from the ONE on/off sensor the owner picks in Settings ›
// Villa ("Villa empty" sensor: on = empty), never from an entity this app names: which sensor answers it is the
// villa's own (the hard rule — nothing villa-specific ships). No sensor picked: no answer, and nothing is shown.
//
// Owner, 2026-10-18: "the goal would be for the user to always be able to see when the villa is seen as occupied
// or not". The tile under the floors draws presenceOf; its panel draws presenceWhy.

import type { HassEntity } from "@/types/ha.types";
import type { StateSince } from "@/ha/historySource";
import { STATUS_COLOR, UNKNOWN_STATES, type StatusKey } from "@/utils/stateColors";
import { fmtDuration } from "@/components/panels/chartUtils";

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
export interface PresenceActivity {
  entityId: string; name: string; moving: boolean; at: Since;
  /** Its name in full, as the villa's system gives it, for its (i) (fullNames). */
  full: string;
}
export interface PresenceSetting {
  /** The setting the row opens (its first). */
  entityId: string;
  /** Every setting the row stands for: one, or several the sensor shows as one line (its "settings" attribute). */
  entityIds: string[];
  name: string;
  /** Its value as the window says it: a time joined to its unit ("5min", "1h"), a count bare ("3"), or the line the
   *  sensor writes for several ("3 pulses in 5min"). */
  said: string;
  /** Its (i): what it does, with an example, as the sensor explains it, and the settings' names in full. */
  explain: string;
}

/** `full` without the name of what it belongs to (owner, 2026-10-25: "remove \"villa empty - \" from the labels"):
 *  "Villa empty - away grace minutes" under the "Villa empty" sensor reads "Away grace minutes"; a name that does not
 *  start with it, as it is. */
export function shortName(full: string, owner: string): string {
  const m = owner ? full.match(new RegExp(`^${owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-–:]\\s*`, "i")) : null;
  const rest = m ? full.slice(m[0].length) : full;
  return rest ? rest[0].toUpperCase() + rest.slice(1) : full;
}

/** The (i)'s last line: the names in full, as the villa's system gives them (owner, 2026-10-25: "mention the full name
 *  of the used entity in the tooltip"). */
export function fullNames(names: readonly string[]): string {
  return names.length ? `In the villa's system: ${names.join(", ")}.` : "";
}

/** The steps the sensor goes through, as a stage sensor it names states them (owner, 2026-10-24: "show each stage in
 *  the mini trend chart"): its id, and its stages in order, from someone in to empty, each with its words. */
export interface PresenceStages {
  sensorId: string; order: [string, string][];
  /** Its stage now, and since when (the history's start of the run, like a person's). */
  now: string; since: Since;
}

const TIME_UNIT_MS: Record<string, number> = { s: 1000, min: 60_000, h: 3_600_000, d: 86_400_000 };
/** A setting's value in words: "5.0" "min" → "5min", "1.0" "h" → "1h" (the app's one duration rule, fmtDuration),
 *  "3.0" → "3", any other unit after its number. */
export function settingWords(value: string, unit: string): string {
  const n = Number(value);
  if (value === "" || !Number.isFinite(n)) return `${value}${unit ? ` ${unit}` : ""}`;
  if (TIME_UNIT_MS[unit]) return fmtDuration(n * TIME_UNIT_MS[unit]);
  const said = String(Math.round(n * 1000) / 1000);
  return unit ? `${said} ${unit}` : said;
}

/** A stage in words: the sensor's own, else the presence's ("Presence unknown" for unavailable or unknown), never
 *  a raw state (owner, 2026-10-24: the legend read "unavailable"). */
export function stageWords(stages: PresenceStages, state: string): string {
  return stages.order.find(([s]) => s === state)?.[1] ?? presenceStateWords(state).label;
}

/** What the window's heading says: the stage now, in its words and colour and since when, while the villa is on its
 *  way to empty (owner, 2026-10-24: "Occupied since 18:11" while everyone was away and the band said "Waiting for
 *  indoor quiet"); empty, or no stages, the presence itself ("Empty" keeps its exact "since", empty_since). */
export function presenceHeading(p: Presence, when: string, stages: PresenceStages | null,
  sinceWords: (s: Since) => string): { label: string; color: string; when: string } {
  const i = stages ? stages.order.findIndex(([s]) => s === stages.now) : -1;
  if (!stages || i < 0) return { label: p.label, color: STATUS_COLOR[p.tone], when };
  // empty: the presence's own words and exact "since", in the band's colour for it
  if (i === stages.order.length - 1) return { label: p.label, color: stageColor(stages, stages.now), when };
  return { label: stages.order[i][1], color: stageColor(stages, stages.now), when: sinceWords(stages.since) };
}

/** The colours of the steps between someone home and empty, in order: amber, then teal (the app's own). */
const STAGE_STEPS = ["var(--status-warning)", STATUS_COLOR.transitional] as const;

/** A stage's colour: the first (someone home) red, as a detection is on the map; the last (empty) the green the other
 *  bands use (owner, 2026-10-25: "the 'empty' color must be the green colour as used in other mini chart"); each step
 *  between them one of STAGE_STEPS in order — never shades of one colour (owner, 2026-10-25: "the different levels of
 *  green are not clear enough … when the villa is occupied, use the red \"active\" colour"); a state the sensor does
 *  not list: no contact's grey. */
export function stageColor(stages: PresenceStages, state: string): string {
  const i = stages.order.findIndex(([s]) => s === state), n = stages.order.length;
  if (i < 0) return STATUS_COLOR.unavailable;
  if (i === 0 || n < 2) return STATUS_COLOR.alert;
  if (i === n - 1) return STATUS_COLOR.active;
  return STAGE_STEPS[(i - 1) % STAGE_STEPS.length];
}

export interface PresenceWhy {
  /** The people the sensor watches — those it lists in its own "people" attribute, home or away and since when;
   *  null when it lists none (the window then says so, rather than showing everyone the villa's system knows). */
  people: PresencePerson[] | null;
  /** Of the sensors it watches (its "sensors" attribute), the one that changed last: moving now, or quiet since;
   *  null when it lists none, or none of them reports. */
  lastActivity: PresenceActivity | null;
  /** It lists the sensors it watches. */
  listsSensors: boolean;
  /** The numbers that decide it: the lines the sensor lists (its "settings" attribute: a label, a value in words, an
   *  explanation, the settings behind it — owner, 2026-10-25: two settings as one line), else the villa's number
   *  settings named after the sensor ("<its name>_…", one prefix per feature), so the panel names none itself. */
  settings: PresenceSetting[];
  /** Its stages, when it names a sensor that states them ("stage_sensor"); null otherwise (the band then says
   *  Occupied / Empty, as before). */
  stages: PresenceStages | null;
}

const nameOf = (e: HassEntity) => String(e.attributes?.friendly_name ?? e.entity_id);
/** An attribute that lists entity ids, as the sensor states it; null when it states none. */
const listed = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);

/** The ids whose "since" the window shows: the people and the sensors the sensor lists. */
export function presenceWatched(sensorId: string, entities: Readonly<Record<string, HassEntity>>): string[] {
  const attrs = entities[sensorId]?.attributes ?? {};
  return [...(listed(attrs.people) ?? []), ...(listed(attrs.sensors) ?? []),
    ...(typeof attrs.stage_sensor === "string" ? [attrs.stage_sensor] : [])];
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
  const owner = nameOf(entities[sensorId] ?? ({ entity_id: sensorId, attributes: {} } as HassEntity));
  const named = (id: string) => (entities[id] ? nameOf(entities[id]) : id);
  const stageId = typeof attrs.stage_sensor === "string" ? attrs.stage_sensor : "";
  const order = (Array.isArray(entities[stageId]?.attributes?.stages) ? entities[stageId].attributes.stages as unknown[] : [])
    .filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "string")
    .map(([s, w]) => [s, w] as [string, string]);
  const prefix = sensorId.includes(".") ? `input_number.${sensorId.split(".")[1]}_` : null;
  const said = (e: HassEntity) => settingWords(e.state, String(e.attributes?.unit_of_measurement ?? ""));
  const stated = Array.isArray(attrs.settings) ? (attrs.settings as unknown[]) : null;
  const settings: PresenceSetting[] = stated
    ? stated.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof (r as { label?: unknown }).label === "string")
      .map((r) => {
        const ids = listed(r.entities) ?? [];
        const one = ids.length === 1 && entities[ids[0]];
        return { entityId: ids[0] ?? "", entityIds: ids, name: String(r.label),
          said: typeof r.value === "string" ? r.value : one ? said(one) : "",
          explain: [typeof r.explain === "string" ? r.explain : "", fullNames(ids.map(named))].filter(Boolean).join("\n\n") };
      })
    : prefix ? all.filter((e) => e.entity_id.startsWith(prefix))
      .map((e) => ({ entityId: e.entity_id, entityIds: [e.entity_id], name: shortName(nameOf(e), owner), said: said(e),
        explain: fullNames([nameOf(e)]) }))
      .sort((a, b) => a.name.localeCompare(b.name)) : [];
  return {
    people,
    lastActivity: latest ? { entityId: latest.entity_id, name: shortName(nameOf(latest), owner), full: fullNames([nameOf(latest)]),
      moving: latest.state === "on", at: sinceOf(latest.entity_id) } : null,
    listsSensors: sensorIds !== null,
    settings,
    stages: order.length ? { sensorId: stageId, order, now: entities[stageId]?.state ?? "", since: sinceOf(stageId) } : null,
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
