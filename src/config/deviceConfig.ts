// src/config/deviceConfig.ts
// Defines WHICH parts of AppConfig are shared site-wide (stored centrally in
// the add-on's /data volume, identical for every connected client) versus kept
// per-device in that browser's own localStorage — plus the tiny client for the
// backend's /device-config store.
//
// The split, and the reasoning behind it:
//
//   SHARED — describes the VILLA. There is exactly one correct answer for the
//   whole installation, so configuring it on a phone must configure it for the
//   wall tablet too (the same expectation the uploaded GLB already sets):
//     entityMap      per-device metadata: label, room, type, category, the
//                    linked/motion entities, badge colour, disabled flag…
//     meshBindings   which 3D mesh is which entity
//     deviceGroups   which entities are really one physical device
//     teleportPoints room definitions (incl. each room's saved overview pose)
//     dismissedEntityIds  entities the owner removed as "no longer in HA" —
//                    a decision about the VILLA's model, so dismissing on a
//                    phone must dismiss on the wall tablet too
//     fmContract     the maintenance contract's cap and category names
//
//   PER-DEVICE — describes THIS CLIENT's look/feel, where different answers on
//   different hardware are correct, not a drift to be reconciled: render
//   quality (a phone should not inherit a desktop's settings), theme,
//   eyeHeight/walkSpeed, badgeStyle, showSummaryBar, hiddenCategories,
//   entityIconScale, currentFloor.
//
// sh3dRooms/sh3dEntities are excluded: they're DERIVED from the model's
// .rooms.json sidecar, which is already served centrally, so every client
// recomputes the same values on load. Syncing them would just duplicate the
// GLB's own payload through a second channel.

import { ingressPath } from "@/ha/ingress";
import type { AppConfig, DeviceGroup } from "./AppConfig";
import { EMPTY_FM_CONTRACT, type FmContract } from "@/fm/fmTypes";
import type { EntityMapping, TeleportPoint } from "@/types/scene.types";
import { backendFetch } from "@/auth/sessionLost";
import {
  keyBy, diffKeyed, applyKeyed, keyedDiffIsEmpty,
  type Keyed, type KeyedDiff,
} from "@/utils/keyedSync";

// ── THE SHARED KEYS: ONE ROW EACH ──────────────────────────────────────────
// Every shared key, described once: how its value is indexed item by item for
// the per-item diff (see "Per-item diff/merge" below), how it is rebuilt from
// that index, what a server value must look like to be accepted, and what it
// is when the server has never stored it. Every function in this file —
// parse, diff, apply, "is the diff empty", the empty baseline — derives from
// these rows (2.496.224). The key list used to be spelled out by hand in
// seven places; a key missing from the parser was silently dropped on every
// pull.
//
// Adding a shared key is: its item type in SharedItems, and its row in
// SHARED_KEYS (tsc refuses a row missing for a key, or a key without a row).

/** The type of ONE item of each shared key, once indexed. */
interface SharedItems {
  entityMap: EntityMapping;
  meshBindings: string;
  deviceGroups: DeviceGroup;
  teleportPoints: TeleportPoint;
  dismissedEntityIds: true;
  fmContract: FmContract;
}

export type SharedConfigKey = keyof SharedItems;
export type SharedDeviceConfig = Pick<AppConfig, SharedConfigKey>;

interface SharedKeyRow<V, I> {
  /** The value as {itemId: item}. */
  index(value: V): Keyed<I>;
  /** The value rebuilt from that index. */
  fromIndex(items: Keyed<I>): V;
  /** A server value in this key's shape, or undefined to keep the local
   *  value. Element shapes are validated downstream by the consumers. */
  parse(raw: unknown): V | undefined;
  /** The value when the server has never stored the key. */
  empty: V;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const asRecord = <T>(raw: unknown): Record<string, T> | undefined =>
  isRecord(raw) ? (raw as Record<string, T>) : undefined;
const asArray = <T>(raw: unknown): T[] | undefined =>
  Array.isArray(raw) ? (raw as T[]) : undefined;
const sameRecord = <T>(v: Keyed<T>): Keyed<T> => v;

const SHARED_KEYS: { [K in SharedConfigKey]: SharedKeyRow<AppConfig[K], SharedItems[K]> } = {
  entityMap: { index: sameRecord, fromIndex: sameRecord, parse: asRecord, empty: {} },
  meshBindings: { index: sameRecord, fromIndex: sameRecord, parse: asRecord, empty: {} },
  // Arrays are indexed by their own natural id (`id` / `name`, both already
  // required to be unique elsewhere in the app).
  deviceGroups: {
    index: (arr) => keyBy(arr, (g) => g.id), fromIndex: Object.values, parse: asArray, empty: [],
  },
  teleportPoints: {
    index: (arr) => keyBy(arr, (p) => p.name), fromIndex: Object.values, parse: asArray, empty: [],
  },
  // A plain id list is its own index — dismissing an entity on one device and
  // un-dismissing a DIFFERENT one on another must not cancel each other out,
  // which is exactly what comparing the two lists wholesale would do.
  dismissedEntityIds: {
    index: (arr) => Object.fromEntries(arr.map((id) => [id, true as const])),
    fromIndex: Object.keys,
    parse: (raw) => (Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : undefined),
    empty: [],
  },
  // One value, not a collection: indexed as a single item, so a change on
  // one device replaces it whole and an untouched copy carries nothing.
  fmContract: {
    index: (v) => ({ terms: v }),
    fromIndex: (items) => items.terms ?? EMPTY_FM_CONTRACT,
    parse: (raw) => (isRecord(raw) ? { ...EMPTY_FM_CONTRACT, ...(raw as Partial<FmContract>) } : undefined),
    empty: EMPTY_FM_CONTRACT,
  },
};

/** The AppConfig fields stored centrally, in the one order every document is
 *  built in (the push gate compares JSON strings, so key order matters). */
export const SHARED_CONFIG_KEYS = Object.keys(SHARED_KEYS) as readonly SharedConfigKey[];

/** One row, typed for its own key — the only cast the loops below need. */
function row<K extends SharedConfigKey>(key: K): SharedKeyRow<AppConfig[K], SharedItems[K]> {
  return SHARED_KEYS[key];
}

// ── Shared, but not ALL of it: derived items are excluded ──────────────────
// `teleportPoints` holds two different kinds of thing under one key. A point
// the user added ("Add room here") is authored data and has to reach every
// device. A point fitted from the floor plan is DERIVED — recomputed on every
// load from the GLB and its room data, both of which are already shared — so
// storing it centrally adds nothing and costs a great deal:
//
// the fit is re-solved per device (an affine solve plus a raycast for the floor
// height), so the coordinates differ slightly between them; the diff compares
// items by JSON; every device therefore pushed all of its rooms on boot, pulled
// a neighbour's fit, disagreed, and pushed again. Telemetry caught it as
// `changed: {teleportPoints: 23}` from five devices in one session.
//
// The split is expressed exactly once, here, as a PAIR: pickSharedConfig
// removes the derived items on the way out, mergeSharedConfig puts this
// device's own back on the way in. Keeping them together is what stops a pull
// blanking the fitted rooms until the next calibration.
const isFittedPoint = (p: TeleportPoint): boolean => p.fitted === true;

/** Extract just the shared slice of a full config — authored data only. */
export function pickSharedConfig(config: AppConfig): SharedDeviceConfig {
  const out = {} as Record<string, unknown>;
  for (const key of SHARED_CONFIG_KEYS) out[key] = config[key];
  out.teleportPoints = config.teleportPoints.filter((p) => !isFittedPoint(p));
  return out as SharedDeviceConfig;
}

/**
 * What local config becomes after a pull: the server's authored data, with
 * this device's own DERIVED items carried across untouched.
 *
 * Without the carry-across a pull would hand `update()` a teleportPoints list
 * with every fitted room missing, emptying the Rooms menu until the next model
 * load happened to re-calibrate.
 */
export function mergeSharedConfig(
  current: AppConfig | SharedDeviceConfig,
  server: Partial<SharedDeviceConfig>,
): Partial<SharedDeviceConfig> {
  if (!("teleportPoints" in server) || !Array.isArray(server.teleportPoints)) return server;
  return {
    ...server,
    teleportPoints: [
      ...current.teleportPoints.filter(isFittedPoint),
      ...server.teleportPoints.filter((p) => !isFittedPoint(p)),
    ],
  };
}

/** Narrow an arbitrary parsed value from the server down to the shared fields
 *  THIS app version knows, dropping anything unrecognised — so a store written
 *  by a newer version can't inject unknown keys into config. Absent/wrong-typed
 *  fields are simply omitted, letting the caller keep its current value. */
export function parseSharedConfig(raw: unknown): Partial<SharedDeviceConfig> {
  if (!isRecord(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const key of SHARED_CONFIG_KEYS) {
    const value = row(key).parse(raw[key]);
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<SharedDeviceConfig>;
}

// NOTE: comparison of two slices is done by the caller as a plain string
// compare of their JSON (see DeviceConfigSync) rather than by a helper here:
// the serialised form is needed anyway and is cached across renders, so a
// separate deep-equal function would just re-do that work on every render.
// Key order is stable in both places because pickSharedConfig always builds
// from SHARED_CONFIG_KEYS in order.

// ── Per-item diff/merge ──────────────────────────────────────────────────
// Two devices editing DIFFERENT items at nearly the same time (villa-kiosk
// is routinely open on a phone, a MacBook, an iPad and a wall tablet at
// once) must not be able to erase each other's work. A whole-object PUT of
// "everything this device currently has" can't tell "I changed this" apart
// from "I'm just carrying this unchanged" — so whichever device pushes last
// silently wins for the WHOLE key, even for items the other device touched.
// Diffing against the baseline each device last synced against, then
// replaying only the genuinely-changed items onto the server's freshest
// copy (see DeviceConfigSync's push flow), makes concurrent edits to
// different items commute instead of racing.
//
// Each shared key is indexed as Record<id, item> for diffing by its row in
// SHARED_KEYS. The diff/apply primitives live in utils/keyedSync.ts — the
// SAME ones the Facility Manager store uses. See that file for why these
// three rules are shared code rather than a copy per store.

export type SharedConfigDiff = { [K in SharedConfigKey]: KeyedDiff<SharedItems[K]> };

/** What did `next` actually change relative to `base`, per item? */
export function diffSharedConfig(base: SharedDeviceConfig, next: SharedDeviceConfig): SharedConfigDiff {
  const out = {} as Record<SharedConfigKey, unknown>;
  for (const key of SHARED_CONFIG_KEYS) {
    const r = row(key) as SharedKeyRow<unknown, unknown>;
    out[key] = diffKeyed(r.index(base[key]), r.index(next[key]));
  }
  return out as SharedConfigDiff;
}

/**
 * How many items each key contributes to a diff, omitting the keys that
 * contribute none. This is telemetry, not logic — but it is the difference
 * between a dump that says "this device pushed again" and one that says WHICH
 * key it keeps pushing.
 *
 * "Every boot emits a config push" was visible in the field for a long time
 * with no way to narrow it: `sync` records carried the outcome and the totals,
 * so a push driven by one churning key looked exactly like a push driven by a
 * real edit. Counts only — never item ids, which are entity_ids and villa
 * data.
 */
export function describeSharedConfigDiff(diff: SharedConfigDiff): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of SHARED_CONFIG_KEYS) {
    const d = diff[key] as KeyedDiff<unknown>;
    const n = Object.keys(d.set).length + d.del.length;
    if (n > 0) out[key] = n;
  }
  return out;
}

export function isSharedConfigDiffEmpty(diff: SharedConfigDiff): boolean {
  return SHARED_CONFIG_KEYS.every((key) => keyedDiffIsEmpty(diff[key] as KeyedDiff<unknown>));
}

/** Replay a diff onto some other config snapshot (normally the server's
 *  freshest one) — additions/edits and deletions from the diff win,
 *  everything else in `target` is left exactly as-is. */
export function applySharedConfigDiff(target: SharedDeviceConfig, diff: SharedConfigDiff): SharedDeviceConfig {
  const out = {} as Record<SharedConfigKey, unknown>;
  for (const key of SHARED_CONFIG_KEYS) {
    const r = row(key) as SharedKeyRow<unknown, unknown>;
    out[key] = r.fromIndex(applyKeyed(r.index(target[key]), diff[key] as KeyedDiff<unknown>));
  }
  return out as SharedDeviceConfig;
}

// The sync baseline (what the server was last known to hold) is PERSISTED,
// not just held in memory for the lifetime of the page.
//
// Without this, a device that reloads before its push lands silently loses
// the edit. The in-memory baseline starts as null on every fresh load, and a
// null baseline means "nothing to protect" — so the very first pull lets the
// server's copy win wholesale, overwriting the edit that localStorage had
// faithfully kept. On a desktop that never happens: the push completes in a
// second and the window closes. On the reported Android PWA it happens
// constantly — its own telemetry shows pagehide->pageshow cycles two seconds
// apart, i.e. it reloads faster than a debounced push (900 ms) plus its
// fetch-then-PUT round trip can finish. Symptom: "the entities disappear
// when I press Remove, then come back a few seconds later", on that device
// only, forever.
//
// Persisting the baseline makes the pending-edit check (DeviceConfigSync's
// rule 3) work ACROSS a reload: local still differs from the last CONFIRMED
// baseline, so the next pull defers and re-pushes instead of clobbering.
// A stale baseline is harmless — the diff still describes only this device's
// own changes, and the push rebases them onto the server's freshest copy.
const BASELINE_KEY = "villa-kiosk:shared-config-baseline";

export function loadSyncBaseline(): SharedDeviceConfig | null {
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    if (!raw) return null;
    const parsed = parseSharedConfig(JSON.parse(raw));
    // Only usable as a baseline if it carries every shared key — a partial
    // one would read as "this device deleted the missing keys".
    return SHARED_CONFIG_KEYS.every((k) => k in parsed)
      ? (parsed as SharedDeviceConfig)
      : null;
  } catch {
    return null;
  }
}

export function saveSyncBaseline(config: SharedDeviceConfig): void {
  try {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(config));
  } catch { /* storage full/disabled — degrades to the old in-memory behaviour */ }
}

/**
 * The baseline = what the server ACTUALLY holds, with an empty value for every
 * key it doesn't carry.
 *
 * This must NOT be `{...local, ...server}`. That merge is right for deciding
 * what local CONFIG becomes (a key the server omits must not blank the field
 * locally), but using it as the baseline silently claims the server already
 * has whatever local happens to hold. The push gate then compares local
 * against that baseline, sees no difference, and never sends the field —
 * so a key the server has never seen can never be pushed. It is stuck on
 * whichever device created it, forever, looking perfectly applied there.
 *
 * Found in the field, not by inspection: `dismissedEntityIds` worked on the
 * desktop and was invisible on the phone for days. The sync telemetry showed
 * both devices pulling the same revision with `serverHadDismissed:false`,
 * while the desktop reported `dismissed:6` — i.e. the desktop was reading its
 * own localStorage and calling it synced. With an empty baseline the diff
 * correctly reads as "local has 6 the server doesn't", and it pushes.
 */
export function baselineFromServer(server: Partial<SharedDeviceConfig>): SharedDeviceConfig {
  const out = {} as Record<string, unknown>;
  // Built in SHARED_CONFIG_KEYS order so its JSON compares byte-for-byte
  // against pickSharedConfig's (the push gate is a string compare).
  for (const key of SHARED_CONFIG_KEYS) {
    out[key] = key in server ? server[key] : row(key).empty;
  }
  return out as SharedDeviceConfig;
}

/** One shared-config fetch: the parsed slice plus the revision it was read
 *  at, so a subsequent write can detect whether someone else wrote in
 *  between (see saveSharedConfig). */
export interface SharedConfigFetch {
  config: Partial<SharedDeviceConfig>;
  rev: string;
  /** The server document EXACTLY as stored, unparsed. Carried back into the
   *  next write so keys this app version doesn't know about survive it.
   *
   *  parseSharedConfig deliberately drops unrecognised keys on read (a newer
   *  version's field must not be injected into config), but a write rebuilds
   *  the document from the parsed slice alone — so an OLDER client, which
   *  parses a newer field to nothing, would silently DELETE it for everyone
   *  the moment it pushed anything. That is not hypothetical: it is exactly
   *  what a phone still running the previous build does to a `dismissedEntityIds`
   *  the desktop just wrote, which reads as "the removal only works on one
   *  device". Writing unknown keys back untouched makes a mixed-version fleet
   *  (the normal state for a few minutes after every release, and longer for
   *  an installed PWA serving a cached bundle) merely stale, never destructive. */
  raw: Record<string, unknown>;
}

/** Fetch the shared device config. Returns null on a transport/parse failure so
 *  the caller can distinguish "server has nothing yet" ({}) from "couldn't
 *  reach it" (null) — the latter must NOT overwrite what this device has. */
export async function fetchSharedConfig(): Promise<SharedConfigFetch | null> {
  try {
    const resp = await backendFetch(ingressPath("device-config"), { credentials: "same-origin" });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { config?: unknown; rev?: unknown };
    const raw = data.config && typeof data.config === "object"
      ? (data.config as Record<string, unknown>) : {};
    return {
      config: parseSharedConfig(data.config),
      rev: typeof data.rev === "string" ? data.rev : "0",
      raw,
    };
  } catch {
    return null;
  }
}

export type SaveSharedConfigResult =
  | { ok: true; rev: string }
  | { ok: false; conflict: false }
  | { ok: false; conflict: true; server: Partial<SharedDeviceConfig>; rev: string };

/** Write the shared device config (owner only — the server 403s other roles).
 *  `expectedRev` is the revision this write was computed against; pass null
 *  to skip the check (unconditional overwrite). If the server's stored
 *  revision has since moved on, the write is rejected (409) rather than
 *  silently clobbering whatever the other write put there — the caller gets
 *  the fresher copy back so it can rebase its own diff and retry. */
export async function saveSharedConfig(
  config: SharedDeviceConfig,
  expectedRev: string | null,
  /** The raw server document this write was computed against (see
   *  SharedConfigFetch.raw) — its unknown keys are written back untouched so
   *  this client can't delete a field a newer version added. */
  carryOver: Record<string, unknown> = {},
): Promise<SaveSharedConfigResult> {
  try {
    const merged = { ...carryOver, ...config };
    const resp = await backendFetch(ingressPath("device-config"), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        expectedRev === null ? { config: merged } : { config: merged, rev: expectedRev }),
    });
    if (resp.status === 409) {
      const data = (await resp.json().catch(() => ({}))) as { config?: unknown; rev?: unknown };
      return {
        ok: false,
        conflict: true,
        server: parseSharedConfig(data.config),
        rev: typeof data.rev === "string" ? data.rev : "0",
      };
    }
    if (!resp.ok) return { ok: false, conflict: false };
    const data = (await resp.json().catch(() => ({}))) as { rev?: unknown };
    return { ok: true, rev: typeof data.rev === "string" ? data.rev : "0" };
  } catch {
    return { ok: false, conflict: false };
  }
}
