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

// ── The same question for every shared key ──────────────────────────────────
// ⚠️ WHY THIS LIVES HERE AND NOT IN A NEW FILE (2026-09-06). The predicate
// below has to stay runtime-import-free, because that is the only reason this
// module can be tested at all — `npm run test:config-delta` is bare `node` with
// type stripping, no runner and no dependencies, exactly like geometry and
// placement. A new file importing `entityMapDelta` would have added the one
// import edge that ends that, so the classifier joins the classifier.

/** Has a shared config slice actually changed?
 *
 * ⚠️ REFERENCE FIRST, CONTENT SECOND, AND BOTH ARE LOAD-BEARING.
 * `DeviceConfigSync.pull()` runs on every window focus and visibilitychange and
 * hands back freshly `JSON.parse`d objects, so a shared key is `!==` its
 * predecessor on every no-op pull — a bare `!==` is a bug, never a fast path.
 * The reference check is not redundant with the content check: it is the cheap
 * exit for the overwhelmingly common case where nothing was pulled at all, and
 * without it every focus stringifies the whole entity map.
 *
 * This was fixed FOUR separate times in the field, once per key — `entityMap`,
 * then `meshBindings`, then `deviceGroups` (which disposed and recreated ~420
 * GUI controls on every focus), then `teleportPoints` — because each fix was
 * written at the site that had been reported rather than at the rule.
 */
export function sliceChanged(a: unknown, b: unknown): boolean {
  return a !== b && JSON.stringify(a) !== JSON.stringify(b);
}

// ⚠️ AN AGGREGATE `configDelta(prev, next)` WAS WRITTEN HERE AND DELETED THE
// SAME DAY (2026-09-06). It returned one verdict for every shared key at once,
// which reads well and had ZERO callers it could actually serve: the decision
// it was meant to own is `cosmeticOnly`, and that also depends on `sh3dChanged`
// — and `sh3dRooms`/`sh3dEntities` are deliberately NOT shared keys, so an
// aggregate over the shared set cannot answer the question the caller is
// asking. Shipping it anyway would have left a function whose interface was
// wider than any caller's need, which is the same shallow-interface defect as
// the `--space-*` scale that was deleted from `styles.css` on the same day for
// having no callers at all.
//
// `sliceChanged` is the part that earns its keep: one rule, five call sites.
// If a future caller does want the aggregate, the honest version takes the
// sh3d pair too — which would also pull the guard in `BabylonCanvas.tsx` back
// to the module whose invariant it is upholding.
