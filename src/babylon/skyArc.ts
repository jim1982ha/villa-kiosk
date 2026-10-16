// src/babylon/skyArc.ts
// Putting a sky body (the sun's disc, the moon) on the overview's arc round
// the villa, through the camera — the Babylon half of skyBodies.ts, shared by
// SkyDome and NightSky so both follow ONE rule in the same frame.
//
// The point comes from skyBodies.arcPoint (no camera). The camera then only
// decides whether it is shown (behindFade) and, when the point is off screen,
// where it waits: at the edge on its true side, at the point's own depth, so
// the house still hides it where they meet (holdOnScreen).

import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { behindFade, GLOW_SPANS, holdOnScreen, type VillaBox, type Vec3 } from "./skyBodies";

/** A soft additive light round a body, so the sky is brightest on its side.
 *  Procedural (no image: the wall may have no internet). */
export interface Glow { mesh: Mesh; mat: StandardMaterial; tex: DynamicTexture }

export function makeGlow(scene: Scene, name: string, color: Color3): Glow {
  const tex = new DynamicTexture(`${name}Tex`, { width: 256, height: 256 }, scene, true);
  const g = tex.getContext() as CanvasRenderingContext2D;
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.25, "rgba(255,255,255,0.45)");
  gr.addColorStop(0.6, "rgba(255,255,255,0.12)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  tex.hasAlpha = true;
  tex.update();
  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.emissiveColor = color;
  mat.disableLighting = true;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.alphaMode = Constants.ALPHA_ADD;   // light added to the sky, never a grey film over it
  mat.backFaceCulling = false;
  mat.alpha = 0;
  const mesh = MeshBuilder.CreatePlane(name, { size: 1 }, scene);
  mesh.material = mat;
  mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  mesh.isPickable = false;
  mesh.applyFog = false;
  mesh.checkCollisions = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.setEnabled(false);
  return { mesh, mat, tex };
}

export function disposeGlow(g: Glow): void {
  g.mesh.dispose();
  g.mat.dispose();
  g.tex.dispose();
}

const FWD = new Vector3(0, 0, 1);
const fwd = new Vector3();

/**
 * Show `point` (skyBodies.arcPoint's `at`) for the active camera: how opaque
 * the body is from the viewer's side (0 when really behind), and where it is
 * drawn — the point, or, when that is off screen, the screen edge on its side
 * at the point's own depth. Null when there is no camera or the point is
 * behind it.
 */
export function showOnArc(scene: Scene, point: Vec3, side: { x: number; z: number }, alt: number):
  { at: Vector3; alpha: number; screen: { x: number; y: number }; held: boolean } | null {
  const cam = scene.activeCamera;
  if (!cam) return null;
  cam.getDirectionToRef(FWD, fwd);
  const alpha = behindFade(side, alt, fwd);
  const eng = scene.getEngine();
  const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
  const view = cam.getViewMatrix(), proj = cam.getProjectionMatrix();
  const p = new Vector3(point.x, point.y, point.z);
  const s = Vector3.Project(p, Matrix.Identity(), view.multiply(proj), vp);
  // Behind the camera a projection lands mirrored on screen: nothing to hold.
  if (!(s.z > 0 && s.z < 1)) return null;
  const h = holdOnScreen(s.x - vp.x, s.y - vp.y, vp.width, vp.height);
  const at = h.held
    ? Vector3.Unproject(new Vector3(h.x, h.y, s.z), vp.width, vp.height, Matrix.Identity(), view, proj)   // viewport-relative pixels
    : p;
  return { at, alpha, screen: { x: h.x / vp.width, y: h.y / vp.height }, held: h.held };
}

/** Put a body's disc and glow at `at`, sized from the villa. `plane` is the
 *  disc mesh's own size (the plane it was built with). */
export function drawOnArc(disc: Mesh, glow: Glow, at: Vector3, villa: VillaBox, plane: number, spans: number,
  alpha: number, glowPeak: number): void {
  disc.infiniteDistance = false;
  disc.position.copyFrom(at);
  disc.scaling.setAll((spans * villa.span) / plane);
  glow.mesh.position.copyFrom(at);
  glow.mesh.scaling.setAll(GLOW_SPANS * villa.span);
  glow.mat.alpha = alpha * glowPeak;
}
