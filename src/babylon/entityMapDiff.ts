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

// ── The aggregate ───────────────────────────────────────────────────────────
// ⚠️ THE SECOND ATTEMPT, AND THE FIRST ONE'S EPITAPH IS WHY THIS SHAPE.
// A `configDelta(prev, next)` was written here and deleted the same day
// (2026-09-06): it aggregated over the SHARED keys only, and the decision it
// was meant to own — `cosmeticOnly` — also depends on `sh3dChanged`, while
// `sh3dRooms`/`sh3dEntities` are deliberately NOT shared keys. An aggregate
// over the shared set could not answer the question its caller was asking, so
// it had zero callers it could serve and was rightly deleted.
//
// That comment named the honest version: "takes the sh3d pair too — which
// would also pull the guard in BabylonCanvas.tsx back to the module whose
// invariant it is upholding". This is that version. It takes the whole config
// pair, not a slice of it, which is what lets it answer every question both
// `updateConfig` bodies were asking privately.

/** The fields a scene config delta reads. Structurally satisfied by
 *  `AppConfig` — declared here rather than imported so this module keeps no
 *  runtime import, which is the only reason `npm run test:config-delta` can
 *  load it with bare `node`. */
export interface SceneConfigSlice {
  render: unknown;
  latitude: unknown;
  longitude: unknown;
  sh3dRooms?: unknown;
  sh3dEntities?: unknown;
  entityMap: Record<string, EntityMapping>;
  meshBindings: unknown;
  teleportPoints: unknown;
  eyeHeight: unknown;
  deviceGroups: unknown;
  badgeStyle?: unknown;
  highlightInteractive: unknown;
  hiddenCategories: readonly string[];
}

/** What a config replacement actually costs, in named bits. */
export interface SceneConfigDelta {
  /** How much work the entityMap replacement requires. */
  mapDelta: EntityMapDelta;
  /** Lighting inputs moved — re-run the render pass and the sun. */
  renderChanged: boolean;
  /** A freshly (re)uploaded central .sh3d landed — recalibrate rooms. */
  sh3dChanged: boolean;
  /** Which mesh is which entity changed. Always structural. */
  meshBindingsChanged: boolean;
  /** A cheap glyph repaint is enough: nothing structural moved. */
  cosmeticOnly: boolean;
  /** The multi-second indexMeshes re-clone/relight pass is required. */
  structuralChanged: boolean;
  /** Point-room glows must be rebuilt (the points moved, or the eye height
   *  they are stored against did). */
  roomPointsChanged: boolean;
  /** The interactive outline set changed. */
  highlightChanged: boolean;
  /** A device group was created or edited — badges appear/disappear. */
  groupsChanged: boolean;
  /** The badge geometry switched between pill and card. */
  badgeStyleChanged: boolean;
}

/**
 * Classify a whole config replacement.
 *
 * ⚠️ EVERY BIT HERE WAS A SEPARATE FIELD DEFECT, and each was fixed at the site
 * that had been reported rather than at the rule — which is how the same bug
 * came back four times under four different keys. The narratives:
 *
 *  • `mapDelta` / `meshBindingsChanged` / `groupsChanged` / `roomPointsChanged`
 *    all need same-CONTENT comparison, not same-reference: `DeviceConfigSync
 *    .pull()` hands back freshly parsed objects on every window focus and
 *    visibilitychange. A bare `!==` reports "changed" forever. Telemetry caught
 *    the entityMap case as five full re-indexes in ninety seconds of idle use.
 *  • `roomPointsChanged` includes `eyeHeight` because `syncRoomPoints` READS
 *    it — a point stores the eye position, so moving the Settings slider used
 *    to leave every point-room glow at its old height until a reload.
 *  • `cosmeticOnly` is the reason this function takes the whole config rather
 *    than the shared keys: it depends on `sh3dChanged`, and the sh3d pair is
 *    not a shared key. That mismatch is what killed the first attempt.
 *  • `sh3dChanged` compares by reference on purpose. The central .sh3d is
 *    replaced wholesale by an async refetch, never mutated in place, and it is
 *    large enough that stringifying it on every focus would cost more than the
 *    recalibration it is trying to avoid.
 */
export function sceneConfigDelta(
  prev: SceneConfigSlice, next: SceneConfigSlice,
): SceneConfigDelta {
  const renderChanged =
    prev.render !== next.render ||
    prev.latitude !== next.latitude ||
    prev.longitude !== next.longitude;

  const sh3dChanged =
    prev.sh3dRooms !== next.sh3dRooms || prev.sh3dEntities !== next.sh3dEntities;

  const mapDelta: EntityMapDelta = prev.entityMap === next.entityMap
    ? "identical"
    : entityMapDelta(prev.entityMap, next.entityMap);

  const meshBindingsChanged = sliceChanged(prev.meshBindings, next.meshBindings);

  return {
    mapDelta,
    renderChanged,
    sh3dChanged,
    meshBindingsChanged,
    cosmeticOnly: mapDelta === "cosmetic" && !meshBindingsChanged && !sh3dChanged,
    structuralChanged: mapDelta === "structural" || meshBindingsChanged || sh3dChanged,
    roomPointsChanged:
      sliceChanged(prev.teleportPoints, next.teleportPoints)
      || prev.eyeHeight !== next.eyeHeight,
    highlightChanged:
      prev.highlightInteractive !== next.highlightInteractive
      || prev.hiddenCategories.join() !== next.hiddenCategories.join(),
    groupsChanged: sliceChanged(prev.deviceGroups, next.deviceGroups),
    badgeStyleChanged: prev.badgeStyle !== next.badgeStyle,
  };
}
