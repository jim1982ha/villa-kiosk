// src/babylon/sceneConfigPlan.ts
// What a config change asks of the 3D scene: which passes to run, decided
// from the previous and the next config alone. SceneManager.updateConfig runs
// the plan (yields, the superseded-call bail-outs, the calls themselves); the
// DECISION is here, where it can be driven by value.
//
// ⚠️ IT WAS 100 LINES OF KEY-BY-KEY CHECKS INSIDE SceneManager (round 10,
// 2.496.158), each shared key getting its content-compare guard only after its
// own field bug — teleportPoints was "the FOURTH shared key to need this"
// (4f5450dc, b22df376 fixed earlier ones) — with reference checks, a
// `hiddenCategories.join()` and an `entityDelta >= 5` re-teleport mixed in,
// testable only by reading SceneManager as text (scene_lifecycle.mjs).
//
// Pure: tests/oracles/scene_config_plan.mjs.

import type { AppConfig } from "@/config/AppConfig";
import { entityMapDelta, sliceChanged } from "./entityMapDiff";

export interface SceneConfigPlan {
  /** Tone mapping, SSAO, IBL, and the sun's lights (render look or location). */
  render: boolean;
  /** Only cosmetic per-entity fields changed: repaint the badge glyphs. */
  repaintBadges: boolean;
  /** The point-rooms (Rooms menu) are rebuilt. */
  roomPoints: boolean;
  /** Which mesh is which entity changed: re-index the meshes, re-apply the
   *  structure (with a loaded model). */
  structural: boolean;
  /** …and the plan→world room fit is recomputed. */
  recalibrate: boolean;
  /** …and the walker is moved to the corrected spawn. */
  reteleport: boolean;
  /** The blue "clickable" outlines are re-applied (with a loaded model). */
  highlight: boolean;
}

/** Entities added in one change beyond which the first spawn — computed from
 *  the old, sparse entityMap — is likely wrong (bulk auto-detection). */
export const RETELEPORT_ENTITY_DELTA = 5;

export function sceneConfigPlan(prev: AppConfig, next: AppConfig): SceneConfigPlan {
  // Config objects are recreated immutably by ConfigContext.update(), so a
  // reference change marks "this slice was touched" — for the slices only
  // this device edits. Every SHARED key is compared BY CONTENT: the
  // device-config sync hands back a freshly JSON-parsed copy on every focus
  // pull, never `===`, and a reference check bought a multi-second rebuild
  // for a config that did not change.
  const render = prev.render !== next.render || prev.latitude !== next.latitude || prev.longitude !== next.longitude;
  // A re-uploaded central .sh3d lands asynchronously (BabylonCanvas's central
  // SH3D refresh) and must re-run the room fit; parseRoomData returns fresh
  // arrays every open, so by content.
  const sh3d = sliceChanged(prev.sh3dRooms, next.sh3dRooms) || sliceChanged(prev.sh3dEntities, next.sh3dEntities);
  // Three outcomes, not two (entityMapDelta): a same-content replacement is
  // neither cosmetic NOR structural.
  const mapDelta = prev.entityMap === next.entityMap ? "identical" : entityMapDelta(prev.entityMap, next.entityMap);
  // Any REAL change to which mesh is which entity is structural; the same-
  // content guard is what matters (a no-op focus pull hands a new object).
  const bindings = sliceChanged(prev.meshBindings, next.meshBindings);
  const structural = mapDelta === "structural" || bindings || sh3d;
  const entityDelta = Object.keys(next.entityMap).length - Object.keys(prev.entityMap).length;
  // New entities improve the plan→world fit.
  const recalibrate = structural && (sh3d || entityDelta > 0);
  return {
    render,
    repaintBadges: mapDelta === "cosmetic" && !bindings && !sh3d,
    // teleportPoints by content (the fourth shared key to need it); eyeHeight
    // because the point-rooms READ it (a point stores the eye, the floor is
    // y − eyeHeight) — the slider left every glow at its old height.
    roomPoints: sliceChanged(prev.teleportPoints, next.teleportPoints) || prev.eyeHeight !== next.eyeHeight,
    structural,
    recalibrate,
    reteleport: recalibrate && entityDelta >= RETELEPORT_ENTITY_DELTA,
    // A disabled or rebound entity must lose or gain its outline.
    highlight: structural || prev.highlightInteractive !== next.highlightInteractive
      || sliceChanged(prev.hiddenCategories, next.hiddenCategories),
  };
}
