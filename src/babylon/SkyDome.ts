// src/babylon/SkyDome.ts
// A sun-driven procedural sky so the view through windows reads as real sky/outside
// instead of a flat clear colour. Uses Babylon's atmospheric SkyMaterial driven by
// the same sun direction that lights the scene (SunController), so it tracks the
// villa's latitude/longitude and the time of day: blue by day, warm at dusk, deep
// blue at night. No texture assets required (SweetHome's sky never exports to GLB).

import { MeshBuilder, Color3, type Scene, type Mesh, type Vector3 } from "@babylonjs/core";
import { SkyMaterial } from "@babylonjs/materials/sky/skyMaterial";

export class SkyDome {
  private box: Mesh;
  private mat: SkyMaterial;

  constructor(scene: Scene) {
    const mat = new SkyMaterial("skyMaterial", scene);
    mat.backFaceCulling = false;     // we view it from the inside
    mat.useSunPosition = true;       // drive the sun from SunController, not inclination
    mat.turbidity = 8;               // haze: a touch of atmosphere without going milky
    mat.rayleigh = 2;                // blue scattering strength
    mat.mieCoefficient = 0.005;
    mat.mieDirectionalG = 0.8;
    mat.luminance = 1;
    this.mat = mat;

    // Large box, pinned to the camera so the horizon never moves relative to it.
    const box = MeshBuilder.CreateBox("skyBox", { size: 1000 }, scene);
    box.material = mat;
    box.infiniteDistance = true;     // always centred on the active camera
    box.isPickable = false;
    box.applyFog = false;
    box.checkCollisions = false;
    box.ignoreCameraMaxZ = true;     // never clipped by the camera far plane
    this.box = box;
  }

  /**
   * Update the sky from the scene's sun. `dirToScene` is the direction the sunlight
   * travels (sun → scene), exactly as SunController computes it, so the sun in the
   * sky sits opposite that direction.
   */
  update(dirToScene: Vector3, isDay: boolean): void {
    // Sun position points back toward the sun; scale it well outside the box.
    this.mat.sunPosition = dirToScene.scale(-300);
    // Night: drop the overall luminance so the sky reads as a dark deep-blue rather
    // than a bright daytime dome. SkyMaterial already darkens once the sun drops
    // below the horizon; this keeps the horizon from glaring at dusk/indoors.
    this.mat.luminance = isDay ? 1 : 0.35;
  }

  setEnabled(on: boolean): void {
    this.box.setEnabled(on);
  }

  dispose(): void {
    this.box.dispose();
    this.mat.dispose();
  }

  // Kept for callers that want a quick neutral tint reference (unused internally).
  static readonly NIGHT_TINT = new Color3(0.03, 0.04, 0.08);
}
