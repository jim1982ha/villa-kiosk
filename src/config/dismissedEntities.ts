// src/config/dismissedEntities.ts
// THE single definition of what "dismissed" means (see
// AppConfig.dismissedEntityIds), so every surface that can show an entity —
// Advanced Settings' auto-detected list, the unavailable-devices modal, the
// HUD's alert badge, Facility readiness — answers the question identically.
//
// It deliberately is NOT "is this id in the list": a dismissal only applies
// while Home Assistant still doesn't know the entity. Splitting that rule
// across callers is exactly how the two halves of this bug happened in the
// first place — one surface read entityMap (where removal worked) while
// another read mesh-derived ids (where it didn't), and they disagreed about
// the same device. One function, one answer.

import type { HassEntity } from "@/types/ha.types";

export function dismissedEntitySet(
  dismissedEntityIds: readonly string[],
  entities: Record<string, HassEntity>,
): Set<string> {
  return new Set(dismissedEntityIds.filter((id) => !entities[id]));
}

/**
 * Removing a device, as ONE operation that cannot be half-performed.
 *
 * ⚠️ THE RULE WAS CENTRALISED FOR READING AND SCATTERED FOR WRITING, AND THAT
 * IS HOW THE REPORTED BUG CAME BACK. `dismissedEntityIds` had exactly one
 * writer in the whole tree — Advanced Settings' banner, "N entities no longer
 * in Home Assistant → Remove N". The trash can on every row of the SAME table
 * deleted the `entityMap` row and recorded nothing, so the row vanished from
 * Settings and the device stayed in the Facility fault picker, the offline
 * count and readiness: precisely the symptom the banner path exists to end,
 * arriving through the other button on the same screen.
 *
 * Returning the whole patch is what makes that impossible to repeat — there is
 * no way to call this and get only the half that does not stick.
 *
 * Generic in the mapping so this module keeps importing nothing from
 * `AppConfig`; the two are read together everywhere and a cycle between them
 * would be gratuitous.
 */
export function forgetEntities<M>(
  entityMap: Record<string, M>,
  dismissedEntityIds: readonly string[],
  ids: readonly string[],
): { entityMap: Record<string, M>; dismissedEntityIds: string[] } {
  const nextMap = { ...entityMap };
  const dismissed = new Set(dismissedEntityIds);
  for (const id of ids) {
    delete nextMap[id];
    // Record the DECISION, not just its effect. These ids are also derived
    // from the model itself (a mesh named after the entity), so auto-detection
    // and every mesh-reading surface regenerate a row that was only deleted.
    dismissed.add(id);
  }
  return { entityMap: nextMap, dismissedEntityIds: [...dismissed] };
}
