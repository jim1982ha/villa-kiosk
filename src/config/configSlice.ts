// src/config/configSlice.ts
// The pure rules of a dialog that edits a slice of the config live — what its
// controls show and whether anything changed. The React half is
// hooks/useDraftedSlice.ts; these are apart so tests/oracles/
// settings_baseline.mjs can drive them by value in plain Node.

import { normaliseConfig, type AppConfig } from "./AppConfig";
import {
  applyRemoteChange, fromSharedItems, sharedItems, type RemoteChange, type SharedConfigKey,
} from "./deviceConfig";
import { applyKeyed, type KeyedDiff } from "@/utils/keyedSync";

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

/** The slice as text that two equal slices share whatever their order: a shared key by its items (an entity map
 *  rebuilt by a merge lists its devices in another order, and a list of ids is a set), every object's keys sorted. */
const sorted = (_k: string, v: unknown) => (v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  : v);
function contentOf<K extends keyof AppConfig>(slice: Slice<K>, keys: readonly K[]): string {
  return JSON.stringify(keys.map((k) => sharedItems(k, slice[k]) ?? slice[k]), sorted);
}

/** Whether the slice differs from its baseline — by CONTENT: an object value
 *  (`render`) is rebuilt by every one of its controls, so `!==` would report
 *  changed forever. A write still waiting to be committed counts as changed. */
export function sliceChanged<K extends keyof AppConfig>(
  config: AppConfig, keys: readonly K[], baseline: Slice<K>, waiting: boolean,
): boolean {
  return waiting || contentOf(sliceOf(config, keys), keys) !== contentOf(baseline, keys);
}

/**
 * What Cancel goes back to, once a change from ANOTHER tablet has arrived while the dialog is open: the baseline with
 * that change applied to it, item by item — the same per-item diff the shared store replays (config/deviceConfig
 * remoteChange). So the other tablet's change never reads as this dialog's (Save stays dark) and survives Cancel,
 * while every item this dialog changed still goes back. An item BOTH changed: this dialog's value stays on screen
 * (the store replays it last: Save keeps it), and Cancel puts the other tablet's back, never the copy from before it.
 *
 * ⚠️ BEFORE (2.496.493 to 2.496.496) the baseline was the copy taken on open, so Cancel wrote the other tablet's
 * edit away, and the sync pushed that undo to every tablet. `context` is the config the merge lands on: the result is
 * normalised as the store normalises it, so an item the merge brought reads equal to the config's. Pure —
 * tests/oracles/draft_remote.mjs.
 */
export function rebaseOnRemote<K extends keyof AppConfig>(
  baseline: Slice<K>, keys: readonly K[], context: AppConfig, change: RemoteChange,
): Slice<K> {
  const moved: Record<string, unknown> = {};
  for (const k of keys) {
    const diff = (change.diff as Partial<Record<string, KeyedDiff<unknown>>>)[k];
    const items = sharedItems(k, baseline[k]);
    if (!diff || !items || (Object.keys(diff.set).length === 0 && diff.del.length === 0)) continue;
    moved[k] = fromSharedItems(k as SharedConfigKey, applyKeyed(items, diff));
  }
  if (Object.keys(moved).length === 0) return baseline;
  return sliceOf(normaliseConfig({ ...context, ...baseline, ...moved } as AppConfig, { maps: true }), keys);
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

/** Whose change another tablet replaced: a device (by entity id) or one of the villa's settings. */
export type ReplacedSubject = { device: string } | { setting: string };

/** The villa's single-value settings, by the name their control shows (Settings, Advanced Settings). */
const SETTING_NAMES: Partial<Record<SharedConfigKey, string>> = {
  latitude: "The villa's location", longitude: "The villa's location", northOffsetDeg: "Model north offset",
  presenceSensor: "Villa presence", recordsKeptDays: "Ticket attachment days", roomGlowAndCones: "Room glow",
};

/** The device an item of a shared key is about (its id, or the entity a mesh or group stands for). */
function subjectOf(key: string, id: string, item: unknown): ReplacedSubject {
  const setting = SETTING_NAMES[key as SharedConfigKey];
  if (setting) return { setting };
  if (key === "meshBindings" && typeof item === "string") return { device: item };
  if (key === "deviceGroups" && item && typeof item === "object" && "primaryEntityId" in item) {
    return { device: String((item as { primaryEntityId: unknown }).primaryEntityId) };
  }
  return { device: id };
}

/**
 * What another tablet's change REPLACED of this dialog's own: every item this dialog changed since it opened
 * (`baseline` against `current`) that the change touches AND takes over (deviceConfig applyRemoteChange: this tablet's
 * edit already sent, the other tablet's wrote after it). One subject per device or setting.
 *
 * ⚠️ BEFORE (to 2.496.497) the field flipped to the other tablet's value without a word, and Save went grey: the
 * owner's change was gone with nothing saying so. The dialog now says it (components/settings/RemoteReplacedNote).
 * An item this tablet has not sent yet is not replaced: its push replays it last. Pure: tests/oracles/sync_inflight.mjs.
 */
export function replacedByRemote<K extends keyof AppConfig>(
  baseline: Slice<K>, keys: readonly K[], current: AppConfig, change: RemoteChange,
): ReplacedSubject[] {
  const patch = applyRemoteChange(current, change);
  if (Object.keys(patch).length === 0) return [];
  const after = normaliseConfig({ ...current, ...patch } as AppConfig, { maps: true });
  const same = (a: unknown, b: unknown) => JSON.stringify(a, sorted) === JSON.stringify(b, sorted);
  const out = new Map<string, ReplacedSubject>();
  for (const k of keys) {
    const diff = (change.diff as Partial<Record<string, KeyedDiff<unknown>>>)[k];
    const was = sharedItems(k, baseline[k]), now = sharedItems(k, current[k]), then = sharedItems(k, after[k]);
    if (!diff || !was || !now || !then) continue;
    for (const id of [...Object.keys(diff.set), ...diff.del]) {
      if (same(was[id], now[id]) || same(now[id], then[id])) continue;
      const subject = subjectOf(k, id, now[id] ?? then[id] ?? was[id]);
      out.set(JSON.stringify(subject), subject);
    }
  }
  return [...out.values()];
}

/** Subjects already said, plus new ones, each once. */
export function withReplaced(said: readonly ReplacedSubject[], found: readonly ReplacedSubject[]): ReplacedSubject[] {
  const seen = new Set(said.map((s) => JSON.stringify(s)));
  return [...said, ...found.filter((s) => !seen.has(JSON.stringify(s)))];
}

/** The line the dialog shows for one subject, the device named as every screen names it (`labelOf`). */
export function replacedLine(subject: ReplacedSubject, labelOf: (entityId: string) => string): string {
  const name = "device" in subject ? labelOf(subject.device) : subject.setting;
  return `${name} was changed on another tablet; your change was replaced.`;
}
