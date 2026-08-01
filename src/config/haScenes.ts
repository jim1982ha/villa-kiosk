// src/config/haScenes.ts
// Reads Home Assistant's OWN scene.* entities live — replaces the kiosk's
// former scenes.ts (a whole-villa state-snapshot system stored in the
// add-on's own /data, authored from Settings). That duplicated HA's own
// Scene Editor with a second, disconnected place to define "Movie Night".
//
// A scene entity's `attributes.entity_id` is HA's own list of every entity
// that scene touches — already delivered on the exact same get_states/
// state_changed stream this app already subscribes to. Cross-referencing
// those ids against config.entityMap's rooms is enough to know which room(s)
// a scene is "about", so this is a PURE derivation with no storage of its
// own: nothing here can drift from HA, because there is nothing to keep in
// sync — every read reflects whatever HA currently has, including a scene
// added, edited or deleted in HA's own editor a moment ago.

import { prettifyEntitySlug } from "./EntityMap";
import type { EntityMapping } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";

export interface HaSceneInfo {
  entityId: string;
  name: string;
  /** Every entity this scene sets — HA's own attributes.entity_id. */
  memberEntityIds: string[];
  /** Rooms (config.entityMap) at least one member entity belongs to, deduped
   *  and in first-seen order. Empty for a scene whose members have no room
   *  assigned yet, or that touches entities outside this villa's model
   *  entirely (e.g. a scene that only sets an input_boolean helper). */
  rooms: string[];
}

/** Derive every live, visible HA scene — see the module docstring for why
 *  this needs no storage/context of its own. `suppressedEntityIds` is the
 *  same hidden/diagnostic filter every other auto-populated list in this app
 *  already respects. */
export function deriveHaScenes(
  entities: Record<string, HassEntity>,
  suppressedEntityIds: ReadonlySet<string>,
  entityMap: Record<string, EntityMapping>,
): HaSceneInfo[] {
  const out: HaSceneInfo[] = [];
  for (const [entityId, e] of Object.entries(entities)) {
    if (!entityId.startsWith("scene.") || suppressedEntityIds.has(entityId)) continue;
    const raw = e.attributes.entity_id;
    const memberEntityIds = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
    const rooms: string[] = [];
    const seen = new Set<string>();
    for (const id of memberEntityIds) {
      const room = entityMap[id]?.room?.trim();
      if (room && !seen.has(room)) { seen.add(room); rooms.push(room); }
    }
    out.push({
      entityId,
      name: e.attributes.friendly_name || prettifyEntitySlug(entityId),
      memberEntityIds,
      rooms,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Scenes relevant to one room — any scene touching at least one entity
 *  mapped to it. Case/whitespace-insensitive, matching every other room-name
 *  comparison in this app. */
export function scenesForRoom(scenes: HaSceneInfo[], room: string): HaSceneInfo[] {
  const key = room.trim().toLowerCase();
  return scenes.filter((s) => s.rooms.some((r) => r.trim().toLowerCase() === key));
}
