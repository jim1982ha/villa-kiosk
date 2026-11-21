// src/config/villaSettings.ts
// The villa's single-value settings, one row each in rootfs/usr/share/vesta/villa-settings.json (architecture review
// round 17): its kind, its default, its bounds and the name its control shows. Every place the app needs one of these
// derives from the row: DEFAULT_CONFIG's villa part (AppConfig), how the villa's copy is read and what it is when
// nothing is stored (deviceConfig SHARED_KEYS), the name a change from another tablet is told by (configSlice), and the
// add-on's server reads the same file for its defaults and bounds (supervisor-proxy.py). Before, a villa setting was
// written in eight places, a bound copied into the server, and a setting missing from the names was told as a device.
//
// Adding one: its row in the JSON, its AppConfig field (tsc refuses a row naming no field), and its SharedItems entry
// in deviceConfig (tsc refuses a shared key without a row there).

import TABLE from "../../rootfs/usr/share/vesta/villa-settings.json" with { type: "json" };
import CONTRACT from "../../rootfs/usr/share/vesta/agent-contract.json" with { type: "json" };
import type { AppConfig } from "./AppConfig";

/** The villa's single-value settings, by key. */
export type VillaSettingKey = keyof typeof TABLE.settings;

interface VillaSettingRow {
  kind: "number" | "int" | "text" | "entity" | "switch" | "record";
  default: unknown;
  min?: number;
  max?: number;
  name: string;
}

const ROWS = TABLE.settings as unknown as Record<VillaSettingKey, VillaSettingRow>;

/** Every villa setting's key, in the table's order. */
export const VILLA_SETTING_KEYS = Object.keys(ROWS) as VillaSettingKey[];

/** Each villa setting's default: what the app holds and the server applies while the villa has stored none. */
export const VILLA_DEFAULTS = Object.fromEntries(VILLA_SETTING_KEYS.map((k) => [k, ROWS[k].default])) as
  { [K in VillaSettingKey]: AppConfig[K] };

/** The name each villa setting's control shows: REQUIRED for every one (a change from another tablet is told by it). */
export const VILLA_SETTING_NAMES = Object.fromEntries(VILLA_SETTING_KEYS.map((k) => [k, ROWS[k].name])) as
  Record<VillaSettingKey, string>;

/** A setting's bounds (an int's `min` and `max`), from the table. */
export function villaBounds(key: VillaSettingKey): { min: number; max: number } {
  const row = ROWS[key];
  return { min: row.min ?? Number.NEGATIVE_INFINITY, max: row.max ?? Number.POSITIVE_INFINITY };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** An entity id, as the add-on's server checks one (agent-contract.json `entityPattern`). */
export const ENTITY_PATTERN = new RegExp(CONTRACT.entityPattern);

/**
 * ⚠️ THE ONE RULE FOR A VILLA SETTING'S VALUE (architecture review, owner approved 2026-11-20): what is kept of a
 * stored or sent value, by its row's kind; undefined: not kept (the setting reads its default). The add-on's server
 * applies the same rule to every save (supervisor-proxy.py _villa_keep), so the villa's file only ever holds kept
 * values; villa-settings.json `examples` drive both sides through the same cases. Before, an out-of-range number was
 * dropped here and clamped by the server. Now both clamp it: a number out of range is kept at the nearest bound, a
 * fraction as its whole part (an owner's "keep 99999 days" keeps the most the field allows, never the default's one
 * year, which would delete more). `number`: any finite number; `int`: a number, whole and within the bounds; `text`:
 * any text; `entity`: an entity id, or "" for none; `switch`: true or false; `record`: an object.
 */
export function keptVillaValue(key: VillaSettingKey, raw: unknown): unknown {
  switch (ROWS[key].kind) {
    case "number": return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
    case "int": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
      const { min, max } = villaBounds(key);
      return Math.min(max, Math.max(min, Math.trunc(raw)));
    }
    case "text": return typeof raw === "string" ? raw : undefined;
    case "entity": return typeof raw === "string" && (raw === "" || ENTITY_PATTERN.test(raw)) ? raw : undefined;
    case "switch": return typeof raw === "boolean" ? raw : undefined;
    case "record": return isRecord(raw) ? raw : undefined;
  }
}

/** A value of the villa's copy as the app holds it (keptVillaValue, a record over its default), or undefined (the
 *  tablet keeps its own). */
export function readVillaSetting<K extends VillaSettingKey>(key: K, raw: unknown): AppConfig[K] | undefined {
  const kept = keptVillaValue(key, raw);
  const value = kept !== undefined && ROWS[key].kind === "record" ? { ...(ROWS[key].default as object), ...(kept as object) } : kept;
  return value as AppConfig[K] | undefined;
}

/** A villa list of devices (deviceConfig idList: asleep by design, dismissed) as it is kept: entity ids, each once, in
 *  their order; undefined when it is no list. The server keeps the same (supervisor-proxy.py _entity_ids). */
export function keptEntityIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return [...new Set(raw.filter((v): v is string => typeof v === "string" && ENTITY_PATTERN.test(v)))];
}

/** How long a full-screen announcement holds the screen: whole seconds from `min` to `max`, `default` a new pick's. */
export const FULL_SCREEN_SECONDS: { default: number; min: number; max: number } = TABLE.fullScreenSeconds;

/** The villa's lists of devices (deviceConfig idList), each kept as keptEntityIds keeps it (villa-settings.json
 *  `lists`). */
export const VILLA_LISTS: readonly string[] = TABLE.lists;

/** Keys an older Kiosk stored in the villa's settings that the server drops (its copy of src/config/migrations.ts'
 *  retired keys, held equal by tests/oracles/messages_settings.mjs). */
export const VILLA_RETIRED_KEYS: readonly string[] = TABLE.retired;

/** The villa's settings as stored and as read in today's shape: both sides drive their migration through them. */
export const VILLA_MIGRATION_EXAMPLES = TABLE.examples as unknown as
  readonly { _: string; stored: Record<string, unknown>; today: Record<string, unknown> }[];
