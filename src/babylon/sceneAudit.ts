// src/babylon/sceneAudit.ts
// How many draw calls does this villa NEED, and how many is it paying for?
//
// ── The measurement this exists to make ────────────────────────────────────
// A controlled comparison (same Mac, same build, same overview) put Safari at
// 33ms inside scene.render() against Chrome's 7.2ms while Chrome was drawing
// 2.9x the pixels. Every per-pixel and per-object family has been eliminated
// by measurement rather than argument: fill rate (a quarter of the pixels, no
// faster), geometry (the fastest burst had the most triangles), culling
// (evalMs is 2ms on both), and multi-pass lighting (drawCalls/activeMeshes has
// been exactly 1.00 since 2.265.0). What is left is per-DRAW-CALL cost —
// 69us on Safari against 14.9us on Chrome — which is inside the browser's
// WebGL implementation and not ours to change.
//
// The only lever left is the NUMBER of draw calls. And since the ratio is 1.00,
// that means the number of drawn meshes: a villa draws one call per mesh, and
// this villa imports around 855 of them.
//
// ── Why this is a measurement and not a fix ────────────────────────────────
// The obvious fix — merge meshes that share a material — is only worth doing
// if the meshes actually DO share materials, and the one number available so
// far says they may not: 856 materials for 855 meshes, i.e. no sharing at all.
// If that holds, merging buys nothing until the materials are deduplicated
// first, and deduplicating is a pipeline change.
//
// Six perf hypotheses in this app's history have been argued from plausibility
// and disproved by measurement, three of them mine. So this ships the number
// first. `dcProjected` is the whole point: what the draw count WOULD be if
// every safely-mergeable bucket were merged. If it is close to `dcDrawn`,
// merging is not the lever and the search moves on. If it is a fraction of it,
// the next release has a target and a predicted result to check itself against.
//
// ── What "safely mergeable" means ──────────────────────────────────────────
// Merging destroys per-mesh identity, and several subsystems depend on it. A
// mesh may only join a bucket if losing its own identity changes nothing:
//
//   * it is not bound to an entity (picking, state visuals, pose variants);
//   * it is not individually toggled — FloorManager drives `setEnabled` per
//     storey and applyStructure hides ceilings with `isVisible`, so storey and
//     current visibility are part of the bucket key rather than something to
//     merge across;
//   * it shares a MATERIAL INSTANCE, a rendering group and a culling/blending
//     mode with the rest of its bucket, because a merged mesh has exactly one
//     of each.
//
// Bucketing by those keys is what makes the projection honest: it is what a
// merge could actually achieve, not an upper bound that ignores the app.

import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { resolveMeshToMapping } from "@/config/EntityMap";
import { structureRole } from "./meshRoles";
import type { AppConfig } from "@/config/AppConfig";

/** Ceiling for the signature walk. A villa with more distinct materials than
 *  this has already answered the question (there is nothing to share), and the
 *  audit must never become a load cost of its own. */
const MAX_SIGNATURE_SCAN = 4000;

type MatLike = Partial<{
  id: string;
  alpha: number;
  transparencyMode: number | null;
  backFaceCulling: boolean;
  needAlphaBlending: () => boolean;
  unlit: boolean;
  metallic: number | null;
  roughness: number | null;
  albedoColor: { r: number; g: number; b: number };
  emissiveColor: { r: number; g: number; b: number };
  albedoTexture: unknown;
  emissiveTexture: unknown;
  bumpTexture: unknown;
  lightmapTexture: unknown;
  getClassName: () => string;
}>;

/** Identity of the decoded IMAGE behind a texture slot, not of the texture
 *  object. Babylon builds one Texture per material slot but shares the
 *  InternalTexture behind it (see ModelLoader's de-duplication note), so
 *  comparing the objects would report every material as distinct even when
 *  they all point at the same atlas. */
function imageKey(tex: unknown): string {
  if (!tex) return "-";
  const t = tex as { getInternalTexture?: () => object | null; uniqueId?: number };
  const internal = t.getInternalTexture?.();
  if (!internal) return `t${t.uniqueId ?? "?"}`;
  const withId = internal as { uniqueId?: number };
  return `i${withId.uniqueId ?? "?"}`;
}

const rgb = (c?: { r: number; g: number; b: number }): string =>
  c ? `${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)}` : "-";

/**
 * What makes two materials INTERCHANGEABLE — i.e. what would have to be equal
 * for one instance to replace the other with no visible difference.
 *
 * Deliberately conservative: any property not listed here is assumed to differ,
 * so this UNDER-reports the sharing opportunity rather than promising one that
 * does not exist. An over-optimistic number here would send the next release
 * after a saving that isn't there.
 */
function materialSignature(mat: MatLike): string {
  return [
    mat.getClassName?.() ?? "?",
    rgb(mat.albedoColor),
    rgb(mat.emissiveColor),
    mat.metallic ?? "-",
    mat.roughness ?? "-",
    mat.alpha ?? 1,
    mat.transparencyMode ?? "-",
    mat.backFaceCulling ? 1 : 0,
    mat.unlit ? 1 : 0,
    imageKey(mat.albedoTexture),
    imageKey(mat.emissiveTexture),
    imageKey(mat.bumpTexture),
    imageKey(mat.lightmapTexture),
  ].join("|");
}

export interface DrawCallAudit {
  /** Meshes with geometry that are currently enabled and visible — the ones
   *  actually costing a draw call. */
  dcDrawn: number;
  /** Distinct material INSTANCES among them. */
  dcMats: number;
  /** Distinct material SIGNATURES among those instances. The gap between this
   *  and dcMats is what a deduplication pass would collapse; equal values mean
   *  the materials genuinely all differ and there is nothing to share. */
  dcMatSig: number;
  /** Drawn meshes that cannot be merged because something addresses them
   *  individually (entity-bound, or otherwise identity-carrying). */
  dcFixed: number;
  /** Buckets the remaining meshes fall into — one merged mesh per bucket. */
  dcBuckets: number;
  /** Draw calls after a merge: dcBuckets + dcFixed. THE number. */
  dcProjected: number;
  /** Same, if materials were deduplicated by signature FIRST. Reported
   *  separately because the two are different pieces of work — one is a scene
   *  pass, the other is a pipeline change — and only this says whether the
   *  second is worth asking for. */
  dcProjectedDedup: number;
}

/**
 * Walk the loaded meshes once and report what the draw count could be.
 *
 * Pure measurement: nothing here mutates the scene. Runs after the reveal, so
 * its cost is never in front of the user, and it is O(meshes) with a couple of
 * string builds per material.
 */
export function auditDrawCalls(
  meshes: readonly AbstractMesh[],
  config: AppConfig,
): DrawCallAudit {
  const matSigs = new Map<string, string>(); // material id -> signature
  const mats = new Set<string>();
  const sigs = new Set<string>();
  /** Bucket key -> count, for the merge projection. */
  const buckets = new Set<string>();
  const bucketsDedup = new Set<string>();
  let drawn = 0;
  let fixed = 0;

  for (const m of meshes) {
    if (!m.isEnabled(false) || !m.isVisible) continue;
    if ((m.getTotalVertices?.() ?? 0) === 0) continue;
    drawn++;

    const mat = m.material as MatLike | null;
    const matId = mat?.id ?? "none";
    mats.add(matId);
    let sig = matSigs.get(matId);
    if (sig === undefined && mat && matSigs.size < MAX_SIGNATURE_SCAN) {
      sig = materialSignature(mat);
      matSigs.set(matId, sig);
      sigs.add(sig);
    }

    // Identity-carrying: something in the app addresses this mesh on its own,
    // so merging it away would break picking, a pose variant or a state visual.
    const bound = resolveMeshToMapping(
      m.name, config.entityMap, config.meshBindings, config.deniedTypes,
    );
    if (bound || m.isPickable) { fixed++; continue; }

    // Storey and current visibility are part of the KEY, not something to
    // merge across — FloorManager toggles by storey and applyStructure hides
    // ceilings independently. Rendering group and blending mode must match
    // because a merged mesh has exactly one of each.
    const role = structureRole(m);
    const blend = mat?.needAlphaBlending?.() ? 1 : 0;
    const common = `${role.level}|${role.isExterior ? 1 : 0}|${m.renderingGroupId}|${blend}`;
    buckets.add(`${common}|${matId}`);
    bucketsDedup.add(`${common}|${sig ?? matId}`);
  }

  return {
    dcDrawn: drawn,
    dcMats: mats.size,
    dcMatSig: sigs.size,
    dcFixed: fixed,
    dcBuckets: buckets.size,
    dcProjected: buckets.size + fixed,
    dcProjectedDedup: bucketsDedup.size + fixed,
  };
}

/** Materials the scene holds that NOTHING draws. Reported alongside the audit
 *  because 856 materials against 855 meshes is the figure that prompted all of
 *  this, and part of the answer may simply be that some are unused — a
 *  different and much cheaper problem than an unshared one. */
export function countOrphanMaterials(scene: Scene, meshes: readonly AbstractMesh[]): number {
  const used = new Set<string>();
  for (const m of meshes) if (m.material) used.add(m.material.id);
  let orphans = 0;
  for (const mat of scene.materials) if (!used.has(mat.id)) orphans++;
  return orphans;
}
