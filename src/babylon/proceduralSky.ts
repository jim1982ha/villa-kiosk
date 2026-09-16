// src/babylon/proceduralSky.ts
// An analytic sky, evaluated into a cube map, as an alternative to the flat
// three-colour gradient in RenderEnhancements.buildGradientEnv.
//
// WHY THIS EXISTS
// The villa's GLB carries real per-material roughness — measured on the shipped
// file: 337 materials, 57 distinct roughnessFactor values from 0.50 to 1.00,
// plus KHR_materials_specular. Every one of those materials samples the scene
// environment for its specular lobe, and what they were sampling was a cube
// built by interpolating THREE constant colours purely by height. Nothing in it
// varies with compass direction, so no surface in the villa could reflect the
// sun, and roughness variation had almost nothing to be visible against.
//
// This module is the other half of that: a sky whose radiance is a function of
// the view direction AND the sun's direction, so a floor, a worktop or a pane
// reflects a brighter sky on the sun's side and a duller one away from it.
//
// ⚠️ IT IS NOT A DOWNLOADED HDRI, AND MUST NEVER BECOME ONE. The add-on targets
// a villa that may have no internet at all, so a fetched .env/.hdr is a feature
// that works on a developer's desk and is simply missing on the wall. This is
// computed, ships as code, and costs nothing on the network. See the offline
// rule in CLAUDE.md.
//
// ⚠️ IT IS ALSO NOT PREETHAM OR HOSEK-WILKIE, and the comments do not claim it
// is. Those fit measured sky-dome radiance with per-turbidity coefficient
// tables; this is a physically MOTIVATED approximation — a Rayleigh-ish
// zenith-to-horizon gradient, a Mie-ish forward-scattering lobe around the sun,
// warm-up at low sun elevation, and a ground term. It is chosen to look right
// on a tablet and to be readable, not to be radiometrically correct. Saying so
// here because a comment that overstated its model would invite someone to
// trust its absolute values.
//
// PURE ON PURPOSE — this module imports nothing, so an oracle can run the real
// function under plain `node`. Directions are plain {x,y,z}, not Vector3, for
// the same reason. Same posture as badgePlacement.ts.

/** A unit direction. Right-handed, +Y up — the scene's own convention. */
export interface Dir3 { x: number; y: number; z: number; }

export interface SkyParams {
  /** Unit vector pointing AT the sun, in MODEL space (already north-corrected
   *  by SunController.modelAzimuth — this module never touches compass maths). */
  sun: Dir3;
  /** Haze, 1 (crisp alpine air) .. 10 (thick summer haze). Raises the horizon
   *  band, widens the sun's glow and desaturates the zenith. */
  turbidity: number;
  /** 0 = full day, 1 = full night. The same twilight factor SunController
   *  already drives the baked day/night atlas crossfade with, so the sky and
   *  the villa's own lighting cannot disagree about what time it is. */
  nightT: number;
}

/**
 * Cube face edge, in texels.
 *
 * ⚠️ 128 IS INHERITED FROM THE GRADIENT CUBE AND THE REASON STILL HOLDS — see
 * buildGradientEnv's note: glass is set to roughness 0.1, which samples mip 0
 * directly, and at 16 the texels were visible as pale squares in the panes
 * (misdiagnosed five times as a bake/atlas/geometry problem). 128 puts a texel
 * at ~0.7°.
 *
 * ⚠️ AND IT IS WHY THE SUN LOBE IS ~2° WIDE AND NOT THE REAL 0.53°. A true-size
 * disc is SUB-TEXEL here: it would land on one texel or none depending on where
 * the sun happened to fall, so it would flicker as the sun moved and vanish at
 * some times of day entirely. Widening the lobe trades angular accuracy — which
 * nothing in this app measures — for a stable highlight, which is the whole
 * point of having a sun in the map at all.
 */
export const SKY_FACE_SIZE = 128;

/** Linear (NOT sRGB) radiances. The cube is written as float and flagged
 *  gammaSpace = false, so these are the values the PBR shader actually gets. */
const ZENITH: readonly [number, number, number] = [0.18, 0.32, 0.72];
const HORIZON: readonly [number, number, number] = [0.62, 0.72, 0.86];
const GROUND: readonly [number, number, number] = [0.14, 0.12, 0.10];
const SUN_TINT: readonly [number, number, number] = [1.0, 0.86, 0.68];
const NIGHT: readonly [number, number, number] = [0.012, 0.018, 0.045];

/**
 * Peak radiance of the sun lobe.
 *
 * ⚠️ NOT PHYSICAL, AND DELIBERATELY SO. The real sun is ~10^5 times the sky, a
 * ratio no 8-bit cube could hold and which even in float would dominate the
 * spherical harmonics Babylon derives for DIFFUSE irradiance — every matte wall
 * in the villa would take its colour from the sun alone. 40 is chosen to give a
 * clearly visible specular highlight on glass and polished floors while leaving
 * the diffuse term recognisably sky-lit.
 */
const SUN_PEAK = 40;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

const mix3 = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** Rec.709 luminance — used only to desaturate toward a warm tint at sunset. */
const luma = (c: readonly [number, number, number]): number =>
  0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Sky radiance for one view direction. Exported so an oracle can assert the
 * SHAPE of the model (sun side brighter than anti-sun side, night darker than
 * day, no negative radiance) against the real function rather than a copy.
 */
export function skyRadiance(dir: Dir3, p: SkyParams): [number, number, number] {
  const turb = Math.min(10, Math.max(1, p.turbidity));
  const night = clamp01(p.nightT);

  // How high the sun is. Everything about the daytime sky scales off this:
  // below the horizon there is no sun term at all, which is what makes the
  // night branch fall out rather than needing to be special-cased.
  const sunUp = clamp01(p.sun.y);
  const dayAmp = 0.15 + 0.85 * Math.sqrt(sunUp);

  let c: [number, number, number];
  if (dir.y >= 0) {
    // ── Rayleigh-ish vertical gradient ────────────────────────────────────
    // A more turbid sky keeps its pale horizon colour further up, so the
    // exponent falls with turbidity rather than the colours changing.
    const t = Math.pow(clamp01(dir.y), 1 / (1 + turb * 0.2));
    c = mix3(HORIZON, ZENITH, t);

    // ── Sunset warmth ─────────────────────────────────────────────────────
    // As the sun drops, the band nearest the horizon desaturates toward the
    // sun's own tint. Weighted by (1 - t) so the zenith stays blue, which is
    // what actually happens and also stops the whole dome going orange.
    const warmth = Math.pow(1 - sunUp, 3) * (1 - t) * 0.6;
    if (warmth > 0) {
      const l = luma(c);
      c = mix3(c, [SUN_TINT[0] * l, SUN_TINT[1] * l, SUN_TINT[2] * l], warmth);
    }
  } else {
    // ── Ground ────────────────────────────────────────────────────────────
    // Not black: the ground bounces sky light back up, and that bounce is a
    // real part of how an interior looks through a window. Fades from the
    // horizon colour down to the earth colour.
    const gt = Math.pow(clamp01(-dir.y), 0.6);
    const bounce: [number, number, number] = [HORIZON[0] * 0.35, HORIZON[1] * 0.35, HORIZON[2] * 0.35];
    c = mix3(bounce, GROUND, gt);
  }

  c = [c[0] * dayAmp, c[1] * dayAmp, c[2] * dayAmp];

  // ── Mie-ish forward scattering + the sun lobe ───────────────────────────
  // Both keyed on the angle between this direction and the sun, and both
  // scaled by sunUp so they disappear together as the sun sets — no separate
  // "is it night" test, which is the kind of second owner this repo keeps
  // finding.
  const cosGamma = dir.x * p.sun.x + dir.y * p.sun.y + dir.z * p.sun.z;
  if (cosGamma > 0 && sunUp > 0) {
    const g = clamp01(cosGamma);
    // Crisp air concentrates the glow; haze spreads it wide.
    const glow = Math.pow(g, 8 + 120 / turb) * (0.5 + turb * 0.35) * sunUp;
    // ~2° half-angle, smoothly. See SKY_FACE_SIZE for why it is not 0.53°.
    const DISC_COS = Math.cos((2 * Math.PI) / 180);
    let disc = 0;
    if (g > DISC_COS) {
      const s = (g - DISC_COS) / (1 - DISC_COS);
      disc = s * s * (3 - 2 * s) * SUN_PEAK * sunUp;   // smoothstep
    }
    const add = glow + disc;
    c = [c[0] + SUN_TINT[0] * add, c[1] + SUN_TINT[1] * add, c[2] + SUN_TINT[2] * add];
  }

  // ── Night ───────────────────────────────────────────────────────────────
  // A floor rather than a multiply: a villa lit only by its own fixtures still
  // sits under a faint sky, and driving the environment to zero makes every
  // PBR surface read as a black hole rather than a dark room.
  if (night > 0) c = mix3(c, NIGHT, night);

  return c;
}

/**
 * The direction a cube-map texel looks along.
 *
 * ⚠️ FACE ORDER AND SIGNS ARE THE GRAPHICS-API CONVENTION (+X,-X,+Y,-Y,+Z,-Z
 * with V running downward), NOT something to re-derive from intuition. The
 * gradient cube next door only ever needed the Y component, so it could get
 * away with a two-line approximation; a sky with a SUN in it cannot — get a
 * sign wrong here and the sun appears on the opposite side of the villa, which
 * looks plausible enough in a screenshot to be missed.
 */
export function cubeDir(face: number, u: number, v: number): Dir3 {
  let x: number, y: number, z: number;
  switch (face) {
    case 0: x = 1; y = -v; z = -u; break;   // +X
    case 1: x = -1; y = -v; z = u; break;   // -X
    case 2: x = u; y = 1; z = v; break;     // +Y
    case 3: x = u; y = -1; z = -v; break;   // -Y
    case 4: x = u; y = -v; z = 1; break;    // +Z
    default: x = -u; y = -v; z = -1; break; // -Z
  }
  const len = Math.sqrt(x * x + y * y + z * z);
  return { x: x / len, y: y / len, z: z / len };
}

/**
 * Evaluate the sky into six RGBA float faces, ready for a RawCubeTexture.
 *
 * Float, not the gradient cube's 8-bit: a sun is the entire reason this exists
 * and 255 is not a sun. Cost is 6 * 128 * 128 * 4 * 4 B = 1.57 MB of VRAM
 * (~2.1 MB with mips) against the gradient's 393 KB — generated once per sun
 * position, never fetched, and adding nothing whatsoever to the GLB.
 */
export function buildSkyFaces(p: SkyParams, size: number = SKY_FACE_SIZE): Float32Array[] {
  const faces: Float32Array[] = [];
  for (let face = 0; face < 6; face++) {
    const data = new Float32Array(size * size * 4);
    for (let j = 0; j < size; j++) {
      const v = (j / (size - 1)) * 2 - 1;
      for (let i = 0; i < size; i++) {
        const u = (i / (size - 1)) * 2 - 1;
        const c = skyRadiance(cubeDir(face, u, v), p);
        const o = (j * size + i) * 4;
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 1;
      }
    }
    faces.push(data);
  }
  return faces;
}
