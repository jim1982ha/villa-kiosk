// src/babylon/bulbSet.ts
// Every bulb in the villa and every light it gives — one module.
//
// ⚠️ ONE BULB'S LIGHT WAS DECIDED IN FIFTEEN PLACES IN EntityVisuals, AND THEY
// DISAGREED. Its brightness had four rules (the PointLight, written twice and
// divided among the entity's bulbs; the floor pool and the furniture light,
// not divided; the emissive); "is it a strip" had three tests; its on/off had
// two — a pool went dark with its hidden storey, the PointLight did not; the
// slider's value was held twice. 2.496.73, .75 and .77 were each that
// disagreement surfacing somewhere new. Architecture review, round 3.
//
// A bulb is one fixture mesh. Its OWN look, in every mode: it glows its light's
// colour while on, and goes window-glass translucent while off (OFF_ALPHA).
// What it gives, by render mode:
//   * a PointLight (every mode) — the room's real light on an unbaked villa;
//     on a lightmapped one it is kept off every glowing mesh (glowEverythingLit)
//     and lights only what the glow leaves out: glass, the fixtures, non-PBR;
//   * floor pools (baked villas — LightPoolSet);
//   * the furniture light (lightmapped villas — lampGlow.ts, fed from the pools);
//   * a cube shadow map, while on, where the walls' shadows are not baked
//     (setCastShadows) — one per entity, on its first bulb's light.
//
// ⚠️ THE LOOK AND THE SHADOW STAYED IN EntityVisuals AFTER ROUND 3, and the two
// repaint paths there disagreed: a state change set the fixture's glow, the
// light and the shadow map; the first paint set the glow and the light and
// forgot the shadow — a light already on at load cast none until it was
// toggled. A floor switch had to remember two calls. `show` is all of it now.
//
// The rules, once:
//  * a bulb is ON when its entity is on AND its storey is shown (the mesh is
//    enabled) — for every output, and again after every floor switch;
//  * a bulb is a STRIP when its longest side is STRIP_MIN_LENGTH or more; a
//    strip's light is lowered toward what is below (so it prints no hotspot
//    on its own ceiling) and, when horizontal, its pools sit at its centre and
//    both ends;
//  * an entity whose every bulb is a strip shares ONE PointLight (a cove is
//    one wash, not four hotspots);
//  * a PointLight is one fixture's worth of light shared among the entity's
//    distinct PointLights (twelve markers must not blow out to white); a pool,
//    and the furniture light it feeds, is per bulb (poolStrength);
//  * the slider scales all of them, and is held here once.
//
// Interface: addFixture (load), mergeStrips + glowEverythingLit (end of the
// load), show (a state change, and the first paint), setStrength (slider),
// resync (floor switch, or anything else that changes an input without a state
// event — it redraws the shadow maps too), invalidateShadows (a pose swap
// changed what occludes), setRooms (calibration), syncGlow (before a frame),
// clear (unload).

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Material } from "@babylonjs/core/Materials/material";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
// ⚠️ THE SIDE EFFECT ShadowGenerator NEEDS, AND NOTHING IMPORTED IT: `new
// ShadowGenerator` throws "ShadowGeneratorSceneComponent needs to be imported"
// without it, and tsc cannot see that. No file in src had it, so on a villa
// whose walls' shadows are not baked (lightingMode.lightShadows) the first
// light turned on threw out of EntityVisuals.apply — latent on this villa,
// which is baked. Found by driving BulbSet in tests/oracles/bulb_set.mjs.
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
// For its REFRESHRATE_* constants (see castShadow). Adds nothing to the bundle
// — ShadowGenerator already pulls this module in.
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { LightPoolSet, type LightReading, type PoolFloorProbe, type PoolRoom } from "./lightPoolSet";
import { attachLampGlow, hasLampGlow, lampGlowFor, LAMP_GLOW_MAX, BULB_REACH_M } from "./lampGlow";
import { isHelperMesh } from "./meshRoles";
import type { Storeys } from "./storeys";

/** The bulbs' own warm white — a fixture's baseline glow and a PointLight's
 *  colour before a state has named one. */
export const WARM_GLOW = new Color3(1.0, 0.89, 0.63);
/** One fixture's worth of PointLight, at full brightness and slider 1. */
const MAX_LIGHT_INTENSITY = 1.3;
/** Metres — a fixture mesh with a side this long is a strip. */
export const STRIP_MIN_LENGTH = 1.5;
/** A strip's PointLight is lowered this fraction of the way to what is below… */
const STRIP_DROP_FRACTION = 0.45;
/** …by at most this much, so a tall room does not put it at knee height. */
const STRIP_DROP_MAX = 1.1;
/** Below this, a strip is already near what it lights and is not lowered. */
const STRIP_DROP_MIN_GAP = 0.3;
/**
 * An OFF bulb's material alpha: slightly clearer than window glass (0.38).
 * Every light fixture mesh — marker sphere, inflated strip, a modelled bulb
 * from the catalog — reads "off" the instant HA says so, by TYPE, never by
 * guessing which meshes look like stand-ins. Material alpha + ALPHABLEND, not
 * mesh.visibility: the fixture's material forces depth writes (EntityVisuals'
 * index pass), without which Babylon sorts it against the glass walls per frame
 * and it flickers. Transparency does not affect picking, so an off strip stays
 * clickable. On restores alpha 1 + OPAQUE, byte-identical to no treatment.
 */
export const OFF_ALPHA = 0.25;
/** One cube shadow map's face size, per lit entity. */
const SHADOW_MAP_SIZE = 256;

/** One light entity's current reading and its bulbs. `reading.on` is the
 *  entity's own — the storey is folded in here, per bulb. */
export interface BulbReading { meshes: readonly AbstractMesh[]; reading: LightReading }

/** What the bulbs need from the floor: one downward probe. FloorProbe. */
export type BulbFloorProbe = PoolFloorProbe;

interface StripShape { strip: boolean; horizontal: boolean }

/** THE strip rule. */
function stripShape(mesh: AbstractMesh): StripShape {
  const bb = mesh.getBoundingInfo().boundingBox;
  const size = bb.maximumWorld.subtract(bb.minimumWorld);
  return {
    strip: Math.max(size.x, size.y, size.z) >= STRIP_MIN_LENGTH,
    horizontal: Math.max(size.x, size.z) >= STRIP_MIN_LENGTH,
  };
}

export class BulbSet {
  /** Keyed by fixture MESH uniqueId, so every piece of a multi-piece entity
   *  (two bedside lamps, a strip's markers) has a light. A merged strip
   *  entity stores the SAME light under several keys. */
  private readonly lights = new Map<number, PointLight>();
  readonly pools: LightPoolSet;
  private strength = 1;
  private glowMeshes: AbstractMesh[] = [];
  private glowVersion = -1;
  private glowOverflow = false;
  /** Live cube shadow maps, keyed by the entity's representative light. */
  private readonly shadows = new Map<PointLight, ShadowGenerator>();
  private castShadows = false;
  private readonly scene: Scene;
  private readonly probe: BulbFloorProbe;
  private readonly readings: () => Iterable<BulbReading>;
  private readonly casters: () => readonly AbstractMesh[];

  constructor(
    scene: Scene,
    probe: BulbFloorProbe,
    readings: () => Iterable<BulbReading>,
    log: (line: string) => void = () => {},
    /** What a lamp's shadow map draws: the villa's static occluders. */
    casters: () => readonly AbstractMesh[] = () => [],
  ) {
    this.scene = scene;
    this.probe = probe;
    this.readings = readings;
    this.casters = casters;
    this.pools = new LightPoolSet(scene, probe, () => this.poolReadings(), log);
  }

  /** How many fixtures have a light. */
  get size(): number { return this.lights.size; }

  /** Whether a mesh is a bulb. */
  isBulb(meshId: number): boolean { return this.lights.has(meshId); }

  /** A bulb's PointLight. */
  lightOf(meshId: number): PointLight | undefined { return this.lights.get(meshId); }

  /** Whether a lit entity casts a cube shadow map (lightingMode.lightShadows:
   *  only where the walls' shadows are not already in a bake — they cost). */
  setCastShadows(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    if (!on) this.disposeShadows();
    else this.resync();
  }

  /** How many shadow maps are live. */
  get shadowCount(): number { return this.shadows.size; }

  /** A fixture mesh found on the load path: its PointLight (off until a state
   *  turns it on) and, on a baked villa, its floor pools. */
  addFixture(mesh: AbstractMesh, withPools: boolean): void {
    const bb = mesh.getBoundingInfo().boundingBox;
    const shape = stripShape(mesh);
    const pos = bb.centerWorld.clone();
    if (shape.strip) this.lowerStripLight(pos, mesh);
    this.lights.set(mesh.uniqueId, this.newLight(`elight_${mesh.name}_${mesh.uniqueId}`, pos));
    if (withPools) {
      this.pools.addFixture(mesh, { min: bb.minimumWorld, max: bb.maximumWorld, centerY: bb.centerWorld.y },
        shape.strip && shape.horizontal);
    }
  }

  /** Every light entity's bulbs, after the load: an entity whose every bulb is
   *  a strip shares ONE PointLight at the middle of them all. Pools stay per
   *  bulb. */
  mergeStrips(entities: Iterable<readonly AbstractMesh[]>): void {
    for (const meshes of entities) {
      if (meshes.length < 2 || !meshes.every((m) => stripShape(m).strip)) continue;
      let min: Vector3 | null = null, max: Vector3 | null = null;
      for (const m of meshes) {
        m.computeWorldMatrix(true);
        const b = m.getBoundingInfo().boundingBox;
        min = min ? Vector3.Minimize(min, b.minimumWorld) : b.minimumWorld.clone();
        max = max ? Vector3.Maximize(max, b.maximumWorld) : b.maximumWorld.clone();
      }
      if (!min || !max) continue;
      const pos = Vector3.Center(min, max);
      this.lowerStripLight(pos, meshes[0]);
      const gone = new Set<PointLight>();
      for (const m of meshes) {
        const l = this.lights.get(m.uniqueId);
        if (l && !gone.has(l)) { gone.add(l); l.dispose(); }
      }
      const shared = this.newLight(`elight_${meshes[0].name}_merged`, pos);
      for (const m of meshes) this.lights.set(m.uniqueId, shared);
    }
  }

  /**
   * On a lightmapped villa, EVERY lit surface takes the bulbs' light from the
   * furniture light (lampGlow.ts) — the lightmapped structure ModelLoader gave
   * it to, and here everything else lit: a curtain, a door leaf, the TV, free
   * furniture. Then every PointLight is taken off every glowing mesh: there it
   * was multiplied away, or a duplicate. Left out on purpose: the bulbs
   * themselves (they glow by their own emissive), anything transparent (glass
   * would turn milky), unlit and non-PBR materials (markers, pools, badges).
   * Runs after the strips are merged, so it sees every light that exists.
   */
  glowEverythingLit(): void {
    // Only on a lightmapped villa — the caller asks (lightingMode.ts); it is
    // no longer inferred from whether some material already carries the glow.
    this.glowMeshes = [];
    for (const m of this.scene.meshes) {
      const mat = m.material as (PBRMaterial & { unlit?: boolean }) | null;
      if (!(mat instanceof PBRMaterial) || hasLampGlow(mat) || mat.unlit) continue;
      if (this.lights.has(m.uniqueId) || isHelperMesh(m)) continue;
      if (mat.alpha < 1 || mat.transparencyMode === Material.MATERIAL_ALPHABLEND) continue;
      attachLampGlow(mat);
    }
    this.glowMeshes = this.scene.meshes.filter((m) => hasLampGlow(m.material));
    for (const l of new Set(this.lights.values())) l.excludedMeshes.push(...this.glowMeshes);
  }

  /** One light entity's state: every output of every bulb it has — its own
   *  glow and transparency, its light, its pools and its shadow map. */
  show(meshes: readonly AbstractMesh[], r: LightReading): void {
    const share = new Set(meshes.map((m) => this.lights.get(m.uniqueId)).filter(Boolean)).size || 1;
    for (const mesh of meshes) {
      this.showFixture(mesh, r);
      const on = r.on && mesh.isEnabled();
      const light = this.lights.get(mesh.uniqueId);
      if (light) {
        light.diffuse = r.colour;
        light.intensity = on ? (MAX_LIGHT_INTENSITY * r.frac * this.strength) / share : 0;
        // Off lights leave every shader's light loop entirely — an all-off villa
        // pays nothing for them.
        light.setEnabled(on);
      }
      this.pools.setLight(mesh.uniqueId, { on, colour: r.colour, frac: r.frac });
    }
    this.castShadow(meshes, r.on);
  }

  /** Re-render every live shadow map ONCE on the next frame — the set of
   *  VISIBLE occluders changed (a floor switch, a door or curtain pose).
   *  Never for the camera or a light's brightness: a depth map drawn from the
   *  light's position cannot change with either. */
  invalidateShadows(): void {
    for (const gen of this.shadows.values()) gen.getShadowMap()?.resetRefreshCounter();
  }

  /** Settings' "Light effect strength". Returns whether it changed. */
  setStrength(value: number): boolean {
    if (value === this.strength) return false;
    this.strength = value;
    this.pools.setStrength(value);
    this.resync();
    return true;
  }

  /** Repaint every bulb from the current readings — after a floor switch (a
   *  hidden storey's bulbs go dark, PointLights included) or anything else
   *  that changes an input without a state event. */
  resync(): void {
    for (const { meshes, reading } of this.readings()) this.show(meshes, reading);
    // What occludes a lamp changed with whatever called this (a storey hidden
    // or shown); the maps render once and then hold.
    this.invalidateShadows();
  }

  /** The calibrated villa plan: the pools take their rooms' shapes and floors. */
  setRooms(plan: Storeys<PoolRoom>): void { this.pools.setRooms(plan); }

  /** Before a frame: write the pools that are on to the furniture light —
   *  when a pool changed, or every frame while more are on than it holds
   *  (then the nearest to the eye win). */
  syncGlow(): void {
    if (this.pools.version === this.glowVersion && !this.glowOverflow) return;
    if (!this.glowMeshes.length) return;
    this.glowVersion = this.pools.version;
    const lamps = this.pools.glowLamps();
    this.glowOverflow = lamps.length > LAMP_GLOW_MAX;
    const eye = this.scene.activeCamera?.globalPosition ?? Vector3.ZeroReadOnly;
    lampGlowFor(this.scene).set(lamps, eye);
  }

  /** Unload: every light and pool of the outgoing model. */
  clear(): void {
    this.disposeShadows();
    new Set(this.lights.values()).forEach((l) => l.dispose());
    this.lights.clear();
    this.pools.clear();
    this.glowMeshes = [];
    this.glowVersion = -1;
  }

  /** Every bulb's reading as the pools want it: per mesh, the storey folded in. */
  private *poolReadings(): Iterable<[number, LightReading]> {
    for (const { meshes, reading } of this.readings()) {
      for (const mesh of meshes) yield [mesh.uniqueId, { ...reading, on: reading.on && mesh.isEnabled() }];
    }
  }

  /** The fixture's own look: its light's colour as glow while on, window-
   *  glass translucent while off (OFF_ALPHA). The ENTITY's on, not the
   *  storey's — a hidden storey's meshes are not drawn at all. */
  private showFixture(mesh: AbstractMesh, r: LightReading): void {
    const mat = mesh.material;
    if (!mat) return;
    const glow = r.on ? r.colour.scale(r.frac) : Color3.Black();
    if (mat instanceof PBRMaterial || mat instanceof StandardMaterial) mat.emissiveColor = glow;
    mat.alpha = r.on ? 1 : OFF_ALPHA;
    mat.transparencyMode = r.on ? Material.MATERIAL_OPAQUE : Material.MATERIAL_ALPHABLEND;
  }

  /**
   * Make walls block a lamp's light, where they are not baked: ONE cube shadow
   * map per light ENTITY, on its first bulb's light — a strip's markers are
   * clustered and one occluder covers them, so twelve markers cost one map.
   * Created when the entity turns on, disposed when it turns off: an off light
   * costs nothing.
   *
   * ⚠️ RENDERED ONCE, NOT EVERY FRAME. Babylon's default refresh is every
   * frame, and a PointLight's map is a CUBE — six full-geometry depth passes a
   * frame per lit fixture, forever, since lights-on is a house's resting state
   * (reported as the device heating slowly while the app stayed open). A map
   * drawn from a fixed light over static casters changes only when the visible
   * occluders do, which is what invalidateShadows is for.
   */
  private castShadow(meshes: readonly AbstractMesh[], on: boolean): void {
    let light: PointLight | undefined;
    for (const m of meshes) { light = this.lights.get(m.uniqueId); if (light) break; }
    if (!light) return;
    const existing = this.shadows.get(light);
    if (!on || !this.castShadows) {
      if (existing) { existing.dispose(); this.shadows.delete(light); }
      return;
    }
    if (existing) return;
    const gen = new ShadowGenerator(SHADOW_MAP_SIZE, light);
    gen.usePoissonSampling = true; // cheap soft edge; blur-ESM isn't supported for cube maps
    const map = gen.getShadowMap();
    if (map) {
      const casters = this.casters();
      map.renderList = casters.slice();
      for (const c of casters) c.receiveShadows = true;
      map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    }
    this.shadows.set(light, gen);
  }

  private disposeShadows(): void {
    for (const gen of this.shadows.values()) gen.dispose();
    this.shadows.clear();
  }

  /** A strip mounted flush against a ceiling or wall: a light AT it prints a
   *  hard hotspot on that surface, so lower it partway toward what is below —
   *  the visible "LED line" stays the mesh's own emissive. */
  private lowerStripLight(pos: Vector3, exclude: AbstractMesh): void {
    const surfaceY = this.probe.below(pos.x, pos.y, pos.z, exclude);
    const gap = surfaceY === null ? 0 : pos.y - surfaceY;
    if (gap > STRIP_DROP_MIN_GAP) pos.y -= Math.min(STRIP_DROP_MAX, gap * STRIP_DROP_FRACTION);
  }

  /** A diffuse-only, shadowless PointLight, created OFF. No specular: on a
   *  glossy floor its lobe is a glint that slides with the camera. */
  private newLight(name: string, pos: Vector3): PointLight {
    const light = new PointLight(name, pos, this.scene);
    light.intensity = 0;
    light.range = BULB_REACH_M;
    light.diffuse = WARM_GLOW.clone();
    light.specular = Color3.Black();
    light.setEnabled(false);
    return light;
  }
}
