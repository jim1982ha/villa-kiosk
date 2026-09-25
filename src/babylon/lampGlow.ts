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
//  * at most LAMP_GLOW_MAX lamps — the nearest to the eye when more are on.
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
import { POOL_ALPHA_STOPS } from "./LightPools";

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
/** How far a bulb's light reaches before it has faded out — this light's and
 *  the bulb's PointLight's (bulbSet.ts), one number. An early 8 m lit straight
 *  through walls into the next rooms. */
export const BULB_REACH_M = 4;
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
export const LAMP_GLOW_GAIN = Math.pow(POOL_CENTRE, 2.2) / (POOL_CENTRE * 0.5);

/** One pool that is on, as the glow needs it (LightPoolSet.glowLamps). */
export interface GlowLamp {
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
}

/** What every glowing material binds this frame. One per scene. */
export class LampGlowState {
  readonly pos = new Float32Array(LAMP_GLOW_MAX * 4);
  readonly col = new Float32Array(LAMP_GLOW_MAX * 4);
  count = 0;
  private key = "";

  /** Write the lamps to show. More than fit: the nearest to `eye`. Returns
   *  whether anything changed. Pure apart from the arrays it fills. */
  set(lamps: readonly GlowLamp[], eye: { x: number; y: number; z: number }): boolean {
    let chosen = lamps.filter((l) => l.amount > 0 && l.radius > 0);
    if (chosen.length > LAMP_GLOW_MAX) {
      const d = (l: GlowLamp) => (l.x - eye.x) ** 2 + (l.y - eye.y) ** 2 + (l.z - eye.z) ** 2;
      chosen = chosen.slice().sort((a, b) => d(a) - d(b)).slice(0, LAMP_GLOW_MAX);
    }
    let key = "";
    for (const l of chosen) key += `${l.x},${l.y},${l.z},${l.r},${l.g},${l.b},${l.amount},${l.radius},${l.floorY},${l.ceilingY};`;
    if (key === this.key) return false;
    this.key = key;
    this.pos.fill(0);
    this.col.fill(0);
    chosen.forEach((l, i) => {
      this.pos.set([l.x, l.y, l.z, l.floorY], i * 4);
      this.col.set([l.r * l.amount, l.g * l.amount, l.b * l.amount, Math.min(l.ceilingY, 1e6)], i * 4);
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
export const GLOW_CAP_TOTAL = POOL_CENTRE * GLOW_CAP_ALL;

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
    lgSum += lgC.rgb * lgW;
  }
  vec3 lgAdd = surfaceAlbedo * ${f(LAMP_GLOW_GAIN)} * min(lgSum, vec3(${f(GLOW_CAP_TOTAL)}));
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

class LampGlowPlugin extends MaterialPluginBase {
  private readonly state: LampGlowState;

  constructor(material: Material, state: LampGlowState) {
    super(material, "LampGlow", 200, { LAMPGLOW: false });
    this.state = state;
    this._enable(true);
  }

  override getClassName(): string { return "LampGlowPlugin"; }

  // GLSL only: the snippet and its anchor are GLSL. On WebGPU the plugin
  // stays out of the shader and the structure renders exactly as before.
  override isCompatible(shaderLanguage: number): boolean { return shaderLanguage === 0; }

  override prepareDefines(defines: MaterialDefines): void { defines.LAMPGLOW = true; }

  override getUniforms() {
    return {
      ubo: [
        { name: "lampGlowPos", size: 4, type: "vec4", arraySize: LAMP_GLOW_MAX },
        { name: "lampGlowCol", size: 4, type: "vec4", arraySize: LAMP_GLOW_MAX },
        { name: "lampGlowCount", size: 1, type: "float" },
      ],
      fragment: `#ifdef LAMPGLOW
uniform vec4 lampGlowPos[${LAMP_GLOW_MAX}];
uniform vec4 lampGlowCol[${LAMP_GLOW_MAX}];
uniform float lampGlowCount;
#endif`,
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateFloatArray("lampGlowPos", this.state.pos);
    ubo.updateFloatArray("lampGlowCol", this.state.col);
    ubo.updateFloat("lampGlowCount", this.state.count);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== "fragment") return null;
    return { [`!${LAMP_GLOW_ANCHOR}`]: `$0${LAMP_GLOW_GLSL}`, [LAMP_GLOW_PLAIN_POINT]: LAMP_GLOW_PLAIN_GLSL };
  }
}

const glowing = new WeakSet<Material>();

/** Give a material the lamp glow — a lightmapped one takes it after its
 *  lightmap, any other before its final colour. Idempotent. */
export function attachLampGlow(material: Material): void {
  if (glowing.has(material)) return;
  new LampGlowPlugin(material, lampGlowFor(material.getScene()));
  glowing.add(material);
}

/** Whether a mesh's material carries the glow — those meshes take their bulb
 *  light from it, and must be kept off the bulbs' PointLights. */
export function hasLampGlow(material: Material | null | undefined): boolean {
  return !!material && glowing.has(material);
}
