// src/babylon/WallDisplay.ts
// Render a live sensor value as a floating label in 3D near its mesh (3Dash
// "values on surfaces" idea). Uses a dynamic-texture plane billboarded to camera.

import {
  DynamicTexture, MeshBuilder, StandardMaterial, Color3, Vector3,
  type Mesh, type Scene, type AbstractMesh,
} from "@babylonjs/core";

interface WallLabel {
  plane: Mesh;
  texture: DynamicTexture;
}

export class WallDisplay {
  private scene: Scene;
  private labels = new Map<string, WallLabel>();
  private requestRender: () => void;

  constructor(scene: Scene, requestRender: () => void) {
    this.scene = scene;
    this.requestRender = requestRender;
  }

  /** Create or update a billboard label anchored above a sensor mesh. */
  set(entityId: string, anchor: AbstractMesh, text: string): void {
    let label = this.labels.get(entityId);
    if (!label) {
      const plane = MeshBuilder.CreatePlane(`label_${entityId}`, { width: 0.9, height: 0.35 }, this.scene);
      plane.billboardMode = 7; // BILLBOARDMODE_ALL
      plane.isPickable = false;
      const pos = anchor.getAbsolutePosition().clone();
      pos.y += 0.5;
      plane.position = pos;

      const texture = new DynamicTexture(`tex_${entityId}`, { width: 360, height: 140 }, this.scene, false);
      const mat = new StandardMaterial(`mat_${entityId}`, this.scene);
      mat.diffuseTexture = texture;
      mat.emissiveColor = new Color3(1, 1, 1);
      mat.opacityTexture = texture;
      mat.disableLighting = true;
      plane.material = mat;

      label = { plane, texture };
      this.labels.set(entityId, label);
    }
    this.draw(label.texture, text);
    this.requestRender();
  }

  private draw(texture: DynamicTexture, text: string): void {
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 360, 140);
    ctx.fillStyle = "rgba(20,14,8,0.78)";
    ctx.beginPath();
    const r = 24;
    ctx.roundRect?.(8, 8, 344, 124, r);
    ctx.fill();
    ctx.fillStyle = "#F5EDD8";
    ctx.font = "600 64px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 180, 74);
    texture.update();
  }

  remove(entityId: string): void {
    const label = this.labels.get(entityId);
    if (!label) return;
    label.texture.dispose();
    label.plane.dispose();
    this.labels.delete(entityId);
  }

  moveLabelAbove(entityId: string, anchor: AbstractMesh, yOffset = 0.5): void {
    const label = this.labels.get(entityId);
    if (!label) return;
    const pos = anchor.getAbsolutePosition().clone();
    pos.y += yOffset;
    label.plane.position = pos;
    void Vector3.Zero();
  }
}
