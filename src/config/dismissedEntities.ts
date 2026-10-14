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

// ⚠️ THE MODEL IS THE GROUND TRUTH (owner, 2026-10-14). A 3D object named after an entity IS a device of this Kiosk:
// it is never removed here — not by "Remove N", not by a row's bin, not by an old dismissal on record. If Home
// Assistant does not have its entity, every surface says so ("Not in Home Assistant"); what changes it is the model
// (rename or delete the object) or a re-mapping (Bound 3D objects, "Point it there"). Until 2.496.348 a dismissal
// applied to such an object too: the map kept its badge while Needs attention and Settings' banner forgot it —
// "media_player.tv" was Unavailable on the map and nowhere else.

export function dismissedEntitySet(
  dismissedEntityIds: readonly string[],
  entities: Record<string, HassEntity>,
  /** The entities the loaded model names: never dismissed (see the note above). */
  sceneEntityIds: { has(id: string): boolean },
): Set<string> {
  return new Set(dismissedEntityIds.filter((id) => !entities[id] && !sceneEntityIds.has(id)));
}

/**
 * The 3D objects of the loaded model whose entity Home Assistant does not have, and that are not pointed at one it
 * has — every one, listed by Advanced Settings with "Point it there" (owner, 2026-10-14: the warning appeared only
 * when the exact id was typed in the search, and opening Settings showed nothing). Sorted, for a stable list.
 */
export function orphanObjects(
  sceneEntityIds: Iterable<string>,
  inHa: (id: string) => boolean,
  meshBindings: Readonly<Record<string, string>>,
): string[] {
  const out: string[] = [];
  for (const id of sceneEntityIds) {
    if (inHa(id)) continue;
    const bound = meshBindings[id];
    if (bound && inHa(bound)) continue;
    out.push(id);
  }
  return out.sort();
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
