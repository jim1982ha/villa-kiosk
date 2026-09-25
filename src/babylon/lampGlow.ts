// src/babylon/lampGlow.ts
// A lamp's light on the LIGHTMAPPED structure — which, on a SweetHome export,
// includes the furniture fused into it: the dining table, the chairs, the
// kitchen counters.
//
// ⚠️ A REAL POINTLIGHT CANNOT DO IT, AND FOR A YEAR IT LOOKED AS IF IT DID.
// The structure uses its lightmap as a SHADOW MAP (ModelLoader:
// `useLightmapAsShadowmap`), so the PBR shader ends with
//     finalColor.rgb *= lightmapColor.rgb;
// — every runtime light's contribution, the lamps' included, MULTIPLIED by the
// baked light. By night that bake is the dark, sun-free one, and a lamp over
// the dining table was multiplied to almost nothing. The table only ever
// looked lit because the floor pool under it was probed at TABLE height and
// floated there; 2.496.72 put that pool back on the floor and the table went
// dark (the owner's before/after screenshots, 2026-09-25). None of Babylon's
// `lightmapMode`s helps: the "excluded" modes REPLACE a light's diffuse with
// the lightmap, they do not add it on top.
//
// So this adds the lamps AFTER the multiply, as a material plugin on exactly
// the lightmapped materials, and the lamps' real PointLights are taken off
// those meshes (EntityVisuals) — they were computing a full PBR light eight
// times per structure pixel only to have it multiplied away. What replaces
// them is a short loop over the lamps that are ON: a falloff, a facing term,
// no BRDF, no shadow.
//
// The rules, once:
//  * the same light as a PointLight lights furniture with: colour × intensity
//    × N·L / (π d²), faded to nothing at `range` (Babylon's glTF window);
//  * the FLOOR under a lamp is the pool's (lightPoolSet, clipped to the room);
//    the glow starts a little above it, so the floor is not lit twice;
//  * the side of a surface that faces the viewer is the side that is lit, so
//    a thin slab exported with a downward normal lights from above, and the
//    far face of a wall stays dark from the next room;
//  * at most LAMP_GLOW_MAX lamps — the nearest to the eye when more are on.
//
// ⚠️ THE HOOK IS A LINE OF BABYLON'S SHADER, matched by regex. A Babylon
// upgrade that rewrites it switches the glow off without an error, so
// tests/oracles/lamp_glow.mjs reads the installed shader and fails if the
// anchor or any variable the snippet uses is gone.

import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { Material } from "@babylonjs/core/Materials/material";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Scene } from "@babylonjs/core/scene";

/** A strip lights from three spots (centre and both ends), so one LED cove
 *  of four strips is twelve — 16 filled with one room's lights. */
export const LAMP_GLOW_MAX = 32;
/** The line the glow is appended to (pbrBlockFinalColorComposition). */
export const LAMP_GLOW_ANCHOR = "finalColor\\.rgb\\*=lightmapColor\\.rgb;";
/** Where the glow begins above its lamp's floor, and where it is whole. */
const ABOVE_FLOOR_FROM = 0.05;
const ABOVE_FLOOR_TO = 0.15;

/** One lamp that is on, as the glow needs it. `floorY` null: no floor known
 *  (no pool), so nothing is held back. */
export interface GlowLamp {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
  intensity: number;
  range: number;
  floorY: number | null;
}

/** What every glowing material binds this frame. One per scene. */
export class LampGlowState {
  readonly pos = new Float32Array(LAMP_GLOW_MAX * 4);
  readonly col = new Float32Array(LAMP_GLOW_MAX * 4);
  count = 0;
  /** Changes whenever the lamps written change — the caller's repaint cue. */
  version = 0;
  private key = "";

  /** Write the lamps to show. More than fit: the nearest to `eye`. Returns
   *  whether anything changed. Pure apart from the arrays it fills. */
  set(lamps: readonly GlowLamp[], eye: { x: number; y: number; z: number }): boolean {
    let chosen = lamps.filter((l) => l.intensity > 0 && l.range > 0);
    if (chosen.length > LAMP_GLOW_MAX) {
      const d = (l: GlowLamp) => (l.x - eye.x) ** 2 + (l.y - eye.y) ** 2 + (l.z - eye.z) ** 2;
      chosen = chosen.slice().sort((a, b) => d(a) - d(b)).slice(0, LAMP_GLOW_MAX);
    }
    let key = "";
    for (const l of chosen) key += `${l.x},${l.y},${l.z},${l.r},${l.g},${l.b},${l.intensity},${l.range},${l.floorY};`;
    if (key === this.key) return false;
    this.key = key;
    this.pos.fill(0);
    this.col.fill(0);
    chosen.forEach((l, i) => {
      this.pos.set([l.x, l.y, l.z, l.floorY ?? -1e6], i * 4);
      this.col.set([l.r * l.intensity, l.g * l.intensity, l.b * l.intensity, 1 / (l.range * l.range)], i * 4);
    });
    this.count = chosen.length;
    this.version++;
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

/** The GLSL appended after the lightmap multiply. Exported for the oracle. */
export const LAMP_GLOW_GLSL = `
#ifdef LAMPGLOW
{
  vec3 lgN = normalize(normalW);
  if (dot(lgN, vEyePosition.xyz - vPositionW) < 0.0) lgN = -lgN;
  vec3 lgSum = vec3(0.0);
  for (int lgI = 0; lgI < ${LAMP_GLOW_MAX}; lgI++) {
    if (float(lgI) >= lampGlowCount) break;
    vec4 lgP = lampGlowPos[lgI];
    vec4 lgC = lampGlowCol[lgI];
    vec3 lgL = lgP.xyz - vPositionW;
    float lgD2 = max(dot(lgL, lgL), 1e-4);
    float lgF = lgD2 * lgC.w;
    float lgWin = clamp(1.0 - lgF * lgF, 0.0, 1.0);
    float lgNdl = max(dot(lgN, lgL * inversesqrt(lgD2)), 0.0);
    float lgAbove = smoothstep(lgP.w + ${ABOVE_FLOOR_FROM.toFixed(2)}, lgP.w + ${ABOVE_FLOOR_TO.toFixed(2)}, vPositionW.y);
    lgSum += lgC.rgb * (lgNdl * lgWin * lgWin * lgAbove / (3.14159265 * lgD2));
  }
  finalColor.rgb += surfaceAlbedo * lgSum;
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
    return { [`!${LAMP_GLOW_ANCHOR}`]: `$0${LAMP_GLOW_GLSL}` };
  }
}

const glowing = new WeakSet<Material>();

/** Give a lightmapped material the lamp glow. Idempotent. */
export function attachLampGlow(material: Material): void {
  if (glowing.has(material)) return;
  new LampGlowPlugin(material, lampGlowFor(material.getScene()));
  glowing.add(material);
}

/** Whether a mesh's material carries the glow — those meshes take their lamp
 *  light from it, and must be kept off the lamps' PointLights. */
export function hasLampGlow(material: Material | null | undefined): boolean {
  return !!material && glowing.has(material);
}
