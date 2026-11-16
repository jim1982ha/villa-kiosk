// src/babylon/lampGlow.ts
// A bulb's light on what stands under it, when that is part of the
// LIGHTMAPPED structure — which, on a SweetHome export, includes the furniture
// fused into it: the dining table, the chairs, the sofa, the counters.
//
// ⚠️ A REAL POINTLIGHT CANNOT DO IT. The structure uses its lightmap as a
// SHADOW MAP (ModelLoader: `useLightmapAsShadowmap`), so the PBR shader ends
//     finalColor.rgb *= lightmapColor.rgb;
// — every runtime light MULTIPLIED by the baked light, and by night that bake
// is the dark, sun-free one. The table only ever looked lit because its floor
// pool was probed at the kitchen counter's 0.75 m and floated at table height;
// 2.496.72 put the pool on the floor and the table was left with no light of
// its own (the owner's photos, 2026-09-25).
//
// So this adds the bulbs AFTER that multiply, as a material plugin on the
// lightmapped materials — and on EVERY OTHER lit surface too (EntityVisuals:
// curtains, door leaves, the TV, fans; any free furniture), so a bulb lights
// the whole room by one rule. An audit of the villa GLB after the first cut
// found 280 device meshes still lit by the old PointLights: a ninth of the
// light and ~20x weaker than the glow beside them — dark curtains next to a
// lit table. The bulbs' PointLights are then taken off every glowing mesh.
//
// ⚠️ THE POOL'S BULB AND STRENGTH, A LIGHT'S FALLOFF. Each lamp here is one
// floor pool (LightPoolSet.glowLamps): its bulb, colour and strength
// (poolStrength). Built first from the PointLight, it lit the table with a
// ninth of what the pool gave the floor — the nine ceiling spots are one
// entity, and a PointLight is divided among its bulbs. Built next from the
// pool's own FOOTPRINT, it lit nothing: the villa's dining table stands in the
// gap between its ceiling spots, every one 1.9 m or more away across the
// floor, where the 1.8 m disc has faded to zero — while each is only ~2.5 m
// away in a straight line (measured on the villa GLB's render: table top
// 59.7 -> 59.7). A bulb lights what is NEAR it, so the falloff is a light's.
//
// The rules, once:
//  * brightness = the pool's strength and colour × the surface's colour ×
//    how squarely it faces the bulb (plain N·L, never wrapped — see below)
//    × an inverse-square falloff, normalised
//    so a surface GLOW_AT_M below a bulb gets what its pool gives the floor
//    right under it, faded to nothing at GLOW_REACH_M, and capped near the
//    bulb (GLOW_CAP_ONE, GLOW_CAP_ALL);
//  * below a little above the lamp's ROOM floor, nothing — the floor is the
//    pool's, and a step light's tread is not its room's floor;
//  * at or above the floor of the storey ABOVE, nothing — no ceiling stops
//    this light, so without it a 1F bulb lit the walls upstairs (render);
//  * the side of a surface that faces the viewer is the side that is lit, so
//    a thin slab exported with a downward normal lights from above, and the
//    far face of a wall stays dark from the next room;
//  * at most LAMP_GLOW_MAX lamps — when more are on, the nearest two on the
//    same storey become one at their middle, their light summed (`fitLamps`),
//    until they fit. Never chosen by the camera: see fitLamps.
//
// ⚠️ THE HOOK IS A LINE OF BABYLON'S SHADER, matched by regex. A Babylon
// upgrade that rewrites it switches this off without an error, so
// tests/oracles/lamp_glow.mjs reads the installed shader and fails if the
// anchor or any variable the snippet uses is gone.

import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { Material } from "@babylonjs/core/Materials/material";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { POOL_ALPHA_STOPS } from "./LightPools";
import { BULB_REACH_M } from "./lightPlacement";
import { MASK_FACING_M, type LampRoomBits, type RoomLightMask } from "./roomLightMask";
import { uploadVec4Array } from "./shaderArrays";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";

const f = (v: number) => v.toFixed(4);

/** One strip is three pools, a room of ceiling spots nine or more. */
export const LAMP_GLOW_MAX = 32;
/** The line the glow is appended to (pbrBlockFinalColorComposition). */
export const LAMP_GLOW_ANCHOR = "finalColor\\.rgb\\*=lightmapColor\\.rgb;";
/** Where the glow begins above its lamp's floor, and where it is whole. */
const ABOVE_FLOOR_FROM = 0.05;
const ABOVE_FLOOR_TO = 0.15;
/** The distance at which the falloff equals the pool's own brightness right
 *  under its bulb — a ceiling light over a floor. */
const GLOW_AT_M = 2.3;
/** How far a bulb's light reaches (lightPlacement.ts, where it is defined so
 *  the floor patch can read it without an import cycle). */
export { BULB_REACH_M };
/** The most one bulb may give a surface, and all of them together, as
 *  multiples of its pool's centre. Without a cap the inverse square runs away
 *  next to the bulb: the villa render showed the wall and ceiling within half
 *  a metre of each ceiling spot blown to white (~20x the floor under it). */
const GLOW_CAP_ONE = 1.4;
const GLOW_CAP_ALL = 1.8;
/*
 * ⚠️ NO WRAP, and none may be added (2.496.79). 2.496.78 wrapped the facing
 * term — (N·L + 0.6) / 1.6 — to soften where the light turns off across the
 * pouf. It also lit every surface angled up to ~127° AWAY from a bulb, and
 * nothing here knows where a wall is: the OUTSIDE faces of the living room's
 * walls lit up, seen from the overview (the owner's photo). A surface facing
 * away from a bulb is exactly what the far side of a wall is. Plain N·L.
 */
/** The pool's brightness at its centre (POOL_ALPHA_STOPS[0]). */
export const POOL_CENTRE = POOL_ALPHA_STOPS[0][1];
/** A surface this close below its storey-above's floor is already that floor. */
const CEILING_SLACK_M = 0.02;
/**
 * The pool is ADDED in display (gamma) space and ignores the colour of the
 * floor; this is added in the shader's linear space and scaled by the
 * surface's colour. So the pool's centre value is taken to linear (^2.2) and
 * divided by a mid surface colour (0.5): a mid-toned surface GLOW_AT_M under
 * a bulb then gets what the floor under that bulb shows.
 */
const LAMP_GLOW_GAIN = Math.pow(POOL_CENTRE, 2.2) / (POOL_CENTRE * 0.5);

/** One pool that is on, as the glow needs it (LightPoolSet.glowLamps). */
interface GlowLamp {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
  /** The pool's own strength (poolStrength). */
  amount: number;
  /** The pool's radius — a pool of none shows no light. */
  radius: number;
  floorY: number;
  /** The floor of the storey above — nothing at or above it is lit.
   *  Infinity: no storey above. */
  ceilingY: number;
  /** The rooms it lights (roomLightMask.ts); none: not held to a room. */
  room?: LampRoomBits;
}

/** What every glowing material binds this frame. One per scene. */
export class LampGlowState {
  readonly pos = new Float32Array(LAMP_GLOW_MAX * 4);
  readonly col = new Float32Array(LAMP_GLOW_MAX * 4);
  /** Per lamp: its band of the room map, its rooms (24 + 8 bits), 1 when held. */
  readonly room = new Float32Array(LAMP_GLOW_MAX * 4);
  /** The room map (roomLightMask.ts): origin x, z, 1 / cell, how far in front
   *  of a surface it is read; width, rows. */
  readonly maskAt = new Float32Array(4);
  readonly maskSize = new Float32Array(4);
  /** The room map's texture; a blank cell until the plan has been drawn, so
   *  the shader never recompiles when it arrives. */
  maskTexture: RawTexture | null = null;
  count = 0;
  private key = "";
  private maskKey = "";

  /** Draw the room map into the texture (once per plan; null clears it). */
  setMask(scene: Scene, mask: RoomLightMask<unknown> | null): void {
    const old = this.maskTexture;
    if (mask) {
      this.maskTexture = RawTexture.CreateRGBATexture(mask.data, mask.width, mask.rows * mask.bands, scene,
        false, false, Texture.NEAREST_SAMPLINGMODE);
      this.maskAt.set([mask.originX, mask.originZ, 1 / mask.cell, MASK_FACING_M]);
      this.maskSize.set([mask.width, mask.rows, 0, 0]);
      this.maskKey = `${mask.originX},${mask.originZ},${mask.width},${mask.rows},${mask.bands},${mask.open.join(";")}`;
    } else {
      this.maskTexture = null;
      this.maskSize.fill(0);
      this.maskKey = "";
    }
    old?.dispose();
    this.key = "";   // the lamps' rooms are re-read on the next set()
  }

  /** Whether a room map is drawn (not the blank cell). */
  get hasMask(): boolean { return this.maskKey !== ""; }

  /** The texture to bind: the map, or a blank cell. */
  boundMask(scene: Scene): RawTexture {
    if (!this.maskTexture) {
      this.maskTexture = RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
      this.maskSize.fill(0);
    }
    return this.maskTexture;
  }

  /** Write the lamps to show — more than fit are merged (fitLamps). Returns
   *  whether anything changed. Pure apart from the arrays it fills. */
  set(lamps: readonly GlowLamp[]): boolean {
    const on = lamps.filter((l) => l.amount > 0 && l.radius > 0);
    // Keyed on the lamps AS GIVEN, so a caller may hand them every frame: the
    // same lamps cost a string, never a merge (fitLamps).
    let key = this.maskKey;
    for (const l of on) key += `${l.x},${l.y},${l.z},${l.r},${l.g},${l.b},${l.amount},${l.radius},${l.floorY},${l.ceilingY},${l.room ? `${l.room.band}:${l.room.lo}:${l.room.hi}` : ""};`;
    if (key === this.key) return false;
    this.key = key;
    const chosen = fitLamps(on, LAMP_GLOW_MAX);
    this.pos.fill(0);
    this.col.fill(0);
    this.room.fill(0);
    chosen.forEach((l, i) => {
      this.pos.set([l.x, l.y, l.z, l.floorY], i * 4);
      this.col.set([l.r * l.amount, l.g * l.amount, l.b * l.amount, Math.min(l.ceilingY, 1e6)], i * 4);
      if (l.room) this.room.set([l.room.band, l.room.lo, l.room.hi, 1], i * 4);
    });
    this.count = chosen.length;
    return true;
  }

  /** Show no lamps until the returned function is called — the probe's clean
   *  A/B: a uniform, so no shader recompiles and the row measures the loop. */
  suspend(): () => void {
    const count = this.count;
    this.count = 0;
    return () => { this.count = count; };
  }
}

/**
 * The lamps that are on, in at most `max` — the same answer wherever the
 * camera stands.
 *
 * ⚠️ NEVER BY THE CAMERA (owner's recording, 2026-10-17). More than 32 lamps
 * were on (ten lights, 31 fixtures, each LED strip three pools) and the 32
 * nearest to the eye were kept: as the view moved, lamps dropped in and out
 * and the walls and furniture brightened and dimmed under a fixed set of
 * lights. Now the two nearest lamps on the same storey (same room floor and
 * floor above) become ONE at their amount-weighted middle with their light
 * summed, until the rest fit — a strip's three pools and a room's ceiling
 * spots first, which sit closest. What a surface a few metres away receives
 * barely moves; nothing switches off. Only if no two share a storey do the
 * nearest two of all merge (the lower floor and ceiling kept).
 *
 * Deterministic: the lamps are ordered by position first, so the same lamps in
 * any order give the same answer.
 */
export function fitLamps(lamps: readonly GlowLamp[], max: number): GlowLamp[] {
  const out = lamps.slice().sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z || a.amount - b.amount);
  const d2 = (a: GlowLamp, b: GlowLamp) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
  const sameStorey = (a: GlowLamp, b: GlowLamp) => a.floorY === b.floorY && a.ceilingY === b.ceilingY;
  while (out.length > max) {
    let bi = -1, bj = -1, best = Infinity, bestSame = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const same = sameStorey(out[i], out[j]);
        const d = d2(out[i], out[j]);
        if ((same && !bestSame) || (same === bestSame && d < best)) { bi = i; bj = j; best = d; bestSame = same; }
      }
    }
    const a = out[bi], b = out[bj];
    const sum = a.amount + b.amount;
    const w = (k: "x" | "y" | "z" | "r" | "g" | "b") => (a[k] * a.amount + b[k] * b.amount) / sum;
    const merged: GlowLamp = {
      x: w("x"), y: w("y"), z: w("z"), r: w("r"), g: w("g"), b: w("b"), amount: sum,
      radius: Math.max(a.radius, b.radius) + Math.sqrt(best) / 2,
      floorY: Math.min(a.floorY, b.floorY), ceilingY: Math.min(a.ceilingY, b.ceilingY),
      // Two lamps' rooms together; across two storeys' bands, held to none.
      room: a.room && b.room && a.room.band === b.room.band
        ? { band: a.room.band, lo: (a.room.lo | b.room.lo) >>> 0, hi: (a.room.hi | b.room.hi) >>> 0 } : undefined,
    };
    out.splice(bj, 1);
    out[bi] = merged;
  }
  return out;
}

const states = new WeakMap<Scene, LampGlowState>();
/** The scene's glow state, created on first ask. */
export function lampGlowFor(scene: Scene): LampGlowState {
  let s = states.get(scene);
  if (!s) { s = new LampGlowState(); states.set(scene, s); }
  return s;
}


/**
 * ONE BULB'S CONTRIBUTION, as plain scalar steps — THE formula, written once.
 * Each step is `[name, expression]`, and every expression is valid GLSL and,
 * given max/min/clamp/smoothstep/step/inversesqrt, valid JavaScript: the
 * shader is generated from these steps, and tests/oracles/lamp_glow.mjs
 * EVALUATES the same steps to check the numbers (a table top under a spot is
 * lit; the far face of a wall, the storey above and the floor are not). The
 * formula used to exist only as shader text that an oracle could grep but
 * never run.
 *
 * Inputs: the fragment `pX,pY,pZ`, its viewer-facing normal `nX,nY,nZ`, and
 * the bulb `lgPx,lgPy,lgPz`, its room floor `lgFloor`, the storey above's
 * floor `lgCeil`. Output: `lgW`, the weight its colour × strength is scaled by.
 */
export const GLOW_TERM: ReadonlyArray<readonly [string, string]> = [
  ["lgLx", "lgPx - pX"],
  ["lgLy", "lgPy - pY"],
  ["lgLz", "lgPz - pZ"],
  ["lgD2", "max(lgLx * lgLx + lgLy * lgLy + lgLz * lgLz, 0.2500)"],
  ["lgWin", `clamp(1.0 - lgD2 * ${f(1 / (BULB_REACH_M * BULB_REACH_M))}, 0.0, 1.0)`],
  ["lgFall", `min(${f(POOL_CENTRE * GLOW_AT_M * GLOW_AT_M)} / lgD2, ${f(POOL_CENTRE * GLOW_CAP_ONE)}) * lgWin * lgWin`],
  ["lgNdl", "max((nX * lgLx + nY * lgLy + nZ * lgLz) * inversesqrt(lgD2), 0.0)"],
  ["lgAbove", `smoothstep(lgFloor + ${f(ABOVE_FLOOR_FROM)}, lgFloor + ${f(ABOVE_FLOOR_TO)}, pY) * step(pY, lgCeil - ${f(CEILING_SLACK_M)})`],
  ["lgW", "lgFall * lgNdl * lgAbove"],
];
/** The cap on every bulb together, as a multiple of a pool's centre. */
const GLOW_CAP_TOTAL = POOL_CENTRE * GLOW_CAP_ALL;

/** The room map's cell under a point, on a band (roomLightMask.ts): its rooms'
 *  bits, the top one marking a wall; 0 off the map.
 *
 *  ⚠️ EVERY INTEGER HERE IS highp. A fragment shader's default int precision
 *  is mediump, which a desktop GPU runs at 32 bits and a phone's at 16: the
 *  rooms past the 16th and the wall bit fell off, and the owner's phone lit
 *  the bedroom through the wall while the Mac and the render rig did not
 *  (2.496.830). */
const LAMP_GLOW_ROOM_LOOKUP = `#ifdef LAMPGLOW_ROOMS
uniform sampler2D lampGlowMask;
highp uint lampGlowCell(vec2 p, float band) {
  highp ivec2 c = ivec2(floor((p - lampGlowMaskAt.xy) * lampGlowMaskAt.z));
  if (c.x < 0 || c.y < 0 || float(c.x) >= lampGlowMaskSize.x || float(c.y) >= lampGlowMaskSize.y) return 0u;
  highp uvec4 t = uvec4(texelFetch(lampGlowMask, ivec2(c.x, c.y + int(band + 0.5) * int(lampGlowMaskSize.y)), 0) * 255.0 + 0.5);
  return t.r | (t.g << 8u) | (t.b << 16u) | (t.a << 24u);
}
#endif
`;

/** The bulbs' light on this fragment, into `lgAdd` — shared by both hooks. */
const ACCUMULATE = `
  vec3 lgN = normalize(normalW);
  if (dot(lgN, vEyePosition.xyz - vPositionW) < 0.0) lgN = -lgN;
  float pX = vPositionW.x; float pY = vPositionW.y; float pZ = vPositionW.z;
  float nX = lgN.x; float nY = lgN.y; float nZ = lgN.z;
  vec3 lgSum = vec3(0.0);
  for (int lgI = 0; lgI < ${LAMP_GLOW_MAX}; lgI++) {
    if (float(lgI) >= lampGlowCount) break;
    vec4 lgP = lampGlowPos[lgI];
    vec4 lgC = lampGlowCol[lgI];
    float lgPx = lgP.x; float lgPy = lgP.y; float lgPz = lgP.z;
    float lgFloor = lgP.w; float lgCeil = lgC.w;
${GLOW_TERM.map(([name, expr]) => `    float ${name} = ${expr};`).join("\n")}
#ifdef LAMPGLOW_ROOMS
    // Its own room and those open to it (roomLightMask.ts, maskAllows).
    vec4 lgR = lampGlowRoom[lgI];
    if (lgW > 0.0 && lgR.w > 0.5 && lampGlowMaskSize.x > 0.0) {
      highp uint lgCellBits = lampGlowCell(vec2(pX, pZ), lgR.x);
      highp uint lgLamp = uint(lgR.y + 0.5) | (uint(lgR.z + 0.5) << 24u);
      if ((lgCellBits & 0x80000000u) != 0u) {
        // In a wall: a face is the room it faces, read in front of it; what
        // faces up (a wall's top, a rail or shelf against it) is lit only if
        // every room around it is (roomLightMask.maskAllows).
        float lgSide = length(vec2(nX, nZ));
        if (lgSide >= 0.5) {
          highp uint lgFront = lampGlowCell(vec2(pX, pZ) + vec2(nX, nZ) / lgSide * lampGlowMaskAt.w, lgR.x);
          if (lgFront == 0u || (lgFront & 0x80000000u) != 0u || (lgFront & lgLamp) == 0u) lgW = 0.0;
        } else {
          bool lgAny = false, lgAll = true;
          for (int lgK = 0; lgK < 4; lgK++) {
            vec2 lgO = lgK == 0 ? vec2(1.0, 0.0) : lgK == 1 ? vec2(-1.0, 0.0) : lgK == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
            highp uint lgN4 = lampGlowCell(vec2(pX, pZ) + lgO * lampGlowMaskAt.w, lgR.x);
            if (lgN4 == 0u || (lgN4 & 0x80000000u) != 0u) continue;
            lgAny = true;
            if ((lgN4 & lgLamp) == 0u) lgAll = false;
          }
          if (!lgAny || !lgAll) lgW = 0.0;
        }
      } else if (lgCellBits != 0u && (lgCellBits & lgLamp) == 0u) lgW = 0.0;
    }
#endif
    lgSum += lgC.rgb * lgW;
  }
#if defined(LAMPGLOW_VERTEXLIT) && defined(VERTEXCOLOR)
  vec3 lgAlbedo = surfaceAlbedo / max(vColor.rgb, vec3(0.0001));
#else
  vec3 lgAlbedo = surfaceAlbedo;
#endif
  vec3 lgAdd = lgAlbedo * ${f(LAMP_GLOW_GAIN)} * min(lgSum, vec3(${f(GLOW_CAP_TOTAL)}));
`;

/** LIGHTMAPPED structure: appended after the lightmap multiply (the anchor),
 *  which would otherwise darken it to nothing. Exported for the oracle. */
export const LAMP_GLOW_GLSL = `
#ifdef LAMPGLOW
{${ACCUMULATE}
  finalColor.rgb += lgAdd;
}
#endif
`;

/** Everything else that is lit — a device, a curtain, a door leaf, a free
 *  piece of furniture: nothing multiplies it afterwards, so the light joins
 *  the diffuse just before the final colour is composed. Never on a
 *  lightmapped material, which has the hook above instead. */
export const LAMP_GLOW_PLAIN_POINT = "CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION";
export const LAMP_GLOW_PLAIN_GLSL = `
#if defined(LAMPGLOW) && !defined(USELIGHTMAPASSHADOWMAP)
{${ACCUMULATE}
  finalDiffuse += lgAdd;
}
#endif
`;

/** The room test's integer ops and texelFetch are WebGL2 shader language. */
const isWebGL2 = (scene: Scene): boolean => ((scene.getEngine() as { webGLVersion?: number }).webGLVersion ?? 1) >= 2;

class LampGlowPlugin extends MaterialPluginBase {
  private readonly state: LampGlowState;
  private readonly vertexLit: boolean;

  constructor(material: Material, state: LampGlowState, vertexLit: boolean) {
    super(material, "LampGlow", 200, { LAMPGLOW: false, LAMPGLOW_VERTEXLIT: false, LAMPGLOW_ROOMS: false });
    this.state = state;
    this.vertexLit = vertexLit;
    this._enable(true);
  }

  override getClassName(): string { return "LampGlowPlugin"; }

  // GLSL only: the snippet and its anchor are GLSL. On WebGPU the plugin
  // stays out of the shader and the structure renders exactly as before.
  override isCompatible(shaderLanguage: number): boolean { return shaderLanguage === 0; }

  override prepareDefines(defines: MaterialDefines, scene: Scene): void {
    defines.LAMPGLOW = true;
    defines.LAMPGLOW_VERTEXLIT = this.vertexLit;
    // The room test needs integer ops and texelFetch: WebGL2's shaders. On
    // WebGL1 the glow lights as before, through walls.
    defines.LAMPGLOW_ROOMS = isWebGL2(scene);
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("lampGlowMask");
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "lampGlowPos", size: 4, type: "vec4", arraySize: LAMP_GLOW_MAX },
        { name: "lampGlowCol", size: 4, type: "vec4", arraySize: LAMP_GLOW_MAX },
        { name: "lampGlowCount", size: 1, type: "float" },
        { name: "lampGlowRoom", size: 4, type: "vec4", arraySize: LAMP_GLOW_MAX },
        { name: "lampGlowMaskAt", size: 4, type: "vec4" },
        { name: "lampGlowMaskSize", size: 4, type: "vec4" },
      ],
      fragment: `#ifdef LAMPGLOW
uniform vec4 lampGlowPos[${LAMP_GLOW_MAX}];
uniform vec4 lampGlowCol[${LAMP_GLOW_MAX}];
uniform float lampGlowCount;
uniform vec4 lampGlowRoom[${LAMP_GLOW_MAX}];
uniform vec4 lampGlowMaskAt;
uniform vec4 lampGlowMaskSize;
#endif`,
    };
  }

  // The arrays through uploadVec4Array: without uniform buffers (Chrome on a
  // Mac) updateFloatArray sent nothing a vec4[] accepts (shaderArrays.ts).
  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh): void {
    uploadVec4Array(ubo, subMesh, "lampGlowPos", this.state.pos);
    uploadVec4Array(ubo, subMesh, "lampGlowCol", this.state.col);
    uploadVec4Array(ubo, subMesh, "lampGlowRoom", this.state.room);
    ubo.updateFloat("lampGlowCount", this.state.count);
    if (isWebGL2(this._material.getScene())) {
      const mask = this.state.boundMask(this._material.getScene());
      ubo.updateFloat4("lampGlowMaskAt", this.state.maskAt[0], this.state.maskAt[1], this.state.maskAt[2], this.state.maskAt[3]);
      ubo.updateFloat4("lampGlowMaskSize", this.state.maskSize[0], this.state.maskSize[1], this.state.maskSize[2], this.state.maskSize[3]);
      ubo.setTexture("lampGlowMask", mask);
    }
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== "fragment") return null;
    // A sampler is never in the uniform text above (Babylon writes that only
    // without uniform buffers): it is declared with the shader's definitions.
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: LAMP_GLOW_ROOM_LOOKUP,
      [`!${LAMP_GLOW_ANCHOR}`]: `$0${LAMP_GLOW_GLSL}`, [LAMP_GLOW_PLAIN_POINT]: LAMP_GLOW_PLAIN_GLSL,
    };
  }
}

const glowing = new WeakSet<Material>();

/** Give a material the lamp glow — a lightmapped one takes it after its
 *  lightmap, any other before its final colour. Idempotent.
 *
 *  `vertexLit`: the material's meshes carry their BAKED light in their vertex
 *  colours (ModelLoader). The shader has already multiplied the albedo by that
 *  light, so without this a bulb's light would be scaled by it too, and at
 *  night, when it is the dim night light, a chair under a lit lamp would stay
 *  dark while the wall behind it brightens. The vertex colour is divided back
 *  out of the glow, so it is albedo times the bulb, as on a lightmapped wall. */
export function attachLampGlow(material: Material, opts: { vertexLit?: boolean } = {}): void {
  if (glowing.has(material)) return;
  new LampGlowPlugin(material, lampGlowFor(material.getScene()), opts.vertexLit === true);
  glowing.add(material);
}

/** Whether a mesh's material carries the glow — those meshes take their bulb
 *  light from it, and must be kept off the bulbs' PointLights. */
export function hasLampGlow(material: Material | null | undefined): boolean {
  return !!material && glowing.has(material);
}
