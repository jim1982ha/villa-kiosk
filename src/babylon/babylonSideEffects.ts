// src/babylon/babylonSideEffects.ts
//
// THE one place this app declares which Babylon prototype patches it needs.
//
// ⚠️ THE HAZARD THIS EXISTS FOR IS INVISIBLE TO `tsc`, AND IT HAS BITTEN THIS
// REPO REPEATEDLY. Several Babylon APIs are declared on `Scene`/`Mesh` by the
// TYPES but implemented by a SIBLING module that patches the prototype when it
// is imported for its side effects. The base implementation is a stub:
// `Scene.prototype.createPickingRay` throws `_WarnImport("Ray")`, and
// `Scene.prototype.pick` quietly returns an empty `PickingInfo` after a console
// warning. The type checker sees a method that exists and says nothing.
//
// ⚠️ IT WAS DECLARED PER CALLER, AND TWO CALLERS HAD NOT DECLARED IT. Five
// separate modules each hand-wrote the import they happened to need, with a
// warning comment above it — and:
//
//   * `OverviewController` calls `scene.createPickingRay` (overview drag-pan)
//     and imported `Culling/ray` NOWHERE. It throws without the patch.
//   * `PickHandler` calls `scene.pick` for every tap in the villa and imported
//     it NOWHERE either. Without the patch nothing is tappable at all, and the
//     only symptom is a line in the console.
//
// Both worked only because five OTHER modules value-import `Ray`, so the
// sibling happened to be in the bundle. That is a guarantee resting on which
// unrelated file someone else chose to import — and the active refactor
// campaign is extracting ray-using code OUT of `SceneManager`, which is the
// day it stops being true.
//
// ⚠️ IMPORT THIS FILE, NOT THE SIBLINGS. One line to remember instead of five
// to get right, and `tests/oracles/babylon_side_effects.mjs` fails the build if
// a module calls a patched API without it. Costs nothing: every module below is
// already in the bundle.

// Scene.pick / pickWithRay / multiPick / multiPickWithRay / createPickingRay*,
// and Camera.getForwardRay.
import "@babylonjs/core/Culling/ray";
// Scene.beginAnimation / beginDirectAnimation.
import "@babylonjs/core/Animations/animatable";
// Mesh.renderOutline / renderOverlay / outlineWidth.
import "@babylonjs/core/Rendering/outlineRenderer";
// Scene.collisionCoordinator — camera collisions and gravity.
import "@babylonjs/core/Collisions/collisionCoordinator";
// Scene.createOrUpdateSelectionOctree.
import "@babylonjs/core/Culling/Octrees/octreeSceneComponent";
// The glTF/GLB loader plugin registration — same hazard, different registry:
// without it `SceneLoader` simply has no handler for the villa's own model.
import "@babylonjs/loaders/glTF";
