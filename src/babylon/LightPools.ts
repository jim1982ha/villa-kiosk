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
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import { earClipTriangulate, regularPolygon, type Pt2 } from "@/utils/geometry";

const POOL_TEXTURE_SIZE = 128;
/** Sides of the pool's own footprint when it is not clipped to a room. Eight
 *  bounds a disc far more tightly than a square while staying convex — which
 *  `clipPolygonToConvex` requires of the CLIP argument (see geometry.ts). The
 *  corners it leaves outside the disc land where the gradient is already fully
 *  transparent, so they cost a few transparent fragments and nothing else. */
const POOL_FOOTPRINT_SIDES = 8;

/**
 * The pool's own footprint, as a CONVEX polygon — the clip region to intersect
 * a room with (`clipPolygonToConvex` requires the CLIP to be convex; the room,
 * which may be L-shaped, is the subject).
 *
 * Sized by its INSCRIBED circle rather than its circumscribed one: at
 * circumradius `radius` an octagon's edge midpoints fall at 0.92·radius, where
 * the gradient still carries ~5% alpha, and that would print the octagon's
 * straight edges faintly onto the floor. Inflating by 1/cos(π/n) puts the whole
 * disc strictly inside, so the falloff reaches 0 before the boundary and the
 * polygon is never visible as a shape. The extra area is transparent
 * fragments — still far less than the old disc's full bounding square.
 */
export function poolFootprint(cx: number, cz: number, radius: number): Pt2[] {
  const circum = radius / Math.cos(Math.PI / POOL_FOOTPRINT_SIDES);
  return regularPolygon(cx, cz, circum, POOL_FOOTPRINT_SIDES);
}

/** Soft radial-alpha gradient, white fading to transparent — shared by every
 *  pool (each pool recolours it via its own material's emissive/alpha, not
 *  the texture itself, so one canvas draw serves the whole villa). */
let sharedTexture: DynamicTexture | null = null;
/** Alpha stops for the radial falloff, as (normalised radius, alpha) pairs —
 *  the same three points a `ctx.createRadialGradient` gradient would have
 *  used. Written out as data rather than a canvas gradient call: WebKit
 *  (Safari, and therefore every iOS browser — Apple mandates WebKit there)
 *  dithers canvas gradients to avoid 8-bit banding, which reads as visible
 *  coloured speckle/confetti once this 128px texture is stretched across a
 *  room-sized disc and additively blended — reported "especially on iOS"
 *  because that dithering is WebKit-specific, Chromium's canvas gradients
 *  don't do it. Computing alpha per-pixel ourselves is deterministic and
 *  identical on every engine, so there's nothing left for any browser to add
 *  noise to.
 */
const POOL_ALPHA_STOPS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.9], [0.45, 0.35], [1, 0],
];
function poolAlphaAt(normalisedDist: number): number {
  for (let i = 0; i < POOL_ALPHA_STOPS.length - 1; i++) {
    const [t0, a0] = POOL_ALPHA_STOPS[i];
    const [t1, a1] = POOL_ALPHA_STOPS[i + 1];
    if (normalisedDist <= t1) {
      const t = t1 === t0 ? 0 : (normalisedDist - t0) / (t1 - t0);
      return a0 + (a1 - a0) * t;
    }
  }
  return 0;
}
function poolTexture(scene: Scene): DynamicTexture {
  // A model reload creates a fresh Scene — a texture cached from the OLD one
  // is invalid there, so only reuse the cache when it still belongs to the
  // CURRENT scene, regenerating otherwise.
  if (sharedTexture && sharedTexture.getScene() === scene) return sharedTexture;
  const tex = new DynamicTexture("lightPoolGradient", POOL_TEXTURE_SIZE, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const size = POOL_TEXTURE_SIZE;
  const c = size / 2;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.min(1, Math.hypot(x - c, y - c) / c);
      const alpha = poolAlphaAt(dist);
      const idx = (y * size + x) * 4;
      img.data[idx] = 255;
      img.data[idx + 1] = 255;
      img.data[idx + 2] = 255;
      img.data[idx + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  tex.hasAlpha = true;
  // CLAMP, and this is load-bearing rather than tidiness. Since 2.300.0 a
  // pool's geometry is its ROOM clipped to its footprint, so a vertex can sit
  // anywhere in that room — including outside the gradient's own square, where
  // u or v leaves [0,1]. WRAP would tile the bright centre back into the far
  // corner of the room; CLAMP holds the rim, and the rim is alpha 0 by
  // construction (POOL_ALPHA_STOPS ends at 0). That is what lets the falloff
  // stay a per-FRAGMENT texture lookup on geometry as coarse as five vertices,
  // instead of needing the disc's 32 segments to carry it.
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
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
  /** The Y the floor probe was cast FROM (the fixture's own height), kept so
   *  the pool can be re-probed later without the caller having to remember
   *  where its fixture was — see EntityVisuals.reshapeLightPools, which re-asks
   *  once calibration lets the probe answer per room instead of per 4m cell. */
  probeFromY = 0;
  private material: StandardMaterial;

  /** `floorPosition` — where the pool sits (the caller has already found the
   *  floor below the fixture, e.g. by raycast, and offset it clear of
   *  z-fighting — see EntityVisuals' light-creation block for that logic,
   *  shared with the strip-drop placement). `radius` — the pool's
   *  world-space radius. `shape` — the world-space XZ polygon the pool should
   *  cover, normally its room clipped to its own footprint; omitted (the load
   *  path, before calibration has produced any room polygons) it falls back to
   *  the plain footprint, which is what every pool looked like before 2.300.0. */
  constructor(scene: Scene, name: string, floorPosition: Vector3, radius: number, shape?: Pt2[]) {
    this.mesh = new Mesh(`lightPool_${name}`, scene);
    this.mesh.position.copyFrom(floorPosition);
    this.applyShape(shape, radius);
    this.mesh.isPickable = false;
    this.mesh.receiveShadows = false;
    // Excluded from shadow casters / IBL surfaces exactly as the room glow's
    // meshes are — it is a marker, not villa geometry.
    this.mesh.metadata = { isMarker: true };

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

  /**
   * Rebuild the pool's footprint in place. Called once per pool after the
   * plan→world calibration lands (EntityVisuals.reshapeLightPools), never on a
   * state change — see `setState`, which is what a tap actually runs.
   *
   * `floorY` moves the pool onto its room's real floor at the same time,
   * because the calibrated room is also what makes the floor probe answer per
   * ROOM rather than per 4-metre cell (see floorProbe.ts) — the two halves of
   * the same fix, applied in one pass so a pool is never briefly correct in
   * shape and wrong in height.
   */
  reshape(shape: Pt2[] | undefined, radius: number, floorY?: number): void {
    if (floorY !== undefined) this.mesh.position.y = floorY;
    this.applyShape(shape, radius);
  }

  /**
   * Geometry in the pool's LOCAL frame (the fixture is the origin), so the mesh
   * keeps its world position and needs no rotation — vertices are laid straight
   * onto the XZ plane at y=0.
   *
   * The UVs are the whole trick: mapping local offset through the pool's own
   * diameter makes the shared radial gradient render an exact circular falloff
   * per FRAGMENT, whatever the triangulation looks like. A room clipped to an
   * octagon can come back as five vertices and still show a perfect radial
   * pool, where the old `CreateDisc` had to spend 32 segments carrying that
   * shape in geometry — and could not be clipped to a room at all.
   */
  private applyShape(shape: Pt2[] | undefined, radius: number): void {
    const pts = shape && shape.length >= 3
      ? shape
      : poolFootprint(this.mesh.position.x, this.mesh.position.z, radius);
    const tris = earClipTriangulate(pts);
    if (tris.length === 0) return; // degenerate sliver — keep whatever it had

    const cx = this.mesh.position.x, cz = this.mesh.position.z;
    const positions: number[] = [];
    const uvs: number[] = [];
    for (const p of pts) {
      positions.push(p.x - cx, 0, p.z - cz);
      uvs.push((p.x - cx) / (2 * radius) + 0.5, (p.z - cz) / (2 * radius) + 0.5);
    }
    const indices: number[] = [];
    for (const [a, b, c] of tris) indices.push(a, b, c);

    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.uvs = uvs;
    // Normals computed even though the material is `disableLighting` — a
    // handful of triangles per pool, and it keeps this identical to
    // RoomHighlight.buildMesh, the proven flat-polygon path in this codebase.
    // Not the place to shave a buffer: this project is verified from
    // screenshots on hardware, so a shader-permutation surprise costs a round
    // trip that the saving could never repay.
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    vd.normals = normals;
    // updatable: reshape() re-applies to this same mesh once the room polygons
    // land, and the vertex COUNT changes when it does.
    vd.applyToMesh(this.mesh, true);
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
