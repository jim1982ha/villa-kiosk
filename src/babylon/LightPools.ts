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

import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

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

/** Drop the module-level gradient cache. The texture object itself belongs to
 *  a Scene and is freed by that scene's dispose(); this just clears the stale
 *  module reference so it can't outlive its scene (holding a disposed texture
 *  alive) and so the next scene regenerates cleanly. Call from
 *  SceneManager.dispose(). */
export function resetLightPoolTextureCache(): void {
  sharedTexture = null;
}

export class LightPool {
  readonly mesh: Mesh;
  /** Per-pool brightness multiplier applied on top of the live intensity. 1 for
   *  a normal single-fixture pool; <1 for a strip's END pools (a light "sitting
   *  in" for the corner where two adjoining strips meet) — see EntityVisuals'
   *  light-creation block, where an elongated strip gets a full-intensity pool
   *  at its centre plus two half-intensity pools at its ends, so two adjoining
   *  strips' end-pools sum to roughly the centre's brightness at the shared
   *  corner instead of leaving it dark (or, if both ends were left at 1,
   *  doubling up into a hotspot there). */
  intensityScale = 1;
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

  /** `intensityFrac` — the light's brightness fraction × the user's "Light
   *  effect strength" setting, so a dimmed light casts a fainter pool and the
   *  slider has real range. Not clamped to 1: in ADDITIVE blending a value
   *  above 1 genuinely brightens/saturates the pool further rather than just
   *  "more opaque", so the slider keeps working past that point. */
  setState(on: boolean, colour: Color3, intensityFrac: number): void {
    this.mesh.setEnabled(on);
    if (!on) return;
    this.material.emissiveColor = colour;
    this.material.alpha = Math.min(2, Math.max(0.15, intensityFrac) * this.intensityScale);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}
