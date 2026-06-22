// src/babylon/LightingSystem.ts
// Scene lights: a directional "sun" + ambient, driven by SunController, plus a
// registry of per-entity light glows.

import {
  DirectionalLight, Vector3, Color3, type Scene,
} from "@babylonjs/core";

export class LightingSystem {
  readonly sunLight: DirectionalLight;
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
    this.sunLight = new DirectionalLight("sunLight", new Vector3(-0.4, -1, -0.6), scene);
    this.sunLight.intensity = 1.2;
    this.sunLight.diffuse = new Color3(1.0, 0.95, 0.8);
    this.sunLight.specular = new Color3(0.2, 0.2, 0.2);
  }

  setSun(direction: Vector3, intensity: number, diffuse: Color3): void {
    this.sunLight.direction = direction;
    this.sunLight.intensity = intensity;
    this.sunLight.diffuse = diffuse;
  }

  setAmbient(color: Color3): void {
    this.scene.ambientColor = color;
  }
}
