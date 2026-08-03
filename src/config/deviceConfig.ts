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
import type { EntityMapping, TeleportPoint } from "@/types/scene.types";
import {
  keyBy, diffKeyed, applyKeyed, keyedDiffIsEmpty,
  type Keyed, type KeyedDiff,
} from "@/utils/keyedSync";

/** The AppConfig fields stored centrally. Single source of truth — both the
 *  push (what we send) and the merge (what a pull is allowed to overwrite)
 *  derive from this one list, so adding a field here is all it takes to make
 *  it site-wide. */
export const SHARED_CONFIG_KEYS = [
  "entityMap", "meshBindings", "deviceGroups", "teleportPoints", "dismissedEntityIds",
] as const;

export type SharedConfigKey = (typeof SHARED_CONFIG_KEYS)[number];
export type SharedDeviceConfig = Pick<AppConfig, SharedConfigKey>;

/** Extract just the shared slice of a full config. */
export function pickSharedConfig(config: AppConfig): SharedDeviceConfig {
  const out = {} as Record<string, unknown>;
  for (const key of SHARED_CONFIG_KEYS) out[key] = config[key];
  return out as SharedDeviceConfig;
}

/** Narrow an arbitrary parsed value from the server down to the shared fields
 *  THIS app version knows, dropping anything unrecognised — so a store written
 *  by a newer version can't inject unknown keys into config. Absent/wrong-typed
 *  fields are simply omitted, letting the caller keep its current value. */
function parseSharedConfig(raw: unknown): Partial<SharedDeviceConfig> {
  if (!raw || typeof raw !== "object") return {};
  const b = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // teleportPoints is the only array; the rest are plain objects/arrays whose
  // element shapes are already validated downstream by the consumers.
  if (b.entityMap && typeof b.entityMap === "object") out.entityMap = b.entityMap;
  if (b.meshBindings && typeof b.meshBindings === "object") out.meshBindings = b.meshBindings;
  if (Array.isArray(b.deviceGroups)) out.deviceGroups = b.deviceGroups;
  if (Array.isArray(b.teleportPoints)) out.teleportPoints = b.teleportPoints;
  if (Array.isArray(b.dismissedEntityIds)) {
    out.dismissedEntityIds = b.dismissedEntityIds.filter((v) => typeof v === "string");
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
// Each shared key is normalised to Record<id, item> for diffing — entityMap
// and meshBindings already are; deviceGroups/teleportPoints (arrays) are
// keyed by their own natural id (`id` / `name` respectively, both already
// required to be unique elsewhere in the app).
// The diff/apply primitives live in utils/keyedSync.ts — the SAME ones the
// Facility Manager store uses. See that file for why these three rules are
// shared code rather than a copy per store.
const keyDeviceGroups = (arr: DeviceGroup[]) => keyBy(arr, (g) => g.id);
const keyTeleportPoints = (arr: TeleportPoint[]) => keyBy(arr, (p) => p.name);
/** A plain id list is its own key — dismissing an entity on one device and
 *  un-dismissing a DIFFERENT one on another must not cancel each other out,
 *  which is exactly what comparing the two lists wholesale would do. */
const keyIdList = (arr: string[]): Keyed<true> =>
  Object.fromEntries(arr.map((id) => [id, true as const]));

export interface SharedConfigDiff {
  entityMap: KeyedDiff<EntityMapping>;
  meshBindings: KeyedDiff<string>;
  deviceGroups: KeyedDiff<DeviceGroup>;
  teleportPoints: KeyedDiff<TeleportPoint>;
  dismissedEntityIds: KeyedDiff<true>;
}

/** What did `next` actually change relative to `base`, per item? */
export function diffSharedConfig(base: SharedDeviceConfig, next: SharedDeviceConfig): SharedConfigDiff {
  return {
    entityMap: diffKeyed(base.entityMap, next.entityMap),
    meshBindings: diffKeyed(base.meshBindings, next.meshBindings),
    deviceGroups: diffKeyed(keyDeviceGroups(base.deviceGroups), keyDeviceGroups(next.deviceGroups)),
    teleportPoints: diffKeyed(keyTeleportPoints(base.teleportPoints), keyTeleportPoints(next.teleportPoints)),
    dismissedEntityIds: diffKeyed(keyIdList(base.dismissedEntityIds), keyIdList(next.dismissedEntityIds)),
  };
}

export function isSharedConfigDiffEmpty(diff: SharedConfigDiff): boolean {
  return keyedDiffIsEmpty(diff.entityMap) && keyedDiffIsEmpty(diff.meshBindings)
    && keyedDiffIsEmpty(diff.deviceGroups) && keyedDiffIsEmpty(diff.teleportPoints)
    && keyedDiffIsEmpty(diff.dismissedEntityIds);
}

/** Replay a diff onto some other config snapshot (normally the server's
 *  freshest one) — additions/edits and deletions from the diff win,
 *  everything else in `target` is left exactly as-is. */
export function applySharedConfigDiff(target: SharedDeviceConfig, diff: SharedConfigDiff): SharedDeviceConfig {
  return {
    entityMap: applyKeyed(target.entityMap, diff.entityMap),
    meshBindings: applyKeyed(target.meshBindings, diff.meshBindings),
    deviceGroups: Object.values(applyKeyed(keyDeviceGroups(target.deviceGroups), diff.deviceGroups)),
    teleportPoints: Object.values(applyKeyed(keyTeleportPoints(target.teleportPoints), diff.teleportPoints)),
    dismissedEntityIds: Object.keys(applyKeyed(keyIdList(target.dismissedEntityIds), diff.dismissedEntityIds)),
  };
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

/** What each shared key looks like when the server has never stored it.
 *  Used to build a HONEST baseline (see baselineFromServer). */
const EMPTY_SHARED_CONFIG: SharedDeviceConfig = {
  entityMap: {}, meshBindings: {}, deviceGroups: [], teleportPoints: [],
  dismissedEntityIds: [],
};

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
    out[key] = key in server ? server[key] : EMPTY_SHARED_CONFIG[key];
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
    const resp = await fetch(ingressPath("device-config"), { credentials: "same-origin" });
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
    const resp = await fetch(ingressPath("device-config"), {
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
