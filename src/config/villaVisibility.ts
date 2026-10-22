// src/config/villaVisibility.ts
// "Which devices is this" — the three sets every Dashboard surface reads,
// decided ONCE (2.496.226). The villa model (VillaModel.tsx) is their only
// caller; before, the Dashboard derived the on-map set itself, the summary
// bar rebuilt the visible entities the villa model already had, and the
// Cockpit's attention hook wrote its own "may this profile see it".

import type { EntityMapping } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";
import type { Role } from "@/auth/roles";
import { isMappingAllowed, listedDevices } from "@/auth/permissions";
import { effectiveCategory, subjectOf } from "./EntityCategories";
import type { Category } from "@/types/scene.types";

interface IdSet { has(id: string): boolean }

/**
 * The entities that are ON THE MAP: every entity a 3D object stands for,
 * plus every mapping's linked entity (it has map presence
 * through the device it belongs to) — dismissed ones left out.
 *
 * Dismissed entities (AppConfig.dismissedEntityIds) are removed HERE rather
 * than at each list: this set is what every "is it on the map / does it
 * exist" surface reads (the unavailable-devices list, the room lists,
 * Facility readiness), so filtering once is what makes "Remove" mean the same
 * thing in all of them.
 */
export function effectiveMapped(
  sceneEntityIds: Iterable<string>, entityMap: Record<string, EntityMapping>, dismissed: IdSet,
): Set<string> {
  const out = new Set<string>();
  for (const id of sceneEntityIds) if (!dismissed.has(id)) out.add(id);
  for (const m of Object.values(entityMap)) {
    if (m.linkedEntityId && !dismissed.has(m.linkedEntityId)) out.add(m.linkedEntityId);
  }
  return out;
}

/** The entities a profile can see at all: hidden-in-HA and configuration/
 *  diagnostic ones left out, as HA's own auto-built dashboards do. The same
 *  object back when nothing is suppressed. */
export function visibleEntitiesOf(
  entities: Record<string, HassEntity>, suppressed: { has(id: string): boolean; size: number },
): Record<string, HassEntity> {
  if (suppressed.size === 0) return entities;
  const out: Record<string, HassEntity> = {};
  for (const [id, e] of Object.entries(entities)) if (!suppressed.has(id)) out[id] = e;
  return out;
}

/**
 * The devices a profile's lists may name: those its lists cover
 * (permissions.listedDevices — a guest's cover only what is on the map) AND
 * whose mapping its profile may see (category and type). An entity with no
 * mapping is judged by the first rule alone. No profile: nothing.
 */
export function visibleTo(
  role: Role | null,
  ctx: { mapped: IdSet; entityMap: Record<string, EntityMapping>; entities: Record<string, HassEntity> },
): IdSet {
  if (role === null) return { has: () => false };
  const listed = listedDevices(role, { has: () => true }, ctx.mapped);
  return {
    has: (id) => {
      if (!listed.has(id)) return false;
      const m = ctx.entityMap[id];
      return !m || isMappingAllowed(role, id, m, ctx.entities[id]);
    },
  };
}

/**
 * The devices a profile's long-press CATEGORY list shows: every mapped device
 * of that category the profile may see, dismissed ones out, and a hidden or
 * diagnostic one only while it is ON THE MAP (a UniFi AP's diagnostic
 * "State" sensor someone bound to a mesh stays; an orphan RSSI sensor does
 * not). Lived inline in the Dashboard, held to SummaryGroupPanel's own rules
 * by a comment (2.496.229).
 */
export function categoryMembers(
  role: Role | null, category: Category,
  ctx: {
    entityMap: Record<string, EntityMapping>; entities: Record<string, HassEntity>;
    dismissed: IdSet; suppressed: IdSet; mapped: IdSet;
    /** Hidden in the villa's system (VillaDevices.isHidden): never listed, placed on the map or not. */
    isHidden?: (id: string) => boolean;
    /** The device `id` belongs to (deviceGroups.deviceOf): a member of another device is that device's row. */
    deviceOf?: (id: string) => string;
  },
): string[] {
  if (role === null) return [];
  return Object.entries(ctx.entityMap)
    .filter(([id, mapping]) => {
      // ⚠️ THE VILLA'S DEVICES, AS THE COUNTS AND THE COCKPIT HAVE THEM (architecture review A, 2026-10-22): this list
      // had filters of its own — a device switched off in Advanced Settings, one hidden in the villa's system but
      // placed on the map, and each member of a device group were listed here and nowhere else.
      if (mapping.disabled) return false;
      if (ctx.isHidden?.(id)) return false;
      if (ctx.deviceOf && ctx.deviceOf(id) !== id) return false;
      if (ctx.dismissed.has(id)) return false;
      if (!isMappingAllowed(role, id, mapping, ctx.entities[id])) return false;
      if (effectiveCategory(subjectOf(id, mapping, ctx.entities[id])) !== category) return false;
      return !ctx.suppressed.has(id) || ctx.mapped.has(id);
    })
    .map(([id]) => id);
}
