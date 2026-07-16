// src/babylon/LightPools.ts
// Baked-lighting villas render their structure UNLIT (see ModelLoader's
// BAKED_MATERIAL_PREFIX) — the walls/floor/ceiling ignore every dynamic
// light by design (that's what makes the baked look crisp and cheap), so a
// real PointLight is never even created for them (see EntityVisuals'
// bakedMode branch) and turning an HA light on never visibly brightens the
// room around it — only the fixture's own emissive glow shows.
//
// This fakes it: a soft, warm, ADDITIVE-blended radial "pool" laid flat on
// the floor under each fixture, sized from the light's range and
// coloured/dimmed from its live brightness + colour, visible only while the
// light is on. Standard trick for a static-baked environment that still
// needs a live light indicator — additive blending means it brightens
// whatever's beneath it instead of covering it like a normal decal would.

import {
  Mesh, MeshBuilder, StandardMaterial, DynamicTexture, Color3, Constants,
  type Vector3, type Scene,
} from "@babylonjs/core";

const POOL_TEXTURE_SIZE = 128;

/** Soft radial-alpha gradient, white fading to transparent — shared by every
 *  pool (each pool recolours it via its own material's emissive/alpha, not
 *  the texture itself, so one canvas draw serves the whole villa). */
let sharedTexture: DynamicTexture | null = null;
function poolTexture(scene: Scene): DynamicTexture {
  // A model reload creates a fresh Scene — a texture cached from the OLD one
  // is invalid there, so only reuse the cache when it still belongs to the
  // CURRENT scene, regenerating otherwise.
  if (sharedTexture && sharedTexture.getScene() === scene) return sharedTexture;
  const tex = new DynamicTexture("lightPoolGradient", POOL_TEXTURE_SIZE, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const c = POOL_TEXTURE_SIZE / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, POOL_TEXTURE_SIZE, POOL_TEXTURE_SIZE);
  tex.update(false);
  tex.hasAlpha = true;
  sharedTexture = tex;
  return tex;
}

export class LightPool {
  readonly mesh: Mesh;
  private material: StandardMaterial;

  /** `floorPosition` — where the pool sits (the caller has already found the
   *  floor below the fixture, e.g. by raycast, and offset it clear of
   *  z-fighting — see EntityVisuals' light-creation block for that logic,
   *  shared with the strip-drop placement). `radius` — the pool's
   *  world-space radius. */
  constructor(scene: Scene, name: string, floorPosition: Vector3, radius: number) {
    this.mesh = MeshBuilder.CreateDisc(`lightPool_${name}`, { radius, tessellation: 32 }, scene);
    this.mesh.rotation.x = Math.PI / 2; // CreateDisc builds facing +Z; lay it flat facing up
    this.mesh.position.copyFrom(floorPosition);
    this.mesh.isPickable = false;
    this.mesh.receiveShadows = false;

    this.material = new StandardMaterial(`lightPoolMat_${name}`, scene);
    this.material.diffuseTexture = poolTexture(scene);
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.emissiveColor = Color3.White();
    this.material.diffuseColor = Color3.Black(); // no contribution from scene lights, only emissive
    this.material.disableLighting = true; // reads its own colour regardless of sun/ambient/day-night
    this.material.specularColor = Color3.Black();
    this.material.backFaceCulling = false;
    // Additive: brightens whatever's beneath instead of covering it — the
    // whole point, since a normal alpha-blend decal would just paint a flat
    // circle over the (unlit) floor rather than reading as "lit".
    this.material.alphaMode = Constants.ALPHA_ADD;
    this.mesh.material = this.material;
    this.mesh.setEnabled(false);
  }

  /** `intensityFrac` — 0..1ish, typically the light's brightness fraction;
   *  scales the pool's overall opacity so a dimmed light casts a fainter pool. */
  setState(on: boolean, colour: Color3, intensityFrac: number): void {
    this.mesh.setEnabled(on);
    if (!on) return;
    this.material.emissiveColor = colour;
    this.material.alpha = Math.max(0.15, Math.min(1, intensityFrac));
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}
