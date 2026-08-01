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
export function parseSharedConfig(raw: unknown): Partial<SharedDeviceConfig> {
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
type Keyed<T> = Record<string, T>;

function keyDeviceGroups(arr: DeviceGroup[]): Keyed<DeviceGroup> {
  return Object.fromEntries(arr.map((g) => [g.id, g]));
}
function keyTeleportPoints(arr: TeleportPoint[]): Keyed<TeleportPoint> {
  return Object.fromEntries(arr.map((p) => [p.name, p]));
}
/** A plain id list is its own key — dismissing an entity on one device and
 *  un-dismissing a DIFFERENT one on another must not cancel each other out,
 *  which is exactly what comparing the two lists wholesale would do. */
function keyIdList(arr: string[]): Keyed<true> {
  return Object.fromEntries(arr.map((id) => [id, true as const]));
}

interface KeyedDiff<T> {
  set: Keyed<T>;
  del: string[];
}

function diffKeyed<T>(base: Keyed<T>, next: Keyed<T>): KeyedDiff<T> {
  const set: Keyed<T> = {};
  for (const [id, item] of Object.entries(next)) {
    if (JSON.stringify(base[id]) !== JSON.stringify(item)) set[id] = item;
  }
  const del: string[] = [];
  for (const id of Object.keys(base)) if (!(id in next)) del.push(id);
  return { set, del };
}

function applyKeyed<T>(server: Keyed<T>, diff: KeyedDiff<T>): Keyed<T> {
  const out = { ...server, ...diff.set };
  for (const id of diff.del) delete out[id];
  return out;
}

function keyedDiffIsEmpty<T>(diff: KeyedDiff<T>): boolean {
  return Object.keys(diff.set).length === 0 && diff.del.length === 0;
}

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

/** One shared-config fetch: the parsed slice plus the revision it was read
 *  at, so a subsequent write can detect whether someone else wrote in
 *  between (see saveSharedConfig). */
export interface SharedConfigFetch {
  config: Partial<SharedDeviceConfig>;
  rev: number;
}

/** Fetch the shared device config. Returns null on a transport/parse failure so
 *  the caller can distinguish "server has nothing yet" ({}) from "couldn't
 *  reach it" (null) — the latter must NOT overwrite what this device has. */
export async function fetchSharedConfig(): Promise<SharedConfigFetch | null> {
  try {
    const resp = await fetch(ingressPath("device-config"), { credentials: "same-origin" });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { config?: unknown; rev?: unknown };
    return {
      config: parseSharedConfig(data.config),
      rev: typeof data.rev === "number" ? data.rev : 0,
    };
  } catch {
    return null;
  }
}

export type SaveSharedConfigResult =
  | { ok: true; rev: number }
  | { ok: false; conflict: false }
  | { ok: false; conflict: true; server: Partial<SharedDeviceConfig>; rev: number };

/** Write the shared device config (owner only — the server 403s other roles).
 *  `expectedRev` is the revision this write was computed against; pass null
 *  to skip the check (unconditional overwrite). If the server's stored
 *  revision has since moved on, the write is rejected (409) rather than
 *  silently clobbering whatever the other write put there — the caller gets
 *  the fresher copy back so it can rebase its own diff and retry. */
export async function saveSharedConfig(
  config: SharedDeviceConfig,
  expectedRev: number | null,
): Promise<SaveSharedConfigResult> {
  try {
    const resp = await fetch(ingressPath("device-config"), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expectedRev === null ? { config } : { config, rev: expectedRev }),
    });
    if (resp.status === 409) {
      const data = (await resp.json().catch(() => ({}))) as { config?: unknown; rev?: unknown };
      return {
        ok: false,
        conflict: true,
        server: parseSharedConfig(data.config),
        rev: typeof data.rev === "number" ? data.rev : 0,
      };
    }
    if (!resp.ok) return { ok: false, conflict: false };
    const data = (await resp.json().catch(() => ({}))) as { rev?: unknown };
    return { ok: true, rev: typeof data.rev === "number" ? data.rev : 0 };
  } catch {
    return { ok: false, conflict: false };
  }
}
