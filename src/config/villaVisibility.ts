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

interface IdSet { has(id: string): boolean }

/**
 * The entities that are ON THE MAP: every entity a 3D object stands for,
 * plus every mapping's linked and motion entity (they have map presence
 * through the device they belong to) — dismissed ones left out.
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
    if (m.motionEntityId && !dismissed.has(m.motionEntityId)) out.add(m.motionEntityId);
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
