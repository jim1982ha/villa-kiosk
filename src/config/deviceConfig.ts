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
//
//   PER-DEVICE — describes THIS CLIENT's look/feel, where different answers on
//   different hardware are correct, not a drift to be reconciled: render
//   quality (a phone should not inherit a desktop's settings), theme,
//   eyeHeight/walkSpeed, badgeStyle, showSummaryBar, hiddenCategories,
//   entityIconScale, currentFloor.
//
// kioskScenes is deliberately NOT here: it already has its own shared store
// (/scenes, see scenesApi.ts + ScenesContext.tsx). Two writers for one field
// would fight; leave that one owning itself.
//
// sh3dRooms/sh3dEntities are also excluded: they're DERIVED from the model's
// .rooms.json sidecar, which is already served centrally, so every client
// recomputes the same values on load. Syncing them would just duplicate the
// GLB's own payload through a second channel.

import { ingressPath } from "@/ha/ingress";
import type { AppConfig } from "./AppConfig";

/** The AppConfig fields stored centrally. Single source of truth — both the
 *  push (what we send) and the merge (what a pull is allowed to overwrite)
 *  derive from this one list, so adding a field here is all it takes to make
 *  it site-wide. */
export const SHARED_CONFIG_KEYS = [
  "entityMap", "meshBindings", "deviceGroups", "teleportPoints",
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
  return out as Partial<SharedDeviceConfig>;
}

// NOTE: comparison of two slices is done by the caller as a plain string
// compare of their JSON (see DeviceConfigSync) rather than by a helper here:
// the serialised form is needed anyway and is cached across renders, so a
// separate deep-equal function would just re-do that work on every render.
// Key order is stable in both places because pickSharedConfig always builds
// from SHARED_CONFIG_KEYS in order.

/** Fetch the shared device config. Returns null on a transport/parse failure so
 *  the caller can distinguish "server has nothing yet" ({}) from "couldn't
 *  reach it" (null) — the latter must NOT overwrite what this device has. */
export async function fetchSharedConfig(): Promise<Partial<SharedDeviceConfig> | null> {
  try {
    const resp = await fetch(ingressPath("device-config"), { credentials: "same-origin" });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { config?: unknown };
    return parseSharedConfig(data.config);
  } catch {
    return null;
  }
}

/** Replace the shared device config (owner only — the server 403s other roles). */
export async function saveSharedConfig(config: SharedDeviceConfig): Promise<boolean> {
  try {
    const resp = await fetch(ingressPath("device-config"), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
