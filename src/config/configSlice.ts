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

