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
 *  category or linked/motion entity — each of which re-indexed the whole
 *  model per commit for no visual benefit. Generalising the list is what makes
 *  those edits feel instant too. (Room used to be here too — it's no longer a
 *  field on EntityMapping at all, see the type's own comment.)
 *
 *  Adding a field here is a promise that NOTHING in the structural pass reads
 *  it. linkedEntityId/motionEntityId only qualify because EntityVisuals
 *  .updateConfig rebuilds their lookup indexes itself on any entityMap change
 *  (they were previously built only by indexMeshes) — if you add a field whose
 *  consumer lives in the structural pass, give it the same treatment first. */
export const COSMETIC_MAPPING_FIELDS = [
  "label", "category", "badgeColor",
  "linkedEntityId", "motionEntityId", "lightIntensityRatio",
  // requireConfirm is read only by utils/quickAction.ts's isQuickToggle
  // (plain JS against config.entityMap, outside the Babylon scene entirely)
  // and PowerToggle's own React props — it never reaches indexMeshes/
  // EntityVisuals, so it qualifies exactly like the fields above it.
  "requireConfirm",
] as const;

/** How much work an entityMap replacement actually requires.
 *
 *  Three outcomes, not two, and the third is the important one: a replacement
 *  can be a NEW OBJECT WITH IDENTICAL CONTENT. That is not a rare edge case —
 *  DeviceConfigSync pulls the shared config on every window focus and parses
 *  fresh JSON, so a no-op replacement arrives every time the app is focused.
 *
 *  The earlier boolean form answered "cosmetic?" and returned false for that
 *  case (nothing cosmetic had changed), which the caller read as "structural"
 *  and paid a full multi-second indexMeshes for a config that had not changed
 *  at all. Telemetry caught it: five full re-indexes in ninety seconds of
 *  idle use, two of them one second apart. */
export type EntityMapDelta = "identical" | "cosmetic" | "structural";

/** Classify a replacement. "cosmetic" means identical key sets with every
 *  structural field equal and at least one COSMETIC_MAPPING_FIELD changed;
 *  "identical" means no field differs anywhere. */
export function entityMapDelta(
  a: Record<string, EntityMapping>,
  b: Record<string, EntityMapping>,
): EntityMapDelta {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return "structural";
  let cosmeticChanged = false;
  for (const k of ak) {
    const ea = a[k], eb = b[k];
    if (!eb) return "structural";        // key set differs
    if (ea === eb) continue;             // untouched entry, cheap identity skip
    const ra: Record<string, unknown> = { ...ea };
    const rb: Record<string, unknown> = { ...eb };
    for (const f of COSMETIC_MAPPING_FIELDS) {
      if (ra[f] !== rb[f]) cosmeticChanged = true;
      delete ra[f];
      delete rb[f];
    }
    if (JSON.stringify(ra) !== JSON.stringify(rb)) return "structural";
  }
  return cosmeticChanged ? "cosmetic" : "identical";
}
