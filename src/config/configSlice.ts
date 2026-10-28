// src/config/configSlice.ts
// The pure rules of a dialog that edits a slice of the config live — what its
// controls show, what it changed (its ledger) and what Cancel puts back. The
// React half is hooks/useDraftedSlice.ts; these are apart so the oracles
// (settings_baseline, draft_ledger, draft_remote) drive them by value in plain Node.

import { normaliseConfig, type AppConfig } from "./AppConfig";
import {
  applyRemoteChange, fromSharedItems, sharedItems, SHARED_CONFIG_KEYS, type RemoteChange, type SharedConfigKey,
} from "./deviceConfig";
import type { ConfigEdit } from "./mappingEdits";
import { applyKeyed, diffKeyed, type Keyed, type KeyedDiff } from "@/utils/keyedSync";

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

/** Two items equal by content, whatever the order of their keys (a merge rebuilds an item with its keys reordered). */
const sorted = (_k: string, v: unknown) => (v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  : v);
const same = (a: unknown, b: unknown) => JSON.stringify(a, sorted) === JSON.stringify(b, sorted);

/** What the config becomes under a patch or an edit (config/mappingEdits): laid over it and completed (defaults,
 *  bounds), the map migrations only when it carries one of the two maps they clean. ConfigContext's one rule for
 *  every write, a dialog's or not; null when an edit changes nothing (nothing re-renders). */
export function applyConfigChange(prev: AppConfig, change: Partial<AppConfig> | ConfigEdit): AppConfig | null {
  const patch = typeof change === "function" ? change(prev) : change;
  if (typeof change === "function" && Object.keys(patch).length === 0) return null;
  const maps = patch.entityMap !== undefined || patch.meshBindings !== undefined;
  return normaliseConfig({ ...prev, ...patch }, { maps });
}

// ── THE DIALOG'S OWN EDITS, ITEM BY ITEM ──────────────────────────────────
/** One item a dialog changed: what it held before the dialog's first change of it (`had` false: it did not exist). */
export interface LedgerEntry { had: boolean; before?: unknown }
/** What a dialog changed since it opened (or was saved), and nothing else: key → item id → its value before. */
export type DraftLedger = Readonly<Record<string, Readonly<Record<string, LedgerEntry>>>>;
export const EMPTY_LEDGER: DraftLedger = {};

const isShared = (key: string) => (SHARED_CONFIG_KEYS as readonly string[]).includes(key);
/** A key's value as items: a shared key by its row (the per-item diff the store syncs by, deviceConfig sharedItems),
 *  any other (a walk speed, the render look) as one item. */
function itemsOf(key: string, value: unknown): Keyed<unknown> {
  return sharedItems(key, value) ?? (value === undefined ? {} : { value });
}
function fromItems(key: string, items: Keyed<unknown>): unknown {
  return isShared(key) ? fromSharedItems(key as SharedConfigKey, items) : items.value;
}

/**
 * The ledger after a write a dialog's own control made (ConfigContext DialogEdits): every item of the slice it changed
 * (`prev` to `next`, per item) is added with the value it had before, unless already there (its first value stays).
 *
 * ⚠️ ONLY WHAT THE DIALOG ITSELF SET (2.496.499). The draft was a copy of the slice taken on open, so ANY write while
 * it was open read as the dialog's: a 3D model uploaded from Advanced Settings reloads the view, the new devices it
 * finds are written to the device list, Save lit by itself, and Cancel deleted those devices on every tablet. A write
 * from anywhere else on this tablet, or from another tablet, never enters the ledger. Pure: tests/oracles/draft_ledger.mjs.
 */
export function recordEdit<K extends keyof AppConfig>(
  ledger: DraftLedger, keys: readonly K[], prev: AppConfig, next: AppConfig,
): DraftLedger {
  let out = ledger;
  for (const k of keys) {
    if (prev[k] === next[k]) continue;
    const was = itemsOf(k, prev[k]);
    const d = diffKeyed(was, itemsOf(k, next[k]));
    for (const id of [...Object.keys(d.set), ...d.del]) {
      if (out[k]?.[id]) continue;
      const entry: LedgerEntry = id in was ? { had: true, before: was[id] } : { had: false };
      out = { ...out, [k]: { ...out[k], [id]: entry } };
    }
  }
  return out;
}

/** Whether the dialog has a change to keep or cancel: an item of its ledger that is not back to its value before.
 *  By CONTENT: an object value (`render`) is rebuilt by every one of its controls. */
export function ledgerDirty(ledger: DraftLedger, config: AppConfig): boolean {
  for (const [k, entries] of Object.entries(ledger)) {
    const now = itemsOf(k, config[k as keyof AppConfig]);
    for (const [id, e] of Object.entries(entries)) {
      if (e.had ? !(id in now) || !same(now[id], e.before) : id in now) return true;
    }
  }
  return false;
}

/** Cancel: exactly the ledger's items put back as they were before the dialog changed them, on the config as it is
 *  NOW — every other item (a device found by the model just loaded, another tablet's change) left as it is. */
export function revertLedger(ledger: DraftLedger, config: AppConfig): Partial<AppConfig> {
  const out: Record<string, unknown> = {};
  for (const [k, entries] of Object.entries(ledger)) {
    const items = { ...itemsOf(k, config[k as keyof AppConfig]) };
    for (const [id, e] of Object.entries(entries)) {
      if (e.had) items[id] = e.before;
      else delete items[id];
    }
    out[k] = fromItems(k, items);
  }
  return out as Partial<AppConfig>;
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
  "recordsKeptDays", "fullScreenFor", "ringShownForS",
] as const satisfies readonly (keyof AppConfig)[];

/** Whose change another tablet replaced: a device (by entity id) or one of the villa's settings. */
export type ReplacedSubject = { device: string } | { setting: string };

/** The villa's single-value settings, by the name their control shows (Settings, Advanced Settings). */
const SETTING_NAMES: Partial<Record<SharedConfigKey, string>> = {
  latitude: "The villa's location", longitude: "The villa's location", northOffsetDeg: "Model north offset",
  presenceSensor: "Villa presence", recordsKeptDays: "Days records are kept", roomGlowAndCones: "Room glow",
  fullScreenFor: "Full screen for", ringShownForS: "Ring shown for",
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
 * A change from ANOTHER tablet, heard by the dialog's ledger (`current`: the config it lands on): every ledger item it
 * touches now goes back to the other tablet's value on Cancel, never to the copy from before it (Cancel would write
 * their change away, and the sync would push that undo to every tablet); an item it does not touch is not the ledger's
 * business. An item BOTH changed: this dialog's value stays on screen while its push replays it last (Save keeps it).
 *
 * And `replaced`: the ledger's items the change TAKES OVER (deviceConfig applyRemoteChange: this tablet's edit already
 * sent, the other tablet's wrote after it), one subject per device or setting, for the dialog to say
 * (components/settings/RemoteReplacedNote). An item this tablet has not sent yet is not replaced.
 *
 * ⚠️ BEFORE (to 2.496.498) the draft was the slice copied on open, moved by each such change: it could not tell this
 * dialog's edit from any other write on this tablet. Pure: tests/oracles/draft_remote.mjs, sync_inflight.mjs.
 */
export function ledgerOnRemote(
  ledger: DraftLedger, current: AppConfig, change: RemoteChange,
): { ledger: DraftLedger; replaced: ReplacedSubject[] } {
  const diffOf = (k: string) => (change.diff as Partial<Record<string, KeyedDiff<unknown>>>)[k];
  const touched = (k: string) => {
    const d = diffOf(k);
    return d ? [...Object.keys(d.set), ...d.del] : [];
  };
  const keys = Object.keys(ledger).filter((k) => touched(k).some((id) => ledger[k][id]));
  if (keys.length === 0) return { ledger, replaced: [] };
  // the config with the other tablet's change on every item (theirs everywhere), and as it will show (mine kept)
  const theirs = normaliseConfig({ ...current, ...Object.fromEntries(keys.map((k) =>
    [k, fromItems(k, applyKeyed(itemsOf(k, current[k as keyof AppConfig]), diffOf(k)!))])) } as AppConfig, { maps: true });
  const after = normaliseConfig({ ...current, ...applyRemoteChange(current, change) } as AppConfig, { maps: true });
  const out: Record<string, Readonly<Record<string, LedgerEntry>>> = { ...ledger };
  const replaced = new Map<string, ReplacedSubject>();
  for (const k of keys) {
    const now = itemsOf(k, current[k as keyof AppConfig]), them = itemsOf(k, theirs[k as keyof AppConfig]);
    const then = itemsOf(k, after[k as keyof AppConfig]);
    const entries: Record<string, LedgerEntry> = { ...ledger[k] };
    for (const id of touched(k)) {
      const e = entries[id];
      if (!e) continue;
      const untouched = e.had ? id in now && same(now[id], e.before) : !(id in now);
      if (!untouched && !same(now[id], then[id])) {
        const subject = subjectOf(k, id, now[id] ?? then[id] ?? e.before);
        replaced.set(JSON.stringify(subject), subject);
      }
      entries[id] = id in them ? { had: true, before: them[id] } : { had: false };
    }
    out[k] = entries;
  }
  return { ledger: out, replaced: [...replaced.values()] };
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
