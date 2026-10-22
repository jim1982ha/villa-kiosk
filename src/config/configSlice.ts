// src/config/configSlice.ts
// The pure rules of a dialog that edits a slice of the config live — what its
// controls show and whether anything changed. The React half is
// hooks/useDraftedSlice.ts; these are apart so tests/oracles/
// settings_baseline.mjs can drive them by value in plain Node.

import type { AppConfig } from "./AppConfig";

export type Slice<K extends keyof AppConfig> = Pick<AppConfig, K>;

/** The slice's keys read out of a config. */
export function sliceOf<K extends keyof AppConfig>(config: AppConfig, keys: readonly K[]): Slice<K> {
  const out = {} as Record<string, unknown>;
  for (const k of keys) out[k] = config[k];
  return out as Slice<K>;
}

/** What the controls show: the live config, with the values still being typed
 *  laid over it. */
export function draftedView<K extends keyof AppConfig>(
  config: AppConfig, keys: readonly K[], typing: Partial<Slice<K>>,
): Slice<K> {
  return { ...sliceOf(config, keys), ...typing };
}

/** Whether the slice differs from its baseline — by CONTENT: an object value
 *  (`render`) is rebuilt by every one of its controls, so `!==` would report
 *  changed forever. A write still waiting to be committed counts as changed. */
export function sliceChanged<K extends keyof AppConfig>(
  config: AppConfig, keys: readonly K[], baseline: Slice<K>, waiting: boolean,
): boolean {
  return waiting || JSON.stringify(sliceOf(config, keys)) !== JSON.stringify(baseline);
}

/**
 * What Advanced Settings edits — the villa's shared setup — as ONE slice, so the dialog that opens it owns it in its
 * draft (owner, 2026-10-22: Advanced Settings joins Settings' Save / Cancel). Its edits still apply live (the 3D view
 * follows a north-offset drag) and reach every tablet; Cancel writes these keys back as they were when the dialog
 * opened — through the same update, so the store and every tablet get the old values — and Save keeps them.
 *
 * Every key a section of Advanced Settings writes, and nothing it merely triggers: the 3D model upload and "Log out
 * all devices" are actions, never reverted; the rooms a model's room data writes (teleportPoints) arrive with that
 * upload. Pure — tests/oracles/advanced_draft.mjs.
 */
export const ADVANCED_SETTINGS_KEYS = [
  "latitude", "longitude", "northOffsetDeg", "presenceSensor",
  "entityMap", "meshBindings", "deviceGroups", "dismissedEntityIds", "unavailableByDesign",
  "recordsKeptDays",
] as const satisfies readonly (keyof AppConfig)[];
