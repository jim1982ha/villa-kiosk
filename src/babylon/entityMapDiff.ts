// src/babylon/entityMapDiff.ts
// Classifies an entityMap edit as COSMETIC (cheap badge repaint) or STRUCTURAL
// (full indexMeshes re-clone/relight pass). Pure — no Babylon, no scene state —
// so it lives outside SceneManager and can be reasoned about (and tested) on
// its own.

import type { EntityMapping } from "@/types/scene.types";

/** EntityMapping fields that do NOT affect how meshes resolve to entities, so
 *  editing one needs only a cheap badge repaint — never the multi-second
 *  indexMeshes re-clone/relight pass.
 *
 *  indexMeshes()/applyStructure() read exactly two things: WHICH entity a mesh
 *  binds to, and whether that binding is live. So the structural inputs are the
 *  key set, `type` (drives mesh-name inference and the RBAC denied-type gate)
 *  and `disabled` (a hidden device loses its badge/outline/pickability) —
 *  everything listed here is presentation or wiring that later passes read
 *  straight off config instead.
 *
 *  This started life as a badgeColor-only special case (a colour pick felt
 *  laggy in the picker modal). The same several-second hitch applied to every
 *  OTHER cosmetic edit in Advanced Settings — renaming a device, changing its
 *  room, category or linked/motion entity — each of which re-indexed the whole
 *  model per commit for no visual benefit. Generalising the list is what makes
 *  those edits feel instant too.
 *
 *  Adding a field here is a promise that NOTHING in the structural pass reads
 *  it. linkedEntityId/motionEntityId only qualify because EntityVisuals
 *  .updateConfig rebuilds their lookup indexes itself on any entityMap change
 *  (they were previously built only by indexMeshes) — if you add a field whose
 *  consumer lives in the structural pass, give it the same treatment first. */
export const COSMETIC_MAPPING_FIELDS = [
  "label", "room", "category", "badgeColor",
  "linkedEntityId", "motionEntityId", "lightIntensityRatio",
] as const;

/** True when two entityMaps differ ONLY in COSMETIC_MAPPING_FIELDS: identical
 *  key sets, every structural field equal, and at least one cosmetic field
 *  actually changed. Lets updateConfig route such an edit to a cheap badge
 *  repaint instead of a full structural re-index. */
export function cosmeticOnlyDiff(
  a: Record<string, EntityMapping>,
  b: Record<string, EntityMapping>,
): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  let cosmeticChanged = false;
  for (const k of ak) {
    const ea = a[k], eb = b[k];
    if (!eb) return false;               // key set differs -> structural
    if (ea === eb) continue;             // untouched entry, cheap identity skip
    const ra: Record<string, unknown> = { ...ea };
    const rb: Record<string, unknown> = { ...eb };
    for (const f of COSMETIC_MAPPING_FIELDS) {
      if (ra[f] !== rb[f]) cosmeticChanged = true;
      delete ra[f];
      delete rb[f];
    }
    if (JSON.stringify(ra) !== JSON.stringify(rb)) return false; // structural field changed
  }
  return cosmeticChanged;
}
