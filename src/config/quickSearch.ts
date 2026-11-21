// src/config/quickSearch.ts
// What the Search window lists for a typed search (owner-approved review P3-03, 2026-11-21): the rooms to fly to, the
// devices this profile may switch, the scenes it may run. Pure: tests/oracles/quick_search.mjs drives it by value.
//
// ⚠️ NEVER A SIREN (CLAUDE.md: the siren needs a person's own press made for that sounding): no siren is listed, nor a
// scene that sets one; a siren is sounded from its camera's own button, which asks.
// ⚠️ A SCENE IS LISTED ONLY WHEN IT SETS A DEVICE THIS PROFILE MAY SWITCH: one that only sets a helper (the press of
// an automation) or devices the profile cannot control is not this profile's to run.

import { deviceSearchTexts, matchesQuery, type SearchSource } from "./deviceRecord";
import type { HaSceneInfo } from "./haScenes";
import type { TeleportPoint } from "@/types/scene.types";
import { isDomain } from "@/utils/entityDomain";

/** How many devices a search lists at most: a word that matches half the villa says to type another. */
export const SEARCH_DEVICE_LIMIT = 30;

export interface QuickSearchSource {
  /** The devices this profile's lists cover (VillaModel.visibleTo). */
  devices: readonly string[];
  /** Whether this profile may switch it (permissions.mayControlDevice). */
  mayControl: (entityId: string) => boolean;
  /** What a device is found by (useDeviceSearch). */
  src: SearchSource;
  /** The rooms with a viewpoint (the Rooms window's). */
  rooms: readonly TeleportPoint[];
  scenes: readonly HaSceneInfo[];
}

export interface QuickSearchResult {
  rooms: TeleportPoint[];
  devices: string[];
  scenes: HaSceneInfo[];
}

const isSiren = (id: string) => isDomain(id, "siren");

/** What a search lists: nothing for an empty one. */
export function quickSearch(query: string, s: QuickSearchSource): QuickSearchResult {
  if (!query.trim()) return { rooms: [], devices: [], scenes: [] };
  const switchable = (id: string) => !isSiren(id) && s.mayControl(id);
  const listed = new Set(s.devices);
  const rooms = s.rooms.filter((r) => matchesQuery(query, r.name));
  const devices = s.devices
    .filter((id) => switchable(id) && matchesQuery(query, ...deviceSearchTexts(id, s.src)))
    .slice(0, SEARCH_DEVICE_LIMIT);
  const scenes = s.scenes.filter((sc) =>
    !sc.memberEntityIds.some(isSiren)
    && sc.memberEntityIds.some((id) => listed.has(id) && switchable(id))
    && matchesQuery(query, sc.name, ...sc.rooms));
  return { rooms, devices, scenes };
}
