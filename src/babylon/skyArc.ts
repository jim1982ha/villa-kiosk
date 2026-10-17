// src/babylon/skyArc.ts
// The Babylon half of skyBodies.ts, shared by SkyDome (the sun) and NightSky
// (the moon): the camera read as numbers for skyBodies.placeBodies (viewOf),
// and a body's disc and glow painted where it says (drawOnArc).

import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { GLOW_SPANS, type SkyView, type VillaBox } from "./skyBodies";

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

/** The active camera as skyBodies.placeBodies takes it; null without one. */
export function viewOf(scene: Scene): SkyView | null {
  const cam = scene.activeCamera;
  if (!cam) return null;
  const forward = new Vector3();
  cam.getDirectionToRef(FWD, forward);
  const eng = scene.getEngine();
  return {
    eye: cam.globalPosition, forward,
    view: cam.getViewMatrix(), projection: cam.getProjectionMatrix(),
    viewport: cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight()),
  };
}

/** Put a body's disc and glow where placeBodies says, sized from the villa
 *  and scaled for its drawn depth. `plane` is the disc mesh's own size (the
 *  plane it was built with). */
export function drawOnArc(disc: Mesh, glow: Glow, shown: { at: Vector3; scale: number }, villa: VillaBox, plane: number,
  spans: number, alpha: number, glowPeak: number): void {
  disc.infiniteDistance = false;
  disc.position.copyFrom(shown.at);
  disc.scaling.setAll((spans * villa.span * shown.scale) / plane);
  glow.mesh.position.copyFrom(shown.at);
  glow.mesh.scaling.setAll(GLOW_SPANS * villa.span * shown.scale);
  glow.mat.alpha = alpha * glowPeak;
}
